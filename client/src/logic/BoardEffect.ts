import type { BoardEffectDef } from './types.js';
import type { Unit } from './Unit.js';
import type { GameState } from './GameState.js';

interface BoardEffectContext {
  playerUnits?: Unit[];
  enemyUnits?: Unit[];
  gameState?: GameState | null;
}

export function applyEffect(effect: BoardEffectDef | null | undefined, { playerUnits = [], enemyUnits = [], gameState = null }: BoardEffectContext = {}): void {
  if (!effect) return;
  const all = [...playerUnits, ...enemyUnits];
  const targets = effect.target_attributes?.length
    ? all.filter(u => u.attributes.some(a => (effect.target_attributes as string[]).includes(a)))
    : all;
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
