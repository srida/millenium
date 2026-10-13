// Barre HUD haute : PV joueur/ennemi (max `PLAYER_HP_CAP`), indicateur de manche et,
// la jauge d'énergie du tour (en préparation, `EnergyGauge`),
// multiplicateurs de dégâts (affichés pendant le combat), identité des deux
// camps (avatar + pseudo/nom de deck, résolus par l'écran appelant).
import { jokerLabel } from '../../data/JokerInfo.js';
import type { JokerKind } from '../../logic/GameState.js';
import EnergyGauge from './EnergyGauge.js';
import JokerButton from './JokerButton.js';
import { useGameStore } from '../../stores/gameStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { Avatar } from '../ui/primitives.js';
import HpBar, { useHpTransition } from './HpBar.js';
import { useWebLayout, useTabletLayout } from '../system/useWebLayout.js';
import { useEmoteStore } from '../../stores/emoteStore.js';

export interface HudProps {
  // Portrait adverse : avatar de profil (PvP) ou avatar du deck public
  // (solo/tournoi) — image ou emoji, résolu par l'écran appelant.
  enemyAvatarSrc?: string | null;
  enemyAvatarFallback?: string;
  // Pseudo de l'adversaire (PvP) ou nom du deck public (solo/tournoi).
  enemyName?: string | null;
  // Messages rapides (Duel en ligne seulement) : quand il est fourni, la zone
  // avatar + pseudo du joueur devient un bouton qui l'appelle.
  onPlayerTap?: () => void;
}

/**
 * Le joker ADVERSE, à côté de ses PV (celui du joueur est `JokerButton`) : son
 * facteur en or quand il est révélé, au combat seulement, un 🃏
 * estompé tant qu'il reste à jouer — c'est une information de lecture : un
 * adversaire qui a encore son joker peut encore faire compter un round. Rien
 * une fois joué.
 */
function JokerChip({ joker, used }: { joker: JokerKind | null; used: boolean }) {
  const label = jokerLabel(joker);
  if (label) return <span className="text-[10px] font-bold text-gold tabular-nums" title="Joker posé ce round">🃏{label}</span>;
  if (used) return null;
  return <span className="text-[10px] opacity-40" title="Joker encore disponible" aria-label="Joker encore disponible">🃏</span>;
}

export default function Hud({ enemyAvatarSrc = null, enemyAvatarFallback = '?', enemyName = null, onPlayerTap }: HudProps) {
  const { playerHp, enemyHp, round, enemyJoker, enemyJokerUsed } = useGameStore();
  // ⚠️ Le chiffre et la jauge comptent sur la MÊME horloge : la transition est
  // tenue ici, une fois par camp, et descend dans les deux (cf. `HpBar`). Deux
  // décomptes indépendants finiraient par ne plus annoncer le même total.
  const player = useHpTransition(playerHp);
  const enemy = useHpTransition(enemyHp);
  const opponentMuted = useEmoteStore(s => s.opponentMuted);
  const user = useAuthStore(s => s.user);
  const playerAvatar = (user as { avatar?: string | null } | null)?.avatar ?? '';
  const playerName = user?.username ?? 'Toi';

  const web = useWebLayout();
  const tablet = useTabletLayout();
  // ⚠️ Concaténation par `+`, pas un template literal avec `${}` : la classe
  // `pt-[max(0.5rem,...)]` contient une VIRGULE, et Tailwind ne l'extrait
  // plus dès qu'un `${}` apparaît ailleurs dans le même gabarit — c'est ce qui
  // faisait passer les barres de vie SOUS la Dynamic Island en PWA installée,
  // sans qu'aucune classe ne soit visiblement « fausse » dans le code.
  const classname_header = 'pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]' + (web ? ' px-22' : '');

  return (
    <div className={classname_header}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          {onPlayerTap ? (
            // Cible tactile de 44 px : `-my-3` l'empêche de faire grandir la ligne.
            <button
              type="button"
              aria-label="Messages rapides"
              onClick={onPlayerTap}
              className="pointer-events-auto -my-3 flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 text-left"
            >
              <Avatar src={playerAvatar} fallback="★" className="h-5 w-5" />
              <span className="truncate font-semibold text-player">{playerName}</span>
            </button>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar src={playerAvatar} fallback="★" className="h-5 w-5" />
              <span className="truncate font-semibold text-player">{playerName}</span>
            </span>
          )}
          <span className="flex flex-shrink-0 items-center gap-1.5">
            <JokerButton />
            <span className="font-bold text-player tabular-nums">{player.shown}</span>
          </span>
        </div>
        <HpBar side="player" value={playerHp} lag={player.lag} delta={player.delta} className="mt-1" />
      </div>

      <div className="flex flex-col items-center px-1">
        <div className="flex flex-col items-center rounded-md border border-line bg-surface/80 px-2 py-0.5">
          <span className="text-sm font-bold tabular-nums">{round} / 5</span>
          <span className="text-[9px] tracking-widest text-white/50">MANCHE</span>
        </div>
        {/* L'énergie, sous la manche en paysage : c'est le budget DU TOUR, et
            le centre du HUD est ce que l'œil retrouve sans chercher. */}
        {web && <EnergyGauge orientation="horizontal" compact={!tablet} className={tablet ? 'mt-1 w-[320px]' : 'mt-1 w-[240px]'} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex flex-shrink-0 items-center gap-1.5">
            <span className="font-bold text-enemy tabular-nums">{enemy.shown}</span>
            <JokerChip joker={enemyJoker} used={enemyJokerUsed} />
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            {opponentMuted && <span className="flex-shrink-0 text-[9px] tracking-[0.08em] text-white/50">MUET</span>}
            {enemyName && <span className="truncate font-semibold text-enemy">{enemyName}</span>}
            <Avatar src={enemyAvatarSrc} fallback={enemyAvatarFallback} className="h-5 w-5" />
          </span>
        </div>
        <HpBar side="enemy" value={enemyHp} lag={enemy.lag} delta={enemy.delta} className="mt-1" />
      </div>

      {/* Portrait : la jauge sort du flux, sous la barre de PV — verticale au
          bord droit sur téléphone (la largeur manque), horizontale centrée sur
          tablette. `top-full` suit la safe area que le header porte déjà. */}
      {!web && (tablet
        ? <EnergyGauge orientation="horizontal" className="absolute left-1/2 top-full w-[calc(100%-1.25rem)] max-w-[520px] -translate-x-1/2" />
        : <EnergyGauge orientation="vertical" className="absolute right-1.5 top-full mt-2.5" />)}
    </div>
  );
}
