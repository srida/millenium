import type { Position, Side } from './types.js';
import type { Unit } from './Unit.js';

export class Board {
  cols: number;
  rows: number;
  grid: (Unit | null)[][];
  _blockedCells: Set<string>;
  // Temporary blocks (e.g. POWER_FREEZE), separate from the permanent terrain
  // blocks: key "col,row" → the combat step at which the freeze expires.
  _temporaryBlockedCells: Map<string, number>;
  /**
   * Ce plateau est-il décrit dans le MIROIR du repère de référence ?
   *
   * Vrai pour le seul rôle B d'un duel en ligne, dont le monde est le reflet de
   * celui de A (`logic/BoardMirror`). Faux partout ailleurs — solo, arcade,
   * tournoi, tutoriel, simulation et rôle A.
   *
   * ⚠️ Il ne change pas ce que le plateau CONTIENT, seulement l'ORDRE dans
   * lequel il l'énumère. Deux ordres qui n'ont pas de sens commun (« la rangée
   * la plus petite » est inversée entre les deux clients) suffisent à faire
   * diverger un combat par ailleurs identique : ils départagent les égalités du
   * choix de cible et du plus court chemin. Cf. `_rowScan` / `getNeighbors`.
   */
  mirroredFrame = false;

  constructor() {
    this.cols = 5;
    this.rows = 11; // rows 0–3 player, 4–6 neutral, 7–10 enemy
    this.grid = this._emptyGrid();
    this._blockedCells = new Set();
    this._temporaryBlockedCells = new Map();
  }

  /**
   * Les rangées dans l'ordre du repère de RÉFÉRENCE : croissantes pour le rôle
   * A, décroissantes pour le rôle B — si bien que les deux clients balaient le
   * plateau physique dans le même sens.
   */
  _rowScan(): number[] {
    const rows = Array.from({ length: this.rows }, (_, r) => r);
    return this.mirroredFrame ? rows.reverse() : rows;
  }

  _emptyGrid(): (Unit | null)[][] {
    return Array.from({ length: this.cols }, () => Array(this.rows).fill(null));
  }

  // --- Placement ---

  placeUnit(unit: Unit, pos: Position): void {
    if (!this.isInBounds(pos)) throw new Error(`Out of bounds: ${JSON.stringify(pos)}`);
    if (this.grid[pos.col][pos.row]) throw new Error(`Cell occupied at ${JSON.stringify(pos)}`);
    this.grid[pos.col][pos.row] = unit;
    unit.position = { col: pos.col, row: pos.row };
    if (!unit.initial_position) unit.initial_position = { col: pos.col, row: pos.row };
  }

  moveUnit(unit: Unit, to: Position): void {
    const from = unit.position;
    if (from) this.grid[from.col][from.row] = null;
    this.grid[to.col][to.row] = unit;
    unit.position = { col: to.col, row: to.row };
  }

  removeUnit(unit: Unit): void {
    const pos = unit.position;
    if (pos && this.grid[pos.col]?.[pos.row] === unit) {
      this.grid[pos.col][pos.row] = null;
    }
  }

  // --- Queries ---

  getUnit(pos: Position): Unit | null {
    if (!this.isInBounds(pos)) return null;
    return this.grid[pos.col][pos.row];
  }

  isOccupied(pos: Position): boolean {
    return this.getUnit(pos) !== null;
  }

  isInBounds(pos: Position): boolean {
    return pos.col >= 0 && pos.col < this.cols && pos.row >= 0 && pos.row < this.rows;
  }

  isPlayerCell(pos: Position): boolean  { return pos.row >= 0 && pos.row <= 3; }
  isNeutralCell(pos: Position): boolean { return pos.row >= 4 && pos.row <= 6; }
  isEnemyCell(pos: Position): boolean   { return pos.row >= 7 && pos.row <= 10; }

  /**
   * ⚠️ L'ORDRE de ce tableau est de la LOGIQUE DE JEU, pas une commodité : il
   * survit tel quel dans `CombatManager.playerUnits` / `enemyUnits` pour toute
   * la durée du combat, et il départage les égalités — la cible retenue par
   * `findAttackTarget` (`d < bestDist`, le premier arrivé gagne), le tri stable
   * par distance de Chebyshev du déplacement, le `reduce` de provocation,
   * `POWER_HEAL`, `_teleportPlan`, et l'ordre des `stat_change` d'attribut.
   *
   * Un balayage à rangée croissante rend donc l'ordre INVERSE d'un client à
   * l'autre en duel : le même camp est en rows 0–3 chez son propriétaire et en
   * 7–10 chez son adversaire. Constaté sur un vrai duel (match `a9c8c4a6`,
   * round 2, tick 85) : à égalité de distance de Chebyshev entre quatre cibles,
   * un client trouvait sa première candidate déjà à portée et ne bougeait pas,
   * l'autre en trouvait une différente et avançait d'une case.
   */
  getUnitsOnSide(side: Side): Unit[] {
    const units: Unit[] = [];
    for (let c = 0; c < this.cols; c++)
      for (const r of this._rowScan())
        if (this.grid[c][r]?.side === side) units.push(this.grid[c][r] as Unit);
    return units;
  }

