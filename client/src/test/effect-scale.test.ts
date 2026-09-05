/* eslint-disable @typescript-eslint/no-explicit-any */
// Le vocabulaire des échelles (`logic/EffectScale`).
//
// ⚠️ Ce module remplace TROIS lectures qui ne se parlaient pas : les deux de
// `value_per` sur un `stat_bonus` d'attribut, et le barème du bouclier, écrit
// en dur et nommé nulle part. Les cas ci-dessous portent donc deux charges —
// prouver ce qui est nouveau, et prouver que rien d'ancien n'a bougé.
import { describe, it, expect } from 'vitest';
import { effectScale, scaleAttributeId, ALLY_COUNT_SCALE, ENEMY_COUNT_SCALE, FLAT_SCALE } from '../logic/EffectScale.js';
import { AttributeManager, reviveIndex } from '../logic/AttributeManager.js';
import { applyBoardEffects } from '../logic/BoardEffect.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

const unit = (attrs: string[], alive = true) => ({ isAlive: () => alive, attributes: attrs });

describe('effectScale — le vocabulaire', () => {
  const mine = [unit(['ARCH_A']), unit(['ARCH_A', 'ARCH_B']), unit([], false)];
  const theirs = [unit(['ARCH_A']), unit(['ARCH_C']), unit(['ARCH_C'])];

  it('absent vaut ×1 — jamais ×0', () => {
    // ⚠️ C'est la moitié qui compte : rendre 0 sur l'absence ferait taire tout
    // effet sans échelle, la panne exacte d'`active_unit`.
    expect(effectScale(null, mine, theirs)).toBe(1);
    expect(effectScale(undefined, mine, theirs)).toBe(1);
    expect(effectScale('', mine, theirs)).toBe(1);
  });

  it('`one` vaut ×1 explicitement', () => {
    expect(effectScale(FLAT_SCALE, mine, theirs)).toBe(1);
  });

  it('`active_unit` compte MES alliés vivants', () => {
    expect(effectScale(ALLY_COUNT_SCALE, mine, theirs)).toBe(2);
  });

  it('`enemy_unit` compte les ennemis vivants', () => {
    expect(effectScale(ENEMY_COUNT_SCALE, mine, theirs)).toBe(3);
  });

  it('un id NU compte les unités D\'EN FACE — la forme historique', () => {
    expect(effectScale('ARCH_C', mine, theirs)).toBe(2);
    expect(effectScale('ARCH_B', mine, theirs)).toBe(0);
  });

  it('`enemy:` dit la même chose que l\'id nu', () => {
    for (const id of ['ARCH_A', 'ARCH_B', 'ARCH_C']) {
      expect(effectScale(`enemy:${id}`, mine, theirs)).toBe(effectScale(id, mine, theirs));
    }
  });

  it('`ally:` compte de MON côté — ce que rien ne savait dire', () => {
    expect(effectScale('ally:ARCH_A', mine, theirs)).toBe(2);
    expect(effectScale('ally:ARCH_B', mine, theirs)).toBe(1);
    expect(effectScale('ally:ARCH_C', mine, theirs)).toBe(0);
  });

  it('les morts ne comptent d\'aucun côté', () => {
    const dead = [unit(['ARCH_A'], false), unit(['ARCH_A'], false)];
    expect(effectScale(ALLY_COUNT_SCALE, dead, theirs)).toBe(0);
    expect(effectScale('ARCH_A', mine, dead)).toBe(0);
  });

  it('scaleAttributeId nomme l\'attribut d\'une échelle, ou rien', () => {
    expect(scaleAttributeId('ARCH_A')).toBe('ARCH_A');
    expect(scaleAttributeId('ally:ARCH_A')).toBe('ARCH_A');
    expect(scaleAttributeId('enemy:ARCH_A')).toBe('ARCH_A');
    for (const s of [null, undefined, FLAT_SCALE, ALLY_COUNT_SCALE, ENEMY_COUNT_SCALE]) {
      expect(scaleAttributeId(s)).toBeNull();
    }
  });
});

