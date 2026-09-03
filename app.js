// --- Basic auth du site (ADMIN_USER + ADMIN_PASS) ---
//
// ⚠️ EN TÊTE DE FICHIER, AVANT TOUT `require`, et ce n'est pas cosmétique.
//
// `requireAuth` laissait auparavant passer quand `ADMIN_PASS` manquait. Comme
// `requireSiteAdmin` retombe dessus et que le write-guard global couvre TOUT
// `POST/PUT/DELETE` sous `/api`, une variable absente ouvrait l'API d'écriture
// entière à des requêtes anonymes — y compris `PUT /api/admin/db/users/:id/admin`,
// qui pose le niveau 100, 9999 golds, 9999 gemmes et tout le catalogue sur
// n'importe quel compte. Le dépôt n'ayant par ailleurs aucun chargeur de `.env`
// avant ce lot, un `npm start` local tournait TOUJOURS dans cet état.
//
// D'où le refus de démarrer plutôt qu'un repli permissif : il n'existe plus
// d'état où l'oubli d'une variable ouvre le serveur. C'est la bonne panne —
// bruyante au déploiement — plutôt que la mauvaise, silencieuse en production.
//
// La garde est placée AVANT `require('./auth')` (qui tire `db.js`, lequel crée
// DATA_DIR et ouvre la base) et avant `bootstrap()` : un démarrage refusé ne
// doit laisser aucune trace sur le disque, sinon le refus lui-même devient un
// effet de bord.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS;

/**
 * → le mot de passe, ou JETTE si la variable manque.
 *
 * ⚠️ Elle JETTE au lieu de terminer le processus, et ce n'est pas un détail :
 * c'est ce qui rend la règle testable (`client/src/test/http-boot.test.ts`
 * vérifie que `require('./app')` lève, et qu'il n'a rien écrit sur le disque en
 * levant). `server.js` traduit l'erreur en sortie non nulle — le comportement
 * observable au démarrage est identique.
 */
function assertAdminPassword(pass = ADMIN_PASS) {
  if (pass) return pass;
  throw new Error(
    'ADMIN_PASS n\'est pas réglé — le serveur refuse de démarrer.\n' +
    '  Sans lui, TOUTE écriture sur /api serait anonyme, promotion admin comprise.\n' +
    '  Dev  : renseigner ADMIN_PASS dans .env (npm start le charge via --env-file-if-exists).\n' +
    '  Prod : régler la variable dans la configuration de l\'hébergeur.',
  );
}

assertAdminPassword();

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

// Compression des réponses. Le gain principal n'est pas sur le SPA (déjà
// pré-compressé au build) mais sur les CATALOGUES : `GET /api/cards` sérialise
// 261 Ko de JSON très répétitif à chaque démarrage de client, et c'est la route
// la plus chaude du jeu. Sur un jeu mobile-first, c'est le gain le plus direct
// qu'on puisse poser en une ligne.
app.use(require('compression')());

// En-têtes de sécurité (X-Content-Type-Options, Referrer-Policy, HSTS…).
//
// ⚠️ La CSP est désactivée À DESSEIN, pas par négligence : `admin.html` est un
// fichier de 282 Ko écrit à la main, tout en scripts et styles en ligne, que la
// politique par défaut de helmet casserait net. La régler proprement (nonces,
// ou extraction des scripts) est un travail à part entière — le faire à moitié
// ici donnerait une CSP qu'on désactiverait au premier bug, ce qui est pire que
// pas de CSP du tout.
app.use(require('helmet')({ contentSecurityPolicy: false }));

// ⚠️ Derrière le proxy de l'hébergeur, `req.ip` est celui du PROXY tant que
// cette ligne n'est pas là : identique pour tout le monde. Le rate-limit
// d'auth.js, qui s'en sert comme clé pour les routes anonymes, comptait donc
// tous les joueurs comme un seul — 15 connexions par minute pour le jeu
// entier. `1` = un seul proxy de confiance devant nous, ce qui est la
// configuration de Railway ; une valeur plus permissive laisserait un client
// forger son propre `X-Forwarded-For` et se donner une IP neuve à volonté.
app.set('trust proxy', 1);

// Deux plafonds de corps, et pas un seul.
//
// La limite globale était à 20 Mo, posée avant toute authentification : une
// requête ANONYME vers n'importe quelle route /api faisait tamponner 20 Mo
// avant que le moindre middleware d'auth ne s'exécute. Seuls les uploads
// d'illustration en base64 ont besoin de cette taille ; ils la reçoivent
// nommément, plus bas, sur leurs routes.
//
// 1 Mo et non 256 Ko : un import en masse depuis l'admin poste `cards.json`
// tel quel, soit ~320 Ko aujourd'hui. Le plafond doit laisser au catalogue la
// place de grandir sans casser l'onglet Cartes.
const jsonSmall = express.json({ limit: '1mb' });
const jsonUpload = express.json({ limit: '20mb' });

