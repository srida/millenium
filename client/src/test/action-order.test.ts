/* eslint-disable @typescript-eslint/no-explicit-any */
// L'ORDRE D'ACTION d'un step de combat.
//
// Il n'y a plus de stat d'initiative : elle ne se lisait nulle part ailleurs
// que dans ce tri, ne s'expliquait donc par rien de ce que le joueur voit sur
// la carte, et il fallait lui trouver une place dans chaque écran qui montre
// une unité. Quatre critères qu'il lit déjà la remplacent, du plus parlant au
// plus arbitraire :
//
//   tier décroissant → ATQ décroissante → vitesse de DÉPLACEMENT décroissante
//   → `card_id` croissante → le camp, dans le repère de référence
//
// ⚠️ Les trois premiers sont des valeurs de COMBAT (bonus compris) et non des
// champs de carte : un buff d'ATQ fait passer devant. Les trois voyagent déjà
// dans `round:board_ready` — `tier` se dérive du catalogue commun aux deux
// clients, `atk` et `movement_rate` de `base` —, donc le contrat de
// déterminisme est tenu sans un champ de plus.
//
// L'ordre ne s'observe pas directement : on le lit dans la SUITE des `attack`
// d'un même step, qui est exactement ce que le tri décide.
import { describe, it, expect } from 'vitest';
import { makeBoard, makeCard, spawn } from './helpers.js';
import { CombatManager } from '../logic/CombatManager.js';

/**
 * Les `card_id` du premier step où tout le monde frappe, dans l'ordre.
 *
 * Toutes les unités portent la PORTÉE MAXIMALE (9) et un rythme d'attaque
 * plein : personne n'a besoin d'avancer, et elles frappent toutes au même
 * step. La seule chose qui les sépare est donc l'ordre du tri.
 *
 * ⚠️ Le premier step n'en porte aucune : `attack_timer` monte AVANT d'être
 * comparé à la période, et le plancher de l'échelle est de 2 ticks (compteur
 * 100). On avance donc jusqu'au premier step qui frappe.
 */
function attackOrder(units: { id: string; atk: number; tier?: number; move?: number }[]): string[] {
  const board = makeBoard();
  const player: any[] = [];
  units.forEach((u, i) => {
    const card = makeCard({
      id: u.id,
      tier: u.tier ?? 1,
      stats: { atk: u.atk, hp: 9999, attack_rate: 100, movement_rate: u.move ?? 50, range: 9 },
    });
    player.push(spawn(board, card, 'player', { col: i, row: 3 }));
  });
  // Un sac de frappe unique : il encaisse tout le step sans jamais tomber, et
  // n'émet rien lui-même (ATQ 0, rythme d'attaque le plus lent de l'échelle).
  const cible = spawn(board, makeCard({
    id: 'ZZ_CIBLE', stats: { atk: 0, hp: 999999, attack_rate: 0, movement_rate: 0, range: 1 },
  }), 'enemy', { col: 2, row: 7 });

  return firstAttackStep(new (CombatManager as any)(board, player, [cible], null));
}

/** Les attaquants du premier step qui en porte, dans l'ordre d'émission. */
function firstAttackStep(combat: any): string[] {
  for (let i = 0; i < 10; i++) {
    const hits = combat.step()
      .filter((e: any) => e.type === 'attack')
      .map((e: any) => e.attacker.card_id);
    if (hits.length) return hits;
  }
  return [];
}

describe('ordre d\'action du combat', () => {
  // Mutation : retirer `b.tier - a.tier` du comparateur → ROUGE (l'ATQ, qui
  // pointe ici dans l'autre sens, reprendrait la main).
  it('le TIER LE PLUS HAUT passe devant, quelle que soit l\'ATQ', () => {
    expect(attackOrder([
      { id: 'A_PETIT', tier: 1, atk: 90 },
      { id: 'B_GROS', tier: 5, atk: 10 },
      { id: 'C_MOYEN', tier: 3, atk: 50 },
    ])).toEqual(['B_GROS', 'C_MOYEN', 'A_PETIT']);
  });

  // Mutation : retirer `b.atk - a.atk` → ROUGE (le `card_id` trierait à
  // l'envers de l'ATQ).
  it('à tier égal, la plus grosse ATQ frappe la première', () => {
    expect(attackOrder([
      { id: 'A_FAIBLE', tier: 2, atk: 5 },
      { id: 'B_FORT', tier: 2, atk: 40 },
      { id: 'C_MOYEN', tier: 2, atk: 20 },
    ])).toEqual(['B_FORT', 'C_MOYEN', 'A_FAIBLE']);
  });

  // Mutation : comparer la PÉRIODE (`movement_period`) au lieu du compteur, ou
  // inverser le sens → ROUGE. C'est l'erreur exacte que le départage d'avant
  // portait légitimement, quand la donnée saisie ÉTAIT une période.
  it('à tier et ATQ égaux, le DÉPLACEMENT le plus rapide passe devant', () => {
    expect(attackOrder([
      { id: 'A_LENT', tier: 2, atk: 10, move: 10 },
      { id: 'B_RAPIDE', tier: 2, atk: 10, move: 100 },
      { id: 'C_MOYEN', tier: 2, atk: 10, move: 55 },
    ])).toEqual(['B_RAPIDE', 'C_MOYEN', 'A_LENT']);
  });

  // ⚠️ `card_id` est une valeur ABSOLUE, identique sur les deux clients d'un
  // PvP, là où l'ordre d'insertion dans le tableau ne l'est pas. Sans lui, deux
  // unités à égalité parfaite s'ordonneraient par la façon dont le joueur les a
  // posées — donc dans l'ordre inverse d'un client à l'autre.
  // Mutation : retirer le `localeCompare` → ROUGE.
  it('à égalité complète, le `card_id` croissant tranche', () => {
    expect(attackOrder([
      { id: 'C_TROIS', tier: 2, atk: 10, move: 50 },
      { id: 'A_UN', tier: 2, atk: 10, move: 50 },
      { id: 'B_DEUX', tier: 2, atk: 10, move: 50 },
    ])).toEqual(['A_UN', 'B_DEUX', 'C_TROIS']);
  });

  // ⚠️ Le tri lit la valeur de COMBAT, pas le champ de la carte : c'est ce qui
  // rend un bonus de Shopping ou d'attribut lisible dans l'ordre d'action.
  // Mutation : comparer `_base.atk` → ROUGE.
  it('un bonus d\'ATQ fait passer devant', () => {
    const board = makeBoard();
    const buffé = spawn(board, makeCard({
      id: 'B_BUFFE', tier: 2, stats: { atk: 10, hp: 9999, attack_rate: 100, movement_rate: 50, range: 9 },
    }), 'player', { col: 0, row: 3 });
    const gros = spawn(board, makeCard({
      id: 'A_GROS', tier: 2, stats: { atk: 30, hp: 9999, attack_rate: 100, movement_rate: 50, range: 9 },
    }), 'player', { col: 1, row: 3 });
    const cible = spawn(board, makeCard({
      id: 'ZZ_CIBLE', stats: { atk: 0, hp: 999999, attack_rate: 0, movement_rate: 0, range: 1 },
    }), 'enemy', { col: 2, row: 7 });

    buffé.applyStatBonus('atk', 50); // 10 → 60, devant les 30 de A_GROS

    const combat = new (CombatManager as any)(board, [buffé, gros], [cible], null);
    expect(firstAttackStep(combat)).toEqual(['B_BUFFE', 'A_GROS']);
  });
});
