// Ce qu'une barre de vie ANNONCE quand elle bouge — pur, sans React ni DOM,
// donc éprouvable par la suite (qui tourne en node, cf. `handVisual.ts` et
// `cardFan.ts`, même partage : le module décide, le composant rend).
//
// La barre a deux lectures superposées, et c'est ce qui la rend lisible :
//   · le REMPLISSAGE, qui rejoint la valeur courante tout de suite ;
//   · la TRAÎNE, qui reste un instant sur la valeur d'avant et la rattrape —
//     c'est elle qui montre COMBIEN vient d'être encaissé, là où un
//     remplissage seul ne montre que le résultat.

/** Les PV de départ d'un joueur, et donc l'échelle de sa barre. */
export const HP_MAX = 1000;

/** Durée du décompte du chiffre, et de la traîne qui le suit. */
export const HP_TWEEN_MS = 700;
/** Combien de temps la traîne RESTE sur la valeur d'avant avant de rattraper. */
export const HP_LAG_HOLD_MS = 260;
/** Combien de temps le montant encaissé reste affiché à côté de la barre.
 *
 *  Dimensionné sur la frappe finale (`COMBAT_OUTRO_MS`), le plus gros coup que
 *  la barre encaisse — mais PAS importé d'elle : la barre bouge aussi au
 *  mulligan, au reroll et sur une magie, et ces montants-là n'ont aucune raison
 *  de durer ce que dure une fin de combat. */
export const HP_DELTA_MS = 1500;

/** Part remplie de la barre, bornée — une valeur négative ou hors barème ne
 *  doit jamais déborder la gouttière. */
export function hpRatio(value: number, max: number = HP_MAX): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/**
 * Le montant à écrire à côté de la barre, ou `null` quand il n'y a rien à dire.
 *
 * ⚠️ **Un delta nul ne s'affiche pas** : « 0 PV » se lirait comme une perte
 * (même règle que les paliers de niveau). Et le signe est TOUJOURS écrit — un
 * « 40 » nu, sur une barre de vie, ne dit pas dans quel sens elle va.
 */
export function hpDeltaLabel(delta: number): string | null {
  const d = Math.round(delta);
  if (!d) return null;
  return `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
}

/**
 * La valeur intermédiaire du décompte, à l'avancement `p` (0 → 1).
 *
 * ⚠️ Elle ARRIVE exactement sur `to` : l'interpolation est arrondie, mais `p = 1`
 * rend la cible telle quelle plutôt que son arrondi — une barre de vie qui
 * s'arrête à 1 PV de sa vraie valeur est un chiffre faux, et c'est celui que le
 * joueur relit au récapitulatif.
 */
export function hpTweenValue(from: number, to: number, p: number): number {
  if (p >= 1) return to;
  if (p <= 0) return from;
  // Départ franc, arrivée douce : le coup se lit tout de suite, le reste glisse.
  const eased = 1 - Math.pow(1 - p, 3);
  return Math.round(from + (to - from) * eased);
}