// Les routes d'upload d'image, sous leurs deux formes : les familles
// génériques utilisées par sync-data.js (`/api/illustrations/:id`…) et le
// triptyque par entité, qui se termine toujours par le nom de la famille
// (`/api/cards/:id/illustration`, `/api/sets/:id/poster`…).
const UPLOAD_ROUTE_RE =
  /^\/api\/(illustrations|avatars|pack-posters|board-backgrounds)\/|\/(illustration|background|poster|avatar)$/;

// ⚠️ Le choix se fait AVANT le parsing, pas après : `express.json` ignore une
// requête dont le corps est déjà lu (`req._body`). Monter la limite haute en
// aval de la limite basse serait donc un no-op — la petite aurait déjà répondu
// 413. C'est un seul middleware qui aiguille, pas deux montés l'un après l'autre.
app.use((req, res, next) => (UPLOAD_ROUTE_RE.test(req.path) ? jsonUpload : jsonSmall)(req, res, next));

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
const SUMMON_TYPES_FILE = path.join(DATA_DIR, 'summon_types.json');
// Dos de cartes : cosmétique pur, montré par la popup de pioche. Leur art vit
// dans ILLUS_DIR sous l'id du dos — comme les variantes et les icônes
// d'attributs —, donc AUCUNE famille d'assets à créer : rien au proxy Vite, rien
// à la liste d'exclusion du fallback SPA, rien à ASSETS de sync-data.js.
const CARD_BACKS_FILE = path.join(DATA_DIR, 'card_backs.json');

