/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Tests HTTP de bout en bout : l'application Express RÉELLE (`app.js`), sur un
// port éphémère, avec un DATA_DIR jetable.
//
// ⚠️ Ce fichier ne vérifie pas des fonctionnalités, il VERROUILLE DES BRÈCHES.
// Chacune a été ouverte une fois, et chacune se refermerait sans bruit : rien
// d'autre ne passe par ces chemins. `routes/online.js`, `auth.js` et la couche
// Express n'avaient aucune couverture — les 413 tests existants exercent les
// modules de règles à travers un harnais qui contourne Express — et c'est très
// exactement là que vivaient tous les constats sérieux de l'audit.
//
// Un refus ne se prouve JAMAIS par un code de statut seul : un 401 sur une URL
// mal orthographiée en rendrait un aussi. Chaque test vérifie donc l'ÉTAT après
// coup — la ligne en base, le fichier sur le disque, le catalogue.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import {
  boot, makeUser, login, raw, sessionCookie, ADMIN_BASIC, PNG, type Harness,
} from './http-harness';

let h: Harness;

beforeAll(async () => { h = await boot(); }, 30_000);
afterAll(() => { h?.server.close(); });

// ===========================================================================
//  Constat 01 — l'API d'écriture s'ouvrait sans ADMIN_PASS
// ===========================================================================
// `requireAuth` faisait `if (!ADMIN_PASS) return next()`. Comme
// `requireSiteAdmin` retombe dessus et que le write-guard global couvre tout
// POST/PUT/DELETE sous /api, la variable absente rendait anonyme l'API entière
// — y compris la route ci-dessous, qui pose le niveau 100, 9999 golds, 9999
// gemmes et tout le catalogue sur n'importe quel compte.
describe('/api/admin/db — promotion admin', () => {
  it('refuse un anonyme, et le compte visé reste non-admin', async () => {
    const victime = makeUser(h, 'cible_anon');
    expect(h.stmt.userById.get(victime).is_admin).toBe(0);

    const res = await request(h.server)
      .put(`/api/admin/db/users/${victime}/admin`)
      .send({ is_admin: true });

    expect([401, 403]).toContain(res.status);
    // ⚠️ LA MOITIÉ QUI COMPTE : c'est l'état de la base qui prouve que rien
    // n'a été écrit, pas le code de statut.
    expect(h.stmt.userById.get(victime).is_admin).toBe(0);
  });

  it('refuse un joueur authentifié qui n\'est pas admin', async () => {
    const victime = makeUser(h, 'cible_joueur');
    const { cookie } = login(h, makeUser(h, 'intrus'));

    const res = await request(h.server)
      .put(`/api/admin/db/users/${victime}/admin`)
      .set('Cookie', cookie)
      .send({ is_admin: true });

    expect([401, 403]).toContain(res.status);
    expect(h.stmt.userById.get(victime).is_admin).toBe(0);
  });

  // Témoin. Sans lui, les deux tests ci-dessus passeraient encore si la route
  // n'était plus montée du tout : un 404 n'est pas un refus, c'est une absence.
  it('accepte la basic-auth du site — la route existe bel et bien', async () => {
    const cible = makeUser(h, 'promu');

    const res = await request(h.server)
      .put(`/api/admin/db/users/${cible}/admin`)
      .set('Authorization', ADMIN_BASIC)
      .send({ is_admin: true });

    expect(res.status).toBe(200);
    expect(h.stmt.userById.get(cible).is_admin).toBe(1);
  });

  it('ne laisse pas lire la table des comptes à un anonyme', async () => {
    const res = await request(h.server).get('/api/admin/db/table/users');
    expect([401, 403]).toContain(res.status);
    expect(res.text).not.toContain('@test.local');
  });
});

