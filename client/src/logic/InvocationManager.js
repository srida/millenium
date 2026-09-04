import { Unit, materialValueOf } from './Unit.js';

// Ré-exporté ici parce que c'est la question « que vaut cette carte comme
// matériau ? », qui appartient au vocabulaire de l'invocation ; la définition
// vit dans `Unit`, seul endroit qui l'écrit.
export { materialValueOf };

/**
 * Valide et exécute les invocations.
 *
 * Une carte porte zéro, une ou plusieurs CONDITIONS (`summon_conditions`) ; elle
 * est jouable dès qu'une seule est satisfaite. Une condition exige un nombre de
 * slots de matériau (`materials`, compté en `material_value`) dont une partie
 * peut être nommée (`requires` : ids de carte ou d'attribut). Aucune condition
 * = invocation directe.
 *
 * ⚠️ Il n'y a plus de « voie » d'invocation : les cinq notions historiques
 * (normale, sacrifice, fusion, héritage, transformation) sont devenues des
 * ATTRIBUTS de carte, purement descriptifs. Le moteur ne connaît qu'un coût.
 *
 * hand: Card[] (mutable — les cartes en sont retirées à l'invocation)
 * board: Board
 */

/** Les conditions d'une carte ; `[]` quand elle n'en a aucune. */
export function summonConditions(card) {
  const list = card?.summon_conditions;
  return Array.isArray(list) ? list : [];
}

/** La condition d'index `i`, ou la première ; `null` si la carte n'en a aucune. */
export function conditionAt(card, index = null) {
  const list = summonConditions(card);
  if (list.length === 0) return null;
  return list[index ?? 0] ?? null;
}

/** Combien de slots de matériau cette condition réclame. */
export function conditionMaterials(condition) {
  return Math.max(0, condition?.materials ?? 0);
}

/** Les exigences nommées de cette condition — un sous-ensemble de ses slots. */
export function conditionRequires(condition) {
  return condition?.requires ?? [];
}

/** Une condition qui n'exige rien : la carte se pose directement. */
export function conditionIsFree(condition) {
  return conditionMaterials(condition) === 0 && conditionRequires(condition).length === 0;
}

/**
 * Ce que la carte coûte au moins, en slots de matériau — sa voie la moins
 * chère. Zéro pour une carte sans condition.
 *
 * ⚠️ SEUL endroit qui répond à « quel genre d'invocation est-ce ». Il y en
 * avait trois : la table de priorité de l'IA, celle de l'auto-joueur, et
 * l'agrégat par voie du rapport d'équilibrage — trois copies d'une même
 * question, dont la simulation mesurait la version la plus ancienne.
 */
export function summonCost(card) {
  const conditions = summonConditions(card);
  if (conditions.length === 0) return 0;
  return Math.min(...conditions.map(conditionMaterials));
}

/**
 * La carte a-t-elle plusieurs voies ? Ne sert qu'à l'UI (menu de choix) et à
 * l'IA (essayer chaque condition) — le moteur, lui, raisonne toujours sur UNE
 * condition résolue.
 */
export function hasMultipleConditions(card) {
  return summonConditions(card).length > 1;
}

/**
 * Une invocation ne coûte un slot de board que pour ce qu'elle n'a pas libéré
 * elle-même : les matériaux pris SUR LE BOARD rendent leur case, ceux pris au
 * CIMETIÈRE n'en rendent aucune.
 *
 * ⚠️ La Transformation n'a plus de cas particulier : consommer un matériau du
 * board et reposer une unité donne `vivants − 1 + 1`, soit exactement zéro slot
 * consommé — la règle générale le dit déjà. Corollaire assumé : une condition
 * satisfaite depuis le seul cimetière est désormais refusée sur un board plein,
 * là où la Transformation y échappait par exception.
 */
export function exceedsBoardSlots(card, selectedMaterials, board, graveyard, playerBoardSlots) {
  const materialsOnBoard = selectedMaterials.filter(u => !graveyard.includes(u)).length;
  const afterPlace = board.getLivingUnitsOnSide('player').length - materialsOnBoard + 1;
  return afterPlace > playerBoardSlots;
}

/**
 * Peut-on poser `card` en `pos` ?
 *
 * Sans `conditionIndex`, une carte à plusieurs conditions rend l'état de CHACUNE
 * (`{ options: [...] }`) au lieu d'un verdict — c'est ce que l'UI affiche dans
 * son menu de choix. Avec un index, le verdict porte sur cette seule condition.
 */
