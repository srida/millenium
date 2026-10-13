// Liste des bonus de préparation : le TERRAIN d'abord, puis les attributs au
// palier ou à une unité du suivant (`isShownSynergy`). Des illustrations
// seules, avec un compteur en pastille ; le nom et l'effet passent par le
// tooltip au tap.
//
// Colonne au bord gauche en portrait, ligne centrée au-dessus de la barre de
// phase en paysage (entre les deux rails). Masquée en combat.
import { useRef } from 'react';
import { useGameStore, type SynergyEntry } from '../../stores/gameStore.js';
import { useUiStore, type TooltipAnchor } from '../../stores/uiStore.js';
import type { BoardDef } from '../../logic/types.js';
import { useWebLayout, useTabletLayout } from '../system/useWebLayout.js';
import { getAttribute } from '../../data/AttributeDatabase.js';
import AttrIcon from '../ui/AttrIcon.js';
import UiIcon from '../ui/UiIcon.js';
import { Illustration, usePressSquash } from '../ui/primitives.js';
import * as Audio from '../../audio/AudioManager.js';
import { isNearThreshold, isShownSynergy, orderShownSynergies } from './synergyFilter.js';

// ⚠️ Classes en constantes (virgules dans `max(...)`/`calc(...)`, cf. Hud).
const POS_PORTRAIT = 'left-1.5 top-[max(6.125rem,calc(env(safe-area-inset-top)+5.625rem))] flex-col';
// Tablette portrait : sous la jauge horizontale.
const POS_PORTRAIT_TABLET = 'left-2.5 top-[max(9.25rem,calc(env(safe-area-inset-top)+8.75rem))] flex-col';
// Paysage : la place de l'ancien bandeau web, 8 px plus haut. `bottom-14` et
// non moins : la barre de phase (pleine largeur) intercepterait les taps.
const POS_LANDSCAPE = 'bottom-[calc(4rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 max-w-[60%] flex-wrap justify-center';

// Taille de tuile, et de l'icône (~55 %) qu'elle porte.
const SIZES = {
  phonePortrait: { tile: 'h-[38px] w-[38px]', icon: 'h-[21px] w-[21px] text-[18px]' },
  tabletPortrait: { tile: 'h-[46px] w-[46px]', icon: 'h-[25px] w-[25px] text-[22px]' },
  phoneLandscape: { tile: 'h-[34px] w-[34px]', icon: 'h-[19px] w-[19px] text-[16px]' },
  tabletLandscape: { tile: 'h-[40px] w-[40px]', icon: 'h-[22px] w-[22px] text-[19px]' },
};

function anchorOf(el: HTMLElement | null, portrait: boolean): TooltipAnchor | null {
  const r = el?.getBoundingClientRect();
  if (!r) return null;
  return { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height, ...(portrait ? { prefer: 'right' as const } : {}) };
}

function TerrainTile({ board, tile, portrait }: { board: BoardDef; tile: string; portrait: boolean }) {
  const showTooltip = useUiStore(s => s.showTooltip);
  const ref = useRef<HTMLButtonElement>(null);
  // ⚠️ La case est lue sur un `ref` : `usePressSquash` diffère l'appel, et un
  // événement synthétique ne reste pas valide passé son dispatch.
  const { handlers } = usePressSquash<HTMLButtonElement>((e) => {
    e.stopPropagation();
    const a = anchorOf(ref.current, portrait);
    if (a) showTooltip({ kind: 'terrain', board }, a);
  }, false);
  return (
    <button
      ref={ref}
      aria-label={`Terrain : ${board.name}`}
      className={'pointer-events-auto flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-strong bg-surface-raised active:opacity-80 ' + tile}
      {...handlers}
    >
      {board._has_illustration
        ? <Illustration id={board.id} className="h-full w-full object-cover" />
        : <UiIcon id="UI_TERRAIN" className="h-1/2 w-1/2" />}
    </button>
  );
}

function AttributeTile({ s, tile, icon, portrait }: { s: SynergyEntry; tile: string; icon: string; portrait: boolean }) {
  const showTooltip = useUiStore(s => s.showTooltip);
  const active = !!s.activeThreshold;
  const near = isNearThreshold(s);
  const label = s.nextThreshold ? `${s.count}/${s.nextThreshold.count}` : `${s.count}`;
  return (
    <button
      aria-label={`${s.attr.name} ${label}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        Audio.playSfx('menu_button');
        const full = (getAttribute as (id: string) => unknown)(s.attr.id);
        const a = anchorOf(e.currentTarget, portrait);
        if (full && a) showTooltip({ kind: 'attribute', attr: full as never, count: s.count, activeThreshold: s.activeThreshold }, a);
      }}
      className={'pointer-events-auto relative flex shrink-0 items-center justify-center rounded-md border ' + tile + ' '
        + (active ? 'border-gold bg-gold/15' : 'border-dashed border-gold/60 bg-surface/70')}
    >
      <AttrIcon id={s.attr.id} fallback={s.attr.icon} className={icon + (near ? ' opacity-85' : '')} />
      <span className={'absolute -right-1.5 -bottom-1.5 flex h-3.5 min-w-[18px] items-center justify-center rounded-full border border-line bg-surface px-[3px] text-[9px] font-bold leading-none tabular-nums '
        + (active ? 'text-gold' : 'text-gold/80')}>
        {label}
      </span>
    </button>
  );
}

export default function BonusRail() {
  const synergies = useGameStore(s => s.synergies);
  const boardTerrain = useGameStore(s => s.boardTerrain);
  const combatActive = useGameStore(s => s.combatActive);
  const web = useWebLayout();
  const tablet = useTabletLayout();
  if (combatActive) return null;
  const shown = orderShownSynergies(synergies.filter(isShownSynergy));
  if (!boardTerrain && shown.length === 0) return null;

  const portrait = !web;
  const size = portrait
    ? (tablet ? SIZES.tabletPortrait : SIZES.phonePortrait)
    : (tablet ? SIZES.tabletLandscape : SIZES.phoneLandscape);
  const pos = portrait ? (tablet ? POS_PORTRAIT_TABLET : POS_PORTRAIT) : POS_LANDSCAPE;

  return (
    // ⚠️ `pointer-events-none` sur le conteneur, `pointer-events-auto` sur
    // CHAQUE tuile : la liste est posée par-dessus le bord du plateau, et une
    // boîte englobante cliquable intercepterait le tap et le glisser-déposer
    // d'invocation jusque dans les interstices entre tuiles.
    <div className={'pointer-events-none absolute z-20 flex gap-2 ' + pos}>
      {boardTerrain && <TerrainTile board={boardTerrain} tile={size.tile} portrait={portrait} />}
      {shown.map(s => <AttributeTile key={s.attr.id} s={s} tile={size.tile} icon={size.icon} portrait={portrait} />)}
    </div>
  );
}
