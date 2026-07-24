// File d'attente de matchmaking en mémoire (FIFO simple, pas d'ELO).
// Si le serveur redémarre, les joueurs en attente doivent simplement
// rejoindre à nouveau la file (aucune persistance nécessaire ici).
const relay = require('./MatchRelay');

const waiting = new Map(); // userId -> { ws, deckName, joinedAt }

function send(ws, type, payload = {}) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ ...payload, type }));
}

function joinQueue(ws, userId, deckName) {
  // Un joueur déjà en file (ex: double clic) remplace simplement son entrée.
  waiting.set(userId, { ws, deckName, joinedAt: Date.now() });

  // Cherche un adversaire différent de soi-même.
  let opponentEntry = null;
  let opponentId = null;
  for (const [uid, entry] of waiting) {
    if (uid === userId) continue;
    opponentEntry = entry;
    opponentId = uid;
    break;
  }

  if (!opponentEntry) return; // seul dans la file, on attend

  waiting.delete(userId);
  waiting.delete(opponentId);

  relay.createMatch(
    { userId, ws, deckName },
    { userId: opponentId, ws: opponentEntry.ws, deckName: opponentEntry.deckName }
  );
}

function leaveQueue(userId) {
  waiting.delete(userId);
}

function handleDisconnectWhileWaiting(userId) {
  waiting.delete(userId);
}

module.exports = { joinQueue, leaveQueue, handleDisconnectWhileWaiting };
