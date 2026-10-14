/* eslint-disable @typescript-eslint/no-explicit-any */
// Règle générale : une cible qu'une attaque simple achève ne coûte pas une
// jauge — l'unité frappe et GARDE son pouvoir (CombatManager._tryFirePower).
import { describe, it, expect } from 'vitest';
import { makeBoard, makeCard, spawn } from './helpers.js';
import { CombatManager } from '../logic/CombatManager.js';

function duel(targetHp: number, shield = 0) {
  const board = makeBoard();
  const caster = spawn(board, makeCard({
    id: 'P_CASTER', power: { id: 'POWER_SUPER_ATTACK', power_rate: 100 },
    stats: { atk: 10, hp: 200, attack_rate: 100, movement_rate: 100, range: 3 },
  }), 'player', { col: 2, row: 3 });
  const target = spawn(board, makeCard({
    id: 'E_TARGET', stats: { atk: 0, hp: 500, attack_rate: 0, movement_rate: 0, range: 1 },
  }), 'enemy', { col: 2, row: 5 });
  target.current_hp = targetHp;
  target.shield = shield;
  caster.power_gauge = 999; // jauge pleine
  const combat = new (CombatManager as any)(board, [caster], [target], null);
  const events: any[] = [];
  for (let i = 0; i < 4 && events.every(e => e.type !== 'attack' && e.type !== 'power'); i++) events.push(...combat.step());
  return { caster, events };
}

describe('pas de pouvoir sur une cible à une attaque de mourir', () => {
  it('cible achevable : attaque simple, jauge gardée', () => {
    const { caster, events } = duel(10);
    expect(events.some(e => e.type === 'power')).toBe(false);
    expect(events.some(e => e.type === 'attack')).toBe(true);
    expect(caster.power_gauge).toBeGreaterThan(0);
  });

  it('le bouclier compte : 6 PV + 5 de bouclier survivent à 10 d\'ATQ, le pouvoir part', () => {
    const { events } = duel(6, 5);
    expect(events.some(e => e.type === 'power')).toBe(true);
  });

  it('cible qui survivrait au coup : le pouvoir part', () => {
    const { events } = duel(11);
    expect(events.some(e => e.type === 'power')).toBe(true);
  });
});
