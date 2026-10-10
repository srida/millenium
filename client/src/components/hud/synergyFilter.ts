// Quels attributs la liste de bonus montre — pur, testé en node.
//
// Un attribut au palier, ou à UNE unité du suivant : c'est là que le joueur a
// une décision à prendre. Un 1/3 n'en appelle aucune ce tour-ci, et dix puces
// en colonne recouvriraient le bord du plateau.
import type { SynergyEntry } from '../../stores/gameStore.js';

export function isNearThreshold(s: SynergyEntry): boolean {
  return !s.activeThreshold && !!s.nextThreshold && s.nextThreshold.count - s.count === 1;
}

export function isShownSynergy(s: SynergyEntry): boolean {
  return !!s.activeThreshold || isNearThreshold(s);
}

// Les attributs au palier passent en tête, ceux à une unité du suivant après.
// Tri stable : à l'intérieur de chaque groupe, l'ordre reçu est conservé.
export function orderShownSynergies(list: readonly SynergyEntry[]): SynergyEntry[] {
  return [...list.filter(s => !!s.activeThreshold), ...list.filter(s => !s.activeThreshold)];
}
