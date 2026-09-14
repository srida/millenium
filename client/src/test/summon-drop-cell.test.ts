/* eslint-disable @typescript-eslint/no-explicit-any */
// La case RETENUE d'une invocation à matériaux — le versant contrôleur du
// glisser-déposer, que ni `logic/` ni l'écran ne voient.
//
// Désigner une case AVANT les matériaux était un refus sec (« Sélectionne les
// matériaux d'abord ») : le geste ne retenait rien, et lâcher une carte à
// matériaux sur le plateau ne valait donc rien. La case est désormais une
// INTENTION, gardée jusqu'à ce que la sélection s'achève — et c'est là que
// l'unité se pose.
//
// ⚠️ Ce que ces cas éprouvent n'est vrai NULLE PART ailleurs : `logic/` répond
// « où » par `forcedCell` et `canSummon`, qui ne connaissent aucune intention ;
// c'est l'ORDRE dans lequel le contrôleur les interroge qui est la règle ici.
//
// Le harnais est celui de `prep-undo-events.test.ts` : les stores tournent en
// node sans DOM, `window` est posé à la main.
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
const { useMissionStore } = await import('../stores/missionStore.js');
const { useGameStore } = await import('../stores/gameStore.js');

// Deux matériaux « normaux » et la carte qui les consomme. DEUX matériaux et
// non un : à UN matériel la recette IMPOSE sa case (`forcedCell`), et le cas
// n'éprouverait donc rien de la case retenue.
const N1 = makeCard({ id: 'DN1', summon_conditions: [] as any });
const N2 = makeCard({ id: 'DN2', summon_conditions: [] as any });
const FUSION = makeCard({ id: 'DF1', summon_conditions: [{ materials: 2, requires: ['DN1', 'DN2'] }] as any });
const SOLO = makeCard({ id: 'DS1', summon_conditions: [{ materials: 1 }] as any });

function makeController(cards: any[]) {
  const byId = new Map(cards.map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [] },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => [],
  } as any;
  const session = new GameSession(deps);
  const controller = new (GameController as any)(session);
  return { session, controller };
}

/** Pose les deux matériaux en (0,0) et (1,0), main prête pour la fusion. */
function withMaterials() {
  const { session, controller } = makeController([N1, N2, FUSION, SOLO]);
  session.hand = [{ ...N1 }, { ...N2 }, { ...FUSION }, { ...SOLO }] as any;
  controller.begin();
  controller.selectCard(session.hand[0], 0);
  controller.onCellTap({ col: 0, row: 0 });
  controller.selectCard(session.hand[0], 0);          // N2 a glissé en tête
  controller.onCellTap({ col: 1, row: 0 });
  expect(session.getPlayerUnits()).toHaveLength(2);
  return { session, controller };
}

const at = (session: any, col: number, row: number) => session.board.getUnit({ col, row });

beforeEach(() => {
  vi.clearAllMocks();
  useMissionStore.getState().reset();
});

