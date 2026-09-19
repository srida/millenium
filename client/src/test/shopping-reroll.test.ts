/* eslint-disable @typescript-eslint/no-explicit-any */
// Reroll de la Phase Shopping — jeter l'offre en cours et en tirer une neuve
// contre 50 PV (`GameSession.canRerollShopping` / `rerollShoppingMagies`).
//
// Ce que ces tests éprouvent, et qui ne se voit pas à l'écran quand ça casse :
// le mot « nouvelles ». Un reroll qui pourrait reproposer ce que le joueur vient
// d'écarter lui ferait payer 50 PV pour la même offre — et rien, à l'écran, ne
// distinguerait ce cas d'un tirage malchanceux.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { SHOPPING_REROLL_COST_HP } from '../logic/GameState.js';
import { makeCard } from './helpers.js';

/** Le seul effet toujours pertinent, quel que soit l'état : la pioche du tour
 *  suivant a toujours lieu. Même bouche-trou que `shopping.test.ts`. */
const ALWAYS = { type: 'draw_bonus', value: 1 };

const magie = (id: string, effect: any = ALWAYS) => ({ id, name: id, effect });
const many = (n: number) => Array.from({ length: n }, (_, i) => magie(`M${String(i).padStart(2, '0')}`));

function makeSession(magies: any[], over: Partial<GameSessionDeps> = {}): GameSession {
  const card = makeCard({ id: 'PLAIN', summon_conditions: [] });
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [card] as any },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (id === 'PLAIN' ? (card as any) : null) },
    getAllBoards: () => [],
    getAllMagies: () => magies,
    ...over,
  } as GameSessionDeps;
  return new GameSession(deps);
}

const ids = (list: { id: string }[] | null) => (list ?? []).map(m => m.id);

describe('Reroll du Shopping — disponibilité', () => {
  it('est proposé dès qu\'une offre est à l\'écran et que le catalogue a de la réserve', () => {
    const session = makeSession(many(10));
    session.getShoppingMagies();
    expect(session.canRerollShopping()).toBe(true);
  });

  it('n\'est pas proposé quand tout le catalogue pertinent a DÉJÀ été montré', () => {
    // Exactement 3 magies : l'offre d'ouverture les épuise.
    const session = makeSession(many(3));
    expect(session.getShoppingMagies()).toHaveLength(3);
    expect(session.canRerollShopping()).toBe(false);
    expect(session.rerollShoppingMagies()).toBeNull();
  });

  it('ne compte que les magies PERTINENTES : une réserve inapplicable n\'en est pas une', () => {
    // `revive` exige un cimetière non vide — il est vide ici, donc les trois
    // magies de réserve ne sont offrables par personne.
    const session = makeSession([
      ...many(3),
      magie('R0', { type: 'revive', value: 50 }),
      magie('R1', { type: 'revive', value: 50 }),
    ]);
    session.getShoppingMagies();
    expect(session.canRerollShopping()).toBe(false);
  });

  it('exige de survivre au paiement — comparaison STRICTE', () => {
    const session = makeSession(many(10));
    session.getShoppingMagies();

    session.gameState.player_hp = SHOPPING_REROLL_COST_HP;
    expect(session.canRerollShopping()).toBe(false);
    expect(session.rerollShoppingMagies()).toBeNull();

    session.gameState.player_hp = SHOPPING_REROLL_COST_HP + 1;
    expect(session.canRerollShopping()).toBe(true);
    expect(session.rerollShoppingMagies()).not.toBeNull();
    expect(session.gameState.player_hp).toBe(1);
  });

  it('n\'existe pas HORS d\'une Phase Shopping — et ne débite rien', () => {
    const session = makeSession(many(10));
    const hp = session.gameState.player_hp;
    // Aucune offre n'a été tirée : il n'y a pas d'offre à rejeter, et un
    // `pickMagies` de taille 0 rendrait une offre vide pour 50 PV.
    expect(session.canRerollShopping()).toBe(false);
    expect(session.rerollShoppingMagies()).toBeNull();
    expect(session.gameState.player_hp).toBe(hp);
  });

  it('un refus ne débite RIEN', () => {
    const session = makeSession(many(3));
    session.getShoppingMagies();
    const hp = session.gameState.player_hp;
    expect(session.rerollShoppingMagies()).toBeNull();
    expect(session.gameState.player_hp).toBe(hp);
  });
});

