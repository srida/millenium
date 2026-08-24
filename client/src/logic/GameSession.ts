/* eslint-disable @typescript-eslint/no-explicit-any */
// GameSession — orchestrateur headless de la boucle de jeu (port de la logique
// d'orchestration de l'ancien GameScreen3D, débarrassée du DOM, des timers et
// du PvP). Pur : aucune dépendance à React, Zustand, Three ni à la couche data —
// les données externes (terrain aléatoire, liste d'attributs, cardDb pour l'IA,
// magies) sont injectées, comme MatchSimulator/Tournament (PLAN §2.1).
//
// Le timing (timer 60 s, tick de combat) vit dans la couche React/animateur ;
// GameSession n'expose que des transitions synchrones et des accesseurs.
import { Board } from './Board.js';
import { Unit } from './Unit.js';
import { GameState, Phase } from './GameState.js';
import { EnemyAI } from './EnemyAI.js';
import { AttributeManager } from './AttributeManager.js';
import { CombatManager } from './CombatManager.js';
import { applyEffect as applyBoardEffect } from './BoardEffect.js';
// Modules JS encore non convertis : leurs annotations JSDoc (Card[][], null par
// défaut…) sont trop étroites pour l'interop TS. Casts localisés en attendant
// la conversion TS de ces modules (au fil des phases).
import { applyEffect as _applyMagieEffect, needsUnitTarget, needsGraveyardTarget } from './MagieEffect.js';
import * as _InvocationManager from './InvocationManager.js';
const applyMagieEffect = _applyMagieEffect as (magie: any, ctx: { gameState?: any; targetUnit?: any }) => void;
const InvocationManager = _InvocationManager as any;
import * as _InvocationRules from './InvocationRules.js';
const {
  needsMaterials, materialsComplete, transformTargetCells,
  materialCandidateCells, materialCandidateGraveyard, isPlayable,
  validCells, summonOptionsStatus,
} = _InvocationRules as any;
import { tiersForRound, drawHand } from './Draw.js';
import type { Card, Position, BoardDef, AttributeDef, Magie, RoundWinner } from './types.js';

const HAND_SIZE = 5;

export interface CardDbLike {
  getCard(id: string): Card | null;
}

export interface GameSessionDeps {
  /** Cartes du deck joueur, groupées par tier : { 1: Card[], … }. */
  cardsByTier: Record<number, Card[]>;
  /** Deck ennemi brut : { "1": ["CORE_001", …], … }. */
  enemyDeck: Record<string, string[]>;
  /** Liste complète des attributs (AttributeDatabase.getAllAttributes()). */
  attributeList: AttributeDef[];
  /** Résolution de carte par id (pour l'IA ennemie). */
  cardDb: CardDbLike;
  /** Tire un terrain de combat aléatoire (BoardDatabase.getRandomBoard). */
  getRandomBoard: () => BoardDef | null;
  /** Tire N magies pour la Phase Shopping (MagieDatabase.getRandomMagies). */
  getRandomMagies: (count: number) => Magie[];
  /** 'ai' (défaut) : EnemyAI place l'adversaire. 'pvp' : l'adversaire est un
   *  humain distant — le placement ennemi et le terrain sont gérés en externe
   *  (PvpController/PvpOpponentProvider), pas ici. */
  mode?: 'ai' | 'pvp';
  /** Source de hasard de la partie : pioche joueur, pioches garanties et
   *  pioche de l'IA. Injectée pour que la simulation d'équilibrage puisse
   *  SEMER une partie et la rejouer à l'identique (cf. logic/Random.ts) —
   *  `getRandomBoard` et `getRandomMagies`, déjà injectés, portent le reste.
   *  Le défaut `Math.random` laisse tous les modes de jeu inchangés. */
  rand?: () => number;
  /** Handicap PLAT donné à chaque unité de l'IA, cumulé à ses stats de base
   *  pour toute la partie. Absent ou nul = adversaire non trafiqué, le cas de
   *  tous les modes existants. C'est un primitif générique : `logic/` ne sait
   *  pas que le mode Arcade s'en sert pour durcir ses quatre échelons. */
  enemyBonus?: { atk: number; hp: number } | null;
}

