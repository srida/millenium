// Registre en mémoire des matchs PvP actifs + relais générique des messages
// entre les 2 joueurs d'un même match. Le serveur ne connaît jamais le
// contenu des unités/board — il transmet des payloads opaques.
//
// Limite assumée pour la v1 : les HP/round en cours ne sont pas persistés
// côté serveur au-delà du numéro de round. Si un joueur se reconnecte après
// une déconnexion, les deux clients relancent la préparation du round en
// cours à pleine vie (pas de resynchronisation fine d'un round entamé) — un
// redémarrage complet du serveur pendant un match est donc traité comme une
// perte de match irrécupérable (seule l'historique en DB survit).
const crypto = require('crypto');
const { stmt } = require('../db');
const progression = require('../progression');
const cosmetics = require('../cosmetics');

const GRACE_PERIOD_MS = 45_000;

const matches = new Map();      // matchId -> MatchState
const matchByUser = new Map();  // userId -> matchId

// Carte d'identité transmise à l'adversaire. `variants` (les illustrations
// alternatives du deck engagé) est ajouté par les appelants : il est DÉRIVÉ du
// deck book serveur, jamais transmis par le client — sinon n'importe qui
// afficherait à son adversaire une variante qu'il n'a pas achetée. Étant
// purement cosmétique, il ne touche pas au payload de déterminisme
// (`round:board_ready`).
function playerInfo(userId, ws) {
  return { id: userId, username: ws?.username, tag: ws?.tag, avatar: ws?.avatar };
}

function send(ws, type, payload = {}) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ ...payload, type }));
}

function otherRole(role) { return role === 'A' ? 'B' : 'A'; }

function findMatch(matchId) {
  return matches.get(matchId) || null;
}

function roleOfUser(match, userId) {
  if (match.players.A.userId === userId) return 'A';
  if (match.players.B.userId === userId) return 'B';
  return null;
}

function createMatch(connA, connB) {
  const matchId = crypto.randomUUID();
  const now = Date.now();

  const match = {
    id: matchId,
    round: 1,
    status: 'active',
    readyRound1: new Set(),
    players: {
      A: { userId: connA.userId, ws: connA.ws, deckName: connA.deckName, connected: true, disconnectTimer: null },
      B: { userId: connB.userId, ws: connB.ws, deckName: connB.deckName, connected: true, disconnectTimer: null },
    },
    lastTerrainBoardId: null,
    combatStartAcks: new Set(),
    resultReports: {},
  };

  matches.set(matchId, match);
  matchByUser.set(connA.userId, matchId);
  matchByUser.set(connB.userId, matchId);

  stmt.insertMatch.run({
    id: matchId,
    player_a_id: connA.userId,
    player_b_id: connB.userId,
    status: 'active',
    round: 1,
    created_at: now,
  });

  const infoA = { ...playerInfo(connA.userId, connA.ws), variants: cosmetics.deckVariantMap(connA.userId, connA.deckName) };
  const infoB = { ...playerInfo(connB.userId, connB.ws), variants: cosmetics.deckVariantMap(connB.userId, connB.deckName) };

  send(connA.ws, 'match:found', { matchId, opponent: infoB, youAre: 'A' });
  send(connB.ws, 'match:found', { matchId, opponent: infoA, youAre: 'B' });

  return matchId;
}

function handleReady(matchId, userId) {
  const match = findMatch(matchId);
  if (!match) return;
  const role = roleOfUser(match, userId);
  if (!role) return;

  match.readyRound1.add(role);
  if (match.readyRound1.size === 2) {
    send(match.players.A.ws, 'match:start', { matchId, round: match.round });
    send(match.players.B.ws, 'match:start', { matchId, round: match.round });
  }
}

