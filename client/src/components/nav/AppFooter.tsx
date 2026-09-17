// AppFooter — barre de navigation commune à TOUTES les pages non-immersives :
// Missions, Boutique, Accueil, Cadeaux, Catalogue. Rendu une seule fois par
// `App.tsx`, comme `AppHeader`.
//
// Accueil est le raccourci qui remplaçait auparavant le bouton centré dans
// `ScreenHeader` — il vit désormais ici, au milieu de la barre (la position la
// plus accessible au pouce), plutôt que dans le header.
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useUiStore } from '../../stores/uiStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useMissionStore, hasUnseenMissions, claimableCount } from '../../stores/missionStore.js';
import { useShopStore, hasUnseenShop } from '../../stores/shopStore.js';
import { useGiftStore, claimableCount as claimableGifts } from '../../stores/giftStore.js';
import { CountBadge, NewDot, usePressSquash } from '../ui/primitives.js';

export function AppFooter() {
  return (
    <div className="sticky bottom-0 z-20 grid shrink-0 grid-cols-5 border-t border-line bg-surface-raised/90 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <MissionsTile />
      <ShopTile />
      <HomeTile />
      <GiftsTile />
      <CatalogTile />
    </div>
  );
}

// Tuile du footer : icône au-dessus du libellé, pastille en surimpression au
// coin.
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
      className={`relative flex min-h-[60px] min-w-tap flex-col items-center justify-center gap-1 transition-transform duration-100 ease-out ${squashed ? 'scale-95' : ''} ${className}`}
      {...handlers}
    >
      <span className="text-xl" aria-hidden="true">{icon}</span>
      <span className="text-[10px] text-white/70">{label}</span>
      {badge && <span className="absolute right-1.5 top-1">{badge}</span>}
    </button>
  );
}

// Accueil — remplace l'ancien bouton centré du header. Toujours rendu, même
// en invité : c'est le seul retour disponible depuis un écran secondaire.
function HomeTile() {
  const navigate = useUiStore(s => s.navigate);
  return <DockTile icon="🏠" label="Accueil" onPointerDown={() => navigate('main_menu')} />;
}

// Accès aux missions du jour. LES DEUX notifications du jeu (`CountBadge` et
// `NewDot`) : la verte chiffrée pour les gains à récupérer, le point doré
// pour le cycle pas encore visité. La verte prime.
//
// Rien n'est rendu en invité — un compte est nécessaire pour porter le cycle.
function MissionsTile() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const userId = user?.id ?? null;
  const snapshot = useMissionStore(s => s.snapshot);
  const load = useMissionStore(s => s.load);

  useEffect(() => { if (userId) void load(true); }, [userId, load]);

  if (!user) return <DockTile icon="🎯" label="Missions" />;

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
// visitée. Rien en invité — l'offre est liée au compte.
function ShopTile() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const userId = user?.id ?? null;
  const snapshot = useShopStore(s => s.snapshot);
  const load = useShopStore(s => s.load);

  useEffect(() => { if (userId) void load(true); }, [userId, load]);

  if (!user) return <DockTile icon="🛒" label="Boutique" />;

  const unseen = !!snapshot && hasUnseenShop(user.id, snapshot.day);

  return <DockTile icon="🛒" label="Boutique" onPointerDown={() => navigate('shop')} badge={unseen ? <NewDot /> : null} />;
}

// Cadeaux. UNE seule pastille, la verte chiffrée. Rien en invité : un cadeau
// se garde sur un compte.
function GiftsTile() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const userId = user?.id ?? null;
  const snapshot = useGiftStore(s => s.snapshot);
  const load = useGiftStore(s => s.load);

  useEffect(() => { if (userId) void load(true); }, [userId, load]);

  if (!user) return <DockTile icon="🎁" label="Cadeaux" />;

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

// Catalogue des cartes — toutes les cartes du jeu, obtenues ou non. Accessible
// sans compte (repli invité de `collectionStore`), donc rendu même déconnecté
// — contrairement à Missions/Boutique/Cadeaux, qui n'ont de sens que pour un
// compte.
function CatalogTile() {
  const navigate = useUiStore(s => s.navigate);
  return <DockTile icon="📖" label="Catalogue" onPointerDown={() => navigate('catalog')} />;
}
