/* eslint-disable @typescript-eslint/no-explicit-any */
// PvpController — variante Duel en ligne de GameController. La préparation, la
// sélection et le placement sont hérités tels quels ; seuls le déclenchement du
// combat et l'enchaînement des rounds changent : ils passent par une poignée de
// main via le relais WebSocket (PvpConnection) et la reconstruction du board
// adverse (PvpOpponentProvider). Le combat lui-même reste 100 % local et
// déterministe des deux côtés (aucun RNG dans CombatManager).
//
// Séquence d'un round (identique pour A et B, barrières côté serveur) :
//   startCombat → board_ready(mes unités) ; A choisit + terrain_pick(boardId)
//   → combat_start_ack → [barrière serveur] → round:go(boardId)
//   → reconstruire l'adversaire (miroir rows 7–10) → session.startCombat(board)
//   → animer. Fin de partie : match:report_result(localWinner) → match:end.
import { GameController } from './GameController.js';
import { GameSession, Phase } from '../logic/GameSession.js';
import * as PvpConnection from '../net/PvpConnection.js';
import { sendOwnBoard, waitForOpponentBoard, reconstructOpponentUnits, applyOpponentMultiplier, reset as resetOpponent } from '../net/PvpOpponentProvider.js';
import type { BoardDef } from '../logic/types.js';
import type { Scene3D } from '../three/Scene3D.js';
import { useGameStore } from '../stores/gameStore.js';
import { useAuthStore } from '../stores/authStore.js';
import * as CardArt from '../data/CardArt.js';
import { CombatRecorder } from './CombatRecorder.js';
import * as AuthClient from '../data/AuthClient.js';

interface PvpDeps {
  cardDb: { getCard(id: string): any };
  getBoard: (id: string) => BoardDef | null;
}

export class PvpController extends GameController {
  private pvp: PvpDeps;
  private role: 'A' | 'B';
  private opponentName: string;
  private _handshaking = false;
  private _oppBoardPromise: Promise<any> | null = null;
  private _listeners: [string, (m: any) => void][] = [];
  private _finished = false;

  constructor(session: GameSession, pvp: PvpDeps, role: 'A' | 'B', opponentName: string) {
    super(session);
    this.pvp = pvp;
    this.role = role;
    this.opponentName = opponentName;
  }

  /**
   * ⚠️ La scène est attachée par `Board3DCanvas` au montage, sans ordre garanti
   * vis-à-vis de `begin()` — le drapeau se pose donc ICI et pas là-bas.
   *
   * Le rôle B joue dans le reflet du monde du rôle A : ses cases bloquées sont
   * miroitées par la session (`mirroredRole`), et le fond de grille doit
   * suivre le même retournement, sans quoi le décor peint et les rochers du
   * terrain ne tomberaient plus au même endroit chez ce joueur.
   */
  attachScene(scene: Scene3D): void {
    super.attachScene(scene);
    scene.setTerrainMirrored(this.role === 'B');
  }

