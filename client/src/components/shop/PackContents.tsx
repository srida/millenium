/* eslint-disable @typescript-eslint/no-explicit-any */
// PackContents — le CONTENU d'un pack de boutique, carte par carte.
//
// ⚠️ À ne pas confondre avec `components/shopping/`, qui est la Phase Shopping
// EN JEU (choix d'une magie entre deux combats). Ici on est dans la boutique
// méta : ce dossier est celui de l'écran Boutique.
//
// La tuile d'un pack ne dit de son contenu qu'un nombre — « 12/57 » et une
// jauge. C'est assez pour mesurer son avancement, pas pour arbitrer entre deux
// boosters à 1000 golds : le joueur ne sait pas CE QU'IL RESTE dedans. Cette
// feuille répond à ça, et à rien d'autre — on consulte, on ne vend pas. L'achat
// reste sur la tuile, à un seul endroit.
//
// La composition vient du serveur (`ShopSet.card_ids` — le pool VENDABLE, celui
// dont `card_count`/`owned_count` sont tirés) ; la POSSESSION, elle, se lit dans
// `collectionStore`, que `shopStore.absorb` tient à jour après chaque achat. Une
// carte qui vient de tomber au booster bascule donc en « possédée » ici sans
// rechargement.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as CardDatabase from '../../data/CardDatabase.js';
import * as AttributeDatabase from '../../data/AttributeDatabase.js';
import type { Card } from '../../logic/types.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useCollectionStore } from '../../stores/collectionStore.js';
import type { ShopSet } from '../../stores/shopStore.js';
import { Button, Gauge } from '../ui/primitives.js';
import CardTile, { cardTileProps } from '../ui/CardTile.js';

const TIER_TEXT: Record<number, string> = {
  1: 'text-tier-1', 2: 'text-tier-2', 3: 'text-tier-3', 4: 'text-tier-4', 5: 'text-tier-5',
};

/** Filtre de possession — trois états exclusifs, jamais une case à cocher : ils
 *  ne se cumulent pas (« possédées » ET « à collecter » ne rendrait rien). */
type Ownership = 'all' | 'missing' | 'owned';

const OWNERSHIP_LABELS: [Ownership, string][] = [
  ['all', 'Tout'],
  ['missing', 'À collecter'],
  ['owned', 'Possédées'],
];

/**
 * Affiche du pack — c'est elle qui lui donne un visage à côté de son nom. Sans
 * affiche posée en admin, une tuile neutre : le serveur n'a pas d'image par
 * défaut à servir, et une `<img>` cassée serait pire que rien.
 *
 * Vit ici plutôt que dans `ShopScreen` parce que les deux écrans s'en servent,
 * et qu'un pack sans visage se reconnaît mal dans une liste.
 */
export function PackPoster({ set, className }: { set: ShopSet; className: string }) {
  if (!set.has_poster) {
    return (
      <div className={`${className} flex flex-shrink-0 items-center justify-center rounded-lg border border-line bg-white/5 text-white/25`}>
        🎁
      </div>
    );
  }
  return (
    <img
      src={`/pack-posters/${set.id}`}
      alt=""
      loading="lazy"
      className={`${className} flex-shrink-0 rounded-lg border border-line object-cover`}
    />
  );
}

function Chip({ active, onTap, children }: { active: boolean; onTap: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onPointerDown={onTap}
      className={`min-h-tap rounded-full border px-3 text-xs font-semibold ${active ? 'border-gold bg-gold/20 text-gold' : 'border-line bg-surface-raised text-white/60'}`}
    >{children}</button>
  );
}