export interface EndRoundResult {
  winner: RoundWinner;
  playerSurvivorsAtk: number;
  enemySurvivorsAtk: number;
  playerSurvivors: { name: string; atk: number }[];
  enemySurvivors: { name: string; atk: number }[];
  damageMultiplierBonus: number;
  isGameOver: boolean;
}

export interface StartCombatResult {
  combat: CombatManager;
  attributeManager: AttributeManager;
  boardData: BoardDef | null;
  playerUnits: Unit[];
  enemyUnits: Unit[];
}

export class GameSession {
  gameState = new GameState();
  board = new Board();
  hand: Card[] = [];
  graveyard: Unit[] = [];
  enemyUnits: Unit[] = [];
  enemyGraveyard: Unit[] = [];

  private deps: GameSessionDeps;
  private enemyAI: EnemyAI;

  // Artefacts du combat en cours (capturés à startCombat, relus à finishCombat)
  private _combat: CombatManager | null = null;
  private _attributeManager: AttributeManager | null = null;
  private _combatPlayerUnits: Unit[] = [];

  constructor(deps: GameSessionDeps) {
    this.deps = deps;
    this.enemyAI = new EnemyAI(deps.enemyDeck, deps.cardDb as any, 'enemy', deps.rand ?? Math.random);
  }

  /** Le hasard de la partie, en un seul point de lecture. */
  private get _rand(): () => number { return this.deps.rand ?? Math.random; }

  // ── Accesseurs ─────────────────────────────────────────────────────────

  get phase() { return this.gameState.phase; }
  getPlayerUnits(): Unit[] { return this.board.getLivingUnitsOnSide('player'); }
  getEnemyUnits(): Unit[] { return this.board.getLivingUnitsOnSide('enemy'); }

  getSynergies() {
    const units = this.getPlayerUnits();
    if (units.length === 0) return [];
    const mgr = new AttributeManager(this.deps.attributeList, units, []);
    return mgr.getActiveSynergies(units);
  }

  // ── Préparation ────────────────────────────────────────────────────────

  startPreparation(): void {
    // Nettoie le terrain du combat précédent
    this.board.clearBlockedCells();

    // Pioches garanties : occupent des slots dans la main normale (pas des cartes en plus)
    const guaranteedDraws = this.gameState.player_guaranteed_draws.splice(0);
    const extraDraws = this.gameState.player_extra_draws;
    this.gameState.player_extra_draws = 0; // consommé — re-gagné chaque tour via attributs
    const randomCount = Math.max(0, HAND_SIZE + extraDraws - guaranteedDraws.length);
    this.hand = [...this.hand, ...drawHand(this.deps.cardsByTier, this.gameState.round, randomCount, this._rand)];

    // Pioches garanties : ignorent la restriction de tier du tour — cherche dans tout le deck
    const fullPool = Object.values(this.deps.cardsByTier).flat();
    for (const draw of guaranteedDraws) {
      const matches = fullPool.filter((c: any) =>
        (!draw.tier      || c.tier === draw.tier) &&
        (!draw.attribute || c.attributes?.includes(draw.attribute)) &&
        (!draw.category  || c.summon_type === draw.category));
      const rand = this._rand;
      if (matches.length > 0) {
        this.hand.push({ ...matches[Math.floor(rand() * matches.length)] });
      } else {
        const fallback = fullPool.filter((c: any) =>
          (!draw.attribute || c.attributes?.includes(draw.attribute)) &&
          (!draw.category  || c.summon_type === draw.category));
        if (fallback.length > 0) this.hand.push({ ...fallback[Math.floor(rand() * fallback.length)] });
        else if (fullPool.length > 0) this.hand.push({ ...fullPool[Math.floor(rand() * fullPool.length)] });
      }
    }

    // Modifiers de main différés (magies choisies au tour précédent)
    if (this.gameState.player_hand_modifiers.length) {
      const modifiers = this.gameState.player_hand_modifiers.splice(0);
      for (const mod of modifiers) {
        if (mod.type === 'reduce_sacrifice_cost') {
          const idx = this.hand.findIndex(c => c.summon_type === 'sacrifice' && (c.cost?.sacrifice ?? 0) > 0);
          if (idx !== -1) {
            const original = this.hand[idx]._original_sacrifice ?? this.hand[idx].cost?.sacrifice ?? 0;
            this.hand[idx] = { ...this.hand[idx], _original_sacrifice: original, cost: { ...this.hand[idx].cost, sacrifice: Math.max(0, original - (mod.value || 1)) } };
          }
        } else if (mod.type === 'free_transformation') {
          const idx = this.hand.findIndex(c => c.summon_type === 'transformation');
          if (idx !== -1) this.hand[idx] = { ...this.hand[idx], _free_transformation: true };
        } else if (mod.type === 'remove_heritage_material') {
          const idx = this.hand.findIndex(c => c.summon_type === 'heritage' && (c.cost?.materials?.length ?? 0) > 0);
          if (idx !== -1) this.hand[idx] = { ...this.hand[idx], cost: { ...this.hand[idx].cost, materials: [] } };
        }
      }
    }

    // L'adversaire ne joue PAS ici : en solo l'IA place ses unités au
    // lancement du combat (startCombat), une fois le joueur prêt ; en PvP
    // l'adversaire humain place sur son propre client et le PvpController
    // reconstruit son board juste avant le combat.
  }

