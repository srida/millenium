/* eslint-disable @typescript-eslint/no-explicit-any */
// Ordres de ciblage : le joueur désigne en combat l'ennemi qu'une de ses unités
// doit viser (`CombatManager.addOrder`). Provocation et confusion passent devant,
// l'ordre tombe à la mort de la cible.
import { describe, it, expect } from 'vitest';
import { CombatManager, ORDER_DELAY_TICKS } from '../logic/CombatManager.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

const stats = { atk: 1, hp: 500, attack_rate: 100, movement_rate: 100, range: 1 };

function setup() {
  const board = makeBoard();
  const p = spawn(board, makeCard({ id: 'P', stats }), 'player', { col: 2, row: 2 });
  const near = spawn(board, makeCard({ id: 'E_NEAR', stats }), 'enemy', { col: 2, row: 6 });
  const far = spawn(board, makeCard({ id: 'E_FAR', stats }), 'enemy', { col: 0, row: 10 });
  const combat = new (CombatManager as any)(board, [p], [near, far], null);
  return { board, p, near, far, combat };
}

describe('Ordres de ciblage', () => {
  it('chaque unité reçoit une référence de combat, la case de départ', () => {
    const { p, near, far } = setup();
    const refs = [p.combat_ref, near.combat_ref, far.combat_ref];
    expect(new Set(refs).size).toBe(3);
    expect(refs.every(r => r >= 0)).toBe(true);
  });

  it('sans ordre l\'unité poursuit le plus proche, avec un ordre elle poursuit la cible désignée', () => {
    const a = setup();
    for (let i = 0; i < 3; i++) a.combat.step();
    expect(a.p.combat_target_uid).toBe(a.near.uid);

    const b = setup();
    expect(b.combat.addOrder({ tick: 1, side: 'player', unitRef: b.p.combat_ref, targetRef: b.far.combat_ref })).toBe(true);
    for (let i = 0; i < 3; i++) b.combat.step();
    expect(b.p.ordered_target).toBe(b.far);
    expect(b.p.combat_target_uid).toBe(b.far.uid);
    // Elle s'est écartée de sa colonne pour aller vers la cible du coin.
    expect(b.p.position.col).toBeLessThan(2);
  });

  it('l\'ordre ne s\'applique qu\'à son tick', () => {
    const { combat, p, far } = setup();
    combat.addOrder({ tick: 3, side: 'player', unitRef: p.combat_ref, targetRef: far.combat_ref });
    combat.step(); combat.step();
    expect(p.ordered_target).toBeNull();
    combat.step();
    expect(p.ordered_target).toBe(far);
  });

  it('un ordre pour un tick déjà joué est refusé', () => {
    const { combat, p, far } = setup();
    combat.step(); combat.step();
    expect(combat.addOrder({ tick: 2, side: 'player', unitRef: p.combat_ref, targetRef: far.combat_ref })).toBe(false);
    expect(combat.addOrder({ tick: combat.currentTick() + ORDER_DELAY_TICKS, side: 'player', unitRef: p.combat_ref, targetRef: far.combat_ref })).toBe(true);
  });

  it('un camp ne commande que ses unités, et ne vise que l\'adversaire', () => {
    const { combat, p, near, far } = setup();
    combat.addOrder({ tick: 1, side: 'enemy', unitRef: p.combat_ref, targetRef: far.combat_ref });
    combat.addOrder({ tick: 1, side: 'enemy', unitRef: near.combat_ref, targetRef: far.combat_ref });
    combat.step();
    expect(p.ordered_target).toBeNull();
    expect(near.ordered_target).toBeNull();
  });

  it('à portée des deux, l\'unité frappe la cible ordonnée', () => {
    const board = makeBoard();
    const p = spawn(board, makeCard({ id: 'P', stats: { ...stats, atk: 10, range: 14 } }), 'player', { col: 2, row: 2 });
    p.is_immobile = true;
    const near = spawn(board, makeCard({ id: 'E_NEAR', stats }), 'enemy', { col: 2, row: 7 });
    const far = spawn(board, makeCard({ id: 'E_FAR', stats }), 'enemy', { col: 4, row: 10 });
    const combat = new (CombatManager as any)(board, [p], [near, far], null);
    combat.addOrder({ tick: 1, side: 'player', unitRef: p.combat_ref, targetRef: far.combat_ref });
    for (let i = 0; i < 10; i++) combat.step();
    expect(far.current_hp).toBeLessThan(500);
    expect(near.current_hp).toBe(500);
  });

  it('la provocation l\'emporte sur l\'ordre', () => {
    const { combat, p, near, far } = setup();
    combat.addOrder({ tick: 1, side: 'player', unitRef: p.combat_ref, targetRef: far.combat_ref });
    p.provoked_by = near;
    p.provoked_remaining = 50;
    for (let i = 0; i < 3; i++) combat.step();
    expect(p.combat_target_uid).toBe(near.uid);
  });

  it('l\'ordre tombe à la mort de la cible', () => {
    const { combat, p, near, far } = setup();
    combat.addOrder({ tick: 1, side: 'player', unitRef: p.combat_ref, targetRef: far.combat_ref });
    combat.step();
    expect(p.ordered_target).toBe(far);
    far.current_hp = 0;
    far.is_neutralized = true;
    for (let i = 0; i < 3; i++) combat.step();
    expect(p.ordered_target).toBeNull();
    expect(p.combat_target_uid).toBe(near.uid);
  });

  it('un nouvel ordre sur la même unité remplace le précédent', () => {
    const { combat, p, near, far } = setup();
    combat.addOrder({ tick: 1, side: 'player', unitRef: p.combat_ref, targetRef: far.combat_ref });
    combat.addOrder({ tick: 1, side: 'player', unitRef: p.combat_ref, targetRef: near.combat_ref });
    combat.step();
    expect(p.ordered_target).toBe(near);
  });

  it('remis à zéro avec les horloges de combat', () => {
    const { combat, p, far } = setup();
    combat.addOrder({ tick: 1, side: 'player', unitRef: p.combat_ref, targetRef: far.combat_ref });
    combat.step();
    p.resetCombatClocks();
    expect(p.ordered_target).toBeNull();
    expect(p.combat_ref).toBe(-1);
  });
});