// --- Bootstrap: copy initial data to volume on first run ---
function bootstrap() {
  fs.mkdirSync(DATA_DIR,  { recursive: true });
  fs.mkdirSync(ILLUS_DIR, { recursive: true });
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  fs.mkdirSync(POSTERS_DIR, { recursive: true });
  fs.mkdirSync(BOARD_BG_DIR, { recursive: true });
  for (const f of ['cards.json', 'attributes.json', 'powers.json', 'boards.json', 'magies.json', 'public_decks.json', 'missions.json', 'sets.json', 'variants.json', 'gifts.json', 'summon_types.json', 'card_backs.json']) {
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
  logTimezone();
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
// Fuseau horaire du serveur — même esprit que le récapitulatif d'assets
// ci-dessus, et pour la même raison : une panne silencieuse qui ne se constate
// qu'après coup.
//
// TOUT le calendrier du jeu lit l'heure LOCALE du processus : `missions.dayKey`,
// `cycleKey` et `weekKey`, dont dérivent la rotation de la boutique, celle des
// cosmétiques, la run d'arcade et le cadeau quotidien. Si `TZ` n'est pas réglée,
// Node prend celle du système — UTC sur la plupart des hébergeurs — et tous les
// rendez-vous quotidiens se décalent d'une ou deux heures sans que rien ne le
// dise. Les joueurs le remarqueraient avant les journaux.
//
// On ne peut pas le corriger tout seul (quel fuseau serait le bon ?), donc on
// le NOMME, exactement comme un dossier d'assets mal placé.
function logTimezone() {
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'inconnu';
  const missions = require('./missions');
  const rotation = `${String(missions.RESET_HOUR).padStart(2, '0')} h`;
  console.log(`[fuseau] ${tz} — rotation quotidienne à ${rotation} locale`);
  if (!process.env.TZ) {
    console.warn(
      `[fuseau] ⚠ TZ n'est pas réglée : le calendrier du jeu (missions, boutique, ` +
      `cosmétiques, arcade, cadeaux) suit « ${tz} », le fuseau du système. Régler ` +
      'TZ=Europe/Paris pour que les rotations tombent à l\'heure attendue.',
    );
  }
}

bootstrap();

// Dote les comptes antérieurs à la collection (idempotent, cf. progression.js).
// Après bootstrap() : cards.json doit exister sur le volume.
const progression = require('./progression');
progression.backfillAll();

// --- Entretien périodique ---
//
// `stmt.deleteExpiredSessions` était PRÉPARÉE et n'était appelée nulle part :
// une ligne par connexion, conservée indéfiniment. Le TTL de 30 jours est bien
// vérifié à la lecture (`getSession` supprime la ligne qu'il trouve expirée),
// mais seulement pour les jetons qu'on présente encore — un joueur qui ne
// revient pas laisse le sien à vie. `deleteExpiredResetTokens`, lui, était
// correctement appelé sur ses deux routes : c'est l'oubli d'une seule des deux.
//
// Les matchs actifs sont refermés au démarrage pour la même raison : l'état
// vivant d'un match est en mémoire (ws/MatchRelay.js) et meurt avec le
// processus, mais la ligne SQL n'est refermée que par `endMatch`. Un
// redémarrage laissait donc des `status='active'` définitifs — sans
// conséquence aujourd'hui (`activeMatchByUser` n'est branché nulle part), mais
// c'est exactement la requête qu'on branchera pour la reprise après
// rechargement, et elle rendrait des fantômes.
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const { db, stmt: dbStmt } = require('./db');
const pvplog = require('./pvplog');
const ailog = require('./ailog');

function runMaintenance({ closeStaleMatches = false } = {}) {
  const sessions = dbStmt.deleteExpiredSessions.run(Date.now()).changes;
  const resets = dbStmt.deleteExpiredResetTokens.run(Date.now()).changes;
  const buckets = auth.sweepBuckets();
  // Logs de combat PvP : outil de diagnostic temporaire, quelques centaines de
  // Ko par vue. Ils se purgent ici plutôt que dans un minuteur à eux — c'est
  // déjà le rendez-vous quotidien du nettoyage.
  const pvpLogs = pvplog.purge();
  // Runs du Labo IA : même rendez-vous, même raison — pas de minuteur à eux.
  const aiRuns = ailog.purge();
  let matches = 0;
  if (closeStaleMatches) {
    matches = db.prepare(
      "UPDATE matches SET status = 'ended', ended_reason = 'server_restart', ended_at = ? WHERE status = 'active'",
    ).run(Date.now()).changes;
  }
  if (sessions || resets || buckets || matches || pvpLogs || aiRuns) {
    console.log(
      `[entretien] ${sessions} session(s) expirée(s), ${resets} jeton(s) de reset, ` +
      `${buckets} seau(x) de quota, ${matches} match(s) rouvert(s) refermé(s), ` +
      `${pvpLogs} log(s) de combat PvP purgé(s), ${aiRuns} run(s) de Labo IA purgé(s)`,
    );
  }
}

runMaintenance({ closeStaleMatches: true });
// `unref()` : ce minuteur ne doit jamais retenir le processus en vie — ni en
// production à l'arrêt, ni dans un fork de test qui a requis app.js.
setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS).unref();

// Après bootstrap() lui aussi : gifts.js tire db.js et shop.js derrière lui, et
// son catalogue vit sur le volume.
const gifts = require('./gifts');

function requireAuth(req, res, next) {
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

// Rapport de la simulation d'équilibrage — page autonome, servie comme
// admin.html : elle va chercher ses données sur /api/admin/sim, qui porte le
// même garde. Enregistrée AVANT le fallback SPA (fin de fichier), qui n'exclut
// pas le préfixe /admin.
app.get('/admin/sim', requireSiteAdmin, (req, res) => res.sendFile(path.join(__dirname, 'sim-report.html')));

// Un id d'asset ne doit jamais pouvoir remonter l'arborescence : il sert de nom
// de fichier tel quel.
function safeAssetId(id) {
  return /^[A-Za-z0-9_-]+$/.test(id || '') ? id : null;
}

/**
 * Chemin du PNG d'un asset, ou `null` si l'id ne peut pas servir de nom de
 * fichier. C'est le SEUL endroit du fichier qui a le droit de composer un
 * chemin d'asset — plus aucun `path.join(<DIR>, …)` à nu dans un handler.
 *
 * ⚠️ Ce n'est pas une commodité, c'est le correctif d'une faille : `safeAssetId`
 * existait et était appliqué à une vingtaine de routes, mais oublié sur huit
 * autres (illustration des cartes et des magies, routes génériques
 * `/api/illustrations/:id` de `sync-data.js`, export). Express décodant `%2f`,
 * un `DELETE /api/cards/..%2FVICTIM/illustration` supprimait un fichier HORS du
 * dossier d'illustrations, et le `PUT` correspondant y écrivait.
 *
 * L'oubli était structurel : le même quintuplet CRUD est recopié pour neuf
 * entités, le garde-fou a été ajouté aux copies récentes et pas aux anciennes,
 * et rien ne pouvait le signaler. Faire passer TOUTES les routes par ce helper
 * — y compris celles qui étaient déjà correctes — ne laisse qu'une seule forme
 * dans le fichier, donc une seule à vérifier.
 */
function assetPath(dir, rawId) {
  const id = safeAssetId(rawId);
  return id ? path.join(dir, `${id}.png`) : null;
}

/** Réponse commune aux routes d'asset dont l'id est refusé. */
function badAssetId(res) {
  return res.status(400).json({ error: 'id invalide' });
}

// Illustrations public (game needs card art) — adds .png extension automatically.
// Sert aussi l'art des VARIANTES, qui vivent dans le même espace de noms.
// Le garde-fou n'est pas décoratif : Express décode `%2f`, et depuis les
// variantes l'id vient du méta de deck, donc du joueur.
app.get('/illustrations/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).end();
  const filePath = assetPath(ILLUS_DIR, id);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).end();
});

