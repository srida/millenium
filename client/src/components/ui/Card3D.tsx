// Card3D — LA vignette de carte du jeu, en relief. Template unique pour la
// main, le cimetière et toute grille de carte (boutique, packs, DeckBuilder,
// tutoriel, bancs de dev) — ce qu'était `CardTile` (2D, supprimé).
//
// Elle rend **le même objet que la carte du plateau** : même balisage de face
// (`unit-face`, `unit-art`, les deux voiles, le liseré haut, le scrim), même
// recette de cadre (`board3d.css`), même palette de tier
// (`three/cardPalette.tierFrameVars`). Ce qu'elle ajoute est ce qu'une carte en
// MAIN a de plus : le nom, la pastille de coût, le compte d'exemplaires, le
// cadenas. Elle ne porte PAS de badge de tier : ici le tier EST la couleur du
// cadre — y compris en grille, où une carte multi-tiers ne montre que le plus
// haut (une couleur ne se partage pas).
//
// ⚠️ Elle ne décide NI où elle se pose (c'est `components/hand/cardFan`), NI de
// quoi elle a l'air selon l'état du jeu (c'est `components/hand/handVisual`).
// Elle compose un `transform` et rend du balisage.
//
// ⚠️ L'ordre du `transform` n'est pas interchangeable : on centre la boîte, on
// la déplace, on la lève, PUIS on tourne et on met à l'échelle. Tourner avant de
// déplacer ferait décrire un arc au déplacement lui-même.
//
// ── Deux modes de layout ──
// **Fan/rail** (`transform` fourni) : la carte est positionnée en ABSOLU par
// `cardFan.ts` à l'intérieur d'un `.card3d-layer` — la main et le cimetière.
// **Flow** (`transform` absent) : la carte reste dans le FLUX normal du
// document, dimensionnée par une classe Tailwind (`size`, comme l'ancien
// `CardTile`) — toute grille/`flex-wrap` de carte. `.card3d.is-flow` (dans
// `card3d.css`) réécrit `position`/`transform` en conséquence ; le reste du
// balisage, du geste et des états (`highlight`, `dim`, badges…) est identique
// aux deux modes — une règle n'existe qu'à un endroit.
import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { type TooltipContent } from '../../stores/uiStore.js';
import { tierFrameVars } from '../../three/cardPalette.js';
import { artFor, illustrationUrl } from '../../data/CardArt.js';
import { summonCostOf } from '../../data/SummonInfo.js';
import { tiersOf } from '../../logic/Tiers.js';
import { useCardPress } from './cardPress.js';
import type { Card } from '../../logic/types.js';
import type { CardTransform } from '../hand/cardFan.js';

const LIFT = { none: '', up: 'lift-up', right: 'lift-right' } as const;

const HIGHLIGHT = {
  none: '', selected: 'is-selected', candidate: 'is-candidate', material: 'is-material',
} as const;
const DIM = { none: '', soft: 'dim-soft', strong: 'dim-strong' } as const;

