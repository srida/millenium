/* eslint-disable @typescript-eslint/no-explicit-any */
// TERRAIN GARANTI (`guaranteed_board`) — un attribut promet le terrain du
// PROCHAIN combat.
//
// Mutations qui doivent faire tomber ces tests :
//   • retirer le bloc `promised` de `pickBoard`               → ROUGE (cas 1–4)
//   • ne pas vider `player_guaranteed_boards` à `startCombat` → ROUGE (« ne vaut que pour un combat »)
//   • retirer la garde `mode === 'pvp'` de `_boardPickContext` → ROUGE (cas PvP)
import { describe, it, expect } from 'vitest';
import { pickBoard } from '../logic/BoardPicker.js';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { compileAttribute } from '../logic/effects/compile.js';
import { makeCard, spawn } from './helpers.js';
import { tiersOf } from '../logic/Tiers.js';
import type { BoardDef } from '../logic/types.js';

const terrain = (id: string) => ({ id, name: id, effect: null } as BoardDef);
const POOL = [terrain('B1'), terrain('B2'), terrain('B3')];
const ctx = (guaranteedBoardIds: string[], used: string[] = []) => ({
  playerAttributes: [], enemyAttributes: [], usedBoardIds: new Set(used), guaranteedBoardIds,
});

function countingRand(v = 0) {
  let calls = 0;
  return { rand: () => { calls++; return v; }, calls: () => calls };
}

describe('pickBoard — terrain garanti', () => {
  it('une promesse l\'emporte sur le tirage ordinaire, avec UN seul appel à rand', () => {
    const r = countingRand();
    expect(pickBoard(POOL, ctx(['B3']), r.rand)?.id).toBe('B3');
    expect(r.calls()).toBe(1);
  });

  it('plusieurs promesses : l\'une d\'elles est tirée au hasard', () => {
    expect(pickBoard(POOL, ctx(['B2', 'B3']), () => 0)?.id).toBe('B2');
    expect(pickBoard(POOL, ctx(['B2', 'B3']), () => 0.99)?.id).toBe('B3');
  });

  it('un terrain déjà joué ne revient jamais, même promis', () => {
    expect(pickBoard(POOL, ctx(['B1'], ['B1']), () => 0)?.id).not.toBe('B1');
    // La promesse invalide est écartée, l'autre reste.
    expect(pickBoard(POOL, ctx(['B1', 'B2'], ['B1']), () => 0)?.id).toBe('B2');
  });

  it('une promesse sur un terrain inconnu se replie sur le tirage ordinaire', () => {
    expect(POOL.map(b => b.id)).toContain(pickBoard(POOL, ctx(['NOPE']), () => 0)?.id);
  });
});

// ── Bout en bout : attribut → file → prochain combat ───────────────────────

const attr = (id: string, boardId: string) => ({
  id, name: id, categorie: 'Archetype', timing: 'end_of_combat',
  thresholds: [{ count: 1, effects: [{ type: 'guaranteed_board', board_id: boardId }] }],
});
const CATALOGUE = [attr('GB_2', 'B2'), attr('GB_3', 'B3')];

function session(mode: 'ai' | 'pvp', rand: () => number = () => 0) {
  const deck = [makeCard({ id: 'X', tier: 1, summon_conditions: [] })];
  const byTier: Record<number, any[]> = {};
  for (const c of deck) for (const t of tiersOf(c)) (byTier[t] ??= []).push(c);
  const deps: GameSessionDeps = {
    cardsByTier: byTier, enemyDeck: {}, attributeList: CATALOGUE as any,
    cardDb: { getCard: (id: string) => (deck.find(c => c.id === id) as any) ?? null },
    getAllBoards: () => POOL, getAllMagies: () => [], rand, mode,
  } as any;
  return new GameSession(deps);
}

function playOneCombat(s: GameSession, attrs: string[]) {
  s.startPreparation();
  const units = attrs.map((a, i) =>
    spawn(s.board, makeCard({ id: `U${i}`, attributes: [a], stats: { atk: 1, hp: 500, range: 1, attack_rate: 0, movement_rate: 0 } } as any) as any, 'player', { col: i, row: 0 }));
  (s as any)._combatPlayerUnits = units;
  // `null` = terrain convenu « aucun » : ce premier combat ne consomme aucun terrain.
  s.startCombat(null);
  (s as any)._combat.isOver = true;
  (s as any)._combat.winner = 'player';
  s.finishCombat();
}

describe('terrain garanti — bout en bout', () => {
  it('l\'attribut ne promet rien avant la fin du combat, puis le terrain promis est joué', () => {
    const s = session('ai');
    playOneCombat(s, ['GB_3']);
    expect(s.gameState.player_guaranteed_boards).toEqual(['B3']);

    s.startPreparation();
    s.startCombat();
    expect([...(s as any)._usedBoardIds]).toEqual(['B3']);
  });

  it('la promesse ne vaut que pour UN combat', () => {
    const s = session('ai');
    playOneCombat(s, ['GB_3']);
    s.startPreparation();
    s.startCombat();
    expect(s.gameState.player_guaranteed_boards).toEqual([]);
  });

  it('deux unités, deux terrains promis : les deux sont en file, un seul est joué', () => {
    const s = session('ai', () => 0.99);
    playOneCombat(s, ['GB_2', 'GB_3']);
    expect(s.gameState.player_guaranteed_boards.slice().sort()).toEqual(['B2', 'B3']);
    s.startPreparation();
    s.startCombat();
    expect((s as any)._usedBoardIds.has('B3')).toBe(true);
    expect((s as any)._usedBoardIds.has('B2')).toBe(false);
  });

  it('désactivé en PvP réel : la file est vidée sans peser sur le tirage', () => {
    const s = session('pvp');
    playOneCombat(s, ['GB_3']);
    expect(s.pickCombatBoard()?.id).toBe('B1'); // rand() = 0 → premier du pool non joué
  });
});

describe('compilation', () => {
  it('un guaranteed_board sans board_id est refusé nommément', () => {
    const { effets, refus } = compileAttribute(
      { id: 'A', timing: 'end_of_combat', thresholds: [{ count: 1, effects: [{ type: 'guaranteed_board' }] }] } as any, new Set(['A']) as any);
    expect(effets).toEqual([]);
    expect(refus).toHaveLength(1);
  });
});
