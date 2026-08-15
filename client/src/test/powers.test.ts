/* eslint-disable @typescript-eslint/no-explicit-any */
// Golden tests du champ `power.value` des cartes (admin : « Valeur »).
//
// Chaque pouvoir chiffré lit cette valeur ; sans elle, il retombe sur sa
// constante. Ce fichier verrouille les DEUX branches pour chacun — une
// surcharge silencieusement ignorée (l'état d'avant) ne se voit nulle part
// dans le jeu : la carte annonce 100 de soin et en rend 40.
//
// On tape `_firePower` directement : c'est le seul entonnoir par lequel passe
// un pouvoir, et le viser en clair évite de faire dépendre l'assertion d'un
// scénario de combat (positions, portées, initiative) qui n'est pas le sujet.
import { describe, it, expect } from 'vitest';
import { makeBoard, makeCard, spawn } from './helpers.js';
import { CombatManager } from '../logic/CombatManager.js';

// Un lanceur, une cible, un allié blessé — de quoi couvrir les trois formes de
// pouvoir (sur soi, sur l'ennemi, sur l'allié le plus bas) sans rejouer un combat.
function arena(power: any, casterStats: any = {}) {
  const board = makeBoard();
  const caster = spawn(board, makeCard({
    id: 'P_CASTER', power,
    stats: { atk: 10, hp: 200, attack_speed: 2, initiative: 5, movement_speed: 1, range: 3, ...casterStats },
  }), 'player', { col: 2, row: 3 });
  const ally = spawn(board, makeCard({
    id: 'P_ALLY', stats: { atk: 5, hp: 100, attack_speed: 2, initiative: 4, movement_speed: 1, range: 1 },
  }), 'player', { col: 1, row: 3 });
  const target = spawn(board, makeCard({
    id: 'E_TARGET', stats: { atk: 5, hp: 500, attack_speed: 2, initiative: 3, movement_speed: 1, range: 1 },
  }), 'enemy', { col: 2, row: 7 });
  const target2 = spawn(board, makeCard({
    id: 'E_TARGET_2', stats: { atk: 5, hp: 500, attack_speed: 2, initiative: 3, movement_speed: 1, range: 1 },
  }), 'enemy', { col: 3, row: 7 });

  const combat = new (CombatManager as any)(board, [caster, ally], [target, target2], null);
  const fire = () => { const events: any[] = []; combat._firePower(caster, target, events); return events; };
  return { board, combat, caster, ally, target, target2, fire };
}

