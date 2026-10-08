/* eslint-disable @typescript-eslint/no-explicit-any */
// LES RÔLES — un par carte, et la ligne du Tank.
//
// Tant qu'un Tank n'a ni attaqué ni été attaqué, aucun allié ne marche au-delà
// de sa rangée (`CombatManager._beyondTankLine`). Chaque cas est doublé de son
// témoin sans Tank : sans lui, un allié qui « ne passe pas » pourrait
// simplement ne pas avoir eu le temps de passer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CombatManager } from '../logic/CombatManager.js';
import { makeCard, spawn, makeBoard } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (f: string) => JSON.parse(readFileSync(path.join(ROOT, 'initial-data', f), 'utf8'));

function carte(id: string, stats: any = {}) {
  return makeCard({ id, stats: { atk: 0, hp: 500, range: 1, attack_rate: 0, movement_rate: 0, ...stats } });
}

function joue(board: any, joueur: any[], ennemi: any[], n: number) {
  const combat = new (CombatManager as any)(board, joueur, ennemi, null);
  for (let i = 0; i < n && !combat.isOver; i++) combat.step();
}

/** Un Tank lent en rangée 1, un allié rapide derrière lui, un ennemi au fond. */
function scene({ tank = true } = {}) {
  const board = makeBoard();
  const t = spawn(board, carte('TANK'), 'player', { col: 2, row: 1 });
  if (tank) t.move_policy = 'tank';
  const allie = spawn(board, carte('ALLIE', { movement_rate: 100 }), 'player', { col: 0, row: 0 });
  const e = spawn(board, carte('E'), 'enemy', { col: 0, row: 10 });
  return { board, t, allie, e };
}

describe('La ligne du Tank', () => {
  it('un allié ne dépasse pas la rangée d\'un Tank non engagé', () => {
    const { board, t, allie, e } = scene();
    joue(board, [t, allie], [e], 40);
    expect(t.tank_engaged).toBe(false);
    expect(allie.position.row).toBeLessThanOrEqual(t.position.row);
  });

  it('témoin : sans Tank, le même allié traverse', () => {
    const { board, t, allie, e } = scene({ tank: false });
    joue(board, [t, allie], [e], 40);
    expect(allie.position.row).toBeGreaterThan(t.position.row);
  });

  it('un Tank engagé ne retient plus personne', () => {
    const { board, t, allie, e } = scene();
    t.tank_engaged = true;
    joue(board, [t, allie], [e], 40);
    expect(allie.position.row).toBeGreaterThan(t.position.row);
  });

  it('encaisser un coup engage le Tank, bouclier compris', () => {
    const { t } = scene();
    t.shield = 50;
    t.takeDamage(10);
    expect(t.tank_engaged).toBe(true);
  });

  it('frapper engage le Tank', () => {
    const board = makeBoard();
    const t = spawn(board, carte('TANK', { atk: 1, range: 14, attack_rate: 100 }), 'player', { col: 2, row: 3 });
    t.move_policy = 'tank';
    const e = spawn(board, carte('E', { hp: 10_000 }), 'enemy', { col: 2, row: 7 });
    joue(board, [t], [e], 10);
    expect(t.tank_engaged).toBe(true);
  });

  it('vaut pour le camp ennemi, dans son sens de marche', () => {
    const board = makeBoard();
    const t = spawn(board, carte('TANK'), 'enemy', { col: 2, row: 9 });
    t.move_policy = 'tank';
    const allie = spawn(board, carte('ALLIE', { movement_rate: 100 }), 'enemy', { col: 0, row: 10 });
    const p = spawn(board, carte('P'), 'player', { col: 0, row: 0 });
    joue(board, [p], [t, allie], 40);
    expect(allie.position.row).toBeGreaterThanOrEqual(t.position.row);
  });

  it('se remet à zéro au début du combat suivant', () => {
    const { t } = scene();
    t.tank_engaged = true;
    t.resetKeywordStatuses();
    expect([t.move_policy, t.tank_engaged]).toEqual(['normal', false]);
  });
});

