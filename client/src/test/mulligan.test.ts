/* eslint-disable @typescript-eslint/no-explicit-any */
// Mulligan — remettre sa main dans le deck et en repiocher une carte de
// MOINS, sans énergie, une fois par tour (`GameSession.canMulligan` /
// `mulligan`).
//
// Ce que ces tests éprouvent, et qui ne se voit nulle part à l'écran quand ça
// casse : le mulligan DÉPLACE le point de retour de « Tout annuler ». Sans ce
// déplacement, un ↺ rendrait la main d'avant, carte perdue comprise.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { MULLIGAN_CARD_PENALTY } from '../logic/GameState.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';

/** Un pool de tour 1 assez large pour qu'une repioche se voie. */
const POOL = Array.from({ length: 12 }, (_, i) =>
  makeCard({ id: `T1_${String(i).padStart(2, '0')}`, tier: 1, summon_conditions: [] }));

function makeSession(over: Partial<GameSessionDeps> = {}): GameSession {
  const byId = new Map(POOL.map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: POOL as any },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => [],
    ...over,
  } as GameSessionDeps;
  return new GameSession(deps);
}

const ids = (session: GameSession) => session.hand.map(c => c.id);

describe('Mulligan — disponibilité', () => {
  it('est proposé au sortir de la première préparation', () => {
    const session = makeSession();
    session.startPreparation();
    expect(session.canMulligan()).toBe(true);
  });

  it('une seule fois par TOUR — le second appel ne débite rien', () => {
    const session = makeSession();
    session.gameState.player_energy_reserve = 10;
    session.startPreparation();
    expect(session.mulligan()).toBe(true);
    expect(session.canMulligan()).toBe(false);

    const reserve = session.energyReserve();
    const hand = ids(session);
    expect(session.mulligan()).toBe(false);
    expect(session.energyReserve()).toBe(reserve);
    expect(ids(session)).toEqual(hand);
  });

  it('redevient disponible au tour suivant', () => {
    const session = makeSession();
    session.gameState.player_energy_reserve = 10;
    session.startPreparation();
    expect(session.mulligan()).toBe(true);
    session.gameState.round = 2;
    session.startPreparation();
    expect(session.canMulligan()).toBe(true);
  });

  it('se retire dès qu\'une unité est posée — le tour doit être intact', () => {
    const session = makeSession();
    session.startPreparation();
    expect(session.canMulligan()).toBe(true);

    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    expect(session.canUndoPreparation()).toBe(true);
    expect(session.canMulligan()).toBe(false);
    expect(session.mulligan()).toBe(false);
  });

  it('se retire aussi sur un simple DÉPLACEMENT, qui ne passe pas par GameSession', () => {
    const session = makeSession();
    session.startPreparation();
    const u = new (Unit as any)(POOL[0], 'player');
    session.board.placeUnit(u, { col: 0, row: 0 });
    // Le board capturé au snapshot ne portait pas cette unité : le tour n'est
    // plus intact, donc plus de mulligan.
    expect(session.canMulligan()).toBe(false);
  });

  // Mutation : remettre `canPayEnergy(2)` dans `canMulligan` → ROUGE.
  it('ne demande AUCUNE énergie, même à budget et réserve nuls', () => {
    const session = makeSession();
    session.startPreparation();
    session.gameState.player_energy_bonus = -3;  // budget du tour 1 ramené à 0
    session.gameState.player_energy_reserve = 0;
    expect(session.energyAvailable()).toBe(0);
    expect(session.canMulligan()).toBe(true);
    expect(session.mulligan()).toBe(true);
    expect(session.energyReserve()).toBe(0);
  });

  it('ne touche ni au budget du tour ni à la réserve', () => {
    const session = makeSession();
    session.startPreparation();
    session.gameState.player_energy_reserve = 4;
    const budget = session.energyBudget();
    expect(session.mulligan()).toBe(true);
    expect(session.energyReserve()).toBe(4);
    expect(session.energyBudget()).toBe(budget);
  });

  it('ne touche jamais aux PV', () => {
    const session = makeSession();
    session.startPreparation();
    const hp = session.gameState.player_hp;
    session.mulligan();
    expect(session.gameState.player_hp).toBe(hp);
  });

  it('n\'est pas proposé sur une main d\'une seule carte — il ne resterait rien', () => {
    const session = makeSession();
    session.startPreparation();
    session.hand = session.hand.slice(0, MULLIGAN_CARD_PENALTY);
    expect(session.canMulligan()).toBe(false);
    expect(session.mulligan()).toBe(false);
    expect(session.hand).toHaveLength(MULLIGAN_CARD_PENALTY);
  });

  it('n\'est pas proposé sur une main vide — il n\'y a rien à rendre', () => {
    const session = makeSession({ cardsByTier: {} as any });
    session.startPreparation();
    expect(session.hand).toHaveLength(0);
    expect(session.canMulligan()).toBe(false);
  });
});

