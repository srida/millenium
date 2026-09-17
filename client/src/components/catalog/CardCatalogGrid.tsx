/* eslint-disable @typescript-eslint/no-explicit-any */
// CardCatalogGrid — la bibliothèque de cartes, partagée entre l'écran
// Catalogue et le contenu d'un pack (`PackContents`). Reprend le patron du
// DeckBuilder (`LibraryPanel` : barre de requête + chips de tier + tri) mais
// sans le vocabulaire d'un deck en construction (pas d'ajout/retrait, pas de
// lanes) — ici on CONSULTE, on ne construit rien.
//
// ⚠️ Une carte non possédée s'affiche COMME LES AUTRES, sans cadenas ni
// grisage : contrairement au DeckBuilder et à `PackContents` (où « verrouillée »
// veut dire « intapable »), le Catalogue n'a rien à empêcher — la seule
// différence entre « obtenue » et « à obtenir » est le filtre de possession.
//
// ⚠️ UNE seule source de vérité pour le filtrage : la requête. Le tri vit À
// CÔTÉ (un axe indépendant), comme dans le DeckBuilder.
import { useMemo, useState, type ReactNode } from 'react';
import * as Query from '../../../../card-query.mjs';
import * as AttributeDatabase from '../../data/AttributeDatabase.js';
import { summonCostOf } from '../../data/SummonInfo.js';
import type { Card } from '../../logic/types.js';
import Card3D, { cardVisualProps } from '../ui/Card3D.js';
import QueryBar from '../ui/QueryBar.js';
import SortControl, { type SortState } from '../ui/SortControl.js';
import { usePressSquash } from '../ui/primitives.js';
import { useWebLayout } from '../system/useWebLayout.js';
import OwnershipToggle, { type Ownership } from './OwnershipToggle.js';

const TIER_TEXT: Record<number, string> = {
  1: 'text-tier-1', 2: 'text-tier-2', 3: 'text-tier-3', 4: 'text-tier-4', 5: 'text-tier-5',
};

// Même chip que le DeckBuilder et `PackContents` (bordure/fond or si actif).
function Chip({ active, onTap, children }: { active: boolean; onTap: () => void; children: ReactNode }) {
  const { handlers } = usePressSquash<HTMLButtonElement>(onTap, false);
  return (
    <button
      type="button"
      className={`min-h-tap rounded-full border px-3 text-xs font-semibold ${active ? 'border-gold bg-[color-mix(in_srgb,var(--color-gold)_20%,var(--color-surface-raised))] text-gold' : 'border-line bg-surface-raised text-white/60'}`}
      {...handlers}
    >{children}</button>
  );
}

function ownershipOfQuery(query: string, schema: any): Ownership {
  if (Query.hasFacetOp(query, schema, 'debloquee', 'oui')) return 'owned';
  if (Query.hasFacetOp(query, schema, 'debloquee', 'non')) return 'missing';
  return 'all';
}

export interface CardCatalogGridProps {
  /** Le pool à filtrer/trier — déjà scopé par l'appelant (tout le catalogue,
   *  ou les seules cartes d'un pack). */
  cards: Card[];
  owns: (id: string) => boolean;
  /** Ordre d'obtention — absent en dehors d'un joueur réel (rien à trier). */
  rankOf?: (id: string) => number | null;
  emptyMessage?: string;
  /** `false` désactive le padding latéral `px-22` en layout web : à utiliser
   *  quand l'appelant contraint déjà la largeur lui-même (ex. `PackContents`,
   *  centré en `max-w-3xl`). */
  webPadding?: boolean;
  className?: string;
}

export default function CardCatalogGrid({
  cards, owns, rankOf, emptyMessage = 'Aucune carte trouvée.', webPadding = true, className = '',
}: CardCatalogGridProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>({ key: '', dir: 'asc' });
  const web = useWebLayout();

  const allAttributes = useMemo(() => (AttributeDatabase as any).getAllAttributes()
    .slice().sort((a: any, b: any) => a.name.localeCompare(b.name, 'fr')), []);

  // Même schéma que le DeckBuilder : le catalogue partagé avec l'admin, plus
  // ce que seul un joueur porte (possession, ordre d'obtention).
  const schema = useMemo(() => {
    const base = Query.cardQuerySchema({
      summonCost: summonCostOf,
      attributeName: (id: string) => {
        try { return (AttributeDatabase as any).getAttribute(id)?.name ?? id; } catch { return id; }
      },
      attributeOptions: () => allAttributes.map((a: any) => ({ value: a.id, label: a.name })),
      tierOptions: () => [1, 2, 3, 4, 5].map(t => ({ value: String(t), label: String(t) })),
    });
    const extra: any[] = [
      { key: 'debloquee', aliases: ['possedee', 'owned'], label: 'Débloquée dans ma collection',
        type: 'bool', get: (c: Card) => owns(c.id) },
    ];
    if (rankOf) {
      extra.push({
        key: 'obtention', aliases: ['obtenue', 'acquisition'], label: 'Ordre d\'obtention',
        type: 'number', get: (c: Card) => rankOf(c.id),
      });
    }
    return { ...base, fields: [...base.fields, ...extra] };
  }, [allAttributes, owns, rankOf]);

  const { items: matching, error: queryError } = Query.filterByQuery(cards, query, schema) as
    { items: Card[]; error: string | null };
  const shown = Query.sortItems(matching, schema, sort) as Card[];

  const ownership = ownershipOfQuery(query, schema);
  const setOwnership = (next: Ownership) => setQuery(
    Query.setFacet(query, schema, 'debloquee', next === 'all' ? '' : next === 'owned' ? 'oui' : 'non'),
  );
  const onTier = (t: number) => Query.hasFacetOp(query, schema, 'tier', t);
  const toggleTier = (t: number) => setQuery(Query.toggleFacet(query, schema, 'tier', t));

  let classnameFilter = 'space-y-2 border-b border-line p-3';
  if (web && webPadding) classnameFilter += ' px-22';
  let classnameCards = 'min-h-0 flex-1 overflow-y-auto p-3';
  if (web && webPadding) classnameCards += ' px-22';

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      <div className={classnameFilter}>
        {/* Même agencement que la bibliothèque du DeckBuilder : la recherche
            sur sa propre ligne, le reste des filtres (tiers, tri, possession)
            sur la ligne suivante. */}
        <QueryBar
          value={query} onChange={setQuery} schema={schema} error={queryError}
          placeholder="Rechercher…" examples={Query.CARD_QUERY_EXAMPLES}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {[1, 2, 3, 4, 5].map(t => (
            <Chip key={t} active={onTier(t)} onTap={() => toggleTier(t)}>
              <span className={TIER_TEXT[t]}>T{t}</span>
            </Chip>
          ))}
          <SortControl schema={schema} value={sort} onChange={setSort} className="ml-auto" />
          <OwnershipToggle value={ownership} onChange={setOwnership} />
        </div>
      </div>

      <div className={classnameCards}>
        {shown.length === 0
          ? <p className="py-10 text-center text-sm text-white/40">{emptyMessage}</p>
          : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
              {shown.map(c => (
                <Card3D key={c.id} {...cardVisualProps(c)} size="h-auto w-full" tapOn="up" />
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
