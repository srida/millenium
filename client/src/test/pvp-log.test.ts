/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Log de combat PvP par tick — OUTIL DE DIAGNOSTIC TEMPORAIRE (`pvplog.js`).
//
// Pourquoi ce fichier existe : un duel en ligne est simulé EN PARALLÈLE par les
// deux clients, sans aucun hasard dans le combat. Les deux simulations sont
// donc censées être identiques au tick près, et rien dans le jeu ne permettait
// de constater qu'elles ne le sont pas. Ce que le module promet — « je nomme la
// PREMIÈRE différence, et je ne mens pas sur sa nature » — ne se voit nulle
// part à l'écran : c'est exactement ce qu'un golden test doit tenir.
//
// Deux sujets, et ils ne se prouvent pas de la même façon :
//   • `diff`   — fonction pure, éprouvée sur des payloads fabriqués ;
//   • `record` — écriture ouverte aux JOUEURS, donc chaque refus se prouve par
//                l'ÉTAT de la base après coup, jamais par un code de statut.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { boot, makeUser, login, ADMIN_BASIC, type Harness } from './http-harness';
import { CombatRecorder } from '../game/CombatRecorder';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let h: Harness;
let pvplog: any;

beforeAll(async () => {
  h = await boot();
  pvplog = require(path.join(ROOT, 'pvplog.js'));
}, 30_000);
afterAll(() => { h?.server.close(); });

// ===========================================================================
//  Fabrique de payloads
// ===========================================================================
// La forme est celle que pose `client/src/game/CombatRecorder.payload()` : une
// légende `columns` écrite une fois, puis des lignes positionnelles.
const COLUMNS = ['key', 'col', 'row', 'hp', 'max_hp', 'shield', 'atk', 'alive'];
const unit = (key: string, col: number, row: number, hp = 100) => [key, col, row, hp, 100, 0, 10, 1];

function view(over: any = {}) {
  return {
    match_id: 'm', round: 1, role: 'A',
    board_id: 'BOARD_014',
    // Le cas réel : `BOARD_014` porte [{3,6},{1,4}], qui n'est PAS invariant par
    // le miroir `row → 10-row`. C'est le suspect n°1 de la divergence observée.
    blocked_cells: [{ col: 3, row: 6 }, { col: 1, row: 4 }],
    columns: COLUMNS,
    start_units: [unit('A:CORE_001', 2, 1), unit('B:CORE_002', 2, 9)],
    winner: 'player',
    tick_count: 2,
    ticks: [
      { t: 1, order: ['A:CORE_001', 'B:CORE_002'], units: [unit('A:CORE_001', 2, 1), unit('B:CORE_002', 2, 9)], events: [] },
      { t: 2, order: ['A:CORE_001', 'B:CORE_002'], units: [unit('A:CORE_001', 2, 2), unit('B:CORE_002', 2, 9, 90)], events: [{ type: 'attack', attacker: 'A:CORE_001', target: 'B:CORE_002', damage: 10 }] },
    ],
    ...over,
  };
}

const clone = (o: any) => JSON.parse(JSON.stringify(o));

