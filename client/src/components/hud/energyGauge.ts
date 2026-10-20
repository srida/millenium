// Ce que la jauge d'énergie DESSINE — pur, sans React ni DOM (même partage que
// `hpBar.ts` : le module décide, le composant rend).
//
// Quatre sortes de cases, dans cet ordre : celles que le plateau OCCUPE, celles
// que les cartes multi-tiers RÉCLAMENT (grises), celles encore LIBRES ce tour,
// puis la RÉSERVE, qui n'a pas de plafond.

/** Au-delà, la réserve se dessine d'un seul bloc : vingt-sept cases d'un pixel
 *  ne se comptent plus, et écraseraient celles du tour. */
export const RESERVE_CELLS_MAX = 10;

export interface GaugeModel {
  /** Cases éteintes : l'énergie que le plateau occupe. */
  used: number;
  /** Cases grises : l'énergie que les cartes multi-tiers réclament jusqu'à
   *  leur plus haut tier — encore posable, consommée en fin de préparation. */
  pending: number;
  /** Cases dorées : ce qu'il reste à poser ce tour, hors cases grises. */
  free: number;
  /** Cases hachurées une à une (0 quand elles sont fusionnées). */
  reserveCells: number;
  /** Vrai → un seul bloc hachuré. */
  reserveMerged: boolean;
  reserve: number;
  /** Plus rien de libre ce tour (les cases grises restent posables). */
  empty: boolean;
}

export function gaugeModel(left: number, budget: number, reserve: number, pending = 0): GaugeModel {
  const b = Math.max(0, budget);
  const l = Math.max(0, Math.min(left, b));
  const p = Math.max(0, Math.min(pending, l));
  const r = Math.max(0, reserve);
  return {
    used: b - l,
    pending: p,
    free: l - p,
    reserveCells: r <= RESERVE_CELLS_MAX ? r : 0,
    reserveMerged: r > RESERVE_CELLS_MAX,
    reserve: r,
    empty: l - p === 0,
  };
}
