// Messages rapides du Duel en ligne : le catalogue, ses constantes et la table
// de réponse du bot. Pur — aucun import.
//
// Seul l'ID transite sur le réseau ; le texte se résout ici, côté client, ce
// qui laisse la porte ouverte à la traduction.
//
// ⚠️ `ws/emotes.js` (`EMOTE_IDS`) est le JUMEAU serveur de ce catalogue.
// `emotes.test.ts` les fait répondre la même chose.

export type BubbleShape = 'round' | 'think' | 'burst';
export type PanelKind = '3a' | '3b' | '3d' | '3e';

export interface Emote {
  id: string;
  text: string;
  shape: BubbleShape;
  /** La case manga qui l'accueille : une par TON de message. */
  panel: PanelKind;
  /** Onomatopée japonaise superposée à la case — pour CE message seulement. */
  sfx?: string;
}

// Espace fine insécable : le point d'exclamation ne passe jamais seul à la ligne.
const NB = ' ';

// L'ordre du tableau est celui du panneau (grille de 3 colonnes).
export const EMOTES: readonly Emote[] = [
  { id: 'bonjour', text: `Bonjour${NB}!`, shape: 'round', panel: '3a' },
  { id: 'chance', text: `Bonne chance${NB}!`, shape: 'round', panel: '3a' },
  { id: 'gg', text: `GG${NB}!`, shape: 'burst', panel: '3b', sfx: 'お見事' },
  { id: 'aie', text: `Aïe${NB}!`, shape: 'burst', panel: '3d', sfx: '痛っ！' },
  { id: 'oups', text: 'Oups…', shape: 'think', panel: '3e' },
  { id: 'hmm', text: 'Hmm…', shape: 'think', panel: '3e' },
  { id: 'duel', text: `C'est l'heure\ndu duel${NB}!`, shape: 'burst', panel: '3b' },
];

export const EMOTE_IDS: ReadonlySet<string> = new Set(EMOTES.map(e => e.id));

const BY_ID = new Map(EMOTES.map(e => [e.id, e]));
export function emoteById(id: string): Emote | null {
  return BY_ID.get(id) ?? null;
}

/** Délai entre deux envois. Le serveur applique sa propre borne, un peu plus basse. */
export const EMOTE_COOLDOWN_MS = 3000;
/** Durée d'affichage d'une case (entrée comprise). */
export const EMOTE_DISPLAY_MS = 2400;

// ── Réponse du bot ──────────────────────────────────────────────────────────
// Un duel contre bot ne passe pas par le relais : le client répond lui-même,
// pour que l'adversaire ait l'air de réagir.
const BOT_REPLIES: Readonly<Record<string, string>> = {
  bonjour: 'bonjour',
  chance: 'chance',
  gg: 'gg',
  aie: 'oups',
  oups: 'hmm',
  hmm: 'duel',
  duel: 'chance',
};

/** Part des messages auxquels le bot répond — pas à chaque fois, ce serait mécanique. */
export const BOT_REPLY_CHANCE = 0.6;
export const BOT_REPLY_MIN_MS = 1500;
export const BOT_REPLY_MAX_MS = 3000;

/**
 * La réponse du bot à un message du joueur, ou `null` s'il se tait.
 * Exactement deux appels à `rand` : le tirage de la réponse, puis celui du délai.
 */
export function botReplyTo(
  emoteId: string,
  rand: () => number = Math.random,
): { emoteId: string; delayMs: number } | null {
  const reply = BOT_REPLIES[emoteId];
  const speaks = rand() < BOT_REPLY_CHANCE;
  const delayMs = Math.round(BOT_REPLY_MIN_MS + rand() * (BOT_REPLY_MAX_MS - BOT_REPLY_MIN_MS));
  return reply && speaks ? { emoteId: reply, delayMs } : null;
}
