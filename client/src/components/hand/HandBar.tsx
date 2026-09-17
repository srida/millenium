// Main du joueur, en cartes 3D (`components/ui/Card3D`) dans les deux
// dispositions. Les emplacements ne changent pas :
//
// **Portrait** : un ÉVENTAIL, à la place de l'ancienne bande (`bottom-14`).
// **Web** (écran plus large que haut) : une PILE à deux colonnes dans le rail
// de gauche, à la place de l'ancienne grille. La bande occupée est celle du
// cimetière au pixel près (WEB_RAIL_BAND, `./rail.ts`), qui porte aussi la
// largeur réservée par le cadrage caméra via WEB_RAIL_PX.
//
// Jamais de défilement, dans aucune des deux : `./cardFan` resserre le pas puis
// réduit la taille — 28 cartes tiennent sur un téléphone de 390 px, 42 dans un
// rail. Toute la main se voit d'un coup.
//
// ⚠️ Il n'y a plus de cadre autour de l'éventail en portrait : un rectangle
// bordé serré autour de cartes inclinées qui se recouvrent rognait l'arc à
// l'œil.
//
// ⚠️ Les deux rails du mode web sont TRANSPARENTS — leur titre les nomme, et
// c'est tout ce qui les habille (`./rail.ts` dit pourquoi).
//
// ⚠️ Ce fichier ne décide RIEN : visibilité, état visuel et intention de tap
// viennent de `./handVisual` (pur, testé), la place de `./cardFan` (pur, testé).
import { useGameStore, type HandEntry } from '../../stores/gameStore.js';
import { useWebLayout } from '../system/useWebLayout.js';
import { useElementSize } from '../system/useElementSize.js';
import { WEB_RAIL_BAND, WEB_RAIL_PAD_LEFT, ZONE_LABEL, ZONE_LABEL_PORTRAIT } from './rail.js';
import { handVisible, handTargetable, handCardVisual, handTapIntent } from './handVisual.js';
import { fanLayout, railLayout, type CardTransform, type LayoutResult } from './cardFan.js';
import Card3D, { cardVisualProps } from '../ui/Card3D.js';
import { RAIL_COLUMNS, RAIL_GAP_X, railCardWidth } from './railGeometry.js';

