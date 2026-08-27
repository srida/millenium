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

/**
 * Contrecoup : ce que la magie coûte en PV JOUEUR. Champ de premier niveau
 * (`magie.cost_hp`) et non un champ d'`effect`, car il est orthogonal à
 * l'effet — n'importe quel type peut porter un coût. Absent, nul, négatif ou
 * mal saisi valent tous « aucun contrecoup » : une magie gratuite est le cas
 * normal, et une donnée douteuse ne doit jamais coûter des PV au joueur.
 * @param {any} magie
 * @returns {number}
 */
export function magieCostHp(magie) {
  const raw = Number(magie?.cost_hp);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
}

/**
 * ⚠️ Comparaison STRICTE : payer doit laisser le joueur à 1 PV au moins. Un
 * coût qui tue n'est pas un choix, et la modale de shopping n'a pas de
 * confirmation — un tap malheureux perdrait la partie. Corollaire utile : à
 * coût nul, la règle se réduit à « le joueur est en vie ».
 * @param {any} magie
 * @param {number} playerHp
 * @returns {boolean}
 */
export function canAffordMagie(magie, playerHp) {
  return playerHp > magieCostHp(magie);
}

/**
 * Noms lisibles des pouvoirs, pour `effectLabel` seul. ⚠️ Doublon ASSUMÉ de
 * `POWER_NAMES` (`three/`) : `logic/` ne doit rien importer de la couche 3D, et
 * `powers.json` n'est pas accessible d'ici (le module est pur). Un id absent de
 * la table retombe sur l'id brut plutôt que de masquer le pouvoir.
 */
const POWER_LABELS = {
  POWER_HEAL: 'Soin', POWER_SHIELD: 'Bouclier', POWER_SUPER_ATTACK: 'Super attaque',
  POWER_AOE_ATTACK: 'Attaque massive', POWER_POISON: 'Poison', POWER_BURN: 'Brûlure',
  POWER_PARALYSIS: 'Paralysie', POWER_PUSH: 'Poussée', POWER_DEBUFF: 'Débuff',
  POWER_BLOCK: 'Blocage', POWER_CONFUSION: 'Confusion', POWER_TAUNT: 'Provocation',
  POWER_TELEPORT: 'Téléportation', POWER_FREEZE: 'Gel',
};

const SUMMON_LABELS = {
  normal: 'Normale', sacrifice: 'Sacrifice', fusion: 'Fusion',
  heritage: 'Héritage', transformation: 'Transformation',
};

/**
 * `guaranteed_draw` porte deux filtres FACULTATIFS qui se cumulent : le tier et
 * la voie d'invocation. Le libellé doit dire lequel des trois cas on a sous les
 * yeux, sinon deux magies très différentes se lisent pareil.
 */
function guaranteedDrawLabel(e) {
  const parts = [];
  if (e.tier) parts.push(`Tier ${e.tier}`);
  if (e.category) parts.push(SUMMON_LABELS[e.category] || e.category);
  return parts.length ? `Pioche garantie ${parts.join(' · ')} ce tour` : 'Pioche garantie ce tour';
}

export function needsUnitTarget(magie) {
  return ['stat_bonus', 'stat_modifier', 'shield', 'heal', 'defuse_fusion', 'destroy_unit', 'drain_life',
    'grant_power', 'power_cooldown'].includes(magie?.effect?.type);
}

export function needsGraveyardTarget(magie) {
  return magie?.effect?.type === 'revive';
}

// Cible une carte de la MAIN (et non une unité du board ou du cimetière) —
// troisième famille de ciblage, cf. GameSession.magieNeedsHandTarget.
export function needsHandTarget(magie) {
  return magie?.effect?.type === 'hand_to_graveyard';
}

export function effectLabel(magie) {
  const e = magie?.effect;
  if (!e) return 'Aucun effet';
  switch (e.type) {
    case 'stat_bonus':       return `+${e.value} ${STAT_NAMES[e.stat] || e.stat} sur une unité (permanent)`;
    case 'team_stat_bonus':  return `+${e.value} ${STAT_NAMES[e.stat] || e.stat} sur TOUTES tes unités (permanent)`;
    case 'stat_modifier':    return `×${e.value} ${STAT_NAMES[e.stat] || e.stat} sur une unité (permanent)`;
    case 'draw_bonus':       return `+${e.value} carte${e.value > 1 ? 's' : ''} supplémentaire${e.value > 1 ? 's' : ''} ce tour`;
    case 'guaranteed_draw':  return guaranteedDrawLabel(e);
    case 'heal':             return 'Soigne ENTIÈREMENT une unité (PV au maximum)';
    case 'team_heal':        return `Soigne toutes tes unités de ${e.value} PV`;
    case 'revive':           return `Réanime une unité du cimetière à ${e.value}% de ses PV`;
    case 'shield':           return `+${e.value} bouclier sur une unité`;
    case 'grant_power':      return `Donne le pouvoir ${POWER_LABELS[e.power_id] || e.power_id || '?'} à une unité (remplace le sien)`;
    case 'power_cooldown':   return `Charge le pouvoir d'une unité ${e.value} fois plus vite`;
    case 'damage_multiplier_bonus': return `+${e.value} au multiplicateur de dégâts, jusqu'à la fin de la partie`;
    case 'player_hp_bonus':  return `+${e.value} PV joueur`;
    case 'board_slot_bonus':         return `+${e.value} slot${e.value > 1 ? 's' : ''} de board permanent${e.value > 1 ? 's' : ''}`;
    case 'defuse_fusion':            return 'Sépare un monstre Fusion en ses matériaux';
    case 'destroy_unit':             return 'Détruit une unité alliée (libère son emplacement, devient un matériau disponible au cimetière)';
    case 'drain_life':               return 'Absorbe les PV d\'une unité alliée : elle part au cimetière et tu récupères ses PV courants';
    case 'hand_to_graveyard':        return 'Envoie une carte de ta main au cimetière (utilisable comme matériau)';
    case 'reduce_sacrifice_cost':    return `-${e.value ?? 1} sacrifice(s) sur une carte Sacrifice en main`;
    case 'free_transformation':      return 'Invoque une Transformation sans son monstre cible';
    case 'remove_heritage_material':   return 'Retire le matériel obligatoire d\'une carte Heritage en main';
    case 'remove_fusion_material':     return `Retire ${e.value ?? 1} matériel(s) requis d'une carte Fusion en main`;
    default: return e.type;
  }
}

