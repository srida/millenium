import { guaranteedDrawCriteria } from './Draw.js';
import { clampRate, rateForTicks, RATE_STATS } from '../../../speed-scale.mjs';

export const STAT_NAMES = {
  atk: 'ATK', hp: 'HP', attack_rate: 'Vit. attaque',
  movement_rate: 'Vit. déplacement', range: 'Portée',
};

// Records the actual permanent _base delta granted by a Shopping Phase magie, so that
// InvocationManager can transfer it onto a composite unit if this unit is later consumed
// as material (sacrifice/fusion/heritage) or replaced (transformation).
function _trackShoppingBonus(unit, stat, delta) {
  if (!delta) return;
  unit._shopping_bonus = unit._shopping_bonus || {};
  unit._shopping_bonus[stat] = (unit._shopping_bonus[stat] || 0) + delta;
}

/**
 * Écrit une stat de base en respectant SA borne, et rend le delta réellement
 * consenti (celui qu'il faut tracer, jamais celui qui était demandé).
 *
 * ⚠️ Les deux rythmes ne se plafonnent pas comme les autres stats : un compteur
 * vit dans [0, 100] — 0 est légitime (le plus lent), et le plafond 100 est
 * précisément la limite que l'échelle existe pour poser. Le `Math.max(1, …)`
 * commun les aurait laissés monter sans fin d'un côté et interdit le zéro de
 * l'autre. C'est la seule bifurcation par stat du fichier, et elle lit la borne
 * dans `speed-scale.mjs` plutôt que de la recopier.
 */
function _writeBaseStat(unit, stat, next) {
  const before = unit._base[stat] ?? 0;
  unit._base[stat] = RATE_STATS.includes(stat) ? clampRate(next) : Math.max(1, next);
  const delta = unit._base[stat] - before;
  _trackShoppingBonus(unit, stat, delta);
  return delta;
}

/**
 * Contrecoup : ce que la magie coûte en PV JOUEUR. Champ de premier niveau
 * (`magie.cost_hp`) et non un champ d'`effect`, car il est orthogonal à
 * l'effet — n'importe quel type peut porter un coût. Absent, nul, négatif ou
 * mal saisi valent tous « aucun contrecoup » : une magie gratuite est le cas
 * normal, et une donnée douteuse ne doit jamais coûter des PV au joueur.
 * @param {any} magie
 * @returns {number}
 */
export function magieCostHp(magie) {
  const raw = Number(magie?.cost_hp);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
}

/**
 * ⚠️ Comparaison STRICTE : payer doit laisser le joueur à 1 PV au moins. Un
 * coût qui tue n'est pas un choix, et la modale de shopping n'a pas de
 * confirmation — un tap malheureux perdrait la partie. Corollaire utile : à
 * coût nul, la règle se réduit à « le joueur est en vie ».
 * @param {any} magie
 * @param {number} playerHp
 * @returns {boolean}
 */
export function canAffordMagie(magie, playerHp) {
  return playerHp > magieCostHp(magie);
}

/**
 * Combien d'exemplaires rend une magie de duplication (`duplicate_unit`,
 * `duplicate_card`). Lecture UNIQUE du champ : `GameSession` s'en sert pour
 * livrer, `effectLabel` pour l'annoncer — deux lectures divergeraient.
 *
 * ⚠️ Le repli est celui de `powerValue` côté combat, et pour la même raison :
 * une **Valeur laissée à 0** en admin (le défaut du champ) se lit « non
 * renseignée » et rend UNE copie, jamais « zéro copie ». Une magie offerte qui
 * ne rend rien est très précisément le blanc que le filtre d'offre existe pour
 * supprimer — et elle aurait encaissé son contrecoup au passage.
 * @param {any} magie
 * @returns {number}
 */
export function duplicateCopies(magie) {
  const raw = Number(magie?.effect?.value);
  return Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.round(raw)) : 1;
}

