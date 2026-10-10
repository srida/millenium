// Ce que la jauge d'énergie DESSINE — pur, sans React ni DOM (même partage que
// `hpBar.ts` : le module décide, le composant rend).
//
// Trois sortes de cases, dans cet ordre : celles que le plateau OCCUPE, celles
// encore LIBRES ce tour, puis la RÉSERVE, qui n'a pas de plafond.

/** Au-delà, la réserve se dessine d'un seul bloc : vingt-sept cases d'un pixel
 *  ne se comptent plus, et écraseraient celles du tour. */
export const RESERVE_CELLS_MAX = 10;

export interface GaugeModel {
  /** Cases éteintes : l'énergie que le plateau occupe. */
  used: number;
  /** Cases dorées : ce qu'il reste à poser ce tour. */
  free: number;
  /** Cases hachurées une à une (0 quand elles sont fusionnées). */
  reserveCells: number;
  /** Vrai → un seul bloc hachuré. */
  reserveMerged: boolean;
  reserve: number;
  /** Plus rien à poser ce tour. */
  empty: boolean;
}

export function gaugeModel(left: number, budget: number, reserve: number): GaugeModel {
  const b = Math.max(0, budget);
  const l = Math.max(0, Math.min(left, b));
  const r = Math.max(0, reserve);
  return {
    used: b - l,
    free: l,
    reserveCells: r <= RESERVE_CELLS_MAX ? r : 0,
    reserveMerged: r > RESERVE_CELLS_MAX,
    reserve: r,
    empty: l === 0,
  };
}
