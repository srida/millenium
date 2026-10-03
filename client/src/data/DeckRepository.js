import * as AuthClient from './AuthClient.js';

const STORAGE_KEY = 'soulforge_decks';
const ACTIVE_KEY = 'soulforge_active_deck';
const META_KEY = 'soulforge_deck_meta';
const SYNCED_USER_KEY = 'soulforge_synced_user';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function save(decks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}

function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

function _deleteMeta(name) {
  const meta = loadMeta();
  delete meta[name];
  saveMeta(meta);
}

// =====================================================================
//  Synchronisation serveur (decks liés au compte quand connecté)
//  Le localStorage reste le cache de travail synchrone ; le serveur est la
//  source de vérité une fois connecté. Reads/writes restent synchrones ;
//  la sync se fait en arrière-plan.
//
//  Multi-appareils : chaque deck porte un horodatage de dernière modification
//  (et une pierre tombale s'il est supprimé). Le client envoie son bloc, le
//  serveur FUSIONNE par deck (deck-book.js) et rend le livre fusionné, que le
//  client applique. Deux appareils qui modifient des decks différents ne
//  s'écrasent donc plus ; le même deck : la dernière modification gagne.
// =====================================================================

const SYNC_STATE_KEY = 'soulforge_deck_sync';
const MIN_REFRESH_MS = 30_000;

function loadSyncState() {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || '{}');
    return { stamps: s.stamps || {}, deleted: s.deleted || {}, active_ts: s.active_ts || 0 };
  } catch {
    return { stamps: {}, deleted: {}, active_ts: 0 };
  }
}

function saveSyncState(state) {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

// Compteur de mutations locales : une réponse de sync qui arrive après une
// modification plus récente ne doit pas l'écraser (cf. `flushSync`).
let _mutationSeq = 0;

function _touch(name) {
  const st = loadSyncState();
  st.stamps[name] = Date.now();
  delete st.deleted[name];
  saveSyncState(st);
  _mutationSeq++;
}

function _tombstone(name) {
  const st = loadSyncState();
  st.deleted[name] = Date.now();
  delete st.stamps[name];
  saveSyncState(st);
  _mutationSeq++;
}

function _touchActive() {
  const st = loadSyncState();
  st.active_ts = Date.now();
  saveSyncState(st);
  _mutationSeq++;
}

// Construit le bloc complet envoyé au serveur.
function _buildBook() {
  const st = loadSyncState();
  return {
    decks: load(), meta: loadMeta(), active: getActiveDeck(),
    stamps: st.stamps, deleted: st.deleted, active_ts: st.active_ts,
  };
}

// Écrit un bloc serveur dans le cache local (sans re-déclencher de push).
function _applyBook(book) {
  save(book?.decks ?? {});
  saveMeta(book?.meta ?? {});
  if (book?.active) localStorage.setItem(ACTIVE_KEY, book.active);
  else localStorage.removeItem(ACTIVE_KEY);
  saveSyncState({
    stamps: book?.stamps ?? {},
    deleted: book?.deleted ?? {},
    active_ts: book?.active_ts ?? 0,
  });
}

function _snapshot() {
  return JSON.stringify([load(), loadMeta(), getActiveDeck()]);
}

function _hasLocalDecks() {
  return Object.keys(load()).length > 0;
}

let _pushTimer = null;
let _lastSyncAt = 0;
// Push debouncé du bloc complet (no-op si non connecté).
function _afterMutation() {
  if (!AuthClient.isLoggedIn()) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => { flushSync(); }, 500);
}

// Envoi immédiat du bloc au serveur, qui le fusionne et rend le résultat.
// Rend `true` si le cache local a changé (un autre appareil a modifié quelque chose).
// Hors-ligne : le cache local reste la vérité, le prochain sync renverra tout.
export async function flushSync() {
  clearTimeout(_pushTimer);
  _pushTimer = null;
  if (!AuthClient.isLoggedIn()) return false;
  const seq = _mutationSeq;
  const before = _snapshot();
  try {
    const res = await fetch('/api/me/decks', {
      method: 'PUT',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book: _buildBook() }),
    });
    if (!res.ok) return false;
    const { book } = await res.json();
    _lastSyncAt = Date.now();
    if (!book) return false;
    if (seq !== _mutationSeq) {
      // Modifié pendant le vol : on garde le local et on repousse.
      _afterMutation();
      return false;
    }
    _applyBook(book);
    return _snapshot() !== before;
  } catch {
    return false; /* hors-ligne */
  }
}

