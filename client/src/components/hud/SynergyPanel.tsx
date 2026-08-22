// Panneau de synergies d'attributs actives (getActiveSynergies). Tap sur une
// puce → tooltip d'attribut.
import { useGameStore } from '../../stores/gameStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useWebLayout } from '../system/useWebLayout.js';
import { getAttribute } from '../../data/AttributeDatabase.js';
import AttrIcon from '../ui/AttrIcon.js';

export default function SynergyPanel() {
  const synergies = useGameStore(s => s.synergies);
  const combatActive = useGameStore(s => s.combatActive);
  const showTooltip = useUiStore(s => s.showTooltip);
  const web = useWebLayout();
  if (combatActive || synergies.length === 0) return null;

  // Web (écran large) : bandeau centré sous le board, entre les deux rails
  // (main à gauche, cimetière à droite — cf. WEB_RAIL_BAND, w-52 chacun).
  // bottom-14, pas bottom-2 : la barre de phase (bottom-0, pleine
  // largeur) intercepterait sinon les taps malgré son fond transparent.
  //
  // Portrait (mobile) : la main et le cimetière occupent déjà le bas de
  // l'écran, sans place pour un troisième bandeau — posé sous la barre de PV à
  // la place. C'est le seul emplacement libre, d'où la suppression des
  // bandeaux de contexte Tournoi/Arcade qui s'y posaient et le recouvraient
  // (cf. GameScreen). Pleine largeur (inset-x-0) plutôt que centré à 92 % :
  // plus de puces tiennent sur une ligne.
  const positionClass = web
    ? 'bottom-14 left-1/2 -translate-x-1/2 max-w-[60%] justify-center'
    : 'top-[max(3.75rem,calc(env(safe-area-inset-top)+3.25rem))] inset-x-0 justify-center px-3';

  return (
    <div className={`pointer-events-auto absolute z-20 flex flex-wrap gap-1 ${positionClass}`}>
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
            {/* L'icône est posée sur TOUTES les puces, actives comme
                incomplètes : c'est avant d'avoir le palier que le joueur décide
                d'ajouter une carte, une puce reconnaissable seulement une fois
                la synergie acquise arriverait trop tard. La distinction
                valide / incomplet continue de passer par ce qui la porte déjà,
                la bordure et le fond dorés — l'icône se contente de s'éteindre.
                Le nom perd 10 px de largeur en échange, pour qu'autant de puces
                qu'avant tiennent sur une ligne en portrait. */}
            <AttrIcon id={s.attr.id} fallback={s.attr.icon} className={`h-4 w-4 text-[13px] ${active ? '' : 'opacity-60'}`} />
            <span className="max-w-[60px] truncate">{s.attr.name}</span>
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