/**
 * De combien de tiers une magie de remplacement décale sa cible
 * (`shift_tier_card`, `shift_tier_unit`). Lecture UNIQUE du champ : `GameSession`
 * s'en sert pour composer le pool, `MagieOffer` pour la pertinence et
 * `effectLabel` pour l'annoncer — trois lectures divergeraient.
 *
 * ⚠️ Même repli que `duplicateCopies`, et pour la même raison : une **Valeur
 * laissée à 0** en admin est le DÉFAUT du champ, pas une intention. Lue
 * strictement, elle rendrait un décalage nul — c'est-à-dire une magie qui
 * remplace une carte par une carte du même tier, exactement le blanc que le
 * filtre d'offre existe pour supprimer, contrecoup encaissé au passage. Le
 * défaut est le tier du DESSUS, la lecture naturelle de « ascension ».
 * @param {any} magie
 * @returns {number}
 */
export function tierShift(magie) {
  const raw = Number(magie?.effect?.value);
  return Number.isFinite(raw) && raw !== 0 ? Math.trunc(raw) : 1;
}

/**
 * Quel pourcentage des PV de la carte `sacrifice_card_hp` verse au joueur.
 * ⚠️ Même repli encore : 0 (le défaut du champ) vaut 100 %, jamais « ne rend
 * rien ». Le précédent est `revive`, dont la `value` est déjà un pourcentage.
 * @param {any} magie
 * @returns {number}
 */