// ===========================================================================
//  diff — la promesse du module
// ===========================================================================
describe('pvplog.diff — deux vues d\'un même combat', () => {
  // Le témoin. Sans lui, tous les tests ci-dessous passeraient encore si `diff`
  // rendait systématiquement une divergence : un outil qui crie au loup à
  // chaque match ne vaut pas mieux qu'un outil muet.
  it('ne trouve rien entre deux vues identiques', () => {
    expect(pvplog.diff(view(), clone(view()))).toBeNull();
  });

  it('nomme un terrain non symétrique par le miroir — le cas BOARD_014', () => {
    const b = clone(view());
    // Ce que le client B enregistre s'il applique les mêmes cases telles quelles
    // dans son monde réfléchi.
    b.blocked_cells = [{ col: 3, row: 4 }, { col: 1, row: 6 }];

    const d = pvplog.diff(view(), b);
    expect(d.kind).toBe('header');
    expect(d.tick).toBe(0);
    expect(d.detail.field).toBe('blocked_cells');
    expect(d.detail.hint).toMatch(/miroir/);
  });

  it('ignore l\'ordre d\'écriture des cases bloquées — c\'est un ENSEMBLE', () => {
    const b = clone(view());
    b.blocked_cells = [{ col: 1, row: 4 }, { col: 3, row: 6 }];
    expect(pvplog.diff(view(), b)).toBeNull();
  });

  it('nomme un terrain différent avant tout le reste', () => {
    const b = clone(view());
    b.board_id = 'BOARD_002';
    b.ticks[0].order = ['B:CORE_002', 'A:CORE_001']; // du bruit, qui ne doit pas primer
    const d = pvplog.diff(view(), b);
    expect(d.kind).toBe('header');
    expect(d.detail.field).toBe('board_id');
  });

  it('nomme un ordre d\'initiative permuté, au bon tick', () => {
    const b = clone(view());
    b.ticks[1].order = ['B:CORE_002', 'A:CORE_001'];

    const d = pvplog.diff(view(), b);
    expect(d.kind).toBe('order');
    expect(d.tick).toBe(2);
    expect(d.detail.A).toEqual(['A:CORE_001', 'B:CORE_002']);
    expect(d.detail.B).toEqual(['B:CORE_002', 'A:CORE_001']);
  });

  it('nomme LE CHAMP qui diverge sur une unité, pas seulement l\'unité', () => {
    const b = clone(view());
    b.ticks[1].units[1][3] = 80; // hp

    const d = pvplog.diff(view(), b);
    expect(d.kind).toBe('state');
    expect(d.tick).toBe(2);
    expect(d.detail.unit).toBe('B:CORE_002');
    expect(d.detail.field).toBe('hp');
    expect(d.detail.A).toBe(90);
    expect(d.detail.B).toBe(80);
  });

  it('voit une unité présente d\'un seul côté', () => {
    const b = clone(view());
    b.ticks[1].units.pop();

    const d = pvplog.diff(view(), b);
    expect(d.kind).toBe('state');
    expect(d.detail.unit).toBe('B:CORE_002');
    expect(d.detail.field).toBe('presence');
  });

  it('nomme un acte qui diffère à état et ordre identiques', () => {
    const b = clone(view());
    b.ticks[1].events = [{ type: 'attack', attacker: 'A:CORE_001', target: 'B:CORE_002', damage: 12 }];

    const d = pvplog.diff(view(), b);
    expect(d.kind).toBe('events');
    expect(d.tick).toBe(2);
  });

  it('voit un combat plus court d\'un côté', () => {
    const b = clone(view());
    b.ticks.pop();

    const d = pvplog.diff(view(), b);
    expect(d.kind).toBe('length');
    expect(d.detail.field).toBe('tick_count');
  });

  it('voit deux vainqueurs différents sur des ticks pourtant identiques', () => {
    const b = clone(view());
    b.winner = 'enemy';

    const d = pvplog.diff(view(), b);
    expect(d.kind).toBe('length');
    expect(d.detail.field).toBe('winner');
  });

  // ⚠️ Le contrat le plus fragile du module : au-delà de la première
  // différence, TOUT diverge par ricochet. Un rapport qui listerait la
  // dixième conséquence au lieu de la cause ne servirait à rien.
  it('s\'arrête à la PREMIÈRE différence, jamais à une conséquence', () => {
    const b = clone(view());
    b.ticks[0].units[0][3] = 99;  // cause, tick 1
    b.ticks[1].units[0][3] = 42;  // conséquence, tick 2

    const d = pvplog.diff(view(), b);
    expect(d.tick).toBe(1);
  });

  it('rend null si une vue manque — il n\'y a rien à comparer', () => {
    expect(pvplog.diff(view(), null)).toBeNull();
    expect(pvplog.diff(null, view())).toBeNull();
  });
});

// ===========================================================================
//  record — une écriture ouverte aux joueurs
// ===========================================================================
// Chaque refus se prouve par l'ABSENCE DE LIGNE en base. Un code de statut ne
// prouve rien : une URL mal orthographiée en rendrait un aussi.
function newMatch(h: Harness, a: string, b: string) {
  const id = crypto.randomUUID();
  h.stmt.insertMatch.run({
    id, player_a_id: a, player_b_id: b, status: 'active', round: 1, created_at: Date.now(),
  });
  return id;
}

