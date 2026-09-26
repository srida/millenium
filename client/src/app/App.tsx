// Shell applicatif : initialise les databases (via /api), restaure la session
// (auth optionnelle, D2), route les écrans via uiStore (parité ?screen=), monte
// le TooltipHost global.
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { useUiStore, type ScreenName } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { initGameData } from '../game/bootstrap.js';
import MainMenu from '../screens/MainMenu.js';
import AuthScreen from '../screens/AuthScreen.js';
import ResetPasswordScreen from '../screens/ResetPasswordScreen.js';
import ProfileScreen from '../screens/ProfileScreen.js';
import DeckSelector from '../screens/DeckSelector.js';
import DeckBuilder from '../screens/DeckBuilder.js';
import TournamentScreen from '../screens/TournamentScreen.js';
import ArcadeScreen from '../screens/ArcadeScreen.js';
import OnlineLobby from '../screens/OnlineLobby.js';
import MissionsScreen from '../screens/MissionsScreen.js';
import ShopScreen from '../screens/ShopScreen.js';
import GiftsScreen from '../screens/GiftsScreen.js';
import CatalogScreen from '../screens/CatalogScreen.js';
import TutorialScreen from '../screens/TutorialScreen.js';
import TooltipHost from '../components/tooltip/TooltipHost.js';
import LinkedCardsModal from '../components/tooltip/LinkedCardsModal.js';
import RewardToasts from '../components/ui/RewardToasts.js';
import { SpaceBackground } from '../components/ui/SpaceBackground.js';
import { AppHeader } from '../components/nav/AppHeader.js';
import { AppFooter } from '../components/nav/AppFooter.js';
import { ScreenTransition } from '../components/nav/ScreenTransition.js';
import { BUTTON_BASE, Gauge, SHADOW_IDLE, SURFACE_GOLD } from '../components/ui/primitives.js';
import * as Audio from '../audio/AudioManager.js';

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
 * Les écrans de DEV la rejoignent aussi, pour une raison plus simple : personne
 * d'autre qu'un admin ne les ouvre.
 */
const GameScreen = lazy(() => import('../screens/GameScreen.js'));
const GameScreenPvp = lazy(() => import('../screens/GameScreenPvp.js'));
const CombatLab = lazy(() => import('../dev/CombatLab.js'));
const TestBench = lazy(() => import('../dev/TestBench.js'));
// ⚠️ Celui-ci n'importe PAS `three/` — il est différé pour l'autre raison : un
// écran de dev que seul un admin ouvre n'a rien à faire dans le chunk d'entrée.
const AiLab = lazy(() => import('../dev/AiLab.js'));

// Repli commun des écrans différés. Volontairement nu : le décor spatial
// n'est pas monté sur ces écrans (cf. IMMERSIVE_SCREENS) et le chunk arrive en
// une fraction de seconde — un écran de chargement travaillé clignoterait.
const lazyFallback = (
  <div className="flex min-h-dvh items-center justify-center bg-surface text-white">Chargement…</div>
);

/**
 * LE registre des écrans. `Record<ScreenName, …>` et non une chaîne de
 * `screen === '…' &&` : TypeScript vérifie l'exhaustivité, donc un nom ajouté à
 * `SCREEN_NAMES` sans composant en face ne compile pas. Le CLAUDE.md prévenait
 * qu'ajouter un écran se faisait « à deux endroits » ; il y en avait quatre, et
 * il n'en reste qu'un que le compilateur ne garde pas tout seul.
 */
const SCREENS: Record<ScreenName, ComponentType> = {
  main_menu: MainMenu,
  auth: AuthScreen,
  reset_password: ResetPasswordScreen,
  profile: ProfileScreen,
  deck_selector: DeckSelector,
  deck_builder: DeckBuilder,
  online_lobby: OnlineLobby,
  tournament: TournamentScreen,
  arcade: ArcadeScreen,
  missions: MissionsScreen,
  shop: ShopScreen,
  gifts: GiftsScreen,
  catalog: CatalogScreen,
  tutorial: TutorialScreen,
  game: GameScreen,
  game_pvp: GameScreenPvp,
  combatlab: CombatLab,
  testbench: TestBench,
  ailab: AiLab,
};

