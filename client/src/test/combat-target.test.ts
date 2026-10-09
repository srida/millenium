/* eslint-disable @typescript-eslint/no-explicit-any */
// `Unit.combat_target_uid` : la cible qu'une unité poursuit ou frappe, montrée
// au tap en combat (`Scene3D.setCombatFocus`). Affichage seulement.
import { describe, it, expect } from 'vitest';
import { CombatManager } from '../logic/CombatManager.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

const stats = { atk: 1, hp: 500, attack_rate: 100, movement_rate: 100, range: 1 };

describe('Cible courante d\'une unité en combat', () => {
  it('une unité qui marche vise l\'ennemi qu\'elle poursuit', () => {
    const board = makeBoard();
    const p = spawn(board, makeCard({ id: 'P', stats }), 'player', { col: 2, row: 2 });
    const near = spawn(board, makeCard({ id: 'E_NEAR', stats }), 'enemy', { col: 2, row: 6 });
    spawn(board, makeCard({ id: 'E_FAR', stats }), 'enemy', { col: 0, row: 10 });
    const combat = new (CombatManager as any)(board, [p], board.getLivingUnitsOnSide('enemy'), null);
    expect(p.combat_target_uid).toBeNull();
    for (let i = 0; i < 3; i++) combat.step();
    expect(p.combat_target_uid).toBe(near.uid);
  });

  it('une unité Tour, qui ne marche pas, vise l\'ennemi qu\'elle frappe', () => {
    const board = makeBoard();
    const p = spawn(board, makeCard({ id: 'P', stats: { ...stats, range: 14 } }), 'player', { col: 2, row: 2 });
    p.is_immobile = true;
    const e = spawn(board, makeCard({ id: 'E', stats }), 'enemy', { col: 4, row: 9 });
    const combat = new (CombatManager as any)(board, [p], [e], null);
    for (let i = 0; i < 3; i++) combat.step();
    expect(p.combat_target_uid).toBe(e.uid);
  });

  it('remise à zéro au début de chaque combat', () => {
    const board = makeBoard();
    const p = spawn(board, makeCard({ id: 'P', stats }), 'player', { col: 2, row: 2 });
    p.combat_target_uid = 42;
    p.resetCombatClocks();
    expect(p.combat_target_uid).toBeNull();
  });
});
