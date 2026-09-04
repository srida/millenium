// CardTile — vignette de carte 2D. **Template unique** partagé par la main, le
// cimetière, le DeckBuilder et le TestBench : illustration plein cadre, scrim +
// nom, badge tier, pastille de coût d'invocation, badge ×N, liseré de tier.
// Repris de la carte de main (version en jeu). La carte affichée sur le board
// est un autre objet (CSS3D) : cf. three/UnitCardEl.ts.
//
// Interaction : tap au pointerdown (retour instantané, cohérent avec le reste du
// jeu) ; `tapOn="up"` bascule au relâchement — le DeckBuilder s'en sert pour
// qu'un appui long (tooltip) n'ajoute pas la carte au deck. Maintien 500 ms →
// tooltip si `tooltip` est fourni.
//
// En mode `tapOn="up"`, le tap n'est armé que par un pointerdown REÇU SUR CETTE
// vignette : sans ça, un relâchement dont l'appui a eu lieu ailleurs déclencherait
// l'action. C'est ce qui ajoutait une carte au deck en arrivant dans le
// DeckBuilder — le bouton « Créer un deck » navigue au pointerdown, et le
// pointerup retombait sur la grille qui venait de se monter dessous.
import { useRef, type ReactNode } from 'react';
import type { Card } from '../../logic/types.js';
import { artFor } from '../../data/CardArt.js';
import { summonCostOf } from '../../data/SummonInfo.js';
import { useUiStore, type TooltipContent } from '../../stores/uiStore.js';
import { Illustration } from './primitives.js';

// Cadre : or = sélection / candidat, blanc = matériau retenu — même code couleur
// que les unités du board (three/UnitCardEl.ts + styles/board3d.css).
const HIGHLIGHT = {
  none: 'border-line',
  selected: 'border-gold',
  candidate: 'border-gold',
  material: 'border-white',
} as const;

const DIM = {
  none: '',
  soft: 'opacity-70 grayscale',     // cimetière : unité non sélectionnable
  strong: 'opacity-40 grayscale',   // main injouable, tier plein
} as const;

// Décalage de la carte sélectionnée hors de sa bande (vers le haut en portrait,
// vers le board quand la main est un rail vertical).
const LIFT = { none: '', up: '-translate-y-2', right: 'translate-x-2' } as const;

const TIER_RING: Record<number, string> = {
  1: 'ring-tier-1/50', 2: 'ring-tier-2/50', 3: 'ring-tier-3/50', 4: 'ring-tier-4/50', 5: 'ring-tier-5/50',
};

export interface CardTileProps {
  illustrationId: string;
  name: string;
  tier?: number | null;             // null → ni badge T·, ni liseré de tier
  hint?: ReactNode;                 // pastille de coût d'invocation (cf. renderHint)
  badge?: number | null;            // badge ×N (exemplaires)
  stacked?: boolean;                // épaisseur de pile (plusieurs exemplaires)
  showName?: boolean;
  size?: string;                    // classes de taille (h-28, h-auto w-full…)
  highlight?: keyof typeof HIGHLIGHT;
  dim?: keyof typeof DIM;
  lift?: keyof typeof LIFT;
  locked?: boolean;                 // carte non débloquée : cadenas (n'implique PAS disabled)
  disabled?: boolean;               // le tap ne déclenche rien (tooltip conservé)
  tapOn?: 'down' | 'up';
  tooltip?: TooltipContent | null;
  onTap?: () => void;
}


// La pastille dit le COÛT, et rien d'autre : un chiffre, le nombre de
// matériels de la voie la moins chère.
//
// ⚠️ Elle portait l'icône de la voie d'invocation, une notion que le moteur n'a
// plus. Ce que ces icônes racontaient (« c'est une Fusion ») se lit maintenant
// dans les ATTRIBUTS de la carte, affichés comme n'importe quel archétype —
// c'est le tooltip qui les rend, pas la vignette, qui n'a la place que d'un
// seul signe.
//
// Rien pour une carte sans condition : une vignette nue DIT qu'elle se pose.
function renderHint(card: Card): ReactNode {
  const cost = summonCostOf(card);
  if (cost <= 0) return null;
  return <span className="inline-flex items-center gap-0.5 tabular-nums">◈{cost}</span>;
}

