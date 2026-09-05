/* eslint-disable @typescript-eslint/no-explicit-any */
// GameController — glue applicative entre GameSession (logique pure), Scene3D
// (rendu Three) et les stores Zustand. C'est ici que vit l'état d'interaction
// (carte/matériaux/case sélectionnés) et l'orchestration des highlights + du
// combat animé. Ne fait PARTIE ni de logic/ ni de three/ : couche app autorisée
// à dépendre des deux + des stores.
import { GameSession, Phase } from '../logic/GameSession.js';
import { boardEffects, effectTargets } from '../logic/BoardEffect.js';
import { primaryTier } from '../logic/Tiers.js';
import { boardTargetsUnits } from '../data/BoardInfo.js';
import { CombatAnimator3D } from '../three/CombatAnimator3D.js';
import type { Scene3D } from '../three/Scene3D.js';
import type { Card, DrawSummary, Position, Magie, SummonCondition } from '../logic/types.js';
import type { Unit } from '../logic/Unit.js';
import { useGameStore, type GameSnapshot, type HandEntry } from '../stores/gameStore.js';
import { useUiStore, type TooltipAnchor } from '../stores/uiStore.js';
import { useMissionStore } from '../stores/missionStore.js';
import * as CardArt from '../data/CardArt.js';
import { PREP_DURATION_S, COMBAT_DURATION_S, combatSecondsLeft, TERRAIN_ALERT_MS, ROUND_INTRO_MS } from './timings.js';
import { CombatRecorder } from './CombatRecorder.js';

/**
 * Le menu de choix d'une carte à plusieurs conditions. Il ne porte plus de
 * LIBELLÉ : une condition se dit par son coût (« 3 matériels, dont X »), que
 * l'UI compose depuis la donnée. La table des cinq voies vivait ici.
 */
interface SummonConditionMenu {
  card: Card;
  options: { index: number; condition: SummonCondition; ok: boolean; reason?: string }[];
}

export class GameController {
  session: GameSession;
  scene: Scene3D | null = null;
  animator: CombatAnimator3D | null = null;

  // Enregistreur de combat par tick — OUTIL DE DIAGNOSTIC TEMPORAIRE, alimenté
  // par le crochet `onStep` qui existait déjà. Reste `null` partout sauf en
  // duel PvP réel : c'est `PvpController` qui en fabrique un (cf. _newRecorder).
  protected _recorder: CombatRecorder | null = null;

  // État d'interaction (préparation)
  private selectedCard: Card | null = null;        // la carte telle quelle
  /** La condition retenue quand la carte en a plusieurs ; `null` sinon.
   *  ⚠️ La carte n'est PLUS aplatie : elle voyage intacte et c'est cet index
   *  qui dit par quelle voie on la joue. Reconstruire une carte « résolue »
   *  fabriquait un objet que la main ne contenait pas, et dont la lignée
   *  d'origine était perdue pour tout ce qui la relisait ensuite. */
  private selectedConditionIndex: number | null = null;
  private selectedHandIdx: number | null = null;   // index dans session.hand
  private selectedMaterials: Unit[] = [];
  private selectedBoardPos: Position | null = null;
  private summonOptions: SummonConditionMenu | null = null;

  // « Tout annuler » — deux repères indexés sur `session.prepId`, qui change de
  // lui-même à chaque ouverture de tour : aucun des deux n'a donc de remise à
  // zéro à faire (et donc aucune à oublier au prochain mode de jeu ajouté).
  //  · _committedPrepId : le tour dont le board est déjà engagé (PRÊT tapé).
  //    En PvP la phase reste PREPARATION pendant toute la poignée de main.
  //  · _eventMark / _markPrepId : longueur de la file d'événements de missions
  //    avant la PREMIÈRE invocation du tour courant.
  protected _committedPrepId: number | null = null;
  private _markPrepId: number | null = null;
  private _eventMark = 0;

