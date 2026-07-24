// Shell applicatif : initialise les databases (via /api), route les écrans via
// uiStore (parité ?screen=), monte le TooltipHost global. Le vrai DeckBuilder /
// auth arrivent en Phases 5/7.
import { lazy, Suspense, useEffect, useState } from 'react';
import { useUiStore } from '../stores/uiStore.js';
import { initGameData } from '../game/bootstrap.js';
import MainMenu from '../screens/MainMenu.js';
import GameScreen from '../screens/GameScreen.js';
import TooltipHost from '../components/tooltip/TooltipHost.js';

const CombatLab = lazy(() => import('../dev/CombatLab.js'));

export default function App() {
  const screen = useUiStore(s => s.screen);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initGameData().then(() => setReady(true)).catch(e => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-surface p-6 text-center text-white">
        <p className="font-semibold text-danger">Impossible de charger les données de jeu</p>
        <p className="text-xs text-white/50">Le serveur Express (port 3742) est-il démarré ?</p>
        <p className="text-[10px] text-white/30">{error}</p>
      </div>
    );
  }

  if (!ready) {
    return <div className="flex min-h-dvh items-center justify-center bg-surface text-gold">Chargement…</div>;
  }

  return (
    <>
      {screen === 'main_menu' && <MainMenu />}
      {screen === 'game' && <GameScreen />}
      {screen === 'combatlab' && (
        <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-surface text-white">Chargement…</div>}>
          <CombatLab />
        </Suspense>
      )}
      <TooltipHost />
    </>
  );
}
