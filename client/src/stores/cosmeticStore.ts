/* eslint-disable @typescript-eslint/no-explicit-any */
// cosmeticStore — instantané de la boutique cosmétique et actions d'achat.
// Même structure que shopStore : le serveur renvoie l'instantané complet à
// chaque mutation, il n'y a donc jamais de rechargement derrière une action.
//
// Un seul instantané alimente TROIS écrans :
//   - ShopScreen  — l'offre du jour (3 avatars, 3 variantes) ;
//   - ProfileScreen — les avatars portables (offerts + achetés) ;
//   - DeckBuilder — les variantes possédées, pour le sélecteur d'illustration.
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import { useAuthStore } from './authStore.js';
import { createSnapshotChannel } from './snapshotLoader.js';

export interface CosmeticAvatar {
  id: string;
  name: string;
  source: 'card' | 'board' | 'magie';
  price_gems: number;
  purchased: boolean;
}

// Une variante n'a pas de nom propre : c'est une illustration de plus pour une
// carte. Elle s'annonce par `card_name`, et se distingue de ses sœurs par son
// image — pas par un libellé.
export interface CosmeticVariant {
  id: string;
  card_id: string;
  card_name: string;
  tier: number | null;
  price_gems: number;
  purchased: boolean;
}

/** Variante possédée — porte son `card_id`, le DeckBuilder en a besoin. */
export interface OwnedVariant {
  id: string;
  card_id: string;
  card_name: string | null;
}

export interface CosmeticSnapshot {
  day: string;
  next_rotation_at: number;
  prices: { avatar: { gems: number }; variant: { gems: number } };
  avatars: CosmeticAvatar[];
  variants: CosmeticVariant[];
  owned: { avatars: string[]; variants: OwnedVariant[] };
  default_avatars: string[];
}

export type CosmeticKind = 'avatar' | 'variant';

interface CosmeticStoreState {
  snapshot: CosmeticSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  load: (force?: boolean) => Promise<void>;
  buy: (kind: CosmeticKind, id: string, label: string) => Promise<string | null>;
  /** Variantes possédées pour une carte — alimente le sélecteur du DeckBuilder. */
  ownedVariantsFor: (cardId: string) => OwnedVariant[];
  /** Avatars sélectionnables au Profil : les offerts, puis les achetés. */
  selectableAvatars: () => string[];
  dismissNotice: () => void;
  reset: () => void;
}

// Whitelist : sans elle, un champ ajouté côté serveur serait silencieusement
// perdu — et un champ retiré laisserait un `undefined` dans le rendu.
function pickSnapshot(data: any): CosmeticSnapshot {
  return {
    day: data.day,
    next_rotation_at: data.next_rotation_at,
    prices: data.prices ?? { avatar: { gems: 0 }, variant: { gems: 0 } },
    avatars: data.avatars ?? [],
    variants: data.variants ?? [],
    owned: {
      avatars: data.owned?.avatars ?? [],
      variants: data.owned?.variants ?? [],
    },
    default_avatars: data.default_avatars ?? [],
  };
}

const channel = createSnapshotChannel<CosmeticSnapshot>({
  fetch: () => (AuthClient as any).getCosmetics(),
  pick: pickSnapshot,
  errorLabel: 'Boutique indisponible.',
});

export const useCosmeticStore = create<CosmeticStoreState>((set, get) => ({
  snapshot: null,
  loading: false,
  busy: false,
  error: null,
  notice: null,

  load: channel.load(set, get),

  buy: async (kind, id, label) => {
    if (get().busy) return null;
    set({ busy: true });
    try {
      const data = await (AuthClient as any).buyCosmetic({ kind, id });
      set({
        snapshot: pickSnapshot(data),
        notice: kind === 'avatar'
          ? `Avatar débloqué : ${label} — choisis-le dans ton profil.`
          : `Illustration débloquée : ${label} — choisis-la dans le DeckBuilder.`,
      });
      useAuthStore.getState().applyProgression(data.progression);
      return null;
    } catch (e: any) {
      // 409 = l'offre a tourné pendant qu'on regardait : on la recharge pour
      // que le joueur voie la nouvelle plutôt qu'une erreur sur l'ancienne.
      if (e?.status === 409) void get().load(true);
      return e?.message ?? 'Achat impossible.';
    } finally {
      set({ busy: false });
    }
  },

  ownedVariantsFor: (cardId) =>
    (get().snapshot?.owned.variants ?? []).filter(v => v.card_id === cardId),

  selectableAvatars: () => {
    const snap = get().snapshot;
    if (!snap) return [];
    // Les offerts d'abord : ce sont ceux que tout le monde reconnaît, et le
    // joueur qui n'a rien acheté ne doit pas voir une grille vide.
    return [...snap.default_avatars, ...snap.owned.avatars];
  },

  dismissNotice: () => set({ notice: null }),
  reset: () => set({ snapshot: null, loading: false, busy: false, error: null, notice: null }),
}));
