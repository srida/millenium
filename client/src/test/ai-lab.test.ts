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
import { runAiPlacement, refusalCounts, placedCount } from '../dev/aiLabRun.js';
import type { AiLabInput, AiTraceEvent } from '../dev/aiLabRun.js';
import { EnemyAI } from '../logic/EnemyAI.js';
import { makeCard, makeBoard } from './helpers.js';

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
