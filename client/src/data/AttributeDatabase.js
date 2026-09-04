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

