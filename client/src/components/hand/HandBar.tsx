// Main du joueur : bande horizontale scrollable, triée par tier et regroupée
// par carte (les exemplaires identiques s'empilent, badge ×N). Carte grisée si
// injouable (doublon normal, matériaux manquants…). Tap → sélection ;
// long-press → tooltip.
//
// En mode web (écran plus large que haut), la bande devient un panneau encadré à
// deux colonnes collé à gauche (même habillage que le cimetière) : le board
// récupère toute la hauteur de l'écran. La largeur du rail (w-52) est réservée
// par le cadrage caméra via WEB_RAIL_PX.
import { useRef } from 'react';
import { useGameStore, type HandEntry } from '../../stores/gameStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useWebLayout } from '../system/useWebLayout.js';
import { costHint } from '../../data/CardDatabase.js';

export default function HandBar() {
  const hand = useGameStore(s => s.hand);
  const combatActive = useGameStore(s => s.combatActive);
  const controller = useGameStore(s => s.controller);
  const web = useWebLayout();
  if (combatActive || !controller) return null;

  const empty = hand.length === 0 && <span className="col-span-2 px-2 py-6 text-xs text-white/40">Main vide</span>;

  if (web) {
    return (
      <div className="pointer-events-auto absolute bottom-14 left-0 top-14 z-20 w-52">
        <div className="mx-2 flex max-h-full flex-col rounded-lg border border-line bg-surface/85 p-1.5">
          <div className="mb-1 shrink-0 text-[9px] tracking-widest text-white/40">MAIN</div>
          <div className="grid grid-cols-2 content-start justify-items-center gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {empty}
            {hand.map(entry => (
              <HandCard key={entry.key} entry={entry} rail />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-14 z-20">
      <div className="flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {empty}
        {hand.map(entry => (
          <HandCard key={entry.key} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function HandCard({ entry, rail = false }: { entry: HandEntry; rail?: boolean }) {
  const controller = useGameStore(s => s.controller)!;
  const showTooltip = useUiStore(s => s.showTooltip);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hint = (costHint as (c: unknown) => string | null)(entry.card);

  // Sélection au pointerdown (tap instantané, cohérent avec le reste de l'app) ;
  // maintien 500ms → tooltip carte.
  const clearLong = () => { if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; } };

  return (
    <button
      onPointerDown={(e) => {
        e.stopPropagation();
        controller.selectCard(entry.selected ? null : entry.card, entry.selected ? null : entry.idx);
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        longPress.current = setTimeout(() => {
          showTooltip({ kind: 'card', card: entry.card }, { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
        }, 500);
      }}
      onPointerUp={clearLong}
      onPointerLeave={clearLong}
      onPointerCancel={clearLong}
      className={[
        'relative aspect-[5/7] h-28 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-transform',
        // La carte sélectionnée sort de la bande : vers le haut en bas d'écran,
        // vers le board (droite) quand la main est un rail vertical.
        entry.selected ? (rail ? 'border-gold translate-x-2' : 'border-gold -translate-y-2') : 'border-line',
        entry.playable ? 'opacity-100' : 'opacity-40 grayscale',
        // Épaisseur de pile : la carte porte visiblement plusieurs exemplaires.
        entry.count > 1 ? 'mr-1 shadow-[3px_3px_0_0_var(--color-surface-raised),4px_4px_0_0_var(--color-line)]' : '',
      ].join(' ')}
    >
      <img src={`/illustrations/${entry.card.id}`} alt={entry.card.name} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1 pb-0.5 pt-3">
        <div className="truncate text-[9px] font-semibold leading-tight text-white">{entry.card.name}</div>
      </div>
      <span className="absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px] font-bold text-white">T{entry.card.tier}</span>
      {hint && <span className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px]">{hint}</span>}
      {entry.count > 1 && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-gold px-1 text-[9px] font-bold text-black">×{entry.count}</span>
      )}
    </button>
  );
}
