// La géométrie commune aux DEUX rails du mode web.
//
// Elle est ici pour la même raison que `rail.ts` porte leur bande : c'est leur
// DÉSACCORD qui se voit. Deux rails symétriques encadrent le board ; des cartes
// plus larges à gauche qu'à droite se lisent comme un défaut d'alignement, et
// rien dans aucun des deux fichiers ne l'aurait dit.
//
// **Deux colonnes**, comme la grille qu'ils remplacent.

export const RAIL_COLUMNS = 2;
/** Gouttière entre les deux colonnes, en px. */
export const RAIL_GAP_X = 6;

/**
 * La largeur d'une carte de rail, déduite de la largeur mesurée.
 *
 * ⚠️ On la DÉRIVE au lieu de la fixer : le rail fait `w-52` moins ses marges et
 * son rembourrage, soit une valeur qu'aucun des deux fichiers ne connaît
 * vraiment. Une constante en dur aurait été juste le jour où elle a été écrite.
 */
export function railCardWidth(railWidth: number): number {
  if (railWidth <= 0) return 0;
  return Math.max(1, (railWidth - RAIL_GAP_X * (RAIL_COLUMNS - 1)) / RAIL_COLUMNS);
}
