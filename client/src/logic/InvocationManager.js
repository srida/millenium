import { Unit } from './Unit.js';

/**
 * Validates and executes summons for all 5 types.
 *
 * hand: Card[] (mutable — cards are spliced out on summon)
 * board: Board
 */

// Transformation is always 1-for-1 (replaces its target in place), so it never counts against the slot limit.
// A free_transformation (no target consumed) takes a brand new cell, so it must count like a normal summon.
export function exceedsBoardSlots(card, selectedMaterials, board, graveyard, playerBoardSlots, type = card.summon_type) {
  if (type === 'transformation' && !card._free_transformation) return false;
  const materialsOnBoard = selectedMaterials.filter(u => !graveyard.includes(u)).length;
  const afterPlace = board.getLivingUnitsOnSide('player').length - materialsOnBoard + 1;
  return afterPlace > playerBoardSlots;
}

// A card opts into multiple summoning alternatives (e.g. transformation from one specific
// monster OR sacrifice of several others, for the same resulting monster) via this field.
// When absent, the card behaves exactly as before via its own summon_type/cost.
export function hasSummonOptions(card) {
  return Array.isArray(card.summon_options) && card.summon_options.length > 0;
}

export function canSummon(card, pos, board, hand, graveyard = [], selectedMaterials = [], optionIndex = null) {
  if (!board.isInBounds(pos)) return fail('Position hors limites');
  if (!board.isPlayerCell(pos)) return fail('Placement uniquement sur le côté joueur (rangées 0–3)');

  if (hasSummonOptions(card)) {
    if (optionIndex !== null && optionIndex !== undefined) {
      const opt = card.summon_options[optionIndex];
      if (!opt) return fail("Option d'invocation invalide");
      return _canSummonForType(card, opt.summon_type, opt.cost, pos, board, hand, graveyard, selectedMaterials);
    }
    // No option chosen yet: report the playability of every alternative for this cell.
    return {
      options: card.summon_options.map((opt, index) => {
        const res = _canSummonForType(card, opt.summon_type, opt.cost, pos, board, hand, graveyard, selectedMaterials);
        return { index, summon_type: opt.summon_type, cost: opt.cost, ok: res.ok, reason: res.reason };
      }),
    };
  }

  return _canSummonForType(card, card.summon_type, card.cost, pos, board, hand, graveyard, selectedMaterials);
}

