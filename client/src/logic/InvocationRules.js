import {
  materialLineageMatches, sumMaterialValue,
  canSummon, exceedsBoardSlots, summonConditions, conditionAt, conditionMaterials,
  conditionRequires, conditionIsFree,
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
  // ⚠️ La lignée ne pèse QUE sur les exigences nommées, et c'est
  // `getUncoveredRequirements` qui la porte : une unité qui paie un slot LIBRE
  // n'est la doublure de personne. Exigée de toute la sélection, elle rendait
  // insacrifiable la moindre unité composite (une fusion hérite d'une lignée
  // qu'un coût nu ne nomme jamais).
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
 * ⚠️ Il n'y a PAS de pré-sélection de matériaux, et c'est délibéré : l'UI ne
 * désigne jamais un matériau à la place du joueur. Le liseré blanc annonce une
 * unité RETENUE — la poser avant tout geste annonce une dépense que personne
 * n'a consentie. Le geste en un tap de l'ancienne Transformation est porté par
 * `GameController.onUnitTap`, qui pose directement dès que le tap complète la
 * sélection ; il n'a rien à pré-cocher pour ça.
 */

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

  if (uncovered.length > 0 && uncovered.length >= remainingSlots) {
    // Plus de mou : seules les unités qui couvrent une exigence restante — et
    // c'est le seul cas où la lignée pèse.
    return withDuplicate(available.filter(u => uncovered.some(matId => materialLineageMatches(u, matId, required))));
  }
  // Il reste du mou : un slot libre se paie avec n'importe quelle unité.
  return withDuplicate(available);
}

/**
 * L'état de chaque condition d'une carte à voies multiples — le menu de choix
 * affiché en main, avant toute case ou matériau. `null` quand il n'y a rien à
 * choisir.
 */
export function summonConditionsStatus(card, board, graveyard = [], maxSlots = Infinity) {
  const conditions = summonConditions(card);
  if (conditions.length <= 1) return null;
  return conditions.map((condition, index) => {
    const verdict = _playableWith(card, condition, board, graveyard, maxSlots);
    return { index, condition, ok: verdict.ok, reason: verdict.reason };
  });
}

/**
 * La carte est-elle potentiellement jouable en l'état ? Sert à griser la main.
 * Volontairement indulgent : ne réclame pas de case libre quand l'invocation en
 * libère elle-même.
 */
export function isPlayable(card, board, graveyard = [], maxSlots = Infinity) {
  const conditions = summonConditions(card);
  if (conditions.length === 0) return _playableWith(card, null, board, graveyard, maxSlots).ok;
  return conditions.some(condition => _playableWith(card, condition, board, graveyard, maxSlots).ok);
}

/**
 * ⚠️ Rend un MOTIF et pas seulement un booléen : le menu de conditions grise
 * les voies impossibles, et un bouton éteint sans raison laisse chercher. Le
 * motif est celui de la première règle qui refuse — même discipline que
 * `canSummon`, dont c'est le pendant « sans case ».
 */
function _playableWith(card, condition, board, graveyard, maxSlots) {
  const no = (reason) => ({ ok: false, reason });
  const living = board.getLivingUnitsOnSide('player');
  const duplicate = living.find(u => u.card_id === card.id);

  if (!condition || conditionIsFree(condition)) {
    // Sans matériau à consommer, un doublon vivant interdit la pose et il n'y a
    // pas de case à libérer : il faut donc une case déjà vide.
    if (duplicate) return no('Un exemplaire vit déjà sur le terrain');
    if (living.length >= maxSlots) return no('Plus de slot libre');
    return hasEmptyPlayerCell(board) ? { ok: true, reason: '' } : no('Aucune case libre');
  }

  const required = conditionRequires(condition);
  const available = [...living, ...graveyard];
  if (sumMaterialValue(available) < conditionMaterials(condition))
    return no(`Requiert ${conditionMaterials(condition)} matériel(s) sur le terrain ou au cimetière`);
  const uncovered = getUncoveredRequirements(required, available);
  // ⚠️ Le motif ne NOMME pas ce qui manque : `logic/` ne sait pas traduire un id
  // de carte ou d'attribut en nom, et un `ARCH_047` lâché dans une modale est
  // du bruit. La recette affichée juste au-dessus, elle, les nomme déjà.
  if (uncovered.length > 0)
    return no(uncovered.length > 1 ? 'Matériels manquants' : 'Matériel manquant');

  // Le doublon, s'il existe, est consommable : il compte parmi les matériaux.
  // ⚠️ Un coût satisfait uniquement au cimetière ne libère aucun SLOT (le
  // cimetière n'en occupe pas), il faut donc que le plafond soit encore ouvert.
  if (living.length >= maxSlots && !available.some(u => living.includes(u))) return no('Plus de slot libre');
  // Une CASE, en revanche, il y en a toujours une : `summon` retire du board
  // tous les matériaux consommés, cimetière compris.
  return { ok: true, reason: '' };
}

/**
 * Le sous-ensemble de `required` que `selectedUnits` ne couvre pas encore
 * (glouton, stable dans l'ordre). Une unité ne couvre qu'UNE exigence.
 *
 * ⚠️ Le test est `materialLineageMatches` et non `matchesMaterial` : c'est ICI,
 * et nulle part ailleurs, que la légitimité de lignée pèse — une doublure ne
 * tient le rôle d'une exigence nommée que si tout ce dont elle hérite est
 * lui-même exigé. Portée sur la sélection entière, la règle interdisait de
 * dépenser une unité composite dans un slot LIBRE ; portée ici, elle dit
 * exactement ce qu'elle a toujours voulu dire.
 */
export function getUncoveredRequirements(required, selectedUnits) {
  const pool = [...selectedUnits];
  return required.filter(matId => {
    const idx = pool.findIndex(u => materialLineageMatches(u, matId, required));
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
