/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Les duels de Draft côté SERVEUR : la file d'attente en mode `draft`
// (`ws/MatchmakingQueue`), le relais (`ws/MatchRelay`) et le repli bot
// (`ws/BotMatch`). Même harnais que pvp-relay.test.ts : modules chargés en
// process, « sockets » qui retiennent ce qu'on leur envoie.
//
// Ce qui est verrouillé :
//   - la file ne prend qu'une run en phase de duels, et n'apparie qu'avec un
//     autre joueur en draft ;
//   - le deck annoncé est celui de la RUN (serveur), jamais un nom de deck ;
//   - le duel est soldé dans la run de chacun par la clôture du match, et un
//     nul ne solde rien ;
//   - contre un bot, une victoire trop rapide ne compte pas, une fuite est
//     une défaite.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let stmt: any;
let progression: any;
let draft: any;
let shop: any;
let relay: any;
let queue: any;
let botMatch: any;
let cards: any[];

function fakeSocket(username: string) {
  const sent: any[] = [];
  return {
    OPEN: 1, readyState: 1,
    username, tag: '0001', avatar: null,
    send: (raw: string) => sent.push(JSON.parse(raw)),
    sent,
    last: (type: string) => [...sent].reverse().find((m) => m.type === type) ?? null,
  };
}

let tagSeq = 0;
function newUser(username = 'T') {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username, username_lc: username.toLowerCase(),
    tag: String(++tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: Date.now(),
  });
  progression.initUser(id);
  return id;
}

/** Pose une run du jour en phase de duels, avec ces cartes. */
function setRun(userId: string, picks: string[], extra: Record<string, unknown> = {}) {
  stmt.upsertDraftState.run({
    user_id: userId,
    run_day: shop.dayKey(),
    run: JSON.stringify({
      day: shop.dayKey(), seed: 1, picks, rerolls: 0, wins: 0, losses: 0,
      extra_life: false, status: 'playing', gems_earned: 0, ...extra,
    }),
  });
}

const runOf = (userId: string) => draft.getSnapshot({ id: userId }).run;
const gemsOf = (userId: string) => stmt.userById.get(userId).gems;

beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-draft-duel-'));
  const illus = path.join(tmp, 'card_illustrations');
  fs.mkdirSync(illus);
  for (const f of ['cards.json', 'attributes.json', 'missions.json', 'sets.json', 'decks.json']) {
    fs.copyFileSync(path.join(ROOT, 'initial-data', f), path.join(tmp, f));
  }
  process.env.DATA_DIR = tmp;
  process.env.ILLUS_DIR = illus;
  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  shop = require(path.join(ROOT, 'shop.js'));
  draft = require(path.join(ROOT, 'draft.js'));
  relay = require(path.join(ROOT, 'ws', 'MatchRelay.js'));
  queue = require(path.join(ROOT, 'ws', 'MatchmakingQueue.js'));
  botMatch = require(path.join(ROOT, 'ws', 'BotMatch.js'));
  cards = JSON.parse(fs.readFileSync(path.join(tmp, 'cards.json'), 'utf8'));
});

afterEach(() => { vi.useRealTimers(); });

const PICKS = () => cards.slice(0, 15).map(c => c.id);
const OTHER_PICKS = () => cards.slice(20, 35).map(c => c.id);

/** Deux joueurs en draft, appariés par la file. */
function draftMatch() {
  const A = newUser('A'); const B = newUser('B');
  setRun(A, PICKS()); setRun(B, OTHER_PICKS());
  const wsA = fakeSocket('A'); const wsB = fakeSocket('B');
  queue.joinQueue(wsA, A, undefined, 'draft');
  queue.joinQueue(wsB, B, undefined, 'draft');
  const found = wsB.last('match:found');
  return { A, B, wsA, wsB, matchId: found?.matchId as string, found };
}

describe('file d\'attente', () => {
  it('refuse une run sans duel à jouer, en le disant', () => {
    const noRun = newUser();
    const ws = fakeSocket('x');
    queue.joinQueue(ws, noRun, undefined, 'draft');
    expect(ws.last('error')).toMatchObject({ code: 'draft_unavailable' });

    // Une carte de plus due : pas de file non plus.
    const pending = newUser();
    setRun(pending, PICKS(), { wins: 1 });
    const ws2 = fakeSocket('y');
    queue.joinQueue(ws2, pending, undefined, 'draft');
    expect(ws2.last('error')).toMatchObject({ code: 'draft_unavailable' });
  });

  it('n\'apparie jamais un joueur en draft avec un joueur du Duel en ligne', () => {
    const D = newUser(); const S = newUser();
    setRun(D, PICKS());
    const wsD = fakeSocket('d'); const wsS = fakeSocket('s');
    queue.joinQueue(wsD, D, undefined, 'draft');
    queue.joinQueue(wsS, S, 'Deck', 'standard');
    expect(wsD.last('match:found')).toBeNull();
    expect(wsS.last('match:found')).toBeNull();
    queue.leaveQueue(D); queue.leaveQueue(S);
  });

  it('annonce un match de draft, avec les attributs du deck de la RUN adverse', () => {
    const { wsA, wsB, found } = draftMatch();
    expect(found.mode).toBe('draft');
    expect(wsA.last('match:found').mode).toBe('draft');
    // B reçoit les attributs du deck drafté de A, aucun cosmétique.
    const expected: Record<string, number> = {};
    for (const id of PICKS()) for (const a of cards.find(c => c.id === id).attributes ?? []) expected[a] = (expected[a] ?? 0) + 1;
    expect(found.opponent.deck_attribute_counts).toEqual(expected);
    expect(found.opponent.variants).toEqual({});
    expect(wsB.last('match:found').opponent.deck_attribute_counts).not.toEqual(wsA.last('match:found').opponent.deck_attribute_counts);
  });
});

