/**
 * AttributeManager
 *
 * Handles all attribute effects across three timings:
 *   start_of_combat  — stat_bonus, shield
 *   during_combat    — stat_modifier (on_enemy_neutralized, on_ally_neutralized)
 *   end_of_combat    — revive, draw_bonus, guaranteed_draw, board_slot_bonus
 *
 * Designed to be stateless between rounds: reconstruct each combat.
 */

// Veterancy: a unit that survives a combat without being neutralized gains 1 point
// (GameScreen3D._finishCombat). From 2 cumulated points onward it gets a permanent
// atk/hp bonus, scaling with the point count, applied/reset alongside start_of_combat
// attribute bonuses (see applyVeterancyBonuses below).
export const VETERANCY_THRESHOLD = 2;
export const VETERANCY_ATK_PER_POINT = 2;
export const VETERANCY_HP_PER_POINT = 15;
export class AttributeManager {
  /**
   * @param {Object[]} attributeList   - raw data from AttributeDatabase
   * @param {Unit[]}   playerUnits
   * @param {Unit[]}   enemyUnits
   */
  constructor(attributeList, playerUnits, enemyUnits) {
    this._attributeMap = Object.fromEntries(attributeList.map(a => [a.id, a]));
    this.playerUnits = playerUnits;
    this.enemyUnits = enemyUnits;

    // Bonuses applied to each unit at start of combat (for POWER_DEBUFF reapplication)
    this._appliedBonuses = new Map(); // uid → [{ stat, value }]

    // during_combat thresholds locked at start of combat so unit deaths mid-combat
    // don't deactivate effects that were already unlocked.
    this._duringCombatThresholds = null; // Map<attrId, { player, enemy }> — populated by applyStartOfCombat
  }

  // ── Counting ──

  // Counts distinct units (by card_id) — duplicate copies of the same card
  // only count once toward attribute thresholds.
  _countAttribute(attrId, units) {
    const ids = new Set();
    for (const u of units) {
      if (u.isAlive() && u.attributes.includes(attrId)) ids.add(u.card_id);
    }
    return ids.size;
  }

  // Returns the active threshold for this attribute on the given side, or null
  _activeThreshold(attrId, units) {
    const attr = this._attributeMap[attrId];
    if (!attr) return null;
    const count = this._countAttribute(attrId, units);
    let best = null;
    for (const t of attr.thresholds) {
      if (count >= t.count) best = t;
    }
    return best ? { attr, threshold: best, count } : null;
  }

  // ── Start of combat ──

  applyStartOfCombat() {
    this._applyStartForSide(this.playerUnits);
    this._applyStartForSide(this.enemyUnits);
    this._applyVeterancyBonuses();
    this._lockDuringCombatThresholds();
  }

  // Permanent atk/hp bonus for units with enough veterancy points, applied the same
  // way as attribute stat_bonus effects (so it's wiped by resetCombatStats and
  // recomputed each combat, and restored by reapplyBonuses() after POWER_DEBUFF).
  _applyVeterancyBonuses() {
    for (const u of [...this.playerUnits, ...this.enemyUnits]) {
      if (!u.isAlive() || u.veterancy_points < VETERANCY_THRESHOLD) continue;
      const atkBonus = u.veterancy_points * VETERANCY_ATK_PER_POINT;
      const hpBonus = u.veterancy_points * VETERANCY_HP_PER_POINT;
      u.applyStatBonus('atk', atkBonus);
      this._recordBonus(u, 'atk', atkBonus);
      u.applyStatBonus('hp', hpBonus);
      this._recordBonus(u, 'hp', hpBonus);
    }
  }

  // Snapshot which during_combat attributes are active on each side at combat start.
  // Once locked, mid-combat unit deaths cannot drop a threshold below its unlock level.
  _lockDuringCombatThresholds() {
    this._duringCombatThresholds = new Map();
    for (const attrId of Object.keys(this._attributeMap)) {
      const attr = this._attributeMap[attrId];
      if (attr.timing !== 'during_combat') continue;
      this._duringCombatThresholds.set(attrId, {
        player: this._activeThreshold(attrId, this.playerUnits),
        enemy:  this._activeThreshold(attrId, this.enemyUnits),
      });
    }
  }

  _applyStartForSide(units) {
    const attrIds = new Set(units.flatMap(u => u.attributes));
    for (const attrId of attrIds) {
      const result = this._activeThreshold(attrId, units);
      if (!result) continue;
      const { attr, threshold } = result;
      if (attr.timing !== 'start_of_combat') continue;

      for (const effect of threshold.effects) {
        switch (effect.type) {
          case 'stat_bonus': {
            // value_per: scale bonus by the count of enemy units carrying that attribute
            const otherUnits = units === this.playerUnits ? this.enemyUnits : this.playerUnits;
            const multiplier = effect.value_per
              ? otherUnits.filter(u => u.isAlive() && u.attributes.includes(effect.value_per)).length
              : 1;
            const bonus = effect.value * multiplier;
            if (bonus === 0) break;
            for (const u of units.filter(u => u.isAlive() && u.attributes.includes(attrId))) {
              u.applyStatBonus(effect.stat, bonus);
              this._recordBonus(u, effect.stat, bonus);
            }
            break;
          }

          case 'shield':
            // shield value = effect.value * number of active ally units on this side
            for (const u of units.filter(u => u.isAlive() && u.attributes.includes(attrId))) {
              const shieldAmount = effect.value * units.filter(x => x.isAlive()).length;
              u.applyShield(shieldAmount);
            }
            break;

          case 'effect_immunity':
            for (const u of units.filter(u => u.isAlive() && u.attributes.includes(attrId))) {
              u.is_effect_immune = true;
            }
            break;
        }
      }
    }
  }

