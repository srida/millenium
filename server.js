const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const auth = require('./auth');

const app = express();
app.use(express.json({ limit: '20mb' }));

// --- Config (env vars for production, local defaults for dev) ---
const IS_PROD = process.env.NODE_ENV === 'production';
const PROJECT_ROOT = __dirname;

const DATA_DIR       = process.env.DATA_DIR  || path.join(PROJECT_ROOT, 'data');
const ILLUS_DIR      = process.env.ILLUS_DIR || path.join(PROJECT_ROOT, 'resources', 'card_illustrations');
const INITIAL_DIR    = path.join(__dirname, 'initial-data');

const CARDS_FILE     = path.join(DATA_DIR, 'cards.json');
const ATTRIBUTES_FILE = path.join(DATA_DIR, 'attributes.json');
const POWERS_FILE    = path.join(DATA_DIR, 'powers.json');
const BOARDS_FILE    = path.join(DATA_DIR, 'boards.json');
const MAGIES_FILE    = path.join(DATA_DIR, 'magies.json');
const PUBLIC_DECKS_FILE = path.join(DATA_DIR, 'public_decks.json');

// --- Bootstrap: copy initial data to volume on first run ---
function bootstrap() {
  fs.mkdirSync(DATA_DIR,  { recursive: true });
  fs.mkdirSync(ILLUS_DIR, { recursive: true });
  for (const f of ['cards.json', 'attributes.json', 'powers.json', 'boards.json', 'magies.json', 'public_decks.json']) {
    const dest = path.join(DATA_DIR, f);
    const src  = path.join(INITIAL_DIR, f);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`[bootstrap] ${f} copied to volume`);
    }
  }
}
bootstrap();

// --- Basic auth (set ADMIN_USER + ADMIN_PASS in env to enable) ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS;

function requireAuth(req, res, next) {
  if (!ADMIN_PASS) return next();
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Soulforge Card Manager"');
    return res.status(401).send('Authentification requise');
  }
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="Soulforge Card Manager"');
    return res.status(401).send('Identifiants incorrects');
  }
  next();
}

// Accès admin : soit un compte joueur marqué is_admin (session cookie), soit
// les identifiants basic-auth du site (ADMIN_USER/ADMIN_PASS, utilisés aussi
// par les scripts type sync-data.js). L'un ou l'autre suffit.
function requireSiteAdmin(req, res, next) {
  const user = auth.attachUser(req);
  if (user && user.is_admin) return next();
  return requireAuth(req, res, next);
}

// Game modules (public, ES modules)
app.use('/game', express.static(path.join(__dirname, 'game')));

// Game (public)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Admin (protected)
app.get('/admin', requireSiteAdmin, (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// Illustrations public (game needs card art) — adds .png extension automatically
app.get('/illustrations/:id', (req, res) => {
  const filePath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).end();
});

// --- Helpers ---
function readJson(file) {
  const raw = fs.readFileSync(file, 'utf-8');
  return JSON.parse(raw.replace(/,\s*([\]}])/g, '$1'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, '\t'), 'utf-8');
}

function illustrationExists(id) {
  return fs.existsSync(path.join(ILLUS_DIR, `${id}.png`));
}

function illustrationChecksum(id) {
  const p = path.join(ILLUS_DIR, `${id}.png`);
  if (!fs.existsSync(p)) return null;
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

// Online API (accounts, sessions, friends) — auth par session cookie, pas la
// basic-auth admin. Monté avant le write-guard ci-dessous pour ne pas tomber
// sous la protection admin.
app.get('/api/version', (req, res) => {
  const pkg = require('./package.json');
  res.json({ version: pkg.version });
});

app.use('/api', require('./routes/online'));

// Explorateur SQLite du mode admin — READ-ONLY, protégé (obligatoire : les
// GET sous /api sont publics par défaut).
app.use('/api/admin/db', requireSiteAdmin, require('./routes/admin-db'));

// Protect write operations on /api (reads stay public for the game)
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return requireSiteAdmin(req, res, next);
  next();
});

