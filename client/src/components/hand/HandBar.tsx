// Main du joueur : bande horizontale scrollable. Carte grisée si injouable
// (doublon normal, matériaux manquants…). Tap → sélection ; long-press → tooltip.
import { useRef } from 'react';
import { useGameStore, type HandEntry } from '../../stores/gameStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { costHint } from '../../data/CardDatabase.js';

export default function HandBar() {
  const hand = useGameStore(s => s.hand);
  const combatActive = useGameStore(s => s.combatActive);
  const controller = useGameStore(s => s.controller);
  if (combatActive || !controller) return null;

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-14 z-20">
      <div className="flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {hand.length === 0 && <span className="px-2 py-6 text-xs text-white/40">Main vide</span>}
        {hand.map((entry, idx) => (
          <HandCard key={entry.key} entry={entry} idx={idx} />
        ))}
      </div>
    </div>
  );
}

function HandCard({ entry, idx }: { entry: HandEntry; idx: number }) {
  const controller = useGameStore(s => s.controller)!;
  const showTooltip = useUiStore(s => s.showTooltip);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hint = (costHint as (c: unknown) => string | null)(entry.card);

  // Sélection au pointerdown (tap instantané, cohérent avec le reste de l'app) ;
  // maintien 500ms → tooltip carte.
  const clearLong = () => { if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; } };

  return (
    <button
      onPointerDown={(e) => {
        e.stopPropagation();
        controller.selectCard(entry.selected ? null : entry.card, entry.selected ? null : idx);
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        longPress.current = setTimeout(() => {
          showTooltip({ kind: 'card', card: entry.card }, { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
        }, 500);
      }}
      onPointerUp={clearLong}
      onPointerLeave={clearLong}
      onPointerCancel={clearLong}
      className={[
        'relative aspect-[5/7] h-28 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-transform',
        entry.selected ? 'border-gold -translate-y-2' : 'border-line',
        entry.playable ? 'opacity-100' : 'opacity-40 grayscale',
      ].join(' ')}
    >
      <img src={`/illustrations/${entry.card.id}`} alt={entry.card.name} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1 pb-0.5 pt-3">
        <div className="truncate text-[9px] font-semibold leading-tight text-white">{entry.card.name}</div>
      </div>
      <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px] font-bold text-white">T{entry.card.tier}</span>
      {hint && <span className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px]">{hint}</span>}
    </button>
  );
}
