import type { BoardEffectDef } from './types.js';
import type { Unit } from './Unit.js';
import type { GameState } from './GameState.js';

interface BoardEffectContext {
  playerUnits?: Unit[];
  enemyUnits?: Unit[];
  gameState?: GameState | null;
}

/**
 * Les unités qu'un effet de terrain touche, parmi celles qu'on lui donne.
 *
 * ⚠️ Extrait d'`applyEffect`, qui l'appelle — et JAMAIS recopié ailleurs :
 * l'annonce de terrain (`GameController`, à l'entrée en combat) compte ses
 * unités boostées avec cette fonction. Deux expressions du même filtre, ce
 * serait s'autoriser à annoncer au joueur un décompte que l'effet n'a pas
 * appliqué.
 *
 * `target_attributes` vide ou absent = TOUTES les unités reçues.
 */
export function effectTargets(effect: BoardEffectDef | null | undefined, units: Unit[]): Unit[] {
  if (!effect) return [];
  const targets = effect.target_attributes;
  if (!targets?.length) return units;
  return units.filter(u => u.attributes.some(a => targets.includes(a)));
}

export function applyEffect(effect: BoardEffectDef | null | undefined, { playerUnits = [], enemyUnits = [], gameState = null }: BoardEffectContext = {}): void {
  if (!effect) return;
  const targets = effectTargets(effect, [...playerUnits, ...enemyUnits]);
  switch (effect.type) {
    case 'stat_bonus':
      for (const u of targets) u.applyStatBonus(effect.stat as string, effect.value as number);
      break;
    case 'stat_modifier':
      // Convert multiplicative to additive equivalent so resetCombatStats() cleans it up
      for (const u of targets) u.applyStatBonus(effect.stat as string, Math.round(u._base[effect.stat as string] * ((effect.value as number) - 1)));
      break;
    case 'shield':
      for (const u of targets) u.applyShield(effect.value as number);
      break;
    case 'draw_bonus':
      if (gameState) gameState.player_extra_draws = (gameState.player_extra_draws || 0) + (effect.value as number);
      break;
  }
}