  /** Placement de l'adversaire IA — le joueur pose en premier, l'IA répond au
   *  moment où il valide (bouton PRÊT / fin du chrono). No-op en PvP. */
  private _placeEnemyUnits(): void {
    if (this.deps.mode === 'pvp') return;
    // L'IA pioche et remplit ses slots vides (survivants restent, cimetière dispo)
    this.enemyAI.drawHand(this.gameState.round);
    this.enemyAI.placeFromHand(this.board, this.gameState.enemy_board_slots, this.enemyGraveyard);
    this.enemyAI.rearrangeUnits(this.board, this.gameState.enemy_board_slots);
    this.enemyUnits = this.board.getLivingUnitsOnSide('enemy');
    this._applyEnemyBonus();
  }

  /**
   * Applique le handicap plat aux unités de l'IA. Appelé ici parce que
   * `_placeEnemyUnits` est le SEUL entonnoir par lequel passent les unités
   * créées par l'IA — `EnemyAI` construit `new Unit` en sept endroits, un par
   * voie d'invocation.
   *
   * Le bonus s'écrit dans `_base` et non dans `_stat_bonuses` : c'est la seule
   * voie permanente du jeu (`_stat_bonuses` est balayé par `resetCombatStats()`
   * à chaque fin de combat, et par POWER_DEBUFF). Même geste que les magies de
   * Shopping, qui sont les autres bonus « définitifs ».
   *
   * Le marqueur d'instance rend l'appel idempotent : un survivant du round
   * précédent est sauté, et une unité FUSIONNÉE à partir de matériaux déjà
   * boostés est une unité neuve — elle reçoit le handicap une fois, sans cumul.
   *
   * ⚠️ Appelé APRÈS `rearrangeUnits` : ce dernier trie par PV, poser le bonus
   * avant décalerait le placement de l'IA dans tous les modes.
   */
  private _applyEnemyBonus(): void {
    const bonus = this.deps.enemyBonus;
    if (!bonus || (!bonus.atk && !bonus.hp)) return;
    for (const unit of this.enemyUnits) {
      if (unit._enemy_bonus_applied) continue;
      unit._enemy_bonus_applied = true;
      if (bonus.atk) unit._base.atk = Math.max(1, unit._base.atk + bonus.atk);
      if (bonus.hp) {
        unit._base.hp = Math.max(1, unit._base.hp + bonus.hp);
        unit.current_hp += bonus.hp;
      }
      unit._recomputeStats();
    }
  }

