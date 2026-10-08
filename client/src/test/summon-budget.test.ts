/* eslint-disable @typescript-eslint/no-explicit-any */
// Le budget d'invocation (« énergie ») : 3, 5, 8, 13, 21 par tour, une carte
// coûte son tier, et les deux camps jouent avec la même règle.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { EnemyAI } from '../logic/EnemyAI.js';
import { Board } from '../logic/Board.js';
import { SUMMON_BUDGET, budgetForRound, energyCost } from '../logic/SummonBudget.js';
import { makeCard } from './helpers.js';

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

  it('« Tout annuler » rend l\'énergie, le tour suivant repart à plein', () => {
    const a = makeCard({ id: 'A', tier: 2 });
    const session = makeSession([a]);
    session.hand = [{ ...a }] as any;
    session.startPreparation();
    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    expect(session.energyLeft()).toBe(1);
    expect(session.undoPreparation()).toBe(true);
    expect(session.energyLeft()).toBe(3);

    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    session.gameState.round = 2;
    session.startPreparation();
    expect(session.energyLeft()).toBe(5);
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

  it('sans budget, le comportement d\'avant', () => {
    const cards = ['X', 'Y', 'Z'].map(id => makeCard({ id, tier: 2, summon_conditions: [] }));
    const byId = new Map(cards.map(c => [c.id, c]));
    const ai = new (EnemyAI as any)({}, { getCard: (id: string) => byId.get(id) ?? null });
    ai._hand = cards.map(c => ({ ...c }));
    expect(ai.placeFromHand(new Board(), 5, [])).toHaveLength(3);
  });
});
