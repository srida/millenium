// Le joker mis en mots — pur, partagé par le bouton de préparation, le HUD et le
// récapitulatif de round. La règle elle-même vit dans `logic/GameState.ts`.
import { JOKER_FACTOR, type JokerKind } from '../logic/GameState.js';

/** Un facteur écrit comme le joueur le lit : « ×2 », « ×0,5 », « ×0,25 ». */
export function factorLabel(factor: number): string {
  return '×' + factor.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

/** L'étiquette d'un joker posé, `null` sans joker. */
export function jokerLabel(kind: JokerKind | null | undefined): string | null {
  return kind ? factorLabel(JOKER_FACTOR[kind]) : null;
}

/** Les deux jokers proposés, dans l'ordre du sélecteur. */
export const JOKER_CHOICES: readonly { kind: JokerKind; label: string; hint: string }[] = [
  { kind: 'x2', label: '×2', hint: 'Dégâts doublés ce round, dans les deux sens' },
  { kind: 'half', label: '×0,5', hint: 'Dégâts divisés par deux ce round, dans les deux sens' },
];
