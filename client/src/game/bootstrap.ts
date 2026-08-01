/* eslint-disable @typescript-eslint/no-explicit-any */
// Bootstrap de partie : initialise les databases (cache mémoire via /api) et
// construit une GameSession avec ses dépendances data injectées. Isole les
// imports de la couche data/ hors de logic/.
import * as CardDatabase from '../data/CardDatabase.js';
import * as PowerDatabase from '../data/PowerDatabase.js';
import * as AttributeDatabase from '../data/AttributeDatabase.js';
import * as BoardDatabase from '../data/BoardDatabase.js';
import * as MagieDatabase from '../data/MagieDatabase.js';
import * as DeckRepository from '../data/DeckRepository.js';
import * as CardArt from '../data/CardArt.js';
import { GameSession } from '../logic/GameSession.js';
import type { Card } from '../logic/types.js';

let _dataReady = false;

export async function initGameData(): Promise<void> {
  if (_dataReady) return;
  await Promise.all([
    (CardDatabase as any).init(),
    (PowerDatabase as any).init(),
    (AttributeDatabase as any).init(),
    (BoardDatabase as any).init(),
    (MagieDatabase as any).init(),
  ]);
  _dataReady = true;
}

// Charge un deck nommé, ou null s'il est absent, illisible ou vide.
function tryLoadDeck(name: string | null | undefined): Record<string, string[]> | null {
  if (!name) return null;
  let raw: Record<string, string[]> | null = null;
  try { raw = (DeckRepository as any).loadDeck(name) as Record<string, string[]> | null; }
  catch { return null; }
  return raw && Object.values(raw).some(ids => (ids as string[])?.length) ? raw : null;
}

// Deck de repli : jusqu'à 8 cartes par tier tirées de la base, quand aucun deck
// n'est sauvegardé (le DeckBuilder arrive en Phase 5).
function autoDeck(): Record<string, string[]> {
  const deck: Record<string, string[]> = {};
  for (let t = 1; t <= 5; t++) {
    const cards = (CardDatabase as any).getCardsByTier(t) as Card[];
    // Cartes normales en priorité pour garantir un board jouable sans matériaux.
    const sorted = [...cards].sort((a, b) => (a.summon_type === 'normal' ? -1 : 1) - (b.summon_type === 'normal' ? -1 : 1));
    deck[String(t)] = sorted.slice(0, 8).map(c => c.id);
  }
  return deck;
}

// Retourne AUSSI le nom retenu : c'est lui qui porte les variantes
// d'illustration choisies pour ce deck (`null` sur le deck de repli, qui n'est
// enregistré nulle part).
function resolveDeck(deckName?: string): { deck: Record<string, string[]>; name: string | null } {
  const asked = tryLoadDeck(deckName);
  if (asked) return { deck: asked, name: deckName ?? null };

  const activeName = (DeckRepository as any).getActiveDeck?.() as string | null;
  const active = tryLoadDeck(activeName);
  if (active) return { deck: active, name: activeName ?? null };

  return { deck: autoDeck(), name: null };
}

/**
 * @param enemyDeck Deck adverse fourni tel quel (decks publics — Tournoi et
 *   partie solo — qui ne vivent pas dans DeckRepository) : prioritaire sur
 *   `enemyDeckName`, qui n'est plus qu'un libellé côté sélecteur.
 * @param playerDeck Deck du joueur fourni tel quel — même raison que
 *   `enemyDeck` : le deck d'entraînement du tutoriel est dérivé du catalogue et
 *   n'est enregistré nulle part, un nom ne suffirait pas à le recharger. Il
 *   court-circuite donc `resolveDeck` (et n'a, comme le deck de repli, aucune
 *   variante d'illustration attachée).
 */
export function buildSession(
  deckName?: string,
  mode: 'ai' | 'pvp' = 'ai',
  enemyDeckName?: string,
  enemyDeck?: Record<string, string[]> | null,
  playerDeck?: Record<string, string[]> | null,
): GameSession {
  const { deck: rawDeck, name: resolvedName } = playerDeck
    ? { deck: playerDeck, name: null }
    : resolveDeck(deckName);
  // Deck de l'IA : celui injecté par l'appelant, sinon celui choisi dans le
  // sélecteur, sinon miroir du deck joueur (comportement historique). Un nom
  // illisible retombe aussi sur le miroir.
  const rawEnemyDeck = enemyDeck ?? (enemyDeckName ? tryLoadDeck(enemyDeckName) : null) ?? rawDeck;

  // Illustrations : les variantes du deck engagé s'appliquent à la main, au
  // cimetière et au board. Le camp adverse repart à zéro — en solo comme en
  // tournoi l'IA joue un deck public, sans variante ; en PvP c'est
  // PvpController qui pose celles de l'adversaire une fois le match trouvé.
  CardArt.setPlayerVariants(resolvedName ? (DeckRepository as any).getDeckVariants?.(resolvedName) : null);
  CardArt.setEnemyVariants(null);

  const cardsByTier: Record<number, Card[]> = {};
  for (let t = 1; t <= 5; t++) {
    cardsByTier[t] = (rawDeck[String(t)] ?? [])
      .map(id => (CardDatabase as any).getCard(id) as Card | null)
      .filter(Boolean) as Card[];
  }

  return new GameSession({
    cardsByTier,
    enemyDeck: rawEnemyDeck,
    attributeList: (AttributeDatabase as any).getAllAttributes(),
    cardDb: CardDatabase as any,
    getRandomBoard: () => (BoardDatabase as any).getRandomBoard(),
    getRandomMagies: (count: number) => (MagieDatabase as any).getRandomMagies(count),
    mode,
  });
}

// Dépendances data pour le PvpController (résolution carte + terrains).
export function pvpDeps() {
  return {
    cardDb: CardDatabase as any,
    getBoard: (id: string) => (BoardDatabase as any).getBoard(id),
    getRandomBoard: () => (BoardDatabase as any).getRandomBoard(),
  };
}
