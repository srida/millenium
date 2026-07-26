// Cimetière : unités neutralisées, disponibles comme matériaux d'invocation
// (sacrifice/fusion/heritage/transformation) et cibles de la magie revive.
//
// En mode web (écran plus large que haut), le bandeau devient un rail vertical à
// deux colonnes collé à droite, symétrique du rail de main — cf. HandBar /
// WEB_RAIL_PX (les deux rails ont la même largeur : le board reste centré).
import { useRef } from 'react';
import { useGameStore, type GraveyardEntry } from '../../stores/gameStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useWebLayout } from '../system/useWebLayout.js';

export default function GraveyardTray() {
  const graveyard = useGameStore(s => s.graveyard);
  const combatActive = useGameStore(s => s.combatActive);
  const shopping = useGameStore(s => s.shopping);
  const controller = useGameStore(s => s.controller);
  const web = useWebLayout();
  // Visible pendant la préparation (matériaux) OU pendant un ciblage revive.
  const targetingGraveyard = shopping?.awaitingTarget === 'graveyard';
  if (!controller || (combatActive && !targetingGraveyard) || graveyard.length === 0) return null;

  if (web) {
    return (
      // top-28 : dégage le bouton ☰ du menu d'options, ancré en haut à droite.
      <div className="pointer-events-auto absolute bottom-14 right-0 top-28 z-20 w-52">
        <div className="mx-2 flex max-h-full flex-col rounded-lg border border-line bg-surface/85 p-1.5">
          <div className="mb-1 shrink-0 text-[9px] tracking-widest text-white/40">NEUTRALISÉES</div>
          <div className="grid grid-cols-2 content-start justify-items-center gap-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {graveyard.map(entry => <GraveCard key={entry.uid} entry={entry} targeting={targetingGraveyard} rail />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-44 z-20">
      <div className="mx-2 rounded-lg border border-line bg-surface/85 p-1.5">
        <div className="mb-1 text-[9px] tracking-widest text-white/40">NEUTRALISÉES</div>
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {graveyard.map(entry => <GraveCard key={entry.uid} entry={entry} targeting={targetingGraveyard} />)}
        </div>
      </div>
    </div>
  );
}

function GraveCard({ entry, targeting, rail = false }: { entry: GraveyardEntry; targeting: boolean; rail?: boolean }) {
  const controller = useGameStore(s => s.controller)!;
  const showTooltip = useUiStore(s => s.showTooltip);

  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLong = () => { if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; } };

  return (
    <button
      onPointerDown={(e) => {
        e.stopPropagation();
        // tap → sélection matériau / cible revive ; maintien → tooltip
        if (targeting) controller.resolveMagieGraveyardTarget(entry.unit);
        else controller.tapGraveyardUnit(entry.unit);
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        longPress.current = setTimeout(() => showTooltip({ kind: 'unit', unit: entry.unit }, { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height }), 500);
      }}
      onPointerUp={clearLong}
      onPointerLeave={clearLong}
      onPointerCancel={clearLong}
      className={[
        // Le rail vertical a la largeur de deux cartes de main : les vignettes y
        // sont plus grandes que dans le bandeau horizontal du mode portrait.
        rail ? 'relative aspect-[5/7] h-24 flex-shrink-0 overflow-hidden rounded border-2' : 'relative aspect-[5/7] h-16 flex-shrink-0 overflow-hidden rounded border-2',
        entry.selected ? 'border-white' : entry.candidate || targeting ? 'border-gold' : 'border-line opacity-70 grayscale',
      ].join(' ')}
    >
      <img src={`/illustrations/${entry.unit.card_id}`} alt={entry.unit.name} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
    </button>
  );
}
