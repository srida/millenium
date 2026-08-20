/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Golden tests des ADVERSAIRES ARTIFICIELS du Duel en ligne : le catalogue
// (`bots.js` + `initial-data/bot_decks.json`), la caisse (`ws/BotMatch.js`) et
// le repli de la file d'attente (`ws/MatchmakingQueue.js`).
//
// Même harnais serveur que shop.test.ts / gifts.test.ts : DATA_DIR et ILLUS_DIR
// temporaires, base SQLite à part, `data/` jamais touché.
//
// ⚠️ Le catalogue de decks, lui, est lu à son emplacement RÉEL (`initial-data/`,
// chemin en dur dans bots.js) et confronté au VRAI `data/cards.json` : c'est
// exactement ce qu'on veut vérifier. Un deck de bot est une dérivation du
// catalogue de cartes, et une carte supprimée en admin doit casser ici — pas en
// laissant un bot poser une main injouable devant un joueur.
//
// Ce qui est verrouillé :
//   - chaque deck de bot est jouable : ≥ 20 cartes, ≤ 8 par tier, aucun
//     doublon, et TOUTE carte de haut tier est invocable avec le deck lui-même ;
//   - l'identité d'un bot est indiscernable de celle d'un joueur (pseudo, tag à
//     4 chiffres, avatar `/illustrations/<id>` dont le PNG existe) ;
//   - une victoire paie `pvp_win` et RIEN d'autre ne paie : ni l'abandon, ni la
//     défaite, ni un match invraisemblablement court, ni le 21ᵉ de l'heure ;
//   - un vrai joueur qui arrive dans le délai est TOUJOURS préféré au bot.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let bots: any;
let botMatch: any;
let queue: any;
let progression: any;
let stmt: any;
let CARDS: any[];
let byId: Record<string, any>;
let TMP: string;
let ILLUS: string;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let _tagSeq = 0;
function newUser() {
  const id = crypto.randomUUID();
  stmt.insertUser.run({
    id, email: `${id}@test.local`, username: 'T', username_lc: 't',
    tag: String(++_tagSeq).padStart(4, '0'), password_hash: 'x', avatar: null, created_at: Date.now(),
  });
  progression.initUser(id);
  return id;
}

/** Socket factice : on ne lit que ce qui en sort. */
function fakeWs(userId?: string) {
  const sent: any[] = [];
  return {
    OPEN: 1, readyState: 1, userId,
    send: (raw: string) => sent.push(JSON.parse(raw)),
    sent,
    last: (type: string) => [...sent].reverse().find(m => m.type === type),
  };
}

/** Toutes les recettes d'une carte : ses alternatives, ou son coût unique. */
const costsOf = (c: any) => (c.summon_options?.length ? c.summon_options.map((o: any) => o.cost) : [c.cost]);

function summonable(card: any, ids: Set<string>, attrs: Set<string>) {
  return costsOf(card).some((cost: any) =>
    ((cost && cost.materials) || []).every((m: string) => (m.startsWith('ARCH_') ? attrs.has(m) : ids.has(m))));
}

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-bots-'));
  ILLUS = fs.mkdtempSync(path.join(os.tmpdir(), 'millenium-bots-illus-'));
  for (const f of ['cards.json', 'boards.json', 'magies.json']) {
    fs.copyFileSync(path.join(ROOT, 'data', f), path.join(TMP, f));
  }
  fs.writeFileSync(path.join(TMP, 'variants.json'), '[]');
  fs.writeFileSync(path.join(TMP, 'sets.json'), '[]');
  process.env.DATA_DIR = TMP;
  process.env.ILLUS_DIR = ILLUS;

  CARDS = JSON.parse(fs.readFileSync(path.join(TMP, 'cards.json'), 'utf8'));
  byId = Object.fromEntries(CARDS.map(c => [c.id, c]));
  // Catalogue entièrement illustré : c'est l'état nominal, et sans art le pool
  // d'avatars serait vide — le fichier ne prouverait plus rien.
  for (const c of CARDS) fs.writeFileSync(path.join(ILLUS, `${c.id}.png`), PNG);

  ({ stmt } = require(path.join(ROOT, 'db.js')));
  progression = require(path.join(ROOT, 'progression.js'));
  bots = require(path.join(ROOT, 'bots.js'));
  botMatch = require(path.join(ROOT, 'ws', 'BotMatch.js'));
  queue = require(path.join(ROOT, 'ws', 'MatchmakingQueue.js'));
});

