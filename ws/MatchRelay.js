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
const decks = require('../decks');

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

/**
 * Ce que le serveur DÉRIVE du deck engagé par un joueur, pour l'annoncer à son
 * adversaire. Deux faits, un seul point d'appel — ils voyagent ensemble dans
 * `match:found` ET `match:rejoined`, et les laisser se séparer voudrait dire
 * qu'un client reconnecté n'aurait qu'une moitié de son adversaire.
 *
 * Aucun des deux ne vient du client : il n'envoie qu'un NOM de deck, qui ne sert
 * qu'à choisir une clé de son propre livre.
 *
 * - `variants` : cosmétique (l'art des cartes adverses), filtré par possession.
 * - `deck_attribute_counts` : PAS cosmétique — c'est ce qui permet au rôle A de
 *   choisir un terrain de combat pertinent pour l'un des deux decks, donc des
 *   bonus de stats réels. Ce sont des COMPTES bruts : le seuil qui décide de ce
 *   qui « identifie » un deck vit côté client, dans `logic/BoardPicker.ts`, en
 *   un seul exemplaire.
 *
 * ⚠️ Divulgation assumée : l'adversaire apprend les attributs dominants du deck
 * avant la première unité posée. La puce 🗺️ du terrain annonce déjà la même
 * chose un round plus tard, et l'alternative — faire choisir le terrain par le
 * serveur — mettrait de la logique de jeu dans un relais dont tout le principe
 * est d'être OPAQUE.
 */
