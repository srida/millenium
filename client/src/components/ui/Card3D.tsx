// Card3D — la carte en relief de la main et du cimetière.
//
// Elle rend **le même objet que la carte du plateau** : même balisage de face
// (`unit-face`, `unit-art`, les deux voiles, le liseré haut, le scrim), même
// recette de cadre (`board3d.css`), même palette de tier
// (`three/cardPalette.tierFrameVars`). Ce qu'elle ajoute est ce qu'une carte en
// MAIN a de plus : le nom, le badge de tier, la pastille de coût, le compte
// d'exemplaires, le cadenas — c'est-à-dire exactement ce que portait la vignette
// 2D (`CardTile`), qui reste en place partout ailleurs.
//
// ⚠️ Elle ne décide NI où elle se pose (c'est `components/hand/cardFan`), NI de
// quoi elle a l'air selon l'état du jeu (c'est `components/hand/handVisual`).
// Elle compose un `transform` et rend du balisage.
//
// ⚠️ L'ordre du `transform` n'est pas interchangeable : on centre la boîte, on
// la déplace, on la lève, PUIS on tourne et on met à l'échelle. Tourner avant de
// déplacer ferait décrire un arc au déplacement lui-même.
import { type ReactNode } from 'react';
import { type TooltipContent } from '../../stores/uiStore.js';
import { tierFrameVars } from '../../three/cardPalette.js';
import { illustrationUrl } from '../../data/CardArt.js';
import { useCardPress } from './cardPress.js';
import type { CardTransform } from '../hand/cardFan.js';

/** Levée de la carte retenue, en px — vers le haut en bande, vers le board en rail. */
const LIFT_PX = 12;
/** Inclinaison autour de l'axe horizontal : le haut de la carte s'éloigne. */
const TILT_DEG = 8;

const HIGHLIGHT = {
  none: '', selected: 'is-selected', candidate: 'is-candidate', material: 'is-material',
} as const;
const DIM = { none: '', soft: 'dim-soft', strong: 'dim-strong' } as const;

export interface Card3DProps {
  illustrationId: string;
  name: string;
  /** Les tiers de la carte. Le CADRE prend le plus haut — une couleur ne se
   *  partage pas —, le badge les dit tous (`T2·4`). */
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
  /** La place calculée par `cardFan`. */
  transform: CardTransform;
  /** Largeur nominale en px — l'échelle vit dans le `transform`. */
  width: number;
  /** Survolée ou pressée : elle sort du rang et reprend son voile animé. */
  raised?: boolean;
}

export default function Card3D({
  illustrationId, name, tiers = null, hint = null, badge = null,
  stacked = false, showName = true,
  highlight = 'none', dim = 'none', lift = 'none',
  locked = false, disabled = false, tapOn = 'down', tooltip = null, onTap,
  transform, width, raised = false,
}: Card3DProps) {
  const press = useCardPress({ tapOn, tooltip, disabled, onTap });
  const tier = tiers?.length ? tiers[tiers.length - 1] : null;

  const liftTx = lift === 'up' ? `translateY(${-LIFT_PX}px)`
    : lift === 'right' ? `translateX(${LIFT_PX}px)` : '';

  return (
    <button
      type="button"
      {...press}
      title={name}
      className={[
        'card3d', HIGHLIGHT[highlight], DIM[dim],
        stacked ? 'is-stacked' : '', raised ? 'is-raised' : '',
      ].filter(Boolean).join(' ')}
      style={{
        ...tierFrameVars(tier),
        width,
        zIndex: transform.zIndex,
        transform: [
          'translate(-50%, -50%)',
          `translate(${transform.x}px, ${transform.y}px)`,
          liftTx,
          `rotate(${transform.rotZ}deg)`,
          transform.rotY ? `rotateY(${transform.rotY}deg)` : '',
          `rotateX(${TILT_DEG}deg)`,
          `scale(${transform.scale})`,
        ].filter(Boolean).join(' '),
      }}
    >
      <span className="unit-face">
        <img className="unit-art" src={illustrationUrl(illustrationId)} alt="" />
        <span className="unit-foil-stars" />
        <span className="unit-foil-nebula" />
        <span className="unit-top-edge" />
        <span className="unit-bottom-scrim" />
        {showName && <span className="card3d-name">{name}</span>}
      </span>
      {tier != null && <span className="card3d-badge card3d-tier">T{tiers!.join('·')}</span>}
      {hint && <span className="card3d-badge card3d-cost">{hint}</span>}
      {badge != null && badge > 0 && <span className="card3d-badge card3d-count">×{badge}</span>}
      {locked && <span className="card3d-lock" aria-label="Carte verrouillée">🔒</span>}
    </button>
  );
}
