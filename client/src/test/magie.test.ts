/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { applyEffect, needsUnitTarget, needsGraveyardTarget, effectLabel } from '../logic/MagieEffect.js';
import { GameState } from '../logic/GameState.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

function magie(effect: any) {
  return { id: 'MAGIC_TEST', name: 'Test', effect };
}

function freshUnit(over: any = {}) {
  return spawn(makeBoard(), makeCard(over), 'player', { col: 0, row: 0 });
}

describe('MagieEffect — routage du ciblage', () => {
  it('needsUnitTarget / needsGraveyardTarget', () => {
    for (const t of ['stat_bonus', 'stat_modifier', 'shield', 'heal', 'defuse_fusion', 'destroy_unit']) {
      expect(needsUnitTarget(magie({ type: t }))).toBe(true);
    }
    expect(needsUnitTarget(magie({ type: 'draw_bonus' }))).toBe(false);
    expect(needsGraveyardTarget(magie({ type: 'revive' }))).toBe(true);
    expect(needsGraveyardTarget(magie({ type: 'heal' }))).toBe(false);
  });

  it('effectLabel couvre tous les types sans planter', () => {
    for (const t of ['stat_bonus', 'stat_modifier', 'draw_bonus', 'guaranteed_draw', 'heal', 'revive', 'shield',
      'player_hp_bonus', 'board_slot_bonus', 'defuse_fusion', 'destroy_unit', 'reduce_sacrifice_cost',
      'free_transformation', 'remove_heritage_material']) {
      expect(typeof effectLabel(magie({ type: t, stat: 'atk', value: 2, tier: 3 }))).toBe('string');
    }
    expect(effectLabel({ id: 'X', name: 'X', effect: null } as any)).toBe('Aucun effet');
  });
});

describe('MagieEffect — effets sur unité', () => {
  it('stat_bonus : permanent via _base, tracké pour transfert, hp soigne aussi', () => {
    const u = freshUnit({ stats: { atk: 10, hp: 50 } });
    applyEffect(magie({ type: 'stat_bonus', stat: 'atk', value: 5 }), { targetUnit: u });
    expect(u._base.atk).toBe(15);
    expect(u.atk).toBe(15);
    expect(u._shopping_bonus).toEqual({ atk: 5 });

    u.current_hp = 30;
    applyEffect(magie({ type: 'stat_bonus', stat: 'hp', value: 20 }), { targetUnit: u });
    expect(u.max_hp).toBe(70);
    expect(u.current_hp).toBe(50);
    // resetCombatStats ne retire PAS le bonus (permanence entre tours)
    u.resetCombatStats();
    expect(u.atk).toBe(15);
    expect(u.max_hp).toBe(70);
  });

  it('stat_modifier : multiplicateur arrondi appliqué à _base, plancher 1', () => {
    const u = freshUnit({ stats: { atk: 7 } });
    applyEffect(magie({ type: 'stat_modifier', stat: 'atk', value: 1.5 }), { targetUnit: u });
    expect(u._base.atk).toBe(7 + Math.round(7 * 0.5)); // 11
    expect(u._shopping_bonus.atk).toBe(4);

    const weak = freshUnit({ stats: { atk: 2 } });
    applyEffect(magie({ type: 'stat_modifier', stat: 'atk', value: 0.1 }), { targetUnit: weak });
    expect(weak._base.atk).toBe(1); // plancher
  });

  it('heal / shield / revive', () => {
    const u = freshUnit({ stats: { hp: 50 } });
    u.current_hp = 20;
    applyEffect(magie({ type: 'heal', value: 15 }), { targetUnit: u });
    expect(u.current_hp).toBe(35);

    applyEffect(magie({ type: 'shield', value: 12 }), { targetUnit: u });
    expect(u.shield).toBe(12);

    u.is_neutralized = true;
    u.current_hp = 0;
    u.dot_effects = [{ damage: 3 }];
    applyEffect(magie({ type: 'revive', value: 40 }), { targetUnit: u });
    expect(u.is_neutralized).toBe(false);
    expect(u.current_hp).toBe(Math.round(u.max_hp * 0.4));
    expect(u.dot_effects).toEqual([]);
  });
});

describe('MagieEffect — effets globaux (gameState)', () => {
  it('player_hp_bonus cappé à 1000', () => {
    const gs = new (GameState as any)();
    gs.player_hp = 950;
    applyEffect(magie({ type: 'player_hp_bonus', value: 100 }), { gameState: gs });
    expect(gs.player_hp).toBe(1000);
  });

  it('board_slot_bonus passe par le cap partagé (+1 max avec Yeux bleus)', () => {
    const gs = new (GameState as any)();
    applyEffect(magie({ type: 'board_slot_bonus', value: 1 }), { gameState: gs });
    expect(gs.player_board_slots).toBe(6);
    // Le même cap est déjà consommé : une 2e magie de slot n'ajoute rien
    applyEffect(magie({ type: 'board_slot_bonus', value: 1 }), { gameState: gs });
    expect(gs.player_board_slots).toBe(6);
  });

  it('draw_bonus / guaranteed_draw / modifiers de main', () => {
    const gs = new (GameState as any)();
    applyEffect(magie({ type: 'draw_bonus', value: 2 }), { gameState: gs });
    expect(gs.player_extra_draws).toBe(2);

    applyEffect(magie({ type: 'guaranteed_draw', tier: 3 }), { gameState: gs });
    expect(gs.player_guaranteed_draws).toEqual([{ tier: 3 }]);

    applyEffect(magie({ type: 'reduce_sacrifice_cost', value: 1 }), { gameState: gs });
    applyEffect(magie({ type: 'free_transformation' }), { gameState: gs });
    applyEffect(magie({ type: 'remove_heritage_material' }), { gameState: gs });
    expect(gs.player_hand_modifiers).toEqual([
      { type: 'reduce_sacrifice_cost', value: 1 },
      { type: 'free_transformation' },
      { type: 'remove_heritage_material' },
    ]);
  });

  it('defuse_fusion et destroy_unit sont des no-ops dans applyEffect (gérés par l\'écran)', () => {
    const u = freshUnit();
    const before = { ...u };
    applyEffect(magie({ type: 'defuse_fusion' }), { targetUnit: u });
    applyEffect(magie({ type: 'destroy_unit' }), { targetUnit: u });
    expect(u.current_hp).toBe(before.current_hp);
    expect(u.is_neutralized).toBe(before.is_neutralized);
  });
});
