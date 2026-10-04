// Registre des duels contre un adversaire artificiel.
//
// Un match bot ressemble à un match réel VU DU CLIENT — mêmes messages
// `match:found` / `match:end`, même écran, même identité d'adversaire — mais il
// n'a rien en commun avec `MatchRelay` côté serveur : il n'y a pas de second
// joueur à qui relayer quoi que ce soit. Le bot est joué CHEZ le client, par
// l'`EnemyAI` du mode solo (cf. client/src/game/BotController.ts) ; ce module
// ne tient que l'identité, l'horloge et la caisse.
//
// ⚠️ Ces matchs ne sont PAS écrits dans la table `matches` : sa clé étrangère
// exige deux `users.id`, et un bot n'a pas de compte. Ce n'est pas un
// contournement — la table sert à retrouver le match ACTIF d'un joueur qui
// recharge sa page, or un match bot n'est pas reprenable : tout son état de jeu
// vit dans l'onglet du joueur, il meurt avec lui.
const crypto = require('crypto');
const progression = require('../progression');
const bots = require('../bots');
const draft = require('../draft');

/** Le joueur est toujours le rôle A — le bot n'a pas de socket à qui parler. */
const PLAYER_ROLE = 'A';

/**
 * ⚠️ Le résultat d'un duel contre bot est RAPPORTÉ PAR LE CLIENT, et il paie
 * `pvp_win` (70 XP). C'est la limite assumée du choix « bot côté client » : le
 * serveur n'arbitre rien, il n'a pas de simulation à opposer au rapport. Deux
 * garde-fous bornent l'abus sans prétendre le fermer — même posture que le
 * rate-limit de `progression.reward` sur les gains solo :
 *
 *   1. une partie de 5 tours contre 1000 PV ne se gagne pas en une minute ;
 *   2. un joueur légitime n'enchaîne pas 20 duels en une heure (≈ 3 min pièce).
 *
 * Les deux plafonds sont larges à dessein : ils doivent rester invisibles à qui
 * joue normalement, et ne coûter qu'au script qui boucle.
 */
const MIN_MATCH_MS = 60_000;
const REWARD_WINDOW_MS = 3_600_000;
const MAX_REWARDS_PER_WINDOW = 20;

const matches = new Map();     // matchId -> { userId, ws, bot, startedAt }
const matchByUser = new Map(); // userId -> matchId
const rewardLog = new Map();   // userId -> timestamps[]

function send(ws, type, payload = {}) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ ...payload, type }));
}

function isBotMatch(matchId) {
  return matches.has(matchId);
}

/**
 * Sert un adversaire artificiel au joueur en attente. Le payload de
 * `match:found` est celui d'un vrai match, plus le deck du bot — c'est lui que
 * le client fait jouer à son `EnemyAI`.
 *
 * `variants` est vide : les illustrations alternatives sont un objet de
 * collection, un bot n'en possède aucune. Le champ reste présent pour que le
 * client n'ait pas de branche à écrire (`CardArt.setEnemyVariants(null)`).
 *
 * → null si aucun bot n'est disponible : le joueur reste alors dans la file,
 *   ce qui vaut mieux que de l'envoyer affronter un deck vide.
 */
/**
 * Duel de DRAFT (`opts.draft`) : le bot a lui aussi un deck drafté, et il est
 * drafté CHEZ LE CLIENT (`logic/Draft.currentOpponent`, même fonction d'offre
 * que le joueur) — Node ne porte pas les règles d'invocation qui font l'offre.
 * Le serveur n'annonce donc qu'une identité ; l'avatar reste vide, le client
 * pose la carte la plus forte du deck drafté (même geste que `bots.avatarFor`).
 */
function createMatch(ws, userId, opts = {}) {
  const isDraft = opts.draft === true;
  const bot = isDraft ? { ...bots.identity(), avatar: null, deck: null } : bots.spawn();
  if (!bot) return null;

  const matchId = crypto.randomUUID();
  matches.set(matchId, { userId, ws, bot, draft: isDraft, startedAt: Date.now() });
  matchByUser.set(userId, matchId);

  send(ws, 'match:found', {
    matchId,
    mode: isDraft ? 'draft' : 'standard',
    youAre: PLAYER_ROLE,
    opponent: { id: null, username: bot.username, tag: bot.tag, avatar: bot.avatar, variants: {}, foils: [], finishes: {} },
    // La seule chose qui distingue ce message d'un vrai match. Le client s'en
    // sert pour monter un BotController au lieu d'un PvpController ; rien n'en
    // ressort à l'écran (cf. GameScreenPvp — même HUD, mêmes overlays).
    bot: { deck: bot.deck },
  });
  return matchId;
}

