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

const DATA_DIR  = process.env.DATA_DIR  || path.join(ROOT, 'data');
const ILLUS_DIR = process.env.ILLUS_DIR || path.join(ROOT, 'resources', 'card_illustrations');

const ENTITIES = [
  { type: 'cards',      file: 'cards.json',      importPath: '/api/cards/import',      deletePath: id => `/api/cards/${id}` },
  { type: 'attributes', file: 'attributes.json', importPath: '/api/attributes/import', deletePath: id => `/api/attributes/${id}` },
  { type: 'powers',     file: 'powers.json',     importPath: '/api/powers/import',     deletePath: id => `/api/powers/${id}` },
  { type: 'boards',     file: 'boards.json',     importPath: '/api/boards/import',     deletePath: id => `/api/boards/${id}` },
  { type: 'magies',     file: 'magies.json',     importPath: '/api/magies/import',     deletePath: id => `/api/magies/${id}` },
  { type: 'publicDecks', file: 'public_decks.json', importPath: '/api/decks/import',   deletePath: id => `/api/decks/${id}` },
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

function localIllustrations() {
  fs.mkdirSync(ILLUS_DIR, { recursive: true });
  const map = new Map();
  for (const f of fs.readdirSync(ILLUS_DIR)) {
    if (!f.endsWith('.png')) continue;
    const id = f.replace(/\.png$/, '');
    const checksum = crypto.createHash('md5').update(fs.readFileSync(path.join(ILLUS_DIR, f))).digest('hex');
    map.set(id, checksum);
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
    const remoteIllus = remote.illustrations || [];
    const local = localIllustrations();
    const remoteIds = new Set(remoteIllus.map(i => i.id));

    let downloaded = 0, skipped = 0, deleted = 0;
    for (const { id, checksum } of remoteIllus) {
      if (local.get(id) === checksum) { skipped++; continue; }
      if (opts.dryRun) { console.log(`[dry-run] télécharger ${id}.png`); downloaded++; continue; }
      const { data } = await apiGet(`/api/export/illustration/${id}`);
      fs.writeFileSync(path.join(ILLUS_DIR, `${id}.png`), Buffer.from(data, 'base64'));
      downloaded++;
    }

    // Supprime localement les illustrations qui n'existent plus côté distant
    for (const id of local.keys()) {
      if (!remoteIds.has(id)) {
        if (opts.dryRun) { console.log(`[dry-run] supprimer localement ${id}.png`); deleted++; continue; }
        fs.unlinkSync(path.join(ILLUS_DIR, `${id}.png`));
        deleted++;
      }
    }
    console.log(`✓ Illustrations : ${downloaded} téléchargées, ${skipped} à jour, ${deleted} supprimées localement`);
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
    const local = localIllustrations();
    const remoteIllus = remote.illustrations || [];
    const remoteMap = new Map(remoteIllus.map(i => [i.id, i.checksum]));

    let uploaded = 0, skipped = 0, deleted = 0;
    for (const [id, checksum] of local) {
      if (remoteMap.get(id) === checksum) { skipped++; continue; }
      if (opts.dryRun) { console.log(`[dry-run] envoyer ${id}.png`); uploaded++; continue; }
      const data = fs.readFileSync(path.join(ILLUS_DIR, `${id}.png`)).toString('base64');
      await apiSend('PUT', `/api/illustrations/${id}`, { data });
      uploaded++;
    }

    for (const id of remoteMap.keys()) {
      if (!local.has(id)) {
        if (opts.dryRun) { console.log(`[dry-run] supprimer côté distant ${id}.png`); deleted++; continue; }
        await apiSend('DELETE', `/api/illustrations/${id}`);
        deleted++;
      }
    }
    console.log(`✓ Illustrations : ${uploaded} envoyées, ${skipped} à jour, ${deleted} supprimées côté distant`);
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
