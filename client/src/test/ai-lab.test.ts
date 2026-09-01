/* eslint-disable @typescript-eslint/no-explicit-any */
// Labo IA — golden tests du pilote pur (`dev/aiLabRun.ts`) et de
// l'instrumentation d'`EnemyAI`.
//
// L'ÉCRAN n'est pas testé : la suite tourne en node sans jsdom, aucun test de
// composant n'est possible dans ce projet. Toute la décision vit donc dans le
// pilote, qui est pur — c'est le même partage que `data/tutorialScript.ts`.
//
// Fixtures 100 % synthétiques (`helpers.makeCard`) : les motifs de refus ne
// doivent pas dépendre du contenu du jeu.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiPlacement, refusalCounts, placedCount } from '../dev/aiLabRun.js';
import type { AiLabInput, AiTraceEvent } from '../dev/aiLabRun.js';
import { EnemyAI } from '../logic/EnemyAI.js';
import { seededRandom } from '../logic/Random.js';
import { makeCard, makeBoard, spawn } from './helpers.js';

/** Racine de `client/src`, pour les tests qui lisent de vraies sources. */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function db(cards: any[]) {
  const byId = new Map(cards.map(c => [c.id, c]));
  return { getCard: (id: string) => (byId.get(id) as any) ?? null };
}

function run(over: Partial<AiLabInput> & { cardDb: any }): ReturnType<typeof runAiPlacement> {
  return runAiPlacement({
    deck: {}, round: 1, slots: 5, survivors: [], graveyard: [],
    hand: [], seed: 'test', ...over,
  } as AiLabInput);
}

const attempts = (r: { events: AiTraceEvent[] }) =>
  r.events.filter(e => e.kind === 'attempt') as Extract<AiTraceEvent, { kind: 'attempt' }>[];

const refusalOf = (r: { events: AiTraceEvent[] }, cardId: string) =>
  attempts(r).find(a => a.card_id === cardId)?.reason ?? null;

// ── Le test qui compte : l'instrumentation n'a rien changé ────────────────────
//
// Tout le reste du fichier décrit des métadonnées neuves. Celui-ci vérifie que
// ces métadonnées sont bien des métadonnées : la trace branchée, l'IA doit
// poser exactement les mêmes unités aux mêmes cases qu'à vide.
describe('Non-régression — observer ne change rien', () => {
  const cards = [
    makeCard({ id: 'N1', summon_type: 'normal', stats: { range: 1, hp: 40 } as any }),
    makeCard({ id: 'N2', summon_type: 'normal', stats: { range: 3, hp: 20 } as any }),
    makeCard({ id: 'N3', summon_type: 'normal', stats: { range: 1, hp: 90 } as any }),
    makeCard({ id: 'F1', summon_type: 'fusion', cost: { materials: ['N1', 'N2'] } }),
    makeCard({ id: 'S1', summon_type: 'sacrifice', cost: { sacrifice: 2 } }),
  ];

  function play(withTrace: boolean) {
    const board = makeBoard();
    const ai = new (EnemyAI as any)({ 1: cards.map(c => c.id) }, db(cards), 'enemy');
    const sink = withTrace ? () => {} : null;
    ai.drawHand(1, sink);
    const hand = ai.getHand().map((c: any) => c.id);
    ai.setHand(cards.filter(c => hand.includes(c.id)));
    // Main imposée pour que les deux exécutions partent du même point : la
    // pioche consomme `rand`, et c'est le PLACEMENT qu'on compare.
    ai.setHand(cards);
    ai.placeFromHand(board, 5, [], sink);
    ai.rearrangeUnits(board, 5, sink);
    return board.getLivingUnitsOnSide('enemy')
      .map((u: any) => `${u.card_id}@${u.position.col},${u.position.row}`)
      .sort();
  }

  it('placeFromHand + rearrangeUnits donnent le même board avec et sans trace', () => {
    expect(play(true)).toEqual(play(false));
  });

  it('les appels sans trace restent la forme par défaut (aucun argument requis)', () => {
    const board = makeBoard();
    const ai = new (EnemyAI as any)({ 1: ['N1'] }, db(cards), 'enemy');
    expect(() => { ai.drawHand(1); ai.placeFromHand(board, 5, []); ai.rearrangeUnits(board, 5); })
      .not.toThrow();
    expect(board.getLivingUnitsOnSide('enemy')).toHaveLength(1);
  });
});

