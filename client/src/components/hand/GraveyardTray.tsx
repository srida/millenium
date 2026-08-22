// Cimetière : unités neutralisées, disponibles comme matériaux d'invocation
// (sacrifice/fusion/heritage/transformation) et cibles de la magie revive.
//
// En mode web (écran plus large que haut), le bandeau devient un rail vertical à
// deux colonnes collé à droite, strictement symétrique du rail de main : même
// bande verticale, même largeur (WEB_RAIL_BAND, `./rail.ts`), le board restant
// centré entre les deux.
import { useGameStore, type GraveyardEntry } from '../../stores/gameStore.js';
import { useWebLayout } from '../system/useWebLayout.js';
import { WEB_RAIL_BAND } from './rail.js';
import CardTile from '../ui/CardTile.js';
import { artFor } from '../../data/CardArt.js';

export default function GraveyardTray() {
  const graveyard = useGameStore(s => s.graveyard);
  const combatActive = useGameStore(s => s.combatActive);
  const shopping = useGameStore(s => s.shopping);
  const controller = useGameStore(s => s.controller);
  const web = useWebLayout();
  // Visible pendant la préparation (matériaux) OU pendant un ciblage revive.
  const targetingGraveyard = shopping?.awaitingTarget === 'graveyard';
  if (!controller || (combatActive && !targetingGraveyard) || graveyard.length === 0) return null;

  if (web) {
    return (
      <div className={`${WEB_RAIL_BAND} right-0`}>
        <div className="mx-2 flex max-h-full flex-col rounded-lg border border-red-500/30 bg-red-500/10 p-1.5">
          <div className="mb-1 shrink-0 text-[9px] tracking-widest text-white/40">NEUTRALISÉES</div>
          <div className="grid grid-cols-2 content-start justify-items-center gap-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {graveyard.map(entry => <GraveCard key={entry.uid} entry={entry} targeting={targetingGraveyard} rail />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-44 z-20">
      <div className="mx-2 rounded-lg border border-red-500/30 bg-red-500/10 p-1.5">
        <div className="mb-1 text-[9px] tracking-widest text-white/40">NEUTRALISÉES</div>
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {graveyard.map(entry => <GraveCard key={entry.uid} entry={entry} targeting={targetingGraveyard} />)}
        </div>
      </div>
    </div>
  );
}

function GraveCard({ entry, targeting, rail = false }: { entry: GraveyardEntry; targeting: boolean; rail?: boolean }) {
  const controller = useGameStore(s => s.controller)!;
  const selectable = entry.candidate || targeting;

  return (
    <CardTile
      illustrationId={artFor(entry.unit.card_id, entry.unit.side)}
      name={entry.unit.name}
      showName={false}
      // Le rail vertical a la largeur de deux cartes de main : les vignettes y
      // sont plus grandes que dans le bandeau horizontal du mode portrait.
      size={rail ? 'h-24' : 'h-16'}
      // tap → sélection matériau / cible revive ; maintien → tooltip
      onTap={() => {
        if (targeting) controller.resolveMagieGraveyardTarget(entry.unit);
        else controller.tapGraveyardUnit(entry.unit);
      }}
      highlight={entry.selected ? 'material' : selectable ? 'candidate' : 'none'}
      dim={entry.selected || selectable ? 'none' : 'soft'}
      tooltip={{ kind: 'unit', unit: entry.unit }}
    />
  );
}
