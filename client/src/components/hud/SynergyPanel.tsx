// Panneau de synergies d'attributs actives (getActiveSynergies). Tap sur une
// puce → tooltip d'attribut.
import { useGameStore } from '../../stores/gameStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useWebLayout } from '../system/useWebLayout.js';
import { getAttribute } from '../../data/AttributeDatabase.js';

export default function SynergyPanel() {
  const synergies = useGameStore(s => s.synergies);
  const combatActive = useGameStore(s => s.combatActive);
  const showTooltip = useUiStore(s => s.showTooltip);
  const web = useWebLayout();
  if (combatActive || synergies.length === 0) return null;

  return (
    // En mode web, la main occupe le rail de gauche : les puces se décalent juste
    // à sa droite.
    <div className={`pointer-events-auto absolute top-14 z-20 flex max-w-[42%] flex-wrap gap-1 ${web ? 'left-54' : 'left-2'}`}>
      {synergies.map(s => {
        const active = !!s.activeThreshold;
        const label = s.nextThreshold ? `${s.count}/${s.nextThreshold.count}` : `${s.count}`;
        return (
          <button
            key={s.attr.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              const full = (getAttribute as (id: string) => unknown)(s.attr.id);
              if (full) showTooltip(
                { kind: 'attribute', attr: full as never, count: s.count, activeThreshold: s.activeThreshold },
                anchorFromEvent(e),
              );
            }}
            className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${active ? 'border-gold bg-gold/15 text-gold' : 'border-line bg-surface/70 text-white/60'}`}
          >
            <span className="max-w-[70px] truncate">{s.attr.name}</span>
            <span className="font-bold tabular-nums">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function anchorFromEvent(e: React.PointerEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
}