describe('Reroll du Shopping — ce qu\'il fait', () => {
  it('débite le coût et rend AUTANT de magies que l\'offre d\'ouverture', () => {
    const session = makeSession(many(10));
    const first = session.getShoppingMagies();
    const hp = session.gameState.player_hp;

    const second = session.rerollShoppingMagies();
    expect(second).toHaveLength(first.length);
    expect(session.gameState.player_hp).toBe(hp - SHOPPING_REROLL_COST_HP);
  });

  it('⚠️ ne repropose JAMAIS une magie déjà montrée cette phase', () => {
    const session = makeSession(many(12));
    const first = ids(session.getShoppingMagies());
    const second = ids(session.rerollShoppingMagies());

    expect(second).toHaveLength(3);
    expect(second.filter(id => first.includes(id))).toEqual([]);
  });

  it('l\'exclusion est CUMULATIVE : trois rerolls, neuf magies distinctes', () => {
    const session = makeSession(many(12));
    const seen = [
      ...ids(session.getShoppingMagies()),
      ...ids(session.rerollShoppingMagies()),
      ...ids(session.rerollShoppingMagies()),
      ...ids(session.rerollShoppingMagies()),
    ];
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    // Le pool est épuisé : le geste se borne tout seul, sans compteur à tenir.
    expect(session.canRerollShopping()).toBe(false);
  });

  it('garde la TAILLE de l\'offre quand un shopping_bonus l\'a élargie', () => {
    const session = makeSession(many(12));
    session.gameState.player_extra_shopping_magies = 1;
    expect(session.getShoppingMagies()).toHaveLength(4);
    // Le compteur a été consommé à l'ouverture — mais la taille de la phase
    // reste la sienne, sinon le bonus s'évaporerait au premier reroll.
    expect(session.gameState.player_extra_shopping_magies).toBe(0);
    expect(session.rerollShoppingMagies()).toHaveLength(4);
  });

  it('le registre repart de zéro à la phase suivante', () => {
    const session = makeSession(many(6));
    const first = ids(session.getShoppingMagies());
    session.rerollShoppingMagies();
    expect(session.canRerollShopping()).toBe(false);   // les 6 sont vues

    // Nouvelle phase : tout le catalogue redevient montrable.
    const next = ids(session.getShoppingMagies());
    expect(next).toHaveLength(3);
    expect(session.canRerollShopping()).toBe(true);
    expect(first.length).toBe(3);
  });

  it('une offre plus COURTE que la taille visée reste honnête (pool épuisé)', () => {
    // 5 magies : l'ouverture en montre 3, il n'en reste que 2.
    const session = makeSession(many(5));
    session.getShoppingMagies();
    expect(session.rerollShoppingMagies()).toHaveLength(2);
  });
});

describe('Reroll du Shopping — l\'info de l\'offre', () => {
  it('cesse d\'annoncer une magie GARANTIE que le joueur vient de jeter', () => {
    const session = makeSession(many(12));
    session.gameState.player_guaranteed_magies = [{ rarity: 1 } as any];
    session.getShoppingMagies();
    expect(session.getLastShoppingBonusInfo().guaranteedCount).toBe(1);

    session.rerollShoppingMagies();
    expect(session.getLastShoppingBonusInfo().guaranteedCount).toBe(0);
  });

  it('continue d\'annoncer le shopping_bonus, lui : l\'offre garde sa taille', () => {
    const session = makeSession(many(12));
    session.gameState.player_extra_shopping_magies = 2;
    session.getShoppingMagies();
    session.rerollShoppingMagies();
    expect(session.getLastShoppingBonusInfo().extra).toBe(2);
  });
});
