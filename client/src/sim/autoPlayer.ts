// Auto-joueur — tient le siège du JOUEUR pendant la phase de préparation.
//
// ⚠️ Il ne passe QUE par l'API publique de `GameSession` (`isPlayable`,
// `needsMaterials`, `materialsComplete`, `materialCandidate*`, `validCells`,
// `place`), donc par `InvocationManager` et `InvocationRules` — le code que le
// jeu exécute quand un joueur pose une carte. Aucune règle n'est réimplémentée
// ici, et c'est tout l'intérêt : `EnemyAI`, elle, tient sa PROPRE copie des
// règles de placement dans un `switch` de deux cents lignes (elle y refait le
// doublon, le compte de slots, la sélection de matériaux). Deux copies
// aujourd'hui d'accord ne le resteront pas, et une simulation d'équilibrage qui
// mesurerait la copie plutôt que l'original mesurerait le mauvais jeu.
//
// La politique elle-même est délibérément simple et DÉTERMINISTE : elle ne doit
// pas devenir un joueur expert (ce qui mesurerait le pilote plutôt que les
// cartes), seulement un joueur compétent et constant, identique d'un run à
// l'autre. Le hasard de la partie vit dans la pioche, pas ici.
import type { GameSession } from '../logic/GameSession.js';
import type { Card, Position } from '../logic/types.js';
import type { Unit } from '../logic/Unit.js';
import { summonCost } from '../logic/InvocationManager.js';

/** Ordre d'essai des cartes, repris de `EnemyAI._summonPriority` : les moins
 *  chères d'abord, parce qu'une fois posées elles deviennent les matériaux des
 *  suivantes — et une carte sans condition ne coûte rien. */
const summonOrder = (card: Card): number => summonCost(card);

/** Colonnes du centre vers les bords — mêmes que `EnemyAI.rearrangeUnits`. */
const COLS = [2, 1, 3, 0, 4];
/** Mêlée devant (rangée 3 = au contact de la zone neutre), distance derrière. */
const MELEE_ROWS = [3, 2, 1, 0];
const RANGED_ROWS = [1, 0, 2, 3];

/** Un candidat matériau se choisit par le plus FAIBLE : on ne jette pas une
 *  grosse unité en pâture à une fusion quand une petite fait l'affaire. */
function materialCost(u: Unit): number {
  return (u.atk ?? 0) * 20 + (u.current_hp ?? 0);
}

/** Les conditions à essayer pour une carte, dans l'ordre — la moins chère
 *  d'abord. Rend des INDEX et non des cartes reconstruites : la carte n'a plus
 *  à être aplatie, toute l'API de `GameSession` prend un `conditionIndex`. */
function conditionOrder(card: Card): (number | null)[] {
  const conditions = card.summon_conditions ?? [];
  if (conditions.length === 0) return [null];
  return conditions
    .map((c, index) => ({ cost: Math.max(0, c.materials ?? 0), index }))
    .sort((a, b) => a.cost - b.cost)
    .map(e => e.index);
}

/**
 * Sélection gloutonne des matériaux. Rend `null` quand la voie ne peut pas être
 * complétée — la carte est alors simplement laissée en main, exactement comme
 * un joueur qui ne peut pas payer.
 *
 * Le cimetière est servi EN PREMIER : ses unités sont déjà hors jeu, les
 * consommer ne coûte aucune unité vivante.
 */
function selectMaterials(session: GameSession, card: Card, conditionIndex: number | null): Unit[] | null {
  if (!session.needsMaterials(card, conditionIndex)) return [];
  const mats: Unit[] = [];
  for (let guard = 0; guard < 12; guard++) {
    if (session.materialsComplete(card, mats, conditionIndex)) return mats;
    const fromGrave = session.materialCandidateGraveyard(card, mats, conditionIndex);
    const fromBoard = session.materialCandidateCells(card, mats, conditionIndex)
      .map((p: Position) => session.board.getUnit(p))
      .filter((u): u is Unit => !!u);
    const pool = fromGrave.length > 0 ? fromGrave : fromBoard;
    if (pool.length === 0) return null;
    // Tri stable et total : le coût, puis l'uid — deux unités de coût égal ne
    // doivent pas dépendre de l'ordre de parcours du board.
    pool.sort((a, b) => materialCost(a) - materialCost(b) || a.uid - b.uid);
    mats.push(pool[0]);
  }
  return session.materialsComplete(card, mats, conditionIndex) ? mats : null;
}

/** La meilleure case parmi celles autorisées : mêlée devant, distance derrière,
 *  centre avant les bords. Une transformation n'en a qu'une, le tri est alors
 *  sans effet. */
function bestCell(cells: Position[], card: Card): Position {
  const rows = (card.stats?.range ?? 1) > 1 ? RANGED_ROWS : MELEE_ROWS;
  let best = cells[0];
  let bestScore = Infinity;
  for (const cell of cells) {
    const r = rows.indexOf(cell.row);
    const c = COLS.indexOf(cell.col);
    const score = (r === -1 ? 9 : r) * 10 + (c === -1 ? 9 : c);
    if (score < bestScore) { bestScore = score; best = cell; }
  }
  return best;
}

/**
 * Joue toute la phase de préparation : pose ce qui peut l'être, en boucle,
 * jusqu'à ce qu'un tour complet de la main ne pose plus rien.
 *
 * @returns les unités posées ce tour-ci.
 */
export function playPreparation(session: GameSession): Unit[] {
  const placed: Unit[] = [];

  // Chaque pose mute `session.hand` (splice) : les index glissent. On relance
  // donc le balayage depuis le début après chaque succès, plutôt que de tenir
  // une comptabilité d'index qui serait le premier endroit à casser.
  for (let sweep = 0; sweep < 40; sweep++) {
    const entries = session.hand
      .map((card, idx) => ({ card, idx }))
      .sort((a, b) => summonOrder(a.card) - summonOrder(b.card) || a.idx - b.idx);

    let progressed = false;
    for (const { card, idx } of entries) {
      if (!session.isPlayable(card)) continue;
      for (const conditionIndex of conditionOrder(card)) {
        const mats = selectMaterials(session, card, conditionIndex);
        if (mats === null) continue;
        const cells = session.validCells(card, mats, conditionIndex);
        if (cells.length === 0) continue;
        const unit = session.place(card, bestCell(cells, card), mats, idx, conditionIndex);
        if (unit) { placed.push(unit); progressed = true; break; }
      }
      if (progressed) break;
    }
    if (!progressed) break;
  }

  return placed;
}
