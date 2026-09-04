/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { resolveGuaranteedDraws } from '../logic/Draw.js';
import { makeCard } from './helpers.js';

// Partagée par GameSession.startPreparation (joueur) et EnemyAI.drawHand
// (ennemi) — le refactor doit rendre exactement ce que l'inline d'avant
// rendait : mêmes filtres, même ordre de repli, un `rand()` par entrée
// honorée (zéro pour une entrée impossible sur un pool vide).
describe('Draw.resolveGuaranteedDraws', () => {
  it('un tier et un attribut qui matchent piochent dedans', () => {
    const pool = [
      makeCard({ id: 'A', tier: 2, summon_conditions: [{ materials: 0 }], attributes: ['ARCH_X'] }),
      makeCard({ id: 'B', tier: 3, summon_conditions: [], attributes: [] })
    ];
    const rand = () => 0; // premier élément filtré
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 2, attribute: 'ARCH_X' }], rand);
    expect(drawn.map(c => c.id)).toEqual(['A']);
  });

  it('sans correspondance exacte, repli SANS le tier', () => {
    const pool = [
      makeCard({ id: 'A', tier: 5, summon_conditions: [{ materials: 0 }], attributes: [] })
    ];
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 1 }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['A']);
  });

  it('sans aucune correspondance, repli sur tout le pool', () => {
    const pool = [makeCard({ id: 'A', tier: 1, summon_conditions: [], attributes: [] })];
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 5, attribute: 'ARCH_NOPE' }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['A']);
  });

  it('pool vide : aucune carte, aucun appel à rand', () => {
    let calls = 0;
    const drawn = resolveGuaranteedDraws([], [{ tier: 1 }], () => { calls++; return 0; });
    expect(drawn).toEqual([]);
    expect(calls).toBe(0);
  });

  it('une entrée par pioche garantie, dans l\'ordre', () => {
    const pool = [makeCard({ id: 'A', tier: 1, summon_conditions: [], attributes: [] })];
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 1 }, { tier: 1 }, { tier: 1 }], () => 0);
    expect(drawn).toHaveLength(3);
  });

  it('rend des CLONES — deux tirages de la même carte sont des objets distincts', () => {
    const pool = [makeCard({ id: 'A', tier: 1, summon_conditions: [], attributes: [] })];
    const [a, b] = resolveGuaranteedDraws(pool as any, [{ tier: 1 }, { tier: 1 }], () => 0);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
