/* eslint-disable @typescript-eslint/no-explicit-any */
// L'annonce de terrain en DÉBUT DE TOUR — le versant qui ne se voit ni dans
// `logic/` (qui ignore l'annonce) ni dans un test de composant (la suite tourne
// en node SANS DOM).
//
// Ce qui est verrouillé ici :
//   - ce que l'annonce DIT ne peut pas contredire ce que l'effet FERA ;
//   - elle tombe APRÈS la popup de pioche, une fois, et se retire seule ;
//   - le combat ne l'attend plus (le terrain est déjà connu).
//
// Harnais d'`arcade-store.test.ts` / `prep-undo-events.test.ts` : `window` posé
// à la main, contrôleur SANS scène (tous les appels y sont en `?.`).
//
// ⚠️ Éprouvés dans les deux sens : la mutation attendue est nommée par cas.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { makeCard } from './helpers.js';
import { Unit } from '../logic/Unit.js';
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
  sendMissionEvents: vi.fn()
}));

const { GameController, terrainPrepAlertFor } = await import('../game/GameController.js');
const { useGameStore } = await import('../stores/gameStore.js');
const { TERRAIN_ALERT_MS, COMBAT_INTRO_MS, ROUND_INTRO_MS } = await import('../game/timings.js');
const { applyEffect } = await import('../logic/BoardEffect.js');

function terrain(id: string, effect: any): BoardDef {
  return { id, name: id, effect } as BoardDef;
}

/** Session dont les deux camps portent des attributs connus. */
function makeController(opts: { board?: BoardDef | null; playerAttrs?: string[][]; enemyAttrs?: string[][] } = {}) {
  const playerCards = (opts.playerAttrs ?? [['ARCH_003']]).map((attributes, i) =>
    makeCard({ id: `P${i}`, summon_conditions: [], attributes }));
  const enemyCards = (opts.enemyAttrs ?? []).map((attributes, i) =>
    makeCard({ id: `E${i}`, summon_conditions: [], attributes }));
  const byId = new Map([...playerCards, ...enemyCards].map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: playerCards as any },
    enemyDeck: { 1: enemyCards.map(c => c.id) },
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => (opts.board ? [opts.board] : []),
    getAllMagies: () => [] };
  const session = new GameSession(deps);
  const controller = new (GameController as any)(session);
  return { session, controller };
}


beforeEach(() => {
  vi.useRealTimers();
  useGameStore.getState().reset();
});

describe('Annonce de terrain — ce qui est dit', () => {
  // ⚠️ L'INVARIANT : l'annonce et l'effet partagent `effectTargets`. Le
  // décompte du début de tour se fait sur les CARTES du joueur (rien n'est
  // posé) ; posées, elles deviennent exactement les unités que l'effet touche.
  // Mutation : compter sur `target_attributes` au lieu de `effectTargets` → ROUGE.
  it('le décompte annoncé est exactement ce que l\'effet boostera une fois posées', () => {
    const cards = [
      makeCard({ id: 'A', attributes: ['ARCH_003'], stats: { atk: 20, hp: 100, movement_rate: 50, attack_rate: 50, range: 1 } as any }),
      makeCard({ id: 'B', attributes: ['ARCH_003'], stats: { atk: 20, hp: 100, movement_rate: 50, attack_rate: 50, range: 1 } as any }),
      makeCard({ id: 'C', attributes: ['ARCH_001'], stats: { atk: 20, hp: 100, movement_rate: 50, attack_rate: 50, range: 1 } as any }),
    ];
    const effect = { type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: ['ARCH_003'] };
    const alert = terrainPrepAlertFor(terrain('B', effect), cards as any)!;

    const units = cards.map(c => new (Unit as any)(c, 'player'));
    applyEffect(effect as any, { playerUnits: units as any, enemyUnits: [] });
    const boosted = units.filter((u: any) => (u._stat_bonuses.atk ?? 0) > 0).length;
    expect(alert.boosted).toEqual({ player: boosted, enemy: null });
    expect(alert.boosted).toEqual({ player: 2, enemy: null });
  });

  // Mutation : `target_attributes` vide traité comme « personne » → ROUGE.
  it('un ciblage vide compte TOUTES les cartes', () => {
    const alert = terrainPrepAlertFor(
      terrain('B', { type: 'stat_bonus', stat: 'atk', value: 5, target_attributes: [] }),
      [{ id: 'X', attributes: [] }, { id: 'Y', attributes: ['X'] }],
    )!;
    expect(alert.boosted).toEqual({ player: 2, enemy: null });
  });

  // Mutation : garde `boardTargetsUnits` retirée → ROUGE.
  it('draw_bonus n\'annonce AUCUN décompte — il ne vise pas les unités', () => {
    const alert = terrainPrepAlertFor(
      terrain('B', { type: 'draw_bonus', value: 1, target_attributes: ['ARCH_003'] }),
      [{ id: 'X', attributes: ['ARCH_003'] }],
    )!;
    expect(alert.boosted).toBeNull();
  });

  // Union, jamais somme. Mutation : addition effet par effet → ROUGE.
  it('sur un terrain à plusieurs effets, on compte les cartes, pas les bonus', () => {
    const board = {
      id: 'B', name: 'B',
      effects: [
        { type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: ['ARCH_003'] },
        { type: 'shield', value: 20, target_attributes: ['ARCH_003', 'ARCH_021'] },
      ] } as any as BoardDef;
    const cards = [{ id: 'A', attributes: ['ARCH_003'] }, { id: 'B', attributes: ['ARCH_021'] }, { id: 'C', attributes: ['ARCH_099'] }];
    expect(terrainPrepAlertFor(board, cards)!.boosted).toEqual({ player: 2, enemy: null });
  });

  // Une carte en main ET posée (deux exemplaires) compte une fois.
  // Mutation : compter les entrées au lieu des card_id → ROUGE.
  it('une même carte (main + plateau) compte une seule fois', () => {
    const board = { id: 'B', name: 'B', effects: [{ type: 'stat_bonus', stat: 'atk', value: 5 }] } as any as BoardDef;
    expect(terrainPrepAlertFor(board, [{ id: 'A', attributes: [] }, { card_id: 'A', attributes: [] }])!.boosted)
      .toEqual({ player: 1, enemy: null });
  });

  it('pas de terrain → aucune annonce', () => {
    expect(terrainPrepAlertFor(null, [])).toBeNull();
  });
});

