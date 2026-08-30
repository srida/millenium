import { chebyshevDistance, manhattanDistance, findClosestEnemy, findAttackTarget, isInAttackRange, canAttack, hasLineOfSight, stepToward, stepTowardOrNearest } from './PathFinder.js';

// Power constants — every one of them is a FALLBACK: the card's own
// `power.value` (admin field "Valeur") overrides it when set, see powerValue().
const POWER_SUPER_ATTACK_MULT = 3;
const POWER_HEAL_RATIO = 0.4;        // % of healer max_hp
const POWER_SHIELD_MULT = 2;         // × atk
const POWER_PARALYSIS_TICKS = 20;    // duration in steps
const POWER_BLOCK_TICKS = 25;
const POWER_CONFUSION_TICKS = 20;
const POWER_TAUNT_TICKS = 20;
const DOT_DAMAGE_DIVISOR = 2;
const DOT_INTERVAL = 3;              // global steps between DOT pulses
const BURN_DAMAGE_DIVISOR = 2;

// Powers that do NOT need an enemy within reach to go off, because they never
// touch the attack target: the heal reads the caster's own side, the taunt and
// the teleport read the caster itself. Gating them on range made a backline
// healer with range 1 unable to ever heal, a tank unable to taunt before
// contact, and — worst of all — a teleporter unable to use the very power whose
// job is to CLOSE the gap: it had to already be in range to jump into range.
// ⚠️ A power added here must not read `primaryTarget`, which is then null.
const RANGELESS_POWERS = new Set(['POWER_HEAL', 'POWER_TAUNT', 'POWER_TELEPORT']);

