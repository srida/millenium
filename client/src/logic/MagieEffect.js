export const STAT_NAMES = {
  atk: 'ATK', hp: 'HP', attack_speed: 'Vit. attaque',
  movement_speed: 'Vit. déplacement', range: 'Portée', initiative: 'Initiative',
};

// Records the actual permanent _base delta granted by a Shopping Phase magie, so that
// InvocationManager can transfer it onto a composite unit if this unit is later consumed
// as material (sacrifice/fusion/heritage) or replaced (transformation).
function _trackShoppingBonus(unit, stat, delta) {
  if (!delta) return;
  unit._shopping_bonus = unit._shopping_bonus || {};
  unit._shopping_bonus[stat] = (unit._shopping_bonus[stat] || 0) + delta;
}

export function needsUnitTarget(magie) {
  return ['stat_bonus', 'stat_modifier', 'shield', 'heal', 'defuse_fusion', 'destroy_unit'].includes(magie?.effect?.type);
}

export function needsGraveyardTarget(magie) {
  return magie?.effect?.type === 'revive';
}

export function effectLabel(magie) {
  const e = magie?.effect;
  if (!e) return 'Aucun effet';
  switch (e.type) {
    case 'stat_bonus':       return `+${e.value} ${STAT_NAMES[e.stat] || e.stat} sur une unité (permanent)`;
    case 'stat_modifier':    return `×${e.value} ${STAT_NAMES[e.stat] || e.stat} sur une unité (permanent)`;
    case 'draw_bonus':       return `+${e.value} carte${e.value > 1 ? 's' : ''} supplémentaire${e.value > 1 ? 's' : ''} ce tour`;
    case 'guaranteed_draw':  return `Pioche garantie Tier ${e.tier} ce tour`;
    case 'heal':             return `Soigne une unité de ${e.value} PV`;
    case 'revive':           return `Réanime une unité du cimetière à ${e.value}% de ses PV`;
    case 'shield':           return `+${e.value} bouclier sur une unité`;
    case 'player_hp_bonus':  return `+${e.value} PV joueur`;
    case 'board_slot_bonus':         return `+${e.value} slot${e.value > 1 ? 's' : ''} de board permanent${e.value > 1 ? 's' : ''}`;
    case 'defuse_fusion':            return 'Sépare un monstre Fusion en ses matériaux';
    case 'destroy_unit':             return 'Détruit une unité alliée (libère son emplacement, devient un matériau disponible au cimetière)';
    case 'reduce_sacrifice_cost':    return `-${e.value ?? 1} sacrifice(s) sur une carte Sacrifice en main`;
    case 'free_transformation':      return 'Invoque une Transformation sans son monstre cible';
    case 'remove_heritage_material':   return 'Retire le matériel obligatoire d\'une carte Heritage en main';
    default: return e.type;
  }
}

export function applyEffect(magie, { gameState = null, targetUnit = null } = {}) {
  const e = magie?.effect;
  if (!e) return;
  switch (e.type) {
    case 'stat_bonus':
      if (targetUnit) {
        // Modify _base for permanence (survives resetCombatStats between rounds)
        const before = targetUnit._base[e.stat] ?? 0;
        targetUnit._base[e.stat] = Math.max(1, before + e.value);
        _trackShoppingBonus(targetUnit, e.stat, targetUnit._base[e.stat] - before);
        targetUnit._recomputeStats();
        if (e.stat === 'hp') targetUnit.current_hp = Math.min(targetUnit.max_hp, targetUnit.current_hp + e.value);
      }
      break;
    case 'stat_modifier':
      if (targetUnit) {
        const base = targetUnit._base[e.stat] ?? 0;
        targetUnit._base[e.stat] = Math.max(1, base + Math.round(base * (e.value - 1)));
        _trackShoppingBonus(targetUnit, e.stat, targetUnit._base[e.stat] - base);
        targetUnit._recomputeStats();
      }
      break;
    case 'heal':
      if (targetUnit) targetUnit.heal(e.value);
      break;
    case 'shield':
      if (targetUnit) targetUnit.applyShield(e.value);
      break;
    case 'revive':
      if (targetUnit) {
        targetUnit.is_neutralized = false;
        targetUnit._deathEmitted = false;
        targetUnit.dot_effects = [];
        targetUnit.burn_stacks = [];
        targetUnit.paralysis_remaining = 0;
        targetUnit.attack_speed_modifier = 0;
        targetUnit.is_power_blocked = false;
        targetUnit.power_block_remaining = 0;
        targetUnit.current_hp = Math.max(1, Math.round(targetUnit.max_hp * (e.value / 100)));
      }
      break;
    case 'player_hp_bonus':
      if (gameState) gameState.player_hp = Math.min(gameState.player_hp + e.value, 1000);
      break;
    case 'board_slot_bonus':
      if (gameState) gameState.grantLimitedBoardSlotBonus(e.value || 1);
      break;
    case 'draw_bonus':
      if (gameState) gameState.player_extra_draws += (e.value || 1);
      break;
    case 'guaranteed_draw':
      if (gameState) gameState.player_guaranteed_draws.push({ tier: e.tier });
      break;
    case 'reduce_sacrifice_cost':
      if (gameState) gameState.player_hand_modifiers.push({ type: 'reduce_sacrifice_cost', value: e.value ?? 1 });
      break;
    case 'free_transformation':
      if (gameState) gameState.player_hand_modifiers.push({ type: 'free_transformation' });
      break;
    case 'remove_heritage_material':
      if (gameState) gameState.player_hand_modifiers.push({ type: 'remove_heritage_material' });
      break;
    case 'defuse_fusion':
      // Handled by GameScreen._defuseFusion() — applyEffect is a no-op here
      break;
    case 'destroy_unit':
      // Handled by GameScreen._destroyUnit() — applyEffect is a no-op here
      break;
  }
}