// Avatars des decks publics — le repli sur l'avatar par défaut est fait ICI et
// nulle part ailleurs : chaque écran qui affiche un adversaire n'a qu'une URL à
// construire, sans savoir si le deck a son portrait.
app.get('/avatars/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).end();
  const filePath = assetPath(AVATARS_DIR, id);
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
  const filePath = assetPath(POSTERS_DIR, id);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).end();
});

// Fond de grille d'un terrain. Pas de repli non plus : un terrain sans fond est
// le cas normal (le décor de scène par défaut est alors conservé), et c'est la
// scène 3D qui décide, sur le drapeau `_has_background`, de charger ou non.
app.get('/board-backgrounds/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).end();
  const filePath = assetPath(BOARD_BG_DIR, id);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).end();
});

// --- Helpers ---
//
// Cache mémoire des catalogues, invalidé au `mtime` — le patron que TOUS les
// modules de règles appliquent déjà (`progression.allCardIds`, `sets.cards`,
// `variants.all`, `missions.catalog`, `gifts`…). Les routes HTTP étaient les
// seules à ne pas l'avoir : chaque `GET /api/cards` relisait et reparsait
// 328 Ko de JSON.
//
// Mesuré : lecture + parse = 4,6 ms sur les 16,7 ms du handler complet, soit
// ~28 %. Le reste (le `map` et le `JSON.stringify` de la réponse, ~8 ms) n'est
// PAS mis en cache : il dépend des drapeaux calculés à la lecture, et les
// mémoriser ferait mentir `_has_illustration` — c'est précisément ce que les
// golden tests de la boutique interdisent.
//
// ⚠️ Ce cache-ci NE passe PAS par `json-cache.js`, et ce n'est pas un oubli :
// le helper partagé sert des catalogues qu'on LIT (les modules de règles), il
// rend donc sa valeur telle quelle et n'a aucune notion d'écriture. Ici les
// handlers MUTENT la liste avant de la réécrire, d'où deux exigences que le
// helper n'a pas : la copie du tableau à chaque lecture, et l'invalidation
// explicite par `writeJson`.
//
// ⚠️ CONTRAT : `readJson` rend une copie du TABLEAU, mais en PARTAGE les
// éléments. Un appelant peut donc `push`, `splice` ou remplacer une case —
// ce que font tous les handlers d'écriture — mais **jamais muter un élément en
// place**. Pour modifier une entrée, on remplace la case par un objet neuf
// (`liste[i] = { ...liste[i], champ: valeur }`), comme le fait
// `syncCardSetMirror`.
//
// La copie profonde a été essayée et REJETÉE : `structuredClone` des 653 cartes
// coûte 5,3 ms, soit plus que les 4,6 ms de lecture + parse qu'il remplace — le
// cache devenait plus lent que pas de cache du tout. La copie de surface, elle,
// ramène `readJson` de 4,62 ms à 0,03 ms, et le handler complet de 16,7 ms à
// 6,0 ms (×2,8) sur la route la plus chaude du jeu.
const _jsonCache = new Map();

function readJson(file) {
  const mtime = fs.statSync(file).mtimeMs;
  const hit = _jsonCache.get(file);
  if (!hit || hit.mtime !== mtime) {
    const raw = fs.readFileSync(file, 'utf-8');
    _jsonCache.set(file, { mtime, value: JSON.parse(raw.replace(/,\s*([\]}])/g, '$1')) });
  }
  return _jsonCache.get(file).value.slice();
}

function writeJson(file, data) {
  // ⚠️ Écriture ATOMIQUE : fichier temporaire puis `rename`, qui est atomique
  // sur un même système de fichiers. `writeFileSync` direct sur la destination
  // laissait un catalogue TRONQUÉ si le processus s'arrêtait au mauvais moment
  // — et l'hébergeur envoie un SIGTERM à chaque déploiement. La base SQLite est
  // protégée (WAL + transactions) ; les neuf catalogues JSON, qui portent
  // autant de valeur, ne l'étaient pas.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, '\t'), 'utf-8');
  fs.renameSync(tmp, file);
  // Invalidation EXPLICITE plutôt que de s'en remettre au mtime : deux
  // écritures — ou une écriture suivie d'une lecture — peuvent tomber dans la
  // même milliseconde, et le cache rendrait alors la version d'avant.
  _jsonCache.delete(file);
}

function illustrationExists(id) {
  return fs.existsSync(assetPath(ILLUS_DIR, id));
}

function avatarExists(id) {
  return fs.existsSync(assetPath(AVATARS_DIR, id));
}

