const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const auth = require('./auth');
// Catalogue des packs de boutique : le serveur en écrit le fichier (onglet
// Packs), ce module le relit (cache au mtime) pour les flags calculés.
const packs = require('./sets');
// Catalogue des variantes d'illustration (onglet Variantes). Propriétaire du
// dossier d'illustrations : leur art y vit sous l'id de la variante.
const variants = require('./variants');

const app = express();
app.use(express.json({ limit: '20mb' }));

// --- Config (env vars for production, local defaults for dev) ---
const IS_PROD = process.env.NODE_ENV === 'production';
const PROJECT_ROOT = __dirname;

// Emplacement des données et des quatre familles d'images : asset-dirs.js est
// seul à en décider (il déduit leur racine commune de ILLUS_DIR, pour qu'aucune
// famille n'atterrisse dans le conteneur — voir l'en-tête de ce module).
//  - ILLUS_DIR     : art des cartes, terrains, magies et variantes (espace de
//                    noms plat — c'est variants.js qui possède ce dossier)
//  - AVATARS_DIR   : portraits des decks publics (adversaires solo + tournoi)
//  - POSTERS_DIR   : affiches des packs de boutique
//  - BOARD_BG_DIR  : fonds de grille des terrains, vue de dessus posée sous les
//                    5 × 11 cases en combat — distinct de l'illustration du
//                    terrain (vignette carrée du tooltip) : deux cadrages.
const {
  DATA_DIR, ILLUS_DIR, AVATARS_DIR, POSTERS_DIR, BOARD_BG_DIR,
  FAMILIES: ASSET_FAMILIES, isEphemeral,
} = require('./asset-dirs');
const INITIAL_DIR    = path.join(__dirname, 'initial-data');

// Avatar servi quand un deck n'a pas le sien : aucun écran ne doit afficher de
// trou, et un deck fraîchement créé en admin est immédiatement présentable.
const DEFAULT_AVATAR_ID = 'PUBLIC_DECK_000';

const CARDS_FILE     = path.join(DATA_DIR, 'cards.json');
const ATTRIBUTES_FILE = path.join(DATA_DIR, 'attributes.json');
const POWERS_FILE    = path.join(DATA_DIR, 'powers.json');
const BOARDS_FILE    = path.join(DATA_DIR, 'boards.json');
const MAGIES_FILE    = path.join(DATA_DIR, 'magies.json');
const PUBLIC_DECKS_FILE = path.join(DATA_DIR, 'public_decks.json');
const SETS_FILE      = path.join(DATA_DIR, 'sets.json');
const MISSIONS_FILE  = path.join(DATA_DIR, 'missions.json');
const GIFTS_FILE     = path.join(DATA_DIR, 'gifts.json');
const VARIANTS_FILE  = variants.VARIANTS_FILE;

// --- Bootstrap: copy initial data to volume on first run ---
function bootstrap() {
  fs.mkdirSync(DATA_DIR,  { recursive: true });
  fs.mkdirSync(ILLUS_DIR, { recursive: true });
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  fs.mkdirSync(POSTERS_DIR, { recursive: true });
  fs.mkdirSync(BOARD_BG_DIR, { recursive: true });
  for (const f of ['cards.json', 'attributes.json', 'powers.json', 'boards.json', 'magies.json', 'public_decks.json', 'missions.json', 'sets.json', 'variants.json', 'gifts.json']) {
    const dest = path.join(DATA_DIR, f);
    const src  = path.join(INITIAL_DIR, f);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`[bootstrap] ${f} copied to volume`);
    }
  }
  // L'avatar par défaut est du code, pas de la donnée : si AVATARS_DIR pointe
  // sur un volume vide (prod), il faut l'y déposer, sinon tous les portraits
  // tombent en 404 tant qu'aucun n'a été uploadé.
  const avatarDefault = path.join(AVATARS_DIR, `${DEFAULT_AVATAR_ID}.png`);
  const avatarSrc = path.join(PROJECT_ROOT, 'resources', 'enemy_avatars', `${DEFAULT_AVATAR_ID}.png`);
  if (!fs.existsSync(avatarDefault) && fs.existsSync(avatarSrc)) {
    fs.copyFileSync(avatarSrc, avatarDefault);
    console.log('[bootstrap] avatar par défaut copié sur le volume');
  }
  logAssetDirs();
}

