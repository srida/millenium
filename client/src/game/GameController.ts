/* eslint-disable @typescript-eslint/no-explicit-any */
// GameController — glue applicative entre GameSession (logique pure), Scene3D
// (rendu Three) et les stores Zustand. C'est ici que vit l'état d'interaction
// (carte/matériaux/case sélectionnés) et l'orchestration des highlights + du
// combat animé. Ne fait PARTIE ni de logic/ ni de three/ : couche app autorisée
// à dépendre des deux + des stores.
import { GameSession, Phase } from '../logic/GameSession.js';
import { matchesMaterial } from '../logic/InvocationManager.js';
import { CombatAnimator3D } from '../three/CombatAnimator3D.js';
import type { Scene3D } from '../three/Scene3D.js';
import type { Card, Position, Magie } from '../logic/types.js';
import type { Unit } from '../logic/Unit.js';
import { useGameStore, type GameSnapshot } from '../stores/gameStore.js';
import { useUiStore, type TooltipAnchor } from '../stores/uiStore.js';

interface SummonOptionMenu {
  card: Card;
  options: { index: number; summon_type: string; label: string; ok: boolean }[];
}

const SUMMON_LABELS: Record<string, string> = {
  normal: 'Normal', sacrifice: 'Sacrifice', fusion: 'Fusion',
  heritage: 'Héritage', transformation: 'Transformation',
};

export class GameController {
  session: GameSession;
  scene: Scene3D | null = null;
  animator: CombatAnimator3D | null = null;

  // État d'interaction (préparation)
  private selectedCard: Card | null = null;        // carte effective (option résolue)
  private selectedHandIdx: number | null = null;   // index dans session.hand
  private selectedMaterials: Unit[] = [];
  private selectedBoardPos: Position | null = null;
  private summonOptions: SummonOptionMenu | null = null;

  combatSpeed = 2;
  private paused = false;
  private _errorTimer: ReturnType<typeof setTimeout> | null = null;
  private _combatRemaining = 60;

  constructor(session: GameSession) {
    this.session = session;
  }

  attachScene(scene: Scene3D): void {
    this.scene = scene;
    scene.setBoard(this.session.board);
    scene.refresh();
    this._applyHighlights();
  }

  // ── Cycle de partie ──────────────────────────────────────────────────────

  begin(): void {
    this.session.startPreparation();
    this._clearSelection();
    this.scene?.refresh();
    this.sync();
  }

  // ── Sélection de carte en main ──────────────────────────────────────────

  selectCard(card: Card | null, handIdx: number | null): void {
    this._closeSummonMenu();
    this.selectedMaterials = [];
    this.selectedBoardPos = null;
    this.scene?.setSelectedPos(null);

    if (card && (card.summon_options?.length ?? 0) > 0) {
      const statuses = this.session.summonOptionsStatus(card) || [];
      const playable = statuses.filter((s: any) => s.ok);
      if (playable.length > 1) {
        this.selectedCard = null;
        this.selectedHandIdx = handIdx;
        this.scene?.clearHighlight();
        this.scene?.clearMaterialHighlight();
        this.summonOptions = {
          card,
          options: statuses.map((s: any) => ({
            index: s.index, summon_type: s.summon_type,
            label: SUMMON_LABELS[s.summon_type] ?? s.summon_type, ok: s.ok,
          })),
        };
        this.sync();
        return;
      }
      const chosen = playable[0] ?? statuses[0];
      card = chosen ? this._effectiveCard(card, chosen.index) : card;
    }

    this.selectedCard = card;
    this.selectedHandIdx = handIdx;
    this._applyHighlights();
    this.sync();
  }

  chooseSummonOption(index: number): void {
    if (!this.summonOptions) return;
    const card = this._effectiveCard(this.summonOptions.card, index);
    this._closeSummonMenu();
    this.selectedCard = card;
    this._applyHighlights();
    this.sync();
  }

  cancelSelection(): void {
    this._clearSelection();
    this.sync();
  }

  private _effectiveCard(card: Card, idx: number): Card {
    const opt = (card.summon_options as any)[idx];
    const rest: any = { ...(card as any) };
    delete rest.summon_options;
    return { ...rest, summon_type: opt.summon_type, cost: opt.cost };
  }

  // ── Interactions board (callbacks Scene3D) ──────────────────────────────

