// Holo, éclats, encre, cadre d'un deck — la part PURE de leur édition
// (DeckBuilder, IllustrationPicker). Rien d'ici ne touche au rendu ni au réseau.
import type { CardFinish, FinishMap, FrameStyle, InkStyle } from './CardArt.js';

/** Ce que le joueur possède pour UNE carte. */
export interface OwnedFinishes {
  foil: boolean;
  holo: boolean;
  sparkle: boolean;
  inks: InkStyle[];
  frames: FrameStyle[];
}

export const NO_FINISH: CardFinish = Object.freeze({});
export const NO_OWNED_FINISHES: OwnedFinishes = Object.freeze({
  foil: false, holo: false, sparkle: false, inks: [], frames: [],
});

/** Le joueur possède-t-il au moins un effet (hors reflet) ou un cadre pour cette carte ? */
export function hasAnyFinish(owned: OwnedFinishes | null | undefined): boolean {
  return !!owned && (owned.holo || owned.sparkle || owned.inks.length > 0 || owned.frames.length > 0);
}

/** Le choix du deck, réduit à ce qui est POSSÉDÉ — c'est ce qu'on aperçoit et ce qu'on enregistre. */
export function visibleFinish(finish: CardFinish, owned: OwnedFinishes | null | undefined): CardFinish {
  if (!owned) return NO_FINISH;
  const out: CardFinish = {};
  if (finish.holo && owned.holo) out.holo = true;
  if (finish.sparkle && owned.sparkle) out.sparkle = true;
  if (finish.ink && owned.inks.includes(finish.ink)) out.ink = finish.ink;
  if (finish.frame && owned.frames.includes(finish.frame)) out.frame = finish.frame;
  return out;
}

/** À l'enregistrement : retire les cartes sorties du deck et ce qui n'est plus possédé. */
export function pruneFinishes(
  finishes: FinishMap, inDeck: ReadonlySet<string>, ownedOf: (cardId: string) => OwnedFinishes,
): FinishMap {
  const out: FinishMap = {};
  for (const [cardId, finish] of Object.entries(finishes)) {
    if (!inDeck.has(cardId)) continue;
    const kept = visibleFinish(finish, ownedOf(cardId));
    if (Object.keys(kept).length) out[cardId] = kept;
  }
  return out;
}
