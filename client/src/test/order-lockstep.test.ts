/* eslint-disable @typescript-eslint/no-explicit-any */
// Le lockstep des ordres de ciblage (`game/orderLockstep`) : deux clients qui
// avancent à des rythmes différents, avec un réseau qui retarde les messages,
// et qui donnent des ordres n'importe quand, doivent jouer le MÊME combat.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import { MIRROR_AXIS } from '../logic/BoardMirror.js';
import { Unit } from '../logic/Unit.js';
import { makeRandom } from '../logic/Random.js';
import { ORDER_DELAY_TICKS } from '../logic/CombatManager.js';
import { OrderLockstep, ORDERS_SEND_EVERY, type OrdersMessage } from '../game/orderLockstep.js';
import { makeCard } from './helpers.js';

describe('OrderLockstep — la frontière', () => {
  const sink = () => {
    const got: any[] = [];
    return { got, addOrder: (o: any) => { got.push(o); return true; } };
  };

  it('aucun tick n\'est jouable avant la première frontière adverse', () => {
    const lock = new OrderLockstep(1, ORDER_DELAY_TICKS, sink());
    expect(lock.canStep(1)).toBe(false);
    lock.receive({ round: 1, upTo: ORDER_DELAY_TICKS - 1, orders: [] });
    expect(lock.canStep(ORDER_DELAY_TICKS - 1)).toBe(true);
    expect(lock.canStep(ORDER_DELAY_TICKS)).toBe(false);
  });

  it('la frontière promise couvre le délai, et part tous les N ticks', () => {
    const lock = new OrderLockstep(1, ORDER_DELAY_TICKS, sink());
    expect(lock.afterStep(0)?.upTo).toBe(ORDER_DELAY_TICKS - 1);
    expect(lock.afterStep(1)).toBeNull();
    expect(lock.afterStep(ORDERS_SEND_EVERY)?.upTo).toBe(ORDERS_SEND_EVERY + ORDER_DELAY_TICKS - 1);
  });

  it('les ordres adverses arrivent au moteur côté `enemy`, ceux d\'un autre round sont ignorés', () => {
    const s = sink();
    const lock = new OrderLockstep(2, ORDER_DELAY_TICKS, s);
    lock.receive({ round: 1, upTo: 50, orders: [{ tick: 9, unitRef: 1, targetRef: 2, seq: 0 }] });
    expect(s.got).toEqual([]);
    expect(lock.canStep(1)).toBe(false);
    lock.receive({ round: 2, upTo: 8, orders: [{ tick: 9, unitRef: 1, targetRef: 2, seq: 0 }] });
    expect(s.got).toEqual([{ tick: 9, side: 'enemy', unitRef: 1, targetRef: 2, seq: 0 }]);
  });
});

// ===========================================================================
//  Deux clients, un réseau lent, des ordres au hasard : le même combat
// ===========================================================================

interface Placed { card: any; col: number; row: number }

