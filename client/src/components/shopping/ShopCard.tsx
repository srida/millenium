// Une carte à l'étal de la boutique de la Phase Shopping : la carte telle
// qu'elle se jouera, son rôle face à ce que le joueur a en jeu, son prix en ⚡.
// Le tap l'achète (relâché, pour laisser l'appui long ouvrir l'infobulle) ;
// rien n'est décidé ici, l'achat passe par `GameController.buyShopCard`.
import Card3D, { cardVisualProps } from '../ui/Card3D.js';
import UiIcon from '../ui/UiIcon.js';
import type { ShopCardEntry } from '../../stores/gameStore.js';

/** Le rôle, dit comme la carte de plus du Draft. */
const KIND_LABEL: Record<ShopCardEntry['kind'], { text: string; tone: string }> = {
  link: { text: 'Lien avec tes cartes', tone: 'text-success' },
  buildable: { text: 'Passe-partout', tone: 'text-white/60' },
  bet: { text: 'Pari : matériaux absents', tone: 'text-gold' },
};

export default function ShopCard({ entry, onBuy }: { entry: ShopCardEntry; onBuy: () => void }) {
  const label = KIND_LABEL[entry.kind];
  return (
    <div className={`flex min-w-0 flex-col items-center gap-1 ${entry.affordable ? '' : 'opacity-40'}`}>
      <Card3D
        {...cardVisualProps(entry.card, 'player', { plain: true })}
        size="h-auto w-full"
        tapOn="up"
        disabled={!entry.affordable}
        onTap={() => { if (entry.affordable) onBuy(); }}
      />
      <span className={`text-center text-[10px] leading-tight ${label.tone}`}>{label.text}</span>
      <span className="inline-flex items-center rounded bg-gold/15 px-1.5 py-px text-[10px] font-bold text-gold">
        <UiIcon id="UI_ENERGY" className="mr-0.5 h-2.5 w-2.5" />{entry.price}
      </span>
    </div>
  );
}
