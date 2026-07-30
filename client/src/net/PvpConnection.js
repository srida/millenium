// Connexion WebSocket unique pour le mode Duel en ligne (PvP 1v1).
// Module singleton (même pattern que AuthClient/DeckRepository) : la socket
// doit survivre à la navigation SPA entre OnlineLobby et GameScreen3DPvP.
let ws = null;
let matchId = null;
let role = null;       // 'A' | 'B'
let opponent = null;   // { id, username, tag, avatar }

const listeners = new Map(); // type -> Set<handler>
// Messages reçus avant qu'un handler ne soit enregistré (course réseau — le
// serveur peut relayer un message avant que le code local n'ait atteint le
// point où il s'abonne). Rejoués au premier `on()` de ce type.
const buffered = new Map(); // type -> payload[]

function dispatch(type, payload) {
  const set = listeners.get(type);
  if (set && set.size) {
    for (const handler of set) handler(payload);
  } else {
    if (!buffered.has(type)) buffered.set(type, []);
    buffered.get(type).push(payload);
  }
}

export function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(`${proto}${location.host}/ws/pvp`);

    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('Connexion au serveur de duel impossible.'));
    ws.onclose = () => dispatch('_socket_closed', {});

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'match:found' || msg.type === 'match:rejoined') {
        matchId = msg.matchId;
        role = msg.youAre;
        opponent = msg.opponent;
      }

      dispatch(msg.type, msg);
    };
  });
}

export function send(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, matchId, ...payload }));
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

export function getMatchId() { return matchId; }
export function getRole() { return role; }
export function getOpponent() { return opponent; }

export function disconnect() {
  if (ws) { ws.onclose = null; ws.close(); }
  ws = null;
  matchId = null;
  role = null;
  opponent = null;
  listeners.clear();
  buffered.clear();
}
