import { Unit } from './Unit.js';
import { tiersForRound, resolveGuaranteedDraws } from './Draw.js';
import { matchesMaterial, materialLineageMatches, materialValueOf } from './InvocationManager.js';

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
   * @param {number} extra  `enemy_extra_draws` accumulé par l'attribut
   *   `draw_bonus` — pendant de `player_extra_draws`. Défaut à 0 : aucun
   *   appelant existant n'a besoin d'y penser.
   * @param {Object[]} guaranteed  `enemy_guaranteed_draws` à honorer ce
   *   round — pendant de `player_guaranteed_draws`. Occupe des slots de la
   *   main normale, exactement comme côté joueur (défaut : `[]`).
   * @returns {Object[]} les cartes PIOCHÉES (pas la main entière)
   */
  drawHand(round, trace = null, extra = 0, guaranteed = []) {
    const tiers = tiersForRound(round);
    const kept = [...this._hand];
    const pool = [];
    for (const t of tiers) {
      for (const id of (this._deck[String(t)] ?? [])) {
        const card = this._cardDb.getCard(id);
        if (card) pool.push(card);
      }
    }
    // ⚠️ Tirage AVEC REMISE. Sans bonus (le cas de TOUS les appelants avant
    // l'attribut `draw_bonus`), exactement HAND_SIZE appels à `rand` dès que
    // le pool n'est pas vide — inchangé au bit près. Le flux semé de la
    // simulation compte ses appels : en consommer un de plus ou de moins
    // décalerait toutes les pioches et tous les choix d'IA qui suivent. Un
    // `extra`/`guaranteed` non vides sont une CAPACITÉ NOUVELLE (l'IA ne
    // pouvait rien recevoir de tel avant) : le décalage qu'ils introduisent
    // n'est déclenché que par un attribut qui n'existait pas dans ce chemin.
    const randomCount = Math.max(0, HAND_SIZE + extra - guaranteed.length);
    const drawn = [];
    if (pool.length > 0) {
      for (let i = 0; i < randomCount; i++) {
        drawn.push(pool[Math.floor(this._rand() * pool.length)]);
      }
    }
    // Pioches garanties : ignorent la restriction de tier du tour — cherche
    // dans TOUT le deck, comme côté joueur (`GameSession.startPreparation`,
    // même fonction partagée : `Draw.resolveGuaranteedDraws`).
    let guaranteedDrawn = [];
    if (guaranteed.length > 0) {
      const fullPool = [];
      for (const t of Object.keys(this._deck)) {
        for (const id of this._deck[t]) {
          const card = this._cardDb.getCard(id);
          if (card) fullPool.push(card);
        }
      }
      guaranteedDrawn = resolveGuaranteedDraws(fullPool, guaranteed, this._rand);
    }
    this._hand = [...kept, ...drawn, ...guaranteedDrawn];
    trace?.({
      kind: 'draw',
      round,
      tiers,
      pool_size: pool.length,
      kept: kept.map(c => c.id),
      drawn: [...drawn, ...guaranteedDrawn].map(c => c.id),
      hand: this._hand.map(c => c.id),
    });
    return [...drawn, ...guaranteedDrawn];
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
      // ⚠️ On rapporte la voie de l'OPTION RETENUE, pas le `summon_type` de
      // premier niveau de la carte — qui n'est qu'un miroir de l'une des options
      // et n'est jamais lu par le moteur. Le log disait « transformation » là où
      // l'IA venait de jouer un héritage à deux sacrifices : sur l'écran fait
      // pour expliquer ses décisions, c'est la dernière chose qui a le droit de
      // mentir.
      if (result.unit) return { ...result, option_index: index, summon_type: opt.summon_type };
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
      const unit = _makeUnit(card, side);
      board.placeUnit(unit, cells[0]);
      return _placedAt(unit, cells[0]);
    }

    case 'sacrifice': {
      const needed = card.cost?.sacrifice ?? 0;
      if (needed === 0) {
        // Sacrifice gratuit (coût nul dans la carte elle-même) : même règle de
        // doublon qu'une invocation normale, comme côté joueur
        // (`InvocationManager._canSummonForType`).
        if (board.getLivingUnitsOnSide(side).some(u => u.card_id === card.id)) return _refused('duplicate_on_board');
        if (onBoard >= maxUnits) return _refused('board_full', { on_board: onBoard, max_units: maxUnits });
        const cells = _freeCells(board, side);
        if (cells.length === 0) return _refused('no_free_cell');
        const unit = _makeUnit(card, side);
        board.placeUnit(unit, cells[0]);
        return _placedAt(unit, cells[0]);
      }
      const boardUnits = board.getLivingUnitsOnSide(side);
      // Si le résultat est déjà sur le terrain, CET exemplaire doit être
      // consommé (même règle du doublon que pour le joueur). Il porte le même
      // `card_id`, donc le même tier : la garde de tier ne peut pas l'écarter.
      const duplicate = boardUnits.find(u => u.card_id === card.id);

      // On dépense dans cet ordre : le doublon (obligatoire), puis le CIMETIÈRE
      // — ces unités sont déjà hors jeu, les perdre ne coûte rien —, puis le
      // terrain du moins cher au plus cher. Et jamais rien qui surclasse.
      const fromBoard = duplicate ? [duplicate] : [];
      const fromGrave = [];
      let value = duplicate ? _materialValue(duplicate) : 0;
      for (const u of _cheapestFirst(graveyard.filter(g => !_outranks(g, card)))) {
        if (value >= needed) break;
        fromGrave.push(u); value += _materialValue(u);
      }
      for (const u of _cheapestFirst(boardUnits.filter(b => b !== duplicate && !_outranks(b, card)))) {
        if (value >= needed) break;
        fromBoard.push(u); value += _materialValue(u);
      }

      if (value < needed) {
        const blocked = [...boardUnits, ...graveyard].some(u => _outranks(u, card));
        return blocked
          ? _refused('material_outranks_result', { needed, available: value, result_tier: card.tier ?? null })
          : _refused('not_enough_material', { needed, available: value });
      }

      // Net board change: -fromBoard.length + 1
      if (onBoard - fromBoard.length + 1 > maxUnits) {
        return _refused('would_exceed_slots', {
          on_board: onBoard, consumed_from_board: fromBoard.length, max_units: maxUnits,
        });
      }
      const consumedBoard = fromBoard.map(_unitRef);
      const consumedGrave = fromGrave.map(_unitRef);
      for (const u of fromBoard) board.removeUnit(u);
      for (const u of fromGrave) {
        const gi = graveyard.indexOf(u);
        if (gi !== -1) graveyard.splice(gi, 1);
      }
      const unit = _makeUnit(card, side);
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
        const unit = _makeUnit(card, side);
        board.placeUnit(unit, cells[0]);
        return _placedAt(unit, cells[0]);
      }
      // Find each required material on board first, then in graveyard
      const boardPool = [...board.getLivingUnitsOnSide(side)];
      const gravePool = [...graveyard];
      const usedBoard = [];
      const usedGrave = [];
      for (const matId of materials) {
        const matches = u => materialLineageMatches(u, matId, materials);
        // Le moins cher d'abord, dans chaque pool — le terrain reste servi
        // avant le cimetière : consommer une unité posée LIBÈRE une case, et
        // c'est ce qui permet à une fusion de passer sur un plateau plein.
        const fromBoard = _takeCheapest(boardPool, card, matches);
        if (fromBoard) { usedBoard.push(fromBoard); continue; }
        const fromGrave = _takeCheapest(gravePool, card, matches);
        if (fromGrave) { usedGrave.push(fromGrave); continue; }
        // Rien d'éligible : est-ce qu'il MANQUAIT, ou est-ce que la garde de
        // tier vient d'écarter le seul candidat ? Les deux se corrigent
        // différemment — l'un demande d'aller chercher la carte, l'autre dit
        // que l'échange n'en valait pas la peine.
        const outranked = _blockedByTier(boardPool, card, matches)
          ?? _blockedByTier(gravePool, card, matches);
        if (outranked) {
          return _refused('material_outranks_result', {
            material: matId,
            candidate: outranked.card_id,
            candidate_tier: outranked.tier ?? null,
            result_tier: card.tier ?? null,
          });
        }
        return _refused('missing_material', { material: matId, materials });
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
      const unit = _makeUnit(card, side);
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
        const unit = _makeUnit(card, side);
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
        const matches = u => matchesMaterial(u, matId);
        const fromBoard = _takeCheapest(boardPool, card, matches);
        if (fromBoard) { toConsumeBoard.push(fromBoard); continue; }
        const fromGrave = _takeCheapest(gravePool, card, matches);
        if (fromGrave) { toConsumeGrave.push(fromGrave); continue; }
        const outranked = _blockedByTier(boardPool, card, matches)
          ?? _blockedByTier(gravePool, card, matches);
        if (outranked) {
          return _refused('material_outranks_result', {
            material: matId,
            candidate: outranked.card_id,
            candidate_tier: outranked.tier ?? null,
            result_tier: card.tier ?? null,
          });
        }
        return _refused('missing_material', { material: matId, materials: required });
      }

      // Les slots de sacrifice restants — cimetière d'abord (déjà perdu), puis
      // le terrain du moins cher au plus cher. Comptés en VALEUR : un composite
      // couvre plusieurs slots, donc moins d'unités dépensées.
      let stillNeeded = sacrifice
        - [...toConsumeBoard, ...toConsumeGrave].reduce((s, u) => s + _materialValue(u), 0);
      for (const u of _cheapestFirst(gravePool.filter(g => !_outranks(g, card)))) {
        if (stillNeeded <= 0) break;
        toConsumeGrave.push(u); stillNeeded -= _materialValue(u);
      }
      for (const u of _cheapestFirst(boardPool.filter(b => !_outranks(b, card)))) {
        if (stillNeeded <= 0) break;
        toConsumeBoard.push(u); stillNeeded -= _materialValue(u);
      }
      if (stillNeeded > 0) {
        const blocked = [...boardPool, ...gravePool].some(u => _outranks(u, card));
        return blocked
          ? _refused('material_outranks_result', { needed: sacrifice, result_tier: card.tier ?? null })
          : _refused('not_enough_material', { needed: sacrifice, available: sacrifice - stillNeeded });
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
      const unit = _makeUnit(card, side);
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
        const unit = _makeUnit(card, side);
        board.placeUnit(unit, pos);
        return _placedAt(unit, pos, consumedBoard);
      }

      // Board target: 1-for-1, no slot limit check. La cible la MOINS chère
      // parmi celles qui conviennent, et jamais une qui surclasse le résultat —
      // une transformation qui descend d'un tier est une perte sèche.
      const matchesTarget = u => materialLineageMatches(u, targetId, [targetId]);
      const boardTarget = _cheapestMatch(boardUnits, card, matchesTarget);
      if (boardTarget) {
        const pos = { ...boardTarget.position };
        const consumedBoard = [_unitRef(boardTarget)];
        board.removeUnit(boardTarget);
        const unit = _makeUnit(card, side);
        board.placeUnit(unit, pos);
        return _placedAt(unit, pos, consumedBoard);
      }

      // Graveyard target: net +1 on board, need a free slot
      const graveTarget = _cheapestMatch(graveyard, card, matchesTarget);
      const graveIdx = graveTarget ? graveyard.indexOf(graveTarget) : -1;
      if (graveIdx !== -1) {
        if (onBoard >= maxUnits) return _refused('board_full', { on_board: onBoard, max_units: maxUnits });
        const cells = _freeCells(board, side);
        if (cells.length === 0) return _refused('no_free_cell');
        const consumedGrave = [_unitRef(graveyard[graveIdx])];
        graveyard.splice(graveIdx, 1);
        const unit = _makeUnit(card, side);
        board.placeUnit(unit, cells[0]);
        return _placedAt(unit, cells[0], [], consumedGrave);
      }

      // La cible existe peut-être, mais surclasse le résultat.
      const outranked = _blockedByTier(boardUnits, card, matchesTarget)
        ?? _blockedByTier(graveyard, card, matchesTarget);
      if (outranked) {
        return _refused('material_outranks_result', {
          material: targetId,
          candidate: outranked.card_id,
          candidate_tier: outranked.tier ?? null,
          result_tier: card.tier ?? null,
        });
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

// ── Choix des matériaux ───────────────────────────────────────────────────────
//
// L'IA prenait le PREMIER candidat venu, dans l'ordre de balayage du plateau.
// Constaté sur un vrai run (deck « Jaden », round 3) : quatre unités totalisant
// 700 PV et 50 ATK consommées en cascade pour n'en laisser qu'UNE de 140 PV et
// 16 ATK — chaque invocation dévorant celle que la précédente venait de créer,
// jusqu'à un Tier 3 sacrifié pour un Tier 2.

/**
 * Une unité de tier STRICTEMENT supérieur au résultat ne se sacrifie jamais.
 *
 * ⚠️ Règle DURE, pas une préférence : quand elle rend une invocation
 * impossible, la carte est refusée (`material_outranks_result`) plutôt que
 * jouée à perte. Un tier est l'échelle de puissance du jeu — descendre l'échelle
 * en dépensant du matériel est toujours un mauvais échange, quelles que soient
 * les stats.
 *
 * `>` et non `>=` : consommer un pair reste légitime (deux Tier 2 pour un Tier 3
 * passent par un intermédiaire de même rang), et l'interdire fermerait des
 * lignées entières.
 */
function _outranks(unit, card) {
  return (unit.tier ?? 0) > (card.tier ?? 0);
}

/**
 * Ce que coûte la perte d'une unité.
 *
 * ⚠️ MÊME métrique que l'auto-joueur (`sim/autoPlayer.materialCost`) : l'ATK
 * pèse 20× les PV, parce que ce sont les survivants et leur ATK qui infligent
 * les dégâts de fin de combat. Deux façons de dire « le moins cher » dans le
 * même projet finiraient par ne plus désigner la même unité.
 */
function _materialCost(unit) {
  return unit.atk * 20 + unit.current_hp;
}

/** Combien de slots de sacrifice une unité couvre (règle du joueur). */
function _materialValue(unit) {
  return unit.material_value ?? 1;
}

/**
 * Le matériau ÉLIGIBLE le moins cher du pool, ou `null`. Ne mute rien.
 * Départage par `uid` : à coût égal, le choix doit rester déterministe.
 */
function _cheapestMatch(pool, card, matches) {
  let best = null;
  for (const u of pool) {
    if (!matches(u) || _outranks(u, card)) continue;
    if (best === null) { best = u; continue; }
    const d = _materialCost(u) - _materialCost(best);
    if (d < 0 || (d === 0 && u.uid < best.uid)) best = u;
  }
  return best;
}

/** Le même, RETIRÉ du pool — pour les boucles qui consomment matériau par matériau. */
function _takeCheapest(pool, card, matches) {
  const best = _cheapestMatch(pool, card, matches);
  if (best) pool.splice(pool.indexOf(best), 1);
  return best;
}

/** Y a-t-il un candidat qui conviendrait, mais que son tier écarte ? */
function _blockedByTier(pool, card, matches) {
  return pool.find(u => matches(u) && _outranks(u, card)) ?? null;
}

/** Le moins cher d'abord — l'ordre dans lequel on accepte de perdre ses unités. */
function _cheapestFirst(units) {
  return [...units].sort(
    (a, b) => _materialCost(a) - _materialCost(b) || a.uid - b.uid,
  );
}

/**
 * Crée l'unité du résultat, AVEC sa valeur de matériau.
 *
 * ⚠️ L'IA construisait ses unités par `new Unit`, qui laisse `material_value`
 * à 1 : ses composites ne couvraient donc qu'UN slot de sacrifice là où les
 * mêmes cartes en couvrent plusieurs pour le joueur. C'était une divergence de
 * règles entre les deux camps, et une des raisons pour lesquelles l'IA
 * dépensait tant d'unités — un composite bâti sur trois sacrifices en revaut
 * trois. La table est celle du joueur (`InvocationManager.materialValueOf`),
 * pas une copie : `card` est déjà aplatie ici, sa `summon_option` résolue.
 */
function _makeUnit(card, side) {
  const unit = new Unit(card, side);
  unit.material_value = materialValueOf(card, card.summon_type, card.cost);
  return unit;
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
    // La voie RETENUE quand la carte a plusieurs recettes (`res.summon_type`),
    // sinon la sienne. Cf. la note de `_attempt` sur le miroir de premier niveau.
    summon_type: res.summon_type ?? card.summon_type ?? null,
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
