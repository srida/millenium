import type { BonusSourceEntry, DrawSourceEntry, EndOfCombatAttributeResult, GuaranteedDraw, GuaranteedMagie, RoundWinner } from './types.js';

export const Phase = Object.freeze({
  PREPARATION: 'preparation',
  COMBAT:      'combat',
  END_ROUND:   'end_round',
  GAME_OVER:   'game_over',
} as const);

export type PhaseValue = typeof Phase[keyof typeof Phase];

const MAX_ROUNDS = 5;

/**
 * Le facteur de tour du multiplicateur de dégâts : ×1, ×1,5, ×2, ×2,5, ×3.
 * Il valait le numéro du tour (×1…×5), si bien que le dernier tour pesait un
 * tiers de la partie — et c'est celui où une carte précise sort le moins.
 */
export function roundFactor(round: number): number {
  return 1 + 0.5 * (Math.max(1, round) - 1);
}
const STARTING_HP = 1000;

/** Plafond de `player_hp` : c'est le pool de départ lui-même — `player_hp_bonus`
 *  et `drain_life` ne font que le regarnir, jamais le dépasser. Exporté parce
 *  que la pertinence d'une magie `player_hp_bonus` en dépend
 *  (`MagieOffer.isMagieRelevant`). ⚠️ `MagieEffect.js` en garde une copie
 *  littérale (`Math.min(…, 1000)`) : les deux doivent rester d'accord. */
export const PLAYER_HP_CAP = STARTING_HP;

/**
 * Les gestes payés en ÉNERGIE DE RÉSERVE, et le seul endroit qui les
 * chiffre (`GameSession` les prélève, l'écran les annonce).
 *
 * La réserve, c'est l'énergie que le joueur n'a pas posée : au lancement du
 * combat, ce qui reste du budget du tour y est versé (`GameSession.startCombat`).
 * Elle remplace les PV comme monnaie de ces gestes — c'est ce qui donne un prix
 * à « je pose tout » contre « je garde pour plus tard ».
 */
export const MULLIGAN_COST_ENERGY = 2;
export const SHOPPING_REROLL_COST_ENERGY = 1;

/**
 * Les prix de la BOUTIQUE de la Phase Shopping, en ⚡ de réserve. Une magie se
 * paie selon sa rareté (Commune 1, Rare 2, Légendaire 3) ; une carte selon son
 * emplacement : un Tier 1 du deck 1, une carte du sac de pioche du tour 2, une
 * carte liée à ce que le joueur a en jeu 3.
 */
export const MAGIE_ENERGY_PRICE: Readonly<Record<1 | 2 | 3, number>> = Object.freeze({ 1: 1, 2: 2, 3: 3 });
export const CARD_ENERGY_PRICE: Readonly<Record<'tier1' | 'pool' | 'link', number>> =
  Object.freeze({ tier1: 1, pool: 2, link: 3 });
/** Cartes proposées par la boutique : une par emplacement (Tier 1, sac du tour, lien). */
export const SHOP_CARD_COUNT = 3;

/**
 * Ce que rapporte une série, versé en réserve à la fin du round
 * (`GameState.applyEndOfCombat`). Deux voies, toutes deux récompensées : celui
 * qui gagne tôt enchaîne (série de victoires), celui qui mise sur la fin reste
 * dans la partie (défaites).
 *
 * L'index est la LONGUEUR de la série après ce round, plafonnée à la dernière
 * case : une victoire seule ne rapporte rien, deux de suite +2, trois et plus
 * +3 ; une défaite +1, deux de suite et plus +2.
 *
 * ⚠️ Un nul ou un timeout ne compte ni comme victoire ni comme défaite : il
 * rompt les deux séries et ne rapporte rien.
 */
export const WIN_STREAK_RESERVE: readonly number[] = [0, 0, 2, 3];
export const LOSS_STREAK_RESERVE: readonly number[] = [0, 1, 2];

export type ReserveGainReason = 'win_streak' | 'loss' | 'loss_streak';

export class GameState {
  round: number;
  phase: PhaseValue;

  player_hp: number;
  enemy_hp: number;