describe('Annonce de terrain — quand elle tombe', () => {
  const BOARD = terrain('B_DRAGON', { type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: ['ARCH_003'] });

  function opened() {
    vi.useFakeTimers();
    const { session, controller } = makeController({ board: BOARD });
    controller.begin();
    return { session, controller };
  }

  // Mutation : annoncer dès `begin()` (par-dessus la pioche) → ROUGE.
  it('le terrain est connu dès la préparation mais annoncé APRÈS la popup de pioche', () => {
    const { session, controller } = opened();
    expect(session.roundBoard?.id).toBe('B_DRAGON');
    expect(useGameStore.getState().boardTerrain?.id).toBe('B_DRAGON');
    expect(useGameStore.getState().terrainAlert).toBeNull();
    vi.advanceTimersByTime(ROUND_INTRO_MS);
    expect(useGameStore.getState().drawPopup).not.toBeNull();
    expect(useGameStore.getState().terrainAlert).toBeNull();
    controller.dismissDrawPopup();
    expect(useGameStore.getState().terrainAlert?.board.id).toBe('B_DRAGON');
  });

  // Mutation : retirer le minuteur de l'annonce → ROUGE.
  it('elle se retire seule, et ne revient pas', () => {
    const { controller } = opened();
    vi.advanceTimersByTime(ROUND_INTRO_MS);
    controller.dismissDrawPopup();
    vi.advanceTimersByTime(TERRAIN_ALERT_MS);
    expect(useGameStore.getState().terrainAlert).toBeNull();
    controller.dismissDrawPopup();   // geste sans objet
    expect(useGameStore.getState().terrainAlert).toBeNull();
  });

  it('le tap la retire tout de suite', () => {
    const { controller } = opened();
    vi.advanceTimersByTime(ROUND_INTRO_MS);
    controller.dismissDrawPopup();
    controller.dismissTerrainAlert();
    expect(useGameStore.getState().terrainAlert).toBeNull();
  });

  // Mutation : laisser l'annonce en combat → ROUGE.
  it('PRÊT pendant l\'annonce la retire, et le combat part après le seul volet', () => {
    const { session, controller } = opened();
    vi.advanceTimersByTime(ROUND_INTRO_MS);
    controller.dismissDrawPopup();
    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    controller.startCombat();
    expect(useGameStore.getState().terrainAlert).toBeNull();
    expect(controller._revealTimer).not.toBeNull();     // retenu par le volet…
    vi.advanceTimersByTime(COMBAT_INTRO_MS);
    expect(controller._revealTimer).toBeNull();         // …et par lui seul
    controller.dispose();
  });

  it('PvP : un terrain qui arrive APRÈS la popup est annoncé à son arrivée', () => {
    vi.useFakeTimers();
    const playerCards = [makeCard({ id: 'P0', summon_conditions: [], attributes: ['ARCH_003'] })];
    const session = new GameSession({
      cardsByTier: { 1: playerCards as any }, enemyDeck: { 1: [] }, attributeList: [],
      cardDb: { getCard: () => null } as any, getAllBoards: () => [BOARD], getAllMagies: () => [],
      mode: 'pvp',
    } as GameSessionDeps);
    const controller = new (GameController as any)(session);
    controller.begin();
    vi.advanceTimersByTime(ROUND_INTRO_MS);
    controller.dismissDrawPopup();
    expect(useGameStore.getState().terrainAlert).toBeNull();      // pas encore connu
    controller.applyRoundBoard(BOARD);
    expect(session.roundBoard?.id).toBe('B_DRAGON');
    expect(useGameStore.getState().terrainAlert?.board.id).toBe('B_DRAGON');
    controller.dispose();
  });
});