/**
 * Écrans qui posent leur propre décor plein cadre. Le board 3D en est le cas le
 * plus visible — il occupe toute la fenêtre, le ciel serait invisible, et une
 * boucle rAF de plus pendant un combat WebGL est une dépense pure — mais le
 * critère est bien « l'écran peint son propre fond plein cadre », pas « l'écran
 * a un canvas » : les bancs de dev le font avec un simple `bg-surface` sur une
 * racine `h-dvh`. Partout ailleurs le fond est le même, monté ICI plutôt que par
 * chaque écran : une seule instance, donc une seule boucle, et le ciel ne se
 * réinitialise pas à chaque navigation.
 *
 * Typé `ScreenName` et non `string` : une faute de frappe y passait sans bruit,
 * et l'écran concerné se retrouvait avec deux décors superposés.
 *
 * ⚠️ **L'INVARIANT** : un écran est SOIT dans ce set, SOIT sa racine porte
 * `relative z-10`. `.space-bg` est `position: fixed; z-index: 0` avec un fond
 * OPAQUE : dans l'ordre de peinture CSS, un descendant positionné à `z-index: 0`
 * passe APRÈS tous les descendants non positionnés — le décor recouvre donc
 * intégralement un écran dont la racine est statique. Et comme il est
 * `pointer-events: none`, l'écran reste tapable : invisible mais fonctionnel,
 * c'est-à-dire une panne qu'aucun contrôle du DOM ne voit (`innerText`, les
 * hauteurs de boîtes et `scrollWidth <= clientWidth` passent tous au vert).
 * `ailab` a été livré en violation de cet invariant et l'écran était vide.
 * Verrouillé par `client/src/test/ai-lab.test.ts`.
 *
 * Depuis `AppHeader`/`AppFooter`, tout écran NON immersif est de toute façon
 * enveloppé dans un conteneur qui porte `relative z-10` (ci-dessous) : la
 * racine `z-10` que chaque écran pose encore reste donc redondante mais
 * inoffensive, jamais la seule chose qui le protège du décor.
 */
const IMMERSIVE_SCREENS = new Set<ScreenName>(['game', 'game_pvp', 'testbench', 'combatlab', 'ailab']);

/**
 * Écrans dont l'entrée (`ScreenTransition`) reste SANS animation : ils
 * montent ~868 `Card3D` non virtualisés (tout le catalogue), et la mise en
 * calque de ce bloc avant de jouer le fondu ajoute un coût perceptible par
 *-dessus un rendu déjà lourd. `deck_builder` ouvre toujours sur son onglet
 * Bibliothèque (le même contenu) — cf. `DeckBuilder.tsx`, qui coupe de même
 * l'entrée de son onglet interne. Ce n'est qu'un pansement : la lenteur de
 * fond (rendu non virtualisé) reste entière, seule la transition est retirée.
 */
const NO_ENTRY_ANIM_SCREENS = new Set<ScreenName>(['catalog', 'deck_builder']);