export default function PackContents({ set, onClose }: { set: ShopSet; onClose: () => void }) {
  // ⚠️ Le `onPointerDown={hideTooltip}` du <main> de ShopScreen ne couvre PAS
  // cette feuille : elle est montée sur `document.body` par un portal. Sans son
  // propre handler, un appui long sur une vignette ouvrirait un tooltip que
  // plus rien ne pourrait refermer.
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const ownedIds = useCollectionStore(s => s.ownedIds);

  const [tierFilters, setTierFilters] = useState<number[]>([]);
  const [attributeFilter, setAttributeFilter] = useState('');
  const [ownership, setOwnership] = useState<Ownership>('all');

  // Échap ferme, comme toute vue superposée. Le bouton ✕ reste le geste normal
  // au doigt — c'est un raccourci de clavier, pas la seule sortie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Les cartes du pack, résolues une fois. `card_ids` porte le pool vendable :
  // un id introuvable au catalogue (carte supprimée en admin après le tirage de
  // l'instantané) est écarté plutôt que rendu en identifiant brut.
  const cards = useMemo(
    () => set.card_ids
      .map(id => (CardDatabase as any).getCard(id) as Card | null)
      .filter((c): c is Card => !!c)
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, 'fr')),
    [set.card_ids],
  );

  // Tiers RÉELLEMENT présents dans ce pack, avec leur effectif. Un chip qui ne
  // peut rien filtrer est du bruit — et la répartition par tier est justement
  // ce qu'on vient lire (depuis que le booster tire uniformément, la
  // composition du pack EST la distribution des drops).
  const tiers = useMemo(() => {
    const count = new Map<number, number>();
    for (const c of cards) count.set(c.tier, (count.get(c.tier) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => a[0] - b[0]);
  }, [cards]);

  // Attributs présents dans CE pack, triés par effectif décroissant : les
  // archétypes qui portent le pack sortent en tête, là où l'ordre alphabétique
  // du catalogue complet (57 entrées, dont la moitié sans carte ici) noierait
  // le thème sous des options mortes.
  const attributes = useMemo(() => {
    const count = new Map<string, number>();
    for (const c of cards) for (const a of c.attributes ?? []) count.set(a, (count.get(a) ?? 0) + 1);
    return [...count.entries()]
      .map(([id, n]) => ({ id, n, name: (AttributeDatabase as any).getAttribute(id)?.name ?? id }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'fr'));
  }, [cards]);

  const owns = (id: string) => ownedIds.has(id);
  const missingTotal = cards.filter(c => !owns(c.id)).length;

  const shown = useMemo(() => cards.filter(c => {
    if (tierFilters.length && !tierFilters.includes(c.tier)) return false;
    if (attributeFilter && !(c.attributes ?? []).includes(attributeFilter)) return false;
    if (ownership !== 'all' && (ownership === 'owned') !== ownedIds.has(c.id)) return false;
    return true;
  }), [cards, tierFilters, attributeFilter, ownership, ownedIds]);

  const filtering = tierFilters.length > 0 || !!attributeFilter || ownership !== 'all';

  return createPortal(
    // z-40 comme `Modal` : les tooltips de carte (TooltipHost, z-50) doivent
    // rester AU-DESSUS — c'est tout l'intérêt de l'appui long ici.
    <div className="fixed inset-0 z-40 flex flex-col bg-surface text-white" onPointerDown={hideTooltip}>
      {/* En-tête + filtres épinglés : la grille peut faire cinquante-sept
          vignettes, on ne doit jamais avoir à remonter pour changer de filtre
          ni pour fermer. Fond OPAQUE, pas de `backdrop-blur` — il créerait un
          bloc conteneur (cf. le portal de ConfirmBuy). */}
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-3xl px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-start gap-3">
            <PackPoster set={set} className="h-14 w-14" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight">{set.name}</p>
              <p className="truncate text-[10px] text-white/40">{set.archetypes.join(' · ')}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <Gauge
                  value={set.card_count ? set.owned_count / set.card_count : 0}
                  className="h-1.5 flex-1"
                  fillClassName={set.complete ? 'bg-success' : 'bg-gold'}
                />
                <span className={`text-xs tabular-nums ${set.complete ? 'text-success' : 'text-white/50'}`}>
                  {set.owned_count}/{set.card_count}
                </span>
              </div>
            </div>
            <Button className="shrink-0 px-3" onPointerDown={onClose} aria-label="Fermer">✕</Button>
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {tiers.map(([t, n]) => (
                <Chip
                  key={t}
                  active={tierFilters.includes(t)}
                  onTap={() => setTierFilters(f => f.includes(t) ? f.filter(x => x !== t) : [...f, t])}
                >
                  <span className={TIER_TEXT[t]}>T{t}</span>
                  <span className="ml-1 text-white/40 tabular-nums">{n}</span>
                </Chip>
              ))}
            </div>

            {attributes.length > 0 && (
              <select
                value={attributeFilter}
                onChange={(e) => setAttributeFilter(e.target.value)}
                className="min-h-tap w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-white"
              >
                <option value="">Tous les attributs</option>
                {attributes.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.n})</option>
                ))}
              </select>
            )}

            <div className="flex flex-wrap gap-1.5">
              {OWNERSHIP_LABELS.map(([key, label]) => (
                <Chip key={key} active={ownership === key} onTap={() => setOwnership(key)}>{label}</Chip>
              ))}
            </div>

            <p className="text-[11px] text-white/40">
              {shown.length} carte{shown.length > 1 ? 's' : ''} affichée{shown.length > 1 ? 's' : ''}
              {' · '}
              {missingTotal === 0
                ? 'pack complet'
                : `${missingTotal} à collecter dans le pack`}
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {shown.length === 0 ? (
            <p className="py-16 text-center text-sm text-white/40">
              {ownership === 'missing' && !filtering
                ? '✓ Plus rien à collecter dans ce pack.'
                : 'Aucune carte ne correspond à ces filtres.'}
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
              {shown.map(c => {
                // Manquante : cadenas + grisé franc — c'est ce qu'il reste à
                // obtenir. `locked` n'implique PAS `disabled` : il n'y a de
                // toute façon aucun `onTap` ici, on regarde. L'appui long
                // ouvre le tooltip, comme partout ailleurs.
                const locked = !owns(c.id);
                return (
                  <CardTile
                    key={c.id}
                    {...cardTileProps(c)}
                    size="h-auto w-full"
                    tapOn="up"
                    locked={locked}
                    dim={locked ? 'strong' : 'none'}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
