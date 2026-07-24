// SQLite layer for the online features (accounts, sessions, friends).
// Single file DB stored on the Railway volume (DATA_DIR). Synchronous API,
// cohérent avec le style synchrone du reste du serveur (readJson/writeJson).
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'soulforge.db');
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Migrations (idempotentes) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    username      TEXT NOT NULL UNIQUE,
    username_lc   TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar        TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS friendships (
    id           TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE(requester_id, addressee_id)
  );
  CREATE INDEX IF NOT EXISTS idx_friend_requester ON friendships(requester_id);
  CREATE INDEX IF NOT EXISTS idx_friend_addressee ON friendships(addressee_id);

  -- Un "deck book" par joueur : blob JSON { decks, meta, active } miroir du
  -- DeckRepository côté client. Le client pousse/récupère l'ensemble d'un bloc.
  CREATE TABLE IF NOT EXISTS deck_books (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reset_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Historique des duels PvP en ligne. L'état de jeu vivant (unités, board,
  -- combat en cours) reste en mémoire côté serveur (ws/MatchRelay.js) — cette
  -- table sert uniquement à l'historique et à retrouver le match actif d'un
  -- joueur qui se reconnecte après un rechargement de page.
  CREATE TABLE IF NOT EXISTS matches (
    id             TEXT PRIMARY KEY,
    player_a_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_b_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status         TEXT NOT NULL DEFAULT 'active',
    winner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    ended_reason   TEXT,
    round          INTEGER NOT NULL DEFAULT 1,
    created_at     INTEGER NOT NULL,
    ended_at       INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_matches_player_a ON matches(player_a_id);
  CREATE INDEX IF NOT EXISTS idx_matches_player_b ON matches(player_b_id);
`);

// Ajout additif de colonne (ALTER TABLE ADD COLUMN échoue si déjà présente,
// donc on vérifie via PRAGMA avant — CREATE TABLE IF NOT EXISTS ne suffit
// pas pour les colonnes ajoutées après coup à une table existante).
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}

// Migration : ajout du discriminateur #tag (Pseudo#1234) — supprime la contrainte
// UNIQUE sur username/username_lc et recrée la table avec UNIQUE(username_lc, tag).
if (!userColumns.includes('tag')) {
  db.exec(`
    ALTER TABLE users RENAME TO users_v1;

    CREATE TABLE users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      username      TEXT NOT NULL,
      username_lc   TEXT NOT NULL,
      tag           TEXT NOT NULL DEFAULT '0001',
      password_hash TEXT NOT NULL,
      avatar        TEXT,
      created_at    INTEGER NOT NULL,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      UNIQUE(username_lc, tag)
    );

    INSERT INTO users (id, email, username, username_lc, tag, password_hash, avatar, created_at, is_admin)
    SELECT id, email, username, username_lc,
      printf('%04d', ROW_NUMBER() OVER (PARTITION BY username_lc ORDER BY created_at)),
      password_hash, avatar, created_at, COALESCE(is_admin, 0)
    FROM users_v1;

    DROP TABLE users_v1;
  `);
}

// Correctif FK : RENAME TABLE reécrit automatiquement les FK dans les tables
// dépendantes (comportement SQLite). Après drop de users_v1, sessions/friendships/
// deck_books/reset_tokens référencent une table supprimée — on les recrée avec
// les FK correctes vers users(id).
const sessionsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get();
if (sessionsSchema && sessionsSchema.sql.includes('users_v1')) {
  db.exec(`
    CREATE TABLE sessions_new (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    INSERT INTO sessions_new SELECT * FROM sessions;
    DROP TABLE sessions;
    ALTER TABLE sessions_new RENAME TO sessions;
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE friendships_new (
      id           TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      UNIQUE(requester_id, addressee_id)
    );
    INSERT INTO friendships_new SELECT * FROM friendships;
    DROP TABLE friendships;
    ALTER TABLE friendships_new RENAME TO friendships;
    CREATE INDEX IF NOT EXISTS idx_friend_requester ON friendships(requester_id);
    CREATE INDEX IF NOT EXISTS idx_friend_addressee ON friendships(addressee_id);

    CREATE TABLE deck_books_new (
      user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO deck_books_new SELECT * FROM deck_books;
    DROP TABLE deck_books;
    ALTER TABLE deck_books_new RENAME TO deck_books;

    CREATE TABLE reset_tokens_new (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO reset_tokens_new SELECT * FROM reset_tokens;
    DROP TABLE reset_tokens;
    ALTER TABLE reset_tokens_new RENAME TO reset_tokens;
  `);
}

// --- Prepared statements ---
const stmt = {
  insertUser: db.prepare(`
    INSERT INTO users (id, email, username, username_lc, tag, password_hash, avatar, created_at)
    VALUES (@id, @email, @username, @username_lc, @tag, @password_hash, @avatar, @created_at)
  `),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userByUsernameLc: db.prepare('SELECT * FROM users WHERE username_lc = ? ORDER BY tag LIMIT 1'),
  userByUsernameTag: db.prepare('SELECT * FROM users WHERE username_lc = ? AND tag = ?'),
  nextTagForUsername: db.prepare(`
    SELECT printf('%04d', COALESCE(MAX(CAST(tag AS INTEGER)), 0) + 1) AS next_tag
    FROM users WHERE username_lc = ?
  `),
  updateProfile: db.prepare('UPDATE users SET username = @username, username_lc = @username_lc, tag = @tag, avatar = @avatar WHERE id = @id'),
  setUserAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
  searchUsers: db.prepare(`
    SELECT id, username, tag, avatar FROM users
    WHERE username_lc LIKE ? AND id != ?
    ORDER BY username_lc, tag LIMIT 20
  `),

  insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionByToken: db.prepare('SELECT * FROM sessions WHERE token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

  insertFriendship: db.prepare(`
    INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
    VALUES (@id, @requester_id, @addressee_id, @status, @created_at, @updated_at)
  `),
  friendshipById: db.prepare('SELECT * FROM friendships WHERE id = ?'),
  // Cherche une relation existante entre deux users, dans un sens ou l'autre.
  friendshipBetween: db.prepare(`
    SELECT * FROM friendships
    WHERE (requester_id = @a AND addressee_id = @b)
       OR (requester_id = @b AND addressee_id = @a)
  `),
  updateFriendshipStatus: db.prepare('UPDATE friendships SET status = @status, updated_at = @updated_at WHERE id = @id'),
  deleteFriendship: db.prepare('DELETE FROM friendships WHERE id = ?'),
  // Amitiés acceptées impliquant l'utilisateur, avec le profil de l'"autre".
  acceptedFriends: db.prepare(`
    SELECT u.id, u.username, u.tag, u.avatar, f.id AS friendship_id
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = @uid THEN f.addressee_id ELSE f.requester_id END
    WHERE f.status = 'accepted' AND (f.requester_id = @uid OR f.addressee_id = @uid)
    ORDER BY u.username_lc
  `),
  incomingRequests: db.prepare(`
    SELECT f.id AS friendship_id, u.id, u.username, u.tag, u.avatar, f.created_at
    FROM friendships f
    JOIN users u ON u.id = f.requester_id
    WHERE f.status = 'pending' AND f.addressee_id = ?
    ORDER BY f.created_at DESC
  `),
  outgoingRequests: db.prepare(`
    SELECT f.id AS friendship_id, u.id, u.username, u.tag, u.avatar, f.created_at
    FROM friendships f
    JOIN users u ON u.id = f.addressee_id
    WHERE f.status = 'pending' AND f.requester_id = ?
    ORDER BY f.created_at DESC
  `),

  deckBookByUser: db.prepare('SELECT data FROM deck_books WHERE user_id = ?'),
  upsertDeckBook: db.prepare(`
    INSERT INTO deck_books (user_id, data, updated_at) VALUES (@user_id, @data, @updated_at)
    ON CONFLICT(user_id) DO UPDATE SET data = @data, updated_at = @updated_at
  `),

  insertResetToken: db.prepare('INSERT INTO reset_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  resetTokenByToken: db.prepare('SELECT * FROM reset_tokens WHERE token = ?'),
  deleteResetToken: db.prepare('DELETE FROM reset_tokens WHERE token = ?'),
  deleteExpiredResetTokens: db.prepare('DELETE FROM reset_tokens WHERE expires_at < ?'),

  insertMatch: db.prepare(`
    INSERT INTO matches (id, player_a_id, player_b_id, status, round, created_at)
    VALUES (@id, @player_a_id, @player_b_id, @status, @round, @created_at)
  `),
  matchById: db.prepare('SELECT * FROM matches WHERE id = ?'),
  activeMatchByUser: db.prepare(`
    SELECT * FROM matches
    WHERE status = 'active' AND (player_a_id = ? OR player_b_id = ?)
    ORDER BY created_at DESC LIMIT 1
  `),
  updateMatchRound: db.prepare('UPDATE matches SET round = ? WHERE id = ?'),
  endMatch: db.prepare(`
    UPDATE matches SET status = 'ended', winner_user_id = ?, ended_reason = ?, ended_at = ?
    WHERE id = ?
  `),
};

module.exports = { db, stmt, DB_FILE };
