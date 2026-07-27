// GameScreen — shell React autour du board 3D. Assemble HUD, main, cimetière,
// synergies, contrôles de phase, overlays. Possède le timer de préparation
// (60s → combat auto) ; toute la logique de jeu vit dans GameSession/GameController.
import { useEffect, useRef, useState } from 'react';
import { buildSession } from '../game/bootstrap.js';
import { GameController } from '../game/GameController.js';
import { useGameStore } from '../stores/gameStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useTournamentStore } from '../stores/tournamentStore.js';
import Board3DCanvas from '../components/board/Board3DCanvas.js';
import Hud from '../components/hud/Hud.js';
import SynergyPanel from '../components/hud/SynergyPanel.js';
import PhaseControls from '../components/hud/PhaseControls.js';
import GameMenu from '../components/hud/GameMenu.js';
import HandBar from '../components/hand/HandBar.js';
import GraveyardTray from '../components/hand/GraveyardTray.js';
import { SummonOptionMenu, EndRoundOverlay, GameOverScreen } from '../components/overlays/Overlays.js';
import ShoppingLayer from '../components/shopping/ShoppingLayer.js';
import { Banner } from '../components/ui/primitives.js';
import { PREP_DURATION_S } from '../game/timings.js';

export default function GameScreen() {
  const [controller, setControllerLocal] = useState<GameController | null>(null);
  const setController = useGameStore(s => s.setController);
  const reset = useGameStore(s => s.reset);
  const deckName = useUiStore(s => s.params.deckName as string | undefined);
  const enemyDeckName = useUiStore(s => s.params.enemyDeckName as string | undefined);
  // Manche de tournoi : adversaire et deck viennent du bracket, et la sortie
  // (fin de partie ou abandon) est comptabilisée puis renvoyée vers l'écran Tournoi.
  const inTournament = useUiStore(s => s.params.tournament === true);

  useEffect(() => {
    const pending = inTournament ? useTournamentStore.getState().pendingGame : null;
    // Tournoi sans manche en attente (rechargement de page, deep-link) : rien à jouer.
    if (inTournament && !pending) { useUiStore.getState().navigate('tournament'); return; }
    const session = buildSession(
      pending?.playerDeckName ?? deckName,
      'ai',
      enemyDeckName,
      pending?.opponentDeck,
    );
    const ctrl = new GameController(session);
    setControllerLocal(ctrl);
    setController(ctrl);
    ctrl.begin();
    return () => {
      ctrl.dispose();
      setController(null);
      reset();
    };
    // Montage unique : la session/partie ne se reconstruit pas sur changement de deps.

  }, []);

  if (!controller) return <div className="flex min-h-dvh items-center justify-center bg-surface text-white">Chargement…</div>;

  return (
    <div className="relative h-dvh overflow-hidden bg-surface text-white" onPointerDown={() => useUiStore.getState().hideTooltip()}>
      <Board3DCanvas controller={controller} />
      <Hud />
      <SynergyPanel />
      <GraveyardTray />
      <HandBar />
      <PhaseControls />
      {inTournament ? (
        // Abandonner une manche de tournoi la concède : le bracket ne peut pas
        // rester en suspens, et rejouer à volonté viderait le Bo5 de son sens.
        <GameMenu quitLabel="Abandonner la manche" onQuit={() => exitTournamentGame('enemy')} />
      ) : (
        <GameMenu onQuit={() => useUiStore.getState().navigate('main_menu')} />
      )}
      <PrepTimer controller={controller} />
      <AiWinReward inTournament={inTournament} />
      {inTournament && <TournamentHeader />}
      <Banners />
      <SummonOptionMenu />
      <EndRoundOverlay />
      <ShoppingLayer />
      {inTournament
        ? <GameOverScreen exitLabel="◂ RETOUR AU TOURNOI" onExit={exitTournamentGame} />
        : <GameOverScreen />}
    </div>
  );
}

// Gain d'XP de la victoire solo, crédité une seule fois par partie (`claimed`).
//
// Une MANCHE de tournoi ne compte pas ici : le tournoi a son propre gain, à la
// victoire finale. Créditer les deux ferait rapporter à un tournoi jusqu'à
// 9 manches × 10 + 50, bien au-delà du barème voulu.
function AiWinReward({ inTournament }: { inTournament: boolean }) {
  const gameOver = useGameStore(s => s.gameOver);
  const winner = useGameStore(s => s.winner);
  const claimed = useRef(false);

  useEffect(() => {
    if (inTournament || claimed.current) return;
    if (!gameOver || winner !== 'player') return;
    claimed.current = true;
    void useAuthStore.getState().claimReward('ai_win');
  }, [gameOver, winner, inTournament]);

  return null;
}

// Solde la manche dans le bracket puis rend la main à l'écran Tournoi.
function exitTournamentGame(winner: 'player' | 'enemy' | 'draw' | null) {
  useTournamentStore.getState().finishGame(winner);
  useUiStore.getState().navigate('tournament');
}

// Rappel du contexte tournoi pendant la partie : adversaire et score du Bo5.
function TournamentHeader() {
  const pending = useTournamentStore(s => s.pendingGame);
  if (!pending) return null;
  const [pw, ow] = pending.score;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[max(3rem,calc(env(safe-area-inset-top)+2.5rem))] z-20 flex -translate-x-1/2 items-center gap-2">
      <span className="rounded-full border border-gold/40 bg-surface/80 px-3 py-0.5 text-[11px] text-gold">
        🏆 vs {pending.opponentName} · manche {pending.gameNumber} ({pw}–{ow})
      </span>
    </div>
  );
}

// Timer de préparation : redémarre à chaque nouvelle manche, ne décompte que
// hors combat/overlay, déclenche le combat à 0.
function PrepTimer({ controller }: { controller: GameController }) {
  const round = useGameStore(s => s.round);
  const applySnapshot = useGameStore(s => s.applySnapshot);
  const remaining = useRef(PREP_DURATION_S);

  useEffect(() => {
    remaining.current = PREP_DURATION_S;
    applySnapshot({ prepRemaining: PREP_DURATION_S });
    const t = setInterval(() => {
      const s = useGameStore.getState();
      const prepActive = s.phase === 'preparation' && !s.combatActive && !s.endRound && !s.shopping && !s.menuOpen && !s.gameOver;
      if (!prepActive) return;
      remaining.current -= 1;
      if (remaining.current <= 0) {
        clearInterval(t);
        applySnapshot({ prepRemaining: 0 });
        controller.onPrepTimeout();
        return;
      }
      applySnapshot({ prepRemaining: remaining.current });
    }, 1000);
    return () => clearInterval(t);
  }, [round, controller, applySnapshot]);

  return null;
}

function Banners() {
  const errorFlash = useGameStore(s => s.errorFlash);
  const invocationBanner = useGameStore(s => s.invocationBanner);
  const combatActive = useGameStore(s => s.combatActive);
  // La bannière de ciblage magie est rendue par ShoppingLayer (avec Annuler).
  if (errorFlash) return <Banner text={`⚠ ${errorFlash}`} tone="error" />;
  if (invocationBanner && !combatActive) return <Banner text={invocationBanner} />;
  return null;
}