function _canSummonForType(card, type, cost, pos, board, hand, graveyard, selectedMaterials) {
  // La transformation place la carte sur la case de la cible (déjà occupée)
  if (type !== 'transformation' && board.isOccupied(pos)) return fail('Case occupée');
  // Pas de doublon (même card_id) sur le terrain joueur — uniquement pour un placement normal :
  // sacrifice/fusion/heritage/transformation peuvent légitimement se jouer par-dessus un doublon existant
  if (type === 'normal') {
    const duplicate = board.getLivingUnitsOnSide('player').some(u => u.card_id === card.id);
    if (duplicate) return fail('Cette carte est déjà présente sur le terrain');
  }
  switch (type) {
    case 'normal':
      return ok();

    case 'sacrifice': {
      const needed = cost?.sacrifice ?? 0;
      if (needed === 0) {
        // Sacrifice gratuit (coût réduit par magie) : même règle de doublon que l'invocation normale
        if (board.getLivingUnitsOnSide('player').some(u => u.card_id === card.id))
          return fail('Cette carte est déjà présente sur le terrain');
        return ok();
      }
      // Si un doublon de la carte invoquée est déjà vivant sur le terrain, il doit être
      // sélectionné comme matériau (sinon on se retrouverait avec deux exemplaires vivants).
      const duplicate = board.getLivingUnitsOnSide('player').find(u => u.card_id === card.id);
      if (duplicate && !selectedMaterials.includes(duplicate)) {
        return fail('Le doublon présent sur le terrain doit être sélectionné comme matériau');
      }
      const total = _sumMaterialValue(board.getLivingUnitsOnSide('player')) + _sumMaterialValue(graveyard);
      if (total < needed) return fail(`Requiert ${needed} unité(s) sur le terrain ou au cimetière`);
      return ok();
    }

    case 'fusion': {
      const materials = cost?.materials ?? [];
      if (materials.length === 0) return ok();
      const playerUnits = board.getUnitsOnSide('player');
      for (const matId of materials) {
        const onBoard = playerUnits.find(u => _materialLineageMatches(u, matId, materials) && u.isAlive());
        const inGrave = graveyard.find(u => _materialLineageMatches(u, matId, materials));
        if (!onBoard && !inGrave)
          return fail(`Matériau manquant sur le terrain ou au cimetière : ${matId}`);
      }
      // Si un doublon du résultat de cette fusion est déjà vivant sur le terrain, il doit
      // être sélectionné comme matériau pour être consommé.
      const duplicate = board.getLivingUnitsOnSide('player').find(u => u.card_id === card.id);
      if (duplicate && !selectedMaterials.includes(duplicate)) {
        return fail('Le doublon présent sur le terrain doit être sélectionné comme matériau');
      }
      return ok();
    }

    case 'heritage': {
      const required = cost?.materials ?? [];
      const sacrifice = cost?.sacrifice ?? 0;
      const allUnits = [...board.getUnitsOnSide('player'), ...graveyard];
      // sacrifice = total material slots to consume; materials = constraints among those units
      if (_sumMaterialValue(allUnits) < sacrifice)
        return fail(`Requiert ${sacrifice} unité(s) sur le terrain ou au cimetière`);
      // Check each material requirement can be matched by some available unit
      const pool = [...allUnits];
      for (const matId of required) {
        const idx = pool.findIndex(u => _matchesMaterial(u, matId));
        if (idx === -1) return fail(`Matériau Heritage manquant : ${matId}`);
        pool.splice(idx, 1);
      }
      // Si un doublon du résultat de cette heritage est déjà vivant sur le terrain, il doit
      // être sélectionné comme matériau pour être consommé.
      const duplicate = board.getLivingUnitsOnSide('player').find(u => u.card_id === card.id);
      if (duplicate && !selectedMaterials.includes(duplicate)) {
        return fail('Le doublon présent sur le terrain doit être sélectionné comme matériau');
      }
      return ok();
    }

    case 'transformation': {
      if (card._free_transformation) {
        if (board.isOccupied(pos)) return fail('Case occupée');
        return ok();
      }
      const targetId = cost?.materials?.[0];
      if (!targetId) return fail('Pas de cible de transformation définie');
      const onBoard = board.getUnitsOnSide('player').find(u => _materialLineageMatches(u, targetId, [targetId]) && u.isAlive());
      const inGrave = graveyard.find(u => _materialLineageMatches(u, targetId, [targetId]));
      if (!onBoard && !inGrave) return fail(`Requiert ${targetId} sur le terrain ou au cimetière`);
      // Si un doublon du résultat de cette transformation est déjà vivant sur le terrain,
      // c'est lui qui doit être consommé comme matériau (sinon on se retrouverait avec
      // deux exemplaires vivants du résultat).
      const duplicate = board.getLivingUnitsOnSide('player').find(u => u.card_id === card.id);
      if (duplicate && selectedMaterials[0] !== duplicate) {
        return fail('Le doublon présent sur le terrain doit être utilisé comme matériau de la transformation');
      }
      return ok();
    }

    default:
      return fail(`Type d'invocation inconnu : ${type}`);
  }
}

/**
 * Execute the summon. Assumes canSummon() returned ok.
 * @param {Object} card  - card data object
 * @param {{col,row}} pos - target cell on player board
 * @param {Board} board
 * @param {Card[]} hand  - mutable hand array
 * @param {Card[][]} sacrificeTargets - for sacrifice/heritage: which board units to remove
 *        (if null, removes the first N living player units)
 * @param {number} handIdx
 * @param {number} optionIndex - when card.summon_options exists, the chosen alternative's index
 * @returns {Unit}
 */
