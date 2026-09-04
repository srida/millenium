// Ce qu'un terrain FAIT, en lignes — un effet par ligne, avec les puces de ce
// qu'il vise.
//
// Deux lecteurs : l'annonce d'entrée en combat (`TerrainAlert`) et l'infobulle
// 🗺️ de la barre de combat. Une seule écriture, pour la raison qui a déjà sorti
// `boardEffectLabel` du tooltip : deux descriptions du même terrain finissent
// par ne plus dire la même chose. Ici s'y ajoute le cumul — un terrain porte
// désormais plusieurs effets, et l'un des deux écrans oublierait les suivants.
//
// ⚠️ La liste des effets passe par `BoardEffect.boardEffects`, seul lecteur des
// deux formes de la donnée (`effects` cumulés, `effect` historique) : un écran
// qui lirait `board.effect` afficherait « Aucun effet » sur les terrains neufs.
import { boardEffects } from '../../logic/BoardEffect.js';
import { boardEffectLabel, boardTargetsUnits, boardTargetAttributes } from '../../data/BoardInfo.js';
import AttrIcon, { attributeName } from './AttrIcon.js';
import type { BoardDef, BoardEffectDef } from '../../logic/types.js';

const CHIP = 'flex items-center gap-1 rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold';

/**
 * Les puces de ciblage d'un effet — ses archétypes, et rien d'autre.
 *
 * ⚠️ Il n'y a plus qu'UNE famille : les voies d'invocation sont devenues des
 * attributs de carte comme les autres, elles passent donc par la même puce. Le
 * ET entre deux familles n'existe plus, et `BoardEffect.effectTargets` non plus
 * ne lit qu'un ciblage.
 */
function TargetChips({ effect, center }: { effect: BoardEffectDef; center?: boolean }) {
  const attrs = boardTargetAttributes(effect);
  if (!boardTargetsUnits(effect)) return null;
  // Aucun ciblage = toutes les unités des deux joueurs : le dire, sinon le
  // silence se lit comme « aucune cible ».
  if (!attrs.length) {
    return <div className="mt-1 text-[10px] text-white/40">Toutes les unités</div>;
  }
  return (
    <div className={`mt-1 flex flex-wrap gap-1 ${center ? 'justify-center' : ''}`}>
      {attrs.map(id => (
        <span key={id} className={CHIP}>
          <AttrIcon id={id} className="h-3.5 w-3.5 text-[11px]" />
          {attributeName(id)}
        </span>
      ))}
    </div>
  );
}

export default function TerrainEffects({ board, center = false, className = '' }: {
  board: BoardDef;
  /** L'annonce d'entrée en combat est centrée ; l'infobulle ne l'est pas. */
  center?: boolean;
  className?: string;
}) {
  const effects = boardEffects(board);
  // ⚠️ « Aucun effet » plutôt qu'un blanc : un vide se lirait comme un bug
  // d'affichage et non comme un terrain neutre (même règle que
  // `boardEffectLabel`, dont c'est le repli).
  if (!effects.length) {
    return <div className={`text-xs text-white/50 ${className}`}>Aucun effet</div>;
  }
  return (
    <div className={`space-y-1.5 ${className}`}>
      {effects.map((effect, i) => (
        <div key={i}>
          <div className="text-xs text-white/70">{boardEffectLabel(effect)}</div>
          <TargetChips effect={effect} center={center} />
        </div>
      ))}
    </div>
  );
}
