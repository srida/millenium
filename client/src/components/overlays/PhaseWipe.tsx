// Le volet de passage d'une phase à l'autre : préparation → combat, puis
// récapitulatif → Phase Shopping. Deux bandes qui balaient l'écran, et rien
// d'autre.
//
// ⚠️ **Aucun MOT.** Le volet portait « COMBAT » et « MAGIES » ; mesuré à
// l'écran, le premier tombait en plein milieu de l'annonce de terrain, qu'il
// recouvrait de son propre nom. Les deux phases s'annoncent déjà elles-mêmes —
// l'annonce de terrain pour le combat, le titre de la modale pour le Shopping —
// et une seconde façon de le dire ne pouvait que les contredire ou les cacher.
// Le volet ne dit donc rien : il montre qu'on change de registre, la teinte
// suffit à dire lequel.
//
// ⚠️ Il ne PILOTE rien et ne RETIENT rien — ni son minuteur (il vit dans
// `GameController`, comme ceux de l'annonce de terrain et de l'ouverture de
// tour), ni l'état qu'il découvre : celui-ci est déjà publié quand le volet
// apparaît. C'est la différence de fond avec `TerrainAlert`, qui tient le
// premier coup, et avec la frappe finale, qui tient le récapitulatif.
//
// ⚠️ `pointer-events-none` sur TOUTE la couche : le volet de combat passe
// par-dessus l'annonce de terrain, qui est justement tapable pendant ce
// temps-là. Un volet qui capte les taps rendrait la règle « le tap passe
// l'annonce » fausse pendant presque une seconde.
//
// ⚠️ `z-40` comme les autres couches de partie, pas plus : `TutorialCoach` est
// en `z-50` avec sa bulle tapable.
import { useGameStore } from '../../stores/gameStore.js';
import { COMBAT_INTRO_MS, SHOPPING_INTRO_MS } from '../../game/timings.js';

const WIPE: Record<'combat' | 'shopping', { durationMs: number; className: string }> = {
  combat:   { durationMs: COMBAT_INTRO_MS,   className: 'phase-wipe-combat' },
  shopping: { durationMs: SHOPPING_INTRO_MS, className: 'phase-wipe-shopping' },
};

export default function PhaseWipe() {
  const wipe = useGameStore(s => s.phaseWipe);
  if (!wipe) return null;
  const { durationMs, className } = WIPE[wipe.kind];

  return (
    <div
      className={`phase-wipe pointer-events-none fixed inset-0 z-40 overflow-hidden ${className}`}
      style={{ ['--phase-wipe-dur' as string]: `${durationMs}ms` }}
      aria-hidden="true"
    >
      {/* Deux bandes qui se croisent en sens inverse. L'écran n'est couvert
          qu'à l'instant où elles se rejoignent, et c'est tout l'intérêt : le
          cadrage saute là-dessous (`Scene3D.enterCombatMode` déplace la caméra
          en 0,5 s), et ce qui vient ensuite est DÉCOUVERT au lieu d'apparaître
          d'un coup. Un voile qui s'allume et s'éteint sur place donnerait un
          clignotement, cinq fois par partie. */}
      <div className="phase-wipe-band phase-wipe-band-top" />
      <div className="phase-wipe-band phase-wipe-band-bottom" />
    </div>
  );
}