// Récupère les decks du compte. À appeler au démarrage et après login.
//  - cache d'un AUTRE compte (ou d'un invité) : le serveur, s'il a des decks,
//    écrase le cache ; sinon migration one-shot des decks locaux
//  - cache de CE compte : fusion par deck avec le serveur (`flushSync`)
// Rend `true` si le cache local a changé.
export async function pull() {
  const user = AuthClient.getUser();
  if (!user) return false;
  const alreadySynced = localStorage.getItem(SYNCED_USER_KEY) === user.id;

  if (alreadySynced) return flushSync();

  const before = _snapshot();
  let book = null;
  try {
    const res = await fetch('/api/me/decks', { credentials: 'include' });
    if (res.ok) book = (await res.json()).book;
  } catch { return false; /* hors-ligne */ }

  const serverHasDecks = book && book.decks && Object.keys(book.decks).length > 0;
  if (serverHasDecks) {
    _applyBook(book);
  } else if (_hasLocalDecks()) {
    // Premier login sur un compte vide : on migre les decks locaux (invité),
    // en les horodatant pour que la fusion les reconnaisse.
    for (const name of Object.keys(load())) _touch(name);
    _touchActive();
    await flushSync();
  } else {
    // Compte vide, rien à migrer.
    _applyBook({ decks: {}, meta: {}, active: null });
  }
  localStorage.setItem(SYNCED_USER_KEY, user.id);
  return _snapshot() !== before;
}

// Pousse tout de suite ce que le debounce retenait encore (passage en arrière-plan).
export function flushIfPending() {
  if (_pushTimer) return flushSync();
  return Promise.resolve(false);
}

// Resynchronisation opportuniste (retour au premier plan, réseau revenu) :
// au plus une fois toutes les 30 s. Rend `true` si le cache local a changé.
export async function refresh() {
  if (!AuthClient.isLoggedIn()) return false;
  if (Date.now() - _lastSyncAt < MIN_REFRESH_MS) return false;
  _lastSyncAt = Date.now();
  return flushSync();
}

// À appeler à la déconnexion : nettoie le cache pour repartir en invité propre.
export function handleLogout() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(META_KEY);
  localStorage.removeItem(ACTIVE_KEY);
  localStorage.removeItem(SYNCED_USER_KEY);
  localStorage.removeItem(SYNC_STATE_KEY);
}

export function getDeckColor(name) {
  return loadMeta()[name]?.color ?? null;
}

export function setDeckColor(name, color) {
  const meta = loadMeta();
  meta[name] = { ...(meta[name] || {}), color };
  saveMeta(meta);
  _touch(name);
  _afterMutation();
}

export function getDeckTags(name) {
  return loadMeta()[name]?.tags ?? [];
}

export function setDeckTags(name, tags) {
  const meta = loadMeta();
  meta[name] = { ...(meta[name] || {}), tags };
  saveMeta(meta);
  _touch(name);
  _afterMutation();
}

// Dos de carte choisi pour CE deck — ce que la popup de pioche montre à
// l'ouverture de chaque tour. `null` = pas de choix pour ce deck : on retombe
// sur le dos du profil, puis sur le défaut du catalogue (cf. RoundStart.tsx,
// qui compose les trois).
export function getDeckCardBack(name) {
  return loadMeta()[name]?.card_back ?? null;
}

export function setDeckCardBack(name, cardBackId) {
  const meta = loadMeta();
  meta[name] = { ...(meta[name] || {}), card_back: cardBackId };
  saveMeta(meta);
  _touch(name);
  _afterMutation();
}

// Illustrations choisies pour ce deck : { card_id: id_de_variante }. Une carte
// absente de la map utilise son illustration d'origine — le « défaut » est
// donc une absence d'entrée, jamais une entrée qui pointe sur la carte
// elle-même.
export function getDeckVariants(name) {
  return loadMeta()[name]?.variants ?? {};
}

export function setDeckVariants(name, variants) {
  const meta = loadMeta();
  meta[name] = { ...(meta[name] || {}), variants };
  saveMeta(meta);
  _touch(name);
  _afterMutation();
}

