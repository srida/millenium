/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { resolveGuaranteedDraws } from '../logic/Draw.js';
import { makeCard } from './helpers.js';

// Partagée par GameSession.startPreparation (joueur) et EnemyAI.drawHand
// (ennemi) — le refactor doit rendre exactement ce que l'inline d'avant
// rendait : mêmes filtres, même ordre de repli, un `rand()` par entrée
// honorée (zéro pour une entrée impossible sur un pool vide).
describe('Draw.resolveGuaranteedDraws', () => {
  it('un tier/attribut/catégorie qui matchent piochent dedans', () => {
    const pool = [
      makeCard({ id: 'A', tier: 2, summon_type: 'fusion', attributes: ['ARCH_X'] }),
      makeCard({ id: 'B', tier: 3, summon_type: 'normal', attributes: [] }),
    ];
    const rand = () => 0; // premier élément filtré
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 2, category: 'fusion', attribute: 'ARCH_X' }], rand);
    expect(drawn.map(c => c.id)).toEqual(['A']);
  });

  it('sans correspondance exacte, repli SANS le tier', () => {
    const pool = [
      makeCard({ id: 'A', tier: 5, summon_type: 'fusion', attributes: [] }),
    ];
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 1, category: 'fusion' }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['A']);
  });

  it('sans aucune correspondance, repli sur tout le pool', () => {
    const pool = [makeCard({ id: 'A', tier: 1, summon_type: 'normal', attributes: [] })];
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 5, category: 'fusion', attribute: 'ARCH_NOPE' }], () => 0);
    expect(drawn.map(c => c.id)).toEqual(['A']);
  });

  it('pool vide : aucune carte, aucun appel à rand', () => {
    let calls = 0;
    const drawn = resolveGuaranteedDraws([], [{ tier: 1 }], () => { calls++; return 0; });
    expect(drawn).toEqual([]);
    expect(calls).toBe(0);
  });

  it('une entrée par pioche garantie, dans l\'ordre', () => {
    const pool = [makeCard({ id: 'A', tier: 1, summon_type: 'normal', attributes: [] })];
    const drawn = resolveGuaranteedDraws(pool as any, [{ tier: 1 }, { tier: 1 }, { tier: 1 }], () => 0);
    expect(drawn).toHaveLength(3);
  });

  it('rend des CLONES — deux tirages de la même carte sont des objets distincts', () => {
    const pool = [makeCard({ id: 'A', tier: 1, summon_type: 'normal', attributes: [] })];
    const [a, b] = resolveGuaranteedDraws(pool as any, [{ tier: 1 }, { tier: 1 }], () => 0);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
