// File d'attente de matchmaking en mémoire (FIFO simple, pas d'ELO).
// Si le serveur redémarre, les joueurs en attente doivent simplement
// rejoindre à nouveau la file (aucune persistance nécessaire ici).
const relay = require('./MatchRelay');
const botMatch = require('./BotMatch');

/**
 * Délai au bout duquel un joueur seul se voit servir un adversaire artificiel.
 *
 * Assez long pour qu'un vrai joueur qui arrive dans la même minute soit
 * toujours préféré — un bot ne doit jamais VOLER un duel humain — et assez
 * court pour qu'une file vide ne se lise pas comme un jeu mort. Le joueur
 * n'apprend pas que son adversaire en est un : il n'y a rien à distinguer à
 * l'écran (cf. ws/BotMatch.js).
 */
const BOT_DELAY_MS = 20_000;

const waiting = new Map(); // userId -> { ws, deckName, joinedAt, botTimer }

/** Retire de la file ET désarme le repli bot — les deux vont toujours ensemble. */
function drop(userId) {
  const entry = waiting.get(userId);
  if (!entry) return null;
  clearTimeout(entry.botTimer);
  waiting.delete(userId);
  return entry;
}

function joinQueue(ws, userId, deckName) {
  // Un joueur déjà en file (ex: double clic) remplace simplement son entrée.
  drop(userId);
  waiting.set(userId, { ws, deckName, joinedAt: Date.now(), botTimer: null });

  // Cherche un adversaire différent de soi-même.
  let opponentEntry = null;
  let opponentId = null;
  for (const [uid, entry] of waiting) {
    if (uid === userId) continue;
    opponentEntry = entry;
    opponentId = uid;
    break;
  }

  if (!opponentEntry) {
    // Seul dans la file : on attend, mais pas indéfiniment.
    const entry = waiting.get(userId);
    entry.botTimer = setTimeout(() => serveBot(userId), BOT_DELAY_MS);
    return;
  }

  drop(userId);
  drop(opponentId);

  relay.createMatch(
    { userId, ws, deckName },
    { userId: opponentId, ws: opponentEntry.ws, deckName: opponentEntry.deckName }
  );
}

/**
 * Le délai est écoulé et personne n'est venu : on sert un bot. Un catalogue
 * vide (ou illisible) laisse le joueur dans la file plutôt que de lui envoyer
 * un adversaire sans deck — et sans nouveau timer : la recherche continue,
 * c'est un humain qui la terminera.
 */
function serveBot(userId) {
  const entry = waiting.get(userId);
  if (!entry) return;
  if (entry.ws.readyState !== entry.ws.OPEN) { drop(userId); return; }
  const matchId = botMatch.createMatch(entry.ws, userId);
  if (matchId) drop(userId);
}

function leaveQueue(userId) {
  drop(userId);
}

function handleDisconnectWhileWaiting(userId) {
  drop(userId);
}

module.exports = { joinQueue, leaveQueue, handleDisconnectWhileWaiting, BOT_DELAY_MS };
