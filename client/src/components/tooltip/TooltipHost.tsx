/* eslint-disable @typescript-eslint/no-explicit-any */
// TooltipHost — instance globale unique pilotée par uiStore (remplace l'ancien
// singleton DOM Tooltip.js). Tap ailleurs → fermeture (géré au niveau App).
import { useLayoutEffect, useRef, useState } from 'react';
import { useUiStore, type TooltipAnchor, type TooltipContent } from '../../stores/uiStore.js';
import { getPower } from '../../data/PowerDatabase.js';
import { getAttribute } from '../../data/AttributeDatabase.js';
import { getCard } from '../../data/CardDatabase.js';

const STAT_LABELS: Record<string, string> = {
  atk: 'ATQ', hp: 'PV', attack_speed: 'VIT', range: 'POR', movement_speed: 'DEP',
};

export default function TooltipHost() {
  const tooltip = useUiStore(s => s.tooltip);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!tooltip || !ref.current) return;
    const el = ref.current;
    const w = el.offsetWidth || 240;
    const h = el.offsetHeight || 180;
    const a = tooltip.anchor;
    let left = a.left + a.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    const top = a.top - h - 8 > 0 ? a.top - h - 8 : a.bottom + 8;
    setPos({ left, top });
  }, [tooltip]);

  if (!tooltip) return null;

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-50 w-60 rounded-xl border border-gold/60 bg-surface/97 p-3 text-white shadow-2xl backdrop-blur"
      style={{ left: pos.left, top: pos.top }}
    >
      <TooltipBody content={tooltip.content} anchor={tooltip.anchor} />
    </div>
  );
}

function StatsRow({ stats }: { stats: Record<string, number> }) {
  return (
    <div className="mt-2 flex overflow-hidden rounded-lg border border-white/10 bg-white/5">
      {Object.entries(STAT_LABELS).map(([k, label]) => (
        <div key={k} className="flex flex-1 flex-col items-center gap-0.5 border-r border-white/5 py-1.5 last:border-r-0">
          <span className="text-[8px] tracking-widest text-white/40">{label}</span>
          <span className="text-xs font-bold tabular-nums">{stats[k]}</span>
        </div>
      ))}
    </div>
  );
}

function Keywords({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {ids.map(id => {
        const attr = (getAttribute as any)(id);
        return <span key={id} className="rounded border border-tier-4/40 bg-tier-4/10 px-2 py-0.5 text-[10px] text-tier-4">{attr?.name ?? id}</span>;
      })}
    </div>
  );
}

function TooltipBody({ content, anchor }: { content: TooltipContent; anchor: TooltipAnchor }) {
  void anchor;
  if (content.kind === 'card' || content.kind === 'unit') {
    const isUnit = content.kind === 'unit';
    const data: any = isUnit ? content.unit : content.card;
    const power = data.power_id ? (getPower as any)(data.power_id) : (data.power?.id ? (getPower as any)(data.power.id) : null);
    const stats = isUnit
      ? { atk: data.atk, hp: data.current_hp, attack_speed: data.attack_speed, range: data.range, movement_speed: data.movement_speed }
      : { atk: data.stats.atk, hp: data.stats.hp, attack_speed: data.stats.attack_speed, range: data.stats.range, movement_speed: data.stats.movement_speed };
    const lineage = isUnit ? (data.represented_ids ?? []).filter((id: string) => id !== data.card_id) : [];

    return (
      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">{data.name}</span>
          <span className="rounded border border-gold/40 px-1.5 text-[10px] font-bold text-gold">T{data.tier}</span>
        </div>
        <StatsRow stats={stats} />
        <Keywords ids={data.attributes ?? []} />
        {power && (
          <div className="mt-2 rounded-lg border border-orange-400/25 bg-orange-500/5 p-2">
            <div className="text-[11px] font-bold text-orange-300">{power.name ?? data.power_id}</div>
            {isUnit
              ? <div className="text-[10px] text-white/60">Jauge {data.power_gauge}/{data.power_speed}</div>
              : power.description && <div className="text-[10px] text-white/60">{power.description}</div>}
          </div>
        )}
        {isUnit && data.shield > 0 && <div className="mt-1 text-[11px] text-gold">🛡 Bouclier : {data.shield}</div>}
        {lineage.length > 0 && (
          <div className="mt-1 text-[11px] text-player">🧬 {lineage.map((id: string) => (getCard as any)(id)?.name ?? id).join(', ')}</div>
        )}
        {isUnit && (data.veterancy_points ?? 0) >= 2 && (
          <div className="mt-1 text-[11px] text-gold">★ Vétéran ({data.veterancy_points})</div>
        )}
      </div>
    );
  }

  if (content.kind === 'attribute') {
    const attr: any = content.attr;
    return (
      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">{attr.name}</span>
          <span className="text-[11px] text-white/50">{content.count} présent{content.count > 1 ? 's' : ''}</span>
        </div>
        <div className="mt-2 space-y-1">
          {(attr.thresholds ?? []).map((t: any, i: number) => {
            const active = content.activeThreshold && t.count <= (content.activeThreshold as any).count;
            return (
              <div key={i} className={`text-[11px] ${active ? 'text-gold' : 'text-white/40'}`}>
                {active ? '●' : '○'} {t.count} — {describeEffects(t.effects)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // terrain
  const b: any = content.board;
  return (
    <div>
      <div className="text-sm font-bold">🗺️ {b.name}</div>
      <div className="mt-1 text-[11px] text-white/60">{b.effect ? describeEffects([b.effect]) : 'Aucun effet'}</div>
    </div>
  );
}

function describeEffects(effects: any[]): string {
  return (effects ?? []).map((e: any) => {
    switch (e.type) {
      case 'stat_bonus': return `+${e.value} ${STAT_LABELS[e.stat] ?? e.stat}`;
      case 'stat_modifier': return `×${e.value} ${STAT_LABELS[e.stat] ?? e.stat}`;
      case 'draw_bonus': return `+${e.value} pioche`;
      case 'guaranteed_draw': return 'Pioche garantie';
      case 'revive': return 'Réanimation';
      case 'shield': return `Bouclier +${e.value}`;
      case 'board_slot_bonus': return `+${e.value} slot`;
      default: return e.type;
    }
  }).join(', ');
}
