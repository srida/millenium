// Barre HUD haute : PV joueur/ennemi (max 1000), indicateur de manche,
// multiplicateurs de dégâts (affichés pendant le combat).
import { useGameStore } from '../../stores/gameStore.js';
import { Gauge } from '../ui/primitives.js';

export default function Hud() {
  const { playerHp, enemyHp, round, playerMultiplier, enemyMultiplier, combatActive } = useGameStore();

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="flex-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-player">◆ Toi</span>
          <span className="font-bold text-player tabular-nums">{playerHp}</span>
        </div>
        <Gauge value={playerHp / 1000} fillClassName="bg-player" className="mt-1" />
      </div>

      <div className="flex flex-col items-center px-1">
        {combatActive && <div className="text-[10px] font-bold text-player tabular-nums">×{playerMultiplier.toFixed(1)}</div>}
        <div className="flex flex-col items-center rounded-md border border-line bg-surface/80 px-2 py-0.5">
          <span className="text-sm font-bold tabular-nums">{round} / 5</span>
          <span className="text-[9px] tracking-widest text-white/50">MANCHE</span>
        </div>
        {combatActive && <div className="text-[10px] font-bold text-enemy tabular-nums">×{enemyMultiplier.toFixed(1)}</div>}
      </div>

      <div className="flex-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-enemy tabular-nums">{enemyHp}</span>
          <span className="font-semibold text-enemy">Adversaire ◆</span>
        </div>
        <Gauge value={enemyHp / 1000} fillClassName="bg-enemy" className="mt-1" />
      </div>
    </div>
  );
}
