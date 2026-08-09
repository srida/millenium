// Online API: auth, profile, friends. Mounted at /api by server.js.
const crypto = require('crypto');
const express = require('express');
const { stmt } = require('../db');
const auth = require('../auth');
const progression = require('../progression');
const missions = require('../missions');
const shop = require('../shop');
const cosmetics = require('../cosmetics');

const router = express.Router();

// --- Validation helpers ---
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

function normEmail(v) { return String(v || '').trim().toLowerCase(); }

// Un avatar voyage soit en id (`CORE_003`), soit en URL héritée
// (`/illustrations/CORE_003`) ; il est STOCKÉ en URL, la forme que tous les
// écrans savent déjà rendre. Retourne null si l'id n'est pas dans `allowed`.
function avatarIdOrNull(raw, allowed) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const id = value.startsWith('/illustrations/') ? value.slice('/illustrations/'.length) : value;
  return allowed.includes(id) ? `/illustrations/${id}` : null;
}
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
    // Un compte neuf ne possède aucun cosmétique : seuls les avatars offerts
    // d'office sont recevables ici. Tout le reste est écarté en silence — c'est
    // une inscription, pas le bon moment pour un message d'erreur sur un champ
    // que le formulaire ne propose même pas.
    avatar: avatarIdOrNull(req.body.avatar, cosmetics.DEFAULT_AVATARS),
    created_at: Date.now(),
  };
  stmt.insertUser.run(user);
  // Dotation de départ : niveau 1 / 0 XP / 0 gold / 0 gemme + cartes CORE_*.
  progression.initUser(user.id);

  const token = auth.createSession(user.id);
  auth.setSessionCookie(res, token);
  res.json({ user: auth.publicUser(stmt.userById.get(user.id)) });
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

  const resetUrl = `${APP_URL}/?screen=reset_password&token=${token}`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [email],
        subject: 'Réinitialisation de ton mot de passe — Millenium',
        html: `
          <p>Bonjour ${user.username},</p>
          <p>Tu as demandé la réinitialisation de ton mot de passe Millenium.</p>
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

  // L'avatar est un id d'illustration : soit un avatar offert d'office, soit un
  // avatar acheté en boutique cosmétique. Il était jusqu'ici écrit TEL QUEL en
  // base, donc une chaîne arbitraire finissait dans un `<img src>` — c'est le
  // seul point de passage, la vérification appartient donc ici.
  //
  // On stocke la forme URL `/illustrations/<id>` : c'est celle que tous les
  // écrans savent déjà rendre, et celle des comptes existants.
  let avatar = current.avatar;
  if (req.body.avatar !== undefined) {
    const raw = String(req.body.avatar || '').trim();
    if (!raw) {
      avatar = null;
    } else {
      const id = raw.startsWith('/illustrations/') ? raw.slice('/illustrations/'.length) : raw;
      if (!cosmetics.canUseAvatar(current, id)) {
        return res.status(400).json({ error: 'Cet avatar n\'est pas débloqué.', field: 'avatar' });
      }
      avatar = `/illustrations/${id}`;
    }
  }
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
//  PROGRESSION (niveau, XP, monnaies, collection)
// =====================================================================
// Le résumé (niveau/XP/gold/gemmes) voyage déjà dans `publicUser` ; cette route
// ajoute la liste complète des cartes possédées, trop volumineuse pour /auth/me.
router.get('/me/progression', auth.requireUser, (req, res) => {
  res.json({
    ...progression.getProgression(req.user),
    unlocked_cards: progression.unlockedCardIds(req.user),
  });
});

// Gain d'XP après un événement de jeu. Le client nomme la RAISON, le serveur
// applique son barème (progression.REWARDS) — un montant envoyé par le client
// serait auto-attribué.
//
// ⚠️ Les parties solo et le tournoi se déroulent entièrement côté client : le
// serveur ne peut que croire le joueur sur parole. Le rate-limit borne l'abus
// sans le rendre impossible. `pvp_win` est donc exclu d'ici — le serveur le
// décerne lui-même, à partir du résultat qu'il arbitre (ws/MatchRelay.js).
router.post('/me/progression/reward', auth.requireUser, auth.rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const reason = String(req.body && req.body.reason || '');
  if (!progression.CLIENT_CLAIMABLE.includes(reason)) {
    return res.status(400).json({ error: 'Gain inconnu.', field: 'reason' });
  }
  res.json({ reason, gained: progression.REWARDS[reason], progression: progression.reward(req.user.id, reason) });
});

// =====================================================================
//  MISSIONS QUOTIDIENNES
// =====================================================================
// `refresh` délivre les lots manquants avant de répondre : le cycle avance à la
// lecture, il n'y a pas de tâche planifiée côté serveur.
router.get('/me/missions', auth.requireUser, (req, res) => {
  res.json(missions.refresh(req.user));
});

// Flux d'événements d'une partie. Le client envoie des ÉVÉNEMENTS NOMMÉS, jamais
// une progression ni un montant : le serveur applique son catalogue et son
// barème (même règle que /me/progression/reward).
//
// ⚠️ Les parties solo se déroulant entièrement côté client, le serveur ne peut
// que croire le joueur sur la teneur du lot. Ce qu'il ne délègue PAS : les
// garde-fous anti-concede et anti-AFK, dérivés du contenu du lot lui-même
// (≥ 2 combats lancés, ≥ 1 invocation) et non d'un drapeau envoyé par le client.
router.post('/me/missions/events', auth.requireUser, auth.rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const body = req.body || {};
  const events = Array.isArray(body.events) ? body.events : null;
  if (!events) return res.status(400).json({ error: 'events requis', field: 'events' });
  if (events.length > missions.MAX_EVENTS_PER_BATCH) {
    return res.status(413).json({ error: 'Trop d\'événements dans le lot.' });
  }
  const matchId = body.match_id ? String(body.match_id).slice(0, 64) : null;

  missions.sync(req.user);
  const result = missions.applyEvents(req.user, { matchId, events });
  // L'utilisateur a pu être crédité : on relit la ligne pour renvoyer un solde à jour.
  const fresh = stmt.userById.get(req.user.id);
  res.json({
    ...result,
    ...missions.getSnapshot(req.user),
    progression: progression.getProgression(fresh),
  });
});

// Récupération du gain d'une mission terminée. Le client désigne une LIGNE, le
// serveur applique son barème : rien ne change au contrat « le client nomme, le
// serveur chiffre », seul le moment du crédit se déplace.
router.post('/me/missions/:id/claim', auth.requireUser, auth.rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  missions.sync(req.user);
  const result = missions.claim(req.user, String(req.params.id));
  if (!result.ok) return res.status(400).json({ error: result.reason });
  const fresh = stmt.userById.get(req.user.id);
  res.json({
    ...result,
    ...missions.getSnapshot(req.user),
    progression: progression.getProgression(fresh),
  });
});

// Récupération d'un palier hebdomadaire atteint. Le chemin a un segment de plus
// que `/me/missions/:id/claim` À DESSEIN : `/me/missions/weekly/claim` aurait la
// même forme que celui-ci et serait capté par `:id = 'weekly'` — une collision
// que seul l'ordre d'enregistrement départagerait.
router.post('/me/missions/weekly/:points/claim', auth.requireUser, auth.rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  missions.sync(req.user);
  const result = missions.claimMilestone(req.user, req.params.points);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  const fresh = stmt.userById.get(req.user.id);
  res.json({
    ...result,
    ...missions.getSnapshot(req.user),
    progression: progression.getProgression(fresh),
  });
});

router.post('/me/missions/:id/reroll', auth.requireUser, auth.rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  missions.sync(req.user);
  const result = missions.reroll(req.user, String(req.params.id));
  if (!result.ok) return res.status(400).json({ error: result.reason });
  const fresh = stmt.userById.get(req.user.id);
  res.json({
    ...result,
    ...missions.getSnapshot(req.user),
    progression: progression.getProgression(fresh),
  });
});

// =====================================================================
//  BOUTIQUE DE CARTES
// =====================================================================
// Comme pour les missions, l'offre avance À LA LECTURE : un GET génère l'offre
// du jour si elle manque, il n'y a pas de tâche planifiée. Et comme pour la
// progression, le client ne chiffre RIEN : il désigne un emplacement ou un
// set, le serveur applique ses prix et son tirage.
//
// Ici, contrairement au solo, le serveur n'a rien à croire sur parole : la
// collection, les soldes et l'offre sont tous de son côté. Le seul vecteur
// d'abus serait le re-tirage de l'offre, d'où sa persistance.
router.get('/me/shop', auth.requireUser, (req, res) => {
  res.json({ ...shop.refresh(req.user), progression: progression.getProgression(req.user) });
});

// Réponse commune aux mutations : instantané complet + solde à jour. Le client
// n'a jamais à recharger derrière une action.
function shopResult(req, res, result) {
  if (!result.ok) return res.status(result.stale ? 409 : 400).json({ error: result.reason });
  const fresh = stmt.userById.get(req.user.id);
  res.json({ ...result, ...shop.getSnapshot(fresh), progression: progression.getProgression(fresh) });
}

// `card_id` accompagne le slot : l'achat valide l'offre HORODATÉE, pas la
// courante — un tap au moment de la rotation échoue (409) au lieu d'acheter la
// carte qui vient de prendre la place.
router.post('/me/shop/buy', auth.requireUser, auth.rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const slot = Number(req.body?.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > shop.DAILY_SLOTS) {
    return res.status(400).json({ error: 'Emplacement invalide.', field: 'slot' });
  }
  const currency = req.body?.currency === 'gems' ? 'gems' : 'golds';
  shop.sync(req.user);
  shopResult(req, res, shop.buySlot(req.user, slot, req.body?.card_id ? String(req.body.card_id) : null, currency));
});

router.post('/me/shop/reroll', auth.requireUser, auth.rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const slot = Number(req.body?.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > shop.DAILY_SLOTS) {
    return res.status(400).json({ error: 'Emplacement invalide.', field: 'slot' });
  }
  shop.sync(req.user);
  shopResult(req, res, shop.reroll(req.user, slot));
});

// `slot: null` détache. Une seule épingle : désigner un autre emplacement la
// déplace (règle appliquée dans shop.setPin).
router.post('/me/shop/pin', auth.requireUser, auth.rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
  const raw = req.body?.slot;
  const slot = raw === null || raw === undefined ? null : Number(raw);
  if (slot !== null && (!Number.isInteger(slot) || slot < 1 || slot > shop.DAILY_SLOTS)) {
    return res.status(400).json({ error: 'Emplacement invalide.', field: 'slot' });
  }
  shop.sync(req.user);
  shopResult(req, res, shop.setPin(req.user, slot));
});

router.post('/me/shop/booster', auth.requireUser, auth.rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const setId = String(req.body?.set_id || '').slice(0, 64);
  const currency = req.body?.currency === 'gems' ? 'gems' : 'golds';
  if (!setId) return res.status(400).json({ error: 'set_id requis', field: 'set_id' });
  shop.sync(req.user);
  shopResult(req, res, shop.buyBooster(req.user, setId, currency));
});

// =====================================================================
//  BOUTIQUE COSMÉTIQUE (avatars, variantes d'illustration)
// =====================================================================
// Mêmes règles que la boutique de cartes : l'offre avance à la lecture, le
// client désigne sans jamais chiffrer, et l'instantané complet accompagne
// chaque mutation pour qu'aucune action n'entraîne de rechargement.
//
// Cet instantané sert aussi le Profil (avatars portables) et le DeckBuilder
// (variantes possédées) : un seul appel pour les trois écrans.
router.get('/me/cosmetics', auth.requireUser, (req, res) => {
  res.json({ ...cosmetics.refresh(req.user), progression: progression.getProgression(req.user) });
});

function cosmeticResult(req, res, result) {
  if (!result.ok) return res.status(result.stale ? 409 : 400).json({ error: result.reason });
  const fresh = stmt.userById.get(req.user.id);
  res.json({ ...result, ...cosmetics.getSnapshot(fresh), progression: progression.getProgression(fresh) });
}

router.post('/me/cosmetics/buy', auth.requireUser, auth.rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const kind = String(req.body?.kind || '');
  const id = String(req.body?.id || '').slice(0, 64);
  if (!cosmetics.KINDS.includes(kind)) return res.status(400).json({ error: 'Type de cosmétique inconnu.', field: 'kind' });
  if (!id) return res.status(400).json({ error: 'id requis', field: 'id' });
  cosmetics.sync(req.user);
  cosmeticResult(req, res, cosmetics.buy(req.user, kind, id));
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
