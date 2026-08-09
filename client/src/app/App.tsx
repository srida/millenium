// Shell applicatif : initialise les databases (via /api), restaure la session
// (auth optionnelle, D2), route les écrans via uiStore (parité ?screen=), monte
// le TooltipHost global.
import { lazy, Suspense, useEffect, useState } from 'react';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { initGameData } from '../game/bootstrap.js';
import MainMenu from '../screens/MainMenu.js';
import AuthScreen from '../screens/AuthScreen.js';
import ResetPasswordScreen from '../screens/ResetPasswordScreen.js';
import ProfileScreen from '../screens/ProfileScreen.js';
import FriendsScreen from '../screens/FriendsScreen.js';
import DeckSelector from '../screens/DeckSelector.js';
import DeckBuilder from '../screens/DeckBuilder.js';
import TournamentScreen from '../screens/TournamentScreen.js';
import ArcadeScreen from '../screens/ArcadeScreen.js';
import OnlineLobby from '../screens/OnlineLobby.js';
import GameScreen from '../screens/GameScreen.js';
import GameScreenPvp from '../screens/GameScreenPvp.js';
import MissionsScreen from '../screens/MissionsScreen.js';
import ShopScreen from '../screens/ShopScreen.js';
import TutorialScreen from '../screens/TutorialScreen.js';
import TooltipHost from '../components/tooltip/TooltipHost.js';
import MissionToasts from '../components/ui/MissionToasts.js';

const CombatLab = lazy(() => import('../dev/CombatLab.js'));
const TestBench = lazy(() => import('../dev/TestBench.js'));

export default function App() {
  const screen = useUiStore(s => s.screen);
  const restore = useAuthStore(s => s.restore);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Données de jeu = bloquant ; restauration de session = best-effort en parallèle.
    restore();
    initGameData().then(() => setReady(true)).catch(e => setError(String(e)));
  }, [restore]);

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
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface text-gold">
        <img src="/logo.png" alt="Millenium" className="h-24 w-24 object-contain" />
        <p>Chargement…</p>
      </div>
    );
  }

  return (
    <>
      {screen === 'main_menu' && <MainMenu />}
      {screen === 'auth' && <AuthScreen />}
      {screen === 'reset_password' && <ResetPasswordScreen />}
      {screen === 'profile' && <ProfileScreen />}
      {screen === 'friends' && <FriendsScreen />}
      {screen === 'deck_selector' && <DeckSelector />}
      {screen === 'deck_builder' && <DeckBuilder />}
      {screen === 'tournament' && <TournamentScreen />}
      {screen === 'arcade' && <ArcadeScreen />}
      {screen === 'missions' && <MissionsScreen />}
      {screen === 'shop' && <ShopScreen />}
      {screen === 'tutorial' && <TutorialScreen />}
      {screen === 'online_lobby' && <OnlineLobby />}
      {screen === 'game' && <GameScreen />}
      {screen === 'game_pvp' && <GameScreenPvp />}
      {screen === 'combatlab' && (
        <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-surface text-white">Chargement…</div>}>
          <CombatLab />
        </Suspense>
      )}
      {screen === 'testbench' && (
        <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-surface text-white">Chargement…</div>}>
          <TestBench />
        </Suspense>
      )}
      <TooltipHost />
      {/* Au-dessus des écrans : le lot d'événements part en fin de partie et la
          réponse arrive souvent une fois revenu au menu. */}
      <MissionToasts />
    </>
  );
}
