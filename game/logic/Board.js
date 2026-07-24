export class Board {
  constructor() {
    this.cols = 5;
    this.rows = 11; // rows 0–3 player, 4–6 neutral, 7–10 enemy
    this.grid = this._emptyGrid();
    this._blockedCells = new Set();
    // Temporary blocks (e.g. POWER_FREEZE), separate from the permanent terrain
    // blocks: key "col,row" → the combat step at which the freeze expires.
    this._temporaryBlockedCells = new Map();
  }

  _emptyGrid() {
    return Array.from({ length: this.cols }, () => Array(this.rows).fill(null));
  }

  // --- Placement ---

  placeUnit(unit, pos) {
    if (!this.isInBounds(pos)) throw new Error(`Out of bounds: ${JSON.stringify(pos)}`);
    if (this.grid[pos.col][pos.row]) throw new Error(`Cell occupied at ${JSON.stringify(pos)}`);
    this.grid[pos.col][pos.row] = unit;
    unit.position = { col: pos.col, row: pos.row };
    if (!unit.initial_position) unit.initial_position = { col: pos.col, row: pos.row };
  }

  moveUnit(unit, to) {
    const from = unit.position;
    if (from) this.grid[from.col][from.row] = null;
    this.grid[to.col][to.row] = unit;
    unit.position = { col: to.col, row: to.row };
  }

  removeUnit(unit) {
    const pos = unit.position;
    if (pos && this.grid[pos.col]?.[pos.row] === unit) {
      this.grid[pos.col][pos.row] = null;
    }
  }

  // --- Queries ---

  getUnit(pos) {
    if (!this.isInBounds(pos)) return null;
    return this.grid[pos.col][pos.row];
  }

  isOccupied(pos) {
    return this.getUnit(pos) !== null;
  }

  isInBounds(pos) {
    return pos.col >= 0 && pos.col < this.cols && pos.row >= 0 && pos.row < this.rows;
  }

  isPlayerCell(pos)  { return pos.row >= 0 && pos.row <= 3; }
  isNeutralCell(pos) { return pos.row >= 4 && pos.row <= 6; }
  isEnemyCell(pos)   { return pos.row >= 7 && pos.row <= 10; }

  getUnitsOnSide(side) {
    const units = [];
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        if (this.grid[c][r]?.side === side) units.push(this.grid[c][r]);
    return units;
  }

  getAllUnits() {
    const units = [];
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        if (this.grid[c][r]) units.push(this.grid[c][r]);
    return units;
  }

  getLivingUnitsOnSide(side) {
    return this.getUnitsOnSide(side).filter(u => u.isAlive());
  }

  // Blocked cells (rows 4–6 neutral zone)
  setBlockedCells(cells) {
    this._blockedCells = new Set((cells || []).map(c => `${c.col},${c.row}`));
    this._temporaryBlockedCells = new Map();
  }

  isBlocked(pos) {
    const key = `${pos.col},${pos.row}`;
    return this._blockedCells.has(key) || this._temporaryBlockedCells.has(key);
  }

  clearBlockedCells() {
    this._blockedCells = new Set();
    this._temporaryBlockedCells = new Map();
  }

  // Temporarily blocks a cell (POWER_FREEZE) until `expiresAtStep` (a
  // CombatManager._stepCount value, purged via purgeExpiredTemporaryBlocks).
  setTemporaryBlock(pos, expiresAtStep) {
    this._temporaryBlockedCells.set(`${pos.col},${pos.row}`, expiresAtStep);
  }

  // Only one frozen cell (POWER_FREEZE) should exist at a time — a new ice
  // block replaces the previous one rather than stacking.
  clearTemporaryBlocks() {
    this._temporaryBlockedCells = new Map();
  }

  purgeExpiredTemporaryBlocks(currentStep) {
    for (const [key, expiresAtStep] of this._temporaryBlockedCells) {
      if (currentStep >= expiresAtStep) this._temporaryBlockedCells.delete(key);
    }
  }

  // Neighbours (4-directional) within bounds, excluding blocked cells
  getNeighbors(pos) {
    return [
      { col: pos.col - 1, row: pos.row },
      { col: pos.col + 1, row: pos.row },
      { col: pos.col, row: pos.row - 1 },
      { col: pos.col, row: pos.row + 1 },
    ].filter(p => this.isInBounds(p) && !this.isBlocked(p));
  }

  // Rebuild grid from a unit list (after combat cleanup)
  rebuild(units) {
    this.grid = this._emptyGrid();
    for (const u of units) {
      if (u.position && this.isInBounds(u.position)) {
        this.grid[u.position.col][u.position.row] = u;
      }
    }
  }

  // Returns first empty cell on player side (row 0–3), column-by-column
  firstEmptyPlayerCell() {
    for (let r = 0; r <= 3; r++)
      for (let c = 0; c < this.cols; c++)
        if (!this.grid[c][r]) return { col: c, row: r };
    return null;
  }

  firstEmptyEnemyCell() {
    for (let r = 7; r <= 10; r++)
      for (let c = 0; c < this.cols; c++)
        if (!this.grid[c][r]) return { col: c, row: r };
    return null;
  }
}
