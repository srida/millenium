/* eslint-disable @typescript-eslint/no-explicit-any */
// Le budget d'invocation (« énergie ») : 3, 5, 8, 13, 21 par tour, un PLAFOND
// DE PLATEAU — chaque unité vivante occupe son tier, survivantes comprises, les
// matériaux pris sur le plateau rendent le leur. Les deux camps, même règle.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { EnemyAI } from '../logic/EnemyAI.js';
import { Board } from '../logic/Board.js';
import { SUMMON_BUDGET, budgetForRound, energyCost } from '../logic/SummonBudget.js';
import { makeCard, spawn } from './helpers.js';

function makeSession(cards: any[] = []): GameSession {
  const byId = new Map(cards.map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [] },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => [] };
  return new GameSession(deps);
}

describe('SummonBudget', () => {
  it('le budget suit la table, et le dernier palier au-delà', () => {
    expect([1, 2, 3, 4, 5].map(budgetForRound)).toEqual([3, 5, 8, 13, 21]);
    expect(budgetForRound(9)).toBe(SUMMON_BUDGET[SUMMON_BUDGET.length - 1]);
  });

  it('une carte coûte son tier, le plus bas pour une carte multi-tiers', () => {
    expect(energyCost(makeCard({ id: 'T3', tier: 3 }) as any)).toBe(3);
    expect(energyCost({ ...makeCard({ id: 'M' }), _tiers: [2, 4] } as any)).toBe(2);
  });
});

describe('GameSession — budget du joueur', () => {
  it('refuse une invocation que le budget ne couvre plus, et le dit', () => {
    const a = makeCard({ id: 'A', tier: 2 });
    const b = makeCard({ id: 'B', tier: 2 });
    const session = makeSession([a, b]);
    session.hand = [{ ...a }, { ...b }] as any;
    session.startPreparation();
    expect(session.energyLeft()).toBe(3);

    expect(session.place(session.hand[0], { col: 0, row: 0 }, [], 0)).not.toBeNull();
    expect(session.energyLeft()).toBe(1);
    expect(session.isPlayable(session.hand[0])).toBe(false);
    const verdict = session.canSummon(session.hand[0], { col: 1, row: 0 }, []);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/Énergie insuffisante/);
    expect(session.place(session.hand[0], { col: 1, row: 0 }, [], 0)).toBeNull();
    expect(session.getPlayerUnits()).toHaveLength(1);
  });

  it('« Tout annuler » rend l\'énergie : elle se lit sur le plateau', () => {
    const a = makeCard({ id: 'A', tier: 2 });
    const session = makeSession([a]);
    session.hand = [{ ...a }] as any;
    session.startPreparation();
    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    expect(session.energyLeft()).toBe(1);
    expect(session.undoPreparation()).toBe(true);
    expect(session.energyLeft()).toBe(3);
  });

  it('les survivantes du tour d\'avant occupent le budget du tour suivant', () => {
    const a = makeCard({ id: 'A', tier: 2 });
    const session = makeSession([a]);
    session.hand = [{ ...a }] as any;
    session.startPreparation();
    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    session.gameState.round = 2;
    session.startPreparation();
    expect(session.energyUsed()).toBe(2);
    expect(session.energyLeft()).toBe(3);
  });

  it('les matériaux pris sur le plateau rendent leur coût', () => {
    const n = makeCard({ id: 'N', tier: 1 });
    const m = makeCard({ id: 'M', tier: 1 });
    const f = makeCard({ id: 'F', tier: 3, summon_conditions: [{ materials: 2 }] });
    const session = makeSession([n, m, f]);
    session.hand = [{ ...f }] as any;
    session.startPreparation();
    const u1 = spawn(session.board, n, 'player', { col: 0, row: 0 });
    const u2 = spawn(session.board, m, 'player', { col: 1, row: 0 });
    // Plateau à 2 sur 3 : le Tier 3 seul ne tiendrait pas, mais il remplace les deux.
    expect(session.energyLeft()).toBe(1);
    expect(session.isPlayable(session.hand[0])).toBe(true);
    expect(session.canSummon(session.hand[0], { col: 0, row: 0 }, [u1, u2]).ok).toBe(true);
    expect(session.place(session.hand[0], { col: 0, row: 0 }, [u1, u2], 0)).not.toBeNull();
    expect(session.energyUsed()).toBe(3);
  });

  it('un seul matériau ne rend pas assez : refus nommé', () => {
    const n = makeCard({ id: 'N', tier: 1 });
    const m = makeCard({ id: 'M', tier: 1 });
    const f = makeCard({ id: 'F', tier: 3, summon_conditions: [{ materials: 1 }] });
    const session = makeSession([n, m, f]);
    session.hand = [{ ...f }] as any;
    session.startPreparation();
    const u1 = spawn(session.board, n, 'player', { col: 0, row: 0 });
    spawn(session.board, m, 'player', { col: 1, row: 0 });
    const verdict = session.canSummon(session.hand[0], { col: 0, row: 0 }, [u1]);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/Énergie insuffisante/);
  });
});

describe('EnemyAI — budget de l\'IA', () => {
  it('l\'IA ne pose pas au-delà de son budget, et le refus porte son motif', () => {
    const cards = ['X', 'Y', 'Z'].map(id => makeCard({ id, tier: 2, summon_conditions: [] }));
    const byId = new Map(cards.map(c => [c.id, c]));
    const ai = new (EnemyAI as any)({}, { getCard: (id: string) => byId.get(id) ?? null });
    ai._hand = cards.map(c => ({ ...c }));
    const events: any[] = [];
    const placed = ai.placeFromHand(new Board(), 5, [], (e: any) => events.push(e), null, 5);
    expect(placed).toHaveLength(2);
    expect(events.some(e => e.kind === 'attempt' && e.reason === 'over_budget')).toBe(true);
  });

  it('les unités déjà posées de l\'IA occupent son budget', () => {
    const cards = ['X', 'Y'].map(id => makeCard({ id, tier: 2, summon_conditions: [] }));
    const old = makeCard({ id: 'OLD', tier: 2 });
    const byId = new Map([...cards, old].map(c => [c.id, c]));
    const ai = new (EnemyAI as any)({}, { getCard: (id: string) => byId.get(id) ?? null });
    ai._hand = cards.map(c => ({ ...c }));
    const board = new Board();
    spawn(board, old, 'enemy', { col: 0, row: 7 });
    expect(ai.placeFromHand(board, 5, [], null, null, 5)).toHaveLength(1);
  });

  it('sans budget, le comportement d\'avant', () => {
    const cards = ['X', 'Y', 'Z'].map(id => makeCard({ id, tier: 2, summon_conditions: [] }));
    const byId = new Map(cards.map(c => [c.id, c]));
    const ai = new (EnemyAI as any)({}, { getCard: (id: string) => byId.get(id) ?? null });
    ai._hand = cards.map(c => ({ ...c }));
    expect(ai.placeFromHand(new Board(), 5, [])).toHaveLength(3);
  });
});