function boardBackgroundExists(id) {
  return fs.existsSync(assetPath(BOARD_BG_DIR, id));
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

// Rapports de la simulation d'équilibrage — même garde EXPLICITE, et pour la
// même raison : le write-guard global ne couvre que les écritures, un GET sous
// /api est public par défaut.
app.use('/api/admin/sim', requireSiteAdmin, require('./routes/admin-sim'));

// Logs de combat PvP — OUTIL DE DIAGNOSTIC TEMPORAIRE (cf. pvplog.js). Même
// garde explicite que ses deux voisins, et pour la même raison : un GET sous
// /api est public par défaut, et un log nomme les deux joueurs d'un duel.
app.use('/api/admin/pvp-logs', requireSiteAdmin, require('./routes/admin-pvplog'));

// Runs du Labo IA — OUTIL DE DIAGNOSTIC (cf. ailog.js). Même garde explicite,
// et elle couvre ici le DÉPÔT autant que la lecture : contrairement aux logs
// PvP, qu'un joueur dépose au sortir de son duel, un run de labo ne peut venir
// que de l'écran de dev.
app.use('/api/admin/ai-logs', requireSiteAdmin, require('./routes/admin-ailog'));

// Protect write operations on /api (reads stay public for the game)
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return requireSiteAdmin(req, res, next);
  next();
});

// --- Catalogues CRUD ---
//
// Six entités partagent le MÊME quintuplet (GET / POST / import / PUT /
// DELETE) et ne diffèrent que par trois choses : leur fichier, les drapeaux
// calculés qu'elles exposent à la lecture, et ceux qu'elles retirent à
// l'écriture. Elles passent donc par `routes/crud-json.js`.
//
// ⚠️ MONTÉES ICI, après le write-guard global, et pas ailleurs. Express
// distribue les middlewares dans l'ordre d'enregistrement : déplacer un de ces
// `app.use` au-dessus du garde ouvrirait toutes ses écritures.
//
// ⚠️ Les triptyques d'illustration restent DÉCLARÉS PLUS BAS, entité par
// entité. Ils ne matchent pas ces routeurs (`/:id/illustration` fait deux
// segments, `/:id` un seul), la requête les traverse donc sans s'y arrêter.
//
// Quatre entités ne sont PAS ici, chacune pour une raison qui lui appartient :
//   variants — exige `card_id`, et l'ORDRE des contrôles est observable ;
//   gifts    — `created_at` est estampillé par le serveur et préservé au PUT,
//              c'est la règle la plus sensible du fichier (cf. gifts.js) ;
//   decks    — le PUT FUSIONNE au lieu de remplacer (le DeckBuilder en iframe
//              ne poste que `{id, name, deck}`) ;
//   sets     — réaligne le miroir `card.set` sur chaque écriture.
// Les faire entrer demanderait autant d'options que d'appelants : à ce
// compte-là, la fabrique cesse de capturer un concept commun et devient un
// aiguillage déguisé en routeur.
const { crudRouter } = require('./routes/crud-json');
const crud = (opts) => crudRouter({ readJson, writeJson, ...opts });

// `_starter` dit si la carte fait partie de la dotation d'un compte neuf (pack
// marqué « départ »). Calculé, jamais persisté — même statut que
// `_has_illustration`. C'est ce qui évite au client de dupliquer la règle de
// dotation pour son repli invité.
//
// ⚠️ `render` reçoit la LISTE et non chaque carte : `starterCardIds()` relit
// sets.json (cache au mtime), le refaire 653 fois par requête serait absurde.
app.use('/api/cards', crud({
  file: CARDS_FILE,
  render: (list) => {
    const starter = new Set(progression.starterCardIds());
    return list.map(c => ({
      ...c,
      _has_illustration: illustrationExists(c.id),
      _starter: starter.has(c.id),
    }));
  },
  strip: (c) => { delete c._has_illustration; },
}));

// L'icône d'un attribut est une IMAGE dont l'art vit dans ILLUS_DIR sous l'id
// de l'attribut ; le champ `icon` du JSON reste l'emoji, qui sert de repli.
app.use('/api/attributes', crud({
  file: ATTRIBUTES_FILE,
  render: (list) => list.map(a => ({ ...a, _has_illustration: illustrationExists(a.id) })),
  strip: (a) => { delete a._has_illustration; },
}));

/// L'icône d'un pouvoir suit exactement la règle des attributs : une IMAGE
// dans ILLUS_DIR sous l'id du pouvoir, le champ `icon` du JSON restant
// l'emoji de repli.
app.use('/api/powers', crud({
  file: POWERS_FILE,
  render: (list) => list.map(p => ({ ...p, _has_illustration: illustrationExists(p.id) })),
  strip: (p) => { delete p._has_illustration; },
}));

app.use('/api/missions', crud({ file: MISSIONS_FILE, guard: requireSiteAdmin }));

app.use('/api/magies', crud({
  file: MAGIES_FILE,
  guard: requireSiteAdmin,
  render: (list) => list.map(m => ({ ...m, _has_illustration: illustrationExists(m.id) })),
  strip: (m) => { delete m._has_illustration; },
}));

