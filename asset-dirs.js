// Emplacement sur disque des familles d'images — un seul endroit qui répond
// « où vit chaque famille d'assets ? ».
//
// Ce module existe pour une raison de DÉPLOIEMENT. Chaque famille se résout par
// une variable d'environnement avec un repli local. Tant que le repli était
// calculé depuis la racine du projet, une famille ajoutée après coup — dont la
// variable n'était donc réglée nulle part en prod — atterrissait dans le système
// de fichiers du CONTENEUR. Comme `resources/` est gitignoré (le dossier n'est
// même pas dans l'image) et que le conteneur est reconstruit à chaque
// déploiement, tout ce qui y avait été uploadé depuis l'admin disparaissait.
//
// D'où la règle : la racine des assets se DÉDUIT de `ILLUS_DIR` — la variable
// réglée de longue date, donc celle qui pointe à coup sûr sur le volume — au
// lieu d'être recalculée depuis le projet. Les familles vivant côte à côte sous
// une même racine (`<racine>/card_illustrations`, `<racine>/enemy_avatars`…),
// une famille ajoutée demain suit le volume sans nouvelle variable à régler.
//
// Il ne requiert rien : aucun cycle possible, il peut être chargé par n'importe
// qui (même motivation que l'existence de `sets.js`).
const path = require('path');

const PROJECT_ROOT = __dirname;

const ILLUS_DIR = process.env.ILLUS_DIR || path.join(PROJECT_ROOT, 'resources', 'card_illustrations');
// En dev : dirname(<projet>/resources/card_illustrations) = <projet>/resources,
// donc les dossiers gardent exactement leur emplacement historique.
const ASSETS_ROOT = path.dirname(ILLUS_DIR);

// La variable par famille reste prioritaire : une configuration existante n'est
// jamais contredite.
const family = (envVar, dirName) => process.env[envVar] || path.join(ASSETS_ROOT, dirName);

const DATA_DIR      = process.env.DATA_DIR || path.join(PROJECT_ROOT, 'data');
const AVATARS_DIR   = family('AVATARS_DIR', 'enemy_avatars');
const POSTERS_DIR   = family('POSTERS_DIR', 'pack_posters');
const BOARD_BG_DIR  = family('BOARD_BG_DIR', 'board_backgrounds');

// Décrit les familles pour le récapitulatif de démarrage (server.js). L'ordre
// est celui d'apparition dans le projet.
const FAMILIES = [
  { label: 'illustrations',     dir: ILLUS_DIR,     env: 'ILLUS_DIR' },
  { label: 'avatars de decks',  dir: AVATARS_DIR,   env: 'AVATARS_DIR' },
  { label: 'affiches de packs', dir: POSTERS_DIR,   env: 'POSTERS_DIR' },
  { label: 'fonds de terrain',  dir: BOARD_BG_DIR,  env: 'BOARD_BG_DIR' },
];

// Un dossier d'assets sous la racine du projet est écrit dans le conteneur : en
// production, son contenu est perdu au prochain déploiement. C'est le test exact
// de la panne, pas une heuristique.
function isEphemeral(dir) {
  const rel = path.relative(PROJECT_ROOT, dir);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = {
  PROJECT_ROOT, ASSETS_ROOT,
  DATA_DIR, ILLUS_DIR, AVATARS_DIR, POSTERS_DIR, BOARD_BG_DIR,
  FAMILIES, isEphemeral,
};