// ── Chaque motif de refus est atteignable ────────────────────────────────────
//
// ⚠️ Chacun est prouvé par le MOTIF *et* par l'état du board — jamais par le
// seul fait qu'aucune unité n'est sortie : c'est très exactement l'ambiguïté
// que le lot supprime, un test qui s'en contenterait la réintroduirait.
describe('Motifs de refus — un par cas', () => {
  it('board_full : le cap est atteint', () => {
    const cards = ['A', 'B', 'C', 'D', 'E', 'F'].map(id => makeCard({ id, summon_type: 'normal' }));
    const r = run({ cardDb: db(cards), hand: cards.map(c => c.id), slots: 5 });
    expect(r.board_after).toHaveLength(5);
    expect(refusalOf(r, 'F')).toBe('board_full');
    const a = attempts(r).find(x => x.card_id === 'F')!;
    expect(a.detail).toMatchObject({ on_board: 5, max_units: 5 });
  });

  it('duplicate_on_board : deux exemplaires vivants de la même carte', () => {
    const n = makeCard({ id: 'N', summon_type: 'normal' });
    const r = run({ cardDb: db([n]), hand: ['N', 'N'] });
    expect(r.board_after.map(u => u.card_id)).toEqual(['N']);
    expect(refusalOf(r, 'N')).toBe(null);       // le premier exemplaire passe
    expect(attempts(r).some(a => a.reason === 'duplicate_on_board')).toBe(true);
    // ⚠️ Le second est retenté à CHAQUE passe tant qu'une passe produit quelque
    // chose : le refus apparaît donc plusieurs fois. C'est le point fixe de
    // `placeFromHand`, pas un doublon de trace.
    expect(r.hand_left).toEqual(['N']);
  });

  it('not_enough_material : moins de matériaux que de sacrifices demandés', () => {
    const s = makeCard({ id: 'S', summon_type: 'sacrifice', cost: { sacrifice: 3 } });
    const r = run({ cardDb: db([s]), hand: ['S'] });
    expect(r.board_after).toHaveLength(0);
    expect(refusalOf(r, 'S')).toBe('not_enough_material');
    expect(attempts(r)[0].detail).toMatchObject({ needed: 3, available: 0 });
  });

  it('missing_material : la fusion NOMME le matériau qui manque', () => {
    const n1 = makeCard({ id: 'N1', summon_type: 'normal' });
    const f = makeCard({ id: 'F', summon_type: 'fusion', cost: { materials: ['N1', 'N2'] } });
    const r = run({ cardDb: db([n1, f]), hand: ['N1', 'F'] });
    expect(r.board_after.map(u => u.card_id)).toEqual(['N1']);
    expect(refusalOf(r, 'F')).toBe('missing_material');
    // C'EST le champ qui manquait : sans lui, « la fusion n'est pas passée »
    // ne dit pas quelle carte aller chercher.
    expect(attempts(r).find(a => a.card_id === 'F')!.detail).toMatchObject({ material: 'N2' });
  });

  it('would_exceed_slots : la fusion ne consomme pas assez de place', () => {
    // 5 unités sur 5 slots, une fusion dont l'unique matériau est au CIMETIÈRE :
    // elle ne libère aucune case du board, le solde net serait +1.
    const surv = ['A', 'B', 'C', 'D', 'E'].map(id => makeCard({ id, summon_type: 'normal' }));
    const mat = makeCard({ id: 'M', summon_type: 'normal' });
    const f = makeCard({ id: 'F', summon_type: 'fusion', cost: { materials: ['M'] } });
    const r = run({
      cardDb: db([...surv, mat, f]),
      survivors: surv.map((c, i) => ({ card_id: c.id, col: i, row: 7 })),
      graveyard: ['M'],
      hand: ['F'],
      slots: 5,
    });
    expect(r.board_after).toHaveLength(5);
    expect(refusalOf(r, 'F')).toBe('would_exceed_slots');
    expect(attempts(r)[0].detail).toMatchObject({ on_board: 5, consumed_from_board: 0, max_units: 5 });
  });

  it('no_transformation_target : la cible n\'est ni sur le board ni au cimetière', () => {
    const t = makeCard({ id: 'T', summon_type: 'transformation', cost: { materials: ['BASE'] } });
    const r = run({ cardDb: db([t]), hand: ['T'] });
    expect(r.board_after).toHaveLength(0);
    expect(refusalOf(r, 'T')).toBe('no_transformation_target');
    expect(attempts(r)[0].detail).toMatchObject({ target: 'BASE' });
  });

  it('no_transformation_target_id : la transformation ne désigne aucune cible', () => {
    const t = makeCard({ id: 'T', summon_type: 'transformation', cost: {} });
    const r = run({ cardDb: db([t]), hand: ['T'] });
    expect(refusalOf(r, 'T')).toBe('no_transformation_target_id');
  });

  it('transformation_target_mismatch : le résultat est déjà là et ne matche pas la cible', () => {
    const base = makeCard({ id: 'BASE', summon_type: 'normal' });
    const t = makeCard({ id: 'T', summon_type: 'transformation', cost: { materials: ['BASE'] } });
    const r = run({
      cardDb: db([base, t]),
      survivors: [{ card_id: 'T', col: 2, row: 7 }],
      hand: ['T'],
    });
    expect(refusalOf(r, 'T')).toBe('transformation_target_mismatch');
    expect(attempts(r)[0].detail).toMatchObject({ target: 'BASE', on_board: 'T' });
  });

  // ⚠️ `duplicate_needs_extra_material` est INATTEIGNABLE, et le nommer l'a
  // montré : la garde `board + grave < needed` juste au-dessus se réduit
  // exactement à la même inégalité, elle absorbe donc tous ses cas. Le motif
  // reste défini (filet si la garde du dessus bouge un jour), mais aucun état
  // ne peut le produire — ce test le documente plutôt que de le prétendre
  // couvert.
  it('duplicate_needs_extra_material est absorbé par not_enough_material', () => {
    const s = makeCard({ id: 'S', summon_type: 'sacrifice', cost: { sacrifice: 3 } });
    const filler = makeCard({ id: 'X', summon_type: 'normal' });
    const r = run({
      cardDb: db([s, filler]),
      survivors: [{ card_id: 'S', col: 2, row: 7 }, { card_id: 'X', col: 1, row: 7 }],
      hand: ['S'],
    });
    expect(refusalOf(r, 'S')).toBe('not_enough_material');

    // Et quand il y a assez de matériaux, le doublon est consommé sans erreur.
    const ok = run({
      cardDb: db([s, filler]),
      survivors: [{ card_id: 'S', col: 2, row: 7 }, { card_id: 'X', col: 1, row: 7 }],
      graveyard: ['X'],
      hand: ['S'],
    });
    const a = attempts(ok).find(x => x.card_id === 'S')!;
    expect(a.outcome).toBe('placed');
    expect(a.consumed.board.map(u => u.card_id).sort()).toEqual(['S', 'X']);
    expect(a.consumed.graveyard.map(u => u.card_id)).toEqual(['X']);
  });

  it('unknown_summon_type : une voie que le moteur ne connaît pas', () => {
    const weird = makeCard({ id: 'W', summon_type: 'rituel' });
    const r = run({ cardDb: db([weird]), hand: ['W'] });
    expect(refusalOf(r, 'W')).toBe('unknown_summon_type');
    expect(attempts(r)[0].detail).toMatchObject({ summon_type: 'rituel' });
  });

  it('all_options_failed : chaque option est nommée avec SON motif', () => {
    const multi = makeCard({
      id: 'M', summon_type: 'fusion',
      summon_options: [
        { summon_type: 'fusion', cost: { materials: ['ABSENT'] } },
        { summon_type: 'sacrifice', cost: { sacrifice: 4 } },
      ],
    });
    const r = run({ cardDb: db([multi]), hand: ['M'] });
    expect(refusalOf(r, 'M')).toBe('all_options_failed');
    const opts = (attempts(r)[0].detail as any).options;
    // ⚠️ L'index est celui d'ORIGINE, pas celui du tri : c'est lui qui nomme
    // l'option dans le catalogue.
    expect(opts).toEqual([
      { index: 0, summon_type: 'fusion', reason: 'missing_material', detail: { material: 'ABSENT', materials: ['ABSENT'] } },
      { index: 1, summon_type: 'sacrifice', reason: 'not_enough_material', detail: { needed: 4, available: 0 } },
    ]);
  });

  it('refusalCounts agrège les motifs sur plusieurs rounds', () => {
    const s = makeCard({ id: 'S', summon_type: 'sacrifice', cost: { sacrifice: 3 } });
    const r1 = run({ cardDb: db([s]), hand: ['S'] });
    const r2 = run({ cardDb: db([s]), hand: ['S'], round: 2 });
    expect(refusalCounts([r1, r2])).toEqual({ not_enough_material: 2 });
    expect(placedCount([r1, r2])).toBe(0);
  });
});

