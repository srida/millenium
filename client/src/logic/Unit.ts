import type { Card, DotEffect, BurnStack, Position, Side } from './types.js';

let _nextUid = 0;

/** Réinitialise le compteur d'uid — usage réservé aux tests. */
export function __resetUnitUidsForTests(): void {
  _nextUid = 0;
}

interface BaseStats {
  atk: number;
  hp: number;
  movement_speed: number;
  attack_speed: number;
  initiative: number;
  range: number;
  // _transferShoppingBonuses / MagieEffect écrivent des stats arbitraires dans _base
  [stat: string]: number;
}

export class Unit {
  uid: number;
  card_id: string;
  name: string;
  side: Side;
  tier: number;
  summon_type: string;
  attributes: string[];

  // Card IDs this unit "counts as" for fusion/heritage material matching.
  // Pre-determined on the card definition (admin panel) rather than computed at summon time.
  represented_ids: string[];
  // How many material "slots" this unit counts as when consumed as a
  // sacrifice/heritage material (set by InvocationManager.summon for
  // fusion/heritage/sacrifice results).
  material_value: number;
  power_id: string | null;
  power_speed: number;
  power_value: number | null;

  // Frozen base stats (for reset)
  _base: BaseStats;
  // Start-of-combat flat bonuses (from stat_bonus attribute effects)
  _stat_bonuses: Record<string, number>;
  // Bonus permanents de la Phase Shopping, transférés aux invocations composites
  // (posé par MagieEffect._trackShoppingBonus / InvocationManager)
  _shopping_bonus?: Record<string, number>;
  // Posé par CombatManager._checkDeaths pour ne pas ré-émettre 'death'
  _deathEmitted?: boolean;

  // Effective combat stats
  atk: number;
  max_hp: number;
  current_hp: number;
  movement_speed: number;
  attack_speed: number;
  initiative: number;
  range: number;

  // Runtime state
  shield: number;
  power_gauge: number;
  dot_effects: DotEffect[];
  burn_stacks: BurnStack[]; // self-inflicted on this unit's next attacks
  paralysis_remaining: number; // steps left of paralysis
  attack_speed_modifier: number; // added to attack_speed while paralyzed
  is_power_blocked: boolean;
  power_block_remaining: number;
  confusion_remaining: number; // steps left of confusion (targets own allies)
  taunt_remaining: number; // steps left this unit forces enemies to target it
  is_effect_immune: boolean; // granted by effect_immunity attribute — blocks debuff powers

  position: Position | null;
  initial_position: Position | null;
  is_neutralized: boolean;

  // Number of past combats this unit survived without being neutralized.
  // Lost when the unit is neutralized and never consumed as summon material
  // before the next combat (it simply stops existing). Carried over to
  // composite units the same way as Shopping Phase bonuses (see InvocationManager).
  veterancy_points: number;

  // Internal action timers (tick up each step)
  attack_timer: number;
  move_timer: number;

  constructor(card: Card, side: Side) {
    this.uid = _nextUid++;
    this.card_id = card.id;
    this.name = card.name;
    this.side = side;
    this.tier = card.tier;
    this.summon_type = card.summon_type;
    this.attributes = card.attributes || [];

    this.represented_ids = [...new Set([card.id, ...(card.represented_ids || [])])];
    this.material_value = 1;
    this.power_id = card.power?.id ?? null;
    this.power_speed = card.power?.power_speed ?? 9999;
    this.power_value = card.power?.value ?? null;

    this._base = {
      atk: card.stats.atk,
      hp: card.stats.hp,
      movement_speed: card.stats.movement_speed,
      attack_speed: card.stats.attack_speed,
      initiative: card.stats.initiative,
      range: card.stats.range,
    };

    this._stat_bonuses = {};

    this.atk = card.stats.atk;
    this.max_hp = card.stats.hp;
    this.current_hp = card.stats.hp;
    this.movement_speed = card.stats.movement_speed;
    this.attack_speed = card.stats.attack_speed;
    this.initiative = card.stats.initiative;
    this.range = card.stats.range;

    this.shield = 0;
    this.power_gauge = 0;
    this.dot_effects = [];
    this.burn_stacks = [];
    this.paralysis_remaining = 0;
    this.attack_speed_modifier = 0;
    this.is_power_blocked = false;
    this.power_block_remaining = 0;
    this.confusion_remaining = 0;
    this.taunt_remaining = 0;
    this.is_effect_immune = false;

    this.position = null;
    this.initial_position = null;
    this.is_neutralized = false;

    this.veterancy_points = 0;

    this.attack_timer = 0;
    this.move_timer = 0;
  }

  // --- Combat queries ---

  effectiveAttackSpeed(): number {
    return Math.max(1, this.attack_speed + this.attack_speed_modifier);
  }

  isPowerReady(): boolean {
    return !!this.power_id && !this.is_power_blocked && this.power_gauge >= this.power_speed;
  }

  isAlive(): boolean {
    return !this.is_neutralized;
  }

  // --- Damage / healing ---

  takeDamage(amount: number): number {
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

  heal(amount: number): void {
    this.current_hp = Math.min(this.max_hp, this.current_hp + Math.max(0, amount));
  }

  applyShield(amount: number): void {
    this.shield += Math.max(0, amount);
  }

  // --- Stat management ---

  applyStatBonus(stat: string, value: number): void {
    this._stat_bonuses[stat] = (this._stat_bonuses[stat] || 0) + value;
    this._recomputeStats();
    // For HP bonuses, also increase current_hp so the unit benefits immediately
    if (stat === 'hp') this.current_hp += value;
  }

  // Called by during_combat stat_modifier effects (rage stacks, etc.)
  applyStatModifier(stat: string, value: number): void {
    if (stat === 'atk') {
      this.atk = Math.max(1, this.atk + value);
    } else if (stat === 'hp') {
      this.max_hp += value;
      this.current_hp = Math.min(this.current_hp + value, this.max_hp);
    }
  }

  // Called by POWER_DEBUFF and at end of combat — strip all bonuses and status effects
  resetCombatStats(): void {
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

  _recomputeStats(): void {
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
