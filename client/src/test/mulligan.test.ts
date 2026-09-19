/* eslint-disable @typescript-eslint/no-explicit-any */
// Mulligan — au tour 1, remettre sa main dans le deck et en repiocher autant,
// contre 50 PV (`GameSession.canMulligan` / `mulligan`).
//
// Ce que ces tests éprouvent, et qui ne se voit nulle part à l'écran quand ça
// casse : le mulligan DÉPLACE le point de retour de « Tout annuler ». Sans ce
// déplacement, un ↺ rendrait la main d'avant sans rendre les 50 PV — le joueur
// paierait pour rien, et rien dans l'interface ne le dirait.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { MULLIGAN_COST_HP } from '../logic/GameState.js';
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

  it('une seule fois par PARTIE — le second appel ne débite rien', () => {
    const session = makeSession();
    session.startPreparation();
    expect(session.mulligan()).toBe(true);
    expect(session.canMulligan()).toBe(false);

    const hp = session.gameState.player_hp;
    const hand = ids(session);
    expect(session.mulligan()).toBe(false);
    expect(session.gameState.player_hp).toBe(hp);
    expect(ids(session)).toEqual(hand);
  });

  it('au tour 1 SEULEMENT — jamais aux tours suivants', () => {
    const session = makeSession();
    session.startPreparation();
    session.gameState.round = 2;
    expect(session.canMulligan()).toBe(false);
    expect(session.mulligan()).toBe(false);
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

  it('exige de survivre au paiement — comparaison STRICTE, comme un contrecoup de magie', () => {
    const session = makeSession();
    session.startPreparation();

    session.gameState.player_hp = MULLIGAN_COST_HP;        // paierait jusqu'à 0
    expect(session.canMulligan()).toBe(false);
    session.gameState.player_hp = MULLIGAN_COST_HP + 1;    // laisse 1 PV
    expect(session.canMulligan()).toBe(true);
    expect(session.mulligan()).toBe(true);
    expect(session.gameState.player_hp).toBe(1);
  });

  it('n\'est pas proposé sur une main vide — il n\'y a rien à rendre', () => {
    const session = makeSession({ cardsByTier: {} as any });
    session.startPreparation();
    expect(session.hand).toHaveLength(0);
    expect(session.canMulligan()).toBe(false);
  });
});

describe('Mulligan — ce qu\'il fait', () => {
  it('débite le coût et repioche AUTANT de cartes qu\'il en rend', () => {
    const session = makeSession();
    session.startPreparation();
    const before = session.hand.length;
    const hp = session.gameState.player_hp;

    expect(session.mulligan()).toBe(true);
    expect(session.hand).toHaveLength(before);
    expect(session.gameState.player_hp).toBe(hp - MULLIGAN_COST_HP);
  });

  it('repioche la taille RÉELLE de la main, pas 5 en dur', () => {
    const session = makeSession();
    // Au tour 1 la main vaut toujours 5 (les bonus de pioche sont des effets de
    // fin de combat) : on force le cas où les deux lectures divergent, sinon
    // rien ne distingue « autant qu'on en rend » d'un 5 écrit en dur.
    session.gameState.player_extra_draws = 2;
    session.startPreparation();
    expect(session.hand).toHaveLength(7);

    expect(session.mulligan()).toBe(true);
    expect(session.hand).toHaveLength(7);
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

  it('⚠️ DÉPLACE le point de retour : ↺ ne rend ni la main d\'avant ni les PV', () => {
    const session = makeSession();
    session.startPreparation();
    const oldHand = ids(session);

    expect(session.mulligan()).toBe(true);
    const newHand = ids(session);
    const hp = session.gameState.player_hp;

    // Rien à annuler juste après : l'état d'après la repioche EST l'ouverture
    // du tour. C'est l'assertion qui tombe si la capture n'est pas rejouée.
    expect(session.canUndoPreparation()).toBe(false);
    expect(session.undoPreparation()).toBe(false);

    // Et après une invocation, ↺ revient à la main REPIOCHÉE, pas à l'ancienne.
    session.place(session.hand[0], { col: 0, row: 0 }, [], 0);
    expect(session.undoPreparation()).toBe(true);
    expect(ids(session)).toEqual(newHand);
    expect(ids(session)).not.toEqual(oldHand);
    expect(session.gameState.player_hp).toBe(hp);
  });
});
