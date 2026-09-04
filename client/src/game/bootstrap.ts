/* eslint-disable @typescript-eslint/no-explicit-any */
// Bootstrap de partie : initialise les databases (cache mémoire via /api) et
// construit une GameSession avec ses dépendances data injectées. Isole les
// imports de la couche data/ hors de logic/.
import * as CardDatabase from '../data/CardDatabase.js';
import * as PowerDatabase from '../data/PowerDatabase.js';
import * as AttributeDatabase from '../data/AttributeDatabase.js';
import * as BoardDatabase from '../data/BoardDatabase.js';
import * as MagieDatabase from '../data/MagieDatabase.js';
import * as CardBackDatabase from '../data/CardBackDatabase.js';
import * as DeckRepository from '../data/DeckRepository.js';
import * as CardArt from '../data/CardArt.js';
import { GameSession } from '../logic/GameSession.js';
import { deckPoolByTier } from '../logic/Draw.js';
import type { Card } from '../logic/types.js';
import { summonCost } from '../logic/InvocationManager.js';

let _dataReady = false;

export async function initGameData(): Promise<void> {
  if (_dataReady) return;
  await Promise.all([
    (CardDatabase as any).init(),
    (PowerDatabase as any).init(),
    (AttributeDatabase as any).init(),
    (BoardDatabase as any).init(),
    (MagieDatabase as any).init(),
    // ⚠️ Ne jette jamais (cf. son en-tête) : un dos de carte n'est pas une
    // donnée de jeu, et un serveur qui ne connaîtrait pas encore la route ne
    // doit pas empêcher de jouer.
    (CardBackDatabase as any).init(),
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
    // Cartes sans condition en priorité, pour garantir un board jouable sans
    // matériaux — c'est le coût qui le dit, plus une voie nommée.
    const sorted = [...cards].sort((a, b) => summonCost(a) - summonCost(b));
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
 * @param enemyBonus Handicap plat (ATK/PV) appliqué à chaque unité de l'IA —
 *   le mode Arcade durcit ainsi ses quatre échelons. Absent partout ailleurs.
 * @param pvpRole Rôle du joueur local dans un duel en ligne. Il ne sert qu'à
 *   UNE chose : dire à la session que son monde est le MIROIR du repère de
 *   référence (`mirroredRole`), le rôle B jouant le reflet du monde de A.
 *   `logic/` ne connaît pas les rôles — il ne reçoit que le booléen.
 */
export function buildSession(
  deckName?: string,
  mode: 'ai' | 'pvp' = 'ai',
  enemyDeckName?: string,
  enemyDeck?: Record<string, string[]> | null,
  playerDeck?: Record<string, string[]> | null,
  enemyBonus?: { atk: number; hp: number } | null,
  pvpRole?: 'A' | 'B' | null,
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

  return new GameSession({
    // ⚠️ Le pool se dérive des TIERS DE LA CARTE, pas de la lane où le
    // DeckBuilder l'a rangée : une carte multi-tiers se pioche à chacun des
    // siens. La règle vit dans `Draw.deckPoolByTier`, que la simulation appelle
    // aussi — deux constructions de pool finiraient par ne plus s'accorder.
    cardsByTier: deckPoolByTier(rawDeck, CardDatabase as any),
    enemyDeck: rawEnemyDeck,
    attributeList: (AttributeDatabase as any).getAllAttributes(),
    cardDb: CardDatabase as any,
    getAllBoards: () => (BoardDatabase as any).getAllBoards(),
    getAllMagies: () => (MagieDatabase as any).getAllMagies(),
    mode,
    enemyBonus: enemyBonus ?? null,
    mirroredRole: mode === 'pvp' && pvpRole === 'B',
  });
}

// Dépendances data pour le PvpController (résolution carte + terrain convenu).
// ⚠️ Plus de `getRandomBoard` : le rôle A tire désormais depuis SA session
// (`pickCombatBoard`), seule à connaître les deux decks et les terrains déjà
// joués. Il ne reste que `getBoard`, dont les deux rôles se servent pour
// résoudre l'id que le serveur leur renvoie.
export function pvpDeps() {
  return {
    cardDb: CardDatabase as any,
    getBoard: (id: string) => (BoardDatabase as any).getBoard(id),
  };
}