// Relais générique : transmet le message tel quel à l'autre joueur du match.
// round:board_ready est renommé round:opponent_board pour le récepteur et mis
// en cache (utile pour un renvoi lors d'une reconnexion de l'adversaire).
// round:combat_start_ack forme une barrière : dès que les 2 joueurs ont acqu,
// le serveur émet round:go aux deux simultanément (avec le terrain convenu),
// plutôt que de relayer l'ack lui-même.
function relayMessage(matchId, fromUserId, msg) {
  const match = findMatch(matchId);
  if (!match) return;
  const role = roleOfUser(match, fromUserId);
  if (!role) return;

  if (msg.type === 'round:board_ready') {
    match.round = msg.round || match.round;
    stmt.updateMatchRound.run(match.round, matchId);
  }

  if (msg.type === 'round:terrain_pick') {
    match.lastTerrainBoardId = msg.boardId;
  }

  if (msg.type === 'round:combat_start_ack') {
    match.combatStartAcks.add(role);
    if (match.combatStartAcks.size === 2) {
      match.combatStartAcks.clear();
      const payload = { matchId, round: match.round, boardId: match.lastTerrainBoardId };
      send(match.players.A.ws, 'round:go', payload);
      send(match.players.B.ws, 'round:go', payload);
    }
    return;
  }

  if (msg.type === 'round:next_ready') {
    // Reset des barrières pour le round suivant.
    match.combatStartAcks.clear();
    match.lastTerrainBoardId = null;
  }

  const target = match.players[otherRole(role)];
  const outType = msg.type === 'round:board_ready' ? 'round:opponent_board' : msg.type;
  send(target.ws, outType, msg);
}

// Chaque client détecte localement la fin de partie (GameState.isGameOver(),
// déterministe des deux côtés) et rapporte son propre résultat — le premier
// rapport reçu termine le match (le second est ignoré, match déjà 'ended').
// localWinner est du point de vue de l'émetteur : 'player' (l'émetteur a
// gagné), 'enemy' (l'émetteur a perdu) ou 'draw'.
function handleReportResult(matchId, userId, localWinner) {
  const match = findMatch(matchId);
  if (!match || match.status !== 'active') return;
  const role = roleOfUser(match, userId);
  if (!role) return;

  // Convert local winner to absolute role ('A' | 'B' | 'draw')
  const absoluteWinner = localWinner === 'draw'
    ? 'draw'
    : localWinner === 'player' ? role : otherRole(role);

  match.resultReports[role] = absoluteWinner;

  // Wait until both clients have reported before closing the match
  if (!match.resultReports.A || !match.resultReports.B) return;

  const resultA = match.resultReports.A;
  const resultB = match.resultReports.B;

  // ⚠️ UN DÉSACCORD N'A PAS DE VAINQUEUR.
  //
  // Le rôle A faisait auparavant autorité (« Role A is authoritative on
  // mismatch »), et c'était exploitable de la façon la plus simple qui soit :
  // un client modifié en rôle A déclarait la victoire à chaque partie et
  // encaissait `pvp_win` — 70 XP, le plus gros gain du jeu — quel que soit le
  // rapport de son adversaire, qui voyait en prime le match se clore contre
  // lui. Le désaccord n'était que journalisé.
  //
  // Le match est donc clos en nul, SANS RIEN VERSER. Un tricheur ne gagne plus
  // rien à mentir ; le coût est qu'un joueur honnête perd ses 70 XP dans un cas
  // — une vraie divergence de simulation — qui ne devrait jamais se produire,
  // le combat étant déterministe des deux côtés (verrouillé par pvp.test.ts).
  //
  // Les deux `userId` sont journalisés, pas seulement les résultats : c'est la
  // seule trace exploitable si un compte revient souvent dans ces lignes.
  if (resultA !== resultB) {
    console.warn(
      `[PvP] Match ${matchId} (round ${match.round}) : rapports divergents — ` +
      `A (${match.players.A.userId}) annonce « ${resultA} », ` +
      `B (${match.players.B.userId}) annonce « ${resultB} ». ` +
      'Match clos en nul, aucun gain versé.',
    );
    endMatch(matchId, null, 'result_mismatch');
    return;
  }

  if (resultA === 'draw') {
    endMatch(matchId, null, 'hp_zero');
  } else {
    endMatch(matchId, match.players[resultA].userId, 'hp_zero');
  }
}

function handleForfeit(matchId, userId) {
  const match = findMatch(matchId);
  if (!match) return;
  const role = roleOfUser(match, userId);
  if (!role) return;
  const winnerRole = otherRole(role);
  endMatch(matchId, match.players[winnerRole].userId, 'forfeit');
}

