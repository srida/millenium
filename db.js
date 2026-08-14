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

    CREATE TABLE matches_new (
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
    INSERT INTO matches_new SELECT * FROM matches;
    DROP TABLE matches;
    ALTER TABLE matches_new RENAME TO matches;
    CREATE INDEX IF NOT EXISTS idx_matches_player_a ON matches(player_a_id);
    CREATE INDEX IF NOT EXISTS idx_matches_player_b ON matches(player_b_id);
  `);
}

// Collection : une ligne par carte débloquée. Les cartes CORE_* sont acquises
// d'office à l'inscription (règles dans progression.js), les admins possèdent
// l'intégralité du jeu.
// ⚠️ Créée APRÈS la migration `tag` : un `ALTER TABLE users RENAME` réécrit les
// FK des tables dépendantes (comportement SQLite), donc une table déclarée plus
// haut pointerait sur `users_v1` — supprimée juste après — et toute écriture
// échouerait avec "no such table: main.users_v1" sur une base neuve.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_cards (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id     TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, card_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_cards_user ON user_cards(user_id);
`);

// Missions quotidiennes. Deux tables : les missions elles-mêmes (une ligne par
// mission délivrée) et l'état du cycle du joueur (jour de la dernière
// délivrance, jauge hebdomadaire, reroll gratuit consommé).
// ⚠️ Même contrainte que user_cards : créées APRÈS la migration `tag`, sinon
// leur FK pointerait sur users_v1 (supprimée juste après).
db.exec(`
  CREATE TABLE IF NOT EXISTS user_missions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mission_id   TEXT NOT NULL,
    slot_weight  INTEGER NOT NULL,
    progress     INTEGER NOT NULL DEFAULT 0,
    target       INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',
    issued_day   TEXT NOT NULL,
    issued_at    INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_user_missions_user ON user_missions(user_id, status);

  CREATE TABLE IF NOT EXISTS user_mission_state (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_issued_day TEXT,
    week_key        TEXT,
    weekly_points   INTEGER NOT NULL DEFAULT 0,
    weekly_claimed  TEXT NOT NULL DEFAULT '[]',
    reroll_free_day TEXT
  );
`);

// Une mission terminée n'est plus créditée d'office : elle attend d'être
// RÉCUPÉRÉE (status 'completed' → 'claimed'). D'où la colonne, ajoutée de
// manière additive comme les autres.
//
// ⚠️ Son absence est aussi le marqueur d'une migration qui ne doit tourner
// qu'UNE fois : les missions terminées sous l'ancien régime ont déjà été
// payées à la seconde où elles se sont terminées. Sans cette bascule elles
// réapparaîtraient comme récupérables et seraient créditées une seconde fois ;
// et un `UPDATE` rejoué à chaque démarrage volerait, lui, les missions
// légitimement en attente. La colonne ne pouvant s'ajouter qu'une fois, la
// bascule non plus.
const missionColumns = db.prepare('PRAGMA table_info(user_missions)').all().map(c => c.name);
if (!missionColumns.includes('claimed_at')) {
  db.exec(`
    ALTER TABLE user_missions ADD COLUMN claimed_at INTEGER;
    UPDATE user_missions SET status = 'claimed', claimed_at = completed_at WHERE status = 'completed';
  `);
}

// Boutique de cartes : une seule ligne par joueur. L'offre du jour y est
// PERSISTÉE (et pas recalculée à la lecture) — c'est elle qui fait foi à
// l'achat, sinon un changement de deck ou un rechargement re-tirerait l'offre
// jusqu'à satisfaction. Les RÈGLES vivent dans shop.js.
// ⚠️ Même contrainte que user_cards : créée APRÈS la migration `tag`.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_shop_state (
    user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    offer_day        TEXT,
    offer            TEXT,
    reroll_free_day  TEXT,
    pinned           TEXT,
    sets_claimed     TEXT NOT NULL DEFAULT '[]'
  );
`);

// Boutique cosmétique : avatars et variantes d'illustration. Deux tables, sur
// le modèle de la boutique de cartes — la possession (une ligne par cosmétique
// débloqué, comme user_cards) et l'offre du jour persistée (comme
// user_shop_state). Les RÈGLES vivent dans cosmetics.js.
// ⚠️ Même contrainte que user_cards : créées APRÈS la migration `tag`.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_cosmetics (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    cosmetic_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, cosmetic_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_cosmetics_user ON user_cosmetics(user_id);

  CREATE TABLE IF NOT EXISTS user_cosmetic_state (
    user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    offer_day TEXT,
    offer     TEXT
  );
`);