  begin(): void {
    // Illustrations de l'adversaire : dérivées par le SERVEUR de son deck book
    // et filtrées par possession (cf. cosmetics.deckVariantMap), elles arrivent
    // dans `match:found` — donc bien avant que la première unité adverse ne
    // soit posée. Purement cosmétiques, elles n'entrent jamais dans le payload
    // de déterminisme du round.
    CardArt.setEnemyVariants((PvpConnection as any).getOpponent()?.variants ?? null);
    CardArt.setEnemyFoils((PvpConnection as any).getOpponent()?.foils ?? null);
    CardArt.setEnemyFinishes((PvpConnection as any).getOpponent()?.finishes ?? null);
    this._applyOpponentDeck();
    // Après une reconnexion, l'adversaire est re-annoncé : on le relit, sinon
    // le reste du match se jouerait avec l'art d'origine.
    this._listen('match:rejoined', () => {
      CardArt.setEnemyVariants((PvpConnection as any).getOpponent()?.variants ?? null);
      CardArt.setEnemyFoils((PvpConnection as any).getOpponent()?.foils ?? null);
      CardArt.setEnemyFinishes((PvpConnection as any).getOpponent()?.finishes ?? null);
    CardArt.setEnemyFinishes((PvpConnection as any).getOpponent()?.finishes ?? null);
      this._applyOpponentDeck();
    });
    // Écoute les messages de round + fin de match, puis démarre la préparation.
    this._listen('round:go', (m) => this._onRoundGo(m));
    this._listen('match:end', (m) => this._onMatchEnd(m));
    this._listen('match:opponent_disconnected', () => this._pvpNotify('Adversaire déconnecté…'));
    this._listen('_socket_closed', () => this._pvpNotify('Connexion perdue'));
    PvpConnection.send('match:ready');
    const draw = this.session.startPreparation();
    this._clearSelection();
    this.scene?.refresh();
    this.sync({ pvpOpponent: this.opponentName });
    // Même ouverture qu'en solo : annonce du tour puis popup de pioche. Les
    // rounds suivants passent par `_proceedNextRound`, hérité tel quel.
    this._openRound(draw);
  }

  // ── Déclenchement du combat : poignée de main réseau ────────────────────────
  startCombat(): void {
    if (this.session.phase !== Phase.PREPARATION || this._handshaking) return;
    // ⚠️ Avant tout le reste : en duel le chrono de préparation ne gèle pas
    // (l'adversaire attend à la barrière réseau), donc il peut tomber à 0 avec
    // la popup encore à l'écran — elle recouvrirait toute la poignée de main.
    this._closeRoundOpening();
    this._handshaking = true;
    // Le board part sur le réseau : plus question de « Tout annuler ». La phase
    // reste PREPARATION pendant toute la poignée de main (`pvpWaiting`), donc
    // la barre de préparation — et son bouton — sont encore à l'écran.
    this._committedPrepId = this.session.prepId;
    this._clearSelection();
    const round = this.session.gameState.round;

    // 1) J'annonce mon board (unités + état persistant + mes PV).
    const gs = this.session.gameState;
    sendOwnBoard(round, this.session.getPlayerUnits(), gs.player_hp, {
      value: gs.player_damage_multiplier_bonus,
      sources: gs.player_multiplier_sources,
    });
    // 2) J'attends le board adverse, puis j'acquitte la barrière.
    this._oppBoardPromise = waitForOpponentBoard(round);
    if (this.role === 'A') {
      // Le rôle A choisit le terrain et le diffuse (déterminisme : un seul
      // tirage). ⚠️ Il doit d'abord CONNAÎTRE le board adverse : un terrain
      // promis (`guaranteed_board`) se lit sur les unités des deux camps. Son
      // acquittement part donc APRÈS `round:terrain_pick` — la barrière du
      // serveur ne s'ouvre qu'à deux acquittements, donc jamais sans le choix.
      void this._pickTerrainThenAck(round);
    } else {
      PvpConnection.send('round:combat_start_ack', { round });
    }
    this.sync({ combatActive: false, pvpWaiting: true });
  }

  /** Délai au-delà duquel A n'attend plus le board adverse : il acquitte sans
   *  terrain et laisse la barrière du serveur trancher (client adverse mort).
   *  Sous `BARRIER_TIMEOUT_MS` (180 s) côté serveur. */
  private static readonly OPP_BOARD_WAIT_MS = 150_000;

  private async _pickTerrainThenAck(round: number): Promise<void> {
    const oppBoard = this._oppBoardPromise;
    let boardId: string | null = null;
    const payload = await Promise.race([
      oppBoard,
      new Promise<null>(resolve => setTimeout(() => resolve(null), PvpController.OPP_BOARD_WAIT_MS)),
    ]);
    if (this._handshaking && this._oppBoardPromise === oppBoard && payload) {
      // Sa session est la seule à connaître les deux decks, les terrains déjà
      // joués et les promesses ; elle ne consomme rien ici : c'est l'id que le
      // serveur renverra dans `round:go` qui sera marqué joué des deux côtés.
      this._installOpponent(payload);
      boardId = this.session.pickCombatBoard()?.id ?? null;
    }
    PvpConnection.send('round:terrain_pick', { round, boardId });
    PvpConnection.send('round:combat_start_ack', { round });
  }

