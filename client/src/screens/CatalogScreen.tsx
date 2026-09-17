/* eslint-disable @typescript-eslint/no-explicit-any */
// CatalogScreen — toutes les cartes du jeu, obtenues ou non. Consultation pure
// (pas de deck en construction) : reprend l'UI de la bibliothèque du
// DeckBuilder (`CardCatalogGrid`), sans les lanes ni l'ajout/retrait.
import { useEffect, useMemo } from 'react';
import * as CardDatabase from '../data/CardDatabase.js';
import { primaryTier } from '../logic/Tiers.js';
import { useUiStore } from '../stores/uiStore.js';
import { useCollectionStore } from '../stores/collectionStore.js';
import CardCatalogGrid from '../components/catalog/CardCatalogGrid.js';
import { useWebLayout } from '../components/system/useWebLayout.js';

export default function CatalogScreen() {
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const web = useWebLayout();

  // Collection du joueur, comme le DeckBuilder : rechargée au montage pour
  // refléter un déblocage obtenu depuis la dernière visite. Invité → repli sur
  // la dotation de départ (cf. `collectionStore`), le catalogue reste consultable.
  const ownedIds = useCollectionStore(s => s.ownedIds);
  const rankOf = useCollectionStore(s => s.rankOf);
  useEffect(() => { void useCollectionStore.getState().load(true); }, []);

  const allCards = useMemo(() => (CardDatabase as any).getAllCards()
    .slice().sort((a: any, b: any) => primaryTier(a) !== primaryTier(b)
      ? primaryTier(a) - primaryTier(b)
      : a.name.localeCompare(b.name, 'fr')), []);

  const owns = useMemo(() => (id: string) => ownedIds.has(id), [ownedIds]);
  const ownedCount = useMemo(() => allCards.filter((c: any) => owns(c.id)).length, [allCards, owns]);

  return (
    <main className="flex min-h-full flex-col relative z-10 text-white" onPointerDown={hideTooltip}>
      <div className={`flex items-center gap-3 px-4 py-3 ${web ? 'px-22' : ''}`}>
        <h1 className="truncate text-lg font-bold tracking-wide">Catalogue</h1>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-white/40">
          {ownedCount}/{allCards.length} débloquées
        </span>
      </div>
      <CardCatalogGrid cards={allCards} owns={owns} rankOf={rankOf} />
    </main>
  );
}
