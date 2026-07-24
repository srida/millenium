export const Phase = Object.freeze({
  PREPARATION: 'preparation',
  COMBAT:      'combat',
  END_ROUND:   'end_round',
  GAME_OVER:   'game_over',
});

const MAX_ROUNDS = 5;
const STARTING_HP = 1000;
const DEFAULT_BOARD_SLOTS = 5;

export class GameState {
  constructor() {
    this.round = 1;
    this.phase = Phase.PREPARATION;

    this.player_hp = STARTING_HP;
    this.enemy_hp  = STARTING_HP;

    this.player_multiplier = 1.0;
    this.enemy_multiplier  = 1.0;
    // Unit-count component only (without the round multiplier), kept for UI breakdown
    this.player_unit_multiplier = 1.0;
    this.enemy_unit_multiplier  = 1.0;

    // Expanded by board_slot_bonus attribute effect
    this.player_board_slots = DEFAULT_BOARD_SLOTS;
    this.enemy_board_slots  = DEFAULT_BOARD_SLOTS;
    // Yeux bleus / Réaction en chaîne / Fission share a single +1 slot cap (non cumulable)
    this._limitedBoardSlotBonusUsed = 0;

    // Carry-over from previous rounds
    this.player_extra_draws = 0;   // accumulated draw_bonus
    this.player_guaranteed_draws = []; // [{ category, attribute }]
    this.player_hand_modifiers = []; // [{ type, value? }] applied to drawn cards
    this.player_extra_shopping_magies = 0; // accumulated shopping_bonus
  }

  // ── Phase transitions ──

  startCombat(playerUnitCount, enemyUnitCount) {
    this.phase = Phase.COMBAT;
    this.player_unit_multiplier = this._multiplier(playerUnitCount);
    this.enemy_unit_multiplier  = this._multiplier(enemyUnitCount);
    this.player_multiplier = this.player_unit_multiplier * this.round;
    this.enemy_multiplier  = this.enemy_unit_multiplier * this.round;
  }

  _multiplier(unitCount) {
    if (unitCount >= 5) return 1.0;
    if (unitCount === 4) return 1.2;
    if (unitCount === 3) return 1.5;
    if (unitCount === 2) return 2.0;
    return 3.0; // 0 or 1 unit on the board
  }

  /**
   * Apply the result of a finished combat round.
   * @param {'player'|'enemy'|'draw'|'timeout'} winner
   * @param {number} playerSurvivorsAtk  - sum of ATK of surviving player units
   * @param {number} enemySurvivorsAtk   - sum of ATK of surviving enemy units
   * @param {Object} attributeResult     - from AttributeManager.applyEndOfCombat()
   */
  applyEndOfCombat(winner, playerSurvivorsAtk, enemySurvivorsAtk, attributeResult = {}) {
    this.phase = Phase.END_ROUND;

    if (winner === 'player' || winner === 'timeout' || winner === 'draw') {
      const mult = this.player_multiplier + (attributeResult.damage_multiplier_bonus || 0);
      this.enemy_hp -= Math.round(playerSurvivorsAtk * mult);
    }
    if (winner === 'enemy' || winner === 'timeout' || winner === 'draw') {
      this.player_hp -= Math.round(enemySurvivorsAtk * this.enemy_multiplier);
    }

    // Clamp HP
    this.player_hp = Math.max(0, this.player_hp);
    this.enemy_hp  = Math.max(0, this.enemy_hp);

    // Accumulate end-of-combat attribute bonuses
    if (attributeResult.board_slot_bonus) {
      this.grantLimitedBoardSlotBonus(attributeResult.board_slot_bonus);
    }
    if (attributeResult.draw_bonus) {
      this.player_extra_draws += attributeResult.draw_bonus;
    }
    if (attributeResult.guaranteed_draws?.length) {
      this.player_guaranteed_draws.push(...attributeResult.guaranteed_draws);
    }
    if (attributeResult.shopping_bonus) {
      this.player_extra_shopping_magies += attributeResult.shopping_bonus;
    }
  }

  /**
   * Grants board slot bonus from the shared, non-stackable +1 pool
   * (Yeux bleus attribute, magies Réaction en chaîne / Fission).
   * Returns the amount actually granted (0 once the cap is reached).
   */
  grantLimitedBoardSlotBonus(value, cap = 1) {
    const grant = Math.max(0, Math.min(value, cap - this._limitedBoardSlotBonusUsed));
    this.player_board_slots += grant;
    this._limitedBoardSlotBonusUsed += grant;
    return grant;
  }

  /**
   * Advance to the next round or trigger game over.
   * Returns the new phase.
   */
  nextRound() {
    if (this.player_hp <= 0 || this.enemy_hp <= 0 || this.round >= MAX_ROUNDS) {
      this.phase = Phase.GAME_OVER;
    } else {
      this.round++;
      this.phase = Phase.PREPARATION;
      // Reset per-round multipliers
      this.player_multiplier = 1.0;
      this.enemy_multiplier  = 1.0;
      this.player_unit_multiplier = 1.0;
      this.enemy_unit_multiplier  = 1.0;
    }
    return this.phase;
  }

  isGameOver() {
    return this.phase === Phase.GAME_OVER || this.player_hp <= 0 || this.enemy_hp <= 0 || this.round >= MAX_ROUNDS;
  }

  getWinner() {
    if (this.player_hp > this.enemy_hp) return 'player';
    if (this.enemy_hp > this.player_hp) return 'enemy';
    return 'draw';
  }

  toSnapshot() {
    return {
      round: this.round,
      phase: this.phase,
      player_hp: this.player_hp,
      enemy_hp: this.enemy_hp,
      player_multiplier: this.player_multiplier,
      enemy_multiplier: this.enemy_multiplier,
      player_board_slots: this.player_board_slots,
    };
  }
}
