/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { applyEffect, needsUnitTarget, needsGraveyardTarget, needsHandTarget, effectLabel } from '../logic/MagieEffect.js';
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
    for (const t of ['stat_bonus', 'stat_modifier', 'shield', 'heal', 'defuse_fusion', 'destroy_unit', 'drain_life']) {
      expect(needsUnitTarget(magie({ type: t }))).toBe(true);
    }
    expect(needsUnitTarget(magie({ type: 'draw_bonus' }))).toBe(false);
    expect(needsGraveyardTarget(magie({ type: 'revive' }))).toBe(true);
    expect(needsGraveyardTarget(magie({ type: 'heal' }))).toBe(false);
  });

  it('needsHandTarget : hand_to_graveyard SEUL, et il n\'est ni unité ni cimetière', () => {
    // Les trois familles de ciblage s'excluent : le controller les teste dans
    // l'ordre unité → cimetière → main, un type reconnu par deux d'entre elles
    // n'atteindrait jamais la troisième branche.
    expect(needsHandTarget(magie({ type: 'hand_to_graveyard' }))).toBe(true);
    expect(needsUnitTarget(magie({ type: 'hand_to_graveyard' }))).toBe(false);
    expect(needsGraveyardTarget(magie({ type: 'hand_to_graveyard' }))).toBe(false);
    for (const t of ['stat_bonus', 'team_stat_bonus', 'revive', 'destroy_unit', 'drain_life']) {
      expect(needsHandTarget(magie({ type: t }))).toBe(false);
    }
  });

  it('les magies d\'ÉQUIPE n\'ont aucune cible à désigner (effets globaux)', () => {
    for (const t of ['team_stat_bonus', 'team_heal']) {
      expect(needsUnitTarget(magie({ type: t })), t).toBe(false);
      expect(needsGraveyardTarget(magie({ type: t })), t).toBe(false);
      expect(needsHandTarget(magie({ type: t })), t).toBe(false);
    }
    // …là où leur pendant à cible unique en demande bien une.
    expect(needsUnitTarget(magie({ type: 'heal' }))).toBe(true);
    expect(needsUnitTarget(magie({ type: 'stat_bonus' }))).toBe(true);
  });

  it('effectLabel couvre tous les types sans planter', () => {
    for (const t of ['stat_bonus', 'stat_modifier', 'draw_bonus', 'guaranteed_draw', 'heal', 'revive', 'shield',
      'player_hp_bonus', 'board_slot_bonus', 'defuse_fusion', 'destroy_unit', 'reduce_sacrifice_cost',
      'free_transformation', 'remove_heritage_material', 'team_stat_bonus', 'drain_life',
      'hand_to_graveyard', 'remove_fusion_material', 'team_heal']) {
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

  it('heal : soin TOTAL — les PV remontent au maximum, quelle que soit la blessure', () => {
    const u = freshUnit({ stats: { hp: 50 } });
    u.current_hp = 3;
    applyEffect(magie({ type: 'heal' }), { targetUnit: u });
    expect(u.current_hp).toBe(u.max_hp);
    expect(u.current_hp).toBe(50);
  });

  it('heal : `value` n\'est PAS lu — un montant resté en donnée ne borne pas le soin', () => {
    // Les entrées de catalogue antérieures au soin total portent encore un
    // `value` : le lire ferait un soin partiel là où la carte promet un soin
    // complet, et rien à l'écran ne le dirait.
    const u = freshUnit({ stats: { hp: 200 } });
    u.current_hp = 10;
    applyEffect(magie({ type: 'heal', value: 15 }), { targetUnit: u });
    expect(u.current_hp).toBe(200);
  });

  it('heal : suit le max COURANT, bonus de PV compris', () => {
    // Un soin total soigne jusqu'au max du moment — vétérance et magies de
    // stat comprises —, pas jusqu'au `hp` figé de la carte.
    const u = freshUnit({ stats: { hp: 50 } });
    applyEffect(magie({ type: 'stat_bonus', stat: 'hp', value: 30 }), { targetUnit: u });
    u.current_hp = 5;
    applyEffect(magie({ type: 'heal' }), { targetUnit: u });
    expect(u.current_hp).toBe(80);
  });

  it('heal : ne dépasse jamais le maximum, et ne ressuscite pas', () => {
    const u = freshUnit({ stats: { hp: 50 } });
    applyEffect(magie({ type: 'heal' }), { targetUnit: u });
    expect(u.current_hp).toBe(50);
    // `revive` est le seul effet qui relève un neutralisé ; le soin ne fait
    // que des PV. (Le ciblage l'exclut de toute façon : magieUnitTargets ne
    // rend que des unités VIVANTES.)
    u.is_neutralized = true;
    u.current_hp = 0;
    applyEffect(magie({ type: 'heal' }), { targetUnit: u });
    expect(u.is_neutralized).toBe(true);
  });

  it('shield / revive', () => {
    const u = freshUnit({ stats: { hp: 50 } });
    u.current_hp = 20;
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

  it('defuse_fusion, destroy_unit, drain_life et hand_to_graveyard sont des no-ops dans applyEffect (gérés par GameSession)', () => {
    const u = freshUnit();
    const before = { ...u };
    const gs = new (GameState as any)();
    // player_hp est SOUS son plafond, sinon un crédit parasite serait masqué
    // par le `min(…, 1000)` et le test passerait à vide.
    gs.player_hp = 500;
    const hpBefore = gs.player_hp;
    for (const t of ['defuse_fusion', 'destroy_unit', 'drain_life', 'hand_to_graveyard']) {
      applyEffect(magie({ type: t }), { gameState: gs, targetUnit: u });
    }
    expect(u.current_hp).toBe(before.current_hp);
    expect(u.is_neutralized).toBe(before.is_neutralized);
    // drain_life en particulier : la jauge du joueur ne bouge PAS ici, sans quoi
    // elle serait créditée deux fois (une par applyEffect, une par _drainLife).
    expect(gs.player_hp).toBe(hpBefore);
  });

  it('remove_fusion_material : empile un modifier de main avec son compte', () => {
    const gs = new (GameState as any)();
    applyEffect(magie({ type: 'remove_fusion_material' }), { gameState: gs });
    applyEffect(magie({ type: 'remove_fusion_material', value: 2 }), { gameState: gs });
    expect(gs.player_hand_modifiers).toEqual([
      { type: 'remove_fusion_material', value: 1 },
      { type: 'remove_fusion_material', value: 2 },
    ]);
  });
});

describe('MagieEffect — team_heal', () => {
  it('soigne CHAQUE unité reçue du montant demandé', () => {
    const board = makeBoard();
    const a = spawn(board, makeCard({ id: 'A', stats: { hp: 100 } as any }), 'player', { col: 0, row: 0 });
    const b = spawn(board, makeCard({ id: 'B', stats: { hp: 100 } as any }), 'player', { col: 1, row: 0 });
    a.current_hp = 10;
    b.current_hp = 50;

    applyEffect(magie({ type: 'team_heal', value: 30 }), { targetUnits: [a, b] });

    expect([a.current_hp, b.current_hp]).toEqual([40, 80]);
  });

  it('est CHIFFRÉ, pas total : une unité très blessée ne repart pas au maximum', () => {
    // C'est toute la différence avec `heal`, qui n'a pas de montant. Un soin
    // de masse total n'aurait aucun contrepoids.
    const board = makeBoard();
    const u = spawn(board, makeCard({ id: 'A', stats: { hp: 300 } as any }), 'player', { col: 0, row: 0 });
    u.current_hp = 5;
    applyEffect(magie({ type: 'team_heal', value: 20 }), { targetUnits: [u] });
    expect(u.current_hp).toBe(25);
  });

  it('plafonne au max de chaque unité, sans déborder', () => {
    const board = makeBoard();
    const u = spawn(board, makeCard({ id: 'A', stats: { hp: 60 } as any }), 'player', { col: 0, row: 0 });
    u.current_hp = 55;
    applyEffect(magie({ type: 'team_heal', value: 999 }), { targetUnits: [u] });
    expect(u.current_hp).toBe(60);
  });

  it('sans unité : aucun plantage', () => {
    expect(() => applyEffect(magie({ type: 'team_heal', value: 10 }), { targetUnits: [] })).not.toThrow();
    expect(() => applyEffect(magie({ type: 'team_heal', value: 10 }), {})).not.toThrow();
  });
});

describe('MagieEffect — team_stat_bonus', () => {
  it('frappe TOUTES les unités reçues, en permanent et tracé pour transfert', () => {
    const board = makeBoard();
    const a = spawn(board, makeCard({ id: 'A', stats: { atk: 10, hp: 30 } as any }), 'player', { col: 0, row: 0 });
    const b = spawn(board, makeCard({ id: 'B', stats: { atk: 4, hp: 30 } as any }), 'player', { col: 1, row: 0 });

    applyEffect(magie({ type: 'team_stat_bonus', stat: 'atk', value: 3 }), { targetUnits: [a, b] });

    expect([a._base.atk, b._base.atk]).toEqual([13, 7]);
    expect([a.atk, b.atk]).toEqual([13, 7]);
    // _shopping_bonus est ce qui suit l'unité dans une invocation composite :
    // sans lui, fusionner une unité boostée perdrait l'investissement du joueur.
    expect(a._shopping_bonus).toEqual({ atk: 3 });
    expect(b._shopping_bonus).toEqual({ atk: 3 });
  });

  it('sur hp : monte aussi les PV courants, sans dépasser le nouveau max', () => {
    const board = makeBoard();
    const u = spawn(board, makeCard({ id: 'H', stats: { atk: 5, hp: 50 } as any }), 'player', { col: 0, row: 0 });
    u.current_hp = 20;
    applyEffect(magie({ type: 'team_stat_bonus', stat: 'hp', value: 15 }), { targetUnits: [u] });
    expect(u.max_hp).toBe(65);
    expect(u.current_hp).toBe(35);
  });

  it('sans unité (board vide) : aucun plantage', () => {
    expect(() => applyEffect(magie({ type: 'team_stat_bonus', stat: 'atk', value: 3 }), { targetUnits: [] })).not.toThrow();
    expect(() => applyEffect(magie({ type: 'team_stat_bonus', stat: 'atk', value: 3 }), {})).not.toThrow();
  });

  it('plancher à 1 comme stat_bonus : une valeur négative ne descend jamais sous 1', () => {
    const board = makeBoard();
    const u = spawn(board, makeCard({ id: 'N', stats: { atk: 3, hp: 30 } as any }), 'player', { col: 0, row: 0 });
    applyEffect(magie({ type: 'team_stat_bonus', stat: 'atk', value: -10 }), { targetUnits: [u] });
    expect(u._base.atk).toBe(1);
  });
});
