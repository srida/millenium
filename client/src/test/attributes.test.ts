/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { AttributeManager } from '../logic/AttributeManager.js';
import { guaranteedDrawCriteria } from '../logic/Draw.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

function units(board: any, defs: { id: string; attrs?: string[]; col: number; row: number; side?: 'player' | 'enemy' }[]) {
  return defs.map(d => spawn(board, makeCard({ id: d.id, attributes: d.attrs ?? [] }), d.side ?? 'player', { col: d.col, row: d.row }));
}

describe('AttributeManager — comptage des seuils', () => {
  it('deux exemplaires de la même carte comptent pour 1', () => {
    const attrs = [{
      id: 'ARCH_X', name: 'X', timing: 'start_of_combat',
      thresholds: [{ count: 2, effects: [{ type: 'stat_bonus', stat: 'atk', value: 5 }] }],
    }];
    const board = makeBoard();
    const [a, b] = units(board, [
      { id: 'SAME', attrs: ['ARCH_X'], col: 0, row: 0 },
      { id: 'SAME', attrs: ['ARCH_X'], col: 1, row: 0 },
    ]);
    const am = new (AttributeManager as any)(attrs, [a, b], []);
    am.applyStartOfCombat();
    // Seuil count:2 non atteint (1 carte distincte) → pas de bonus
    expect(a.atk).toBe(5);

    const board2 = makeBoard();
    const [c, d] = units(board2, [
      { id: 'CARD_A', attrs: ['ARCH_X'], col: 0, row: 0 },
      { id: 'CARD_B', attrs: ['ARCH_X'], col: 1, row: 0 },
    ]);
    const am2 = new (AttributeManager as any)(attrs, [c, d], []);
    am2.applyStartOfCombat();
    expect(c.atk).toBe(10);
    expect(d.atk).toBe(10);
  });

  it('value_per : bonus multiplié par les unités ENNEMIES portant l\'attribut', () => {
    const attrs = [{
      id: 'ARCH_HUNTER', name: 'Chasseur', timing: 'start_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 3, value_per: 'ARCH_PREY' }] }],
    }];
    const board = makeBoard();
    const hunter = spawn(board, makeCard({ id: 'HUNTER', attributes: ['ARCH_HUNTER'] }), 'player', { col: 0, row: 0 });
    const prey1 = spawn(board, makeCard({ id: 'PREY_1', attributes: ['ARCH_PREY'] }), 'enemy', { col: 0, row: 7 });
    const prey2 = spawn(board, makeCard({ id: 'PREY_2', attributes: ['ARCH_PREY'] }), 'enemy', { col: 1, row: 7 });
    const am = new (AttributeManager as any)(attrs, [hunter], [prey1, prey2]);
    am.applyStartOfCombat();
    expect(hunter.atk).toBe(5 + 3 * 2);
  });

  it('shield : valeur × alliés vivants', () => {
    const attrs = [{
      id: 'ARCH_GUARD', name: 'Garde', timing: 'start_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'shield', value: 8 }] }],
    }];
    const board = makeBoard();
    const g = spawn(board, makeCard({ id: 'G', attributes: ['ARCH_GUARD'] }), 'player', { col: 0, row: 0 });
    units(board, [{ id: 'A1', col: 1, row: 0 }, { id: 'A2', col: 2, row: 0 }]);
    const allUnits = board.getUnitsOnSide('player');
    const am = new (AttributeManager as any)(attrs, allUnits, []);
    am.applyStartOfCombat();
    expect(g.shield).toBe(8 * 3);
  });
});

describe('AttributeManager — seuils during_combat verrouillés', () => {
  const attrs = [{
    id: 'ARCH_RAGE', name: 'Rage', timing: 'during_combat',
    thresholds: [{ count: 2, effects: [{ type: 'stat_modifier', stat: 'atk', value: 4, trigger: 'on_ally_neutralized' }] }],
  }];

  it('les morts en cours de combat ne désactivent pas un seuil déjà actif', () => {
    const board = makeBoard();
    const [r1, r2, bait] = units(board, [
      { id: 'R1', attrs: ['ARCH_RAGE'], col: 0, row: 0 },
      { id: 'R2', attrs: ['ARCH_RAGE'], col: 1, row: 0 },
      { id: 'BAIT', col: 2, row: 0 },
    ]);
    // Même référence de tableau pour le constructeur et l'appel : AttributeManager
    // identifie le côté par identité de référence (comme le fait CombatManager).
    const playerUnits = [r1, r2, bait];
    const am = new (AttributeManager as any)(attrs, playerUnits, []);
    am.applyStartOfCombat();

    // R2 meurt : le compte vivant tombe à 1, mais le seuil reste verrouillé
    r2.is_neutralized = true;
    const events = am.onUnitNeutralized(r2, playerUnits, []);
    expect(r1.atk).toBe(5 + 4);
    expect(events.filter((e: any) => e.type === 'stat_change')).toHaveLength(1); // r1 seul (r2 mort)
  });

  it('un seuil non atteint au start ne se déclenche jamais', () => {
    const board = makeBoard();
    const [r1, bait] = units(board, [
      { id: 'R1', attrs: ['ARCH_RAGE'], col: 0, row: 0 },
      { id: 'BAIT', col: 2, row: 0 },
    ]);
    const playerUnits = [r1, bait];
    const am = new (AttributeManager as any)(attrs, playerUnits, []);
    am.applyStartOfCombat();
    bait.is_neutralized = true;
    am.onUnitNeutralized(bait, playerUnits, []);
    expect(r1.atk).toBe(5);
  });
});

