/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { applyEffect, needsUnitTarget, needsGraveyardTarget, needsHandTarget, effectLabel, magieCostHp, canAffordMagie } from '../logic/MagieEffect.js';
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
      'player_hp_bonus', 'board_slot_bonus', 'defuse_fusion', 'destroy_unit', 'reduce_materials',
      'remove_requirements', 'team_stat_bonus', 'drain_life',
      'hand_to_graveyard', 'team_heal', 'grant_power',
      'power_cooldown', 'damage_multiplier_bonus']) {
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

    applyEffect(magie({ type: 'reduce_materials', value: 1 }), { gameState: gs });
    applyEffect(magie({ type: 'remove_requirements' }), { gameState: gs });
    expect(gs.player_hand_modifiers).toEqual([
      { type: 'reduce_materials', value: 1, attribute: null },
      { type: 'remove_requirements', value: 1, attribute: null },
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

  it('remove_requirements : empile un modifier de main avec son compte', () => {
    const gs = new (GameState as any)();
    applyEffect(magie({ type: 'remove_requirements' }), { gameState: gs });
    applyEffect(magie({ type: 'remove_requirements', value: 2 }), { gameState: gs });
    expect(gs.player_hand_modifiers).toEqual([
      { type: 'remove_requirements', value: 1, attribute: null },
      { type: 'remove_requirements', value: 2, attribute: null },
    ]);
  });

  // ⚠️ L'attribut VOYAGE jusqu'au modificateur : la magie est jouée un tour
  // avant que la main retouchée n'existe, elle ne peut donc pas choisir la
  // carte elle-même. S'il n'était pas transporté, la magie visée retomberait
  // sur n'importe quelle carte — en silence.
  // Mutation : ne pas recopier `attribute` dans le push → ROUGE.
  it('la remise VISÉE transporte son attribut jusqu\'au tour suivant', () => {
    const gs = new (GameState as any)();
    applyEffect(magie({ type: 'reduce_materials', value: 2, attribute: 'ARCH_086' }), { gameState: gs });
    expect(gs.player_hand_modifiers).toEqual([
      { type: 'reduce_materials', value: 2, attribute: 'ARCH_086' },
    ]);
  });
});

describe('MagieEffect — pouvoirs (grant_power / power_cooldown)', () => {
  it('grant_power pose pouvoir, vitesse et valeur, et REMET la jauge à zéro', () => {
    const u = freshUnit({ power: { id: 'POWER_HEAL', power_speed: 30, value: null } });
    u.power_gauge = 29; // presque prêt à lancer l'ANCIEN pouvoir

    applyEffect(magie({ type: 'grant_power', power_id: 'POWER_FREEZE', power_speed: 12, value: 5 }), { targetUnit: u });

    expect(u.power_id).toBe('POWER_FREEZE');
    expect(u.power_speed).toBe(12);
    expect(u.power_value).toBe(5);
    // Sans cette remise à zéro, le pouvoir NEUF partirait au premier step sur
    // une jauge héritée de l'ancien — rien à l'écran ne l'annoncerait.
    expect(u.power_gauge).toBe(0);
  });

  it('grant_power donne un pouvoir à une unité qui n\'en avait aucun', () => {
    const u = freshUnit();
    expect(u.power_id).toBeNull();
    expect(u.power_speed).toBe(9999); // le défaut « pas de pouvoir »

    applyEffect(magie({ type: 'grant_power', power_id: 'POWER_TAUNT', power_speed: 15 }), { targetUnit: u });

    expect(u.power_id).toBe('POWER_TAUNT');
    expect(u.power_speed).toBe(15);
    expect(u.isPowerReady()).toBe(false);
  });

  it('grant_power lève un blocage de pouvoir en cours', () => {
    const u = freshUnit({ power: { id: 'POWER_HEAL', power_speed: 20, value: null } });
    u.is_power_blocked = true;
    u.power_block_remaining = 10;
    applyEffect(magie({ type: 'grant_power', power_id: 'POWER_POISON', power_speed: 8 }), { targetUnit: u });
    expect(u.is_power_blocked).toBe(false);
    expect(u.power_block_remaining).toBe(0);
  });

  it('grant_power sans power_id ne touche à rien', () => {
    const u = freshUnit({ power: { id: 'POWER_HEAL', power_speed: 20, value: null } });
    applyEffect(magie({ type: 'grant_power', power_speed: 5 }), { targetUnit: u });
    expect(u.power_id).toBe('POWER_HEAL');
    expect(u.power_speed).toBe(20);
  });

  it('power_cooldown DIVISE le seuil de jauge, il ne le soustrait pas', () => {
    // `power_speed` est un seuil : −4 plat ne veut pas dire la même chose sur
    // un pouvoir à 6 et sur un pouvoir à 40. La division, elle, veut dire
    // « deux fois plus souvent » quel que soit le rythme de départ.
    const lent = freshUnit({ power: { id: 'POWER_AOE_ATTACK', power_speed: 40, value: null } });
    const vif = freshUnit({ power: { id: 'POWER_HEAL', power_speed: 6, value: null } });

    applyEffect(magie({ type: 'power_cooldown', value: 2 }), { targetUnit: lent });
    applyEffect(magie({ type: 'power_cooldown', value: 2 }), { targetUnit: vif });

    expect(lent.power_speed).toBe(20);
    expect(vif.power_speed).toBe(3);
  });

  it('power_cooldown ne descend jamais sous 1, et se cumule', () => {
    const u = freshUnit({ power: { id: 'POWER_HEAL', power_speed: 10, value: null } });
    applyEffect(magie({ type: 'power_cooldown', value: 100 }), { targetUnit: u });
    expect(u.power_speed).toBe(1);
    applyEffect(magie({ type: 'power_cooldown', value: 2 }), { targetUnit: u });
    expect(u.power_speed).toBe(1);
  });

  it('power_cooldown ne fait rien sur une unité SANS pouvoir', () => {
    const u = freshUnit();
    applyEffect(magie({ type: 'power_cooldown', value: 2 }), { targetUnit: u });
    expect(u.power_speed).toBe(9999);
  });

  it('power_cooldown : une valeur absente ou absurde retombe sur un doublement', () => {
    for (const v of [undefined, 0, -3]) {
      const u = freshUnit({ power: { id: 'POWER_HEAL', power_speed: 20, value: null } });
      applyEffect(magie({ type: 'power_cooldown', value: v }), { targetUnit: u });
      expect(u.power_speed, String(v)).toBe(10);
    }
  });
});

describe('MagieEffect — damage_multiplier_bonus & pioche par voie', () => {
  it('damage_multiplier_bonus s\'accumule sur gameState', () => {
    const gs = new (GameState as any)();
    expect(gs.player_damage_multiplier_bonus).toBe(0);
    applyEffect(magie({ type: 'damage_multiplier_bonus', value: 0.5 }), { gameState: gs });
    applyEffect(magie({ type: 'damage_multiplier_bonus', value: 0.25 }), { gameState: gs });
    expect(gs.player_damage_multiplier_bonus).toBe(0.75);
  });

  // ⚠️ Le filtre `category` (la voie d'invocation) a disparu : les voies sont
  // devenues des attributs, et `attribute` les nomme déjà. Deux champs pour la
  // même exigence, c'était deux endroits où l'écrire — et un seul où la lire.
  it('guaranteed_draw transporte tier ET attribute, chacun facultatif', () => {
    const gs = new (GameState as any)();
    applyEffect(magie({ type: 'guaranteed_draw', tier: 3 }), { gameState: gs });
    applyEffect(magie({ type: 'guaranteed_draw', attribute: 'ARCH_086' }), { gameState: gs });
    applyEffect(magie({ type: 'guaranteed_draw', tier: 5, attribute: 'ARCH_089' }), { gameState: gs });
    expect(gs.player_guaranteed_draws).toEqual([
      { tier: 3, attribute: undefined },
      { tier: undefined, attribute: 'ARCH_086' },
      { tier: 5, attribute: 'ARCH_089' },
    ]);
  });
});

describe('MagieEffect — contrecoup en PV joueur', () => {
  const withCost = (cost: any) => ({ id: 'M', name: 'M', effect: { type: 'draw_bonus', value: 1 }, cost_hp: cost });

  it('magieCostHp lit le champ de PREMIER NIVEAU, arrondi', () => {
    expect(magieCostHp(withCost(120))).toBe(120);
    expect(magieCostHp(withCost(49.6))).toBe(50);
  });

  it('une donnée absente, nulle, négative ou illisible vaut « aucun contrecoup »', () => {
    // Une magie gratuite est le cas normal : c'est la lecture de repli sûre.
    // L'inverse ferait payer des PV sur une faute de saisie.
    expect(magieCostHp(magie({ type: 'draw_bonus' }))).toBe(0);
    for (const bad of [0, -50, null, undefined, NaN, 'cent', {}]) {
      expect(magieCostHp(withCost(bad)), String(bad)).toBe(0);
    }
    expect(magieCostHp(undefined)).toBe(0);
  });

  it('canAffordMagie est STRICT : payer laisse toujours 1 PV', () => {
    expect(canAffordMagie(withCost(100), 101)).toBe(true);
    // Payer exactement ses PV tuerait : refusé.
    expect(canAffordMagie(withCost(100), 100)).toBe(false);
    expect(canAffordMagie(withCost(100), 40)).toBe(false);
  });

  it('sans contrecoup, la règle se réduit à « le joueur est en vie »', () => {
    expect(canAffordMagie(magie({ type: 'draw_bonus' }), 1)).toBe(true);
    expect(canAffordMagie(magie({ type: 'draw_bonus' }), 0)).toBe(false);
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
