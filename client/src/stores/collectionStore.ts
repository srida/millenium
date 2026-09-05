/* eslint-disable @typescript-eslint/no-explicit-any */
// collectionStore — cartes que le joueur possède réellement (source : la table
// user_cards du serveur, exposée par GET /api/me/progression).
//
// Invité : repli sur les cartes de DÉPART, exactement la dotation d'un compte
// neuf. Le jeu se joue sans compte (auth optionnelle) : un invité sans aucune
// carte ne pourrait plus construire de deck, et ce qu'il bâtit reste valable
// s'il s'inscrit ensuite.
import { create } from 'zustand';
import * as AuthClient from '../data/AuthClient.js';
import * as CardDatabase from '../data/CardDatabase.js';

// Repli du repli : préfixe historique de la dotation, utilisé seulement si les
// cartes servies ne portent pas `_starter` (serveur antérieur au pack de départ).
const STARTER_PREFIX = 'CORE';

/**
 * La dotation est DÉSIGNÉE côté serveur (pack marqué « départ » dans
 * `sets.json`) et voyage sur chaque carte de `/api/cards` via `_starter` — le
 * client n'a donc plus à dupliquer la règle.
 */
function starterCardIds(): string[] {
  const all = (CardDatabase as any).getAllCards() as { id: string; _starter?: boolean }[];
  const designed = all.filter(c => c._starter).map(c => c.id);
  if (designed.length) return designed;
  return all.map(c => c.id).filter(id => String(id).toUpperCase().startsWith(STARTER_PREFIX));
}

/** Une liste ORDONNÉE d'ids → les deux lectures que l'écran en fait. */
function fromOrdered(ids: string[]): { ownedIds: Set<string>; ownedRank: Map<string, number> } {
  return { ownedIds: new Set(ids), ownedRank: new Map(ids.map((id, i) => [id, i])) };
}

interface CollectionStoreState {
  ownedIds: Set<string>;
  /**
   * Rang d'OBTENTION d'une carte : 0 pour la première possédée, puis dans
   * l'ordre où elles sont tombées. Le serveur envoie `unlocked_cards` dans cet
   * ordre (`user_cards.unlocked_at`) — c'est la seule information de cette
   * liste que le client ne peut pas recalculer.
   *
   * ⚠️ Une MAP explicite, pas l'ordre d'itération du `Set`. Les deux
   * coïncident aujourd'hui, mais faire porter un ordre SÉMANTIQUE par un
   * conteneur choisi pour ses `has()` est le genre de dépendance qu'un
   * `new Set([...a, ...b])` ailleurs casse sans un mot.
   *
   * ⚠️ Un admin et un invité n'ont pas d'historique (collection calculée du
   * catalogue, ou dotation de départ) : le rang y retombe sur l'ordre du
   * catalogue. On trie sur ce qu'on reçoit, on n'invente pas une date.
   */
  ownedRank: Map<string, number>;
  /** Vrai dès que `load()` a abouti (serveur OU repli invité). */
  loaded: boolean;
  loading: boolean;
  owns: (cardId: string) => boolean;
  /** Le rang d'obtention, ou `null` pour une carte non possédée. */
  rankOf: (cardId: string) => number | null;
  /** Charge la collection. `force` refait l'appel même si déjà chargée (login/logout). */
  load: (force?: boolean) => Promise<void>;
  /** Ajoute des cartes fraîchement débloquées (achat en boutique, booster). */
  add: (cardIds: string[]) => void;
  reset: () => void;
}

export const useCollectionStore = create<CollectionStoreState>((set, get) => ({
  ownedIds: new Set(),
  ownedRank: new Map(),
  loaded: false,
  loading: false,

  owns: (cardId) => get().ownedIds.has(cardId),
  rankOf: (cardId) => get().ownedRank.get(cardId) ?? null,

  load: async (force = false) => {
    if (get().loading || (get().loaded && !force)) return;
    set({ loading: true });
    try {
      const { unlocked_cards } = await (AuthClient as any).getProgression();
      set({ ...fromOrdered(unlocked_cards ?? []), loaded: true });
    } catch {
      // Invité (401) ou serveur injoignable : dotation de départ. Mieux vaut un
      // DeckBuilder utilisable qu'un écran vide.
      set({ ...fromOrdered(starterCardIds()), loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  // Le serveur a déjà débloqué ces cartes : on reflète le déblocage localement
  // plutôt que de relancer /me/progression (398 ids) après chaque achat.
  add: (cardIds) => {
    if (!cardIds?.length) return;
    // Elles viennent d'être obtenues : elles vont donc à la FIN du classement,
    // et les rangs déjà attribués ne bougent pas.
    set(s => {
      const ownedRank = new Map(s.ownedRank);
      let next = ownedRank.size;
      for (const id of cardIds) if (!ownedRank.has(id)) ownedRank.set(id, next++);
      return { ownedIds: new Set([...s.ownedIds, ...cardIds]), ownedRank };
    });
  },

  reset: () => set({ ownedIds: new Set(), ownedRank: new Map(), loaded: false, loading: false }),
}));
