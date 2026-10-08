// Le budget d'invocation (« énergie ») d'un tour de préparation.
//
// Le budget est un PLAFOND DE PLATEAU : chaque unité vivante du camp en occupe
// le coût de sa carte (son tier), survivantes des tours précédents comprises.
// Une invocation n'est permise que si le plateau, une fois posé, tient dans le
// budget du tour (3, 5, 8, 13, 21) — les matériaux consommés rendent le leur.
//
// ⚠️ Pur, aucun import hors `Tiers` : `GameSession` (joueur) et `EnemyAI` (IA)
// lisent les mêmes deux fonctions — deux tables finiraient par ne plus donner
// le même jeu aux deux camps.

import type { Card } from './types.js';
import { tiersOf, DEFAULT_TIER } from './Tiers.js';

/** Le budget de chaque tour, du tour 1 au tour 5. */
export const SUMMON_BUDGET: readonly number[] = [3, 5, 8, 13, 21];

/** Le budget d'un tour. Au-delà de la table, le dernier palier. */
export function budgetForRound(round: number): number {
  const i = Math.min(Math.max(1, round), SUMMON_BUDGET.length) - 1;
  return SUMMON_BUDGET[i];
}

/**
 * Ce qu'une invocation coûte : le tier de la carte.
 *
 * ⚠️ Le PLUS BAS de ses tiers pour une carte multi-tiers : c'est la question
 * « à partir de quand se joue-t-elle », la même que la pioche. Le plus haut
 * rendrait injouable au tour 1 une carte que le tour 1 pioche.
 */
export function energyCost(card: Card | null | undefined): number {
  const t = tiersOf(card);
  return t.length ? Math.min(...t) : DEFAULT_TIER;
}

/** Ce qu'une unité occupe du budget : le coût de sa carte. Un token ne coûte
 *  rien — il n'est posé par aucune invocation et quitte le plateau en fin de
 *  combat. */
export function unitEnergy(u: { energy_cost?: number; is_token?: boolean }): number {
  return u.is_token ? 0 : (u.energy_cost ?? 0);
}

/** Ce que ces unités occupent du budget, ensemble. */
export function boardEnergy(units: readonly { energy_cost?: number; is_token?: boolean }[]): number {
  let total = 0;
  for (const u of units) total += unitEnergy(u);
  return total;
}
