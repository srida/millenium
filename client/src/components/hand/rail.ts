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
// intercepterait les taps malgré son fond transparent), et `w-52` doit rester
// synchronisé avec WEB_RAIL_PX (`three/constants.ts`), la largeur que le
// cadrage caméra réserve de chaque côté du board.
//
// ⚠️ **Les deux rails du mode web sont TRANSPARENTS, et ce qui les nomme est
// leur seul TITRE.** Ils portaient chacun un cadre teinté (jaune pour la main,
// rouge pour les neutralisées) : sur un téléphone en paysage, ces deux pavés de
// couleur encadraient le plateau en permanence, alors que ce qu'il faut lire
// dans un rail — le tier — est justement une COULEUR, celle du cadre des
// cartes. Un fond teinté derrière elles leur disputait la seule chose qu'elles
// aient à dire.

// ⚠️ `top-20` et non `top-28` : en paysage sur téléphone, la bande utile ne fait
// que ~220 px, et la pile étant CENTRÉE verticalement dans ce qui reste sous le
// titre, les deux rails se lisaient posés trop bas — décalés vers le bord
// inférieur de l'écran plutôt qu'en regard du plateau. Les 32 px repris sur le
// haut dégagent toujours la barre de PV (~56 px) et profitent aussi à la
// capacité des piles.
export const WEB_RAIL_BAND = 'pointer-events-auto absolute bottom-14 top-20 z-20 w-52';

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
