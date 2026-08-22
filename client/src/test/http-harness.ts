/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Harnais HTTP : démarre l'application Express RÉELLE (`app.js`) sur un port
// éphémère, avec un DATA_DIR et une racine d'assets jetables.
//
// Fichier volontairement nommé sans `.test.ts` : `vitest.config.ts` ne collecte
// que `src/test/**/*.test.ts`, donc celui-ci n'est jamais exécuté seul. Même
// convention que `helpers.ts`.
//
// Deux différences avec les harnais serveur existants (shop.test.ts & co), et
// elles comptent toutes les deux :
//
//  1. AUCUN catalogue n'est recopié à la main. `bootstrap()` vit dans app.js et
//     s'en charge : un DATA_DIR vide est peuplé depuis `initial-data/` par le
//     code de PRODUCTION lui-même, pas par une copie parallèle qui dériverait.
//
//  2. La racine d'assets est un dossier À NOUS, dont ILLUS_DIR est un ENFANT.
//     `asset-dirs.js` déduit AVATARS_DIR / POSTERS_DIR / BOARD_BG_DIR de
//     `path.dirname(ILLUS_DIR)` : poser ILLUS_DIR directement dans `os.tmpdir()`
//     ferait pondre `$TMPDIR/enemy_avatars`, partagé entre fichiers de tests et
//     avec la machine du développeur. C'est aussi ce qui donne un « au-dessus
//     d'ILLUS_DIR » propre, où déposer le fichier-victime du test de traversée.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const ADMIN_USER = 'admin';
export const ADMIN_PASS = 'harness-pass';
export const ADMIN_BASIC = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');

/** 1×1 px transparent — même constante que shop.test.ts / cosmetics.test.ts. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export interface Harness {
  server: http.Server;
  app: any;
  stmt: any;
  auth: any;
  progression: any;
  DATA: string;
  ASSETS: string;
  ILLUS: string;
}

export async function boot(): Promise<Harness> {
  const ASSETS = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-http-assets-'));
  const ILLUS = path.join(ASSETS, 'card_illustrations');
  fs.mkdirSync(ILLUS, { recursive: true });
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-http-data-'));

  // ⚠️ AVANT le premier require d'un module racine : db.js, progression.js,
  // asset-dirs.js, missions.js, cosmetics.js, arcade.js et gifts.js figent
  // `process.env.DATA_DIR` dans une const au chargement, et app.js fige de même
  // ADMIN_USER / ADMIN_PASS — dont l'absence l'empêche carrément de se charger.
  process.env.DATA_DIR = DATA;
  process.env.ILLUS_DIR = ILLUS;
  process.env.ADMIN_USER = ADMIN_USER;
  process.env.ADMIN_PASS = ADMIN_PASS;
  // `/auth/forgot-password` répond 503 sans clé : aucun appel réseau ne part
  // d'ici, même si la machine de développement en exporte une.
  delete process.env.RESEND_API_KEY;

  const app = require(path.join(ROOT, 'app.js'));
  const { stmt } = require(path.join(ROOT, 'db.js'));
  const auth = require(path.join(ROOT, 'auth.js'));
  const progression = require(path.join(ROOT, 'progression.js'));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  return { server, app, stmt, auth, progression, DATA, ASSETS, ILLUS };
}

export const portOf = (h: Harness) => (h.server.address() as any).port;

// --- Comptes ---------------------------------------------------------------
// ⚠️ `auth.rateLimit({ max: 10 })` protège `/auth/register` (seau mémoire par
// req.ip + req.path, fenêtre 60 s, non exporté donc non réinitialisable). Toutes
// les requêtes d'un fork partagent la même IP : un fichier qui inscrirait plus
// de 10 comptes par HTTP se prendrait un 429 et échouerait au hasard. On
// n'inscrit donc par HTTP que les comptes dont l'INSCRIPTION est le sujet ; les
// autres sont créés en base, comme le font déjà shop.test.ts et missions.test.ts.
//
// Le tag vient d'un compteur et non d'un UUID tronqué : la contrainte porte sur
// (username_lc, tag), et 4 caractères d'UUID finissent par entrer en collision
// (même raison que shop.test.ts).
let tagSeq = 0;

export function makeUser(h: Harness, username: string) {
  const id = crypto.randomUUID();
  h.stmt.insertUser.run({
    id,
    email: `${id}@test.local`,
    username,
    username_lc: username.toLowerCase(),
    tag: String(++tagSeq).padStart(4, '0'),
    password_hash: 'x',
    avatar: null,
    created_at: Date.now(),
  });
  h.progression.initUser(id);
  return id;
}

/** Session ouverte pour un compte → l'en-tête `Cookie` prêt à poser. */
export function login(h: Harness, userId: string) {
  const token = h.auth.createSession(userId);
  return { token, cookie: `${h.auth.COOKIE_NAME}=${token}` };
}

/** Extrait le cookie de session d'une réponse supertest. */
export function sessionCookie(res: any): string | null {
  const raw: string[] = res.headers['set-cookie'] ?? [];
  const hit = raw.find((c) => c.startsWith('sf_session='));
  return hit ? hit.split(';')[0] : null;
}

// --- Client HTTP brut ------------------------------------------------------
/**
 * Requête dont le CHEMIN N'EST PAS NORMALISÉ. Indispensable au test de
 * traversée : Node écrit `options.path` verbatim dans la ligne de requête,
 * là où un client de plus haut niveau peut ré-analyser l'URL et réécrire
 * `..%2F` — auquel cas le test ne prouverait plus rien.
 *
 * Vérifié de bout en bout : `DELETE /api/cards/..%2FVICTIM/illustration`
 * arrive intact, Express décode, et `req.params.id === '../VICTIM'`.
 */
export function raw(
  h: Harness,
  method: string,
  rawPath: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: string; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body));
    const req = http.request(
      {
        port: portOf(h),
        method,
        path: rawPath,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        let b = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let json: any = null;
          try { json = JSON.parse(b); } catch { /* corps non-JSON (404 Express) */ }
          resolve({ status: res.statusCode!, body: b, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
