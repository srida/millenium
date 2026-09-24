// Le compteur d'unités (`placedCount/boardSlots`) posé au coin bas-droit du
// plateau, PENDANT la préparation seulement. Sa position est la vraie
// projection caméra (`GameController.screenPosForCell`), jamais un calcul CSS
// à côté : `Scene3D._cameraFraming` diffère déjà entre portrait et web, une
// seconde version finirait par s'en désaccorder au premier changement de l'un
// des deux.
//
// ⚠️ Case { col: 4, row: 0 } : colonne la plus à DROITE (`xForCol` croît avec
// `col`, 5 colonnes 0-4) et rangée la plus BASSE à l'écran côté joueur —
// `zForRow` DÉCROÎT quand `row` croît, et la caméra pose `up = (0,0,-1)`
// (aucune inclinaison), donc c'est +Z qui est le BAS de l'écran. `row: 0`,
// au Z maximal des quatre rangées joueur, est la plus proche du joueur — donc
// la plus basse à l'écran.
//
// ⚠️ Inchangé en PvP : la mise en miroir (`BoardMirror`) ne touche que la
// reconstruction de l'ADVERSAIRE (rangées 7-10) — les rangées 0-3 restent
// celles du joueur local, quel que soit son rôle A/B.
import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';

const CORNER_CELL = { col: 4, row: 0 };

export default function UnitCounterBadge() {
  const controller = useGameStore(s => s.controller);
  const phase = useGameStore(s => s.phase);
  const placedCount = useGameStore(s => s.placedCount);
  const boardSlots = useGameStore(s => s.boardSlots);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const active = phase === 'preparation';

  useEffect(() => {
    if (!active || !controller) { setPos(null); return; }
    const recompute = () => setPos(controller.screenPosForCell(CORNER_CELL));
    recompute();
    // `Board3DCanvas` attache la scène dans son PROPRE effet : au tout premier
    // rendu elle peut ne pas l'être encore. Un second essai au frame suivant
    // couvre cette course sans boucle continue (pas de rAF permanent : le
    // cadrage de préparation ne bouge qu'au resize).
    const raf = requestAnimationFrame(recompute);
    window.addEventListener('resize', recompute);
    window.addEventListener('orientationchange', recompute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', recompute);
      window.removeEventListener('orientationchange', recompute);
    };
  }, [active, controller]);

  if (!active || !pos) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-10 flex min-w-[2.25rem] items-center justify-center rounded-md border border-line bg-surface/80 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white/80 shadow-lg"
      style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }}
    >
      {placedCount}/{boardSlots}
    </div>
  );
}