const rowsOf = (matchId: string) => h.stmt.pvpLogsByMatch.all(matchId);

describe('pvplog.record — qui a le droit d\'écrire', () => {
  it('accepte le rôle A d\'un match réel, et la ligne est bien posée', () => {
    const [a, b] = [makeUser(h, 'recA1'), makeUser(h, 'recB1')];
    const m = newMatch(h, a, b);

    const res = pvplog.record({ id: a }, { matchId: m, round: 1, role: 'A', payload: view() });

    expect(res).toEqual({ ok: true, stored: true });
    expect(rowsOf(m)).toHaveLength(1);
    expect(rowsOf(m)[0].role).toBe('A');
  });

  it('refuse un match inconnu — aucune ligne', () => {
    const a = makeUser(h, 'recA2');
    const fantome = crypto.randomUUID();

    const res = pvplog.record({ id: a }, { matchId: fantome, round: 1, role: 'A', payload: view() });

    expect(res.ok).toBe(false);
    expect(rowsOf(fantome)).toHaveLength(0);
  });

  // Sans ce contrôle, n'importe quel compte connecté déposerait des lignes sous
  // n'importe quel match — et le fichier qu'on lit ensuite pour arbitrer une
  // divergence serait exactement ce qu'un tricheur y aurait écrit.
  it('refuse un joueur étranger au match — aucune ligne', () => {
    const [a, b] = [makeUser(h, 'recA3'), makeUser(h, 'recB3')];
    const intrus = makeUser(h, 'recX3');
    const m = newMatch(h, a, b);

    const res = pvplog.record({ id: intrus }, { matchId: m, round: 1, role: 'A', payload: view() });

    expect(res.ok).toBe(false);
    expect(rowsOf(m)).toHaveLength(0);
  });

  // La clé primaire est (match_id, round, role) : laisser le client annoncer un
  // rôle arbitraire lui permettrait d'occuper la place de son adversaire, donc
  // d'empêcher la vue adverse d'être enregistrée du tout.
  it('refuse un rôle usurpé — le joueur B ne peut pas écrire en A', () => {
    const [a, b] = [makeUser(h, 'recA4'), makeUser(h, 'recB4')];
    const m = newMatch(h, a, b);

    const res = pvplog.record({ id: b }, { matchId: m, round: 1, role: 'A', payload: view() });

    expect(res.ok).toBe(false);
    expect(rowsOf(m)).toHaveLength(0);
  });

  // Le renvoi est idempotent, et le PREMIER écrit gagne : un second envoi ne
  // doit pas pouvoir réécrire après coup ce qu'on est en train de diagnostiquer.
  it('ne réécrit pas une vue déjà déposée', () => {
    const [a, b] = [makeUser(h, 'recA5'), makeUser(h, 'recB5')];
    const m = newMatch(h, a, b);
    pvplog.record({ id: a }, { matchId: m, round: 1, role: 'A', payload: view() });

    const res = pvplog.record({ id: a }, { matchId: m, round: 1, role: 'A', payload: view({ board_id: 'AUTRE' }) });

    expect(res).toEqual({ ok: true, stored: false });
    expect(rowsOf(m)).toHaveLength(1);
    expect(JSON.parse(rowsOf(m)[0].payload).board_id).toBe('BOARD_014');
  });

  it('refuse un payload absent ou un round aberrant', () => {
    const [a, b] = [makeUser(h, 'recA6'), makeUser(h, 'recB6')];
    const m = newMatch(h, a, b);

    expect(pvplog.record({ id: a }, { matchId: m, round: 1, role: 'A' }).ok).toBe(false);
    expect(pvplog.record({ id: a }, { matchId: m, round: 0, role: 'A', payload: view() }).ok).toBe(false);
    expect(pvplog.record({ id: a }, { matchId: m, round: 1, role: 'C', payload: view() }).ok).toBe(false);
    expect(rowsOf(m)).toHaveLength(0);
  });
});

