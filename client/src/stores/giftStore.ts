/* eslint-disable @typescript-eslint/no-explicit-any */
// giftStore — instantané des cadeaux et récupérations.
// Même structure que shopStore / cosmeticStore : le serveur renvoie
// l'instantané complet à chaque mutation, il n'y a donc jamais de rechargement
// derrière une action.
//
// Le client ne transmet AUCUN montant : il désigne « le quotidien » ou un id de
// cadeau, et le serveur chiffre.
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import { useAuthStore } from './authStore.js';
import { useCollectionStore } from './collectionStore.js';

/** Un lot, tel qu'annoncé AVANT récupération (libellé résolu côté serveur). */
export interface GiftLot {
  type: 'gold' | 'gems' | 'card' | 'pack' | 'avatar' | 'variant';
  amount?: number;
  id?: string;
  label?: string;
  tier?: number | null;
  card_id?: string | null;
  card_count?: number;
}

/** Une ligne, telle que RENDUE après récupération. */
export interface GiftLine {
  type: GiftLot['type'];
  id?: string;
  amount?: number;
  granted: boolean;
  reason?: 'already_owned' | 'unknown' | 'empty_pool';
  cards?: { card_id: string; tier: number }[];
}

export interface Gift {
  id: string;
  name: string;
  description: string;
  created_at: number;
  contents: GiftLot[];
  claimed: boolean;
  claimed_at: number | null;
}

export interface GiftSnapshot {
  day: string;
  next_rotation_at: number;
  daily: {
    reward: { gold: number; gems: number };
    claimed: boolean;
    claimed_at: number | null;
  };
  gifts: Gift[];
}

/** Ce qu'une récupération vient de rendre — alimente la modale de révélation. */
export interface GiftReveal {
  title: string;
  lines: GiftLine[];
  gold: number;
  gems: number;
}

interface GiftStoreState {
  snapshot: GiftSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  reveal: GiftReveal | null;
  load: (force?: boolean) => Promise<void>;
  claimDaily: () => Promise<string | null>;
  claim: (id: string) => Promise<string | null>;
  closeReveal: () => void;
  reset: () => void;
}

const isGuest = () => !useAuthStore.getState().user;

// Whitelist : sans elle, un champ ajouté côté serveur serait silencieusement
// perdu — et un champ retiré laisserait un `undefined` dans le rendu.
function pickSnapshot(data: any): GiftSnapshot {
  return {
    day: data.day,
    next_rotation_at: data.next_rotation_at,
    daily: {
      reward: data.daily?.reward ?? { gold: 0, gems: 0 },
      claimed: !!data.daily?.claimed,
      claimed_at: data.daily?.claimed_at ?? null,
    },
    gifts: data.gifts ?? [],
  };
}

/** Toutes les cartes réellement débloquées par une récupération, lots inclus. */
function unlockedCardsOf(lines: GiftLine[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!line.granted) continue;
    if (line.type === 'card' && line.id) out.push(line.id);
    if (line.type === 'pack') out.push(...(line.cards ?? []).map(c => c.card_id));
  }
  return out;
}

function absorb(set: (p: Partial<GiftStoreState>) => void, data: any, reveal: GiftReveal | null) {
  set({ snapshot: pickSnapshot(data), reveal });
  useAuthStore.getState().applyProgression(data.progression);
  // Les cartes offertes doivent apparaître au DeckBuilder sans recharger les
  // 398 ids de la collection.
  if (reveal) useCollectionStore.getState().add(unlockedCardsOf(reveal.lines));
}

export const useGiftStore = create<GiftStoreState>((set, get) => ({
  snapshot: null,
  loading: false,
  busy: false,
  error: null,
  reveal: null,

  load: async (force = false) => {
    if (isGuest()) { set({ snapshot: null, error: null }); return; }
    if (get().loading || (get().snapshot && !force)) return;
    set({ loading: true, error: null });
    try {
      const data = await (AuthClient as any).getGifts();
      set({ snapshot: pickSnapshot(data) });
      useAuthStore.getState().applyProgression(data.progression);
    } catch (e: any) {
      set({ error: e?.message ?? 'Cadeaux indisponibles.' });
    } finally {
      set({ loading: false });
    }
  },

  claimDaily: async () => {
    if (get().busy) return null;
    set({ busy: true });
    try {
      const data = await (AuthClient as any).claimDailyGift();
      const { gold = 0, gems = 0 } = data.granted ?? {};
      absorb(set, data, { title: 'Cadeau quotidien', lines: [], gold, gems });
      return null;
    } catch (e: any) {
      // L'instantané peut dater (autre onglet, rotation franchie) : on le
      // recharge pour que le joueur voie l'état réel plutôt qu'une erreur.
      void get().load(true);
      return e?.message ?? 'Récupération impossible.';
    } finally {
      set({ busy: false });
    }
  },

  claim: async (id) => {
    if (get().busy) return null;
    set({ busy: true });
    try {
      const data = await (AuthClient as any).claimGift(id);
      absorb(set, data, {
        title: data.gift?.name ?? 'Cadeau',
        lines: data.lines ?? [],
        gold: data.granted?.gold ?? 0,
        gems: data.granted?.gems ?? 0,
      });
      return null;
    } catch (e: any) {
      void get().load(true);
      return e?.message ?? 'Récupération impossible.';
    } finally {
      set({ busy: false });
    }
  },

  closeReveal: () => set({ reveal: null }),
  reset: () => set({ snapshot: null, loading: false, busy: false, error: null, reveal: null }),
}));

/**
 * Nombre de cadeaux en attente — DÉRIVÉ de l'instantané, jamais transmis par le
 * serveur : une valeur dérivée qu'on transporte est une valeur qui peut
 * contredire sa source (même règle que `claimableCount` côté missions).
 */
export function claimableCount(snapshot: GiftSnapshot | null): number {
  if (!snapshot) return 0;
  return (snapshot.daily.claimed ? 0 : 1) + snapshot.gifts.filter(g => !g.claimed).length;
}
