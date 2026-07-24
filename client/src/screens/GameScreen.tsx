// GameScreen — shell React autour du board 3D. Assemble HUD, main, cimetière,
// synergies, contrôles de phase, overlays. Possède le timer de préparation
// (60s → combat auto) ; toute la logique de jeu vit dans GameSession/GameController.
import { useEffect, useRef, useState } from 'react';
import { buildSession } from '../game/bootstrap.js';
import { GameController } from '../game/GameController.js';
import { useGameStore } from '../stores/gameStore.js';
import { useUiStore } from '../stores/uiStore.js';
import Board3DCanvas from '../components/board/Board3DCanvas.js';
import Hud from '../components/hud/Hud.js';
import SynergyPanel from '../components/hud/SynergyPanel.js';
import PhaseControls from '../components/hud/PhaseControls.js';
import HandBar from '../components/hand/HandBar.js';
import GraveyardTray from '../components/hand/GraveyardTray.js';
import { SummonOptionMenu, EndRoundOverlay, ShoppingOverlay, GameOverScreen } from '../components/overlays/Overlays.js';
import { Banner } from '../components/ui/primitives.js';

const PREP_DURATION = 60;

export default function GameScreen() {
  const [controller, setControllerLocal] = useState<GameController | null>(null);
  const setController = useGameStore(s => s.setController);
  const reset = useGameStore(s => s.reset);
  const deckName = useUiStore(s => s.params.deckName as string | undefined);

  useEffect(() => {
    const session = buildSession(deckName);
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
      <PrepTimer controller={controller} />
      <Banners />
      <SummonOptionMenu />
      <EndRoundOverlay />
      <ShoppingOverlay />
      <GameOverScreen />
    </div>
  );
}

// Timer de préparation : redémarre à chaque nouvelle manche, ne décompte que
// hors combat/overlay, déclenche le combat à 0.
function PrepTimer({ controller }: { controller: GameController }) {
  const round = useGameStore(s => s.round);
  const applySnapshot = useGameStore(s => s.applySnapshot);
  const remaining = useRef(PREP_DURATION);

  useEffect(() => {
    remaining.current = PREP_DURATION;
    applySnapshot({ prepRemaining: PREP_DURATION });
    const t = setInterval(() => {
      const s = useGameStore.getState();
      const prepActive = s.phase === 'preparation' && !s.combatActive && !s.endRound && !s.shopping && !s.gameOver;
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
  const shopping = useGameStore(s => s.shopping);
  const combatActive = useGameStore(s => s.combatActive);
  if (errorFlash) return <Banner text={`⚠ ${errorFlash}`} tone="error" />;
  if (shopping?.banner) return <Banner text={`✨ ${shopping.banner}`} />;
  if (invocationBanner && !combatActive) return <Banner text={invocationBanner} />;
  return null;
}
