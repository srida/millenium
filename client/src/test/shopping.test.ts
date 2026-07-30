/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 4 — Phase Shopping. Couvre l'API de shopping de GameSession (le rôle
// « ShoppingController » du plan §3.4 vit dans GameSession, l'orchestrateur pur) :
// tirage + extraShoppingMagies, routage du ciblage, application des effets à
// cible (defuse_fusion / destroy_unit / revive) et carry-over des effets différés
// consommés au tour suivant (draw_bonus, guaranteed_draw, board_slot, modifiers de main).
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { Unit } from '../logic/Unit.js';
import { makeCard } from './helpers.js';

function magie(effect: any, over: any = {}) {
  return { id: over.id ?? 'MAGIC_T', name: over.name ?? 'Test', effect, ...over };
}

// Session minimale : deps synthétiques, deck ennemi vide (l'IA ne place rien).
function makeSession(opts: { cards?: any[]; magies?: any[] } = {}): {
  session: GameSession;
  magieCount: () => number;
} {
  const cards = opts.cards ?? [makeCard({ id: 'PLAIN', summon_type: 'normal' })];
  const byId = new Map(cards.map(c => [c.id, c]));
  let lastCount = 0;
  const magiePool = opts.magies ?? [];
  const deps: GameSessionDeps = {
    cardsByTier: { 1: cards.filter(c => (c.tier ?? 1) === 1) },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getRandomBoard: () => null,
    getRandomMagies: (n: number) => { lastCount = n; return magiePool.slice(0, n); },
  };
  return { session: new GameSession(deps), magieCount: () => lastCount };
}

function place(session: GameSession, card: any, pos: { col: number; row: number }): any {
  const u = new (Unit as any)(card, 'player');
  session.board.placeUnit(u, pos);
  return u;
}

describe('Shopping — tirage & extraShoppingMagies', () => {
  it('getShoppingMagies tire 3 par défaut, +extra, et consomme le compteur', () => {
    const { session, magieCount } = makeSession({ magies: Array.from({ length: 6 }, (_, i) => magie(null, { id: `M${i}` })) });
    session.getShoppingMagies();
    expect(magieCount()).toBe(3);

    session.gameState.player_extra_shopping_magies = 2;
    const drawn = session.getShoppingMagies();
    expect(magieCount()).toBe(5);
    expect(drawn).toHaveLength(5);
    // compteur remis à zéro après consommation
    expect(session.gameState.player_extra_shopping_magies).toBe(0);
  });
});

describe('Shopping — routage du ciblage', () => {
  it('magieNeedsUnitTarget / magieNeedsGraveyardTarget', () => {
    const { session } = makeSession();
    expect(session.magieNeedsUnitTarget(magie({ type: 'heal', value: 5 }) as any)).toBe(true);
    expect(session.magieNeedsUnitTarget(magie({ type: 'defuse_fusion' }) as any)).toBe(true);
    expect(session.magieNeedsGraveyardTarget(magie({ type: 'revive', value: 50 }) as any)).toBe(true);
    expect(session.magieNeedsUnitTarget(magie({ type: 'draw_bonus', value: 1 }) as any)).toBe(false);
  });

  it('magieUnitTargets(defuse_fusion) ne retient que les unités Fusion à matériaux', () => {
    const fusionCard = makeCard({ id: 'FUS', summon_type: 'fusion', cost: { materials: ['MAT_A', 'MAT_B'] } });
    const plainCard = makeCard({ id: 'PLAIN', summon_type: 'normal' });
    const { session } = makeSession({ cards: [fusionCard, plainCard, makeCard({ id: 'MAT_A' }), makeCard({ id: 'MAT_B' })] });
    place(session, fusionCard, { col: 0, row: 0 });
    place(session, plainCard, { col: 1, row: 0 });

    const targets = session.magieUnitTargets(magie({ type: 'defuse_fusion' }) as any);
    expect(targets).toHaveLength(1);
    expect(targets[0].card_id).toBe('FUS');
  });

  it('magieUnitTargets(autre) retient toutes les unités joueur', () => {
    const { session } = makeSession();
    place(session, makeCard({ id: 'PLAIN' }), { col: 0, row: 0 });
    place(session, makeCard({ id: 'PLAIN' }), { col: 1, row: 0 });
    expect(session.magieUnitTargets(magie({ type: 'heal', value: 5 }) as any)).toHaveLength(2);
  });
});

