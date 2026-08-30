// Le repère PARTAGÉ des deux clients d'un duel — le seul module qui sache
// traduire une rangée d'un camp à l'autre.
//
// Chaque client joue toujours dans SON repère local : ses unités en rows 0–3,
// l'adversaire en 7–10. Le monde du rôle B est donc le reflet de celui de A
// autour de la rangée centrale, et toute donnée POSITIONNELLE qui traverse le
// réseau doit passer par `mirrorRow` — c'est déjà ce que fait le placement des
// unités adverses (`net/PvpOpponentProvider`).
//
// ⚠️ Le terrain est POSITIONNEL lui aussi, et c'est ce qu'on a longtemps oublié :
// `blocked_cells` était appliqué VERBATIM des deux côtés, si bien qu'une case
// bloquée décrite en rangée 4 était voisine du camp de A chez A, et voisine du
// camp de B chez B. Les deux clients ne simulaient plus le même plateau : ligne
// de vue et contournement BFS divergeaient dès les premiers ticks, sans qu'aucun
// message réseau ne soit en cause. Mesuré sur un vrai duel (BOARD_013) : la
// première divergence tombe au tick 10.
//
// Le module est PUR et sans import : `logic/` reste headless, et `net/` comme
// `game/` peuvent s'en servir sans faire entrer quoi que ce soit dans leur
// graphe de modules.

/** Rangée la plus haute du plateau (Board.rows - 1) — l'axe du miroir est ROWS/2. */
export const MIRROR_AXIS = 10;

/** row → row miroir. Involutive : `mirrorRow(mirrorRow(r)) === r`. */
export function mirrorRow(row: number): number {
  return MIRROR_AXIS - row;
}

/**
 * Miroite un ensemble de cases. ⚠️ La colonne ne se miroite PAS — les deux
 * clients partagent le même axe de colonnes, seul l'axe des rangées s'inverse.
 */
export function mirrorCells<T extends { col: number; row: number }>(
  cells: readonly T[] | null | undefined,
): { col: number; row: number }[] {
  return (cells ?? []).map(c => ({ col: c.col, row: mirrorRow(c.row) }));
}

/**
 * La rangée d'une case dans le repère de RÉFÉRENCE (celui du rôle A), depuis
 * une rangée locale.
 *
 * C'est la primitive de tout ce qui doit être *ordonné* de la même façon des
 * deux côtés : balayage du plateau, énumération des voisins d'une case. Les
 * deux clients ne peuvent pas s'accorder sur « la rangée la plus petite » —
 * elles sont inversées — mais ils s'accordent tous les deux sur « la rangée la
 * plus petite VUE DU RÔLE A ».
 */
export function referenceRow(row: number, mirrored: boolean): number {
  return mirrored ? mirrorRow(row) : row;
}

/**
 * Un terrain est « symétrique » quand son ensemble de cases bloquées est
 * invariant par le miroir — les deux joueurs y affrontent alors la même
 * géographie.
 *
 * ⚠️ Ce n'est PAS ce qui garantit le déterminisme : c'est `mirrorCells` au
 * moment de l'application qui le fait, et il le fait pour tous les terrains, y
 * compris ceux qui ne sont pas symétriques. Le prédicat ne sert qu'à
 * l'ÉQUITÉ — le signaler en admin, ou préférer un terrain symétrique en duel.
 * Les confondre a coûté cher : le log de duel nommait « terrain non symétrique »
 * une panne dont la symétrie n'était qu'un cache-misère (7 terrains sur 14 la
 * violent, les 7 autres masquaient le bug).
 */
export function isMirrorSymmetric(
  cells: readonly { col: number; row: number }[] | null | undefined,
): boolean {
  const key = (c: { col: number; row: number }) => `${c.col},${c.row}`;
  const set = new Set((cells ?? []).map(key));
  return mirrorCells(cells).every(c => set.has(key(c)));
}