// ── Ce que la trace dit d'un SUCCÈS ──────────────────────────────────────────
describe('Trace d\'un placement réussi', () => {
  it('nomme la case et les matériaux consommés, board et cimetière séparés', () => {
    const n1 = makeCard({ id: 'N1', summon_type: 'normal' });
    const n2 = makeCard({ id: 'N2', summon_type: 'normal' });
    const f = makeCard({ id: 'F', summon_type: 'fusion', cost: { materials: ['N1', 'N2'] } });
    const r = run({
      cardDb: db([n1, n2, f]),
      survivors: [{ card_id: 'N1', col: 0, row: 7 }],
      graveyard: ['N2'],
      hand: ['F'],
    });
    const a = attempts(r).find(x => x.card_id === 'F')!;
    expect(a.outcome).toBe('placed');
    expect(a.cell).toEqual({ col: 0, row: 7 });
    expect(a.consumed.board.map(u => u.card_id)).toEqual(['N1']);
    expect(a.consumed.graveyard.map(u => u.card_id)).toEqual(['N2']);
    // Le matériau a bien quitté le cimetière — la trace ne raconte pas autre
    // chose que ce qui s'est passé.
    expect(r.graveyard_left).toEqual([]);
    expect(r.board_after.map(u => u.card_id)).toEqual(['F']);
  });

  it('l\'option retenue d\'une carte multi-voies est nommée par son index d\'origine', () => {
    const base = makeCard({ id: 'BASE', summon_type: 'normal' });
    const multi = makeCard({
      id: 'M', summon_type: 'fusion',
      summon_options: [
        { summon_type: 'sacrifice', cost: { sacrifice: 4 } },
        { summon_type: 'transformation', cost: { materials: ['BASE'] } },
      ],
    });
    const r = run({
      cardDb: db([base, multi]),
      survivors: [{ card_id: 'BASE', col: 2, row: 7 }],
      hand: ['M'],
    });
    const a = attempts(r).find(x => x.card_id === 'M')!;
    expect(a.outcome).toBe('placed');
    // La transformation est tentée en PREMIER (tri de `_attempt`) alors qu'elle
    // est en position 1 du catalogue.
    expect(a.option_index).toBe(1);
  });
});

