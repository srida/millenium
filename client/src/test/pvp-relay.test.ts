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
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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

/** Pose un deck book SERVEUR pour ce joueur — la seule source que le relais lit
 *  pour dériver quoi que ce soit d'un deck (le client n'envoie qu'un NOM). */
function setDeckBook(userId: string, decks: Record<string, Record<string, string[]>>, active: string) {
  stmt.upsertDeckBook.run({
    user_id: userId,
    data: JSON.stringify({ active, decks, meta: {} }),
    updated_at: Date.now(),
  });
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

// ── Ce que le serveur DÉRIVE du deck engagé ────────────────────────────────
//
// Le rôle A choisit le terrain de combat en fonction des DEUX decks. Il connaît
// le sien ; celui d'en face ne peut venir que d'ici — le client ne transmet
// jamais son deck, seulement un nom, et `deps.enemyDeck` est un miroir en PvP.
describe('attributs du deck adverse', () => {
  // CORE_002 et CORE_006 portent tous deux ARCH_003 (Dragon) et ARCH_045
  // (Volant) ; CORE_001 et CORE_003 portent ARCH_002 (Magicien).
  const DRAGONS = { '1': ['CORE_002', 'CORE_006'] };
  const MAGES = { '1': ['CORE_001', 'CORE_003'] };

  function matchWith(deckA: any, deckB: any, name = 'Test') {
    const a = newUser('derivA');
    const b = newUser('derivB');
    if (deckA) setDeckBook(a, { [name]: deckA }, name);
    if (deckB) setDeckBook(b, { [name]: deckB }, name);
    const sa = fakeSocket('derivA');
    const sb = fakeSocket('derivB');
    const id = relay.createMatch({ userId: a, ws: sa, deckName: name }, { userId: b, ws: sb, deckName: name });
    return { a, b, sa, sb, id };
  }

  // Mutation : champ non ajouté à `deckDerived` → ROUGE.
  it('match:found porte les comptes d\'attributs, dérivés du deck book SERVEUR', () => {
    const { sa } = matchWith(DRAGONS, MAGES);
    const counts = sa.last('match:found').opponent.deck_attribute_counts;
    expect(counts).toBeTruthy();
    expect(counts.ARCH_002).toBe(2);   // les 2 cartes du deck adverse sont Magicien
  });

  // ⚠️ Le bug classique de ces deux lignes : chacun doit recevoir les attributs
  // de l'AUTRE. Mutation : intervertir connA/connB → ROUGE.
  it('chacun reçoit les attributs de l\'ADVERSAIRE, pas les siens', () => {
    const { sa, sb } = matchWith(DRAGONS, MAGES);
    expect(sa.last('match:found').opponent.deck_attribute_counts.ARCH_002).toBe(2);
    expect(sa.last('match:found').opponent.deck_attribute_counts.ARCH_003).toBeUndefined();
    expect(sb.last('match:found').opponent.deck_attribute_counts.ARCH_003).toBe(2);
    expect(sb.last('match:found').opponent.deck_attribute_counts.ARCH_002).toBeUndefined();
  });

  // Mutation : oublier le second point d'appel (handleRejoin) → ROUGE.
  it('match:rejoined les porte AUSSI — sinon un reconnecté perdrait la règle', () => {
    const { a, id } = matchWith(DRAGONS, MAGES);
    const again = fakeSocket('derivA');
    relay.handleRejoin(again, id, a);
    expect(again.last('match:rejoined').opponent.deck_attribute_counts.ARCH_002).toBe(2);
  });

  // ⚠️ Le serveur COMPTE, il ne seuille pas : `MIN_ATTRIBUTE_OCCURRENCES` vit
  // côté client, en un seul exemplaire. Mutation : appliquer un seuil ici → ROUGE.
  it('rend des comptes BRUTS — un attribut sur une seule carte est transmis', () => {
    // CORE_002 porte ARCH_017, que CORE_006 ne porte pas : compte de 1.
    const { sa } = matchWith(MAGES, DRAGONS);
    expect(sa.last('match:found').opponent.deck_attribute_counts.ARCH_017).toBe(1);
  });

  // Mutation : repli sur `book.active` supprimé → ROUGE.
  it('un nom de deck inconnu retombe sur le deck ACTIF du joueur', () => {
    const b = newUser('derivFallback');
    setDeckBook(b, { Actif: MAGES }, 'Actif');
    const sa = fakeSocket('derivAsker');
    relay.createMatch(
      { userId: newUser('derivAsker'), ws: sa, deckName: 'Test' },
      { userId: b, ws: fakeSocket('derivFallback'), deckName: 'ce-deck-n-existe-pas' },
    );
    expect(sa.last('match:found').opponent.deck_attribute_counts.ARCH_002).toBe(2);
  });

  it('un joueur sans deck book ne casse rien — comptes vides', () => {
    const { sa } = matchWith(DRAGONS, null);
    expect(sa.last('match:found').opponent.deck_attribute_counts).toEqual({});
  });

  // Les deux faits dérivés voyagent ENSEMBLE : les séparer voudrait dire qu'un
  // client reconnecté n'a qu'une moitié de son adversaire.
  it('variants et deck_attribute_counts arrivent par le même chemin', () => {
    const { sa } = matchWith(DRAGONS, MAGES);
    const opp = sa.last('match:found').opponent;
    expect(opp.variants).toBeTruthy();
    expect(opp.deck_attribute_counts).toBeTruthy();
  });
});

// ── La barrière du terrain ─────────────────────────────────────────────────
//
// Tests de CARACTÉRISATION : ils passaient déjà, mais rien ne les tenait. Le
// choix du terrain repose désormais dessus — c'est le seul mécanisme qui
// garantit que les deux clients jouent le MÊME terrain.
describe('barrière du terrain', () => {
  it('round:go porte aux DEUX le terrain annoncé par le rôle A', () => {
    relay.relayMessage(matchId, A, { type: 'round:terrain_pick', round: 1, boardId: 'BOARD_007' });
    relay.relayMessage(matchId, A, { type: 'round:combat_start_ack', round: 1 });
    expect(wsB.last('round:go')).toBeNull();          // barrière : on attend les 2
    relay.relayMessage(matchId, B, { type: 'round:combat_start_ack', round: 1 });
    expect(wsA.last('round:go').boardId).toBe('BOARD_007');
    expect(wsB.last('round:go').boardId).toBe('BOARD_007');
  });

  // Le terrain d'un round ne fuit pas sur le suivant. C'était garanti par la
  // remise à zéro qu'opérait `round:next_ready` ; ça l'est désormais par
  // construction — chaque terrain est mémorisé POUR SON ROUND.
  it('le terrain d\'un round ne vaut pas pour le suivant', () => {
    relay.relayMessage(matchId, A, { type: 'round:terrain_pick', round: 1, boardId: 'BOARD_007' });
    relay.relayMessage(matchId, A, { type: 'round:next_ready', round: 1 });
    relay.relayMessage(matchId, A, { type: 'round:combat_start_ack', round: 2 });
    relay.relayMessage(matchId, B, { type: 'round:combat_start_ack', round: 2 });
    expect(wsA.last('round:go').boardId).toBeNull();
  });

  // ⚠️ LE cas qui a bloqué un vrai duel (`d388310d`, round 4) : les deux joueurs
  // ne traversent PAS la fin d'un round à la même vitesse. Récapitulatif 22 s,
  // Phase Shopping 45 s, préparation 60 s — un joueur peut avoir tapé PRÊT pour
  // le round suivant quand l'autre quitte à peine le précédent.
  //
  // `round:next_ready` vidait alors la barrière SANS REGARDER de quel round il
  // parlait, effaçant l'acquittement déjà posé. Chaque client n'acquitte qu'une
  // fois par round : la barrière ne repassait jamais à deux, et les deux
  // joueurs restaient sur « En attente de l'adversaire… » indéfiniment.
  //
  // Mutation : `next_ready` remis à `combatStartAcks.clear()` → ROUGE.
  it('un joueur EN RETARD ne peut pas effacer l\'acquittement de l\'autre', () => {
    // Le rapide part au round 2 : terrain, board, acquittement.
    relay.relayMessage(matchId, A, { type: 'round:next_ready', round: 1 });
    relay.relayMessage(matchId, A, { type: 'round:terrain_pick', round: 2, boardId: 'BOARD_004' });
    relay.relayMessage(matchId, A, { type: 'round:combat_start_ack', round: 2 });
    expect(wsA.last('round:go')).toBeNull();          // il attend, c'est normal

    // Le lent quitte seulement maintenant le round 1 — son message est en
    // retard d'un round, il ne doit rien emporter.
    relay.relayMessage(matchId, B, { type: 'round:next_ready', round: 1 });
    relay.relayMessage(matchId, B, { type: 'round:combat_start_ack', round: 2 });

    expect(wsA.last('round:go'), 'la barrière doit s\'ouvrir').not.toBeNull();
    expect(wsA.last('round:go').round).toBe(2);
    expect(wsA.last('round:go').boardId).toBe('BOARD_004');
    expect(wsB.last('round:go').boardId).toBe('BOARD_004');
  });

  // Corollaire : une barrière n'appartient qu'à son round. Un acquittement
  // resté d'un round précédent ne compte pas pour le suivant, sans quoi un seul
  // joueur suffirait à lancer le combat.
  it('un acquittement d\'un autre round ne compte pas', () => {
    relay.relayMessage(matchId, A, { type: 'round:combat_start_ack', round: 2 });
    relay.relayMessage(matchId, B, { type: 'round:combat_start_ack', round: 3 });
    expect(wsA.last('round:go')).toBeNull();
    relay.relayMessage(matchId, A, { type: 'round:combat_start_ack', round: 3 });
    expect(wsA.last('round:go').round).toBe(3);
  });

  // Et la barrière se referme : le round suivant repart de zéro, un seul
  // acquittement ne relance pas le combat.
  it('se referme après usage', () => {
    relay.relayMessage(matchId, A, { type: 'round:combat_start_ack', round: 1 });
    relay.relayMessage(matchId, B, { type: 'round:combat_start_ack', round: 1 });
    expect(wsA.last('round:go').round).toBe(1);

    wsA.sent.length = 0;
    relay.relayMessage(matchId, A, { type: 'round:combat_start_ack', round: 2 });
    expect(wsA.last('round:go')).toBeNull();
  });
});


// ── L'échéance : une barrière à moitié franchie ne dure pas ─────────────────
//
// Le blocage du match `d388310d` a été refermé par l'indexation par round, mais
// il restait une seconde façon de figer un duel : un client qui n'acquitte
// jamais — suspendu par l'OS, onglet gelé — sans se déconnecter pour autant.
// Son adversaire attendait indéfiniment ; seule la déconnexion FRANCHE était
// traitée.
//
// La règle est celle de Marvel Snap : on joue le round si on peut, sinon le
// silencieux perd. ⚠️ « Jouer sans lui » n'est possible que si son BOARD est
// arrivé — le serveur n'en garde aucune copie, et le client présent l'attend
// aussi (`waitForOpponentBoard`).
describe('échéance de la barrière', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const BARRIER_MS = 180_000;

  /** Le tour complet d'un joueur qui tape PRÊT : board, terrain, acquittement. */
  function pret(who: string, ws: any, round: number, boardId: string | null = null) {
    relay.relayMessage(matchId, who, { type: 'round:board_ready', round, units: [], player_hp: 1000 });
    if (boardId) relay.relayMessage(matchId, who, { type: 'round:terrain_pick', round, boardId });
    relay.relayMessage(matchId, who, { type: 'round:combat_start_ack', round });
    return ws;
  }

  // ⚠️ Mutation : échéance retirée → le test reste bloqué (round:go jamais émis,
  // match toujours actif) et passe au rouge sur les deux attentes.
  it('clôt le match quand l\'adversaire n\'a rien annoncé du tout', () => {
    const avantA = xpOf(A);
    pret(A, wsA, 2, 'BOARD_004');
    expect(wsA.last('round:go')).toBeNull();

    vi.advanceTimersByTime(BARRIER_MS);

    expect(wsA.last('match:end')).not.toBeNull();
    expect(wsA.last('match:end').winner).toBe('A');
    expect(wsA.last('match:end').reason).toBe('timeout');
    // Le forfait paie, comme la déconnexion : l'adversaire a bien remporté le match.
    expect(xpOf(A)).not.toEqual(avantA);
    expect(stmt.matchById.get(matchId).winner_user_id).toBe(A);
  });

  // La grâce : le board est bien arrivé, seul l'acquittement manque. Le round se
  // joue — il n'y a aucune raison de couper une partie qu'on peut jouer.
  it('joue le round quand seul l\'ACQUITTEMENT manque', () => {
    pret(A, wsA, 2, 'BOARD_004');
    relay.relayMessage(matchId, B, { type: 'round:board_ready', round: 2, units: [], player_hp: 1000 });

    vi.advanceTimersByTime(BARRIER_MS);

    expect(wsA.last('match:end')).toBeNull();
    expect(wsA.last('round:go').round).toBe(2);
    expect(wsB.last('round:go').boardId).toBe('BOARD_004');
  });

  // ⚠️ « Une seule grâce » n'est pas un compteur, c'est une conséquence : un
  // client toujours muet n'annoncera pas non plus le board du round suivant, et
  // la barrière suivante retombe donc sur le forfait.
  it('la grâce ne se répète pas : au round suivant, le muet perd', () => {
    pret(A, wsA, 2, 'BOARD_004');
    relay.relayMessage(matchId, B, { type: 'round:board_ready', round: 2, units: [], player_hp: 1000 });
    vi.advanceTimersByTime(BARRIER_MS);
    expect(wsA.last('round:go').round).toBe(2);

    pret(A, wsA, 3, 'BOARD_007');           // B ne dit plus rien
    vi.advanceTimersByTime(BARRIER_MS);
    expect(wsA.last('match:end').winner).toBe('A');
  });

  // L'échéance ne doit pas se déclencher sur une barrière déjà franchie.
  it('une barrière franchie à temps ne clôt rien', () => {
    pret(A, wsA, 2, 'BOARD_004');
    pret(B, wsB, 2);
    expect(wsA.last('round:go').round).toBe(2);

    vi.advanceTimersByTime(BARRIER_MS * 3);
    expect(wsA.last('match:end')).toBeNull();
    expect(stmt.matchById.get(matchId).status).toBe('active');
  });
});
