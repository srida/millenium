// Auth helpers: password hashing, opaque sessions, cookie + middleware.
const crypto = require('crypto');
const cookie = require('cookie');
const bcrypt = require('bcryptjs');
const { stmt } = require('./db');
// Pour la seule dette de paliers de niveau (`pending_levels` ci-dessous).
// progression.js ne requiert pas auth.js : la dépendance ne va que dans ce sens.
const progression = require('./progression');

const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'sf_session';
const BCRYPT_COST = 11;

// --- Passwords ---
function hashPassword(pw) {
  return bcrypt.hashSync(pw, BCRYPT_COST);
}
function verifyPassword(pw, hash) {
  try { return bcrypt.compareSync(pw, hash); } catch { return false; }
}

// --- Sessions ---
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  stmt.insertSession.run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = stmt.sessionByToken.get(token);
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    stmt.deleteSession.run(token);
    return null;
  }
  return s;
}

function destroySession(token) {
  if (token) stmt.deleteSession.run(token);
}

// Retire les champs sensibles avant de renvoyer un user au client.
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, username: u.username, tag: u.tag, avatar: u.avatar,
    // Dos de carte porté — `null` = celui par défaut, que le client résout.
    // Il voyage ici et pas sur `/me/cosmetics` : la popup de pioche l'affiche
    // dès le premier tour, avant que le moindre écran de boutique n'ait été
    // ouvert (même raison que `pending_levels`).
    card_back: u.card_back ?? null,
    created_at: u.created_at, is_admin: !!u.is_admin,
    // Progression : le détail de la collection reste sur /api/me/progression.
    level: u.level ?? 1, xp: u.xp ?? 0, gold: u.gold ?? 0, gems: u.gems ?? 0,
    // Paliers de niveau en attente : la pastille du menu doit être juste dès la
    // restauration de session, avant que le moindre écran n'ait été ouvert.
    pending_levels: progression.pendingLevelCount(u),
  };
}

// --- Cookies ---
function setSessionCookie(res, token, { remember = true } = {}) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    ...(remember ? { maxAge: Math.floor(SESSION_TTL_MS / 1000) } : {}),
  }));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 0,
  }));
}

function readToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  return cookie.parse(header)[COOKIE_NAME] || null;
}

// --- Middlewares ---
function attachUser(req) {
  const token = readToken(req);
  const session = getSession(token);
  if (!session) return null;
  const user = stmt.userById.get(session.user_id);
  if (!user) return null;
  req.sessionToken = token;
  req.user = user;
  return user;
}

function requireUser(req, res, next) {
  if (!attachUser(req)) return res.status(401).json({ error: 'Authentification requise' });
  next();
}

function optionalUser(req, res, next) {
  attachUser(req);
  next();
}

// Route réservée aux comptes marqués is_admin (indépendant de la basic-auth
// admin de site, utilisée elle pour /admin et l'explorateur DB).
function requireAppAdmin(req, res, next) {
  const user = attachUser(req);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  next();
}

// --- Rate limiting (mémoire, best-effort) ---
//
// ⚠️ La clé est le COMPTE quand il y en a un, l'IP sinon. Elle était l'IP dans
// tous les cas, et derrière le proxy de l'hébergeur `req.ip` est celui du proxy,
// identique pour tout le monde : tous les joueurs partageaient un seul seau par
// route. Le quota devenait un déni de service subi (15 connexions par minute
// pour le jeu ENTIER) au lieu d'une protection — et il ne protégeait plus du
// bourrage d'identifiants, qui vient lui aussi d'une IP unique.
//
// `app.set('trust proxy', 1)` (app.js) est l'autre moitié du correctif : sans
// lui, `req.ip` reste celui du proxy même pour les routes anonymes.
const buckets = new Map();

/** Purge les seaux expirés — sans elle, une entrée par (clé, route) à vie. */
function sweepBuckets(now = Date.now()) {
  let removed = 0;
  for (const [key, b] of buckets) {
    if (now > b.reset) { buckets.delete(key); removed++; }
  }
  return removed;
}

function rateLimit({ windowMs = 60_000, max = 10 } = {}) {
  return (req, res, next) => {
    // `attachUser` est déjà passé sur les routes authentifiées (requireUser en
    // amont) ; sur les routes publiques il n'y a pas de session, on retombe
    // donc sur l'IP — ce qui est le bon comportement pour /auth/login.
    const identity = req.user ? `u:${req.user.id}` : `ip:${req.ip}`;
    const key = `${identity}:${req.path}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now > b.reset) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (b.count >= max) {
      return res.status(429).json({ error: 'Trop de tentatives, réessaie plus tard.' });
    }
    b.count++;
    next();
  };
}

module.exports = {
  COOKIE_NAME,
  hashPassword, verifyPassword,
  createSession, getSession, destroySession,
  publicUser,
  setSessionCookie, clearSessionCookie,
  attachUser, sweepBuckets,
  requireUser, optionalUser, requireAppAdmin,
  rateLimit,
};