export default function App() {
  const screen = useUiStore(s => s.screen);
  const Screen = SCREENS[screen];
  const restore = useAuthStore(s => s.restore);
  const [progress, setProgress] = useState(0);
  const [dataReady, setDataReady] = useState(false);
  // Franchi par un TAP explicite une fois les données (catalogues + sons)
  // chargées — cf. l'écran de chargement plus bas. C'est ce tap, et lui
  // seul, qui déclenche la toute première lecture audio : synchrone dans un
  // geste utilisateur, il satisfait même les navigateurs les plus stricts
  // (Safari) là où un `play()` lancé après coup, une fois les données prêtes
  // mais sans geste EN COURS, pouvait rester bloqué sans un mot — la musique
  // de menu qui « ne se lance pas toujours ».
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Données de jeu = bloquant ; restauration de session = best-effort en parallèle.
    restore();
    initGameData(setProgress).then(() => setDataReady(true)).catch(e => setError(String(e)));
  }, [restore]);

  // Filet de rattrapage, permanent (PAS `{ once: true }`) : le tap d'entrée
  // (`onClick`, ci-dessous) est le geste normal qui débloque l'audio, mais si
  // ce tout premier `play()` restait quand même muet sur un appareil qu'on
  // n'a pas pu tester, `Audio.unlock()` retente la piste en pause à CHAQUE
  // clic qui suit, n'importe où dans l'appli — c'est ce qui explique
  // pourquoi la musique « redevient audible » dès qu'un bouton quelconque est
  // cliqué en cours de partie. Idempotent et bon marché : sans rien à
  // rattraper, il ne fait rien.
  useEffect(() => {
    const onClick = () => Audio.unlock();
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  // Coupe la musique quand l'onglet/l'appli passe en arrière-plan (change
  // d'onglet, mise en veille, PWA envoyée en fond) — sans ça une PWA
  // installée peut continuer à jouer du son hors champ (constaté sur
  // Android, qui autorise la lecture en fond une fois qu'une page en a
  // joué). Reprend automatiquement au retour, exactement où c'était.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) Audio.suspendForBackground();
      else Audio.resumeFromBackground();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Musique des MENUS — un seul emplacement (`menu`, cf. `sound-schema.mjs`) :
  // menu principal, connexion et tous les autres menus le partagent, la
  // variété venant du nombre de pistes catalogué plutôt que d'emplacements
  // séparés. La partie en cours (`game`/`game_pvp`) règle la sienne elle-même
  // depuis `GameController` (thème de partie verrouillé par match) : cet
  // effet n'y touche pas.
  //
  // ⚠️ Dépend d'`entered`, pas de `dataReady` : le premier `setMusicTheme`
  // part déjà dans le `onPointerDown` du bouton d'entrée (synchrone, dans le
  // geste), donc CET effet-ci n'a plus qu'à suivre les changements d'écran
  // une fois entré — il ne fait que confirmer un thème déjà en cours (NO-OP)
  // sauf navigation réelle entre deux emplacements.
  useEffect(() => {
    if (!entered) return;
    if (screen === 'game' || screen === 'game_pvp') return;
    Audio.setMusicTheme('menu');
  }, [screen, entered]);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-surface p-6 text-center text-white">
        <p className="font-semibold text-danger">Impossible de charger les données de jeu</p>
        <p className="text-xs text-white/50">Le serveur Express (port 3742) est-il démarré ?</p>
        <p className="text-[10px] text-white/30">{error}</p>
      </div>
    );
  }

  if (!dataReady || !entered) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-surface px-6 text-gold">
        <img src="/logo.png" alt="Millenium" className="h-24 w-24 object-contain" />
        {dataReady ? (
          // ⚠️ Un `<button>` NU, PAS le `Button` du jeu : celui-ci retarde son
          // `onPointerDown` de `SQUASH_DELAY_MS` (`usePressSquash`, le temps de
          // course de l'enfoncement) — un `setTimeout`, même de 45 ms, sort le
          // `play()` du tour d'exécution SYNCHRONE du geste natif, et les
          // navigateurs stricts refusent alors la lecture SANS un mot.
          //
          // ⚠️ `onClick`, PAS `onPointerDown` : Safari mobile applique à
          // `<audio>.play()` (mais pas à un `AudioContext` déjà démarré, d'où
          // les sons du jeu qui, eux, fonctionnaient déjà) une politique plus
          // stricte que Chrome desktop, qui ne reconnaît pas forcément
          // `pointerdown`/`touchstart` (déclenché AVANT que le doigt ne quitte
          // l'écran) comme un « vrai » geste d'activation — seul `click`
          // (synthétisé APRÈS le relâchement, sur mobile comme au clic souris)
          // est reconnu de façon fiable sur toutes les plateformes. C'est très
          // exactement pourquoi la musique restait muette au premier lancement
          // SUR MOBILE SEULEMENT, et redevenait audible dès qu'un vrai clic
          // avait eu lieu ailleurs (n'importe quel bouton en cours de partie).
          // `click` reste SYNCHRONE (pas de `setTimeout` sur ce chemin), donc
          // la leçon ci-dessus tient toujours.
          <button
            type="button"
            className={`${BUTTON_BASE} ${SURFACE_GOLD} ${SHADOW_IDLE} min-w-40 justify-center text-base text-gold hover:brightness-110`}
            onClick={() => { Audio.unlock(); Audio.setMusicTheme('menu'); setEntered(true); }}
          >
            Appuyer pour commencer
          </button>
        ) : (
          <>
            <p>Chargement…</p>
            <Gauge value={progress} className="h-2 w-56" fillClassName="bg-gold" />
          </>
        )}
      </div>
    );
  }

  const immersive = IMMERSIVE_SCREENS.has(screen);

  return (
    <>
      {!immersive && <SpaceBackground />}
      {/* Un seul `Suspense` pour tout le routage : les écrans chargés en
          statique ne suspendent jamais, seuls les `lazy()` ci-dessus
          l'utilisent. Une frontière par écran différé ferait quatre copies du
          même repli, et il faudrait penser à en ajouter une au prochain.
          `AppHeader` / `AppFooter` sont communs à toutes les pages
          non-immersives (partie en cours, bancs de dev) : un seul endroit
          les rend, plutôt que chaque écran secondaire. */}
      {immersive ? (
        <Suspense fallback={lazyFallback}>
          <Screen />
        </Suspense>
      ) : (
        <div className="relative z-10 flex h-[var(--app-h,100dvh)] flex-col text-white">
          <AppHeader />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={lazyFallback}>
              <ScreenTransition screenKey={screen} animate={!NO_ENTRY_ANIM_SCREENS.has(screen)}>
                <Screen />
              </ScreenTransition>
            </Suspense>
          </div>
          <AppFooter />
        </div>
      )}
      <TooltipHost />
      {/* Le panneau « Cartes liées » (🧬), ouvert depuis le tooltip d'une
          carte : même patron que TooltipHost, une instance globale pilotée
          par uiStore plutôt qu'un état par écran. */}
      <LinkedCardsModal />
      {/* Au-dessus des écrans : missions terminées, paliers hebdomadaires et
          niveaux gagnés s'y annoncent ensemble — la réponse arrive souvent une
          fois revenu au menu. */}
      <RewardToasts />
    </>
  );
}