describe('AttributeManager — end_of_combat', () => {
  it('compte vivants + neutralisés ; revive restaure la première unité morte', () => {
    const attrs = [{
      id: 'ARCH_NECRO', name: 'Nécro', timing: 'end_of_combat',
      thresholds: [{ count: 2, effects: [{ type: 'revive', hp_percent: 30 }, { type: 'draw_bonus', value: 1 }] }],
    }];
    const board = makeBoard();
    const [n1, n2] = units(board, [
      { id: 'N1', attrs: ['ARCH_NECRO'], col: 0, row: 0 },
      { id: 'N2', attrs: ['ARCH_NECRO'], col: 1, row: 0 },
    ]);
    // N2 est mort pendant le combat — il compte quand même pour le seuil
    n2.is_neutralized = true;
    n2.current_hp = 0;

    const am = new (AttributeManager as any)(attrs, [n1, n2], []);
    const neutralized = [n2];
    const result = am.applyEndOfCombat(neutralized, []);

    expect(result.revived).toEqual([n2]);
    expect(n2.is_neutralized).toBe(false);
    expect(n2.current_hp).toBe(Math.floor(n2.max_hp * 0.3));
    expect(neutralized).toHaveLength(0); // retirée de la liste des morts
    expect(result.draw_bonus).toBe(1);
  });

  // La pioche a un destinataire des DEUX côtés (`EnemyAI` pioche aussi),
  // contrairement à l'emplacement, au multiplicateur et au Shopping —
  // ressources exclusivement joueur, cf. les trois tests suivants.
  it('draw_bonus côté ENNEMI crédite enemy_draw_bonus, pas draw_bonus', () => {
    const attrs = [{
      id: 'ARCH_SCOUT', name: 'Éclaireur', timing: 'end_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'draw_bonus', value: 2 }] }],
    }];
    const board = makeBoard();
    const [e1] = units(board, [{ id: 'E1', attrs: ['ARCH_SCOUT'], col: 0, row: 7, side: 'enemy' }]);
    const am = new (AttributeManager as any)(attrs, [], [e1]);
    const result = am.applyEndOfCombat([], []);

    expect(result.enemy_draw_bonus).toBe(2);
    expect(result.draw_bonus).toBe(0);
    // Rien n'affiche la provenance de la pioche adverse.
    expect(result.draw_sources).toEqual([]);
  });

  // ⚠️ Un effet d'attribut et une magie du même type alimentent la MÊME file et
  // sont résolus par le même `Draw.resolveGuaranteedDraws` : leur donner deux
  // pouvoirs d'expression, c'était laisser l'attribut ne savoir promettre qu'un
  // attribut, là où la magie sait nommer un tier et des cartes.
  // Mutation : ne recopier que `effect.attribute` dans le push → ROUGE.
  it('guaranteed_draw d’attribut porte les MÊMES critères qu’une magie', () => {
    const attrs = [{
      id: 'ARCH_ORACLE', name: 'Oracle', timing: 'end_of_combat',
      thresholds: [{
        count: 1,
        effects: [{
          type: 'guaranteed_draw',
          tier: 4,
          attributes: ['ARCH_003', 'ARCH_009'],
          card_ids: ['CORE_001', 'CORE_002'],
        }],
      }],
    }];
    const board = makeBoard();
    const [p1] = units(board, [{ id: 'P1', attrs: ['ARCH_ORACLE'], col: 0, row: 0 }]);
    const am = new (AttributeManager as any)(attrs, [p1], []);
    const result = am.applyEndOfCombat([], []);

    expect(result.guaranteed_draws).toEqual([{
      tier: 4,
      attribute: null,
      attributes: ['ARCH_003', 'ARCH_009'],
      card_ids: ['CORE_001', 'CORE_002'],
    }]);
    // Et ces critères se relisent EXACTEMENT comme ceux d'une magie.
    expect(guaranteedDrawCriteria(result.guaranteed_draws[0])).toEqual({
      tier: 4,
      attributes: ['ARCH_003', 'ARCH_009'],
      cardIds: ['CORE_001', 'CORE_002'],
    });
  });

  it('guaranteed_draw côté ENNEMI alimente enemy_guaranteed_draws, pas guaranteed_draws', () => {
    const attrs = [{
      id: 'ARCH_FORGE', name: 'Forge', timing: 'end_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'guaranteed_draw', attribute: 'ARCH_086' }] }],
    }];
    const board = makeBoard();
    const [e1] = units(board, [{ id: 'E1', attrs: ['ARCH_FORGE'], col: 0, row: 7, side: 'enemy' }]);
    const am = new (AttributeManager as any)(attrs, [], [e1]);
    const result = am.applyEndOfCombat([], []);

    expect(result.enemy_guaranteed_draws).toEqual([{ attribute: 'ARCH_086' }]);
    expect(result.guaranteed_draws).toEqual([]);
  });

  // Cap partagé (slot), dégâts (multiplicateur) et Shopping restent
  // exclusivement JOUEUR : l'IA n'a ni Phase Shopping ni cap de slot dérivé de
  // l'attribut, et le multiplicateur d'attribut est volontairement asymétrique
  // (contrat de déterminisme PvP, cf. CLAUDE.md « damage_multiplier_bonus »).
  it('board_slot_bonus / damage_multiplier_bonus / shopping_bonus côté ENNEMI ne donnent rien', () => {
    const attrs = [
      { id: 'ARCH_SLOT', name: 'S', timing: 'end_of_combat', thresholds: [{ count: 1, effects: [{ type: 'board_slot_bonus', value: 1 }] }] },
      { id: 'ARCH_DMG', name: 'D', timing: 'end_of_combat', thresholds: [{ count: 1, effects: [{ type: 'damage_multiplier_bonus', value: 2 }] }] },
      { id: 'ARCH_SHOP', name: 'H', timing: 'end_of_combat', thresholds: [{ count: 1, effects: [{ type: 'shopping_bonus', value: 1 }] }] },
    ];
    const board = makeBoard();
    const [e1, e2, e3] = units(board, [
      { id: 'E1', attrs: ['ARCH_SLOT'], col: 0, row: 7, side: 'enemy' },
      { id: 'E2', attrs: ['ARCH_DMG'], col: 1, row: 7, side: 'enemy' },
      { id: 'E3', attrs: ['ARCH_SHOP'], col: 2, row: 7, side: 'enemy' },
    ]);
    const am = new (AttributeManager as any)(attrs, [], [e1, e2, e3]);
    const result = am.applyEndOfCombat([], []);

    expect(result.board_slot_bonus).toBe(0);
    expect(result.damage_multiplier_bonus).toBe(0);
    expect(result.shopping_bonus).toBe(0);
  });
});

