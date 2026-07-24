// Online API: auth, profile, friends. Mounted at /api by server.js.
const crypto = require('crypto');
const express = require('express');
const { stmt } = require('../db');
const auth = require('../auth');

const router = express.Router();

// --- Validation helpers ---
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

function normEmail(v) { return String(v || '').trim().toLowerCase(); }
function validPassword(v) { return typeof v === 'string' && v.length >= 8 && v.length <= 200; }

// =====================================================================
//  AUTH
// =====================================================================
router.post('/auth/register', auth.rateLimit({ max: 10 }), (req, res) => {
  const email = normEmail(req.body.email);
  const username = String(req.body.username || '').trim();
  const password = req.body.password;

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.', field: 'email' });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Pseudo : 3 à 20 caractères (lettres, chiffres, _).', field: 'username' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum.', field: 'password' });

  if (stmt.userByEmail.get(email)) return res.status(409).json({ error: 'Cet e-mail est déjà utilisé.', field: 'email' });

  const username_lc = username.toLowerCase();
  const { next_tag } = stmt.nextTagForUsername.get(username_lc);

  const user = {
    id: crypto.randomUUID(),
    email,
    username,
    username_lc,
    tag: next_tag,
    password_hash: auth.hashPassword(password),
    avatar: req.body.avatar || null,
    created_at: Date.now(),
  };
  stmt.insertUser.run(user);

  const token = auth.createSession(user.id);
  auth.setSessionCookie(res, token);
  res.json({ user: auth.publicUser(user) });
});

router.post('/auth/login', auth.rateLimit({ max: 15 }), (req, res) => {
  const email = normEmail(req.body.email);
  const rememberMe = !!req.body.rememberMe;
  const password = req.body.password;
  const user = stmt.userByEmail.get(email);
  // Message générique : ne révèle pas si l'e-mail existe.
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  }
  const token = auth.createSession(user.id);
  auth.setSessionCookie(res, token, { remember: rememberMe });
  res.json({ user: auth.publicUser(user) });
});

router.post('/auth/logout', (req, res) => {
  const token = req.headers.cookie && require('cookie').parse(req.headers.cookie)[auth.COOKIE_NAME];
  auth.destroySession(token);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/auth/me', auth.optionalUser, (req, res) => {
  res.json({ user: req.user ? auth.publicUser(req.user) : null });
});

// =====================================================================
//  MOT DE PASSE OUBLIÉ
// =====================================================================
const RESET_TTL_MS = 60 * 60 * 1000; // 1h
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'noreply@soulforge.app';
const APP_URL = process.env.APP_URL || 'https://soulforge.up.railway.app';

router.post('/auth/forgot-password', auth.rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  const email = normEmail(req.body.email);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.', field: 'email' });

  if (!RESEND_API_KEY) return res.status(503).json({ error: 'Service e-mail non configuré.' });

  // Réponse générique : ne révèle pas si l'e-mail existe.
  const user = stmt.userByEmail.get(email);
  if (!user) return res.json({ ok: true });

  stmt.deleteExpiredResetTokens.run(Date.now());

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  stmt.insertResetToken.run(token, user.id, now, now + RESET_TTL_MS);

  const resetUrl = `${APP_URL}/?screen=resetpwd&token=${token}`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [email],
        subject: 'Réinitialisation de ton mot de passe — Soulforge',
        html: `
          <p>Bonjour ${user.username},</p>
          <p>Tu as demandé la réinitialisation de ton mot de passe Soulforge.</p>
          <p><a href="${resetUrl}" style="background:#7c5cff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Réinitialiser mon mot de passe</a></p>
          <p>Ce lien est valable <strong>1 heure</strong>. Si tu n'as pas fait cette demande, ignore cet e-mail.</p>
          <p style="color:#888;font-size:12px;">${resetUrl}</p>
        `,
      }),
    });
  } catch (err) {
    console.error('[forgot-password] Resend error:', err.message);
    return res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'e-mail.' });
  }

  res.json({ ok: true });
});

