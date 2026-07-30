import { chebyshevDistance, manhattanDistance, findClosestEnemy, findAttackTarget, isInAttackRange, canAttack, hasLineOfSight, stepToward, stepTowardOrNearest } from './PathFinder.js';

// Power constants
const POWER_SUPER_ATTACK_MULT = 3;
const POWER_HEAL_RATIO = 0.4;        // % of healer max_hp
const POWER_SHIELD_MULT = 2;         // × atk
const POWER_PARALYSIS_MODIFIER = 6;  // added to attack_speed
const POWER_PARALYSIS_TICKS = 20;
const POWER_BLOCK_TICKS = 25;
const POWER_CONFUSION_TICKS = 20;
const POWER_TAUNT_TICKS = 20;
const DOT_DAMAGE_DIVISOR = 2;
const DOT_INTERVAL = 3;              // global steps between DOT pulses
const DOT_PULSES = 5;
const BURN_DAMAGE_DIVISOR = 2;
const BURN_ATTACKS = 3;              // number of the target's own attacks before the curse expires

// Mirrors CombatAnimator3D's BASE_TICK_MS (180ms/tick at speed ×1) — kept in
// sync manually since logic/ never imports from ui/. A combat that's still
// going after this many ticks (60s of real time at ×1) is cut short by a timeout.
const BASE_TICK_MS = 180;
const COMBAT_TIMEOUT_MS = 60_000;
export const MAX_COMBAT_TICKS = Math.round(COMBAT_TIMEOUT_MS / BASE_TICK_MS);

export class CombatManager {
  /**
   * @param {Board} board
   * @param {Unit[]} playerUnits
   * @param {Unit[]} enemyUnits
   * @param {AttributeManager} attributeManager
   */
  constructor(board, playerUnits, enemyUnits, attributeManager) {
    this.board = board;
    this.playerUnits = playerUnits;
    this.enemyUnits = enemyUnits;
    this.attributeManager = attributeManager;
    this.isOver = false;
    this.winner = null; // 'player' | 'enemy' | 'draw' | 'timeout'
    this._stepCount = 0;
  }

  // Ticks left before the combat is cut short by the timeout (see _checkTimeout).
  remainingTicks() {
    return Math.max(0, MAX_COMBAT_TICKS - this._stepCount);
  }

