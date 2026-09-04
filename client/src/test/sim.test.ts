// Simulation d'équilibrage — les invariants qui ne se voient pas dans un
// rapport, et qui rendraient pourtant tous ses chiffres faux.
//
// ⚠️ Chacun a été ÉPROUVÉ DANS LES DEUX SENS : vert sur le code livré, rouge
// sur le comportement d'avant réintroduit exprès (Math.random à la place du
// RNG semé, tri par |Δ| brut, filtre de couverture retiré). Un test qui passe
// aussi sur la faille ne vaut rien, et c'est invérifiable après coup.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import { makeRandom, seededRandom } from '../logic/Random.js';
import { primaryTier, hasTier } from '../logic/Tiers.js';
import { loadCatalog } from '../sim/catalog.js';
import { buildDeck, deckCardIds, deckWithCard, deckWithoutCard, isSummonable, materialClosure } from '../sim/decks.js';
import { MetricsCollector, effectSize, wilsonHalfWidth } from '../sim/metrics.js';
import { playPreparation } from '../sim/autoPlayer.js';
import { runGame } from '../sim/runGame.js';
import { runDetector } from '../sim/protocol.js';
import { buildReport } from '../sim/report.js';
import type { Card } from '../logic/types.js';
import { summonCost } from '../logic/InvocationManager.js';

const cat = loadCatalog();

function attrsOf(ids: string[]): Set<string> {
  const s = new Set<string>();
  for (const id of ids) for (const a of cat.cardDb.getCard(id)?.attributes ?? []) s.add(a);
  return s;
}

