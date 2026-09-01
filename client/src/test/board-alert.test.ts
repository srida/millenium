/* eslint-disable @typescript-eslint/no-explicit-any */
// L'annonce de terrain à l'entrée en combat — le versant qui ne se voit ni dans
// `logic/` (qui ignore l'annonce) ni dans un test de composant (la suite tourne
// en node SANS DOM).
//
// Ce qui est verrouillé ici tient en deux choses :
//   - ce que l'annonce DIT ne peut pas contredire ce que l'effet a FAIT ;
//   - le combat ne part pas tant que l'annonce est à l'écran, et il ne part
//     qu'UNE fois.
//
// Harnais d'`arcade-store.test.ts` / `prep-undo-events.test.ts` : `window` posé
// à la main, contrôleur SANS scène (tous les appels y sont en `?.`).
//
// ⚠️ Éprouvés dans les deux sens : la mutation attendue est nommée par cas.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { makeCard } from './helpers.js';
import type { BoardDef } from '../logic/types.js';

(globalThis as any).window = { location: { search: '' }, addEventListener() {}, removeEventListener() {} };
// `CombatAnimator3D.start()` planifie une frame : sans DOM il n'y a pas de rAF.
// On la neutralise — ce qu'on éprouve, c'est QUAND le combat part, pas ce qu'il
// anime.
(globalThis as any).requestAnimationFrame = () => 0;
(globalThis as any).cancelAnimationFrame = () => {};

vi.mock('../data/AuthClient.js', () => ({
  me: vi.fn(), getUser: () => null, isLoggedIn: () => false, isReady: () => true,
  logout: vi.fn(), claimReward: vi.fn(), pullDecks: vi.fn(), pushDecks: vi.fn(),
  sendMissionEvents: vi.fn(),
}));

const { GameController, terrainAlertFor } = await import('../game/GameController.js');
const { useGameStore } = await import('../stores/gameStore.js');
const { TERRAIN_ALERT_MS } = await import('../game/timings.js');
const { applyEffect } = await import('../logic/BoardEffect.js');

function terrain(id: string, effect: any): BoardDef {
  return { id, name: id, effect } as BoardDef;
}

/** Session dont les deux camps portent des attributs connus. */
function makeController(opts: { board?: BoardDef | null; playerAttrs?: string[][]; enemyAttrs?: string[][] } = {}) {
  const playerCards = (opts.playerAttrs ?? [['ARCH_003']]).map((attributes, i) =>
    makeCard({ id: `P${i}`, summon_type: 'normal', attributes }));
  const enemyCards = (opts.enemyAttrs ?? []).map((attributes, i) =>
    makeCard({ id: `E${i}`, summon_type: 'normal', attributes }));
  const byId = new Map([...playerCards, ...enemyCards].map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: playerCards as any },
    enemyDeck: { 1: enemyCards.map(c => c.id) },
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => (opts.board ? [opts.board] : []),
    getAllMagies: () => [],
  };
  const session = new GameSession(deps);
  const controller = new (GameController as any)(session);
  return { session, controller };
}

/** Pose une unité du joueur puis lance le combat. */
function playTo(controller: any, session: GameSession) {
  session.startPreparation();
  session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
  controller.startCombat();
}

beforeEach(() => {
  vi.useRealTimers();
  useGameStore.getState().reset();
});