// ── La structure en passes ───────────────────────────────────────────────────
describe('Passes — le point fixe de placeFromHand', () => {
  it('une fusion trouve ses matériaux dès la passe 1 : les normales passent devant', () => {
    const n1 = makeCard({ id: 'N1', summon_type: 'normal' });
    const n2 = makeCard({ id: 'N2', summon_type: 'normal' });
    const f = makeCard({ id: 'F', summon_type: 'fusion', cost: { materials: ['N1', 'N2'] } });
    const r = run({ cardDb: db([n1, n2, f]), hand: ['F', 'N1', 'N2'] });

    const starts = r.events.filter(e => e.kind === 'pass_start') as any[];
    // `_summonPriority` réordonne : les normales sont posées AVANT que la
    // fusion ne soit tentée, une seule passe suffit donc.
    expect(starts[0].order).toEqual(['N1', 'N2', 'F']);
    expect(starts).toHaveLength(1);
    expect(attempts(r).find(a => a.card_id === 'F')).toMatchObject({ pass: 1, outcome: 'placed' });
    expect(r.board_after.map(u => u.card_id)).toEqual(['F']);
  });

  it('une fusion qui attend un SACRIFICE sort à la passe 2', () => {
    // Le tri ne sauve que ce qui est en amont : `sacrifice` (4) vient APRÈS
    // `fusion` (2), donc la fusion est tentée avant que son matériau existe.
    // C'est le seul cas où la boucle de point fixe sert vraiment.
    const n = makeCard({ id: 'N', summon_type: 'normal' });
    const s = makeCard({ id: 'S', summon_type: 'sacrifice', cost: { sacrifice: 1 } });
    const f = makeCard({ id: 'F', summon_type: 'fusion', cost: { materials: ['S'] } });
    const r = run({ cardDb: db([n, s, f]), hand: ['N', 'S', 'F'] });

    const starts = r.events.filter(e => e.kind === 'pass_start') as any[];
    expect(starts).toHaveLength(2);
    expect(starts[0].order).toEqual(['N', 'F', 'S']);

    const fusion = attempts(r).filter(a => a.card_id === 'F');
    expect(fusion[0]).toMatchObject({ pass: 1, outcome: 'refused', reason: 'missing_material' });
    expect(fusion[1]).toMatchObject({ pass: 2, outcome: 'placed' });
    expect(r.board_after.map(u => u.card_id)).toEqual(['F']);
    expect(r.hand_left).toEqual([]);
  });

  it('pass_end compte les posées et nomme ce qui reste', () => {
    const n = makeCard({ id: 'N', summon_type: 'normal' });
    const t = makeCard({ id: 'T', summon_type: 'transformation', cost: { materials: ['ABSENT'] } });
    const r = run({ cardDb: db([n, t]), hand: ['N', 'T'] });
    const ends = r.events.filter(e => e.kind === 'pass_end') as any[];
    expect(ends[0]).toMatchObject({ pass: 1, placed: 1, unplaced: ['T'] });
    expect(r.hand_left).toEqual(['T']);
  });
});

