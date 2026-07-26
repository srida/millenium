/* eslint-disable @typescript-eslint/no-explicit-any */
// GameScreenPvp — variante Duel en ligne de GameScreen. Même shell (board 3D,
// HUD, main, cimetière, contrôles, Phase Shopping, overlays) mais piloté par
// PvpController. Ajoute la bannière adversaire, l'overlay d'attente (poignée de
// main réseau / résultat) et l'abandon.
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
import GameMenu from '../components/hud/GameMenu.js';
import HandBar from '../components/hand/HandBar.js';
import GraveyardTray from '../components/hand/GraveyardTray.js';
import { SummonOptionMenu, EndRoundOverlay, GameOverScreen } from '../components/overlays/Overlays.js';
import ShoppingLayer from '../components/shopping/ShoppingLayer.js';
import { Banner } from '../components/ui/primitives.js';
import { PREP_DURATION_S, SHOPPING_DURATION_S } from '../game/timings.js';

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
      setController(null);
      reset();
      // Ne fermer la socket PvP (singleton) QUE si on quitte réellement l'écran.
      // En dev, StrictMode démonte puis remonte ce composant : lors de ce
      // démontage transitoire, `screen` vaut toujours 'game_pvp' (aucune
      // navigation), donc on préserve la socket + le rôle. Les fermer ici
      // renverrait `getRole()===null` au remontage → rebond vers le lobby et
      // « adversaire déconnecté » côté opposant.
      if (useUiStore.getState().screen !== 'game_pvp') {
        (PvpConnection as any).disconnect();
      }
    };
    // Montage unique.
  }, []);

  if (!controller) return <div className="flex min-h-dvh items-center justify-center bg-surface text-white">Connexion au duel…</div>;

  return (
    <div className="relative h-dvh overflow-hidden bg-surface text-white" onPointerDown={() => useUiStore.getState().hideTooltip()}>
      <Board3DCanvas controller={controller} />
      <Hud />
      <SynergyPanel />
      <GraveyardTray />
      <HandBar />
      <PhaseControls />
      <PvpHeader />
      {/* Le chrono de préparation PvP n'est PAS gelé par le menu : l'adversaire
          attend à la barrière réseau, on ne peut pas le bloquer en l'ouvrant. */}
      <GameMenu onQuit={() => controller.forfeit()} quitLabel="Abandonner le duel" />
      <PrepTimer controller={controller} />
      <ShoppingTimer controller={controller} />
      <PvpBanners />
      <SummonOptionMenu />
      <WaitingOverlay />
      <EndRoundOverlay />
      <ShoppingLayer />
      <GameOverScreen />
    </div>
  );
}

// L'abandon vit dans le menu d'options (☰), avec confirmation : il était trop
// facile de le déclencher d'un doigt posé au mauvais endroit.
function PvpHeader() {
  const opponent = useGameStore(s => s.pvpOpponent);
  return (
    <div className="pointer-events-none absolute left-1/2 top-[max(3rem,calc(env(safe-area-inset-top)+2.5rem))] z-20 flex -translate-x-1/2 items-center gap-2">
      <span className="rounded-full border border-enemy/40 bg-surface/80 px-3 py-0.5 text-[11px] text-enemy">vs {opponent ?? '—'}</span>
    </div>
  );
}

// Timer de préparation : déclenche la poignée de main de combat à 0.
function PrepTimer({ controller }: { controller: PvpController }) {
  const round = useGameStore(s => s.round);
  const applySnapshot = useGameStore(s => s.applySnapshot);
  const remaining = useRef(PREP_DURATION_S);
  useEffect(() => {
    remaining.current = PREP_DURATION_S;
    applySnapshot({ prepRemaining: PREP_DURATION_S });
    const t = setInterval(() => {
      const s = useGameStore.getState();
      const active = s.phase === 'preparation' && !s.combatActive && !s.endRound && !s.shopping && !s.pvpWaiting && !s.gameOver;
      if (!active) return;
      remaining.current -= 1;
      if (remaining.current <= 0) { clearInterval(t); applySnapshot({ prepRemaining: 0 }); controller.startCombat(); return; }
      applySnapshot({ prepRemaining: remaining.current });
    }, 1000);
    return () => clearInterval(t);
  }, [round, controller, applySnapshot]);
  return null;
}

// Chrono de la Phase Shopping — spécifique au PvP. En solo rien ne presse, mais
// ici l'adversaire attend à la barrière réseau tant que je n'ai pas choisi : le
// choix est donc borné, et « passer » est automatique à 0.
function ShoppingTimer({ controller }: { controller: PvpController }) {
  const active = useGameStore(s => !!s.shopping);
  const [remaining, setRemaining] = useState(SHOPPING_DURATION_S);
  const skipped = useRef(false);

  useEffect(() => {
    if (!active) { skipped.current = false; setRemaining(SHOPPING_DURATION_S); return; }
    setRemaining(SHOPPING_DURATION_S);
    const t = setInterval(() => setRemaining(c => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Hors du render : `skipShopping` déclenche un setState dans le store.
  useEffect(() => {
    if (!active || remaining > 0 || skipped.current) return;
    skipped.current = true;
    controller.skipShopping();
  }, [active, remaining, controller]);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-50 -translate-x-1/2 rounded-full border border-gold/40 bg-surface/95 px-3 py-1 text-xs font-semibold tabular-nums text-gold">
      Shopping · {remaining}s
    </div>
  );
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
