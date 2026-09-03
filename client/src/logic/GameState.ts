import type { DrawSourceEntry, EndOfCombatAttributeResult, GuaranteedDraw, HandModifier, RoundWinner } from './types.js';

export const Phase = Object.freeze({
  PREPARATION: 'preparation',
  COMBAT:      'combat',
  END_ROUND:   'end_round',
  GAME_OVER:   'game_over',
} as const);

export type PhaseValue = typeof Phase[keyof typeof Phase];

const MAX_ROUNDS = 5;
const STARTING_HP = 1000;
const DEFAULT_BOARD_SLOTS = 5;

/** Plafond de `player_hp` : c'est le pool de départ lui-même — `player_hp_bonus`
 *  et `drain_life` ne font que le regarnir, jamais le dépasser. Exporté parce
 *  que la pertinence d'une magie `player_hp_bonus` en dépend
 *  (`MagieOffer.isMagieRelevant`). ⚠️ `MagieEffect.js` en garde une copie
 *  littérale (`Math.min(…, 1000)`) : les deux doivent rester d'accord. */
export const PLAYER_HP_CAP = STARTING_HP;

/** Cap PARTAGÉ du bonus de slot de board : attribut Yeux Bleus ∪ magies
 *  `board_slot_bonus`, +1 pour toute la partie. */
export const LIMITED_BOARD_SLOT_CAP = 1;

export class GameState {
  round: number;
  phase: PhaseValue;

  player_hp: number;
  enemy_hp: number;

  player_multiplier: number;
  enemy_multiplier: number;
  // Unit-count component only (without the round multiplier), kept for UI breakdown
  player_unit_multiplier: number;
  enemy_unit_multiplier: number;

  // Expanded by board_slot_bonus attribute effect
  player_board_slots: number;
  enemy_board_slots: number;
  // Yeux bleus / Réaction en chaîne / Fission share a single +1 slot cap (non cumulable)
  _limitedBoardSlotBonusUsed: number;

  // Carry-over from previous rounds
  player_extra_draws: number;              // accumulated draw_bonus
  player_guaranteed_draws: GuaranteedDraw[];
  /**
   * Le MÊME octroi que les deux champs ci-dessus, raconté : qui a crédité quoi.
   * Purement descriptif — la popup de pioche le lit, aucun calcul ne s'en sert.
   *
   * ⚠️ INVARIANT : `sum(value) === player_extra_draws` et une entrée
   * `guaranteed` par élément de `player_guaranteed_draws`. Écrit et vidé aux
   * MÊMES instants que les deux (les trois se consomment ensemble dans
   * `GameSession.startPreparation`) — un quatrième émetteur qui oublierait son
   * inscription ferait mentir la popup, ce que `draw-summary.test.ts` refuse.
   */
  player_draw_sources: DrawSourceEntry[];
  player_hand_modifiers: HandModifier[];   // applied to drawn cards
  player_extra_shopping_magies: number;    // accumulated shopping_bonus
  /** Bonus PERMANENT de multiplicateur de dégâts, cumulé par les magies
   *  `damage_multiplier_bonus`. ⚠️ Volontairement HORS de `nextRound()`, qui
   *  remet `player_multiplier` à 1.0 à chaque tour : c'est un investissement,
   *  il vaut pour tous les combats restants. À distinguer du bonus d'ATTRIBUT
   *  du même nom, qui ne vaut que pour le round où il se déclenche et arrive
   *  par `attributeResult`. */
  player_damage_multiplier_bonus: number;

  constructor() {
    this.round = 1;
    this.phase = Phase.PREPARATION;

    this.player_hp = STARTING_HP;
    this.enemy_hp  = STARTING_HP;

    this.player_multiplier = 1.0;
    this.enemy_multiplier  = 1.0;
    this.player_unit_multiplier = 1.0;
    this.enemy_unit_multiplier  = 1.0;

    this.player_board_slots = DEFAULT_BOARD_SLOTS;
    this.enemy_board_slots  = DEFAULT_BOARD_SLOTS;
    this._limitedBoardSlotBonusUsed = 0;

    this.player_extra_draws = 0;
    this.player_guaranteed_draws = [];
    this.player_draw_sources = [];
    this.player_hand_modifiers = [];
    this.player_extra_shopping_magies = 0;
    this.player_damage_multiplier_bonus = 0;
  }

  // ── Phase transitions ──

  startCombat(playerUnitCount: number, enemyUnitCount: number): void {
    this.phase = Phase.COMBAT;
    this.player_unit_multiplier = this._multiplier(playerUnitCount);
    this.enemy_unit_multiplier  = this._multiplier(enemyUnitCount);
    this.player_multiplier = this.player_unit_multiplier * this.round;
    this.enemy_multiplier  = this.enemy_unit_multiplier * this.round;
  }

  _multiplier(unitCount: number): number {
    if (unitCount >= 5) return 1.0;
    if (unitCount === 4) return 1.2;
    if (unitCount === 3) return 1.5;
    if (unitCount === 2) return 2.0;
    return 3.0; // 0 or 1 unit on the board
  }

  /**
   * Apply the result of a finished combat round.
   * @param winner 'player' | 'enemy' | 'draw' | 'timeout'
   * @param playerSurvivorsAtk  sum of ATK of surviving player units
   * @param enemySurvivorsAtk   sum of ATK of surviving enemy units
   * @param attributeResult     from AttributeManager.applyEndOfCombat()
   */
  applyEndOfCombat(
    winner: RoundWinner,
    playerSurvivorsAtk: number,
    enemySurvivorsAtk: number,
    attributeResult: EndOfCombatAttributeResult = {},
  ): void {
    this.phase = Phase.END_ROUND;

    if (winner === 'player' || winner === 'timeout' || winner === 'draw') {
      const mult = this.player_multiplier
        + (attributeResult.damage_multiplier_bonus || 0)
        + this.player_damage_multiplier_bonus;
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
    // La provenance suit le crédit, dans le même `if`-bloc de fait : le manager
    // n'inscrit une ligne que pour ce qu'il a réellement porté aux deux champs
    // ci-dessus (plafond `max` déjà appliqué).
    if (attributeResult.draw_sources?.length) {
      this.player_draw_sources.push(...attributeResult.draw_sources);
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
  grantLimitedBoardSlotBonus(value: number, cap = LIMITED_BOARD_SLOT_CAP): number {
    const grant = Math.max(0, Math.min(value, cap - this._limitedBoardSlotBonusUsed));
    this.player_board_slots += grant;
    this._limitedBoardSlotBonusUsed += grant;
    return grant;
  }

  /**
   * Le cap partagé est-il encore libre ? Lu par la pertinence de l'offre de
   * Shopping : une magie `board_slot_bonus` proposée une fois le cap consommé
   * s'appliquerait sans erreur et ne donnerait RIEN
   * (`grantLimitedBoardSlotBonus` rend 0 en silence).
   */
  hasLimitedBoardSlotBonusLeft(cap = LIMITED_BOARD_SLOT_CAP): boolean {
    return this._limitedBoardSlotBonusUsed < cap;
  }

  /**
   * Advance to the next round or trigger game over.
   * Returns the new phase.
   */
  nextRound(): PhaseValue {
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

  isGameOver(): boolean {
    return this.phase === Phase.GAME_OVER || this.player_hp <= 0 || this.enemy_hp <= 0 || this.round >= MAX_ROUNDS;
  }

  getWinner(): 'player' | 'enemy' | 'draw' {
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
