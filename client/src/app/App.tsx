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
import MissionsScreen from '../screens/MissionsScreen.js';
import ShopScreen from '../screens/ShopScreen.js';
import GiftsScreen from '../screens/GiftsScreen.js';
import TutorialScreen from '../screens/TutorialScreen.js';
import TooltipHost from '../components/tooltip/TooltipHost.js';
import RewardToasts from '../components/ui/RewardToasts.js';
import { SpaceBackground } from '../components/ui/SpaceBackground.js';

/**
 * Écrans chargés à la demande. Ce ne sont pas les plus gros en lignes, ce sont
 * les seuls à tirer `three/Scene3D` — donc Three.js (≈ 560 Ko) tout entier.
 * Statiquement importés, ils le faisaient télécharger pour AFFICHER LE MENU :
 * un joueur qui ouvre la boutique, lit le codex ou consulte ses missions payait
 * le moteur 3D sans lancer une seule partie. Le chunk n'est désormais cherché
 * qu'au premier combat — bundle d'entrée 1 058 Ko → 447 Ko (295 → 133 Ko gzip).
 *
 * ⚠️ Tout nouvel écran qui importe `three/` doit rejoindre cette liste, sinon
 * il ramène Scene3D dans le chunk d'entrée et annule le découpage d'un coup.
 */
const GameScreen = lazy(() => import('../screens/GameScreen.js'));
const GameScreenPvp = lazy(() => import('../screens/GameScreenPvp.js'));
const CombatLab = lazy(() => import('../dev/CombatLab.js'));
const TestBench = lazy(() => import('../dev/TestBench.js'));

// Repli commun des quatre écrans différés. Volontairement nu : le décor spatial
// n'est pas monté sur ces écrans (cf. IMMERSIVE_SCREENS) et le chunk arrive en
// une fraction de seconde — un écran de chargement travaillé clignoterait.
const lazyFallback = (
  <div className="flex min-h-dvh items-center justify-center bg-surface text-white">Chargement…</div>
);

/**
 * Écrans qui posent leur propre décor plein cadre : le board 3D y occupe toute
 * la fenêtre, le ciel serait invisible — et une boucle rAF de plus pendant un
 * combat WebGL est une dépense pure. Partout ailleurs le fond est le même,
 * monté ICI plutôt que par chaque écran : une seule instance, donc une seule
 * boucle, et le ciel ne se réinitialise pas à chaque navigation.
 */
const IMMERSIVE_SCREENS = new Set(['game', 'game_pvp', 'testbench', 'combatlab']);

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
      {!IMMERSIVE_SCREENS.has(screen) && <SpaceBackground />}
      {/* Un seul `Suspense` pour tout le routage : les écrans chargés en
          statique ne suspendent jamais, seuls les quatre `lazy()` ci-dessus
          l'utilisent. Une frontière par écran différé ferait quatre copies du
          même repli, et il faudrait penser à en ajouter une au prochain. */}
      <Suspense fallback={lazyFallback}>
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
      {screen === 'gifts' && <GiftsScreen />}
      {screen === 'tutorial' && <TutorialScreen />}
      {screen === 'online_lobby' && <OnlineLobby />}
      {screen === 'game' && <GameScreen />}
      {screen === 'game_pvp' && <GameScreenPvp />}
      {screen === 'combatlab' && <CombatLab />}
      {screen === 'testbench' && <TestBench />}
      </Suspense>
      <TooltipHost />
      {/* Au-dessus des écrans : missions terminées, paliers hebdomadaires et
          niveaux gagnés s'y annoncent ensemble — la réponse arrive souvent une
          fois revenu au menu. */}
      <RewardToasts />
    </>
  );
}
