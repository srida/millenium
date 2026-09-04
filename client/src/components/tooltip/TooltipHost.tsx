/* eslint-disable @typescript-eslint/no-explicit-any */
// TooltipHost — instance globale unique pilotée par uiStore (remplace l'ancien
// singleton DOM Tooltip.js). Tap ailleurs → fermeture (géré au niveau App).
import { useLayoutEffect, useRef, useState } from 'react';
import { useUiStore, type TooltipAnchor, type TooltipContent } from '../../stores/uiStore.js';
import { getPower } from '../../data/PowerDatabase.js';
import { getAttribute } from '../../data/AttributeDatabase.js';
import AttrIcon, { attributeName } from '../ui/AttrIcon.js';
import PowerIcon from '../ui/PowerIcon.js';
import { Illustration } from '../ui/primitives.js';
import RecipeRow from '../ui/SummonRecipe.js';
import { cardName } from '../../data/gameNames.js';
import { summonRecipes, recipeIsFree } from '../../data/SummonInfo.js';
import { primaryTier } from '../../logic/Tiers.js';
import { materialValueOf } from '../../logic/Unit.js';
import type { Card } from '../../logic/types.js';
import { STAT_LABELS } from '../../data/StatLabels.js';
import { boardEffectLabel } from '../../data/BoardInfo.js';
import TerrainEffects from '../ui/TerrainEffects.js';

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
    let top = a.top - h - 8 > 0 ? a.top - h - 8 : a.bottom + 8;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
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
        return (
          <span key={id} className="inline-flex items-center gap-1 rounded border border-tier-4/40 bg-tier-4/10 px-2 py-0.5 text-[10px] text-tier-4">
            <AttrIcon id={id} className="h-3.5 w-3.5 text-[11px]" />
            {attr?.name ?? id}
          </span>
        );
      })}
    </div>
  );
}

// Invocation — ce que la carte exige pour se poser. Une carte à plusieurs
// CONDITIONS les affiche l'une sous l'autre : ce sont des alternatives, pas un
// cumul.
//
// ⚠️ Plus une ligne ne nomme de voie. Ce que « Fusion » ou « Héritage »
// disaient au joueur se lit dans les ATTRIBUTS de la carte, rendus juste
// au-dessus comme n'importe quel archétype.
function SummonBlock({ card }: { card: any }) {
  const recipes = summonRecipes(card);
  // Rien à exiger n'apprend rien : la carte se pose, point.
  if (recipes.length === 1 && recipeIsFree(recipes[0])) return null;

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="text-[9px] tracking-widest text-white/40">
        {recipes.length > 1 ? 'INVOCATION — AU CHOIX' : 'INVOCATION'}
      </div>
      <div className="mt-1 space-y-1.5">
        {recipes.map((r, i) => <RecipeRow key={r.index ?? i} recipe={r} />)}
      </div>
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
    const shoppingBonus: Record<string, number> = isUnit ? (data._shopping_bonus ?? {}) : {};
    const shoppingEntries = Object.entries(shoppingBonus).filter(([, v]) => v);

    return (
      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">{data.name}</span>
          <span className="rounded border border-gold/40 px-1.5 text-[10px] font-bold text-gold">T{isUnit ? data.tier : primaryTier(data)}</span>
        </div>
        <StatsRow stats={stats} />
        <Keywords ids={data.attributes ?? []} />
        {power && (
          <div className="mt-2 rounded-lg border border-orange-400/25 bg-orange-500/5 p-2">
            <div className="flex items-center gap-1 text-[11px] font-bold text-orange-300">
              <PowerIcon id={data.power_id} fallback="⚡" className="h-3.5 w-3.5 text-[11px]" />
              {power.name ?? data.power_id}
            </div>
            {isUnit
              ? <div className="text-[10px] text-white/60">Jauge {data.power_gauge}/{data.power_speed}</div>
              : power.description && <div className="text-[10px] text-white/60">{power.description}</div>}
          </div>
        )}
        {!isUnit && <SummonBlock card={data} />}
        {isUnit && data.shield > 0 && <div className="mt-1 text-[11px] text-gold">🛡 Bouclier : {data.shield}</div>}
        {/* Ce que l'unité VAUT comme matériau — la question qu'on ne pouvait
            trancher qu'en tentant l'invocation. ⚠️ Sur une UNITÉ elle se dit
            toujours (c'est ici qu'on vient chercher la réponse) ; sur une carte
            en main, seulement au-dessus de 1 — le défaut n'apprend rien à qui
            n'a encore rien posé. La pastille du plateau suit la même règle. */}
        {(isUnit || (data.material_value ?? 1) > 1) && (
          <div className="mt-1 text-[11px] text-tier-2">
            ◈ Vaut {materialValueOf(data as Card)} matériel{materialValueOf(data as Card) > 1 ? 's' : ''} une fois consommée
          </div>
        )}
        {lineage.length > 0 && (
          <div className="mt-1 text-[11px] text-player">🧬 {lineage.map(cardName).join(', ')}</div>
        )}
        {/* ⚠️ Le signe se DÉRIVE de la valeur : une magie de Shopping peut poser
            un malus permanent (MAGIC_012 : −5 vitesse d'attaque), et le « + »
            écrit en dur rendait « +-5 ». */}
        {shoppingEntries.length > 0 && (
          <div className="mt-1 text-[11px] text-gold">
            🛒 {shoppingEntries
              .map(([stat, value]) => `${(value as number) > 0 ? '+' : '−'}${Math.abs(value as number)} ${STAT_LABELS[stat] ?? stat}`)
              .join(', ')}
          </div>
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
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <AttrIcon id={attr.id} fallback={attr.icon} className="h-7 w-7 text-xl" />
            <span className="text-sm font-bold">{attr.name}</span>
          </span>
          <span className="flex-shrink-0 text-[11px] text-white/50">{content.count} présent{content.count > 1 ? 's' : ''}</span>
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
  //
  // Pas d'emoji dans le titre : l'illustration du terrain est déjà là, et le
  // chip de la barre de combat porte la même — 🗺️ n'ajoutait qu'un pictogramme
  // générique à côté de l'image qui, elle, distingue les terrains.
  const b: any = content.board;
  return (
    <div>
      <div className="flex items-center gap-2">
        {b._has_illustration && (
          <Illustration id={b.id} className="h-10 w-10 rounded-md" />
        )}
        <div className="text-sm font-bold">{b.name}</div>
      </div>
      {/* Un effet ne répète PAS ses cibles entre parenthèses : archétypes et
          voies d'invocation sont annoncés juste en dessous, avec leur icône —
          un attribut se reconnaît à son pictogramme bien avant son nom. Le
          rendu est celui de l'annonce d'entrée en combat, au mot près. */}
      <TerrainEffects board={b} className="mt-1" />
    </div>
  );
}

// Les effets d'ATTRIBUT (paliers de synergie) — même grammaire que celle des
// terrains, qu'ils partagent désormais via `data/BoardInfo`. Ici les cibles SONT
// annoncées entre parenthèses : contrairement au terrain, rien ne les répète en
// dessous avec leur icône.
function describeEffects(effects: any[], withTargets = true): string {
  return (effects ?? []).map((e: any) =>
    // ⚠️ `cardName` est passé même sans cibles : une pioche garantie peut NOMMER
    // des cartes, et sans résolveur c'est un id brut qui sort à l'écran.
    boardEffectLabel(e, withTargets ? (ids) => ids.map(attributeName).join(', ') : undefined, cardName),
  ).join(', ');
}
