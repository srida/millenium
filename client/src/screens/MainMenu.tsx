// MainMenu — hub : jouer, tournoi, duel en ligne, gérer ses decks, se connecter /
// déconnecter (auth optionnelle, D2). Lien dev vers le CombatLab.
//
// C'est ICI que se choisit le deck du joueur : la pastille du deck actif, à côté
// du profil, est le seul accès à « Mes decks » (DeckSelector, mode 'manage') —
// elle affiche déjà avec quoi on joue, un bouton dédié en plus ferait doublon.
// Le deck actif sert dans tous les modes : Tournoi et Duel en ligne entrent donc
// directement, et « Jouer » n'ouvre le sélecteur que pour le deck de l'IA.
import { useEffect, useState } from 'react';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useDeckStore } from '../stores/deckStore.js';
import { useMissionStore, hasUnseenMissions, claimableCount } from '../stores/missionStore.js';
import { useShopStore, hasUnseenShop } from '../stores/shopStore.js';
import { useGiftStore, claimableCount as claimableGifts } from '../stores/giftStore.js';
import { useArcadeStore } from '../stores/arcadeStore.js';
import { getProgress, shouldInvite, updateProgress } from '../data/tutorialProgress.js';
import { Button, CountBadge, Modal, NewDot } from '../components/ui/primitives.js';
import { ProgressionPills, ProfilePill } from '../components/ui/ProgressionStats.js';
import { SpaceBackground } from '../components/ui/SpaceBackground.js';
import { FullscreenButton } from '../components/system/DeviceGuards.js';
import { AppVersion } from '../components/system/AppVersion.js';

export default function MainMenu() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface p-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
      {/* Décor spatial : premier enfant, tout le reste passe au-dessus en
          `relative z-10`. `bg-surface` reste sur <main> — c'est la couleur du
          vide, visible tant que le fond n'a pas peint sa première frame. */}
      <SpaceBackground />
      <FullscreenButton className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10" />
      <div className="relative z-10 text-center">
        <img src="/logo.png" alt="Millenium" className="mx-auto h-32 w-32 object-contain" />
        <p className="mt-1 text-sm text-white/50">Auto-battler tactique</p>
      </div>

      <div className="relative z-10 flex w-full max-w-xs flex-col gap-3">
        <Button variant="primary" className="w-full py-3 text-base" onPointerDown={() => navigate('deck_selector', { mode: 'play' })}>
          Jouer
        </Button>
        <TutorialButton />
        <div className="flex gap-2">
          {/* Ces deux modes jouent le deck actif : aucune sélection en amont. */}
          <Button className="flex-1" onPointerDown={() => navigate('tournament')}>🏆 Tournoi</Button>
          <Button className="flex-1" onPointerDown={() => navigate(user ? 'online_lobby' : 'auth')}>⚔ Duel en ligne</Button>
        </div>
        <ArcadeButton />
        <div className="flex gap-2">
          <MissionsButton />
          <ShopButton />
        </div>
        <GiftsButton />
        {user?.is_admin && (
          <div className="flex gap-2">
            <Button className="flex-1 text-xs opacity-70" onPointerDown={() => navigate('testbench')}>
              TestBench (dev)
            </Button>
            <Button className="flex-1 text-xs opacity-70" onPointerDown={() => navigate('combatlab')}>
              CombatLab (dev)
            </Button>
          </div>
        )}
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2 text-xs">
        {/* Deck actif à côté du profil : rappel permanent de ce avec quoi on
            joue, et raccourci vers l'écran où on en change. */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <ActiveDeckPill />
          {user ? (
            <>
              <ProfilePill user={user} onPointerDown={() => navigate('profile')} />
              <button onPointerDown={() => navigate('friends')} className="text-white/70 underline">Amis</button>
              {user.is_admin && <a href="/admin" className="text-white/70 underline">Admin</a>}
            </>
          ) : (
            <button onPointerDown={() => navigate('auth')} className="text-white/60 underline">Se connecter / créer un compte</button>
          )}
        </div>
        {/* Progression du compte, sous l'identité : niveau, XP et monnaies. La
            pastille de niveau mène au Profil, où les paliers à venir sont
            annoncés — c'est la question que pose une jauge qu'on regarde. */}
        <ProgressionPills user={user} onOpen={() => navigate('profile')} />
      </div>
      <AppVersion className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10" />
      <TutorialInvite />
    </main>
  );
}

