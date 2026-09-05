// Le TIER d'une carte est un ATTRIBUT, pas un champ.
//
// Les cinq tiers sont des attributs de catégorie `Tiers` (`ARCH_091`…`ARCH_095`)
// exactement comme les cinq voies d'invocation sont des attributs de catégorie
// `Invocation` : le moteur ne connaît plus qu'un catalogue d'attributs, et une
// carte peut en porter PLUSIEURS de la même catégorie. Une carte à deux tiers
// est piochable aux deux, et se range dans les deux lanes du deck.
//
// ⚠️ Ce module ne nomme AUCUN id d'attribut. La catégorie dit qu'un attribut
// est un tier, le champ `tier` de l'attribut dit LEQUEL. Un id en dur ici
// (`ARCH_091`) rendrait le catalogue non éditable, et une dérivation depuis le
// `name` (« Tier 3 ») casserait au premier renommage en admin.
//
// ⚠️ JUMEAU : `client/src/logic/Tiers.ts` porte la même règle pour le client,
// la simulation d'équilibrage et les tests — la frontière CJS / ESM-TS interdit
// un module partagé (même situation que `XP_PER_LEVEL` et `BASE_TICK_MS`).
// `client/src/test/tiers.test.ts` compare les deux sur le catalogue entier :
// c'est le seul filet contre la dérive.
//
// Feuille du graphe de dépendances, comme `sets.js` et `variants.js` : il ne
// requiert que `json-cache` (qui ne requiert rien) et `asset-dirs`.
const path = require('path');
const { jsonCache } = require('./json-cache');
const { DATA_DIR } = require('./asset-dirs');

const ATTRIBUTES_FILE = path.join(DATA_DIR, 'attributes.json');

/** La catégorie qui porte les tiers. Elle vit ICI et dans son jumeau TS. */
const TIER_CATEGORY = 'Tiers';

/** Repli quand une carte ne porte aucun attribut de tier (donnée en retard de
 *  migration) : le tier le plus bas, celui du premier round. La LECTURE est
 *  tolérante ; c'est l'écriture qui refuse, et l'audit qui le signale. */
const DEFAULT_TIER = 1;

// ── La règle, sous forme PURE ────────────────────────────────────────────────
// Les scripts (`audit-cards.js`, `build-bot-decks.js`, `build-sets.js`) lisent
// un dossier de données qu'ils choisissent eux-mêmes — `data/` ou
// `initial-data/` —, jamais celui du serveur. Ils prennent donc l'index en
// argument, au lieu de recopier la règle chacun de leur côté.

/** `{ [attributeId]: tier }`, construit depuis un catalogue d'attributs. */
function tierIndex(attributes) {
  const map = {};
  for (const a of attributes ?? []) {
    if (!a || a.categorie !== TIER_CATEGORY) continue;
    const t = Number(a.tier);
    if (Number.isFinite(t) && t > 0) map[a.id] = t;
  }
  return map;
}

/** Les tiers d'une carte contre un index donné. Triés, sans doublon. */
function resolveTiers(card, map) {
  const out = new Set();
  for (const id of card?.attributes ?? []) {
    if (map[id] != null) out.add(map[id]);
  }
  return [...out].sort((a, b) => a - b);
}

// ── La même règle, liée au catalogue SERVI ───────────────────────────────────

/** Index du catalogue courant — cache mémoire au mtime, l'admin écrit à chaud. */
const index = jsonCache(ATTRIBUTES_FILE, tierIndex);

/**
 * Les tiers d'une carte, triés, sans doublon. `[]` si elle n'en porte aucun.
 *
 * ⚠️ Il n'y a PLUS de repli sur un champ `tier` : il a quitté les données. Une
 * carte sans attribut de tier n'entre dans aucun pool de pioche, et c'est le
 * contrat d'écriture (`card-contract.js`) qui garantit qu'elle n'existe pas —
 * pas une clause de lecture. Son jumeau TS porte exactement la même règle.
 */
function tiersOf(card) {
  return resolveTiers(card, index());
}

/**
 * Le tier d'une carte quand il en faut UN SEUL : son plus haut.
 *
 * ⚠️ Le maximum et pas le minimum : les trois consommateurs scalaires (échelle
 * des effets visuels, garde « un matériel ne se consomme jamais vers le haut »
 * de l'IA, `tier_min` des missions) demandent tous « quelle est la puissance de
 * cette carte », pas « à partir de quand se pioche-t-elle ».
 */
function primaryTier(card) {
  const t = tiersOf(card);
  return t.length ? t[t.length - 1] : DEFAULT_TIER;
}

/**
 * Le tier à AFFICHER sur une étiquette, ou `null` quand il n'y a rien à dire.
 *
 * ⚠️ Distinct de `primaryTier`, et la différence n'est pas cosmétique : une
 * règle de jeu doit toujours obtenir un chiffre (d'où le repli), une étiquette
 * ne doit pas inventer un « T1 » sur une carte qui ne porte aucun tier.
 */
function displayTier(card) {
  const t = tiersOf(card ?? {});
  return t.length ? t[t.length - 1] : null;
}

/** Cet attribut désigne-t-il un tier ? */
function isTierAttribute(id) {
  return index()[id] != null;
}

/** Les ids d'attribut des tiers, du plus bas au plus haut. */
function tierAttributeIds() {
  const map = index();
  return Object.keys(map).sort((a, b) => map[a] - map[b]);
}

module.exports = {
  TIER_CATEGORY, DEFAULT_TIER, ATTRIBUTES_FILE,
  tierIndex, resolveTiers,
  tiersOf, primaryTier, displayTier, isTierAttribute, tierAttributeIds,
};