  // ── Flux d'invocation (délégué à InvocationRules/Manager) ───────────────

  isPlayable(card: Card): boolean {
    return isPlayable(card as any, this.board, this.graveyard, this.gameState.player_board_slots);
  }

  needsMaterials(card: Card): boolean {
    return needsMaterials(card as any, this.board, this.graveyard);
  }

  materialsComplete(card: Card, mats: Unit[]): boolean {
    return materialsComplete(card as any, mats);
  }

  summonOptionsStatus(card: Card) {
    return summonOptionsStatus(card as any, this.board, this.graveyard, this.gameState.player_board_slots);
  }

  validCells(card: Card, selectedMaterials: Unit[]): Position[] {
    return validCells(card as any, {
      board: this.board, hand: this.hand, graveyard: this.graveyard,
      selectedMaterials, playerBoardSlots: this.gameState.player_board_slots,
    });
  }

  materialCandidateCells(card: Card, selectedMaterials: Unit[]): Position[] {
    return materialCandidateCells(card as any, selectedMaterials, this.board);
  }

  transformTargetCells(card: Card): Position[] {
    return transformTargetCells(card as any, this.board);
  }

  materialCandidateGraveyard(card: Card, selectedMaterials: Unit[]): Unit[] {
    return materialCandidateGraveyard(card as any, selectedMaterials, this.graveyard, this.board);
  }

  canSummon(card: Card, pos: Position, selectedMaterials: Unit[]) {
    return InvocationManager.canSummon(card as any, pos, this.board, this.hand, this.graveyard, selectedMaterials);
  }

  exceedsBoardSlots(card: Card, selectedMaterials: Unit[]): boolean {
    return InvocationManager.exceedsBoardSlots(card as any, selectedMaterials, this.board, this.graveyard, this.gameState.player_board_slots);
  }

  /** Exécute l'invocation (validée en amont). Retourne l'unité placée ou null. */
  place(card: Card, pos: Position, selectedMaterials: Unit[], handIdx: number | null): Unit | null {
    const unit = InvocationManager.summon(card as any, pos, this.board, this.hand, selectedMaterials.length > 0 ? selectedMaterials : null, handIdx);
    // Retire les unités de cimetière consommées
    for (const u of selectedMaterials) {
      const gi = this.graveyard.indexOf(u);
      if (gi !== -1) this.graveyard.splice(gi, 1);
    }
    return unit;
  }

  /** Échange/déplace une unité joueur pendant la préparation (drag & drop). */
  reposition(unit: Unit, toPos: Position): boolean {
    if (unit.side !== 'player') return false;
    if (!this.board.isPlayerCell(toPos)) return false;
    const target = this.board.getUnit(toPos);
    if (target && target.side !== 'player') return false;
    if (target === unit) return false;

    const fromPos = { ...(unit.position as Position) };
    this.board.removeUnit(unit);
    if (target) {
      this.board.removeUnit(target);
      this.board.placeUnit(target, fromPos);
      target.initial_position = { ...fromPos };
    }
    this.board.placeUnit(unit, toPos);
    unit.initial_position = { ...toPos };
    return true;
  }

  // ── Combat ─────────────────────────────────────────────────────────────

  // agreedBoard : en PvP, terrain convenu entre les 2 clients (déterminisme) ;
  // omis en IA → terrain aléatoire.
  startCombat(agreedBoard?: BoardDef | null): StartCombatResult {
    // L'IA joue en dernier : son placement consomme encore le cimetière ennemi
    // du round précédent, il doit donc précéder la purge des cimetières.
    this._placeEnemyUnits();

    this.graveyard = [];
    this.enemyGraveyard = [];

    const boardData = agreedBoard !== undefined ? agreedBoard : this.deps.getRandomBoard();
    this.board.setBlockedCells(boardData?.blocked_cells || []);

    const playerUnits = this.board.getLivingUnitsOnSide('player');
    this.enemyUnits = this.board.getLivingUnitsOnSide('enemy');

    this.gameState.startCombat(playerUnits.length, this.enemyUnits.length);

    const attributeManager = new AttributeManager(this.deps.attributeList, playerUnits, this.enemyUnits);
    attributeManager.applyStartOfCombat();

    if (boardData?.effect) {
      applyBoardEffect(boardData.effect, { playerUnits, enemyUnits: this.enemyUnits, gameState: this.gameState });
    }

    const combat = new CombatManager(this.board, playerUnits, this.enemyUnits, attributeManager);
    this._combat = combat;
    this._attributeManager = attributeManager;
    this._combatPlayerUnits = playerUnits;

    return { combat, attributeManager, boardData, playerUnits, enemyUnits: this.enemyUnits };
  }

