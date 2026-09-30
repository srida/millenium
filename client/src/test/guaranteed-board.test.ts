/* eslint-disable @typescript-eslint/no-explicit-any */
// TERRAIN GARANTI (`guaranteed_board`) — un attribut promet le terrain du
// PROCHAIN combat.
//
// Mutations qui doivent faire tomber ces tests :
//   • retirer le bloc `promised` de `pickBoard`                 → ROUGE (cas pickBoard + bout en bout)
//   • `all.find` → `unused.find` dans `promised`                → ROUGE (« l'emporte sur la non-répétition »)
//   • ne lire que `playerUnits` dans `guaranteedBoardIds`       → ROUGE (« l'IA promet aussi »)
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

  it('une promesse l\'emporte sur la règle « jamais deux fois dans un duel »', () => {
    expect(pickBoard(POOL, ctx(['B1'], ['B1']), () => 0)?.id).toBe('B1');
  });

  it('une promesse sur un terrain inconnu se replie sur le tirage ordinaire', () => {
    expect(POOL.map(b => b.id)).toContain(pickBoard(POOL, ctx(['NOPE']), () => 0)?.id);
  });
});

// ── Bout en bout : attribut → terrain du combat qui commence ──────────────

const attr = (id: string, boardId: string) => ({
  id, name: id, categorie: 'Archetype', timing: 'start_of_combat',
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
  const s = new GameSession(deps);
  s.startPreparation();
  return s;
}

const carte = (id: string, attrs: string[]) =>
  makeCard({ id, attributes: attrs, stats: { atk: 1, hp: 500, range: 1, attack_rate: 0, movement_rate: 0 } } as any) as any;

const joueur = (s: GameSession, attrs: string[], i = 0) => spawn(s.board, carte(`P${i}`, attrs), 'player', { col: i, row: 0 });
const adverse = (s: GameSession, attrs: string[], i = 0) => spawn(s.board, carte(`E${i}`, attrs), 'enemy', { col: i, row: 10 });
const joues = (s: GameSession) => [...(s as any)._usedBoardIds];

describe('terrain garanti — bout en bout', () => {
  it('le terrain promis est celui du combat qui commence', () => {
    const s = session('ai');
    joueur(s, ['GB_3']);
    s.startCombat();
    expect(joues(s)).toEqual(['B3']);
  });

  it('sans unité porteuse sur le plateau, rien n\'est promis', () => {
    const s = session('ai');
    joueur(s, []);
    expect(s.pickCombatBoard()?.id).toBe('B1'); // rand() = 0 → premier du pool
  });

  it('l\'IA promet aussi : son unité porteuse impose son terrain', () => {
    const s = session('ai');
    adverse(s, ['GB_2']);
    s.startCombat();
    expect(joues(s)).toEqual(['B2']);
  });

  it('une promesse de chaque camp : l\'une est tirée au hasard (joueur d\'abord)', () => {
    const a = session('ai', () => 0);
    joueur(a, ['GB_3']); adverse(a, ['GB_2']);
    a.startCombat();
    expect(joues(a)).toEqual(['B3']);
    const b = session('ai', () => 0.99);
    joueur(b, ['GB_3']); adverse(b, ['GB_2']);
    b.startCombat();
    expect(joues(b)).toEqual(['B2']);
  });

  it('un terrain déjà joué revient quand il est promis', () => {
    const s = session('ai');
    joueur(s, ['GB_3']);
    s.startCombat();
    (s as any)._usedBoardIds.add('B3');
    expect(s.pickCombatBoard()?.id).toBe('B3');
  });

  it('identique en PvP (le rôle A tire sur les deux boards)', () => {
    const s = session('pvp');
    adverse(s, ['GB_2']);
    expect(s.pickCombatBoard()?.id).toBe('B2');
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
