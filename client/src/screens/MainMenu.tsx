// MainMenu — hub : jouer, tournoi, entraînement, gérer ses decks, se connecter /
// déconnecter (auth optionnelle, D2). Lien dev vers le CombatLab.
//
// Sans scroll dans les deux orientations (téléphone ET tablette) : la racine
// est `h-dvh` + `overflow-hidden`, trois zones fixes (en-tête, bloc logo,
// pile d'actions) puis le dock des raccourcis. `useWebLayout` (même seuil que
// `Scene3D._cameraFraming`) fait basculer le dock d'une barre basse (portrait)
// à un rail droit (paysage — desktop, tablette, téléphone tourné), et la pile
// d'actions d'une colonne à une ligne [carte Jouer | grille 2×2 des modes].
// Sur tablette (`sm:`), le logo cesse de grandir et cède la place à la pile
// d'actions, bornée et centrée — sinon le portail écrase les boutons.
//
// C'est ICI que se choisit le deck du joueur : la pastille du deck actif, en
// coiffe du bouton « Jouer » (`PlayCard`), est le seul accès à « Mes decks »
// (DeckSelector, mode 'manage') — elle affiche déjà avec quoi on joue, un
// bouton dédié en plus ferait doublon. Le deck actif sert dans tous les modes :
// « Jouer » (le duel en ligne) et le Tournoi entrent donc directement, et seul
// « Entraînement » ouvre le sélecteur, pour le seul deck de l'IA.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useDeckStore } from '../stores/deckStore.js';
import { useMissionStore, hasUnseenMissions, claimableCount } from '../stores/missionStore.js';
import { useShopStore, hasUnseenShop } from '../stores/shopStore.js';
import { useGiftStore, claimableCount as claimableGifts } from '../stores/giftStore.js';
import { useArcadeStore } from '../stores/arcadeStore.js';
import { getProgress, shouldInvite, updateProgress } from '../data/tutorialProgress.js';
import { Button, CountBadge, Modal, NewDot, usePressSquash } from '../components/ui/primitives.js';
import { AnimatedLogo } from '../components/ui/AnimatedLogo.js';
import { ProgressionPills, ProfilePill } from '../components/ui/ProgressionStats.js';
import { FullscreenButton } from '../components/system/DeviceGuards.js';
import { AppVersion } from '../components/system/AppVersion.js';
import { useWebLayout } from '../components/system/useWebLayout.js';

// Taille des boutons de mode (Tutoriel, Tournoi, Entraînement, Arcade) :
// rehaussée en portrait téléphone (44px de base se lisait comme un menu
// secondaire), puis un cran de plus sur tablette (`sm:`).
const MENU_BUTTON_SIZE = 'min-h-12 text-base sm:min-h-[58px]';