// Mode Arcade : la run quotidienne d'un joueur. Une seule ligne, dont tout le
// contenu tient dans un blob JSON dont la forme appartient à arcade.js — seul
// le jour est promu en colonne, pour que la comparaison de rotation reste une
// comparaison de chaîne. C'est cette persistance qui rend la run REPRENABLE :
// s'arrêter entre deux duels ne demande rien de plus au client que de relire
// « où j'en suis aujourd'hui ». Les RÈGLES vivent dans arcade.js.
// ⚠️ Même contrainte que user_cards : créée APRÈS la migration `tag`.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_arcade_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    run_day TEXT,
    run     TEXT
  );
`);

// Cadeaux. Deux formes de persistance parce qu'il y a deux natures de cadeau,
// et qu'aucune n'a besoin de la forme de l'autre :
//
//   - le QUOTIDIEN est un rendez-vous qui se rejoue : une seule ligne par
//     joueur, dont seul le JOUR est promu en colonne, pour que la comparaison
//     de rotation reste une comparaison de chaîne (même raison que
//     `user_shop_state.offer_day` et `user_arcade_state.run_day`). Rien ne
//     s'accumule, il n'y a donc rien à purger.
//   - les PONCTUELS forment un registre : une ligne par cadeau soldé, sur le
//     modèle de `user_cards` / `user_cosmetics`.
//
// ⚠️ Dans les DEUX cas, la garde anti-double-récupération est DANS LE SQL et
// nulle part ailleurs — comme `claimMission` plus bas, dont le commentaire
// explique pourquoi. Deux taps concurrents ne doivent changer qu'une ligne :
// ici c'est le `WHERE` du DO UPDATE d'un côté, la clé primaire de l'autre, et
// `changes === 0` qui vaut « quelqu'un est passé avant ».
//
// Les RÈGLES (barème, catalogue, éligibilité, livraison des lots) vivent dans
// gifts.js — ici, seulement l'accès SQL.
// ⚠️ Même contrainte que user_cards : créées APRÈS la migration `tag`.
db.exec(`
  CREATE TABLE IF NOT EXISTS user_gift_state (
    user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    daily_day        TEXT,
    daily_claimed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS user_gifts (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gift_id    TEXT NOT NULL,
    claimed_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, gift_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_gifts_user ON user_gifts(user_id);
`);

// Migration : la Convoitise (carte nommée dans tout le catalogue, 3 jours
// d'attente) a été remplacée par l'épingle d'un emplacement proposé. Les deux
// colonnes qu'elle occupait n'ont plus d'objet — DROP COLUMN plutôt que de les
// laisser traîner, la table est trop jeune pour mériter une couche de sédiment.
const shopColumns = db.prepare('PRAGMA table_info(user_shop_state)').all().map(c => c.name);
if (!shopColumns.includes('pinned')) db.exec('ALTER TABLE user_shop_state ADD COLUMN pinned TEXT');
for (const dead of ['covet_card_id', 'covet_pinned_day']) {
  if (shopColumns.includes(dead)) db.exec(`ALTER TABLE user_shop_state DROP COLUMN ${dead}`);
}

// Progression du joueur (niveau, XP, monnaies). Colonnes additives : le PRAGMA
// est relu ici car la migration `tag` ci-dessus a pu recréer la table entre-temps.
const userColumnsV2 = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
for (const [col, def] of [['level', 1], ['xp', 0], ['gold', 0], ['gems', 0]]) {
  if (!userColumnsV2.includes(col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} INTEGER NOT NULL DEFAULT ${def}`);
  }
}

