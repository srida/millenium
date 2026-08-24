// Chargement du catalogue pour la simulation d'équilibrage.
//
// Mêmes chemins que `scripts/build-bot-decks.js` : `data/` s'il existe (le
// volume, donc le catalogue RÉELLEMENT servi aux joueurs, retouches admin
// comprises), sinon `initial-data/` (versionné, toujours présent sur un clone
// neuf). Un rapport qui mesurerait `initial-data/` alors que la prod tourne sur
// autre chose ne dirait rien d'utile — c'est pourquoi la routine fait un
// `sync-data.js pull` avant de lancer la simulation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AttributeDef, BoardDef, Card } from '../logic/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '../../..');

export const DATA_DIR = fs.existsSync(path.join(PROJECT, 'data', 'cards.json'))
  ? path.join(PROJECT, 'data')
  : path.join(PROJECT, 'initial-data');

/** `initial-data/` toujours : les decks de bots sont du CODE, pas de la donnée
 *  (cf. CLAUDE.md — ils ne sont ni copiés sur le volume ni éditables en admin). */
export const CODE_DIR = path.join(PROJECT, 'initial-data');

function load<T>(dir: string, file: string): T[] {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  return (Array.isArray(raw) ? raw : Object.values(raw)) as T[];
}

export interface Catalog {
  cards: Card[];
  attributes: AttributeDef[];
  boards: BoardDef[];
  botDecks: { id: string; name: string; deck: Record<string, string[]> }[];
  cardDb: { getCard(id: string): Card | null };
  /** Empreinte du catalogue mesuré — le rapport la porte pour qu'on sache
   *  toujours SUR QUOI un chiffre a été obtenu. */
  fingerprint: { source: string; cards: number; attributes: number; boards: number; hash: string };
}

/** FNV-1a sur les ids + stats : deux catalogues différents ne peuvent pas
 *  produire la même empreinte, et une retouche de stat la change. */
function hashCatalog(cards: Card[]): string {
  let h = 2166136261;
  for (const c of cards) {
    const s = `${c.id}:${c.tier}:${c.stats?.atk}:${c.stats?.hp}:${c.stats?.range}:${c.power?.id ?? ''}:${c.power?.value ?? ''}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function loadCatalog(): Catalog {
  const cards = load<Card>(DATA_DIR, 'cards.json');
  const attributes = load<AttributeDef>(DATA_DIR, 'attributes.json');
  const boards = load<BoardDef>(DATA_DIR, 'boards.json');
  const botDecks = load<{ id: string; name: string; deck: Record<string, string[]> }>(CODE_DIR, 'bot_decks.json');

  const byId = new Map(cards.map(c => [c.id, c]));
  return {
    cards, attributes, boards, botDecks,
    cardDb: { getCard: (id: string) => byId.get(id) ?? null },
    fingerprint: {
      source: path.basename(DATA_DIR),
      cards: cards.length,
      attributes: attributes.length,
      boards: boards.length,
      hash: hashCatalog(cards),
    },
  };
}
