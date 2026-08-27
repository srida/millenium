/* eslint-disable @typescript-eslint/no-explicit-any */
// « Tout annuler » — le versant MISSIONS, qui ne se voit ni dans `logic/` (qui
// ignore les missions) ni à l'écran.
//
// Une invocation met un `summon_performed` dans la file d'événements de la
// partie, vidée en fin de match. Annuler le tour doit retirer ceux du tour
// courant — sans quoi une boucle poser/annuler ferait avancer une mission
// « invoque N unités » sans jouer une seule partie. Et SEULEMENT ceux du tour
// courant : les invocations des tours précédents ont bien eu lieu.
//
// Le harnais est celui d'`arcade-store.test.ts` — les stores tournent en node
// sans DOM, seul `AuthClient` est mocké et l'utilisateur est posé à la main
// (`emit` est un no-op en invité, la file resterait vide).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { makeCard } from './helpers.js';

// `uiStore` lit `window.location.search` au chargement (deep-link ?screen=) et
// la suite tourne en node sans DOM : on le pose à la main, comme
// `pvp-connection.test.ts` pose `WebSocket` et `location`.
(globalThis as any).window = { location: { search: '' }, addEventListener() {}, removeEventListener() {} };

vi.mock('../data/AuthClient.js', () => ({
  me: vi.fn(), getUser: () => null, isLoggedIn: () => false, isReady: () => true,
  logout: vi.fn(), claimReward: vi.fn(), pullDecks: vi.fn(), pushDecks: vi.fn(),
  sendMissionEvents: vi.fn(),
}));

const { GameController } = await import('../game/GameController.js');
const { BotController } = await import('../game/BotController.js');
const { useMissionStore } = await import('../stores/missionStore.js');
const { useAuthStore } = await import('../stores/authStore.js');
const { useGameStore } = await import('../stores/gameStore.js');
// La file elle-même n'est pas exposée : on la lit par `flushMatch`, qui la
// remet au serveur. C'est aussi ce que fait la vraie fin de partie.
const AuthClient: any = await import('../data/AuthClient.js');

function makeController(cards: any[]) {
  const byId = new Map(cards.map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [] },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getRandomBoard: () => null,
    getAllMagies: () => [],
  };
  const session = new GameSession(deps);
  return { session, controller: new (GameController as any)(session) };
}

async function flushedEvents(): Promise<any[]> {
  AuthClient.sendMissionEvents.mockResolvedValue({});
  await useMissionStore.getState().flushMatch();
  const call = AuthClient.sendMissionEvents.mock.calls.at(-1);
  return call ? call[0].events : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  useMissionStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u1' } as any, ready: true } as any);
});