// Dernier palier de niveau RÉCUPÉRÉ (levels.js). Les paliers en attente s'en
// déduisent : `levels_claimed + 1 … level`. Une seule colonne suffit parce
// qu'un palier ne se saute pas — ils se récupèrent dans l'ordre, tous à la fois.
//
// ⚠️ Son absence est aussi le marqueur d'une bascule qui ne doit tourner qu'UNE
// fois : les comptes existants sont alignés sur leur niveau courant, sinon un
// joueur déjà niveau 40 — et un admin posé d'autorité au niveau 100 — ouvrirait
// l'écran sur quarante (ou cent) paliers rétroactifs, dont des tirages d'objets
// que le jeu ne lui a jamais promis. La colonne ne pouvant s'ajouter qu'une
// fois, la bascule non plus. Même idiome que `user_missions.claimed_at`.
if (!userColumnsV2.includes('levels_claimed')) {
  db.exec(`
    ALTER TABLE users ADD COLUMN levels_claimed INTEGER NOT NULL DEFAULT 1;
    UPDATE users SET levels_claimed = level;
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

  // Progression + collection. Les règles (valeurs par défaut, grants admin,
  // cartes de départ) vivent dans progression.js — ici, seulement l'accès SQL.
  updateProgression: db.prepare(`
    UPDATE users SET level = @level, xp = @xp, gold = @gold, gems = @gems WHERE id = @id
  `),
  // Récupération des paliers de niveau : compare-and-swap. La garde
  // anti-double-crédit est DANS LE SQL (même règle que `claimMission` et
  // `claimGift`) — deux taps concurrents ne changent qu'une ligne, le second
  // voit `changes === 0` et ne livre rien. `level = @level` est dans le WHERE
  // pour qu'un niveau gagné entre la lecture et l'écriture ne soit pas soldé
  // sans avoir été livré.
  claimLevels: db.prepare(`
    UPDATE users SET levels_claimed = @level
    WHERE id = @id AND levels_claimed = @from AND level = @level
  `),
  // Niveau posé d'autorité (admin) : le compteur suit, sinon la promotion
  // ouvrirait cent paliers rétroactifs.
  syncLevelsClaimed: db.prepare('UPDATE users SET levels_claimed = level WHERE id = ?'),
  unlockCard: db.prepare(`
    INSERT OR IGNORE INTO user_cards (user_id, card_id, unlocked_at) VALUES (?, ?, ?)
  `),
  unlockedCards: db.prepare('SELECT card_id FROM user_cards WHERE user_id = ? ORDER BY card_id'),
  countUnlockedCards: db.prepare('SELECT COUNT(*) AS c FROM user_cards WHERE user_id = ?'),
  hasUnlockedCard: db.prepare('SELECT 1 FROM user_cards WHERE user_id = ? AND card_id = ?'),
  usersWithoutCards: db.prepare(`
    SELECT u.id, u.is_admin FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM user_cards c WHERE c.user_id = u.id)
  `),

  // Missions quotidiennes. Les RÈGLES (tirage, barème, jauge hebdo) vivent dans
  // missions.js — ici, seulement l'accès SQL.
  insertMission: db.prepare(`
    INSERT INTO user_missions (id, user_id, mission_id, slot_weight, progress, target, status, issued_day, issued_at)
    VALUES (@id, @user_id, @mission_id, @slot_weight, 0, @target, 'active', @issued_day, @issued_at)
  `),
  missionRowById: db.prepare('SELECT * FROM user_missions WHERE id = ?'),
  // Les missions terminées passent EN TÊTE : ce sont les seules sur lesquelles
  // le joueur a quelque chose à faire (récupérer). Viennent ensuite les actives,
  // puis les déjà récupérées, qui ne sont plus là que pour la mémoire du jour.
  missionsByUser: db.prepare(`
    SELECT * FROM user_missions WHERE user_id = ?
    ORDER BY CASE status WHEN 'completed' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, slot_weight, issued_at
  `),
  activeMissionsByUser: db.prepare("SELECT * FROM user_missions WHERE user_id = ? AND status = 'active'"),
  countActiveMissions: db.prepare("SELECT COUNT(*) AS c FROM user_missions WHERE user_id = ? AND status = 'active'"),
  updateMissionProgress: db.prepare('UPDATE user_missions SET progress = @progress, status = @status, completed_at = @completed_at WHERE id = @id'),
  // Le `status = 'completed'` de la clause WHERE n'est pas décoratif : c'est lui
  // qui rend le double crédit impossible, sans relecture préalable. Deux appels
  // concurrents → le second ne change aucune ligne (`changes === 0`).
  claimMission: db.prepare("UPDATE user_missions SET status = 'claimed', claimed_at = @claimed_at WHERE id = @id AND status = 'completed'"),
  deleteMission: db.prepare('DELETE FROM user_missions WHERE id = ?'),
  // Purge des missions RÉCUPÉRÉES d'un cycle révolu (appelée au reset quotidien).
  // Une mission terminée mais non récupérée n'est jamais purgée : le gain est
  // acquis, seule la main du joueur peut le solder.
  deleteStaleClaimedMissions: db.prepare("DELETE FROM user_missions WHERE user_id = ? AND status = 'claimed' AND issued_day < ?"),

  missionStateByUser: db.prepare('SELECT * FROM user_mission_state WHERE user_id = ?'),
  upsertMissionState: db.prepare(`
    INSERT INTO user_mission_state (user_id, last_issued_day, week_key, weekly_points, weekly_claimed, reroll_free_day)
    VALUES (@user_id, @last_issued_day, @week_key, @weekly_points, @weekly_claimed, @reroll_free_day)
    ON CONFLICT(user_id) DO UPDATE SET
      last_issued_day = @last_issued_day, week_key = @week_key,
      weekly_points = @weekly_points, weekly_claimed = @weekly_claimed,
      reroll_free_day = @reroll_free_day
  `),

  // Boutique de cartes. Les RÈGLES (tirage des emplacements, prix, épingle,
  // boosters) vivent dans shop.js — ici, seulement l'accès SQL.
  shopStateByUser: db.prepare('SELECT * FROM user_shop_state WHERE user_id = ?'),
  upsertShopState: db.prepare(`
    INSERT INTO user_shop_state (user_id, offer_day, offer, reroll_free_day, pinned, sets_claimed)
    VALUES (@user_id, @offer_day, @offer, @reroll_free_day, @pinned, @sets_claimed)
    ON CONFLICT(user_id) DO UPDATE SET
      offer_day = @offer_day, offer = @offer, reroll_free_day = @reroll_free_day,
      pinned = @pinned, sets_claimed = @sets_claimed
  `),

  // Boutique cosmétique (avatars, variantes). Les RÈGLES vivent dans
  // cosmetics.js — ici, seulement l'accès SQL.
  unlockCosmetic: db.prepare(`
    INSERT OR IGNORE INTO user_cosmetics (user_id, kind, cosmetic_id, unlocked_at) VALUES (?, ?, ?, ?)
  `),
  cosmeticsByUser: db.prepare('SELECT kind, cosmetic_id FROM user_cosmetics WHERE user_id = ? ORDER BY cosmetic_id'),
  hasCosmetic: db.prepare('SELECT 1 FROM user_cosmetics WHERE user_id = ? AND kind = ? AND cosmetic_id = ?'),
  cosmeticStateByUser: db.prepare('SELECT * FROM user_cosmetic_state WHERE user_id = ?'),
  upsertCosmeticState: db.prepare(`
    INSERT INTO user_cosmetic_state (user_id, offer_day, offer)
    VALUES (@user_id, @offer_day, @offer)
    ON CONFLICT(user_id) DO UPDATE SET offer_day = @offer_day, offer = @offer
  `),

  arcadeStateByUser: db.prepare('SELECT * FROM user_arcade_state WHERE user_id = ?'),
  upsertArcadeState: db.prepare(`
    INSERT INTO user_arcade_state (user_id, run_day, run)
    VALUES (@user_id, @run_day, @run)
    ON CONFLICT(user_id) DO UPDATE SET run_day = @run_day, run = @run
  `),

  // Cadeaux (quotidien + ponctuels). Les RÈGLES vivent dans gifts.js — ici,
  // seulement l'accès SQL.
  giftStateByUser: db.prepare('SELECT * FROM user_gift_state WHERE user_id = ?'),
  // ⚠️ Le `WHERE` du DO UPDATE **EST** la garde anti-double-récupération du
  // cadeau quotidien : la ligne ne bascule que si elle ne porte pas déjà le
  // jour courant, donc `changes === 0` signifie « déjà récupéré aujourd'hui ».
  // `IS NOT` et non `!=` : la comparaison doit être vraie quand `daily_day` est
  // NULL (première récupération du compte), ce que `!=` rendrait NULL — donc
  // faux, et le tout premier cadeau serait refusé.
  claimDailyGift: db.prepare(`
    INSERT INTO user_gift_state (user_id, daily_day, daily_claimed_at)
    VALUES (@user_id, @day, @now)
    ON CONFLICT(user_id) DO UPDATE SET daily_day = @day, daily_claimed_at = @now
      WHERE user_gift_state.daily_day IS NOT @day
  `),
  // ⚠️ Même rôle, porté ici par la clé primaire (user_id, gift_id) :
  // `INSERT OR IGNORE` puis `changes === 0` = « cadeau déjà récupéré ».
  claimGift: db.prepare('INSERT OR IGNORE INTO user_gifts (user_id, gift_id, claimed_at) VALUES (?, ?, ?)'),
  giftsByUser: db.prepare('SELECT gift_id, claimed_at FROM user_gifts WHERE user_id = ?'),

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