// Cartes à reflet de ce deck : [card_id, …]. Un reflet s'achète par carte en
// boutique (cosmetics.js) et s'allume deck par deck, comme une variante. Le
// serveur refiltre par possession avant de l'annoncer à un adversaire.
export function getDeckFoils(name) {
  const foils = loadMeta()[name]?.foils;
  return Array.isArray(foils) ? foils : [];
}

export function setDeckFoils(name, foils) {
  const meta = loadMeta();
  meta[name] = { ...(meta[name] || {}), foils };
  saveMeta(meta);
  _touch(name);
  _afterMutation();
}

// Holo, éclats, encre, cadre de ce deck : { card_id: { holo?, sparkle?, ink?,
// frame? } }. Même trajet que les reflets — le serveur refiltre par présence
// au deck et par possession avant de l'annoncer à un adversaire.
export function getDeckFinishes(name) {
  const f = loadMeta()[name]?.finishes;
  return f && typeof f === 'object' && !Array.isArray(f) ? f : {};
}

export function setDeckFinishes(name, finishes) {
  const meta = loadMeta();
  meta[name] = { ...(meta[name] || {}), finishes };
  saveMeta(meta);
  _touch(name);
  _afterMutation();
}

// Sauvegarde un deck. Structure : { "1": ["ID", ...], "2": [...], ... }
export function saveDeck(name, deckData) {
  const decks = load();
  decks[name] = deckData;
  save(decks);
  _touch(name);
  _afterMutation();
}

export function loadDeck(name) {
  return load()[name] ?? null;
}

export function deleteDeck(name) {
  const decks = load();
  delete decks[name];
  save(decks);
  _deleteMeta(name);
  if (getActiveDeck() === name) { localStorage.removeItem(ACTIVE_KEY); _touchActive(); }
  _tombstone(name);
  _afterMutation();
}

export function renameDeck(oldName, newName) {
  const decks = load();
  if (!decks[oldName]) throw new Error(`Deck "${oldName}" introuvable`);
  if (decks[newName]) throw new Error(`Un deck "${newName}" existe déjà`);
  decks[newName] = decks[oldName];
  delete decks[oldName];
  save(decks);
  const meta = loadMeta();
  if (meta[oldName]) { meta[newName] = meta[oldName]; delete meta[oldName]; saveMeta(meta); }
  if (getActiveDeck() === oldName) setActiveDeck(newName);
  _tombstone(oldName);
  _touch(newName);
  _afterMutation();
}

export function listDecks() {
  return Object.keys(load());
}

export function deckExists(name) {
  return name in load();
}

// Cœur PUR de `findFreeName` (aucun accès au localStorage) : partant de
// `baseName`, ajoute " (2)", " (3)", ... jusqu'à ne plus figurer dans
// `existingNames`. Extrait pour être testable sans DOM ni stockage, et
// partagé par `findFreeName` (deck du joueur) et `adoptGuestDeck` (copie
// d'un deck invité) — une seule règle de nommage.
export function freeNameAmong(baseName, existingNames) {
  if (!existingNames.includes(baseName)) return baseName;
  let i = 2;
  while (existingNames.includes(`${baseName} (${i})`)) i++;
  return `${baseName} (${i})`;
}

// Trouve un nom de deck libre en partant de `baseName` (ajoute " (2)", " (3)", ... si besoin)
export function findFreeName(baseName) {
  return freeNameAmong(baseName, Object.keys(load()));
}

export function setActiveDeck(name) {
  localStorage.setItem(ACTIVE_KEY, name);
  _touchActive();
  _afterMutation();
}

export function getActiveDeck() {
  return localStorage.getItem(ACTIVE_KEY) ?? null;
}

export function hasActiveDeck() {
  const name = getActiveDeck();
  return name !== null && deckExists(name);
}

// Adopte un deck invité (`guest: true`, cf. PublicDeckDatabase.getGuestDecks)
// comme deck LOCAL du joueur : au-delà de cet appel, c'est un deck ordinaire,
// éditable et renommable comme n'importe quel autre — rien ne le distingue
// plus de son origine. ⚠️ Ne définit le deck actif que si aucun n'existait
// déjà : adopter un deck d'essai ne doit jamais écraser le choix du joueur.
export function adoptGuestDeck(guestDeck) {
  const name = findFreeName(guestDeck.name);
  saveDeck(name, guestDeck.deck);
  if (!hasActiveDeck()) setActiveDeck(name);
  return name;
}