function deckDerived(userId, deckName) {
  return {
    variants: cosmetics.deckVariantMap(userId, deckName),
    deck_attribute_counts: decks.deckAttributeCounts(userId, deckName),
  };
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
    // ⚠️ La barrière de lancement de combat est indexée par ROUND, et ce n'est
    // pas de la précaution : les deux clients ne traversent pas la fin d'un
    // round à la même vitesse (récapitulatif 22 s, Phase Shopping 45 s, temps
    // de préparation 60 s), et un état de barrière global se fait écraser par
    // le message d'un joueur en retard. Cf. `round:next_ready`.
    //
    // round → { acks:Set<role>, boards:Set<role>, boardId, timer }
    barriers: new Map(),
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

  const infoA = { ...playerInfo(connA.userId, connA.ws), ...deckDerived(connA.userId, connA.deckName) };
  const infoB = { ...playerInfo(connB.userId, connB.ws), ...deckDerived(connB.userId, connB.deckName) };

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
/**
 * Délai au bout duquel une barrière à moitié franchie est tranchée.
 *
 * ⚠️ Il ne borne PAS la lenteur d'un joueur, il détecte un client MORT — d'où sa
 * générosité. Le pire écart légitime entre les deux acquittements se dérive des
 * chronos du client, qui font tous avancer une partie même sans le moindre
 * geste : écart d'animation entre ×1 et ×4 sur un long combat (~27 s),
 * récapitulatif de fin de round (22 s), Phase Shopping (45 s), préparation
 * (60 s) — soit ~155 s. En dessous, on couperait la partie d'un joueur qui joue.
 */
const BARRIER_TIMEOUT_MS = 180_000;

/** L'état de barrière d'un round, créé à la demande. */
function barrierFor(match, round) {
  let b = match.barriers.get(round);
  if (!b) {
    b = { acks: new Set(), boards: new Set(), boardId: null, timer: null };
    match.barriers.set(round, b);
  }
  return b;
}

/** Émet `round:go` aux deux joueurs et referme tout ce qui précède ce round. */
function openBarrier(match, round) {
  const boardId = match.barriers.get(round)?.boardId ?? null;
  const payload = { matchId: match.id, round, boardId };
  send(match.players.A.ws, 'round:go', payload);
  send(match.players.B.ws, 'round:go', payload);
  for (const [r, b] of match.barriers) {
    if (r <= round) { clearTimeout(b.timer); match.barriers.delete(r); }
  }
}

/**
 * Un seul des deux joueurs a acquitté, et l'échéance est passée. Deux issues, et
 * une seule règle : on joue le round si on PEUT le jouer, sinon on clôt.
 *
 * ⚠️ « Jouer sans lui » n'est pas une option ouverte : le client présent attend
 * aussi le BOARD de son adversaire (`waitForOpponentBoard`), et le serveur n'en
 * garde aucune copie — un `round:go` sans board déplacerait le gel au lieu de le
 * lever. La grâce ne vaut donc que dans le cas où le board est bien arrivé et où
 * seul l'acquittement manque ; sinon le joueur d'en face n'est plus là, et son
 * adversaire a assez attendu.
 *
 * ⚠️ « Une seule grâce » est une CONSÉQUENCE, pas un compteur : après un
 * `round:go` de grâce, un client toujours muet n'enverra pas non plus le board du
 * round suivant — la barrière suivante tombera donc dans la seconde branche.
 */
function onBarrierTimeout(matchId, round) {
  const match = findMatch(matchId);
  if (!match || match.status !== 'active') return;
  const barrier = match.barriers.get(round);
  if (!barrier || barrier.acks.size !== 1) return;   // franchie ou périmée entre-temps

  if (barrier.boards.size === 2) { openBarrier(match, round); return; }

  const presentRole = [...barrier.acks][0];
  console.warn(
    `[PvP] Match ${matchId} (round ${round}) : barrière expirée, ` +
    `le rôle ${otherRole(presentRole)} n'a pas annoncé son board — forfait.`,
  );
  endMatch(matchId, match.players[presentRole].userId, 'timeout');
}

/**
 * Le round dont parle un message de round. Les clients l'annoncent tous
 * (`board_ready`, `terrain_pick`, `combat_start_ack`) ; `match.round` n'est
 * qu'un repli pour un client antérieur au champ.
 */
function roundOf(msg, match) {
  return typeof msg.round === 'number' ? msg.round : match.round;
}

function relayMessage(matchId, fromUserId, msg) {
  const match = findMatch(matchId);
  if (!match) return;
  const role = roleOfUser(match, fromUserId);
  if (!role) return;

  if (msg.type === 'round:board_ready') {
    match.round = msg.round || match.round;
    stmt.updateMatchRound.run(match.round, matchId);
    barrierFor(match, roundOf(msg, match)).boards.add(role);
  }

  // Le terrain est mémorisé POUR SON ROUND : le rôle A l'annonce au moment où
  // il tape PRÊT, donc potentiellement bien avant que son adversaire n'ait fini
  // le round précédent.
  if (msg.type === 'round:terrain_pick') {
    barrierFor(match, roundOf(msg, match)).boardId = msg.boardId ?? null;
  }

  if (msg.type === 'round:combat_start_ack') {
    const round = roundOf(msg, match);
    const barrier = barrierFor(match, round);
    barrier.acks.add(role);
    if (barrier.acks.size === 2) { openBarrier(match, round); return; }
    // Premier acquittement : on arme l'échéance. Cf. `BARRIER_TIMEOUT_MS`.
    if (!barrier.timer) {
      barrier.timer = setTimeout(() => onBarrierTimeout(match.id, round), BARRIER_TIMEOUT_MS);
    }
    return;
  }

  // ⚠️ `round:next_ready` ne RÉINITIALISE plus rien, et c'est la correction :
  // il n'est qu'un relais. Il vidait auparavant la barrière et le terrain, sans
  // regarder de quel round il parlait — si bien qu'un joueur encore en Phase
  // Shopping du round N effaçait, en la quittant, l'acquittement que son
  // adversaire venait de poser pour le round N+1. Chaque client n'acquitte
  // qu'une fois par round : la barrière ne repassait donc JAMAIS à deux, et les
  // deux joueurs restaient sur « En attente de l'adversaire… » pour toujours.
  // Constaté sur le match `d388310d`, au round 4.

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
    ? { ...playerInfo(other.userId, other.ws), ...deckDerived(other.userId, other.deckName) }
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
  // Les échéances de barrière encore armées n'ont plus d'objet : le match est
  // clos, et `onBarrierTimeout` s'en assure aussi de son côté (`status`).
  for (const b of match.barriers.values()) clearTimeout(b.timer);
  match.barriers.clear();
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
