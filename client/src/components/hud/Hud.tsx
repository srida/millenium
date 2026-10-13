// Barre HUD haute, façon jeu de combat : les deux camps se font face, avatar
// aux extrémités, barre de PV biseautée vers le centre avec le chiffre dedans,
// pseudo sous l'avatar ; la manche au centre, et en paysage la jauge d'énergie
// du tour (`EnergyGauge`) sous elle. Sous chaque barre : ce qui vient d'être
// encaissé et le joker du camp (au combat). Le joker du joueur se POSE dans la
// barre de phase (`JokerButton`, `PhaseControls`).
import type { ReactNode } from 'react';
import { jokerLabel } from '../../data/JokerInfo.js';
import type { JokerKind } from '../../logic/GameState.js';
import EnergyGauge from './EnergyGauge.js';
import { useGameStore } from '../../stores/gameStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { Avatar } from '../ui/primitives.js';
import HpBar, { HpDelta, useHpTransition } from './HpBar.js';
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
 * Le joker d'un camp, sous sa barre de PV : son facteur en or quand il est
 * révélé (au combat seulement), un 🃏 estompé tant que l'ADVERSAIRE l'a encore
 * en main — c'est une information de lecture : un adversaire qui a encore son
 * joker peut encore faire compter un round. Rien une fois joué.
 */
function JokerChip({ joker, used }: { joker: JokerKind | null; used: boolean }) {
  const label = jokerLabel(joker);
  if (label) return <span className="text-[11px] font-bold leading-[14px] text-gold tabular-nums" title="Joker posé ce round">🃏{label}</span>;
  if (used) return null;
  return <span className="text-[11px] leading-[14px] opacity-40" title="Joker encore disponible" aria-label="Joker encore disponible">🃏</span>;
}

/**
 * L'avatar d'un camp et son pseudo dessous. Le pseudo est en absolu : il
 * déborde sous la barre sans la pousser, et se tronque au-delà de sa largeur
 * maximale.
 */
function Portrait({ side, src, fallback, name, web, children }: {
  side: 'player' | 'enemy';
  src: string | null;
  fallback: string;
  name: string | null;
  web: boolean;
  children?: ReactNode;
}) {
  const player = side === 'player';
  return (
    <span className="relative z-10 block shrink-0">
      <Avatar
        src={src}
        fallback={fallback}
        className={(web ? 'h-11 w-11 ' : 'h-[46px] w-[46px] ')
          + 'border-[3px]! border-[#0b0b0d]! text-lg shadow-[0_4px_10px_rgba(0,0,0,.55)] ring-2 '
          + (player ? 'ring-player -rotate-3' : 'ring-enemy rotate-3')}
      />
      {name && (
        <span
          className={'hud-name font-comic absolute top-[calc(100%+6px)] block truncate bg-[#0b0b0d] px-[7px] text-[10px] font-bold uppercase leading-[14px] tracking-[.04em] text-white '
            + (web ? 'max-w-[150px] ' : 'max-w-[96px] ')
            + (player ? 'hud-name-player left-0' : 'hud-name-enemy right-0')}
        >
          {name}
        </span>
      )}
      {children}
    </span>
  );
}

export default function Hud({ enemyAvatarSrc = null, enemyAvatarFallback = '?', enemyName = null, onPlayerTap }: HudProps) {
  const { playerHp, enemyHp, round, playerJoker, enemyJoker, enemyJokerUsed, combatActive } = useGameStore();
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
  const classname_header = 'pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-1.5 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]' + (web ? ' px-22' : '');
  // La barre se centre verticalement sur l'avatar (46 px portrait, 44 paysage)
  // et passe 6 px dessous.
  const barColumn = 'flex min-w-0 flex-1 flex-col gap-[5px] ' + (web ? 'mt-2.5' : 'mt-[11px]');

  const portrait = <Portrait side="player" src={playerAvatar} fallback="★" name={playerName} web={web} />;

  return (
    <div className={classname_header}>
      <div className="flex min-w-0 flex-1 items-start">
        {onPlayerTap ? (
          // Messages rapides : avatar + pseudo forment la cible (44 px minimum).
          <button
            type="button"
            aria-label="Messages rapides"
            onClick={onPlayerTap}
            className="pointer-events-auto relative z-10 min-h-tap min-w-tap shrink-0"
          >
            {portrait}
          </button>
        ) : portrait}
        <div className={barColumn + ' -ml-1.5'}>
          <HpBar side="player" value={playerHp} shown={player.shown} lag={player.lag} />
          <div className="flex min-h-[14px] items-center justify-end gap-1.5 pr-3">
            <HpDelta delta={player.delta} />
            {/* Le joueur pose le sien dans la barre de phase : ici, seulement
                le facteur joué, au combat. */}
            {combatActive && <JokerChip joker={playerJoker} used />}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-[3px] px-0.5">
        <div className="round-hex flex h-10 w-[54px] items-center justify-center bg-gold">
          <div className="round-hex-inner flex h-9 w-[50px] items-center justify-center gap-px bg-[#0b0b0d]">
            <span className="text-xl font-bold leading-none tabular-nums text-gold">{round}</span>
            <span className="mt-1.5 text-[10px] font-bold leading-none text-white/50">/5</span>
          </div>
        </div>
        <span className="text-[8px] font-bold leading-[10px] tracking-[.14em] text-white/55">MANCHE</span>
        {/* L'énergie, sous la manche en paysage : c'est le budget DU TOUR, et
            le centre du HUD est ce que l'œil retrouve sans chercher. */}
        {web && <EnergyGauge orientation="horizontal" compact={!tablet} className={tablet ? 'mt-1 w-[320px]' : 'mt-1 w-[240px]'} />}
      </div>

      <div className="flex min-w-0 flex-1 flex-row-reverse items-start">
        <Portrait side="enemy" src={enemyAvatarSrc} fallback={enemyAvatarFallback} name={enemyName} web={web}>
          {opponentMuted && (
            <span className="absolute right-0 top-[calc(100%+26px)] text-[9px] tracking-[0.08em] text-white/50">MUET</span>
          )}
        </Portrait>
        <div className={barColumn + ' -mr-1.5'}>
          <HpBar side="enemy" value={enemyHp} shown={enemy.shown} lag={enemy.lag} />
          <div className="flex min-h-[14px] items-center justify-start gap-1.5 pl-3">
            <JokerChip joker={enemyJoker} used={enemyJokerUsed} />
            <HpDelta delta={enemy.delta} />
          </div>
        </div>
      </div>

      {/* Portrait : la jauge sort du flux, sous le HUD — verticale au bord droit
          sur téléphone (la largeur manque), horizontale centrée sur tablette.
          `top-full` suit la safe area que le header porte déjà ; `mt-7` passe
          sous les pseudos. */}
      {!web && (tablet
        ? <EnergyGauge orientation="horizontal" className="absolute left-1/2 top-full mt-5 w-[calc(100%-1.25rem)] max-w-[520px] -translate-x-1/2" />
        : <EnergyGauge orientation="vertical" className="absolute right-1.5 top-full mt-7" />)}
    </div>
  );
}