// ===========================================================================
//  Constat 02 — traversée de répertoire sur les routes d'asset
// ===========================================================================
// `safeAssetId` existait et gardait une vingtaine de routes, mais était oublié
// sur huit autres. Express décodant `%2f`, `..%2FX` arrivait tel quel jusqu'à
// `path.join` : `req.params.id === '../VICTIM'`.
describe('assets — traversée de répertoire', () => {
  // ASSETS est le PARENT d'ILLUS_DIR : `path.join(ILLUS, '../VICTIM.png')`
  // tombe donc exactement là — c'est la cible que la route atteignait.
  const victimPath = () => path.join(h.ASSETS, 'VICTIM.png');

  it('DELETE /api/cards/..%2FVICTIM/illustration : 400, et le voisin survit', async () => {
    fs.writeFileSync(victimPath(), PNG);
    expect(path.join(h.ILLUS, '..', 'VICTIM.png')).toBe(victimPath());   // le montage est bien celui-là

    const res = await raw(h, 'DELETE', '/api/cards/..%2FVICTIM/illustration', {
      headers: { Authorization: ADMIN_BASIC },
    });

    // ⚠️ 400 EXACTEMENT, jamais `[400, 404]`. Un 404 signifierait que le chemin
    // a été normalisé quelque part (`/api/cards/../VICTIM/illustration` fait
    // cinq segments et ne correspond à aucune route) : le test ne prouverait
    // alors plus rien, et il doit échouer bruyamment plutôt que passer à vide.
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'id invalide' });
    expect(fs.existsSync(victimPath())).toBe(true);
    fs.rmSync(victimPath(), { force: true });
  });

  it('PUT /api/illustrations/..%2FVICTIM : 400, et rien n\'est écrit', async () => {
    fs.rmSync(victimPath(), { force: true });

    const res = await raw(h, 'PUT', '/api/illustrations/..%2FVICTIM', {
      headers: { Authorization: ADMIN_BASIC },
      body: { data: PNG.toString('base64') },
    });

    expect(res.status).toBe(400);
    expect(fs.existsSync(victimPath())).toBe(false);
  });

  // ⚠️ La plus grave des huit, et de loin : le write-guard ne couvre que les
  // ÉCRITURES, donc les GET sous /api sont publics. Sans garde-fou, cette route
  // rendait le contenu base64 de n'importe quel .png du système de fichiers à
  // un appelant totalement anonyme.
  it('GET /api/export/illustration/..%2FVICTIM : 400, sans authentification', async () => {
    fs.writeFileSync(victimPath(), Buffer.from('CONTENU-SECRET'));

    const res = await raw(h, 'GET', '/api/export/illustration/..%2FVICTIM');

    expect(res.status).toBe(400);
    expect(res.body).not.toContain(Buffer.from('CONTENU-SECRET').toString('base64'));
    fs.rmSync(victimPath(), { force: true });
  });

  // Témoin : un garde-fou qui refuse TOUT n'est pas un correctif.
  it('les identifiants légitimes passent toujours', async () => {
    const art = path.join(h.ILLUS, 'TRAV_OK.png');

    const pose = await raw(h, 'PUT', '/api/illustrations/TRAV_OK', {
      headers: { Authorization: ADMIN_BASIC },
      body: { data: PNG.toString('base64') },
    });
    expect(pose.status).toBe(200);
    expect(fs.existsSync(art)).toBe(true);

    const lit = await raw(h, 'GET', '/api/export/illustration/TRAV_OK');
    expect(lit.status).toBe(200);
    expect(lit.json.id).toBe('TRAV_OK');

    const efface = await raw(h, 'DELETE', '/api/cards/TRAV_OK/illustration', {
      headers: { Authorization: ADMIN_BASIC },
    });
    expect(efface.status).toBe(200);
    expect(fs.existsSync(art)).toBe(false);
  });
});