  /**
   * Advance the combat by one tick.
   * Returns an array of events describing what happened.
   * Event shapes:
   *   { type: 'move',    unit, from, to }
   *   { type: 'attack',  attacker, target, damage }
   *   { type: 'power',   unit, targets, power_id, extra }
   *   { type: 'dot',     unit, damage }
   *   { type: 'freeze',  cell, expiresAtStep }
   *   { type: 'death',   unit }
   *   { type: 'combat_end', winner }
   */
  step() {
    if (this.isOver) return [{ type: 'combat_end', winner: this.winner }];

    const events = [];
    this._stepCount++;
    this.board.purgeExpiredTemporaryBlocks(this._stepCount);

    const allUnits = [...this.playerUnits, ...this.enemyUnits];
    const livingUnits = allUnits.filter(u => u.isAlive());

    // Sort by initiative desc, tie-break by attack_speed desc, then card_id asc
    // card_id is absolute (same value on both PvP clients) — prevents ordering divergence on equal stats
    livingUnits.sort((a, b) =>
      b.initiative - a.initiative ||
      b.effectiveAttackSpeed() - a.effectiveAttackSpeed() ||
      a.card_id.localeCompare(b.card_id));

    // ── 1. Passive ticks (power gauge, DOT, paralysis, power block) ──
    for (const u of livingUnits) {
      // 'power_charge' is a regular stat_bonus stat (applied via AttributeManager
      // like atk/hp) that speeds up power gauge charging instead of a combat stat.
      u.power_gauge += 1 + (u._stat_bonuses.power_charge || 0);

      // Paralysis countdown
      if (u.paralysis_remaining > 0) {
        u.paralysis_remaining--;
        if (u.paralysis_remaining === 0) u.attack_speed_modifier = 0;
      }

      // Power block countdown
      if (u.power_block_remaining > 0) {
        u.power_block_remaining--;
        if (u.power_block_remaining === 0) u.is_power_blocked = false;
      }

      // Confusion / taunt countdown
      if (u.confusion_remaining > 0) u.confusion_remaining--;
      if (u.taunt_remaining > 0) u.taunt_remaining--;

      // DOT pulses
      for (const dot of u.dot_effects.slice()) {
        dot.timer++;
        if (dot.timer >= dot.interval) {
          dot.timer = 0;
          dot.remaining--;
          u.takeDamage(dot.damage);
          events.push({ type: 'dot', unit: u, damage: dot.damage });
        }
      }
      u.dot_effects = u.dot_effects.filter(d => d.remaining > 0);
    }

    // ── 2. Deaths from DOT ──
    this._checkDeaths(livingUnits, events);
    if (this._checkEnd(events)) return events;

    // ── 3. Movement (independent timer) ──
    for (const u of livingUnits) {
      if (!u.isAlive()) continue;
      u.move_timer++;
      if (u.move_timer < u.movement_speed) continue;
      u.move_timer = 0;

      const candidates = this._targetCandidates(u, { requireLOS: false });
      if (candidates.length === 0) continue;

      // Try candidates closest-first; if primary target is blocked, fall back to next reachable one
      const sorted = [...candidates].sort(
        (a, b) => chebyshevDistance(u.position, a.position) - chebyshevDistance(u.position, b.position)
      );
      let moved = false;
      for (const target of sorted) {
        if (canAttack(u, target, this.board)) { moved = true; break; } // in range and has line of sight
        const next = stepToward(this.board, u.position, target.position);
        if (next && !this.board.isOccupied(next)) {
          const from = { ...u.position };
          this.board.moveUnit(u, next);
          events.push({ type: 'move', unit: u, from, to: { ...u.position } });
          moved = true;
          break;
        }
        // path blocked for this target → try next closest
      }
      // Fallback: all normal paths failed — get as close as possible to the primary target
      if (!moved && sorted.length > 0) {
        const next = stepTowardOrNearest(this.board, u.position, sorted[0].position);
        if (next) {
          const from = { ...u.position };
          this.board.moveUnit(u, next);
          events.push({ type: 'move', unit: u, from, to: { ...u.position } });
        }
      }
    }

    // ── 4. Attacks / powers ──
    for (const u of livingUnits) {
      if (!u.isAlive()) continue;
      u.attack_timer++;
      if (u.attack_timer < u.effectiveAttackSpeed()) continue;
      u.attack_timer = 0;

      const candidates = this._targetCandidates(u, { requireLOS: true });
      if (candidates.length === 0) continue;
      const { unit: target } = findAttackTarget(u, candidates, this.board);
      if (!canAttack(u, target, this.board)) continue; // out of range or no line of sight

      if (u.isPowerReady()) {
        // _firePower returns false only for a power that failed to resolve this
        // tick (e.g. POWER_TELEPORT with no free cell) — in that case the gauge
        // stays full so the unit retries on a later tick instead of wasting it.
        const fired = this._firePower(u, target, events);
        if (fired !== false) u.power_gauge = 0;
      } else {
        this._normalAttack(u, target, events);
      }
      this._applyBurnStacks(u, events);
    }

    // ── 5. Deaths from attacks ──
    this._checkDeaths(allUnits, events);
    if (!this._checkEnd(events)) this._checkTimeout(events);

    // ── 6. During-combat attribute triggers (stat_modifier) ──
    // stat_modifier triggers are fired from CombatManager via AttributeManager callbacks
    // This is handled by events; the AttributeManager is called reactively on 'death' events.

    return events;
  }

  _enemies(unit) {
    return unit.side === 'player' ? this.enemyUnits : this.playerUnits;
  }