  /** Multiplicateur de base du round : le seul facteur de tour
   *  (`roundFactor`). Il dépendait aussi du nombre d'unités posées (×3 à une
   *  unité) ; c'est la réserve d'énergie qui récompense désormais la retenue. */
  player_multiplier: number;
  enemy_multiplier: number;

  /** Énergie mise de côté, cumulée d'un tour à l'autre — cf.
   *  `MULLIGAN_COST_ENERGY`. Joueur seulement : l'IA ne fait ni mulligan ni
   *  Shopping, et en PvP chaque client tient la sienne (rien ne voyage). */
  player_energy_reserve: number;
  /** Longueur des séries en cours (une seule des deux est non nulle). */
  player_win_streak: number;
  player_loss_streak: number;

  // Énergie d'invocation en plus, pour toute la partie (`energy_bonus` :
  // magie ou attribut). S'ajoute au budget du tour (`SummonBudget`).
  player_energy_bonus: number;
  enemy_energy_bonus: number;

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
  /** Magies garanties à la prochaine Phase Shopping — accumulées par le
   *  terrain (au lancement du combat) et l'attribut (`fin_combat`), consommées
   *  d'un coup par `GameSession.getShoppingMagies()`. */
  player_guaranteed_magies: GuaranteedMagie[];
  /**
   * Pendant enemy des deux champs ci-dessus : contrairement au
   * multiplicateur et au Shopping (ressources exclusivement joueur), la
   * pioche a un destinataire de CHAQUE côté — `EnemyAI` pioche aussi.
   * Consommés par `GameSession._placeEnemyUnits`, comme leurs pendants
   * joueur le sont par `startPreparation`. Pas de `enemy_draw_sources` :
   * rien n'affiche la provenance de la pioche adverse.
   */
  enemy_extra_draws: number;
  enemy_guaranteed_draws: GuaranteedDraw[];
  player_extra_shopping_magies: number;    // accumulated shopping_bonus
  /** Bonus PERMANENT de multiplicateur de dégâts, cumulé par les magies
   *  `damage_multiplier_bonus`. ⚠️ Volontairement HORS de `nextRound()`, qui
   *  remet `player_multiplier` à 1.0 à chaque tour : c'est un investissement,
   *  il vaut pour tous les combats restants. À distinguer du bonus d'ATTRIBUT
   *  du même nom, qui ne vaut que pour le round où il se déclenche et arrive
   *  par `attributeResult`. */
  player_damage_multiplier_bonus: number;
  /**
   * Provenance du champ ci-dessus (cf. `BonusSourceEntry`) — quelle MAGIE a
   * crédité quelle part. ⚠️ Il est PERMANENT comme lui, et ne se vide donc pas
   * au round : les deux s'écrivent au même instant (`GameSession._pourMagie`) et
   * `sum(value) === player_damage_multiplier_bonus` à tout moment. La part
   * d'ATTRIBUT n'entre pas ici — elle ne vaut que pour son round et arrive par
   * `attributeResult.damage_multiplier_sources`.
   */
  player_multiplier_sources: BonusSourceEntry[];
  /**
   * Pendant ADVERSE des deux champs ci-dessus — PvP seulement : le bonus
   * permanent de magie de l'adversaire, reçu avec son board
   * (`round:board_ready`) et AFFECTÉ, jamais cumulé (son propriétaire fait foi).
   * Sans lui, chaque client calculait les PV qu'il perd sans le multiplicateur
   * de magie d'en face. Reste à 0 contre l'IA, qui n'a pas de Phase Shopping.
   */
  enemy_damage_multiplier_bonus: number;
  enemy_multiplier_sources: BonusSourceEntry[];
  /**
   * Provenance d'un `player_hp_bonus` de TERRAIN — le seul porteur qui
   * s'applique AU LANCEMENT du combat (`BoardEffect.applyBoardEffects`), donc
   * avant que `applyEndOfCombat` (qui verse la part ATTRIBUT, à `fin_combat`)
   * n'ait quoi que ce soit à raconter. Transitoire : accumulé au lancement du
   * combat, lu et vidé par `applyEndOfCombat` du MÊME combat.
   */
  player_hp_sources: BonusSourceEntry[];

