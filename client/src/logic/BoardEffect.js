export function applyEffect(effect, { playerUnits = [], enemyUnits = [], gameState = null } = {}) {
  if (!effect) return;
  const all = [...playerUnits, ...enemyUnits];
  const targets = effect.target_attributes?.length
    ? all.filter(u => u.attributes.some(a => effect.target_attributes.includes(a)))
    : all;
  switch (effect.type) {
    case 'stat_bonus':
      for (const u of targets) u.applyStatBonus(effect.stat, effect.value);
      break;
    case 'stat_modifier':
      // Convert multiplicative to additive equivalent so resetCombatStats() cleans it up
      for (const u of targets) u.applyStatBonus(effect.stat, Math.round(u._base[effect.stat] * (effect.value - 1)));
      break;
    case 'shield':
      for (const u of targets) u.applyShield(effect.value);
      break;
    case 'draw_bonus':
      if (gameState) gameState.player_extra_draws = (gameState.player_extra_draws || 0) + effect.value;
      break;
  }
}