  onCellTap = (pos: Position): void => {
    if (this.summonOptions) return;
    useUiStore.getState().hideTooltip();
    if (this.selectedCard) {
      if (this.session.needsMaterials(this.selectedCard) && !this.session.materialsComplete(this.selectedCard, this.selectedMaterials)) {
        this._flashError("Sélectionne les matériaux d'abord");
        return;
      }
      this._tryPlace(this.selectedCard, pos);
    } else if (this.selectedBoardPos) {
      this._tryMove(pos);
    }
  };

  onUnitTap = (unit: Unit, pos: Position, rect: TooltipAnchor): void => {
    if (this.summonOptions) return;
    // Mode ciblage d'une magie (Phase Shopping)
    if (this._pendingMagie && this.session.magieNeedsUnitTarget(this._pendingMagie)) {
      if (unit.side === 'player') this.resolveMagieUnitTarget(unit);
      return;
    }
    if (this.session.phase !== Phase.PREPARATION) {
      useUiStore.getState().showTooltip({ kind: 'unit', unit }, rect);
      return;
    }
    useUiStore.getState().hideTooltip();
    if (unit.side !== 'player') return;

    // Mode sélection de matériaux
    if (this.selectedCard && this.session.needsMaterials(this.selectedCard)) {
      const idx = this.selectedMaterials.indexOf(unit);
      if (idx !== -1) {
        this.selectedMaterials.splice(idx, 1);
      } else {
        const candidates = this.session.materialCandidateCells(this.selectedCard, this.selectedMaterials);
        if (candidates.some(p => p.col === pos.col && p.row === pos.row)) this.selectedMaterials.push(unit);
      }
      this._applyHighlights();
      this.sync();
      return;
    }

    // Transformation : taper l'unité cible déclenche l'invocation
    if (this.selectedCard && this.selectedCard.summon_type === 'transformation' && !this.selectedCard._free_transformation) {
      const targetId = this.selectedCard.cost?.materials?.[0];
      if (targetId && matchesMaterial(unit, targetId) && unit.isAlive()) {
        this.selectedMaterials = [unit];
        this._tryPlace(this.selectedCard, pos);
      }
      return;
    }

    // Désélectionne la carte en main (carte sans matériaux)
    if (this.selectedCard) {
      this._clearSelection();
      this.sync();
      return;
    }

    // Bascule la sélection de repositionnement
    if (this.selectedBoardPos?.col === pos.col && this.selectedBoardPos?.row === pos.row) {
      this.selectedBoardPos = null;
      this.scene?.setSelectedPos(null);
      this.scene?.clearHighlight();
      return;
    }
    this.selectedBoardPos = pos;
    this.scene?.setSelectedPos(pos);
    const empty: Position[] = [];
    for (let r = 0; r <= 3; r++) for (let c = 0; c < 5; c++)
      if (!this.session.board.isOccupied({ col: c, row: r })) empty.push({ col: c, row: r });
    this.scene?.setHighlight(empty);
  };

  onUnitDrag = (unit: Unit, from: Position, to: Position): void => {
    if (this.session.phase !== Phase.PREPARATION) return;
    if (to.col === from.col && to.row === from.row) return;
    if (!this.session.reposition(unit, to)) {
      this.scene?.animateUnitMove(unit.uid, from, 0.15);
      return;
    }
    this._clearSelection();
    this.scene?.refresh();
    this.sync();
  };

  onUnitLongPress = (unit: Unit, _pos: Position, rect: TooltipAnchor): void => {
    useUiStore.getState().showTooltip({ kind: 'unit', unit }, rect);
  };

  // Tap sur une unité du cimetière (matériau) — appelé depuis GraveyardTray React.
  tapGraveyardUnit(unit: Unit): void {
    useUiStore.getState().hideTooltip();
    if (this.session.phase === Phase.PREPARATION && this.selectedCard && this.session.needsMaterials(this.selectedCard)) {
      const candidates = this.session.materialCandidateGraveyard(this.selectedCard, this.selectedMaterials);
      const idx = this.selectedMaterials.indexOf(unit);
      if (idx !== -1) this.selectedMaterials.splice(idx, 1);
      else if (candidates.includes(unit)) this.selectedMaterials.push(unit);
      this._applyHighlights();
      this.sync();
    }
  }

  private _tryPlace(card: Card, pos: Position): void {
    const result = this.session.canSummon(card, pos, this.selectedMaterials) as any;
    if (!result.ok) { this._flashError(result.reason); return; }
    if (this.session.exceedsBoardSlots(card, this.selectedMaterials)) {
      this._flashError(`Maximum ${this.session.gameState.player_board_slots} unités sur le terrain`);
      return;
    }
    this.session.place(card, pos, this.selectedMaterials, this.selectedHandIdx);
    this._clearSelection();
    this.scene?.refresh();
    this.sync();
  }

