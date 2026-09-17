// Cimetière : unités neutralisées, disponibles comme matériaux d'invocation et
// cibles de la magie revive. Cartes 3D dans les deux dispositions, aux mêmes
// emplacements qu'avant :
//
// **Portrait** : une RANGÉE PLATE au-dessus de la main (`bottom-44`).
// **Web** : une PILE à deux colonnes dans le rail de droite, strictement
// symétrique de celui de la main (WEB_RAIL_BAND, `./rail.ts`).
//
// ⚠️ La rangée du portrait est PLATE (`arc: 0`), là où la main s'ouvre en
// éventail. Une main s'ouvre parce qu'on la TIENT ; un cimetière est une rangée
// de corps posés. Leur donner le même geste ferait lire le second comme une
// seconde main — alors que ces cartes ne se jouent pas, elles se dépensent.
//
// ⚠️ Les deux rails du mode web sont TRANSPARENTS — leur titre les nomme, et
// c'est tout ce qui les habille (`./rail.ts` dit pourquoi).
//
// ⚠️ Comme la main, il ne décide rien : `./handVisual` porte la visibilité,
// l'état visuel et l'intention de tap ; `./cardFan` la place.
import { useGameStore, type GraveyardEntry } from '../../stores/gameStore.js';
import { useWebLayout } from '../system/useWebLayout.js';
import { useElementSize } from '../system/useElementSize.js';
import { WEB_RAIL_BAND, WEB_RAIL_PAD_RIGHT, ZONE_LABEL, ZONE_LABEL_PORTRAIT } from './rail.js';
import { graveyardVisible, graveyardCardVisual, graveyardTapIntent } from './handVisual.js';
import { fanLayout, railLayout, type CardTransform, type LayoutResult } from './cardFan.js';
import Card3D from '../ui/Card3D.js';
import { artFor } from '../../data/CardArt.js';
import { RAIL_COLUMNS, RAIL_GAP_X, railCardWidth } from './railGeometry.js';

/** Largeur nominale d'une carte de cimetière en portrait — plus petite que
 *  celle de la main : ce sont des matériaux, pas des cartes à jouer. */
const GRAVE_CARD_WIDTH = 54;

export default function GraveyardTray() {
  const graveyard = useGameStore(s => s.graveyard);
  const combatActive = useGameStore(s => s.combatActive);
  const shopping = useGameStore(s => s.shopping);
  const controller = useGameStore(s => s.controller);
  const web = useWebLayout();
  const [bandRef, band] = useElementSize<HTMLDivElement>();
  // Visible pendant la préparation (matériaux) OU pendant un ciblage revive.
  const targetingGraveyard = shopping?.awaitingTarget === 'graveyard';

  const visible = graveyardVisible({
    hasController: !!controller, combatActive, targetingGraveyard, count: graveyard.length,
  });

  const cardWidth = web ? railCardWidth(band.width) : GRAVE_CARD_WIDTH;
  const layout: LayoutResult = web
    ? railLayout({ count: graveyard.length, width: band.width, height: band.height, cardWidth, columns: RAIL_COLUMNS, gapX: RAIL_GAP_X })
    : fanLayout({ count: graveyard.length, width: band.width, cardWidth, arc: 0 });

  const cards = graveyard.map((entry, i) => layout.cards[i] && (
    <GraveCard3D
      key={entry.uid}
      entry={entry}
      targeting={targetingGraveyard}
      transform={layout.cards[i]}
      width={cardWidth}
      rail={web}
    />
  ));

  if (web) {
    return (
      <div className={`${WEB_RAIL_BAND} right-0 ${visible ? '' : 'pointer-events-none opacity-0'}`}>
        <div className={`flex h-full flex-col ${WEB_RAIL_PAD_RIGHT}`}>
          <div className={`mb-1 shrink-0 ${ZONE_LABEL}`}>NEUTRALISÉES</div>
          {/* `min-h-0` : cf. `HandBar` — sans lui la mesure rend la hauteur
              VOULUE et non la hauteur DISPONIBLE. */}
          <div ref={bandRef} className="card3d-layer min-h-0 flex-1">{visible && cards}</div>
        </div>
      </div>
    );
  }

  return (
    // Montée en permanence pour garder sa mesure, vidée quand il n'y a rien —
    // même geste que la main.
    <div className={`absolute inset-x-0 bottom-44 z-20 ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <div
        ref={bandRef}
        className="card3d-layer mx-2 flex items-center justify-center"
        style={{ height: visible && graveyard.length ? layout.boundsHeight : undefined }}
      >
        {/* Cf. `HandBar` : la zone se nomme dans les deux dispositions. */}
        {visible && <span className={ZONE_LABEL_PORTRAIT}>NEUTRALISÉES</span>}
        {visible && cards}
      </div>
    </div>
  );
}

function GraveCard3D({ entry, targeting, transform, width, rail }: {
  entry: GraveyardEntry; targeting: boolean; transform: CardTransform; width: number; rail: boolean;
}) {
  const controller = useGameStore(s => s.controller)!;
  const visual = graveyardCardVisual(entry, { targeting });
  const intent = graveyardTapIntent({ targeting });

  return (
    <Card3D
      illustrationId={artFor(entry.unit.card_id, entry.unit.side)}
      name={entry.unit.name}
      showName={false}
      // ⚠️ Le tier de l'unité, et pas `null` : sur la carte 3D le CADRE est la
      // couleur du tier, donc une carte sans tier prendrait le cadre de repli
      // — toutes les neutralisées sortiraient du même bleu. La vignette 2D
      // pouvait s'en passer, elle n'avait pas de cadre à colorer.
      tiers={entry.unit.tier != null ? [entry.unit.tier] : null}
      transform={transform}
      width={width}
      rail={rail ? 'right' : null}
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