export function canSummon(card, pos, board, hand, graveyard = [], selectedMaterials = [], conditionIndex = null) {
  if (!board.isInBounds(pos)) return fail('Position hors limites');
  if (!board.isPlayerCell(pos)) return fail('Placement uniquement sur le côté joueur (rangées 0–3)');

  const conditions = summonConditions(card);
  if (conditions.length > 1 && (conditionIndex === null || conditionIndex === undefined)) {
    return {
      options: conditions.map((condition, index) => {
        const res = _canSummonWith(card, condition, pos, board, graveyard, selectedMaterials);
        return { index, condition, ok: res.ok, reason: res.reason };
      }),
    };
  }

  if (conditionIndex !== null && conditionIndex !== undefined && conditions.length > 0) {
    const condition = conditions[conditionIndex];
    if (!condition) return fail("Condition d'invocation invalide");
    return _canSummonWith(card, condition, pos, board, graveyard, selectedMaterials);
  }

  return _canSummonWith(card, conditions[0] ?? null, pos, board, graveyard, selectedMaterials);
}

/**
 * Les cinq règles, et rien d'autre. Elles remplacent les cinq branches par voie
 * d'invocation : chacune était un cas particulier de l'une d'elles.
 */
function _canSummonWith(card, condition, pos, board, graveyard, selectedMaterials) {
  const living = board.getLivingUnitsOnSide('player');

  // 1. La case doit être libre, OU occupée par une unité qu'on consomme —
  //    c'est ce qui permet de reposer le résultat sur la case d'un matériau
  //    (l'ancienne Transformation, généralisée à toutes les conditions).
  if (board.isOccupied(pos)) {
    const occupant = board.getUnit(pos);
    if (!selectedMaterials.includes(occupant))
      return fail('Case occupée');
  }

  // 2. Jamais deux exemplaires vivants de la même carte : un doublon présent
  //    doit être consommé. Sans condition il n'y a aucun matériau à
  //    sélectionner, donc la carte est refusée — l'ancienne règle du placement
  //    normal tombe d'elle-même, il n'y a rien à écrire pour elle.
  const duplicate = living.find(u => u.card_id === card.id);
  if (duplicate && !selectedMaterials.includes(duplicate)) {
    return fail('Le doublon présent sur le terrain doit être sélectionné comme matériau');
  }

  if (!condition || conditionIsFree(condition)) return ok();

  const needed = conditionMaterials(condition);
  const required = conditionRequires(condition);

  // 3. Quantité — disponible partout (terrain + cimetière) ; c'est la
  //    sélection, pas cette garde, qui décide d'où viennent les matériaux.
  const available = [...board.getUnitsOnSide('player').filter(u => u.isAlive()), ...graveyard];
  if (sumMaterialValue(available) < needed)
    return fail(`Requiert ${needed} matériel(s) sur le terrain ou au cimetière`);

  // 4. Exigences nommées — appariées à des unités DISTINCTES (glouton), chacune
  //    devant être une doublure légitime (lignée).
  const pool = [...available];
  for (const matId of required) {
    const idx = pool.findIndex(u => materialLineageMatches(u, matId, required));
    if (idx === -1) return fail(`Matériel manquant sur le terrain ou au cimetière : ${matId}`);
    pool.splice(idx, 1);
  }

  return ok();
}

/**
 * Exécute l'invocation. Suppose que `canSummon` a rendu ok.
 *
 * @param {Object} card
 * @param {{col,row}} pos
 * @param {Board} board
 * @param {Card[]} hand - main mutable
 * @param {Unit[]} materials - les unités à consommer ; `null` laisse l'appelant
 *        (l'IA) s'en remettre à une sélection automatique.
 * @param {number} handIdx
 * @param {number} conditionIndex - la condition retenue quand la carte en a plusieurs
 * @returns {Unit}
 */
export function summon(card, pos, board, hand, materials = null, handIdx = null, conditionIndex = null) {
  const condition = conditionAt(card, conditionIndex);
  const unit = new Unit(card, 'player');

  _removeFromHand(hand, card.id, handIdx);

  const consumed = (condition && !conditionIsFree(condition))
    ? (materials?.length ? [...materials] : _autoSelectMaterials(card, condition, board, []))
    : [];

  // ⚠️ Les matériaux partent AVANT la pose : `pos` peut être la case de l'un
  // d'eux (règle 1), et `placeUnit` jette sur une case occupée. C'est aussi ce
  // qui fait que l'unité produite reprend la case de son matériau sans une
  // ligne pour le dire — l'ancienne Transformation n'était que ce cas-là.
  for (const u of consumed) board.removeUnit(u);

  _transferShoppingBonuses(unit, consumed);
  board.placeUnit(unit, pos);
  return unit;
}

