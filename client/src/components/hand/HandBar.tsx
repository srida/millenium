// Main du joueur : bande horizontale scrollable, triée par tier et regroupée
// par carte (les exemplaires identiques s'empilent, badge ×N). Carte grisée si
// injouable (doublon normal, matériaux manquants…). Tap → sélection ;
// long-press → tooltip. La vignette elle-même est le template partagé
// components/ui/CardTile.
//
// En mode web (écran plus large que haut), la bande devient un panneau encadré à
// deux colonnes collé à gauche (même habillage que le cimetière) : le board
// récupère toute la hauteur de l'écran. La bande occupée est celle du cimetière,
// au pixel près — cf. WEB_RAIL_BAND (`./rail.ts`), qui porte aussi la largeur
// réservée par le cadrage caméra via WEB_RAIL_PX.
import { useGameStore, type HandEntry } from '../../stores/gameStore.js';
import { useWebLayout } from '../system/useWebLayout.js';
import { WEB_RAIL_BAND } from './rail.js';
import CardTile, { cardTileProps } from '../ui/CardTile.js';

export default function HandBar() {
  const hand = useGameStore(s => s.hand);
  const combatActive = useGameStore(s => s.combatActive);
  const controller = useGameStore(s => s.controller);
  const web = useWebLayout();
  if (combatActive || !controller) return null;

  const empty = hand.length === 0 && <span className="col-span-2 px-2 py-6 text-xs text-white/40">Main vide</span>;

  if (web) {
    return (
      <div className={`${WEB_RAIL_BAND} left-0`}>
        <div className="mx-2 flex max-h-full flex-col rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-1.5">
          <div className="mb-1 shrink-0 text-[9px] tracking-widest text-white/40">MAIN</div>
          <div className="grid grid-cols-2 content-start justify-items-center gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {empty}
            {hand.map(entry => (
              <HandCard key={entry.key} entry={entry} rail />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-14 z-20">
      <div className="mx-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-1.5">
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {empty}
          {hand.map(entry => (
            <HandCard key={entry.key} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HandCard({ entry, rail = false }: { entry: HandEntry; rail?: boolean }) {
  const controller = useGameStore(s => s.controller)!;

  return (
    <CardTile
      {...cardTileProps(entry.card)}
      onTap={() => controller.selectCard(entry.selected ? null : entry.card, entry.selected ? null : entry.idx)}
      highlight={entry.selected ? 'selected' : 'none'}
      // La carte sélectionnée sort de la bande : vers le haut en bas d'écran,
      // vers le board (droite) quand la main est un rail vertical.
      lift={entry.selected ? (rail ? 'right' : 'up') : 'none'}
      dim={entry.playable ? 'none' : 'strong'}
      badge={entry.count > 1 ? entry.count : null}
      stacked={entry.count > 1}
    />
  );
}
