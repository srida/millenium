import {
  matchesMaterial, materialLineageLegit, materialLineageMatches, sumMaterialValue,
  canSummon, exceedsBoardSlots, summonConditions, conditionAt, conditionMaterials,
  conditionRequires, conditionIsFree, autoSelectMaterials,
} from './InvocationManager.js';

/**
 * Lectures PURES de l'état d'invocation — ce que l'UI a besoin de savoir avant
 * que le joueur ne tape (cases valides, matériaux candidats, carte jouable).
 * Aucune mutation.
 *
 * Chaque fonction raisonne sur UNE condition résolue (`conditionIndex`), jamais
 * sur une « voie » : il n'y a plus de branche par type d'invocation ici, c'est
 * tout l'objet de la refonte.
 */

/** La condition visée, ou la première quand la carte n'en a qu'une. */
function _condition(card, conditionIndex) {
  return conditionAt(card, conditionIndex);
}

/**
 * Faut-il désigner des matériaux avant de pouvoir poser la carte ?
 *
 * Ne dépend plus que de la condition : une condition qui exige quelque chose
 * demande une sélection, les autres non. Le board n'a plus rien à dire ici —
 * l'ancienne version l'interrogeait pour savoir si la cible d'une
 * Transformation était vivante, un cas qui n'existe plus.
 */
export function needsMaterials(card, conditionIndex = null) {
  const condition = _condition(card, conditionIndex);
  return !!condition && !conditionIsFree(condition);
}

/** La sélection en cours satisfait-elle la condition ? */
export function materialsComplete(card, mats, conditionIndex = null, board = null) {
  const condition = _condition(card, conditionIndex);
  if (!condition || conditionIsFree(condition)) return true;

  const required = conditionRequires(condition);
  if (!mats.every(u => materialLineageLegit(u, required))) return false;
  if (getUncoveredRequirements(required, mats).length > 0) return false;
  if (sumMaterialValue(mats) < conditionMaterials(condition)) return false;

  // Un doublon vivant du résultat doit figurer dans la sélection, sans quoi
  // `canSummon` refusera au moment de poser.
  if (board) {
    const duplicate = board.getLivingUnitsOnSide('player').find(u => u.card_id === card.id);
    if (duplicate && !mats.includes(duplicate)) return false;
  }
  return true;
}

/**
 * La sélection que l'UI peut poser d'office parce que la condition n'en admet
 * qu'une seule lecture — c'est ce qui préserve le geste en UN TAP de l'ancienne
 * Transformation (taper le monstre à remplacer suffisait).
 *
 * ⚠️ Ne pré-sélectionne QUE si le choix est forcé : dès qu'un matériau est
 * substituable, c'est au joueur de trancher (il sait, lui, ce qu'il veut garder).
 */
export function forcedMaterials(card, board, graveyard = [], conditionIndex = null) {
  const condition = _condition(card, conditionIndex);
  if (!condition || conditionIsFree(condition)) return [];

  const usable = [...board.getLivingUnitsOnSide('player'), ...graveyard]
    .filter(u => materialLineageLegit(u, conditionRequires(condition)));

  // Le choix n'est forcé que si TOUT ce qui est utilisable est exactement ce
  // qu'il faut : un slot de mou, et c'est au joueur de dire ce qu'il sacrifie.
  if (sumMaterialValue(usable) !== conditionMaterials(condition)) return [];

  const auto = autoSelectMaterials(card, condition, board, graveyard);
  return materialsComplete(card, auto, conditionIndex, board) ? auto : [];
}

/** Positions des unités du board encore sélectionnables comme matériau. */
export function materialCandidateCells(card, alreadySelected, board, conditionIndex = null) {
  const condition = _condition(card, conditionIndex);
  if (!condition || conditionIsFree(condition)) return [];

  const units = board.getLivingUnitsOnSide('player');
  const selected = new Set(alreadySelected);
  return _candidates(card, condition, alreadySelected, units.filter(u => !selected.has(u)), board)
    .map(u => ({ ...u.position }));
}

/** Unités du cimetière encore sélectionnables comme matériau. */
export function materialCandidateGraveyard(card, alreadySelected, graveyard, board, conditionIndex = null) {
  const condition = _condition(card, conditionIndex);
  if (!condition || conditionIsFree(condition) || !graveyard.length) return [];

  const selected = new Set(alreadySelected);
  return _candidates(card, condition, alreadySelected, graveyard.filter(u => !selected.has(u)), board);
}

/**
 * Le cœur du filtrage des candidats, partagé par le terrain et le cimetière —
 * une seule écriture de la règle pour les deux provenances.
 *
 * Trois cas se succèdent : la sélection est déjà complète (plus rien, sauf le
 * doublon qu'il faut encore manger) ; il reste juste assez de slots pour les
 * exigences non couvertes (seules elles sont proposées) ; ou il reste du mou
 * (n'importe quelle unité légitime fait l'affaire).
 */
