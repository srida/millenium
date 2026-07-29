/* eslint-disable @typescript-eslint/no-explicit-any */
// shopStore — boutique de cartes : instantané servi par le serveur + actions.
//
// Le client ne calcule AUCUN prix et ne tire AUCUNE carte : il désigne un
// emplacement ou un set, et affiche ce que le serveur répond. Même contrat que
// missionStore — un montant envoyé par le client serait auto-attribué, et une
// offre tirée par le client serait re-tirée jusqu'à satisfaction.
//
// Chaque mutation renvoie l'instantané complet : aucun rechargement derrière
// une action, et l'offre affichée est toujours celle que le serveur vient de
// valider.
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import { useAuthStore } from './authStore.js';
import { useCollectionStore } from './collectionStore.js';

/** Pourquoi cette carte est proposée — c'est le badge qui porte la valeur perçue. */
export type SlotReason = 'unlocks' | 'material' | 'affinity' | 'random';

export interface ShopSlot {
  slot: number;
  card_id: string;
  tier: number;
  price: number;
  reason: SlotReason;
  /** Carte débloquée (`material`) ou attribut visé (`affinity`). */
  reason_ref: string | null;
  purchased: boolean;
  /** Conservé à la prochaine rotation au lieu d'être re-tiré. */
  pinned: boolean;
}

export interface ShopSet {
  id: string;
  name: string;
  card_count: number;
  owned_count: number;
  complete: boolean;
  booster_enabled: boolean;
  archetypes: string[];
  signature_card: string | null;
  completion_reward: { gems?: number; gold?: number; xp?: number } | null;
}

export interface PinnedSlot {
  slot: number;
  card_id: string;
  since_day: string;
}

export interface ShopSnapshot {
  day: string;
  next_rotation_at: number;
  slots: ShopSlot[];
  reroll: { free_available: boolean; per_day: number };
  pinned: PinnedSlot | null;
  pin_rules: { max: number };
  booster: { price_golds: number; price_gems: number; card_count: number };
  sets: ShopSet[];
  prices: Record<string, number>;
  collection: { owned: number; total: number };
}

/** Résultat d'une ouverture de booster — consommé par l'écran pour la révélation. */
export interface BoosterResult {
  set_id: string;
  cards: { card_id: string; tier: number }[];
  price: number;
  currency: 'golds' | 'gems';
  pin_cleared: boolean;
  sets_completed: { set_id: string; name: string; rewards: { xp: number; gold: number; gems: number } }[];
}

interface ShopStoreState {
  snapshot: ShopSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Annonce transitoire (set complété…), affichée par l'écran. */
  notice: string | null;
  booster: BoosterResult | null;

  load: (force?: boolean) => Promise<void>;
  buy: (slot: ShopSlot) => Promise<string | null>;
  reroll: (slot: number) => Promise<string | null>;
  /** Épingle un emplacement, ou détache avec `null`. */
  pin: (slot: number | null) => Promise<string | null>;
  openBooster: (setId: string, currency: 'golds' | 'gems') => Promise<string | null>;
  closeBooster: () => void;
  dismissNotice: () => void;
  reset: () => void;
}

const isGuest = () => !useAuthStore.getState().user;

// Pastille "nouveauté" du bouton Boutique du menu principal : un simple point,
// pas un compteur — la valeur d'un emplacement ne se lit pas dans un chiffre
// (cf. le badge par emplacement dans ShopScreen). Elle disparaît dès que le
// joueur a *visité* l'écran pour le jour en cours, comme une notification —
// pas au premier achat, pas à la rotation suivante avant d'y être retourné.
const seenKey = (userId: string) => `millenium_shop_seen_day_${userId}`;

export function hasUnseenShop(userId: string, day: string): boolean {
  try {
    return localStorage.getItem(seenKey(userId)) !== day;
  } catch {
    return false;
  }
}

