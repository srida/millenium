/* eslint-disable @typescript-eslint/no-explicit-any */
// draftStore — la run de Draft du jour, servie par le serveur (`draft.js`).
//
// Le partage est celui de l'Arcade, à une nuance près : le serveur tient la run
// (graine, choix, relances, duels, vie rachetée, gemmes) et le CLIENT calcule
// l'offre à partir de cette graine (`logic/Draft.ts`), parce qu'elle repose sur
// les règles d'invocation que Node ne porte pas. Aucune copie locale : un
// rechargement ou un autre appareil relit « où j'en suis aujourd'hui ».
//
// Les duels sont des matchs EN LIGNE : leur résultat est soldé par le serveur à
// la clôture du match, et arrive avec `match:end` (champ `draft`). Le store ne
// rapporte donc rien ; il retient ce que le match a rendu et relit la run.
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import * as CardDatabase from '../data/CardDatabase.js';
import { useAuthStore } from './authStore.js';
import { createSnapshotChannel } from './snapshotLoader.js';
import { draftPool, type DraftState } from '../logic/Draft.js';
import type { Card } from '../logic/types.js';

export interface DraftRun extends DraftState {
  day: string;
  gems_earned: number;
}

/** Le solde d'un duel tel que le serveur l'annonce avec `match:end`. */
export interface DraftDuelOutcome {
  result: 'win' | 'loss';
  status: DraftRun['status'];
  granted: { gems: number } | null;
}

export interface DraftSnapshot {
  day: string;
  next_rotation_at: number;
  rules: {
    extra_life_price_gems: number;
    /** Gemmes de la 1ʳᵉ, 2ᵉ… victoire. */
    win_gems: number[];
  };
  run: DraftRun | null;
}

function pickSnapshot(data: any): DraftSnapshot {
  return {
    day: data.day,
    next_rotation_at: data.next_rotation_at,
    rules: {
      extra_life_price_gems: data.rules?.extra_life_price_gems ?? 0,
      win_gems: data.rules?.win_gems ?? [],
    },
    run: data.run ?? null,
  };
}

/** Le catalogue du draft, calculé une fois (il ne change pas en cours de session). */
let poolCache: Card[] | null = null;
export function getDraftPool(): Card[] {
  if (!poolCache) poolCache = draftPool((CardDatabase as any).getAllCards() as Card[]);
  return poolCache;
}

const channel = createSnapshotChannel<DraftSnapshot>({
  fetch: () => (AuthClient as any).getDraft(),
  pick: pickSnapshot,
  errorLabel: 'Draft indisponible.',
});

interface DraftStoreState {
  snapshot: DraftSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Ce que le dernier duel a soldé dans la run (`match:end`), affiché une
   *  fois sur l'écran de résultat. */
  lastDuel: DraftDuelOutcome | null;

  load: (force?: boolean) => Promise<void>;
  start: () => Promise<string | null>;
  /** Une carte, ou les trois d'un lot. */
  pick: (cardIds: string[], mod?: 'malus' | 'bonus') => Promise<string | null>;
  reroll: () => Promise<string | null>;
  buyLife: () => Promise<string | null>;
  /** Retient le solde annoncé par `match:end` (`null` : rien de soldé). */
  noteDuel: (outcome: DraftDuelOutcome | null) => void;
}

export const useDraftStore = create<DraftStoreState>((set, get) => {
  /** Une mutation : appel serveur, instantané rendu, progression appliquée.
   *  Un 409 veut dire que le serveur sait mieux (autre onglet) : on relit. */
  const mutate = async (call: () => Promise<any>, fallback: string): Promise<string | null> => {
    if (get().busy) return null;
    set({ busy: true });
    try {
      const data = await call();
      channel.bump();
      set({ snapshot: pickSnapshot(data) });
      useAuthStore.getState().applyProgression(data.progression);
      return null;
    } catch (e: any) {
      if (e?.status === 409) void get().load(true);
      return e?.message ?? fallback;
    } finally {
      set({ busy: false });
    }
  };

  return {
    snapshot: null,
    loading: false,
    busy: false,
    error: null,
    lastDuel: null,

    load: channel.load(set, get),
    start: () => mutate(() => (AuthClient as any).startDraft(), 'Impossible de lancer le draft.'),
    pick: (cardIds, mod) => mutate(() => (AuthClient as any).pickDraftCards(cardIds, mod), 'Choix non enregistré.'),
    reroll: () => mutate(() => (AuthClient as any).rerollDraft(), 'Relance impossible.'),
    buyLife: () => mutate(() => (AuthClient as any).buyDraftLife(), 'Achat impossible.'),
    // Rien à relire ici : l'écran Draft relit la run à son montage, c'est-à-dire
    // au retour du match, une fois le duel soldé côté serveur.
    noteDuel: (outcome) => set({ lastDuel: outcome }),
  };
});
