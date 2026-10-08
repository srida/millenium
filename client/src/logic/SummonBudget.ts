// Le budget d'invocation (« énergie ») d'un tour de préparation.
//
// Chaque tour donne un budget, chaque invocation depuis la main en coûte le
// TIER de sa carte. Ce qui n'est pas dépensé est perdu : la suite (3, 5, 8, 13,
// 21) grandit déjà plus vite que le plateau ne se remplit.
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
