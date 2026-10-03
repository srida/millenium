/// <reference types="node" />
// Routes de synchro multi-appareils : /me/decks (fusion) et /me/tournament
// (garde de révision). L'application Express RÉELLE, comme http.test.ts.
//
// Un refus ne se prouve pas par le statut seul : chaque cas relit l'ÉTAT en base.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, makeUser, login, raw, type Harness } from './http-harness';

let h: Harness;
beforeAll(async () => { h = await boot(); }, 30_000);
afterAll(() => { h?.server.close(); });

const D = (id: string) => ({ '1': [id], '2': [], '3': [], '4': [], '5': [] });
const call = (cookie: string, method: string, p: string, body?: unknown) =>
  raw(h, method, `/api${p}`, { headers: { Cookie: cookie }, body });

describe('PUT /api/me/decks — fusion', () => {
  it('deux appareils qui poussent des decks différents les gardent tous les deux', async () => {
    const uid = makeUser(h, 'MergeDecks');
    const { cookie } = login(h, uid);
    const now = Date.now();

    const a = await call(cookie, 'PUT', '/me/decks', { book: { decks: { A: D('a') }, stamps: { A: now - 100 }, active: 'A', active_ts: now - 100 } });
    expect(a.status).toBe(200);
    // L'appareil B n'a jamais vu A : il pousse son propre bloc.
    const b = await call(cookie, 'PUT', '/me/decks', { book: { decks: { B: D('b') }, stamps: { B: now - 50 } } });
    expect(b.json.book.decks.A).toBeDefined();
    expect(b.json.book.decks.B).toBeDefined();

    // État en base, pas seulement la réponse.
    const stored = JSON.parse(h.stmt.deckBookByUser.get(uid).data);
    expect(Object.keys(stored.decks).sort()).toEqual(['A', 'B']);
    expect(stored.active).toBe('A');
  });

  it('un bloc périmé (ancien horodatage) n\'écrase pas un deck plus récent', async () => {
    const uid = makeUser(h, 'StaleDeck');
    const { cookie } = login(h, uid);
    const now = Date.now();
    await call(cookie, 'PUT', '/me/decks', { book: { decks: { A: D('recent') }, stamps: { A: now - 10 } } });
    await call(cookie, 'PUT', '/me/decks', { book: { decks: { A: D('perime') }, stamps: { A: now - 9999 } } });
    const stored = JSON.parse(h.stmt.deckBookByUser.get(uid).data);
    expect(stored.decks.A['1']).toEqual(['recent']);
  });

  it('une suppression propagée par pierre tombale', async () => {
    const uid = makeUser(h, 'TombDeck');
    const { cookie } = login(h, uid);
    const now = Date.now();
    await call(cookie, 'PUT', '/me/decks', { book: { decks: { A: D('a') }, stamps: { A: now - 100 } } });
    await call(cookie, 'PUT', '/me/decks', { book: { decks: {}, deleted: { A: now - 1 } } });
    // Un appareil resté sur l'ancien bloc ne le ressuscite pas.
    const stale = await call(cookie, 'PUT', '/me/decks', { book: { decks: { A: D('a') }, stamps: { A: now - 100 } } });
    expect(stale.json.book.decks.A).toBeUndefined();
    expect(JSON.parse(h.stmt.deckBookByUser.get(uid).data).decks.A).toBeUndefined();
  });

  it('refuse sans session et sans bloc', async () => {
    expect((await raw(h, 'PUT', '/api/me/decks', { body: { book: {} } })).status).toBe(401);
    const { cookie } = login(h, makeUser(h, 'NoBook'));
    expect((await call(cookie, 'PUT', '/me/decks', {})).status).toBe(400);
  });
});

const T = (n: number) => ({
  playerDeckName: 'Mon deck', currentRoundIndex: 0,
  participants: [{ id: 0, name: 'Vous', isPlayer: true }],
  rounds: [[{ id: n, players: [0, 0], wins: [0, 0], games: [], winnerSlot: null }]],
});

describe('/api/me/tournament — révision', () => {
  it('stocke, relit, et refuse une révision périmée (409) sans rien changer', async () => {
    const uid = makeUser(h, 'TourneyRev');
    const { cookie } = login(h, uid);

    expect((await call(cookie, 'GET', '/me/tournament')).json).toEqual({ tournament: null, rev: 0 });
    expect((await call(cookie, 'PUT', '/me/tournament', { tournament: T(1), rev: 2 })).status).toBe(200);

    // Appareil resté sur une révision plus ancienne.
    const stale = await call(cookie, 'PUT', '/me/tournament', { tournament: T(99), rev: 2 });
    expect(stale.status).toBe(409);
    expect(stale.json.rev).toBe(2);
    expect(stale.json.tournament.rounds[0][0].id).toBe(1);

    const row = h.stmt.tournamentByUser.get(uid);
    expect(row.rev).toBe(2);
    expect(JSON.parse(row.data).rounds[0][0].id).toBe(1);

    expect((await call(cookie, 'PUT', '/me/tournament', { tournament: T(3), rev: 3 })).status).toBe(200);
    expect((await call(cookie, 'GET', '/me/tournament')).json.tournament.rounds[0][0].id).toBe(3);
  });

  it('DELETE laisse une pierre tombale : un appareil périmé ne ressuscite pas le bracket', async () => {
    const uid = makeUser(h, 'TourneyDel');
    const { cookie } = login(h, uid);
    await call(cookie, 'PUT', '/me/tournament', { tournament: T(1), rev: 4 });
    const del = await call(cookie, 'DELETE', '/me/tournament');
    expect(del.json.rev).toBe(5);

    const zombie = await call(cookie, 'PUT', '/me/tournament', { tournament: T(1), rev: 4 });
    expect(zombie.status).toBe(409);
    const got = await call(cookie, 'GET', '/me/tournament');
    expect(got.json).toEqual({ tournament: null, rev: 5 });

    // Un nouveau tournoi repart de la révision courante.
    expect((await call(cookie, 'PUT', '/me/tournament', { tournament: T(7), rev: 6 })).status).toBe(200);
  });

  it('chaque joueur a son bracket ; formes invalides et gros blobs refusés', async () => {
    const a = login(h, makeUser(h, 'TourneyA')).cookie;
    const b = login(h, makeUser(h, 'TourneyB')).cookie;
    await call(a, 'PUT', '/me/tournament', { tournament: T(1), rev: 1 });
    expect((await call(b, 'GET', '/me/tournament')).json.tournament).toBeNull();

    expect((await call(a, 'PUT', '/me/tournament', { tournament: { x: 1 }, rev: 9 })).status).toBe(400);
    expect((await call(a, 'PUT', '/me/tournament', { tournament: T(1), rev: 0 })).status).toBe(400);
    const huge = { ...T(1), participants: [{ id: 0, blob: 'x'.repeat(400_000) }] };
    expect((await call(a, 'PUT', '/me/tournament', { tournament: huge, rev: 9 })).status).toBe(413);
    expect((await raw(h, 'GET', '/api/me/tournament')).status).toBe(401);
  });
});