// Un terrain porte DEUX images : la vignette carrée du tooltip
// (`_has_illustration`, dans ILLUS_DIR) et le fond de grille au ratio 5:11
// (`_has_background`, dans BOARD_BG_DIR). Deux assets, pas un recadrage.
app.use('/api/boards', crud({
  file: BOARDS_FILE,
  guard: requireSiteAdmin,
  render: (list) => list.map(b => ({
    ...b,
    _has_illustration: illustrationExists(b.id),
    _has_background: boardBackgroundExists(b.id),
  })),
  strip: stripBoardComputed,
}));

// Catalogue FERMÉ à 6 entrées (les types d'invocation du moteur, plus « Plusieurs
// recettes » — `summon_options` — qui n'est pas un `summon_type` mais suit la
// même règle d'icône) : l'admin n'y édite que le libellé et l'icône (emoji +
// illustration, même mécanisme que les attributs), jamais l'id ni le `type`
// qui sert de clé de résolution côté client. `validateCreate` bloque
// POST/import ; l'UI admin n'expose simplement aucun bouton créer/supprimer
// pour ce tab.
app.use('/api/summon-types', crud({
  file: SUMMON_TYPES_FILE,
  guard: requireSiteAdmin,
  render: (list) => list.map(s => ({ ...s, _has_illustration: illustrationExists(s.id) })),
  strip: (s) => { delete s._has_illustration; },
  validateCreate: () => ({ status: 403, body: { error: "Catalogue fixe : 6 types d'invocation, aucun ajout possible" } }),
}));

// Dos de cartes — le cosmétique que la popup de pioche met en scène. Catalogue
// OUVERT (l'admin en crée et en supprime), art dans ILLUS_DIR sous l'id du dos.
//
// ⚠️ Le GET est PUBLIC comme tous les GET sous /api : c'est voulu, le client le
// lit à l'initialisation (`data/CardBackDatabase.js`) et un invité doit voir un
// dos comme les autres. Il n'y a rien de sensible dans un catalogue de dos.
app.use('/api/card-backs', crud({
  file: CARD_BACKS_FILE,
  guard: requireSiteAdmin,
  render: (list) => list.map(b => ({ ...b, _has_illustration: illustrationExists(b.id) })),
  strip: (b) => { delete b._has_illustration; },
}));




