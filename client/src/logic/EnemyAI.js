import { Unit } from './Unit.js';
import { tiersForRound, resolveGuaranteedDraws } from './Draw.js';
import {
  materialLineageMatches, summonConditions, conditionMaterials, conditionRequires,
  conditionIsFree, summonCost,
} from './InvocationManager.js';

const HAND_SIZE = 5;

/**
 * EnemyAI
 * Draws from the enemy deck each round and places units on rows 7–10
 * using the same summon rules as the player: one cost per condition, and a
 * card is playable as soon as ONE of its conditions is met. Graveyard units
 * (neutralized last combat) are available as materials during the preparation
 * phase.
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
 *   succès → { unit, cell, consumed: { board: [...], graveyard: [...] }, condition_index }
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
  const conditions = summonConditions(card);

  if (conditions.length <= 1) {
    const res = _attemptWith(card, conditions[0] ?? null, board, maxUnits, graveyard, side);
    return conditions.length === 1 && res.unit ? { ...res, condition_index: 0 } : res;
  }

  // Plusieurs voies : la MOINS CHÈRE d'abord, en slots de matériau. C'était
  // « la transformation d'abord » — une préférence écrite en dur qui disait la
  // même chose, la transformation étant précisément la voie à un seul matériau.
  // On indexe AVANT de trier pour garder l'index d'origine, qui nomme la voie.
  const sorted = conditions
    .map((condition, index) => ({ condition, index }))
    .sort((a, b) => conditionMaterials(a.condition) - conditionMaterials(b.condition));

  const tried = [];
  for (const { condition, index } of sorted) {
    const result = _attemptWith(card, condition, board, maxUnits, graveyard, side);
    if (result.unit) return { ...result, condition_index: index };
    tried.push({ index, condition, reason: result.reason, detail: result.detail });
  }
  return { unit: null, reason: 'all_conditions_failed', detail: { conditions: tried } };
}

/**
 * Une seule condition, du même coup les cinq anciennes branches.
 *
 * L'ordre de dépense généralise celui de l'Héritage, qui était déjà le cas
 * général : les matériels NOMMÉS se cherchent sur le terrain d'abord (une unité
 * posée libère une case, et c'est ce qui fait passer une invocation sur un
 * plateau plein), le REMPLISSAGE au cimetière d'abord (ces unités sont déjà
 * perdues). L'ancien Sacrifice n'était que le cas sans matériel nommé, l'ancien
 * Fusion le cas où tous les slots le sont.
 */