describe('RNG semé', () => {
  it('rejoue exactement la même suite', () => {
    const a = Array.from({ length: 20 }, () => makeRandom(42)());
    expect(Array.from({ length: 20 }, () => makeRandom(42)())).toEqual(a);
  });

  it('rend des suites différentes pour des graines différentes', () => {
    const r1 = seededRandom('2026-08-24'), r2 = seededRandom('2026-08-25');
    const a = Array.from({ length: 10 }, () => r1());
    const b = Array.from({ length: 10 }, () => r2());
    expect(a).not.toEqual(b);
  });

  it('reste dans [0, 1[', () => {
    const r = makeRandom(1);
    for (let i = 0; i < 5000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("ne se fige pas sur la graine 0 (l'état 0 est un point fixe de xorshift)", () => {
    const r = makeRandom(0);
    expect(new Set([r(), r(), r(), r()]).size).toBe(4);
  });
});

describe('Déterminisme de la simulation', () => {
  it('deux runs à graine égale rendent des métriques IDENTIQUES', () => {
    const a = runDetector(cat, 30, 'graine-test');
    const b = runDetector(cat, 30, 'graine-test');
    expect(b.baseline).toBe(a.baseline);
    expect(b.rows.map(r => [r.card_id, r.played, r.wins, r.combats, r.damageDealt]))
      .toEqual(a.rows.map(r => [r.card_id, r.played, r.wins, r.combats, r.damageDealt]));
  });

  it('deux graines différentes ne rendent pas le même run', () => {
    // Le pendant du test précédent : sans lui, un RNG ignoré passerait pour un
    // déterminisme réussi.
    const a = runDetector(cat, 30, 'graine-A');
    const b = runDetector(cat, 30, 'graine-B');
    expect(b.rows.map(r => [r.card_id, r.played])).not.toEqual(a.rows.map(r => [r.card_id, r.played]));
  });

  it('une partie isolée se rejoue à l’identique', () => {
    const deckRand = seededRandom('duel');
    const p = buildDeck(cat.cards, deckRand), e = buildDeck(cat.cards, deckRand);
    const play = () => runGame({
      playerDeck: p, enemyDeck: e, attributeList: cat.attributes,
      cardDb: cat.cardDb, boards: cat.boards, rand: seededRandom('duel', 1),
    });
    const a = play(), b = play();
    expect([b.winner, b.rounds, b.steps, b.playerHp, b.enemyHp])
      .toEqual([a.winner, a.rounds, a.steps, a.playerHp, a.enemyHp]);
  });
});

describe('Générateur de decks — la couverture des matériaux', () => {
  it('ne retient QUE des cartes que le deck peut invoquer', () => {
    // Sans cette règle, un deck aléatoire embarque des fusions dont les
    // matériaux sont absents : elles ne quittent jamais la main et le rapport
    // les déclare faibles alors qu'elles n'ont jamais été jouées.
    const rand = seededRandom('couverture');
    for (let i = 0; i < 25; i++) {
      const deck = buildDeck(cat.cards, rand);
      const ids = new Set(deckCardIds(deck));
      const attrs = attrsOf([...ids]);
      for (const id of ids) {
        const card = cat.cardDb.getCard(id)!;
        expect(isSummonable(card, ids, attrs), `${card.name} (${id}) n'est pas invocable dans son propre deck`).toBe(true);
      }
    }
  });

  it('respecte le plafond du DeckBuilder : 8 cartes par tier, sans doublon', () => {
    const rand = seededRandom('plafond');
    for (let i = 0; i < 15; i++) {
      const deck = buildDeck(cat.cards, rand);
      const ids = deckCardIds(deck);
      expect(new Set(ids).size).toBe(ids.length);
      for (const [tier, list] of Object.entries(deck)) {
        expect(list.length).toBeLessThanOrEqual(8);
        // ⚠️ APPARTENANCE, pas égalité au champ historique : une carte peut
        // porter plusieurs tiers, et c'est le résolveur qui fait foi.
        for (const id of list) expect(hasTier(cat.cardDb.getCard(id)!, Number(tier))).toBe(true);
      }
    }
  });

  it('produit des decks jouables (≥ 20 cartes, le minimum du DeckBuilder)', () => {
    const rand = seededRandom('taille');
    for (let i = 0; i < 15; i++) {
      expect(deckCardIds(buildDeck(cat.cards, rand)).length).toBeGreaterThanOrEqual(20);
    }
  });

  it('la fermeture de matériaux rend une carte de haut tier invocable', () => {
    const fusion = cat.cards.find(c =>
      primaryTier(c) >= 4 && (c.summon_conditions ?? []).some(cd => (cd.requires ?? []).length >= 2))!;
    const closure = materialClosure(fusion, cat.cards, cat.cardDb);
    expect(closure).not.toBeNull();
    const ids = new Set([fusion.id, ...closure!.map(c => c.id)]);
    expect(isSummonable(fusion, ids, attrsOf([...ids]))).toBe(true);
  });
});

describe('Protocole A/B — les deux bras ne diffèrent que par la carte', () => {
  const card = cat.cards.find(c => c.tier === 1 && summonCost(c) === 0)!;

  it('le bras « avec » contient la carte, le bras « sans » ne la contient pas', () => {
    const rand = seededRandom('ab');
    const base = buildDeck(cat.cards, rand);
    const withDeck = deckWithCard(base, card, cat.cardDb, rand);
    expect(withDeck).not.toBeNull();
    const withoutDeck = deckWithoutCard(withDeck!, card.id)!;
    expect(deckCardIds(withDeck!)).toContain(card.id);
    expect(deckCardIds(withoutDeck)).not.toContain(card.id);
  });

  it("n'évince jamais une carte dont un matériau du deck dépend", () => {
    // Retirer un matériau casserait la couverture d'une AUTRE carte : l'écart
    // mesuré ne porterait alors plus seulement sur la carte testée.
    const rand = seededRandom('eviction');
    for (let i = 0; i < 20; i++) {
      const base = buildDeck(cat.cards, rand);
      const withDeck = deckWithCard(base, card, cat.cardDb, rand);
      if (!withDeck) continue;
      const ids = new Set(deckCardIds(withDeck));
      const attrs = attrsOf([...ids]);
      for (const id of ids) {
        const c = cat.cardDb.getCard(id)!;
        if (c.id === card.id) continue;
        expect(isSummonable(c, ids, attrs), `${c.name} a perdu ses matériaux`).toBe(true);
      }
    }
  });
});

describe('Auto-joueur — il joue sous les règles du JOUEUR', () => {
  function sessionWith(card: Card) {
    return new GameSession({
      cardsByTier: { 1: [card], 2: [], 3: [], 4: [], 5: [] },
      enemyDeck: { '1': [card.id], '2': [], '3': [], '4': [], '5': [] },
      attributeList: cat.attributes, cardDb: cat.cardDb,
      getAllBoards: () => [], getAllMagies: () => [],
      mode: 'ai', rand: seededRandom('doublon'),
    });
  }

  const normal = cat.cards.find(c => c.tier === 1 && summonCost(c) === 0)!;

  it('respecte la règle du doublon : une seule unité vivante par card_id', () => {
    // Le deck ne contient qu'une carte : la main en tire cinq exemplaires
    // (la pioche est AVEC remise). Le joueur ne peut en poser qu'un.
    const session = sessionWith(normal);
    session.startPreparation();
    expect(session.hand.length).toBe(5);
    expect(session.hand.every(c => c.id === normal.id)).toBe(true);

    playPreparation(session);
    const units = session.getPlayerUnits();
    expect(units.length).toBe(1);
    expect(units[0].card_id).toBe(normal.id);
  });

  it("…et c'est bien la règle du jeu qui l'en empêche, pas une limite du pilote", () => {
    // Le pendant du test précédent : sans lui, un auto-joueur qui poserait
    // simplement mal passerait pour un auto-joueur respectueux des règles.
    // On observe le mécanisme — `isPlayable` se ferme — alors qu'il reste des
    // exemplaires en main et de la place sur le board.
    const session = sessionWith(normal);
    session.startPreparation();
    expect(session.isPlayable(normal)).toBe(true);

    playPreparation(session);
    expect(session.hand.length).toBeGreaterThan(0);          // il en reste en main
    expect(session.getPlayerUnits().length).toBeLessThan(     // et de la place
      session.gameState.player_board_slots);
    expect(session.isPlayable(normal)).toBe(false);           // la règle, donc
  });

  it('ne dépasse jamais le nombre de slots du board', () => {
    const rand = seededRandom('slots');
    const deck = buildDeck(cat.cards, rand);
    const cardsByTier: Record<number, Card[]> = {};
    for (let t = 1; t <= 5; t++) cardsByTier[t] = (deck[String(t)] ?? []).map(id => cat.cardDb.getCard(id)!).filter(Boolean);
    const session = new GameSession({
      cardsByTier, enemyDeck: deck, attributeList: cat.attributes, cardDb: cat.cardDb,
      getAllBoards: () => [], getAllMagies: () => [], mode: 'ai', rand,
    });
    session.startPreparation();
    playPreparation(session);
    expect(session.getPlayerUnits().length).toBeLessThanOrEqual(session.gameState.player_board_slots);
  });
});

describe('Métriques — ce qu’un chiffre a le droit d’affirmer', () => {
  it('le dénominateur du winrate est « posée », jamais « en deck »', () => {
    const c = new MetricsCollector(cat.cardDb);
    // Une partie gagnée ; la carte B était en deck mais n'a jamais été posée.
    c.add({
      winner: 'player', rounds: 5, timeouts: 0, playerHp: 900, enemyHp: 0, steps: 100,
      units: [{ card_id: 'A', side: 'player', combats: 3, survived: 2, damageDealt: 100, damageTaken: 50 }],
    }, ['A', 'B']);
    const rows = c.toRows();
    const a = rows.find(r => r.card_id === 'A')!;
    const b = rows.find(r => r.card_id === 'B')!;
    expect(a.played).toBe(1);
    expect(a.winrate).toBe(1);
    expect(b.inDeck).toBe(1);
    expect(b.played).toBe(0);
    expect(b.winrate).toBeNull();
    expect(b.playRate).toBe(0);
  });

  it('ne mesure QUE le siège du joueur', () => {
    const c = new MetricsCollector(cat.cardDb);
    c.add({
      winner: 'player', rounds: 5, timeouts: 0, playerHp: 900, enemyHp: 0, steps: 100,
      units: [{ card_id: 'ENN', side: 'enemy', combats: 3, survived: 3, damageDealt: 999, damageTaken: 0 }],
    }, []);
    expect(c.toRows().find(r => r.card_id === 'ENN')).toBeUndefined();
  });

  it("l'intervalle de Wilson ne s'annule pas sur un taux de 0 ou 1", () => {
    // C'est la raison du choix : l'intervalle normal rendrait 0, et une carte
    // posée trois fois et gagnante trois fois passerait pour une certitude.
    expect(wilsonHalfWidth(3, 3)).toBeGreaterThan(0.15);
    expect(wilsonHalfWidth(0, 3)).toBeGreaterThan(0.15);
    // Et il se resserre quand l'échantillon grandit.
    expect(wilsonHalfWidth(500, 1000)).toBeLessThan(wilsonHalfWidth(50, 100));
  });

  it('le classement met à zéro un écart que son échantillon ne soutient pas', () => {
    const tiny = { delta: 0.5, ci: 0.4 } as never;
    const solid = { delta: 0.2, ci: 0.05 } as never;
    expect(effectSize(tiny)).toBeCloseTo(0.1, 6);
    expect(effectSize(solid)).toBeCloseTo(0.15, 6);
    // Donc la ligne solide passe devant, malgré un écart brut deux fois moindre.
    expect(effectSize(solid)).toBeGreaterThan(effectSize(tiny));
  });

  it('présente les lignes significatives AVANT les écarts spectaculaires mal étayés', () => {
    // Le classement du rapport : une carte posée 3 fois et gagnante 3 fois
    // affiche un écart énorme et ne prouve rien. Elle ne doit pas coiffer une
    // carte posée 400 fois dont l'écart est établi.
    const c = new MetricsCollector(cat.cardDb);
    const play = (id: string, won: boolean) => c.add({
      winner: won ? 'player' : 'enemy', rounds: 5, timeouts: 0,
      playerHp: won ? 900 : 0, enemyHp: won ? 0 : 900, steps: 10,
      units: [{ card_id: id, side: 'player', combats: 1, survived: 1, damageDealt: 1, damageTaken: 0 }],
    }, [id]);

    // SOLIDE : 400 poses, 65 % de victoires.
    for (let i = 0; i < 400; i++) play('SOLIDE', i % 100 < 65);
    // BRUIT : 3 poses, 3 victoires — écart brut maximal, échantillon nul.
    for (let i = 0; i < 3; i++) play('BRUIT', true);
    // Du remplissage pour que la ligne de base ne soit pas dictée par ces deux-là.
    for (let i = 0; i < 600; i++) play('FOND', i % 2 === 0);

    const rows = c.toRows();
    const solide = rows.findIndex(r => r.card_id === 'SOLIDE');
    const bruit = rows.findIndex(r => r.card_id === 'BRUIT');
    expect(rows[solide].significant).toBe(true);
    expect(rows[bruit].significant).toBe(false);
    expect(Math.abs(rows[bruit].delta!)).toBeGreaterThan(Math.abs(rows[solide].delta!));
    expect(solide).toBeLessThan(bruit);
  });

  it('une ligne sous le seuil de poses n’est jamais déclarée significative', () => {
    const c = new MetricsCollector(cat.cardDb);
    for (let i = 0; i < 8; i++) {
      c.add({
        winner: 'player', rounds: 5, timeouts: 0, playerHp: 900, enemyHp: 0, steps: 10,
        units: [{ card_id: 'A', side: 'player', combats: 1, survived: 1, damageDealt: 1, damageTaken: 0 }],
      }, ['A']);
    }
    expect(c.toRows().find(r => r.card_id === 'A')!.significant).toBe(false);
  });
});

describe('Rapport', () => {
  it('reste très en deçà du plafond de corps de 1 Mo de /api', () => {
    const detector = runDetector(cat, 40, 'taille');
    const report = buildReport(cat, detector, [], { seed: 'taille', abGamesPerArm: 0, date: '2026-01-01' });
    const bytes = Buffer.byteLength(JSON.stringify(report));
    expect(bytes).toBeLessThan(700 * 1024);
    // Et il porte de quoi savoir sur quoi il a été obtenu.
    expect(report.catalog.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(report.seed).toBe('taille');
    expect(report.protocol.handicap).toEqual({ atk: 4, hp: 40 });
    expect(report.protocol.excludes.length).toBeGreaterThan(0);
  });
});
