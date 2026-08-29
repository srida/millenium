// Durées des chronos de phase, partagées entre le controller (qui réinitialise
// l'instantané au changement de phase) et les composants React (qui décomptent).
// Elles vivaient en double dans GameScreen / GameScreenPvp : deux sources de
// vérité pour un même chrono, et l'une des deux oubliait la remise à zéro.
import { MAX_COMBAT_TICKS } from '../logic/CombatManager.js';

export const PREP_DURATION_S = 60;
export const END_ROUND_DURATION_S = 30;
export const SHOPPING_DURATION_S = 30;   // solo, PvP et tournoi — passage auto à 0
export const COMBAT_DURATION_S = 60;     // miroir de COMBAT_TIMEOUT_MS côté logique

/** Annonce du terrain à l'entrée en combat (cf. `TerrainAlert`).
 *
 *  ⚠️ UNE seule source pour cette durée : elle borne le `setTimeout` qui retient
 *  le premier coup (`GameController`) *et* alimente la variable CSS qui pilote
 *  l'animation. Les laisser diverger ferait, au choix, une carte qui s'efface
 *  avant que le combat ne parte, ou un combat qui démarre sous une carte encore
 *  affichée. */
export const TERRAIN_ALERT_MS = 2500;

// Secondes de combat restantes, dérivées des ticks (jamais d'horloge murale :
// à ×2/×4 le combat consomme ses ticks plus vite, le chrono suit).
export function combatSecondsLeft(remainingTicks: number): number {
  return Math.ceil(COMBAT_DURATION_S * remainingTicks / MAX_COMBAT_TICKS);
}
