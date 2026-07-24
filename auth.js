// Auth helpers: password hashing, opaque sessions, cookie + middleware.
const crypto = require('crypto');
const cookie = require('cookie');
const bcrypt = require('bcryptjs');
const { stmt } = require('./db');

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
    created_at: u.created_at, is_admin: !!u.is_admin,
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
const buckets = new Map();
function rateLimit({ windowMs = 60_000, max = 10 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
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
  attachUser,
  requireUser, optionalUser, requireAppAdmin,
  rateLimit,
};