describe('catalogue de decks', () => {
  it('en contient une dizaine, tous utilisables', () => {
    const all = bots.catalog();
    expect(all.length).toBeGreaterThanOrEqual(8);
    for (const def of all) {
      expect(typeof def.id).toBe('string');
      expect(typeof def.name).toBe('string');
      expect([1, 2, 3, 4]).toContain(def.difficulty);
    }
  });

  it('respecte les règles du DeckBuilder : ≥ 20 cartes, ≤ 8 par tier, sans doublon', () => {
    for (const def of bots.catalog()) {
      const flat = Object.values(def.deck).flat() as string[];
      expect(flat.length, def.id).toBeGreaterThanOrEqual(20);
      expect(new Set(flat).size, def.id).toBe(flat.length);
      for (const [tier, ids] of Object.entries(def.deck)) {
        expect((ids as string[]).length, `${def.id} T${tier}`).toBeLessThanOrEqual(8);
        for (const id of ids as string[]) {
          expect(byId[id], `${def.id} → ${id}`).toBeTruthy();
          expect(String(byId[id].tier), `${def.id} → ${id}`).toBe(tier);
        }
      }
    }
  });

  it('n\'embarque AUCUNE carte que le deck ne permet pas d\'invoquer', () => {
    // La règle qui commande tout le générateur : au-delà du tier 2, le
    // catalogue n'a presque aucune invocation normale. Une carte dont les
    // matériaux manquent est morte en main pour toute la partie — et un bot ne
    // la remplacera jamais par autre chose.
    for (const def of bots.catalog()) {
      const ids = new Set<string>();
      const attrs = new Set<string>();
      for (const tier of ['1', '2', '3', '4', '5']) {
        const cards = ((def.deck[tier] ?? []) as string[]).map(id => byId[id]).filter(Boolean);
        for (const c of cards) {
          expect(summonable(c, ids, attrs), `${def.id} → ${c.id} (${c.name}, ${c.summon_type})`).toBe(true);
        }
        for (const c of cards) {
          ids.add(c.id);
          for (const a of c.attributes ?? []) attrs.add(a);
        }
      }
    }
  });

  it('a de quoi remplir une main à chaque tour', () => {
    // Pool de pioche par tour (cf. Draw System) : une main vide est un tour où
    // le bot ne pose rien, donc un tour offert.
    const POOL: Record<string, number[]> = { 1: [1], 2: [1, 2], 3: [1, 2, 3], 4: [2, 3, 4], 5: [3, 4, 5] };
    for (const def of bots.catalog()) {
      for (const [round, tiers] of Object.entries(POOL)) {
        const n = tiers.reduce((a, t) => a + (def.deck[String(t)]?.length ?? 0), 0);
        expect(n, `${def.id} tour ${round}`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('varie les archétypes : aucun deck n\'en recopie un autre', () => {
    const seen = new Set<string>();
    for (const def of bots.catalog()) {
      const key = (Object.values(def.deck).flat() as string[]).slice().sort().join(',');
      expect(seen.has(key), def.id).toBe(false);
      seen.add(key);
    }
  });
});

describe('identité', () => {
  it('donne un pseudo, un tag à 4 chiffres et un deck jouable', () => {
    const bot = bots.spawn();
    expect(bots.PSEUDOS).toContain(bot.username);
    expect(bot.tag).toMatch(/^\d{4}$/);
    expect((Object.values(bot.deck).flat() as string[]).length).toBeGreaterThanOrEqual(20);
  });

  it('porte un avatar de la même forme que celui d\'un joueur, et son PNG existe', () => {
    // `PUT /api/profile/me` stocke exactement cette forme : les cinq sites de
    // rendu n'ont donc aucune branche « bot » à écrire. Et l'id est filtré par
    // l'existence de l'art — un `<img>` vide dans le HUD adverse serait le tell
    // le plus visible qu'on puisse laisser.
    for (let i = 0; i < 40; i++) {
      const bot = bots.spawn();
      expect(bot.avatar).toMatch(/^\/illustrations\/[A-Za-z0-9_-]+$/);
      const id = bot.avatar.split('/').pop()!;
      expect(fs.existsSync(path.join(ILLUS, `${id}.png`))).toBe(true);
      expect(Object.values(bot.deck).flat()).toContain(id);
    }
  });

  it('ne fige pas un pseudo sur un deck', () => {
    // Les apparier une fois pour toutes serait le tell le plus facile du
    // système : « ce pseudo joue toujours des dragons » se remarque vite.
    const byDeck = new Map<string, Set<string>>();
    for (let i = 0; i < 300; i++) {
      const bot = bots.spawn();
      if (!byDeck.has(bot.deckId)) byDeck.set(bot.deckId, new Set());
      byDeck.get(bot.deckId)!.add(bot.username);
    }
    for (const [deckId, pseudos] of byDeck) {
      expect(pseudos.size, deckId).toBeGreaterThan(1);
    }
  });
});

describe('caisse', () => {
  let userId: string;
  let ws: ReturnType<typeof fakeWs>;
  let matchId: string;

  /** Un match dont l'horloge est déjà assez vieille pour que le gain passe. */
  function openMatch(ageMs = botMatch.MIN_MATCH_MS + 1000) {
    userId = newUser();
    ws = fakeWs(userId);
    const started = Date.now();
    vi.setSystemTime(started);
    matchId = botMatch.createMatch(ws, userId);
    vi.setSystemTime(started + ageMs);
    return matchId;
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('annonce le match comme un vrai : même forme, adversaire nommé', () => {
    openMatch();
    const found = ws.last('match:found');
    expect(found.matchId).toBe(matchId);
    expect(found.youAre).toBe('A');
    expect(found.opponent.username).toBeTruthy();
    expect(found.opponent.tag).toMatch(/^\d{4}$/);
    // Un bot ne possède aucune variante d'illustration — le champ est présent
    // pour que le client n'ait pas de branche à écrire.
    expect(found.opponent.variants).toEqual({});
    expect(found.bot.deck).toBeTruthy();
  });

  it('paie pvp_win, et exactement ce barème', () => {
    openMatch();
    const before = progression.getProgression(stmt.userById.get(userId));
    botMatch.handleReportResult(matchId, userId, 'player');
    const end = ws.last('match:end');
    expect(end.winner).toBe('A');
    expect(end.xp_gained).toBe(progression.REWARDS.pvp_win);
    const after = progression.getProgression(stmt.userById.get(userId));
    expect(after.xp - before.xp).toBe(progression.REWARDS.pvp_win);
    expect(end.progression.xp).toBe(after.xp);
  });

  it('ne paie ni la défaite, ni l\'égalité, ni l\'abandon', () => {
    for (const close of [
      () => botMatch.handleReportResult(matchId, userId, 'enemy'),
      () => botMatch.handleReportResult(matchId, userId, 'draw'),
      () => botMatch.handleForfeit(matchId, userId),
    ]) {
      openMatch();
      const before = progression.getProgression(stmt.userById.get(userId));
      close();
      expect(ws.last('match:end').xp_gained).toBeUndefined();
      expect(progression.getProgression(stmt.userById.get(userId)).xp).toBe(before.xp);
    }
  });

  it('refuse le gain d\'un match invraisemblablement court', () => {
    // Une partie de 5 tours contre 1000 PV ne se gagne pas en une minute : le
    // seul rapport qui arrive si vite est un rapport fabriqué. Le match est
    // quand même soldé — c'est le gain qu'on retire, pas la partie.
    openMatch(1000);
    const before = progression.getProgression(stmt.userById.get(userId));
    botMatch.handleReportResult(matchId, userId, 'player');
    expect(ws.last('match:end').winner).toBe('A');
    expect(ws.last('match:end').xp_gained).toBeUndefined();
    expect(progression.getProgression(stmt.userById.get(userId)).xp).toBe(before.xp);
  });

  it('plafonne les gains par heure sans jamais gêner qui joue normalement', () => {
    const uid = newUser();
    let paid = 0;
    const base = Date.now();
    for (let i = 0; i < botMatch.MAX_REWARDS_PER_WINDOW + 5; i++) {
      const sock = fakeWs(uid);
      vi.setSystemTime(base + i * 1000);
      const id = botMatch.createMatch(sock, uid);
      vi.setSystemTime(base + i * 1000 + botMatch.MIN_MATCH_MS + 1000);
      botMatch.handleReportResult(id, uid, 'player');
      if (sock.last('match:end').xp_gained) paid++;
    }
    expect(paid).toBe(botMatch.MAX_REWARDS_PER_WINDOW);
  });

  it('ne solde jamais le match d\'un autre', () => {
    openMatch();
    const intrus = newUser();
    const before = progression.getProgression(stmt.userById.get(intrus));
    botMatch.handleReportResult(matchId, intrus, 'player');
    expect(progression.getProgression(stmt.userById.get(intrus)).xp).toBe(before.xp);
    expect(ws.last('match:end')).toBeUndefined();
  });

  it('oublie le match quand le joueur ferme son onglet', () => {
    openMatch();
    expect(botMatch.isBotMatch(matchId)).toBe(true);
    botMatch.handleDisconnect(userId);
    expect(botMatch.isBotMatch(matchId)).toBe(false);
    // Un rapport tardif ne ressuscite rien, donc ne paie rien.
    const before = progression.getProgression(stmt.userById.get(userId));
    botMatch.handleReportResult(matchId, userId, 'player');
    expect(progression.getProgression(stmt.userById.get(userId)).xp).toBe(before.xp);
  });
});

describe('file d\'attente', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sert un bot au joueur resté seul, et pas avant le délai', () => {
    const uid = newUser();
    const ws = fakeWs(uid);
    queue.joinQueue(ws, uid, 'Deck');
    vi.advanceTimersByTime(queue.BOT_DELAY_MS - 1);
    expect(ws.last('match:found')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(ws.last('match:found').bot).toBeTruthy();
    queue.leaveQueue(uid);
  });

  it('ne vole JAMAIS un duel humain', () => {
    // Un vrai joueur arrivé avant l'échéance doit toujours l'emporter — sinon
    // le repli transformerait une file qui marche en jeu contre des bots.
    const a = newUser(); const b = newUser();
    const wsA = fakeWs(a); const wsB = fakeWs(b);
    queue.joinQueue(wsA, a, 'Deck A');
    vi.advanceTimersByTime(queue.BOT_DELAY_MS - 1);
    queue.joinQueue(wsB, b, 'Deck B');
    expect(wsA.last('match:found').bot).toBeUndefined();
    expect(wsB.last('match:found').bot).toBeUndefined();
    // Et le timer du premier ne doit plus se déclencher derrière.
    vi.advanceTimersByTime(queue.BOT_DELAY_MS * 2);
    expect(wsA.sent.filter((m: any) => m.type === 'match:found')).toHaveLength(1);
  });

  it('désarme le repli quand le joueur quitte la file', () => {
    const uid = newUser();
    const ws = fakeWs(uid);
    queue.joinQueue(ws, uid, 'Deck');
    queue.leaveQueue(uid);
    vi.advanceTimersByTime(queue.BOT_DELAY_MS * 2);
    expect(ws.last('match:found')).toBeUndefined();
  });

  it('ne sert rien à une socket déjà fermée', () => {
    const uid = newUser();
    const ws = fakeWs(uid);
    queue.joinQueue(ws, uid, 'Deck');
    ws.readyState = 3;
    vi.advanceTimersByTime(queue.BOT_DELAY_MS);
    expect(ws.last('match:found')).toBeUndefined();
  });
});