// ===========================================================================
//  bundle — le recollage des deux vues
// ===========================================================================
describe('pvplog.bundle — ce que l\'admin télécharge', () => {
  function twoViews(name: string, mutate?: (b: any) => void) {
    const [a, b] = [makeUser(h, `${name}A`), makeUser(h, `${name}B`)];
    const m = newMatch(h, a, b);
    const vb = clone(view({ role: 'B' }));
    mutate?.(vb);
    pvplog.record({ id: a }, { matchId: m, round: 1, role: 'A', payload: view() });
    pvplog.record({ id: b }, { matchId: m, round: 1, role: 'B', payload: vb });
    return m;
  }

  it('rend « ok » quand les deux vues concordent', () => {
    const bundle = pvplog.bundle(twoViews('bok'));
    expect(bundle.verdict).toBe('ok');
    expect(bundle.first_divergence).toBeNull();
    expect(bundle.rounds).toHaveLength(1);
    // Les DEUX vues doivent être dans le fichier : c'est tout son objet.
    expect(bundle.rounds[0].A).toBeTruthy();
    expect(bundle.rounds[0].B).toBeTruthy();
  });

  it('rend « diverged » et situe la divergence par son round', () => {
    const m = twoViews('bdiv', (vb) => { vb.ticks[1].units[1][3] = 80; });
    const bundle = pvplog.bundle(m);

    expect(bundle.verdict).toBe('diverged');
    expect(bundle.first_divergence.round).toBe(1);
    expect(bundle.first_divergence.tick).toBe(2);
    expect(bundle.first_divergence.kind).toBe('state');
  });

  it('rend « incomplete » quand un seul joueur a déposé sa vue', () => {
    const [a, b] = [makeUser(h, 'bincA'), makeUser(h, 'bincB')];
    const m = newMatch(h, a, b);
    pvplog.record({ id: a }, { matchId: m, round: 1, role: 'A', payload: view() });

    const bundle = pvplog.bundle(m);
    expect(bundle.verdict).toBe('incomplete');
    expect(bundle.rounds[0].B).toBeNull();
  });

  it('rend null sur un match sans le moindre log', () => {
    expect(pvplog.bundle(crypto.randomUUID())).toBeNull();
  });
});

// ===========================================================================
//  Les deux routes, de bout en bout
// ===========================================================================
describe('POST /api/me/pvp-log', () => {
  it('refuse un anonyme — aucune ligne', async () => {
    const [a, b] = [makeUser(h, 'httpA1'), makeUser(h, 'httpB1')];
    const m = newMatch(h, a, b);

    const res = await request(h.server)
      .post('/api/me/pvp-log')
      .send({ match_id: m, round: 1, role: 'A', payload: view() });

    expect([401, 403]).toContain(res.status);
    expect(rowsOf(m)).toHaveLength(0);
  });

  // Témoin : sans lui, le test ci-dessus passerait encore si la route n'était
  // pas montée du tout — un 404 n'est pas un refus, c'est une absence. Et il
  // vérifie au passage que `routes/online.js` est bien monté AVANT le
  // write-guard global, sans quoi ce POST joueur tomberait sous requireSiteAdmin.
  it('accepte un joueur du match — la route existe et écrit', async () => {
    const [a, b] = [makeUser(h, 'httpA2'), makeUser(h, 'httpB2')];
    const m = newMatch(h, a, b);
    const { cookie } = login(h, a);

    const res = await request(h.server)
      .post('/api/me/pvp-log')
      .set('Cookie', cookie)
      .send({ match_id: m, round: 1, role: 'A', payload: view() });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, stored: true });
    expect(rowsOf(m)).toHaveLength(1);
  });

  it('refuse un joueur étranger au match — aucune ligne', async () => {
    const [a, b] = [makeUser(h, 'httpA3'), makeUser(h, 'httpB3')];
    const m = newMatch(h, a, b);
    const { cookie } = login(h, makeUser(h, 'httpX3'));

    const res = await request(h.server)
      .post('/api/me/pvp-log')
      .set('Cookie', cookie)
      .send({ match_id: m, round: 1, role: 'A', payload: view() });

    expect(res.status).toBe(400);
    expect(rowsOf(m)).toHaveLength(0);
  });
});

