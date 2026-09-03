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
  const shopping = useGameStore(s => s.shopping);
  const controller = useGameStore(s => s.controller);
  // Ouverture de tour : la popup de pioche RÉVÈLE la main, elle ne la pioche
  // pas — `session.hand` porte déjà les cartes du tour dès `startPreparation()`.
  // Sans cette garde, la bande affichait les noms/illustrations en dessous de
  // la popup avant même le tap : exactement le spoil qu'elle existe pour
  // éviter. La main réapparaît au même instant que le tap ferme la popup
  // (`dismissDrawPopup`), après le vol des dos.
  const roundIntro = useGameStore(s => s.roundIntro);
  const drawPopup = useGameStore(s => s.drawPopup);
  const web = useWebLayout();
  // Visible pendant la préparation OU pendant un ciblage de MAIN
  // (`hand_to_graveyard`, `duplicate_card`…) — même règle que le cimetière, qui
  // reste montré pour le ciblage revive. On ne lit que `awaitingTarget` : une
  // magie de main de plus n'a rien à rebrancher ici.
  const targetingHand = shopping?.awaitingTarget === 'hand';
  // ⚠️ Toutes les magies de main n'acceptent pas toutes les cartes :
  // `shift_tier_card` veut un tier voisin dans le deck, `draw_material` une
  // carte À MATÉRIELS. `null` = pas de restriction, le cas des trois autres.
  // La liste est calculée par la session, jamais ici : le HUD montre la règle,
  // il ne la tient pas (`GameController.resolveMagieHandTarget` la revérifie).
  const handTargets = shopping?.handTargets ?? null;
  const isTarget = (idx: number) => !handTargets || handTargets.includes(idx);
  if ((combatActive && !targetingHand) || !controller) return null;
  if (roundIntro || drawPopup) return null;

  const empty = hand.length === 0 && <span className="col-span-2 px-2 py-6 text-xs text-white/40">Main vide</span>;

  if (web) {
    return (
      <div className={`${WEB_RAIL_BAND} left-0`}>
        <div className="mx-2 flex max-h-full flex-col rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-1.5">
          <div className="mb-1 shrink-0 text-[9px] tracking-widest text-white/40">MAIN</div>
          <div className="grid grid-cols-2 content-start justify-items-center gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {empty}
            {hand.map(entry => (
              <HandCard key={entry.key} entry={entry} targeting={targetingHand} targetable={isTarget(entry.idx)} rail />
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
            <HandCard key={entry.key} entry={entry} targeting={targetingHand} targetable={isTarget(entry.idx)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HandCard({ entry, targeting = false, targetable = true, rail = false }:
  { entry: HandEntry; targeting?: boolean; targetable?: boolean; rail?: boolean }) {
  const controller = useGameStore(s => s.controller)!;
  // En ciblage, « candidate » veut dire tapable : une carte que la magie ne
  // peut pas servir s'éteint au lieu de se laisser choisir pour rien.
  const candidate = targeting && targetable;

  return (
    <CardTile
      {...cardTileProps(entry.card)}
      // tap → sélection d'invocation ; en ciblage de magie, la carte est la
      // cible (une carte injouable l'est tout autant : c'est même souvent
      // celle qu'on veut envoyer au cimetière ou brûler).
      onTap={() => {
        if (targeting) { if (candidate) controller.resolveMagieHandTarget(entry.idx); return; }
        controller.selectCard(entry.selected ? null : entry.card, entry.selected ? null : entry.idx);
      }}
      highlight={candidate ? 'candidate' : entry.selected && !targeting ? 'selected' : 'none'}
      // La carte sélectionnée sort de la bande : vers le haut en bas d'écran,
      // vers le board (droite) quand la main est un rail vertical.
      lift={entry.selected && !targeting ? (rail ? 'right' : 'up') : 'none'}
      dim={targeting ? (candidate ? 'none' : 'strong') : (entry.playable ? 'none' : 'strong')}
      badge={entry.count > 1 ? entry.count : null}
      stacked={entry.count > 1}
    />
  );
}
