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
 *
 * ── Observation des décisions ────────────────────────────────────────────────
 * Les trois méthodes de délibération acceptent un `trace` OPTIONNEL : une
 * fonction nue, appelée `trace?.(event)`. Elle n'ajoute aucun import — `logic/`
 * reste headless et ignore qu'un écran l'observe, exactement comme il ignore
 * d'où vient `rand`.
 *
 * ⚠️ Le sink est un PARAMÈTRE, jamais un état d'instance (pas de `setTrace()`).
 * C'est ce qui rend structurellement impossible qu'une partie réelle se
 * retrouve tracée par un observateur oublié sur l'objet : les appels de
 * `GameSession._placeEnemyUnits` ne le passent pas, il n'existe donc pas pour
 * eux. Le seul appelant qui le fournit est le Labo IA (`dev/aiLabRun.ts`).
 */
export class EnemyAI {
  /**
   * @param {Object} deck   - { "1": [cardId, ...], ..., "5": [...] }
   * @param {CardDatabase} cardDb - must already be initialised
   * @param {'player'|'enemy'} side - which board side this AI plays (default 'enemy')
   * @param {() => number} rand - source de hasard, injectée pour que la
   *   simulation d'équilibrage puisse SEMER la pioche (cf. logic/Random.ts).
   *   Le défaut laisse le jeu strictement inchangé.
   */
  constructor(deck, cardDb, side = 'enemy', rand = Math.random) {
    this._deck = deck;
    this._cardDb = cardDb;
    this._side = side;
    this._rand = rand;
    this._hand = [];
  }

  /**
   * Draw HAND_SIZE cards from the deck for the given round's eligible tiers,
   * and ADD them to the hand. Call placeFromHand() to place them.
   *
   * ⚠️ La main S'ACCUMULE, comme celle du joueur (`GameSession.startPreparation`
   * fait le même `[...this.hand, ...drawHand(…)]`). Elle était ÉCRASÉE, ce qui
   * perdait à chaque round les cartes que `placeFromHand` avait pris soin de
   * retenir — et ce sont précisément les plus intéressantes : une fusion sortie
   * au round 1 alors que ses matériaux n'étaient pas encore là ne revenait
   * jamais, quand bien même le round 3 les lui donnait. L'IA repiochait une
   * main neuve dans un pool de tiers plus haut, où la carte n'était même plus
   * tirable.
   *
   * ⚠️ Un pool VIDE ne vide pas la main non plus : un round dont les tiers ne
   * sont pas représentés dans le deck n'est pas une raison de défausser ce
   * qu'on tenait. C'était le second point d'écrasement, et le plus silencieux.
   *
   * ⚠️ La main n'a PAS de plafond, exactement comme celle du joueur (« taille
   * illimitée »). Le pire cas est borné par la partie : 5 rounds × 5 cartes,
   * moins tout ce qui est posé.
   *
   * @param {number} round
   * @param {?function(*): void} trace
   * @returns {Object[]} les cartes PIOCHÉES (pas la main entière)
   */
  drawHand(round, trace = null) {
    const tiers = tiersForRound(round);
    const kept = [...this._hand];
    const pool = [];
    for (const t of tiers) {
      for (const id of (this._deck[String(t)] ?? [])) {
        const card = this._cardDb.getCard(id);
        if (card) pool.push(card);
      }
    }
    // ⚠️ Tirage AVEC REMISE, et exactement HAND_SIZE appels à `rand` dès que le
    // pool n'est pas vide — comme avant. Le flux semé de la simulation compte
    // ses appels : en consommer un de plus ou de moins décalerait toutes les
    // pioches et tous les choix d'IA qui suivent.
    const drawn = [];
    if (pool.length > 0) {
      for (let i = 0; i < HAND_SIZE; i++) {
        drawn.push(pool[Math.floor(this._rand() * pool.length)]);
      }
    }
    this._hand = [...kept, ...drawn];
    trace?.({
      kind: 'draw',
      round,
      tiers,
      pool_size: pool.length,
      kept: kept.map(c => c.id),
      drawn: drawn.map(c => c.id),
      hand: this._hand.map(c => c.id),
    });
    return [...drawn];
  }