/** Largeur nominale d'une carte de main en portrait, en px — la hauteur s'en
 *  déduit par le `aspect-ratio: 5/7`, et l'éventail réduit l'échelle quand la
 *  main s'allonge. */
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
  const [bandRef, band] = useElementSize<HTMLDivElement>();
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

  const cardWidth = web ? railCardWidth(band.width) : HAND_CARD_WIDTH;
  const layout: LayoutResult = web
    ? railLayout({ count: hand.length, width: band.width, height: band.height, cardWidth, columns: RAIL_COLUMNS, gapX: RAIL_GAP_X })
    : fanLayout({ count: hand.length, width: band.width, cardWidth });

  const cards = hand.map((entry, i) => layout.cards[i] && (
    <HandCard3D
      key={entry.key}
      entry={entry}
      targeting={targetingHand}
      targetable={handTargetable(handTargets, entry.idx)}
      transform={layout.cards[i]}
      width={cardWidth}
      rail={web}
    />
  ));

  if (web) {
    return (
      <div className={`${WEB_RAIL_BAND} left-0 ${visible ? '' : 'pointer-events-none opacity-0'}`}>
        <div className={`flex h-full flex-col ${WEB_RAIL_PAD_LEFT}`}>
          <div className={`mb-1 shrink-0 ${ZONE_LABEL}`}>MAIN</div>
          {/* ⚠️ `min-h-0` : sans lui, un enfant de colonne flex refuse de
              descendre sous sa hauteur de contenu, et la mesure rendrait la
              hauteur VOULUE au lieu de la hauteur DISPONIBLE. */}
          <div ref={bandRef} className="card3d-layer min-h-0 flex-1">
            {visible && hand.length === 0 && <span className="block px-2 py-6 text-center text-xs text-white/40">Main vide</span>}
            {visible && cards}
          </div>
        </div>
      </div>
    );
  }

  return (
    // ⚠️ La bande reste MONTÉE quand la main est masquée, et n'est que vidée :
    // la démonter remettrait sa mesure à zéro, et l'éventail rejaillirait d'une
    // main vide à chaque ouverture de tour.
    <div className={`absolute inset-x-0 bottom-14 z-20 ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <div
        ref={bandRef}
        className="card3d-layer mx-2 flex items-center justify-center"
        style={{ height: visible && hand.length ? layout.boundsHeight : undefined }}
      >
        {/* La zone se NOMME en portrait comme elle se nomme en rail : c'était la
            seule des deux dispositions où rien ne disait ce qu'on regardait. */}
        {visible && <span className={ZONE_LABEL_PORTRAIT}>MAIN</span>}
        {visible && hand.length === 0 && <span className="px-2 py-6 text-xs text-white/40">Main vide</span>}
        {visible && cards}
      </div>
    </div>
  );
}

function HandCard3D({ entry, targeting, targetable, transform, width, rail }: {
  entry: HandEntry; targeting: boolean; targetable: boolean;
  transform: CardTransform; width: number; rail: boolean;
}) {
  const controller = useGameStore(s => s.controller)!;
  const ctx = { targeting, targetable, rail };
  const visual = handCardVisual(entry, ctx);
  const intent = handTapIntent(entry, ctx);

  return (
    <Card3D
      {...cardVisualProps(entry.card)}
      transform={transform}
      width={width}
      // tap → sélection d'invocation ; en ciblage de magie, la carte est la
      // cible (une carte injouable l'est tout autant : c'est même souvent
      // celle qu'on veut envoyer au cimetière ou brûler).
      onTap={() => {
        switch (intent.kind) {
          case 'magie_target': controller.resolveMagieHandTarget(entry.idx); break;
          case 'select':       controller.selectCard(entry.card, entry.idx); break;
          case 'deselect':     controller.selectCard(null, null); break;
          case 'none':         break;
        }
      }}
      // ⚠️ Le glisser n'écrit AUCUNE règle : il appelle `selectCard` en partant
      // et `onCellTap` en arrivant — les deux points d'entrée du tap. Donc les
      // mêmes surlignages de cases valides, le même menu de conditions
      // multiples, la même case imposée par une recette à un matériel.
      //
      // ⚠️ Et une carte à MATÉRIAUX se glisse comme les autres : la case lâchée
      // est RETENUE (`GameController._reserveCell`), le joueur désigne ensuite
      // ses matériaux et l'unité se pose là. Rien de tout ça n'est écrit ici.
      //
      // Absent en CIBLAGE de magie : la carte y est une cible à désigner, pas
      // une unité à poser — le geste redevient alors un tap annulé.
      onDragBegin={targeting ? undefined : () => {
        // Ne pas re-sélectionner une carte déjà retenue : `selectCard` vide les
        // matériaux, et le joueur qui reprend sa carte perdrait ses choix.
        if (!entry.selected) controller.selectCard(entry.card, entry.idx);
        // Une carte à plusieurs conditions ouvre un menu : le glisser n'a plus
        // d'objet, c'est la modale qui prend la main.
        return !useGameStore.getState().summonOptions;
      }}
      // Le repère de la case survolée — le seul retour que le glisser ait sur le
      // plateau. Il ne passe par aucun état React : `hoverCellAt` écrit dans la
      // scène, qui n'en repeint ses tuiles que lorsque la case CHANGE.
      onDragMove={targeting ? undefined : (x, y) => controller.hoverCellAt(x, y)}
      onDrop={targeting ? undefined : (x, y) => {
        controller.clearHoverCell();
        const cell = controller.cellAtScreen(x, y);
        // Lâchée hors du plateau : la carte revient, et la SÉLECTION reste —
        // le joueur peut enchaîner par un tap de case.
        if (cell) controller.onCellTap(cell);
      }}
      highlight={visual.highlight}
      // La carte retenue sort de sa bande : vers le haut en portrait, vers le
      // board (droite) quand la main est un rail vertical.
      lift={visual.lift}
      dim={visual.dim}
      badge={visual.badge}
      stacked={visual.stacked}
      raised={visual.lift !== 'none'}
      rail={rail ? 'left' : null}
    />
  );
}
