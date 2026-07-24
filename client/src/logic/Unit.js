let _nextUid = 0;

export class Unit {
  constructor(card, side) {
    this.uid = _nextUid++;
    this.card_id = card.id;
    this.name = card.name;
    this.side = side; // 'player' | 'enemy'
    this.tier = card.tier;
    this.summon_type = card.summon_type;
    this.attributes = card.attributes || [];

    // Card IDs this unit "counts as" for fusion/heritage material matching.
    // Pre-determined on the card definition (admin panel) rather than computed at summon time.
    this.represented_ids = [...new Set([card.id, ...(card.represented_ids || [])])];
    // How many material "slots" this unit counts as when consumed as a
    // sacrifice/heritage material (set by InvocationManager.summon for
    // fusion/heritage/sacrifice results).
    this.material_value = 1;
    this.power_id = card.power?.id ?? null;
    this.power_speed = card.power?.power_speed ?? 9999;
    this.power_value = card.power?.value ?? null;

    // Frozen base stats (for reset)
    this._base = {
      atk: card.stats.atk,
      hp: card.stats.hp,
      movement_speed: card.stats.movement_speed,
      attack_speed: card.stats.attack_speed,
      initiative: card.stats.initiative,
      range: card.stats.range,
    };

    // Start-of-combat flat bonuses (from stat_bonus attribute effects)
    this._stat_bonuses = {};

    // Effective combat stats
    this.atk = card.stats.atk;
    this.max_hp = card.stats.hp;
    this.current_hp = card.stats.hp;
    this.movement_speed = card.stats.movement_speed;
    this.attack_speed = card.stats.attack_speed;
    this.initiative = card.stats.initiative;
    this.range = card.stats.range;

    // Runtime state
    this.shield = 0;
    this.power_gauge = 0;
    this.dot_effects = []; // { damage, remaining, interval, timer }
    this.burn_stacks = []; // { damage, attacksRemaining } — self-inflicted on this unit's next attacks
    this.paralysis_remaining = 0;  // steps left of paralysis
    this.attack_speed_modifier = 0; // added to attack_speed while paralyzed
    this.is_power_blocked = false;
    this.power_block_remaining = 0;
    this.confusion_remaining = 0;  // steps left of confusion (targets own allies)
    this.taunt_remaining = 0;      // steps left this unit forces enemies to target it
    this.is_effect_immune = false; // granted by effect_immunity attribute — blocks debuff powers

    this.position = null;         // { col, row }
    this.initial_position = null;
    this.is_neutralized = false;

    // Number of past combats this unit survived without being neutralized.
    // Lost when the unit is neutralized and never consumed as summon material
    // before the next combat (it simply stops existing). Carried over to
    // composite units the same way as Shopping Phase bonuses (see InvocationManager).
    this.veterancy_points = 0;

    // Internal action timers (tick up each step)
    this.attack_timer = 0;
    this.move_timer = 0;
  }

  // --- Combat queries ---

  effectiveAttackSpeed() {
    return Math.max(1, this.attack_speed + this.attack_speed_modifier);
  }

  isPowerReady() {
    return this.power_id && !this.is_power_blocked && this.power_gauge >= this.power_speed;
  }

  isAlive() {
    return !this.is_neutralized;
  }

  // --- Damage / healing ---

  takeDamage(amount) {
    let dmg = Math.max(0, amount);
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
    }
    this.current_hp = Math.max(0, this.current_hp - dmg);
    if (this.current_hp === 0) {
      this.is_neutralized = true;
      this.power_gauge = 0;
    }
    return dmg; // actual damage dealt (after shield)
  }

  heal(amount) {
    this.current_hp = Math.min(this.max_hp, this.current_hp + Math.max(0, amount));
  }

  applyShield(amount) {
    this.shield += Math.max(0, amount);
  }

  // --- Stat management ---

  applyStatBonus(stat, value) {
    this._stat_bonuses[stat] = (this._stat_bonuses[stat] || 0) + value;
    this._recomputeStats();
    // For HP bonuses, also increase current_hp so the unit benefits immediately
    if (stat === 'hp') this.current_hp += value;
  }

  // Called by during_combat stat_modifier effects (rage stacks, etc.)
  applyStatModifier(stat, value) {
    if (stat === 'atk') {
      this.atk = Math.max(1, this.atk + value);
    } else if (stat === 'hp') {
      this.max_hp += value;
      this.current_hp = Math.min(this.current_hp + value, this.max_hp);
    }
  }

  // Called by POWER_DEBUFF and at end of combat — strip all bonuses and status effects
  resetCombatStats() {
    this._stat_bonuses = {};
    this.power_gauge = 0;
    this.attack_speed_modifier = 0;
    this.paralysis_remaining = 0;
    this.is_power_blocked = false;
    this.power_block_remaining = 0;
    this.confusion_remaining = 0;
    this.taunt_remaining = 0;
    this.is_effect_immune = false;
    this.dot_effects = [];
    this.burn_stacks = [];
    this._recomputeStats();
    this.current_hp = Math.min(this.current_hp, this.max_hp);
  }

  _recomputeStats() {
    this.atk = Math.max(1, this._base.atk + (this._stat_bonuses.atk || 0));
    this.max_hp = Math.max(1, this._base.hp + (this._stat_bonuses.hp || 0));
    this.attack_speed = Math.max(1, this._base.attack_speed + (this._stat_bonuses.attack_speed || 0));
    this.movement_speed = this._base.movement_speed;
    this.initiative = this._base.initiative;
    this.range = Math.max(1, this._base.range + (this._stat_bonuses.range || 0));
  }

  // Serialise l'état pour le Board Inspector (debug)
  toDebugInfo() {
    return {
      uid: this.uid, name: this.name, side: this.side,
      hp: `${this.current_hp}/${this.max_hp}`, shield: this.shield,
      atk: this.atk, pos: this.position,
      power: `${this.power_gauge}/${this.power_speed}`,
    };
  }
}
