// Cache mémoire d'un catalogue JSON, invalidé au `mtime` du fichier.
//
// Le patron était recopié VERBATIM dans quatre modules (`sets.js`,
// `variants.js`, `cosmetics.js`, `gifts.js` — empreintes md5 identiques), plus
// quatre variantes écrites à la main (`progression.js`, `missions.js` ×2,
// `arcade.js`, `bots.js`). Huit implémentations du même mécanisme, aujourd'hui
// d'accord entre elles — le risque n'est pas l'état actuel, c'est la neuvième.
//
// Il existe pour la même raison qu'`asset-dirs.js`, et suit la même règle :
// **il ne requiert RIEN**. C'est ce qui le rend chargeable par n'importe quel
// module de règles sans jamais créer de cycle, y compris par les feuilles du
// graphe (`sets.js`, `variants.js`) à qui le linter interdit de requérir quoi
// que ce soit d'autre.
const fs = require('fs');

/** Retire les virgules traînantes — les catalogues sont parfois édités à la main. */
const stripTrailingCommas = (raw) => raw.replace(/,\s*([\]}])/g, '$1');

/**
 * → un GETTER qui rend la valeur construite, relue seulement quand le fichier
 * a changé.
 *
 * ⚠️ `build` est appelé une première fois avec `[]` à la création : le getter
 * doit pouvoir répondre avant toute lecture réussie (fichier pas encore
 * bootstrapé, dossier absent). C'est ce qui permet aux modules de se charger
 * dans n'importe quel ordre.
 *
 * ⚠️ Un fichier absent ou illisible ne vide PAS le cache : on garde la dernière
 * valeur connue. Un catalogue temporairement inaccessible ne doit pas faire
 * disparaître la boutique ou les missions le temps d'une écriture.
 *
 * @param {string}   file   chemin absolu du JSON
 * @param {Function} build  (tableau brut) => valeur mise en cache
 */
function jsonCache(file, build) {
  let cache = { mtime: -1, value: build([]) };
  return () => {
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (mtime !== cache.mtime) {
        const raw = JSON.parse(stripTrailingCommas(fs.readFileSync(file, 'utf8')));
        cache = { mtime, value: build(Array.isArray(raw) ? raw : []) };
      }
    } catch { /* fichier absent/illisible : on garde le dernier cache connu */ }
    return cache.value;
  };
}

module.exports = { jsonCache, stripTrailingCommas };