describe('/api/admin/pvp-logs', () => {
  function loggedMatch(name: string) {
    const [a, b] = [makeUser(h, `${name}A`), makeUser(h, `${name}B`)];
    const m = newMatch(h, a, b);
    pvplog.record({ id: a }, { matchId: m, round: 1, role: 'A', payload: view() });
    pvplog.record({ id: b }, { matchId: m, round: 1, role: 'B', payload: view({ role: 'B' }) });
    return m;
  }

  it('ne montre rien à un anonyme', async () => {
    const m = loggedMatch('admAnon');
    const res = await request(h.server).get('/api/admin/pvp-logs');

    expect([401, 403]).toContain(res.status);
    expect(res.text).not.toContain(m);
  });

  it('ne montre rien à un joueur authentifié non-admin', async () => {
    const m = loggedMatch('admPlayer');
    const { cookie } = login(h, makeUser(h, 'admCurieux'));

    const res = await request(h.server).get(`/api/admin/pvp-logs/${m}`).set('Cookie', cookie);

    expect([401, 403]).toContain(res.status);
    expect(res.text).not.toContain('BOARD_014');
  });

  it('sert la liste à la basic-auth du site', async () => {
    const m = loggedMatch('admList');
    const res = await request(h.server).get('/api/admin/pvp-logs').set('Authorization', ADMIN_BASIC);

    expect(res.status).toBe(200);
    const found = res.body.matches.find((x: any) => x.match_id === m);
    expect(found.verdict).toBe('ok');
  });

  // ⚠️ Le `matchId` compose un NOM DE FICHIER (Content-Disposition). Le 400
  // STRICT est le canari : un 404 signalerait une normalisation en amont, et le
  // test passerait alors à vide en ne prouvant plus rien.
  it('refuse un match_id hors motif par un 400, jamais un 404', async () => {
    for (const mauvais of ['../../etc/passwd', 'pas-un-uuid', 'x'.repeat(36)]) {
      const res = await request(h.server)
        .get(`/api/admin/pvp-logs/${encodeURIComponent(mauvais)}/download`)
        .set('Authorization', ADMIN_BASIC);
      expect(res.status).toBe(400);
    }
  });

  it('sert le fichier en pièce jointe, avec les deux vues dedans', async () => {
    const m = loggedMatch('admDl');
    const res = await request(h.server)
      .get(`/api/admin/pvp-logs/${m}/download`)
      .set('Authorization', ADMIN_BASIC);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="pvp-${m}.json"`);
    const body = JSON.parse(res.text);
    expect(body.rounds[0].A.role).toBe('A');
    expect(body.rounds[0].B.role).toBe('B');
  });

  it('rend 404 sur un match bien formé mais sans log', async () => {
    const res = await request(h.server)
      .get(`/api/admin/pvp-logs/${crypto.randomUUID()}`)
      .set('Authorization', ADMIN_BASIC);
    expect(res.status).toBe(404);
  });

  it('supprime les logs d\'un match, et la base le confirme', async () => {
    const m = loggedMatch('admDel');
    expect(rowsOf(m)).toHaveLength(2);

    const res = await request(h.server)
      .delete(`/api/admin/pvp-logs/${m}`)
      .set('Authorization', ADMIN_BASIC);

    expect(res.status).toBe(200);
    expect(rowsOf(m)).toHaveLength(0);
  });
});

// ===========================================================================
//  purge — la rétention
// ===========================================================================
describe('pvplog.purge', () => {
  it('emporte les vieilles lignes et laisse les récentes', () => {
    const vieux = loggedRow('purgeOld', Date.now() - (pvplog.KEEP_DAYS + 1) * 86_400_000);
    const recent = loggedRow('purgeNew', Date.now());

    pvplog.purge();

    expect(rowsOf(vieux)).toHaveLength(0);
    expect(rowsOf(recent)).toHaveLength(1);
  });

  function loggedRow(name: string, createdAt: number) {
    const [a, b] = [makeUser(h, `${name}A`), makeUser(h, `${name}B`)];
    const m = newMatch(h, a, b);
    h.stmt.insertPvpLog.run({
      match_id: m, round: 1, role: 'A', user_id: a,
      created_at: createdAt, truncated: 0, payload: JSON.stringify(view()),
    });
    return m;
  }
});

// ===========================================================================
//  La forme canonique — le pilier du dispositif
// ===========================================================================
// Tout repose sur une seule idée : les deux clients ne voient PAS le même monde
// (celui du rôle B est le reflet de celui de A, `row → 10 - row`), et
// `CombatRecorder` normalise à la capture dans le repère du rôle A. Si cette
// normalisation est fausse, tout combat sain ressort « divergent » et l'outil
// ne vaut rien — sans que rien ne le signale.
//
// On rejoue donc UN MÊME combat physique vu des deux côtés, avec le VRAI
// enregistreur et le VRAI diff.
describe('CombatRecorder — la forme canonique', () => {
  /** Unité factice : les seuls membres que l'enregistreur lit. */
  function u(cardId: string, side: 'player' | 'enemy', col: number, row: number, hp = 100) {
    return {
      card_id: cardId, side, position: { col, row },
      current_hp: hp, max_hp: 100, shield: 0, atk: 10, initiative: 5,
      power_gauge: 0, attack_timer: 0, move_timer: 0,
      paralysis_remaining: 0, power_block_remaining: 0,
      confusion_remaining: 0, taunt_remaining: 0,
      dot_effects: [], burn_stacks: [],
      isAlive: () => hp > 0,
      effectiveAttackSpeed: () => 4,
    };
  }

  /** Un `CombatManager` réduit à ce que l'enregistreur regarde. */
  const combat = (playerUnits: any[], enemyUnits: any[], step = 1) =>
    ({ playerUnits, enemyUnits, _stepCount: step, winner: null });

  // Le même combat, décrit deux fois.
  //
  //   Monde physique (repère du rôle A) : A tient CORE_001 en (2,1),
  //   B tient CORE_002 en (2,9). A frappe B.
  //
  // Chaque client range TOUJOURS ses propres unités en rows 0–3 et l'adversaire
  // en rows 7–10 : le rôle B voit donc son CORE_002 en (2,1) et le CORE_001
  // adverse en (2,9) — l'exact reflet.
  //
  // ⚠️ Les PV doivent être les MÊMES des deux côtés pour une même unité
  // physique : c'est justement ce que `round:board_ready` transporte. Les
  // donner différents ici ferait échouer le test pour une raison qui n'est pas
  // son sujet — et masquerait un vrai défaut de normalisation.
  function record(role: 'A' | 'B', board: any) {
    const mine = role === 'A' ? u('CORE_001', 'player', 2, 1) : u('CORE_002', 'player', 2, 1, 90);
    const theirs = role === 'A' ? u('CORE_002', 'enemy', 2, 9, 90) : u('CORE_001', 'enemy', 2, 9);
    const rec = new CombatRecorder({ matchId: 'm', round: 1, role });
    const c = combat([mine], [theirs]);
    rec.header(c, board);
    rec.capture(c, [{ type: 'attack', attacker: role === 'A' ? mine : theirs, target: role === 'A' ? theirs : mine, damage: 10 }]);
    return rec.payload().payload;
  }

  // Un terrain SYMÉTRIQUE par le miroir : les deux clients doivent alors être
  // rigoureusement d'accord. C'est le témoin — sans lui, le test suivant
  // passerait aussi avec une normalisation cassée.
  const SYMETRIQUE = { id: 'BOARD_015', blocked_cells: [{ col: 2, row: 4 }, { col: 2, row: 6 }] };
  // Un terrain qui ne l'est PAS. Mesuré sur les données livrées : 7 des 14
  // terrains sont dans ce cas.
  const ASYMETRIQUE = { id: 'BOARD_014', blocked_cells: [{ col: 3, row: 6 }, { col: 1, row: 4 }] };

  it('rend le MÊME log des deux côtés sur un combat sain', () => {
    expect(pvplog.diff(record('A', SYMETRIQUE), record('B', SYMETRIQUE))).toBeNull();
  });

  it('désigne les unités par (propriétaire, card_id) et jamais par le camp local', () => {
    // Le CORE_001 de A doit s'appeler pareil chez A (qui le joue) et chez B
    // (qui le subit) — sans quoi rien ne serait comparable.
    const a = record('A', SYMETRIQUE);
    const b = record('B', SYMETRIQUE);
    expect(a.ticks[0].order).toEqual(b.ticks[0].order);
    expect(a.ticks[0].order.sort()).toEqual(['A:CORE_001', 'B:CORE_002']);
  });

  it('replace chaque unité au même endroit vue des deux côtés', () => {
    const byKey = (v: any) => Object.fromEntries(v.ticks[0].units.map((r: any[]) => [r[0], `${r[1]},${r[2]}`]));
    expect(byKey(record('A', SYMETRIQUE))).toEqual({ 'A:CORE_001': '2,1', 'B:CORE_002': '2,9' });
    expect(byKey(record('B', SYMETRIQUE))).toEqual({ 'A:CORE_001': '2,1', 'B:CORE_002': '2,9' });
  });

  // ⚠️ LE TEST QUI A VALU LE LOT — et dont la panne est FERMÉE depuis.
  //
  // Il décrivait la production : les cases bloquées étaient appliquées verbatim
  // des deux côtés, les deux clients simulaient donc deux plateaux différents
  // dès qu'un terrain n'était pas invariant par le miroir (7 sur 14). C'est ce
  // que l'outil a effectivement rendu visible sur un vrai duel, round 5.
  //
  // `GameSession.startCombat` miroite désormais le terrain pour le rôle B
  // (`logic/BoardMirror`) et `GameController` journalise les cases TELLES
  // QU'ELLES SONT JOUÉES : ce cas n'est donc plus atteignable en jeu — il reste
  // ici comme détecteur de régression, en simulant deux clients qui ne
  // s'accorderaient plus sur le terrain. Le duel réel, correction comprise, est
  // rejoué de bout en bout par `pvp-determinism.test.ts`.
  it('attrape deux clients en désaccord sur le terrain, au tick 0, en nommant le champ', () => {
    const d = pvplog.diff(record('A', ASYMETRIQUE), record('B', ASYMETRIQUE));
    expect(d).not.toBeNull();
    expect(d.kind).toBe('header');
    expect(d.tick).toBe(0);
    expect(d.detail.field).toBe('blocked_cells');
  });

  it('normalise aussi les positions PORTÉES PAR LES ÉVÉNEMENTS', () => {
    // `move.from/to` et `freeze.cell` sont des positions : non normalisées,
    // elles divergeraient par construction et noieraient toute autre différence.
    const rec = new CombatRecorder({ matchId: 'm', round: 1, role: 'B' });
    const mine = u('CORE_002', 'player', 2, 1);
    const c = combat([mine], []);
    rec.header(c, SYMETRIQUE);
    rec.capture(c, [{ type: 'move', unit: mine, from: { col: 2, row: 2 }, to: { col: 2, row: 1 } }]);

    const evt = rec.payload().payload.ticks[0].events[0];
    expect(evt.unit).toBe('B:CORE_002');
    expect(evt.from).toEqual({ col: 2, row: 8 });
    expect(evt.to).toEqual({ col: 2, row: 9 });
  });

  it('se tronque en le DISANT plutôt que de rendre un fichier amputé en silence', () => {
    const rec = new CombatRecorder({ matchId: 'm', round: 1, role: 'A' });
    const units = Array.from({ length: 12 }, (_, i) => u(`CORE_${i}`, 'player', i % 5, 1));
    const c = combat(units, []);
    rec.header(c, SYMETRIQUE);
    for (let i = 0; i < 5000; i++) rec.capture(c, []);

    const p = rec.payload();
    expect(p.truncated).toBe(true);
    expect(JSON.stringify(p).length).toBeLessThan(1_000_000); // le plafond de corps d'/api
  });
});
