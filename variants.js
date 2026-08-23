// Catalogue des VARIANTES de carte — `data/variants.json`, édité depuis le
// panneau d'administration (onglet Variantes).
//
// Une variante est une illustration alternative d'une carte. Elle n'a aucun
// effet de jeu : deux joueurs dont les variantes diffèrent jouent exactement le
// même combat.
//
// Son art vit dans le dossier d'illustrations EXISTANT, sous l'id de la
// variante — cartes, terrains et magies s'y côtoient déjà dans un espace de
// noms plat. Conséquence : `/illustrations/:id` la sert sans nouvelle route, et
// `/api/export` la synchronise sans nouvelle famille d'assets. C'est ce module
// qui possède le dossier, comme `sets.js` possède celui des affiches.
//
// Même règle de dépendances que `sets.js`, et pour la même raison : `server.js`
// et `cosmetics.js` en ont tous deux besoin, et `cosmetics.js` requiert déjà
// `progression.js` et `shop.js`. Ce fichier ne requiert donc AUCUN des trois.
const path = require('path');
const fs = require('fs');
// Cache mémoire au mtime, partagé par tous les catalogues (json-cache.js ne
// requiert rien : chargeable ici sans créer de cycle, cf. son en-tête).
const { jsonCache } = require('./json-cache');

// L'emplacement des dossiers est décidé par asset-dirs.js (qui ne requiert
// rien, donc pas de cycle) : ce module possède le dossier d'illustrations au
// sens éditorial — qui a le droit d'y écrire — pas au sens du chemin sur disque.
const { DATA_DIR, ILLUS_DIR } = require('./asset-dirs');
const VARIANTS_FILE = path.join(DATA_DIR, 'variants.json');

// --- Catalogue (cache mémoire invalidé au mtime) ---
// Même patron que sets.js : l'admin écrit à chaud, le serveur ne redémarre pas.


/** Toutes les variantes du catalogue. Une variante sans `card_id` ne vise rien : écartée. */
const all = jsonCache(VARIANTS_FILE, list => list.filter(v => v && v.id && v.card_id));

function byId(id) {
  return all().find(v => v.id === id) ?? null;
}

/** Variantes proposées pour une carte donnée. */
function byCard(cardId) {
  return all().filter(v => v.card_id === cardId);
}

/** La variante a-t-elle son illustration ? Une variante sans art n'est pas vendable. */
function illustrationExists(id) {
  try {
    return fs.existsSync(path.join(ILLUS_DIR, `${id}.png`));
  } catch {
    return false;
  }
}

module.exports = {
  ILLUS_DIR, VARIANTS_FILE,
  all, byId, byCard, illustrationExists,
};