describe('Annonce de terrain — ce qui est dit', () => {
  // ⚠️ L'INVARIANT du lot : l'annonce et l'effet partagent `effectTargets`.
  // Mutation : compter sur `target_attributes` au lieu de `effectTargets` → ROUGE.
  it('le décompte annoncé est exactement ce que l\'effet a boosté', () => {
    const units = [
      { attributes: ['ARCH_003'] }, { attributes: ['ARCH_003'] }, { attributes: ['ARCH_001'] },
    ] as any[];
    const enemies = [{ attributes: ['ARCH_003'] }] as any[];
    const effect = { type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: ['ARCH_003'] };

    const alert = terrainAlertFor(terrain('B', effect), units, enemies)!;

    // Ce que l'effet fait RÉELLEMENT : on le pose et on compte qui a été touché.
    const p = units.map(u => ({ ...u, applyStatBonus: vi.fn() }));
    const e = enemies.map(u => ({ ...u, applyStatBonus: vi.fn() }));
    applyEffect(effect as any, { playerUnits: p as any, enemyUnits: e as any });
    const boostedPlayer = p.filter(u => u.applyStatBonus.mock.calls.length > 0).length;
    const boostedEnemy = e.filter(u => u.applyStatBonus.mock.calls.length > 0).length;

    expect(alert.boosted).toEqual({ player: boostedPlayer, enemy: boostedEnemy });
    expect(alert.boosted).toEqual({ player: 2, enemy: 1 });
  });

  // Mutation : `target_attributes` vide traité comme « personne » → ROUGE.
  it('un ciblage vide compte TOUTES les unités des deux camps', () => {
    const alert = terrainAlertFor(
      terrain('B', { type: 'stat_bonus', stat: 'atk', value: 5, target_attributes: [] }),
      [{ attributes: [] }, { attributes: ['X'] }] as any,
      [{ attributes: [] }] as any,
    )!;
    expect(alert.boosted).toEqual({ player: 2, enemy: 1 });
  });

  // Mutation : garde `boardTargetsUnits` retirée → ROUGE.
  it('draw_bonus n\'annonce AUCUN décompte — il ne vise pas les unités', () => {
    const alert = terrainAlertFor(
      terrain('B', { type: 'draw_bonus', value: 1, target_attributes: ['ARCH_003'] }),
      [{ attributes: ['ARCH_003'] }] as any, [] as any,
    )!;
    expect(alert.boosted).toBeNull();
    expect(alert.board.id).toBe('B');
  });

  // ⚠️ Un terrain CUMULE désormais plusieurs effets : on annonce l'UNION des
  // unités touchées, jamais la somme — une unité que deux effets boostent reste
  // une unité, et la phrase dit « combien en profitent ».
  // Mutation : addition des décomptes effet par effet → ROUGE (3 au lieu de 2).
  it('sur un terrain à plusieurs effets, on compte les unités, pas les bonus', () => {
    const board = {
      id: 'B', name: 'B',
      effects: [
        { type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: ['ARCH_003'] },
        { type: 'shield', value: 20, target_attributes: ['ARCH_003', 'ARCH_021'] },
      ],
    } as any as BoardDef;
    const units = [{ attributes: ['ARCH_003'] }, { attributes: ['ARCH_021'] }, { attributes: ['ARCH_099'] }] as any[];

    expect(terrainAlertFor(board, units, [])!.boosted).toEqual({ player: 2, enemy: 0 });
  });

  // Mutation : `board.effect` lu directement au lieu de `boardEffects` → ROUGE.
  it('un terrain migré en `effects` s\'annonce comme les autres', () => {
    const board = { id: 'B', name: 'B', effects: [{ type: 'stat_bonus', stat: 'atk', value: 5 }] } as any as BoardDef;
    expect(terrainAlertFor(board, [{ attributes: [] }] as any, [])!.boosted).toEqual({ player: 1, enemy: 0 });
  });

  // Le décompte suit le ciblage par VOIE d'invocation comme celui par
  // archétype : c'est `effectTargets` qui tranche, des deux côtés.
  it('le décompte suit aussi le ciblage par voie d\'invocation', () => {
    const board = {
      id: 'B', name: 'B',
      effects: [{ type: 'stat_bonus', stat: 'atk', value: 10, target_summon_types: ['fusion'] }],
    } as any as BoardDef;
    const units = [{ attributes: [], summon_key: 'fusion' }, { attributes: [], summon_key: 'normal' }] as any[];

    expect(terrainAlertFor(board, units, [])!.boosted).toEqual({ player: 1, enemy: 0 });
  });

  it('un terrain sans effet s\'annonce quand même, sans décompte', () => {
    const alert = terrainAlertFor(terrain('B', null), [{ attributes: [] }] as any, [] as any)!;
    expect(alert.boosted).toBeNull();
  });

  it('pas de terrain → aucune annonce', () => {
    expect(terrainAlertFor(null, [] as any, [] as any)).toBeNull();
  });
});

describe('Annonce de terrain — quand le combat part', () => {
  const BOARD = terrain('B_DRAGON', { type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: ['ARCH_003'] });

  // Mutation : départ immédiat rétabli (`animator.start()` hors du timer) → ROUGE.
  it('le combat ne démarre PAS tant que l\'annonce est à l\'écran', () => {
    vi.useFakeTimers();
    const { session, controller } = makeController({ board: BOARD, playerAttrs: [['ARCH_003']] });
    playTo(controller, session);

    const snap = useGameStore.getState();
    expect(snap.terrainAlert?.board.id).toBe('B_DRAGON');
    expect(snap.combatActive).toBe(true);          // le HUD est déjà en combat…
    expect((controller as any).animator._running).toBeFalsy();   // …mais rien ne joue

    vi.advanceTimersByTime(TERRAIN_ALERT_MS);
    expect(useGameStore.getState().terrainAlert).toBeNull();
    expect((controller as any).animator._running).toBe(true);
    controller.dispose();
  });

  it('le tap congédie l\'annonce et lance le combat', () => {
    vi.useFakeTimers();
    const { session, controller } = makeController({ board: BOARD, playerAttrs: [['ARCH_003']] });
    playTo(controller, session);

    controller.dismissTerrainAlert();
    expect(useGameStore.getState().terrainAlert).toBeNull();
    expect((controller as any).animator._running).toBe(true);
    controller.dispose();
  });

  // ⚠️ Mutation : `_pendingCombatStart` non remis à `null` → ROUGE.
  it('deux taps ne lancent qu\'UN combat', () => {
    vi.useFakeTimers();
    const { session, controller } = makeController({ board: BOARD, playerAttrs: [['ARCH_003']] });
    playTo(controller, session);

    const animator = (controller as any).animator;
    const start = vi.spyOn(animator, 'start');
    controller.dismissTerrainAlert();
    controller.dismissTerrainAlert();
    controller.dismissTerrainAlert();
    expect(start).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('sans terrain, le combat part sans attendre', () => {
    vi.useFakeTimers();
    const { session, controller } = makeController({ board: null });
    playTo(controller, session);

    expect(useGameStore.getState().terrainAlert).toBeNull();
    expect((controller as any).animator._running).toBe(true);
    controller.dispose();
  });

  // ⚠️ Deux choses distinctes, et il faut les deux : le combat ne part pas (la
  // garde d'identité de l'animateur s'en charge), ET le minuteur est réellement
  // annulé. Sans la seconde assertion, retirer le `clearTimeout` de `dispose`
  // laisse ce test au vert — vérifié.
  it('démonter l\'écran pendant l\'annonce annule le départ en attente', () => {
    vi.useFakeTimers();
    const { session, controller } = makeController({ board: BOARD, playerAttrs: [['ARCH_003']] });
    playTo(controller, session);
    const animator = (controller as any).animator;
    const start = vi.spyOn(animator, 'start');
    expect(vi.getTimerCount()).toBeGreaterThan(0);   // l'annonce retient bien le combat

    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);              // …et `dispose` a bien lâché le minuteur
    vi.advanceTimersByTime(TERRAIN_ALERT_MS * 2);
    expect(start).not.toHaveBeenCalled();
  });
});
