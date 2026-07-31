// Client de la couche online (comptes, profil, amis).
// Même pattern que les *Database.js : module à exports nommés, cache mémoire.
let currentUser = null;
let fetched = false;

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    // fetch ne rejette QUE sur échec réseau (serveur arrêté, hors-ligne, requête
    // bloquée) : le message natif « Failed to fetch » ne dit rien au joueur, on
    // le traduit en cause réelle. `network` permet aux écrans de proposer un
    // « Réessayer » plutôt que de traiter ça comme une erreur métier.
    const err = new Error('Serveur injoignable — vérifie ta connexion.');
    err.network = true;
    err.cause = cause;
    throw err;
  }
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

// --- Réinitialisation du mot de passe ---
export async function forgotPassword(email) {
  return api('/auth/forgot-password', { method: 'POST', body: { email } });
}

export async function resetPassword({ token, password }) {
  return api('/auth/reset-password', { method: 'POST', body: { token, password } });
}

export async function updateProfile({ username, avatar }) {
  const { user } = await api('/profile/me', { method: 'PUT', body: { username, avatar } });
  currentUser = user;
  return user;
}

// --- Progression (niveau, XP, monnaies, collection) ---
export async function getProgression() {
  return api('/me/progression'); // { level, xp, xp_per_level, gold, gems, unlocked_count, unlocked_cards }
}

// Déclare un événement de jeu ; le serveur applique son barème et renvoie la
// progression à jour. Volontairement silencieux en cas d'échec côté appelant :
// perdre un gain d'XP ne doit jamais casser une fin de partie.
export async function claimReward(reason) {
  const { progression } = await api('/me/progression/reward', { method: 'POST', body: { reason } });
  if (currentUser && progression) currentUser = { ...currentUser, ...progression };
  return progression;
}

// --- Missions quotidiennes ---
// Le serveur délivre les lots manquants À LA LECTURE : un simple GET fait
// avancer le cycle, il n'y a pas de tâche planifiée à attendre.
export async function getMissions() {
  return api('/me/missions'); // { missions, daily, weekly, reroll }
}

// Envoie un lot d'ÉVÉNEMENTS de partie (jamais une progression ni un montant :
// le serveur applique son catalogue et son barème). `matchId` absent = lot méta,
// hors partie (deck enregistré…).
export async function sendMissionEvents({ matchId = null, events }) {
  const data = await api('/me/missions/events', {
    method: 'POST',
    body: { match_id: matchId, events },
  });
  if (currentUser && data && data.progression) currentUser = { ...currentUser, ...data.progression };
  return data; // { countable, completed, milestones, missions, weekly, reroll, progression }
}

export async function rerollMission(id) {
  const data = await api(`/me/missions/${encodeURIComponent(id)}/reroll`, { method: 'POST' });
  if (currentUser && data && data.progression) currentUser = { ...currentUser, ...data.progression };
  return data;
}

// --- Boutique de cartes ---
// Même contrat que les missions : le client DÉSIGNE (un emplacement, un set),
// le serveur chiffre. Aucun prix ne circule dans le sens client → serveur,
// sinon n'importe qui s'achèterait une T5 pour 1 gold.
// Toutes les réponses portent l'instantané complet + la progression à jour :
// aucun rechargement à faire derrière une action.
function absorbShop(data) {
  if (currentUser && data && data.progression) currentUser = { ...currentUser, ...data.progression };
  return data;
}

export async function getShop() {
  return absorbShop(await api('/me/shop'));
}

// `cardId` accompagne le slot : le serveur refuse (409) si l'offre a tourné
// entre l'affichage et le tap, au lieu d'acheter la carte qui a pris la place.
export async function buyShopCard({ slot, cardId, currency = 'golds' }) {
  return absorbShop(await api('/me/shop/buy', { method: 'POST', body: { slot, card_id: cardId, currency } }));
}

export async function rerollShopSlot(slot) {
  return absorbShop(await api('/me/shop/reroll', { method: 'POST', body: { slot } }));
}

/** `slot = null` détache. Une seule épingle : désigner un autre slot la déplace. */
export async function pinShopSlot(slot) {
  return absorbShop(await api('/me/shop/pin', { method: 'POST', body: { slot } }));
}

export async function buyBooster({ setId, currency = 'golds' }) {
  return absorbShop(await api('/me/shop/booster', { method: 'POST', body: { set_id: setId, currency } }));
}

// --- Boutique cosmétique (avatars, variantes) ---
// Même contrat que ci-dessus. L'instantané sert trois écrans : la boutique
// (l'offre du jour), le profil (les avatars portables) et le DeckBuilder (les
// variantes possédées).
export async function getCosmetics() {
  return absorbShop(await api('/me/cosmetics'));
}

export async function buyCosmetic({ kind, id }) {
  return absorbShop(await api('/me/cosmetics/buy', { method: 'POST', body: { kind, id } }));
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
