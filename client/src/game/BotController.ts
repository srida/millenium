/* eslint-disable @typescript-eslint/no-explicit-any */
// BotController — duel du lobby en ligne contre un adversaire artificiel.
//
// Il tient la place de `PvpController` quand le matchmaking n'a trouvé personne
// (cf. ws/MatchmakingQueue.BOT_DELAY_MIN_MS → BOT_DELAY_MAX_MS) et que le
// serveur a servi un bot. Le joueur n'en sait rien : même écran, même HUD,
// mêmes overlays, même identité d'adversaire — c'est GameScreenPvp qui monte
// l'un ou l'autre, rien d'autre ne change.
//
// La partie, elle, est un solo : l'adversaire est joué par l'`EnemyAI`
// habituelle, sur le deck que le serveur a annoncé. Aucun combat n'est simulé
// côté serveur — le PvP est un relais opaque, lui faire jouer un bot
// reviendrait à porter tout `logic/` côté Node.
//
// Ce qui reste au serveur, et qui justifie le WebSocket : la CAISSE. Une
// victoire paie `pvp_win`, donc le client ne peut ni la nommer ni la chiffrer.
// Il rapporte son résultat (`match:report_result`) exactement comme en PvP réel
// et attend `match:end` — le gain arrive avec (cf. ws/BotMatch.js).
import { GameController } from './GameController.js';
import { GameSession, Phase } from '../logic/GameSession.js';
import * as PvpConnection from '../net/PvpConnection.js';
import { useAuthStore } from '../stores/authStore.js';

/**
 * Latence de « PRÊT » de l'adversaire, tirée à chaque round.
 *
 * Sans elle, le bot répond au quart de seconde à chaque round — ce serait le
 * tell : un vrai joueur pose ses unités, hésite, choisit sa magie. On modélise
 * donc le moment où il est prêt DEPUIS LE DÉBUT DE LA PRÉPARATION, pas depuis
 * le tap du joueur : celui qui prend son temps ne l'attend jamais, celui qui
 * expédie son tour patiente — exactement ce que produit un adversaire humain.
 *
 * Le plafond reste bien sous `PREP_DURATION_S` (60 s), et ce n'est pas
 * décoratif : c'est ce qui garantit qu'un joueur qui ne tape jamais PRÊT voie
 * son combat partir à 0 sans attendre une seconde de plus — le chrono de
 * préparation appelle `startCombat()` directement (cf. GameScreenPvp), il n'a
 * aucune notion de bot à qui laisser du temps.
 */
const READY_MIN_MS = 3_000;
const READY_MAX_MS = 22_000;

/**
 * Délai au bout duquel on cesse d'attendre le `match:end` du serveur.
 *
 * ⚠️ Il n'y a pas d'adversaire à attendre ici : la partie est jouée EN ENTIER
 * dans l'onglet, le serveur ne fait que tenir la caisse. Un `match:end` qui ne
 * revient pas (socket coupée juste après l'envoi, serveur redéployé) laissait
 * donc le joueur derrière « En attente de l'adversaire… » indéfiniment, sur une
 * partie dont il connaît le résultat depuis le début — il ne lui restait que le
 * rechargement de la page. On se rabat sur le résultat local, en disant que le
 * gain n'a pas pu être enregistré : le serveur reste seul arbitre du gain, on
 * ne s'attribue rien, on rend juste sa partie au joueur.
 */
const MATCH_END_TIMEOUT_MS = 10_000;

export class BotController extends GameController {
  private opponentName: string;
  private _readyAt = 0;
  private _waitTimer: ReturnType<typeof setTimeout> | null = null;
  private _listeners: [string, (m: any) => void][] = [];
  private _finished = false;
  private _endTimer: ReturnType<typeof setTimeout> | null = null;
  private _resolved = false;

  constructor(session: GameSession, opponentName: string) {
    super(session);
    this.opponentName = opponentName;
  }

  begin(): void {
    this._listen('match:end', (m) => this._onMatchEnd(m));
    // ⚠️ Bannière ÉPHÉMÈRE (2 s), pas permanente : `errorFlash` a la priorité
    // sur `invocationBanner` (cf. hud/PhaseTimer.Banners), une bannière qui
    // reste éteint donc tout le retour d'invocation pour le reste du duel — et
    // le duel, lui, continue de se jouer très bien sans réseau : c'est un solo.
    // Ce qui dépend vraiment du serveur, c'est le GAIN, et il se dit à la fin.
    this._listen('_socket_closed', () => this._flashError('Connexion perdue'));
    super.begin();
    this._armReady();
    this.sync({ pvpOpponent: this.opponentName });
  }

