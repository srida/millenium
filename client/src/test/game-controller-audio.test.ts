/* eslint-disable @typescript-eslint/no-explicit-any */
// Les effets sonores du contrôleur sont câblés au SUCCÈS de chaque geste, pas
// à sa tentative — golden test qui prouve que `Audio.playSfx` est bien
// appelé aux points d'entrée réels (invocation, repositionnement par tap
// ET par glisser), sans passer par le rendu 3D. Même harnais headless que
// `prep-undo-events.test.ts`.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { makeCard } from './helpers.js';

(globalThis as any).window = { location: { search: '' }, addEventListener() {}, removeEventListener() {} };

vi.mock('../data/AuthClient.js', () => ({
  me: vi.fn(), getUser: () => null, isLoggedIn: () => false, isReady: () => true,
  logout: vi.fn(), claimReward: vi.fn(), pullDecks: vi.fn(), pushDecks: vi.fn(),
  sendMissionEvents: vi.fn(),
}));

const playSfx = vi.fn();
vi.mock('../audio/AudioManager.js', () => ({ playSfx, setMusicTheme: vi.fn() }));

const { GameSession } = await import('../logic/GameSession.js');
const { GameController } = await import('../game/GameController.js');

function makeController(cards: any[]) {
  const byId = new Map(cards.map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [] },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => [],
  };
  const session = new GameSession(deps);
  return { session, controller: new (GameController as any)(session) };
}

const rect = { left: 0, top: 0, bottom: 0, width: 0, height: 0 };

beforeEach(() => { playSfx.mockClear(); });

describe('GameController — effets sonores', () => {
  it('invocation réussie joue "summon" avec le tier de la carte', () => {
    const a = makeCard({ id: 'GA', tier: 2 });
    const { session, controller } = makeController([a]);
    session.hand = [{ ...a }] as any;
    controller.begin();
    playSfx.mockClear(); // ignore le son de pioche/ouverture de round

    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 0, row: 0 });

    expect(session.getPlayerUnits()).toHaveLength(1);
    expect(playSfx).toHaveBeenCalledWith('summon', { tier: 2 });
  });

  it('repositionnement par TAP-TAP (onUnitTap puis onCellTap) joue "move_unit"', () => {
    const a = makeCard({ id: 'GB' });
    const { session, controller } = makeController([a]);
    session.hand = [{ ...a }] as any;
    controller.begin();

    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 0, row: 0 });
    const unit = session.getPlayerUnits()[0];
    playSfx.mockClear();

    (controller as any).onUnitTap(unit, { col: 0, row: 0 }, rect);
    (controller as any).onCellTap({ col: 2, row: 1 });

    expect(unit.position).toEqual({ col: 2, row: 1 });
    expect(playSfx).toHaveBeenCalledWith('move_unit');
  });

  it('repositionnement par GLISSER (onUnitDrag) joue "move_unit"', () => {
    const a = makeCard({ id: 'GC' });
    const { session, controller } = makeController([a]);
    session.hand = [{ ...a }] as any;
    controller.begin();

    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 0, row: 0 });
    const unit = session.getPlayerUnits()[0];
    playSfx.mockClear();

    controller.onUnitDrag(unit, { col: 0, row: 0 }, { col: 3, row: 2 });

    expect(unit.position).toEqual({ col: 3, row: 2 });
    expect(playSfx).toHaveBeenCalledWith('move_unit');
  });

  it('un glisser REFUSÉ (hors de la zone joueur) ne joue AUCUN son', () => {
    const a = makeCard({ id: 'GD' });
    const { session, controller } = makeController([a]);
    session.hand = [{ ...a }] as any;
    controller.begin();

    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 0, row: 0 });
    const unit = session.getPlayerUnits()[0];
    playSfx.mockClear();

    // Rangée 5 = zone neutre, hors de portée du repositionnement joueur
    // (`Board.isPlayerCell`) : `GameSession.reposition` refuse et rend `false`.
    controller.onUnitDrag(unit, { col: 0, row: 0 }, { col: 0, row: 5 });

    expect(unit.position).toEqual({ col: 0, row: 0 });
    expect(playSfx).not.toHaveBeenCalledWith('move_unit');
  });
});