export default function MainMenu() {
  const web = useWebLayout();
  // Distingue téléphone paysage de tablette paysage : au même seuil `web`, le
  // premier loge le logo dans un rail à gauche (écran court, la place manque
  // en haut), le second garde le logo au-dessus de la pile d'actions.
  //
  // ⚠️ La LARGEUR seule ne tranche pas : un iPhone en paysage (852) est plus
  // large qu'un iPad en PORTRAIT (820). C'est la HAUTEUR qui distingue les
  // deux — courte sur téléphone quelle que soit l'orientation, jamais sous
  // ~700px sur tablette — d'où les deux bornes conjointes.
  const isTabletDevice = useMediaQuery('(min-width: 700px) and (min-height: 700px)');
  const user = useAuthStore(s => s.user);
  const [devOpen, setDevOpen] = useState(false);
  // Boutons dev derrière l'appui long sur la version — ils ne comptent plus
  // dans la hauteur du menu, qui doit tenir sans scroll.
  const openDevMenu = () => { if (user?.is_admin) setDevOpen(true); };

  return (
    <main className="relative z-10 flex h-dvh flex-col gap-2 overflow-hidden px-10 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white sm:px-2">
      {/* En portrait téléphone, la place manque pour le loger dans l'en-tête
          (déjà plein : profil, niveau, or, gemmes) — il flotte alors sous
          l'en-tête. À partir de `sm:` (paysage, tablette), il rejoint l'en-tête. */}
      <FullscreenButton className="absolute right-3 top-[calc(env(safe-area-inset-top)+3.25rem)] sm:hidden" />

      {web && !isTabletDevice ? (
        // Téléphone paysage : logo + version en rail gauche (plus de place en
        // haut pour l'en-tête et la ligne d'actions), dock en rail droit.
        <div className="flex min-h-0 flex-1 gap-3">
          <LogoRail isAdmin={!!user?.is_admin} onVersionLongPress={openDevMenu} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <MenuHeader className="w-full" />
            <div className="flex min-h-0 flex-1 items-stretch gap-3">
              <PlayCard className="min-w-0 flex-[1.15]" />
              <div className="grid h-full flex-1 grid-cols-2 grid-rows-2 gap-2">
                <TutorialButton className="h-full w-full" />
                <TournamentButton className="h-full w-full" />
                <TrainingButton className="h-full w-full" />
                <ArcadeButton className="h-full w-full" />
              </div>
            </div>
          </div>
          <Dock web>
            <MissionsTile />
            <ShopTile />
            <GiftsTile />
            <CatalogTile />
          </Dock>
        </div>
      ) : web ? (
        // Tablette paysage : logo au-dessus de la ligne d'actions, comme en
        // portrait, mais celle-ci se scinde [carte Jouer | grille 2×2].
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <MenuHeader className="w-full" />
            <LogoBlock grow={false} isAdmin={!!user?.is_admin} onVersionLongPress={openDevMenu} />
            <div className="flex min-h-0 flex-1 items-stretch gap-3 sm:max-w-[820px] sm:max-h-[190px]">
              <PlayCard className="min-w-0 flex-[1.15]" />
              <div className="grid h-full flex-1 grid-cols-2 grid-rows-2 gap-2">
                <TutorialButton className="h-full w-full" />
                <TournamentButton className="h-full w-full" />
                <TrainingButton className="h-full w-full" />
                <ArcadeButton className="h-full w-full" />
              </div>
            </div>
          </div>
          <Dock web>
            <MissionsTile />
            <ShopTile />
            <GiftsTile />
            <CatalogTile />
          </Dock>
        </div>
      ) : (
        <>
          <MenuHeader />
          <LogoBlock grow isAdmin={!!user?.is_admin} onVersionLongPress={openDevMenu} />
          <div className="flex flex-col gap-2.5 sm:mx-auto sm:w-full sm:max-w-[470px] sm:flex-1 sm:justify-center">
            <PlayCard />
            <TutorialButton />
            <div className="flex gap-2">
              <TournamentButton className="flex-1" />
              <TrainingButton className="flex-1" />
            </div>
            <ArcadeButton />
          </div>
          <Dock web={false}>
            <MissionsTile />
            <ShopTile />
            <GiftsTile />
            <CatalogTile />
          </Dock>
        </>
      )}

      <DevMenu open={devOpen} onClose={() => setDevOpen(false)} />
      <TutorialInvite />
    </main>
  );
}

// Même patron que `useWebLayout`, sur une requête média arbitraire — pour
// distinguer téléphone et tablette à l'intérieur d'un même mode (paysage,
// ici), ce que l'aspect ratio seul ne peut pas trancher.
function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return match;
}

// En-tête : identité à gauche (profil ou invite à se connecter), progression
// à droite. Même pastilles qu'`ScreenHeader` (niveau + or + gemmes), mais
// TOUJOURS visibles ici — contrairement aux écrans secondaires, l'accueil n'a
// ni bouton retour ni titre à défendre, la place ne manque qu'aux détails fins
// (cf. le repli `sm:` dans `ProgressionPills`).
function MenuHeader({ className = '' }: { className?: string }) {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);

  return (
    // `text-xs` : les marges élargies du portrait téléphone (cf. `<main>`)
    // laissent peu de place pour profil + niveau + or + gemmes sur une seule
    // ligne — la police redescend d'un cran, `sm:` la rend à sa taille.
    <div className={`flex min-h-tap shrink-0 items-center gap-2 text-xs sm:text-sm ${className}`}>
      {user ? (
        <>
          <ProfilePill user={user} compact onPointerDown={() => navigate('profile')} />
          {user.is_admin && (
            <a href="/admin" className="hidden text-xs text-white/70 underline sm:inline">Admin</a>
          )}
        </>
      ) : (
        <button
          type="button"
          onPointerDown={() => navigate('auth')}
          className="flex min-h-tap items-center rounded-full border border-dashed border-gold/60 px-3 text-xs font-semibold text-gold active:opacity-80"
        >
          Connexion
        </button>
      )}
      <div className="flex-1" />
      {user && <ProgressionPills user={user} onOpen={() => navigate('profile')} />}
      <FullscreenButton className="hidden sm:flex" />
    </div>
  );
}