// ===========================================================================
//  Le write-guard global
// ===========================================================================
describe('write-guard /api', () => {
  it('un joueur authentifié non-admin ne peut pas créer de carte', async () => {
    const { cookie } = login(h, makeUser(h, 'joueur_lambda'));
    const catalogue = path.join(h.DATA, 'cards.json');
    const avant = fs.readFileSync(catalogue, 'utf8');

    const res = await request(h.server)
      .post('/api/cards')
      .set('Cookie', cookie)
      .send({ id: 'INTRUS_001', name: 'Carte pirate' });

    expect([401, 403]).toContain(res.status);
    // Un refus qui écrit quand même n'en est pas un.
    expect(fs.readFileSync(catalogue, 'utf8')).toBe(avant);

    const liste = await request(h.server).get('/api/cards');
    expect(liste.body.map((c: any) => c.id)).not.toContain('INTRUS_001');
  });

  it('les lectures restent publiques — le garde ne porte que sur les écritures', async () => {
    const res = await request(h.server).get('/api/cards');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('un admin applicatif (is_admin) passe, lui', async () => {
    const admin = makeUser(h, 'vrai_admin');
    h.stmt.setUserAdmin.run(1, admin);
    const { cookie } = login(h, admin);

    const res = await request(h.server)
      .post('/api/cards')
      .set('Cookie', cookie)
      .send({ id: 'ADMIN_OK_001', name: 'Carte admin', tier: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    await request(h.server).delete('/api/cards/ADMIN_OK_001').set('Cookie', cookie);
  });
});

// ===========================================================================
//  Constat 06 — réinitialiser son mot de passe ne déconnectait personne
// ===========================================================================
describe('POST /api/auth/reset-password', () => {
  it('révoque les sessions ouvertes du compte', async () => {
    // Inscription par HTTP : c'est le seul chemin qui produit un vrai
    // `password_hash`, et on veut que le test parle du vrai formulaire.
    const inscription = await request(h.server).post('/api/auth/register').send({
      email: 'reset@test.local', username: 'reseteur', password: 'motdepasse-initial',
    });
    expect(inscription.status).toBe(200);
    const cookie = sessionCookie(inscription)!;
    const token = cookie.split('=')[1];
    const userId = inscription.body.user.id;

    // La session ouvre bien une porte AVANT.
    expect((await request(h.server).get('/api/profile/me').set('Cookie', cookie)).status).toBe(200);

    // Jeton posé en base : `/auth/forgot-password` exige RESEND_API_KEY (503
    // sinon) et partirait appeler api.resend.com. Le test porte sur la
    // CONSÉQUENCE de la réinitialisation, pas sur l'envoi de l'e-mail.
    const reset = 'jeton-de-reset-fixe';
    const now = Date.now();
    h.stmt.insertResetToken.run(reset, userId, now, now + 3_600_000);

    const res = await request(h.server)
      .post('/api/auth/reset-password')
      .send({ token: reset, password: 'nouveau-mot-de-passe' });
    expect(res.status).toBe(200);

    // ⚠️ LE CŒUR : l'ancien cookie ne doit plus rien ouvrir. Sans révocation,
    // quiconque a volé la session — la raison même pour laquelle on
    // réinitialise — la garde jusqu'à expiration, soit 30 jours par défaut.
    expect((await request(h.server).get('/api/profile/me').set('Cookie', cookie)).status).toBe(401);
    expect(h.stmt.sessionByToken.get(token)).toBeUndefined();

    // Le nouveau mot de passe ouvre, l'ancien non.
    const neuf = await request(h.server).post('/api/auth/login')
      .send({ email: 'reset@test.local', password: 'nouveau-mot-de-passe' });
    expect(neuf.status).toBe(200);
    const vieux = await request(h.server).post('/api/auth/login')
      .send({ email: 'reset@test.local', password: 'motdepasse-initial' });
    expect(vieux.status).toBe(401);

    // Et le jeton de réinitialisation est consommé : le lien ne se rejoue pas.
    const rejeu = await request(h.server).post('/api/auth/reset-password')
      .send({ token: reset, password: 'encore-un-autre-mdp' });
    expect(rejeu.status).toBe(400);
  });
});

// ===========================================================================
//  Constat 09 — 20 Mo de corps acceptés avant toute authentification
// ===========================================================================
describe('plafonds de corps de requête', () => {
  it('refuse 2 Mo sur une route ordinaire', async () => {
    const res = await request(h.server)
      .post('/api/cards')
      .set('Authorization', ADMIN_BASIC)
      .send({ id: 'GROS_001', name: 'x'.repeat(2 * 1024 * 1024) });

    expect(res.status).toBe(413);
  });

  // Le plafond bas ne doit pas casser l'admin : un import en masse poste
  // `cards.json` tel quel, soit ~320 Ko aujourd'hui.
  it('laisse passer un import en masse de taille réaliste', async () => {
    const items = Array.from({ length: 400 }, (_, i) => ({
      id: `BULK_${String(i).padStart(3, '0')}`, name: 'Carte de charge', tier: 1,
      description: 'x'.repeat(700),
    }));
    expect(JSON.stringify({ items }).length).toBeGreaterThan(300_000);

    const res = await request(h.server)
      .post('/api/cards/import')
      .set('Authorization', ADMIN_BASIC)
      .send({ items, mode: 'replace' });

    expect(res.status).toBe(200);
    expect(res.body.added).toBe(400);
  });

  // ⚠️ Les routes d'upload gardent les 20 Mo : une illustration en base64 les
  // dépasse vite. Le choix se fait AVANT le parsing — `express.json` ignore une
  // requête déjà lue, donc monter la limite haute en aval de la basse serait un
  // no-op silencieux.
  it('laisse passer 2 Mo sur une route d\'upload d\'image', async () => {
    const res = await request(h.server)
      .put('/api/illustrations/GROS_ART')
      .set('Authorization', ADMIN_BASIC)
      .send({ data: PNG.toString('base64') + 'A'.repeat(2 * 1024 * 1024) });

    // 500 (sharp refuse ces octets) et non 413 : la requête est ARRIVÉE, c'est
    // tout ce que ce test doit prouver. Un 413 signalerait le mauvais plafond.
    expect(res.status).not.toBe(413);
  });
});

// ===========================================================================
//  Le compte de départ, et la forme des flags calculés
// ===========================================================================
describe('GET /api/cards', () => {
  it('porte les flags CALCULÉS, jamais persistés', async () => {
    const res = await request(h.server).get('/api/cards');
    const carte = res.body[0];
    expect(carte).toHaveProperty('_has_illustration');
    expect(carte).toHaveProperty('_starter');

    // Le catalogue sur disque, lui, n'en porte aucune trace : les recalculer à
    // la lecture est ce qui permet d'ajouter une illustration depuis l'admin
    // sans redémarrer, et de ne jamais les laisser mentir.
    const disque = JSON.parse(fs.readFileSync(path.join(h.DATA, 'cards.json'), 'utf8'));
    expect(disque[0]).not.toHaveProperty('_has_illustration');
    expect(disque[0]).not.toHaveProperty('_starter');
  });
});