/** Le client rapporte son propre résultat, comme en PvP réel (`localWinner`). */
function handleReportResult(matchId, userId, localWinner) {
  const match = matches.get(matchId);
  if (!match || match.userId !== userId) return;
  const won = localWinner === 'player';
  endMatch(matchId, localWinner === 'draw' ? 'draw' : won ? PLAYER_ROLE : 'B', 'hp_zero');
}

/** Abandon volontaire : le bot l'emporte, et rien n'est versé. */
function handleForfeit(matchId, userId) {
  const match = matches.get(matchId);
  if (!match || match.userId !== userId) return;
  endMatch(matchId, 'B', 'forfeit');
}

/**
 * Le joueur a fermé l'onglet : le match disparaît sans gain ni défaite. Il n'y
 * a pas de période de grâce à tenir ici, contrairement au PvP réel — aucun
 * adversaire n'attend, et l'état de la partie est parti avec la page.
 *
 * ⚠️ Sauf en Draft, où c'est une DÉFAITE : sans elle, un duel mal engagé se
 * fermerait pour être rejoué, et le repli bot deviendrait la porte « rejouer
 * jusqu'à gagner » d'un mode où chaque victoire paie des gemmes. Un vrai duel
 * se perd de même au bout de la période de grâce (cf. MatchRelay).
 */
function handleDisconnect(userId) {
  const matchId = matchByUser.get(userId);
  if (!matchId) return;
  const match = matches.get(matchId);
  matches.delete(matchId);
  matchByUser.delete(userId);
  if (match?.draft) draft.recordDuel(userId, 'loss');
}

function rewardAllowed(userId, match) {
  if (Date.now() - match.startedAt < MIN_MATCH_MS) {
    console.warn(`[bot] gain refusé à ${userId} : match soldé en ${Date.now() - match.startedAt} ms.`);
    return false;
  }
  const now = Date.now();
  const recent = (rewardLog.get(userId) ?? []).filter(t => now - t < REWARD_WINDOW_MS);
  if (recent.length >= MAX_REWARDS_PER_WINDOW) {
    console.warn(`[bot] gain refusé à ${userId} : ${recent.length} duels bot gagnés dans l'heure.`);
    rewardLog.set(userId, recent);
    return false;
  }
  recent.push(now);
  rewardLog.set(userId, recent);
  return true;
}

function endMatch(matchId, winnerRole, reason) {
  const match = matches.get(matchId);
  if (!match) return;
  matches.delete(matchId);
  matchByUser.delete(match.userId);

  // Même forme de réponse que `MatchRelay.endMatch` : la progression voyage
  // avec `match:end`, le vainqueur voit sa jauge bouger sans refetch.
  const allowed = winnerRole === PLAYER_ROLE && rewardAllowed(match.userId, match);

  // Draft : le duel est soldé dans la run, AVANT le gain (la progression rendue
  // porte ainsi les gemmes). Une victoire que la caisse refuse (match trop
  // court) ne compte pas ; une défaite compte toujours ; un nul se rejoue.
  let draftOutcome = null;
  if (match.draft && winnerRole !== 'draw' && (winnerRole !== PLAYER_ROLE || allowed)) {
    const res = draft.recordDuel(match.userId, winnerRole === PLAYER_ROLE ? 'win' : 'loss');
    if (res.ok) draftOutcome = { result: res.result, status: res.status, granted: res.granted };
  }

  const gain = allowed ? progression.reward(match.userId, 'pvp_win') : null;

  send(match.ws, 'match:end', {
    matchId,
    winner: winnerRole,
    reason,
    ...(gain ? { xp_gained: progression.REWARDS.pvp_win, progression: gain } : {}),
    ...(draftOutcome ? { draft: draftOutcome } : {}),
  });
}

module.exports = {
  createMatch, isBotMatch, handleReportResult, handleForfeit, handleDisconnect,
  MIN_MATCH_MS, MAX_REWARDS_PER_WINDOW,
};
