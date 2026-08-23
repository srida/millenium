/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Arbitrage du relais PvP (`ws/MatchRelay.js`, côté SERVEUR).
//
// Le module se charge en process, sans socket — même harnais que bots.test.ts,
// qui requiert déjà `ws/BotMatch.js` et `ws/MatchmakingQueue.js` de cette
// façon. Les « sockets » sont des objets qui enregistrent ce qu'on leur envoie.
//
// Ce qui est verrouillé ici, c'est le seul endroit du projet où le contrat
// « le serveur est seul arbitre du vainqueur PvP » ne tenait pas :
//
//   - deux rapports CONCORDANTS décident, et le vainqueur touche pvp_win ;
//   - deux rapports DIVERGENTS ne décident rien, et personne n'est payé.
//
// Le rôle A faisait auparavant autorité sur désaccord. C'était exploitable de
// la façon la plus simple qui soit : un client modifié en rôle A déclarait la
// victoire à chaque partie et encaissait 70 XP — le plus gros gain du jeu —
// quel que soit le rapport de son adversaire.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let relay: any;
let stmt: any;
let progression: any;

/** Socket factice : retient les messages, se dit toujours ouverte. */
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
function newUser(username: string) {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username, username_lc: username.toLowerCase(),
    tag: String(++tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: Date.now(),
  });
  progression.initUser(id);
  return id;
}

const xpOf = (id: string) => {
  const u = stmt.userById.get(id);
  return { level: u.level, xp: u.xp };
};

beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-relay-'));
  const illus = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-relay-illus-'));
  for (const f of ['cards.json', 'sets.json', 'variants.json']) {
    fs.copyFileSync(path.join(ROOT, 'data', f), path.join(tmp, f));
  }
  process.env.DATA_DIR = tmp;
  process.env.ILLUS_DIR = illus;

  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  relay = require(path.join(ROOT, 'ws', 'MatchRelay.js'));
});

let A: string, B: string, wsA: any, wsB: any, matchId: string;

beforeEach(() => {
  A = newUser('joueurA');
  B = newUser('joueurB');
  wsA = fakeSocket('joueurA');
  wsB = fakeSocket('joueurB');
  matchId = relay.createMatch(
    { userId: A, ws: wsA, deckName: 'Test' },
    { userId: B, ws: wsB, deckName: 'Test' },
  );
});

describe('rapports concordants', () => {
  it('A gagne : A est payé, B ne l\'est pas', () => {
    const avantA = xpOf(A);
    const avantB = xpOf(B);

    relay.handleReportResult(matchId, A, 'player');   // A dit « j'ai gagné »
    relay.handleReportResult(matchId, B, 'enemy');    // B dit « j'ai perdu »

    expect(wsA.last('match:end').winner).toBe('A');
    expect(wsB.last('match:end').winner).toBe('A');
    expect(wsA.last('match:end').xp_gained).toBe(70);
    expect(wsB.last('match:end').xp_gained).toBeUndefined();

    // Le gain est bien VERSÉ, pas seulement annoncé.
    expect(xpOf(A)).not.toEqual(avantA);
    expect(xpOf(B)).toEqual(avantB);
    expect(stmt.matchById.get(matchId).winner_user_id).toBe(A);
  });

  it('un nul ne paie personne', () => {
    const avantA = xpOf(A);
    const avantB = xpOf(B);

    relay.handleReportResult(matchId, A, 'draw');
    relay.handleReportResult(matchId, B, 'draw');

    expect(wsA.last('match:end').winner).toBe('draw');
    expect(xpOf(A)).toEqual(avantA);
    expect(xpOf(B)).toEqual(avantB);
  });
});

describe('rapports divergents', () => {
  // ⚠️ LE TEST CENTRAL DU FICHIER. Avant correctif, ce scénario faisait gagner A
  // et lui versait 70 XP — c'est-à-dire qu'il suffisait de mentir en rôle A.
  it('les deux se déclarent vainqueurs : nul, et AUCUN gain', () => {
    const avantA = xpOf(A);
    const avantB = xpOf(B);

    relay.handleReportResult(matchId, A, 'player');
    relay.handleReportResult(matchId, B, 'player');

    expect(wsA.last('match:end').winner).toBe('draw');
    expect(wsB.last('match:end').winner).toBe('draw');
    expect(wsA.last('match:end').reason).toBe('result_mismatch');

    // La moitié qui compte : le tricheur ne gagne RIEN à mentir.
    expect(xpOf(A)).toEqual(avantA);
    expect(xpOf(B)).toEqual(avantB);
    expect(wsA.last('match:end').xp_gained).toBeUndefined();
    expect(wsB.last('match:end').xp_gained).toBeUndefined();
    expect(stmt.matchById.get(matchId).winner_user_id).toBeNull();
  });

  it('le rôle A ne fait plus autorité : mentir en A ne paie pas non plus', () => {
    const avantA = xpOf(A);

    relay.handleReportResult(matchId, A, 'player');   // A ment
    relay.handleReportResult(matchId, B, 'draw');     // B dit vrai

    expect(wsA.last('match:end').winner).toBe('draw');
    expect(xpOf(A)).toEqual(avantA);
  });
});

describe('forfait et déconnexion', () => {
  it('un abandon paie bien l\'adversaire — le désaccord seul est neutre', () => {
    const avantB = xpOf(B);
    relay.handleForfeit(matchId, A);

    expect(wsB.last('match:end').winner).toBe('B');
    expect(wsB.last('match:end').xp_gained).toBe(70);
    expect(xpOf(B)).not.toEqual(avantB);
  });

  it('un second rapport après la fin du match ne change rien', () => {
    relay.handleReportResult(matchId, A, 'player');
    relay.handleReportResult(matchId, B, 'enemy');
    const apres = xpOf(A);

    relay.handleReportResult(matchId, A, 'player');
    relay.handleReportResult(matchId, B, 'enemy');

    expect(xpOf(A)).toEqual(apres);
  });
});
