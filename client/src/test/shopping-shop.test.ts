/* eslint-disable @typescript-eslint/no-explicit-any */
// La boutique de la Phase Shopping — des magies (prix selon la rareté) et trois
// cartes (prix selon le rôle), payées en ⚡ de réserve, achetées une à une ;
// et son reroll à 1 ⚡ (`GameSession.openShop` / `chargeMagie` /
// `buyShopCard` / `rerollShop`).
//
// Ce que ces tests éprouvent, et qui ne se voit pas à l'écran quand ça casse :
// le mot « nouvelles » du reroll (il ne repropose jamais ce que le joueur vient
// d'écarter), et qu'un achat refusé ne débite RIEN.
import { describe, it, expect } from 'vitest';
import { GameSession, Phase } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { SHOPPING_REROLL_COST_ENERGY, MAGIE_ENERGY_PRICE, CARD_ENERGY_PRICE } from '../logic/GameState.js';
import { makeCard } from './helpers.js';

/** Le seul effet toujours pertinent, quel que soit l'état : la pioche du tour
 *  suivant a toujours lieu. Même bouche-trou que `shopping.test.ts`. */
const ALWAYS = { type: 'draw_bonus', value: 1 };

const magie = (id: string, effect: any = ALWAYS, rarity = 1) => ({ id, name: id, effect, rarity });
const many = (n: number) => Array.from({ length: n }, (_, i) => magie(`M${String(i).padStart(2, '0')}`));

function makeSession(magies: any[], over: Partial<GameSessionDeps> = {}, cards = [makeCard({ id: 'PLAIN', summon_conditions: [] })]): GameSession {
  const byId = new Map(cards.map(c => [c.id, c]));
  const deps: GameSessionDeps = {
    cardsByTier: { 1: cards as any },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => magies,
    ...over,
  } as GameSessionDeps;
  const s = new GameSession(deps);
  s.gameState.player_energy_reserve = 100;
  // La boutique s'ouvre après le combat : le budget du tour n'y compte pas.
  s.gameState.phase = Phase.END_ROUND;
  return s;
}

const ids = (list: { id: string }[] | null) => (list ?? []).map(m => m.id);
const shopIds = (s: GameSession) => ids(s.shopMagies());

describe('Boutique — prix', () => {
  it('une magie coûte 1, 2 ou 3 ⚡ selon sa rareté', () => {
    const session = makeSession([]);
    expect([1, 2, 3].map(r => session.magiePrice(magie('X', ALWAYS, r) as any))).toEqual([1, 2, 3]);
    expect(MAGIE_ENERGY_PRICE).toEqual({ 1: 1, 2: 2, 3: 3 });
  });

  it('une carte coûte selon son rôle : le lien se paie, le pari se récompense', () => {
    expect(CARD_ENERGY_PRICE).toEqual({ link: 3, buildable: 2, bet: 1 });
  });
});

describe('Boutique — magies', () => {
  it('chargeMagie débite le prix et retire la magie de l\'étal', () => {
    const session = makeSession([magie('L', ALWAYS, 3), ...many(2)]);
    session.openShop();
    const m = session.shopMagies().find(x => x.id === 'L')!;
    expect(session.chargeMagie(m)).toBe(true);
    expect(session.energyReserve()).toBe(97);
    expect(shopIds(session)).not.toContain('L');
    expect(session.shopMagies()).toHaveLength(2);
  });

  it('les achats s\'enchaînent tant que la réserve suit', () => {
    const session = makeSession(many(3));
    session.gameState.player_energy_reserve = 2;
    session.openShop();
    const [a, b, c] = session.shopMagies();
    expect(session.chargeMagie(a)).toBe(true);
    expect(session.chargeMagie(b)).toBe(true);
    expect(session.canBuyMagie(c)).toBe(false);
    expect(session.chargeMagie(c)).toBe(false);
    expect(session.energyReserve()).toBe(0);
    expect(session.shopMagies()).toEqual([c]);
  });

  it('une magie hors de l\'étal ne s\'achète pas', () => {
    const session = makeSession(many(3));
    session.openShop();
    expect(session.chargeMagie(magie('AILLEURS') as any)).toBe(false);
    expect(session.energyReserve()).toBe(100);
  });

  it('le contrecoup en PV reste exigé en plus du prix', () => {
    const session = makeSession([{ ...magie('CHER'), cost_hp: 5000 }, ...many(2)]);
    session.openShop();
    const m = session.shopMagies().find(x => x.id === 'CHER')!;
    expect(session.canBuyMagie(m)).toBe(false);
  });

  it('la boutique ne paie qu\'avec la RÉSERVE hors préparation', () => {
    const session = makeSession(many(3));
    session.gameState.player_energy_reserve = 0;
    session.openShop();
    expect(session.canBuyMagie(session.shopMagies()[0])).toBe(false);
  });
});

