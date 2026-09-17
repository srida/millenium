// MainMenu — hub : jouer, tournoi, entraînement, gérer ses decks, se connecter /
// déconnecter (auth optionnelle, D2). Lien dev vers le CombatLab.
//
// Le header (profil, progression) et le footer (Accueil, Missions, Boutique,
// Cadeaux, Catalogue) ne sont plus posés par cet écran : `App.tsx` rend
// `AppHeader`/`AppFooter` une seule fois, partagés par toutes les pages. Cette
// racine n'occupe donc que l'espace restant, sans scroll dans les deux
// orientations (téléphone ET tablette) — `useWebLayout` (même seuil que
// `Scene3D._cameraFraming`) fait basculer la pile d'actions d'une colonne à
// une ligne [carte Jouer | grille 2×2 des modes]. Sur tablette (`sm:`), le
// logo cesse de grandir et cède la place à la pile d'actions, bornée et
// centrée — sinon le portail écrase les boutons.
//
// C'est ICI que se choisit le deck du joueur : la pastille du deck actif, en
// coiffe du bouton « Jouer » (`PlayCard`), est le seul accès à « Mes decks »
// (DeckSelector, mode 'manage') — elle affiche déjà avec quoi on joue, un
// bouton dédié en plus ferait doublon. Le deck actif sert dans tous les modes :
// « Jouer » (le duel en ligne) et le Tournoi entrent donc directement, et seul
// « Entraînement » ouvre le sélecteur, pour le seul deck de l'IA.
import { useEffect, useState } from 'react';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useDeckStore } from '../stores/deckStore.js';
import { useArcadeStore } from '../stores/arcadeStore.js';
import { getProgress, shouldInvite, updateProgress } from '../data/tutorialProgress.js';
import { Button, CountBadge, Modal, NewDot } from '../components/ui/primitives.js';
import { AnimatedLogo } from '../components/ui/AnimatedLogo.js';
import { FullscreenButton } from '../components/system/DeviceGuards.js';
import { AppVersion } from '../components/system/AppVersion.js';
import { useWebLayout, useTabletLayout } from '../components/system/useWebLayout.js';

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
  const isTabletDevice = useTabletLayout();
  const user = useAuthStore(s => s.user);
  const [devOpen, setDevOpen] = useState(false);
  // Boutons dev derrière le badge « DEV » de la version — ils ne comptent pas
  // dans la hauteur du menu, qui doit tenir sans scroll.
  const openDevMenu = () => { if (user?.is_admin) setDevOpen(true); };

  return (
    // ⚠️ `pl-`/`pr-` en `max(…, env(safe-area-inset-*))` et non un simple
    // `px-` : en paysage (PWA installée surtout, cf. `viewport-fit=cover`),
    // l'encoche d'un téléphone tourné se retrouve sur un CÔTÉ — un `px-`
    // ignore l'inset et laisse le contenu empiéter dessous.
    //
    // Le header (profil, progression) et le footer (Accueil, Missions,
    // Boutique, Cadeaux, Catalogue) ne sont plus posés ici : `App.tsx` les
    // rend une seule fois, `AppHeader`/`AppFooter`, partagés par tous les
    // écrans — cette racine n'occupe donc plus que l'espace restant.
    <main className="menu-body relative z-10 flex h-full flex-col gap-2 overflow-hidden py-3 pl-[max(2.5rem,env(safe-area-inset-left))] pr-[max(2.5rem,env(safe-area-inset-right))] text-white sm:pl-[max(0.25rem,env(safe-area-inset-left))] sm:pr-[max(0.25rem,env(safe-area-inset-right))]">
      <FullscreenButton className="absolute right-3 top-2 sm:hidden" />

      {web && !isTabletDevice ? (
        // Téléphone paysage : une ligne [rail logo | carte Jouer + grille].
        <div className="flex min-h-0 flex-1 gap-3">
          <LogoRail isAdmin={!!user?.is_admin} onDevTap={openDevMenu} />
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
      ) : web ? (
        // Tablette paysage : logo au-dessus de la ligne d'actions, comme en
        // portrait, mais celle-ci se scinde [carte Jouer | grille 2×2].
        // Le tout se centre verticalement EN BLOC (`justify-center`) : sans
        // lui, la ligne s'arrête à la hauteur voulue mais reste collée en
        // haut, sous le logo, au lieu d'occuper le milieu de l'écran.
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-col flex-1 items-center justify-center gap-2">
          <LogoBlock grow={false} isAdmin={!!user?.is_admin} onDevTap={openDevMenu} />
          <div className="flex w-full items-stretch gap-3 flex-1 sm:gap-2 sm:max-h-[330px]">
            <PlayCard className="min-w-0 flex-[1.15]" />
            <div className="grid h-full flex-1 grid-cols-2 grid-rows-2 gap-2">
              <TutorialButton className="h-full w-full" />
              <TournamentButton className="h-full w-full" />
              <TrainingButton className="h-full w-full" />
              <ArcadeButton className="h-full w-full" />
            </div>
          </div>
        </div>
      ) : (
        <>
          <LogoBlock grow isAdmin={!!user?.is_admin} onDevTap={openDevMenu} />
          <div className="flex flex-2 flex-col gap-2.5 sm:mx-auto sm:w-full sm:max-w-[470px] sm:flex-1 sm:justify-center">
            <PlayCard />
            <TutorialButton />
            <div className="flex gap-2">
              <TournamentButton className="flex-1" />
              <TrainingButton className="flex-1" />
            </div>
            <ArcadeButton />
          </div>
        </>
      )}

      <DevMenu open={devOpen} onClose={() => setDevOpen(false)} />
      <TutorialInvite />
    </main>
  );
}

