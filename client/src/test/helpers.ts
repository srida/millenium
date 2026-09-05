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
  /** Les tiers RÉSOLUS de la carte — la forme que le jeu lit (`logic/Tiers`).
   *  Les fixtures les écrivent en clair : elles n'ont pas de catalogue
   *  d'attributs sous la main pour les résoudre, et c'est déjà le travail de
   *  `tiers.test.ts`. */
  _tiers: number[];
  attributes: string[];
  represented_ids?: string[];
  power?: { id: string; power_speed: number; value?: number | null } | null;
  /** Les voies d'invocation. Absent = aucune condition (l'ancienne « normale »). */
  summon_conditions?: { materials: number; requires?: string[] }[];
  /** Ce que la carte vaut comme matériau. Absent = 1. */
  material_value?: number;
  stats: {
    atk: number; hp: number; movement_speed: number;
    attack_speed: number; initiative: number; range: number;
  };
}

let cardSeq = 0;

/**
 * Une carte de test.
 *
 * ⚠️ `tier: N` est accepté en RACCOURCI et traduit en `_tiers: [N]` : le champ
 * `tier` n'existe plus dans les données, mais des centaines de fixtures le
 * nomment et elles ne parlent que d'un seul tier. Écrire `_tiers` directement
 * reste possible, et c'est le seul moyen d'obtenir une carte multi-tiers.
 */
export function makeCard(
  overrides: Partial<CardFixture> & { id?: string; tier?: number } = {},
): CardFixture {
  const { stats, tier, ...rest } = overrides;
  return {
    id: overrides.id ?? `FIX_${String(++cardSeq).padStart(3, '0')}`,
    name: overrides.name ?? overrides.id ?? 'Fixture',
    _tiers: tier != null ? [tier] : [1],
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
