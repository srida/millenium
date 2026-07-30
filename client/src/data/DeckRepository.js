import * as AuthClient from './AuthClient.js';

const STORAGE_KEY = 'soulforge_decks';
const ACTIVE_KEY = 'soulforge_active_deck';
const PENDING_EDIT_KEY = 'soulforge_pending_edit';
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
// =====================================================================

// Construit le bloc complet envoyé au serveur.
function _buildBook() {
  return { decks: load(), meta: loadMeta(), active: getActiveDeck() };
}

// Écrit un bloc serveur dans le cache local (sans re-déclencher de push).
function _applyBook(book) {
  save(book?.decks ?? {});
  saveMeta(book?.meta ?? {});
  if (book?.active) localStorage.setItem(ACTIVE_KEY, book.active);
  else localStorage.removeItem(ACTIVE_KEY);
}

function _hasLocalDecks() {
  return Object.keys(load()).length > 0;
}

let _pushTimer = null;
// Push debouncé du bloc complet (no-op si non connecté).
function _afterMutation() {
  if (!AuthClient.isLoggedIn()) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => { flushSync(); }, 500);
}

// Envoi immédiat du bloc au serveur (best-effort).
export async function flushSync() {
  clearTimeout(_pushTimer);
  if (!AuthClient.isLoggedIn()) return;
  try {
    await fetch('/api/me/decks', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book: _buildBook() }),
    });
  } catch { /* hors-ligne : le cache local reste la vérité jusqu'au prochain push */ }
}

// Récupère les decks du compte. À appeler au démarrage et après login.
//  - serveur non vide → le serveur écrase le cache local (autoritaire)
//  - serveur vide + decks locaux jamais migrés vers CE compte → migration one-shot
export async function pull() {
  const user = AuthClient.getUser();
  if (!user) return;
  let book = null;
  try {
    const res = await fetch('/api/me/decks', { credentials: 'include' });
    if (res.ok) book = (await res.json()).book;
  } catch { return; /* hors-ligne */ }

  const serverHasDecks = book && book.decks && Object.keys(book.decks).length > 0;
  const alreadySynced = localStorage.getItem(SYNCED_USER_KEY) === user.id;

  if (serverHasDecks) {
    _applyBook(book);
  } else if (!alreadySynced && _hasLocalDecks()) {
    // Premier login sur un compte vide : on migre les decks locaux (invité).
    await flushSync();
  } else {
    // Compte vide, rien à migrer.
    _applyBook({ decks: {}, meta: {}, active: null });
  }
  localStorage.setItem(SYNCED_USER_KEY, user.id);
}

// À appeler à la déconnexion : nettoie le cache pour repartir en invité propre.
export function handleLogout() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(META_KEY);
  localStorage.removeItem(ACTIVE_KEY);
  localStorage.removeItem(SYNCED_USER_KEY);
}

export function getDeckColor(name) {
  return loadMeta()[name]?.color ?? null;
}

export function setDeckColor(name, color) {
  const meta = loadMeta();
  meta[name] = { ...(meta[name] || {}), color };
  saveMeta(meta);
  _afterMutation();
}

export function getDeckTags(name) {
  return loadMeta()[name]?.tags ?? [];
}

export function setDeckTags(name, tags) {
  const meta = loadMeta();
  meta[name] = { ...(meta[name] || {}), tags };
  saveMeta(meta);
  _afterMutation();
}

// Sauvegarde un deck. Structure : { "1": ["ID", ...], "2": [...], ... }
export function saveDeck(name, deckData) {
  const decks = load();
  decks[name] = deckData;
  save(decks);
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
  if (getActiveDeck() === name) localStorage.removeItem(ACTIVE_KEY);
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
  _afterMutation();
}

export function listDecks() {
  return Object.keys(load());
}

export function deckExists(name) {
  return name in load();
}

// Trouve un nom de deck libre en partant de `baseName` (ajoute " (2)", " (3)", ... si besoin)
export function findFreeName(baseName) {
  const decks = load();
  if (!(baseName in decks)) return baseName;
  let i = 2;
  while (`${baseName} (${i})` in decks) i++;
  return `${baseName} (${i})`;
}

export function setActiveDeck(name) {
  localStorage.setItem(ACTIVE_KEY, name);
  _afterMutation();
}

export function getActiveDeck() {
  return localStorage.getItem(ACTIVE_KEY) ?? null;
}

export function hasActiveDeck() {
  const name = getActiveDeck();
  return name !== null && deckExists(name);
}

// Utilisé par DeckSelector pour ouvrir DeckBuilder en mode édition
export function setPendingEdit(deckName) {
  sessionStorage.setItem(PENDING_EDIT_KEY, deckName);
}

export function consumePendingEdit() {
  const name = sessionStorage.getItem(PENDING_EDIT_KEY) ?? null;
  sessionStorage.removeItem(PENDING_EDIT_KEY);
  return name;
}
