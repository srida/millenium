// Router SPA minimaliste
const SCREENS = {
  main_menu:    () => import('./ui/screens/MainMenu.js'),
  deck_selector: () => import('./ui/screens/DeckSelector.js'),
  deck_builder:  () => import('./ui/screens/DeckBuilder.js'),
  testbench3d:   () => import('./ui/screens/TestBench3D.js'),
  game3d:        () => import('./ui/screens/GameScreen3D.js'),
  online_lobby:  () => import('./ui/screens/OnlineLobby.js'),
  tournament:    () => import('./ui/screens/TournamentScreen.js'),
  auth:          () => import('./ui/screens/AuthScreen.js'),
  profile:       () => import('./ui/screens/ProfileScreen.js'),
  friends:       () => import('./ui/screens/FriendsScreen.js'),
  resetpwd:      () => import('./ui/screens/ResetPasswordScreen.js'),
};

const container = document.getElementById('screen');
let currentScreen = null;
let currentModule = null;

export async function navigate(screenName, params = {}) {
  if (!SCREENS[screenName]) throw new Error(`Unknown screen: ${screenName}`);
  currentModule?.unmount?.();
  container.innerHTML = '';
  currentScreen = screenName;
  const mod = await SCREENS[screenName]();
  currentModule = mod;
  await mod.mount(container, params);
}

// Bootstrap
// Permet d'ouvrir un écran directement via l'URL, ex: /?screen=deck_builder&publicDeckId=PUBLIC_DECK_001
const initialParams = new URLSearchParams(window.location.search);
const initialScreen = initialParams.get('screen');

async function bootstrap() {
  // Réinitialisation de mot de passe : accessible sans session.
  if (initialScreen === 'resetpwd') {
    navigate('resetpwd', Object.fromEntries(initialParams));
    return;
  }

  // Connexion obligatoire : on résout d'abord la session. Sans session valide,
  // le joueur est envoyé sur la page de login et ne peut pas entrer dans le jeu.
  // Cap dur de 4s pour ne pas bloquer sur un serveur injoignable (→ page login).
  const AuthClient = await import('./data/AuthClient.js');
  let user = null;
  try {
    user = await Promise.race([
      AuthClient.me(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
    ]);
  } catch { user = null; }

  if (!user) { navigate('auth'); return; }

  // Connecté : synchronise les decks du compte avant le premier écran, sans
  // bloquer plus de 2s si le réseau traîne.
  try {
    const DeckRepository = await import('./data/DeckRepository.js');
    await Promise.race([DeckRepository.pull(), new Promise(r => setTimeout(r, 2000))]);
  } catch { /* ignore */ }

  if (initialScreen && SCREENS[initialScreen]) {
    navigate(initialScreen, Object.fromEntries(initialParams));
  } else {
    navigate('main_menu');
  }
}

bootstrap();