  /** Applique la fin de combat : dégâts HP, vétérance, cimetière, repositionnement. */
  finishCombat(): EndRoundResult {
    const combat = this._combat!;
    const attributeManager = this._attributeManager!;
    const playerUnits = this._combatPlayerUnits;

    const playerNeutralized = playerUnits.filter(u => u.is_neutralized);
    const enemyNeutralized = this.enemyUnits.filter(u => u.is_neutralized);
    const attributeResult = attributeManager.applyEndOfCombat(playerNeutralized, enemyNeutralized) as any;

    const winner: RoundWinner = (combat.winner ?? 'draw') as RoundWinner;
    const playerSurvivors = playerUnits.filter(u => !u.is_neutralized);
    const enemySurvivors = this.enemyUnits.filter(u => !u.is_neutralized);
    // Vétérance : une unité encore active en fin de combat gagne 1 point
    for (const u of [...playerSurvivors, ...enemySurvivors]) u.veterancy_points++;
    const playerSurvivorsAtk = playerSurvivors.reduce((s, u) => s + u.atk, 0);
    const enemySurvivorsAtk = enemySurvivors.reduce((s, u) => s + u.atk, 0);
    this.gameState.applyEndOfCombat(winner, playerSurvivorsAtk, enemySurvivorsAtk, attributeResult);

    // Retire les ennemis morts ; les survivants restent
    for (const u of this.enemyUnits) if (u.is_neutralized) this.board.removeUnit(u);
    this.enemyGraveyard = this.enemyUnits.filter(u => u.is_neutralized);
    this.enemyUnits = this.enemyUnits.filter(u => !u.is_neutralized);
    for (const u of this.enemyUnits) u.resetCombatStats();
    this._returnHome(this.enemyUnits, 'enemy');

    // Retire les unités joueur neutralisées
    for (const u of playerUnits) if (u.is_neutralized) this.board.removeUnit(u);

    // Ré-place les unités réanimées (revive attribut)
    for (const u of attributeResult.revived ?? []) {
      u.is_neutralized = false;
      const target = u.initial_position && !this.board.isOccupied(u.initial_position)
        ? u.initial_position : this.board.firstEmptyPlayerCell();
      if (target) {
        try { this.board.placeUnit(u, target); } catch { u.is_neutralized = true; }
      } else {
        u.is_neutralized = true;
      }
    }

    // Unités encore neutralisées → cimetière pour la préparation suivante
    this.graveyard = playerUnits.filter(u => u.is_neutralized);

    // Reset des bonus de combat sur les survivants joueur (pas d'empilement entre tours)
    for (const u of this.board.getLivingUnitsOnSide('player')) u.resetCombatStats();
    this._returnHome(this.board.getLivingUnitsOnSide('player'), 'player');

    return {
      winner,
      playerSurvivorsAtk,
      enemySurvivorsAtk,
      playerSurvivors: playerSurvivors.map(u => ({ name: u.name, atk: u.atk })),
      enemySurvivors: enemySurvivors.map(u => ({ name: u.name, atk: u.atk })),
      damageMultiplierBonus: attributeResult.damage_multiplier_bonus ?? 0,
      isGameOver: this.gameState.isGameOver(),
    };
  }

