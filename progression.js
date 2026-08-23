// Progression du joueur : niveau, XP, monnaies (gold / gemmes) et collection
// de cartes débloquées. db.js ne porte que l'accès SQL ; les RÈGLES sont ici.
//
//   - nouveau compte : niveau 1, 0 XP, 0 gold, 0 gemme, cartes du pack de départ
//   - compte admin   : niveau 100, 9999 gold, 9999 gemmes, toutes les cartes
//
// La liste des cartes vient de cards.json (même fichier que /api/cards), pas de
// la base : c'est le catalogue du jeu, il évolue via le panneau d'admin.
const path = require('path');
const { db, stmt } = require('./db');
// `sets.js` ne requiert ni ce module ni shop.js : c'est ce qui permet de lire le
// catalogue de packs ici sans créer de cycle (shop.js requiert progression.js).
const packs = require('./sets');
// Cache mémoire au mtime, partagé par tous les catalogues (json-cache.js ne
// requiert rien : chargeable ici sans créer de cycle, cf. son en-tête).
const { jsonCache } = require('./json-cache');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

const DEFAULTS = Object.freeze({ level: 1, xp: 0, gold: 0, gems: 0 });
const ADMIN_GRANTS = Object.freeze({ level: 100, gold: 9999, gems: 9999 });
// Repli quand AUCUN pack n'est marqué « départ » dans sets.json : préfixe des
// cartes offertes à tous les joueurs (CORE_001, CORE_002…). C'était la règle
// avant que la dotation soit designable en admin ; elle reste le filet de
// sécurité — un catalogue sans pack de départ ne doit pas produire de comptes
// sans aucune carte, qui ne pourraient plus construire de deck.
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
// ⚠️ Gagne au passage la tolérance aux virgules traînantes de `json-cache.js`
// — un catalogue édité à la main qui en portait une faisait auparavant échouer
// le parse ici, donc rendait le DERNIER cache connu (vide au boot, c'est-à-dire
// aucune carte débloquable). Strictement plus permissif, jamais moins.
const allCardIds = jsonCache(CARDS_FILE, list => list.map(c => c && c.id).filter(Boolean));

/**
 * Dotation d'un compte neuf. Elle est DESIGNÉE : ce sont les cartes du (ou des)
 * pack(s) marqué(s) « départ » dans sets.json, éditables depuis l'admin. Le
 * préfixe historique ne sert plus que de repli.
 */
function starterCardIds() {
  const designed = packs.starterCardIds();
  if (designed.length) return designed;
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
  // Le niveau est POSÉ, pas gagné : `levels_claimed` suit, sinon la promotion
  // ouvrirait cent paliers rétroactifs à récupérer (levels.js).
  stmt.syncLevelsClaimed.run(userId);
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
 *
 * ⚠️ Monter de niveau ne DONNE rien ici. Les récompenses de palier (levels.js)
 * se récupèrent d'un tap au Profil : ce module se contente de faire monter
 * `level`, et la dette de paliers se déduit à la lecture (`levels_claimed`).
 * C'est ce qui dispense de brancher quoi que ce soit sur les sources d'XP —
 * parties, missions, arcade, primes de complétion — et donc d'en oublier une.
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

/**
 * Paliers de niveau gagnés mais pas encore récupérés. La colonne
 * `levels_claimed` appartient à ce module (c'est `users`) ; ce que le palier
 * DONNE, en revanche, appartient à levels.js — qui construit sa liste sur ce
 * compte plutôt que de refaire la soustraction de son côté.
 */
function pendingLevelCount(user) {
  if (!user) return 0;
  const level = Math.max(1, user.level ?? DEFAULTS.level);
  return Math.max(0, level - Math.max(1, user.levels_claimed ?? level));
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
    // Voyage avec CHAQUE réponse qui crédite : c'est ce qui fait apparaître la
    // pastille du menu à la seconde où le niveau est gagné, sans second appel.
    pending_levels: pendingLevelCount(user),
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
  unlockedCardIds, ownsCard, getProgression, pendingLevelCount,
  backfillAll,
};