export function markShopSeen(userId: string, day: string): void {
  try {
    localStorage.setItem(seenKey(userId), day);
  } catch {
    // localStorage indisponible (navigation privée…) : la pastille resterait
    // affichée en permanence, sans conséquence plus grave.
  }
}

function pickSnapshot(data: any): ShopSnapshot {
  return {
    day: data.day,
    next_rotation_at: data.next_rotation_at,
    slots: data.slots ?? [],
    reroll: data.reroll,
    pinned: data.pinned ?? null,
    pin_rules: data.pin_rules ?? { max: 1 },
    booster: data.booster,
    sets: data.sets ?? [],
    prices: data.prices ?? {},
    collection: data.collection ?? { owned: 0, total: 0 },
  };
}

/** Réponse d'une mutation : instantané, solde, collection, primes de complétion. */
function absorb(set: (partial: any) => void, data: any, unlocked: string[] = []): void {
  if (!data) return;
  set({ snapshot: pickSnapshot(data) });
  useAuthStore.getState().applyProgression(data.progression);
  useCollectionStore.getState().add(unlocked);

  const completed = data.sets_completed ?? [];
  if (completed.length) {
    const gems = completed.reduce((n: number, s: any) => n + (s.rewards?.gems ?? 0), 0);
    set({ notice: `Set complété : ${completed.map((s: any) => s.name).join(', ')}${gems ? ` — +${gems} 💎` : ''}` });
  }
}

export const useShopStore = create<ShopStoreState>((set, get) => ({
  snapshot: null,
  loading: false,
  busy: false,
  error: null,
  notice: null,
  booster: null,

  load: async (force = false) => {
    if (isGuest()) { set({ snapshot: null, error: null }); return; }
    if (get().loading || (get().snapshot && !force)) return;
    set({ loading: true, error: null });
    try {
      const data = await (AuthClient as any).getShop();
      set({ snapshot: pickSnapshot(data) });
      useAuthStore.getState().applyProgression(data.progression);
    } catch (e: any) {
      set({ error: e?.message ?? 'Boutique indisponible.' });
    } finally {
      set({ loading: false });
    }
  },

  buy: async (slot) => {
    if (get().busy) return null;
    set({ busy: true });
    try {
      const data = await (AuthClient as any).buyShopCard({ slot: slot.slot, cardId: slot.card_id });
      absorb(set, data, [slot.card_id]);
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

  reroll: async (slot) => {
    if (get().busy) return null;
    set({ busy: true });
    try {
      absorb(set, await (AuthClient as any).rerollShopSlot(slot));
      return null;
    } catch (e: any) {
      if (e?.status === 409) void get().load(true);
      return e?.message ?? 'Reroll impossible.';
    } finally {
      set({ busy: false });
    }
  },

  pin: async (slot) => {
    if (get().busy) return null;
    set({ busy: true });
    try {
      absorb(set, await (AuthClient as any).pinShopSlot(slot));
      return null;
    } catch (e: any) {
      if (e?.status === 409) void get().load(true);
      return e?.message ?? 'Impossible d\'épingler cet emplacement.';
    } finally {
      set({ busy: false });
    }
  },

  openBooster: async (setId, currency) => {
    if (get().busy) return null;
    set({ busy: true });
    try {
      const data = await (AuthClient as any).buyBooster({ setId, currency });
      const cards = (data.cards ?? []) as { card_id: string; tier: number }[];
      absorb(set, data, cards.map(c => c.card_id));
      set({
        booster: {
          set_id: data.set_id, cards, price: data.price, currency: data.currency,
          pin_cleared: !!data.pin_cleared, sets_completed: data.sets_completed ?? [],
        },
      });
      return null;
    } catch (e: any) {
      return e?.message ?? 'Ouverture impossible.';
    } finally {
      set({ busy: false });
    }
  },

  closeBooster: () => set({ booster: null }),
  dismissNotice: () => set({ notice: null }),
  reset: () => set({ snapshot: null, booster: null, notice: null, error: null }),
}));
