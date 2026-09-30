// Seuil du chrono « bas » : en dessous (inclus), le chrono de préparation vire
// au rouge et pulse, et `timer_low` a été joué une fois. Partagé par
// `PhaseTimer` (le son) et `PhaseControls` (l'indication) — deux seuils
// recopiés finiraient par ne plus s'accorder.
export const TIMER_LOW_S = 10;

export function isTimerLow(remaining: number): boolean {
  return remaining <= TIMER_LOW_S;
}
