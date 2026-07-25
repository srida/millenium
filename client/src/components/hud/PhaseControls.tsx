// Contrôles de phase : en préparation (compteur d'unités, timer 60s, bouton
// PRÊT) ; en combat (terrain, timer restant, vitesse ×1/×2/×4, pause).
import { useGameStore } from '../../stores/gameStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import type { BoardDef } from '../../logic/types.js';
import { Button } from '../ui/primitives.js';

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;
}

// Terrain du combat en cours : tap → tooltip (nom + effet). Les cases bloquées
// qu'il impose sont rendues par Scene3D, ce chip dit d'où elles viennent.
function TerrainChip({ board }: { board: BoardDef }) {
  const showTooltip = useUiStore(s => s.showTooltip);
  return (
    <button
      onPointerDown={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        showTooltip({ kind: 'terrain', board }, { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
      }}
      className="min-h-tap min-w-0 max-w-[8rem] truncate rounded-md border border-line bg-surface/80 px-2 text-xs text-white/80 active:opacity-80"
    >
      🗺️ {board.name}
    </button>
  );
}

export default function PhaseControls() {
  const { controller, combatActive, placedCount, boardSlots, prepRemaining, combatRemaining, speed, paused, boardTerrain } = useGameStore();
  if (!controller) return null;

  if (combatActive) {
    return (
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <span className="rounded-md border border-line bg-surface/80 px-2 py-1 text-xs font-bold tabular-nums text-white/80">
          {combatRemaining}s
        </span>
        {boardTerrain && <TerrainChip board={boardTerrain} />}
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-line">
          {[1, 2, 4].map(s => (
            <button
              key={s}
              onPointerDown={(e) => { e.stopPropagation(); controller.setSpeed(s); }}
              className={`min-h-tap px-3 text-sm font-semibold ${s === speed ? 'bg-gold/20 text-gold' : 'bg-surface-raised text-white/70'}`}
            >×{s}</button>
          ))}
        </div>
        <div className="flex-1" />
        <Button onPointerDown={(e) => { e.stopPropagation(); controller.togglePause(); }}>
          {paused ? '▶ Reprendre' : '⏸ Pause'}
        </Button>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 p-2">
      <span className="rounded-md border border-line bg-surface/80 px-2 py-1 text-sm font-semibold tabular-nums">
        {placedCount}/{boardSlots}
      </span>
      <span className="rounded-md border border-line bg-surface/80 px-2 py-1 text-xs tabular-nums text-white/70">
        Fin prépa {fmt(prepRemaining)}
      </span>
      <div className="flex-1" />
      <Button variant="primary" onPointerDown={(e) => { e.stopPropagation(); controller.startCombat(); }}>
        PRÊT ▸
      </Button>
    </div>
  );
}
