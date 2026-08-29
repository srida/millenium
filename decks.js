// Ce que le SERVEUR sait du deck engagé par un joueur — la copie autoritaire du
// deck book, par opposition au nom de deck que le client annonce.
//
// Ce module existe pour une raison de DÉPENDANCES, comme `sets.js` : le relais
// PvP (`ws/MatchRelay.js`) doit dériver les attributs du deck d'un joueur, et
// `cosmetics.js` doit résoudre le même deck pour ses variantes d'illustration.
// Les deux lisaient — ou allaient lire — le même livre de deux façons.
//
// ⚠️ Il ne requiert que `db` et `json-cache` (qui, lui, ne requiert rien) :
// aucun module de règles ne le charge, il n'y a donc pas de cycle possible.
//
// ⚠️ Ce que ce module rend n'est PAS cosmétique, et c'est pourquoi il ne vit pas
// dans `cosmetics.js` : les attributs d'un deck décident du terrain de combat,
// donc de bonus de stats réels. Un module dont le nom ne parle que de
// cosmétiques ne doit pas porter une règle de jeu.
const path = require('path');
const { jsonCache } = require('./json-cache');
const { stmt } = require('./db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

/** Index `card_id → attributs`. Cache mémoire au mtime, le patron de partout
 *  ailleurs (`progression.allCardIds`, `sets.cards`, `cosmetics.cards`) :
 *  l'admin réécrit `cards.json` à chaud, sans redémarrage. */
const cardAttributes = jsonCache(path.join(DATA_DIR, 'cards.json'), list =>
  new Map(list.filter(c => c && c.id)
              .map(c => [c.id, Array.isArray(c.attributes) ? c.attributes : []])));

/**
 * Le deck désigné dans le livre SERVEUR du joueur, avec le nom retenu.
 *
 * `deckName` vient bien du client, mais ne sert qu'à choisir une clé de son
 * PROPRE livre : il ne peut rien injecter. Un nom inconnu retombe sur le deck
 * actif — c'est le comportement historique de `cosmetics.deckVariantMap`, dont
 * ce module reprend la résolution pour qu'elle n'existe qu'une fois.
 */
function resolveDeck(userId, deckName) {
  const row = stmt.deckBookByUser.get(userId);
  if (!row) return null;
  let book;
  try { book = JSON.parse(row.data); } catch { return null; }

  const name = deckName && book?.decks?.[deckName] ? deckName : book?.active;
  const deck = book?.decks?.[name];
  if (!deck) return null;
  return { name, deck, book };
}

/** Les ids de cartes du deck engagé (Set, sans doublon). */
function deckCardIds(userId, deckName) {
  const resolved = resolveDeck(userId, deckName);
  const out = new Set();
  if (!resolved) return out;
  for (const ids of Object.values(resolved.deck)) {
    for (const id of Array.isArray(ids) ? ids : []) out.add(id);
  }
  return out;
}

/**
 * Combien de cartes du deck portent chaque attribut → `{ ARCH_003: 7, … }`.
 *
 * ⚠️ Le SEUIL n'est PAS appliqué ici, et c'est délibéré : il vit dans
 * `client/src/logic/BoardPicker.ts`, en un seul exemplaire. Renvoyer une liste
 * déjà filtrée mettrait `MIN_ATTRIBUTE_OCCURRENCES` des deux côtés du fil, à
 * tenir synchronisé à la main — le piège de `XP_PER_LEVEL`, la seule valeur du
 * projet dans ce cas, et une de trop. Le serveur COMPTE, le client SEUILLE.
 *
 * ⚠️ Une carte inconnue du catalogue est ignorée sans bruit : un deck peut
 * porter une carte supprimée en admin depuis sa dernière édition.
 */
function deckAttributeCounts(userId, deckName) {
  const index = cardAttributes();
  const out = {};
  for (const id of deckCardIds(userId, deckName)) {
    for (const attr of index.get(id) ?? []) out[attr] = (out[attr] ?? 0) + 1;
  }
  return out;
}

module.exports = { resolveDeck, deckCardIds, deckAttributeCounts };