/**
 * Le jeu de matériaux qu'une condition consomme quand personne ne l'a désigné.
 *
 * ⚠️ Sert DEUX appelants qui ne doivent pas diverger : l'IA, qui invoque sans
 * passer par l'UI, et la pré-sélection du joueur quand la condition n'admet
 * qu'une seule lecture. Les exigences nommées d'abord (elles contraignent),
 * le remplissage ensuite.
 */
export function autoSelectMaterials(card, condition, board, graveyard = []) {
  return _autoSelectMaterials(card, condition, board, graveyard);
}

function _autoSelectMaterials(card, condition, board, graveyard) {
  if (!condition || conditionIsFree(condition)) return [];
  const required = conditionRequires(condition);
  const needed = conditionMaterials(condition);
  const onBoard = board.getLivingUnitsOnSide('player');
  const pool = [...onBoard, ...graveyard];
  const chosen = [];

  // Un doublon vivant du résultat DOIT être consommé (règle 2) : il passe donc
  // en tête, avant même les exigences nommées, sinon la sélection automatique
  // produirait un jeu que `canSummon` refuse.
  const duplicate = onBoard.find(u => u.card_id === card.id);
  if (duplicate) {
    chosen.push(duplicate);
    pool.splice(pool.indexOf(duplicate), 1);
  }

  for (const matId of required) {
    if (chosen.some(u => matchesMaterial(u, matId))) continue;
    const idx = pool.findIndex(u => materialLineageMatches(u, matId, required));
    if (idx === -1) continue;
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }

  for (const u of pool) {
    if (sumMaterialValue(chosen) >= needed) break;
    chosen.push(u);
  }
  return chosen;
}

// Reporte les bonus de Phase Shopping des unités consommées sur le composite :
// deltas de stats permanents (magies stat_bonus/stat_modifier, y compris un
// malus consenti contre un bonus) et bouclier restant, qui seraient sinon
// perdus en silence. Les points de vétérance suivent en MAXIMUM et non en
// somme — enchaîner les matériaux ne doit pas permettre de la farmer.
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

// Une exigence désigne un ATTRIBUT (n'importe quelle unité qui le porte) plutôt
// qu'une carte précise. Seul endroit qui décide de ce préfixe — le tooltip le
// lit aussi, pour nommer l'exigence dans la base d'attributs et non celle des
// cartes.
export function isAttributeMaterial(matId) {
  return typeof matId === 'string' && matId.startsWith('ARCH_');
}

// Une exigence est satisfaite par un id de carte ou par un attribut. Un
// composite compte pour les cartes qu'il représente (represented_ids).
export function matchesMaterial(unit, matId) {
  if (isAttributeMaterial(matId)) return unit.attributes?.includes(matId) ?? false;
  return unit.represented_ids?.includes(matId) ?? unit.card_id === matId;
}

/**
 * Une unité composite ne peut tenir le rôle d'une exigence que si TOUTE la
 * lignée dont elle hérite est elle-même exigée par la condition en cours.
 * Ex. « Aile de feu » (Avian + Burstinatrix) ne remplace pas Avian seul, mais
 * comble à elle seule les deux exigences d'une condition qui demande les deux.
 * Exception : si la carte est nommée pour elle-même, sa lignée n'importe pas.
 */
export function materialLineageLegit(unit, requiredMaterials) {
  if (requiredMaterials.includes(unit.card_id)) return true;
  const inherited = (unit.represented_ids ?? [unit.card_id]).filter(id => id !== unit.card_id);
  return inherited.every(id => requiredMaterials.includes(id));
}

// matchesMaterial + materialLineageLegit — le test à utiliser pour un candidat.
export function materialLineageMatches(unit, matId, requiredMaterials) {
  if (!matchesMaterial(unit, matId)) return false;
  if (isAttributeMaterial(matId)) return true;
  return materialLineageLegit(unit, requiredMaterials);
}

// Total des slots représentés par une liste d'unités.
export function sumMaterialValue(units) {
  return units.reduce((sum, u) => sum + (u.material_value ?? 1), 0);
}