  /**
   * Remplace les unités adverses par celles du payload, en miroir (rows 7–10).
   * Idempotent pour un payload donné : le rôle A l'appelle AVANT de tirer le
   * terrain, `_onRoundGo` le rappelle pour les deux rôles.
   */
  private _installedPayload: any = null;
  private _installOpponent(oppPayload: any): void {
    if (this._installedPayload === oppPayload) return;
    this._installedPayload = oppPayload;
    // Nettoie le côté ennemi (rounds > 1 : on rebâtit depuis le board autoritaire
    // de l'adversaire) puis reconstruit ses unités en miroir (rows 7–10).
    for (const u of this.session.board.getLivingUnitsOnSide('enemy')) this.session.board.removeUnit(u);
    reconstructOpponentUnits(oppPayload, this.session.board, this.pvp.cardDb);
    this.session.enemyUnits = this.session.board.getLivingUnitsOnSide('enemy');
  }

  private async _onRoundGo(msg: { round: number; boardId: string | null }): Promise<void> {
    if (!this._oppBoardPromise) return;
    const oppPayload = await this._oppBoardPromise;
    this._oppBoardPromise = null;

    // PV adverses : autoritaires côté propriétaire. Les magies globales de la
    // Phase Shopping (player_hp_bonus) n'existent que sur le client qui les a
    // jouées — sans cette resynchro, les deux clients divergeraient sur les PV
    // et pourraient déclarer la fin de partie différemment.
    if (typeof oppPayload.player_hp === 'number') this.session.gameState.enemy_hp = oppPayload.player_hp;
    // Bonus permanent de multiplicateur de l'adversaire (magies) — AFFECTÉ,
    // jamais cumulé : son propriétaire fait foi, comme pour ses PV.
    applyOpponentMultiplier(this.session.gameState, oppPayload);

    this._installOpponent(oppPayload);

    const board = msg.boardId ? this.pvp.getBoard(msg.boardId) : null;
    this.scene?.refresh();
    const { combat } = this.session.startCombat(board);
    this._handshaking = false;
    this.sync({ pvpWaiting: false });
    this._beginCombatAnimation(combat, board);
  }

  // ── Fin de round / fin de partie ───────────────────────────────────────────
  dismissEndRound(): void {
    if (this.session.isGameOver()) {
      if (this._finished) return;
      this._finished = true;
      // Missions : la partie est jouée, on solde le lot sans attendre l'arbitrage
      // du serveur (le résultat local suffit — seuls les gains PvP en dépendent).
      this._reportMatchCompleted();
      const localWinner = this.session.getWinner(); // 'player' | 'enemy' | 'draw'
      PvpConnection.send('match:report_result', { localWinner });
      this.sync({ endRound: null, pvpWaiting: true });
      return;
    }
    // Phase Shopping identique au mode solo. Aucune synchro n'est nécessaire :
    // chaque joueur tire et applique ses magies localement, et le résultat est
    // transmis à l'adversaire dans le payload de board_ready du round suivant
    // (stats de base, PV, bouclier, PV joueur). Le décalage de durée entre les
    // deux shoppings est absorbé par la barrière `combat_start_ack`.
    this._startShopping();
  }

  // Le passage au round suivant traverse le relais : il réinitialise les
  // barrières serveur (terrain + acks). Appelé aussi bien après le choix d'une
  // magie qu'après « Passer cette phase ».
  protected _proceedNextRound(): void {
    PvpConnection.send('round:next_ready', { round: this.session.gameState.round });
    super._proceedNextRound();
  }

