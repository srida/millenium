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
import { sendOwnBoard, waitForOpponentBoard, reconstructOpponentUnits, reset as resetOpponent } from '../net/PvpOpponentProvider.js';
import type { BoardDef } from '../logic/types.js';
import { useGameStore } from '../stores/gameStore.js';

interface PvpDeps {
  cardDb: { getCard(id: string): any };
  getBoard: (id: string) => BoardDef | null;
  getRandomBoard: () => BoardDef | null;
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

  begin(): void {
    // Écoute les messages de round + fin de match, puis démarre la préparation.
    this._listen('round:go', (m) => this._onRoundGo(m));
    this._listen('match:end', (m) => this._onMatchEnd(m));
    this._listen('match:opponent_disconnected', () => this._pvpNotify('Adversaire déconnecté…'));
    this._listen('_socket_closed', () => this._pvpNotify('Connexion perdue'));
    PvpConnection.send('match:ready');
    this.session.startPreparation();
    this._clearSelection();
    this.scene?.refresh();
    this.sync({ pvpOpponent: this.opponentName });
  }

  // ── Déclenchement du combat : poignée de main réseau ────────────────────────
  startCombat(): void {
    if (this.session.phase !== Phase.PREPARATION || this._handshaking) return;
    this._handshaking = true;
    this._clearSelection();
    const round = this.session.gameState.round;

    // 1) J'annonce mon board (unités + vétérance).
    sendOwnBoard(round, this.session.getPlayerUnits());
    // 2) Le rôle A choisit le terrain et le diffuse (déterminisme : un seul tirage).
    if (this.role === 'A') {
      const board = this.pvp.getRandomBoard();
      PvpConnection.send('round:terrain_pick', { round, boardId: board?.id ?? null });
    }
    // 3) J'attends le board adverse en parallèle, puis j'acquitte la barrière.
    this._oppBoardPromise = waitForOpponentBoard(round);
    PvpConnection.send('round:combat_start_ack', { round });
    this.sync({ combatActive: false, pvpWaiting: true });
  }

  private async _onRoundGo(msg: { round: number; boardId: string | null }): Promise<void> {
    if (!this._oppBoardPromise) return;
    const oppPayload = await this._oppBoardPromise;
    this._oppBoardPromise = null;

    // Nettoie le côté ennemi (rounds > 1 : on rebâtit depuis le board autoritaire
    // de l'adversaire) puis reconstruit ses unités en miroir (rows 7–10).
    for (const u of this.session.board.getLivingUnitsOnSide('enemy')) this.session.board.removeUnit(u);
    reconstructOpponentUnits(oppPayload, this.session.board, this.pvp.cardDb);
    this.session.enemyUnits = this.session.board.getLivingUnitsOnSide('enemy');

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
      const localWinner = this.session.getWinner(); // 'player' | 'enemy' | 'draw'
      PvpConnection.send('match:report_result', { localWinner });
      this.sync({ endRound: null, pvpWaiting: true });
      return;
    }
    // Pas de Phase Shopping en PvP : on relance directement la préparation.
    PvpConnection.send('round:next_ready', { round: this.session.gameState.round });
    this._proceedNextRound();
  }

  private _onMatchEnd(msg: { winner: 'A' | 'B' | 'draw' }): void {
    const iWon = msg.winner === this.role;
    const winner: 'player' | 'enemy' | 'draw' = msg.winner === 'draw' ? 'draw' : iWon ? 'player' : 'enemy';
    this.animator?.stop();
    this.sync({ combatActive: false, pvpWaiting: false, gameOver: true, winner });
  }

  // Abandon volontaire (bouton quitter).
  forfeit(): void {
    if (this._finished) return;
    this._finished = true;
    PvpConnection.send('match:forfeit');
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
