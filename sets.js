// Catalogue des PACKS de boutique — `data/sets.json`, édité depuis le panneau
// d'administration (onglet Packs).
//
// Le mot « set » est celui de la donnée et du code (fichier `sets.json`, champ
// `set` d'une carte) ; l'interface, elle, dit « pack ». Les deux désignent la
// même chose.
//
// Ce module existe pour une raison de DÉPENDANCES : `shop.js` (boosters) et
// `progression.js` (dotation d'un compte neuf, cf. le pack marqué `starter`)
// ont tous deux besoin de lire ce catalogue, et `shop.js` requiert déjà
// `progression.js`. Mettre la lecture ici évite le cycle — d'où la règle :
// ce fichier ne requiert NI shop.js NI progression.js.
const path = require('path');
const fs = require('fs');

// Affiches des packs. Dossier séparé des illustrations de cartes et des avatars
// de decks publics, pour les mêmes raisons : ce n'est pas de l'art de carte, et
// l'index des illustrations ne doit pas s'en trouver pollué. L'emplacement des
// dossiers est décidé par asset-dirs.js (qui ne requiert rien, donc pas de
// cycle avec ce module).
const { DATA_DIR, POSTERS_DIR } = require('./asset-dirs');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');
const SETS_FILE = path.join(DATA_DIR, 'sets.json');

// --- Catalogue (cache mémoire invalidé au mtime) ---
// Même patron que progression.allCardIds : l'admin écrit à chaud, le serveur
// n'a pas à redémarrer.

function jsonCache(file, build) {
  let cache = { mtime: -1, value: build([]) };
  return () => {
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (mtime !== cache.mtime) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/,\s*([\]}])/g, '$1'));
        cache = { mtime, value: build(Array.isArray(raw) ? raw : []) };
      }
    } catch { /* fichier absent/illisible : on garde le dernier cache connu */ }
    return cache.value;
  };
}

/** Catalogue de cartes, partagé avec shop.js (une seule lecture pour les deux). */
const cards = jsonCache(CARDS_FILE, list => new Map(list.filter(c => c && c.id).map(c => [c.id, c])));

/** TOUS les packs, pack de départ compris. */
const all = jsonCache(SETS_FILE, list => list.filter(s => s && s.id));

function byId(id) {
  return all().find(s => s.id === id) ?? null;
}

/**
 * Cartes d'un pack. `sets.json` FAIT FOI ; le champ `set` de la carte n'en est
 * que le miroir — c'est lui qui rattrape une carte créée depuis l'admin après
 * la rédaction du pack.
 */
function cardIdsOf(def) {
  if (!def) return [];
  const listed = Array.isArray(def.cards) ? def.cards : [];
  const mirrored = [...cards().values()].filter(c => c.set === def.id).map(c => c.id);
  return [...new Set([...listed, ...mirrored])].filter(id => cards().has(id));
}

/**
 * Un pack de DÉPART n'est pas un produit : c'est la dotation d'un compte neuf.
 * Il chevauche donc les packs commerciaux par nature (une carte offerte peut
 * très bien appartenir à un pack vendu), et il ne se vend jamais — sans quoi
 * chaque compte neuf le posséderait déjà en entier.
 */
function isStarter(def) {
  return !!def && def.starter === true;
}

function starterPacks() {
  return all().filter(isStarter);
}

/** Packs proposés en boutique : tout sauf les packs de départ. */
function boosterPacks() {
  return all().filter(def => !isStarter(def));
}

/** Dotation d'un compte neuf, ou `[]` si aucun pack n'est marqué « départ ». */
function starterCardIds() {
  const out = new Set();
  for (const def of starterPacks()) for (const id of cardIdsOf(def)) out.add(id);
  return [...out];
}

/** Le pack a-t-il SON affiche ? (contrairement aux avatars, il n'y a pas de défaut) */
function posterExists(id) {
  try {
    return fs.existsSync(path.join(POSTERS_DIR, `${id}.png`));
  } catch {
    return false;
  }
}

module.exports = {
  POSTERS_DIR, SETS_FILE,
  cards, all, byId, cardIdsOf,
  isStarter, starterPacks, boosterPacks, starterCardIds,
  posterExists,
};