  // ── Déclenchement du combat : l'attente que le réseau aurait produite ──────
  startCombat(): void {
    if (this.session.phase !== Phase.PREPARATION || this._waitTimer) return;
    const wait = this._readyAt - Date.now();
    if (wait <= 0) { super.startCombat(); return; }
    this._clearSelection();
    this.sync({ combatActive: false, pvpWaiting: true });
    this._waitTimer = setTimeout(() => {
      this._waitTimer = null;
      // ⚠️ La partie a pu se solder PENDANT l'attente : l'overlay est modal,
      // mais le menu ☰ y reste atteignable et un abandon clôt le match. Sans
      // cette garde, le combat repartirait par-dessus l'écran de résultat —
      // `session.phase` ne suffit pas à le voir, elle est toujours en
      // préparation (c'est le SERVEUR qui a mis fin au match, pas la session).
      if (this._finished) return;
      this.sync({ pvpWaiting: false });
      if (this.session.phase === Phase.PREPARATION) super.startCombat();
    }, wait);
  }

  // ── Fin de round / fin de partie ──────────────────────────────────────────
  dismissEndRound(): void {
    if (this.session.isGameOver()) {
      if (this._finished) return;
      this._finished = true;
      // Missions : la partie est jouée, on solde le lot sans attendre le
      // serveur — seul le gain PvP dépend de son arbitrage.
      this._reportMatchCompleted();
      const sent = PvpConnection.send('match:report_result', { localWinner: this.session.getWinner() });
      if (!sent) { this._resolveLocally(); return; }
      // Le serveur a le message : on lui laisse le temps de rendre son verdict,
      // pas l'éternité (cf. MATCH_END_TIMEOUT_MS).
      this._endTimer = setTimeout(() => this._resolveLocally(), MATCH_END_TIMEOUT_MS);
      this.sync({ endRound: null, pvpWaiting: true });
      return;
    }
    super.dismissEndRound();
  }

  protected _proceedNextRound(): void {
    super._proceedNextRound();
    this._armReady();
  }

  private _armReady(): void {
    const span = READY_MAX_MS - READY_MIN_MS;
    this._readyAt = Date.now() + READY_MIN_MS + Math.floor(Math.random() * span);
  }

  private _onMatchEnd(msg: { winner: 'A' | 'B' | 'draw'; progression?: any }): void {
    if (this._resolved) return;
    this._resolved = true;
    this._clearEndTimer();
    // Le joueur est toujours le rôle A d'un match bot (cf. ws/BotMatch.js).
    const winner: 'player' | 'enemy' | 'draw' =
      msg.winner === 'draw' ? 'draw' : msg.winner === 'A' ? 'player' : 'enemy';
    this.animator?.stop();
    this._reportMatchCompleted();
    // `progression` n'accompagne `match:end` que si le gain a été versé : le
    // serveur refuse un match invraisemblablement court ou trop répété.
    if (msg.progression) useAuthStore.getState().applyProgression(msg.progression);
    this.sync({ combatActive: false, pvpWaiting: false, gameOver: true, winner });
  }

  // Abandon volontaire : concédé au serveur, qui clôt le match sans rien verser.
  // ⚠️ Sans réseau, l'abandon ne partait nulle part et le menu se contentait de
  // se refermer : le joueur restait enfermé dans une partie qu'il venait de
  // quitter. Rien n'est en jeu (un abandon ne verse jamais rien), on clôt donc
  // localement sur la défaite qu'il a demandée.
  forfeit(): void {
    if (this._finished) return;
    this._finished = true;
    if (PvpConnection.send('match:forfeit')) {
      this._endTimer = setTimeout(() => this._resolveLocally('enemy'), MATCH_END_TIMEOUT_MS);
      return;
    }
    this._resolveLocally('enemy');
  }

  /**
   * Le serveur n'a pas rendu — ou n'a pas pu recevoir — son verdict : on solde
   * la partie sur le résultat local. Aucun gain n'est appliqué (le client ne
   * s'en attribue jamais), et on le DIT plutôt que de laisser croire à une
   * victoire non payée — même posture que le `reportError` de l'Arcade.
   */
  private _resolveLocally(forced?: 'player' | 'enemy' | 'draw'): void {
    if (this._resolved) return;
    this._resolved = true;
    this._clearEndTimer();
    this.animator?.stop();
    // No-op si le lot a déjà été soldé par `dismissEndRound` ; nécessaire sur
    // le chemin de l'abandon, où c'était `match:end` qui s'en chargeait.
    this._reportMatchCompleted();
    this.sync({
      combatActive: false,
      pvpWaiting: false,
      gameOver: true,
      winner: forced ?? this.session.getWinner(),
    });
    // Permanent : il est repris tel quel par l'écran de résultat (cf.
    // GameScreenPvp.ResultOverlay), qui recouvre la bannière.
    this._flashError('Serveur injoignable — ce duel n\'a pas pu être enregistré.', 0);
  }

  private _clearEndTimer(): void {
    if (this._endTimer) { clearTimeout(this._endTimer); this._endTimer = null; }
  }

  private _listen(type: string, fn: (m: any) => void): void {
    (PvpConnection as any).on(type, fn);
    this._listeners.push([type, fn]);
  }

  dispose(): void {
    if (this._waitTimer) { clearTimeout(this._waitTimer); this._waitTimer = null; }
    this._clearEndTimer();
    for (const [type, fn] of this._listeners) (PvpConnection as any).off(type, fn);
    this._listeners = [];
    super.dispose();
  }
}