  _allies(unit) {
    return unit.side === 'player' ? this.playerUnits : this.enemyUnits;
  }

  // Resolves the pool of candidate targets for `unit`'s movement/attack this step,
  // taking taunt (POWER_TAUNT) and confusion (POWER_CONFUSION) into account.
  // Taunt always overrides confusion: a taunted unit must commit to the taunter.
  // requireLOS: true for attack target resolution (a taunter out of sight no longer
  // forces targeting — falls back to normal enemy targeting), false for movement
  // (the unit should keep walking toward the taunter to regain line of sight).
  _targetCandidates(unit, { requireLOS }) {
    const enemies = this._enemies(unit).filter(e => e.isAlive());
    let taunters = enemies.filter(e => e.taunt_remaining > 0);
    if (requireLOS) taunters = taunters.filter(e => hasLineOfSight(this.board, unit.position, e.position));
    if (taunters.length > 0) {
      return [taunters.reduce((a, b) =>
        manhattanDistance(unit.position, a.position) <= manhattanDistance(unit.position, b.position) ? a : b
      )];
    }

    if (unit.confusion_remaining > 0) {
      const allies = this._allies(unit).filter(a => a.isAlive() && a !== unit);
      if (allies.length > 0) return allies;
    }

    return enemies;
  }

  _normalAttack(attacker, target, events) {
    const damage = attacker.atk;
    target.takeDamage(damage);
    events.push({ type: 'attack', attacker, target, damage });
  }

  _firePower(unit, primaryTarget, events) {
    const pid = unit.power_id;
    const allies = this._allies(unit).filter(u => u.isAlive());
    const enemies = this._enemies(unit).filter(u => u.isAlive());

    switch (pid) {
      case 'POWER_HEAL': {
        // Heal the ally with the lowest current_hp (including self)
        const lowestAlly = allies.reduce((a, b) => a.current_hp < b.current_hp ? a : b, allies[0]);
        if (lowestAlly) {
          const amount = Math.floor(unit.max_hp * POWER_HEAL_RATIO);
          lowestAlly.heal(amount);
          events.push({ type: 'power', unit, targets: [lowestAlly], power_id: pid, extra: { amount } });
        }
        break;
      }

      case 'POWER_SHIELD': {
        const amount = unit.atk * POWER_SHIELD_MULT;
        unit.applyShield(amount);
        events.push({ type: 'power', unit, targets: [unit], power_id: pid, extra: { amount } });
        break;
      }

      case 'POWER_SUPER_ATTACK': {
        const damage = unit.atk * POWER_SUPER_ATTACK_MULT;
        primaryTarget.takeDamage(damage);
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { damage } });
        break;
      }

      case 'POWER_AOE_ATTACK': {
        const damage = unit.atk;
        for (const e of enemies) e.takeDamage(damage);
        events.push({ type: 'power', unit, targets: [...enemies], power_id: pid, extra: { damage } });
        break;
      }