/**
 * `targetUnits` porte les magies d'équipe (team_stat_bonus) : elles n'ont pas
 * de cible à désigner mais frappent tout le board joueur, que `applyGlobalMagie`
 * leur passe. Annoté en JSDoc car TS infère sinon `null` — et non `any` — du
 * seul défaut de chaque champ.
 * @param {any} magie
 * @param {{ gameState?: any, targetUnit?: any, targetUnits?: any[] | null }} [ctx]
 */
export function applyEffect(magie, { gameState = null, targetUnit = null, targetUnits = null } = {}) {
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
    case 'team_stat_bonus':
      // Le même geste que stat_bonus, répété sur chaque unité du joueur : le
      // bonus est permanent (_base) et tracé (_shopping_bonus), donc transféré
      // à une invocation composite si l'unité est consommée comme matériau.
      for (const unit of (targetUnits || [])) {
        const was = unit._base[e.stat] ?? 0;
        unit._base[e.stat] = Math.max(1, was + e.value);
        _trackShoppingBonus(unit, e.stat, unit._base[e.stat] - was);
        unit._recomputeStats();
        if (e.stat === 'hp') unit.current_hp = Math.min(unit.max_hp, unit.current_hp + e.value);
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
      // Soin TOTAL : `value` n'est pas lu. `heal()` plafonne déjà à `max_hp`,
      // il n'y a donc rien à calculer — et le soin suit le max courant, bonus
      // de PV compris (magies de stat, vétérance).
      if (targetUnit) targetUnit.heal(targetUnit.max_hp);
      break;
    case 'team_heal':
      // Le soin de masse, lui, est CHIFFRÉ : c'est ce qui le distingue du soin
      // total à cible unique, qui n'aurait aucun contrepoids s'il frappait
      // tout le board.
      for (const unit of (targetUnits || [])) unit.heal(e.value);
      break;
    case 'shield':
      if (targetUnit) targetUnit.applyShield(e.value);
      break;
    case 'grant_power':
      if (targetUnit && e.power_id) {
        targetUnit.power_id = e.power_id;
        // ⚠️ La vitesse est posée telle quelle, sans repli sur l'ancienne : un
        // pouvoir donné sans vitesse hériterait de 9999 (le défaut d'`Unit`
        // pour « pas de pouvoir ») et ne partirait jamais. L'admin l'impose.
        targetUnit.power_speed = Math.max(1, e.power_speed ?? targetUnit.power_speed);
        targetUnit.power_value = e.value ?? null;
        // La jauge repart de zéro : héritée pleine de l'ancien pouvoir, le
        // nouveau se déclencherait au premier step, ce que rien n'annonce.
        targetUnit.power_gauge = 0;
        targetUnit.is_power_blocked = false;
        targetUnit.power_block_remaining = 0;
      }
      break;
    case 'power_cooldown':
      // `power_speed` est un SEUIL de jauge : plus il est bas, plus le pouvoir
      // part souvent. « Charger N fois plus vite » est donc une DIVISION, pas
      // une soustraction — un −4 plat ne veut pas dire la même chose sur un
      // pouvoir à 6 et sur un pouvoir à 40, exactement le piège qui a fait
      // passer POWER_PARALYSIS d'une sévérité plate à un doublement.
      if (targetUnit && targetUnit.power_id) {
        const factor = e.value > 0 ? e.value : 2;
        targetUnit.power_speed = Math.max(1, Math.round(targetUnit.power_speed / factor));
      }
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
      // Les deux filtres voyagent tels quels : `startPreparation` les ET-e, et
      // un champ absent n'y contraint rien. C'est la MÊME forme que celle des
      // effets d'attribut (`GuaranteedDraw`), consommée par le même code.
      if (gameState) gameState.player_guaranteed_draws.push({ tier: e.tier, category: e.category });
      break;
    case 'damage_multiplier_bonus':
      if (gameState) gameState.player_damage_multiplier_bonus += (e.value || 0);
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
    case 'remove_fusion_material':
      if (gameState) gameState.player_hand_modifiers.push({ type: 'remove_fusion_material', value: e.value ?? 1 });
      break;
    case 'defuse_fusion':
      // Handled by GameScreen._defuseFusion() — applyEffect is a no-op here
      break;
    case 'destroy_unit':
      // Handled by GameScreen._destroyUnit() — applyEffect is a no-op here
      break;
    case 'drain_life':
      // Handled by GameSession._drainLife() — applyEffect is a no-op here
      break;
    case 'hand_to_graveyard':
      // Handled by GameSession.applyMagieOnHandCard() — applyEffect is a no-op here
      break;
  }
}