// ── Le rangement ─────────────────────────────────────────────────────────────
describe('rearrangeUnits — ce qui est rangé, et ce qui est jeté', () => {
  it('les unités au-delà du cap sont NOMMÉES dans dropped', () => {
    // 6 survivants pour 5 slots : `rearrangeUnits` en retire une du board sans
    // qu'elle meure ni passe au cimetière. Elle disparaissait en silence.
    const surv = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) =>
      makeCard({ id, summon_type: 'normal', stats: { hp: 10 + i } as any }));
    const r = run({
      cardDb: db(surv),
      survivors: surv.map((c, i) => ({ card_id: c.id, col: i % 5, row: 7 + Math.floor(i / 5) })),
      hand: [],
      slots: 5,
    });
    const re = r.events.find(e => e.kind === 'rearrange') as any;
    expect(re.before).toHaveLength(6);
    expect(re.after).toHaveLength(5);
    expect(re.dropped).toHaveLength(1);
    // Le tri range par range puis PV décroissants : le plus faible tombe.
    expect(re.dropped[0].card_id).toBe('A');
    expect(r.board_after).toHaveLength(5);
  });

  it('mêlée devant, distance derrière', () => {
    const melee = makeCard({ id: 'ML', summon_type: 'normal', stats: { range: 1 } as any });
    const ranged = makeCard({ id: 'RG', summon_type: 'normal', stats: { range: 4 } as any });
    const r = run({ cardDb: db([melee, ranged]), hand: ['ML', 'RG'] });
    const rows = Object.fromEntries(r.board_after.map(u => [u.card_id, u.row]));
    expect(rows.ML).toBe(7);
    expect(rows.RG).toBe(9);
  });
});

