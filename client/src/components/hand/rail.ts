// Bande verticale des deux rails du mode web (main à gauche, neutralisées à
// droite) : même haut, même bas, même largeur pour les deux — la seule chose
// qui les distingue est le côté auquel ils se collent.
//
// Elle est ici et non recopiée dans chaque composant parce que c'est justement
// leur DÉSACCORD qui se voyait : la main partait de `top-14` et le cimetière de
// `top-28`, si bien que le rail de gauche flottait un cran au-dessus du bloc
// joueur (centré verticalement en web, cf. `_cameraFraming`) et de son
// symétrique de droite. Deux rails de même taille encadrent le board ; un rail
// plus haut que l'autre se lit comme un défaut d'alignement.
//
// `top-28` dégage la barre de PV du HUD (`top-0`, ~56 px) sans venir la lécher,
// `bottom-14` la barre de phase (`bottom-0`, pleine largeur — elle
// intercepterait les taps malgré son fond transparent).
//
// ⚠️ **Les deux rails du mode web sont TRANSPARENTS, et ce qui les nomme est
// leur seul TITRE.** Ils portaient chacun un cadre teinté (jaune pour la main,
// rouge pour les neutralisées) : sur un téléphone en paysage, ces deux pavés de
// couleur encadraient le plateau en permanence, alors que ce qu'il faut lire
// dans un rail — le tier — est justement une COULEUR, celle du cadre des
// cartes. Un fond teinté derrière elles leur disputait la seule chose qu'elles
// aient à dire.

// ⚠️ `top-16` et non `top-28` : en paysage sur téléphone, la bande utile ne fait
// que ~220 px, et les deux rails se lisaient posés trop bas — décalés vers le
// bord inférieur de l'écran plutôt qu'en regard du plateau. **64 px est le
// plancher, et il est MESURÉ** : la barre de PV descend exactement à 56 px
// (`Hud`, safe-area comprise), il reste donc 8 px de gouttière. Les 48 px repris
// sur le haut profitent aussi à la capacité des piles.
// ⚠️ Ça ne suffisait pas à soi seul : c'est l'alignement EN HAUT de la pile
// (`cardFan.railLayout`) qui règle le cas d'une main courte, qui flottait au
// milieu de la bande quelle que soit la position de celle-ci.
//
// ⚠️ **Deux largeurs, pas une** : `w-[214px]` sur tablette, `w-[174px]` sur
// téléphone en paysage — c'est la MARGE de bord qui explique l'écart avec
// `WEB_RAIL_TABLET_PX`/`WEB_RAIL_PHONE_PX`. Ces deux constantes
// (`three/constants.ts`, 302/262 px) restent la largeur que le cadrage
// caméra réserve de CHAQUE côté du board — on n'y touche pas ici seul, sinon
// le rail dépasserait le board sans que la caméra ne lui laisse la place
// (les deux bougent ENSEMBLE, cf. `three/constants.ts` : plus de lisibilité
// pour les cartes de main/cimetière, quitte à réduire un peu le board — et
// sur téléphone en paysage, où le conteneur est bien plus étroit, la
// tablette écraserait le board contre le plancher de zoom). Mais le rail
// lui-même ne colle pas au bord VRAI de l'écran (`left-0`/`right-0`) : `Hud`
// et `PhaseControls` dégagent tous deux ce bord d'un `px-22` (5.5rem/88 px)
// fixe — la même marge que toutes les pages en mode web — et un rail flush
// contre l'écran ne s'accordait plus avec eux, en paysage téléphone où cette
// marge tombe sur l'encoche/le coin arrondi de l'appareil. Le rail se décale
// donc du MÊME `px-22` (`WEB_RAIL_OFFSET_LEFT`/`RIGHT`, ci-dessous) et
// RÉTRÉCIT d'autant (302/262 px − 88 px = 214/174 px) pour que son bord côté
// board reste exactement à 302/262 px du bord vrai — les valeurs que
// `webRailPxFor` réserve, inchangées. Le choix entre les deux suit
// `useTabletLayout` (`components/system/useWebLayout.ts`), même seuil que
// `TABLET_BREAKPOINT_PX` côté caméra. `railCardWidth` dérive déjà la taille
// des cartes de la largeur MESURÉE du rail, donc rien à recalculer ailleurs
// pour ce changement de largeur.
// ⚠️ `3.5rem` + la safe area, pas `bottom-14` nu : `PhaseControls` (bottom-0)
// grandit de `env(safe-area-inset-bottom)` en PWA installée (home indicator,
// barre de navigation gestuelle) — sans le report, les rails se posent sous
// la barre de phase agrandie.
const WEB_RAIL_BOTTOM = 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]';
export const WEB_RAIL_BAND_TABLET = `pointer-events-auto absolute ${WEB_RAIL_BOTTOM} top-16 z-20 w-[214px]`;
export const WEB_RAIL_BAND_PHONE = `pointer-events-auto absolute ${WEB_RAIL_BOTTOM} top-16 z-20 w-[174px]`;

export function webRailBand(isTablet: boolean): string {
  return isTablet ? WEB_RAIL_BAND_TABLET : WEB_RAIL_BAND_PHONE;
}

export const WEB_RAIL_OFFSET_LEFT = 'left-22';
export const WEB_RAIL_OFFSET_RIGHT = 'right-22';

/**
 * Le TITRE d'une zone — celui des rails du mode web ET celui des bandes du
 * portrait, écrit une seule fois.
 *
 * ⚠️ **Un titre, et rien d'autre** : pas de cadre, pas de fond teinté. C'est la
 * règle des rails (plus haut) et elle vaut à l'identique en portrait — ce qu'il
 * faut lire dans une carte est une COULEUR (celle de son cadre, donc son tier),
 * et un fond derrière elle la lui dispute.
 */
export const ZONE_LABEL = 'text-[9px] tracking-widest text-white/45';

/**
 * En portrait, le titre n'a pas de ligne à lui : la bande de la main et la
 * rangée du cimetière se touchent presque (3 px d'écart), donc rien ne peut se
 * poser AU-DESSUS d'elles. Il se pose DANS la bande, au coin haut-gauche, et il
 * est déclaré AVANT les cartes : celles-ci portent `z-index: var(--card-z)` à
 * partir de 0, donc à z égal c'est l'ordre du DOM qui tranche et une main qui
 * s'allonge recouvre son propre titre — ce qui est le bon arbitrage, les cartes
 * disent alors d'elles-mêmes de quelle zone il s'agit.
 */
export const ZONE_LABEL_PORTRAIT = `pointer-events-none absolute left-1 top-0 z-0 ${ZONE_LABEL}`;
