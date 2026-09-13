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
import type { CSSProperties, ReactNode } from 'react';
import { type TooltipContent } from '../../stores/uiStore.js';
import { tierFrameVars } from '../../three/cardPalette.js';
import { illustrationUrl } from '../../data/CardArt.js';
import { useCardPress } from './cardPress.js';
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
  /** Retenue : elle sort du rang, passe devant et reprend son voile animé. */
  raised?: boolean;
  /** Dans un rail vertical : le survol sort la carte vers le board, pas vers le
   *  haut — et le rail de droite la sort vers la gauche. */
  rail?: 'left' | 'right' | null;
}

export default function Card3D({
  illustrationId, name, tiers = null, hint = null, badge = null,
  stacked = false, showName = true,
  highlight = 'none', dim = 'none', lift = 'none',
  locked = false, disabled = false, tapOn = 'down', tooltip = null, onTap,
  transform, width, raised = false, rail = null,
}: Card3DProps) {
  const press = useCardPress({ tapOn, tooltip, disabled, onTap });
  const tier = tiers?.length ? tiers[tiers.length - 1] : null;

  return (
    <button
      type="button"
      {...press}
      title={name}
      className={[
        'card3d', HIGHLIGHT[highlight], DIM[dim], LIFT[lift],
        stacked ? 'is-stacked' : '', raised ? 'is-raised' : '',
        rail ? `in-rail in-rail-${rail}` : '',
      ].filter(Boolean).join(' ')}
      // ⚠️ La place voyage en VARIABLES, jamais en `transform` composé ici :
      // une déclaration en ligne bat toute règle de feuille, donc un
      // `transform` écrit ici aurait interdit au survol d'y ajouter quoi que ce
      // soit sans un état React — c'est-à-dire un re-render de tout l'éventail
      // à chaque carte survolée. La composition vit dans `styles/card3d.css`.
      style={{
        ...tierFrameVars(tier),
        width,
        '--card-x': `${transform.x}px`,
        '--card-y': `${transform.y}px`,
        '--card-rot': `${transform.rotZ}deg`,
        '--card-roty': `${transform.rotY}deg`,
        '--card-scale': transform.scale,
        '--card-z': transform.zIndex,
      } as CSSProperties}
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
