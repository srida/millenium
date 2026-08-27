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
import { GameState, Phase, PLAYER_HP_CAP } from './GameState.js';
import { EnemyAI } from './EnemyAI.js';
import { AttributeManager } from './AttributeManager.js';
import { CombatManager } from './CombatManager.js';
import { applyEffect as applyBoardEffect } from './BoardEffect.js';
// Modules JS encore non convertis : leurs annotations JSDoc (Card[][], null par
// défaut…) sont trop étroites pour l'interop TS. Casts localisés en attendant
// la conversion TS de ces modules (au fil des phases).
import { applyEffect as _applyMagieEffect, needsUnitTarget, needsGraveyardTarget, needsHandTarget, magieCostHp, canAffordMagie } from './MagieEffect.js';
import * as _InvocationManager from './InvocationManager.js';
const applyMagieEffect = _applyMagieEffect as (magie: any, ctx: { gameState?: any; targetUnit?: any; targetUnits?: any[] }) => void;
const InvocationManager = _InvocationManager as any;
import * as _InvocationRules from './InvocationRules.js';
const {
  needsMaterials, materialsComplete, transformTargetCells,
  materialCandidateCells, materialCandidateGraveyard, isPlayable,
  validCells, summonOptionsStatus,
} = _InvocationRules as any;
import { tiersForRound, drawHand } from './Draw.js';
import { pickMagies } from './MagieOffer.js';
import type { MagieOfferContext } from './MagieOffer.js';
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
  /** Catalogue COMPLET des magies (MagieDatabase.getAllMagies).
   *  ⚠️ Le tirage n'est PLUS délégué à la couche data : c'est
   *  `getShoppingMagies` qui filtre par pertinence et pondère par rareté
   *  (`logic/MagieOffer.ts`), avec le `rand` semé de la partie. La couche data
   *  fournit, elle ne décide plus. */
  getAllMagies: () => Magie[];
  /** 'ai' (défaut) : EnemyAI place l'adversaire. 'pvp' : l'adversaire est un
   *  humain distant — le placement ennemi et le terrain sont gérés en externe
   *  (PvpController/PvpOpponentProvider), pas ici. */
  mode?: 'ai' | 'pvp';
  /** Source de hasard de la partie : pioche joueur, pioches garanties et
   *  pioche de l'IA. Injectée pour que la simulation d'équilibrage puisse
   *  SEMER une partie et la rejouer à l'identique (cf. logic/Random.ts) —
   *  `getRandomBoard` et `getAllMagies`, déjà injectés, portent le reste.
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

/**
 * État du board et de la main du joueur à l'OUVERTURE d'un tour, tel que
 * `undoPreparation()` le rétablit (bouton « Tout annuler »).
 *
 * ⚠️ Rien n'est cloné, et ce n'est pas une économie : la restauration doit être
 * exacte au bit près. Les unités ne sont JAMAIS mutées par ce qui se passe en
 * préparation — `board.removeUnit` ne fait que vider une case (il ne touche même
 * pas `unit.position`) et `_transferShoppingBonuses` LIT les matériaux pour
 * écrire sur le composite — et `_removeFromHand` fait un `splice` du tableau
 * sans toucher aux objets `Card`. Garder les références rend donc `_base`,
 * `_shopping_bonus`, `veterancy_points`, `current_hp`, `shield` et surtout
 * l'`uid` intacts ; c'est ce dernier qui laisse `Scene3D.refresh()` — un diff
 * indexé par uid — remettre la scène d'aplomb sans une ligne de plus.
 *
 * Seules les POSITIONS sont copiées : elles, la préparation les écrase.
 */
interface PrepSnapshot {
  hand: Card[];
  graveyard: Unit[];
  units: { unit: Unit; position: Position; initial_position: Position | null }[];
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

  /** Numéro du tour de préparation courant — incrémenté à chaque
   *  `startPreparation()`. Repère d'identité, pas un compteur de rounds : la
   *  couche app s'en sert pour savoir si un état qu'elle a mémorisé (marque
   *  d'événements de missions, verrou d'engagement PvP) parle encore du tour à
   *  l'écran, sans avoir à être prévenue du passage au tour suivant. */
  prepId = 0;

  private deps: GameSessionDeps;
  private enemyAI: EnemyAI;

