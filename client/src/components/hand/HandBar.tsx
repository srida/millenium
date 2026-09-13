// Main du joueur.
//
// **Portrait** : un ÉVENTAIL de cartes en relief (`components/ui/Card3D`), posé
// à la place exacte de l'ancienne bande (`bottom-14`). La géométrie vient de
// `./cardFan` — pas resserré puis taille réduite, jamais de défilement : toute
// la main se voit d'un coup (28 cartes tiennent sur un téléphone de 390 px).
//
// ⚠️ Il n'y a plus de cadre autour de l'éventail en portrait. Un rectangle
// bordé serré autour de cartes inclinées et qui se recouvrent rognait l'arc à
// l'œil, et c'était le seul élément d'interface qui disait « bande » là où le
// geste dit « main tenue ». Le cadre reste en mode web, où les cartes sont
// rangées en grille.
//
// **Mode web** (écran plus large que haut) : inchangé pour l'instant — panneau
// encadré à deux colonnes collé à gauche, vignettes 2D. La bande occupée est
// celle du cimetière au pixel près (WEB_RAIL_BAND, `./rail.ts`), qui porte aussi
// la largeur réservée par le cadrage caméra via WEB_RAIL_PX.
//
// ⚠️ Ce fichier ne décide RIEN : visibilité, état visuel et intention de tap
// viennent de `./handVisual` (pur, testé), la place de `./cardFan` (pur, testé).
import { useGameStore, type HandEntry } from '../../stores/gameStore.js';
import { useWebLayout } from '../system/useWebLayout.js';
import { useElementWidth } from '../system/useElementWidth.js';
import { WEB_RAIL_BAND } from './rail.js';
import { handVisible, handTargetable, handCardVisual, handTapIntent } from './handVisual.js';
import { fanLayout, type CardTransform } from './cardFan.js';
import CardTile, { cardTileProps } from '../ui/CardTile.js';
import Card3D from '../ui/Card3D.js';

/** Largeur nominale d'une carte de main, en px — la hauteur s'en déduit par le
 *  `aspect-ratio: 5/7`, et l'éventail réduit l'échelle quand la main s'allonge. */
const HAND_CARD_WIDTH = 84;

export default function HandBar() {
  const hand = useGameStore(s => s.hand);
  const combatActive = useGameStore(s => s.combatActive);
  const shopping = useGameStore(s => s.shopping);
  const controller = useGameStore(s => s.controller);
  // Ouverture de tour : la popup de pioche RÉVÈLE la main, elle ne la pioche
  // pas — `session.hand` porte déjà les cartes du tour dès `startPreparation()`.
  const roundIntro = useGameStore(s => s.roundIntro);
  const drawPopup = useGameStore(s => s.drawPopup);
  const web = useWebLayout();
  const [bandRef, bandWidth] = useElementWidth<HTMLDivElement>();
  // Visible pendant la préparation OU pendant un ciblage de MAIN
  // (`hand_to_graveyard`, `duplicate_card`…) — même règle que le cimetière, qui
  // reste montré pour le ciblage revive.
  const targetingHand = shopping?.awaitingTarget === 'hand';
  // ⚠️ Toutes les magies de main n'acceptent pas toutes les cartes :
  // `shift_tier_card` veut un tier voisin dans le deck, `draw_material` une
  // carte À MATÉRIELS. `null` = pas de restriction, le cas des trois autres.
  // La liste est calculée par la session, jamais ici : le HUD montre la règle,
  // il ne la tient pas (`GameController.resolveMagieHandTarget` la revérifie).
  const handTargets = shopping?.handTargets ?? null;

  const visible = handVisible({
    hasController: !!controller, combatActive, targetingHand,
    roundIntro: !!roundIntro, drawPopup: !!drawPopup,
  });

  const layout = fanLayout({ count: hand.length, width: bandWidth, cardWidth: HAND_CARD_WIDTH });
  const empty = <span className="px-2 py-6 text-xs text-white/40">Main vide</span>;

  if (!visible) {
    // ⚠️ La bande reste MONTÉE pour garder sa mesure : la démonter remettrait la
    // largeur à zéro, et l'éventail rejaillirait d'une main vide à chaque
    // ouverture de tour. Elle est seulement vidée et rendue intraversable.
    return <div ref={bandRef} className="pointer-events-none absolute inset-x-0 bottom-14 z-20 mx-2 h-0" />;
  }

  if (web) {
    return (
      <div className={`${WEB_RAIL_BAND} left-0`}>
        <div className="mx-2 flex max-h-full flex-col rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-1.5">
          <div className="mb-1 shrink-0 text-[9px] tracking-widest text-white/40">MAIN</div>
          <div className="grid grid-cols-2 content-start justify-items-center gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {hand.length === 0 && <span className="col-span-2 px-2 py-6 text-xs text-white/40">Main vide</span>}
            {hand.map(entry => (
              <HandTile key={entry.key} entry={entry} targeting={targetingHand}
                targetable={handTargetable(handTargets, entry.idx)} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-14 z-20">
      <div
        ref={bandRef}
        className="card3d-layer mx-2 flex items-center justify-center"
        style={{ height: hand.length ? layout.boundsHeight : undefined }}
      >
        {hand.length === 0 && empty}
        {hand.map((entry, i) => layout.cards[i] && (
          <HandCard3D key={entry.key} entry={entry} targeting={targetingHand}
            targetable={handTargetable(handTargets, entry.idx)}
            transform={layout.cards[i]} />
        ))}
      </div>
    </div>
  );
}

/** Le tap d'une carte de main, quel que soit son rendu. */
function tapHandCard(entry: HandEntry, targeting: boolean, targetable: boolean): () => void {
  const controller = useGameStore.getState().controller!;
  const intent = handTapIntent(entry, { targeting, targetable, rail: false });
  return () => {
    switch (intent.kind) {
      case 'magie_target': controller.resolveMagieHandTarget(entry.idx); break;
      case 'select':       controller.selectCard(entry.card, entry.idx); break;
      case 'deselect':     controller.selectCard(null, null); break;
      case 'none':         break;
    }
  };
}

function HandCard3D({ entry, targeting, targetable, transform }:
  { entry: HandEntry; targeting: boolean; targetable: boolean; transform: CardTransform }) {
  const visual = handCardVisual(entry, { targeting, targetable, rail: false });
  return (
    <Card3D
      {...cardTileProps(entry.card)}
      transform={transform}
      width={HAND_CARD_WIDTH}
      onTap={tapHandCard(entry, targeting, targetable)}
      highlight={visual.highlight}
      lift={visual.lift}
      dim={visual.dim}
      badge={visual.badge}
      stacked={visual.stacked}
      raised={visual.lift !== 'none'}
    />
  );
}

/** Vignette 2D — le rail du mode web, jusqu'à sa reprise. */
function HandTile({ entry, targeting, targetable }:
  { entry: HandEntry; targeting: boolean; targetable: boolean }) {
  const visual = handCardVisual(entry, { targeting, targetable, rail: true });
  return (
    <CardTile
      {...cardTileProps(entry.card)}
      onTap={tapHandCard(entry, targeting, targetable)}
      highlight={visual.highlight}
      lift={visual.lift}
      dim={visual.dim}
      badge={visual.badge}
      stacked={visual.stacked}
    />
  );
}
