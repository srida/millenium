// Contrôles de phase : en préparation (compteur d'unités, timer 60s, bouton
// PRÊT) ; en combat (timer restant, vitesse ×1/×2/×4, pause).
import { useGameStore } from '../../stores/gameStore.js';
import { Button } from '../ui/primitives.js';

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;
}

export default function PhaseControls() {
  const { controller, combatActive, placedCount, boardSlots, prepRemaining, combatRemaining, speed, paused } = useGameStore();
  if (!controller) return null;

  if (combatActive) {
    return (
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <span className="rounded-md border border-line bg-surface/80 px-2 py-1 text-xs font-bold tabular-nums text-white/80">
          {combatRemaining}s
        </span>
        <div className="flex overflow-hidden rounded-lg border border-line">
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
