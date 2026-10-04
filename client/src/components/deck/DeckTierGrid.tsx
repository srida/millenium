// Le deck rangé par tier, en vignettes : la présentation de l'onglet « Deck »
// du DeckBuilder, partagée avec l'écran Draft. Ne décide rien — chaque vignette
// est rendue par l'appelant (geste, cosmétiques, verrou), ce composant ne pose
// que les cinq bandeaux et leur décompte.
import type { ReactNode } from 'react';
import type { Card } from '../../logic/types.js';
import TierIcon from '../ui/TierIcon.js';

// Classes littérales : Tailwind ne voit pas une classe composée à l'exécution.
export const TIER_TEXT: Record<number, string> = {
  1: 'text-tier-1', 2: 'text-tier-2', 3: 'text-tier-3', 4: 'text-tier-4', 5: 'text-tier-5',
};

const TIERS = [1, 2, 3, 4, 5] as const;

export default function DeckTierGrid({ deck, tierMax, renderCard, className = '' }: {
  deck: Record<number, Card[]>;
  /** Plafond par tier : affiché `n/max`, en rouge une fois atteint. Absent, le
   *  décompte est nu. */
  tierMax?: Record<number, number>;
  renderCard: (card: Card, tier: number, index: number) => ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-3 ${className}`}>
      {TIERS.map(t => {
        const cards = deck[t] ?? [];
        const max = tierMax?.[t];
        const full = max != null && cards.length >= max;
        return (
          <div key={t} className="rounded-lg border border-line bg-surface-raised/50 p-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span className={`flex items-center gap-1.5 text-xs font-bold ${TIER_TEXT[t]}`}><TierIcon tier={t} className="h-4 w-4" /> Tier {t}</span>
              <div className="h-px flex-1 bg-line" />
              <span className={`text-xs font-bold tabular-nums ${full ? 'text-danger' : 'text-white/50'}`}>
                {max != null ? `${cards.length}/${max}` : cards.length}
              </span>
            </div>
            {cards.length === 0
              ? <div className="py-2 text-center text-[11px] text-white/30">Aucune carte de tier {t}</div>
              : (
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
                  {cards.map((c, idx) => renderCard(c, t, idx))}
                </div>
              )}
          </div>
        );
      })}
    </div>
  );
}
