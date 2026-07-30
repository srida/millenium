/* eslint-disable @typescript-eslint/no-explicit-any */
// Règles d'invocation : lignées (represented_ids), material_value, transfert
// des bonus shopping/vétérance. Cas de référence : Aile de feu / Electrum
// documentés dans CLAUDE.md.
import { describe, it, expect } from 'vitest';
import {
  canSummon, summon, matchesMaterial, materialLineageLegit,
  materialLineageMatches, sumMaterialValue, resolveTransformationTarget,
} from '../logic/InvocationManager.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

// canSummon retourne { ok, reason } ou { options } (cartes à summon_options) ;
// ces tests n'utilisent que la première forme.
function can(...args: unknown[]): { ok: boolean; reason: string } {
  return (canSummon as any)(...args);
}

const AVIAN = makeCard({ id: 'AVIAN', name: 'Avian' });
const BURSTINATRIX = makeCard({ id: 'BURSTINATRIX', name: 'Burstinatrix' });
const FIREWING = makeCard({
  id: 'FIREWING', name: 'Aile de feu', summon_type: 'fusion',
  cost: { materials: ['AVIAN', 'BURSTINATRIX'] },
  represented_ids: ['AVIAN', 'BURSTINATRIX'],
});

describe('matchesMaterial', () => {
  it('matche par card_id, par lignée et par attribut ARCH_', () => {
    const board = makeBoard();
    const avian = spawn(board, AVIAN, 'player', { col: 0, row: 0 });
    expect(matchesMaterial(avian, 'AVIAN')).toBe(true);
    expect(matchesMaterial(avian, 'BURSTINATRIX')).toBe(false);

    const dragon = spawn(board, makeCard({ id: 'DRAGON_1', attributes: ['ARCH_DRAGON'] }), 'player', { col: 1, row: 0 });
    expect(matchesMaterial(dragon, 'ARCH_DRAGON')).toBe(true);
    expect(matchesMaterial(dragon, 'ARCH_AUTRE')).toBe(false);
  });
});

describe('materialLineageLegit — cas Aile de feu / Electrum', () => {
  function makeFirewingUnit() {
    const board = makeBoard();
    return spawn(board, FIREWING, 'player', { col: 0, row: 0 });
  }

  it('Aile de feu ne peut PAS remplacer Avian seul (lignée excédentaire)', () => {
    const fw = makeFirewingUnit();
    expect(materialLineageMatches(fw, 'AVIAN', ['AVIAN'])).toBe(false);
  });

  it('Aile de feu peut combler Avian+Burstinatrix pour Electrum (toute la lignée requise)', () => {
    const fw = makeFirewingUnit();
    const electrum = ['AVIAN', 'BURSTINATRIX', 'SPARKMAN'];
    expect(materialLineageMatches(fw, 'AVIAN', electrum)).toBe(true);
    expect(materialLineageMatches(fw, 'BURSTINATRIX', electrum)).toBe(true);
  });

  it('exception : une unité requise nommément est légitime malgré sa lignée', () => {
    const fw = makeFirewingUnit();
    // FIREWING est lui-même un matériau requis → utilisé comme lui-même
    expect(materialLineageLegit(fw, ['FIREWING'])).toBe(true);
    expect(materialLineageMatches(fw, 'FIREWING', ['FIREWING'])).toBe(true);
  });

  it('les matériaux par attribut (ARCH_) ne subissent pas le check de lignée', () => {
    const board = makeBoard();
    const composite = spawn(board, makeCard({ id: 'COMP', attributes: ['ARCH_DRAGON'], represented_ids: ['OTHER_ID'] }), 'player', { col: 0, row: 0 });
    expect(materialLineageMatches(composite, 'ARCH_DRAGON', ['ARCH_DRAGON'])).toBe(true);
  });
});

describe('material_value', () => {
  it('fusion → nombre de matériaux ; sacrifice/heritage → coût sacrifice', () => {
    // Fusion : consomme AVIAN + BURSTINATRIX déjà en jeu
    const board = makeBoard();
    spawn(board, AVIAN, 'player', { col: 0, row: 0 });
    spawn(board, BURSTINATRIX, 'player', { col: 1, row: 0 });
    const hand: any[] = [{ ...FIREWING }];
    const fw = summon(FIREWING as any, { col: 2, row: 0 }, board, hand);
    expect(fw.material_value).toBe(2);
    expect(hand).toHaveLength(0);
    expect(board.getLivingUnitsOnSide('player')).toHaveLength(1); // matériaux consommés

    // Sacrifice de coût 2
    const board2 = makeBoard();
    spawn(board2, makeCard({ id: 'FODDER_1' }), 'player', { col: 0, row: 0 });
    spawn(board2, makeCard({ id: 'FODDER_2' }), 'player', { col: 1, row: 0 });
    const sacCard = makeCard({ id: 'SAC_BOSS', summon_type: 'sacrifice', cost: { sacrifice: 2 } });
    const boss = summon(sacCard as any, { col: 2, row: 0 }, board2, [{ ...sacCard }]);
    expect(boss.material_value).toBe(2);
  });

  it('sumMaterialValue additionne les slots représentés', () => {
    const board = makeBoard();
    const a = spawn(board, AVIAN, 'player', { col: 0, row: 0 });
    const fw = spawn(board, FIREWING, 'player', { col: 1, row: 0 });
    fw.material_value = 2;
    expect(sumMaterialValue([a, fw])).toBe(3);
  });
});

