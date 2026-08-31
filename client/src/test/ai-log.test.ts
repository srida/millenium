/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Dépôt et consultation des runs du Labo IA (`ailog.js` + `routes/admin-ailog.js`).
//
// ⚠️ Toute la surface est ADMIN, dépôt compris — c'est la différence de fond
// avec `pvp-log.test.ts`, dont le `record` est ouvert aux joueurs. Il n'y a
// donc ici ni appartenance ni rôle à éprouver ; ce qui se prouve, c'est que
// **rien** n'est écrit ni lu sans droits.
//
// ⚠️ Un refus ne se prouve JAMAIS par un code de statut seul — un 401 sur une
// URL mal orthographiée en rendrait un aussi. Chaque test vérifie l'ÉTAT après
// coup : la ligne en base.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { boot, makeUser, login, ADMIN_BASIC, type Harness } from './http-harness';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let h: Harness;
let ailog: any;

beforeAll(async () => {
  h = await boot();
  ailog = require(path.join(ROOT, 'ailog.js'));
}, 30_000);
afterAll(() => { h?.server.close(); });

/** La forme que pose `dev/aiLabRun.runAiPlacement`, réduite à ce que le module lit. */
function run(over: any = {}) {
  return {
    label: 'essai',
    deck_id: 'PUBLIC_DECK_001',
    rounds: [{
      round: 1,
      events: [
        { kind: 'attempt', card_id: 'N1', outcome: 'placed', reason: null },
        { kind: 'attempt', card_id: 'F1', outcome: 'refused', reason: 'missing_material' },
        { kind: 'attempt', card_id: 'F1', outcome: 'refused', reason: 'missing_material' },
        { kind: 'attempt', card_id: 'S1', outcome: 'refused', reason: 'board_full' },
      ],
    }],
    ...over,
  };
}

const countRuns = () => h.stmt.aiRunCount.get().n;

describe('ailog.record — validation et résumé', () => {
  it('refuse un run sans round, et n\'écrit RIEN', () => {
    const before = countRuns();
    expect(ailog.record({ rounds: [] })).toMatchObject({ ok: false });
    expect(ailog.record({})).toMatchObject({ ok: false });
    expect(ailog.record({ rounds: [{ round: 'x', events: [] }] })).toMatchObject({ ok: false });
    expect(ailog.record({ rounds: [{ round: 1 }] })).toMatchObject({ ok: false });
    expect(countRuns()).toBe(before);
  });

  it('refuse un run trop volumineux plutôt que de le tronquer en silence', () => {
    const before = countRuns();
    const gros = run({ label: 'x'.repeat(ailog.MAX_PAYLOAD_BYTES + 1000) });
    expect(ailog.record(gros)).toMatchObject({ ok: false, error: 'run trop volumineux' });
    expect(countRuns()).toBe(before);
  });

  it('compte les refus PAR MOTIF à l\'insertion, pas à la lecture', () => {
    const { ok, id } = ailog.record(run());
    expect(ok).toBe(true);

    // Les colonnes portent le résumé : la liste n'aura aucun payload à parser.
    const row = h.stmt.aiRunById.get(id);
    expect(row).toMatchObject({ rounds: 1, placed: 1, refused: 3, deck_id: 'PUBLIC_DECK_001' });

    expect(ailog.get(id).payload.refusals_by_reason)
      .toEqual({ missing_material: 2, board_full: 1 });
    ailog.remove(id);
  });

  it('donne un id serveur, jamais celui de l\'appelant', () => {
    const a = ailog.record(run({ id: 'JE-CHOISIS-MON-ID' }));
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.id).not.toBe('JE-CHOISIS-MON-ID');
    const b = ailog.record(run());
    expect(b.id).not.toBe(a.id);
    ailog.remove(a.id); ailog.remove(b.id);
  });
});

