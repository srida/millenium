let list = null;
let byId = null;

export async function init() {
  if (list) return list;
  const res = await fetch('/api/attributes');
  if (!res.ok) throw new Error(`AttributeDatabase: fetch failed (${res.status})`);
  list = await res.json();
  byId = Object.fromEntries(list.map(a => [a.id, a]));
  return list;
}

export function getAttribute(id) {
  if (!byId) throw new Error('AttributeDatabase not initialised — call init() first');
  return byId[id] ?? null;
}

export function getAllAttributes() {
  if (!list) throw new Error('AttributeDatabase not initialised — call init() first');
  return list;
}

/**
 * La catégorie qui porte les cinq anciennes voies d'invocation (Fusion,
 * Héritage, Transformation, Sacrifice, Normal). Ce sont des attributs comme les
 * autres pour le MOTEUR — un terrain peut les cibler, une mission les compter —
 * mais pas pour ce qui CARACTÉRISE un deck : « Normal » est porté par 389
 * cartes sur 868, il serait dominant partout et ne distinguerait rien.
 *
 * ⚠️ Le nom de la catégorie vit ICI et nulle part ailleurs.
 */
export const INVOCATION_CATEGORY = 'Invocation';

/**
 * La catégorie qui porte les cinq TIERS. Même statut qu'`INVOCATION_CATEGORY` :
 * ce sont des attributs comme les autres pour le moteur (un terrain a le droit
 * de viser les Tier 5), mais ils ne CARACTÉRISENT pas un deck — toute carte en
 * porte un, ils seraient dominants partout.
 *
 * ⚠️ Le nom de la catégorie vit dans `logic/Tiers.ts` pour le moteur et ICI
 * pour les questions d'affichage, faute d'un import possible dans les deux sens.
 */
export const TIER_CATEGORY = 'Tiers';

/**
 * La catégorie qui porte les MOTS-CLÉS (Tour, Explosif, Appelant, Second
 * souffle). Troisième catégorie « mécanique » après `Tiers` et `Invocation`, et
 * elle se lit à l'inverse des deux autres pour l'affichage :
 *
 *   • un tier est déjà dit par la couleur du cadre, une voie d'invocation par le
 *     chiffre du coût → ils sortent des chips ;
 *   • un mot-clé n'est dit par RIEN d'autre → c'est la chip qui le porte, et
 *     c'est tout l'intérêt.
 *
 * ⚠️ Le nom de la catégorie vit dans `effect-schema.mjs` (racine, partagé avec
 * `admin.html`) et n'est que RÉ-EXPORTÉ ici — contrairement à `TIER_CATEGORY`,
 * recopié depuis `logic/Tiers.ts`. Un nom de catégorie écrit deux fois est un
 * nom qu'on renomme à un seul endroit.
 */
export { MOT_CLE_CATEGORY } from '../../../effect-schema.mjs';
import { MOT_CLE_CATEGORY as KEYWORD_CATEGORY } from '../../../effect-schema.mjs';

/** Cet attribut décrit-il un MOT-CLÉ (une mécanique) plutôt qu'un thème ? */
export function isKeywordAttribute(id) {
  try {
    return getAttribute(id)?.categorie === KEYWORD_CATEGORY;
  } catch {
    // Database non initialisée (bancs de dev) — même filet qu'`AttrIcon`.
    return false;
  }
}

/** Cet attribut désigne-t-il un tier ? */
export function isTierAttribute(id) {
  try {
    return getAttribute(id)?.categorie === TIER_CATEGORY;
  } catch {
    return false;
  }
}

/** Cet attribut décrit-il une voie d'invocation plutôt qu'un archétype ? */
export function isInvocationAttribute(id) {
  try {
    return getAttribute(id)?.categorie === INVOCATION_CATEGORY;
  } catch {
    // Database non initialisée (bancs de dev) — même filet qu'`AttrIcon`.
    return false;
  }
}

/**
 * La catégorie qui porte les ÉLÉMENTS (Feu, Eau, Terre…). Même statut que les
 * trois au-dessus : un attribut comme un autre pour le moteur, qui décide ici
 * seulement de la question « cet attribut décrit-il un élément ? » — posée
 * pour choisir un effet sonore d'attaque (`AudioManager`), sur le même
 * catalogue que `three/constants.ELEMENT_STYLES` mais sans en dépendre.
 */
export const ELEMENT_CATEGORY = 'Element';

/** Cet attribut décrit-il un élément ? */
export function isElementAttribute(id) {
  try {
    return getAttribute(id)?.categorie === ELEMENT_CATEGORY;
  } catch {
    return false;
  }
}

/** Le premier attribut Élément porté par une unité, ou `null` — le choix
 *  entre plusieurs n'a pas à être déterministe ici, c'est un habillage
 *  sonore, pas une règle de jeu. */
export function primaryElementOf(attrIds) {
  try {
    return (attrIds || []).find(id => isElementAttribute(id)) ?? null;
  } catch {
    return null;
  }
}