/**
 * Logo + version, seuls occupants du bloc. La version REMPLACE l'ancien
 * sous-titre (« Auto-battler tactique ») et sert aussi de zone d'appui long
 * pour les outils dev — elle est donc le seul footer du menu.
 *
 * `grow` : en portrait téléphone, ce bloc est la zone `flex-1` qui absorbe la
 * hauteur disponible (le logo grandit). Sur tablette portrait (`sm:`), c'est
 * la pile d'actions qui devient `flex-1` à la place — le logo, lui, revient à
 * sa taille naturelle et rétrécit ( `sm:w-[min(7rem,16dvh)]`), sinon il écrase
 * les boutons (cf. discussion design). En paysage tablette, `grow` est
 * toujours faux et le même rétrécissement s'applique : c'est la ligne [carte
 * Jouer | grille] qui absorbe l'espace. Le téléphone paysage n'utilise pas ce
 * bloc (cf. `LogoRail`).
 *
 * `isAdmin` : pose un point doré à côté de la version — le seul indice que
 * l'appui long y ouvre les outils dev. Sans lui, rien ne distingue la version
 * d'un texte inerte, admin ou pas.
 */
function LogoBlock({ grow, isAdmin, onVersionLongPress }: { grow: boolean; isAdmin: boolean; onVersionLongPress: () => void }) {
  const longPress = useLongPress(onVersionLongPress);
  return (
    <div className={`flex flex-col items-center justify-center gap-0.5 ${grow ? 'flex-1 sm:flex-none' : 'flex-none'}`}>
      {/* Largeur bornée par la hauteur disponible (`26dvh`) autant que par une
          taille maximale (`11rem`) : c'est elle qui fait tenir le logo sans
          scroll quand l'écran est court. Sur tablette (`sm:`), les deux bornes
          descendent : la pile d'actions a besoin de la place. */}
      <AnimatedLogo className="w-[min(11rem,26dvh)] sm:w-[min(7rem,16dvh)]" />
      <div {...longPress} className="-mt-2 flex select-none items-center gap-1">
        <AppVersion />
        {isAdmin && <NewDot label="Outils dev (appui long)" />}
      </div>
    </div>
  );
}

// Rail gauche du téléphone paysage : logo + version posés à côté de l'en-tête
// et de la ligne d'actions plutôt qu'au-dessus — l'écran est trop court pour
// leur laisser une ligne à eux. ~1/4 de la largeur de l'écran (`25vw`) : assez
// présent pour rester le repère visuel du menu même relégué sur le côté.
function LogoRail({ isAdmin, onVersionLongPress }: { isAdmin: boolean; onVersionLongPress: () => void }) {
  const longPress = useLongPress(onVersionLongPress);
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-0.5">
      <AnimatedLogo className="w-[25vw]" />
      <div {...longPress} className="-mt-2 flex select-none items-center gap-1">
        <AppVersion />
        {isAdmin && <NewDot label="Outils dev (appui long)" />}
      </div>
    </div>
  );
}

// Appui long générique (bouton dev caché derrière la version). Même
// convention que `usePressSquash` : un `clearTimer` redéclaré à chaque rendu,
// nettoyé au démontage — il ne dépend que de la `ref`, jamais périmé.
function useLongPress(onLongPress: () => void, ms = 550) {
  const timer = useRef<number | null>(null);
  const clearTimer = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clearTimer, []);
  return {
    onPointerDown: () => { clearTimer(); timer.current = window.setTimeout(onLongPress, ms); },
    onPointerUp: clearTimer,
    onPointerLeave: clearTimer,
    onPointerCancel: clearTimer,
  };
}