  constructor() {
    this.round = 1;
    this.phase = Phase.PREPARATION;

    this.player_hp = STARTING_HP;
    this.enemy_hp  = STARTING_HP;

    this.player_multiplier = 1.0;
    this.enemy_multiplier  = 1.0;

    this.player_energy_reserve = 0;
    this.player_win_streak = 0;
    this.player_loss_streak = 0;

    this.player_energy_bonus = 0;
    this.enemy_energy_bonus  = 0;

    this.player_extra_draws = 0;
    this.player_guaranteed_draws = [];
    this.player_draw_sources = [];
    this.player_guaranteed_magies = [];
    this.enemy_extra_draws = 0;
    this.enemy_guaranteed_draws = [];
    this.player_extra_shopping_magies = 0;
    this.player_damage_multiplier_bonus = 0;
    this.player_multiplier_sources = [];
    this.enemy_damage_multiplier_bonus = 0;
    this.enemy_multiplier_sources = [];
    this.player_hp_sources = [];
  }

  // ── Phase transitions ──

  startCombat(): void {
    this.phase = Phase.COMBAT;
    this.player_multiplier = roundFactor(this.round);
    this.enemy_multiplier  = roundFactor(this.round);
  }

  /**
   * Avance les séries du joueur d'après le vainqueur du round, et verse ce
   * qu'elles rapportent en réserve. Rend le gain et sa raison (pour le
   * récapitulatif), `0`/`null` quand le round ne rapporte rien.
   */
  creditRoundOutcome(winner: RoundWinner): { gain: number; reason: ReserveGainReason | null } {
    if (winner === 'player') {
      this.player_win_streak++;
      this.player_loss_streak = 0;
    } else if (winner === 'enemy') {
      this.player_loss_streak++;
      this.player_win_streak = 0;
    } else {
      this.player_win_streak = 0;
      this.player_loss_streak = 0;
      return { gain: 0, reason: null };
    }
    const at = (table: readonly number[], n: number) => table[Math.min(n, table.length - 1)];
    const gain = winner === 'player'
      ? at(WIN_STREAK_RESERVE, this.player_win_streak)
      : at(LOSS_STREAK_RESERVE, this.player_loss_streak);
    if (gain <= 0) return { gain: 0, reason: null };
    this.player_energy_reserve += gain;
    const reason: ReserveGainReason = winner === 'player' ? 'win_streak'
      : this.player_loss_streak >= 2 ? 'loss_streak' : 'loss';
    return { gain, reason };
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
  ): {
    playerMultiplier: number; enemyMultiplier: number;
    playerDamageDealt: number; enemyDamageDealt: number;
    playerMultiplierSources: BonusSourceEntry[]; enemyMultiplierSources: BonusSourceEntry[];
    playerHpBonus: number; playerHpSources: BonusSourceEntry[];
    reserveGain: number; reserveGainReason: ReserveGainReason | null;
  } {
    this.phase = Phase.END_ROUND;

    let playerMultiplier = 0;
    let enemyMultiplier = 0;
    let playerDamageDealt = 0;
    let enemyDamageDealt = 0;
    // ⚠️ Les deux registres se concatènent DANS L'ORDRE des deux termes ajoutés
    // juste en dessous : la liste est la lecture de la somme, pas un inventaire
    // à côté d'elle. Vides quand le camp n'encaisse pas — il n'y a alors aucun
    // multiplicateur à expliquer.
    let playerMultiplierSources: BonusSourceEntry[] = [];
    let enemyMultiplierSources: BonusSourceEntry[] = [];

    if (winner === 'player' || winner === 'timeout' || winner === 'draw') {
      playerMultiplier = this.player_multiplier
        + (attributeResult.damage_multiplier_bonus || 0)
        + this.player_damage_multiplier_bonus;
      playerMultiplierSources = [
        ...(attributeResult.damage_multiplier_sources ?? []),
        ...this.player_multiplier_sources,
      ];
      playerDamageDealt = Math.round(playerSurvivorsAtk * playerMultiplier);
      this.enemy_hp -= playerDamageDealt;
    }
    if (winner === 'enemy' || winner === 'timeout' || winner === 'draw') {
      // ⚠️ Le pendant EXACT de la ligne au-dessus, et c'est la décision 3 du §7 :
      // l'IA porte ses effets comme un vrai joueur. Le bonus d'attribut ne vaut
      // que pour CE round, comme celui du joueur ; le bonus de magie permanent
      // n'existe qu'en PvP (reçu du réseau), l'IA n'ayant pas de Shopping.
      // ⚠️ Les termes s'additionnent dans le MÊME ORDRE que ceux du joueur :
      // l'adversaire calcule ses dégâts infligés par la ligne du dessus, et
      // l'addition flottante n'est pas associative.
      enemyMultiplier = this.enemy_multiplier
        + (attributeResult.enemy_damage_multiplier_bonus || 0)
        + this.enemy_damage_multiplier_bonus;
      enemyMultiplierSources = [
        ...(attributeResult.enemy_damage_multiplier_sources ?? []),
        ...this.enemy_multiplier_sources,
      ];
      enemyDamageDealt = Math.round(enemySurvivorsAtk * enemyMultiplier);
      this.player_hp -= enemyDamageDealt;
    }

    // Clamp HP
    this.player_hp = Math.max(0, this.player_hp);
    this.enemy_hp  = Math.max(0, this.enemy_hp);

    // Accumulate end-of-combat attribute bonuses
    if (attributeResult.energy_bonus) {
      this.player_energy_bonus += attributeResult.energy_bonus;
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
    if (attributeResult.guaranteed_magies?.length) {
      this.player_guaranteed_magies.push(...attributeResult.guaranteed_magies);
    }
    if (attributeResult.shopping_bonus) {
      this.player_extra_shopping_magies += attributeResult.shopping_bonus;
    }
    if (attributeResult.enemy_draw_bonus) {
      this.enemy_extra_draws += attributeResult.enemy_draw_bonus;
    }
    if (attributeResult.enemy_guaranteed_draws?.length) {
      this.enemy_guaranteed_draws.push(...attributeResult.enemy_guaranteed_draws);
    }
    if (attributeResult.enemy_energy_bonus) {
      this.enemy_energy_bonus += attributeResult.enemy_energy_bonus;
    }

    // ⚠️ Deux sources pour le MÊME champ : le terrain (posé au lancement du
    // combat, dans `this.player_hp_sources`) et l'attribut (`fin_combat`,
    // dans `attributeResult`). Le RÉCAPITULATIF les cumule (même invariant
    // `sum(value) === le bonus` que le multiplicateur), mais seule la part
    // ATTRIBUT se verse ici : celle du terrain l'a déjà été par
    // `applyBoardEffects`, au lancement du combat — la reverser la comptait
    // deux fois. Le registre du terrain est transitoire, vidé ici.
    const playerHpSources = [...this.player_hp_sources, ...(attributeResult.player_hp_sources ?? [])];
    this.player_hp_sources = [];
    const playerHpBonus = playerHpSources.reduce((n, s) => n + s.value, 0);
    const attributeHpBonus = attributeResult.player_hp_bonus || 0;
    if (attributeHpBonus) {
      this.player_hp = Math.min(Math.max(0, this.player_hp + attributeHpBonus), PLAYER_HP_CAP);
    }
    // ⚠️ Pendant ADVERSE, au même instant et avec le même écrêtage : l'IA porte
    // ses effets comme un vrai joueur, et en PvP c'est ce qui fait que les
    // deux clients s'accordent sur les PV de fin de round (l'adversaire se
    // verse ce gain par la ligne du dessus).
    const enemyHpBonus = attributeResult.enemy_hp_bonus || 0;
    if (enemyHpBonus) {
      this.enemy_hp = Math.min(Math.max(0, this.enemy_hp + enemyHpBonus), PLAYER_HP_CAP);
    }

    const outcome = this.creditRoundOutcome(winner);

    return {
      playerMultiplier, enemyMultiplier, playerDamageDealt, enemyDamageDealt,
      playerMultiplierSources, enemyMultiplierSources,
      playerHpBonus, playerHpSources,
      reserveGain: outcome.gain, reserveGainReason: outcome.reason,
    };
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
      player_energy_bonus: this.player_energy_bonus,
      player_energy_reserve: this.player_energy_reserve,
    };
  }
}