export function sacrificeHpPercent(magie) {
  const raw = Number(magie?.effect?.value);
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

/** « du tier au-dessus » / « de 2 tiers en dessous » — la seule chose que le
 *  joueur ait à lire d'un `tierShift`. */
function tierShiftLabel(magie) {
  const shift = tierShift(magie);
  const n = Math.abs(shift);
  const dir = shift > 0 ? 'au-dessus' : 'en dessous';
  return n === 1 ? `du tier ${dir}` : `de ${n} tiers ${dir}`;
}

/**
 * Noms lisibles des pouvoirs, pour `effectLabel` seul. ⚠️ Doublon ASSUMÉ de
 * `POWER_NAMES` (`three/`) : `logic/` ne doit rien importer de la couche 3D, et
 * `powers.json` n'est pas accessible d'ici (le module est pur). Un id absent de
 * la table retombe sur l'id brut plutôt que de masquer le pouvoir.
 */
const POWER_LABELS = {
  POWER_HEAL: 'Soin', POWER_SHIELD: 'Bouclier', POWER_SUPER_ATTACK: 'Super attaque',
  POWER_AOE_ATTACK: 'Attaque massive', POWER_POISON: 'Poison', POWER_BURN: 'Brûlure',
  POWER_PARALYSIS: 'Paralysie', POWER_PUSH: 'Poussée', POWER_DEBUFF: 'Débuff',
  POWER_BLOCK: 'Blocage', POWER_CONFUSION: 'Confusion', POWER_TAUNT: 'Provocation',
  POWER_TELEPORT: 'Téléportation', POWER_FREEZE: 'Gel',
};

/**
 * Les noms que `logic/` ne sait pas résoudre — `logic/` n'importe pas `data/`.
 * L'appelant injecte de quoi nommer un attribut et une carte ; à défaut, l'id
 * sort tel quel.
 *
 * ⚠️ Ce n'est PAS un détail d'affichage : sans résolveur, la Phase Shopping
 * proposait des magies libellées « Pioche garantie ARCH_047 ce tour ». Le défaut
 * ne ment pas (l'id est la vérité), mais aucun écran ne doit s'en contenter.
 */
const RAW_NAMES = { attribute: (id) => id, card: (id) => id };

/**
 * `guaranteed_draw` porte des critères FACULTATIFS qui se cumulent : le tier,
 * un ou plusieurs attributs, et une liste de cartes acceptables. Le libellé doit
 * dire lequel des cas on a sous les yeux, sinon deux magies très différentes se
 * lisent pareil.
 *
 * ⚠️ Les critères sont lus par `Draw.guaranteedDrawCriteria`, comme le moteur de
 * pioche et le filtre de pertinence : trois lectures de la même donnée
 * finiraient par ne plus annoncer ce qui est réellement piochré.
 */
function guaranteedDrawLabel(e, names) {
  const { tier, attributes, cardIds } = guaranteedDrawCriteria(e);
  const parts = [];
  if (tier) parts.push(`Tier ${tier}`);
  parts.push(...attributes.map(names.attribute));
  if (cardIds.length) parts.push(cardIds.map(names.card).join(' ou '));
  return parts.length ? `Pioche garantie ${parts.join(' · ')} ce tour` : 'Pioche garantie ce tour';
}

/**
 * Sur quelle carte une remise de main s'applique. Même règle de nommage que
 * `guaranteedDrawLabel` : `logic/` ne sait pas nommer un attribut, l'appelant
 * résout.
 */
function handModifierScope(e, names) {
  return e.attribute ? `${names.attribute(e.attribute)} de ta main` : 'de ta main';
}

export function needsUnitTarget(magie) {
  return ['stat_bonus', 'stat_modifier', 'shield', 'heal', 'defuse_fusion', 'destroy_unit', 'drain_life',
    'grant_power', 'power_cooldown', 'duplicate_unit', 'shift_tier_unit'].includes(magie?.effect?.type);
}

// Cible une unité du CIMETIÈRE. ⚠️ Les deux membres n'en font pas le même
// usage : `revive` l'en SORT pour la reposer sur le terrain, là où
// `duplicate_graveyard_unit` la laisse en place et ne rend que sa carte.
export function needsGraveyardTarget(magie) {
  return ['revive', 'duplicate_graveyard_unit'].includes(magie?.effect?.type);
}

// Cible une carte de la MAIN (et non une unité du board ou du cimetière) —
// troisième famille de ciblage, cf. GameSession.magieNeedsHandTarget.
// ⚠️ Les membres n'y font PAS le même geste — seule la façon de DÉSIGNER est
// commune : `hand_to_graveyard` retire la carte et la pose au cimetière,
// `duplicate_card` la laisse et en ajoute une copie, `shift_tier_card` la
// REMPLACE, `draw_material` la laisse et ajoute l'un de ses matériels,
// `sacrifice_card_hp` la brûle contre des PV joueur.
//
// ⚠️ Et ils n'acceptent pas les mêmes cartes : `GameSession.magieHandTargets`
// dit, magie par magie, lesquelles sont des cibles — le pendant exact de
// `magieUnitTargets` côté board. Sans lui, `shift_tier_card` et `draw_material`
// se laisseraient jouer sur une carte qu'elles ne peuvent pas servir.
export function needsHandTarget(magie) {
  return ['hand_to_graveyard', 'duplicate_card', 'shift_tier_card', 'draw_material',
    'sacrifice_card_hp',
    // ⚠️ Les deux remises d'invocation sont IMMÉDIATES et CIBLÉES : le joueur
    // désigne la carte de sa main qu'il remise. Elles étaient différées au tour
    // suivant, ce qui coûtait un état de round entier pour un effet que
    // personne ne choisissait — la remise tombait sur la première carte
    // retouchable venue.
    'reduce_materials', 'remove_requirements'].includes(magie?.effect?.type);
}

/**
 * La description d'une magie, en français.
 *
 * @param names — de quoi nommer un attribut (`names.attribute`) et une carte
 *   (`names.card`). ⚠️ À FOURNIR par tout écran de jeu : le défaut rend les ids
 *   bruts, ce qui affichait « ARCH_047 » là où le joueur attend « Dragon ».
 */
export function effectLabel(magie, names = RAW_NAMES) {
  const e = magie?.effect;
  names = { ...RAW_NAMES, ...names };
  if (!e) return 'Aucun effet';
  switch (e.type) {
    case 'stat_bonus':       return `+${e.value} ${STAT_NAMES[e.stat] || e.stat} sur une unité (permanent)`;
    case 'team_stat_bonus':  return `+${e.value} ${STAT_NAMES[e.stat] || e.stat} sur TOUTES tes unités (permanent)`;
    case 'stat_modifier':    return `×${e.value} ${STAT_NAMES[e.stat] || e.stat} sur une unité (permanent)`;
    case 'draw_bonus':       return `+${e.value} carte${e.value > 1 ? 's' : ''} supplémentaire${e.value > 1 ? 's' : ''} ce tour`;
    case 'guaranteed_draw':  return guaranteedDrawLabel(e, names);
    case 'heal':             return 'Soigne ENTIÈREMENT une unité (PV au maximum)';
    case 'team_heal':        return `Soigne toutes tes unités de ${e.value} PV`;
    case 'revive':           return `Réanime une unité du cimetière à ${e.value}% de ses PV`;
    case 'shield':           return `+${e.value} bouclier sur une unité`;
    case 'grant_power':      return `Donne le pouvoir ${POWER_LABELS[e.power_id] || e.power_id || '?'} à une unité (remplace le sien)`;
    case 'power_cooldown':   return `Charge le pouvoir d'une unité ${e.value} fois plus vite`;
    case 'damage_multiplier_bonus': return `+${e.value} au multiplicateur de dégâts, jusqu'à la fin de la partie`;
    case 'player_hp_bonus':  return `+${e.value} PV joueur`;
    case 'board_slot_bonus':         return `+${e.value} slot${e.value > 1 ? 's' : ''} de board permanent${e.value > 1 ? 's' : ''}`;
    case 'defuse_fusion':            return 'Sépare un monstre Fusion en ses matériaux';
    case 'destroy_unit':             return 'Détruit une unité alliée (libère son emplacement, devient un matériau disponible au cimetière)';
    case 'drain_life':               return 'Absorbe les PV d\'une unité alliée : elle part au cimetière et tu récupères ses PV courants';
    case 'hand_to_graveyard':        return 'Envoie une carte de ta main au cimetière (utilisable comme matériau)';
    // Deux sources, une seule destination : la main. Le libellé nomme la source
    // — c'est tout ce qui les distingue au moment du choix.
    case 'duplicate_unit':           return duplicateCopies(magie) > 1
      ? `Ajoute à ta main ${duplicateCopies(magie)} copies de la carte d'une unité de ton terrain`
      : 'Ajoute à ta main une copie de la carte d\'une unité de ton terrain';
    case 'duplicate_graveyard_unit': return duplicateCopies(magie) > 1
      ? `Ajoute à ta main ${duplicateCopies(magie)} copies de la carte d'une unité de ton cimetière`
      : 'Ajoute à ta main une copie de la carte d\'une unité de ton cimetière';
    case 'duplicate_card':           return duplicateCopies(magie) > 1
      ? `Duplique une carte de ta main en ${duplicateCopies(magie)} exemplaires`
      : 'Duplique une carte de ta main (l\'originale est conservée)';
    // Les deux remplacements par tier : même geste, deux provenances — comme
    // les deux duplications d'unité. Le libellé nomme donc ce qu'on désigne.
    case 'shift_tier_card':          return `Remplace une carte de ta main par une carte de ton deck ${tierShiftLabel(magie)}`;
    case 'shift_tier_unit':          return `Remplace une unité de ton terrain par une unité de ton deck ${tierShiftLabel(magie)}`;
    case 'draw_material':            return 'Ajoute à ta main un matériel d\'invocation d\'une carte de ta main';
    case 'sacrifice_card_hp':        return sacrificeHpPercent(magie) === 100
      ? 'Sacrifie une carte de ta main : tu gagnes ses PV en points de vie'
      : `Sacrifie une carte de ta main : tu gagnes ${sacrificeHpPercent(magie)}% de ses PV en points de vie`;
    // Les deux remises d'invocation. Elles ne disent PAS la même chose : l'une
    // baisse le prix, l'autre lève une contrainte sans rien rendre moins cher.
    case 'reduce_materials':         return `-${e.value ?? 1} matériel(s) requis sur une carte ${handModifierScope(e, names)}`;
    case 'remove_requirements':      return `Retire ${e.value ?? 1} matériel(s) NOMMÉ(s) d'une carte ${handModifierScope(e, names)}`;
    default: return e.type;
  }
}

/**
 * `targetUnits` porte les magies d'équipe (team_stat_bonus) : elles n'ont pas
 * de cible à désigner mais frappent tout le board joueur, que `applyGlobalMagie`
 * leur passe. Annoté en JSDoc car TS infère sinon `null` — et non `any` — du
 * seul défaut de chaque champ.
 * @param {any} magie
 * @param {{ gameState?: any, targetUnit?: any, targetUnits?: any[] | null }} [ctx]
 */
export function applyEffect(magie, { gameState = null, targetUnit = null, targetUnits = null } = {}) {
  const e = magie?.effect;
  if (!e) return;
  switch (e.type) {
    case 'stat_bonus':
      if (targetUnit) {
        // Modify _base for permanence (survives resetCombatStats between rounds)
        _writeBaseStat(targetUnit, e.stat, (targetUnit._base[e.stat] ?? 0) + e.value);
        targetUnit._recomputeStats();
        if (e.stat === 'hp') targetUnit.current_hp = Math.min(targetUnit.max_hp, targetUnit.current_hp + e.value);
      }
      break;
    case 'team_stat_bonus':
      // Le même geste que stat_bonus, répété sur chaque unité du joueur : le
      // bonus est permanent (_base) et tracé (_shopping_bonus), donc transféré
      // à une invocation composite si l'unité est consommée comme matériau.
      for (const unit of (targetUnits || [])) {
        _writeBaseStat(unit, e.stat, (unit._base[e.stat] ?? 0) + e.value);
        unit._recomputeStats();
        if (e.stat === 'hp') unit.current_hp = Math.min(unit.max_hp, unit.current_hp + e.value);
      }
      break;
    case 'stat_modifier':
      if (targetUnit) {
        const base = targetUnit._base[e.stat] ?? 0;
        _writeBaseStat(targetUnit, e.stat, base + Math.round(base * (e.value - 1)));
        targetUnit._recomputeStats();
      }
      break;
    case 'heal':
      // Soin TOTAL : `value` n'est pas lu. `heal()` plafonne déjà à `max_hp`,
      // il n'y a donc rien à calculer — et le soin suit le max courant, bonus
      // de PV compris (magies de stat, vétérance).
      if (targetUnit) targetUnit.heal(targetUnit.max_hp);
      break;
    case 'team_heal':
      // Le soin de masse, lui, est CHIFFRÉ : c'est ce qui le distingue du soin
      // total à cible unique, qui n'aurait aucun contrepoids s'il frappait
      // tout le board.
      for (const unit of (targetUnits || [])) unit.heal(e.value);
      break;
    case 'shield':
      if (targetUnit) targetUnit.applyShield(e.value);
      break;
    case 'grant_power':
      if (targetUnit && e.power_id) {
        targetUnit.power_id = e.power_id;
        // ⚠️ La vitesse est posée telle quelle, sans repli sur l'ancienne : un
        // pouvoir donné sans vitesse garde le `null` d'`Unit` (« pas de
        // pouvoir ») et ne partirait jamais. L'admin l'impose.
        //
        // ⚠️ `??` et non `||` : le compteur 0 est une valeur LÉGITIME depuis
        // l'échelle 0–100 (le pouvoir le plus lent, 77 ticks), là où l'ancien
        // seuil en ticks ne pouvait pas valoir zéro. Un `||` le confondrait
        // avec « champ non saisi » et rendrait le pouvoir muet.
        targetUnit.power_rate = clampRate(e.power_rate ?? targetUnit.power_rate ?? 0);
        targetUnit.power_value = e.value ?? null;
        // ⚠️ La durée voyage AVEC le pouvoir : une paralysie donnée sans elle
        // retomberait sur le repli du moteur, pas sur celle qu'annonce la magie.
        // Les deux champs se posent ensemble parce qu'un pouvoir donné n'hérite
        // de rien de l'ancien — ni sa valeur, ni sa durée.
        targetUnit.power_duration = e.duration ?? null;
        // La jauge repart de zéro : héritée pleine de l'ancien pouvoir, le
        // nouveau se déclencherait au premier step, ce que rien n'annonce.
        targetUnit.power_gauge = 0;
        targetUnit.is_power_blocked = false;
        targetUnit.power_block_remaining = 0;
      }
      break;
    case 'power_cooldown':
      // « Charger N fois plus vite » est une DIVISION de la PÉRIODE, pas une
      // soustraction — un −4 plat ne veut pas dire la même chose sur un pouvoir
      // à 6 ticks et sur un pouvoir à 40, exactement le piège qui a fait passer
      // POWER_PARALYSIS d'une sévérité plate à un doublement.
      //
      // ⚠️ L'opération se fait donc en TICKS et le résultat se retraduit en
      // compteur. L'écrire en compteur (« +N points ») serait une autre magie :
      // sur l'échelle linéaire, un delta constant divise la période d'autant
      // moins que l'unité est déjà rapide. On garde le geste, pas la forme.
      if (targetUnit && targetUnit.power_id && targetUnit.power_rate != null) {
        const factor = e.value > 0 ? e.value : 2;
        targetUnit.power_rate = rateForTicks(Math.max(1, Math.round(targetUnit.powerPeriod() / factor)));
      }
      break;
    case 'revive':
      if (targetUnit) {
        targetUnit.is_neutralized = false;
        targetUnit._deathEmitted = false;
        targetUnit.dot_effects = [];
        targetUnit.burn_stacks = [];
        targetUnit.paralysis_remaining = 0;
        targetUnit.attack_period_modifier = 0;
        targetUnit.is_power_blocked = false;
        targetUnit.power_block_remaining = 0;
        targetUnit.current_hp = Math.max(1, Math.round(targetUnit.max_hp * (e.value / 100)));
      }
      break;
    case 'player_hp_bonus':
      if (gameState) gameState.player_hp = Math.min(gameState.player_hp + e.value, 1000);
      break;
    case 'board_slot_bonus':
      if (gameState) gameState.grantLimitedBoardSlotBonus(e.value || 1);
      break;
    case 'draw_bonus':
      if (gameState) {
        gameState.player_extra_draws += (e.value || 1);
        // Le registre suit le crédit ligne à ligne (cf. types.DrawSourceEntry) :
        // c'est ce qui permet à la popup de pioche de nommer la magie plutôt
        // que d'annoncer un « +2 » venu de nulle part.
        gameState.player_draw_sources.push({ kind: 'magie', ref: magie.id, value: (e.value || 1) });
      }
      break;
    case 'guaranteed_draw':
      // Les critères voyagent tels quels : `Draw.matchesGuaranteedDraw` les ET-e,
      // et un champ absent n'y contraint rien. C'est la MÊME forme que celle des
      // effets d'attribut (`GuaranteedDraw`), consommée par le même code.
      // ⚠️ Recopier champ à champ est ce qui perdait `attributes` et `card_ids`
      // en route : la forme est portée par le type, pas par cette ligne.
      if (gameState) {
        gameState.player_guaranteed_draws.push({
          tier: e.tier, attribute: e.attribute,
          attributes: e.attributes, card_ids: e.card_ids,
        });
        // `value: 0` — une pioche garantie prend un slot de la main normale,
        // elle n'ajoute pas une carte (cf. `randomCount` dans startPreparation).
        gameState.player_draw_sources.push({ kind: 'magie', ref: magie.id, value: 0, guaranteed: true });
      }
      break;
    case 'damage_multiplier_bonus':
      if (gameState) gameState.player_damage_multiplier_bonus += (e.value || 0);
      break;
    // ⚠️ Les deux remises d'invocation ne passent PAS par ici : ce sont des
    // magies de MAIN, appliquées par `GameSession.applyMagieOnHandCard` sur la
    // carte que le joueur désigne — comme `shift_tier_card` ou `draw_material`.
    case 'defuse_fusion':
      // Handled by GameScreen._defuseFusion() — applyEffect is a no-op here
      break;
    case 'destroy_unit':
      // Handled by GameScreen._destroyUnit() — applyEffect is a no-op here
      break;
    case 'drain_life':
      // Handled by GameSession._drainLife() — applyEffect is a no-op here
      break;
    case 'hand_to_graveyard':
      // Handled by GameSession.applyMagieOnHandCard() — applyEffect is a no-op here
      break;
    case 'duplicate_unit':
    case 'duplicate_graveyard_unit':
      // Handled by GameSession._duplicateFromUnit() — applyEffect is a no-op here
      break;
    case 'duplicate_card':
      // Handled by GameSession.applyMagieOnHandCard() — applyEffect is a no-op here
      break;
    case 'shift_tier_card':
    case 'draw_material':
    case 'sacrifice_card_hp':
      // Handled by GameSession.applyMagieOnHandCard() — applyEffect is a no-op here
      break;
    case 'shift_tier_unit':
      // Handled by GameSession._shiftTierUnit() — applyEffect is a no-op here
      break;
  }
}
