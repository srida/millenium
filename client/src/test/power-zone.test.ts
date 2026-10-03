/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { makeBoard, makeCard, spawn } from './helpers.js';
import { CombatManager } from '../logic/CombatManager.js';
import { zoneFor, ZONE_POWERS, ZONE_MIN, ZONE_MAX, clampZone } from '../../../speed-scale.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contract = require('../../../card-contract.js');

// La ZONE d'un pouvoir : un rayon de Manhattan autour de la cible (Attaque Zone)
// ou du lanceur (Provocation). Avant elle, les deux touchaient tout le plateau.

const still = { attack_rate: 100, movement_rate: 0, range: 1 };

function arena(power: any) {
  const board = makeBoard();
  const caster = spawn(board, makeCard({
    id: 'P_CASTER', power, stats: { atk: 10, hp: 500, ...still, range: 14 },
  }), 'player', { col: 2, row: 3 });
  // Trois ennemis : la cible, une voisine (distance 1 de la cible), une lointaine.
  const target = spawn(board, makeCard({ id: 'E_A', stats: { atk: 5, hp: 500, ...still } }), 'enemy', { col: 2, row: 7 });
  const near = spawn(board, makeCard({ id: 'E_B', stats: { atk: 5, hp: 500, ...still } }), 'enemy', { col: 3, row: 7 });
  const far = spawn(board, makeCard({ id: 'E_C', stats: { atk: 5, hp: 500, ...still } }), 'enemy', { col: 0, row: 10 });
  const combat = new (CombatManager as any)(board, [caster], [target, near, far], null);
  for (const u of [caster, target, near, far]) u.movement_period = 9999;
  const fire = (t: any = target) => {
    const events: any[] = [];
    combat._firePower(caster, t, events);
    return events;
  };
  return { board, combat, caster, target, near, far, fire };
}

describe('Attaque Zone — seulement la zone autour de la cible', () => {
  it('zone 1 : la cible et sa voisine, pas la lointaine', () => {
    const a = arena({ id: 'POWER_AOE_ATTACK', power_rate: 100, value: 40, zone: 1 });
    const ev = a.fire();
    expect(a.target.current_hp).toBe(460);
    expect(a.near.current_hp).toBe(460);
    expect(a.far.current_hp).toBe(500);
    expect(ev[0].targets[0]).toBe(a.target);   // la cible principale en tête (centre de l'onde)
    expect(ev[0].extra.zone).toBe(1);
  });

  it('zone 0 : la seule cible — 0 est une zone légitime, pas un champ vide', () => {
    const a = arena({ id: 'POWER_AOE_ATTACK', power_rate: 100, value: 40, zone: 0 });
    a.fire();
    expect(a.target.current_hp).toBe(460);
    expect(a.near.current_hp).toBe(500);
  });

  it('zone absente : le repli du pouvoir (1)', () => {
    const a = arena({ id: 'POWER_AOE_ATTACK', power_rate: 100, value: 40 });
    a.fire();
    expect(a.near.current_hp).toBe(460);
    expect(a.far.current_hp).toBe(500);
  });

  it('zone large : toute l\'équipe adverse', () => {
    const a = arena({ id: 'POWER_AOE_ATTACK', power_rate: 100, value: 40, zone: 14 });
    a.fire();
    expect(a.far.current_hp).toBe(460);
  });
});

