import { Unit } from './Unit.js';
import { tiersForRound } from './Draw.js';
import { matchesMaterial, materialLineageMatches } from './InvocationManager.js';

const HAND_SIZE = 5;

/**
 * EnemyAI
 * Draws from the enemy deck each round and places units on rows 7–10
 * using the same summon rules as the player (normal, sacrifice, fusion,
 * heritage, transformation). Graveyard units (neutralized last combat) are
 * available as materials during the preparation phase.
 */
export class EnemyAI {
  /**
   * @param {Object} deck   - { "1": [cardId, ...], ..., "5": [...] }
   * @param {CardDatabase} cardDb - must already be initialised
   * @param {'player'|'enemy'} side - which board side this AI plays (default 'enemy')
   */
  constructor(deck, cardDb, side = 'enemy') {
    this._deck = deck;
    this._cardDb = cardDb;
    this._side = side;
    this._hand = [];
  }

  /**
   * Draw HAND_SIZE cards from the deck for the given round's eligible tiers.
   * Stored internally; call placeFromHand() to place them.
   * @param {number} round
   * @returns {Object[]} drawn cards
   */
  drawHand(round) {
    const tiers = tiersForRound(round);
    const pool = [];
    for (const t of tiers) {
      for (const id of (this._deck[String(t)] ?? [])) {
        const card = this._cardDb.getCard(id);
        if (card) pool.push(card);
      }
    }
    if (pool.length === 0) { this._hand = []; return []; }
    const hand = [];
    for (let i = 0; i < HAND_SIZE; i++) {
      hand.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    this._hand = hand;
    return [...hand];
  }

  /**
   * Place cards from the hand on enemy cells, respecting all summon rules.
   * Uses multi-pass: normal cards first so they are available as materials
   * for fusion / heritage / transformation in later passes.
   * Graveyard units (neutralized last round, already off-board) are consumed
   * in-place when used as material.
   * @param {Board} board
   * @param {number} maxUnits
   * @param {Unit[]} graveyard - mutated: consumed units are spliced out
   * @returns {Unit[]} placed units
   */
  placeFromHand(board, maxUnits = 5, graveyard = []) {
    let unplaced = [...this._hand];
    const placed = [];

    for (;;) {
      const before = placed.length;
      const remaining = [];

      // Sort each pass: normal cards first so they are on board as materials.
      const sorted = [...unplaced].sort(
        (a, b) => _summonPriority(a) - _summonPriority(b)
      );

      for (const card of sorted) {
        const unit = _tryPlace(card, board, maxUnits, graveyard, this._side);
        if (unit) placed.push(unit);
        else remaining.push(card);
      }

      unplaced = remaining;
      if (placed.length === before || unplaced.length === 0) break;
    }

    this._hand = unplaced;
    return placed;
  }

  /** Cards not placed — used for damage multiplier calculation. */
  getHand() {
    return this._hand;
  }

  /**
   * Rearrange all living enemy units on the board by role:
   *   - Low range (melee/tanks) → front rows (7–8, closest to neutral zone)
   *   - High range (ranged)     → back rows (9–10)
   *   Within each group, highest HP goes furthest forward.
   * Enforces maxUnits cap (excess units are dropped).
   * Updates initial_position so units return here after combat.
   * @param {Board} board
   * @param {number} maxUnits
   */
  rearrangeUnits(board, maxUnits = 5) {
    const units = board.getLivingUnitsOnSide(this._side);
    if (units.length === 0) return;

    for (const u of units) board.removeUnit(u);

    const sorted = [...units].sort((a, b) => {
      if (a.range !== b.range) return a.range - b.range; // lower range → front
      return b.max_hp - a.max_hp;                        // higher HP → front within group
    });

    const toPlace = sorted.slice(0, maxUnits);

    const melee  = toPlace.filter(u => u.range <= 1);
    const ranged = toPlace.filter(u => u.range > 1);

    // Column order: centre-out so units are never bunched at one edge
    const COL = [2, 1, 3, 0, 4];

    // Front row = closest to the neutral zone (row 7 for enemy, row 3 for player).
    // Enemy rows grow downward from the front (7→9); player rows grow upward (3→1).
    const frontRow = this._side === 'player' ? 3 : 7;
    const rowStep  = this._side === 'player' ? -1 : 1;
    const meleeFrontRow  = frontRow;
    const rangedFrontRow = melee.length > 0 ? frontRow + rowStep * 2 : frontRow + rowStep;

    // Assign positions for a group: max 3 per row, then spill into the next row back.
    const assign = (group, startRow) =>
      group.map((u, i) => ({
        unit: u,
        pos: { col: COL[i % 5], row: startRow + rowStep * Math.floor(i / 3) },
      }));

    const placements = [
      ...assign(melee, meleeFrontRow),
      ...assign(ranged, rangedFrontRow),
    ];

    for (const { unit, pos } of placements) {
      unit.initial_position = null; // reset so placeUnit assigns the new cell
      board.placeUnit(unit, pos);
    }
  }

  /** Damage multiplier formula, based on units on the board at start of combat (symmetric with player). */
  computeMultiplier(unitCount) {
    if (unitCount >= 5) return 1.0;
    if (unitCount === 4) return 1.2;
    if (unitCount === 3) return 1.5;
    if (unitCount === 2) return 2.0;
    return 3.0; // 0 or 1 unit on the board
  }
}

// ── Placement helpers ─────────────────────────────────────────────────────────

/**
 * Try to place a single card on the enemy board.
 * graveyard is mutated in-place when units are consumed as materials.
 * Returns the placed Unit on success, null otherwise.
 */
function _tryPlace(card, board, maxUnits, graveyard, side = 'enemy') {
  // Cards with multiple invocation options: prefer transformation, then try each in order
  if (Array.isArray(card.summon_options) && card.summon_options.length > 0) {
    const sorted = [...card.summon_options].sort((a, b) =>
      a.summon_type === 'transformation' ? -1 : b.summon_type === 'transformation' ? 1 : 0
    );
    for (const opt of sorted) {
      const variant = { ...card, summon_type: opt.summon_type, cost: opt.cost };
      delete variant.summon_options; // avoid re-entering this branch → infinite recursion
      const result = _tryPlace(variant, board, maxUnits, graveyard, side);
      if (result) return result;
    }
    return null;
  }

  const onBoard = board.getLivingUnitsOnSide(side).length;

  switch (card.summon_type) {
    case 'normal': {
      if (onBoard >= maxUnits) return null;
      // Pas de doublon (même card_id) sur le terrain, comme pour le joueur
      if (board.getLivingUnitsOnSide(side).some(u => u.card_id === card.id)) return null;
      const cells = _freeCells(board, side);
      if (cells.length === 0) return null;
      const unit = new Unit(card, side);
      board.placeUnit(unit, cells[0]);
      return unit;
    }

    case 'sacrifice': {
      const needed = card.cost?.sacrifice ?? 0;
      if (needed === 0) {
        if (onBoard >= maxUnits) return null;
        const cells = _freeCells(board, side);
        if (cells.length === 0) return null;
        const unit = new Unit(card, side);
        board.placeUnit(unit, cells[0]);
        return unit;
      }
      const boardUnits = board.getLivingUnitsOnSide(side);
      if (boardUnits.length + graveyard.length < needed) return null;
      // If the result card is already on board, that unit must be consumed as a sacrifice material
      const duplicate = boardUnits.find(u => u.card_id === card.id);
      let fromBoard, fromGraveCount;
      if (duplicate) {
        const otherBoard = boardUnits.filter(u => u !== duplicate);
        const stillNeeded = needed - 1;
        fromGraveCount = Math.min(stillNeeded, graveyard.length);
        const fromBoardCount = stillNeeded - fromGraveCount;
        if (fromBoardCount > otherBoard.length) return null;
        fromBoard = [...otherBoard.slice(0, fromBoardCount), duplicate];
      } else {
        fromGraveCount = Math.min(needed, graveyard.length);
        fromBoard = boardUnits.slice(0, needed - fromGraveCount);
      }
      // Net board change: -fromBoard.length + 1
      if (onBoard - fromBoard.length + 1 > maxUnits) return null;
      graveyard.splice(0, fromGraveCount);
      for (const u of fromBoard) board.removeUnit(u);
      const unit = new Unit(card, side);
      board.placeUnit(unit, _freeCells(board, side)[0]);
      return unit;
    }

    case 'fusion': {
      const materials = card.cost?.materials ?? [];
      if (materials.length === 0) {
        if (onBoard >= maxUnits) return null;
        const cells = _freeCells(board, side);
        if (cells.length === 0) return null;
        const unit = new Unit(card, side);
        board.placeUnit(unit, cells[0]);
        return unit;
      }
      // Find each required material on board first, then in graveyard
      const boardPool = [...board.getLivingUnitsOnSide(side)];
      const gravePool = [...graveyard];
      const usedBoard = [];
      const usedGrave = [];
      for (const matId of materials) {
        let idx = boardPool.findIndex(u => materialLineageMatches(u, matId, materials));
        if (idx !== -1) {
          usedBoard.push(boardPool[idx]);
          boardPool.splice(idx, 1);
        } else {
          idx = gravePool.findIndex(u => materialLineageMatches(u, matId, materials));
          if (idx !== -1) {
            usedGrave.push(gravePool[idx]);
            gravePool.splice(idx, 1);
          } else {
            return null; // missing material
          }
        }
      }
      // Net board change: -usedBoard.length + 1
      if (onBoard - usedBoard.length + 1 > maxUnits) return null;
      for (const u of usedBoard) board.removeUnit(u);
      for (const u of usedGrave) {
        const gi = graveyard.indexOf(u);
        if (gi !== -1) graveyard.splice(gi, 1);
      }
      const unit = new Unit(card, side);
      board.placeUnit(unit, _freeCells(board, side)[0]);
      return unit;
    }

    case 'heritage': {
      const required = card.cost?.materials ?? [];
      const sacrifice = card.cost?.sacrifice ?? 0;
      if (sacrifice === 0 && required.length === 0) {
        if (onBoard >= maxUnits) return null;
        const cells = _freeCells(board, side);
        if (cells.length === 0) return null;
        const unit = new Unit(card, side);
        board.placeUnit(unit, cells[0]);
        return unit;
      }
      const boardPool = [...board.getLivingUnitsOnSide(side)];
      const gravePool = [...graveyard];
      if (boardPool.length + gravePool.length < sacrifice) return null;

      const toConsumeBoard = [];
      const toConsumeGrave = [];

      // Satisfy explicit material constraints first (board priority, then graveyard)
      for (const matId of required) {
        let idx = boardPool.findIndex(u => matchesMaterial(u, matId));
        if (idx !== -1) {
          toConsumeBoard.push(boardPool[idx]);
          boardPool.splice(idx, 1);
        } else {
          idx = gravePool.findIndex(u => matchesMaterial(u, matId));
          if (idx !== -1) {
            toConsumeGrave.push(gravePool[idx]);
            gravePool.splice(idx, 1);
          } else {
            return null; // constraint unsatisfiable
          }
        }
      }

      // Fill remaining sacrifice slots — prefer graveyard over board
      let stillNeeded = sacrifice - toConsumeBoard.length - toConsumeGrave.length;
      for (const u of gravePool.slice(0, stillNeeded)) {
        toConsumeGrave.push(u);
        stillNeeded--;
      }
      for (const u of boardPool.slice(0, stillNeeded)) {
        toConsumeBoard.push(u);
      }

      // Net board change: -toConsumeBoard.length + 1
      if (onBoard - toConsumeBoard.length + 1 > maxUnits) return null;

      for (const u of toConsumeBoard) board.removeUnit(u);
      for (const u of toConsumeGrave) {
        const gi = graveyard.indexOf(u);
        if (gi !== -1) graveyard.splice(gi, 1);
      }
      const unit = new Unit(card, side);
      board.placeUnit(unit, _freeCells(board, side)[0]);
      return unit;
    }

    case 'transformation': {
      const targetId = card.cost?.materials?.[0];
      if (!targetId) return null;

      const boardUnits = board.getLivingUnitsOnSide(side);
      // If result already on board, that copy must be consumed as the transformation material.
      // If it doesn't match targetId, the transformation would create a duplicate — invalid.
      const existingResult = boardUnits.find(u => u.card_id === card.id);
      if (existingResult) {
        if (!materialLineageMatches(existingResult, targetId, [targetId])) return null;
        const pos = { ...existingResult.position };
        board.removeUnit(existingResult);
        const unit = new Unit(card, side);
        board.placeUnit(unit, pos);
        return unit;
      }

      // Board target: 1-for-1, no slot limit check
      const boardTarget = boardUnits.find(u => materialLineageMatches(u, targetId, [targetId]));
      if (boardTarget) {
        const pos = { ...boardTarget.position };
        board.removeUnit(boardTarget);
        const unit = new Unit(card, side);
        board.placeUnit(unit, pos);
        return unit;
      }

      // Graveyard target: net +1 on board, need a free slot
      const graveIdx = graveyard.findIndex(u => materialLineageMatches(u, targetId, [targetId]));
      if (graveIdx !== -1) {
        if (onBoard >= maxUnits) return null;
        const cells = _freeCells(board, side);
        if (cells.length === 0) return null;
        graveyard.splice(graveIdx, 1);
        const unit = new Unit(card, side);
        board.placeUnit(unit, cells[0]);
        return unit;
      }

      return null;
    }

    default:
      return null;
  }
}

// Normal cards placed first so they are on board as materials for later passes
function _summonPriority(card) {
  const order = { normal: 0, transformation: 1, fusion: 2, heritage: 3, sacrifice: 4 };
  return order[card.summon_type] ?? 5;
}

function _freeCells(board, side = 'enemy') {
  const [rowStart, rowEnd] = side === 'player' ? [0, 3] : [7, 10];
  const cells = [];
  for (let row = rowStart; row <= rowEnd; row++)
    for (let col = 0; col < 5; col++)
      if (!board.isOccupied({ col, row })) cells.push({ col, row });
  return cells;
}