describe('Tout annuler — file d\'événements de missions', () => {
  it('les invocations annulées ne sont pas rapportées au serveur', async () => {
    const a = makeCard({ id: 'EA' });
    const b = makeCard({ id: 'EB' });
    const { session, controller } = makeController([a, b]);
    session.hand = [{ ...a }, { ...b }] as any;
    controller.begin();                       // ouvre le lot + la préparation

    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 0, row: 0 });
    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 1, row: 0 });
    expect(session.getPlayerUnits()).toHaveLength(2);

    controller.undoPreparation();
    expect(session.getPlayerUnits()).toHaveLength(0);
    expect(await flushedEvents()).toEqual([]);
  });

  it('les invocations des tours PRÉCÉDENTS survivent à une annulation', async () => {
    const a = makeCard({ id: 'FA' });
    const b = makeCard({ id: 'FB' });
    const { session, controller } = makeController([a, b]);
    session.hand = [{ ...a }, { ...b }] as any;
    controller.begin();

    // Tour 1 : une invocation, puis on part au combat (rien à annuler ensuite).
    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 0, row: 0 });
    session.startCombat();
    session.gameState.phase = 'preparation' as any;
    session.startPreparation();

    // Tour 2 : une invocation, annulée.
    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 2, row: 0 });
    controller.undoPreparation();

    const events = await flushedEvents();
    expect(events.map(e => e.type)).toEqual(['summon_performed']);
    expect(events[0].card_id).toBe('FA');
  });

  it('annuler un tour où l\'on n\'a fait que DÉPLACER ne touche pas les tours d\'avant', async () => {
    // Le cas que le repère de tour (`prepId`) protège, et lui seul : la marque
    // mémorisée date du tour précédent, un rollback aveugle la rejouerait et
    // effacerait une invocation qui, elle, a bien eu lieu.
    const a = makeCard({ id: 'IA' });
    const { session, controller } = makeController([a]);
    session.hand = [{ ...a }] as any;
    controller.begin();

    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 0, row: 0 });
    session.startCombat();
    session.gameState.phase = 'preparation' as any;
    session.startPreparation();

    // Tour 2 : aucune invocation, un simple repositionnement.
    const unit = session.getPlayerUnits()[0];
    session.reposition(unit, { col: 3, row: 1 });
    controller.undoPreparation();
    expect(unit.position).toEqual({ col: 0, row: 0 });

    const events = await flushedEvents();
    expect(events.map(e => e.type)).toEqual(['summon_performed']);
  });

  it('poser, annuler, reposer ne compte qu\'UNE invocation', async () => {
    const a = makeCard({ id: 'GA' });
    const { session, controller } = makeController([a]);
    session.hand = [{ ...a }] as any;
    controller.begin();

    for (let i = 0; i < 3; i++) {
      controller.selectCard(session.hand[0], 0);
      (controller as any).onCellTap({ col: i, row: 0 });
      controller.undoPreparation();
    }
    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 4, row: 0 });

    const events = await flushedEvents();
    expect(events.map(e => e.type)).toEqual(['summon_performed']);
  });
});

describe('Tout annuler — verrou d\'engagement', () => {
  it('après PRÊT, le bouton n\'est plus proposé et l\'annulation est refusée', () => {
    const a = makeCard({ id: 'HA' });
    const { session, controller } = makeController([a]);
    session.hand = [{ ...a }] as any;
    controller.begin();

    controller.selectCard(session.hand[0], 0);
    (controller as any).onCellTap({ col: 0, row: 0 });
    controller.sync();
    expect(useGameStore.getState().canUndo).toBe(true);

    // Le verrou d'un lancement de combat : la phase change aussi, mais c'est
    // `_committedPrepId` qui porte le cas PvP, où elle reste PREPARATION
    // pendant toute la poignée de main réseau.
    (controller as any)._committedPrepId = session.prepId;
    controller.sync();
    expect(useGameStore.getState().canUndo).toBe(false);

    controller.undoPreparation();
    expect(session.getPlayerUnits()).toHaveLength(1);
  });

  it('un duel contre bot engage le tour dès le tap sur PRÊT, pas à la fin de l\'attente', () => {
    // `BotController` retarde le combat de 3 à 22 s pour imiter un adversaire
    // humain. Pendant cette attente la phase reste PREPARATION et `sync`
    // republie l'instantané : sans verrou, le bouton reviendrait sous l'overlay
    // « En attente de l'adversaire… », soit vingt secondes de rab pour
    // retoucher un board déjà validé.
    const a = makeCard({ id: 'JA' });
    const { session } = makeController([a]);
    const bot = new (BotController as any)(session, 'Adversaire');
    (bot as any)._readyAt = Date.now() + 60_000;   // attente encore en cours

    session.hand = [{ ...a }] as any;
    session.startPreparation();
    bot.selectCard(session.hand[0], 0);
    (bot as any).onCellTap({ col: 0, row: 0 });
    bot.sync();
    expect(useGameStore.getState().canUndo).toBe(true);

    bot.startCombat();
    bot.sync();
    expect(useGameStore.getState().canUndo).toBe(false);
    bot.undoPreparation();
    expect(session.getPlayerUnits()).toHaveLength(1);

    clearTimeout((bot as any)._waitTimer);
  });
});
