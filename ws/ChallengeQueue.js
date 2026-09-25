// Rendez-vous WS d'un défi entre amis, une fois ACCEPTÉ côté REST
// (`POST /api/challenges/:id/accept`, cf. challenges.js). Jumeau de
// MatchmakingQueue.js : la même finalité (produire une paire
// `{userId, ws, deckName}` pour `MatchRelay.createMatch`), mais indexée par
// `challengeId` au lieu d'un FIFO — les deux joueurs sont déjà connus l'un de
// l'autre, il n'y a personne à apparier, seulement à faire coïncider.
//
// ⚠️ Les DEUX clients arrivent ici par des chemins différents : l'accepteur
// envoie `challenge:join` tout de suite après son propre appel REST `accept`
// ; le défieur y arrive après avoir observé, dans son propre polling
// (`GET /api/me/challenges`), que son défi sortant est passé à `accepted`
// (cf. ChallengeBanner côté client). Rien ici ne suppose un ordre d'arrivée.
const relay = require('./MatchRelay');
const challenges = require('../challenges');

/**
 * Fenêtre laissée aux deux sockets pour se présenter une fois le défi
 * accepté. `challenges.JOIN_TTL_MS` est la même fenêtre côté DB (l'`accepted`
 * expire en même temps) — les deux doivent rester d'accord, sinon une
 * jointure pourrait arriver après que la ligne ait déjà été purgée.
 */
const JOIN_TIMEOUT_MS = challenges.JOIN_TTL_MS;

const pending = new Map(); // challengeId -> { from, to, timer }

function send(ws, type, payload = {}) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ ...payload, type }));
}

/** `'from' | 'to' | null` — lequel des deux participants est cet utilisateur. */
function slotFor(challenge, userId) {
  if (challenge.from_user_id === userId) return 'from';
  if (challenge.to_user_id === userId) return 'to';
  return null;
}

function clearEntry(challengeId) {
  const entry = pending.get(challengeId);
  if (!entry) return null;
  clearTimeout(entry.timer);
  pending.delete(challengeId);
  return entry;
}

function timeoutJoin(challengeId) {
  const entry = clearEntry(challengeId);
  if (!entry) return;
  challenges.expireJoin(challengeId);
  // Celui qui s'est présenté apprend que l'autre ne viendra pas — sans quoi il
  // resterait sur un écran d'attente qui ne se résout jamais (même souci que
  // `PvpConnection.send()` sur une socket morte, cf. son commentaire).
  for (const side of [entry.from, entry.to]) {
    if (side) send(side.ws, 'challenge:join_failed', { challengeId, reason: 'timeout' });
  }
}

function handleJoin(ws, userId, challengeId, deckName) {
  const challenge = challenges.acceptedForJoin(challengeId);
  if (!challenge) {
    send(ws, 'challenge:join_failed', { challengeId, reason: 'not_found' });
    return;
  }
  const role = slotFor(challenge, userId);
  // Usurpation ou message tardif sur un défi qui ne le concerne pas — on
  // ignore, comme `MatchRelay` ignore un message hors match (cf. son
  // commentaire sur l'appartenance).
  if (!role) return;

  let entry = pending.get(challengeId);
  if (!entry) {
    entry = { from: null, to: null, timer: setTimeout(() => timeoutJoin(challengeId), JOIN_TIMEOUT_MS) };
    pending.set(challengeId, entry);
  }
  entry[role] = { userId, ws, deckName };

  if (entry.from && entry.to) {
    clearEntry(challengeId);
    challenges.markMatched(challengeId);
    relay.createMatch(
      { userId: entry.from.userId, ws: entry.from.ws, deckName: entry.from.deckName },
      { userId: entry.to.userId, ws: entry.to.ws, deckName: entry.to.deckName },
    );
  }
}

/**
 * Une des deux sockets se ferme pendant qu'elle attend l'autre — l'autre
 * (si déjà présentée) doit l'apprendre plutôt que d'attendre le timeout complet.
 * Miroir de `MatchmakingQueue.handleDisconnectWhileWaiting`.
 */
function handleDisconnectWhileWaiting(userId) {
  for (const [challengeId, entry] of pending) {
    if (entry.from?.userId !== userId && entry.to?.userId !== userId) continue;
    clearEntry(challengeId);
    challenges.expireJoin(challengeId);
    const other = entry.from?.userId === userId ? entry.to : entry.from;
    if (other) send(other.ws, 'challenge:join_failed', { challengeId, reason: 'opponent_disconnected' });
  }
}

module.exports = { handleJoin, handleDisconnectWhileWaiting, JOIN_TIMEOUT_MS };