export function summon(card, pos, board, hand, sacrificeTargets = null, handIdx = null, optionIndex = null) {
  const opt = hasSummonOptions(card) ? card.summon_options[optionIndex ?? 0] : null;
  const type = opt ? opt.summon_type : card.summon_type;
  const cost = opt ? opt.cost : card.cost;
  const unit = new Unit(card, 'player');

  switch (type) {
    case 'normal':
      _removeFromHand(hand, card.id, handIdx);
      break;

    case 'sacrifice': {
      _removeFromHand(hand, card.id, handIdx);
      const needed = cost?.sacrifice ?? 0;
      const toRemove = sacrificeTargets
        ? _takeByMaterialValue(sacrificeTargets, needed)
        : _takeByMaterialValue(board.getLivingUnitsOnSide('player'), needed);
      for (const u of toRemove) board.removeUnit(u);
      unit.material_value = card._original_sacrifice ?? needed;
      _transferShoppingBonuses(unit, toRemove);
      break;
    }

    case 'fusion': {
      _removeFromHand(hand, card.id, handIdx);
      const consumed = [];
      if (sacrificeTargets && sacrificeTargets.length > 0) {
        for (const u of sacrificeTargets) { board.removeUnit(u); consumed.push(u); }
      } else {
        // AI fallback: auto-select matching units
        const fusionMaterials = cost?.materials ?? [];
        const fusionUnits = board.getUnitsOnSide('player');
        for (const matId of fusionMaterials) {
          const mat = fusionUnits.find(u => _materialLineageMatches(u, matId, fusionMaterials) && u.isAlive() && !consumed.includes(u));
          if (mat) { board.removeUnit(mat); consumed.push(mat); }
        }
      }
      unit.material_value = (cost?.materials ?? []).length || 1;
      _transferShoppingBonuses(unit, consumed);
      break;
    }

    case 'heritage': {
      _removeFromHand(hand, card.id, handIdx);
      let consumed;
      if (sacrificeTargets && sacrificeTargets.length > 0) {
        consumed = sacrificeTargets;
        for (const u of sacrificeTargets) board.removeUnit(u);
      } else {
        // AI fallback: pick required materials first, fill remaining slots with any unit
        const sacrifice = cost?.sacrifice ?? 0;
        const pool = board.getLivingUnitsOnSide('player').slice();
        const toConsume = [];
        for (const matId of (cost?.materials ?? [])) {
          const idx = pool.findIndex(u => _matchesMaterial(u, matId));
          if (idx !== -1) { toConsume.push(pool[idx]); pool.splice(idx, 1); }
        }
        let remaining = sacrifice - toConsume.reduce((s, u) => s + (u.material_value ?? 1), 0);
        for (const u of pool) {
          if (remaining <= 0) break;
          toConsume.push(u);
          remaining -= (u.material_value ?? 1);
        }
        for (const u of toConsume) board.removeUnit(u);
        consumed = toConsume;
      }
      unit.material_value = cost?.sacrifice || 1;
      _transferShoppingBonuses(unit, consumed);
      break;
    }

    case 'transformation': {
      _removeFromHand(hand, card.id, handIdx);
      if (!card._free_transformation) {
        const targetId = cost?.materials?.[0];
        // Prefer the explicitly-passed unit (fixes same-name ambiguity). Otherwise fall back to
        // the exact same resolution the UI used to pick/highlight the target cell — using a
        // plain "first match" here instead would silently consume a different unit than the one
        // the player tapped, losing whatever Shopping Phase bonus was on the intended unit.
        const targetUnit = sacrificeTargets?.find(u => _materialLineageMatches(u, targetId, [targetId]))
          ?? resolveTransformationTarget({ ...card, cost }, board);
        if (targetUnit) {
          // Une unité encore sur le board cède sa case ; une unité du cimetière n'a plus
          // de case valide (sa .position est l'ancienne position de combat) — garder le pos
          // tapé par le joueur dans ce cas.
          if (board.getUnit(targetUnit.position) === targetUnit) {
            pos = { ...targetUnit.position };
          }
          board.removeUnit(targetUnit);
          _transferShoppingBonuses(unit, [targetUnit]);
        }
      }
      break;
    }
  }

  board.placeUnit(unit, pos);
  return unit;
}

