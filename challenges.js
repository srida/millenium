// DÉFIS ENTRE AMIS — lancer un duel en ligne contre un ami précis, par
// opposition au matchmaking anonyme (`ws/MatchmakingQueue.js`). db.js ne porte
// que l'accès SQL ; les RÈGLES sont ici.
//
// ⚠️ Ce module ne CRÉE aucun match : il ne fait que faire naître, dans la
// table `challenges`, l'ACCORD des deux joueurs. C'est `ws/ChallengeQueue.js`
// qui, une fois les deux sockets présentées, appelle `ws/MatchRelay.createMatch`
// — la MÊME fonction que la file anonyme. Un défi n'est qu'une seconde façon de
// produire la paire `{userId, ws, deckName}` que `createMatch` attend déjà.
//
// Trois règles portent tout le reste :
//
//   1. UN DÉFI NE SE LANCE QU'ENTRE AMIS ACCEPTÉS — jamais vers un inconnu, ce
//      qui rendrait cette route équivalente à un harcèlement par ping.
//   2. UN SEUL DÉFI ACTIF À LA FOIS ENTRE DEUX COMPTES, DANS UN SENS COMME DANS
//      L'AUTRE — s'envoyer un défi chacun en même temps ou en relancer un par
//      dessus un déjà pendant est refusé, pas empilé.
//   3. UN JOUEUR DÉJÀ EN MATCH NE PEUT NI DÉFIER NI ÊTRE DÉFIÉ — la garde porte
//      sur `matches` (source de vérité de `ws/MatchRelay.js`), aux DEUX
//      extrémités (émetteur et cible), et à DEUX moments (création ET
//      acceptation, l'un des deux ayant pu se mettre en match entre-temps).
//
// ⚠️ EXPIRATION PARESSEUSE, comme les jetons de reset ou le cadeau quotidien :
// aucun minuteur dédié. `expireStale()` bascule un `pending` en retard vers
// `expired` à chaque écriture/lecture, et purge un `accepted` dont la fenêtre
// de jointure a expiré sans qu'aucune des deux sockets ne se soit présentée
// (filet de sécurité si le serveur redémarre entre l'acceptation et la
// jointure WS — cf. `ws/ChallengeQueue.js`). `purge()` complète pour
// `runMaintenance`, sur le modèle de `pvplog.purge()`.
const crypto = require('crypto');
const { db, stmt } = require('./db');

/**
 * Durée de vie d'un défi non répondu. Court, dans l'esprit « cadence Marvel
 * Snap » du jeu, et proche du repli bot du matchmaking anonyme
 * (`MatchmakingQueue.BOT_DELAY_MIN_MS`..`MAX_MS`, 10-20 s) : un ami qui ne
 * répond pas en 90 s n'est probablement pas devant l'écran.
 */
const CHALLENGE_TTL_MS = 90_000;

/**
 * Fenêtre laissée aux DEUX clients pour ouvrir leur WebSocket et envoyer
 * `challenge:join` une fois le défi accepté. Plus généreuse que le TTL
 * d'attente de réponse : contrairement à l'acceptation (un tap), rejoindre
 * suppose une connexion WS (cf. `net/PvpConnection.connect()`), potentiellement
 * précédée par le round-trip du polling qui a révélé l'acceptation au défieur.
 */
const JOIN_TTL_MS = 30_000;

/** Rétention des lignes terminales jamais relues (onglet fermé). */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Statuts qu'une ligne relue en sortie du poll n'a plus besoin de conserver. */
const TERMINAL_STATUSES = Object.freeze(['declined', 'cancelled', 'expired']);

function publicRef(row, prefix) {
  return {
    id: row[`${prefix}_id`] ?? row.id,
    username: row.username,
    tag: row.tag,
    avatar: row.avatar,
  };
}

/** Bascule paresseuse — appelée avant toute lecture/écriture qui en dépend. */
function expireStale(now = Date.now()) {
  stmt.expireStaleChallenges.run({ now });
  stmt.deleteStaleAcceptedChallenges.run(now);
}

function isBusy(userId) {
  return !!stmt.activeMatchByUser.get(userId, userId);
}

/**
 * → { ok: true, challenge } | { ok: false, reason }
 *
 * `reason` est un CODE, pas une phrase — même contrat que `deliverLot` côté
 * cadeaux : le client l'habille.
 */