function _attemptWith(card, condition, board, maxUnits, graveyard, side) {
  const onBoard = board.getLivingUnitsOnSide(side).length;

  if (!condition || conditionIsFree(condition)) {
    if (board.getLivingUnitsOnSide(side).some(u => u.card_id === card.id))
      return _refused('duplicate_on_board');
    if (onBoard >= maxUnits) return _refused('board_full', { on_board: onBoard, max_units: maxUnits });
    const cells = _freeCells(board, side);
    if (cells.length === 0) return _refused('no_free_cell');
    const unit = _makeUnit(card, side);
    board.placeUnit(unit, cells[0]);
    return _placedAt(unit, cells[0]);
  }

  const needed = conditionMaterials(condition);
  const required = conditionRequires(condition);
  const boardPool = [...board.getLivingUnitsOnSide(side)];
  const gravePool = [...graveyard];
  const toConsumeBoard = [];
  const toConsumeGrave = [];

  // Le doublon du résultat DOIT partir (règle du joueur), et il porte le même
  // `card_id`, donc le même tier : la garde de tier ne peut pas l'écarter.
  const duplicate = boardPool.find(u => u.card_id === card.id);
  if (duplicate) {
    toConsumeBoard.push(duplicate);
    boardPool.splice(boardPool.indexOf(duplicate), 1);
  }

  // 1. Les matériels nommés — terrain d'abord, puis cimetière.
  for (const matId of required) {
    const matches = u => materialLineageMatches(u, matId, required);
    if (toConsumeBoard.some(matches) || toConsumeGrave.some(matches)) continue;
    const fromBoard = _takeCheapest(boardPool, card, matches);
    if (fromBoard) { toConsumeBoard.push(fromBoard); continue; }
    const fromGrave = _takeCheapest(gravePool, card, matches);
    if (fromGrave) { toConsumeGrave.push(fromGrave); continue; }
    // Rien d'éligible : est-ce qu'il MANQUAIT, ou est-ce que la garde de tier
    // vient d'écarter le seul candidat ? Les deux se corrigent différemment —
    // l'un demande d'aller chercher la carte, l'autre dit que l'échange n'en
    // valait pas la peine.
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

  // 2. Le remplissage — cimetière d'abord, puis le terrain du moins cher au
  //    plus cher. Compté en VALEUR : un composite couvre plusieurs slots.
  let stillNeeded = needed
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
      ? _refused('material_outranks_result', { needed, result_tier: card.tier ?? null })
      : _refused('not_enough_material', { needed, available: needed - stillNeeded });
  }

  // 3. Les slots. ⚠️ Plus d'exception : une condition satisfaite depuis le seul
  //    cimetière ne libère aucune case et compte donc comme une pose neuve —
  //    exactement la règle du joueur (`InvocationManager.exceedsBoardSlots`).
  if (onBoard - toConsumeBoard.length + 1 > maxUnits) {
    return _refused('would_exceed_slots', {
      on_board: onBoard, consumed_from_board: toConsumeBoard.length, max_units: maxUnits,
    });
  }

  const consumedBoard = toConsumeBoard.map(_unitRef);
  const consumedGrave = toConsumeGrave.map(_unitRef);
  // La case d'un matériau consommé sur le terrain revient au résultat : c'est
  // l'ancienne Transformation, obtenue sans une ligne qui la nomme.
  const inherited = toConsumeBoard[0]?.position ? { ...toConsumeBoard[0].position } : null;
  for (const u of toConsumeBoard) board.removeUnit(u);
  for (const u of toConsumeGrave) {
    const gi = graveyard.indexOf(u);
    if (gi !== -1) graveyard.splice(gi, 1);
  }
  const cell = inherited ?? _freeCells(board, side)[0];
  if (!cell) return _refused('no_free_cell');
  const unit = _makeUnit(card, side);
  board.placeUnit(unit, cell);
  return _placedAt(unit, cell, consumedBoard, consumedGrave);
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
 * Crée l'unité du résultat.
 *
 * ⚠️ Il n'y a PLUS RIEN à faire ici : `material_value` est une donnée de carte,
 * lue par le constructeur d'`Unit` pour les deux camps. L'IA devait auparavant
 * la recalculer à la main — elle laissait sinon tous ses composites à 1, là où
 * les mêmes cartes en valaient plusieurs pour le joueur. Une divergence de
 * règles entre les deux camps que la donnée rend désormais impossible.
 */
function _makeUnit(card, side) {
  return new Unit(card, side);
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
    // La condition RETENUE quand la carte en a plusieurs — son index nomme la
    // voie. Le log annonçait « transformation » là où l'IA venait de jouer un
    // héritage à deux sacrifices : sur l'écran fait pour expliquer ses
    // décisions, c'est la dernière chose qui a le droit de mentir.
    condition_index: res.condition_index ?? null,
    outcome: res.unit ? 'placed' : 'refused',
    reason: res.reason ?? null,
    detail: res.detail ?? null,
    cell: res.cell ?? null,
    consumed: res.consumed ?? { board: [], graveyard: [] },
  };
}

/**
 * Les cartes SANS condition d'abord, pour qu'elles soient sur le terrain comme
 * matériaux des passes suivantes ; ensuite les moins chères.
 *
 * ⚠️ C'était une table de cinq voies écrites en dur. Le coût en matériels dit
 * la même chose sans nommer personne : une carte sans condition vaut 0, une
 * transformation 1, une fusion à trois matériaux 3. La carte la moins chère
 * étant aussi celle qui libère le moins, elle passe en premier — c'est l'ordre
 * qu'encodait la table.
 */
function _summonPriority(card) {
  return summonCost(card);
}

function _freeCells(board, side = 'enemy') {
  const [rowStart, rowEnd] = side === 'player' ? [0, 3] : [7, 10];
  const cells = [];
  for (let row = rowStart; row <= rowEnd; row++)
    for (let col = 0; col < 5; col++)
      if (!board.isOccupied({ col, row })) cells.push({ col, row });
  return cells;
}
