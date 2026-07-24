// Chebyshev distance (8-directional king's distance)
export function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

export function manhattanDistance(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/**
 * BFS from `from` to `to`.
 * Neutralized units do not block movement.
 * The destination cell may be occupied (by the target enemy).
 * Returns array of positions to walk (excluding start, including destination),
 * or null if unreachable.
 */
export function findPath(board, from, to) {
  const key = p => `${p.col},${p.row}`;
  const visited = new Set([key(from)]);
  const queue = [{ pos: from, path: [] }];

  while (queue.length > 0) {
    const { pos, path } = queue.shift();

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
export function stepToward(board, from, to) {
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
export function stepTowardOrNearest(board, from, to) {
  const step = stepToward(board, from, to);
  if (step !== null) {
    const occ = board.getUnit(step);
    if (!occ || occ.is_neutralized) return step;
  }
  // No path or first step is occupied: find the free neighbor closest to target
  let best = null, bestDist = Infinity;
  for (const n of board.getNeighbors(from)) {
    const occupant = board.getUnit(n);
    if (occupant && !occupant.is_neutralized) continue;
    const d = manhattanDistance(n, to);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return best;
}

/**
 * Find the closest enemy to `unit` among `enemies`.
 * Returns { unit, distance } or null.
 */
export function findClosestEnemy(unit, enemies) {
  let best = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    if (!e.isAlive()) continue;
    const d = manhattanDistance(unit.position, e.position);
    if (d < bestDist) { bestDist = d; best = e; }
  }
  return best ? { unit: best, distance: bestDist } : null;
}

/**
 * Returns true if `attacker` can attack `target` given its range.
 * All units use Manhattan distance (cardinal directions only).
 */
export function isInAttackRange(attacker, target) {
  return manhattanDistance(attacker.position, target.position) <= attacker.range;
}

/**
 * Bresenham line-of-sight check: returns false if any blocked cell lies
 * on the straight line between `from` and `to` (endpoints excluded).
 */
export function hasLineOfSight(board, from, to) {
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
export function canAttack(attacker, target, board = null) {
  return isInAttackRange(attacker, target) && hasLineOfSight(board, attacker.position, target.position);
}

/**
 * Find the best attack target for `unit` among `enemies`.
 * Prefers targets with line of sight when a board is provided.
 * Returns { unit, distance } or null.
 */
export function findAttackTarget(unit, enemies, board = null) {
  const alive = enemies.filter(e => e.isAlive());
  // Prefer targets with line of sight; fall back to all alive if none have LOS
  const losAlive = board ? alive.filter(e => hasLineOfSight(board, unit.position, e.position)) : alive;
  const pool = losAlive.length > 0 ? losAlive : alive;

  let best = null, bestDist = Infinity;
  for (const e of pool) {
    const d = manhattanDistance(unit.position, e.position);
    if (d < bestDist) { bestDist = d; best = e; }
  }
  return best ? { unit: best, distance: bestDist } : null;
}
