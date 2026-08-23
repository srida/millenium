// Adversaires artificiels du Duel en ligne — leur catalogue et leur identité.
//
// Ils existent pour une raison de peuplement : une file d'attente vide est un
// cul-de-sac, et un joueur qui cherche un duel trois fois sans rien trouver
// n'y revient pas. Passé le délai de `ws/MatchmakingQueue` (tiré entre
// BOT_DELAY_MIN_MS et BOT_DELAY_MAX_MS), le serveur sert donc un bot plutôt
// que rien.
//
// ⚠️ Le bot n'est PAS joué par le serveur. Le PvP est un relais opaque
// (cf. ws/pvpServer.js) : aucune logique de jeu ne vit ici, et en faire tourner
// une pour les bots reviendrait à porter tout `client/src/logic/` côté Node.
// C'est le CLIENT qui joue le bot, avec l'`EnemyAI` du mode solo — ce module ne
// fournit que la carte d'identité et le deck (cf. client/src/game/BotController).
//
// ⚠️ Le catalogue est du CODE, pas de la donnée : il est généré par
// `scripts/build-bot-decks.js` et lu depuis `initial-data/`, sans copie sur le
// volume ni CRUD d'admin. Un deck de bot n'est pas un contenu qu'on retouche,
// c'est une dérivation du catalogue de cartes — on le regénère.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const variants = require('./variants');

const DECKS_FILE = path.join(__dirname, 'initial-data', 'bot_decks.json');

// Pseudos DÉCOUPLÉS des decks, et tirés à chaque match. Les apparier
// une fois pour toutes serait le tell le plus facile du système : « Drakenor
// joue toujours des dragons » se remarque au troisième duel. Ici, le même
// pseudo peut revenir sur n'importe quel deck, comme un vrai joueur qui change.
const PSEUDOS = Object.freeze([
  'Kyoshiro', 'Nova', 'Ravnos', 'Lys', 'Torvald', 'Ambre', 'Sekhmet', 'Vhalor',
  'Mistral', 'Kaelis', 'Orion', 'Nyx', 'Draven', 'Isaline', 'Zephyr', 'Morrigan',
  'Ashkar', 'Vesper', 'Loki', 'Selene', 'Bastet', 'Rhydan', 'Tempest', 'Ilyana',
  'Corvus', 'Sable', 'Ezekiel', 'Astra', 'Nikaido', 'Wraith', 'Melkior', 'Faye',
  'Sorren', 'Ysera', 'Balthus', 'Kira', 'Onyx', 'Perceval', 'Sylve', 'Tancrède',
  'Ulric', 'Vanth', 'Xanthe', 'Yorick', 'Zaltar', 'Anouk', 'Brann', 'Cendre',
]);

// --- Catalogue (cache mémoire au mtime) ---
//
// ⚠️ Seul cache du backend à NE PAS passer par `json-cache.js`, et c'est
// délibéré : sa gestion d'erreur est l'inverse de celle du helper partagé.
// Là où les catalogues de jeu gardent leur dernière valeur connue quand le
// fichier devient illisible — une boutique qui disparaît le temps d'une
// écriture serait pire que des données d'une seconde —, celui-ci rend `[]` et
// le JOURNALISE. Un catalogue de bots vide sert simplement moins de bots (le
// joueur reste en file, cf. `serveBot`), là où un catalogue périmé ferait
// affronter des decks qui ne correspondent plus au vrai `cards.json` — ce que
// bots.test.ts vérifie précisément.

let cache = null;
let cacheMtime = 0;

function catalog() {
  let mtime = 0;
  try { mtime = fs.statSync(DECKS_FILE).mtimeMs; } catch { return []; }
  if (cache && mtime === cacheMtime) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(DECKS_FILE, 'utf8'));
    cache = Array.isArray(raw) ? raw.filter(isUsable) : [];
    cacheMtime = mtime;
  } catch (err) {
    console.warn(`[bots] ${DECKS_FILE} illisible : ${err.message}`);
    cache = [];
  }
  return cache;
}

/** Un deck trop court ne se joue pas — même seuil que le DeckBuilder. */
function isUsable(def) {
  if (!def || !def.deck) return false;
  return Object.values(def.deck).reduce((n, ids) => n + (Array.isArray(ids) ? ids.length : 0), 0) >= 20;
}

// --- Identité ---

const pick = list => list[crypto.randomInt(list.length)];

/**
 * L'avatar est tiré des cartes du deck du bot, comme un joueur qui porte une
 * carte qu'il aime. Il prend la forme URL `/illustrations/<id>` — exactement ce
 * que `PUT /api/profile/me` écrit pour un vrai joueur, donc les cinq sites de
 * rendu existants n'ont rien à savoir de plus.
 *
 * Le filtre sur l'art n'est pas cosmétique : `canUseAvatar` ne teste que la
 * possession, un id sans PNG donnerait une `<img>` vide dans le HUD adverse —
 * un trou à l'écran est le tell le plus visible qu'on puisse laisser.
 */
function avatarFor(def) {
  const ids = Object.values(def.deck || {}).flat().filter(id => variants.illustrationExists(id));
  if (!ids.length) return null;
  return `/illustrations/${pick(ids)}`;
}

/** Discriminateur `#1234`, au même format que celui des vrais comptes. */
function randomTag() {
  return String(crypto.randomInt(1, 10000)).padStart(4, '0');
}

/**
 * Un adversaire artificiel prêt à être annoncé dans `match:found`.
 * → null si le catalogue est vide (aucun bot n'est alors servi : mieux vaut
 *   laisser le joueur dans la file que lui envoyer un adversaire sans deck).
 */
function spawn() {
  const decks = catalog();
  if (!decks.length) return null;
  const def = pick(decks);
  return {
    deckId: def.id,
    username: pick(PSEUDOS),
    tag: randomTag(),
    avatar: avatarFor(def),
    deck: def.deck,
  };
}

module.exports = { catalog, spawn, avatarFor, PSEUDOS, DECKS_FILE };