      case 'POWER_POISON': {
        if (primaryTarget.is_effect_immune) {
          events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { immune: true } });
          break;
        }
        const dot = {
          damage: Math.max(1, Math.floor(unit.atk / DOT_DAMAGE_DIVISOR)),
          remaining: DOT_PULSES,
          interval: DOT_INTERVAL,
          timer: 0,
        };
        primaryTarget.dot_effects.push(dot);
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: dot });
        break;
      }

      case 'POWER_PARALYSIS': {
        if (primaryTarget.is_effect_immune) {
          events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { immune: true } });
          break;
        }
        primaryTarget.attack_speed_modifier += POWER_PARALYSIS_MODIFIER;
        primaryTarget.paralysis_remaining = POWER_PARALYSIS_TICKS;
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { ticks: POWER_PARALYSIS_TICKS } });
        break;
      }

      case 'POWER_PUSH': {
        if (primaryTarget.is_effect_immune) {
          events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { immune: true } });
          break;
        }
        const pushCells = unit.power_value ?? 2;
        const pushed = this._pushUnit(primaryTarget, unit.position, pushCells);
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { pushed } });
        break;
      }

      case 'POWER_DEBUFF': {
        primaryTarget.resetCombatStats();
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid });
        break;
      }

      case 'POWER_TELEPORT': {
        return this._teleportToWeakestEnemy(unit, enemies, events);
      }

      case 'POWER_BURN': {
        if (primaryTarget.is_effect_immune) {
          events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { immune: true } });
          break;
        }
        const burn = {
          damage: Math.max(1, Math.floor(unit.atk / BURN_DAMAGE_DIVISOR)),
          attacksRemaining: unit.power_value ?? BURN_ATTACKS,
        };
        primaryTarget.burn_stacks.push(burn);
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: burn });
        break;
      }

      case 'POWER_FREEZE': {
        if (primaryTarget.is_effect_immune) {
          events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { immune: true } });
          break;
        }
        // Push the target back by one cell (reuses the same retreat mechanic
        // as POWER_PUSH) and freeze the cell it just vacated — guaranteed
        // empty, unlike the cell it's standing on, whose own card visual
        // would otherwise hide the frozen-tile overlay completely.
        const cell = { ...primaryTarget.position };
        this._pushUnit(primaryTarget, unit.position, 1);
        // Frozen until the round ends, not a fixed tick count — cleared along
        // with the rest of the terrain's temporary blocks when the next combat
        // (or the following preparation phase) resets the board's blocked cells.
        const expiresAtStep = Infinity;
        // Only one ice block exists at a time — a new freeze replaces the
        // previous one instead of stacking blocked cells indefinitely.
        this.board.clearTemporaryBlocks();
        this.board.setTemporaryBlock(cell, expiresAtStep);
        // Emit both: 'power' drives the standard cast toast/flash (like every
        // other power), 'freeze' carries the cell data for the ice overlay.
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { cell, expiresAtStep } });
        events.push({ type: 'freeze', cell, expiresAtStep });
        break;
      }

      case 'POWER_BLOCK': {
        if (primaryTarget.is_effect_immune) {
          events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { immune: true } });
          break;
        }
        primaryTarget.is_power_blocked = true;
        primaryTarget.power_block_remaining = POWER_BLOCK_TICKS;
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid });
        break;
      }

      case 'POWER_CONFUSION': {
        if (primaryTarget.is_effect_immune) {
          events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { immune: true } });
          break;
        }
        primaryTarget.confusion_remaining = POWER_CONFUSION_TICKS;
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { ticks: POWER_CONFUSION_TICKS } });
        break;
      }

      case 'POWER_TAUNT': {
        const taunt_ticks = unit.power_value ?? POWER_TAUNT_TICKS;
        unit.taunt_remaining = taunt_ticks;
        events.push({ type: 'power', unit, targets: [unit], power_id: pid, extra: { ticks: taunt_ticks } });
        break;
      }

      default:
        // Unknown power — fall back to normal attack
        this._normalAttack(unit, primaryTarget, events);
    }
  }

  // Teleport `unit` next to the enemy with the least current_hp (mirrors the
  // lowest-HP reduce used by POWER_HEAL, applied to enemies instead of allies).
  // Moves the unit directly via board.moveUnit — no pathfinding, no movement
  // cooldown. Returns false (power not consumed) if no cell is available at all.
  _teleportToWeakestEnemy(unit, enemies, events) {
    if (enemies.length === 0) return false;
    const target = enemies.reduce((a, b) => a.current_hp < b.current_hp ? a : b, enemies[0]);

    // Excludes unit.position explicitly (on top of the occupied check, which
    // already covers it) so the teleport is guaranteed to land on a different
    // cell — never a no-op "teleport to where it already stands".
    const isFree = p => this.board.isInBounds(p) && !this.board.isOccupied(p) && !this.board.isBlocked(p)
      && (p.col !== unit.position.col || p.row !== unit.position.row);

    const adjacent = [
      { col: target.position.col, row: target.position.row - 1 },
      { col: target.position.col, row: target.position.row + 1 },
      { col: target.position.col - 1, row: target.position.row },
      { col: target.position.col + 1, row: target.position.row },
    ].filter(isFree);

    let destination = adjacent[0] ?? null;

    if (!destination) {
      // No free adjacent cell — fall back to the closest free cell on the board.
      let bestDist = Infinity;
      for (let col = 0; col < this.board.cols; col++) {
        for (let row = 0; row < this.board.rows; row++) {
          const p = { col, row };
          if (!isFree(p)) continue;
          const d = Math.abs(p.col - target.position.col) + Math.abs(p.row - target.position.row);
          if (d < bestDist) { bestDist = d; destination = p; }
        }
      }
    }

    if (!destination) return false; // no other cell available — retry next tick

    const from = { ...unit.position };
    this.board.moveUnit(unit, destination);
    // 'power' drives the standard cast toast/flash (like every other power);
    // 'move' is consumed separately by the animator to play the relocation.
    events.push({ type: 'power', unit, targets: [target], power_id: 'POWER_TELEPORT', extra: { from, to: { ...unit.position } } });
    events.push({ type: 'move', unit, from, to: { ...unit.position } });
    return true;
  }

  // Unlike POWER_POISON (a DOT ticking on a fixed timer), POWER_BURN is a curse
  // attached to the attacker itself: it pulses on the unit's own next attacks
  // (decremented here, right after it acts) instead of on a global tick interval.
  _applyBurnStacks(unit, events) {
    if (unit.burn_stacks.length === 0) return;
    for (const stack of unit.burn_stacks) {
      unit.takeDamage(stack.damage);
      events.push({ type: 'dot', unit, damage: stack.damage });
      stack.attacksRemaining--;
    }
    unit.burn_stacks = unit.burn_stacks.filter(s => s.attacksRemaining > 0);
  }

  // Push target away from attacker's position by `cells` steps in a straight line
  _pushUnit(target, attackerPos, cells) {
    const dirCol = Math.sign(target.position.col - attackerPos.col);
    const dirRow = Math.sign(target.position.row - attackerPos.row);
    let pushed = 0;
    for (let i = 0; i < cells; i++) {
      const next = { col: target.position.col + dirCol, row: target.position.row + dirRow };
      if (!this.board.isInBounds(next) || this.board.isOccupied(next) || this.board.isBlocked(next)) break;
      this.board.moveUnit(target, next);
      pushed++;
    }
    return pushed;
  }

  _checkDeaths(units, events) {
    for (const u of units) {
      if (u.is_neutralized && !u._deathEmitted) {
        u._deathEmitted = true;
        this.board.removeUnit(u);
        events.push({ type: 'death', unit: u });

        // Trigger during-combat attribute stat_modifiers
        if (this.attributeManager) {
          const evts = this.attributeManager.onUnitNeutralized(u, this.playerUnits, this.enemyUnits);
          events.push(...evts);
        }
      }
    }
  }

  _checkEnd(events) {
    const pAlive = this.playerUnits.some(u => u.isAlive());
    const eAlive = this.enemyUnits.some(u => u.isAlive());

    if (pAlive && eAlive) return false;

    this.isOver = true;
    if (pAlive)       this.winner = 'player';
    else if (eAlive)  this.winner = 'enemy';
    else              this.winner = 'draw';

    events.push({ type: 'combat_end', winner: this.winner });
    return true;
  }

  // Cuts the combat short once it has run for MAX_COMBAT_TICKS without either
  // side being fully neutralized (both sides still have a living unit, since
  // _checkEnd already returned false). Both players are treated as having
  // lost the round — see GameState.applyEndOfCombat('timeout', ...).
  _checkTimeout(events) {
    if (this._stepCount < MAX_COMBAT_TICKS) return false;

    this.isOver = true;
    this.winner = 'timeout';
    events.push({ type: 'combat_end', winner: this.winner });
    return true;
  }
}