describe('Boutique — cartes', () => {
  // Un deck où les trois rôles existent : A est jouable, B nomme A (lien),
  // C exige une carte absente (pari).
  const A = makeCard({ id: 'A', summon_conditions: [] });
  const B = makeCard({ id: 'B', summon_conditions: [{ materials: 1, requires: ['A'] }] as any });
  const C = makeCard({ id: 'C', summon_conditions: [{ materials: 1, requires: ['ZZZ'] }] as any });
  const D = makeCard({ id: 'D', summon_conditions: [] });

  it('trois cartes du deck, une par rôle, au prix de leur rôle', () => {
    const session = makeSession([], {}, [A, B, C, D]);
    session.hand = [{ ...A }];
    const { cards } = session.openShop();
    expect(cards).toHaveLength(3);
    const byKind = Object.fromEntries(cards.map(c => [c.kind, c]));
    expect(byKind.link.card.id).toMatch(/^[AB]$/);
    expect(byKind.bet.card.id).toBe('C');
    for (const c of cards) expect(c.price).toBe(CARD_ENERGY_PRICE[c.kind]);
  });

  it('une carte achetée rejoint la main (un objet neuf) et quitte l\'étal', () => {
    const session = makeSession([], {}, [A, B, C, D]);
    session.openShop();
    const before = session.hand.length;
    const offer = session.shopCards()[0];
    const card = session.buyShopCard(0)!;
    expect(card.id).toBe(offer.card.id);
    expect(card).not.toBe(offer.card);
    expect(session.hand).toHaveLength(before + 1);
    expect(session.shopCards()).toHaveLength(2);
    expect(session.energyReserve()).toBe(100 - offer.price);
  });

  it('un achat impayable ne débite rien et ne touche pas la main', () => {
    const session = makeSession([], {}, [A, B, C, D]);
    session.gameState.player_energy_reserve = 0;
    session.openShop();
    expect(session.buyShopCard(0)).toBeNull();
    expect(session.hand).toHaveLength(0);
    expect(session.shopCards()).toHaveLength(3);
  });

  it('ne propose que les tiers du tour qui vient', () => {
    const T3 = makeCard({ id: 'T3', tier: 3, summon_conditions: [] });
    const session = makeSession([], { cardsByTier: { 1: [A] as any, 3: [T3] as any } }, [A, T3]);
    expect(session.openShop().cards.map(c => c.card.id)).toEqual(['A']);   // tour 1 → tiers 1–2
  });
});

describe('Boutique — ouverture et fermeture', () => {
  it('le tour suivant ferme la boutique : plus rien à acheter ni à reroller', () => {
    const session = makeSession(many(10));
    session.openShop();
    session.startNextRound();
    expect(session.shopMagies()).toEqual([]);
    expect(session.shopCards()).toEqual([]);
    expect(session.canRerollShopping()).toBe(false);
  });

  it('l\'énergie non posée part en réserve au lancement du combat', () => {
    const session = makeSession([]);
    session.gameState.player_energy_reserve = 0;
    session.gameState.phase = Phase.PREPARATION;
    session.startPreparation();          // tour 1 : budget 3, rien de posé
    session.startCombat(null);
    expect(session.energyReserve()).toBe(3);
  });
});