describe('Échelle sur un ATTRIBUT', () => {
  function play(effect: any, attrId = 'ARCH_X') {
    const board = makeBoard();
    const mk = (id: string, side: 'player' | 'enemy', col: number, row: number, attrs: string[]) =>
      spawn(board, makeCard({ id, attributes: attrs, stats: { atk: 10, hp: 100 } as any }), side, { col, row });
    const player = [mk('P1', 'player', 0, 0, [attrId]), mk('P2', 'player', 1, 0, [attrId, 'ARCH_PET'])];
    const enemy = [mk('E1', 'enemy', 0, 10, ['ARCH_PET']), mk('E2', 'enemy', 1, 10, ['ARCH_PET']), mk('E3', 'enemy', 2, 10, [])];
    const attrs = [{ id: attrId, name: 'X', timing: 'start_of_combat', thresholds: [{ count: 1, effects: [effect] }] }];
    new (AttributeManager as any)(attrs, player, enemy).applyStartOfCombat();
    return { player, enemy };
  }

  it('`ally:` sur un stat_bonus — nouveau, et impossible avant', () => {
    // Sous l'ancienne lecture, `ally:ARCH_PET` n'était l'attribut de personne :
    // le filtre rendait 0, donc un bonus nul, donc rien du tout.
    const { player } = play({ type: 'stat_bonus', stat: 'atk', value: 4, value_per: 'ally:ARCH_PET' });
    expect(player[0].atk).toBe(10 + 4 * 1);
  });

  it('`enemy_unit` sur un stat_bonus', () => {
    const { player } = play({ type: 'stat_bonus', stat: 'atk', value: 2, value_per: 'enemy_unit' });
    expect(player[0].atk).toBe(10 + 2 * 3);
  });

  it('un id nu compte toujours les porteurs d\'en face', () => {
    const { player } = play({ type: 'stat_bonus', stat: 'atk', value: 5, value_per: 'ARCH_PET' });
    expect(player[0].atk).toBe(10 + 5 * 2);
  });

  // ⚠️ Les deux cas du BOUCLIER : son barème par défaut, et le seul moyen d'y
  // renoncer. Le premier est un non-changement qu'il faut prouver, le second
  // est ce que le défaut déclaré rend enfin possible.
  it('le bouclier garde son barème × alliés vivants, sans value_per', () => {
    const { player } = play({ type: 'shield', value: 50 });
    expect(player[0].shield).toBe(50 * 2);
  });

  it('`one` rend le bouclier PLAT — inexprimable tant que le barème était en dur', () => {
    const { player } = play({ type: 'shield', value: 50, value_per: 'one' });
    expect(player[0].shield).toBe(50);
  });

  it('le bouclier accepte les autres échelles comme tout le monde', () => {
    const { player } = play({ type: 'shield', value: 10, value_per: 'ARCH_PET' });
    expect(player[0].shield).toBe(10 * 2);
  });
});