// A card's `power.value` overrides the constant it maps to; absent, it falls
// back to the formula below. `||` and not `??` on purpose: a Valeur left at 0
// in the admin panel reads as "not set", never as "this power does nothing" —
// a silent no-op power is the one authoring mistake that costs a card its
// whole identity without saying so anywhere.
const powerValue = (unit, fallback) => unit.power_value || fallback;

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

    // ⚠️ Les deux camps dans l'ordre du repère de RÉFÉRENCE, jamais « les
    // miennes d'abord ». Ce tableau sert de tableau de balayage des morts
    // (`_checkDeaths`, phase 5), et l'ordre y est de la logique de jeu : chaque
    // mort déclenche les `stat_modifier` d'attribut, qui ne comptent que les
    // unités ENCORE VIVANTES. Deux unités qui tombent au même tick, une de
    // chaque camp, ne donnent donc pas les mêmes bonus selon l'ordre — et
    // `[...playerUnits, ...enemyUnits]` met « mes » unités en tête sur CHAQUE
    // client, donc dans l'ordre inverse d'un client à l'autre.
    const allUnits = this._frameOrderedUnits();
    const livingUnits = allUnits.filter(u => u.isAlive());

    // Sort by initiative desc, tie-break by attack_speed desc, then card_id asc
    // card_id is absolute (same value on both PvP clients) — prevents ordering divergence on equal stats
    //
    // Le DERNIER départage est le camp, exprimé dans le repère de référence :
    // l'égalité parfaite — même initiative, même vitesse ET même `card_id` —
    // arrive dès que les deux joueurs jouent la même carte, et il ne restait
    // alors que l'ordre du tableau d'entrée pour trancher.
    //
    // ⚠️ Il est REDONDANT avec `_frameOrderedUnits` tant que `sort` est stable
    // (garanti depuis ES2019) : c'est ce dernier qui porte réellement la
    // correction, et retirer ce départage-ci seul ne fait rien tomber. Il est
    // gardé parce qu'il rend le tri AUTOSUFFISANT — l'invariant est écrit dans
    // le comparateur, au lieu de dépendre de l'ordre dans lequel on lui a passé
    // les unités. Le jour où ce tableau d'entrée change, le tri tient encore.
    livingUnits.sort((a, b) =>
      b.initiative - a.initiative ||
      b.effectiveAttackSpeed() - a.effectiveAttackSpeed() ||
      a.card_id.localeCompare(b.card_id) ||
      this._frameSide(a) - this._frameSide(b));

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

      // DOT pulses — no expiry, they last the whole round (see POWER_POISON).
      for (const dot of u.dot_effects) {
        dot.timer++;
        if (dot.timer >= dot.interval) {
          dot.timer = 0;
          u.takeDamage(dot.damage);
          events.push({ type: 'dot', unit: u, damage: dot.damage });
        }
      }
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
      const target = candidates.length > 0 ? findAttackTarget(u, candidates, this.board).unit : null;
      // Out of range or without line of sight there is nothing to hit — but the
      // rangeless powers never needed that target in the first place, so they
      // are offered a null one rather than being skipped with the attack.
      const reachable = target !== null && canAttack(u, target, this.board);
      const powerTarget = reachable ? target : null;
      const canFire = u.isPowerReady()
        && (reachable || RANGELESS_POWERS.has(u.power_id))
        && this._isPowerRelevant(u, powerTarget);

      // A full gauge is not enough: the power must have something to do to THIS
      // target (see _isPowerRelevant). When it hasn't, the unit attacks normally
      // and KEEPS its gauge full — same treatment as a power that fails to
      // resolve below, and for the same reason: the charge is held, not burnt.
      if (canFire) {
        // _firePower returns false only for a power that failed to resolve this
        // tick (e.g. POWER_TELEPORT with no free cell) — in that case the gauge
        // stays full so the unit retries on a later tick instead of wasting it.
        const fired = this._firePower(u, powerTarget, events);
        if (fired !== false) u.power_gauge = 0;
      } else if (reachable) {
        this._normalAttack(u, target, events);
      } else {
        continue; // nothing in reach, nothing to cast — the unit just closes in
      }
      // The burn pulses on the CURSED UNIT'S OWN action, and a power replaces
      // the attack of the step: a rangeless cast burns exactly like a swing.
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
  /**
   * Le camp d'une unité dans le repère de RÉFÉRENCE : 0 pour celui du rôle A,
   * 1 pour celui du rôle B — la même valeur pour la même unité physique sur les
   * deux clients, là où `side` ('player' / 'enemy') est purement local.
   *
   * Hors duel en ligne, le plateau n'est jamais miroité : le joueur est donc
   * toujours 0, exactement l'ordre que la concaténation donnait déjà.
   */
  /**
   * Les unités des deux camps, celui du rôle A d'abord — le même ordre sur les
   * deux clients. Hors duel en ligne le plateau n'est jamais miroité : c'est
   * exactement la concaténation historique.
   */
  _frameOrderedUnits() {
    return this.board?.mirroredFrame
      ? [...this.enemyUnits, ...this.playerUnits]
      : [...this.playerUnits, ...this.enemyUnits];
  }

  _frameSide(unit) {
    const isLocalPlayer = unit.side === 'player';
    return (this.board?.mirroredFrame ? !isLocalPlayer : isLocalPlayer) ? 0 : 1;
  }

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

  // Would firing `unit`'s power at `target` right now change anything?
  //
  // A power used to leave on the sole condition that its gauge was full, so a
  // blocker spent its charge on a target with no power at all, a dispeller on a
  // target carrying nothing, a pusher on a target with a wall behind it — all of
  // them silent no-ops the player could only diagnose by reading the code. The
  // rule below is narrow on purpose: it answers "would this do NOTHING?", never
  // "is there a better target?" — target selection stays findAttackTarget's job
  // (range and line of sight), and the power is simply held until that target is
  // worth it. Every predicate is a pure function of combat state, so it stays
  // deterministic on both PvP clients.
  //
  // Two families are deliberately NOT covered:
  //   - effect immunity (is_effect_immune) — it already has a designed outcome,
  //     the deflection VFX, and it is a COUNTER the player earns via an
  //     attribute: letting casters hold their charge instead would defuse it.
  //   - powers that always land something (super attack, AOE, shield, poison,
  //     burn) — poison and burn stack, shields add up, damage is damage.
  _isPowerRelevant(unit, target) {
    // `target` is null when nothing is in reach — only RANGELESS_POWERS get
    // asked in that state, and none of their branches below read it. Any other
    // power without a target has, by definition, nothing to act on.
    if (target === null && !RANGELESS_POWERS.has(unit.power_id)) return false;

    switch (unit.power_id) {
      // Heals the lowest-HP ally (self included) — worthless at full health.
      case 'POWER_HEAL':
        return this._allies(unit).some(a => a.isAlive() && a.current_hp < a.max_hp);

      // Blocks the target's power: nothing to block on a unit that has none.
      // Re-blocking is skipped too — power_block_remaining is ASSIGNED, so
      // firing again on a longer-running block would actually SHORTEN it.
      case 'POWER_BLOCK':
        return !!target.power_id && !target.is_power_blocked;

      // Strips what resetCombatStats() would clear. The target's power gauge is
      // reset too, but that is a side effect of the wipe, not what the power is
      // for: counting it would make the dispel relevant against every powered
      // enemy — i.e. undo the check on the one power that most needed it.
      case 'POWER_DEBUFF':
        return this._hasStrippableState(target);

      // paralysis_remaining is ASSIGNED, so re-applying can shorten a running
      // paralysis. Held until it lapses, then re-applied — same for confusion.
      case 'POWER_PARALYSIS':
        return target.paralysis_remaining === 0;

      // Turns the target against its own side: needs a side to turn against.
      case 'POWER_CONFUSION':
        return target.confusion_remaining === 0
          && this._allies(target).some(a => a.isAlive() && a !== target);

      // Self-buff, assigned the same way: no point refreshing a running taunt.
      case 'POWER_TAUNT':
        return unit.taunt_remaining === 0;

      // Both retreat the target by at least one cell. A target with a wall, an
      // ally or the board edge right behind it does not move — and the freeze
      // would then block the cell the target is still standing on.
      case 'POWER_PUSH':
      case 'POWER_FREEZE':
        return this._canPush(target, unit.position);

      // The jump has to actually close the gap on the weakest enemy. Already
      // next to it, or the only free cell left is no nearer than where the unit
      // already stands (the closest-free-cell fallback can even walk it back) →
      // the teleport just breaks the formation for nothing. A null plan (no
      // enemy, no free cell) lands here too: the unit attacks rather than
      // spending its tick on a power that cannot resolve.
      case 'POWER_TELEPORT': {
        const plan = this._teleportPlan(unit, this._enemies(unit).filter(u => u.isAlive()));
        if (!plan) return false;
        return manhattanDistance(plan.destination, plan.target.position)
             < manhattanDistance(unit.position, plan.target.position);
      }

      default:
        return true;
    }
  }

  // Everything resetCombatStats() takes away, minus the power gauge (see above).
  _hasStrippableState(u) {
    return Object.values(u._stat_bonuses).some(v => v !== 0)
      || u.dot_effects.length > 0
      || u.burn_stacks.length > 0
      || u.paralysis_remaining > 0
      || u.attack_speed_modifier !== 0
      || u.is_power_blocked
      || u.confusion_remaining > 0
      || u.taunt_remaining > 0
      || u.is_effect_immune;
  }

  // First step of the retreat _pushUnit would walk — the whole push is a no-op
  // when it is unavailable, both cells sharing the same direction vector.
  _canPush(target, attackerPos) {
    const dirCol = Math.sign(target.position.col - attackerPos.col);
    const dirRow = Math.sign(target.position.row - attackerPos.row);
    if (dirCol === 0 && dirRow === 0) return false;
    const next = { col: target.position.col + dirCol, row: target.position.row + dirRow };
    return this.board.isInBounds(next) && !this.board.isOccupied(next) && !this.board.isBlocked(next);
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
          // `value` = flat HP restored; without it, 40% of the healer's max_hp.
          const amount = powerValue(unit, Math.floor(unit.max_hp * POWER_HEAL_RATIO));
          lowestAlly.heal(amount);
          events.push({ type: 'power', unit, targets: [lowestAlly], power_id: pid, extra: { amount } });
        }
        break;
      }

      case 'POWER_SHIELD': {
        const amount = powerValue(unit, unit.atk * POWER_SHIELD_MULT);
        unit.applyShield(amount);
        events.push({ type: 'power', unit, targets: [unit], power_id: pid, extra: { amount } });
        break;
      }

      case 'POWER_SUPER_ATTACK': {
        const damage = powerValue(unit, unit.atk * POWER_SUPER_ATTACK_MULT);
        primaryTarget.takeDamage(damage);
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { damage } });
        break;
      }

      case 'POWER_AOE_ATTACK': {
        const damage = powerValue(unit, unit.atk);
        for (const e of enemies) e.takeDamage(damage);
        events.push({ type: 'power', unit, targets: [...enemies], power_id: pid, extra: { damage } });
        break;
      }

      case 'POWER_POISON': {
        if (primaryTarget.is_effect_immune) {
          events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { immune: true } });
          break;
        }
        // No pulse counter: the poison runs until the end of the round. It is
        // cleared with the rest of the statuses by resetCombatStats() (end of
        // combat, POWER_DEBUFF, revive magic) — those purges are the only exit.
        const dot = {
          damage: powerValue(unit, Math.max(1, Math.floor(unit.atk / DOT_DAMAGE_DIVISOR))),
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
        // The severity is fixed: attack_speed DOUBLED (higher = slower), so the
        // effect costs the target half its attacks whatever its rhythm — a flat
        // +6 was crippling on a fast unit and unnoticeable on a slow one.
        // `value` is therefore the DURATION in steps. Stored as a plain delta so
        // effectiveAttackSpeed() stays additive; a second hit REFRESHES it
        // instead of stacking — doubled is a ceiling, not a step.
        const paralysisTicks = powerValue(unit, POWER_PARALYSIS_TICKS);
        primaryTarget.attack_speed_modifier = primaryTarget.attack_speed;
        primaryTarget.paralysis_remaining = paralysisTicks;
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { ticks: paralysisTicks } });
        break;
      }

      case 'POWER_PUSH': {
        if (primaryTarget.is_effect_immune) {
          events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { immune: true } });
          break;
        }
        const pushCells = powerValue(unit, 2);
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
        // No attack counter: like the poison, the curse runs until the end of
        // the round and is cleared only by the status purges.
        const burn = {
          damage: powerValue(unit, Math.max(1, Math.floor(unit.atk / BURN_DAMAGE_DIVISOR))),
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
        const block_ticks = powerValue(unit, POWER_BLOCK_TICKS);
        primaryTarget.is_power_blocked = true;
        primaryTarget.power_block_remaining = block_ticks;
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { ticks: block_ticks } });
        break;
      }

      case 'POWER_CONFUSION': {
        if (primaryTarget.is_effect_immune) {
          events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { immune: true } });
          break;
        }
        const confusion_ticks = powerValue(unit, POWER_CONFUSION_TICKS);
        primaryTarget.confusion_remaining = confusion_ticks;
        events.push({ type: 'power', unit, targets: [primaryTarget], power_id: pid, extra: { ticks: confusion_ticks } });
        break;
      }

      case 'POWER_TAUNT': {
        const taunt_ticks = powerValue(unit, POWER_TAUNT_TICKS);
        unit.taunt_remaining = taunt_ticks;
        events.push({ type: 'power', unit, targets: [unit], power_id: pid, extra: { ticks: taunt_ticks } });
        break;
      }

      default:
        // Unknown power — fall back to normal attack
        this._normalAttack(unit, primaryTarget, events);
    }
  }

  // Where POWER_TELEPORT would take `unit`: next to the enemy with the least
  // current_hp (mirrors the lowest-HP reduce used by POWER_HEAL, applied to
  // enemies instead of allies). Pure — it reads the board and returns a plan,
  // so _isPowerRelevant can ask the same question the power itself will ask.
  // Returns null when there is no enemy or no cell to land on.
  _teleportPlan(unit, enemies) {
    if (enemies.length === 0) return null;
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

    return destination ? { target, destination } : null;
  }

  // Moves the unit directly via board.moveUnit — no pathfinding, no movement
  // cooldown. Returns false (power not consumed) if no cell is available at all.
  _teleportToWeakestEnemy(unit, enemies, events) {
    const plan = this._teleportPlan(unit, enemies);
    if (!plan) return false; // no other cell available — retry next tick
    const { target, destination } = plan;

    const from = { ...unit.position };
    this.board.moveUnit(unit, destination);
    // 'power' drives the standard cast toast/flash (like every other power);
    // 'move' is consumed separately by the animator to play the relocation.
    events.push({ type: 'power', unit, targets: [target], power_id: 'POWER_TELEPORT', extra: { from, to: { ...unit.position } } });
    events.push({ type: 'move', unit, from, to: { ...unit.position } });
    return true;
  }

  // Like POWER_POISON, the curse lasts the whole round — what separates the two
  // is their CLOCK, not their duration: the poison pulses on a fixed global
  // interval, the burn pulses on the cursed unit's own attacks. A unit that
  // stops attacking (paralysed, out of range, blocked) stops burning.
  _applyBurnStacks(unit, events) {
    if (unit.burn_stacks.length === 0) return;
    for (const stack of unit.burn_stacks) {
      unit.takeDamage(stack.damage);
      events.push({ type: 'dot', unit, damage: stack.damage });
    }
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
