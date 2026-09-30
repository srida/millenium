/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { makeBoard, makeCard, spawn, runCombat } from './helpers.js';

describe('Insaisissable — le pouvoir prime sur l\'attaque simple', () => {
  it('lance son pouvoir prêt dans la fenêtre du rechargement de mouvement', () => {
    const board = makeBoard();
    const elusive = spawn(board, makeCard({
      id: 'ELU_1',
      stats: { atk: 5, hp: 500, movement_rate: 100, attack_rate: 0, range: 4 },
      power: { id: 'POWER_SUPER_ATTACK', power_rate: 100 },
    }), 'player', { col: 2, row: 3 });
    elusive.is_elusive = true;
    const foe = spawn(board, makeCard({
      id: 'FOE_1',
      stats: { atk: 1, hp: 500, movement_rate: 0, attack_rate: 0, range: 1 },
    }), 'enemy', { col: 2, row: 5 });

    const { events } = runCombat(board, [elusive], [foe], null, 30);
    const first = events.find(e => e.type === 'power' || e.type === 'attack');
    expect(first?.type).toBe('power');
  });
});
