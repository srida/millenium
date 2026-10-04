import type { Position, TargetPolicy } from './types.js';
import type { Board } from './Board.js';
import type { Unit } from './Unit.js';

// Chebyshev distance (8-directional king's distance)
export function chebyshevDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/**
 * BFS from `from` to `to`.
 * Neutralized units do not block movement.
 * The destination cell may be occupied (by the target enemy).
 * Returns array of positions to walk (excluding start, including destination),
 * or null if unreachable.
 */
function findPath(board: Board, from: Position, to: Position): Position[] | null {
  const key = (p: Position) => `${p.col},${p.row}`;
  const visited = new Set([key(from)]);
  const queue: { pos: Position; path: Position[] }[] = [{ pos: from, path: [] }];

  while (queue.length > 0) {
    const { pos, path } = queue.shift() as { pos: Position; path: Position[] };

    for (const next of board.getNeighbors(pos)) {
      const k = key(next);
      if (visited.has(k)) continue;
      visited.add(k);

      const isGoal = next.col === to.col && next.row === to.row;
      if (!isGoal) {
        const occupant = board.getUnit(next);
        // Block on living units (except destination)
        if (occupant && !occupant.is_neutralized) continue;
      }

      const newPath = [...path, next];
      if (isGoal) return newPath;
      queue.push({ pos: next, path: newPath });
    }
  }
  return null;
}

/**
 * Returns the best adjacent cell to step toward `to` from `from`.
 * Used when we only want to move one cell closer.
 */
export function stepToward(board: Board, from: Position, to: Position): Position | null {
  const path = findPath(board, from, to);
  if (!path || path.length === 0) return null;
  return path[0]; // first step of the path
}

/**
 * Like stepToward, but if the target is unreachable or the next step lands on
 * an occupied cell (e.g. adjacent enemy with no LOS), falls back to the free
 * neighbor of `from` that minimizes Manhattan distance to `to`.
 * Never returns an occupied cell. Returns null only if all neighbors are blocked/occupied.
 */
export function stepTowardOrNearest(board: Board, from: Position, to: Position): Position | null {
  const step = stepToward(board, from, to);
  if (step !== null) {
    const occ = board.getUnit(step);
    if (!occ || occ.is_neutralized) return step;
  }
  // No path or first step is occupied: find the free neighbor closest to target
  let best: Position | null = null, bestDist = Infinity;
  for (const n of board.getNeighbors(from)) {
    const occupant = board.getUnit(n);
    if (occupant && !occupant.is_neutralized) continue;
    const d = manhattanDistance(n, to);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return best;
}

/**
 * Free neighbour of `from` that maximises the Manhattan distance to
 * `awayFrom` — the flee step of the **Insaisissable** keyword.
 *
 * Returns null when no neighbour improves on the distance already held at
 * `from` (cornered, or every free cell is a dead end): the unit stays put
 * rather than closing the gap on its own.
 *
 * ⚠️ Ties keep `board.getNeighbors`' own order, the reference-frame
 * enumerator every other cell-picker in this file relies on (`stepToward`,
 * `stepTowardOrNearest`) — the same determinism guarantee, applied to moving
 * away instead of toward. A body left on the board (`is_neutralized`) does not
 * block the flee, exactly like it does not block the BFS above.
 */
export function stepAway(board: Board, from: Position, awayFrom: Position): Position | null {
  const currentDist = manhattanDistance(from, awayFrom);
  let best: Position | null = null, bestDist = currentDist;
  for (const n of board.getNeighbors(from)) {
    const occupant = board.getUnit(n);
    if (occupant && !occupant.is_neutralized) continue;
    const d = manhattanDistance(n, awayFrom);
    if (d > bestDist) { bestDist = d; best = n; }
  }
  return best;
}

/**
 * Find the closest enemy to `unit` among `enemies`.
 * Returns { unit, distance } or null.
 */
export function findClosestEnemy(unit: Unit, enemies: Unit[]): { unit: Unit; distance: number } | null {
  let best: Unit | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    if (!e.isAlive()) continue;
    const d = manhattanDistance(unit.position as Position, e.position as Position);
    if (d < bestDist) { bestDist = d; best = e; }
  }
  return best ? { unit: best, distance: bestDist } : null;
}

/**
 * Returns true if `attacker` can attack `target` given its range.
 * All units use Manhattan distance (cardinal directions only).
 */
export function isInAttackRange(attacker: Unit, target: Unit): boolean {
  return manhattanDistance(attacker.position as Position, target.position as Position) <= attacker.range;
}

/**
 * Bresenham line-of-sight check: returns false if any blocked cell lies
 * on the straight line between `from` and `to` (endpoints excluded).
 */
export function hasLineOfSight(board: Board | null | undefined, from: Position, to: Position): boolean {
  if (!board || (board._blockedCells.size === 0 && board._temporaryBlockedCells.size === 0)) return true;
  let x = from.col, y = from.row;
  const x1 = to.col, y1 = to.row;
  const dx = Math.abs(x1 - x), dy = Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
  let err = dx - dy;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
    if (x === x1 && y === y1) break; // reached target — don't check it
    if (board.isBlocked({ col: x, row: y })) return false;
  }
  return true;
}