function _candidates(card, condition, alreadySelected, available, board) {
  const required = conditionRequires(condition);
  const needed = conditionMaterials(condition);
  const selected = new Set(alreadySelected);

  // Un doublon vivant du résultat reste toujours proposé tant qu'il n'est pas
  // pris : sans lui la sélection ne sera jamais posable.
  const duplicate = board.getLivingUnitsOnSide('player').find(u => u.card_id === card.id && !selected.has(u));
  const withDuplicate = (list) => {
    if (duplicate && available.includes(duplicate) && !list.includes(duplicate)) return [...list, duplicate];
    return list;
  };

  if (sumMaterialValue(alreadySelected) >= needed) return withDuplicate([]);

  const uncovered = getUncoveredRequirements(required, alreadySelected);
  const remainingSlots = needed - sumMaterialValue(alreadySelected);
  const legit = available.filter(u => materialLineageLegit(u, required));

  if (uncovered.length > 0 && uncovered.length >= remainingSlots) {
    // Plus de mou : seules les unités qui couvrent une exigence restante.
    return withDuplicate(legit.filter(u => uncovered.some(matId => materialLineageMatches(u, matId, required))));
  }
  return withDuplicate(legit);
}

/**
 * L'état de chaque condition d'une carte à voies multiples — le menu de choix
 * affiché en main, avant toute case ou matériau. `null` quand il n'y a rien à
 * choisir.
 */
export function summonConditionsStatus(card, board, graveyard = [], maxSlots = Infinity) {
  const conditions = summonConditions(card);
  if (conditions.length <= 1) return null;
  return conditions.map((condition, index) => ({
    index,
    condition,
    ok: _isPlayableWith(card, condition, board, graveyard, maxSlots),
  }));
}

/**
 * La carte est-elle potentiellement jouable en l'état ? Sert à griser la main.
 * Volontairement indulgent : ne réclame pas de case libre quand l'invocation en
 * libère elle-même.
 */
export function isPlayable(card, board, graveyard = [], maxSlots = Infinity) {
  const conditions = summonConditions(card);
  if (conditions.length === 0) return _isPlayableWith(card, null, board, graveyard, maxSlots);
  return conditions.some(condition => _isPlayableWith(card, condition, board, graveyard, maxSlots));
}

function _isPlayableWith(card, condition, board, graveyard, maxSlots) {
  const living = board.getLivingUnitsOnSide('player');
  const duplicate = living.find(u => u.card_id === card.id);

  if (!condition || conditionIsFree(condition)) {
    // Sans matériau à consommer, un doublon vivant interdit la pose et il n'y a
    // pas de case à libérer : il faut donc une case déjà vide.
    if (duplicate) return false;
    if (living.length >= maxSlots) return false;
    return hasEmptyPlayerCell(board);
  }

  const required = conditionRequires(condition);
  const available = [...living, ...graveyard];
  if (sumMaterialValue(available) < conditionMaterials(condition)) return false;
  if (getUncoveredRequirements(required, available.filter(u => materialLineageLegit(u, required))).length > 0)
    return false;

  // Le doublon, s'il existe, est consommable : il compte parmi les matériaux.
  // ⚠️ Un coût satisfait uniquement au cimetière ne libère aucun SLOT (le
  // cimetière n'en occupe pas), il faut donc que le plafond soit encore ouvert.
  if (living.length >= maxSlots && !available.some(u => living.includes(u))) return false;
  // Une CASE, en revanche, il y en a toujours une : `summon` retire du board
  // tous les matériaux consommés, cimetière compris.
  return true;
}

/**
 * Le sous-ensemble de `required` que `selectedUnits` ne couvre pas encore
 * (glouton, stable dans l'ordre). Une unité ne couvre qu'UNE exigence.
 */
export function getUncoveredRequirements(required, selectedUnits) {
  const pool = [...selectedUnits];
  return required.filter(matId => {
    const idx = pool.findIndex(u => matchesMaterial(u, matId));
    if (idx !== -1) { pool.splice(idx, 1); return false; }
    return true;
  });
}

export function hasEmptyPlayerCell(board) {
  for (let r = 0; r <= 3; r++)
    for (let c = 0; c < 5; c++)
      if (!board.isOccupied({ col: c, row: r })) return true;
  return false;
}

/**
 * Les cases où `card` peut être posée compte tenu de la sélection en cours.
 *
 * ⚠️ Les cases des matériaux sélectionnés en font partie : elles seront libres
 * au moment de la pose. Cimetière COMPRIS — un corps neutralisé occupe encore
 * une case, et `summon` le retire du board comme les autres. L'exclure ici
 * rendait injouable, faute de case, toute condition payée au seul cimetière.
 *
 * Sur une condition à un matériel, `canSummon` n'en laissera passer qu'une : la
 * case de ce matériel.
 */
export function validCells(card, { board, graveyard, selectedMaterials, playerBoardSlots, conditionIndex = null }) {
  if (needsMaterials(card, conditionIndex)
      && !materialsComplete(card, selectedMaterials, conditionIndex, board)) return [];

  if (exceedsBoardSlots(card, selectedMaterials, board, graveyard, playerBoardSlots)) return [];

  const freed = new Set(
    selectedMaterials
      .filter(u => u.position && board.getUnit(u.position) === u)
      .map(u => `${u.position.col},${u.position.row}`)
  );

  const cells = [];
  for (let r = 0; r <= 3; r++)
    for (let c = 0; c < 5; c++) {
      const pos = { col: c, row: r };
      // Une case libérée par un matériau vaut une case vide : `canSummon` le
      // dit déjà (règle 1), on lui laisse le dernier mot dans les deux cas.
      if ((freed.has(`${c},${r}`) || !board.isOccupied(pos))
          && canSummon(card, pos, board, null, graveyard, selectedMaterials, conditionIndex).ok) {
        cells.push(pos);
      }
    }
  return cells;
}
