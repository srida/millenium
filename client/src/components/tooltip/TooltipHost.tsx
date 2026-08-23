/* eslint-disable @typescript-eslint/no-explicit-any */
// TooltipHost — instance globale unique pilotée par uiStore (remplace l'ancien
// singleton DOM Tooltip.js). Tap ailleurs → fermeture (géré au niveau App).
import { useLayoutEffect, useRef, useState } from 'react';
import { useUiStore, type TooltipAnchor, type TooltipContent } from '../../stores/uiStore.js';
import { getPower } from '../../data/PowerDatabase.js';
import { getAttribute } from '../../data/AttributeDatabase.js';
import { getCard } from '../../data/CardDatabase.js';
import AttrIcon from '../ui/AttrIcon.js';
import { Illustration } from '../ui/primitives.js';
import {
  summonRecipes, recipeCostText, materialsLabel, recipeIsFree, type SummonRecipe,
} from '../../data/SummonInfo.js';

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

// Le tooltip est rendu depuis des écrans où CardDatabase n'est pas forcément
// initialisée (TestBench, CombatLab et leurs cartes fabriquées) : un id qu'on
// ne sait pas nommer se rend tel quel, il ne fait pas tomber l'affichage.
function cardName(id: string): string {
  try {
    return (getCard as any)(id)?.name ?? id;
  } catch {
    return id;
  }
}

function attributeName(id: string): string {
  try {
    return (getAttribute as any)(id)?.name ?? id;
  } catch {
    return id;
  }
}

// Invocation — comment la carte se pose et ce qu'elle exige. Une carte à
// `summon_options` affiche ses voies l'une sous l'autre : ce sont des
// alternatives, pas un cumul.
function SummonBlock({ card }: { card: any }) {
  const recipes = summonRecipes(card);
  // Une normale sans rien à exiger n'apprend rien : la carte se pose, point.
  if (recipes.length === 1 && recipes[0].summon_type === 'normal' && recipeIsFree(recipes[0])) return null;

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

function RecipeRow({ recipe }: { recipe: SummonRecipe }) {
  const cost = recipeCostText(recipe);
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] font-bold text-white/85">{recipe.icon} {recipe.label}</span>
        {cost && <span className="text-[10px] text-white/55">{cost}</span>}
      </div>
      {recipe.materials.length > 0 && (
        <div className="mt-0.5 text-[10px] leading-snug text-white/55">
          <span className="text-white/40">{materialsLabel(recipe)} : </span>
          {recipe.materials.map((m, i) => (
            <span key={`${m.id}-${i}`}>
              {i > 0 && <span className="text-white/30"> + </span>}
              {m.kind === 'attribute'
                // Un matériel d'attribut n'est pas une carte : n'importe quelle
                // unité qui le porte convient. Le dire, sinon le joueur cherche
                // une carte de ce nom.
                // « tout porteur de X » plutôt que « tout X » : le nom d'un
                // attribut n'a ni genre ni nombre fixes (Yeux Bleus, Dragon…),
                // la tournure impersonnelle s'accorde donc toujours.
                ? <span className="text-tier-4">tout porteur de {attributeName(m.id)}</span>
                : <span className="text-player">{cardName(m.id)}</span>}
            </span>
          ))}
        </div>
      )}
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
        {!isUnit && <SummonBlock card={data} />}
        {isUnit && data.shield > 0 && <div className="mt-1 text-[11px] text-gold">🛡 Bouclier : {data.shield}</div>}
        {lineage.length > 0 && (
          <div className="mt-1 text-[11px] text-player">🧬 {lineage.map(cardName).join(', ')}</div>
        )}
        {shoppingEntries.length > 0 && (
          <div className="mt-1 text-[11px] text-gold">
            🛒 {shoppingEntries.map(([stat, value]) => `+${value} ${STAT_LABELS[stat] ?? stat}`).join(', ')}
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
  const targets: string[] = Array.isArray(b.effect?.target_attributes) ? b.effect.target_attributes : [];
  // Seuls ces trois effets LISENT `target_attributes` (cf. BoardEffect) : un
  // `draw_bonus` ne vise personne sur le board, annoncer « toutes les unités »
  // sous lui ferait mentir le tooltip.
  const targetsUnits = ['stat_bonus', 'stat_modifier', 'shield'].includes(b.effect?.type);
  return (
    <div>
      <div className="flex items-center gap-2">
        {b._has_illustration && (
          <Illustration id={b.id} className="h-10 w-10 rounded-md" />
        )}
        <div className="text-sm font-bold">{b.name}</div>
      </div>
      {/* L'effet ne répète PAS ses cibles entre parenthèses : les archétypes
          boostés sont annoncés juste en dessous, avec leur icône. Un attribut
          se reconnaît à son pictogramme bien avant son nom. */}
      <div className="mt-1 text-[11px] text-white/60">{b.effect ? describeEffects([b.effect], false) : 'Aucun effet'}</div>
      {targetsUnits && (
        targets.length > 0 ? (
          <div className="mt-2">
            <div className="text-[9px] uppercase tracking-widest text-white/40">Archétypes boostés</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {targets.map((id: string) => (
                <span key={id} className="flex items-center gap-1 rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold">
                  <AttrIcon id={id} className="h-3.5 w-3.5 text-[11px]" />
                  {attributeName(id)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          // target_attributes vide = toutes les unités des deux joueurs : le
          // dire, sinon le silence se lit comme « aucune cible ».
          <div className="mt-2 text-[10px] text-white/40">Toutes les unités</div>
        )
      )}
    </div>
  );
}

function describeEffects(effects: any[], withTargets = true): string {
  return (effects ?? []).map((e: any) => {
    const target = withTargets ? describeTargetAttributes(e.target_attributes) : '';
    switch (e.type) {
      case 'stat_bonus': return `+${e.value} ${STAT_LABELS[e.stat] ?? e.stat}${target}`;
      case 'stat_modifier': return `×${e.value} ${STAT_LABELS[e.stat] ?? e.stat}${target}`;
      case 'draw_bonus': return `+${e.value} pioche`;
      case 'guaranteed_draw': return 'Pioche garantie';
      case 'revive': return 'Réanimation';
      case 'shield': return `Bouclier +${e.value}${target}`;
      case 'board_slot_bonus': return `+${e.value} slot`;
      default: return e.type;
    }
  }).join(', ');
}

function describeTargetAttributes(targetAttributes: any): string {
  if (!Array.isArray(targetAttributes) || targetAttributes.length === 0) return '';
  const names = targetAttributes.map((id: string) => (getAttribute(id) as any)?.name ?? id);
  return ` (${names.join(', ')})`;
}