  // Artefacts du combat en cours (capturés à startCombat, relus à finishCombat)
  private _combat: CombatManager | null = null;
  private _attributeManager: AttributeManager | null = null;
  private _combatPlayerUnits: Unit[] = [];

  // État de début de tour, pour « Tout annuler » (cf. PrepSnapshot).
  private _prepSnapshot: PrepSnapshot | null = null;

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
        } else if (mod.type === 'remove_fusion_material') {
          // Jumeau de remove_heritage_material, mais la fusion ne perd QU'UNE
          // partie de ses matériels : on retire les derniers de la liste, et
          // `_removed_materials` garde la trace pour le tooltip (même rôle
          // qu'`_original_sacrifice`). Une fusion à un seul matériel tombe à
          // zéro : elle s'invoque alors comme une normale, ce qui est bien
          // l'effet voulu.
          const idx = this.hand.findIndex(c => c.summon_type === 'fusion' && (c.cost?.materials?.length ?? 0) > 0);
          if (idx !== -1) {
            const materials = this.hand[idx].cost?.materials ?? [];
            const removed = Math.min(materials.length, Math.max(1, mod.value || 1));
            this.hand[idx] = {
              ...this.hand[idx],
              _removed_materials: (this.hand[idx]._removed_materials ?? 0) + removed,
              cost: { ...this.hand[idx].cost, materials: materials.slice(0, materials.length - removed) },
            };
          }
        }
      }
    }

    // L'adversaire ne joue PAS ici : en solo l'IA place ses unités au
    // lancement du combat (startCombat), une fois le joueur prêt ; en PvP
    // l'adversaire humain place sur son propre client et le PvpController
    // reconstruit son board juste avant le combat.

    // Le tour est ouvert : c'est CET état que « Tout annuler » rétablit. La
    // capture est la dernière instruction — pioche et modificateurs de main
    // font partie du début de tour, pas de ce que le joueur a fait ensuite.
    this.prepId++;
    this._prepSnapshot = this._capturePreparation();
  }

  // ── « Tout annuler » (bouton de la barre de préparation) ─────────────────

  private _capturePreparation(): PrepSnapshot {
    return {
      hand: [...this.hand],
      graveyard: [...this.graveyard],
      units: this.board.getUnitsOnSide('player').map(unit => ({
        unit,
        position: { ...(unit.position as Position) },
        initial_position: unit.initial_position ? { ...unit.initial_position } : null,
      })),
    };
  }

  /**
   * Y a-t-il quelque chose à annuler ? Le test est STRUCTUREL — on compare
   * l'état courant au snapshot — et non un drapeau posé par les mutateurs :
   * le déplacement tap-tap passe par `board.moveUnit` sans traverser
   * `GameSession`, un drapeau se ferait donc oublier au prochain chemin ajouté.
   * Sur cinq unités et une dizaine de cartes, le coût est nul.
   */
  canUndoPreparation(): boolean {
    const snap = this._prepSnapshot;
    if (!snap) return false;
    if (this.hand.length !== snap.hand.length) return true;
    if (this.graveyard.length !== snap.graveyard.length) return true;
    if (this.hand.some((c, i) => c !== snap.hand[i])) return true;
    if (this.graveyard.some((u, i) => u !== snap.graveyard[i])) return true;

    const units = this.board.getUnitsOnSide('player');
    if (units.length !== snap.units.length) return true;
    return snap.units.some(e => {
      const pos = e.unit.position;
      if (!pos || this.board.getUnit(pos) !== e.unit) return true;
      if (pos.col !== e.position.col || pos.row !== e.position.row) return true;
      const init = e.unit.initial_position;
      if (!init !== !e.initial_position) return true;
      return !!init && !!e.initial_position &&
        (init.col !== e.initial_position.col || init.row !== e.initial_position.row);
    });
  }

  /** Remet board, main et cimetière du joueur à l'ouverture du tour. */
  undoPreparation(): boolean {
    const snap = this._prepSnapshot;
    if (!snap || !this.canUndoPreparation()) return false;

    // ⚠️ On vide TOUTES les cases joueur avant d'en reposer une seule :
    // `placeUnit` jette sur case occupée, et une unité déplacée pendant la
    // préparation occupe la case d'une autre.
    for (const u of this.board.getUnitsOnSide('player')) this.board.removeUnit(u);
    for (const e of snap.units) {
      this.board.placeUnit(e.unit, e.position);
      e.unit.initial_position = e.initial_position ? { ...e.initial_position } : null;
    }
    this.hand = [...snap.hand];
    this.graveyard = [...snap.graveyard];
    return true;
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
    // Le tour est engagé : il n'y a plus rien à annuler.
    this._prepSnapshot = null;
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

  /**
   * L'offre de la Phase Shopping : `3 + extra` magies, tirées PARMI LES SEULES
   * PERTINENTES dans l'état courant, pondérées par rareté et sans remise
   * (`logic/MagieOffer.ts`).
   *
   * ⚠️ Aucun repli sur une magie sans effet réel : l'offre peut être plus
   * courte que `count`, et vide — `_startShopping` saute alors la phase, ce
   * qu'il faisait déjà.
   *
   * ⚠️ `player_extra_shopping_magies` est consommé AVANT le filtre : si le pool
   * pertinent est plus court, l'extra est PERDU et ne se reporte pas. Le
   * re-créditer transformerait un compteur d'octroi en dette — et le tour où il
   * ne reste rien à offrir est précisément celui où une magie de plus n'existe
   * pas.
   */
  getShoppingMagies(): Magie[] {
    const count = 3 + (this.gameState.player_extra_shopping_magies || 0);
    this.gameState.player_extra_shopping_magies = 0;
    return pickMagies(this.deps.getAllMagies(), this._offerContext(), count, this._rand);
  }

  /**
   * L'état courant réduit aux faits dont dépend la pertinence d'une magie.
   *
   * ⚠️ Construit ICI et pas dans `MagieOffer` : le deck du joueur
   * (`deps.cardsByTier`) ne sort pas de la session — aucun accesseur public à
   * ouvrir — et `MagieOffer` reste testable sans instancier une partie.
   */
  private _offerContext(): MagieOfferContext {
    const deck = Object.values(this.deps.cardsByTier).flat();
    return {
      boardUnitCount: this.getPlayerUnits().length,
      defusableFusionCount: this._defusableFusions().length,
      graveyardCount: this.graveyard.length,
      handCount: this.hand.length,
      deckTiers: [...new Set(deck.map(c => c.tier).filter((t): t is number => typeof t === 'number'))],
      // ⚠️ Le DECK et non la main : les quatre modificateurs sont différés au
      // `startPreparation()` suivant, donc appliqués après une pioche neuve.
      // Chaque prédicat est LE MÊME que celui que `startPreparation` appliquera
      // — le `summon_type` seul ne suffit pas, une fusion sans matériaux ou un
      // sacrifice à coût nul ne seraient jamais retouchés.
      deckHasSacrificeCost:    deck.some(c => c.summon_type === 'sacrifice' && (c.cost?.sacrifice ?? 0) > 0),
      deckHasTransformation:   deck.some(c => c.summon_type === 'transformation'),
      deckHasHeritageMaterial: deck.some(c => c.summon_type === 'heritage' && (c.cost?.materials?.length ?? 0) > 0),
      deckHasFusionMaterial:   deck.some(c => c.summon_type === 'fusion' && (c.cost?.materials?.length ?? 0) > 0),
      boardSlotBonusAvailable: this.gameState.hasLimitedBoardSlotBonusLeft(),
      playerHpBelowCap:        this.gameState.player_hp < PLAYER_HP_CAP,
    };
  }

  magieNeedsUnitTarget(magie: Magie): boolean { return needsUnitTarget(magie as any); }
  magieNeedsGraveyardTarget(magie: Magie): boolean { return needsGraveyardTarget(magie as any); }
  magieNeedsHandTarget(magie: Magie): boolean { return needsHandTarget(magie as any); }

  /**
   * Unités du board joueur qu'une magie `defuse_fusion` peut séparer : des
   * fusions, et seulement celles qui ont des matériaux à rendre. Extrait pour
   * que la règle n'existe qu'à UN endroit — `magieUnitTargets` la sert au
   * ciblage, `_offerContext` à la pertinence de l'offre.
   */
  private _defusableFusions(): Unit[] {
    return this.getPlayerUnits().filter(u => {
      const c = this.deps.cardDb.getCard(u.card_id);
      return c?.summon_type === 'fusion' && (c.cost?.materials?.length ?? 0) > 0;
    });
  }

  /** Contrecoup en PV joueur de la magie (0 si elle n'en a pas). */
  magieCostHp(magie: Magie): number { return magieCostHp(magie as any); }

  /** Le joueur peut-il payer le contrecoup ET rester en vie ? */
  canAffordMagie(magie: Magie): boolean {
    return canAffordMagie(magie as any, this.gameState.player_hp);
  }

  /**
   * Prélève le contrecoup. Appelé par les QUATRE chemins d'application, et
   * toujours AVANT l'effet : sans quoi `drain_life` financerait son propre
   * coût avec les PV qu'il rapporte. Le plancher à 0 est défensif — la garde
   * d'accessibilité rend le cas impossible.
   */
  private _payMagieCost(magie: Magie): void {
    const cost = this.magieCostHp(magie);
    if (cost > 0) this.gameState.player_hp = Math.max(0, this.gameState.player_hp - cost);
  }

  /** Cibles valides d'une magie sur le board joueur (defuse : fusions seulement). */
  magieUnitTargets(magie: Magie): Unit[] {
    if (magie.effect?.type === 'defuse_fusion') return this._defusableFusions();
    return this.getPlayerUnits();
  }

  applyMagieOnUnit(magie: Magie, unit: Unit): void {
    if (!this.canAffordMagie(magie)) return;
    this._payMagieCost(magie);
    if (magie.effect?.type === 'defuse_fusion') { this._defuseFusion(unit); return; }
    if (magie.effect?.type === 'destroy_unit') { this._destroyUnit(unit); return; }
    if (magie.effect?.type === 'drain_life') { this._drainLife(unit); return; }
    applyMagieEffect(magie as any, { gameState: this.gameState, targetUnit: unit });
  }

  /**
   * Envoie une carte de la MAIN au cimetière, sous forme d'unité neutralisée :
   * elle y devient un matériau d'invocation (sacrifice / fusion / héritage /
   * transformation) au même titre qu'une unité tombée au combat. Comme toute
   * unité du cimetière, elle disparaît au lancement du combat si personne ne
   * l'a consommée — la magie échange donc une carte contre un matériau, elle
   * n'ajoute pas de corps sur le terrain.
   */
  applyMagieOnHandCard(magie: Magie, handIdx: number): Unit | null {
    const card = this.hand[handIdx];
    if (!card) return null;
    if (!this.canAffordMagie(magie)) return null;
    this._payMagieCost(magie);
    this.hand.splice(handIdx, 1);
    const unit = new Unit(card, 'player');
    unit.is_neutralized = true;
    this.graveyard.push(unit);
    return unit;
  }

  applyMagieOnGraveyardUnit(magie: Magie, unit: Unit): void {
    if (!this.canAffordMagie(magie)) return;
    this._payMagieCost(magie);
    applyMagieEffect(magie as any, { gameState: this.gameState, targetUnit: unit });
    const target = unit.initial_position && !this.board.isOccupied(unit.initial_position)
      ? unit.initial_position : this.board.firstEmptyPlayerCell();
    if (target) { try { this.board.placeUnit(unit, target); } catch { /* pas de slot */ } }
    this.graveyard = this.graveyard.filter(u => u.uid !== unit.uid);
  }

  applyGlobalMagie(magie: Magie): void {
    if (!this.canAffordMagie(magie)) return;
    this._payMagieCost(magie);
    // `targetUnits` porte les magies d'équipe (team_stat_bonus) : elles n'ont
    // pas de cible à désigner, mais frappent tout le board joueur.
    applyMagieEffect(magie as any, { gameState: this.gameState, targetUnits: this.getPlayerUnits() });
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

  /**
   * Absorption : l'unité est détruite comme par `destroy_unit` (elle part au
   * cimetière et libère son emplacement) et ses PV COURANTS — pas son
   * `max_hp` — sont versés à la jauge du joueur, plafonnés à PLAYER_HP_CAP comme
   * `player_hp_bonus`. Ce sont bien les PV courants : absorber une unité
   * qu'on vient de voir encaisser tout un combat ne doit pas rapporter autant
   * qu'absorber une unité intacte.
   */
  private _drainLife(unit: Unit): void {
    const drained = Math.max(0, Math.round(unit.current_hp));
    this._destroyUnit(unit);
    this.gameState.player_hp = Math.min(this.gameState.player_hp + drained, PLAYER_HP_CAP);
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