/**
 * Logo + version, seuls occupants du bloc. La version REMPLACE l'ancien
 * sous-titre (« Auto-battler tactique »).
 *
 * `grow` : en portrait téléphone, ce bloc est la zone `flex-1` qui absorbe la
 * hauteur disponible (le logo grandit). Sur tablette portrait (`sm:`), c'est
 * la pile d'actions qui devient `flex-1` à la place — le logo, lui, revient à
 * sa taille naturelle (`sm:w-[min(13.5rem,30dvh)]`) et descend
 * (`sm:mt-16`), pour ne pas coller à l'en-tête. En paysage tablette, `grow`
 * est toujours faux : c'est le groupe [logo, ligne d'actions] tout entier qui
 * se centre verticalement (cf. l'appelant), la marge du haut serait donc de
 * trop. Le téléphone paysage n'utilise pas ce bloc (cf. `LogoRail`).
 *
 * `isAdmin` : pose un badge « DEV » à côté de la version, un simple tap
 * dessus ouvre les outils. Sans lui, rien ne distingue la version d'un texte
 * inerte, admin ou pas.
 */
function LogoBlock({ grow, isAdmin, onDevTap }: { grow: boolean; isAdmin: boolean; onDevTap: () => void }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-0.5 ${grow ? 'flex-2 sm:flex-none sm:mt-16' : 'flex-none'}`}>
      {/* Largeur bornée par la hauteur disponible (`26dvh`) autant que par une
          taille maximale (`11rem`) : c'est elle qui fait tenir le logo sans
          scroll quand l'écran est court. Sur tablette (`sm:`), les deux bornes
          grandissent : plus de place là qu'en portrait téléphone. */}
      <AnimatedLogo className="w-[min(11rem,26dvh)] sm:w-[min(13.5rem,30dvh)]" />
      <div className="-mt-2 flex items-center gap-1.5">
        <AppVersion />
        {isAdmin && <DevBadge onTap={onDevTap} />}
      </div>
    </div>
  );
}

// Rail gauche du téléphone paysage : logo + version posés à côté de la ligne
// d'actions plutôt qu'au-dessus — l'écran est trop court pour leur laisser
// une ligne à eux. ~1/4 de la largeur de l'écran (`25vw`) : assez présent
// pour rester le repère visuel du menu même relégué sur le côté.
//
// ⚠️ La safe-area gauche est déjà portée par `<main>` (elle vaut pour tout
// l'en-tête aussi) — ce `pl-4` n'est qu'un ajustement VISUEL : les lueurs du
// logo débordent jusqu'au bord de son cadre là où l'avatar de l'en-tête a
// déjà un retrait (padding de sa pastille) ; sans lui, les deux semblaient
// désalignés malgré des conteneurs alignés au pixel près.
function LogoRail({ isAdmin, onDevTap }: { isAdmin: boolean; onDevTap: () => void }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 pl-4">
      <AnimatedLogo className="w-[25vw]" />
      <div className="-mt-2 flex items-center gap-1.5">
        <AppVersion />
        {isAdmin && <DevBadge onTap={onDevTap} />}
      </div>
    </div>
  );
}

// Badge « DEV », seul indice qu'un compte admin peut ouvrir TestBench,
// CombatLab et le Labo IA d'ici — un tap suffit, pas d'appui long à deviner.
function DevBadge({ onTap }: { onTap: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={onTap}
      aria-label="Outils dev"
      className="rounded border border-gold/50 bg-gold/15 px-1 py-0.5 text-[9px] font-bold leading-none tracking-wide text-gold active:opacity-70"
    >
      DEV
    </button>
  );
}

// Les trois écrans de dev, révélés par l'appui long sur la version plutôt que
// posés en permanence : ils ne comptent plus dans la hauteur du menu. Admin
// (le Card Manager, `admin.html`) les rejoint ici — le même `Button` que les
// trois autres, pour le même relief et le même délai anti-scroll ; la
// navigation reste un vrai changement de page (`window.location`), pas un
// `navigate()` React : c'est une page serveur distincte, hors du routage
// React. Il vivait avant dans `AppHeader`, où il traînait sur toutes les pages.
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
        <Button className="w-full text-xs opacity-70" onPointerDown={() => { window.location.href = '/admin'; }}>Admin</Button>
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
  return (
    <Button className={`${MENU_BUTTON_SIZE} ${className}`} onPointerDown={() => navigate('tournament')}>
      <span className="whitespace-nowrap">🏆 Tournoi</span>
    </Button>
  );
}

// Entraînement = la partie solo contre l'IA. Seul mode qui ouvre encore le
// sélecteur, et uniquement pour choisir le deck adverse.
function TrainingButton({ className = '' }: { className?: string }) {
  const navigate = useUiStore(s => s.navigate);
  return (
    <Button className={`${MENU_BUTTON_SIZE} ${className}`} onPointerDown={() => navigate('deck_selector', { mode: 'play' })}>
      <span className="whitespace-nowrap">🤖 Entraînement</span>
    </Button>
  );
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

// Le dock des raccourcis (Missions, Boutique, Cadeaux, Catalogue) et
// l'Accueil vivent désormais dans `AppFooter`, partagé par tous les écrans.
