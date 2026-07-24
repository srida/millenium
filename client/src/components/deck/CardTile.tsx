// CardTile — vignette de carte réutilisable (DeckBuilder bibliothèque + lanes).
// Illustration + nom + badge tier + pastille de coût d'invocation. Tap → onTap ;
// long-press 500ms → tooltip carte. Badge optionnel (nombre d'exemplaires).
import { useRef } from 'react';
import type { Card } from '../../logic/types.js';
import { costHint } from '../../data/CardDatabase.js';
import { useUiStore } from '../../stores/uiStore.js';

const TIER_RING: Record<number, string> = {
  1: 'ring-tier-1/50', 2: 'ring-tier-2/50', 3: 'ring-tier-3/50', 4: 'ring-tier-4/50', 5: 'ring-tier-5/50',
};

export default function CardTile({
  card, onTap, disabled = false, badge = null, dimmed = false, size = 'h-24',
}: {
  card: Card;
  onTap: () => void;
  disabled?: boolean;
  badge?: number | null;
  dimmed?: boolean;
  size?: string;
}) {
  const showTooltip = useUiStore(s => s.showTooltip);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false); // un long-press a ouvert le tooltip → annule le tap suivant
  const clearLong = () => { if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; } };
  const hint = (costHint as (c: unknown) => string | null)(card);

  // Tap = onClick (fiable mobile + automatisation) ; maintien 500ms = tooltip.
  return (
    <button
      onPointerDown={(e) => {
        e.stopPropagation();
        suppressClick.current = false;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        longPress.current = setTimeout(() => {
          longPress.current = null;
          suppressClick.current = true;
          showTooltip({ kind: 'card', card }, { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
        }, 500);
      }}
      onPointerUp={clearLong}
      onPointerLeave={clearLong}
      onPointerCancel={clearLong}
      onClick={(e) => {
        clearLong();
        if (suppressClick.current) { suppressClick.current = false; return; }
        if (!disabled) { e.stopPropagation(); onTap(); }
      }}
      className={[
        'relative aspect-[5/7] flex-shrink-0 overflow-hidden rounded-lg border-2 transition-transform ring-1 ring-inset',
        size,
        TIER_RING[card.tier] ?? 'ring-white/10',
        disabled ? 'border-line' : 'border-line active:scale-95',
        dimmed ? 'opacity-40 grayscale' : 'opacity-100',
      ].join(' ')}
    >
      <img src={`/illustrations/${card.id}`} alt={card.name} className="pointer-events-none absolute inset-0 h-full w-full object-cover" loading="lazy" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1 pb-0.5 pt-3">
        <div className="truncate text-[9px] font-semibold leading-tight text-white">{card.name}</div>
      </div>
      <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px] font-bold text-white">T{card.tier}</span>
      {hint && <span className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px]">{hint}</span>}
      {badge != null && badge > 0 && (
        <span className="absolute right-0.5 bottom-5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-black">×{badge}</span>
      )}
    </button>
  );
}