describe('Les rôles livrés', () => {
  const attrs: any[] = load('attributes.json');
  const cards: any[] = load('cards.json');
  const roles = attrs.filter(a => a.categorie === 'Role');

  it('six rôles, dont un seul sans effet (Fantassin)', () => {
    expect(roles.map(r => r.name).sort()).toEqual(['Archer', 'Assassin', 'Fantassin', 'Lancier', 'Soutien', 'Tank']);
    expect(roles.filter(r => !(r.thresholds?.length))).toHaveLength(1);
  });

  it('chaque carte porte exactement un rôle', () => {
    const ids = new Set(roles.map(r => r.id));
    const fautes = cards.filter(c => (c.attributes ?? []).filter((id: string) => ids.has(id)).length !== 1).map(c => c.id);
    expect(fautes).toEqual([]);
  });

  it('les anciens mots-clés de déplacement ne sont plus des mots-clés', () => {
    const types = ['tireur_elite', 'chasseur', 'briseur', 'embusque', 'garde_du_corps', 'flanc'];
    const restants = attrs.filter(a => a.categorie === 'MotCle'
      && a.thresholds?.some((t: any) => t.effects?.some((e: any) => types.includes(e.type))));
    expect(restants.map(a => a.id)).toEqual([]);
  });
});

describe('La ligne de l\'Archer', () => {
  /** Un allié lent en rangée 2, un Archer rapide au fond, un ennemi loin. */
  function sceneArcher({ archer = true, camp = 'player' as 'player' | 'enemy' } = {}) {
    const board = makeBoard();
    const r = (row: number) => (camp === 'player' ? row : 10 - row);
    const front = spawn(board, carte('FRONT'), camp, { col: 2, row: r(2) });
    const a = spawn(board, carte('ARCHER', { movement_rate: 100 }), camp, { col: 0, row: r(0) });
    if (archer) a.target_policy = 'plus_loin_a_portee';
    const autre = camp === 'player' ? 'enemy' : 'player';
    const e = spawn(board, carte('E'), autre, { col: 4, row: r(10) });
    return { board, front, a, e, camp };
  }
  const profondeur = (u: any, camp: string) => (camp === 'player' ? u.position.row : 10 - u.position.row);

  it('un Archer reste une rangée derrière l\'allié d\'un autre rôle le plus avancé', () => {
    const { board, front, a, e } = sceneArcher();
    joue(board, [front, a], [e], 40);
    expect(a.position.row).toBe(front.position.row - 1);
  });

  it('témoin : sans rôle d\'Archer, la même unité dépasse', () => {
    const { board, front, a, e } = sceneArcher({ archer: false });
    joue(board, [front, a], [e], 40);
    expect(a.position.row).toBeGreaterThan(front.position.row);
  });

  it('les autres Archers ne fixent pas la ligne', () => {
    const { board, front, a, e } = sceneArcher();
    const a2 = spawn(board, carte('ARCHER2'), 'player', { col: 4, row: 3 });
    a2.target_policy = 'plus_loin_a_portee';
    joue(board, [front, a, a2], [e], 40);
    expect(a.position.row).toBe(front.position.row - 1);
  });

  it('seul avec d\'autres Archers, il avance librement', () => {
    const board = makeBoard();
    const a = spawn(board, carte('ARCHER', { movement_rate: 100 }), 'player', { col: 0, row: 0 });
    a.target_policy = 'plus_loin_a_portee';
    const e = spawn(board, carte('E'), 'enemy', { col: 4, row: 10 });
    joue(board, [a], [e], 40);
    expect(a.position.row).toBeGreaterThan(1);
  });

  it('vaut pour le camp ennemi, dans son sens de marche', () => {
    const { board, front, a, e, camp } = sceneArcher({ camp: 'enemy' });
    joue(board, [e], [front, a], 40);
    expect(profondeur(a, camp)).toBe(profondeur(front, camp) - 1);
  });
});