describe('canSummon', () => {
  it('normal : refuse le doublon vivant sur le board joueur', () => {
    const board = makeBoard();
    spawn(board, AVIAN, 'player', { col: 0, row: 0 });
    const res = can(AVIAN as any, { col: 1, row: 0 }, board, []);
    expect(res.ok).toBe(false);

    // …mais l'accepte si l'exemplaire en jeu est neutralisé
    board.getLivingUnitsOnSide('player')[0].is_neutralized = true;
    const res2 = can(AVIAN as any, { col: 1, row: 0 }, board, []);
    expect(res2.ok).toBe(true);
  });

  it('refuse le côté ennemi et les cases occupées', () => {
    const board = makeBoard();
    expect(can(AVIAN as any, { col: 0, row: 7 }, board, []).ok).toBe(false);
    spawn(board, BURSTINATRIX, 'player', { col: 0, row: 0 });
    expect(can(AVIAN as any, { col: 0, row: 0 }, board, []).ok).toBe(false);
  });

  it('sacrifice : compte les material_value du board ET du cimetière', () => {
    const board = makeBoard();
    const graveyard: any[] = [];
    const sacCard = makeCard({ id: 'SAC_BOSS', summon_type: 'sacrifice', cost: { sacrifice: 2 } });

    // 1 seule unité en jeu (valeur 1) → insuffisant
    spawn(board, makeCard({ id: 'FODDER_1' }), 'player', { col: 0, row: 0 });
    expect(can(sacCard as any, { col: 2, row: 0 }, board, [], graveyard).ok).toBe(false);

    // + une unité au cimetière → 2 slots, ok
    const dead = spawn(makeBoard(), makeCard({ id: 'FODDER_2' }), 'player', { col: 0, row: 0 });
    dead.is_neutralized = true;
    graveyard.push(dead);
    expect(can(sacCard as any, { col: 2, row: 0 }, board, [], graveyard).ok).toBe(true);
  });

  it('fusion : exige chaque matériau sur le board ou au cimetière', () => {
    const board = makeBoard();
    spawn(board, AVIAN, 'player', { col: 0, row: 0 });
    expect(can(FIREWING as any, { col: 2, row: 0 }, board, []).ok).toBe(false);
    spawn(board, BURSTINATRIX, 'player', { col: 1, row: 0 });
    expect(can(FIREWING as any, { col: 2, row: 0 }, board, []).ok).toBe(true);
  });

  it('transformation : cible requise, position héritée de la cible', () => {
    const NEO = makeCard({ id: 'NEO_AVIAN', summon_type: 'transformation', cost: { materials: ['AVIAN'] } });
    const board = makeBoard();
    expect(can(NEO as any, { col: 0, row: 0 }, board, []).ok).toBe(false);

    const avian = spawn(board, AVIAN, 'player', { col: 1, row: 2 });
    expect(can(NEO as any, { col: 1, row: 2 }, board, []).ok).toBe(true);
    expect(resolveTransformationTarget(NEO as any, board)).toBe(avian);

    const neo = summon(NEO as any, { col: 3, row: 0 }, board, [{ ...NEO }]);
    // La transformation conserve la position du monstre d'origine
    expect(neo.position).toEqual({ col: 1, row: 2 });
    expect(board.getUnit({ col: 1, row: 2 })).toBe(neo);
    expect(neo.material_value).toBe(1);
  });
});

describe('transfert des bonus shopping et de la vétérance', () => {
  it('somme les _shopping_bonus, transfère le bouclier, prend le MAX de vétérance', () => {
    const board = makeBoard();
    const a = spawn(board, AVIAN, 'player', { col: 0, row: 0 });
    const b = spawn(board, BURSTINATRIX, 'player', { col: 1, row: 0 });

    a._shopping_bonus = { atk: 4 };
    a._base.atk += 4;
    a.shield = 7;
    a.veterancy_points = 2;
    b._shopping_bonus = { atk: 1, hp: 10 };
    b._base.atk += 1;
    b._base.hp += 10;
    b.veterancy_points = 5;

    const fw = summon(FIREWING as any, { col: 2, row: 0 }, board, [{ ...FIREWING }], [a, b]);
    expect(fw._shopping_bonus).toEqual({ atk: 5, hp: 10 });
    expect(fw.atk).toBe(FIREWING.stats.atk + 5);
    expect(fw.shield).toBe(7);
    expect(fw.veterancy_points).toBe(5); // max, pas somme (anti-farm)
  });
});