describe('La case retenue d\'une invocation à matériaux', () => {
  it('désigner une case avant les matériaux ne pose rien, mais la RETIENT', () => {
    const { session, controller } = withMaterials();
    const fusion = session.hand.find((c: any) => c.id === 'DF1') as any;
    controller.selectCard(fusion, session.hand.indexOf(fusion));

    controller.onCellTap({ col: 3, row: 2 });
    // Rien n'est posé : la sélection n'est pas faite.
    expect(session.getPlayerUnits()).toHaveLength(2);
    // Mais la case est retenue, et l'écran le DIT.
    expect(useGameStore.getState().invocationBanner).toContain('Case retenue');
  });

  it('l\'unité se pose sur la case RETENUE, pas sur celle du dernier matériau', () => {
    const { session, controller } = withMaterials();
    const fusion = session.hand.find((c: any) => c.id === 'DF1') as any;
    controller.selectCard(fusion, session.hand.indexOf(fusion));
    controller.onCellTap({ col: 3, row: 2 });

    // Les deux matériaux, désignés dans l'ordre. Le second ACHÈVE la sélection.
    controller.onUnitTap(at(session, 0, 0), { col: 0, row: 0 }, {} as any);
    controller.onUnitTap(at(session, 1, 0), { col: 1, row: 0 }, {} as any);

    const units = session.getPlayerUnits();
    expect(units).toHaveLength(1);
    expect(units[0].card_id).toBe('DF1');
    // ⚠️ LE cas : sans la case retenue, l'unité se posait en (1,0) — la case du
    // dernier matériau taté, qui est le geste en un tap.
    expect(units[0].position).toEqual({ col: 3, row: 2 });
    expect(at(session, 3, 2)).toBe(units[0]);
  });

  it('sans case retenue, le geste en UN TAP est inchangé : la case du matériau', () => {
    const { session, controller } = withMaterials();
    const fusion = session.hand.find((c: any) => c.id === 'DF1') as any;
    controller.selectCard(fusion, session.hand.indexOf(fusion));

    controller.onUnitTap(at(session, 0, 0), { col: 0, row: 0 }, {} as any);
    controller.onUnitTap(at(session, 1, 0), { col: 1, row: 0 }, {} as any);

    const units = session.getPlayerUnits();
    expect(units).toHaveLength(1);
    expect(units[0].position).toEqual({ col: 1, row: 0 });
  });

  it('la RECETTE l\'emporte sur la case retenue quand elle impose la sienne', () => {
    // Une condition à UN matériel prend la place de ce matériel, d'où qu'on
    // ait lâché la carte : `forcedCell` est le seul endroit qui réponde à
    // « où », et il passe devant l'intention du joueur.
    const { session, controller } = withMaterials();
    const solo = session.hand.find((c: any) => c.id === 'DS1') as any;
    controller.selectCard(solo, session.hand.indexOf(solo));
    controller.onCellTap({ col: 4, row: 3 });
    controller.onUnitTap(at(session, 0, 0), { col: 0, row: 0 }, {} as any);

    const placed = session.getPlayerUnits().find((u: any) => u.card_id === 'DS1') as any;
    expect(placed.position).toEqual({ col: 0, row: 0 });
    expect(at(session, 4, 3)).toBeNull();
  });

  it('retaper la case retenue la libère', () => {
    const { session, controller } = withMaterials();
    const fusion = session.hand.find((c: any) => c.id === 'DF1') as any;
    controller.selectCard(fusion, session.hand.indexOf(fusion));
    controller.onCellTap({ col: 3, row: 2 });
    controller.onCellTap({ col: 3, row: 2 });
    expect(useGameStore.getState().invocationBanner).not.toContain('Case retenue');

    controller.onUnitTap(at(session, 0, 0), { col: 0, row: 0 }, {} as any);
    controller.onUnitTap(at(session, 1, 0), { col: 1, row: 0 }, {} as any);
    expect(session.getPlayerUnits()[0].position).toEqual({ col: 1, row: 0 });
  });

  it('changer de carte oublie la case retenue', () => {
    const { session, controller } = withMaterials();
    const fusion = session.hand.find((c: any) => c.id === 'DF1') as any;
    controller.selectCard(fusion, session.hand.indexOf(fusion));
    controller.onCellTap({ col: 3, row: 2 });
    controller.selectCard(fusion, session.hand.indexOf(fusion));   // re-sélection
    expect(useGameStore.getState().invocationBanner).not.toContain('Case retenue');

    controller.onUnitTap(at(session, 0, 0), { col: 0, row: 0 }, {} as any);
    controller.onUnitTap(at(session, 1, 0), { col: 1, row: 0 }, {} as any);
    expect(session.getPlayerUnits()[0].position).toEqual({ col: 1, row: 0 });
  });

  it('une case hors de la zone du joueur n\'est jamais retenue', () => {
    const { session, controller } = withMaterials();
    const fusion = session.hand.find((c: any) => c.id === 'DF1') as any;
    controller.selectCard(fusion, session.hand.indexOf(fusion));
    controller.onCellTap({ col: 2, row: 8 });                      // zone ennemie
    expect(useGameStore.getState().invocationBanner).not.toContain('Case retenue');
  });
});