  getAllUnits(): Unit[] {
    const units: Unit[] = [];
    for (let c = 0; c < this.cols; c++)
      for (const r of this._rowScan())
        if (this.grid[c][r]) units.push(this.grid[c][r] as Unit);
    return units;
  }

  getLivingUnitsOnSide(side: Side): Unit[] {
    return this.getUnitsOnSide(side).filter(u => u.isAlive());
  }

  // Blocked cells (rows 4–6 neutral zone)
  setBlockedCells(cells: Position[] | null | undefined): void {
    this._blockedCells = new Set((cells || []).map(c => `${c.col},${c.row}`));
    this._temporaryBlockedCells = new Map();
  }

  isBlocked(pos: Position): boolean {
    const key = `${pos.col},${pos.row}`;
    return this._blockedCells.has(key) || this._temporaryBlockedCells.has(key);
  }

  /**
   * Les blocages PERMANENTS du terrain, tels qu'ils sont réellement appliqués.
   *
   * ⚠️ C'est la seule lecture juste pour le rendu (les rochers de `Scene3D`) et
   * pour l'enregistreur de duel : en PvP le rôle B applique les cases MIROITÉES
   * (`GameSession.startCombat` + `logic/BoardMirror`), et relire
   * `boardData.blocked_cells` y donnerait un jeu de cases que le pathfinding
   * n'utilise pas — des obstacles invisibles d'un côté et des rochers posés sur
   * des cases libres de l'autre. Le board est la source de vérité.
   *
   * Les blocages TEMPORAIRES (POWER_FREEZE) n'en font pas partie : ils naissent
   * en cours de combat et ont leur propre rendu.
   */
  blockedCells(): Position[] {
    return [...this._blockedCells].map(key => {
      const [col, row] = key.split(',').map(Number);
      return { col, row };
    });
  }

  clearBlockedCells(): void {
    this._blockedCells = new Set();
    this._temporaryBlockedCells = new Map();
  }

  // Temporarily blocks a cell (POWER_FREEZE) until `expiresAtStep` (a
  // CombatManager._stepCount value, purged via purgeExpiredTemporaryBlocks).
  setTemporaryBlock(pos: Position, expiresAtStep: number): void {
    this._temporaryBlockedCells.set(`${pos.col},${pos.row}`, expiresAtStep);
  }

  // Only one frozen cell (POWER_FREEZE) should exist at a time — a new ice
  // block replaces the previous one rather than stacking.
  clearTemporaryBlocks(): void {
    this._temporaryBlockedCells = new Map();
  }

  purgeExpiredTemporaryBlocks(currentStep: number): void {
    for (const [key, expiresAtStep] of this._temporaryBlockedCells) {
      if (currentStep >= expiresAtStep) this._temporaryBlockedCells.delete(key);
    }
  }

  /**
   * Voisines cardinales dans les limites du plateau, cases bloquées exclues.
   *
   * ⚠️ L'ordre compte : le BFS de `PathFinder.findPath` rend le PREMIER plus
   * court chemin trouvé, et `stepTowardOrNearest` la PREMIÈRE voisine la plus
   * proche. `row - 1` et `row + 1` désignant deux directions physiques opposées
   * d'un client à l'autre, l'énumération est ordonnée dans le repère de
   * référence — sans quoi deux chemins de même longueur se départagent en sens
   * inverse et les deux simulations divergent.
   */
  getNeighbors(pos: Position): Position[] {
    const [before, after] = this.mirroredFrame ? [1, -1] : [-1, 1];
    return [
      { col: pos.col - 1, row: pos.row },
      { col: pos.col + 1, row: pos.row },
      { col: pos.col, row: pos.row + before },
      { col: pos.col, row: pos.row + after },
    ].filter(p => this.isInBounds(p) && !this.isBlocked(p));
  }

  // Rebuild grid from a unit list (after combat cleanup)
  rebuild(units: Unit[]): void {
    this.grid = this._emptyGrid();
    for (const u of units) {
      if (u.position && this.isInBounds(u.position)) {
        this.grid[u.position.col][u.position.row] = u;
      }
    }
  }

  // Returns first empty cell on player side (row 0–3), column-by-column
  firstEmptyPlayerCell(): Position | null {
    for (let r = 0; r <= 3; r++)
      for (let c = 0; c < this.cols; c++)
        if (!this.grid[c][r]) return { col: c, row: r };
    return null;
  }

  firstEmptyEnemyCell(): Position | null {
    for (let r = 7; r <= 10; r++)
      for (let c = 0; c < this.cols; c++)
        if (!this.grid[c][r]) return { col: c, row: r };
    return null;
  }
}
