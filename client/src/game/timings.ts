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

/** Annonce du changement de tour, à l'ouverture de la préparation.
 *
 *  ⚠️ Même règle que `TERRAIN_ALERT_MS` : c'est le CONTRÔLEUR qui tient ce
 *  minuteur (il enchaîne sur la popup de pioche), la variable CSS n'en est
 *  qu'un miroir. Un tap la saute et ouvre la popup tout de suite. */
export const ROUND_INTRO_MS = 1400;

/** Popup de pioche laissée sans réponse : au bout de ce délai elle se congédie
 *  seule.
 *
 *  ⚠️ Armée en PvP UNIQUEMENT. En solo la popup gèle le chrono de préparation
 *  et peut donc attendre indéfiniment ; en duel le chrono continue (l'adversaire
 *  attend à la barrière réseau et ne doit pas pouvoir être bloqué), et une
 *  popup oubliée à l'écran masquerait au joueur sa propre préparation. Rien
 *  n'est perdu à ce congédiement : la main est déjà piochée. */
export const DRAW_POPUP_AUTO_MS = 8000;

// Secondes de combat restantes, dérivées des ticks (jamais d'horloge murale :
// à ×2/×4 le combat consomme ses ticks plus vite, le chrono suit).
export function combatSecondsLeft(remainingTicks: number): number {
  return Math.ceil(COMBAT_DURATION_S * remainingTicks / MAX_COMBAT_TICKS);
}
