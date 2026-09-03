/* eslint-disable @typescript-eslint/no-explicit-any */
// GameSession — orchestrateur headless de la boucle de jeu (port de la logique
// d'orchestration de l'ancien GameScreen3D, débarrassée du DOM, des timers et
// du PvP). Pur : aucune dépendance à React, Zustand, Three ni à la couche data —
// les données externes (catalogue de terrains, liste d'attributs, cardDb pour l'IA,
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
import { applyBoardEffects } from './BoardEffect.js';
import { mirrorCells } from './BoardMirror.js';
import { pickBoard, deckAttributes, dominantAttributes } from './BoardPicker.js';
import type { BoardPickContext, AttributeCounts } from './BoardPicker.js';
// Modules JS encore non convertis : leurs annotations JSDoc (Card[][], null par
// défaut…) sont trop étroites pour l'interop TS. Casts localisés en attendant
// la conversion TS de ces modules (au fil des phases).
import { applyEffect as _applyMagieEffect, needsUnitTarget, needsGraveyardTarget, needsHandTarget, magieCostHp, canAffordMagie, duplicateCopies, tierShift, sacrificeHpPercent } from './MagieEffect.js';
import * as _InvocationManager from './InvocationManager.js';
const applyMagieEffect = _applyMagieEffect as (magie: any, ctx: { gameState?: any; targetUnit?: any; targetUnits?: any[] }) => void;
const InvocationManager = _InvocationManager as any;
import * as _InvocationRules from './InvocationRules.js';
const {
  needsMaterials, materialsComplete, transformTargetCells,
  materialCandidateCells, materialCandidateGraveyard, isPlayable,
  validCells, summonOptionsStatus,
} = _InvocationRules as any;
import { tiersForRound, drawHand, resolveGuaranteedDraws } from './Draw.js';
import { pickMagies } from './MagieOffer.js';
import type { MagieOfferContext } from './MagieOffer.js';
import type { Card, Position, BoardDef, AttributeDef, DrawSummary, Magie, RoundWinner } from './types.js';

const HAND_SIZE = 5;