  combatSpeed = 2;
  protected paused = false;
  private _errorTimer: ReturnType<typeof setTimeout> | null = null;
  private _revealTimer: ReturnType<typeof setTimeout> | null = null;
  /** L'annonce de changement de tour, et la pioche qu'elle précède. Même patron
   *  que `_pendingCombatStart` : un CHAMP, pour que le tap et le minuteur
   *  ouvrent la même popup une seule fois. */
  private _introTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingDraw: DrawSummary | null = null;
  /** Le départ du combat, tant qu'il est retenu par la cascade et/ou l'annonce
   *  de terrain. C'est un CHAMP et non une closure locale parce qu'un tap du
   *  joueur doit pouvoir déclencher le même départ que le minuteur — et une
   *  seule fois : il se remet à `null` en partant, donc un double tap ne lance
   *  pas deux combats. */
  private _pendingCombatStart: (() => void) | null = null;
  /** Instant au plus tôt où le combat peut partir : la cascade d'arrivée de
   *  l'IA doit être terminée, même si le joueur passe l'annonce d'un tap. */
  private _combatStartAt = 0;
  protected _combatRemaining = COMBAT_DURATION_S;

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
    const draw = this.session.startPreparation();
    this._clearSelection();
    // Ouvre la file d'événements de missions : elle est vidée en fin de partie
    // (ou au démontage), un lot = une partie. Cf. stores/missionStore.
    useMissionStore.getState().startMatch();
    this._matchReported = false;
    this.scene?.refresh();
    this.sync(this._freshPhaseClocks());
    this._openRound(draw);
  }

  /**
   * Les deux beats d'ouverture d'un tour : l'annonce du changement de tour,
   * puis la popup de pioche.
   *
   * ⚠️ UN SEUL minuteur, et il vit ici — pas dans le composant. C'est la règle
   * de `TerrainAlert` : la couche React n'a que des états à rendre, le
   * contrôleur possède l'horloge. Le champ (et non une closure) permet au tap
   * de sauter l'annonce en déclenchant EXACTEMENT le même passage, une fois.
   *
   * ⚠️ Appelé à toutes les ouvertures de tour — `begin()` comme
   * `_proceedNextRound()` — et par les deux contrôleurs : `PvpController`
   * hérite de celui-ci et ne redéfinit ni l'un ni l'autre. Une popup posée sur
   * un seul des deux chemins manquerait un round sur cinq.
   */
  protected _openRound(draw: DrawSummary | null): void {
    if (this._introTimer) { clearTimeout(this._introTimer); this._introTimer = null; }
    if (!draw) return;                       // partie finie : rien à ouvrir
    this._pendingDraw = draw;
    this.sync({ roundIntro: { round: draw.round }, drawPopup: null });
    this._introTimer = setTimeout(() => this._openDrawPopup(), ROUND_INTRO_MS);
  }

  /** Passe l'annonce de tour d'un tap — le minuteur et le tap ouvrent la MÊME
   *  popup, une seule fois (le champ se vide en partant). */
  dismissRoundIntro(): void {
    if (!this._pendingDraw) return;
    this._openDrawPopup();
  }

  private _openDrawPopup(): void {
    if (this._introTimer) { clearTimeout(this._introTimer); this._introTimer = null; }
    const draw = this._pendingDraw;
    if (!draw) return;
    this._pendingDraw = null;
    this.sync({ roundIntro: null, drawPopup: draw });
  }

  /** Le tap sur le dos de carte : la main est déjà là, on lève le voile. */
  dismissDrawPopup(): void {
    if (!useGameStore.getState().drawPopup) return;
    this.sync({ drawPopup: null });
  }

  // Chronos remis à neuf en même temps que la phase de préparation : le
  // décompte lui-même vit dans React, mais la valeur affichée doit être juste
  // dès le premier rendu du nouveau round (sinon le HUD montre brièvement le
  // reliquat du round précédent — « Fin prépa 0:00 »).
  protected _freshPhaseClocks(): Partial<GameSnapshot> {
    this._combatRemaining = COMBAT_DURATION_S;
    return { prepRemaining: PREP_DURATION_S, combatRemaining: COMBAT_DURATION_S };
  }

  // ── Sélection de carte en main ──────────────────────────────────────────

  selectCard(card: Card | null, handIdx: number | null): void {
    this._closeSummonMenu();
    this.selectedMaterials = [];
    this.selectedBoardPos = null;
    this.scene?.setSelectedPos(null);

    this.selectedConditionIndex = null;

    if (card) {
      const statuses = this.session.summonConditionsStatus(card) || [];
      const playable = statuses.filter((s: any) => s.ok);
      if (statuses.length > 0 && playable.length > 1) {
        this.selectedCard = null;
        this.selectedHandIdx = handIdx;
        this.scene?.clearHighlight();
        this.scene?.clearMaterialHighlight();
        this.summonOptions = {
          card,
          options: statuses.map((s: any) => ({
            index: s.index, condition: s.condition, ok: s.ok, reason: s.reason,
          })),
        };
        this.sync();
        return;
      }
      // Une seule voie jouable (ou aucune) : elle est retenue d'office.
      if (statuses.length > 0) this.selectedConditionIndex = (playable[0] ?? statuses[0]).index;
    }

    this.selectedCard = card;
    this.selectedHandIdx = handIdx;
    this._applyHighlights();
    this.sync();
  }

  chooseSummonOption(index: number): void {
    if (!this.summonOptions) return;
    const card = this.summonOptions.card;
    this._closeSummonMenu();
    this.selectedCard = card;
    this.selectedConditionIndex = index;
    this._applyHighlights();
    this.sync();
  }

  /**
   * ⚠️ RIEN n'est pré-sélectionné à la sélection d'une carte, et c'est la règle :
   * le liseré BLANC dit « matériau retenu » (`board3d.css`), donc le poser avant
   * que le joueur n'ait désigné quoi que ce soit annonce une dépense qu'il n'a
   * pas consentie — et pire, son premier tap sur la cible la DÉSÉLECTIONNAIT
   * (`onUnitTap` bascule).
   *
   * Le geste en UN TAP de l'ancienne Transformation n'en a pas besoin : c'est
   * `onUnitTap` qui le porte, en posant directement dès que le tap COMPLÈTE la
   * sélection. Le joueur voit donc ses cibles en ORANGE (candidat), en tape une,
   * et l'unité est posée.
   */

  cancelSelection(): void {
    this._clearSelection();
    this.sync();
  }

  // ── Interactions board (callbacks Scene3D) ──────────────────────────────

  onCellTap = (pos: Position): void => {
    if (this.summonOptions) return;
    useUiStore.getState().hideTooltip();
    if (this.selectedCard) {
      if (this.session.needsMaterials(this.selectedCard, this.selectedConditionIndex)
          && !this.session.materialsComplete(this.selectedCard, this.selectedMaterials, this.selectedConditionIndex)) {
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
    if (this.selectedCard && this.session.needsMaterials(this.selectedCard, this.selectedConditionIndex)) {
      const card = this.selectedCard;
      const condIdx = this.selectedConditionIndex;
      const idx = this.selectedMaterials.indexOf(unit);
      if (idx !== -1) {
        this.selectedMaterials.splice(idx, 1);
      } else {
        const candidates = this.session.materialCandidateCells(card, this.selectedMaterials, condIdx);
        if (candidates.some(p => p.col === pos.col && p.row === pos.row)) {
          // ⚠️ Le tap qui COMPLÈTE la sélection pose directement, sans second
          // geste : sur une condition à un matériel, la case du matériel EST
          // celle du résultat, il n'y a donc rien à désigner ensuite. C'était le
          // geste écrit en dur pour la Transformation ; il vaut maintenant pour
          // toute condition qui se solde d'une seule unité.
          const mats = [...this.selectedMaterials, unit];
          if (this.session.materialsComplete(card, mats, condIdx)
              && this.session.canSummon(card, pos, mats, condIdx).ok) {
            this.selectedMaterials = mats;
            this._tryPlace(card, pos);
            return;
          }
          this.selectedMaterials.push(unit);
        }
      }
      this._applyHighlights();
      this.sync();
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
    if (this.session.phase === Phase.PREPARATION && this.selectedCard && this.session.needsMaterials(this.selectedCard, this.selectedConditionIndex)) {
      const candidates = this.session.materialCandidateGraveyard(this.selectedCard, this.selectedMaterials, this.selectedConditionIndex);
      const idx = this.selectedMaterials.indexOf(unit);
      if (idx !== -1) this.selectedMaterials.splice(idx, 1);
      else if (candidates.includes(unit)) this.selectedMaterials.push(unit);
      this._applyHighlights();
      this.sync();
    }
  }

  private _tryPlace(card: Card, pos: Position): void {
    const result = this.session.canSummon(card, pos, this.selectedMaterials, this.selectedConditionIndex) as any;
    if (!result.ok) { this._flashError(result.reason); return; }
    if (this.session.exceedsBoardSlots(card, this.selectedMaterials)) {
      this._flashError(`Maximum ${this.session.gameState.player_board_slots} unités sur le terrain`);
      return;
    }
    if (this._markPrepId !== this.session.prepId) {
      this._markPrepId = this.session.prepId;
      this._eventMark = useMissionStore.getState().eventMark();
    }
    this.session.place(card, pos, this.selectedMaterials, this.selectedHandIdx, this.selectedConditionIndex);
    // ⚠️ L'événement porte les ATTRIBUTS de la carte, plus une voie
    // d'invocation : les cinq voies sont devenues des attributs, et c'est sur
    // eux que les missions filtrent désormais.
    useMissionStore.getState().emit('summon_performed', {
      card_id: card.id, tier: primaryTier(card), attributes: card.attributes ?? [],
    });
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

  /**
   * « Tout annuler » — remet board, main et cimetière à l'ouverture du tour.
   * La règle vit dans `GameSession` ; ici on ne fait que défaire ce qui n'est
   * pas de son ressort : les événements de missions déjà mis en file, sans quoi
   * une boucle poser/annuler ferait avancer une mission d'invocation sans jouer.
   */
  undoPreparation(): void {
    if (this.session.phase !== Phase.PREPARATION) return;
    if (this._committedPrepId === this.session.prepId) return;   // board déjà annoncé (PvP)
    if (!this.session.undoPreparation()) return;
    if (this._markPrepId === this.session.prepId) {
      useMissionStore.getState().rollbackEvents(this._eventMark);
      this._markPrepId = null;
    }
    this._clearSelection();
    this.scene?.refresh();
    this.sync();
  }

  // ── Combat ───────────────────────────────────────────────────────────────

  startCombat(): void {
    if (this.session.phase !== Phase.PREPARATION) return;
    this._closeRoundOpening();
    this._committedPrepId = this.session.prepId;
    this._clearSelection();
    const { combat, boardData } = this.session.startCombat();
    this._beginCombatAnimation(combat, boardData);
  }

  /**
   * Le combat part : ni l'annonce de tour ni la popup de pioche n'ont plus lieu
   * d'être.
   *
   * ⚠️ Nécessaire même si la popup capte les taps : le chrono de préparation
   * peut tomber à 0 par-dessous (c'est le cas normal en PvP, où il ne gèle
   * pas), et l'overlay resterait alors posé sur tout le combat.
   */
  protected _closeRoundOpening(): void {
    if (this._introTimer) { clearTimeout(this._introTimer); this._introTimer = null; }
    this._pendingDraw = null;
    const s = useGameStore.getState();
    if (s.roundIntro || s.drawPopup) this.sync({ roundIntro: null, drawPopup: null });
  }

  // Lance l'animateur de combat sur un CombatManager déjà construit. Partagé
  // avec le mode PvP (qui appelle session.startCombat(agreedBoard) puis ceci).
  protected _beginCombatAnimation(combat: import('../logic/CombatManager.js').CombatManager, boardData: import('../logic/types.js').BoardDef | null): void {
    // Le terrain n'existait jusqu'ici que côté logique (Board._blockedCells) :
    // la scène doit l'afficher, sinon les unités contournent des cases qui ont
    // l'air libres.
    // ⚠️ Les cases du BOARD, pas celles de la définition de terrain : en duel
    // en ligne le rôle B applique les cases miroitées (`logic/BoardMirror`), et
    // peindre les rochers d'après `boardData` poserait le décor à côté des
    // obstacles que le pathfinding contourne réellement.
    this.scene?.setBlockedCells(this.session.board.blockedCells());
    this.scene?.setTerrainBackground(boardData ?? null);
    this.scene?.enterCombatMode();
    // L'IA place ses unités au moment du PRÊT : elles n'ont pas encore d'objet
    // de scène (refresh() ne passe plus en mode combat) — on les fait tomber en
    // cascade et on retarde le premier step d'autant, pour que le joueur voie
    // arriver l'adversaire avant le premier coup. 0 en PvP (board déjà rendu).
    const revealMs = this.scene?.revealEnemyUnits(this.session.enemyUnits) ?? 0;
    this._combatRemaining = COMBAT_DURATION_S;
    this._noteCombatStarted();
    this._recorder = this._newRecorder();
    // Même raison : le log doit porter le terrain TEL QU'IL EST JOUÉ. Le lire
    // sur `boardData` ferait ressortir en divergence tout terrain non
    // symétrique — c'est-à-dire la moitié du catalogue — alors que les deux
    // clients s'accordent désormais dessus.
    this._recorder?.header(combat, { ...boardData, blocked_cells: this.session.board.blockedCells() });
    const animator = new CombatAnimator3D(combat, this.scene as any, {
      onStep: (events: any[]) => {
        this._recorder?.capture(combat, events);
        this._noteCombatEvents(events);
        this._combatRemaining = combatSecondsLeft(combat.remainingTicks());
        this.sync({ combatActive: true, combatRemaining: this._combatRemaining });
      },
      onFinished: () => this._onCombatFinished(),
    });
    animator.setSpeed(this.combatSpeed);
    this.animator = animator;
    this.paused = false;
    // L'annonce du terrain : ce qui va peser sur ce combat, dit AVANT le premier
    // coup. Elle prolonge l'attente qui existait déjà pour la cascade au lieu de
    // s'en ajouter une seconde — deux minuteurs pour un même départ finiraient
    // par ne plus s'accorder. Les listes passées sont celles sur lesquelles
    // `startCombat` vient d'appliquer l'effet : unités vivantes, IA déjà placée.
    const terrainAlert = terrainAlertFor(boardData, this.session.getPlayerUnits(), this.session.enemyUnits);
    const holdMs = Math.max(revealMs, terrainAlert ? TERRAIN_ALERT_MS : 0);
    // combatRemaining doit repartir de 60 dès l'entrée en combat : sans ça le
    // HUD affiche la valeur finale du combat précédent jusqu'au premier tick.
    this.sync({ combatActive: true, combatRemaining: this._combatRemaining, boardTerrain: boardData, terrainAlert });
    // ⚠️ Le plancher est la CASCADE, pas l'annonce : un tap qui passe l'annonce
    // ne doit pas lancer le premier coup pendant que l'adversaire est encore en
    // l'air (`dismissTerrainAlert` réarme pour le reliquat).
    this._combatStartAt = Date.now() + revealMs;
    const begin = () => {
      this._revealTimer = null;
      this._pendingCombatStart = null;
      if (this.animator !== animator) return;   // combat quitté entre-temps
      this.sync({ terrainAlert: null });
      animator.start();
      if (this.paused) animator.pause();        // Pause tapée pendant l'attente
    };
    if (holdMs > 0) {
      this._pendingCombatStart = begin;
      this._revealTimer = setTimeout(begin, holdMs);
    } else {
      begin();
    }
  }

  /**
   * Passe l'annonce de terrain d'un tap. À 5 rounds par partie — et 4 duels
   * enchaînés en Arcade — une attente non passable devient vite une corvée.
   *
   * ⚠️ Ne peut PAS faire partir le combat avant la fin de la cascade d'arrivée
   * de l'IA : on réarme pour le reliquat plutôt que de démarrer sous des cartes
   * encore en train de tomber.
   */
  dismissTerrainAlert(): void {
    const begin = this._pendingCombatStart;
    if (!begin) return;                          // déjà parti — geste sans objet
    if (this._revealTimer) clearTimeout(this._revealTimer);
    const left = this._combatStartAt - Date.now();
    if (left > 0) {
      this.sync({ terrainAlert: null });          // l'annonce s'en va tout de suite
      this._revealTimer = setTimeout(begin, left);
      return;
    }
    this._revealTimer = null;
    begin();
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

  // ── Événements de missions ───────────────────────────────────────────────
  // Le contrôleur est la SEULE couche qui nomme ces événements : logic/ reste
  // headless et ignore tout des missions. Les montants et le catalogue vivent
  // côté serveur (missions.js) — ici on ne fait que décrire ce qui s'est passé.

  private _combatUnitCount = 0;
  protected _matchReported = false;

  private _noteCombatStarted(): void {
    const units = this.session.getPlayerUnits();
    const synergies = this.session.getSynergies() as any[];
    this._combatUnitCount = units.length;
    useMissionStore.getState().emitCombatStarted({
      unit_count: units.length,
      // Attributs dont un palier est ATTEINT (les autres ne sont que comptés).
      attribute_count: synergies.filter(s => s.activeThreshold != null).length,
      max_attribute_units: synergies.reduce((m, s) => Math.max(m, s.count ?? 0), 0),
    });
  }

  // Pouvoirs déclenchés par le camp du joueur, comptés sur le flux d'événements
  // du CombatManager — la seule source qui les voit tous.
  private _noteCombatEvents(events: any[]): void {
    if (!events?.length) return;
    const emit = useMissionStore.getState().emit;
    for (const e of events) {
      if (e?.type === 'power' && e.unit?.side === 'player') {
        emit('power_triggered', { power_id: e.power_id });
      }
    }
  }

  private _noteMagie(magie: Magie): void {
    useMissionStore.getState().emit('magic_selected', {
      magic_id: magie.id, effect_type: magie.effect?.type ?? null,
    });
  }

  /** Clôt le lot d'événements de la partie et l'envoie. Idempotent. */
  protected _reportMatchCompleted(): void {
    if (this._matchReported) return;
    this._matchReported = true;
    const winner = this.session.getWinner();
    useMissionStore.getState().emit('match_completed', {
      result: winner === 'player' ? 'win' : winner === 'enemy' ? 'loss' : 'draw',
      rounds_played: this.session.gameState.round,
    });
    void useMissionStore.getState().flushMatch();
  }

  /**
   * Fabrique l'enregistreur du combat qui commence, ou `null` pour ne rien
   * enregistrer. No-op ici : seul le duel PvP réel a deux simulations à
   * confronter — partout ailleurs il n'y a qu'un point de vue, donc rien à
   * diffé (cf. PvpController).
   */
  protected _newRecorder(): CombatRecorder | null { return null; }

  /** Expédie ce que l'enregistreur a retenu, s'il y a lieu. No-op ici. */
  protected _flushRecorder(): void { this._recorder = null; }

  protected _onCombatFinished(): void {
    // ⚠️ La résolution de fin de combat AVANT l'expédition du log, et ce n'est
    // pas un détail d'ordre : réanimation d'attribut, survivants retenus et
    // dégâts encaissés ont lieu ici, APRÈS le dernier tick. Le log partait
    // auparavant avant eux, et cette moitié du round était donc invisible —
    // deux clients pouvaient jouer 162 ticks rigoureusement identiques puis
    // décompter des survivants différents, sans que le fichier n'en dise rien.
    const result = this.session.finishCombat();
    this._recorder?.epilogue(this.session, result);
    this._flushRecorder();
    useMissionStore.getState().emit('combat_ended', {
      result: result.winner === 'player' ? 'win' : result.winner === 'enemy' ? 'loss' : result.winner,
      unit_count: this._combatUnitCount,
      units_lost: Math.max(0, this._combatUnitCount - result.playerSurvivors.length),
    });
    this.animator = null;
    // Le terrain ne vaut que pour le combat écoulé (session.startPreparation
    // appelle board.clearBlockedCells de son côté).
    this.scene?.setBlockedCells([]);
    this.scene?.setTerrainBackground(null);
    this.scene?.exitCombatMode();
    this.sync({ combatActive: false, boardTerrain: null, endRound: result });
  }

  // ── Fin de round → Shopping (Phase 4) ou tour suivant ────────────────────

  dismissEndRound(): void {
    if (this.session.isGameOver()) {
      this._reportMatchCompleted();
      this.sync({ endRound: null, gameOver: true, winner: this.session.getWinner() });
      return;
    }
    this._startShopping();
  }

  protected _startShopping(): void {
    const magies = this.session.getShoppingMagies();
    if (!magies.length) { this._proceedNextRound(); return; }
    this._shoppingMagies = magies;
    this.sync({ endRound: null, shopping: { magies, awaitingTarget: null, handTargets: null, banner: null } });
  }

  // ⚠️ Les trois gardes « aucune cible valide » ci-dessous sont devenues
  // INATTEIGNABLES depuis que l'offre est filtrée par pertinence
  // (`GameSession.getShoppingMagies` → `MagieOffer.pickMagies`) : une magie sans
  // cible n'est plus proposée. On les garde quand même — ce sont les seules
  // protections de `resolveMagie*Target` si un type sortait un jour de la table
  // de pertinence, et le coût est de trois lignes.
  chooseMagie(magie: Magie): void {
    // Contrecoup impayable : la carte est déjà verrouillée à l'écran, cette
    // garde n'est là que pour que la règle ne dépende pas du seul rendu.
    if (!this.session.canAffordMagie(magie)) {
      this._flashError('Pas assez de PV pour en payer le contrecoup');
      return;
    }
    if (this.session.magieNeedsUnitTarget(magie)) {
      const targets = this.session.magieUnitTargets(magie);
      if (!targets.length) { this._flashError('Aucune cible valide pour cette magie'); return; }
      this.scene?.setHighlight(targets.map(u => u.position!).filter(Boolean));
      this._pendingMagie = magie;
      this.sync({ shopping: { magies: [], awaitingTarget: 'unit', handTargets: null, banner: `${magie.name} — touche une unité de ton terrain` } });
    } else if (this.session.magieNeedsGraveyardTarget(magie)) {
      if (!this.session.graveyard.length) { this._flashError('Aucune unité au cimetière'); return; }
      this._pendingMagie = magie;
      this.sync({ shopping: { magies: [], awaitingTarget: 'graveyard', handTargets: null, banner: `${magie.name} — touche une unité du cimetière` } });
    } else if (this.session.magieNeedsHandTarget(magie)) {
      // ⚠️ Toutes les magies de main n'acceptent pas toutes les cartes :
      // `shift_tier_card` et `draw_material` en écartent (cf.
      // `GameSession.magieHandTargets`). La garde n'est donc PAS inatteignable
      // ici, contrairement aux deux au-dessus : le filtre d'offre ne connaît
      // que des tiers, il peut être optimiste d'un cheveu. Refuser sans
      // consommer la magie est exactement la bonne issue.
      const handTargets = this.session.magieHandTargets(magie);
      if (!handTargets.length) { this._flashError('Aucune carte valide en main'); return; }
      this._pendingMagie = magie;
      this.sync({ shopping: { magies: [], awaitingTarget: 'hand', handTargets, banner: `${magie.name} — touche une carte de ta main` } });
    } else {
      this.session.applyGlobalMagie(magie);
      this._noteMagie(magie);
      this._proceedNextRound();
    }
  }

  skipShopping(): void {
    this._proceedNextRound();
  }

  // Annule le ciblage en cours et revient au choix des 3 magies (la magie n'est
  // pas consommée). Plan §3.4 : le ciblage est annulable.
  cancelMagieTargeting(): void {
    if (!this._pendingMagie) return;
    this._pendingMagie = null;
    this.scene?.clearHighlight();
    this.sync({ shopping: { magies: this._shoppingMagies, awaitingTarget: null, handTargets: null, banner: null } });
  }

  private _pendingMagie: Magie | null = null;
  private _shoppingMagies: Magie[] = [];

  // Ciblage magie sur unité board — réutilise onUnitTap via un mode dédié.
  resolveMagieUnitTarget(unit: Unit): void {
    if (!this._pendingMagie) return;
    const targets = this.session.magieUnitTargets(this._pendingMagie);
    if (!targets.includes(unit)) return;
    const magie = this._pendingMagie;
    this._pendingMagie = null;
    this.scene?.clearHighlight();
    this.session.applyMagieOnUnit(magie, unit);
    this._noteMagie(magie);
    this.scene?.refresh();
    this._proceedNextRound();
  }

  // Ciblage magie sur une carte de la main (`hand_to_graveyard` la retire,
  // `duplicate_card` la laisse et en ajoute une copie, `shift_tier_card` la
  // remplace, `draw_material` en tire un matériel, `sacrifice_card_hp` la brûle
  // contre des PV). L'index vient de l'entrée groupée du HUD : c'est
  // l'exemplaire représentatif qui part, exactement comme à l'invocation
  // (cf. HandEntry.idx).
  //
  // ⚠️ La carte désignée doit être une CIBLE, pas seulement une carte de la
  // main — même garde que `resolveMagieUnitTarget`, qui vérifie déjà que
  // l'unité tapée est dans `magieUnitTargets`. Sans elle, le HUD serait le seul
  // à tenir la règle.
  resolveMagieHandTarget(handIdx: number): void {
    if (!this._pendingMagie) return;
    if (!this.session.magieNeedsHandTarget(this._pendingMagie)) return;
    if (handIdx < 0 || handIdx >= this.session.hand.length) return;
    if (!this.session.magieHandTargets(this._pendingMagie).includes(handIdx)) return;
    const magie = this._pendingMagie;
    this._pendingMagie = null;
    this.session.applyMagieOnHandCard(magie, handIdx);
    this._noteMagie(magie);
    this.scene?.refresh();
    this._proceedNextRound();
  }

  resolveMagieGraveyardTarget(unit: Unit): void {
    if (!this._pendingMagie) return;
    if (!this.session.graveyard.includes(unit)) return;
    const magie = this._pendingMagie;
    this._pendingMagie = null;
    this.session.applyMagieOnGraveyardUnit(magie, unit);
    this._noteMagie(magie);
    this.scene?.refresh();
    this._proceedNextRound();
  }

  get awaitingMagieTarget(): 'unit' | 'graveyard' | 'hand' | null {
    if (!this._pendingMagie) return null;
    if (this.session.magieNeedsGraveyardTarget(this._pendingMagie)) return 'graveyard';
    if (this.session.magieNeedsHandTarget(this._pendingMagie)) return 'hand';
    return 'unit';
  }

  protected _proceedNextRound(): void {
    this._shoppingMagies = [];
    this._pendingMagie = null;
    const draw = this.session.startNextRound();
    this._clearSelection();
    if (this.session.phase === Phase.GAME_OVER) {
      this._reportMatchCompleted();
      this.sync({ shopping: null, endRound: null, roundIntro: null, drawPopup: null, gameOver: true, winner: this.session.getWinner() });
      return;
    }
    this.scene?.refresh();
    this.sync({ shopping: null, endRound: null, ...this._freshPhaseClocks() });
    this._openRound(draw);
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
    scene.setHighlight(this.session.validCells(this.selectedCard, this.selectedMaterials, this.selectedConditionIndex));
    scene.setMaterialCandidates([
      ...this.session.materialCandidateCells(this.selectedCard, this.selectedMaterials, this.selectedConditionIndex),
    ]);
    const complete = this.session.materialsComplete(this.selectedCard, this.selectedMaterials, this.selectedConditionIndex);
    scene.setMaterialSelected(
      this.selectedMaterials.filter(u => !this.session.graveyard.includes(u)).map(u => ({ ...(u.position as Position) })),
      complete,
    );
  }

  protected _clearSelection(): void {
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

  /**
   * `durationMs = 0` rend la bannière PERMANENTE — et désarme quand même le
   * minuteur en cours, sans quoi un flash antérieur encore en vol l'effacerait
   * deux secondes plus tard (cf. BotController, qui annonce ainsi un résultat
   * de duel non enregistré).
   */
  protected _flashError(msg: string, durationMs = 2000): void {
    this.sync({ errorFlash: msg });
    if (this._errorTimer) { clearTimeout(this._errorTimer); this._errorTimer = null; }
    if (durationMs > 0) this._errorTimer = setTimeout(() => this.sync({ errorFlash: null }), durationMs);
  }

  // Main affichée : les exemplaires identiques sont empilés sous une seule
  // entrée (compteur ×N) et l'ordre est stable — tier croissant puis nom — au
  // lieu de l'ordre de pioche. La signature inclut les CONDITIONS car une
  // remise de magie ne modifie QU'UN exemplaire : le fondre avec un exemplaire
  // au plein tarif masquerait la remise que le tooltip annonce.
  private _groupHand(): HandEntry[] {
    const groups: { entry: HandEntry; indices: number[] }[] = [];
    const byKey = new Map<string, { entry: HandEntry; indices: number[] }>();

    this.session.hand.forEach((card, i) => {
      const key = `${card.id}|${JSON.stringify(card.summon_conditions ?? null)}`;
      const found = byKey.get(key);
      if (found) { found.entry.count += 1; found.indices.push(i); return; }
      const group = {
        entry: { key, idx: i, card, count: 1, playable: this.session.isPlayable(card), selected: false },
        indices: [i],
      };
      byKey.set(key, group);
      groups.push(group);
    });

    for (const g of groups) {
      g.entry.selected = this.selectedHandIdx != null && g.indices.includes(this.selectedHandIdx);
    }

    return groups
      .map(g => g.entry)
      .sort((a, b) => primaryTier(a.card) - primaryTier(b.card) || a.card.name.localeCompare(b.card.name));
  }

  // Recalcule l'instantané React depuis session + état de sélection.
  sync(extra: Partial<GameSnapshot> = {}): void {
    const gs = this.session.gameState;
    const hand = this._groupHand();

    const matSet = new Set(this.selectedMaterials);
    const gcandidates = this.selectedCard
      ? new Set(this.session.materialCandidateGraveyard(this.selectedCard, this.selectedMaterials, this.selectedConditionIndex))
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
    if (this.selectedCard && this.session.needsMaterials(this.selectedCard, this.selectedConditionIndex)
        && !this.session.materialsComplete(this.selectedCard, this.selectedMaterials, this.selectedConditionIndex)) {
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
      canUndo: gs.phase === Phase.PREPARATION
        && this._committedPrepId !== this.session.prepId
        && this.session.canUndoPreparation(),
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
    if (this._revealTimer) clearTimeout(this._revealTimer);
    // Sans quoi une annonce de tour encore en vol republierait sur une partie
    // démontée — et rouvrirait une popup de pioche sur l'écran suivant.
    if (this._introTimer) clearTimeout(this._introTimer);
    this._introTimer = null;
    this._pendingDraw = null;
    this._pendingCombatStart = null;
    this.animator?.stop();
    this.animator = null;
    // Combat quitté en cours de route : ce qui a été capturé part quand même.
    // Un combat interrompu est justement celui qu'on aimerait pouvoir relire.
    this._flushRecorder();
    // Les illustrations de l'adversaire ne survivent pas au match — sans quoi
    // elles fuiteraient dans la partie suivante. Celles du joueur restent en
    // place : les écrans de menu s'en servent.
    CardArt.setEnemyVariants(null);
    // Partie quittée en cours de route : ce qui a été joué reste acquis (le
    // serveur écarte de lui-même les lots trop courts — anti-concede). No-op si
    // la fin de partie a déjà vidé la file.
    void useMissionStore.getState().flushMatch();
  }
}

/**
 * Ce que l'annonce de terrain a à dire : le terrain, et combien d'unités de
 * chaque camp son effet touche VRAIMENT.
 *
 * ⚠️ Le décompte passe par `effectTargets`, la fonction même dont
 * `BoardEffect.applyEffect` se sert pour choisir ses cibles. C'est ce qui rend
 * impossible d'annoncer au joueur un décompte que l'effet n'a pas appliqué —
 * un second filtre écrit ici aurait fini par ne plus dire la même chose.
 *
 * ⚠️ `boosted: null` quand AUCUN effet ne lit le ciblage (`draw_bonus`, qui
 * crédite le joueur quoi qu'il arrive) : annoncer « 3 unités boostées » sous lui
 * ferait mentir l'écran.
 *
 * ⚠️ Sur un terrain à plusieurs effets, on compte l'UNION des unités touchées,
 * jamais la somme : une unité que deux effets boostent reste une unité. La
 * phrase annoncée est « combien en profitent », pas « combien de bonus tombent ».
 */
export function terrainAlertFor(
  board: import('../logic/types.js').BoardDef | null,
  playerUnits: import('../logic/Unit.js').Unit[],
  enemyUnits: import('../logic/Unit.js').Unit[],
): import('../stores/gameStore.js').TerrainAlertSnapshot | null {
  if (!board) return null;
  const targeting = boardEffects(board).filter(boardTargetsUnits);
  const count = (units: import('../logic/Unit.js').Unit[]) => {
    const touched = new Set<import('../logic/Unit.js').Unit>();
    for (const effect of targeting) for (const u of effectTargets(effect, units)) touched.add(u);
    return touched.size;
  };
  const boosted = targeting.length ? { player: count(playerUnits), enemy: count(enemyUnits) } : null;
  return { board, boosted };
}