  // ── During combat — triggered on death ──

  /**
   * Called by CombatManager when a unit is neutralized.
   * Returns extra events (stat changes) for the animator.
   */
  onUnitNeutralized(deadUnit, playerUnits, enemyUnits) {
    const events = [];
    const allySide = deadUnit.side === 'player' ? playerUnits : enemyUnits;
    const enemySide = deadUnit.side === 'player' ? enemyUnits : playerUnits;

    // Allies react to a dead ally
    this._triggerStatModifiers('on_ally_neutralized', allySide, allySide, events);
    // Enemies react to a dead enemy
    this._triggerStatModifiers('on_enemy_neutralized', enemySide, enemySide, events);

    return events;
  }

  _triggerStatModifiers(trigger, affectedUnits, referenceUnits, events) {
    const attrIds = new Set(affectedUnits.flatMap(u => u.attributes));
    const isPlayerSide = affectedUnits === this.playerUnits;

    for (const attrId of attrIds) {
      const cached = this._duringCombatThresholds?.get(attrId);
      const result = cached ? (isPlayerSide ? cached.player : cached.enemy) : null;
      if (!result) continue;
      const { attr, threshold } = result;

      for (const effect of threshold.effects) {
        if (effect.type !== 'stat_modifier' || effect.trigger !== trigger) continue;
        for (const u of affectedUnits.filter(u => u.isAlive() && u.attributes.includes(attrId))) {
          u.applyStatModifier(effect.stat, effect.value);
          events.push({ type: 'stat_change', unit: u, stat: effect.stat, value: effect.value });
        }
      }
    }
  }

  // ── End of combat ──

  /**
   * Resolve end-of-combat effects.
   * @param {Unit[]} playerNeutralized - units neutralized this combat (player side)
   * @param {Unit[]} enemyNeutralized  - units neutralized this combat (enemy side)
   * @returns {{ revived: Unit[], draw_bonus: number, guaranteed_draws: Object[], board_slot_bonus: number }}
   */
  applyEndOfCombat(playerNeutralized, enemyNeutralized) {
    const result = {
      revived: [],
      draw_bonus: 0,
      guaranteed_draws: [], // { category, attribute }
      board_slot_bonus: 0,
      damage_multiplier_bonus: 0,
      shopping_bonus: 0,
    };

    const attrIds = new Set(this.playerUnits.flatMap(u => u.attributes));

    for (const attrId of attrIds) {
      const attr = this._attributeMap[attrId];
      if (!attr || attr.timing !== 'end_of_combat') continue;

      // For end_of_combat, count ALL distinct units that participated (alive + neutralized)
      // so the threshold is met even if some attribute units died during combat
      const count = new Set(
        this.playerUnits.filter(u => u.attributes.includes(attrId)).map(u => u.card_id)
      ).size;
      let best = null;
      for (const t of attr.thresholds) {
        if (count >= t.count) best = t;
      }
      if (!best) continue;
      const threshold = best;

      for (const effect of threshold.effects) {
        switch (effect.type) {
          case 'revive': {
            const candidate = playerNeutralized[0];
            if (candidate) {
              const hpPct = (effect.hp_percent ?? 50) / 100;
              candidate.current_hp = Math.floor(candidate.max_hp * hpPct);
              candidate.is_neutralized = false;
              candidate._deathEmitted = false;
              candidate.dot_effects = [];
              candidate.paralysis_remaining = 0;
              candidate.attack_speed_modifier = 0;
              playerNeutralized.splice(0, 1);
              result.revived.push(candidate);
            }
            break;
          }
          case 'draw_bonus':
            result.draw_bonus = Math.min(result.draw_bonus + effect.value, effect.max ?? Infinity);
            break;
          case 'guaranteed_draw':
            result.guaranteed_draws.push({ category: effect.category, attribute: effect.attribute });
            break;
          case 'board_slot_bonus':
            result.board_slot_bonus = Math.min(result.board_slot_bonus + effect.value, effect.max ?? Infinity);
            break;
          case 'damage_multiplier_bonus':
            result.damage_multiplier_bonus += effect.value;
            break;
          case 'shopping_bonus':
            result.shopping_bonus = Math.min(result.shopping_bonus + (effect.value ?? 1), effect.max ?? Infinity);
            break;
        }
      }
    }

    return result;
  }

  // ── POWER_DEBUFF support ──

  _recordBonus(unit, stat, value) {
    if (!this._appliedBonuses.has(unit.uid)) this._appliedBonuses.set(unit.uid, []);
    this._appliedBonuses.get(unit.uid).push({ stat, value });
  }

  // Re-apply only the start-of-combat stat bonuses after POWER_DEBUFF reset
  reapplyBonuses(unit) {
    const bonuses = this._appliedBonuses.get(unit.uid) ?? [];
    for (const { stat, value } of bonuses) unit.applyStatBonus(stat, value);
  }

  // ── Public API for UI ──

  /** Returns active attribute synergies for display */
  getActiveSynergies(units) {
    const attrIds = new Set(units.flatMap(u => u.attributes));
    const synergies = [];
    for (const attrId of attrIds) {
      const attr = this._attributeMap[attrId];
      if (!attr) continue;
      if (!attr.thresholds || attr.thresholds.length === 0) continue; // archétype sans effet : pas affiché
      const count = this._countAttribute(attrId, units);
      const result = this._activeThreshold(attrId, units);
      const activeThreshold = result?.threshold ?? null;
      const nextThreshold = attr.thresholds
        .filter(t => t.count > count)
        .sort((a, b) => a.count - b.count)[0] ?? null;
      synergies.push({ attr, count, activeThreshold, nextThreshold });
    }
    return synergies.sort((a, b) => b.count - a.count);
  }
}
