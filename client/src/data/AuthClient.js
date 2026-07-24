// Client de la couche online (comptes, profil, amis).
// Même pattern que les *Database.js : module à exports nommés, cache mémoire.
let currentUser = null;
let fetched = false;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* pas de corps JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Erreur ${res.status}`);
    err.status = res.status;
    err.field = data && data.field;
    throw err;
  }
  return data;
}

// --- Session ---
export async function me() {
  const { user } = await api('/auth/me');
  currentUser = user;
  fetched = true;
  return user;
}

// user courant en cache (null si déconnecté ou pas encore chargé). Appeler me() d'abord.
export function getUser() { return currentUser; }
export function isLoggedIn() { return !!currentUser; }
export function isReady() { return fetched; }

export async function register({ email, username, password }) {
  const { user } = await api('/auth/register', { method: 'POST', body: { email, username, password } });
  currentUser = user; fetched = true;
  return user;
}

export async function login({ email, password, rememberMe = false }) {
  const { user } = await api('/auth/login', { method: 'POST', body: { email, password, rememberMe } });
  currentUser = user; fetched = true;
  return user;
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' });
  currentUser = null;
}

export async function updateProfile({ username, avatar }) {
  const { user } = await api('/profile/me', { method: 'PUT', body: { username, avatar } });
  currentUser = user;
  return user;
}

// --- Amis ---
export async function searchUsers(q) {
  const { users } = await api(`/users/search?q=${encodeURIComponent(q)}`);
  return users;
}
export async function getFriends() {
  const { friends } = await api('/friends');
  return friends;
}
export async function getRequests() {
  return api('/friends/requests'); // { incoming, outgoing }
}
export async function sendRequest(userId) {
  return api('/friends/request', { method: 'POST', body: { userId } });
}
export async function acceptRequest(friendshipId) {
  return api(`/friends/${friendshipId}/accept`, { method: 'POST' });
}
export async function declineRequest(friendshipId) {
  return api(`/friends/${friendshipId}/decline`, { method: 'POST' });
}
export async function removeFriend(friendshipId) {
  return api(`/friends/${friendshipId}`, { method: 'DELETE' });
}