router.post('/auth/reset-password', auth.rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  const { token, password } = req.body;
  if (!token) return res.status(400).json({ error: 'Token manquant.' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum.', field: 'password' });

  stmt.deleteExpiredResetTokens.run(Date.now());
  const row = stmt.resetTokenByToken.get(token);
  if (!row || row.expires_at < Date.now()) return res.status(400).json({ error: 'Lien expiré ou invalide.' });

  const user = stmt.userById.get(row.user_id);
  if (!user) return res.status(400).json({ error: 'Compte introuvable.' });

  require('../db').db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(auth.hashPassword(password), user.id);
  stmt.deleteResetToken.run(token);

  res.json({ ok: true });
});

// =====================================================================
//  PROFILE
// =====================================================================
router.get('/profile/me', auth.requireUser, (req, res) => {
  res.json({ user: auth.publicUser(req.user) });
});

router.put('/profile/me', auth.requireUser, (req, res) => {
  const current = req.user;
  let username = current.username;
  let username_lc = current.username_lc;
  let tag = current.tag;

  if (req.body.username !== undefined) {
    const next = String(req.body.username).trim();
    if (!USERNAME_RE.test(next)) return res.status(400).json({ error: 'Pseudo : 3 à 20 caractères (lettres, chiffres, _).', field: 'username' });
    const lc = next.toLowerCase();
    // Si le pseudo change, assigner un nouveau tag pour ce nouveau pseudo.
    if (lc !== username_lc) {
      tag = stmt.nextTagForUsername.get(lc).next_tag;
    }
    username = next;
    username_lc = lc;
  }

  const avatar = req.body.avatar !== undefined ? (req.body.avatar || null) : current.avatar;
  stmt.updateProfile.run({ id: current.id, username, username_lc, tag, avatar });
  res.json({ user: auth.publicUser({ ...current, username, username_lc, tag, avatar }) });
});

// =====================================================================
//  FRIENDS
// =====================================================================
router.get('/users/search', auth.requireUser, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const like = `${q.replace(/[%_]/g, '\\$&')}%`;
  const rows = stmt.searchUsers.all(like, req.user.id);
  // Annote la relation existante pour que le client adapte le bouton.
  const users = rows.map(u => {
    const rel = stmt.friendshipBetween.get({ a: req.user.id, b: u.id });
    let relation = 'none';
    if (rel) {
      if (rel.status === 'accepted') relation = 'friends';
      else if (rel.requester_id === req.user.id) relation = 'outgoing';
      else relation = 'incoming';
    }
    return { ...u, relation };
  });
  res.json({ users });
});

router.get('/friends', auth.requireUser, (req, res) => {
  res.json({ friends: stmt.acceptedFriends.all({ uid: req.user.id }) });
});

router.get('/friends/requests', auth.requireUser, (req, res) => {
  res.json({
    incoming: stmt.incomingRequests.all(req.user.id),
    outgoing: stmt.outgoingRequests.all(req.user.id),
  });
});

// Envoi/acceptation de demande d'ami par ID utilisateur.
router.post('/friends/request', auth.requireUser, (req, res) => {
  const target = stmt.userById.get(String(req.body.userId || ''));
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas t\'ajouter toi-même.' });

  const existing = stmt.friendshipBetween.get({ a: req.user.id, b: target.id });
  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'Vous êtes déjà amis.' });
    // Demande inverse en attente → on l'accepte directement.
    if (existing.addressee_id === req.user.id) {
      stmt.updateFriendshipStatus.run({ id: existing.id, status: 'accepted', updated_at: Date.now() });
      return res.json({ ok: true, status: 'accepted' });
    }
    return res.status(409).json({ error: 'Demande déjà envoyée.' });
  }

  const now = Date.now();
  stmt.insertFriendship.run({
    id: crypto.randomUUID(),
    requester_id: req.user.id,
    addressee_id: target.id,
    status: 'pending',
    created_at: now,
    updated_at: now,
  });
  res.json({ ok: true, status: 'pending' });
});

router.post('/friends/:id/accept', auth.requireUser, (req, res) => {
  const f = stmt.friendshipById.get(req.params.id);
  if (!f || f.status !== 'pending' || f.addressee_id !== req.user.id) {
    return res.status(404).json({ error: 'Demande introuvable.' });
  }
  stmt.updateFriendshipStatus.run({ id: f.id, status: 'accepted', updated_at: Date.now() });
  res.json({ ok: true });
});

router.post('/friends/:id/decline', auth.requireUser, (req, res) => {
  const f = stmt.friendshipById.get(req.params.id);
  if (!f || f.status !== 'pending' || f.addressee_id !== req.user.id) {
    return res.status(404).json({ error: 'Demande introuvable.' });
  }
  stmt.deleteFriendship.run(f.id);
  res.json({ ok: true });
});

// Supprime une amitié acceptée OU annule une demande sortante.
router.delete('/friends/:id', auth.requireUser, (req, res) => {
  const f = stmt.friendshipById.get(req.params.id);
  if (!f || (f.requester_id !== req.user.id && f.addressee_id !== req.user.id)) {
    return res.status(404).json({ error: 'Relation introuvable.' });
  }
  stmt.deleteFriendship.run(f.id);
  res.json({ ok: true });
});

// =====================================================================
//  DECK BOOK (decks du joueur, synchronisés depuis le DeckRepository client)
// =====================================================================
router.get('/me/decks', auth.requireUser, (req, res) => {
  const row = stmt.deckBookByUser.get(req.user.id);
  let book = null;
  if (row) { try { book = JSON.parse(row.data); } catch { book = null; } }
  res.json({ book });
});

router.put('/me/decks', auth.requireUser, (req, res) => {
  const book = req.body && req.body.book;
  if (!book || typeof book !== 'object') return res.status(400).json({ error: 'book requis' });
  // On stocke le bloc tel quel (decks + meta + active). Garde-fou de taille.
  const data = JSON.stringify(book);
  if (data.length > 1_000_000) return res.status(413).json({ error: 'deck book trop volumineux' });
  stmt.upsertDeckBook.run({ user_id: req.user.id, data, updated_at: Date.now() });
  res.json({ ok: true });
});

module.exports = router;
