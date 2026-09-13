// Cimetière : unités neutralisées, disponibles comme matériaux d'invocation
// (sacrifice/fusion/heritage/transformation) et cibles de la magie revive.
//
// En mode web (écran plus large que haut), le bandeau devient un rail vertical à
// deux colonnes collé à droite, strictement symétrique du rail de main : même
// bande verticale, même largeur (WEB_RAIL_BAND, `./rail.ts`), le board restant
// centré entre les deux.
//
// ⚠️ Comme la main, il ne décide rien : `./handVisual` porte la visibilité,
// l'état visuel et l'intention de tap — les deux bandes posent la même question
// à un mot près, elles appellent donc la même fonction.
import { useGameStore, type GraveyardEntry } from '../../stores/gameStore.js';
import { useWebLayout } from '../system/useWebLayout.js';
import { WEB_RAIL_BAND } from './rail.js';
import { graveyardVisible, graveyardCardVisual, graveyardTapIntent } from './handVisual.js';
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

  if (!graveyardVisible({
    hasController: !!controller, combatActive, targetingGraveyard, count: graveyard.length,
  })) return null;

  const cards = graveyard.map(entry => (
    <GraveCard key={entry.uid} entry={entry} targeting={targetingGraveyard} rail={web} />
  ));

  if (web) {
    return (
      <div className={`${WEB_RAIL_BAND} right-0`}>
        <div className="mx-2 flex max-h-full flex-col rounded-lg border border-red-500/30 bg-red-500/10 p-1.5">
          <div className="mb-1 shrink-0 text-[9px] tracking-widest text-white/40">NEUTRALISÉES</div>
          <div className="grid grid-cols-2 content-start justify-items-center gap-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {cards}
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
          {cards}
        </div>
      </div>
    </div>
  );
}

function GraveCard({ entry, targeting, rail = false }: { entry: GraveyardEntry; targeting: boolean; rail?: boolean }) {
  const controller = useGameStore(s => s.controller)!;
  const visual = graveyardCardVisual(entry, { targeting });
  const intent = graveyardTapIntent({ targeting });

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
        if (intent.kind === 'magie_target') controller.resolveMagieGraveyardTarget(entry.unit);
        else controller.tapGraveyardUnit(entry.unit);
      }}
      highlight={visual.highlight}
      dim={visual.dim}
      tooltip={{ kind: 'unit', unit: entry.unit }}
    />
  );
}