describe('AttributeManager — reapplyBonuses (POWER_DEBUFF)', () => {
  it('ré-applique les bonus start_of_combat après un reset', () => {
    const attrs = [{
      id: 'ARCH_W', name: 'W', timing: 'start_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 6 }] }],
    }];
    const board = makeBoard();
    const u = spawn(board, makeCard({ id: 'W1', attributes: ['ARCH_W'] }), 'player', { col: 0, row: 0 });
    const am = new (AttributeManager as any)(attrs, [u], []);
    am.applyStartOfCombat();
    expect(u.atk).toBe(11);

    u.resetCombatStats(); // POWER_DEBUFF
    expect(u.atk).toBe(5);
    am.reapplyBonuses(u);
    expect(u.atk).toBe(11);
  });
});

describe('AttributeManager — getActiveSynergies', () => {
  it('retourne compte, palier actif et palier suivant, trié par compte', () => {
    const attrs = [
      {
        id: 'ARCH_A', name: 'A', timing: 'start_of_combat',
        thresholds: [
          { count: 1, effects: [{ type: 'stat_bonus', stat: 'atk', value: 1 }] },
          { count: 3, effects: [{ type: 'stat_bonus', stat: 'atk', value: 3 }] },
        ],
      },
      { id: 'ARCH_VIDE', name: 'Archétype sans effet', timing: 'start_of_combat', thresholds: [] },
    ];
    const board = makeBoard();
    const list = units(board, [
      { id: 'U1', attrs: ['ARCH_A'], col: 0, row: 0 },
      { id: 'U2', attrs: ['ARCH_A', 'ARCH_VIDE'], col: 1, row: 0 },
    ]);
    const am = new (AttributeManager as any)(attrs, list, []);
    const syn = am.getActiveSynergies(list);

    expect(syn).toHaveLength(1); // ARCH_VIDE (sans thresholds) exclu
    expect(syn[0].count).toBe(2);
    expect(syn[0].activeThreshold.count).toBe(1);
    expect(syn[0].nextThreshold.count).toBe(3);
  });
});