// Récapitulatif des dossiers d'images réellement utilisés. Une famille dont la
// variable d'environnement n'est pas réglée en prod écrit dans le conteneur, et
// son contenu disparaît au déploiement suivant — panne invisible au démarrage,
// qui ne se constate qu'après coup par des images manquantes. On la nomme donc
// ici, franchement, plutôt que de la laisser se découvrir.
function logAssetDirs() {
  for (const { label, dir, env } of ASSET_FAMILIES) {
    let count = 0;
    try { count = fs.readdirSync(dir).filter(f => f.endsWith('.png')).length; } catch { /* dossier illisible */ }
    console.log(`[assets] ${label.padEnd(17)} ${dir} (${count} image${count > 1 ? 's' : ''})`);
    if (IS_PROD && isEphemeral(dir)) {
      // Régler ILLUS_DIR suffit pour toutes les familles sauf elle-même : les
      // autres dossiers se déduisent de sa racine (cf. asset-dirs.js).
      const fix = env === 'ILLUS_DIR' ? 'ILLUS_DIR' : `${env}, ou ILLUS_DIR dont il se déduit,`;
      console.warn(
        `[assets] ⚠ ${label} : ce dossier est DANS LE CONTENEUR, son contenu sera ` +
        `effacé au prochain déploiement. Régler ${fix} sur le volume.`,
      );
    }
  }
}
bootstrap();

// Dote les comptes antérieurs à la collection (idempotent, cf. progression.js).
// Après bootstrap() : cards.json doit exister sur le volume.
const progression = require('./progression');
progression.backfillAll();

// Après bootstrap() lui aussi : gifts.js tire db.js et shop.js derrière lui, et
// son catalogue vit sur le volume.
const gifts = require('./gifts');

// --- Basic auth (set ADMIN_USER + ADMIN_PASS in env to enable) ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS;

function requireAuth(req, res, next) {
  if (!ADMIN_PASS) return next();
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Millenium Card Manager"');
    return res.status(401).send('Authentification requise');
  }
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="Millenium Card Manager"');
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

// Client Vite build (SPA). `npm run build` (dans client/) génère client/dist.
// express.static sert index.html sur "/", plus les assets, le service worker,
// le manifest et les icônes. Le fallback SPA est monté en fin de fichier.
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');
app.use(express.static(CLIENT_DIST));

// Admin (protected)
app.get('/admin', requireSiteAdmin, (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// Un id d'asset ne doit jamais pouvoir remonter l'arborescence : il sert de nom
// de fichier tel quel.
function safeAssetId(id) {
  return /^[A-Za-z0-9_-]+$/.test(id || '') ? id : null;
}

// Illustrations public (game needs card art) — adds .png extension automatically.
// Sert aussi l'art des VARIANTES, qui vivent dans le même espace de noms.
// Le garde-fou n'est pas décoratif : Express décode `%2f`, et depuis les
// variantes l'id vient du méta de deck, donc du joueur.
app.get('/illustrations/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).end();
  const filePath = path.join(ILLUS_DIR, `${id}.png`);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).end();
});

// Avatars des decks publics — le repli sur l'avatar par défaut est fait ICI et
// nulle part ailleurs : chaque écran qui affiche un adversaire n'a qu'une URL à
// construire, sans savoir si le deck a son portrait.
app.get('/avatars/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).end();
  const filePath = path.join(AVATARS_DIR, `${id}.png`);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  const fallback = path.join(AVATARS_DIR, `${DEFAULT_AVATAR_ID}.png`);
  if (fs.existsSync(fallback)) return res.sendFile(fallback);
  res.status(404).end();
});

// Affiche d'un pack de boutique. Pas de repli, contrairement aux avatars : il
// n'existe pas d'affiche par défaut, et un pack sans affiche est un cas normal
// (l'instantané de la boutique porte `has_poster`, le client pose alors une
// tuile neutre plutôt qu'une image cassée).
app.get('/pack-posters/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).end();
  const filePath = path.join(POSTERS_DIR, `${id}.png`);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).end();
});

