/* eslint-disable @typescript-eslint/no-explicit-any */
// TooltipHost — instance globale unique pilotée par uiStore (remplace l'ancien
// singleton DOM Tooltip.js). Tap ailleurs → fermeture (géré au niveau App).
import { useLayoutEffect, useRef, useState } from 'react';
import { useUiStore, type TooltipAnchor, type TooltipContent } from '../../stores/uiStore.js';
import { getPower } from '../../data/PowerDatabase.js';
import { getAttribute, isTierAttribute } from '../../data/AttributeDatabase.js';
import AttrIcon, { attributeName } from '../ui/AttrIcon.js';
import PowerIcon from '../ui/PowerIcon.js';
import { Illustration } from '../ui/primitives.js';
import RecipeRow from '../ui/SummonRecipe.js';
import { cardName, magieName } from '../../data/gameNames.js';
import { summonRecipes, recipeIsFree } from '../../data/SummonInfo.js';
import { primaryTier, tiersOf } from '../../logic/Tiers.js';
import { materialValueOf } from '../../logic/Unit.js';
// ⚠️ La SEULE déclaration des mots-clés (racine, partagée avec `admin.html`).
import { MOTS_CLES, MOT_CLE_CATEGORY } from '../../../../effect-schema.mjs';
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
      {Object.entries(STAT_LABELS).map(([k, label]) => {
        // ⚠️ Une valeur absente s'écrit « — », jamais rien : `{undefined}` rend
        // une case VIDE sous son intitulé, ce qui se lit comme un défaut de
        // mise en page et non comme une donnée manquante. C'est exactement ce
        // qu'a produit un catalogue non repris sur l'échelle de vitesse — VIT
        // et DEP sortaient blancs, et la seule chose que ça évoquait était un
        // bug d'affichage. Un tiret nomme l'absence.
        const value = stats[k];
        const shown = Number.isFinite(value) ? value : '—';
        return (
          <div key={k} className="flex flex-1 flex-col items-center gap-0.5 border-r border-white/5 py-1.5 last:border-r-0">
            <span className="text-[8px] tracking-widest text-white/40">{label}</span>
            <span className={`text-xs font-bold tabular-nums${Number.isFinite(value) ? '' : ' text-white/30'}`}>{shown}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Ce que ce mot-clé fait, en une phrase — ou `null` si ce n'en est pas un.
 *
 * ⚠️ **Le seul endroit qui répond à « cet attribut s'explique-t-il ? »**, et il
 * sert les DEUX rendus : la chip qui s'efface et le bloc qui explique. Poser la
 * question à deux endroits, c'est s'autoriser à répondre deux fois la même
 * chose — ce que le tooltip a effectivement fait le temps d'un rendu.
 *
 * ⚠️ **Deux sources, dans cet ordre, et c'est le partage des mots-clés** :
 *   • `MOTS_CLES` pour ceux dont la règle n'est PAS un effet (Second souffle) —
 *     une phrase écrite à la main, la seule qu'il y ait ;
 *   • sinon les EFFETS de son palier, mis en mots par `describeEffects` — la
 *     même fonction que le tooltip d'attribut, donc le même vocabulaire que
 *     partout ailleurs. Un mot-clé qui est un effet se décrit donc tout seul :
 *     changer sa portée en admin change ce que le joueur lit, sans une ligne.
 *
 * ⚠️ Sans cette seconde source, Tour sortait en chip MUETTE : rien ne dit ce
 * qu'un mot-clé veut dire, et une chip d'attribut n'est pas tapable.
 */
function motCleTexte(id: string): string | null {
  const attr = (getAttribute as any)(id);
  if (!attr) return null;
  const def = (MOTS_CLES as any)[attr.mot_cle];
  if (def) return def.aide;
  if (attr.categorie !== MOT_CLE_CATEGORY) return null;
  // ⚠️ `withTargets: false` : la cible d'un mot-clé est TOUJOURS son porteur.
  // Annoncer « (Tour) » derrière chaque effet répéterait le titre juste au-dessus.
  const texte = describeEffects((attr.thresholds ?? []).flatMap((t: any) => t.effects ?? []), false);
  return texte || null;
}

function Keywords({ ids }: { ids: string[] }) {
  // ⚠️ Les attributs de TIER sont écartés : le badge de l'en-tête vient de les
  // dire, deux lignes plus haut. Les voies d'invocation, elles, RESTENT — c'est
  // ici qu'on lit « c'est une Fusion », et rien d'autre ne le dit.
  //
  // ⚠️ Même règle pour un MOT-CLÉ que le bloc du dessous EXPLIQUE : il y porte
  // déjà son icône et son nom, en tête de sa propre explication. La condition
  // est bien « ce bloc le dit », jamais « c'est un mot-clé » — un mot-clé dont
  // la mécanique est un EFFET n'a pas d'entrée dans `MOTS_CLES`, donc rien ne
  // le dirait ailleurs, donc il garde sa chip.
  const shown = ids.filter(id => !isTierAttribute(id) && !motCleTexte(id));
  if (!shown.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {shown.map(id => {
        const attr = (getAttribute as any)(id);
        return (
          <span key={id} className="inline-flex items-center gap-1 rounded border border-violet/40 bg-violet/10 px-2 py-0.5 text-[10px] text-violet">
            <AttrIcon id={id} className="h-3.5 w-3.5 text-[11px]" />
            {attr?.name ?? id}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Ce qu'un MOT-CLÉ fait — la chip seule ne le dit pas.
 *
 * ⚠️ **Un mot-clé n'est pas un thème, et c'est toute la raison de ce bloc.**
 * « Zombie » ou « Sable » n'ont rien à expliquer : ils rangent la carte. « Second
 * souffle » nomme une MÉCANIQUE, et la chip qui le porte est muette — elle n'est
 * pas tapable, rien derrière elle ne s'ouvre. Un joueur lisait donc un mot sans
 * moyen d'apprendre ce qu'il veut dire. Le geste est celui du bloc de pouvoir,
 * juste en dessous : on nomme, puis on explique.
 *
 * ⚠️ Le texte est celui de `motCleTexte`, et de nulle part ailleurs — c'est ce
 * qui garantit qu'un mot-clé expliqué ici est exactement celui que la chip
 * au-dessus a cédé.
 */
function MotsCles({ ids }: { ids: string[] }) {
  const portes = ids
    .map(id => ({ id, attr: (getAttribute as any)(id), texte: motCleTexte(id) }))
    .filter(x => x.texte);
  if (!portes.length) return null;
  return (
    <div className="mt-2 space-y-1">
      {portes.map(({ id, attr, texte }) => (
        <div key={id} className="rounded-lg border border-violet/25 bg-violet/5 p-2">
          <div className="flex items-center gap-1 text-[11px] font-bold text-violet">
            <AttrIcon id={id} fallback={attr?.icon} className="h-3.5 w-3.5 text-[11px]" />
            {attr?.name ?? id}
          </div>
          <div className="text-[10px] text-white/60">{texte}</div>
        </div>
      ))}
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
      ? { atk: data.atk, hp: data.current_hp, attack_rate: data.attack_rate, range: data.range, movement_rate: data.movement_rate }
      : { atk: data.stats.atk, hp: data.stats.hp, attack_rate: data.stats.attack_rate, range: data.stats.range, movement_rate: data.stats.movement_rate };
    const lineage = isUnit ? (data.represented_ids ?? []).filter((id: string) => id !== data.card_id) : [];
    const shoppingBonus: Record<string, number> = isUnit ? (data._shopping_bonus ?? {}) : {};
    const shoppingEntries = Object.entries(shoppingBonus).filter(([, v]) => v);

    return (
      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">{data.name}</span>
          {/* Une CARTE dit tous ses tiers ; une UNITÉ n'en porte qu'un (sa puissance). */}
          <span className="rounded border border-gold/40 px-1.5 text-[10px] font-bold text-gold">
            T{isUnit ? data.tier : (tiersOf(data).join('·') || primaryTier(data))}
          </span>
        </div>
        <StatsRow stats={stats} />
        <Keywords ids={data.attributes ?? []} />
        <MotsCles ids={data.attributes ?? []} />
        {power && (
          <div className="mt-2 rounded-lg border border-orange-400/25 bg-orange-500/5 p-2">
            <div className="flex items-center gap-1 text-[11px] font-bold text-orange-300">
              <PowerIcon id={data.power_id} fallback="⚡" className="h-3.5 w-3.5 text-[11px]" />
              {power.name ?? data.power_id}
            </div>
            {/* ⚠️ La jauge se dit en TICKS, pas en compteur : c'est une
                progression (« 12 sur 20 »), pas un réglage. Le compteur est ce
                qu'on paramètre, la période ce qu'on regarde avancer. Un
                pouvoir sans compteur déclaré rend `Infinity` — on le nomme
                plutôt que de laisser lire « 12/Infinity ». */}
            {isUnit
              ? <div className="text-[10px] text-white/60">
                  {Number.isFinite(data.powerPeriod?.() ?? Infinity)
                    ? `Jauge ${data.power_gauge}/${data.powerPeriod()}`
                    : 'Aucune vitesse de chargement — ce pouvoir ne part jamais'}
                </div>
              : power.description && <div className="text-[10px] text-white/60">{power.description}</div>}
          </div>
        )}
        {!isUnit && <SummonBlock card={data} />}
        {isUnit && data.shield > 0 && <div className="mt-1 text-[11px] text-gold">🛡 Bouclier : {data.shield}</div>}
        {/* Ce que l'unité VAUT comme matériau — la question qu'on ne pouvait
            trancher qu'en tentant l'invocation. ⚠️ Sur une UNITÉ elle se dit
            toujours (c'est ici qu'on vient chercher la réponse) ; sur une carte
            en main, seulement au-dessus de 1 — le défaut n'apprend rien à qui
            n'a encore rien posé. La pastille du plateau suit la même règle.
            ⚠️ La valeur ne se touche que sur un slot LIBRE : consommée au titre
            d'un matériel que la recette NOMME, l'unité ne paie qu'un slot
            (`materialSlotsPaid`). Un « vaut 2 » sec s'y lirait comme une
            promesse que l'invocation ne tient pas. */}
        {(isUnit || (data.material_value ?? 1) > 1) && (
          <div className="mt-1 text-[11px] text-success">
            ◈ Vaut {materialValueOf(data as Card)} matériel{materialValueOf(data as Card) > 1 ? 's' : ''} sur un slot libre
            {materialValueOf(data as Card) > 1 ? ' — 1 seul si la recette la nomme' : ''}
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
    boardEffectLabel(e, withTargets ? (ids) => ids.map(attributeName).join(', ') : undefined, cardName, magieName),
  ).join(', ');
}