// Props dérivées d'une carte du catalogue — évite de répéter costHint et le
// tooltip sur chaque appelant. `illustrationId` passe par `artFor` : la
// variante choisie pour le deck actif s'applique donc partout où ce helper est
// utilisé (main, cimetière, DeckBuilder, boutique, TestBench). La prop reste
// surchargeable — le DeckBuilder s'en sert pour prévisualiser un choix en
// cours d'édition, avant qu'il ne soit enregistré.
export function cardTileProps(card: Card): Pick<CardTileProps, 'illustrationId' | 'name' | 'tier' | 'hint' | 'tooltip'> {
  return {
    illustrationId: artFor(card.id),
    name: card.name,
    tier: card.tier,
    hint: renderHint(card),
    tooltip: { kind: 'card', card },
  };
}

export default function CardTile({
  illustrationId, name, tier = null, hint = null, badge = null,
  stacked = false, showName = true, size = 'h-28',
  highlight = 'none', dim = 'none', lift = 'none',
  locked = false, disabled = false, tapOn = 'down', tooltip = null, onTap,
}: CardTileProps) {
  const showTooltip = useUiStore(s => s.showTooltip);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressTap = useRef(false); // un appui long a ouvert le tooltip → annule le tap
  const armed = useRef(false);       // un pointerdown a bien eu lieu ICI (cf. en-tête)
  const clearLong = () => { if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; } };
  const cancelTap = () => { clearLong(); armed.current = false; };

  const fire = () => { if (!disabled) onTap?.(); };

  return (
    <button
      onPointerDown={(e) => {
        e.stopPropagation();
        suppressTap.current = false;
        armed.current = true;
        if (tapOn === 'down') fire();
        if (!tooltip) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        longPress.current = setTimeout(() => {
          longPress.current = null;
          suppressTap.current = true;
          showTooltip(tooltip, { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
        }, 500);
      }}
      onPointerUp={() => {
        clearLong();
        if (tapOn === 'up' && armed.current && !suppressTap.current) fire();
        armed.current = false;
        suppressTap.current = false;
      }}
      // Sortir de la vignette avant de relâcher annule le tap (le doigt a glissé).
      onPointerLeave={cancelTap}
      onPointerCancel={cancelTap}
      title={name}
      className={[
        'relative aspect-[5/7] flex-shrink-0 overflow-hidden rounded-lg border-2 ring-1 ring-inset transition-transform',
        size,
        tier != null ? (TIER_RING[tier] ?? 'ring-white/10') : 'ring-white/10',
        HIGHLIGHT[highlight],
        DIM[dim],
        LIFT[lift],
        disabled ? '' : 'active:scale-95',
        // Épaisseur de pile : la carte porte visiblement plusieurs exemplaires.
        stacked ? 'mr-1 shadow-[3px_3px_0_0_var(--color-surface-raised),4px_4px_0_0_var(--color-line)]' : '',
      ].join(' ')}
    >
      <Illustration id={illustrationId} alt={name} className="pointer-events-none absolute inset-0 h-full w-full" />
      {showName && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1 pb-0.5 pt-3">
          <div className="truncate text-[9px] font-semibold leading-tight text-white">{name}</div>
        </div>
      )}
      {tier != null && (
        <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px] font-bold text-white">T{tier}</span>
      )}
      {hint && <span className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px]">{hint}</span>}
      {badge != null && badge > 0 && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-gold px-1 text-[9px] font-bold text-black">×{badge}</span>
      )}
      {/* Carte non débloquée : cadenas centré sur un voile, lisible même quand
          la vignette est déjà grisée par `dim`. */}
      {locked && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-base" aria-label="Carte verrouillée">
          🔒
        </span>
      )}
    </button>
  );
}
