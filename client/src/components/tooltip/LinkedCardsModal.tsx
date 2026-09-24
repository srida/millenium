// LinkedCardsModal — le panneau ouvert par le bouton 🧬 du tooltip d'une
// carte : ses matériels, sa lignée, et les cartes qui la consomment comme
// matériel. Montée UNE FOIS au niveau de l'App, comme `TooltipHost` et
// `RewardToasts` — elle n'est visible que quand `uiStore.linkedCards` l'est.
//
// ⚠️ Consultation PURE, exactement comme le Catalogue : chaque vignette ne
// fait qu'ouvrir SA PROPRE infobulle (appui long, `tapOn="up"` sans `onTap`) —
// aucun ajout/retrait, aucun cadenas sur les cartes non possédées (« le
// Catalogue n'a rien à empêcher »). Le tooltip de la carte affichée y porte
// lui-même son bouton 🧬 : c'est ce qui rend le panneau réentrant sans code
// de navigation dédié — un long tap puis un tap sur 🧬 REMPLACE le contenu du
// même état, aucune pile à gérer.
import { useMemo } from 'react';
import * as CardDatabase from '../../data/CardDatabase.js';
import { linkedCardGroups } from '../../data/CardLinks.js';
import { useUiStore } from '../../stores/uiStore.js';
import { Modal } from '../ui/primitives.js';
import Card3D, { cardVisualProps } from '../ui/Card3D.js';
import type { Card } from '../../logic/types.js';

function CardGroup({ title, cards }: { title: string; cards: Card[] }) {
  if (!cards.length) return null;
  return (
    <div className="mt-3 first:mt-0">
      <div className="text-[10px] tracking-widest text-white/40">
        {title} ({cards.length})
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-2">
        {cards.map(c => (
          <Card3D key={c.id} {...cardVisualProps(c)} size="h-auto w-full" tapOn="up" />
        ))}
      </div>
    </div>
  );
}

export default function LinkedCardsModal() {
  const linked = useUiStore(s => s.linkedCards);
  const hideLinkedCards = useUiStore(s => s.hideLinkedCards);
  // Mémoïsé une fois : le catalogue ne change pas en cours de session, et
  // c'est le même geste que `CatalogScreen` pour la même raison.
  const allCards = useMemo(() => (CardDatabase.getAllCards() as unknown as Card[]), []);

  if (!linked) return null;
  const groups = linkedCardGroups(linked.card, allCards);

  return (
    <Modal onClose={hideLinkedCards} maxWidth="max-w-md">
      <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
        <span className="truncate text-sm font-bold">🧬 {linked.card.name}</span>
        <button
          type="button"
          onPointerDown={(e) => { e.stopPropagation(); hideLinkedCards(); }}
          className="shrink-0 text-lg leading-none text-white/50"
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>
      <CardGroup title="MATÉRIELS" cards={groups.materials} />
      <CardGroup title="LIGNÉE" cards={groups.lineage} />
      <CardGroup title="UTILISÉE PAR" cards={groups.usedBy} />
    </Modal>
  );
}