describe('Échelle sur un TERRAIN', () => {
  function play(effect: any) {
    const board = makeBoard();
    const mk = (id: string, side: 'player' | 'enemy', col: number, row: number) =>
      spawn(board, makeCard({ id, attributes: ['ARCH_X'], stats: { atk: 10, hp: 100 } as any }), side, { col, row });
    // Deux camps de tailles DIFFÉRENTES : c'est la seule façon de voir que
    // l'échelle se compte bien dans le camp de la cible, et non une fois pour
    // tout l'effet.
    const player = [mk('P1', 'player', 0, 0), mk('P2', 'player', 1, 0), mk('P3', 'player', 2, 0)];
    const enemy = [mk('E1', 'enemy', 0, 10)];
    applyBoardEffects({ id: 'B', name: 'B', effects: [effect] } as any,
      { playerUnits: player, enemyUnits: enemy, gameState: null } as any);
    return { player, enemy };
  }

  it('chaque camp compte SES alliés — pas ceux de l\'effet', () => {
    const { player, enemy } = play({ type: 'stat_bonus', stat: 'atk', value: 3, value_per: 'active_unit' });
    expect(player[0].atk).toBe(10 + 3 * 3);
    expect(enemy[0].atk).toBe(10 + 3 * 1);
  });

  it('sans value_per, un terrain est inchangé — ×1', () => {
    const { player, enemy } = play({ type: 'stat_bonus', stat: 'atk', value: 3 });
    expect(player[0].atk).toBe(13);
    expect(enemy[0].atk).toBe(13);
  });

  it('le bouclier de terrain n\'a AUCUN défaut, contrairement à celui d\'attribut', () => {
    // ⚠️ Les deux `shield` portent le même nom et pas le même barème : celui
    // d'attribut multiplie par les alliés, celui de terrain non. Le registre le
    // dit domaine par domaine ; ce test le prouve.
    const { player } = play({ type: 'shield', value: 20 });
    expect(player[0].shield).toBe(20);
  });

  it('un stat_modifier ne s\'échelonne PAS — c\'est un facteur, pas un montant', () => {
    const { player } = play({ type: 'stat_modifier', stat: 'atk', value: 2, value_per: 'active_unit' });
    expect(player[0].atk).toBe(20);
  });
});

describe('Cible d\'un revive d\'attribut', () => {
  function play(target: string | undefined) {
    const board = makeBoard();
    const mk = (id: string, hp: number, atk: number, col: number) =>
      spawn(board, makeCard({ id, attributes: ['ARCH_N'], stats: { atk, hp } as any }), 'player', { col, row: 0 });
    // Ordre de MORT volontairement décorrélé des stats : sans ça, « le premier »
    // et « le plus costaud » désigneraient la même unité et le test serait vert
    // quelle que soit la règle.
    const morts = [mk('M_FIRST', 50, 30, 0), mk('M_TANK', 300, 5, 1), mk('M_HITTER', 80, 90, 2)];
    for (const u of morts) { u.is_neutralized = true; u.current_hp = 0; }
    const attrs = [{
      id: 'ARCH_N', name: 'N', timing: 'end_of_combat',
      thresholds: [{ count: 1, effects: [{ type: 'revive', hp_percent: 50, ...(target ? { target } : {}) }] }],
    }];
    const am = new (AttributeManager as any)(attrs, morts, []);
    const result = am.applyEndOfCombat([...morts], []);
    return result.revived.map((u: any) => u.card_id);
  }

  it('sans cible, relève la PREMIÈRE morte — le comportement d\'avant', () => {
    expect(play(undefined)).toEqual(['M_FIRST']);
  });

  it('`highest_hp` relève la plus résistante', () => {
    expect(play('highest_hp')).toEqual(['M_TANK']);
  });

  it('`highest_atk` relève la plus offensive', () => {
    expect(play('highest_atk')).toEqual(['M_HITTER']);
  });

  it('une cible inconnue retombe sur la première, jamais sur rien', () => {
    // ⚠️ Un `revive` qui ne relève personne serait muet, et c'est très
    // exactement le mode de panne que ce lot supprime.
    expect(play('ce_nest_pas_une_cible')).toEqual(['M_FIRST']);
  });
});

describe('reviveIndex — déterminisme', () => {
  it('départage par card_id à stat égale', () => {
    const u = (id: string, hp: number) => ({ card_id: id, max_hp: hp, atk: 1 });
    // ⚠️ L'ordre de la liste ne doit RIEN décider : deux clients PvP la
    // construisent depuis leurs propres morts, et une réanimation change les
    // survivants donc les dégâts.
    expect(reviveIndex('highest_hp', [u('B', 100), u('A', 100), u('C', 100)])).toBe(1);
    expect(reviveIndex('highest_hp', [u('C', 100), u('A', 100), u('B', 100)])).toBe(1);
  });

  it('une liste vide ne jette pas', () => {
    expect(reviveIndex('highest_hp', [])).toBe(0);
  });
});