  private _onMatchEnd(msg: { winner: 'A' | 'B' | 'draw'; progression?: any }): void {
    const iWon = msg.winner === this.role;
    const winner: 'player' | 'enemy' | 'draw' = msg.winner === 'draw' ? 'draw' : iWon ? 'player' : 'enemy';
    this.animator?.stop();
    // Le gain PvP est décerné par le serveur (seul arbitre du vainqueur) et
    // voyage dans match:end : il n'y a rien à réclamer, juste à afficher.
    this._reportMatchCompleted();
    if (iWon && msg.progression) useAuthStore.getState().applyProgression(msg.progression);
    this.sync({ combatActive: false, pvpWaiting: false, gameOver: true, winner });
  }

  // Abandon volontaire (bouton quitter).
  forfeit(): void {
    if (this._finished) return;
    this._finished = true;
    PvpConnection.send('match:forfeit');
  }

  /**
   * Les attributs du deck adverse, dérivés par le SERVEUR de son deck book et
   * transportés dans `match:found` / `match:rejoined` — le trajet exact des
   * variantes d'illustration, et pour la même raison : le client n'envoie qu'un
   * NOM de deck, qui ne sert qu'à choisir une clé de son propre livre.
   *
   * ⚠️ Eux, en revanche, ne sont PAS cosmétiques : ils décident du terrain,
   * donc de bonus de stats réels.
   *
   * ⚠️ On n'écrase QUE si le champ est présent. `match:rejoined` peut porter un
   * adversaire dégénéré (`{ id }` quand sa socket est tombée) : repartir sur des
   * comptes vides changerait la règle de tirage en plein match.
   */
  private _applyOpponentDeck(): void {
    this.session.setEnemyDeckAttributeCounts(
      (PvpConnection as any).getOpponent()?.deck_attribute_counts);
  }

  // ── Log de combat par tick — OUTIL DE DIAGNOSTIC TEMPORAIRE ────────────────
  //
  // Les deux clients simulent le même combat en parallèle sans aucun hasard :
  // ils sont censés produire le même tick, à l'unité près. Chacun enregistre
  // donc sa vue et la dépose ; le serveur recolle les deux et nomme la première
  // différence (cf. `pvplog.js`, `GET /api/admin/pvp-logs`).

  /**
   * ⚠️ Rien n'est enregistré en duel contre BOT : la partie y est un solo
   * (`BotController`, session `mode: 'ai'`), il n'existe qu'un seul point de
   * vue et donc rien à confronter. Le match n'a d'ailleurs aucune ligne dans
   * `matches`, que `pvplog.record` exige pour valider l'appartenance.
   *
   * Le round est FIGÉ ici plutôt que relu à la fin : `_onCombatFinished`
   * précède `nextRound()`, mais le figer supprime la question.
   */
  protected _newRecorder(): CombatRecorder | null {
    if ((PvpConnection as any).getBotMatch()) return null;
    const matchId = (PvpConnection as any).getMatchId();
    if (!matchId) return null;
    return new CombatRecorder({ matchId, round: this.session.gameState.round, role: this.role });
  }

  /**
   * ⚠️ « Pose et oublie » : jamais attendu, jamais montré au joueur. Un outil
   * de debug qui peut retarder une navigation ou faire échouer une fin de
   * combat est pire que pas d'outil du tout — d'où le `void` et le `catch`
   * muet. Appelé à la fin du combat ET au démontage (combat quitté en route),
   * l'enregistreur étant remis à `null` pour que le second passage soit inerte.
   */
  protected _flushRecorder(): void {
    const recorder = this._recorder;
    this._recorder = null;
    if (!recorder || recorder.isEmpty) return;
    void AuthClient.postPvpLog(recorder.payload()).catch(() => { /* diagnostic : jamais bloquant */ });
  }

  private _pvpNotify(msg: string): void { useGameStore.getState().applySnapshot({ errorFlash: msg }); }

  private _listen(type: string, fn: (m: any) => void): void {
    PvpConnection.on(type, fn);
    this._listeners.push([type, fn]);
  }

  dispose(): void {
    for (const [type, fn] of this._listeners) PvpConnection.off(type, fn);
    this._listeners = [];
    resetOpponent();
    super.dispose();
  }
}