/**
 * Returns true if `attacker` is in range AND has line of sight to `target`.
 */
export function canAttack(attacker: Unit, target: Unit, board: Board | null = null): boolean {
  return isInAttackRange(attacker, target) && hasLineOfSight(board, attacker.position as Position, target.position as Position);
}

/**
 * Find the best attack target for `unit` among `enemies`, under `policy`.
 *
 * `plus_proche` (the default) is the historical rule, unchanged to the bit:
 * prefer targets with line of sight, then the closest in Manhattan, first of the
 * array on a tie. Changing it would move every combat (sim goldens, PvP net).
 *
 * The three keyword policies (Tireur d'élite, Chasseur, Briseur) first look at
 * the ATTACKABLE candidates (range + line of sight) and pick the best of them by
 * the policy — so an attack is never lost because the preferred target is out
 * of reach. With nothing attackable, `plus_loin_a_portee` falls back to the
 * default, while the two GLOBAL policies pick their prey in the whole pool
 * (line of sight first, like the default): that is the unit phase 3 walks to.
 *
 * Returns { unit, distance } or null.
 */
export function findAttackTarget(unit: Unit, enemies: Unit[], board: Board | null = null, policy: TargetPolicy = 'plus_proche'): { unit: Unit; distance: number } | null {
  const alive = enemies.filter(e => e.isAlive());
  const from = unit.position as Position;
  if (policy !== 'plus_proche') {
    const attackable = alive.filter(e => canAttack(unit, e, board));
    if (attackable.length > 0 || isGlobalPolicy(policy)) {
      const losAlive = board ? alive.filter(e => hasLineOfSight(board, from, e.position as Position)) : alive;
      const pool = attackable.length > 0 ? attackable : (losAlive.length > 0 ? losAlive : alive);
      const best = bestByPolicy(from, pool, board, policy);
      return best ? { unit: best, distance: manhattanDistance(from, best.position as Position) } : null;
    }
  }
  // Prefer targets with line of sight; fall back to all alive if none have LOS
  const losAlive = board ? alive.filter(e => hasLineOfSight(board, from, e.position as Position)) : alive;
  const pool = losAlive.length > 0 ? losAlive : alive;

  let best: Unit | null = null, bestDist = Infinity;
  for (const e of pool) {
    const d = manhattanDistance(from, e.position as Position);
    if (d < bestDist) { bestDist = d; best = e; }
  }
  return best ? { unit: best, distance: bestDist } : null;
}

/**
 * Les politiques qui choisissent leur cible PARTOUT sur le plateau (Chasseur,
 * Briseur) : l'unité marche vers elle, au lieu de marcher vers la plus proche.
 */
export function isGlobalPolicy(policy: TargetPolicy): boolean {
  return policy === 'pv_bas' || policy === 'pv_max_haut';
}

/**
 * Le rang d'une case dans le repère de RÉFÉRENCE : la colonne, puis la place de
 * la rangée dans `board.rowScan()`. La même valeur pour la même case physique
 * sur les deux clients d'un duel — là où `row` seul est miroité.
 */
export function referenceCellRank(board: Board | null, pos: Position): number {
  const rows = board?.rows ?? 11;
  const rank = board?.mirroredFrame ? rows - 1 - pos.row : pos.row;
  return pos.col * rows + rank;
}

/**
 * Le départage de toute politique hors défaut, une fois sa métrique à égalité :
 * Manhattan croissante depuis `from`, puis `card_id`, puis la case dans le
 * repère de référence.
 *
 * ⚠️ `card_id` ne suffit pas : deux exemplaires d'une carte Multiple, ou deux
 * tokens, le partagent dans un même camp. Jamais l'ordre d'un tableau d'unités.
 */
export function compareTieBreak(from: Position, board: Board | null, a: Unit, b: Unit): number {
  return manhattanDistance(from, a.position as Position) - manhattanDistance(from, b.position as Position)
    || a.card_id.localeCompare(b.card_id)
    || referenceCellRank(board, a.position as Position) - referenceCellRank(board, b.position as Position);
}

/** La métrique d'une politique, plus petite = meilleure. */
function policyMetric(policy: TargetPolicy, from: Position, u: Unit): number {
  switch (policy) {
    case 'plus_loin_a_portee': return -manhattanDistance(from, u.position as Position);
    // `current_hp` absolu, bouclier exclu — comme POWER_HEAL et `_teleportPlan`.
    case 'pv_bas': return u.current_hp;
    case 'pv_max_haut': return -u.max_hp;
    default: return manhattanDistance(from, u.position as Position);
  }
}

/** `pool` trié par la politique, puis par `compareTieBreak` — une copie. */
export function sortByPolicy(from: Position, pool: Unit[], board: Board | null, policy: TargetPolicy): Unit[] {
  return [...pool].sort((a, b) =>
    policyMetric(policy, from, a) - policyMetric(policy, from, b) || compareTieBreak(from, board, a, b));
}

function bestByPolicy(from: Position, pool: Unit[], board: Board | null, policy: TargetPolicy): Unit | null {
  return pool.length > 0 ? sortByPolicy(from, pool, board, policy)[0] : null;
}
