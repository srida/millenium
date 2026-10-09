/* eslint-disable @typescript-eslint/no-explicit-any */
// Un token né EN COMBAT porte son rôle (et ses mots-clés) comme une carte :
// `AttributeManager.applyTokenStatuses`, appelé par `CombatManager._summonToken`
// et par `GameSession.startCombat` pour les tokens d'attribut ou de terrain.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttributeManager } from '../logic/AttributeManager.js';
import { CombatManager } from '../logic/CombatManager.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const attributs: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));
const TANK = 'ARCH_110';
const TOUR = 'ARCH_097';

function summonToken(attributes: string[]) {
  const def = {
    id: 'TOK_ROLE', name: 'Esprit', attributes,
    stats: { atk: 3, hp: 12, movement_rate: 80, attack_rate: 80, range: 1 },
  };
  const board = makeBoard();
  const caster = spawn(board, makeCard({
    id: 'P_CASTER', power: { id: 'POWER_SUMMON_TOKEN', power_rate: 100, token_id: def.id } as any,
    stats: { atk: 10, hp: 100, attack_rate: 100, movement_rate: 100, range: 1 },
  }), 'player', { col: 2, row: 2 });
  const am = new (AttributeManager as any)(attributs, [caster], [], null);
  am.applyStartOfCombat();
  const combat = new (CombatManager as any)(board, [caster], [], am, { getToken: () => def });
  expect(combat._firePower(caster, null, [])).toBe(true);
  return combat.playerUnits.find((u: any) => u.is_token);
}

describe('Rôle d\'un token invoqué en combat', () => {
  it('un token Tank prend la politique de déplacement du Tank', () => {
    expect(summonToken([TANK]).move_policy).toBe('tank');
  });

  it('un token Tour est immobile et reçoit sa portée', () => {
    const t = summonToken([TOUR]);
    expect(t.is_immobile).toBe(true);
    expect(t.range).toBe(21);
  });

  it('un token sans rôle reste un Fantassin', () => {
    const t = summonToken([]);
    expect(t.move_policy).not.toBe('tank');
    expect(t.is_immobile).toBe(false);
  });
});
