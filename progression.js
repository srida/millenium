// Progression du joueur : niveau, XP, monnaies (gold / gemmes) et collection
// de cartes débloquées. db.js ne porte que l'accès SQL ; les RÈGLES sont ici.
//
//   - nouveau compte : niveau 1, 0 XP, 0 gold, 0 gemme, cartes CORE_* débloquées
//   - compte admin   : niveau 100, 9999 gold, 9999 gemmes, toutes les cartes
//
// La liste des cartes vient de cards.json (même fichier que /api/cards), pas de
// la base : c'est le catalogue du jeu, il évolue via le panneau d'admin.
const path = require('path');
const fs = require('fs');
const { db, stmt } = require('./db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

const DEFAULTS = Object.freeze({ level: 1, xp: 0, gold: 0, gems: 0 });
const ADMIN_GRANTS = Object.freeze({ level: 100, gold: 9999, gems: 9999 });
// Préfixe des cartes offertes à tous les joueurs (CORE_001, CORE_002…).
const STARTER_PREFIX = 'CORE';

// Courbe de niveau : palier unique de 100 XP, d'où la jauge 0→100 de l'UI.
// `users.xp` stocke la PROGRESSION DANS LE NIVEAU (0–99), pas un cumul de
// carrière : le passage de palier est absorbé par `grant()`.
const XP_PER_LEVEL = 100;

// Barème des gains. Le client nomme l'ÉVÉNEMENT, jamais le montant — sinon
// n'importe qui pourrait s'attribuer le gain de son choix.
const REWARDS = Object.freeze({
  ai_win: 10,          // victoire sur l'IA (partie solo)
  tournament_win: 50,  // tournoi remporté (le joueur est champion)
  pvp_win: 70,         // victoire sur un autre joueur en ligne
});
// `pvp_win` est décerné par le serveur lui-même (ws/MatchRelay.endMatch, qui
// tranche le vainqueur à partir des rapports croisés des deux clients) : le
// réclamer via HTTP n'aurait aucune garantie.
const CLIENT_CLAIMABLE = Object.freeze(['ai_win', 'tournament_win']);

// Cache mémoire des ids, invalidé au mtime : l'admin peut ajouter des cartes à
// chaud (POST /api/cards) sans redémarrer le serveur.
let _cache = { mtime: -1, ids: [] };

function allCardIds() {
  try {
    const mtime = fs.statSync(CARDS_FILE).mtimeMs;
    if (mtime !== _cache.mtime) {
      const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
      _cache = { mtime, ids: (Array.isArray(cards) ? cards : []).map(c => c && c.id).filter(Boolean) };
    }
  } catch {
    // cards.json absent/illisible : on garde le dernier cache connu (vide au boot).
  }
  return _cache.ids;
}

function starterCardIds() {
  return allCardIds().filter(id => String(id).toUpperCase().startsWith(STARTER_PREFIX));
}

// --- Écritures ---

const unlockCards = db.transaction((userId, cardIds) => {
  const now = Date.now();
  for (const id of cardIds) stmt.unlockCard.run(userId, id, now);
});

/** Applique les grants admin : niveau/monnaies plafonnés au minimum requis, toutes les cartes. */
function applyAdminGrants(userId) {
  const user = stmt.userById.get(userId);
  if (!user) return null;
  stmt.updateProgression.run({
    id: userId,
    // MAX : ne jamais rétrograder un admin qui aurait déjà progressé au-delà.
    level: Math.max(user.level || 0, ADMIN_GRANTS.level),
    xp: user.xp || 0,
    gold: Math.max(user.gold || 0, ADMIN_GRANTS.gold),
    gems: Math.max(user.gems || 0, ADMIN_GRANTS.gems),
  });
  unlockCards(userId, allCardIds());
  return getProgression(stmt.userById.get(userId));
}

/** Dote un compte fraîchement créé (appelé par POST /api/auth/register). */
function initUser(userId, { isAdmin = false } = {}) {
  stmt.updateProgression.run({ id: userId, ...DEFAULTS });
  if (isAdmin) return applyAdminGrants(userId);
  unlockCards(userId, starterCardIds());
  return getProgression(stmt.userById.get(userId));
}

/** Débloque une carte pour un joueur. → true si elle ne l'était pas déjà. */
function unlockCard(userId, cardId) {
  if (!allCardIds().includes(cardId)) return false;
  const res = stmt.unlockCard.run(userId, cardId, Date.now());
  return res.changes > 0;
}

/**
 * Crédit/débit relatif (valeurs négatives = débit, plancher à 0). L'XP passe
 * par la courbe de niveau : tous les 100 points, un niveau est gagné et le
 * reste est reporté — un gain de 250 XP fait donc monter de 2 niveaux + 50.
 * Un débit d'XP ne fait jamais REDESCENDRE de niveau (plancher à 0 sur le
 * palier courant) : on ne retire pas un niveau déjà acquis.
 */
const grant = db.transaction((userId, { xp = 0, gold = 0, gems = 0 } = {}) => {
  const u = stmt.userById.get(userId);
  if (!u) return null;

  const pool = Math.max(0, (u.xp ?? DEFAULTS.xp) + xp);
  stmt.updateProgression.run({
    id: userId,
    level: Math.max(1, (u.level ?? DEFAULTS.level) + Math.floor(pool / XP_PER_LEVEL)),
    xp: pool % XP_PER_LEVEL,
    gold: Math.max(0, (u.gold ?? DEFAULTS.gold) + gold),
    gems: Math.max(0, (u.gems ?? DEFAULTS.gems) + gems),
  });
  return getProgression(stmt.userById.get(userId));
});

/** Applique le barème d'un événement de jeu. → null si la raison est inconnue. */
function reward(userId, reason) {
  const xp = REWARDS[reason];
  if (!xp) return null;
  return grant(userId, { xp });
}

// --- Lectures ---

/**
 * Ids des cartes possédées. Pour un admin, la réponse est CALCULÉE (catalogue
 * complet) et non lue en base : une carte créée après sa promotion lui
 * appartient immédiatement, sans resynchronisation.
 */
function unlockedCardIds(user) {
  if (!user) return [];
  if (user.is_admin) return allCardIds();
  return stmt.unlockedCards.all(user.id).map(r => r.card_id);
}

function ownsCard(user, cardId) {
  if (!user) return false;
  if (user.is_admin) return allCardIds().includes(cardId);
  return !!stmt.hasUnlockedCard.get(user.id, cardId);
}

/** Bloc de progression exposé au client (sans la liste de cartes). */
function getProgression(user) {
  if (!user) return null;
  return {
    level: user.level ?? DEFAULTS.level,
    xp: user.xp ?? DEFAULTS.xp,
    xp_per_level: XP_PER_LEVEL,
    gold: user.gold ?? DEFAULTS.gold,
    gems: user.gems ?? DEFAULTS.gems,
    unlocked_count: user.is_admin ? allCardIds().length : stmt.countUnlockedCards.get(user.id).c,
  };
}

/**
 * Rattrapage au démarrage : dote les comptes créés avant l'ajout de la
 * collection. Idempotent — ne cible que les joueurs sans aucune carte, ce qui
 * est impossible autrement (tout compte a au moins les CORE_*).
 */
function backfillAll() {
  const pending = stmt.usersWithoutCards.all();
  if (!pending.length) return 0;
  const starters = starterCardIds();
  const all = allCardIds();
  if (!all.length) return 0; // cards.json pas encore là : on retentera au prochain boot
  for (const u of pending) unlockCards(u.id, u.is_admin ? all : starters);
  // Les colonnes level/xp/gold/gems ont déjà les bons défauts (DEFAULT SQL) ;
  // seuls les admins existants ont besoin de leurs grants.
  for (const u of pending) if (u.is_admin) applyAdminGrants(u.id);
  console.log(`[progression] ${pending.length} compte(s) doté(s) de leur collection de départ`);
  return pending.length;
}

module.exports = {
  DEFAULTS, ADMIN_GRANTS, STARTER_PREFIX, XP_PER_LEVEL, REWARDS, CLIENT_CLAIMABLE,
  allCardIds, starterCardIds,
  initUser, applyAdminGrants, unlockCard, unlockCards, grant, reward,
  unlockedCardIds, ownsCard, getProgression,
  backfillAll,
};
