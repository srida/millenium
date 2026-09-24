// LinkedCardsModal — le panneau ouvert par le bouton 🧬 du tooltip d'une
// carte : ses matériels, sa lignée, et les cartes qui la consomment comme
// matériel. Montée UNE FOIS au niveau de l'App, comme `TooltipHost` et
// `RewardToasts` — elle n'est visible que quand `uiStore.linkedCards` l'est.
//
// ⚠️ Deux modes, JAMAIS une seconde règle d'ajout : sans `deckPickContext`
// (Catalogue, ou tout autre écran), c'est une consultation pure comme le
// Catalogue — chaque vignette n'ouvre que SA PROPRE infobulle. Avec lui (le
// DeckBuilder est monté), le tap fait l'aller-retour dans le deck en cours
// d'édition — EXACTEMENT le geste de sa bibliothèque (`tapOn="up"`, retire si
// déjà dedans, ajoute sinon), parce que c'est littéralement les mêmes
// fonctions qui décident, prêtées par l'écran via `uiStore.deckPickContext`.
// Le tooltip d'une carte affichée ici porte lui-même son bouton 🧬 : c'est ce
// qui rend le panneau réentrant sans code de navigation dédié — un appui long
// puis un tap sur 🧬 REMPLACE le contenu du même état, aucune pile à gérer.
import { useMemo } from 'react';
import * as CardDatabase from '../../data/CardDatabase.js';
import { linkedCardGroups } from '../../data/CardLinks.js';
import { useUiStore, type DeckPickContext } from '../../stores/uiStore.js';
import { Modal } from '../ui/primitives.js';
import Card3D, { cardVisualProps } from '../ui/Card3D.js';
import type { Card } from '../../logic/types.js';

function CardGroup({ title, cards, pick }: { title: string; cards: Card[]; pick: DeckPickContext | null }) {
  if (!cards.length) return null;
  return (
    <div className="mt-3 first:mt-0">
      <div className="text-[10px] tracking-widest text-white/40">
        {title} ({cards.length})
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-2">
        {cards.map(c => {
          if (!pick) return <Card3D key={c.id} {...cardVisualProps(c)} size="h-auto w-full" tapOn="up" />;
          // Même lecture que `LibraryPanel` du DeckBuilder, au mot près :
          // déjà dans le deck → liseré or + tap qui RETIRE ; verrouillée (non
          // possédée) ou tier plein → grisée et intapable, sauf si déjà
          // dedans (c'est justement sur un tier plein qu'il faut pouvoir
          // faire de la place, et un héritage verrouillé reste retirable).
          const locked = !pick.owns(c.id);
          const inDeck = pick.inDeck(c.id);
          const full = !pick.canAdd(c);
          return (
            <Card3D
              key={c.id} {...cardVisualProps(c)} size="h-auto w-full"
              tapOn="up" onTap={() => pick.onTap(c)}
              locked={locked}
              disabled={!inDeck && (locked || full)}
              dim={locked ? 'strong' : inDeck ? 'soft' : full ? 'strong' : 'none'}
              highlight={inDeck ? 'selected' : 'none'}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function LinkedCardsModal() {
  const linked = useUiStore(s => s.linkedCards);
  const hideLinkedCards = useUiStore(s => s.hideLinkedCards);
  const deckPick = useUiStore(s => s.deckPickContext);
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
      <CardGroup title="MATÉRIELS" cards={groups.materials} pick={deckPick} />
      <CardGroup title="LIGNÉE" cards={groups.lineage} pick={deckPick} />
      <CardGroup title="UTILISÉE PAR" cards={groups.usedBy} pick={deckPick} />
    </Modal>
  );
}
