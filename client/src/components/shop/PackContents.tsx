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
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as CardDatabase from '../../data/CardDatabase.js';
import type { Card } from '../../logic/types.js';
import { primaryTier } from '../../logic/Tiers.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useCollectionStore } from '../../stores/collectionStore.js';
import type { ShopSet } from '../../stores/shopStore.js';
import { Button, Gauge } from '../ui/primitives.js';
import CardCatalogGrid from '../catalog/CardCatalogGrid.js';

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

export default function PackContents({ set, onClose }: { set: ShopSet; onClose: () => void }) {
  // La feuille porte son PROPRE `onPointerDown={hideTooltip}` pour être
  // autonome : elle s'ouvre depuis la boutique aujourd'hui, mais rien dans son
  // contrat ne l'y attache, et un appui long sur une vignette doit toujours
  // pouvoir se refermer.
  //
  // (Ce n'est PAS parce que le portal la couperait du handler de `ShopScreen` :
  // les événements synthétiques React traversent un portal via l'arbre REACT,
  // pas via le DOM — le `<main>` parent les reçoit donc bel et bien. C'est la
  // même propriété qui rend le portal de `Modal` sans conséquence pour ses
  // appelants.)
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const ownedIds = useCollectionStore(s => s.ownedIds);

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
      .sort((a, b) => primaryTier(a) - primaryTier(b) || a.name.localeCompare(b.name, 'fr')),
    [set.card_ids],
  );

  const owns = (id: string) => ownedIds.has(id);

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
        </div>
      </header>

      {/* Même UI que la bibliothèque du DeckBuilder / le Catalogue, scopée aux
          seules cartes du pack : recherche, tiers, tri, possession — sur une
          ligne — puis la grille. Une carte manquante s'affiche COMME LES
          AUTRES (pas de cadenas ni de grisage) : c'est le filtre de
          possession qui distingue, pas la vignette. */}
      <CardCatalogGrid
        cards={cards}
        owns={owns}
        webPadding={false}
        emptyMessage="Aucune carte ne correspond à ces filtres."
        className="mx-auto w-full max-w-3xl"
      />
    </div>,
    document.body,
  );
}