  private _tryMove(to: Position): void {
    if (!this.selectedBoardPos) return;
    if (this.session.board.isOccupied(to)) { this._flashError('Case occupée'); return; }
    if (!this.session.board.isPlayerCell(to)) return;
    const unit = this.session.board.getUnit(this.selectedBoardPos);
    if (!unit) { this.selectedBoardPos = null; this.scene?.clearHighlight(); return; }
    this.session.board.moveUnit(unit, to);
    unit.initial_position = { ...to };
    this.selectedBoardPos = null;
    this.scene?.setSelectedPos(null);
    this.scene?.clearHighlight();
    this.scene?.refresh();
    this.sync();
  }

  // ── Combat ───────────────────────────────────────────────────────────────

  startCombat(): void {
    if (this.session.phase !== Phase.PREPARATION) return;
    this._clearSelection();
    const { combat, boardData } = this.session.startCombat();
    this.scene?.enterCombatMode();
    this._combatRemaining = 60;

    const animator = new CombatAnimator3D(combat, this.scene as any, {
      onStep: () => {
        this._combatRemaining = Math.ceil(60 * combat.remainingTicks() / 333);
        this.sync({ combatActive: true, combatRemaining: this._combatRemaining });
      },
      onFinished: () => this._onCombatFinished(),
    });
    animator.setSpeed(this.combatSpeed);
    this.animator = animator;
    this.paused = false;
    this.sync({ combatActive: true, boardTerrain: boardData });
    animator.start();
  }

  setSpeed(s: number): void {
    this.combatSpeed = s;
    this.animator?.setSpeed(s);
    this.sync();
  }

  togglePause(): void {
    if (!this.animator) return;
    if (this.paused) { this.animator.resume(); this.paused = false; }
    else { this.animator.pause(); this.paused = true; }
    this.sync();
  }

  private _onCombatFinished(): void {
    const result = this.session.finishCombat();
    this.animator = null;
    this.scene?.exitCombatMode();
    this.sync({ combatActive: false, boardTerrain: null, endRound: result });
  }

  // ── Fin de round → Shopping (Phase 4) ou tour suivant ────────────────────

  dismissEndRound(): void {
    if (this.session.isGameOver()) {
      this.sync({ endRound: null, gameOver: true, winner: this.session.getWinner() });
      return;
    }
    this._startShopping();
  }

  private _startShopping(): void {
    const magies = this.session.getShoppingMagies();
    if (!magies.length) { this._proceedNextRound(); return; }
    this.sync({ endRound: null, shopping: { magies, awaitingTarget: null, banner: null } });
  }

  chooseMagie(magie: Magie): void {
    if (this.session.magieNeedsUnitTarget(magie)) {
      const targets = this.session.magieUnitTargets(magie);
      if (!targets.length) { this._proceedNextRound(); return; }
      this.scene?.setHighlight(targets.map(u => u.position!).filter(Boolean));
      this._pendingMagie = magie;
      this.sync({ shopping: { magies: [], awaitingTarget: 'unit', banner: `${magie.name} — touche une unité de ton terrain` } });
    } else if (this.session.magieNeedsGraveyardTarget(magie)) {
      if (!this.session.graveyard.length) { this._proceedNextRound(); return; }
      this._pendingMagie = magie;
      this.sync({ shopping: { magies: [], awaitingTarget: 'graveyard', banner: `${magie.name} — touche une unité du cimetière` } });
    } else {
      this.session.applyGlobalMagie(magie);
      this._proceedNextRound();
    }
  }

  skipShopping(): void {
    this._proceedNextRound();
  }

  private _pendingMagie: Magie | null = null;

  // Ciblage magie sur unité board — réutilise onUnitTap via un mode dédié.
  resolveMagieUnitTarget(unit: Unit): void {
    if (!this._pendingMagie) return;
    const targets = this.session.magieUnitTargets(this._pendingMagie);
    if (!targets.includes(unit)) return;
    const magie = this._pendingMagie;
    this._pendingMagie = null;
    this.scene?.clearHighlight();
    this.session.applyMagieOnUnit(magie, unit);
    this.scene?.refresh();
    this._proceedNextRound();
  }

  resolveMagieGraveyardTarget(unit: Unit): void {
    if (!this._pendingMagie) return;
    if (!this.session.graveyard.includes(unit)) return;
    const magie = this._pendingMagie;
    this._pendingMagie = null;
    this.session.applyMagieOnGraveyardUnit(magie, unit);
    this.scene?.refresh();
    this._proceedNextRound();
  }