/** Les tiers DISTINCTS d'une liste de cartes, entrées sans tier ignorées. */
function _tiers(cards: readonly (Card | null | undefined)[]): number[] {
  return [...new Set(cards.map(c => c?.tier).filter((t): t is number => typeof t === 'number'))];
}

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
  /** Catalogue COMPLET des terrains (BoardDatabase.getAllBoards).
   *  ⚠️ Le TIRAGE n'est PLUS délégué à la couche data : il vit dans
   *  `logic/BoardPicker.pickBoard`, qui le filtre par pertinence vis-à-vis des
   *  deux decks et refuse un terrain déjà joué dans ce duel. La couche data
   *  FOURNIT, elle ne décide plus — exactement comme `getAllMagies`. */
  getAllBoards: () => BoardDef[];
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
   *  SEMER une partie et la rejouer à l'identique (cf. logic/Random.ts). Le
   *  TERRAIN y est passé : son tirage (`BoardPicker`) consomme ce même flux, à
   *  exactement un appel par combat — ni plus, ni moins, sinon toutes les
   *  pioches et tous les choix d'IA qui suivent se décaleraient.
   *  Le défaut `Math.random` laisse tous les modes de jeu inchangés. */
  rand?: () => number;
  /** Handicap PLAT donné à chaque unité de l'IA, cumulé à ses stats de base
   *  pour toute la partie. Absent ou nul = adversaire non trafiqué, le cas de
   *  tous les modes existants. C'est un primitif générique : `logic/` ne sait
   *  pas que le mode Arcade s'en sert pour durcir ses quatre échelons. */
  enemyBonus?: { atk: number; hp: number } | null;
  /** Le monde local est-il le MIROIR du repère de référence ? Vrai pour le seul
   *  rôle B d'un duel en ligne, dont le plateau est le reflet de celui de A
   *  (`logic/BoardMirror`). Absent partout ailleurs — solo, arcade, tournoi,
   *  tutoriel, simulation et rôle A sont déjà dans le repère de référence, et
   *  leur comportement est rigoureusement inchangé.
   *
   *  Il gouverne TROIS choses, qui sont la même : ce qui n'a pas le même sens
   *  des deux côtés doit être exprimé dans un repère commun.
   *    • les cases bloquées du terrain, appliquées miroitées (`startCombat`) ;
   *    • l'ORDRE dans lequel le plateau s'énumère — balayage des unités et
   *      voisines d'une case (`Board.mirroredFrame`), qui départage le choix de
   *      cible et le plus court chemin ;
   *    • le départage par camp de l'ordre d'initiative (`CombatManager`).
   *
   *  ⚠️ Posé UNE FOIS à la construction de la session, jamais passé en
   *  paramètre : il n'y aurait sinon qu'à l'oublier sur un chemin d'appel pour
   *  que la divergence revienne en silence. */
  mirroredRole?: boolean;
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

  /** Terrains déjà JOUÉS dans ce duel. Vit sur la session, donc sa durée de vie
   *  est exactement celle du duel — rien à réinitialiser, rien à purger, et
   *  rien à oublier de purger au prochain mode de jeu ajouté. */
  private _usedBoardIds = new Set<string>();

  // ⚠️ Dérivés UNE FOIS au constructeur : les deux decks sont figés pour tout le
  // duel (`cardsByTier` est bâti par `buildSession`, et `enemyDeck` est déjà
  // consommé ici même par `EnemyAI`). Le deck lui-même ne sort jamais de la
  // session — seule une liste d'ids d'attributs en sort, comme `_offerContext`
  // ne rend que des booléens et des tiers.
  private _playerDeckAttributes: string[];
  private _enemyDeckAttributes: string[];

  constructor(deps: GameSessionDeps) {
    this.deps = deps;
    // Le repère du plateau est posé AVANT tout placement : c'est lui qui décide
    // de l'ordre dans lequel le plateau s'énumère, et cet ordre est de la
    // logique de jeu (cf. `Board.getUnitsOnSide`).
    this.board.mirroredFrame = !!deps.mirroredRole;
    this.enemyAI = new EnemyAI(deps.enemyDeck, deps.cardDb as any, 'enemy', deps.rand ?? Math.random);
    this._playerDeckAttributes = deckAttributes(Object.values(deps.cardsByTier ?? {}).flat());
    this._enemyDeckAttributes = deckAttributes(
      Object.values(deps.enemyDeck ?? {})
        // ⚠️ Ni les decks publics ni les decks de bots ne sont validés par un
        // schéma : une entrée qui n'est pas un tableau ne doit pas jeter ici.
        .flatMap(ids => (Array.isArray(ids) ? ids : []))
        .map(id => (deps.cardDb as any).getCard(id) as Card | null));
  }

  /**
   * PvP : les attributs du deck ADVERSE, sous forme de COMPTES bruts dérivés
   * par le serveur de son deck book et transportés par `match:found` /
   * `match:rejoined` — le trajet exact des variantes d'illustration.
   *
   * ⚠️ Indispensable, et c'est le seul vrai piège du mode : en PvP,
   * `deps.enemyDeck` est le MIROIR du deck du joueur (`buildSession` y retombe
   * sur `rawDeck`, faute d'un deck adverse à injecter). Sans ce point d'entrée,
   * le rôle A choisirait le terrain en comptant DEUX FOIS son propre deck — une
   * erreur parfaitement silencieuse, puisqu'elle rend quand même un terrain
   * pertinent pour quelqu'un.
   *
   * ⚠️ Ce sont des comptes, pas une liste déjà filtrée : le seuil ne s'applique
   * qu'ici, côté client (cf. `BoardPicker.dominantAttributes`).
   */
  setEnemyDeckAttributeCounts(counts: AttributeCounts | null | undefined): void {
    if (!counts) return;
    this._enemyDeckAttributes = dominantAttributes(counts);
  }

  /**
   * Le terrain du prochain combat, SANS le jouer ni le consommer. Seul le rôle A
   * du PvP s'en sert : il le tire, diffuse son id, et les DEUX clients repassent
   * ensuite par `startCombat(board)` avec l'id que le serveur leur renvoie.
   */
  pickCombatBoard(): BoardDef | null {
    return pickBoard(this.deps.getAllBoards(), this._boardPickContext(), this._rand);
  }

  /** L'état du duel traduit pour `BoardPicker` — même geste que `_offerContext`
   *  pour les magies : le module de règles est pur, c'est la session qui lui
   *  raconte où on en est. */
  private _boardPickContext(): BoardPickContext {
    return {
      playerAttributes: this._playerDeckAttributes,
      enemyAttributes: this._enemyDeckAttributes,
      usedBoardIds: this._usedBoardIds,
    };
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

  startPreparation(): DrawSummary {
    // Nettoie le terrain du combat précédent
    this.board.clearBlockedCells();

    // Pioches garanties : occupent des slots dans la main normale (pas des cartes en plus)
    const guaranteedDraws = this.gameState.player_guaranteed_draws.splice(0);
    const extraDraws = this.gameState.player_extra_draws;
    this.gameState.player_extra_draws = 0; // consommé — re-gagné chaque tour via attributs
    // ⚠️ Le registre de provenance se vide AVEC les deux : les trois décrivent
    // un seul et même octroi, celui de ce tour (cf. `player_draw_sources`).
    const drawSources = this.gameState.player_draw_sources.splice(0);
    const handSizeBefore = this.hand.length;
    const randomCount = Math.max(0, HAND_SIZE + extraDraws - guaranteedDraws.length);
    this.hand = [...this.hand, ...drawHand(this.deps.cardsByTier, this.gameState.round, randomCount, this._rand)];

    // Pioches garanties : ignorent la restriction de tier du tour — cherche dans tout le deck
    const fullPool = Object.values(this.deps.cardsByTier).flat();
    this.hand.push(...resolveGuaranteedDraws(fullPool as any, guaranteedDraws, this._rand));

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

    // Ce que le tour vient de donner, pour la popup de pioche. ⚠️ `drawnCount`
    // est MESURÉ et non recalculé : les pioches garanties ont un double repli
    // et un pool vide ne rend rien — une soustraction en annoncerait des cartes
    // que la main n'a pas. Même discipline que le décompte de `TerrainAlert`.
    return {
      round: this.gameState.round,
      tiers: tiersForRound(this.gameState.round),
      baseCount: HAND_SIZE,
      extraDraws,
      guaranteed: guaranteedDraws,
      drawnCount: this.hand.length - handSizeBefore,
      handSizeAfter: this.hand.length,
      sources: drawSources,
    };
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
    // — bonus de pioche accumulés par l'attribut `draw_bonus`/`guaranteed_draw`
    // du CAMP ENNEMI, consommés ici comme leurs pendants joueur le sont par
    // `startPreparation`.
    const extraDraws = this.gameState.enemy_extra_draws;
    this.gameState.enemy_extra_draws = 0;
    const guaranteedDraws = this.gameState.enemy_guaranteed_draws.splice(0);
    this.enemyAI.drawHand(this.gameState.round, null, extraDraws, guaranteedDraws);
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

    const boardData = agreedBoard !== undefined ? agreedBoard : this.pickCombatBoard();
    // ⚠️ On marque le terrain qui est JOUÉ, jamais celui qui a été tiré. En PvP,
    // c'est l'id renvoyé par le serveur qui fait foi : un `round:terrain_pick`
    // perdu ne doit pas consommer un terrain que personne n'a vu. Et comme le
    // marquage vit ICI, il vaut pour les deux rôles et pour tous les modes, y
    // compris ceux où le terrain arrive de l'extérieur (`agreedBoard`) — une
    // seule ligne tient l'historique du duel.
    if (boardData) this._usedBoardIds.add(boardData.id);
    // ⚠️ Le terrain est une donnée POSITIONNELLE, au même titre que la position
    // d'une unité : appliqué verbatim des deux côtés d'un duel, il décrit deux
    // plateaux différents (cf. `logic/BoardMirror`).
    this.board.setBlockedCells(
      this.deps.mirroredRole
        ? mirrorCells(boardData?.blocked_cells)
        : (boardData?.blocked_cells || []),
    );

    const playerUnits = this.board.getLivingUnitsOnSide('player');
    this.enemyUnits = this.board.getLivingUnitsOnSide('enemy');

    // ⚠️ Les horloges d'attaque et de déplacement repartent de zéro à CHAQUE
    // combat, comme la jauge de pouvoir que `resetCombatStats` remet déjà à 0.
    // Elles ne le faisaient pas : un survivant gardait le reliquat de son
    // dernier coup et frappait donc quelques ticks plus tôt au round suivant.
    // Invisible en solo (une seule simulation), fatal en duel — l'unité
    // reconstruite depuis le réseau naît, elle, avec des horloges neuves, si
    // bien que chaque joueur voyait l'adversaire d'en face décalé du sien.
    // Le geste est ici et non dans `resetCombatStats`, que `POWER_DEBUFF`
    // appelle EN PLEIN COMBAT : y toucher rendrait la dissipation capable de
    // décaler le prochain coup de sa cible.
    for (const u of playerUnits) u.resetCombatClocks();
    for (const u of this.enemyUnits) u.resetCombatClocks();

    this.gameState.startCombat(playerUnits.length, this.enemyUnits.length);

    const attributeManager = new AttributeManager(this.deps.attributeList, playerUnits, this.enemyUnits);
    attributeManager.applyStartOfCombat();

    // ⚠️ TOUS les effets du terrain, pas seulement le premier : `effects` est
    // une liste cumulée (cf. `BoardEffect.boardEffects`, seul lecteur des deux
    // formes de la donnée).
    applyBoardEffects(boardData, { playerUnits, enemyUnits: this.enemyUnits, gameState: this.gameState });

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

    // ⚠️ Tous les participants du combat, morts COMPRIS — capturés avant que
    // les filtres ci-dessous ne retirent les neutralisés. C'est cette liste que
    // la remise à zéro finale balaie (cf. plus bas).
    const combatants = [...playerUnits, ...this.enemyUnits];

    const winner: RoundWinner = (combat.winner ?? 'draw') as RoundWinner;
    const playerSurvivors = playerUnits.filter(u => !u.is_neutralized);
    const enemySurvivors = this.enemyUnits.filter(u => !u.is_neutralized);
    // Vétérance : une unité encore active en fin de combat gagne 1 point
    for (const u of [...playerSurvivors, ...enemySurvivors]) u.veterancy_points++;
    const playerSurvivorsAtk = playerSurvivors.reduce((s, u) => s + u.atk, 0);
    const enemySurvivorsAtk = enemySurvivors.reduce((s, u) => s + u.atk, 0);
    this.gameState.applyEndOfCombat(winner, playerSurvivorsAtk, enemySurvivorsAtk, attributeResult);

    // Ré-place les ennemis réanimés (revive d'attribut, côté adverse) — le
    // pendant exact de la boucle joueur plus bas. `CombatManager._checkDeaths`
    // les a retirés du plateau à leur mort, il faut donc leur rendre une case.
    for (const u of attributeResult.enemyRevived ?? []) {
      const target = u.initial_position && !this.board.isOccupied(u.initial_position)
        ? u.initial_position : this.board.firstEmptyEnemyCell();
      if (target) {
        try { this.board.placeUnit(u, target); } catch { u.is_neutralized = true; }
      } else {
        u.is_neutralized = true;
      }
    }

    // Retire les ennemis morts ; les survivants restent
    for (const u of this.enemyUnits) if (u.is_neutralized) this.board.removeUnit(u);
    this.enemyGraveyard = this.enemyUnits.filter(u => u.is_neutralized);
    this.enemyUnits = this.enemyUnits.filter(u => !u.is_neutralized);
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

    // Reset des bonus de combat : pas d'empilement d'un tour sur l'autre.
    //
    // ⚠️ Sur TOUS les participants, les NEUTRALISÉS compris — c'était la moitié
    // manquante, et elle a coûté un duel. Seules les unités encore vivantes
    // étaient balayées ; une unité tombée au combat gardait donc indéfiniment
    // les bonus d'attribut de son dernier round, `max_hp` gonflé compris, tant
    // qu'elle restait au cimetière. Le round suivant, `applyStartOfCombat`
    // ajoutait les nouveaux bonus PAR-DESSUS les anciens.
    //
    // Invisible en solo (une seule simulation, et la synergie change rarement
    // d'un tour à l'autre) ; systématique en duel, où l'adversaire RECONSTRUIT
    // l'unité depuis `_base` à chaque round et ne peut donc hériter d'aucune
    // dérive. Constaté sur le duel `3ebfa22f` : au round 5, une unité gardait
    // le +20 PV d'un palier d'attribut que son camp n'atteignait plus.
    //
    // C'est le même geste que la remise à zéro des horloges de combat, et pour
    // la même raison : un état qui n'a pas de raison de survivre au combat se
    // supprime, il ne se transporte pas.
    for (const u of combatants) u.resetCombatStats();
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
    const deck = this._deckCards();
    return {
      boardUnitCount: this.getPlayerUnits().length,
      defusableFusionCount: this._defusableFusions().length,
      poweredUnitCount: this._poweredUnits().length,
      duplicableUnitCount: this._duplicableUnits().length,
      duplicableGraveyardCount: this._duplicableGraveyardUnits().length,
      graveyardCount: this.graveyard.length,
      handCount: this.hand.length,
      handTiers: _tiers(this.hand),
      boardTiers: _tiers(this._duplicableUnits().map(u => this.deps.cardDb.getCard(u.card_id)!)),
      materialSourceCount: this.hand.filter(c => this._drawableMaterialIds(c).length > 0).length,
      deckTiers: [...new Set(deck.map(c => c.tier).filter((t): t is number => typeof t === 'number'))],
      deckSummonTypes: [...new Set(deck.map(c => c.summon_type).filter((t): t is NonNullable<typeof t> => typeof t === 'string'))],
      // ⚠️ FAUX en PvP, et ce n'est pas une restriction arbitraire : `enemy_hp`
      // y est RÉÉCRIT à chaque round depuis le `player_hp` autoritaire de
      // l'adversaire (`PvpController._onRoundGo`), qui a calculé ses propres
      // dégâts subis sans connaître ce bonus. Le bonus n'y change donc rien —
      // sauf à faire déclarer une fin de partie que l'adversaire ne voit pas,
      // c'est-à-dire un `result_mismatch` qui prive les DEUX joueurs de leur
      // gain. Une magie qui ne peut que nuire n'est pas offerte.
      damageMultiplierMatters: this.deps.mode !== 'pvp',
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
  /**
   * Unités qui ont un pouvoir à accélérer. Même geste que `_defusableFusions`
   * et pour la même raison : la règle sert le ciblage ET la pertinence de
   * l'offre, elle ne doit donc exister qu'à un endroit.
   *
   * ⚠️ Lu sur l'UNITÉ et non sur sa carte : `grant_power` a pu lui en poser un
   * qu'elle n'avait pas: la carte mentirait.
   */
  private _poweredUnits(): Unit[] {
    return this.getPlayerUnits().filter(u => !!u.power_id);
  }

  /**
   * Unités du board dont la CARTE est retrouvable au catalogue — les seules
   * qu'une magie `duplicate_unit` puisse copier. Troisième membre de la même
   * famille que `_defusableFusions` et `_poweredUnits`, et pour la même raison :
   * la règle sert le ciblage ET la pertinence de l'offre, elle ne doit exister
   * qu'à UN endroit. Sans elle, une unité dont la carte a quitté le catalogue
   * encaisserait le contrecoup sans rien rendre.
   */
  private _duplicableUnits(): Unit[] {
    return this._cataloguedUnits(this.getPlayerUnits());
  }

  /** Le pendant au CIMETIÈRE : une unité neutralisée se copie comme une
   *  vivante, c'est la même carte qu'on lit. */
  private _duplicableGraveyardUnits(): Unit[] {
    return this._cataloguedUnits(this.graveyard);
  }

  /** Le prédicat commun aux duplications d'unité : on ne copie que ce que le
   *  catalogue sait rendre. Écrit une fois pour les deux provenances — deux
   *  copies de la même question finiraient par ne plus y répondre pareil. */
  private _cataloguedUnits(units: readonly Unit[]): Unit[] {
    return units.filter(u => !!this.deps.cardDb.getCard(u.card_id));
  }

  /** Le deck du joueur à plat. Ne SORT pas de la session : les accesseurs
   *  publics n'en rendent que des tiers, des booléens et des cartes tirées. */
  private _deckCards(): Card[] {
    return Object.values(this.deps.cardsByTier).flat();
  }

  /**
   * Le pool de remplacement d'une cible de tier `tier`, décalée de `shift` :
   * les cartes du DECK au tier voisin. Le deck et pas le catalogue — c'est la
   * seule réserve de cartes qu'une partie connaisse, celle où puisent déjà la
   * pioche et les pioches garanties.
   *
   * Un tier hors bornes ne demande aucune garde : `cardsByTier` n'a pas de case
   * 0 ni 6, le pool est vide et la cible n'en est pas une.
   */
  private _tierShiftPool(tier: number | undefined, shift: number): Card[] {
    if (typeof tier !== 'number') return [];
    return this.deps.cardsByTier[tier + shift] ?? [];
  }

  /**
   * Le même pool, pour un remplacement SUR LE TERRAIN — moins ce qui y est déjà
   * vivant.
   *
   * ⚠️ C'est la RÈGLE DU DOUBLON, et c'est la seule différence entre les deux
   * variantes de la magie : une copie de plus en main est légale (la règle ne
   * pèse que sur le board, et `duplicate_card` en fabrique déjà), un second
   * exemplaire VIVANT ne l'est pas. Une magie n'a pas à ouvrir une porte que
   * l'invocation ferme.
   */
  private _boardTierShiftPool(tier: number | undefined, shift: number): Card[] {
    const alive = new Set(this.getPlayerUnits().map(u => u.card_id));
    return this._tierShiftPool(tier, shift).filter(c => !alive.has(c.id));
  }

  /** Unités du board qu'un `shift_tier_unit` peut effectivement remplacer.
   *  Même famille que `_defusableFusions` / `_poweredUnits` : la règle sert le
   *  ciblage ET la pertinence, elle ne doit exister qu'à un endroit. */
  private _tierShiftUnits(shift: number): Unit[] {
    return this._duplicableUnits().filter(u => {
      const card = this.deps.cardDb.getCard(u.card_id);
      return this._boardTierShiftPool(card?.tier, shift).length > 0;
    });
  }

  /** Tire une carte de remplacement dans un pool. Objet NEUF, comme
   *  `_pushHandCopies` : deux cases de la main ne partagent jamais une carte. */
  private _pickFrom(pool: readonly Card[]): Card | null {
    if (!pool.length) return null;
    return { ...pool[Math.floor(this._rand() * pool.length)] };
  }

  // ── `draw_material` : rendre en main un matériel d'invocation ─────────────

  /**
   * Les matériels d'une carte qu'on sait rendre en main.
   *
   * ⚠️ PUR, aucun tirage : `magieHandTargets` l'interroge à chaque rendu de la
   * main, et un `rand()` consommé par une question d'affichage décalerait tout
   * le flux semé de la partie.
   *
   * ⚠️ « A des matériels » ne suffit pas : un id peut avoir quitté le
   * catalogue, et un matériel désigné par ATTRIBUT (`ARCH_*`) n'est pas une
   * carte — il n'en est une que si le deck en porte une. Même piège que
   * `duplicate_unit`, qui ne se contente pas de `boardUnitCount`.
   */
  private _drawableMaterialIds(card: Card): string[] {
    return [...new Set(card.cost?.materials ?? [])].filter(id => this._materialBearers(id).length > 0);
  }

  /** Les cartes qui peuvent tenir lieu de ce matériel : la carte nommée, ou —
   *  pour un matériel d'attribut — les cartes du deck qui le portent. */
  private _materialBearers(matId: string): Card[] {
    if (InvocationManager.isAttributeMaterial(matId)) {
      return this._deckCards().filter(c => c.attributes?.includes(matId));
    }
    // ⚠️ Le CATALOGUE et non le deck : un matériel nommé par id est la carte
    // exacte que la recette exige, qu'elle soit dans le deck ou non. C'est le
    // matériel d'attribut, qui ne nomme personne, qui doit puiser dans le deck.
    const card = this.deps.cardDb.getCard(matId) as Card | null;
    return card ? [card] : [];
  }

  /** Le joueur dispose-t-il déjà de ce matériel — sur le board, au cimetière ou
   *  en main ? Sert à préférer ce qui MANQUE (cf. `_drawMaterial`). */
  private _ownsMaterial(matId: string): boolean {
    const units = [...this.getPlayerUnits(), ...this.graveyard];
    if (units.some(u => InvocationManager.matchesMaterial(u, matId))) return true;
    return this.hand.some(c => (InvocationManager.isAttributeMaterial(matId)
      ? !!c.attributes?.includes(matId)
      : (c.represented_ids?.includes(matId) ?? c.id === matId)));
  }

  /**
   * Le matériel rendu en main. Double repli, dans l'esprit des pioches
   * garanties : on tire d'abord parmi les matériels que le joueur n'a PAS —
   * c'est le seul qui débloque quelque chose — et à défaut parmi tous.
   * Sans ce tri, la magie rendrait souvent le matériau déjà posé sur le board.
   */
  private _drawMaterial(card: Card): Card | null {
    const ids = this._drawableMaterialIds(card);
    if (!ids.length) return null;
    const missing = ids.filter(id => !this._ownsMaterial(id));
    const pool = missing.length ? missing : ids;
    const matId = pool[Math.floor(this._rand() * pool.length)];
    return this._pickFrom(this._materialBearers(matId));
  }

  /**
   * Les cartes de la main qu'une magie de main peut réellement servir, par
   * INDEX dans `session.hand` — le pendant exact de `magieUnitTargets` côté
   * board, et il a la même raison d'être : `shift_tier_card` sur une carte dont
   * le tier voisin est absent du deck, ou `draw_material` sur une carte sans
   * matériel, sont des taps qui consommeraient la magie pour rien.
   *
   * Les trois autres magies de main acceptent n'importe quelle carte — y
   * compris une carte injouable, qui est même souvent celle qu'on veut envoyer
   * au cimetière ou brûler.
   */
  magieHandTargets(magie: Magie): number[] {
    const type = magie.effect?.type;
    const ok = type === 'shift_tier_card'
      ? (card: Card) => this._tierShiftPool(card.tier, tierShift(magie as any)).length > 0
      : type === 'draw_material'
        ? (card: Card) => this._drawableMaterialIds(card).length > 0
        : () => true;
    const targets: number[] = [];
    this.hand.forEach((card, i) => { if (ok(card)) targets.push(i); });
    return targets;
  }

  magieUnitTargets(magie: Magie): Unit[] {
    if (magie.effect?.type === 'defuse_fusion') return this._defusableFusions();
    // Accélérer le pouvoir d'une unité qui n'en a pas ne ferait rien : elle
    // n'est pas une cible, exactement comme une non-fusion pour `defuse_fusion`.
    if (magie.effect?.type === 'power_cooldown') return this._poweredUnits();
    if (magie.effect?.type === 'duplicate_unit') return this._duplicableUnits();
    if (magie.effect?.type === 'shift_tier_unit') return this._tierShiftUnits(tierShift(magie as any));
    return this.getPlayerUnits();
  }

  applyMagieOnUnit(magie: Magie, unit: Unit): void {
    if (!this.canAffordMagie(magie)) return;
    // ⚠️ La duplication passe AVANT le paiement : elle résout sa carte
    // elle-même et n'encaisse le contrecoup que si la copie part vraiment
    // (cf. `_duplicateFromUnit`).
    if (magie.effect?.type === 'duplicate_unit') { this._duplicateFromUnit(magie, unit); return; }
    // ⚠️ Le remplacement par tier passe lui aussi AVANT le paiement, et pour la
    // même raison : il peut ne rien trouver à poser.
    if (magie.effect?.type === 'shift_tier_unit') { this._shiftTierUnit(magie, unit); return; }
    this._payMagieCost(magie);
    if (magie.effect?.type === 'defuse_fusion') { this._defuseFusion(unit); return; }
    if (magie.effect?.type === 'destroy_unit') { this._destroyUnit(unit); return; }
    if (magie.effect?.type === 'drain_life') { this._drainLife(unit); return; }
    applyMagieEffect(magie as any, { gameState: this.gameState, targetUnit: unit });
  }

  /**
   * Duplication d'unité — **le même geste depuis le board et depuis le
   * cimetière**, d'où une seule méthode : c'est la CARTE qui revient en main,
   * jamais l'unité, et l'endroit où elle se trouvait n'y change rien.
   *
   * Rien de ce que l'unité a acquis ne voyage — bonus de Shopping
   * (`_shopping_bonus`), vétérance, PV courants, bouclier, pouvoir posé par
   * `grant_power` : la copie est l'entrée du catalogue, telle qu'une pioche la
   * rendrait. C'est ce qui distingue une duplication d'un clonage, et ce qui
   * empêche la magie de blanchir un investissement en le rendant deux fois.
   *
   * ⚠️ Conséquence assumée de la RÈGLE DU DOUBLON, et **seulement depuis le
   * board** : tant que l'original vit, la copie n'est invocable qu'en désignant
   * ce doublon comme matériau (sacrifice, fusion, héritage, transformation) —
   * une invocation normale la refuse, et la main l'affiche grisée. Une unité du
   * CIMETIÈRE n'est pas vivante : sa copie est jouable tout de suite, ce qui
   * fait des deux provenances deux magies au tempo opposé — un remplaçant mis
   * de côté d'un côté, une seconde chance immédiate de l'autre.
   *
   * ⚠️ La carte est résolue AVANT le paiement : un contrecoup prélevé pour une
   * copie qui n'arrive jamais serait pire qu'un refus. Le filtre d'offre rend
   * le cas inatteignable, cette garde est ce qui l'en empêche pour de bon.
   */
  private _duplicateFromUnit(magie: Magie, unit: Unit): void {
    const card = this.deps.cardDb.getCard(unit.card_id);
    if (!card) return;
    this._payMagieCost(magie);
    this._pushHandCopies(card as Card, duplicateCopies(magie as any));
  }

  /**
   * ⚠️ Chaque copie est un OBJET NEUF, jamais la référence source partagée.
   * Deux cases de la main pointant sur le même objet seraient correctes
   * aujourd'hui — `startPreparation` REMPLACE une carte retouchée par une magie
   * de main (`this.hand[idx] = { ...this.hand[idx], … }`) au lieu de la muter,
   * et `canUndoPreparation` compare la main par RÉFÉRENCE — mais la copie ne
   * coûte rien et referme le cas par construction.
   *
   * La source est prise TELLE QU'ELLE EST, remises comprises
   * (`_original_sacrifice`, `_removed_materials`, `_free_transformation`) : le
   * joueur duplique la carte qu'il a sous les yeux, avec le coût que son
   * tooltip annonce. La copie rejoint donc le même groupe que l'originale dans
   * la main (badge ×N) — `GameController._groupHand` clé sur l'id ET le coût.
   */
  private _pushHandCopies(card: Card, copies: number): void {
    for (let i = 0; i < copies; i++) this.hand.push({ ...card });
  }

  /**
   * Remplacement d'une unité du terrain par une carte du tier voisin.
   *
   * ⚠️ C'est une SUBSTITUTION, pas une invocation ni une mort : l'unité
   * remplacée quitte la partie — elle ne passe pas par le cimetière, où elle
   * redeviendrait un matériau. Le joueur échange une unité contre une autre, il
   * n'en garde pas la dépouille ; sans ça la magie paierait deux fois.
   *
   * ⚠️ Et rien de ce que l'unité avait acquis ne survit — bonus de Shopping,
   * vétérance, PV courants, bouclier, pouvoir donné par magie : la nouvelle est
   * bâtie sur l'entrée du catalogue, exactement comme la copie que rend
   * `_duplicateFromUnit`. C'est ce qui empêche une chaîne d'ascensions de
   * capitaliser les investissements du round précédent.
   *
   * La CASE, elle, est conservée (`initial_position` comprise) : c'est le sens
   * même du mot « remplace », et le placement du joueur ne doit pas bouger sous
   * ses yeux. `Scene3D.refresh()` — un diff indexé par uid — despawn l'ancienne
   * et spawn la nouvelle sans une ligne de plus, `GameController` l'appelant
   * déjà après tout ciblage de magie.
   */
  private _shiftTierUnit(magie: Magie, unit: Unit): void {
    const card = this.deps.cardDb.getCard(unit.card_id);
    const replacement = this._pickFrom(this._boardTierShiftPool(card?.tier, tierShift(magie as any)));
    if (!replacement) return;
    this._payMagieCost(magie);
    const pos = { ...(unit.position as Position) };
    this.board.removeUnit(unit);
    const fresh = new Unit(replacement, 'player');
    fresh.initial_position = { ...pos };
    this.board.placeUnit(fresh, pos);
  }

  /**
   * Les magies qui désignent une carte de la MAIN. Elles partagent le geste
   * (taper une carte) et rien d'autre :
   *
   * - `duplicate_card` LAISSE la carte désignée et en ajoute une copie ;
   * - `shift_tier_card` la REMPLACE par une carte du deck au tier voisin ;
   * - `draw_material` la laisse et ajoute l'un de ses MATÉRIELS d'invocation ;
   * - `sacrifice_card_hp` la BRÛLE contre des PV joueur — elle ne va pas au
   *   cimetière, sinon elle ferait doublon avec `hand_to_graveyard` et rendrait
   *   le choix entre les deux sans objet ;
   * - `hand_to_graveyard` la RETIRE et l'envoie au cimetière sous forme d'unité
   *   neutralisée, où elle devient un matériau d'invocation (sacrifice /
   *   fusion / héritage / transformation) au même titre qu'une unité tombée au
   *   combat. Comme toute unité du cimetière, elle disparaît au lancement du
   *   combat si personne ne l'a consommée : la magie échange une carte contre
   *   un matériau, elle n'ajoute pas de corps sur le terrain.
   *
   * L'unité rendue est celle du cimetière ; les quatre autres n'en créent
   * aucune et rendent `null`.
   *
   * ⚠️ Les deux effets qui peuvent ne RIEN trouver résolvent AVANT de payer —
   * même règle que `_duplicateFromUnit` : un contrecoup prélevé pour une carte
   * qui n'arrive jamais serait pire qu'un refus. `magieHandTargets` rend le cas
   * inatteignable depuis l'écran ; ces gardes sont ce qui l'en empêchent pour
   * de bon.
   */
  applyMagieOnHandCard(magie: Magie, handIdx: number): Unit | null {
    const card = this.hand[handIdx];
    if (!card) return null;
    if (!this.canAffordMagie(magie)) return null;
    const type = magie.effect?.type;

    if (type === 'shift_tier_card') {
      const replacement = this._pickFrom(this._tierShiftPool(card.tier, tierShift(magie as any)));
      if (!replacement) return null;
      this._payMagieCost(magie);
      // La case est écrasée, jamais mutée : `canUndoPreparation` compare la main
      // par RÉFÉRENCE, et `_capturePreparation` en garde une copie plate.
      this.hand[handIdx] = replacement;
      return null;
    }
    if (type === 'draw_material') {
      const material = this._drawMaterial(card);
      if (!material) return null;
      this._payMagieCost(magie);
      this.hand.push(material);
      return null;
    }

    this._payMagieCost(magie);
    if (type === 'duplicate_card') {
      this._pushHandCopies(card, duplicateCopies(magie as any));
      return null;
    }
    if (type === 'sacrifice_card_hp') {
      this.hand.splice(handIdx, 1);
      // Les PV de la CARTE (`stats.hp`), pas ceux d'une unité : rien n'a encore
      // été posé, il n'y a pas de PV courants à lire. Plafonné comme
      // `player_hp_bonus` et `drain_life`, dont c'est le troisième jumeau — la
      // seule source de PV joueur qui se paie en cartes plutôt qu'en unités.
      const gained = Math.max(0, Math.round((card.stats?.hp ?? 0) * sacrificeHpPercent(magie as any) / 100));
      this.gameState.player_hp = Math.min(this.gameState.player_hp + gained, PLAYER_HP_CAP);
      return null;
    }

    this.hand.splice(handIdx, 1);
    const unit = new Unit(card, 'player');
    unit.is_neutralized = true;
    this.graveyard.push(unit);
    return unit;
  }

  /**
   * Les deux magies qui désignent une unité du CIMETIÈRE, et elles n'en font
   * pas le même usage :
   *
   * - `duplicate_graveyard_unit` la LAISSE où elle est et rend sa carte en
   *   main — le corps reste donc disponible comme matériau d'invocation ;
   * - `revive` la SORT du cimetière et la repose sur le terrain.
   */
  applyMagieOnGraveyardUnit(magie: Magie, unit: Unit): void {
    if (!this.canAffordMagie(magie)) return;
    if (magie.effect?.type === 'duplicate_graveyard_unit') { this._duplicateFromUnit(magie, unit); return; }
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

  /** Avance au tour suivant et lance la préparation. Rend le résumé de pioche du
   *  nouveau tour, ou `null` si la partie est finie — il n'y a alors rien à
   *  annoncer. */
  startNextRound(): DrawSummary | null {
    this.gameState.nextRound();
    if (this.gameState.phase === Phase.GAME_OVER) return null;
    return this.startPreparation();
  }
}

export { Phase };
export { tiersForRound };
