/* eslint-disable @typescript-eslint/no-explicit-any */
// Ce que le joueur VOIT quand il choisit une carte à matériaux — et surtout ce
// qu'il ne doit pas voir.
//
// Le liseré BLANC d'une unité dit « matériau retenu » (`board3d.css`) ; l'orange
// dit « candidat ». Une pré-sélection posée à la sélection de la carte peignait
// donc les cibles en blanc avant que le joueur n'ait désigné quoi que ce soit —
// et son premier tap sur la cible la DÉSÉLECTIONNAIT, `onUnitTap` étant une
// bascule. Le geste en un tap n'en a pas besoin : c'est le tap qui COMPLÈTE la
// sélection qui pose.
//
// Harnais de `prep-undo-events.test.ts` : les stores tournent en node sans DOM.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { makeCard } from './helpers.js';

(globalThis as any).window = { location: { search: '' }, addEventListener() {}, removeEventListener() {} };

vi.mock('../data/AuthClient.js', () => ({
  me: vi.fn(), getUser: () => null, isLoggedIn: () => false, isReady: () => true,
  logout: vi.fn(), claimReward: vi.fn(), pullDecks: vi.fn(), pushDecks: vi.fn(),
  sendMissionEvents: vi.fn(),
}));

const { GameController } = await import('../game/GameController.js');
const { useAuthStore } = await import('../stores/authStore.js');

const TARGET = makeCard({ id: 'TARGET', name: 'Cible' });
const OTHER = makeCard({ id: 'OTHER', name: 'Autre' });
// La « Transformation » d'hier : un matériel, nommé. Sa case est imposée.
const MORPH = makeCard({
  id: 'MORPH', name: 'Métamorphose',
  summon_conditions: [{ materials: 1, requires: ['TARGET'] }],
});

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

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'u1' } as any, ready: true } as any);
});

describe('Sélection d’une carte à matériaux', () => {
  // Mutation : reposer une pré-sélection dans `selectCard` → ROUGE.
  it('ne retient AUCUN matériau tant que le joueur n’a rien tapé', () => {
    const { session, controller } = makeController([TARGET, OTHER, MORPH]);
    session.hand = [{ ...MORPH }] as any;
    controller.begin();
    session.place(TARGET as any, { col: 0, row: 0 }, [], null);
    session.place(OTHER as any, { col: 1, row: 0 }, [], null);

    controller.selectCard(session.hand[0], 0);
    expect((controller as any).selectedMaterials).toEqual([]);
  });

  // Même chose quand la cible est la SEULE unité du terrain : c'est justement le
  // cas où la pré-sélection se déclenchait le plus volontiers.
  it('ne retient rien non plus quand une seule unité est éligible', () => {
    const { session, controller } = makeController([TARGET, MORPH]);
    session.hand = [{ ...MORPH }] as any;
    controller.begin();
    session.place(TARGET as any, { col: 0, row: 0 }, [], null);

    controller.selectCard(session.hand[0], 0);
    expect((controller as any).selectedMaterials).toEqual([]);
    // …mais elle est bien PROPOSÉE (liseré orange).
    expect(session.materialCandidateCells(session.hand[0], [], null))
      .toEqual([{ col: 0, row: 0 }]);
  });

  // Le geste en UN TAP survit : taper la cible complète la sélection ET pose.
  // Mutation : retirer la pose directe d'`onUnitTap` → ROUGE.
  it('taper la cible pose l’unité, sans second geste', () => {
    const { session, controller } = makeController([TARGET, MORPH]);
    session.hand = [{ ...MORPH }] as any;
    controller.begin();
    const target = session.place(TARGET as any, { col: 2, row: 1 }, [], null)!;

    controller.selectCard(session.hand[0], 0);
    (controller as any).onUnitTap(target, { col: 2, row: 1 }, {} as any);

    const units = session.getPlayerUnits();
    expect(units.map((u: any) => u.card_id)).toEqual(['MORPH']);
    // La case du matériel est celle du résultat (`forcedCell`).
    expect(units[0].position).toEqual({ col: 2, row: 1 });
    expect(session.hand).toHaveLength(0);
  });
});