  get awaitingMagieTarget(): 'unit' | 'graveyard' | null {
    return this._pendingMagie ? (this.session.magieNeedsGraveyardTarget(this._pendingMagie) ? 'graveyard' : 'unit') : null;
  }

  private _proceedNextRound(): void {
    this.session.startNextRound();
    this._clearSelection();
    if (this.session.phase === Phase.GAME_OVER) {
      this.sync({ shopping: null, endRound: null, gameOver: true, winner: this.session.getWinner() });
      return;
    }
    this.scene?.refresh();
    this.sync({ shopping: null, endRound: null });
  }

  // ── Timer de préparation (piloté par GameScreen) ─────────────────────────

  onPrepTimeout(): void {
    if (this.session.phase === Phase.PREPARATION) this.startCombat();
  }

  // ── Highlights & snapshot ────────────────────────────────────────────────

  private _applyHighlights(): void {
    const scene = this.scene;
    if (!scene) return;
    if (!this.selectedCard) {
      scene.clearHighlight();
      scene.clearMaterialHighlight();
      return;
    }
    scene.setHighlight(this.session.validCells(this.selectedCard, this.selectedMaterials));
    scene.setMaterialCandidates([
      ...this.session.materialCandidateCells(this.selectedCard, this.selectedMaterials),
      ...this.session.transformTargetCells(this.selectedCard),
    ]);
    const complete = this.session.materialsComplete(this.selectedCard, this.selectedMaterials);
    scene.setMaterialSelected(
      this.selectedMaterials.filter(u => !this.session.graveyard.includes(u)).map(u => ({ ...(u.position as Position) })),
      complete,
    );
  }

  private _clearSelection(): void {
    this.selectedCard = null;
    this.selectedHandIdx = null;
    this.selectedMaterials = [];
    this.selectedBoardPos = null;
    this._closeSummonMenu();
    this.scene?.clearHighlight();
    this.scene?.clearMaterialHighlight();
    this.scene?.setSelectedPos(null);
  }

  private _closeSummonMenu(): void {
    this.summonOptions = null;
  }

  private _flashError(msg: string): void {
    this.sync({ errorFlash: msg });
    if (this._errorTimer) clearTimeout(this._errorTimer);
    this._errorTimer = setTimeout(() => this.sync({ errorFlash: null }), 2000);
  }

  // Recalcule l'instantané React depuis session + état de sélection.
  sync(extra: Partial<GameSnapshot> = {}): void {
    const gs = this.session.gameState;
    const selKey = this.selectedHandIdx != null ? `h${this.selectedHandIdx}` : null;

    const hand = this.session.hand.map((card, i) => ({
      key: `h${i}`,
      card,
      playable: this.session.isPlayable(card),
      selected: selKey === `h${i}`,
    }));

    const matSet = new Set(this.selectedMaterials);
    const gcandidates = this.selectedCard
      ? new Set(this.session.materialCandidateGraveyard(this.selectedCard, this.selectedMaterials))
      : new Set<Unit>();
    const graveyard = this.session.graveyard.map(unit => ({
      uid: unit.uid, unit,
      candidate: gcandidates.has(unit),
      selected: matSet.has(unit),
    }));

    const synergies = this.session.getSynergies().map((s: any) => ({
      attr: { id: s.attr.id, name: s.attr.name, icon: s.attr.icon },
      count: s.count,
      activeThreshold: s.activeThreshold,
      nextThreshold: s.nextThreshold,
    }));

    let invocationBanner: string | null = null;
    if (this.selectedCard && this.session.needsMaterials(this.selectedCard) && !this.session.materialsComplete(this.selectedCard, this.selectedMaterials)) {
      invocationBanner = 'Sélectionne les matériaux d\'invocation';
    }

    const snapshot: Partial<GameSnapshot> = {
      round: gs.round,
      phase: gs.phase,
      playerHp: gs.player_hp,
      enemyHp: gs.enemy_hp,
      playerMultiplier: gs.player_multiplier,
      enemyMultiplier: gs.enemy_multiplier,
      boardSlots: gs.player_board_slots,
      placedCount: this.session.getPlayerUnits().length,
      hand,
      graveyard,
      synergies,
      invocationBanner,
      speed: this.combatSpeed,
      paused: this.paused,
      summonOptions: this.summonOptions,
      ...extra,
    } as any;

    useGameStore.getState().applySnapshot(snapshot);
  }

  dispose(): void {
    if (this._errorTimer) clearTimeout(this._errorTimer);
    this.animator?.stop();
    this.animator = null;
  }
}