function create(fromUser, toUserId) {
  expireStale();

  const targetId = String(toUserId || '');
  if (!targetId || targetId === fromUser.id) return { ok: false, reason: 'self' };

  const target = stmt.userById.get(targetId);
  if (!target) return { ok: false, reason: 'not_found' };

  const friendship = stmt.friendshipBetween.get({ a: fromUser.id, b: targetId });
  if (!friendship || friendship.status !== 'accepted') return { ok: false, reason: 'not_friends' };

  if (isBusy(fromUser.id) || isBusy(targetId)) return { ok: false, reason: 'busy' };

  if (stmt.activeChallengeBetween.get({ a: fromUser.id, b: targetId })) {
    return { ok: false, reason: 'already_pending' };
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  stmt.insertChallenge.run({
    id,
    from_user_id: fromUser.id,
    to_user_id: targetId,
    created_at: now,
    expires_at: now + CHALLENGE_TTL_MS,
  });

  return {
    ok: true,
    challenge: {
      id,
      to: { id: target.id, username: target.username, tag: target.tag, avatar: target.avatar },
      created_at: now,
      expires_at: now + CHALLENGE_TTL_MS,
    },
  };
}

/**
 * → { ok: true, challenge_id } | { ok: false, reason }
 *
 * ⚠️ Le pré-contrôle JS (statut, expiration, occupation) et le
 * compare-and-swap SQL ne se désolidarisent jamais — même règle que
 * `magieCostHp` (la garde ET le paiement) : le premier donne un motif de
 * refus lisible, le second est ce qui rend un double accept impossible.
 */
function accept(user, challengeId) {
  expireStale();

  const row = stmt.challengeById.get(String(challengeId || ''));
  if (!row || row.to_user_id !== user.id) return { ok: false, reason: 'not_found' };
  // ⚠️ Les deux motifs ne sont PAS interchangeables : un statut déjà réglé
  // (accepté, décliné, annulé par l'émetteur) répond « already_handled », une
  // ligne encore `pending` mais hors délai répond « expired ». Les confondre
  // sous un même verdict aurait affiché « ce défi a expiré » sur un double tap
  // — vrai la première fois, faux la seconde.
  if (row.status !== 'pending') return { ok: false, reason: 'already_handled' };
  if (row.expires_at <= Date.now()) return { ok: false, reason: 'expired' };
  if (isBusy(row.from_user_id) || isBusy(row.to_user_id)) return { ok: false, reason: 'busy' };

  const now = Date.now();
  const res = stmt.acceptChallenge.run({
    id: row.id, uid: user.id, now, join_expires: now + JOIN_TTL_MS,
  });
  if (!res.changes) return { ok: false, reason: 'already_handled' };

  return { ok: true, challenge_id: row.id };
}

function decline(user, challengeId) {
  expireStale();
  const now = Date.now();
  const res = stmt.declineChallenge.run({ id: String(challengeId || ''), uid: user.id, now });
  if (!res.changes) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

/** Retrait par l'émetteur — avant OU après acceptation (tant que non jointe). */
function cancel(user, challengeId) {
  expireStale();
  const now = Date.now();
  const res = stmt.cancelChallenge.run({ id: String(challengeId || ''), uid: user.id, now });
  if (!res.changes) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

function listIncoming(userId) {
  expireStale();
  return stmt.incomingChallenges.all(userId, Date.now()).map(row => ({
    id: row.id,
    from: publicRef(row, 'from'),
    created_at: row.created_at,
    expires_at: row.expires_at,
  }));
}

/**
 * ⚠️ LECTURE-QUI-EFFACE pour les statuts terminaux, dans la MÊME transaction
 * que la lecture : c'est ce qui rend le poll du défieur suffisant pour
 * observer « refusé »/« expiré »/« annulé » exactement UNE fois, sans minuteur
 * de purge dédié à surveiller. `pending` et `accepted` restent — le premier
 * parce qu'il n'y a encore rien à raconter, le second parce que c'est
 * précisément ce basculement que le défieur guette pour déclencher son
 * `challenge:join` (cf. ChallengeBanner côté client).
 *
 * Un round perdu (coupure réseau juste après ce transaction) n'est pas
 * rattrapable — et c'est un choix assumé : la ligne n'est qu'une notification
 * transitoire, pas un gain, rien à réconcilier derrière une réponse perdue.
 */
const listOutgoing = db.transaction((userId) => {
  expireStale();
  const rows = stmt.outgoingChallenges.all(userId);
  for (const row of rows) {
    if (TERMINAL_STATUSES.includes(row.status)) stmt.deleteChallenge.run(row.id);
  }
  return rows.map(row => ({
    id: row.id,
    to: publicRef(row, 'to'),
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
  }));
});

/**
 * Instantané des deux files. Point d'entrée normal de la route de poll — même
 * forme que `gifts.refresh` / `shop.refresh`.
 */
function refresh(user) {
  return { incoming: listIncoming(user.id), outgoing: listOutgoing(user.id) };
}

// --- Rendez-vous WS (ws/ChallengeQueue.js) ---

/** Un défi `accepted` encore valide pour la jointure — `null` sinon. */
function acceptedForJoin(challengeId) {
  return stmt.acceptedChallengeById.get(String(challengeId || '')) || null;
}

/** Les deux sockets se sont présentées : le rendez-vous a fait son office. */
function markMatched(challengeId) {
  stmt.deleteChallenge.run(challengeId);
}

/** La fenêtre de jointure a expiré sans que les deux ne se présentent. */
function expireJoin(challengeId) {
  stmt.deleteChallenge.run(challengeId);
}

/** Purge de fond pour `runMaintenance` — filet, pas le mécanisme normal. */
function purge(now = Date.now()) {
  expireStale(now);
  return stmt.deleteOldChallenges.run(now - PURGE_AFTER_MS).changes;
}

module.exports = {
  CHALLENGE_TTL_MS, JOIN_TTL_MS,
  create, accept, decline, cancel, refresh,
  acceptedForJoin, markMatched, expireJoin, purge,
};
