/* eslint-disable @typescript-eslint/no-explicit-any */
// draftStore — la run de Draft en cours. Toute la RÈGLE vit dans
// `logic/Draft.ts` ; ce store ne fait que tenir l'état, le persister et
// fournir le catalogue.
//
// Entièrement CLIENT, comme le tutoriel : pas de route, pas de table, aucun
// gain propre au mode (seul l'XP habituelle d'une victoire solo, `ai_win`, est
// créditée par l'écran de jeu). Il est donc ouvert aux invités. La run tient
// dans une clé localStorage : un rechargement la reprend, et l'offre étant une
// fonction de l'état, il ne donne pas une nouvelle offre.
import { create } from 'zustand';
import * as CardDatabase from '../data/CardDatabase.js';
import {
  newDraft, pickCard, reroll as rerollDraft, recordResult, parseDraft, draftPool,
  type DraftState,
} from '../logic/Draft.js';
import type { Card } from '../logic/types.js';

const KEY = 'millenium_draft_v1';

function loadState(): DraftState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseDraft(JSON.parse(raw)) : null;
  } catch { return null; }
}

function saveState(state: DraftState | null): void {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch { /* mode privé : la run vit le temps de l'onglet */ }
}

/** Le catalogue du draft, calculé une fois (le catalogue ne change pas en
 *  cours de session). */
let poolCache: Card[] | null = null;
export function getDraftPool(): Card[] {
  if (!poolCache) poolCache = draftPool((CardDatabase as any).getAllCards() as Card[]);
  return poolCache;
}

interface DraftStoreState {
  state: DraftState | null;
  hydrate: () => void;
  start: () => void;
  pick: (cardId: string) => boolean;
  reroll: () => void;
  report: (result: 'win' | 'loss') => void;
  abandon: () => void;
}

export const useDraftStore = create<DraftStoreState>((set, get) => {
  const commit = (state: DraftState | null) => { saveState(state); set({ state }); };
  return {
    state: null,
    hydrate: () => set({ state: loadState() }),
    start: () => commit(newDraft((Math.random() * 0xffffffff) >>> 0)),
    pick: (cardId) => {
      const cur = get().state;
      const next = cur ? pickCard(cur, cardId, getDraftPool()) : null;
      if (!next) return false;
      commit(next);
      return true;
    },
    reroll: () => {
      const cur = get().state;
      const next = cur ? rerollDraft(cur) : null;
      if (next) commit(next);
    },
    report: (result) => {
      const cur = get().state;
      const next = cur ? recordResult(cur, result) : null;
      if (next) commit(next);
    },
    abandon: () => commit(null),
  };
});
