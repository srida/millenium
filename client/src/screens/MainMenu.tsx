// MainMenu — hub : jouer, tournoi, duel en ligne, gérer ses decks, se connecter /
// déconnecter (auth optionnelle, D2). Lien dev vers le CombatLab.
//
// C'est ICI que se choisit le deck du joueur : la pastille du deck actif, à côté
// du profil, est le seul accès à « Mes decks » (DeckSelector, mode 'manage') —
// elle affiche déjà avec quoi on joue, un bouton dédié en plus ferait doublon.
// Le deck actif sert dans tous les modes : Tournoi et Duel en ligne entrent donc
// directement, et « Jouer » n'ouvre le sélecteur que pour le deck de l'IA.
import { useEffect } from 'react';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore, type AuthUser } from '../stores/authStore.js';
import { useDeckStore } from '../stores/deckStore.js';
import { useMissionStore } from '../stores/missionStore.js';
import { useShopStore } from '../stores/shopStore.js';
import { Button } from '../components/ui/primitives.js';
import { ProgressionPills } from '../components/ui/ProgressionStats.js';
import { FullscreenButton } from '../components/system/DeviceGuards.js';

export default function MainMenu() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface p-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
      <FullscreenButton className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))]" />
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-[0.2em] text-gold">MILLENIUM</h1>
        <p className="mt-1 text-sm text-white/50">Auto-battler tactique</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button variant="primary" className="w-full py-3 text-base" onPointerDown={() => navigate('deck_selector', { mode: 'play' })}>
          Jouer
        </Button>
        <div className="flex gap-2">
          {/* Ces deux modes jouent le deck actif : aucune sélection en amont. */}
          <Button className="flex-1" onPointerDown={() => navigate('tournament')}>🏆 Tournoi</Button>
          <Button className="flex-1" onPointerDown={() => navigate(user ? 'online_lobby' : 'auth')}>⚔ Duel en ligne</Button>
        </div>
        <div className="flex gap-2">
          <MissionsButton />
          <ShopButton />
        </div>
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

      <div className="flex flex-col items-center gap-2 text-xs">
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
        {/* Progression du compte, sous l'identité : niveau, XP et monnaies. */}
        <ProgressionPills user={user} />
        {user && (
          <button onPointerDown={() => logout()} className="text-white/50 underline">Se déconnecter</button>
        )}
      </div>
    </main>
  );
}

// Accès aux missions du jour, avec le nombre de missions restantes en pastille :
// c'est le rappel qui fait revenir, il doit être lisible sans ouvrir l'écran.
// Rien n'est rendu en invité — un compte est nécessaire pour porter le cycle.
function MissionsButton() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const snapshot = useMissionStore(s => s.snapshot);
  const load = useMissionStore(s => s.load);

  useEffect(() => { if (user) void load(true); }, [user, load]);

  if (!user) return null;

  const pending = (snapshot?.missions ?? []).filter(m => m.status === 'active').length;
  const done = (snapshot?.missions ?? []).filter(m => m.status === 'completed').length;

  return (
    <Button className="flex-1 px-2" onPointerDown={() => navigate('missions')}>
      <span className="whitespace-nowrap">🎯 Missions</span>
      {pending > 0 && (
        <span className="rounded-full border border-gold/50 bg-gold/15 px-2 text-xs tabular-nums text-gold">{pending}</span>
      )}
      {done > 0 && (
        <span className="rounded-full border border-success/50 bg-success/15 px-2 text-xs tabular-nums text-success">✓ {done}</span>
      )}
    </Button>
  );
}

// Boutique de cartes. La pastille compte les emplacements du jour encore
// disponibles, et l'éclair signale un Maillon (une carte qui débloque une
// invocation) : c'est la seule proposition qui mérite qu'on ouvre l'écran
// aujourd'hui plutôt que demain. Rien en invité — l'offre est liée au compte.
function ShopButton() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const snapshot = useShopStore(s => s.snapshot);
  const load = useShopStore(s => s.load);

  useEffect(() => { if (user) void load(true); }, [user, load]);

  if (!user) return null;

  const slots = snapshot?.slots ?? [];
  const available = slots.filter(s => !s.purchased).length;
  const highlight = slots.some(s => !s.purchased && (s.reason === 'unlocks' || s.reason === 'material' || s.reason === 'covet'));

  return (
    <Button className="flex-1 px-2" onPointerDown={() => navigate('shop')}>
      {/* nowrap : avec la pastille, « 🛒 Boutique » se coupait en deux lignes. */}
      <span className="whitespace-nowrap">🛒 Boutique</span>
      {available > 0 && (
        <span className="rounded-full border border-gold/50 bg-gold/15 px-2 text-xs tabular-nums text-gold">
          {highlight && '⚡ '}{available}
        </span>
      )}
    </Button>
  );
}

// Pastille de profil (avatar + pseudo). Tap → écran Profil. Elle dit déjà qui est
// connecté : pas de ligne « Connecté : … » en plus. L'avatar suit la même règle
// qu'ailleurs (URL/data → image, sinon emoji, sinon initiale du pseudo).
function ProfilePill({ user, onPointerDown }: { user: AuthUser; onPointerDown: () => void }) {
  const avatar = (user.avatar ?? '').trim();
  const isImg = /^(https?:|data:)/i.test(avatar);

  return (
    <button
      onPointerDown={onPointerDown}
      title="Profil"
      aria-label={`Profil de ${user.username}`}
      className="flex min-h-tap items-center gap-2 rounded-full border border-line bg-surface-raised/70 px-2 py-1 pr-3 active:opacity-80"
    >
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-gold/40 bg-surface text-xs">
        {avatar
          ? (isImg ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <span>{avatar.slice(0, 2)}</span>)
          : <span>{user.username.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className="max-w-[9rem] truncate font-semibold text-white">{user.username}</span>
    </button>
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