// ── Déterminisme et main imposée ─────────────────────────────────────────────
describe('Pioche — semée, et court-circuitable', () => {
  const cards = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(id => makeCard({ id, summon_type: 'normal' }));
  const deck = { 1: cards.map(c => c.id) };

  it('même graine ⇒ run rigoureusement identique, uid compris', () => {
    const a = run({ cardDb: db(cards), deck, hand: null, seed: 'graine-1' });
    const b = run({ cardDb: db(cards), deck, hand: null, seed: 'graine-1' });
    expect(a.hand).toEqual(b.hand);
    expect(a.hand_source).toBe('draw');
    // ⚠️ Le run ENTIER, pas seulement la main : c'est ce qui rend deux logs
    // du même scénario differ-ables. `Unit.uid` sort d'un compteur de module
    // et grandit sur toute la vie de l'onglet — sans la renumérotation locale
    // de `canonicaliseUids`, cette égalité est fausse (constaté).
    expect(a).toEqual(b);
  });

  it('les uid sont des index LOCAUX au run, pas le compteur global', () => {
    const r = run({ cardDb: db(cards), deck, hand: ['A', 'B'], seed: 's' });
    expect(r.board_after.map(u => u.uid).sort()).toEqual([0, 1]);
  });

  it('deux graines différentes ne donnent pas la même main', () => {
    const a = run({ cardDb: db(cards), deck, hand: null, seed: 'graine-1' });
    const b = run({ cardDb: db(cards), deck, hand: null, seed: 'graine-2' });
    expect(a.hand).not.toEqual(b.hand);
  });

  it('la graine tient compte du ROUND — deux rounds ne rejouent pas la même main', () => {
    const a = run({ cardDb: db(cards), deck, hand: null, seed: 's', round: 1 });
    const b = run({ cardDb: db(cards), deck, hand: null, seed: 's', round: 2 });
    expect(a.hand).not.toEqual(b.hand);
  });

  // ── La main s'accumule d'un round à l'autre ────────────────────────────────
  //
  // Ces cas pilotent `EnemyAI` directement : le pilote du labo construit une IA
  // NEUVE à chaque appel (chaque round y est décrit de bout en bout), la
  // rétention ne s'y observe donc pas. C'est bien l'instance qui la porte.
  describe('Rétention de la main entre les rounds', () => {
    // Une fusion dont les matériaux n'arrivent qu'après : le cas exact que
    // l'écrasement rendait injouable pour toujours.
    const n1 = makeCard({ id: 'N1', tier: 2, summon_type: 'normal' });
    const n2 = makeCard({ id: 'N2', tier: 2, summon_type: 'normal' });
    const fus = makeCard({ id: 'F', tier: 1, summon_type: 'fusion', cost: { materials: ['N1', 'N2'] } });
    const deckByTier = { 1: ['F'], 2: ['N1', 'N2'] };

    it('une carte non posée reste en main, et redevient jouable plus tard', () => {
      const board = makeBoard();
      const ai = new (EnemyAI as any)(deckByTier, db([n1, n2, fus]), 'enemy');

      // Round 1 : seul le tier 1 est tirable, la fusion sort et ne passe pas.
      ai.drawHand(1);
      expect(ai.getHand().map((c: any) => c.id)).toEqual(['F', 'F', 'F', 'F', 'F']);
      ai.placeFromHand(board, 5, []);
      expect(board.getLivingUnitsOnSide('enemy')).toHaveLength(0);
      // ⚠️ Cette rétention-CI marchait déjà : `placeFromHand` finit par
      // `this._hand = unplaced`. C'est le `drawHand` du round suivant qui
      // jetait le tout — d'où le cumul éprouvé par le cas d'à côté.
      expect(ai.getHand()).toHaveLength(5);

      // Round suivant, ses matériaux sont là (survivants ou pioche — peu
      // importe d'où ils viennent, c'est la RÉTENTION qu'on éprouve ici, et
      // les poser à la main la rend indépendante d'un tirage chanceux).
      spawn(board, n1, 'enemy', { col: 0, row: 7 });
      spawn(board, n2, 'enemy', { col: 1, row: 7 });

      // Aucune pioche : c'est bien la main RETENUE qui joue.
      ai.placeFromHand(board, 5, []);
      expect(board.getLivingUnitsOnSide('enemy').map((u: any) => u.card_id)).toEqual(['F']);
    });

    it('la main retenue se cumule avec la pioche du round suivant', () => {
      const ai = new (EnemyAI as any)(deckByTier, db([n1, n2, fus]), 'enemy');
      ai.drawHand(1);
      expect(ai.getHand()).toHaveLength(5);
      ai.drawHand(2);
      expect(ai.getHand()).toHaveLength(10);   // ⚠️ 5 avant le correctif
      ai.drawHand(3);
      expect(ai.getHand()).toHaveLength(15);
    });

    it('la pioche AJOUTE au lieu de remplacer, et la trace le dit', () => {
      const ai = new (EnemyAI as any)(deckByTier, db([n1, n2, fus]), 'enemy');
      ai.drawHand(1);
      const events: any[] = [];
      ai.drawHand(2, (e: any) => events.push(e));
      const draw = events.find(e => e.kind === 'draw');
      expect(draw.kept).toHaveLength(5);
      expect(draw.drawn).toHaveLength(5);
      expect(draw.hand).toEqual([...draw.kept, ...draw.drawn]);
    });

    it('un pool VIDE ne défausse pas la main', () => {
      // Deck sans tier 3+ : au round 5 le pool est vide. La main tenue doit
      // survivre — c'était le second point d'écrasement, et le plus silencieux.
      const ai = new (EnemyAI as any)({ 1: ['F'] }, db([n1, n2, fus]), 'enemy');
      ai.drawHand(1);
      expect(ai.getHand()).toHaveLength(5);
      const events: any[] = [];
      ai.drawHand(5, (e: any) => events.push(e));
      expect(ai.getHand()).toHaveLength(5);
      expect(events[0]).toMatchObject({ pool_size: 0, drawn: [] });
    });

    it('un pool vide ne consomme AUCUN tirage — le flux semé reste en phase', () => {
      // Deux IA sur le même flux : celle qui traverse un round vide doit
      // ensuite tirer exactement ce que l'autre tire.
      const mk = () => new (EnemyAI as any)({ 1: ['F'] }, db([n1, n2, fus]), 'enemy', seededRandom('phase'));
      const a = mk(); a.drawHand(5); a.setHand([]); a.drawHand(1);
      const b = mk(); b.drawHand(1);
      expect(a.getHand().map((c: any) => c.id)).toEqual(b.getHand().map((c: any) => c.id));
    });

    it('placeFromHand ne retient que ce qu\'il n\'a pas posé', () => {
      const board = makeBoard();
      const ai = new (EnemyAI as any)({ 1: ['N1'] }, db([n1]), 'enemy');
      ai.setHand([n1, n1, fus]);
      ai.placeFromHand(board, 5, []);
      // N1 posé une fois (règle du doublon), son doublon et la fusion retenus.
      expect(board.getLivingUnitsOnSide('enemy')).toHaveLength(1);
      expect(ai.getHand().map((c: any) => c.id).sort()).toEqual(['F', 'N1']);
    });
  });

  it('la pioche respecte les tiers du round', () => {
    const t1 = makeCard({ id: 'T1', tier: 1, summon_type: 'normal' });
    const t3 = makeCard({ id: 'T3', tier: 3, summon_type: 'normal' });
    const r = run({
      cardDb: db([t1, t3]), deck: { 1: ['T1'], 3: ['T3'] }, hand: null, round: 1, seed: 's',
    });
    const draw = r.events.find(e => e.kind === 'draw') as any;
    expect(draw.tiers).toEqual([1]);
    expect(r.hand.every(id => id === 'T1')).toBe(true);
  });

  it('une main imposée court-circuite la pioche', () => {
    const r = run({ cardDb: db(cards), deck, hand: ['A', 'B'], seed: 's' });
    expect(r.hand_source).toBe('manual');
    expect(r.hand).toEqual(['A', 'B']);
    expect(r.board_after.map(u => u.card_id).sort()).toEqual(['A', 'B']);
  });

  it('un deck vide rend une main vide plutôt que de jeter', () => {
    const r = run({ cardDb: db(cards), deck: {}, hand: null, seed: 's' });
    expect(r.hand).toEqual([]);
    expect(r.board_after).toEqual([]);
  });
});