describe('Shopping — effets à cible', () => {
  it('defuse_fusion : sépare la fusion en ses matériaux sur le board', () => {
    const fusionCard = makeCard({ id: 'FUS', summon_type: 'fusion', cost: { materials: ['MAT_A', 'MAT_B'] } });
    const matA = makeCard({ id: 'MAT_A' });
    const matB = makeCard({ id: 'MAT_B' });
    const { session } = makeSession({ cards: [fusionCard, matA, matB] });
    const fusion = place(session, fusionCard, { col: 2, row: 0 });

    session.applyMagieOnUnit(magie({ type: 'defuse_fusion' }) as any, fusion);

    const units = session.getPlayerUnits();
    expect(units.map(u => u.card_id).sort()).toEqual(['MAT_A', 'MAT_B']);
    expect(units.some(u => u.card_id === 'FUS')).toBe(false);
    expect(session.graveyard).toHaveLength(0);
  });

  it('defuse_fusion : matériaux en surnombre débordent au cimetière', () => {
    const materials = ['A', 'B', 'C', 'D', 'E', 'F'];
    const fusionCard = makeCard({ id: 'FUS', summon_type: 'fusion', cost: { materials } });
    const matCards = materials.map(id => makeCard({ id }));
    const { session } = makeSession({ cards: [fusionCard, ...matCards] });
    // Board déjà rempli à 4 unités + la fusion = 5 (slots par défaut) ; après retrait
    // de la fusion il reste 1 slot pour 6 matériaux → 1 placé, 5 au cimetière.
    for (let c = 0; c < 4; c++) place(session, makeCard({ id: 'PLAIN' }), { col: c, row: 0 });
    const fusion = place(session, fusionCard, { col: 4, row: 0 });

    session.applyMagieOnUnit(magie({ type: 'defuse_fusion' }) as any, fusion);

    expect(session.getPlayerUnits()).toHaveLength(5); // 4 anciens + 1 matériau
    expect(session.graveyard).toHaveLength(5);
    expect(session.graveyard.every(u => u.is_neutralized)).toBe(true);
  });

  it('destroy_unit : retire l\'unité du board vers le cimetière', () => {
    const { session } = makeSession();
    const u = place(session, makeCard({ id: 'PLAIN' }), { col: 0, row: 0 });
    session.applyMagieOnUnit(magie({ type: 'destroy_unit' }) as any, u);
    expect(session.getPlayerUnits()).toHaveLength(0);
    expect(session.graveyard).toEqual([u]);
    expect(u.is_neutralized).toBe(true);
  });

  it('revive : ré-place l\'unité du cimetière et la retire du cimetière', () => {
    const { session } = makeSession();
    const card = makeCard({ id: 'PLAIN', stats: { hp: 40 } as any });
    const u = new (Unit as any)(card, 'player');
    u.is_neutralized = true;
    u.current_hp = 0;
    u.initial_position = { col: 1, row: 1 };
    session.graveyard = [u];

    session.applyMagieOnGraveyardUnit(magie({ type: 'revive', value: 50 }) as any, u);

    expect(session.graveyard).toHaveLength(0);
    expect(u.is_neutralized).toBe(false);
    expect(u.current_hp).toBe(Math.round(u.max_hp * 0.5));
    expect(session.board.getUnit({ col: 1, row: 1 })).toBe(u);
  });
});

describe('Shopping — carry-over des effets globaux (consommés au tour suivant)', () => {
  it('draw_bonus : la main du tour suivant reçoit les pioches en plus', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'draw_bonus', value: 2 }) as any);
    expect(session.gameState.player_extra_draws).toBe(2);
    session.startPreparation();
    expect(session.hand).toHaveLength(5 + 2);
    // consommé : ne se re-déclenche pas
    expect(session.gameState.player_extra_draws).toBe(0);
  });

  it('guaranteed_draw : pioche un exemplaire du tier demandé', () => {
    const t3 = makeCard({ id: 'T3', tier: 3 });
    const { session } = makeSession({ cards: [makeCard({ id: 'PLAIN', tier: 1 }), t3] });
    // tier 3 doit exister dans le pool complet pour la pioche garantie
    (session as any).deps.cardsByTier[3] = [t3];
    session.applyGlobalMagie(magie({ type: 'guaranteed_draw', tier: 3 }) as any);
    session.startPreparation();
    expect(session.hand.some(c => c.id === 'T3')).toBe(true);
    expect(session.gameState.player_guaranteed_draws).toHaveLength(0);
  });

  it('board_slot_bonus : slot permanent conservé', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'board_slot_bonus', value: 1 }) as any);
    expect(session.gameState.player_board_slots).toBe(6);
  });

  it('reduce_sacrifice_cost : réduit le coût d\'une carte Sacrifice en main', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'reduce_sacrifice_cost', value: 1 }) as any);
    session.hand = [makeCard({ id: 'SAC', summon_type: 'sacrifice', cost: { sacrifice: 3 } }) as any];
    session.startPreparation();
    const sac = session.hand.find(c => c.id === 'SAC')!;
    expect(sac.cost?.sacrifice).toBe(2);
    expect(session.gameState.player_hand_modifiers).toHaveLength(0);
  });

  it('free_transformation : marque une carte Transformation en main', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'free_transformation' }) as any);
    session.hand = [makeCard({ id: 'TR', summon_type: 'transformation', cost: { materials: ['X'] } }) as any];
    session.startPreparation();
    expect(session.hand.find(c => c.id === 'TR')!._free_transformation).toBe(true);
  });

  it('remove_heritage_material : vide le matériel obligatoire d\'une carte Heritage', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'remove_heritage_material' }) as any);
    session.hand = [makeCard({ id: 'HER', summon_type: 'heritage', cost: { materials: ['X'], sacrifice: 1 } }) as any];
    session.startPreparation();
    expect(session.hand.find(c => c.id === 'HER')!.cost?.materials).toEqual([]);
  });

  it('player_hp_bonus : appliqué immédiatement, cappé à 1000', () => {
    const { session } = makeSession();
    session.gameState.player_hp = 940;
    session.applyGlobalMagie(magie({ type: 'player_hp_bonus', value: 100 }) as any);
    expect(session.gameState.player_hp).toBe(1000);
  });
});