describe('Mulligan — ce qu\'il fait', () => {
  // Mutation : repiocher `hand.length` → ROUGE.
  it('repioche UNE CARTE DE MOINS qu\'il n\'en rend, sans débiter d\'énergie', () => {
    const session = makeSession();
    session.startPreparation();
    const before = session.hand.length;
    const available = session.energyAvailable();

    expect(session.mulligan()).toBe(true);
    expect(session.hand).toHaveLength(before - MULLIGAN_CARD_PENALTY);
    expect(session.energyAvailable()).toBe(available);
  });

  it('repioche la taille RÉELLE de la main, pas 5 en dur', () => {
    const session = makeSession();
    // Au tour 1 la main vaut toujours 5 (les bonus de pioche sont des effets de
    // fin de combat) : on force le cas où les deux lectures divergent, sinon
    // rien ne distingue « la main moins une » d'un 4 écrit en dur.
    session.gameState.player_extra_draws = 2;
    session.startPreparation();
    expect(session.hand).toHaveLength(7);

    expect(session.mulligan()).toBe(true);
    expect(session.hand).toHaveLength(7 - MULLIGAN_CARD_PENALTY);
  });

  it('la main est bien REPIOCHÉE : deux graines différentes ne rendent pas la même', () => {
    // Le hasard est injecté : on force deux flux distincts plutôt que d'espérer
    // qu'un tirage aléatoire diffère.
    const scripted = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };
    const a = makeSession({ rand: scripted([0.01]) });
    const b = makeSession({ rand: scripted([0.01, 0.01, 0.01, 0.01, 0.01, 0.99]) });
    a.startPreparation(); b.startPreparation();
    expect(ids(a)).toEqual(ids(b));               // même main de départ
    a.mulligan(); b.mulligan();
    expect(ids(a)).not.toEqual(ids(b));           // la repioche a bien consommé du hasard
  });

  it('garde `prepId` intact — c\'est le MÊME tour de préparation', () => {
    const session = makeSession();
    session.startPreparation();
    const prepId = session.prepId;
    session.mulligan();
    expect(session.prepId).toBe(prepId);
  });

  it('⚠️ DÉPLACE le point de retour : ↺ ne rend ni la main d\'avant ni la carte perdue', () => {
    const session = makeSession();
    session.startPreparation();
    const oldHand = ids(session);

    expect(session.mulligan()).toBe(true);
    const newHand = ids(session);
    const budget = session.energyBudget();

    // Rien à annuler juste après : l'état d'après la repioche EST l'ouverture
    // du tour. C'est l'assertion qui tombe si la capture n'est pas rejouée.
    expect(session.canUndoPreparation()).toBe(false);
    expect(session.undoPreparation()).toBe(false);

    // Et après une invocation, ↺ revient à la main REPIOCHÉE, pas à l'ancienne.
    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    expect(session.undoPreparation()).toBe(true);
    expect(ids(session)).toEqual(newHand);
    expect(ids(session)).not.toEqual(oldHand);
    expect(session.energyBudget()).toBe(budget);
  });
});