function scenario(seed: number): { a: Placed[]; b: Placed[] } {
  const rand = makeRandom(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const taken = new Set<string>();
  const place = (side: 'A' | 'B', i: number): Placed => {
    let col = 0, row = 0;
    do {
      col = Math.floor(rand() * 5);
      row = (side === 'A' ? 0 : 7) + Math.floor(rand() * 4);
    } while (taken.has(`${col},${row}`));
    taken.add(`${col},${row}`);
    return {
      col, row,
      card: makeCard({
        id: `${side}_${i}`, summon_conditions: [],
        stats: {
          atk: pick([6, 9, 14]), hp: pick([60, 90, 130]),
          movement_rate: pick([100, 99, 98]), attack_rate: pick([99, 96, 92]), range: pick([1, 2, 3]),
        },
      }),
    };
  };
  return { a: Array.from({ length: 4 }, (_, i) => place('A', i)), b: Array.from({ length: 4 }, (_, i) => place('B', i)) };
}

function client(role: 'A' | 'B', a: Placed[], b: Placed[]) {
  const mirrored = role === 'B';
  const localRow = (row: number) => (mirrored ? MIRROR_AXIS - row : row);
  const byId = new Map([...a, ...b].map(p => [p.card.id, p.card]));
  const s = new GameSession({
    cardsByTier: { 1: [] }, enemyDeck: { 1: [] }, attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [], getAllMagies: () => [], mode: 'pvp', mirroredRole: mirrored,
  } as any);
  s.startPreparation();
  for (const p of mirrored ? b : a) s.board.placeUnit(new (Unit as any)(p.card, 'player'), { col: p.col, row: localRow(p.row) });
  for (const p of mirrored ? a : b) s.board.placeUnit(new (Unit as any)(p.card, 'enemy'), { col: p.col, row: localRow(p.row) });
  const { combat } = s.startCombat(null);
  const lock = new OrderLockstep(1, ORDER_DELAY_TICKS, combat);
  // Un instantané canonique par tick : qui (rôle + carte), où (rangée de A), combien de PV.
  const trace: string[] = [];
  const snap = () => [...combat.playerUnits, ...combat.enemyUnits]
    .map((u: any) => `${u.side === 'player' ? role : role === 'A' ? 'B' : 'A'}:${u.card_id}@${u.position?.col},${u.position ? localRow(u.position.row) : '-'}:${u.current_hp}`)
    .sort().join('|');
  return { combat, lock, trace, snap };
}

function duel(seed: number) {
  const { a, b } = scenario(seed);
  const rand = makeRandom(seed * 104729);
  const A = client('A', a, b);
  const B = client('B', a, b);
  // Deux canaux FIFO, à latence variable.
  const wire: Record<'A' | 'B', { at: number; msg: OrdersMessage }[]> = { A: [], B: [] };
  const lastAt = { A: 0, B: 0 };
  const post = (to: 'A' | 'B', now: number, msg: OrdersMessage | null) => {
    if (!msg) return;
    lastAt[to] = Math.max(lastAt[to], now + Math.floor(rand() * 8));
    wire[to].push({ at: lastAt[to], msg: JSON.parse(JSON.stringify(msg)) });
  };
  post('B', 0, A.lock.afterStep(0));
  post('A', 0, B.lock.afterStep(0));
  let orders = 0;
  for (let now = 0; now < 50_000 && !(A.combat.isOver && B.combat.isOver); now++) {
    for (const [me, other, name, otherName] of [[A, B, 'A', 'B'], [B, A, 'B', 'A']] as const) {
      while (wire[name].length && wire[name][0].at <= now) me.lock.receive(wire[name].shift()!.msg);
      if (me.combat.isOver) continue;
      // Un ordre de temps en temps, d'une unité vivante vers un ennemi vivant.
      if (rand() < 0.04) {
        const mine = me.combat.playerUnits.filter((u: any) => u.isAlive());
        const theirs = me.combat.enemyUnits.filter((u: any) => u.isAlive());
        if (mine.length && theirs.length) {
          const order = {
            tick: me.combat.currentTick() + ORDER_DELAY_TICKS,
            unitRef: mine[Math.floor(rand() * mine.length)].combat_ref,
            targetRef: theirs[Math.floor(rand() * theirs.length)].combat_ref,
            seq: orders++,
          };
          expect(me.combat.addOrder({ ...order, side: 'player' })).toBe(true);
          post(otherName, now, me.lock.localOrder(me.combat.currentTick(), order));
        }
      }
      // Rythmes différents : chacun ne tente un tick qu'une fois sur deux ou trois.
      if (rand() < (name === 'A' ? 0.5 : 0.35) && me.lock.canStep(me.combat.currentTick() + 1)) {
        me.combat.step();
        me.trace.push(me.snap());
        post(otherName, now, me.lock.afterStep(me.combat.currentTick()));
      }
      void other;
    }
  }
  return { A, B, orders };
}

describe('OrderLockstep — deux clients désynchronisés jouent le même combat', () => {
  it('60 duels semés, latence et rythmes variables, ordres au hasard', () => {
    const divergents: number[] = [];
    let totalOrders = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { A, B, orders } = duel(seed);
      totalOrders += orders;
      expect(A.combat.isOver && B.combat.isOver).toBe(true);
      expect(A.lock.rejected + B.lock.rejected).toBe(0);
      if (JSON.stringify(A.trace) !== JSON.stringify(B.trace)) divergents.push(seed);
    }
    expect(divergents).toEqual([]);
    expect(totalOrders).toBeGreaterThan(100);
  });
});