describe('Provocation — un ÉTAT posé sur les ennemis de la zone du lanceur', () => {
  it('seuls les ennemis dans la zone sont provoqués', () => {
    // Lanceur (2,3) : E_A à 4, E_B à 5, E_C à 9.
    const a = arena({ id: 'POWER_TAUNT', power_rate: 100, zone: 5 });
    a.fire();
    expect(a.target.provoked_by).toBe(a.caster);
    expect(a.near.provoked_by).toBe(a.caster);
    expect(a.far.provoked_by).toBe(null);
    expect(a.target.provoked_remaining).toBeGreaterThan(0);
  });

  it('un ennemi provoqué ne peut cibler QUE son provocateur', () => {
    const a = arena({ id: 'POWER_TAUNT', power_rate: 100, zone: 5 });
    a.fire();
    expect(a.combat._targetCandidates(a.target, { requireLOS: false })).toEqual([a.caster]);
    // Le non-provoqué garde sa liste entière.
    expect(a.combat._targetCandidates(a.far, { requireLOS: false })).toEqual([a.caster]);
  });

  it('l\'immunité aux effets protège de la provocation', () => {
    const a = arena({ id: 'POWER_TAUNT', power_rate: 100, zone: 5 });
    a.near.is_effect_immune = true;
    const ev = a.fire();
    expect(a.near.provoked_by).toBe(null);
    expect(a.target.provoked_by).toBe(a.caster);
    expect(ev[0].extra.immune).toEqual([a.near]);
  });

  it('la provocation expire avec son décompte, et cesse à la mort du lanceur', () => {
    const a = arena({ id: 'POWER_TAUNT', power_rate: 100, zone: 5 });
    a.fire();
    expect(a.combat._provoker(a.target)).toBe(a.caster);
    a.caster.current_hp = 0; a.caster.is_neutralized = true;
    expect(a.combat._provoker(a.target)).toBe(null);
    a.caster.current_hp = 500; a.caster.is_neutralized = false;
    a.target.provoked_remaining = 1;
    a.combat.step();
    expect(a.target.provoked_remaining).toBe(0);
    expect(a.target.provoked_by).toBe(null);
  });

  it('resetCombatStats (Débuff) libère une victime', () => {
    const a = arena({ id: 'POWER_TAUNT', power_rate: 100, zone: 5 });
    a.fire();
    expect(a.combat._hasStrippableState(a.target)).toBe(true);
    a.target.resetCombatStats();
    expect(a.target.provoked_by).toBe(null);
    expect(a.target.provoked_remaining).toBe(0);
  });
});

describe('la donnée de zone', () => {
  it('zoneFor : la donnée, sinon le repli ; 0 n\'est PAS un champ vide', () => {
    expect(zoneFor('POWER_AOE_ATTACK', 0)).toBe(0);
    expect(zoneFor('POWER_AOE_ATTACK', null)).toBe(1);
    expect(zoneFor('POWER_TAUNT', undefined)).toBe(2);
    expect(zoneFor('POWER_TAUNT', 99)).toBe(ZONE_MAX);
    expect(clampZone('')).toBe(null);
  });

  it('le contrat de carte est le jumeau de speed-scale', () => {
    expect([...contract.ZONE_POWERS].sort()).toEqual([...ZONE_POWERS].sort());
    expect(contract.ZONE_MIN).toBe(ZONE_MIN);
    expect(contract.ZONE_MAX).toBe(ZONE_MAX);
  });

  it('missingZones : obligatoire sur les pouvoirs de zone, interdite ailleurs', () => {
    const c = (power: any) => ({ id: 'X', power });
    expect(contract.missingZones(c({ id: 'POWER_AOE_ATTACK', power_rate: 50 }))).toHaveLength(1);
    expect(contract.missingZones(c({ id: 'POWER_AOE_ATTACK', power_rate: 50, zone: 0 }))).toEqual([]);
    expect(contract.missingZones(c({ id: 'POWER_TAUNT', zone: 15 }))).toHaveLength(1);
    expect(contract.missingZones(c({ id: 'POWER_TAUNT', zone: 1.5 }))).toHaveLength(1);
    expect(contract.missingZones(c({ id: 'POWER_HEAL', zone: 1 }))).toHaveLength(1);
    expect(contract.missingZones(c({ id: 'POWER_HEAL' }))).toEqual([]);
  });

  it('le catalogue livré est repris (aucune carte de zone sans zone)', () => {
    const cards = require('../../../initial-data/cards.json');
    expect(cards.filter((x: any) => contract.missingZones(x).length)).toEqual([]);
  });
});