  // Renvoie les survivants à leur initial_position (avec repli si occupée).
  private _returnHome(units: Unit[], side: 'player' | 'enemy'): void {
    const toReposition = units.filter(u =>
      u.initial_position &&
      (u.position!.col !== u.initial_position.col || u.position!.row !== u.initial_position.row));
    for (const u of toReposition) this.board.removeUnit(u);
    for (const u of toReposition) {
      const dest = u.initial_position && !this.board.isOccupied(u.initial_position)
        ? u.initial_position
        : (side === 'player' ? this.board.firstEmptyPlayerCell() : this.board.firstEmptyEnemyCell());
      if (dest) this.board.moveUnit(u, dest);
    }
  }

  // ── Phase Shopping (Phase 4 branchera l'UI ; ici : tirage + application) ──

  getShoppingMagies(): Magie[] {
    const count = 3 + (this.gameState.player_extra_shopping_magies || 0);
    this.gameState.player_extra_shopping_magies = 0;
    return this.deps.getRandomMagies(count);
  }

  magieNeedsUnitTarget(magie: Magie): boolean { return needsUnitTarget(magie as any); }
  magieNeedsGraveyardTarget(magie: Magie): boolean { return needsGraveyardTarget(magie as any); }

  /** Cibles valides d'une magie sur le board joueur (defuse : fusions seulement). */
  magieUnitTargets(magie: Magie): Unit[] {
    if (magie.effect?.type === 'defuse_fusion') {
      return this.getPlayerUnits().filter(u => {
        const c = this.deps.cardDb.getCard(u.card_id);
        return c?.summon_type === 'fusion' && (c.cost?.materials?.length ?? 0) > 0;
      });
    }
    return this.getPlayerUnits();
  }

  applyMagieOnUnit(magie: Magie, unit: Unit): void {
    if (magie.effect?.type === 'defuse_fusion') { this._defuseFusion(unit); return; }
    if (magie.effect?.type === 'destroy_unit') { this._destroyUnit(unit); return; }
    applyMagieEffect(magie as any, { gameState: this.gameState, targetUnit: unit });
  }

  applyMagieOnGraveyardUnit(magie: Magie, unit: Unit): void {
    applyMagieEffect(magie as any, { gameState: this.gameState, targetUnit: unit });
    const target = unit.initial_position && !this.board.isOccupied(unit.initial_position)
      ? unit.initial_position : this.board.firstEmptyPlayerCell();
    if (target) { try { this.board.placeUnit(unit, target); } catch { /* pas de slot */ } }
    this.graveyard = this.graveyard.filter(u => u.uid !== unit.uid);
  }

  applyGlobalMagie(magie: Magie): void {
    applyMagieEffect(magie as any, { gameState: this.gameState });
  }

  private _defuseFusion(fusionUnit: Unit): void {
    const fusionCard = this.deps.cardDb.getCard(fusionUnit.card_id);
    const materials = fusionCard?.cost?.materials ?? [];
    this.board.removeUnit(fusionUnit);
    for (const matId of materials) {
      const matCard = this.deps.cardDb.getCard(matId);
      if (!matCard) continue;
      const matUnit = new Unit(matCard, 'player');
      const cell = this.board.getLivingUnitsOnSide('player').length < this.gameState.player_board_slots
        ? this.board.firstEmptyPlayerCell() : null;
      if (cell) {
        matUnit.initial_position = { ...cell };
        this.board.placeUnit(matUnit, cell);
      } else {
        matUnit.is_neutralized = true;
        this.graveyard.push(matUnit);
      }
    }
  }

  private _destroyUnit(unit: Unit): void {
    this.board.removeUnit(unit);
    unit.is_neutralized = true;
    this.graveyard.push(unit);
  }

  // ── Fin de partie / tour suivant ────────────────────────────────────────

  isGameOver(): boolean { return this.gameState.isGameOver(); }
  getWinner() { return this.gameState.getWinner(); }

  /** Avance au tour suivant et lance la préparation. */
  startNextRound(): void {
    this.gameState.nextRound();
    if (this.gameState.phase !== Phase.GAME_OVER) this.startPreparation();
  }
}

export { Phase };
export { tiersForRound };