  /**
   * Impose la main au lieu de la piocher — le Labo IA compose un cas de test
   * carte par carte. Aucun appelant en jeu : la pioche reste le seul chemin.
   * @param {Object[]} cards
   */
  setHand(cards) {
    this._hand = [...cards];
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
   * @param {?function(*): void} trace
   * @returns {Unit[]} placed units
   */
  placeFromHand(board, maxUnits = 5, graveyard = [], trace = null) {
    let unplaced = [...this._hand];
    const placed = [];
    let pass = 0;

    for (;;) {
      const before = placed.length;
      const remaining = [];
      pass++;

      // Sort each pass: normal cards first so they are on board as materials.
      const sorted = [...unplaced].sort(
        (a, b) => _summonPriority(a) - _summonPriority(b)
      );

      trace?.({ kind: 'pass_start', pass, order: sorted.map(c => c.id) });

      for (const card of sorted) {
        const res = _attempt(card, board, maxUnits, graveyard, this._side);
        trace?.(_attemptEvent(pass, card, res));
        if (res.unit) placed.push(res.unit);
        else remaining.push(card);
      }

      trace?.({
        kind: 'pass_end',
        pass,
        placed: placed.length - before,
        unplaced: remaining.map(c => c.id),
      });

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
   * @param {?function(*): void} trace
   */
  rearrangeUnits(board, maxUnits = 5, trace = null) {
    const units = board.getLivingUnitsOnSide(this._side);
    if (units.length === 0) {
      trace?.({ kind: 'rearrange', before: [], after: [], dropped: [] });
      return;
    }

    const before = units.map(u => _unitRow(u));

    for (const u of units) board.removeUnit(u);

    const sorted = [...units].sort((a, b) => {
      if (a.range !== b.range) return a.range - b.range; // lower range → front
      return b.max_hp - a.max_hp;                        // higher HP → front within group
    });

    const toPlace = sorted.slice(0, maxUnits);
    // ⚠️ Les unités au-delà du cap sont retirées du board SANS mourir ni passer
    // au cimetière — elles disparaissent, simplement. On les nomme ici, c'est
    // la seule trace qu'il en reste.
    const dropped = sorted.slice(maxUnits).map(u => _unitRow(u));

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

    trace?.({
      kind: 'rearrange',
      before,
      after: placements.map(({ unit }) => _unitRow(unit)),
      dropped,
    });
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
 *
 * Remplace le `_tryPlace` d'avant : rend un RÉSULTAT au lieu d'un `Unit | null`.
 *
 *   succès → { unit, cell, consumed: { board: [...], graveyard: [...] }, option_index }
 *   échec  → { unit: null, reason, detail }
 *
 * ⚠️ La valeur ajoutée ici est le MOTIF. Les quinze `return null` de la version
 * d'avant étaient rigoureusement indiscernables : « pas la place », « doublon »,
 * « matériau manquant » et « dépasserait les slots » sortaient tous comme la
 * même absence de valeur, et la question « pourquoi l'IA n'a pas joué cette
 * carte ? » n'avait aucune réponse observable, ni en jeu ni en test.
 *
 * ⚠️ AUCUNE condition, aucun ordre et aucune case ne changent par rapport à la
 * version d'avant : ce sont des métadonnées, rien d'autre. Le critère de
 * non-régression est que la suite entière passe sans une seule mise à jour de
 * snapshot (goldens de `sim.test.ts`, `bots.test.ts`, `tutorial.test.ts`).
 */
function _attempt(card, board, maxUnits, graveyard, side = 'enemy') {
  // Cards with multiple invocation options: prefer transformation, then try each in order
  if (Array.isArray(card.summon_options) && card.summon_options.length > 0) {
    // On indexe AVANT de trier pour garder l'index d'origine de chaque option :
    // c'est lui qui la nomme, et le tri (stable, même comparateur, même ordre
    // d'entrée) rend exactement la même séquence qu'auparavant.
    const sorted = card.summon_options
      .map((opt, index) => ({ opt, index }))
      .sort((a, b) =>
        a.opt.summon_type === 'transformation' ? -1 : b.opt.summon_type === 'transformation' ? 1 : 0
      );
    const tried = [];
    for (const { opt, index } of sorted) {
      const variant = { ...card, summon_type: opt.summon_type, cost: opt.cost };
      delete variant.summon_options; // avoid re-entering this branch → infinite recursion
      const result = _attempt(variant, board, maxUnits, graveyard, side);
      if (result.unit) return { ...result, option_index: index };
      tried.push({ index, summon_type: opt.summon_type, reason: result.reason, detail: result.detail });
    }
    return { unit: null, reason: 'all_options_failed', detail: { options: tried } };
  }

  const onBoard = board.getLivingUnitsOnSide(side).length;

  switch (card.summon_type) {
    case 'normal': {
      if (onBoard >= maxUnits) return _refused('board_full', { on_board: onBoard, max_units: maxUnits });
      // Pas de doublon (même card_id) sur le terrain, comme pour le joueur
      if (board.getLivingUnitsOnSide(side).some(u => u.card_id === card.id)) return _refused('duplicate_on_board');
      const cells = _freeCells(board, side);
      if (cells.length === 0) return _refused('no_free_cell');
      const unit = new Unit(card, side);
      board.placeUnit(unit, cells[0]);
      return _placedAt(unit, cells[0]);
    }

    case 'sacrifice': {
      const needed = card.cost?.sacrifice ?? 0;
      if (needed === 0) {
        if (onBoard >= maxUnits) return _refused('board_full', { on_board: onBoard, max_units: maxUnits });
        const cells = _freeCells(board, side);
        if (cells.length === 0) return _refused('no_free_cell');
        const unit = new Unit(card, side);
        board.placeUnit(unit, cells[0]);
        return _placedAt(unit, cells[0]);
      }
      const boardUnits = board.getLivingUnitsOnSide(side);
      if (boardUnits.length + graveyard.length < needed) {
        return _refused('not_enough_material', {
          needed, available: boardUnits.length + graveyard.length,
        });
      }
      // If the result card is already on board, that unit must be consumed as a sacrifice material
      const duplicate = boardUnits.find(u => u.card_id === card.id);
      let fromBoard, fromGraveCount;
      if (duplicate) {
        const otherBoard = boardUnits.filter(u => u !== duplicate);
        const stillNeeded = needed - 1;
        fromGraveCount = Math.min(stillNeeded, graveyard.length);
        const fromBoardCount = stillNeeded - fromGraveCount;
        // ⚠️ INATTEIGNABLE, et c'est démontrable : la garde ci-dessus a déjà
        // écarté `board + grave < needed`, or cette condition se réduit
        // exactement à `needed > board + grave`. Elle est gardée comme filet —
        // le jour où la garde du dessus change, elle redevient le dernier
        // rempart — mais aucun cas du labo ne peut la faire sortir.
        if (fromBoardCount > otherBoard.length) {
          return _refused('duplicate_needs_extra_material', {
            needed, still_needed: stillNeeded, other_board: otherBoard.length,
          });
        }
        fromBoard = [...otherBoard.slice(0, fromBoardCount), duplicate];
      } else {
        fromGraveCount = Math.min(needed, graveyard.length);
        fromBoard = boardUnits.slice(0, needed - fromGraveCount);
      }
      // Net board change: -fromBoard.length + 1
      if (onBoard - fromBoard.length + 1 > maxUnits) {
        return _refused('would_exceed_slots', {
          on_board: onBoard, consumed_from_board: fromBoard.length, max_units: maxUnits,
        });
      }
      const consumedGrave = graveyard.slice(0, fromGraveCount).map(_unitRef);
      const consumedBoard = fromBoard.map(_unitRef);
      graveyard.splice(0, fromGraveCount);
      for (const u of fromBoard) board.removeUnit(u);
      const unit = new Unit(card, side);
      const cell = _freeCells(board, side)[0];
      board.placeUnit(unit, cell);
      return _placedAt(unit, cell, consumedBoard, consumedGrave);
    }

    case 'fusion': {
      const materials = card.cost?.materials ?? [];
      if (materials.length === 0) {
        if (onBoard >= maxUnits) return _refused('board_full', { on_board: onBoard, max_units: maxUnits });
        const cells = _freeCells(board, side);
        if (cells.length === 0) return _refused('no_free_cell');
        const unit = new Unit(card, side);
        board.placeUnit(unit, cells[0]);
        return _placedAt(unit, cells[0]);
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
            return _refused('missing_material', { material: matId, materials }); // missing material
          }
        }
      }
      // Net board change: -usedBoard.length + 1
      if (onBoard - usedBoard.length + 1 > maxUnits) {
        return _refused('would_exceed_slots', {
          on_board: onBoard, consumed_from_board: usedBoard.length, max_units: maxUnits,
        });
      }
      const consumedBoard = usedBoard.map(_unitRef);
      const consumedGrave = usedGrave.map(_unitRef);
      for (const u of usedBoard) board.removeUnit(u);
      for (const u of usedGrave) {
        const gi = graveyard.indexOf(u);
        if (gi !== -1) graveyard.splice(gi, 1);
      }
      const unit = new Unit(card, side);
      const cell = _freeCells(board, side)[0];
      board.placeUnit(unit, cell);
      return _placedAt(unit, cell, consumedBoard, consumedGrave);
    }

    case 'heritage': {
      const required = card.cost?.materials ?? [];
      const sacrifice = card.cost?.sacrifice ?? 0;
      if (sacrifice === 0 && required.length === 0) {
        if (onBoard >= maxUnits) return _refused('board_full', { on_board: onBoard, max_units: maxUnits });
        const cells = _freeCells(board, side);
        if (cells.length === 0) return _refused('no_free_cell');
        const unit = new Unit(card, side);
        board.placeUnit(unit, cells[0]);
        return _placedAt(unit, cells[0]);
      }
      const boardPool = [...board.getLivingUnitsOnSide(side)];
      const gravePool = [...graveyard];
      if (boardPool.length + gravePool.length < sacrifice) {
        return _refused('not_enough_material', {
          needed: sacrifice, available: boardPool.length + gravePool.length,
        });
      }

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
            return _refused('missing_material', { material: matId, materials: required }); // constraint unsatisfiable
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
      if (onBoard - toConsumeBoard.length + 1 > maxUnits) {
        return _refused('would_exceed_slots', {
          on_board: onBoard, consumed_from_board: toConsumeBoard.length, max_units: maxUnits,
        });
      }

      const consumedBoard = toConsumeBoard.map(_unitRef);
      const consumedGrave = toConsumeGrave.map(_unitRef);
      for (const u of toConsumeBoard) board.removeUnit(u);
      for (const u of toConsumeGrave) {
        const gi = graveyard.indexOf(u);
        if (gi !== -1) graveyard.splice(gi, 1);
      }
      const unit = new Unit(card, side);
      const cell = _freeCells(board, side)[0];
      board.placeUnit(unit, cell);
      return _placedAt(unit, cell, consumedBoard, consumedGrave);
    }

    case 'transformation': {
      const targetId = card.cost?.materials?.[0];
      if (!targetId) return _refused('no_transformation_target_id');

      const boardUnits = board.getLivingUnitsOnSide(side);
      // If result already on board, that copy must be consumed as the transformation material.
      // If it doesn't match targetId, the transformation would create a duplicate — invalid.
      const existingResult = boardUnits.find(u => u.card_id === card.id);
      if (existingResult) {
        if (!materialLineageMatches(existingResult, targetId, [targetId])) {
          return _refused('transformation_target_mismatch', { target: targetId, on_board: existingResult.card_id });
        }
        const pos = { ...existingResult.position };
        const consumedBoard = [_unitRef(existingResult)];
        board.removeUnit(existingResult);
        const unit = new Unit(card, side);
        board.placeUnit(unit, pos);
        return _placedAt(unit, pos, consumedBoard);
      }

      // Board target: 1-for-1, no slot limit check
      const boardTarget = boardUnits.find(u => materialLineageMatches(u, targetId, [targetId]));
      if (boardTarget) {
        const pos = { ...boardTarget.position };
        const consumedBoard = [_unitRef(boardTarget)];
        board.removeUnit(boardTarget);
        const unit = new Unit(card, side);
        board.placeUnit(unit, pos);
        return _placedAt(unit, pos, consumedBoard);
      }

      // Graveyard target: net +1 on board, need a free slot
      const graveIdx = graveyard.findIndex(u => materialLineageMatches(u, targetId, [targetId]));
      if (graveIdx !== -1) {
        if (onBoard >= maxUnits) return _refused('board_full', { on_board: onBoard, max_units: maxUnits });
        const cells = _freeCells(board, side);
        if (cells.length === 0) return _refused('no_free_cell');
        const consumedGrave = [_unitRef(graveyard[graveIdx])];
        graveyard.splice(graveIdx, 1);
        const unit = new Unit(card, side);
        board.placeUnit(unit, cells[0]);
        return _placedAt(unit, cells[0], [], consumedGrave);
      }

      return _refused('no_transformation_target', { target: targetId });
    }

    default:
      return _refused('unknown_summon_type', { summon_type: card.summon_type ?? null });
  }
}

function _refused(reason, detail = null) {
  return { unit: null, reason, detail };
}

function _placedAt(unit, cell, consumedBoard = [], consumedGrave = []) {
  return {
    unit,
    reason: null,
    detail: null,
    cell: cell ? { col: cell.col, row: cell.row } : null,
    consumed: { board: consumedBoard, graveyard: consumedGrave },
  };
}

/** Identité d'une unité dans la trace. L'`uid` distingue deux exemplaires de la même carte. */
function _unitRef(unit) {
  return { uid: unit.uid, card_id: unit.card_id };
}

/** Ligne d'unité de la trace de placement : identité + ce qui décide du rangement. */
function _unitRow(unit) {
  return {
    uid: unit.uid,
    card_id: unit.card_id,
    col: unit.position?.col ?? null,
    row: unit.position?.row ?? null,
    range: unit.range,
    max_hp: unit.max_hp,
    atk: unit.atk,
  };
}

/** Événement de tentative, dérivé du résultat de `_attempt`. */
function _attemptEvent(pass, card, res) {
  return {
    kind: 'attempt',
    pass,
    card_id: card.id,
    summon_type: card.summon_type ?? null,
    option_index: res.option_index ?? null,
    outcome: res.unit ? 'placed' : 'refused',
    reason: res.reason ?? null,
    detail: res.detail ?? null,
    cell: res.cell ?? null,
    consumed: res.consumed ?? { board: [], graveyard: [] },
  };
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
