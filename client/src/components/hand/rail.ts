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
export const WEB_RAIL_BAND = 'pointer-events-auto absolute bottom-14 top-28 z-20 w-52';
