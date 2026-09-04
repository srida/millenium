/* eslint-disable @typescript-eslint/no-explicit-any */
// Règles d'invocation : lignées (represented_ids), material_value, transfert
// des bonus shopping/vétérance. Cas de référence : Aile de feu / Electrum
// documentés dans CLAUDE.md.
import { describe, it, expect } from 'vitest';
import {
  canSummon, summon, matchesMaterial, materialLineageLegit,
  materialLineageMatches, sumMaterialValue, exceedsBoardSlots,
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
  id: 'FIREWING', name: 'Aile de feu',
  summon_conditions: [{ materials: 2, requires: ['AVIAN', 'BURSTINATRIX'] }],
  represented_ids: ['AVIAN', 'BURSTINATRIX'],
  material_value: 2,
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
  // ⚠️ Ce n'est PLUS une table dérivée de la voie jouée : la carte porte sa
  // valeur, et le constructeur d'`Unit` la lit — pour les deux camps. C'est ce
  // qui rend structurellement impossible que l'IA et le joueur donnent deux
  // valeurs à la même carte. Mutation : dériver la valeur du coût → ROUGE.
  it('vient de la CARTE, pas de la condition payée', () => {
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
    const sacCard = makeCard({ id: 'SAC_BOSS', summon_conditions: [{ materials: 2 }], material_value: 2 });
    const boss = summon(sacCard as any, { col: 2, row: 0 }, board2, [{ ...sacCard }]);
    expect(boss.material_value).toBe(2);

    // Une carte qui ne dit rien vaut UN slot — le défaut, jamais un calcul.
    const plain = makeCard({ id: 'PLAIN', summon_conditions: [{ materials: 2 }] });
    const p = summon(plain as any, { col: 3, row: 0 }, board2, [{ ...plain }]);
    expect(p.material_value).toBe(1);
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
    const sacCard = makeCard({ id: 'SAC_BOSS', summon_conditions: [{ materials: 2 }] });

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

  // ⚠️ L'ancienne Transformation n'est plus qu'une condition à UN matériel
  // nommé. Elle « conserve la position de sa cible » sans qu'aucune ligne ne le
  // dise : le matériau libère sa case avant la pose, et le joueur tape cette
  // case. Mutation : retirer les matériaux APRÈS `placeUnit` → ROUGE (case
  // occupée).
  it('un matériel nommé : le résultat se pose sur la case libérée', () => {
    const NEO = makeCard({ id: 'NEO_AVIAN', summon_conditions: [{ materials: 1, requires: ['AVIAN'] }] });
    const board = makeBoard();
    expect(can(NEO as any, { col: 0, row: 0 }, board, []).ok).toBe(false);

    const avian = spawn(board, AVIAN, 'player', { col: 1, row: 2 });
    // ⚠️ La case occupée n'est acceptée que si son occupant est SÉLECTIONNÉ
    // comme matériau : sans la sélection, c'est une case occupée comme une
    // autre. L'ancienne Transformation y échappait par exception.
    expect(can(NEO as any, { col: 1, row: 2 }, board, [], [], []).ok).toBe(false);
    expect(can(NEO as any, { col: 1, row: 2 }, board, [], [], [avian]).ok).toBe(true);

    const neo = summon(NEO as any, { col: 1, row: 2 }, board, [{ ...NEO }], [avian]);
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

// ── Les deux règles NOUVELLES de la refonte ──────────────────────────────────
//
// Elles n'existaient pas sous forme de règle avant : la première était un cas
// particulier codé en dur pour la Transformation, la seconde une branche du
// `switch` propre à l'invocation normale. Les deux tombent maintenant de la
// règle générale, et c'est exactement ce qui doit être verrouillé — une refonte
// qui « simplifie » en perdant une règle ne se voit nulle part ailleurs.
describe('exceedsBoardSlots — le cimetière ne libère aucune case', () => {
  const SLOTS = 5;
  const fill = (board: any, n: number) => {
    const units = [];
    for (let c = 0; c < n; c++) units.push(spawn(board, makeCard({ id: `FILL_${c}` }), 'player', { col: c, row: 0 }));
    return units;
  };

  // ⚠️ CHANGEMENT DE GAMEPLAY ASSUMÉ : la Transformation échappait au plafond
  // par exception, quelle que soit la provenance de sa cible. La règle unifiée
  // ne regarde plus que ce qui est LIBÉRÉ.
  // Mutation : compter aussi les matériaux du cimetière → ROUGE.
  it('un matériau pris au CIMETIÈRE ne rend pas de case : refusé sur un board plein', () => {
    const board = makeBoard();
    fill(board, SLOTS);
    const dead = spawn(board, makeCard({ id: 'DEAD' }), 'player', { col: 0, row: 1 });
    board.removeUnit(dead);
    dead.is_neutralized = true;
    const graveyard = [dead];

    const card = makeCard({ id: 'BOSS', summon_conditions: [{ materials: 1, requires: ['DEAD'] }] });
    expect(exceedsBoardSlots(card as any, [dead], board, graveyard, SLOTS)).toBe(true);
  });

  // Mutation : ignorer les matériaux du board → ROUGE.
  it('un matériau pris sur le BOARD rend sa case : accepté sur un board plein', () => {
    const board = makeBoard();
    const [first] = fill(board, SLOTS);

    const card = makeCard({ id: 'BOSS', summon_conditions: [{ materials: 1, requires: ['FILL_0'] }] });
    expect(exceedsBoardSlots(card as any, [first], board, [], SLOTS)).toBe(false);
  });
});

describe('la règle du doublon n’a plus de branche « invocation normale »', () => {
  // ⚠️ Elle tombe de la règle générale : une carte SANS condition n'a aucun
  // matériau à sélectionner, donc le doublon vivant ne peut jamais y figurer,
  // donc elle est refusée. Il n'y a rien d'écrit pour ce cas.
  // Mutation : n'appliquer la garde de doublon qu'aux cartes à condition → ROUGE.
  it('une carte sans condition est refusée si un doublon vit sur le terrain', () => {
    const board = makeBoard();
    const plain = makeCard({ id: 'PLAIN' });
    spawn(board, plain, 'player', { col: 0, row: 0 });
    expect(can(plain as any, { col: 1, row: 0 }, board, [], [], []).ok).toBe(false);
  });

  // Et le pendant : avec une condition, le doublon est jouable — À CONDITION
  // d'être mangé. C'est la même règle, lue dans l'autre sens.
  it('avec une condition, le doublon passe s’il est sélectionné comme matériau', () => {
    const board = makeBoard();
    const boss = makeCard({ id: 'BOSS', summon_conditions: [{ materials: 1 }] });
    const twin = spawn(board, boss, 'player', { col: 0, row: 0 });

    expect(can(boss as any, { col: 1, row: 0 }, board, [], [], []).ok).toBe(false);
    expect(can(boss as any, { col: 0, row: 0 }, board, [], [], [twin]).ok).toBe(true);
  });
});