// --- Cards API ---
app.get('/api/cards', (req, res) => {
  try {
    const cards = readJson(CARDS_FILE);
    res.json(cards.map(c => ({ ...c, _has_illustration: illustrationExists(c.id) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cards', (req, res) => {
  try {
    const cards = readJson(CARDS_FILE);
    const card = req.body;
    if (!card.id) return res.status(400).json({ error: 'id required' });
    if (cards.find(c => c.id === card.id)) return res.status(400).json({ error: `ID ${card.id} already exists` });
    delete card._has_illustration;
    cards.push(card);
    writeJson(CARDS_FILE, cards);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cards/import', (req, res) => {
  try {
    const { items, mode = 'skip' } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items doit être un tableau' });
    const cards = readJson(CARDS_FILE);
    let added = 0, replaced = 0, skipped = 0;
    const errors = [];
    for (const item of items) {
      if (!item.id) { errors.push('Élément sans ID ignoré'); continue; }
      delete item._has_illustration;
      const idx = cards.findIndex(c => c.id === item.id);
      if (idx !== -1) {
        if (mode === 'replace') { cards[idx] = item; replaced++; }
        else skipped++;
      } else {
        cards.push(item);
        added++;
      }
    }
    writeJson(CARDS_FILE, cards);
    res.json({ ok: true, added, replaced, skipped, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/cards/:id', (req, res) => {
  try {
    const cards = readJson(CARDS_FILE);
    const idx = cards.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const updated = req.body;
    delete updated._has_illustration;
    cards[idx] = updated;
    writeJson(CARDS_FILE, cards);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/cards/:id', (req, res) => {
  try {
    let cards = readJson(CARDS_FILE);
    const idx = cards.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    cards.splice(idx, 1);
    writeJson(CARDS_FILE, cards);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Illustration import ---
app.post('/api/cards/:id/illustration', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const destPath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  try {
    const imageBuffer = await downloadUrl(url);
    let sharp;
    try { sharp = require('sharp'); } catch (_) {}
    if (sharp) {
      await sharp(imageBuffer).png().toFile(destPath);
    } else {
      fs.writeFileSync(destPath, imageBuffer);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload illustration en base64 (utilisé par push-illustrations.js et l'upload depuis l'appareil dans l'admin)
// Convertit automatiquement vers PNG, quel que soit le format d'origine (JPEG, WebP, etc.)
app.put('/api/cards/:id/illustration', async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  const destPath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  try {
    const imageBuffer = Buffer.from(data, 'base64');
    let sharp;
    try { sharp = require('sharp'); } catch (_) {}
    if (sharp) {
      await sharp(imageBuffer).png().toFile(destPath);
    } else {
      fs.writeFileSync(destPath, imageBuffer);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/cards/:id/illustration', (req, res) => {
  const filePath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Attributes API ---
app.get('/api/attributes', (req, res) => {
  try { res.json(readJson(ATTRIBUTES_FILE)); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attributes', (req, res) => {
  try {
    const attributes = readJson(ATTRIBUTES_FILE);
    const attr = req.body;
    if (!attr.id) return res.status(400).json({ error: 'id required' });
    if (attributes.find(a => a.id === attr.id)) return res.status(400).json({ error: `ID ${attr.id} already exists` });
    attributes.push(attr);
    writeJson(ATTRIBUTES_FILE, attributes);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attributes/import', (req, res) => {
  try {
    const { items, mode = 'skip' } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items doit être un tableau' });
    const attributes = readJson(ATTRIBUTES_FILE);
    let added = 0, replaced = 0, skipped = 0;
    const errors = [];
    for (const item of items) {
      if (!item.id) { errors.push('Élément sans ID ignoré'); continue; }
      const idx = attributes.findIndex(a => a.id === item.id);
      if (idx !== -1) {
        if (mode === 'replace') { attributes[idx] = item; replaced++; }
        else skipped++;
      } else {
        attributes.push(item);
        added++;
      }
    }
    writeJson(ATTRIBUTES_FILE, attributes);
    res.json({ ok: true, added, replaced, skipped, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/attributes/:id', (req, res) => {
  try {
    const attributes = readJson(ATTRIBUTES_FILE);
    const idx = attributes.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    attributes[idx] = req.body;
    writeJson(ATTRIBUTES_FILE, attributes);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/attributes/:id', (req, res) => {
  try {
    let attributes = readJson(ATTRIBUTES_FILE);
    const idx = attributes.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    attributes.splice(idx, 1);
    writeJson(ATTRIBUTES_FILE, attributes);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Powers API ---
app.get('/api/powers', (req, res) => {
  try { res.json(readJson(POWERS_FILE)); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/powers', (req, res) => {
  try {
    const powers = readJson(POWERS_FILE);
    const power = req.body;
    if (!power.id) return res.status(400).json({ error: 'id required' });
    if (powers.find(p => p.id === power.id)) return res.status(400).json({ error: `ID ${power.id} already exists` });
    powers.push(power);
    writeJson(POWERS_FILE, powers);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/powers/import', (req, res) => {
  try {
    const { items, mode = 'skip' } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items doit être un tableau' });
    const powers = readJson(POWERS_FILE);
    let added = 0, replaced = 0, skipped = 0;
    const errors = [];
    for (const item of items) {
      if (!item.id) { errors.push('Élément sans ID ignoré'); continue; }
      const idx = powers.findIndex(p => p.id === item.id);
      if (idx !== -1) {
        if (mode === 'replace') { powers[idx] = item; replaced++; }
        else skipped++;
      } else {
        powers.push(item);
        added++;
      }
    }
    writeJson(POWERS_FILE, powers);
    res.json({ ok: true, added, replaced, skipped, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/powers/:id', (req, res) => {
  try {
    const powers = readJson(POWERS_FILE);
    const idx = powers.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    powers[idx] = req.body;
    writeJson(POWERS_FILE, powers);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/powers/:id', (req, res) => {
  try {
    let powers = readJson(POWERS_FILE);
    const idx = powers.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    powers.splice(idx, 1);
    writeJson(POWERS_FILE, powers);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Boards API ---
app.get('/api/boards', (req, res) => {
  try {
    const boards = readJson(BOARDS_FILE);
    res.json(boards.map(b => ({ ...b, _has_illustration: illustrationExists(b.id) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/boards', requireSiteAdmin, (req, res) => {
  try {
    const boards = readJson(BOARDS_FILE);
    const board  = req.body;
    if (!board.id) return res.status(400).json({ error: 'id required' });
    if (boards.find(b => b.id === board.id)) return res.status(400).json({ error: `ID ${board.id} already exists` });
    boards.push(board);
    writeJson(BOARDS_FILE, boards);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/boards/import', requireSiteAdmin, (req, res) => {
  try {
    const { items, mode = 'skip' } = req.body;
    const boards = readJson(BOARDS_FILE);
    let added = 0, replaced = 0, skipped = 0;
    for (const item of items) {
      const idx = boards.findIndex(b => b.id === item.id);
      if (idx !== -1) {
        if (mode === 'replace') { boards[idx] = item; replaced++; }
        else skipped++;
      } else {
        boards.push(item); added++;
      }
    }
    writeJson(BOARDS_FILE, boards);
    res.json({ ok: true, added, replaced, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/boards/:id', requireSiteAdmin, (req, res) => {
  try {
    const boards = readJson(BOARDS_FILE);
    const idx = boards.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    boards[idx] = req.body;
    writeJson(BOARDS_FILE, boards);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/boards/:id', requireSiteAdmin, (req, res) => {
  try {
    let boards = readJson(BOARDS_FILE);
    const idx = boards.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    boards.splice(idx, 1);
    writeJson(BOARDS_FILE, boards);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/boards/:id/illustration', requireSiteAdmin, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const destPath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  try {
    const imageBuffer = await downloadUrl(url);
    let sharp;
    try { sharp = require('sharp'); } catch (_) {}
    if (sharp) {
      await sharp(imageBuffer).png().toFile(destPath);
    } else {
      fs.writeFileSync(destPath, imageBuffer);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/boards/:id/illustration', requireSiteAdmin, (req, res) => {
  const filePath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Magies API ---
app.get('/api/magies', (req, res) => {
  try {
    const magies = readJson(MAGIES_FILE);
    res.json(magies.map(m => ({ ...m, _has_illustration: illustrationExists(m.id) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/magies', requireSiteAdmin, (req, res) => {
  try {
    const magies = readJson(MAGIES_FILE);
    const magie  = req.body;
    if (!magie.id) return res.status(400).json({ error: 'id required' });
    if (magies.find(m => m.id === magie.id)) return res.status(400).json({ error: `ID ${magie.id} already exists` });
    delete magie._has_illustration;
    magies.push(magie);
    writeJson(MAGIES_FILE, magies);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/magies/import', requireSiteAdmin, (req, res) => {
  try {
    const { items, mode = 'skip' } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items doit être un tableau' });
    const magies = readJson(MAGIES_FILE);
    let added = 0, replaced = 0, skipped = 0;
    const errors = [];
    for (const item of items) {
      if (!item.id) { errors.push('Élément sans ID ignoré'); continue; }
      delete item._has_illustration;
      const idx = magies.findIndex(m => m.id === item.id);
      if (idx !== -1) {
        if (mode === 'replace') { magies[idx] = item; replaced++; }
        else skipped++;
      } else {
        magies.push(item);
        added++;
      }
    }
    writeJson(MAGIES_FILE, magies);
    res.json({ ok: true, added, replaced, skipped, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/magies/:id', requireSiteAdmin, (req, res) => {
  try {
    const magies = readJson(MAGIES_FILE);
    const idx = magies.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const updated = req.body;
    delete updated._has_illustration;
    magies[idx] = updated;
    writeJson(MAGIES_FILE, magies);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/magies/:id', requireSiteAdmin, (req, res) => {
  try {
    let magies = readJson(MAGIES_FILE);
    const idx = magies.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    magies.splice(idx, 1);
    writeJson(MAGIES_FILE, magies);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/magies/:id/illustration', requireSiteAdmin, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const destPath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  try {
    const imageBuffer = await downloadUrl(url);
    let sharp;
    try { sharp = require('sharp'); } catch (_) {}
    if (sharp) {
      await sharp(imageBuffer).png().toFile(destPath);
    } else {
      fs.writeFileSync(destPath, imageBuffer);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/magies/:id/illustration', requireSiteAdmin, (req, res) => {
  const filePath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Decks publics API ---
app.get('/api/decks', (req, res) => {
  try {
    res.json(readJson(PUBLIC_DECKS_FILE));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/decks', requireSiteAdmin, (req, res) => {
  try {
    const decks = readJson(PUBLIC_DECKS_FILE);
    const deck = req.body;
    if (!deck.id) return res.status(400).json({ error: 'id required' });
    if (decks.find(d => d.id === deck.id)) return res.status(400).json({ error: `ID ${deck.id} already exists` });
    decks.push(deck);
    writeJson(PUBLIC_DECKS_FILE, decks);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/decks/import', requireSiteAdmin, (req, res) => {
  try {
    const { items, mode = 'skip' } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items doit être un tableau' });
    const decks = readJson(PUBLIC_DECKS_FILE);
    let added = 0, replaced = 0, skipped = 0;
    const errors = [];
    for (const item of items) {
      if (!item.id) { errors.push('Élément sans ID ignoré'); continue; }
      const idx = decks.findIndex(d => d.id === item.id);
      if (idx !== -1) {
        if (mode === 'replace') { decks[idx] = item; replaced++; }
        else skipped++;
      } else {
        decks.push(item);
        added++;
      }
    }
    writeJson(PUBLIC_DECKS_FILE, decks);
    res.json({ ok: true, added, replaced, skipped, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/decks/:id', requireSiteAdmin, (req, res) => {
  try {
    const decks = readJson(PUBLIC_DECKS_FILE);
    const idx = decks.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    decks[idx] = req.body;
    writeJson(PUBLIC_DECKS_FILE, decks);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/decks/:id', requireSiteAdmin, (req, res) => {
  try {
    let decks = readJson(PUBLIC_DECKS_FILE);
    const idx = decks.findIndex(d => d.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    decks.splice(idx, 1);
    writeJson(PUBLIC_DECKS_FILE, decks);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Export API (pour la future sync locale) ---
app.get('/api/export', (req, res) => {
  try {
    const cards      = readJson(CARDS_FILE);
    const attributes = readJson(ATTRIBUTES_FILE);
    const powers     = readJson(POWERS_FILE);
    const boards     = readJson(BOARDS_FILE);
    const magies     = readJson(MAGIES_FILE);
    const publicDecks = readJson(PUBLIC_DECKS_FILE);
    const illustrations = fs.readdirSync(ILLUS_DIR)
      .filter(f => f.endsWith('.png'))
      .map(f => {
        const id = f.replace('.png', '');
        return { id, checksum: illustrationChecksum(id) };
      });
    res.json({ cards, attributes, powers, boards, magies, publicDecks, illustrations });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export/illustration/:id', (req, res) => {
  const filePath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json({ id: req.params.id, data: fs.readFileSync(filePath).toString('base64') });
});

// --- Generic illustration upload/delete (utilisé par scripts/sync-data.js) ---
app.put('/api/illustrations/:id', (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  const destPath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  try {
    fs.writeFileSync(destPath, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/illustrations/:id', (req, res) => {
  const filePath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Download helper ---
function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return downloadUrl(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const { attachPvpWebSocketServer } = require('./ws/pvpServer');

const PORT = process.env.PORT || 3742;
const httpServer = http.createServer(app);
attachPvpWebSocketServer(httpServer);
httpServer.listen(PORT, () => console.log(`Card Manager running at http://localhost:${PORT}`));