// ── Handicap et robustesse d'entrée ──────────────────────────────────────────
describe('Handicap — le réglage de difficulté existant', () => {
  it('écrit dans _base et laisse _stat_bonuses intact', () => {
    const n = makeCard({ id: 'N', summon_type: 'normal', stats: { atk: 5, hp: 30 } as any });
    const r = run({ cardDb: db([n]), hand: ['N'], enemyBonus: { atk: 4, hp: 40 } });
    expect(r.board_after[0]).toMatchObject({ atk: 9, max_hp: 70 });
    expect(r.enemy_bonus).toEqual({ atk: 4, hp: 40 });
  });

  it('absent, il ne touche à rien', () => {
    const n = makeCard({ id: 'N', summon_type: 'normal', stats: { atk: 5, hp: 30 } as any });
    const r = run({ cardDb: db([n]), hand: ['N'] });
    expect(r.board_after[0]).toMatchObject({ atk: 5, max_hp: 30 });
  });
});

describe('Entrées douteuses — un run rejoué depuis un JSON édité à la main', () => {
  it('une carte inconnue est NOMMÉE au lieu de faire tomber le run', () => {
    const n = makeCard({ id: 'N', summon_type: 'normal' });
    const r = run({ cardDb: db([n]), hand: ['N', 'FANTOME'], graveyard: ['AUTRE'] });
    expect(r.unknown_cards.sort()).toEqual(['AUTRE', 'FANTOME']);
    expect(r.board_after.map(u => u.card_id)).toEqual(['N']);
  });

  it('un survivant hors de la zone de l\'IA est ignoré', () => {
    const n = makeCard({ id: 'N', summon_type: 'normal' });
    const r = run({ cardDb: db([n]), survivors: [{ card_id: 'N', col: 2, row: 0 }], hand: [] });
    expect(r.survivors_in).toEqual([]);
    expect(r.board_after).toEqual([]);
  });

  it('deux survivants sur la même case : le second est ignoré, pas fatal', () => {
    const a = makeCard({ id: 'A', summon_type: 'normal' });
    const b = makeCard({ id: 'B', summon_type: 'normal' });
    const r = run({
      cardDb: db([a, b]),
      survivors: [{ card_id: 'A', col: 2, row: 7 }, { card_id: 'B', col: 2, row: 7 }],
      hand: [],
    });
    expect(r.survivors_in.map(u => u.card_id)).toEqual(['A']);
  });
});

// ── L'enchaînement des rounds ────────────────────────────────────────────────
describe('Round par round — aucun état caché', () => {
  it('le board_after d\'un round devient les survivants du suivant', () => {
    const n = makeCard({ id: 'N', summon_type: 'normal' });
    const m = makeCard({ id: 'M', summon_type: 'normal' });
    const r1 = run({ cardDb: db([n, m]), hand: ['N'], round: 1 });
    const r2 = run({
      cardDb: db([n, m]), round: 2, hand: ['M'],
      survivors: r1.board_after.map(u => ({ card_id: u.card_id, col: u.col!, row: u.row! })),
    });
    expect(r2.survivors_in.map(u => u.card_id)).toEqual(['N']);
    expect(r2.board_after.map(u => u.card_id).sort()).toEqual(['M', 'N']);
  });
});

