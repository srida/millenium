/* eslint-disable @typescript-eslint/no-explicit-any */
// GameScreenPvp — variante Duel en ligne de GameScreen. Même shell (board 3D,
// HUD, main, contrôles, overlays) mais piloté par PvpController et sans Phase
// Shopping. Ajoute la bannière adversaire, l'overlay d'attente (poignée de main
// réseau / résultat) et l'abandon.
import { useEffect, useRef, useState } from 'react';
import { buildSession, pvpDeps } from '../game/bootstrap.js';
import { PvpController } from '../game/PvpController.js';
import * as PvpConnection from '../net/PvpConnection.js';
import { useGameStore } from '../stores/gameStore.js';
import { useUiStore } from '../stores/uiStore.js';
import Board3DCanvas from '../components/board/Board3DCanvas.js';
import Hud from '../components/hud/Hud.js';
import SynergyPanel from '../components/hud/SynergyPanel.js';
import PhaseControls from '../components/hud/PhaseControls.js';
import HandBar from '../components/hand/HandBar.js';
import { EndRoundOverlay, GameOverScreen } from '../components/overlays/Overlays.js';
import { Banner, Button } from '../components/ui/primitives.js';

const PREP_DURATION = 60;

export default function GameScreenPvp() {
  const [controller, setControllerLocal] = useState<PvpController | null>(null);
  const setController = useGameStore(s => s.setController);
  const reset = useGameStore(s => s.reset);
  const navigate = useUiStore(s => s.navigate);
  const deckName = useUiStore(s => s.params.deckName as string | undefined);

  useEffect(() => {
    const role = (PvpConnection as any).getRole() as 'A' | 'B' | null;
    if (!role) { navigate('online_lobby'); return; }
    const opponent = (PvpConnection as any).getOpponent()?.username ?? 'Adversaire';
    const session = buildSession(deckName, 'pvp');
    const ctrl = new PvpController(session, pvpDeps(), role, opponent);
    setControllerLocal(ctrl);
    setController(ctrl);
    ctrl.begin();
    return () => {
      ctrl.dispose();
      (PvpConnection as any).disconnect();
      setController(null);
      reset();
    };
    // Montage unique.
  }, []);

  if (!controller) return <div className="flex min-h-dvh items-center justify-center bg-surface text-white">Connexion au duel…</div>;

  return (
    <div className="relative h-dvh overflow-hidden bg-surface text-white" onPointerDown={() => useUiStore.getState().hideTooltip()}>
      <Board3DCanvas controller={controller} />
      <Hud />
      <SynergyPanel />
      <HandBar />
      <PhaseControls />
      <PvpHeader controller={controller} />
      <PrepTimer controller={controller} />
      <PvpBanners />
      <WaitingOverlay />
      <EndRoundOverlay />
      <GameOverScreen />
    </div>
  );
}

function PvpHeader({ controller }: { controller: PvpController }) {
  const opponent = useGameStore(s => s.pvpOpponent);
  return (
    <div className="pointer-events-auto absolute left-1/2 top-[max(3rem,calc(env(safe-area-inset-top)+2.5rem))] z-20 flex -translate-x-1/2 items-center gap-2">
      <span className="rounded-full border border-enemy/40 bg-surface/80 px-3 py-0.5 text-[11px] text-enemy">vs {opponent ?? '—'}</span>
      <Button className="px-2 py-0.5 text-[11px]" onPointerDown={() => controller.forfeit()}>Abandonner</Button>
    </div>
  );
}

// Timer de préparation : déclenche la poignée de main de combat à 0.
function PrepTimer({ controller }: { controller: PvpController }) {
  const round = useGameStore(s => s.round);
  const applySnapshot = useGameStore(s => s.applySnapshot);
  const remaining = useRef(PREP_DURATION);
  useEffect(() => {
    remaining.current = PREP_DURATION;
    applySnapshot({ prepRemaining: PREP_DURATION });
    const t = setInterval(() => {
      const s = useGameStore.getState();
      const active = s.phase === 'preparation' && !s.combatActive && !s.endRound && !s.pvpWaiting && !s.gameOver;
      if (!active) return;
      remaining.current -= 1;
      if (remaining.current <= 0) { clearInterval(t); applySnapshot({ prepRemaining: 0 }); controller.startCombat(); return; }
      applySnapshot({ prepRemaining: remaining.current });
    }, 1000);
    return () => clearInterval(t);
  }, [round, controller, applySnapshot]);
  return null;
}

function PvpBanners() {
  const errorFlash = useGameStore(s => s.errorFlash);
  const invocationBanner = useGameStore(s => s.invocationBanner);
  const combatActive = useGameStore(s => s.combatActive);
  if (errorFlash) return <Banner text={`⚠ ${errorFlash}`} tone="error" />;
  if (invocationBanner && !combatActive) return <Banner text={invocationBanner} />;
  return null;
}

function WaitingOverlay() {
  const waiting = useGameStore(s => s.pvpWaiting);
  const gameOver = useGameStore(s => s.gameOver);
  if (!waiting || gameOver) return null;
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-gold/40 bg-surface/95 px-6 py-5">
        <div className="text-2xl">⏳</div>
        <div className="animate-pulse text-sm text-white/70">En attente de l'adversaire…</div>
      </div>
    </div>
  );
}
