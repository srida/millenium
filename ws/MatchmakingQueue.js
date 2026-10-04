// File d'attente de matchmaking en mémoire (FIFO simple, pas d'ELO).
// Si le serveur redémarre, les joueurs en attente doivent simplement
// rejoindre à nouveau la file (aucune persistance nécessaire ici).
const relay = require('./MatchRelay');
const botMatch = require('./BotMatch');
const draft = require('../draft');

/**
 * Fenêtre au bout de laquelle un joueur seul se voit servir un adversaire
 * artificiel : le délai est TIRÉ AU HASARD dans `[MIN, MAX]`, à chaque entrée
 * en file.
 *
 * Assez long pour qu'un vrai joueur qui arrive entre-temps soit toujours
 * préféré — un bot ne doit jamais VOLER un duel humain — et assez court pour
 * qu'une file vide ne se lise pas comme un jeu mort.
 *
 * ⚠️ Le hasard n'est pas cosmétique : **une échéance fixe est un tell**. Le
 * joueur n'est pas censé apprendre que son adversaire en est un (rien ne les
 * distingue à l'écran, cf. ws/BotMatch.js) — mais « trouvé à 20 s pile, trois
 * fois de suite » se remarque, là où une attente qui varie ressemble à une
 * file. C'est la même raison qui fait varier le « PRÊT » du bot en partie
 * (game/BotController.READY_MIN_MS → READY_MAX_MS).
 */
const BOT_DELAY_MIN_MS = 10_000;
const BOT_DELAY_MAX_MS = 20_000;

/** Délai du repli, tiré dans la fenêtre — bornes comprises. */
function botDelay() {
  return BOT_DELAY_MIN_MS + Math.floor(Math.random() * (BOT_DELAY_MAX_MS - BOT_DELAY_MIN_MS + 1));
}

const waiting = new Map(); // userId -> { ws, deckName, mode, draftIds, joinedAt, botTimer }

/**
 * Deux files dans une : `standard` (Duel en ligne, deck actif) et `draft`
 * (duels de la run de Draft du jour). Un joueur n'est apparié qu'avec un
 * joueur du MÊME mode — un deck drafté de 15 cartes contre un deck construit
 * ne serait pas un duel de Draft.
 */
const MODES = Object.freeze(['standard', 'draft']);

/** Retire de la file ET désarme le repli bot — les deux vont toujours ensemble. */
function drop(userId) {
  const entry = waiting.get(userId);
  if (!entry) return null;
  clearTimeout(entry.botTimer);
  waiting.delete(userId);
  return entry;
}

function sendError(ws, code, message) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', code, message }));
}

function joinQueue(ws, userId, deckName, mode = 'standard') {
  // Un joueur déjà en file (ex: double clic) remplace simplement son entrée.
  drop(userId);
  if (!MODES.includes(mode)) mode = 'standard';

  // Draft : le deck vient de la run SERVEUR, jamais du client. Pas de run en
  // phase de duels (ou une carte due) → pas de file.
  let draftIds = null;
  if (mode === 'draft') {
    const ready = draft.duelDeck(userId);
    if (!ready.ok) { sendError(ws, 'draft_unavailable', ready.reason); return; }
    draftIds = ready.card_ids;
  }
  waiting.set(userId, { ws, deckName, mode, draftIds, joinedAt: Date.now(), botTimer: null });

  // Cherche un adversaire différent de soi-même, dans le même mode.
  let opponentEntry = null;
  let opponentId = null;
  for (const [uid, entry] of waiting) {
    if (uid === userId || entry.mode !== mode) continue;
    opponentEntry = entry;
    opponentId = uid;
    break;
  }

  if (!opponentEntry) {
    // Seul dans la file : on attend, mais pas indéfiniment.
    const entry = waiting.get(userId);
    entry.botTimer = setTimeout(() => serveBot(userId), botDelay());
    return;
  }

  drop(userId);
  drop(opponentId);

  relay.createMatch(
    { userId, ws, deckName, draftIds },
    { userId: opponentId, ws: opponentEntry.ws, deckName: opponentEntry.deckName, draftIds: opponentEntry.draftIds },
    mode,
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
  const matchId = botMatch.createMatch(entry.ws, userId, { draft: entry.mode === 'draft' });
  if (matchId) drop(userId);
}

function leaveQueue(userId) {
  drop(userId);
}

function handleDisconnectWhileWaiting(userId) {
  drop(userId);
}

module.exports = { MODES, joinQueue, leaveQueue, handleDisconnectWhileWaiting, BOT_DELAY_MIN_MS, BOT_DELAY_MAX_MS };