// Accès au tutoriel. Rendu pour TOUT LE MONDE, invités compris — contrairement
// aux Missions et à la Boutique, qui ont besoin d'un compte. C'est précisément
// le joueur sans compte qu'il s'agit d'accueillir, et la progression du
// tutoriel vit en localStorage, sans identifiant.
function TutorialButton() {
  const navigate = useUiStore(s => s.navigate);
  const [read, setRead] = useState(0);

  // Lu au montage plutôt qu'au rendu : le retour du tutoriel remonte le menu,
  // et le compteur doit refléter ce qui vient d'être parcouru.
  useEffect(() => { setRead(getProgress().chapters.length); }, []);

  return (
    <Button className="w-full" onPointerDown={() => navigate('tutorial')}>
      <span className="whitespace-nowrap">🎓 Tutoriel</span>
      {read === 0 && <NewDot label="Jamais ouvert" />}
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

// Accès aux missions du jour. LES DEUX notifications du jeu (`CountBadge` et
// `NewDot`, définies dans les primitives, cf. leur commentaire) : la verte
// chiffrée pour les gains à récupérer, le point doré pour le cycle pas encore
// visité. La verte prime.
//
// Rien n'est rendu en invité — un compte est nécessaire pour porter le cycle.
function MissionsButton() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const snapshot = useMissionStore(s => s.snapshot);
  const load = useMissionStore(s => s.load);

  useEffect(() => { if (user) void load(true); }, [user, load]);

  if (!user) return null;

  const pending = claimableCount(snapshot);
  const unseen = !!snapshot && hasUnseenMissions(user.id, snapshot.cycle.next_reset_at);

  return (
    <Button className="flex-1 px-2" onPointerDown={() => navigate('missions')}>
      <span className="whitespace-nowrap">🎯 Missions</span>
      {pending > 0 ? (
        <CountBadge label={`${pending} gain${pending > 1 ? 's' : ''} à récupérer`}>{pending}</CountBadge>
      ) : unseen ? (
        <NewDot />
      ) : null}
    </Button>
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
// d'un compte. Le bouton renvoie alors vers l'inscription, comme le Duel en ligne.
function ArcadeButton() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const snapshot = useArcadeStore(s => s.snapshot);
  const load = useArcadeStore(s => s.load);

  useEffect(() => { if (user) void load(true); }, [user, load]);

  if (!user) {
    return (
      <Button className="w-full" onPointerDown={() => navigate('auth')}>
        <span className="whitespace-nowrap">🕹 Arcade</span>
      </Button>
    );
  }

  const run = snapshot?.run ?? null;
  const running = run?.status === 'in_progress';
  const available = !!snapshot && !run;

  return (
    <Button className="w-full" onPointerDown={() => navigate('arcade')}>
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

// Boutique de cartes. Un simple point signale une offre du jour pas encore
// visitée — pas un compteur, qui répéterait une valeur déjà portée par le
// badge de chaque emplacement à l'intérieur. Il s'efface dès que l'écran a
// été ouvert pour ce jour, comme une notification. Rien en invité — l'offre
// est liée au compte.
function ShopButton() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const snapshot = useShopStore(s => s.snapshot);
  const load = useShopStore(s => s.load);

  useEffect(() => { if (user) void load(true); }, [user, load]);

  if (!user) return null;

  const unseen = !!snapshot && hasUnseenShop(user.id, snapshot.day);

  return (
    <Button className="flex-1 px-2" onPointerDown={() => navigate('shop')}>
      {/* nowrap : avec la pastille, « 🛒 Boutique » se coupait en deux lignes. */}
      <span className="whitespace-nowrap">🛒 Boutique</span>
      {unseen && <NewDot />}
    </Button>
  );
}

// Cadeaux. UNE seule pastille, la verte chiffrée — et pas de point doré « pas
// encore vu » ni de localStorage, contrairement aux Missions et à la Boutique :
// un cadeau est toujours actionnable ou absent, il n'y a pas de nouveauté à
// signaler à part. Elle ne s'efface donc pas à la visite mais quand tout est
// récupéré, et compte le quotidien disponible plus les cadeaux non pris.
// Rien en invité : un cadeau se garde sur un compte.
function GiftsButton() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const snapshot = useGiftStore(s => s.snapshot);
  const load = useGiftStore(s => s.load);

  useEffect(() => { if (user) void load(true); }, [user, load]);

  if (!user) return null;

  const pending = claimableGifts(snapshot);

  return (
    <Button className="w-full" onPointerDown={() => navigate('gifts')}>
      <span className="whitespace-nowrap">🎁 Cadeaux</span>
      {pending > 0 && (
        <CountBadge label={`${pending} cadeau${pending > 1 ? 'x' : ''} à récupérer`}>{pending}</CountBadge>
      )}
    </Button>
  );
}

// Pastille du deck actif (couleur + nom + nombre de cartes). Tap → « Mes decks »,
// où l'on en change. Sans deck actif, elle invite à en choisir un : tous les
// modes en dépendent.
function ActiveDeckPill() {
  const navigate = useUiStore(s => s.navigate);
  const decks = useDeckStore(s => s.decks);
  const activeDeck = useDeckStore(s => s.activeDeck);
  const refresh = useDeckStore(s => s.refresh);

  useEffect(() => { refresh(); }, [refresh]);

  const deck = activeDeck ? decks.find(d => d.name === activeDeck) ?? null : null;
  const hex = deck?.color ?? '#a86ee7';

  return (
    <button
      onPointerDown={() => navigate('deck_selector', { mode: 'manage' })}
      className={`flex min-h-tap items-center gap-2 rounded-full border bg-surface-raised/70 px-3 py-1.5 active:opacity-80 ${deck ? 'border-line' : 'border-dashed border-gold/50'}`}
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
    </button>
  );
}
