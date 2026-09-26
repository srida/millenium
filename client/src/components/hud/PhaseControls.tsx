// Contrôles de phase : en préparation (compteur d'unités, timer 60s, options,
// bouton PRÊT) ; en combat (terrain, timer restant, vitesse ×1/×2/×4, options,
// pause). Le menu d'options lui-même est rendu par GameMenu, qui lit `menuOpen`.
import { useGameStore } from '../../stores/gameStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import type { BoardDef } from '../../logic/types.js';
import { Button, Illustration } from '../ui/primitives.js';
import HoldConfirmButton from '../ui/HoldConfirmButton.js';
import { useWebLayout } from '../system/useWebLayout.js';
import * as Audio from '../../audio/AudioManager.js';

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;
}

// Terrain du combat en cours : tap → tooltip (nom + effet). Les cases bloquées
// qu'il impose sont rendues par Scene3D, ce chip dit d'où elles viennent.
//
// Le terrain s'annonce par son ILLUSTRATION (la vignette carrée du dossier
// d'illustrations, celle du tooltip) ; 🗺️ n'est que le repli tant qu'aucune
// image n'a été importée — même règle que `AttrIcon` pour les attributs. Un
// pictogramme générique ne distingue pas deux terrains, une image si.
function TerrainChip({ board }: { board: BoardDef }) {
  const showTooltip = useUiStore(s => s.showTooltip);
  return (
    <button
      onPointerDown={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        showTooltip({ kind: 'terrain', board }, { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
      }}
      className="flex min-h-tap min-w-[4.5rem] max-w-[8rem] items-center gap-1.5 rounded-md border border-line bg-surface/80 px-2 text-xs text-white/80 active:opacity-80"
    >
      {board._has_illustration
        ? <Illustration id={board.id} className="h-5 w-5 rounded" />
        : <span className="flex-shrink-0 leading-none">🗺️</span>}
      <span className="truncate">{board.name}</span>
    </button>
  );
}

// « Tout annuler » — remet board et main à l'ouverture du tour (cf.
// GameSession.undoPreparation). Il n'apparaît qu'une fois quelque chose posé ou
// déplacé : au début du tour il n'a rien à faire, et la barre du bas est déjà
// dense sur un écran de 375 px (compteur, chrono, ☰, PRÊT).
//
// Icône seule pour la même raison — le sens passe par `aria-label` / `title`.
// La cible tactile de 44 px vient de `Button` : ne PAS refabriquer un bouton à
// la main ici (c'est ce qui avait mis les contrôles de la boutique sous le
// seuil).
function UndoButton({ onUndo }: { onUndo: () => void }) {
  return (
    <Button
      aria-label="Tout annuler"
      title="Tout annuler"
      className="shrink-0 px-3 text-base"
      onPointerDown={(e) => { e.stopPropagation(); onUndo(); }}
      sfx={false}
    >
      ↺
    </Button>
  );
}

// Mulligan — remet la main dans le deck et en repioche autant, contre des PV.
// N'existe qu'au tour 1, tant que rien n'a été posé ni déplacé : il occupe donc
// exactement la place que `UndoButton` prendra dès la première invocation, et
// les deux ne sont jamais à l'écran ensemble (cf. `GameSnapshot.canMulligan`).
//
// ⚠️ Même bouton à MAINTENIR que le reroll de la Phase Shopping
// (`HoldConfirmButton`) — même doctrine : la charge est la confirmation, plus
// de modale à traverser dans une barre déjà dense.

// Ouvre le menu d'options (rendu par GameMenu) — posé dans la barre du bas,
// à portée de pouce, juste avant PRÊT / Pause.
function MenuButton() {
  const applySnapshot = useGameStore(s => s.applySnapshot);
  return (
    <Button
      aria-label="Options"
      className="shrink-0 px-3 text-base"
      onPointerDown={(e) => { e.stopPropagation(); Audio.playSfx('menu_ingame'); applySnapshot({ menuOpen: true }); }}
      sfx={false}
    >
      ☰
    </Button>
  );
}

export default function PhaseControls({ pvp = false }: { pvp?: boolean }) {
  const {
    controller, combatActive, prepRemaining, combatRemaining,
    speed, paused, boardTerrain, canUndo, canMulligan, mulliganCost,
  } = useGameStore();
  const web = useWebLayout();
  if (!controller) return null;

  // ⚠️ Concaténation par `+`, pas un template literal avec `${}` : la classe
  // `pb-[max(0.5rem,...)]` contient une VIRGULE, et Tailwind ne l'extrait
  // plus dès qu'un `${}` apparaît ailleurs dans le même gabarit — la marge de
  // safe area était donc silencieusement absente du CSS compilé, pour les
  // DEUX barres, depuis leur introduction.
  const classname_footer = 'pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-1.5 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]' + (web ? ' px-22' : '');
  // ⚠️ Même padding que `classname_footer` (combat) : la barre de préparation
  // (PRÊT, ↺, ☰) n'avait pas cette marge et se posait DANS la safe area en PWA
  // installée — home indicator iOS, barre de navigation gestuelle Android.
  const classname_footer2 = 'pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]' + (web ? ' px-22' : '');

  // Barre de combat : dense sur un écran de 375 px (timer, terrain, vitesses,
  // options, pause) — d'où les paddings serrés et les `shrink-0`, sans quoi le
  // chip terrain est écrasé et le label Pause passe à la ligne. En PvP, vitesse
  // et pause ne sont pas réseau — un joueur qui ralentit/pause chez lui ne fait
  // que désynchroniser sa propre vue de l'adversaire qui attend, donc les deux
  // sont retirés plutôt que de laisser un contrôle trompeur.
  if (combatActive) {
    return (
      <div className={classname_footer}>
        <span className="shrink-0 rounded-md border border-line bg-surface/80 px-2 py-1 text-xs font-bold tabular-nums text-white/80">
          {combatRemaining}s
        </span>
        {boardTerrain && <TerrainChip board={boardTerrain} />}
        {!pvp && (
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-line">
            {[1, 2, 4].map(s => (
              <button
                key={s}
                onPointerDown={(e) => { e.stopPropagation(); controller.setSpeed(s); }}
                className={`min-h-tap px-2 text-sm font-semibold ${s === speed ? 'bg-[color-mix(in_srgb,var(--color-gold)_20%,var(--color-surface-raised))] text-gold' : 'bg-surface-raised text-white/70'}`}
              >×{s}</button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        <MenuButton />
        {!pvp && (
          <Button
            aria-label={paused ? 'Reprendre le combat' : 'Mettre en pause'}
            className="shrink-0 px-3 text-base"
            onPointerDown={(e) => { e.stopPropagation(); controller.togglePause(); }}
            sfx={false}
          >
            {paused ? '▶' : '⏸'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={classname_footer2}>
      {/* Le compteur d'unités vit désormais au coin du plateau
          (`UnitCounterBadge`) : le montrer ICI aussi le dirait deux fois. */}
      <span className="rounded-md border border-line bg-surface/80 px-2 py-1 text-xs tabular-nums text-white/70">
        {fmt(prepRemaining)}
      </span>
      <div className="flex-1" />
      {/* `visible`, pas un montage conditionnel : `canMulligan` retombe à
          `false` dans le MÊME tick que `onConfirm` (une seule fois par
          partie) — démonter le composant ici tuerait son toast avant qu'il
          ne s'affiche (cf. `HoldConfirmButton`). */}
      <HoldConfirmButton
        label="Mulligan"
        cost={mulliganCost}
        onConfirm={() => controller.mulligan()}
        visible={canMulligan}
      />
      {canUndo && <UndoButton onUndo={() => controller.undoPreparation()} />}
      <MenuButton />
      <Button variant="primary" onPointerDown={(e) => { e.stopPropagation(); controller.startCombat(); }} sfx={false}>
        PRÊT ▸
      </Button>
    </div>
  );
}