// Les trois écrans de dev, révélés par l'appui long sur la version plutôt que
// posés en permanence : ils ne comptent plus dans la hauteur du menu.
function DevMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useUiStore(s => s.navigate);
  if (!open) return null;
  const go = (screen: 'testbench' | 'combatlab' | 'ailab') => { onClose(); navigate(screen); };
  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-2">
        <p className="text-center text-[10px] tracking-widest text-white/40">OUTILS DEV</p>
        <Button className="w-full text-xs opacity-70" onPointerDown={() => go('testbench')}>TestBench</Button>
        <Button className="w-full text-xs opacity-70" onPointerDown={() => go('combatlab')}>CombatLab</Button>
        <Button className="w-full text-xs opacity-70" onPointerDown={() => go('ailab')}>Labo IA</Button>
      </div>
    </Modal>
  );
}

// Carte « Jouer » : la pastille du deck actif en coiffe du bouton primaire,
// dans un même conteneur bordé — c'est l'intégration retenue (2b) pour que le
// deck avec lequel on va jouer soit visible au-dessus du geste qui lance la
// partie, sans lui faire concurrence pour l'espace.
function PlayCard({ className = '' }: { className?: string }) {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const decks = useDeckStore(s => s.decks);
  const activeDeck = useDeckStore(s => s.activeDeck);
  const refresh = useDeckStore(s => s.refresh);

  useEffect(() => { refresh(); }, [refresh]);

  const deck = activeDeck ? decks.find(d => d.name === activeDeck) ?? null : null;
  const hex = deck?.color ?? '#a86ee7';

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border ${deck ? 'border-gold/40' : 'border-dashed border-gold/60'} ${className}`}>
      <button
        type="button"
        onPointerDown={() => navigate('deck_selector', { mode: 'manage' })}
        className="flex min-h-tap items-center gap-2 border-b border-line bg-surface-raised/80 px-3 py-2 backdrop-blur active:opacity-80"
      >
        <span
          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={deck ? { background: hex, boxShadow: `0 0 8px -1px ${hex}` } : { background: 'transparent', border: '1px solid rgba(255,255,255,0.3)' }}
        />
        {deck ? (
          <>
            <span className="max-w-[9rem] truncate font-semibold text-white">{deck.name}</span>
            <span className={`tabular-nums ${deck.count >= 20 ? 'text-success' : 'text-gold'}`}>{deck.count}</span>
          </>
        ) : (
          <span className="font-semibold text-gold">Choisir un deck</span>
        )}
        <span className="ml-auto flex-shrink-0 text-xs text-white/40">changer ›</span>
      </button>
      {/* « Jouer » est le duel en ligne : c'est le mode principal, il prend
          donc le bouton primaire. Il joue le deck actif, sans sélection en
          amont — d'où l'entrée directe (ou l'inscription en invité). */}
      <Button
        variant="primary"
        className="min-h-14 flex-1 justify-center rounded-none border-0 border-t border-t-gold/30 text-lg sm:min-h-[70px]"
        onPointerDown={() => navigate(user ? 'online_lobby' : 'auth')}
      >
        Jouer
      </Button>
    </div>
  );
}

// Accès au tutoriel. Rendu pour TOUT LE MONDE, invités compris — contrairement
// aux Missions et à la Boutique, qui ont besoin d'un compte. C'est précisément
// le joueur sans compte qu'il s'agit d'accueillir, et la progression du
// tutoriel vit en localStorage, sans identifiant.
function TutorialButton({ className = '' }: { className?: string }) {
  const navigate = useUiStore(s => s.navigate);
  const [read, setRead] = useState(0);

  // Lu au montage plutôt qu'au rendu : le retour du tutoriel remonte le menu,
  // et le compteur doit refléter ce qui vient d'être parcouru.
  useEffect(() => { setRead(getProgress().chapters.length); }, []);

  return (
    <Button className={`w-full ${MENU_BUTTON_SIZE} ${className}`} onPointerDown={() => navigate('tutorial')}>
      <span className="whitespace-nowrap">🎓 Tutoriel</span>
      {read === 0 && <NewDot label="Jamais ouvert" />}
    </Button>
  );
}

function TournamentButton({ className = '' }: { className?: string }) {
  const navigate = useUiStore(s => s.navigate);
  return <Button className={`${MENU_BUTTON_SIZE} ${className}`} onPointerDown={() => navigate('tournament')}>🏆 Tournoi</Button>;
}

// Entraînement = la partie solo contre l'IA. Seul mode qui ouvre encore le
// sélecteur, et uniquement pour choisir le deck adverse.
function TrainingButton({ className = '' }: { className?: string }) {
  const navigate = useUiStore(s => s.navigate);
  return <Button className={`${MENU_BUTTON_SIZE} ${className}`} onPointerDown={() => navigate('deck_selector', { mode: 'play' })}>🤖 Entraînement</Button>;
}

// Invitation du tout premier lancement — une seule fois, jamais reproposée.
// Un nouveau joueur ne sait pas qu'un tutoriel existe, et il ne le cherchera
// pas : c'est le seul moment où l'interrompre est légitime.
function TutorialInvite() {
  const navigate = useUiStore(s => s.navigate);
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(shouldInvite()); }, []);

  if (!open) return null;

  const close = () => { updateProgress({ dismissed: true }); setOpen(false); };

  return (
    <Modal onClose={close}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="text-4xl" aria-hidden>🎓</div>
        <div className="text-lg font-bold text-gold">Première partie ?</div>
        <p className="text-sm leading-relaxed text-white/70">
          Millenium est un auto-battler : tu prépares un board, puis le combat se résout tout seul.
          Le tutoriel explique les règles, te fait jouer une partie guidée et t'aide à construire ton premier deck.
        </p>
        <Button
          variant="primary"
          className="w-full"
          onPointerDown={() => { updateProgress({ dismissed: true }); setOpen(false); navigate('tutorial'); }}
        >
          ▸ Commencer le tutoriel
        </Button>
        <button onPointerDown={close} className="text-xs text-white/50 underline">Plus tard</button>
      </div>
    </Modal>
  );
}

// Arcade : la run solo du jour. Deux pastilles qui ne disent pas la même chose,
// et toutes deux DÉRIVÉES de l'instantané serveur — pas de localStorage « déjà
// vu » ici, contrairement aux Missions et à la Boutique : ce n'est pas une
// nouveauté qu'on signale, c'est un état de jeu.
//
//   - pastille VERTE = une run est en cours, il reste des duels à jouer. C'est
//     l'appel le plus fort : quelque chose est engagé et attend.
//   - point DORÉ = la run du jour n'est pas encore lancée.
//   - rien quand la journée est soldée (parcours complet ou run perdue).
//
// Rien n'est rendu en invité : la run est gardée côté serveur, elle a besoin
// d'un compte. Le bouton renvoie alors vers l'inscription, comme « Jouer ».
function ArcadeButton({ className = '' }: { className?: string }) {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  // ⚠️ L'ID, jamais l'objet : `user` change d'IDENTITÉ à chaque réponse qui
  //    porte une progression, et une lecture forcée en dépendance d'un objet
  //    qu'elle fait elle-même changer boucle sans fin (cf. authStore).
  const userId = user?.id ?? null;
  const snapshot = useArcadeStore(s => s.snapshot);
  const load = useArcadeStore(s => s.load);

  useEffect(() => { if (userId) void load(true); }, [userId, load]);

  if (!user) {
    return (
      <Button className={`w-full ${MENU_BUTTON_SIZE} ${className}`} onPointerDown={() => navigate('auth')}>
        <span className="whitespace-nowrap">🕹 Arcade</span>
      </Button>
    );
  }

  const run = snapshot?.run ?? null;
  const running = run?.status === 'in_progress';
  const available = !!snapshot && !run;

  return (
    <Button className={`w-full ${MENU_BUTTON_SIZE} ${className}`} onPointerDown={() => navigate('arcade')}>
      <span className="whitespace-nowrap">🕹 Arcade</span>
      {running ? (
        <CountBadge label={`Run en cours — duel ${run.current + 1} sur ${snapshot!.duel_count}`} className="px-1.5">
          {run.current + 1}/{snapshot!.duel_count}
        </CountBadge>
      ) : available ? (
        <NewDot label="Run du jour disponible" />
      ) : null}
    </Button>
  );
}

// Dock des raccourcis (Missions, Boutique, Cadeaux, Catalogue) : barre du bas
// en portrait, rail à droite en paysage — même seuil que le reste du menu.
function Dock({ web, children }: { web: boolean; children: ReactNode }) {
  return (
    <div
      className={
        web
          ? 'flex w-[76px] shrink-0 flex-col justify-center gap-1 rounded-2xl border border-line bg-surface-raised/80 py-2 backdrop-blur sm:w-[88px] sm:gap-2'
          : 'grid shrink-0 grid-cols-4 rounded-2xl border border-line bg-surface-raised/80 backdrop-blur'
      }
    >
      {children}
    </div>
  );
}

// Tuile du dock : icône au-dessus du libellé, pastille en surimpression au
// coin — le dock est trop étroit en rail pour une notification en ligne.
function DockTile({ icon, label, onPointerDown, badge, className = '' }: {
  icon: ReactNode;
  label: string;
  onPointerDown?: () => void;
  badge?: ReactNode;
  className?: string;
}) {
  const { squashed, handlers } = usePressSquash(onPointerDown, false);
  return (
    <button
      type="button"
      className={`relative flex min-h-[60px] min-w-tap flex-col items-center justify-center gap-1 transition-transform duration-100 ease-out sm:min-h-[70px] ${squashed ? 'scale-95' : ''} ${className}`}
      {...handlers}
    >
      <span className="text-xl" aria-hidden="true">{icon}</span>
      <span className="text-[10px] text-white/70 sm:text-[11px]">{label}</span>
      {badge && <span className="absolute right-1.5 top-1">{badge}</span>}
    </button>
  );
}

// Accès aux missions du jour. LES DEUX notifications du jeu (`CountBadge` et
// `NewDot`, définies dans les primitives, cf. leur commentaire) : la verte
// chiffrée pour les gains à récupérer, le point doré pour le cycle pas encore
// visité. La verte prime.
//
// Rien n'est rendu en invité — un compte est nécessaire pour porter le cycle.
function MissionsTile() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const userId = user?.id ?? null;
  const snapshot = useMissionStore(s => s.snapshot);
  const load = useMissionStore(s => s.load);

  useEffect(() => { if (userId) void load(true); }, [userId, load]);

  if (!user) return null;

  const pending = claimableCount(snapshot);
  const unseen = !!snapshot && hasUnseenMissions(user.id, snapshot.cycle.next_reset_at);

  return (
    <DockTile
      icon="🎯"
      label="Missions"
      onPointerDown={() => navigate('missions')}
      badge={pending > 0 ? (
        <CountBadge label={`${pending} gain${pending > 1 ? 's' : ''} à récupérer`} className="h-4 min-w-4 text-[10px]">
          {pending}
        </CountBadge>
      ) : unseen ? <NewDot /> : null}
    />
  );
}

// Boutique de cartes. Un simple point signale une offre du jour pas encore
// visitée — pas un compteur, qui répéterait une valeur déjà portée par le
// badge de chaque emplacement à l'intérieur. Rien en invité — l'offre est
// liée au compte.
function ShopTile() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const userId = user?.id ?? null;
  const snapshot = useShopStore(s => s.snapshot);
  const load = useShopStore(s => s.load);

  useEffect(() => { if (userId) void load(true); }, [userId, load]);

  if (!user) return null;

  const unseen = !!snapshot && hasUnseenShop(user.id, snapshot.day);

  return <DockTile icon="🛒" label="Boutique" onPointerDown={() => navigate('shop')} badge={unseen ? <NewDot /> : null} />;
}

// Cadeaux. UNE seule pastille, la verte chiffrée — un cadeau est toujours
// actionnable ou absent, il n'y a pas de nouveauté à signaler à part. Rien en
// invité : un cadeau se garde sur un compte.
function GiftsTile() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const userId = user?.id ?? null;
  const snapshot = useGiftStore(s => s.snapshot);
  const load = useGiftStore(s => s.load);

  useEffect(() => { if (userId) void load(true); }, [userId, load]);

  if (!user) return null;

  const pending = claimableGifts(snapshot);

  return (
    <DockTile
      icon="🎁"
      label="Cadeaux"
      onPointerDown={() => navigate('gifts')}
      badge={pending > 0 ? (
        <CountBadge label={`${pending} cadeau${pending > 1 ? 'x' : ''} à récupérer`} className="h-4 min-w-4 text-[10px]">
          {pending}
        </CountBadge>
      ) : null}
    />
  );
}

// Catalogue des cartes — écran pas encore construit : le bouton existe déjà
// dans le dock (regroupement retenu), il ne mène nulle part pour l'instant.
function CatalogTile() {
  return <DockTile icon="📖" label="Catalogue" />;
}
