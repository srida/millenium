#!/usr/bin/env node
/**
 * Synchronise les données (JSON + illustrations) entre Railway et local.
 *
 * Usage :
 *   node scripts/sync-data.js pull [--no-illustrations] [--dry-run]
 *   node scripts/sync-data.js push [--no-illustrations] [--dry-run] [--yes]
 *
 * Configuration via variables d'environnement (ou fichier .env à la racine) :
 *   SYNC_URL    — URL de l'instance Railway (ex: https://soulforge.up.railway.app)
 *   ADMIN_USER  — utilisateur admin (auth basique)
 *   ADMIN_PASS  — mot de passe admin
 *
 * "pull"  : copie les données de Railway vers le dossier local data/ + resources/card_illustrations/
 *           + resources/enemy_avatars/ + resources/pack_posters/ + resources/board_backgrounds/
 *           + resources/audio/ (--no-illustrations coupe les cinq, malgré son nom historique)
 * "push"  : envoie les données locales vers Railway (écrase les données distantes)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');

// --- Charge .env (parsing minimal, pas de dépendance) ---
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const SYNC_URL   = (process.env.SYNC_URL || '').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '';

// Mêmes dossiers que le serveur, décidés au même endroit — les recalculer ici
// laisserait les deux côtés diverger au prochain ajout de famille.
const { DATA_DIR, ILLUS_DIR, AVATARS_DIR, POSTERS_DIR, BOARD_BG_DIR, AUDIO_DIR } = require(path.join(ROOT, 'asset-dirs'));
// Jumeau CJS de `AUDIO_EXTENSIONS` (`sound-schema.mjs`) — même frontière que
// dans app.js : ce script est CommonJS, il ne peut pas `require()` un ESM.
const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav', 'm4a'];

// Les familles d'images se synchronisent à l'identique, sur un dossier et un jeu
// de routes chacune. `key` est la clé du manifeste de /api/export.
// ⚠️ `extensions` : toujours `['png']` pour une image ; l'audio en a
// PLUSIEURS possibles (le fichier réel décide), d'où `variableExt` qui fait
// voyager l'extension dans le corps des requêtes push (le PUT en a besoin
// pour choisir le nom de fichier côté serveur).
const ASSETS = [
  { key: 'illustrations', label: 'Illustrations', dir: ILLUS_DIR, extensions: ['png'], exportPath: id => `/api/export/illustration/${id}`, pushPath: id => `/api/illustrations/${id}` },
  { key: 'avatars',       label: 'Avatars',       dir: AVATARS_DIR, extensions: ['png'], exportPath: id => `/api/export/avatar/${id}`,      pushPath: id => `/api/avatars/${id}` },
  { key: 'packPosters',   label: 'Affiches de packs', dir: POSTERS_DIR, extensions: ['png'], exportPath: id => `/api/export/pack-poster/${id}`, pushPath: id => `/api/pack-posters/${id}` },
  { key: 'boardBackgrounds', label: 'Fonds de terrain', dir: BOARD_BG_DIR, extensions: ['png'], exportPath: id => `/api/export/board-background/${id}`, pushPath: id => `/api/board-backgrounds/${id}` },
  { key: 'audio',          label: 'Audio (sfx + musiques)', dir: AUDIO_DIR, extensions: AUDIO_EXTENSIONS, variableExt: true, exportPath: id => `/api/export/audio/${id}`, pushPath: id => `/api/audio/${id}` },
];

const ENTITIES = [
  { type: 'cards',      file: 'cards.json',      importPath: '/api/cards/import',      deletePath: id => `/api/cards/${id}` },
  { type: 'attributes', file: 'attributes.json', importPath: '/api/attributes/import', deletePath: id => `/api/attributes/${id}` },
  { type: 'powers',     file: 'powers.json',     importPath: '/api/powers/import',     deletePath: id => `/api/powers/${id}` },
  { type: 'boards',     file: 'boards.json',     importPath: '/api/boards/import',     deletePath: id => `/api/boards/${id}` },
  { type: 'magies',     file: 'magies.json',     importPath: '/api/magies/import',     deletePath: id => `/api/magies/${id}` },
  // Porte AUSSI les decks de bots (`bot: true`) : ils partagent le même
  // fichier et la même route depuis leur fusion avec les decks publics.
  { type: 'publicDecks', file: 'decks.json',        importPath: '/api/decks/import',   deletePath: id => `/api/decks/${id}` },
  { type: 'sets',       file: 'sets.json',       importPath: '/api/sets/import',       deletePath: id => `/api/sets/${id}` },
  // Les variantes n'ont pas d'entrée dans ASSETS : leur art vit dans le dossier
  // des illustrations, sous l'id de la variante.
  { type: 'variants',   file: 'variants.json',   importPath: '/api/variants/import',   deletePath: id => `/api/variants/${id}` },
  // Les cadeaux n'ont pas non plus d'entrée dans ASSETS : ils n'ont pas d'image
  // propre, ils empruntent celles de leurs lots.
  { type: 'gifts',      file: 'gifts.json',      importPath: '/api/gifts/import',      deletePath: id => `/api/gifts/${id}` },
  // Catalogue fermé à 5 entrées, pas d'entrée ASSETS non plus (même dossier
  // que les attributs et les variantes, sous l'id de chaque type).
  // Les dos de cartes non plus n'ont pas d'entrée ASSETS : leur art vit dans le
  // dossier des illustrations, sous l'id du dos.
  { type: 'cardBacks',  file: 'card_backs.json', importPath: '/api/card-backs/import', deletePath: id => `/api/card-backs/${id}` },
  // Les tokens n'ont pas d'entrée ASSETS non plus : leur art vit dans le
  // dossier des illustrations, sous l'id du token.
  { type: 'tokens',     file: 'tokens.json',     importPath: '/api/tokens/import',     deletePath: id => `/api/tokens/${id}` },
  // Effets sonores et musiques : catalogues au même patron, art dans AUDIO_DIR
  // (entrée `audio` d'ASSETS ci-dessus).
  { type: 'sfx',        file: 'sfx.json',        importPath: '/api/sfx/import',        deletePath: id => `/api/sfx/${id}` },
  { type: 'music',      file: 'music.json',      importPath: '/api/music/import',      deletePath: id => `/api/music/${id}` },
  { type: 'musicThemes', file: 'music_themes.json', importPath: '/api/music-themes/import', deletePath: id => `/api/music-themes/${id}` },
];

function authHeader() {
  const token = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
  return `Basic ${token}`;
}

async function apiGet(p) {
  const res = await fetch(`${SYNC_URL}${p}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiSend(method, p, body) {
  const res = await fetch(`${SYNC_URL}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`);
  return res.json();
}

function readLocalJson(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf-8').replace(/,\s*([\]}])/g, '$1'));
}

function writeLocalJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, '\t'), 'utf-8');
}

// `extensions` : les extensions acceptées pour cette famille (`['png']` pour
// une image, la liste audio pour les sons). La valeur porte l'extension
// TROUVÉE, pas une extension fixe — c'est ce qui permet à l'audio de varier
// par fichier sans que ce module le sache autrement.
function localAssets(dir, extensions) {
  fs.mkdirSync(dir, { recursive: true });
  const map = new Map();
  for (const f of fs.readdirSync(dir)) {
    const ext = extensions.find(e => f.endsWith(`.${e}`));
    if (!ext) continue;
    const id = f.slice(0, -(ext.length + 1));
    const checksum = crypto.createHash('md5').update(fs.readFileSync(path.join(dir, f))).digest('hex');
    map.set(id, { checksum, ext });
  }
  return map;
}

function confirm(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(/^y(es)?$/i.test(answer.trim())); });
  });
}

async function pull(opts) {
  console.log(`Récupération depuis ${SYNC_URL} ...`);
  const remote = await apiGet('/api/export');

  for (const entity of ENTITIES) {
    const items = remote[entity.type] || [];
    if (opts.dryRun) {
      console.log(`[dry-run] ${entity.file} : ${items.length} éléments`);
      continue;
    }
    writeLocalJson(entity.file, items);
    console.log(`✓ ${entity.file} (${items.length} éléments)`);
  }

  if (opts.illustrations) {
    for (const asset of ASSETS) {
      const remoteAssets = remote[asset.key] || [];
      const local = localAssets(asset.dir, asset.extensions);
      const remoteIds = new Set(remoteAssets.map(i => i.id));

      let downloaded = 0, skipped = 0, deleted = 0;
      for (const { id, checksum, ext: remoteExt } of remoteAssets) {
        // Une image n'a pas de champ `ext` dans le manifeste (toujours PNG) ;
        // l'audio l'a, puisque c'est la seule chose qui varie par fichier.
        const ext = asset.variableExt ? remoteExt : asset.extensions[0];
        const existing = local.get(id);
        if (existing && existing.checksum === checksum && existing.ext === ext) { skipped++; continue; }
        if (opts.dryRun) { console.log(`[dry-run] télécharger ${id}.${ext}`); downloaded++; continue; }
        // Un fichier local sous une AUTRE extension (musique reconvertie) ne
        // doit pas rester à côté du nouveau : `audioFilePath` côté serveur
        // sert la première extension trouvée dans l'ordre du catalogue.
        if (existing && existing.ext !== ext) fs.unlinkSync(path.join(asset.dir, `${id}.${existing.ext}`));
        const { data } = await apiGet(asset.exportPath(id));
        fs.writeFileSync(path.join(asset.dir, `${id}.${ext}`), Buffer.from(data, 'base64'));
        downloaded++;
      }

      // Supprime localement les fichiers qui n'existent plus côté distant
      for (const [id, { ext }] of local) {
        if (!remoteIds.has(id)) {
          if (opts.dryRun) { console.log(`[dry-run] supprimer localement ${id}.${ext}`); deleted++; continue; }
          fs.unlinkSync(path.join(asset.dir, `${id}.${ext}`));
          deleted++;
        }
      }
      console.log(`✓ ${asset.label} : ${downloaded} téléchargées, ${skipped} à jour, ${deleted} supprimées localement`);
    }
  }

  console.log('Pull terminé.');
}

async function push(opts) {
  if (!opts.dryRun && !opts.yes) {
    const ok = await confirm(`Ceci va écraser les données distantes sur ${SYNC_URL} avec les données locales. Continuer ? (y/N) `);
    if (!ok) { console.log('Annulé.'); return; }
  }

  console.log(`Envoi vers ${SYNC_URL} ...`);
  const remote = await apiGet('/api/export');

  for (const entity of ENTITIES) {
    const localItems = readLocalJson(entity.file);
    const remoteItems = remote[entity.type] || [];
    const localIds = new Set(localItems.map(i => i.id));
    const toDelete = remoteItems.filter(i => !localIds.has(i.id));

    if (opts.dryRun) {
      console.log(`[dry-run] ${entity.type} : ${localItems.length} envoyés (replace), ${toDelete.length} supprimés`);
      continue;
    }

    if (localItems.length) {
      const result = await apiSend('POST', entity.importPath, { items: localItems, mode: 'replace' });
      console.log(`✓ ${entity.type} : +${result.added} ~${result.replaced} (=${result.skipped})`);
    }
    for (const item of toDelete) {
      await apiSend('DELETE', entity.deletePath(item.id));
    }
    if (toDelete.length) console.log(`  ${toDelete.length} supprimés côté distant`);
  }

  if (opts.illustrations) {
    for (const asset of ASSETS) {
      const local = localAssets(asset.dir, asset.extensions);
      const remoteMap = new Map((remote[asset.key] || []).map(i => [i.id, { checksum: i.checksum, ext: i.ext }]));

      let uploaded = 0, skipped = 0, deleted = 0;
      for (const [id, { checksum, ext }] of local) {
        const existing = remoteMap.get(id);
        if (existing && existing.checksum === checksum) { skipped++; continue; }
        if (opts.dryRun) { console.log(`[dry-run] envoyer ${id}.${ext}`); uploaded++; continue; }
        const data = fs.readFileSync(path.join(asset.dir, `${id}.${ext}`)).toString('base64');
        // `ext` ne voyage que pour l'audio : les routes d'images l'ignorent
        // (toujours PNG côté serveur).
        await apiSend('PUT', asset.pushPath(id), asset.variableExt ? { data, ext } : { data });
        uploaded++;
      }

      for (const id of remoteMap.keys()) {
        if (!local.has(id)) {
          if (opts.dryRun) { console.log(`[dry-run] supprimer côté distant ${id}`); deleted++; continue; }
          await apiSend('DELETE', asset.pushPath(id));
          deleted++;
        }
      }
      console.log(`✓ ${asset.label} : ${uploaded} envoyées, ${skipped} à jour, ${deleted} supprimées côté distant`);
    }
  }

  console.log('Push terminé.');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const opts = {
    dryRun: args.includes('--dry-run'),
    yes: args.includes('--yes'),
    illustrations: !args.includes('--no-illustrations'),
  };

  if (!['pull', 'push'].includes(command)) {
    console.error('Usage: node scripts/sync-data.js <pull|push> [--no-illustrations] [--dry-run] [--yes]');
    process.exit(1);
  }
  if (!SYNC_URL) {
    console.error('SYNC_URL manquant (variable d\'environnement ou .env)');
    process.exit(1);
  }
  if (!ADMIN_PASS) {
    console.error('ADMIN_PASS manquant (variable d\'environnement ou .env)');
    process.exit(1);
  }

  if (command === 'pull') await pull(opts);
  else await push(opts);
}

main().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