describe('power.value — surcharge par carte', () => {
  it('POWER_HEAL : `value` = PV plats rendus', () => {
    const a = arena({ id: 'POWER_HEAL', power_speed: 1, value: 80 });
    a.ally.current_hp = 10;
    a.fire();
    expect(a.ally.current_hp).toBe(90);
  });

  it('POWER_HEAL sans `value` : 40 % du max_hp du LANCEUR', () => {
    const a = arena({ id: 'POWER_HEAL', power_speed: 1 });   // caster max_hp = 200
    a.ally.current_hp = 10;
    a.fire();
    expect(a.ally.current_hp).toBe(10 + 80);
  });

  it('POWER_SHIELD : `value` = bouclier plat — le seul barème utilisable par un mur à 1 ATK', () => {
    const a = arena({ id: 'POWER_SHIELD', power_speed: 1, value: 80 }, { atk: 1 });
    a.fire();
    expect(a.caster.shield).toBe(80);
  });

  it('POWER_SHIELD sans `value` : atk × 2', () => {
    const a = arena({ id: 'POWER_SHIELD', power_speed: 1 });  // atk = 10
    a.fire();
    expect(a.caster.shield).toBe(20);
  });

  it('POWER_SUPER_ATTACK : `value` = dégâts plats', () => {
    const a = arena({ id: 'POWER_SUPER_ATTACK', power_speed: 1, value: 150 });
    a.fire();
    expect(a.target.current_hp).toBe(500 - 150);
  });

  it('POWER_SUPER_ATTACK sans `value` : atk × 3', () => {
    const a = arena({ id: 'POWER_SUPER_ATTACK', power_speed: 1 });
    a.fire();
    expect(a.target.current_hp).toBe(500 - 30);
  });

  it('POWER_AOE_ATTACK : `value` = dégâts plats, sur TOUS les ennemis vivants', () => {
    const a = arena({ id: 'POWER_AOE_ATTACK', power_speed: 1, value: 50 });
    a.fire();
    expect(a.target.current_hp).toBe(450);
    expect(a.target2.current_hp).toBe(450);
  });

  it('POWER_AOE_ATTACK sans `value` : atk', () => {
    const a = arena({ id: 'POWER_AOE_ATTACK', power_speed: 1 });
    a.fire();
    expect(a.target.current_hp).toBe(490);
    expect(a.target2.current_hp).toBe(490);
  });

  it('POWER_PARALYSIS : `value` = modificateur d\'attack_speed, pas la durée', () => {
    const a = arena({ id: 'POWER_PARALYSIS', power_speed: 1, value: 8 });
    a.fire();
    expect(a.target.attack_speed_modifier).toBe(8);
    expect(a.target.paralysis_remaining).toBe(20);   // durée inchangée
  });

  it('POWER_PARALYSIS sans `value` : modificateur 6', () => {
    const a = arena({ id: 'POWER_PARALYSIS', power_speed: 1 });
    a.fire();
    expect(a.target.attack_speed_modifier).toBe(6);
  });

  it('POWER_BLOCK : `value` = nombre de steps', () => {
    const a = arena({ id: 'POWER_BLOCK', power_speed: 1, value: 40 });
    a.fire();
    expect(a.target.is_power_blocked).toBe(true);
    expect(a.target.power_block_remaining).toBe(40);
  });

  it('POWER_BLOCK sans `value` : 25 steps', () => {
    const a = arena({ id: 'POWER_BLOCK', power_speed: 1 });
    a.fire();
    expect(a.target.power_block_remaining).toBe(25);
  });

  it('POWER_CONFUSION : `value` = nombre de steps', () => {
    const a = arena({ id: 'POWER_CONFUSION', power_speed: 1, value: 35 });
    a.fire();
    expect(a.target.confusion_remaining).toBe(35);
  });

  it('POWER_CONFUSION sans `value` : 20 steps', () => {
    const a = arena({ id: 'POWER_CONFUSION', power_speed: 1 });
    a.fire();
    expect(a.target.confusion_remaining).toBe(20);
  });

  it('POWER_POISON : `value` = dégâts PAR PULSE', () => {
    const a = arena({ id: 'POWER_POISON', power_speed: 1, value: 5 });
    a.fire();
    expect(a.target.dot_effects).toHaveLength(1);
    expect(a.target.dot_effects[0].damage).toBe(5);
  });

  it('POWER_POISON sans `value` : max(1, floor(atk / 2))', () => {
    const a = arena({ id: 'POWER_POISON', power_speed: 1 });   // atk = 10
    a.fire();
    expect(a.target.dot_effects[0].damage).toBe(5);
  });

  it('POWER_POISON : le plancher à 1 tient pour un lanceur à 1 ATK', () => {
    const a = arena({ id: 'POWER_POISON', power_speed: 1 }, { atk: 1 });
    a.fire();
    expect(a.target.dot_effects[0].damage).toBe(1);
  });

  it('POWER_BURN : `value` = dégâts PAR ATTAQUE de la cible', () => {
    const a = arena({ id: 'POWER_BURN', power_speed: 1, value: 12 });
    a.fire();
    expect(a.target.burn_stacks).toHaveLength(1);
    expect(a.target.burn_stacks[0].damage).toBe(12);
  });

  it('POWER_BURN sans `value` : max(1, floor(atk / 2))', () => {
    const a = arena({ id: 'POWER_BURN', power_speed: 1 });   // atk = 10
    a.fire();
    expect(a.target.burn_stacks[0].damage).toBe(5);
  });

  // ── La règle du 0 ──
  // `||` et non `??` : une Valeur laissée à 0 en admin doit retomber sur le
  // défaut. Le cas s'est produit (CORE_077, POWER_BLOCK value: 0) et l'aurait
  // rendu inerte sans que rien ne le signale.
  it('`value: 0` est lu comme absent, sur tous les pouvoirs chiffrés', () => {
    const block = arena({ id: 'POWER_BLOCK', power_speed: 1, value: 0 });
    block.fire();
    expect(block.target.power_block_remaining).toBe(25);   // le cas CORE_077

    const heal = arena({ id: 'POWER_HEAL', power_speed: 1, value: 0 });
    heal.ally.current_hp = 10;
    heal.fire();
    expect(heal.ally.current_hp).toBe(90);              // 40 % de 200, pas 0

    const push = arena({ id: 'POWER_PUSH', power_speed: 1, value: 0 });
    const before = { ...push.target.position };
    push.fire();
    expect(push.target.position).not.toEqual(before);   // repoussé de 2, pas de 0
  });
});