describe('/api/admin/ai-logs — le dépôt est admin', () => {
  it('un anonyme n\'écrit RIEN — prouvé par l\'absence de ligne', async () => {
    const before = countRuns();
    const res = await request(h.server).post('/api/admin/ai-logs').send(run({ label: 'anon' }));

    expect([401, 403]).toContain(res.status);
    expect(countRuns()).toBe(before);
  });

  it('un joueur authentifié non-admin n\'écrit RIEN non plus', async () => {
    const before = countRuns();
    const { cookie } = login(h, makeUser(h, 'aiCurieux'));

    const res = await request(h.server)
      .post('/api/admin/ai-logs').set('Cookie', cookie).send(run({ label: 'joueur' }));

    expect([401, 403]).toContain(res.status);
    expect(countRuns()).toBe(before);
  });

  it('un anonyme ne LIT rien non plus', async () => {
    const { id } = ailog.record(run({ label: 'secret-de-liste' }));
    const res = await request(h.server).get('/api/admin/ai-logs');

    expect([401, 403]).toContain(res.status);
    expect(res.text).not.toContain('secret-de-liste');
    ailog.remove(id);
  });

  it('dépose, liste et relit un run de bout en bout', async () => {
    const post = await request(h.server)
      .post('/api/admin/ai-logs').set('Authorization', ADMIN_BASIC).send(run({ label: 'bout-en-bout' }));
    expect(post.status).toBe(200);
    const id = post.body.id;

    const list = await request(h.server).get('/api/admin/ai-logs').set('Authorization', ADMIN_BASIC);
    expect(list.status).toBe(200);
    const found = list.body.runs.find((r: any) => r.id === id);
    expect(found).toMatchObject({ label: 'bout-en-bout', rounds: 1, placed: 1, refused: 3 });
    // La liste ne transporte PAS le payload — il pèse et ne sert qu'au détail.
    expect(found.payload).toBeUndefined();

    const detail = await request(h.server).get(`/api/admin/ai-logs/${id}`).set('Authorization', ADMIN_BASIC);
    expect(detail.status).toBe(200);
    expect(detail.body.payload.rounds[0].events).toHaveLength(4);

    const del = await request(h.server).delete(`/api/admin/ai-logs/${id}`).set('Authorization', ADMIN_BASIC);
    expect(del.body).toMatchObject({ ok: true, deleted: 1 });
    expect(h.stmt.aiRunById.get(id)).toBeUndefined();
  });

  it('sert le fichier en pièce jointe', async () => {
    const { id } = ailog.record(run({ label: 'fichier' }));
    const res = await request(h.server)
      .get(`/api/admin/ai-logs/${id}/download`).set('Authorization', ADMIN_BASIC);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="ai-run-${id}.json"`);
    expect(JSON.parse(res.text).label).toBe('fichier');
    ailog.remove(id);
  });

  // ⚠️ L'`id` compose un NOM DE FICHIER (Content-Disposition). Le 400 STRICT
  // est le canari : un 404 signalerait une normalisation en amont, et le test
  // passerait alors à vide en ne prouvant plus rien.
  it('refuse un id hors motif par un 400, jamais un 404', async () => {
    for (const mauvais of ['../../etc/passwd', 'pas-un-uuid', 'x'.repeat(36)]) {
      const res = await request(h.server)
        .get(`/api/admin/ai-logs/${encodeURIComponent(mauvais)}/download`)
        .set('Authorization', ADMIN_BASIC);
      expect(res.status).toBe(400);
    }
  });

  it('un id bien formé mais inconnu rend 404', async () => {
    const res = await request(h.server)
      .get('/api/admin/ai-logs/00000000-0000-4000-8000-000000000000')
      .set('Authorization', ADMIN_BASIC);
    expect(res.status).toBe(404);
  });
});

describe('Rétention', () => {
  it('purge au-delà de KEEP_DAYS et garde le reste', () => {
    const vieux = ailog.record(run({ label: 'vieux' })).id;
    const neuf = ailog.record(run({ label: 'neuf' })).id;

    // On vieillit la ligne à la main : c'est `created_at` que la purge lit.
    const trop = Date.now() - (ailog.KEEP_DAYS + 1) * 86400_000;
    h.stmt.aiRunById.database.prepare('UPDATE ai_lab_runs SET created_at = ? WHERE id = ?')
      .run(trop, vieux);

    expect(ailog.purge()).toBeGreaterThanOrEqual(1);
    expect(h.stmt.aiRunById.get(vieux)).toBeUndefined();
    expect(h.stmt.aiRunById.get(neuf)).toBeDefined();
    ailog.remove(neuf);
  });
});