// Fond de grille d'un terrain. Pas de repli non plus : un terrain sans fond est
// le cas normal (le décor de scène par défaut est alors conservé), et c'est la
// scène 3D qui décide, sur le drapeau `_has_background`, de charger ou non.
app.get('/board-backgrounds/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).end();
  const filePath = path.join(BOARD_BG_DIR, `${id}.png`);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).end();
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

function avatarExists(id) {
  return fs.existsSync(path.join(AVATARS_DIR, `${id}.png`));
}

function boardBackgroundExists(id) {
  return fs.existsSync(path.join(BOARD_BG_DIR, `${id}.png`));
}

// Écrit un buffer image en PNG (conversion via sharp quand il est installé —
// l'upload accepte alors JPEG/WebP —, sinon copie brute).
async function savePng(dir, id, imageBuffer) {
  const destPath = path.join(dir, `${id}.png`);
  let sharp;
  try { sharp = require('sharp'); } catch (_) { /* optionnel */ }
  if (sharp) await sharp(imageBuffer).png().toFile(destPath);
  else fs.writeFileSync(destPath, imageBuffer);
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
// `_starter` dit si la carte fait partie de la dotation d'un compte neuf (pack
// marqué « départ »). Calculé, jamais persisté — même statut que
// `_has_illustration`. C'est ce qui évite au client de dupliquer la règle de
// dotation pour son repli invité.
app.get('/api/cards', (req, res) => {
  try {
    const cards = readJson(CARDS_FILE);
    const starter = new Set(progression.starterCardIds());
    res.json(cards.map(c => ({
      ...c,
      _has_illustration: illustrationExists(c.id),
      _starter: starter.has(c.id),
    })));
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
// `_has_illustration` et `_has_background` sont calculés à la lecture depuis le
// disque : les réécrire dans boards.json ferait mentir la donnée dès qu'une
// image est ajoutée ou retirée hors de cette requête.
function stripBoardComputed(board) {
  delete board._has_illustration;
  delete board._has_background;
}

app.get('/api/boards', (req, res) => {
  try {
    const boards = readJson(BOARDS_FILE);
    res.json(boards.map(b => ({
      ...b,
      _has_illustration: illustrationExists(b.id),
      _has_background: boardBackgroundExists(b.id),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/boards', requireSiteAdmin, (req, res) => {
  try {
    const boards = readJson(BOARDS_FILE);
    const board  = req.body;
    if (!board.id) return res.status(400).json({ error: 'id required' });
    if (boards.find(b => b.id === board.id)) return res.status(400).json({ error: `ID ${board.id} already exists` });
    stripBoardComputed(board);
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
      stripBoardComputed(item);
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
    stripBoardComputed(req.body);
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

// --- Illustration d'un terrain (vignette du tooltip 🗺️) : même triptyque que
// les avatars et les affiches de packs — URL, upload base64 depuis l'appareil,
// suppression ---
app.post('/api/boards/:id/illustration', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(ILLUS_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/boards/:id/illustration', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(ILLUS_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/boards/:id/illustration', requireSiteAdmin, (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = path.join(ILLUS_DIR, `${id}.png`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Fond de grille d'un terrain (vue de dessus, ratio 5:11) ---
app.post('/api/boards/:id/background', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(BOARD_BG_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/boards/:id/background', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(BOARD_BG_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/boards/:id/background', requireSiteAdmin, (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = path.join(BOARD_BG_DIR, `${id}.png`);
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

// --- Variantes API ---
// Une variante est une illustration alternative d'une carte, vendue dans
// l'onglet cosmétique de la boutique. Son art vit dans ILLUS_DIR sous l'id de
// la variante : le triptyque d'illustration ci-dessous est donc exactement
// celui des magies, au chemin près (il n'y en a pas).
app.get('/api/variants', (req, res) => {
  try {
    const list = readJson(VARIANTS_FILE);
    res.json(list.map(v => ({ ...v, _has_illustration: illustrationExists(v.id) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/variants', requireSiteAdmin, (req, res) => {
  try {
    const list = readJson(VARIANTS_FILE);
    const variant = req.body;
    if (!variant.id) return res.status(400).json({ error: 'id required' });
    if (!variant.card_id) return res.status(400).json({ error: 'card_id required' });
    if (list.find(v => v.id === variant.id)) return res.status(400).json({ error: `ID ${variant.id} already exists` });
    delete variant._has_illustration;
    list.push(variant);
    writeJson(VARIANTS_FILE, list);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/variants/import', requireSiteAdmin, (req, res) => {
  try {
    const { items, mode = 'skip' } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items doit être un tableau' });
    const list = readJson(VARIANTS_FILE);
    let added = 0, replaced = 0, skipped = 0;
    const errors = [];
    for (const item of items) {
      if (!item.id) { errors.push('Élément sans ID ignoré'); continue; }
      if (!item.card_id) { errors.push(`${item.id} : card_id manquant, ignoré`); continue; }
      delete item._has_illustration;
      const idx = list.findIndex(v => v.id === item.id);
      if (idx !== -1) {
        if (mode === 'replace') { list[idx] = item; replaced++; }
        else skipped++;
      } else {
        list.push(item);
        added++;
      }
    }
    writeJson(VARIANTS_FILE, list);
    res.json({ ok: true, added, replaced, skipped, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/variants/:id', requireSiteAdmin, (req, res) => {
  try {
    const list = readJson(VARIANTS_FILE);
    const idx = list.findIndex(v => v.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const updated = req.body;
    if (!updated.card_id) return res.status(400).json({ error: 'card_id required' });
    delete updated._has_illustration;
    list[idx] = updated;
    writeJson(VARIANTS_FILE, list);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/variants/:id', requireSiteAdmin, (req, res) => {
  try {
    const list = readJson(VARIANTS_FILE);
    const idx = list.findIndex(v => v.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    list.splice(idx, 1);
    writeJson(VARIANTS_FILE, list);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/variants/:id/illustration', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(ILLUS_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/variants/:id/illustration', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(ILLUS_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/variants/:id/illustration', requireSiteAdmin, (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = path.join(ILLUS_DIR, `${id}.png`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Missions API ---
app.get('/api/missions', (req, res) => {
  try {
    res.json(readJson(MISSIONS_FILE));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/missions', requireSiteAdmin, (req, res) => {
  try {
    const missions = readJson(MISSIONS_FILE);
    const mission  = req.body;
    if (!mission.id) return res.status(400).json({ error: 'id required' });
    if (missions.find(m => m.id === mission.id)) return res.status(400).json({ error: `ID ${mission.id} already exists` });
    missions.push(mission);
    writeJson(MISSIONS_FILE, missions);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/missions/import', requireSiteAdmin, (req, res) => {
  try {
    const { items, mode = 'skip' } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items doit être un tableau' });
    const missions = readJson(MISSIONS_FILE);
    let added = 0, replaced = 0, skipped = 0;
    const errors = [];
    for (const item of items) {
      if (!item.id) { errors.push('Élément sans ID ignoré'); continue; }
      const idx = missions.findIndex(m => m.id === item.id);
      if (idx !== -1) {
        if (mode === 'replace') { missions[idx] = item; replaced++; }
        else skipped++;
      } else {
        missions.push(item);
        added++;
      }
    }
    writeJson(MISSIONS_FILE, missions);
    res.json({ ok: true, added, replaced, skipped, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/missions/:id', requireSiteAdmin, (req, res) => {
  try {
    const missions = readJson(MISSIONS_FILE);
    const idx = missions.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    missions[idx] = req.body;
    writeJson(MISSIONS_FILE, missions);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/missions/:id', requireSiteAdmin, (req, res) => {
  try {
    let missions = readJson(MISSIONS_FILE);
    const idx = missions.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    missions.splice(idx, 1);
    writeJson(MISSIONS_FILE, missions);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Cadeaux API ---
// ⚠️ `created_at` est POSÉ PAR LE SERVEUR et jamais lu du corps de la requête :
// c'est lui, et lui seul, qui décide quels comptes peuvent réclamer le cadeau
// (ceux qui existaient déjà). Le laisser au formulaire, c'est laisser une faute
// de frappe rendre un cadeau invisible à tous — ou l'ouvrir à toute la base.
//
// La validation passe par `gifts.validateGift`, la même fonction que celle dont
// dérive le chargement : la route d'écriture et la lecture ne peuvent pas
// diverger sur ce qu'est un cadeau valide.
app.get('/api/gifts', (req, res) => {
  try {
    res.json(readJson(GIFTS_FILE));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/gifts', requireSiteAdmin, (req, res) => {
  try {
    const check = gifts.validateGift(req.body);
    if (!check.ok) return res.status(400).json({ error: check.errors[0].message, field: check.errors[0].field });
    const list = readJson(GIFTS_FILE);
    if (list.find(g => g.id === req.body.id)) return res.status(400).json({ error: `ID ${req.body.id} already exists` });
    list.push({ ...req.body, created_at: Date.now() });
    writeJson(GIFTS_FILE, list);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ⚠️ L'import CONSERVE le `created_at` reçu quand il y en a un : `sync-data.js`
// doit pouvoir faire l'aller-retour local ↔ prod sans re-dater les cadeaux, ce
// qui les rouvrirait à tous les comptes créés depuis.
app.post('/api/gifts/import', requireSiteAdmin, (req, res) => {
  try {
    const { items, mode = 'skip' } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items doit être un tableau' });
    const list = readJson(GIFTS_FILE);
    let added = 0, replaced = 0, skipped = 0;
    const errors = [];
    for (const item of items) {
      if (!item.id) { errors.push('Élément sans ID ignoré'); continue; }
      const check = gifts.validateGift(item);
      if (!check.ok) { errors.push(`${item.id} : ${check.errors[0].message}`); continue; }
      const entry = { ...item, created_at: Number(item.created_at) || Date.now() };
      const idx = list.findIndex(g => g.id === item.id);
      if (idx !== -1) {
        if (mode === 'replace') { list[idx] = entry; replaced++; }
        else skipped++;
      } else {
        list.push(entry);
        added++;
      }
    }
    writeJson(GIFTS_FILE, list);
    res.json({ ok: true, added, replaced, skipped, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Le PUT PRÉSERVE le `created_at` enregistré : retoucher le libellé d'un cadeau
// ne doit pas déplacer son adresse.
app.put('/api/gifts/:id', requireSiteAdmin, (req, res) => {
  try {
    const check = gifts.validateGift(req.body);
    if (!check.ok) return res.status(400).json({ error: check.errors[0].message, field: check.errors[0].field });
    const list = readJson(GIFTS_FILE);
    const idx = list.findIndex(g => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    list[idx] = { ...req.body, id: list[idx].id, created_at: list[idx].created_at };
    writeJson(GIFTS_FILE, list);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ⚠️ Supprimer un cadeau n'efface PAS le registre des récupérations : recréer un
// cadeau sous le même id le laisse silencieusement inaccessible à tous ceux qui
// avaient pris le premier. Même piège que la prime de complétion d'un pack,
// mémorisée par id — l'écran d'admin le dit.
app.delete('/api/gifts/:id', requireSiteAdmin, (req, res) => {
  try {
    const list = readJson(GIFTS_FILE);
    const idx = list.findIndex(g => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    list.splice(idx, 1);
    writeJson(GIFTS_FILE, list);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Decks publics API ---
// `_has_avatar` est calculé (comme `_has_illustration` ailleurs) : il dit si le
// deck a SON portrait, là où /avatars/:id sert toujours quelque chose.
app.get('/api/decks', (req, res) => {
  try {
    res.json(readJson(PUBLIC_DECKS_FILE).map(d => ({ ...d, _has_avatar: avatarExists(d.id) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/decks', requireSiteAdmin, (req, res) => {
  try {
    const decks = readJson(PUBLIC_DECKS_FILE);
    const deck = req.body;
    if (!deck.id) return res.status(400).json({ error: 'id required' });
    if (decks.find(d => d.id === deck.id)) return res.status(400).json({ error: `ID ${deck.id} already exists` });
    delete deck._has_avatar;
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
      delete item._has_avatar;
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
    const updated = req.body;
    delete updated._has_avatar;
    // FUSION et non remplacement : deux clients écrivent ici, et ils n'envoient
    // pas le même objet. Le formulaire admin poste le deck complet, mais le
    // DeckBuilder (iframe, ?publicDeckId=) ne poste que `{ id, name, deck }` —
    // un remplacement franc effacerait `difficulty` à chaque composition.
    decks[idx] = { ...decks[idx], ...updated };
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

// --- Avatars des decks publics (même triptyque que les illustrations : URL,
// upload base64 depuis l'appareil, suppression) ---
app.post('/api/decks/:id/avatar', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(AVATARS_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/decks/:id/avatar', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(AVATARS_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/decks/:id/avatar', requireSiteAdmin, (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = path.join(AVATARS_DIR, `${id}.png`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Packs de boutique API ---
// Le fichier `sets.json` FAIT FOI pour le pool d'un booster (cf. sets.js) ; le
// champ `set` d'une carte n'en est que le miroir. Ces routes écrivent les deux,
// pour qu'une carte n'appartienne qu'à UN pack commercial — sans quoi une carte
// listée dans un pack et miroir d'un autre se retrouverait dans les deux pools.
function packMemberIds(pack) {
  return Array.isArray(pack?.cards) ? pack.cards.filter(Boolean) : [];
}

/**
 * Aligne le champ `set` des cartes sur la composition d'un pack : il est posé
 * sur les membres, et effacé sur les cartes qui viennent d'en sortir.
 *
 * Un pack de DÉPART ne possède pas le miroir : la dotation chevauche les packs
 * commerciaux par nature (une carte offerte peut appartenir à un pack vendu),
 * lui laisser réécrire le champ dépouillerait les packs concernés.
 */
function syncCardSetMirror(pack, previousIds = []) {
  if (!pack || pack.starter === true) return;
  const members = new Set(packMemberIds(pack));
  const dropped = new Set(previousIds.filter(id => !members.has(id)));
  if (!members.size && !dropped.size) return;

  const cards = readJson(CARDS_FILE);
  let touched = 0;
  for (const c of cards) {
    if (members.has(c.id) && c.set !== pack.id) { c.set = pack.id; touched++; }
    else if (dropped.has(c.id) && c.set === pack.id) { delete c.set; touched++; }
  }
  if (touched) writeJson(CARDS_FILE, cards);
}

// `_has_poster` est calculé (comme `_has_avatar` pour les decks) : un pack sans
// affiche est un cas normal, il n'y a pas d'affiche par défaut.
app.get('/api/sets', (req, res) => {
  try {
    res.json(readJson(SETS_FILE).map(s => ({ ...s, _has_poster: packs.posterExists(s.id) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sets', requireSiteAdmin, (req, res) => {
  try {
    const sets = readJson(SETS_FILE);
    const pack = req.body;
    if (!pack.id) return res.status(400).json({ error: 'id required' });
    if (sets.find(s => s.id === pack.id)) return res.status(400).json({ error: `ID ${pack.id} already exists` });
    delete pack._has_poster;
    sets.push(pack);
    writeJson(SETS_FILE, sets);
    syncCardSetMirror(pack);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sets/import', requireSiteAdmin, (req, res) => {
  try {
    const { items, mode = 'skip' } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items doit être un tableau' });
    const sets = readJson(SETS_FILE);
    let added = 0, replaced = 0, skipped = 0;
    const errors = [];
    for (const item of items) {
      if (!item.id) { errors.push('Élément sans ID ignoré'); continue; }
      delete item._has_poster;
      const idx = sets.findIndex(s => s.id === item.id);
      if (idx !== -1) {
        if (mode === 'replace') { sets[idx] = item; replaced++; }
        else skipped++;
      } else {
        sets.push(item);
        added++;
      }
    }
    writeJson(SETS_FILE, sets);
    res.json({ ok: true, added, replaced, skipped, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/sets/:id', requireSiteAdmin, (req, res) => {
  try {
    const sets = readJson(SETS_FILE);
    const idx = sets.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const updated = req.body;
    delete updated._has_poster;
    const previousIds = packMemberIds(sets[idx]);
    sets[idx] = updated;
    writeJson(SETS_FILE, sets);
    syncCardSetMirror(updated, previousIds);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/sets/:id', requireSiteAdmin, (req, res) => {
  try {
    const sets = readJson(SETS_FILE);
    const idx = sets.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    // Le miroir des cartes du pack supprimé est effacé : le laisser pointer sur
    // un pack disparu ne casse rien aujourd'hui, mais ferait revenir les cartes
    // dans son pool si l'id était réutilisé.
    syncCardSetMirror({ id: sets[idx].id, cards: [] }, packMemberIds(sets[idx]));
    sets.splice(idx, 1);
    writeJson(SETS_FILE, sets);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Affiches des packs (même triptyque que les avatars : URL, upload base64
// depuis l'appareil, suppression) ---
app.post('/api/sets/:id/poster', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(POSTERS_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/sets/:id/poster', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(POSTERS_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/sets/:id/poster', requireSiteAdmin, (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = path.join(POSTERS_DIR, `${id}.png`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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
    const sets       = readJson(SETS_FILE);
    const variantList = readJson(VARIANTS_FILE);
    // Un cadeau n'a pas d'image propre : il emprunte celles de ses lots
    // (cartes, affiches de packs), déjà servies. Pas de famille d'assets.
    const giftList = readJson(GIFTS_FILE);
    // L'art des variantes est déjà dans ILLUS_DIR : il voyage avec les
    // illustrations, sans famille d'assets supplémentaire.
    const illustrations = listPngChecksums(ILLUS_DIR);
    const avatars = listPngChecksums(AVATARS_DIR);
    const boardBackgrounds = listPngChecksums(BOARD_BG_DIR);
    const packPosters = listPngChecksums(POSTERS_DIR);
    res.json({ cards, attributes, powers, boards, magies, publicDecks, sets, variants: variantList, gifts: giftList, illustrations, avatars, packPosters, boardBackgrounds });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function listPngChecksums(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.png'))
    .map(f => ({
      id: f.replace(/\.png$/, ''),
      checksum: crypto.createHash('md5').update(fs.readFileSync(path.join(dir, f))).digest('hex'),
    }));
}

app.get('/api/export/illustration/:id', (req, res) => {
  const filePath = path.join(ILLUS_DIR, `${req.params.id}.png`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json({ id: req.params.id, data: fs.readFileSync(filePath).toString('base64') });
});

app.get('/api/export/avatar/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  const filePath = path.join(AVATARS_DIR, `${id}.png`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json({ id, data: fs.readFileSync(filePath).toString('base64') });
});

app.get('/api/export/pack-poster/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  const filePath = path.join(POSTERS_DIR, `${id}.png`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json({ id, data: fs.readFileSync(filePath).toString('base64') });
});

app.get('/api/export/board-background/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  const filePath = path.join(BOARD_BG_DIR, `${id}.png`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json({ id, data: fs.readFileSync(filePath).toString('base64') });
});

// --- Upload/delete générique d'affiche de pack (scripts/sync-data.js) ---
app.put('/api/pack-posters/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    fs.writeFileSync(path.join(POSTERS_DIR, `${id}.png`), Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/pack-posters/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = path.join(POSTERS_DIR, `${id}.png`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Upload/delete générique de fond de terrain (scripts/sync-data.js) ---
app.put('/api/board-backgrounds/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    fs.writeFileSync(path.join(BOARD_BG_DIR, `${id}.png`), Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/board-backgrounds/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = path.join(BOARD_BG_DIR, `${id}.png`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Upload/delete générique d'avatar (scripts/sync-data.js) ---
app.put('/api/avatars/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    fs.writeFileSync(path.join(AVATARS_DIR, `${id}.png`), Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/avatars/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = path.join(AVATARS_DIR, `${id}.png`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// Fallback SPA : toute route GET non-API renvoie l'app cliente (deep-links
// /deck_selector, /game…). Les préfixes API/assets serveur passent au suivant.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/illustrations') || req.path.startsWith('/avatars')
      || req.path.startsWith('/pack-posters') || req.path.startsWith('/board-backgrounds')
      || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

const { attachPvpWebSocketServer } = require('./ws/pvpServer');

const PORT = process.env.PORT || 3742;
const httpServer = http.createServer(app);
attachPvpWebSocketServer(httpServer);
httpServer.listen(PORT, () => console.log(`Card Manager running at http://localhost:${PORT}`));
