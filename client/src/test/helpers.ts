/* eslint-disable @typescript-eslint/no-explicit-any */
// Harnais des golden tests de déterminisme (PLAN_REFONTE Phase 1).
// Les fixtures sont 100 % synthétiques : elles ne dépendent pas des données
// serveur (cards.json…), donc les snapshots restent stables même si le
// contenu du jeu évolue.
import { Unit } from '../logic/Unit.js';
import { Board } from '../logic/Board.js';
import { CombatManager } from '../logic/CombatManager.js';

export interface CardFixture {
  id: string;
  name: string;
  tier: number;
  summon_type: string;
  attributes: string[];
  represented_ids?: string[];
  power?: { id: string; power_speed: number; value?: number | null } | null;
  cost?: { sacrifice?: number; materials?: string[] };
  summon_options?: { summon_type: string; cost?: { sacrifice?: number; materials?: string[] } }[];
  stats: {
    atk: number; hp: number; movement_speed: number;
    attack_speed: number; initiative: number; range: number;
  };
}

let cardSeq = 0;

export function makeCard(overrides: Partial<CardFixture> & { id?: string } = {}): CardFixture {
  const { stats, ...rest } = overrides;
  return {
    id: overrides.id ?? `FIX_${String(++cardSeq).padStart(3, '0')}`,
    name: overrides.name ?? overrides.id ?? 'Fixture',
    tier: 1,
    summon_type: 'normal',
    attributes: [],
    power: null,
    ...rest,
    stats: {
      atk: 5, hp: 30, movement_speed: 1, attack_speed: 2, initiative: 5, range: 1,
      ...stats,
    },
  };
}

// Place une unité fraîche sur le board et la retourne.
export function spawn(board: any, card: CardFixture, side: 'player' | 'enemy', pos: { col: number; row: number }) {
  const unit = new (Unit as any)(card, side);
  board.placeUnit(unit, pos);
  return unit;
}

function isUnitLike(v: any): boolean {
  return v !== null && typeof v === 'object' && 'card_id' in v && 'side' in v && 'current_hp' in v;
}

// Référence stable et lisible d'une unité dans les snapshots : pas d'uid
// (compteur module-level) pour que les snapshots survivent à l'ordre des tests.
function refUnit(u: any): string {
  return `${u.side}:${u.card_id}`;
}

function serializeValue(v: any): any {
  if (isUnitLike(v)) return refUnit(v);
  if (Array.isArray(v)) return v.map(serializeValue);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serializeValue(x)]));
  }
  return v;
}

// Sérialisation immédiate à chaque step : les objets d'événement (dot, extra…)
// sont mutés par les steps suivants, il faut capturer l'état au moment de l'émission.
export function runCombat(
  board: any,
  playerUnits: any[],
  enemyUnits: any[],
  attributeManager: any = null,
  maxSteps = 400,
): { winner: string | null; steps: number; events: any[] } {
  const combat = new (CombatManager as any)(board, playerUnits, enemyUnits, attributeManager);
  const log: any[] = [];
  let steps = 0;
  while (!combat.isOver && steps < maxSteps) {
    steps++;
    const events = combat.step();
    for (const e of events) log.push({ step: steps, ...serializeValue(e) });
  }
  return { winner: combat.winner, steps, events: log };
}

export function makeBoard(): any {
  return new (Board as any)();
}

// Décompte par type d'événement — pour les scénarios trop longs pour un
// snapshot exhaustif (timeout à 333 steps).
export function countEventTypes(events: any[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  return counts;
}
