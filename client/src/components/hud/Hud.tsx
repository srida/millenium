// Barre HUD haute : PV joueur/ennemi (max 1000), indicateur de manche,
// multiplicateurs de dégâts (affichés pendant le combat), identité des deux
// camps (avatar + pseudo joueur). Côté adverse, le nom n'est affiché que si
// fourni (solo/tournoi, deck public) — en PvP il vit déjà dans le bandeau
// `vs …` dédié, pas besoin de le répéter ici.
import { useGameStore } from '../../stores/gameStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { Avatar, Gauge } from '../ui/primitives.js';

export interface HudProps {
  // Portrait adverse : avatar de profil (PvP) ou avatar du deck public
  // (solo/tournoi) — image ou emoji, résolu par l'écran appelant.
  enemyAvatarSrc?: string | null;
  enemyAvatarFallback?: string;
  // Nom du deck public adverse (solo/tournoi uniquement).
  enemyName?: string | null;
}

export default function Hud({ enemyAvatarSrc = null, enemyAvatarFallback = '?', enemyName = null }: HudProps) {
  const { playerHp, enemyHp, round, playerMultiplier, enemyMultiplier, combatActive } = useGameStore();
  const user = useAuthStore(s => s.user);
  const playerAvatar = (user as { avatar?: string | null } | null)?.avatar ?? '';
  const playerName = user?.username ?? 'Toi';

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar src={playerAvatar} fallback="★" className="h-5 w-5" />
            <span className="truncate font-semibold text-player">{playerName}</span>
          </span>
          <span className="flex flex-shrink-0 items-center gap-1.5">
            {combatActive && <span className="text-[10px] font-bold text-player/80 tabular-nums">×{playerMultiplier.toFixed(1)}</span>}
            <span className="font-bold text-player tabular-nums">{playerHp}</span>
          </span>
        </div>
        <Gauge value={playerHp / 1000} fillClassName="bg-player" className="mt-1" />
      </div>

      <div className="flex flex-col items-center px-1">
        <div className="flex flex-col items-center rounded-md border border-line bg-surface/80 px-2 py-0.5">
          <span className="text-sm font-bold tabular-nums">{round} / 5</span>
          <span className="text-[9px] tracking-widest text-white/50">MANCHE</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex flex-shrink-0 items-center gap-1.5">
            <span className="font-bold text-enemy tabular-nums">{enemyHp}</span>
            {combatActive && <span className="text-[10px] font-bold text-enemy/80 tabular-nums">×{enemyMultiplier.toFixed(1)}</span>}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            {enemyName && <span className="truncate font-semibold text-enemy">{enemyName}</span>}
            <Avatar src={enemyAvatarSrc} fallback={enemyAvatarFallback} className="h-5 w-5" />
          </span>
        </div>
        <Gauge value={enemyHp / 1000} fillClassName="bg-enemy" className="mt-1" />
      </div>
    </div>
  );
}
