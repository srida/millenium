/* eslint-disable @typescript-eslint/no-explicit-any */
// deckStore — vue réactive sur DeckRepository (localStorage, impératif). React ne
// peut pas observer localStorage : les écrans mutent via DeckRepository puis
// appellent refresh() pour reprojeter la liste. Source de vérité = DeckRepository ;
// ce store n'est qu'un cache de rendu.
import { create } from 'zustand';
import * as DeckRepository from '../data/DeckRepository.js';
import * as CardArt from '../data/CardArt.js';

export interface DeckSummary {
  name: string;
  deck: Record<string, string[]>;
  color: string | null;
  tags: string[];
  count: number;
  dist: Record<number, number>;   // { 1: n, …, 5: n }
}

function summarize(name: string): DeckSummary {
  const deck = ((DeckRepository as any).loadDeck(name) ?? {}) as Record<string, string[]>;
  const dist: Record<number, number> = {};
  let count = 0;
  for (let t = 1; t <= 5; t++) { const n = (deck[String(t)] ?? []).length; dist[t] = n; count += n; }
  return {
    name, deck, count, dist,
    color: (DeckRepository as any).getDeckColor?.(name) ?? null,
    tags: (DeckRepository as any).getDeckTags?.(name) ?? [],
  };
}

interface DeckStoreState {
  decks: DeckSummary[];
  activeDeck: string | null;
  refresh: () => void;
}

export const useDeckStore = create<DeckStoreState>((set) => ({
  decks: [],
  activeDeck: null,
  refresh: () => {
    const activeDeck = ((DeckRepository as any).getActiveDeck?.() ?? null) as string | null;
    // Hors partie (sélecteur de deck, boutique, menu), les vignettes de carte
    // montrent les illustrations du deck ACTIF. En partie, buildSession pose
    // celles du deck réellement engagé — qui peut différer si le joueur a
    // changé de deck actif entre-temps.
    CardArt.setPlayerVariants(activeDeck ? (DeckRepository as any).getDeckVariants?.(activeDeck) : null);
    set({
      decks: ((DeckRepository as any).listDecks() as string[]).map(summarize),
      activeDeck,
    });
  },
}));