export interface Card3DProps {
  illustrationId: string;
  name: string;
  /** Les tiers de la carte. Le CADRE prend le plus haut — une couleur ne se
   *  partage pas. ⚠️ Ils ne s'écrivent NULLE PART sur la carte : c'est le cadre
   *  qui les dit, et le tooltip qui les détaille. */
  tiers?: readonly number[] | null;
  hint?: ReactNode;
  badge?: number | null;
  stacked?: boolean;
  showName?: boolean;
  highlight?: keyof typeof HIGHLIGHT;
  dim?: keyof typeof DIM;
  lift?: 'none' | 'up' | 'right';
  locked?: boolean;
  disabled?: boolean;
  tapOn?: 'down' | 'up';
  tooltip?: TooltipContent | null;
  onTap?: () => void;
  /** La place calculée par `cardFan`. **Absent → mode FLOW** : la carte reste
   *  dans le flux normal (grille, `flex-wrap`), dimensionnée par `size`. */
  transform?: CardTransform;
  /** Largeur nominale en px — l'échelle vit dans le `transform`. Ignoré en
   *  mode flow (cf. `size`). */
  width?: number;
  /** Classes Tailwind de taille, MODE FLOW SEULEMENT — même convention que
   *  l'ancien `CardTile` (`h-28`, `h-auto w-full`…). Ignoré en fan/rail, où la
   *  taille vient de `width` + `transform.scale`. */
  size?: string;
  /** Retenue : elle sort du rang, passe devant et reprend son voile animé. */
  raised?: boolean;
  /** Dans un rail vertical : le survol sort la carte vers le board, pas vers le
   *  haut — et le rail de droite la sort vers la gauche. */
  rail?: 'left' | 'right' | null;
  /**
   * Le glisser-déposer. `onDragBegin` peut REFUSER en rendant `false` — le
   * geste redevient alors un tap annulé. `onDrop` reçoit le point de l'écran où
   * le doigt a lâché ; c'est à l'appelant d'en faire une case.
   *
   * `onDragMove` reçoit le point survolé pendant le geste. ⚠️ Il est appelé à
   * chaque `pointermove` : l'appelant ne doit RIEN y faire qui re-rende — c'est
   * d'ailleurs la raison pour laquelle le suivi de la carte elle-même mute deux
   * variables CSS au lieu de passer par un état React.
   */
  onDragBegin?: () => boolean | void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDrop?: (clientX: number, clientY: number) => void;
}

export default function Card3D({
  illustrationId, name, tiers = null, hint = null, badge = null,
  stacked = false, showName = true,
  highlight = 'none', dim = 'none', lift = 'none',
  locked = false, disabled = false, tapOn = 'down', tooltip = null, onTap,
  transform, width, size = 'h-auto w-full', raised = false, rail = null,
  onDragBegin, onDragMove, onDrop,
}: Card3DProps) {
  // Mode flow : pas de géométrie calculée par `cardFan`, la carte reste dans
  // le flux normal — même convention que l'ancien `CardTile`.
  const flow = !transform;
  // ⚠️ `dragging` est un ÉTAT React, pas une classe posée à la main : la prise
  // en main appelle `selectCard`, qui republie l'instantané, donc re-rend la
  // carte — React réécrirait alors `className` et effacerait une classe posée
  // impérativement. Deux rendus par glisser (départ, arrivée), pas un par
  // frame : le SUIVI du doigt, lui, mute deux variables CSS par référence.
  const [dragging, setDragging] = useState(false);
  // Le centre de la carte au moment de la prise : le suivi n'est qu'un delta.
  const origin = useRef<{ x: number; y: number } | null>(null);

  const follow = (el: HTMLElement, clientX: number, clientY: number) => {
    if (!origin.current) return;
    el.style.setProperty('--card-drag-x', `${clientX - origin.current.x}px`);
    el.style.setProperty('--card-drag-y', `${clientY - origin.current.y}px`);
  };
  const release = (el: HTMLElement) => {
    origin.current = null;
    el.style.removeProperty('--card-drag-x');
    el.style.removeProperty('--card-drag-y');
    setDragging(false);
  };

  const press = useCardPress({
    tapOn, tooltip, disabled, onTap,
    drag: onDrop && !disabled ? {
      start: (e) => {
        if (onDragBegin?.() === false) return false;
        const el = e.currentTarget as HTMLElement;
        const r = el.getBoundingClientRect();
        origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        setDragging(true);
        return true;
      },
      move: (e) => {
        follow(e.currentTarget as HTMLElement, e.clientX, e.clientY);
        onDragMove?.(e.clientX, e.clientY);
      },
      end: (e) => {
        const el = e.currentTarget as HTMLElement;
        const had = origin.current !== null;
        release(el);
        if (had) onDrop(e.clientX, e.clientY);
      },
    } : undefined,
  });
  const tier = tiers?.length ? tiers[tiers.length - 1] : null;

  return (
    <button
      type="button"
      {...press}
      title={name}
      data-draggable={onDrop && !disabled ? 'true' : undefined}
      className={[
        'card3d', HIGHLIGHT[highlight], DIM[dim], LIFT[lift],
        stacked ? 'is-stacked' : '', raised ? 'is-raised' : '',
        badge != null && badge > 0 ? 'has-count' : '',
        rail ? `in-rail in-rail-${rail}` : '', dragging ? 'is-dragging' : '',
        // Mode flow : pas de géométrie absolue, la carte reste dans le flux —
        // `is-flow` réécrit `position`/`transform` en conséquence
        // (`card3d.css`) ; la taille vient de `size`, classes Tailwind.
        flow ? `is-flow ${size}` : '',
      ].filter(Boolean).join(' ')}
      // ⚠️ La place voyage en VARIABLES, jamais en `transform` composé ici :
      // une déclaration en ligne bat toute règle de feuille, donc un
      // `transform` écrit ici aurait interdit au survol d'y ajouter quoi que ce
      // soit sans un état React — c'est-à-dire un re-render de tout l'éventail
      // à chaque carte survolée. La composition vit dans `styles/card3d.css`.
      // ⚠️ En mode flow, ni `width` ni `--card-x/y/rot/roty/scale/z` : ces
      // variables n'existent pas sans `transform`, et leurs défauts CSS (0px,
      // 0deg, 1, 0) sont justement ceux d'une carte posée à plat dans sa case.
      style={{
        ...tierFrameVars(tier),
        ...(flow ? {} : {
          width,
          '--card-x': `${transform!.x}px`,
          '--card-y': `${transform!.y}px`,
          '--card-rot': `${transform!.rotZ}deg`,
          '--card-roty': `${transform!.rotY}deg`,
          '--card-scale': transform!.scale,
          '--card-z': transform!.zIndex,
        }),
      } as CSSProperties}
    >
      <span className="unit-face">
        {/* ⚠️ `draggable={false}` : sans lui, le premier pixel d'un glisser démarre
            le GLISSER NATIF D'IMAGE du navigateur, qui émet aussitôt un
            `pointercancel` — le geste du jeu meurt avant d'exister, et rien
            dans le code ne le dit. `loading="lazy"` : en grille (boutique,
            DeckBuilder, packs…), une carte peut en montrer des centaines. */}
        <img className="unit-art" src={illustrationUrl(illustrationId)} alt="" draggable={false} loading="lazy" />
        <span className="unit-foil-stars" />
        <span className="unit-foil-nebula" />
        <span className="unit-top-edge" />
        <span className="unit-bottom-scrim" />
        {showName && <span className="card3d-name">{name}</span>}
      </span>
      {/* Le COÛT en haut à gauche, le compte d'exemplaires en bas à gauche : les
          deux coins d'une même lisière, la seule qu'un éventail laisse voir
          d'une carte recouverte. Le tier ne s'écrit pas — il est le cadre. */}
      {hint && <span className="card3d-badge card3d-cost">{hint}</span>}
      {badge != null && badge > 0 && <span className="card3d-badge card3d-count">×{badge}</span>}
      {locked && <span className="card3d-lock" aria-label="Carte verrouillée">🔒</span>}
    </button>
  );
}