describe('Reroll de la boutique — disponibilité', () => {
  it('est proposé dès qu\'une offre est à l\'écran et que le catalogue a de la réserve', () => {
    const session = makeSession(many(10));
    session.openShop();
    expect(session.canRerollShopping()).toBe(true);
  });

  it('n\'est pas proposé quand tout le catalogue pertinent a DÉJÀ été montré', () => {
    const session = makeSession(many(3));
    session.openShop();
    expect(session.shopMagies()).toHaveLength(3);
    expect(session.canRerollShopping()).toBe(false);
    expect(session.rerollShop()).toBe(false);
  });

  it('ne compte que les magies PERTINENTES : une réserve inapplicable n\'en est pas une', () => {
    const session = makeSession([
      ...many(3),
      magie('R0', { type: 'revive', value: 50 }),
      magie('R1', { type: 'revive', value: 50 }),
    ]);
    session.openShop();
    expect(session.canRerollShopping()).toBe(false);
  });

  it('exige l\'énergie, et un refus ne débite rien', () => {
    const session = makeSession(many(10));
    session.openShop();
    session.gameState.player_energy_reserve = SHOPPING_REROLL_COST_ENERGY - 1;
    expect(session.canRerollShopping()).toBe(false);
    expect(session.rerollShop()).toBe(false);
    expect(session.energyReserve()).toBe(SHOPPING_REROLL_COST_ENERGY - 1);

    session.gameState.player_energy_reserve = SHOPPING_REROLL_COST_ENERGY;
    expect(session.rerollShop()).toBe(true);
    expect(session.energyReserve()).toBe(0);
  });

  it('n\'existe pas HORS d\'une Phase Shopping — et ne débite rien', () => {
    const session = makeSession(many(10));
    expect(session.canRerollShopping()).toBe(false);
    expect(session.rerollShop()).toBe(false);
    expect(session.energyReserve()).toBe(100);
  });

  it('ne touche jamais aux PV', () => {
    const session = makeSession(many(10));
    session.openShop();
    const hp = session.gameState.player_hp;
    session.rerollShop();
    expect(session.gameState.player_hp).toBe(hp);
  });
});

describe('Reroll de la boutique — ce qu\'il fait', () => {
  it('rend une offre PLEINE, même après des achats', () => {
    const session = makeSession(many(10));
    session.openShop();
    session.chargeMagie(session.shopMagies()[0]);
    expect(session.shopMagies()).toHaveLength(2);
    session.rerollShop();
    expect(session.shopMagies()).toHaveLength(3);
  });

  it('⚠️ ne repropose JAMAIS une magie déjà montrée cette phase', () => {
    const session = makeSession(many(12));
    session.openShop();
    const first = shopIds(session);
    session.rerollShop();
    const second = shopIds(session);
    expect(second).toHaveLength(3);
    expect(second.filter(id => first.includes(id))).toEqual([]);
  });

  it('l\'exclusion est CUMULATIVE : trois rerolls, douze magies distinctes', () => {
    const session = makeSession(many(12));
    session.openShop();
    const seen = [...shopIds(session)];
    for (let i = 0; i < 3; i++) { session.rerollShop(); seen.push(...shopIds(session)); }
    expect(new Set(seen).size).toBe(12);
    expect(session.canRerollShopping()).toBe(false);
  });

  it('garde la TAILLE de l\'offre quand un shopping_bonus l\'a élargie', () => {
    const session = makeSession(many(12));
    session.gameState.player_extra_shopping_magies = 1;
    session.openShop();
    expect(session.shopMagies()).toHaveLength(4);
    session.rerollShop();
    expect(session.shopMagies()).toHaveLength(4);
  });

  it('le registre repart de zéro à la phase suivante', () => {
    const session = makeSession(many(6));
    session.openShop();
    session.rerollShop();
    expect(session.canRerollShopping()).toBe(false);
    session.openShop();
    expect(session.shopMagies()).toHaveLength(3);
    expect(session.canRerollShopping()).toBe(true);
  });

  it('cesse d\'annoncer une magie GARANTIE que le joueur vient de jeter', () => {
    const session = makeSession(many(12));
    session.gameState.player_guaranteed_magies = [{ rarity: 1 } as any];
    session.openShop();
    expect(session.getLastShoppingBonusInfo().guaranteedCount).toBe(1);
    session.rerollShop();
    expect(session.getLastShoppingBonusInfo().guaranteedCount).toBe(0);
  });
});
