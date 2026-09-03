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

/**
 * Un dos de carte — le seul cosmétique dont le PRIX est éditorial : il vient du
 * catalogue (saisi en admin), pas d'un barème par famille. `prices.card_back`
 * n'est donc qu'un repli.
 */
export interface CosmeticCardBack {
  id: string;
  name: string;
  price_gems: number;
  purchased: boolean;
}

/** Dos possédé ou offert — le Profil dresse sa grille avec ça, sans relire le catalogue. */
export interface OwnedCardBack {
  id: string;
  name: string;
}

export interface CosmeticSnapshot {
  day: string;
  next_rotation_at: number;
  prices: { avatar: { gems: number }; variant: { gems: number }; card_back?: { gems: number } };
  avatars: CosmeticAvatar[];
  variants: CosmeticVariant[];
  card_backs: CosmeticCardBack[];
  owned: { avatars: string[]; variants: OwnedVariant[]; card_backs: OwnedCardBack[] };
  default_avatars: string[];
  default_card_backs: string[];
}

export type CosmeticKind = 'avatar' | 'variant' | 'card_back';

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
  /** Dos de cartes portables au Profil — offerts et achetés confondus. */
  selectableCardBacks: () => OwnedCardBack[];
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
    card_backs: data.card_backs ?? [],
    owned: {
      avatars: data.owned?.avatars ?? [],
      variants: data.owned?.variants ?? [],
      card_backs: data.owned?.card_backs ?? [],
    },
    default_avatars: data.default_avatars ?? [],
    default_card_backs: data.default_card_backs ?? [],
  };
}

// Ce qu'on dit après un achat : chaque famille se PORTE ailleurs, et le message
// doit dire où. Une table plutôt qu'un ternaire — avec trois familles, « tout ce
// qui n'est pas un avatar » renverrait le joueur au DeckBuilder pour un dos.
const BUY_NOTICE: Record<CosmeticKind, (label: string) => string> = {
  avatar: (l) => `Avatar débloqué : ${l} — choisis-le dans ton profil.`,
  variant: (l) => `Illustration débloquée : ${l} — choisis-la dans le DeckBuilder.`,
  card_back: (l) => `Dos de carte débloqué : ${l} — choisis-le dans ton profil.`,
};

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
      set({ snapshot: pickSnapshot(data), notice: BUY_NOTICE[kind](label) });
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

  // Le serveur joint déjà les offerts aux achetés (`owned.card_backs`) : il n'y
  // a rien à recomposer ici, contrairement aux avatars dont les deux listes
  // voyagent séparément pour des raisons historiques.
  selectableCardBacks: () => get().snapshot?.owned.card_backs ?? [],

  dismissNotice: () => set({ notice: null }),
  reset: () => set({ snapshot: null, loading: false, busy: false, error: null, notice: null }),
}));
