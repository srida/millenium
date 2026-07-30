/* eslint-disable @typescript-eslint/no-explicit-any */
// Golden tests de déterminisme du combat (PLAN_REFONTE Phase 1).
//
// ⚠️ CONTRAT : ces snapshots sont la baseline du portage. Ils ne doivent JAMAIS
// être mis à jour "pour faire passer le build" pendant la conversion TS — une
// divergence signifie que le comportement du combat a changé (et casserait le
// PvP, où chaque client simule le même combat localement). Toute mise à jour
// volontaire (correction de bug de gameplay) doit être un commit dédié.
import { describe, it, expect } from 'vitest';
import { makeBoard, makeCard, spawn, runCombat, countEventTypes } from './helpers.js';
import { AttributeManager } from '../logic/AttributeManager.js';
import { MAX_COMBAT_TICKS } from '../logic/CombatManager.js';

describe('combat déterministe — golden events', () => {
  it('S1 — mêlée basique 2v2 (mouvement, ciblage, initiative, morts)', () => {
    const board = makeBoard();
    const p1 = spawn(board, makeCard({ id: 'P_BRUTE', stats: { atk: 8, hp: 40, attack_speed: 2, initiative: 5, movement_speed: 1, range: 1 } }), 'player', { col: 2, row: 3 });
    const p2 = spawn(board, makeCard({ id: 'P_SQUIRE', stats: { atk: 5, hp: 30, attack_speed: 3, initiative: 3, movement_speed: 1, range: 1 } }), 'player', { col: 1, row: 3 });
    const e1 = spawn(board, makeCard({ id: 'E_ORC', stats: { atk: 6, hp: 35, attack_speed: 2, initiative: 4, movement_speed: 1, range: 1 } }), 'enemy', { col: 2, row: 7 });
    const e2 = spawn(board, makeCard({ id: 'E_GOBLIN', stats: { atk: 4, hp: 22, attack_speed: 3, initiative: 6, movement_speed: 2, range: 1 } }), 'enemy', { col: 3, row: 7 });

    const result = runCombat(board, [p1, p2], [e1, e2]);
    expect(result.winner).not.toBeNull();
    expect(result).toMatchSnapshot();
  });

  it('S2 — portée + ligne de vue avec mur de cases bloquées', () => {
    const board = makeBoard();
    board.setBlockedCells([{ col: 1, row: 5 }, { col: 2, row: 5 }, { col: 3, row: 5 }]);

    const archer = spawn(board, makeCard({ id: 'P_ARCHER', stats: { atk: 6, hp: 25, attack_speed: 2, initiative: 6, movement_speed: 1, range: 4 } }), 'player', { col: 2, row: 2 });
    const tank = spawn(board, makeCard({ id: 'P_TANK', stats: { atk: 4, hp: 45, attack_speed: 3, initiative: 4, movement_speed: 1, range: 1 } }), 'player', { col: 2, row: 3 });
    const brute = spawn(board, makeCard({ id: 'E_BRUTE', stats: { atk: 7, hp: 40, attack_speed: 2, initiative: 5, movement_speed: 1, range: 1 } }), 'enemy', { col: 2, row: 8 });
    const eArcher = spawn(board, makeCard({ id: 'E_ARCHER', stats: { atk: 5, hp: 20, attack_speed: 3, initiative: 7, movement_speed: 2, range: 3 } }), 'enemy', { col: 1, row: 9 });

    const result = runCombat(board, [archer, tank], [brute, eArcher]);
    expect(result.winner).not.toBeNull();
    expect(result).toMatchSnapshot();
  });

  it('S3 — pouvoirs de soutien : HEAL, SHIELD, SUPER_ATTACK, AOE_ATTACK', () => {
    const board = makeBoard();
    const healer = spawn(board, makeCard({ id: 'P_HEALER', power: { id: 'POWER_HEAL', power_speed: 6 }, stats: { atk: 3, hp: 30, attack_speed: 2, initiative: 4, movement_speed: 1, range: 3 } }), 'player', { col: 1, row: 2 });
    const striker = spawn(board, makeCard({ id: 'P_STRIKER', power: { id: 'POWER_SUPER_ATTACK', power_speed: 7 }, stats: { atk: 7, hp: 35, attack_speed: 2, initiative: 6, movement_speed: 1, range: 1 } }), 'player', { col: 2, row: 3 });
    const shielder = spawn(board, makeCard({ id: 'E_SHIELDER', power: { id: 'POWER_SHIELD', power_speed: 5 }, stats: { atk: 6, hp: 30, attack_speed: 2, initiative: 5, movement_speed: 1, range: 1 } }), 'enemy', { col: 2, row: 7 });
    const bomber = spawn(board, makeCard({ id: 'E_BOMBER', power: { id: 'POWER_AOE_ATTACK', power_speed: 8 }, stats: { atk: 5, hp: 28, attack_speed: 3, initiative: 3, movement_speed: 2, range: 3 } }), 'enemy', { col: 3, row: 8 });

    const result = runCombat(board, [healer, striker], [shielder, bomber]);
    expect(result.winner).not.toBeNull();
    expect(result).toMatchSnapshot();
  });

  it('S4 — pouvoirs de contrôle : POISON, PARALYSIS, PUSH, BLOCK', () => {
    const board = makeBoard();
    const poisoner = spawn(board, makeCard({ id: 'P_POISONER', power: { id: 'POWER_POISON', power_speed: 5 }, stats: { atk: 6, hp: 30, attack_speed: 2, initiative: 6, movement_speed: 1, range: 2 } }), 'player', { col: 2, row: 3 });
    const pusher = spawn(board, makeCard({ id: 'P_PUSHER', power: { id: 'POWER_PUSH', power_speed: 7, value: 2 }, stats: { atk: 5, hp: 35, attack_speed: 2, initiative: 4, movement_speed: 1, range: 1 } }), 'player', { col: 1, row: 3 });
    const paralyzer = spawn(board, makeCard({ id: 'E_PARALYZER', power: { id: 'POWER_PARALYSIS', power_speed: 6 }, stats: { atk: 6, hp: 32, attack_speed: 2, initiative: 5, movement_speed: 1, range: 2 } }), 'enemy', { col: 2, row: 7 });
    const blocker = spawn(board, makeCard({ id: 'E_BLOCKER', power: { id: 'POWER_BLOCK', power_speed: 4 }, stats: { atk: 5, hp: 30, attack_speed: 3, initiative: 3, movement_speed: 1, range: 1 } }), 'enemy', { col: 1, row: 7 });

    const result = runCombat(board, [poisoner, pusher], [paralyzer, blocker]);
    expect(result.winner).not.toBeNull();
    expect(result).toMatchSnapshot();
  });

  it('S5 — pouvoirs avancés : BURN, CONFUSION, FREEZE, TAUNT, TELEPORT + immunité', () => {
    const board = makeBoard();
    // ARCH_IMMU (effect_immunity) protège E_IMMUNE des debuffs (burn/confusion/freeze immune:true)
    const attributeList = [
      { id: 'ARCH_IMMU', name: 'Immunisé', timing: 'start_of_combat', thresholds: [{ count: 1, effects: [{ type: 'effect_immunity' }] }] },
    ];

    const burner = spawn(board, makeCard({ id: 'P_BURNER', power: { id: 'POWER_BURN', power_speed: 5 }, stats: { atk: 6, hp: 30, attack_speed: 2, initiative: 6, movement_speed: 1, range: 2 } }), 'player', { col: 1, row: 3 });
    const taunter = spawn(board, makeCard({ id: 'P_TAUNTER', power: { id: 'POWER_TAUNT', power_speed: 4 }, stats: { atk: 4, hp: 45, attack_speed: 3, initiative: 5, movement_speed: 1, range: 1 } }), 'player', { col: 2, row: 3 });
    const teleporter = spawn(board, makeCard({ id: 'P_TELEPORTER', power: { id: 'POWER_TELEPORT', power_speed: 6 }, stats: { atk: 7, hp: 25, attack_speed: 2, initiative: 7, movement_speed: 1, range: 1 } }), 'player', { col: 3, row: 3 });
    const freezer = spawn(board, makeCard({ id: 'E_FREEZER', power: { id: 'POWER_FREEZE', power_speed: 5 }, stats: { atk: 5, hp: 30, attack_speed: 2, initiative: 6, movement_speed: 1, range: 2 } }), 'enemy', { col: 1, row: 7 });
    const confuser = spawn(board, makeCard({ id: 'E_CONFUSER', power: { id: 'POWER_CONFUSION', power_speed: 6 }, stats: { atk: 5, hp: 28, attack_speed: 3, initiative: 4, movement_speed: 2, range: 3 } }), 'enemy', { col: 2, row: 8 });
    const immune = spawn(board, makeCard({ id: 'E_IMMUNE', attributes: ['ARCH_IMMU'], stats: { atk: 6, hp: 38, attack_speed: 2, initiative: 5, movement_speed: 1, range: 1 } }), 'enemy', { col: 3, row: 7 });

    const playerUnits = [burner, taunter, teleporter];
    const enemyUnits = [freezer, confuser, immune];
    const am = new (AttributeManager as any)(attributeList, playerUnits, enemyUnits);
    am.applyStartOfCombat();
    expect(immune.is_effect_immune).toBe(true);

    const result = runCombat(board, playerUnits, enemyUnits, am);
    expect(result.winner).not.toBeNull();
    expect(result).toMatchSnapshot();
  });

  it('S6 — synergies : stat_bonus, shield, during_combat stat_modifier, vétérance', () => {
    const board = makeBoard();
    const attributeList = [
      { id: 'ARCH_WARRIOR', name: 'Guerrier', timing: 'start_of_combat', thresholds: [{ count: 2, effects: [{ type: 'stat_bonus', stat: 'atk', value: 5 }] }] },
      { id: 'ARCH_GUARD', name: 'Garde', timing: 'start_of_combat', thresholds: [{ count: 1, effects: [{ type: 'shield', value: 10 }] }] },
      { id: 'ARCH_RAGE', name: 'Rage', timing: 'during_combat', thresholds: [{ count: 2, effects: [{ type: 'stat_modifier', stat: 'atk', value: 3, trigger: 'on_ally_neutralized' }] }] },
    ];

    const w1 = spawn(board, makeCard({ id: 'P_W1', attributes: ['ARCH_WARRIOR', 'ARCH_RAGE'], stats: { atk: 7, hp: 40, attack_speed: 2, initiative: 6, movement_speed: 1, range: 1 } }), 'player', { col: 1, row: 3 });
    const w2 = spawn(board, makeCard({ id: 'P_W2', attributes: ['ARCH_WARRIOR', 'ARCH_RAGE'], stats: { atk: 6, hp: 35, attack_speed: 2, initiative: 5, movement_speed: 1, range: 1 } }), 'player', { col: 3, row: 3 });
    const guard = spawn(board, makeCard({ id: 'P_GUARD', attributes: ['ARCH_GUARD'], stats: { atk: 4, hp: 30, attack_speed: 3, initiative: 4, movement_speed: 1, range: 1 } }), 'player', { col: 2, row: 2 });
    // Le bait est en ligne de front (row 3) pour mourir tôt et déclencher la RAGE
    const bait = spawn(board, makeCard({ id: 'P_BAIT', stats: { atk: 2, hp: 8, attack_speed: 3, initiative: 8, movement_speed: 1, range: 1 } }), 'player', { col: 2, row: 3 });
    const e1 = spawn(board, makeCard({ id: 'E_BRUTE_1', stats: { atk: 9, hp: 60, attack_speed: 2, initiative: 5, movement_speed: 1, range: 1 } }), 'enemy', { col: 2, row: 7 });
    const e2 = spawn(board, makeCard({ id: 'E_BRUTE_2', stats: { atk: 8, hp: 55, attack_speed: 2, initiative: 4, movement_speed: 1, range: 1 } }), 'enemy', { col: 1, row: 7 });

    // Vétérance : w1 a survécu à 3 combats → +6 atk / +45 hp au start (2/pt, 15/pt)
    w1.veterancy_points = 3;

    const playerUnits = [w1, w2, guard, bait];
    const enemyUnits = [e1, e2];
    const am = new (AttributeManager as any)(attributeList, playerUnits, enemyUnits);
    am.applyStartOfCombat();

    // Bonus start_of_combat vérifiés en clair (documentation vivante)
    expect(w1.atk).toBe(7 + 5 + 6);        // base + ARCH_WARRIOR + vétérance
    expect(w1.max_hp).toBe(40 + 45);       // base + vétérance
    expect(w2.atk).toBe(6 + 5);
    expect(guard.shield).toBe(10 * 4);     // value × alliés vivants

    const result = runCombat(board, playerUnits, enemyUnits, am);
    expect(result.winner).not.toBeNull();
    // Le stat_change de la RAGE doit apparaître quand P_BAIT meurt
    expect(result.events.some((e: any) => e.type === 'stat_change')).toBe(true);
    expect(result).toMatchSnapshot();
  });

  it('S7 — timeout : combat interminable coupé à MAX_COMBAT_TICKS', () => {
    const board = makeBoard();
    const p = spawn(board, makeCard({ id: 'P_WALL', stats: { atk: 1, hp: 500, attack_speed: 3, initiative: 5, movement_speed: 1, range: 1 } }), 'player', { col: 2, row: 3 });
    const e = spawn(board, makeCard({ id: 'E_WALL', stats: { atk: 1, hp: 500, attack_speed: 3, initiative: 5, movement_speed: 1, range: 1 } }), 'enemy', { col: 2, row: 7 });

    const result = runCombat(board, [p], [e]);
    expect(result.winner).toBe('timeout');
    expect(result.steps).toBe(MAX_COMBAT_TICKS);
    // Snapshot compact : le flux complet ferait ~1000 lignes pour rien
    expect({ winner: result.winner, steps: result.steps, counts: countEventTypes(result.events) }).toMatchSnapshot();
  });
});
