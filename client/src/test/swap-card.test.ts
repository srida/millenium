/* eslint-disable @typescript-eslint/no-explicit-any */
// L'échangeur de carte (`swap_card`) : une carte de la main contre une carte
// du pool de pioche du tour, jamais contre elle-même.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { isMagieRelevant } from '../logic/MagieOffer.js';
import { needsHandTarget } from '../logic/MagieEffect.js';
import { makeCard } from './helpers.js';

const SWAP = { id: 'SWAP', name: 'Échangeur', rarity: 1, effect: { type: 'swap_card' } } as any;

function makeSession(cardsByTier: Record<number, any[]>, rand: () => number = () => 0): GameSession {
  const all = Object.values(cardsByTier).flat();
  const byId = new Map(all.map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier,
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => [],
    rand,
  } as any;
  return new GameSession(deps);
}

describe('Échangeur de carte', () => {
  it('se désigne sur une carte de la main', () => {
    expect(needsHandTarget(SWAP)).toBe(true);
  });

  it('remplace la carte par une AUTRE carte du pool du tour, en un seul tirage', () => {
    const a = makeCard({ id: 'A', tier: 1 });
    const b = makeCard({ id: 'B', tier: 1 });
    const t3 = makeCard({ id: 'HAUT', tier: 3 });
    let calls = 0;
    const session = makeSession({ 1: [a, b], 3: [t3] }, () => { calls++; return 0; });
    session.hand = [{ ...a }] as any;

    expect(session.magieHandTargets(SWAP)).toEqual([0]);
    calls = 0;
    session.applyMagieOnHandCard(SWAP, 0);
    // Tour 1 : le pool est le Tier 1, moins A — il ne reste que B.
    expect(session.hand.map(c => c.id)).toEqual(['B']);
    expect(calls).toBe(1);
  });

  it('une carte seule dans le pool du tour n\'est pas une cible, et la magie n\'est pas offerte', () => {
    const a = makeCard({ id: 'A', tier: 1 });
    const session = makeSession({ 1: [a] });
    session.hand = [{ ...a }] as any;
    expect(session.magieHandTargets(SWAP)).toEqual([]);
    expect((session as any)._offerContext().swapTargetCount).toBe(0);
    expect(isMagieRelevant(SWAP, (session as any)._offerContext())).toBe(false);
    expect(session.applyMagieOnHandCard(SWAP, 0)).toBeNull();
    expect(session.hand.map(c => c.id)).toEqual(['A']);
  });
});
