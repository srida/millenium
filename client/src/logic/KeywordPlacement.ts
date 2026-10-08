// Où poser une unité qui porte un mot-clé des familles 1 et 2.
//
// ⚠️ Le seul endroit qui répond à cette question : l'IA (`EnemyAI.rearrangeUnits`)
// et l'auto-joueur de la simulation (`sim/autoPlayer.bestCell`) y passent tous
// les deux. Deux copies finiraient par ne plus placer pareil, et la simulation
// mesurerait alors un autre placement que celui de l'adversaire réel.
//
// ⚠️ Une unité SANS ces mots-clés n'est jamais touchée : `placementKeyword` rend
// `null`, et les deux appelants gardent leur placement historique au bit près.
// C'est ce qui laisse inchangés les goldens de `sim.test.ts` et la ligne de base
// de la simulation tant qu'aucune carte ne porte ces mots-clés.
//
// Chasseur et Briseur n'ont pas de placement propre : ils marchent vers leur
// proie où qu'elle soit, leur case de départ ne change rien à la règle.
import type { Position } from './types.js';
import type { Board } from './Board.js';
import { manhattanDistance } from './PathFinder.js';

export type PlacementKeyword = 'tank' | 'garde_du_corps' | 'embusque' | 'flanc' | 'tireur_elite';

/**
 * L'ordre de lecture quand une unité en porte plusieurs : la famille 2 d'abord
 * (c'est elle qui décide où l'unité VA), dans le rang du moteur
 * (`KEYWORD_POLICIES`), puis Tireur d'élite.
 */
const ORDRE: readonly PlacementKeyword[] = ['tank', 'garde_du_corps', 'embusque', 'flanc', 'tireur_elite'];

/** Attribut → les types d'effet de placement que ses paliers à 1 posent. */
export function indexPlacementKeywords(attributeList: readonly any[] = []): Map<string, Set<PlacementKeyword>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const index = new Map<string, Set<PlacementKeyword>>();
  for (const attr of attributeList) {
    for (const th of attr?.thresholds ?? []) {
      if ((th?.count ?? 1) > 1) continue;
      for (const e of th?.effects ?? []) {
        if (!ORDRE.includes(e?.type)) continue;
        if (!index.has(attr.id)) index.set(attr.id, new Set());
        index.get(attr.id)!.add(e.type);
      }
    }
  }
  return index;
}

/** Le mot-clé de placement d'une unité (ou carte) d'après ses attributs, ou `null`. */
export function placementKeyword(attrIds: readonly string[] | undefined, index: Map<string, Set<PlacementKeyword>>): PlacementKeyword | null {
  if (!attrIds?.length || index.size === 0) return null;
  const portes = new Set<PlacementKeyword>();
  for (const id of attrIds) for (const k of index.get(id) ?? []) portes.add(k);
  return ORDRE.find(k => portes.has(k)) ?? null;
}

/** Ce qu'un camp sait de lui-même pour classer ses cases. */
export interface PlacementContext {
  board: Board;
  /** La rangée au contact de la zone neutre (3 pour le joueur, 7 pour l'IA). */
  frontRow: number;
  /** Le pas vers l'arrière (−1 pour le joueur, +1 pour l'IA). */
  rowStep: number;
  /** Portée de l'unité à placer. */
  range: number;
  /** Garde du corps : l'allié à protéger, déjà posé — `null` s'il n'y en a pas. */
  ward: Position | null;
}

/** Colonnes du centre vers les bords (celles de `rearrangeUnits`), et l'inverse pour Flanc. */
const CENTRE = [2, 1, 3, 0, 4];
const BORDS = [0, 4, 1, 3, 2];

/**
 * Le score d'une case pour ce mot-clé — plus petit = meilleur —, ou `null`
 * quand le mot-clé ne dit rien de la case (Garde du corps sans allié) : le
 * placement par défaut s'applique alors.
 *
 * - **Tireur d'élite** : le plus au fond possible, centre d'abord.
 * - **Tank** : en première ligne, centre d'abord — c'est sa rangée qui retient
 *   ses alliés.
 * - **Embusqué** : en première ligne, face à un couloir libre (aucune case
 *   bloquée dans la zone neutre de sa colonne) — c'est là que l'ennemi entrera
 *   à sa portée.
 * - **Flanc** : sur une colonne de bord, à la profondeur de sa portée.
 * - **Garde du corps** : au plus près de son protégé.
 */
export function keywordCellScore(keyword: PlacementKeyword, cell: Position, ctx: PlacementContext): number | null {
  const depth = (cell.row - ctx.frontRow) * ctx.rowStep; // 0 = front, 3 = fond
  const centre = CENTRE.indexOf(cell.col);
  switch (keyword) {
    case 'tireur_elite':
      return (3 - depth) * 10 + centre;
    case 'tank':
      return depth * 10 + centre;
    case 'embusque': {
      const couloir = [4, 5, 6].some(row => ctx.board.isBlocked({ col: cell.col, row })) ? 1 : 0;
      return depth * 100 + couloir * 10 + centre;
    }
    case 'flanc': {
      const voulu = ctx.range > 1 ? 2 : 0;
      return BORDS.indexOf(cell.col) * 10 + Math.abs(depth - voulu);
    }
    case 'garde_du_corps':
      return ctx.ward ? manhattanDistance(cell, ctx.ward) * 10 + centre : null;
  }
}

/** La meilleure case de `cells` pour ce mot-clé, ou `null` si le mot-clé n'en dit rien. */
export function bestKeywordCell(keyword: PlacementKeyword, cells: readonly Position[], ctx: PlacementContext): Position | null {
  let best: Position | null = null, bestScore = Infinity;
  for (const cell of cells) {
    const score = keywordCellScore(keyword, cell, ctx);
    if (score === null) return null;
    if (score < bestScore) { bestScore = score; best = cell; }
  }
  return best;
}