// Carries Shopping Phase bonuses from consumed/replaced units onto the resulting composite
// unit: permanent stat bonuses (stat_bonus/stat_modifier magies — including any negative
// stat traded off against another, e.g. -5 attack_speed for +15 atk) plus any still-unused
// shield (shield magie), which would otherwise be silently lost. Also carries over
// veterancy points — taking the highest value among consumed units rather than summing,
// so chaining materials can't be used to farm veterancy.
function _transferShoppingBonuses(unit, consumedUnits) {
  const summed = {};
  let shieldTotal = 0;
  let veterancyMax = 0;
  for (const u of consumedUnits) {
    const bonus = u._shopping_bonus;
    if (bonus) {
      for (const [stat, value] of Object.entries(bonus)) {
        summed[stat] = (summed[stat] || 0) + value;
      }
    }
    shieldTotal += u.shield || 0;
    veterancyMax = Math.max(veterancyMax, u.veterancy_points || 0);
  }
  const entries = Object.entries(summed);
  if (entries.length > 0) {
    unit._shopping_bonus = unit._shopping_bonus || {};
    for (const [stat, value] of entries) {
      unit._base[stat] = (unit._base[stat] ?? 0) + value;
      unit._shopping_bonus[stat] = (unit._shopping_bonus[stat] || 0) + value;
    }
    unit._recomputeStats();
  }
  if (shieldTotal > 0) unit.applyShield(shieldTotal);
  if (veterancyMax > 0) unit.veterancy_points = Math.max(unit.veterancy_points, veterancyMax);
}

function _removeFromHand(hand, cardId, atIdx = null) {
  const idx = (atIdx !== null && hand[atIdx]?.id === cardId)
    ? atIdx
    : hand.findIndex(c => c.id === cardId);
  if (idx !== -1) hand.splice(idx, 1);
}

function ok()         { return { ok: true,  reason: '' }; }
function fail(reason) { return { ok: false, reason }; }

// A material requirement matches either a specific card ID or an attribute ID.
// Transformation results count as the original monster (represented_ids).
export function matchesMaterial(unit, matId) {
  if (matId.startsWith('ARCH_')) return unit.attributes?.includes(matId) ?? false;
  return unit.represented_ids?.includes(matId) ?? unit.card_id === matId;
}
const _matchesMaterial = matchesMaterial;

// Single source of truth for "which board unit does this Transformation consume when the
// player didn't explicitly tap a specific unit". Mirrors InvocationRules.transformTargetCells'
// preference (an existing duplicate of the transformation's own result, to avoid ending up with
// two living copies) so the cell the UI highlights always matches the unit actually consumed.
export function resolveTransformationTarget(card, board) {
  const targetId = card.cost?.materials?.[0];
  if (!targetId) return null;
  const matches = board.getLivingUnitsOnSide('player').filter(u => materialLineageMatches(u, targetId, [targetId]));
  return matches.find(u => u.card_id === card.id) ?? matches[0] ?? null;
}

// A composite unit (built via a previous fusion/heritage/transformation) can only stand in for a
// fusion material slot if every id it itself was built from is also required by THIS fusion.
// Ex: "Aile de feu" (fusion d'Avian+Burstinatrix) ne peut pas remplacer Avian seul pour Marin
// (qui ne requiert pas Burstinatrix), mais peut remplacer Avian+Burstinatrix à la fois pour
// Electrum (qui requiert les deux) puisqu'elle ne "représente" rien hors de ce qui est demandé.
// Exception : si la carte elle-même (son propre card_id) est un des matériaux requis, elle est
// utilisée comme elle-même (pas comme substitut) — sa lignée d'origine n'a alors pas d'importance.
// Ex: "Géant du tonnerre" (lui-même issu d'une Fusion) reste un matériel valide pour la
// Transformation "Géant du Tonnerre Voltaïques" qui le requiert nommément.
export function materialLineageLegit(unit, requiredMaterials) {
  if (requiredMaterials.includes(unit.card_id)) return true;
  const inherited = (unit.represented_ids ?? [unit.card_id]).filter(id => id !== unit.card_id);
  return inherited.every(id => requiredMaterials.includes(id));
}

// matchesMaterial + materialLineageLegit combined — the check to use for fusion material candidates.
export function materialLineageMatches(unit, matId, requiredMaterials) {
  if (!matchesMaterial(unit, matId)) return false;
  if (matId.startsWith('ARCH_')) return true;
  return materialLineageLegit(unit, requiredMaterials);
}
const _materialLineageMatches = materialLineageMatches;

// Total material "slots" represented by a list of units.
export function sumMaterialValue(units) {
  return units.reduce((sum, u) => sum + (u.material_value ?? 1), 0);
}
const _sumMaterialValue = sumMaterialValue;

// Take units one by one until their combined material_value reaches `needed`.
function _takeByMaterialValue(units, needed) {
  const taken = [];
  let total = 0;
  for (const u of units) {
    if (total >= needed) break;
    taken.push(u);
    total += (u.material_value ?? 1);
  }
  return taken;
}