function handleDisconnect(userId) {
  const matchId = matchByUser.get(userId);
  if (!matchId) return;
  const match = findMatch(matchId);
  if (!match || match.status !== 'active') return;
  const role = roleOfUser(match, userId);
  if (!role) return;

  match.players[role].connected = false;
  match.players[role].ws = null;

  const other = match.players[otherRole(role)];
  send(other.ws, 'match:opponent_disconnected', { matchId, gracePeriodMs: GRACE_PERIOD_MS });

  clearTimeout(match.players[role].disconnectTimer);
  match.players[role].disconnectTimer = setTimeout(() => {
    handleGraceExpired(matchId, userId);
  }, GRACE_PERIOD_MS);
}

function handleGraceExpired(matchId, userId) {
  const match = findMatch(matchId);
  if (!match || match.status !== 'active') return;
  const role = roleOfUser(match, userId);
  if (!role || match.players[role].connected) return; // reconnecté entre-temps
  const winnerRole = otherRole(role);
  endMatch(matchId, match.players[winnerRole].userId, 'timeout');
}

function handleRejoin(ws, matchIdHint, userId) {
  let matchId = matchIdHint && matches.has(matchIdHint) ? matchIdHint : matchByUser.get(userId);
  const match = matchId ? findMatch(matchId) : null;
  if (!match || match.status !== 'active') {
    send(ws, 'error', { code: 'no_active_match', message: 'Aucun match actif à rejoindre.' });
    return;
  }
  const role = roleOfUser(match, userId);
  if (!role) {
    send(ws, 'error', { code: 'not_in_match', message: 'Ce match ne vous appartient pas.' });
    return;
  }

  clearTimeout(match.players[role].disconnectTimer);
  match.players[role].disconnectTimer = null;
  match.players[role].connected = true;
  match.players[role].ws = ws;
  ws.userId = userId;

  const other = match.players[otherRole(role)];
  // À la reconnexion aussi : sans ça, un joueur revenu en jeu perdrait l'art
  // de son adversaire pour le reste du match.
  const opponentInfo = other.ws
    ? { ...playerInfo(other.userId, other.ws), variants: cosmetics.deckVariantMap(other.userId, other.deckName) }
    : { id: other.userId };

  send(ws, 'match:rejoined', { matchId: match.id, round: match.round, opponent: opponentInfo, youAre: role });

  if (other.connected) {
    send(other.ws, 'match:opponent_reconnected', { matchId: match.id });
    // Les deux clients relancent proprement la préparation du round en cours
    // (aucun état de round intermédiaire n'est conservé côté serveur).
    send(other.ws, 'round:restart', { matchId: match.id, round: match.round });
    send(ws, 'round:restart', { matchId: match.id, round: match.round });
  }
}

function endMatch(matchId, winnerUserId, reason) {
  const match = findMatch(matchId);
  if (!match || match.status !== 'active') return;
  match.status = 'ended';

  const roleA = match.players.A;
  const roleB = match.players.B;
  const winnerRole = winnerUserId === roleA.userId ? 'A' : winnerUserId === roleB.userId ? 'B' : 'draw';

  stmt.endMatch.run(winnerUserId || null, reason, Date.now(), matchId);

  // Gain PvP décerné ICI et pas par le client : c'est le serveur qui arbitre le
  // vainqueur (rapports croisés des deux joueurs, forfait, timeout). Le gain
  // vaut aussi sur forfait/timeout — l'adversaire a bien remporté le match.
  // `reward` renvoie la progression à jour, transmise avec match:end pour que
  // le vainqueur voie sa jauge bouger sans refetch.
  const gain = winnerUserId ? progression.reward(winnerUserId, 'pvp_win') : null;
  const xpGained = gain ? progression.REWARDS.pvp_win : 0;

  send(roleA.ws, 'match:end', {
    matchId, winner: winnerRole, reason,
    ...(winnerRole === 'A' ? { xp_gained: xpGained, progression: gain } : {}),
  });
  send(roleB.ws, 'match:end', {
    matchId, winner: winnerRole, reason,
    ...(winnerRole === 'B' ? { xp_gained: xpGained, progression: gain } : {}),
  });

  for (const p of [roleA, roleB]) {
    clearTimeout(p.disconnectTimer);
    matchByUser.delete(p.userId);
  }
  matches.delete(matchId);
}

module.exports = {
  createMatch,
  handleReady,
  relayMessage,
  handleReportResult,
  handleForfeit,
  handleDisconnect,
  handleGraceExpired,
  handleRejoin,
  endMatch,
};