describe('POWER_POISON — durée infinie', () => {
  it('pulse toujours bien au-delà des 5 pulses de l\'ancien barème', () => {
    const a = arena({ id: 'POWER_POISON', power_speed: 9999, value: 5 });
    a.fire();

    // 20 pulses = 4× l'ancienne durée. Le DOT bat tous les 3 steps.
    let pulses = 0;
    for (let i = 0; i < 20 * 3; i++) {
      for (const e of a.combat.step()) if (e.type === 'dot' && e.unit === a.target) pulses++;
      if (a.combat.isOver) break;
    }
    expect(pulses).toBe(20);
    expect(a.target.dot_effects).toHaveLength(1);   // jamais purgé par lui-même
  });

  it('le poison ne survit PAS au combat : resetCombatStats le purge', () => {
    const a = arena({ id: 'POWER_POISON', power_speed: 1, value: 5 });
    a.fire();
    expect(a.target.dot_effects).toHaveLength(1);
    a.target.resetCombatStats();
    expect(a.target.dot_effects).toEqual([]);
  });

  it('POWER_DEBUFF nettoie un poison devenu permanent', () => {
    const a = arena({ id: 'POWER_POISON', power_speed: 1, value: 5 });
    a.fire();
    const cleanser = arena({ id: 'POWER_DEBUFF', power_speed: 1 });
    cleanser.combat._firePower(cleanser.caster, a.target, []);
    expect(a.target.dot_effects).toEqual([]);
  });

  it('⚠️ les poisons CUMULENT, et plus rien ne les fait expirer', () => {
    const a = arena({ id: 'POWER_POISON', power_speed: 1, value: 5 });
    a.fire(); a.fire(); a.fire();
    expect(a.target.dot_effects).toHaveLength(3);

    const hp = a.target.current_hp;
    for (let i = 0; i < 3; i++) a.combat.step();
    expect(hp - a.target.current_hp).toBeGreaterThanOrEqual(15);   // 3 stacks × 5
  });
});

describe('POWER_BURN — durée infinie', () => {
  it('brûle bien au-delà des 3 attaques de l\'ancien barème', () => {
    const a = arena({ id: 'POWER_BURN', power_speed: 1, value: 4 });
    a.fire();

    let pulses = 0;
    for (let i = 0; i < 20; i++) {
      const events: any[] = [];
      a.combat._applyBurnStacks(a.target, events);
      pulses += events.filter(e => e.type === 'dot').length;
    }
    expect(pulses).toBe(20);
    expect(a.target.burn_stacks).toHaveLength(1);   // jamais consommé
  });

  it('bat sur les ATTAQUES de la cible, pas sur l\'horloge — une cible qui n\'attaque pas ne brûle pas', () => {
    // La différence de fond avec le poison, et désormais la SEULE chose qui
    // borne la brûlure : personne n'attaque ici, donc rien ne brûle, là où un
    // poison aurait pulsé sept fois en 20 steps.
    const a = arena({ id: 'POWER_BURN', power_speed: 1, value: 4 });
    a.fire();
    for (const u of [a.caster, a.ally, a.target, a.target2]) u.attack_speed = 9999;

    const hp = a.target.current_hp;
    for (let i = 0; i < 20 && !a.combat.isOver; i++) a.combat.step();
    expect(a.target.current_hp).toBe(hp);
  });

  it('le feu ne survit PAS au combat : resetCombatStats le purge', () => {
    const a = arena({ id: 'POWER_BURN', power_speed: 1, value: 4 });
    a.fire();
    a.target.resetCombatStats();
    expect(a.target.burn_stacks).toEqual([]);
  });

  it('⚠️ les brûlures CUMULENT, et plus rien ne les fait expirer', () => {
    const a = arena({ id: 'POWER_BURN', power_speed: 1, value: 4 });
    a.fire(); a.fire(); a.fire();
    expect(a.target.burn_stacks).toHaveLength(3);

    const hp = a.target.current_hp;
    a.combat._applyBurnStacks(a.target, []);
    expect(hp - a.target.current_hp).toBe(12);   // 3 piles × 4, sur une attaque
  });
});