// ===========================================================================
//  Le décor spatial — l'invariant de peinture des écrans
// ===========================================================================
//
// Ce bloc n'est pas « à propos du Labo IA » : il défend TOUS les écrans. Il est
// ici parce que c'est le Labo IA qui a payé pour l'apprendre.
//
// `.space-bg` est `position: fixed; z-index: 0` avec un fond OPAQUE. Dans
// l'ordre de peinture CSS, un descendant positionné à `z-index: 0` passe APRÈS
// tous les descendants NON positionnés : le décor recouvre donc intégralement
// un écran dont la racine est statique. D'où l'invariant :
//
//     un écran est SOIT dans IMMERSIVE_SCREENS (le décor n'est pas monté),
//     SOIT sa racine porte `relative z-10` (il passe au-dessus).
//
// ⚠️ Ce test existe parce que RIEN d'autre ne peut l'attraper. La suite tourne
// en node sans jsdom — aucun test de composant n'est possible — et le symptôme
// est invisible à toute inspection du DOM : `innerText` rend le texte, les
// boîtes ont leurs vraies dimensions, `scrollWidth <= clientWidth` passe, et
// `.space-bg` étant `pointer-events: none`, même le test de survol touche le bon
// élément. L'écran est parfaitement mesurable, parfaitement tapable, et
// parfaitement invisible. Seul un contrôle des PIXELS le voit — ou celui-ci.
describe('Décor spatial — l\'invariant de peinture des écrans', () => {
  const appSrc = fs.readFileSync(path.join(SRC, 'app/App.tsx'), 'utf8');

  /** Les noms d'écran du registre, appariés à leur composant. */
  const screenToComponent = new Map<string, string>();
  for (const [, screen, component] of appSrc
    .slice(appSrc.indexOf('const SCREENS'), appSrc.indexOf('};', appSrc.indexOf('const SCREENS')))
    .matchAll(/^\s*(\w+):\s*(\w+),/gm)) {
    screenToComponent.set(screen, component);
  }

  /** Le composant, apparié à son fichier source — import statique ou `lazy()`. */
  const componentToFile = new Map<string, string>();
  for (const [, component, file] of appSrc.matchAll(/^import\s+(\w+)\s+from\s+'\.\.\/(.+?)\.js';/gm)) {
    componentToFile.set(component, file);
  }
  for (const [, component, file] of appSrc.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\('\.\.\/(.+?)\.js'\)\)/g)) {
    componentToFile.set(component, file);
  }

  const immersive = new Set(
    (appSrc.match(/const IMMERSIVE_SCREENS = new Set<ScreenName>\(\[(.*?)\]\)/s)?.[1] ?? '')
      .split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean),
  );

  it('le registre et les imports se résolvent — sinon le test passerait à vide', () => {
    expect(screenToComponent.size).toBeGreaterThanOrEqual(19);
    expect(immersive.size).toBeGreaterThanOrEqual(4);
    for (const [screen, component] of screenToComponent) {
      expect(componentToFile.get(component), `fichier introuvable pour l'écran « ${screen} »`)
        .toBeTruthy();
    }
  });

  it('chaque écran est SOIT immersif, SOIT posé en z-10 au-dessus du décor', () => {
    const coupables: string[] = [];
    for (const [screen, component] of screenToComponent) {
      if (immersive.has(screen)) continue;
      const src = fs.readFileSync(path.join(SRC, `${componentToFile.get(component)}.tsx`), 'utf8');
      if (!/\bz-10\b/.test(src)) coupables.push(`${screen} (${componentToFile.get(component)}.tsx)`);
    }
    // Le message porte la raison : un futur lecteur ne doit pas avoir à
    // retrouver l'ordre de peinture CSS tout seul.
    expect(
      coupables,
      `Écrans peints SOUS le décor spatial (racine sans « relative z-10 », et absents de `
      + `IMMERSIVE_SCREENS) : ${coupables.join(', ')}. Ils s'afficheront VIDES.`,
    ).toEqual([]);
  });

  it('les écrans immersifs, eux, n\'ont pas besoin de z-10 — ils possèdent leur fond', () => {
    // Le pendant : la liste ne doit pas se remplir d'écrans ordinaires, sans quoi
    // l'invariant se viderait de son sens en désactivant le décor partout.
    for (const screen of immersive) {
      expect(screenToComponent.has(screen), `« ${screen} » n'est pas un écran connu`).toBe(true);
      const src = fs.readFileSync(
        path.join(SRC, `${componentToFile.get(screenToComponent.get(screen)!)}.tsx`), 'utf8');
      // Ils posent tous leur propre fond plein cadre — c'est le critère du set.
      expect(src, `« ${screen} » est immersif mais ne peint aucun fond plein cadre`)
        .toMatch(/h-dvh[^"'`]*bg-|bg-[^"'`]*h-dvh/);
    }
  });
});