// --- Illustration import ---
app.post('/api/cards/:id/illustration', async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return badAssetId(res);
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(ILLUS_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload illustration en base64 (utilisé par push-illustrations.js et l'upload depuis l'appareil dans l'admin)
// Convertit automatiquement vers PNG, quel que soit le format d'origine (JPEG, WebP, etc.)
app.put('/api/cards/:id/illustration', async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return badAssetId(res);
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(ILLUS_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/cards/:id/illustration', (req, res) => {
  const filePath = assetPath(ILLUS_DIR, req.params.id);
  if (!filePath) return badAssetId(res);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Attributes API ---
// L'icône d'un attribut est une IMAGE, dont l'art vit dans ILLUS_DIR sous l'id
// de l'attribut — même espace de noms plat que les cartes, terrains, magies et
// variantes, donc aucune famille d'assets à créer (cf. variants.js). Le champ
// `icon` du JSON reste l'emoji, qui sert de repli tant qu'aucune image n'a été
// importée. `_has_illustration` est calculé à la lecture : le réécrire dans
// attributes.json le ferait mentir dès qu'une image est ajoutée ou retirée
// hors de cette requête.





// Icône d'un attribut — triptyque identique à celui des variantes (URL, upload
// base64 depuis l'appareil, suppression), au même dossier près : ILLUS_DIR. Pas
// de middleware ici, comme les routes d'attributs voisines : le write-guard
// global couvre déjà tout POST/PUT/DELETE sous /api.
app.post('/api/attributes/:id/illustration', async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(ILLUS_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/attributes/:id/illustration', async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(ILLUS_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/attributes/:id/illustration', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = assetPath(ILLUS_DIR, id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Powers API ---
// Icône d'un pouvoir — même triptyque que celui des attributs, même dossier
// (ILLUS_DIR), même id de fichier que l'id du pouvoir.
app.post('/api/powers/:id/illustration', async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(ILLUS_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/powers/:id/illustration', async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(ILLUS_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/powers/:id/illustration', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = assetPath(ILLUS_DIR, id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Summon types API ---
// Même triptyque, pour les 5 entrées du catalogue des types d'invocation.
app.post('/api/summon-types/:id/illustration', async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(ILLUS_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/summon-types/:id/illustration', async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(ILLUS_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/summon-types/:id/illustration', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = assetPath(ILLUS_DIR, id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Card backs API ---
// Même triptyque : l'art d'un dos vit dans ILLUS_DIR sous son id, comme celui
// des variantes et des icônes d'attributs. Rien à ajouter nulle part ailleurs.
app.post('/api/card-backs/:id/illustration', async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(ILLUS_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/card-backs/:id/illustration', async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return res.status(400).json({ error: 'id invalide' });
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(ILLUS_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/card-backs/:id/illustration', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = assetPath(ILLUS_DIR, id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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



// ⚠️ Cette route était la SEULE des dix à ne pas garder `Array.isArray`, et la
// conséquence n'était pas l'erreur qu'on imaginerait : une chaîne est un
// ITÉRABLE, donc `{"items":"nope"}` parcourait ses caractères et les poussait
// dans le catalogue comme s'ils étaient des terrains — en répondant 200.
// `boards.json` se retrouvait avec une chaîne nue là où `BoardDatabase` attend
// un objet, et le tirage du terrain pouvait la sortir en plein combat.
//
// Elle sautait aussi les deux autres garde-fous du patron commun : l'entrée
// sans `id` et la clé `errors` du compte rendu. Alignée sur les huit autres.



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
    const filePath = assetPath(ILLUS_DIR, id);
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
    const filePath = assetPath(BOARD_BG_DIR, id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Magies API ---





app.post('/api/magies/:id/illustration', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { url } = req.body;
  if (!id) return badAssetId(res);
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    await savePng(ILLUS_DIR, id, await downloadUrl(url));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload base64 — les magies étaient la SEULE famille à ne pas l'avoir, alors
// que l'admin propose partout ailleurs « importer depuis l'appareil ». Ajouté
// ici parce que le triptyque est justement ce qu'on uniformise : une famille
// qui en dévie est la prochaine à recevoir un garde-fou de travers.
app.put('/api/magies/:id/illustration', requireSiteAdmin, async (req, res) => {
  const id = safeAssetId(req.params.id);
  const { data } = req.body;
  if (!id) return badAssetId(res);
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    await savePng(ILLUS_DIR, id, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/magies/:id/illustration', requireSiteAdmin, (req, res) => {
  const filePath = assetPath(ILLUS_DIR, req.params.id);
  if (!filePath) return badAssetId(res);
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
    const filePath = assetPath(ILLUS_DIR, id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Missions API ---





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
    const filePath = assetPath(AVATARS_DIR, id);
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
  // ⚠️ On REMPLACE la case du tableau au lieu de muter la carte en place :
  // `readJson` rend une copie du tableau mais PARTAGE ses éléments (cf. son
  // en-tête), et muter une carte ici corromprait le cache pour toutes les
  // lectures suivantes. C'était le seul endroit du fichier à muter un élément.
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (members.has(c.id) && c.set !== pack.id) {
      cards[i] = { ...c, set: pack.id };
      touched++;
    } else if (dropped.has(c.id) && c.set === pack.id) {
      const next = { ...c };
      delete next.set;
      cards[i] = next;
      touched++;
    }
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
    // ⚠️ Le miroir `card.set` était aligné par le POST et le PUT, mais PAS par
    // l'import — un pack importé laissait donc les cartes pointer sur leur
    // ancien pack, ou sur rien. `sets.json` fait foi pour le pool d'un booster,
    // mais le miroir rattrape les cartes créées après la rédaction du pack :
    // le laisser périmé fait diverger les deux sources.
    //
    // Après l'écriture du fichier, comme les deux autres : `syncCardSetMirror`
    // relit le catalogue de cartes et écrit de son côté.
    for (const item of items) {
      if (item && item.id && sets.some(s => s.id === item.id)) syncCardSetMirror(item);
    }
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
    const filePath = assetPath(POSTERS_DIR, id);
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
    const summonTypes = readJson(SUMMON_TYPES_FILE);
    // L'art des dos de cartes est déjà dans ILLUS_DIR : il voyage avec les
    // illustrations, sans famille d'assets supplémentaire (cf. variantes).
    const cardBacks = readJson(CARD_BACKS_FILE);
    // Un cadeau n'a pas d'image propre : il emprunte celles de ses lots
    // (cartes, affiches de packs), déjà servies. Pas de famille d'assets.
    const giftList = readJson(GIFTS_FILE);
    // L'art des variantes est déjà dans ILLUS_DIR : il voyage avec les
    // illustrations, sans famille d'assets supplémentaire.
    const illustrations = listPngChecksums(ILLUS_DIR);
    const avatars = listPngChecksums(AVATARS_DIR);
    const boardBackgrounds = listPngChecksums(BOARD_BG_DIR);
    const packPosters = listPngChecksums(POSTERS_DIR);
    res.json({ cards, attributes, powers, boards, magies, publicDecks, sets, variants: variantList, gifts: giftList, summonTypes, cardBacks, illustrations, avatars, packPosters, boardBackgrounds });
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

// ⚠️ La route la plus exposée des huit qui manquaient de garde-fou, et de loin :
// le write-guard ne couvre que POST/PUT/DELETE, donc les GET sous /api sont
// PUBLICS. Sans `assetPath`, un `GET /api/export/illustration/..%2FSECRET`
// anonyme rendait le contenu base64 de n'importe quel `.png` du système de
// fichiers — pas seulement de ceux du dossier d'illustrations.
app.get('/api/export/illustration/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return badAssetId(res);
  const filePath = assetPath(ILLUS_DIR, id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json({ id, data: fs.readFileSync(filePath).toString('base64') });
});

app.get('/api/export/avatar/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  const filePath = assetPath(AVATARS_DIR, id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json({ id, data: fs.readFileSync(filePath).toString('base64') });
});

app.get('/api/export/pack-poster/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  const filePath = assetPath(POSTERS_DIR, id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.json({ id, data: fs.readFileSync(filePath).toString('base64') });
});

app.get('/api/export/board-background/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  const filePath = assetPath(BOARD_BG_DIR, id);
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
    fs.writeFileSync(assetPath(POSTERS_DIR, id), Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/pack-posters/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = assetPath(POSTERS_DIR, id);
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
    fs.writeFileSync(assetPath(BOARD_BG_DIR, id), Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/board-backgrounds/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = assetPath(BOARD_BG_DIR, id);
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
    fs.writeFileSync(assetPath(AVATARS_DIR, id), Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/avatars/:id', (req, res) => {
  const id = safeAssetId(req.params.id);
  if (!id) return res.status(400).json({ error: 'id invalide' });
  try {
    const filePath = assetPath(AVATARS_DIR, id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Generic illustration upload/delete (utilisé par scripts/sync-data.js) ---
app.put('/api/illustrations/:id', (req, res) => {
  const destPath = assetPath(ILLUS_DIR, req.params.id);
  const { data } = req.body;
  if (!destPath) return badAssetId(res);
  if (!data) return res.status(400).json({ error: 'data (base64) required' });
  try {
    fs.writeFileSync(destPath, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/illustrations/:id', (req, res) => {
  const filePath = assetPath(ILLUS_DIR, req.params.id);
  if (!filePath) return badAssetId(res);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Download helper ---
//
// Récupère une image depuis une URL fournie en admin (import d'illustration).
// Quatre garde-fous, tous absents à l'origine :
//
//   - 5 redirections au maximum. La fonction se rappelait elle-même sans
//     compteur : une URL qui redirige vers elle-même bouclait jusqu'à
//     l'épuisement de la pile.
//   - 10 s de délai. Sans lui, une cible qui n'envoie jamais rien immobilise la
//     requête admin indéfiniment.
//   - 10 Mo au maximum. Le corps était accumulé en mémoire sans borne.
//   - refus des adresses PRIVÉES. C'est le garde-fou SSRF : sans lui, un import
//     d'illustration est une sonde vers le réseau interne de l'hébergeur
//     (169.254.169.254 et consorts). La route est réservée à l'admin, mais
//     « admin » n'est pas « de confiance pour atteindre le réseau interne ».
const DOWNLOAD_MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Une adresse littérale privée, locale ou de lien-local ? */
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)          // lien-local : métadonnées cloud
    || (a === 100 && b >= 64 && b <= 127); // CGNAT
}

function downloadUrl(rawUrl, redirectsLeft = DOWNLOAD_MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(rawUrl); } catch { return reject(new Error('URL invalide')); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return reject(new Error(`Protocole non autorisé : ${url.protocol}`));
    }
    if (isPrivateHost(url.hostname)) {
      return reject(new Error(`Adresse privée refusée : ${url.hostname}`));
    }

    const proto = url.protocol === 'https:' ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();   // libère la socket avant de repartir
        if (redirectsLeft <= 0) return reject(new Error('Trop de redirections'));
        // `new URL(location, url)` résout les redirections relatives, et fait
        // repasser la cible par le contrôle d'adresse privée ci-dessus — une
        // redirection vers 169.254.169.254 est le vecteur SSRF classique.
        return downloadUrl(new URL(res.headers.location, url).href, redirectsLeft - 1)
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }

      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > DOWNLOAD_MAX_BYTES) {
          req.destroy();
          return reject(new Error(`Image trop volumineuse (> ${DOWNLOAD_MAX_BYTES / 1024 / 1024} Mo)`));
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error(`Délai dépassé (${DOWNLOAD_TIMEOUT_MS / 1000} s)`));
    });
    req.on('error', reject);
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

// L'application Express, sans aucun socket : c'est ce qui la rend testable
// (client/src/test/http.test.ts la require directement, puis la passe à
// http.createServer sur un port éphémère). Le `listen` et l'attache du
// WebSocket PvP vivent dans server.js, qui est le point d'entrée du PROCESSUS.
module.exports = app;