// La pastille dit le COÛT, et rien d'autre : un chiffre, le nombre de
// matériels de la voie la moins chère.
//
// Rien pour une carte sans condition : une vignette nue DIT qu'elle se pose.
// Reprise de l'ex-`CardTile.tsx` — cf. son historique pour le pourquoi de
// l'absence d'icône de voie d'invocation.
function renderHint(card: Card): ReactNode {
  const cost = summonCostOf(card);
  if (cost <= 0) return null;
  return <span className="inline-flex items-center gap-0.5 tabular-nums">◈{cost}</span>;
}

// Props dérivées d'une carte du catalogue — évite de répéter costHint et le
// tooltip sur chaque appelant. `illustrationId` passe par `artFor` : la
// variante choisie pour le deck actif s'applique donc partout où ce helper est
// utilisé (main, cimetière, boutique, DeckBuilder, packs, tutoriel, bancs de
// dev). La prop reste surchargeable — le DeckBuilder s'en sert pour prévisualiser
// un choix en cours d'édition, avant qu'il ne soit enregistré.
export function cardVisualProps(card: Card): Pick<Card3DProps, 'illustrationId' | 'name' | 'tiers' | 'hint' | 'tooltip'> {
  return {
    illustrationId: artFor(card.id),
    name: card.name,
    tiers: tiersOf(card),
    hint: renderHint(card),
    tooltip: { kind: 'card', card },
  };
}
