// Connexion WebSocket unique pour le mode Duel en ligne (PvP 1v1).
// Module singleton (même pattern que AuthClient/DeckRepository) : la socket
// doit survivre à la navigation SPA entre OnlineLobby et GameScreen3DPvP.
let ws = null;
let matchId = null;
let role = null;       // 'A' | 'B'
let opponent = null;   // { id, username, tag, avatar }
// Duel contre un adversaire artificiel : porte son deck, que l'EnemyAI locale
// fera jouer (cf. game/BotController.ts). Reste `null` sur un duel réel, et
// c'est la SEULE chose qui distingue les deux côté client.
let botMatch = null;   // { deck } | null
let keepAlive = null;

/**
 * Battement de cœur applicatif, client → serveur.
 *
 * ⚠️ Il n'est PAS redondant avec le ping du serveur (ws/pvpServer, 30 s) :
 * celui-là ne produit que du trafic serveur → client. Or un duel contre un
 * adversaire artificiel n'envoie RIEN entre `match:found` et le rapport final —
 * la partie est un solo, tout se joue dans l'onglet (cf. game/BotController).
 * Un duel réel, lui, écrit à chaque round. Une socket muette pendant dix
 * minutes est exactement ce qu'un NAT ou un proxy inverse recycle, et c'est ce
 * qui rend la coupure BEAUCOUP plus probable contre un bot que contre un
 * joueur. 25 s reste sous les fenêtres d'inactivité usuelles (30–60 s).
 *
 * Le serveur le reconnaît explicitement et ne le relaie jamais à l'adversaire
 * (cf. ws/pvpServer.handleMessage) : un type inconnu relayé s'empilerait
 * indéfiniment dans le tampon du client d'en face.
 */
const KEEPALIVE_MS = 25_000;

const listeners = new Map(); // type -> Set<handler>
// Messages reçus avant qu'un handler ne soit enregistré (course réseau — le
// serveur peut relayer un message avant que le code local n'ait atteint le
// point où il s'abonne). Rejoués au premier `on()` de ce type.
const buffered = new Map(); // type -> payload[]

/**
 * Événements de CYCLE DE VIE de la socket, qui ne se mettent jamais en attente.
 *
 * ⚠️ Sans cette exception, `_socket_closed` était bufferisé quand il survenait
 * sans auditeur — c'est-à-dire dans tous les cas où personne ne peut rien en
 * faire : échec de `connect()` au lobby, coupure pendant la recherche, ou
 * pendant la présentation de l'adversaire. Il était alors REJOUÉ au premier
 * `on('_socket_closed')` venu, c'est-à-dire au `begin()` du duel suivant : une
 * partie parfaitement saine s'ouvrait sur « Connexion perdue », bannière que
 * rien ne venait effacer et qui masquait ensuite tout retour d'invocation.
 * Une socket morte n'a rien à raconter à celle qui la remplace.
 */
const TRANSIENT = new Set(['_socket_closed']);

function dispatch(type, payload) {
  const set = listeners.get(type);
  if (set && set.size) {
    for (const handler of set) handler(payload);
    return;
  }
  if (TRANSIENT.has(type)) return;
  if (!buffered.has(type)) buffered.set(type, []);
  buffered.get(type).push(payload);
}

function startKeepAlive() {
  stopKeepAlive();
  keepAlive = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', matchId }));
  }, KEEPALIVE_MS);
}

function stopKeepAlive() {
  if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
}

export function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return Promise.resolve();
  }
  // Nouvelle socket : ce que la précédente a laissé en attente ne concerne plus
  // personne — le match auquel ces messages appartenaient est mort avec elle.
  buffered.clear();
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const sock = new WebSocket(`${proto}${location.host}/ws/pvp`);
    ws = sock;

    // ⚠️ Chaque handler se garde contre sa propre obsolescence : une socket
    // remplacée (reconnexion) ou fermée par `disconnect()` peut encore livrer
    // un `close` ou un `message` en retard, qui parlerait alors au nom de la
    // socket courante.
    const current = () => ws === sock;

    sock.onopen = () => { if (current()) startKeepAlive(); resolve(); };
    sock.onerror = () => reject(new Error('Connexion au serveur de duel impossible.'));
    sock.onclose = () => {
      if (!current()) return;
      stopKeepAlive();
      dispatch('_socket_closed', {});
    };

    sock.onmessage = (event) => {
      if (!current()) return;
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'match:found' || msg.type === 'match:rejoined') {
        matchId = msg.matchId;
        role = msg.youAre;
        opponent = msg.opponent;
        botMatch = msg.bot ?? null;
      }

      dispatch(msg.type, msg);
    };
  });
}

/**
 * → `true` si le message est bien parti.
 *
 * ⚠️ Le retour n'est pas décoratif : une socket morte avale silencieusement le
 * rapport de fin de match, et l'appelant reste alors derrière « En attente de
 * l'adversaire… » pour toujours. C'est à lui de savoir qu'il doit se rabattre
 * sur son propre résultat (cf. game/BotController).
 */
export function send(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type, matchId, ...payload }));
  return true;
}

export function isConnected() {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

export function on(type, handler) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(handler);
  const buf = buffered.get(type);
  if (buf && buf.length) {
    const toFlush = buf.splice(0, buf.length);
    for (const payload of toFlush) handler(payload);
  }
}

export function off(type, handler) {
  const set = listeners.get(type);
  if (set) set.delete(handler);
}

export function getRole() { return role; }
export function getOpponent() { return opponent; }
export function getBotMatch() { return botMatch; }

export function disconnect() {
  stopKeepAlive();
  if (ws) { const sock = ws; ws = null; sock.close(); }
  matchId = null;
  role = null;
  opponent = null;
  botMatch = null;
  listeners.clear();
  buffered.clear();
}