describe('solde du duel', () => {
  it('une victoire arbitrée est soldée dans les DEUX runs, gemmes comprises', () => {
    const { A, B, wsA, wsB, matchId } = draftMatch();
    const gems = gemsOf(A);
    relay.handleReportResult(matchId, A, 'player');
    relay.handleReportResult(matchId, B, 'enemy');
    expect(runOf(A)).toMatchObject({ wins: 1, losses: 0, gems_earned: draft.WIN_GEMS[0] });
    expect(runOf(B)).toMatchObject({ wins: 0, losses: 1 });
    expect(gemsOf(A) - gems).toBe(draft.WIN_GEMS[0]);
    expect(wsA.last('match:end').draft).toMatchObject({ result: 'win', granted: { gems: draft.WIN_GEMS[0] } });
    expect(wsB.last('match:end').draft).toMatchObject({ result: 'loss', status: 'playing' });
    // La progression rendue au vainqueur porte déjà les gemmes.
    expect(wsA.last('match:end').progression.gems).toBe(gemsOf(A));
    // Un duel de Draft paie `draft_win` (30 XP), pas `pvp_win`.
    expect(wsA.last('match:end').xp_gained).toBe(progression.REWARDS.draft_win);
    expect(progression.REWARDS.draft_win).toBe(30);
    // Une carte de plus est due à chacun.
    expect(draft.pendingBonus(runOf(A))).toBe(true);
    expect(draft.pendingBonus(runOf(B))).toBe(true);
  });

  it('un nul ne solde rien : le duel se rejoue', () => {
    const { A, B, wsA, matchId } = draftMatch();
    relay.handleReportResult(matchId, A, 'draw');
    relay.handleReportResult(matchId, B, 'draw');
    expect(runOf(A)).toMatchObject({ wins: 0, losses: 0 });
    expect(runOf(B)).toMatchObject({ wins: 0, losses: 0 });
    expect(wsA.last('match:end').draft).toBeUndefined();
  });

  it('un abandon est une défaite pour qui abandonne', () => {
    const { A, B, matchId } = draftMatch();
    relay.handleForfeit(matchId, B);
    expect(runOf(A).wins).toBe(1);
    expect(runOf(B).losses).toBe(1);
  });

  it('un match du Duel en ligne ne touche à aucune run', () => {
    const A = newUser(); const B = newUser();
    setRun(A, PICKS()); setRun(B, OTHER_PICKS());
    const wsA = fakeSocket('a');
    const id = relay.createMatch({ userId: A, ws: wsA, deckName: 'x' }, { userId: B, ws: fakeSocket('b'), deckName: 'x' });
    relay.handleReportResult(id, A, 'player');
    relay.handleReportResult(id, B, 'enemy');
    expect(wsA.last('match:end').xp_gained).toBe(progression.REWARDS.pvp_win);
    expect(runOf(A).wins).toBe(0);
    expect(runOf(B).losses).toBe(0);
  });
});

describe('repli bot', () => {
  it('annonce un bot SANS deck : il est drafté chez le client', () => {
    const U = newUser(); setRun(U, PICKS());
    const ws = fakeSocket('u');
    const id = botMatch.createMatch(ws, U, { draft: true });
    const found = ws.last('match:found');
    expect(found).toMatchObject({ matchId: id, mode: 'draft', bot: { deck: null } });
    expect(found.opponent.username).toBeTruthy();
    botMatch.handleForfeit(id, U);
  });

  it('une victoire plausible compte, une victoire trop rapide non', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const U = newUser(); setRun(U, PICKS());
    const fast = botMatch.createMatch(fakeSocket('u'), U, { draft: true });
    botMatch.handleReportResult(fast, U, 'player');
    expect(runOf(U)).toMatchObject({ wins: 0, losses: 0 });

    const ws = fakeSocket('u');
    const slow = botMatch.createMatch(ws, U, { draft: true });
    vi.setSystemTime(Date.now() + botMatch.MIN_MATCH_MS + 1000);
    botMatch.handleReportResult(slow, U, 'player');
    expect(runOf(U)).toMatchObject({ wins: 1, gems_earned: draft.WIN_GEMS[0] });
    expect(ws.last('match:end').draft).toMatchObject({ result: 'win' });
    expect(ws.last('match:end').xp_gained).toBe(progression.REWARDS.draft_win);
  });

  it('fermer l\'onglet en plein duel est une défaite', () => {
    const U = newUser(); setRun(U, PICKS());
    botMatch.createMatch(fakeSocket('u'), U, { draft: true });
    botMatch.handleDisconnect(U);
    expect(runOf(U).losses).toBe(1);

    // Hors Draft, rien ne change : le match disparaît sans résultat.
    const V = newUser(); setRun(V, PICKS());
    botMatch.createMatch(fakeSocket('v'), V);
    botMatch.handleDisconnect(V);
    expect(runOf(V).losses).toBe(0);
  });
});
