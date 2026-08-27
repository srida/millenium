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
import { makeRandom } from '../logic/Random.js';
import { makeCard } from './helpers.js';

function magie(effect: any, over: any = {}) {
  return { id: over.id ?? 'MAGIC_T', name: over.name ?? 'Test', effect, ...over };
}

/** Le seul effet toujours pertinent, quel que soit l'état : la pioche du tour
 *  suivant a toujours lieu. Sert de bouche-trou partout où le test porte sur le
 *  NOMBRE de magies offertes et non sur leur nature. */
const ALWAYS = { type: 'draw_bonus', value: 1 };

// Session minimale : deps synthétiques, deck ennemi vide (l'IA ne place rien).
// ⚠️ La dep est `getAllMagies` : c'est `GameSession` qui filtre et tire, la
// couche data ne fait plus que fournir le catalogue.
function makeSession(opts: { cards?: any[]; magies?: any[]; rand?: () => number; mode?: 'ai' | 'pvp' } = {}): {
  session: GameSession;
} {
  const cards = opts.cards ?? [makeCard({ id: 'PLAIN', summon_type: 'normal' })];
  const byId = new Map(cards.map(c => [c.id, c]));
  const magiePool = opts.magies ?? [];
  const deps: GameSessionDeps = {
    cardsByTier: { 1: cards.filter(c => (c.tier ?? 1) === 1) },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getRandomBoard: () => null,
    getAllMagies: () => magiePool,
    rand: opts.rand,
    mode: opts.mode,
  };
  return { session: new GameSession(deps) };
}

/** Les ids offerts pour un état donné — l'assertion de base des tests d'offre. */
function offeredIds(session: GameSession): string[] {
  return session.getShoppingMagies().map(m => m.id);
}

function place(session: GameSession, card: any, pos: { col: number; row: number }): any {
  const u = new (Unit as any)(card, 'player');
  session.board.placeUnit(u, pos);
  return u;
}

const manyAlways = (n: number) => Array.from({ length: n }, (_, i) => magie(ALWAYS, { id: `M${i}` }));

describe('Shopping — tirage & extraShoppingMagies', () => {
  it('getShoppingMagies tire 3 par défaut, +extra, et consomme le compteur', () => {
    const { session } = makeSession({ magies: manyAlways(6) });
    expect(session.getShoppingMagies()).toHaveLength(3);

    session.gameState.player_extra_shopping_magies = 2;
    expect(session.getShoppingMagies()).toHaveLength(5);
    // compteur remis à zéro après consommation
    expect(session.gameState.player_extra_shopping_magies).toBe(0);
  });

  it('sans remise : une magie n\'occupe jamais deux emplacements de la même offre', () => {
    const { session } = makeSession({ magies: manyAlways(8) });
    session.gameState.player_extra_shopping_magies = 5; // 8 emplacements pour 8 magies
    const ids = offeredIds(session);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });

  it('pool pertinent plus court que le compte : offre courte, et l\'extra est PERDU', () => {
    // Décision figée : le compteur est un octroi POUR CE TOUR, pas une dette.
    // Le tour où il ne reste rien à offrir est celui où une magie de plus
    // n'existe pas.
    const { session } = makeSession({ magies: manyAlways(2) });
    session.gameState.player_extra_shopping_magies = 3;
    expect(session.getShoppingMagies()).toHaveLength(2);
    expect(session.gameState.player_extra_shopping_magies).toBe(0);
  });

  it('offre vide quand plus rien n\'est pertinent — le contrôleur saute alors la phase', () => {
    const { session } = makeSession({ magies: [magie({ type: 'heal' }, { id: 'HEAL' })] });
    expect(session.getPlayerUnits()).toHaveLength(0);
    expect(session.getShoppingMagies()).toEqual([]);
  });

  it('le tirage passe par deps.rand : deux sessions semées à l\'identique offrent la même chose', () => {
    const pool = manyAlways(10);
    const a = makeSession({ magies: pool, rand: makeRandom(7) }).session;
    const b = makeSession({ magies: pool, rand: makeRandom(7) }).session;
    expect(offeredIds(a)).toEqual(offeredIds(b));
  });
});

describe('Shopping — pertinence de l\'offre', () => {
  // ⚠️ Chaque cas est éprouvé DANS LES DEUX SENS : l'état où la magie doit
  // être absente, et celui où elle doit revenir. Un seul des deux ne prouverait
  // rien — une offre vide passe le premier sans effort.

  it('magies à cible d\'unité : absentes board vide, présentes dès une unité', () => {
    const types = ['stat_bonus', 'stat_modifier', 'shield', 'heal',
      'team_stat_bonus', 'team_heal', 'destroy_unit', 'drain_life'];
    const pool = types.map(type => magie({ type, stat: 'atk', value: 1 }, { id: type }));
    const { session } = makeSession({ magies: pool });

    expect(session.getShoppingMagies()).toEqual([]);

    place(session, makeCard({ id: 'PLAIN' }), { col: 0, row: 0 });
    session.gameState.player_extra_shopping_magies = types.length - 3;
    expect(offeredIds(session).sort()).toEqual([...types].sort());
  });

  it('defuse_fusion : ni sans unité, ni sur une normale, ni sur une Fusion SANS matériaux', () => {
    const fusionCard = makeCard({ id: 'FUS', summon_type: 'fusion', cost: { materials: ['MAT_A'] } });
    const emptyFusion = makeCard({ id: 'EMPTY', summon_type: 'fusion', cost: { materials: [] } });
    const plain = makeCard({ id: 'PLAIN', summon_type: 'normal' });
    const pool = [magie({ type: 'defuse_fusion' }, { id: 'FISSION' })];
    const { session } = makeSession({ cards: [fusionCard, emptyFusion, plain, makeCard({ id: 'MAT_A' })], magies: pool });

    expect(session.getShoppingMagies()).toEqual([]);
    place(session, plain, { col: 0, row: 0 });
    expect(session.getShoppingMagies()).toEqual([]);
    place(session, emptyFusion, { col: 1, row: 0 });
    expect(session.getShoppingMagies()).toEqual([]);
    place(session, fusionCard, { col: 2, row: 0 });
    expect(offeredIds(session)).toEqual(['FISSION']);
  });

  it('revive : absente cimetière vide, présente dès une unité au cimetière', () => {
    const { session } = makeSession({ magies: [magie({ type: 'revive', value: 50 }, { id: 'REBORN' })] });
    expect(session.getShoppingMagies()).toEqual([]);

    const u = new (Unit as any)(makeCard({ id: 'PLAIN' }), 'player');
    u.is_neutralized = true;
    session.graveyard = [u];
    expect(offeredIds(session)).toEqual(['REBORN']);
  });

  it('hand_to_graveyard : absente main vide, présente dès une carte en main', () => {
    const { session } = makeSession({ magies: [magie({ type: 'hand_to_graveyard' }, { id: 'ABANDON' })] });
    expect(session.getShoppingMagies()).toEqual([]);

    session.hand = [makeCard({ id: 'PLAIN' }) as any];
    expect(offeredIds(session)).toEqual(['ABANDON']);
  });

  it('guaranteed_draw : seulement pour un tier PRÉSENT dans le deck', () => {
    // Sans ce filtre, la magie n'est pas inerte : startPreparation a un double
    // repli et pioche quand même, dans tout le deck — elle ment sur son tier.
    const t3 = makeCard({ id: 'T3', tier: 3 });
    const { session } = makeSession({
      cards: [makeCard({ id: 'PLAIN', tier: 1 }), t3],
      magies: [magie({ type: 'guaranteed_draw', tier: 1 }, { id: 'G1' }),
               magie({ type: 'guaranteed_draw', tier: 3 }, { id: 'G3' }),
               magie({ type: 'guaranteed_draw', tier: 5 }, { id: 'G5' })],
    });
    expect(offeredIds(session)).toEqual(['G1']);

    (session as any).deps.cardsByTier[3] = [t3];
    expect(offeredIds(session).sort()).toEqual(['G1', 'G3']);
  });

  it('board_slot_bonus : disparaît une fois le cap partagé consommé', () => {
    // C'est la seule magie du jeu qui s'applique sans erreur et ne donne RIEN :
    // grantLimitedBoardSlotBonus rend 0 en silence passé le cap.
    const { session } = makeSession({ magies: [magie({ type: 'board_slot_bonus', value: 1 }, { id: 'CHAIN' })] });
    expect(offeredIds(session)).toEqual(['CHAIN']);

    session.applyGlobalMagie(magie({ type: 'board_slot_bonus', value: 1 }) as any);
    expect(session.getShoppingMagies()).toEqual([]);
  });

  it('board_slot_bonus : disparaît aussi quand c\'est l\'ATTRIBUT qui a pris le cap', () => {
    const { session } = makeSession({ magies: [magie({ type: 'board_slot_bonus', value: 1 }, { id: 'CHAIN' })] });
    session.gameState.grantLimitedBoardSlotBonus(1); // Yeux Bleus
    expect(session.getShoppingMagies()).toEqual([]);
  });

  it('player_hp_bonus : absente à PV pleins, présente dès un point perdu', () => {
    const { session } = makeSession({ magies: [magie({ type: 'player_hp_bonus', value: 100 }, { id: 'ROUGE' })] });
    expect(session.getShoppingMagies()).toEqual([]);

    session.gameState.player_hp = 999;
    expect(offeredIds(session)).toEqual(['ROUGE']);
  });

  it('modificateurs de main : lus sur le DECK, jamais sur la main', () => {
    // Ils sont DIFFÉRÉS au startPreparation suivant, donc appliqués après une
    // pioche neuve : la main du moment ne dit rien de leur cible. Les deux
    // assertions ci-dessous ne peuvent passer ensemble que si on a lu le deck.
    const sac = makeCard({ id: 'SAC', summon_type: 'sacrifice', cost: { sacrifice: 3 } });
    const pool = [magie({ type: 'reduce_sacrifice_cost', value: 1 }, { id: 'RISTOURNE' })];

    const withInDeck = makeSession({ cards: [sac], magies: pool }).session;
    expect(withInDeck.hand).toHaveLength(0);
    expect(offeredIds(withInDeck)).toEqual(['RISTOURNE']);

    const notInDeck = makeSession({ cards: [makeCard({ id: 'PLAIN' })], magies: pool }).session;
    notInDeck.hand = [sac as any, sac as any];
    expect(notInDeck.getShoppingMagies()).toEqual([]);
  });

  it('modificateurs de main : le summon_type ne suffit pas, le COÛT est lu aussi', () => {
    // Le prédicat doit être celui que startPreparation appliquera : une fusion
    // sans matériaux ou un sacrifice à coût nul ne sont jamais retouchés.
    const pool = [
      magie({ type: 'reduce_sacrifice_cost', value: 1 }, { id: 'SAC' }),
      magie({ type: 'remove_heritage_material' }, { id: 'HER' }),
      magie({ type: 'remove_fusion_material', value: 1 }, { id: 'FUS' }),
      magie({ type: 'free_transformation' }, { id: 'TRA' }),
    ];
    const inert = makeSession({ magies: pool, cards: [
      makeCard({ id: 'S0', summon_type: 'sacrifice', cost: { sacrifice: 0 } }),
      makeCard({ id: 'H0', summon_type: 'heritage', cost: { materials: [] } }),
      makeCard({ id: 'F0', summon_type: 'fusion', cost: { materials: [] } }),
    ] }).session;
    expect(inert.getShoppingMagies()).toEqual([]);

    const live = makeSession({ magies: pool, cards: [
      makeCard({ id: 'S1', summon_type: 'sacrifice', cost: { sacrifice: 2 } }),
      makeCard({ id: 'H1', summon_type: 'heritage', cost: { materials: ['X'] } }),
      makeCard({ id: 'F1', summon_type: 'fusion', cost: { materials: ['X'] } }),
      makeCard({ id: 'T1', summon_type: 'transformation' }),
    ] }).session;
    live.gameState.player_extra_shopping_magies = 1;
    expect(offeredIds(live).sort()).toEqual(['FUS', 'HER', 'SAC', 'TRA']);
  });
});

describe('Shopping — routage du ciblage', () => {
  it('magieNeedsUnitTarget / magieNeedsGraveyardTarget', () => {
    const { session } = makeSession();
    expect(session.magieNeedsUnitTarget(magie({ type: 'heal' }) as any)).toBe(true);
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
    expect(session.magieUnitTargets(magie({ type: 'heal' }) as any)).toHaveLength(2);
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

  it('remove_fusion_material : retire UN matériel requis d\'une carte Fusion en main', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'remove_fusion_material' }) as any);
    session.hand = [makeCard({ id: 'FUS', summon_type: 'fusion', cost: { materials: ['A', 'B', 'C'] } }) as any];
    session.startPreparation();
    const fus = session.hand.find(c => c.id === 'FUS')!;
    expect(fus.cost?.materials).toEqual(['A', 'B']);
    // La trace sert au tooltip (cf. SummonInfo), au même titre qu'_original_sacrifice.
    expect(fus._removed_materials).toBe(1);
    expect(session.gameState.player_hand_modifiers).toHaveLength(0);
  });

  it('remove_fusion_material : `value` retire plusieurs matériels, sans jamais descendre sous zéro', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'remove_fusion_material', value: 5 }) as any);
    session.hand = [makeCard({ id: 'FUS', summon_type: 'fusion', cost: { materials: ['A', 'B'] } }) as any];
    session.startPreparation();
    const fus = session.hand.find(c => c.id === 'FUS')!;
    expect(fus.cost?.materials).toEqual([]);
    expect(fus._removed_materials).toBe(2);
  });

  it('remove_fusion_material : ne touche NI une Heritage NI une Fusion déjà sans matériel', () => {
    // Le pendant exact de remove_heritage_material, qui ne prend que les
    // Heritage : les deux magies ne doivent pas se voler leur cible.
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'remove_fusion_material' }) as any);
    session.hand = [
      makeCard({ id: 'HER', summon_type: 'heritage', cost: { materials: ['X'], sacrifice: 2 } }) as any,
      makeCard({ id: 'EMPTY', summon_type: 'fusion', cost: { materials: [] } }) as any,
      makeCard({ id: 'FUS', summon_type: 'fusion', cost: { materials: ['A', 'B'] } }) as any,
    ];
    session.startPreparation();
    expect(session.hand.find(c => c.id === 'HER')!.cost?.materials).toEqual(['X']);
    expect(session.hand.find(c => c.id === 'EMPTY')!.cost?.materials).toEqual([]);
    expect(session.hand.find(c => c.id === 'FUS')!.cost?.materials).toEqual(['A']);
  });

  it('remove_fusion_material : une Fusion dépouillée de tous ses matériels s\'invoque directement', () => {
    // C'est bien l'effet voulu : plus rien à réunir, la carte se pose comme une
    // normale. Vérifié sur la règle elle-même, pas sur la seule forme du coût.
    const fus = makeCard({ id: 'FUS', summon_type: 'fusion', cost: { materials: ['A'] } }) as any;
    const { session } = makeSession({ cards: [makeCard({ id: 'PLAIN' }), fus] });
    session.applyGlobalMagie(magie({ type: 'remove_fusion_material' }) as any);
    session.hand = [fus];
    session.startPreparation();
    const stripped = session.hand.find(c => c.id === 'FUS')!;
    expect(session.needsMaterials(stripped as any)).toBe(false);
    expect(session.isPlayable(stripped as any)).toBe(true);
  });

  it('team_heal : effet GLOBAL — soigne tout le board joueur du montant demandé', () => {
    const { session } = makeSession();
    const m = magie({ type: 'team_heal', value: 25 }) as any;
    expect(session.magieNeedsUnitTarget(m)).toBe(false);
    expect(session.magieNeedsGraveyardTarget(m)).toBe(false);
    expect(session.magieNeedsHandTarget(m)).toBe(false);

    const a = place(session, makeCard({ id: 'A', stats: { hp: 100 } as any }), { col: 0, row: 0 });
    const b = place(session, makeCard({ id: 'B', stats: { hp: 100 } as any }), { col: 1, row: 0 });
    a.current_hp = 10;
    b.current_hp = 90;

    session.applyGlobalMagie(m);

    expect([a.current_hp, b.current_hp]).toEqual([35, 100]);
  });

  it('team_heal : n\'atteint ni l\'ennemi ni le cimetière', () => {
    // `getPlayerUnits()` ne rend que les unités VIVANTES du joueur : un
    // neutralisé encore posé sur le board après le combat n'est pas soigné —
    // c'est `revive` qui relève, pas le soin.
    const { session } = makeSession();
    const mine = place(session, makeCard({ id: 'A', stats: { hp: 100 } as any }), { col: 0, row: 0 });
    mine.current_hp = 20;

    const dead = place(session, makeCard({ id: 'D', stats: { hp: 100 } as any }), { col: 1, row: 0 });
    dead.current_hp = 0;
    dead.is_neutralized = true;

    const theirs = new (Unit as any)(makeCard({ id: 'E', stats: { hp: 100 } as any }), 'enemy');
    session.board.placeUnit(theirs, { col: 0, row: 10 });
    theirs.current_hp = 20;

    session.applyGlobalMagie(magie({ type: 'team_heal', value: 50 }) as any);

    expect(mine.current_hp).toBe(70);
    expect(dead.current_hp).toBe(0);
    expect(theirs.current_hp).toBe(20);
  });

  it('team_stat_bonus : effet GLOBAL — aucune cible à désigner, tout le board joueur en profite', () => {
    const { session } = makeSession();
    const m = magie({ type: 'team_stat_bonus', stat: 'atk', value: 4 }) as any;
    expect(session.magieNeedsUnitTarget(m)).toBe(false);
    expect(session.magieNeedsGraveyardTarget(m)).toBe(false);
    expect(session.magieNeedsHandTarget(m)).toBe(false);

    const a = place(session, makeCard({ id: 'A', stats: { atk: 10 } as any }), { col: 0, row: 0 });
    const b = place(session, makeCard({ id: 'B', stats: { atk: 2 } as any }), { col: 1, row: 0 });
    session.applyGlobalMagie(m);
    expect([a.atk, b.atk]).toEqual([14, 6]);
  });

  it('team_stat_bonus : n\'atteint PAS les unités ennemies', () => {
    const { session } = makeSession();
    const mine = place(session, makeCard({ id: 'A', stats: { atk: 10 } as any }), { col: 0, row: 0 });
    const theirs = new (Unit as any)(makeCard({ id: 'E', stats: { atk: 10 } as any }), 'enemy');
    session.board.placeUnit(theirs, { col: 0, row: 10 });

    session.applyGlobalMagie(magie({ type: 'team_stat_bonus', stat: 'atk', value: 4 }) as any);

    expect(mine.atk).toBe(14);
    expect(theirs.atk).toBe(10);
  });

  it('team_stat_bonus : le bonus est PERMANENT — il survit à resetCombatStats', () => {
    const { session } = makeSession();
    const u = place(session, makeCard({ id: 'A', stats: { atk: 10 } as any }), { col: 0, row: 0 });
    session.applyGlobalMagie(magie({ type: 'team_stat_bonus', stat: 'atk', value: 4 }) as any);
    u.resetCombatStats();
    expect(u.atk).toBe(14);
  });
});

describe('Shopping — pouvoirs, multiplicateur, pioche par voie', () => {
  const powered = (id: string, speed: number) =>
    makeCard({ id, power: { id: 'POWER_HEAL', power_speed: speed, value: null } as any });

  it('power_cooldown ne cible QUE les unités portant un pouvoir', () => {
    const { session } = makeSession();
    const avec = place(session, powered('P', 20), { col: 0, row: 0 });
    place(session, makeCard({ id: 'SANS' }), { col: 1, row: 0 });

    expect(session.magieUnitTargets(magie({ type: 'power_cooldown', value: 2 }) as any)).toEqual([avec]);
    // grant_power, lui, s'adresse à TOUTES les unités : donner un pouvoir à qui
    // n'en a pas est précisément son intérêt.
    expect(session.magieUnitTargets(magie({ type: 'grant_power', power_id: 'POWER_HEAL' }) as any)).toHaveLength(2);
  });

  it('un pouvoir DONNÉ rend l\'unité ciblable par power_cooldown', () => {
    // La cible se lit sur l'UNITÉ, pas sur sa carte : sinon la carte mentirait
    // dès qu'une magie a posé un pouvoir que la définition ne porte pas.
    const { session } = makeSession();
    const u = place(session, makeCard({ id: 'SANS' }), { col: 0, row: 0 });
    expect(session.magieUnitTargets(magie({ type: 'power_cooldown', value: 2 }) as any)).toHaveLength(0);

    session.applyMagieOnUnit(magie({ type: 'grant_power', power_id: 'POWER_FREEZE', power_speed: 16 }) as any, u);

    expect(session.magieUnitTargets(magie({ type: 'power_cooldown', value: 2 }) as any)).toEqual([u]);
  });

  it('le pouvoir donné est PERMANENT — il survit à resetCombatStats', () => {
    const { session } = makeSession();
    const u = place(session, makeCard({ id: 'A' }), { col: 0, row: 0 });
    session.applyMagieOnUnit(magie({ type: 'grant_power', power_id: 'POWER_TAUNT', power_speed: 9 }) as any, u);
    u.resetCombatStats();
    expect(u.power_id).toBe('POWER_TAUNT');
    expect(u.power_speed).toBe(9);
  });

  it('damage_multiplier_bonus atteint les DÉGÂTS réellement infligés, et dure', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'damage_multiplier_bonus', value: 1 }) as any);

    const gs = session.gameState;
    gs.enemy_hp = 1000;
    gs.player_multiplier = 1;
    // 100 d'ATK × (1 de base + 1 de bonus) = 200, et non 100.
    gs.applyEndOfCombat('player', 100, 0);
    expect(gs.enemy_hp).toBe(800);

    // ⚠️ `nextRound()` remet `player_multiplier` à 1.0 : le bonus, lui, N'EST
    // PAS consommé — c'est un investissement, il vaut pour tous les combats
    // restants.
    gs.nextRound();
    gs.player_multiplier = 1;
    gs.applyEndOfCombat('player', 100, 0);
    expect(gs.enemy_hp).toBe(600);
  });

  it('damage_multiplier_bonus s\'ajoute au bonus d\'ATTRIBUT, il ne le remplace pas', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'damage_multiplier_bonus', value: 1 }) as any);
    const gs = session.gameState;
    gs.enemy_hp = 1000;
    gs.player_multiplier = 1;
    gs.applyEndOfCombat('player', 100, 0, { damage_multiplier_bonus: 2 });
    // 1 (base) + 2 (attribut) + 1 (magie) = 4
    expect(gs.enemy_hp).toBe(600);
  });

  it('⚠️ damage_multiplier_bonus n\'est PAS offert en PvP', () => {
    // En PvP `enemy_hp` est réécrit chaque round depuis le `player_hp`
    // autoritaire de l'adversaire, qui a calculé ses dégâts subis SANS ce
    // bonus. Il n'y change donc rien — sauf à faire déclarer une fin de partie
    // que l'adversaire ne voit pas, soit un result_mismatch qui prive les deux
    // joueurs de leur gain. Une magie qui ne peut que nuire n'est pas offerte.
    const m = magie({ type: 'damage_multiplier_bonus', value: 1 }, { id: 'MULT' }) as any;
    const solo = makeSession({ magies: [m] });
    expect(offeredIds(solo.session)).toContain('MULT');

    const pvp = makeSession({ magies: [m], mode: 'pvp' });
    expect(offeredIds(pvp.session)).not.toContain('MULT');
  });

  it('pioche garantie par VOIE D\'INVOCATION : la carte tirée a le bon summon_type', () => {
    const fus = makeCard({ id: 'FUS', tier: 1, summon_type: 'fusion', cost: { materials: ['X'] } });
    const { session } = makeSession({ cards: [makeCard({ id: 'PLAIN', tier: 1 }), fus] });
    session.applyGlobalMagie(magie({ type: 'guaranteed_draw', category: 'fusion' }) as any);
    session.startPreparation();

    expect(session.hand.some(c => c.id === 'FUS')).toBe(true);
    expect(session.gameState.player_guaranteed_draws).toHaveLength(0);
    // Elle OCCUPE un slot de la main, ce n'est pas une carte en plus.
    expect(session.hand).toHaveLength(5);
  });

  it('pioche garantie : tier et voie se CUMULENT', () => {
    const t3fusion = makeCard({ id: 'T3F', tier: 3, summon_type: 'fusion', cost: { materials: ['X'] } });
    const t1fusion = makeCard({ id: 'T1F', tier: 1, summon_type: 'fusion', cost: { materials: ['X'] } });
    const { session } = makeSession({ cards: [makeCard({ id: 'PLAIN', tier: 1 }), t1fusion, t3fusion] });
    (session as any).deps.cardsByTier[3] = [t3fusion];

    session.applyGlobalMagie(magie({ type: 'guaranteed_draw', tier: 3, category: 'fusion' }) as any);
    session.startPreparation();

    expect(session.hand.some(c => c.id === 'T3F')).toBe(true);
  });

  it('une pioche garantie par voie n\'est offerte que si le DECK porte cette voie', () => {
    const m = magie({ type: 'guaranteed_draw', category: 'heritage' }, { id: 'HER' }) as any;
    const sansHeritage = makeSession({ cards: [makeCard({ id: 'PLAIN', summon_type: 'normal' })], magies: [m] });
    expect(offeredIds(sansHeritage.session)).not.toContain('HER');

    const avec = makeSession({
      cards: [makeCard({ id: 'H', summon_type: 'heritage', cost: { materials: ['X'], sacrifice: 1 } })],
      magies: [m],
    });
    expect(offeredIds(avec.session)).toContain('HER');
  });
});

describe('Shopping — contrecoup en PV joueur', () => {
  // Le contrecoup est orthogonal à l'effet : il se pose sur n'importe quel type.
  const costly = (effect: any, cost: number) => magie(effect, { cost_hp: cost }) as any;

  it('est prélevé sur les QUATRE chemins d\'application', () => {
    // Global
    let { session } = makeSession();
    session.gameState.player_hp = 500;
    session.applyGlobalMagie(costly({ type: 'draw_bonus', value: 1 }, 80));
    expect(session.gameState.player_hp).toBe(420);
    expect(session.gameState.player_extra_draws).toBe(1);

    // Cible board
    ({ session } = makeSession());
    session.gameState.player_hp = 500;
    const u = place(session, makeCard({ id: 'A', stats: { hp: 60 } as any }), { col: 0, row: 0 });
    u.current_hp = 10;
    session.applyMagieOnUnit(costly({ type: 'heal' }, 80), u);
    expect(session.gameState.player_hp).toBe(420);
    expect(u.current_hp).toBe(60);

    // Cible cimetière
    ({ session } = makeSession());
    session.gameState.player_hp = 500;
    const dead = new (Unit as any)(makeCard({ id: 'D', stats: { hp: 40 } as any }), 'player');
    dead.is_neutralized = true;
    dead.current_hp = 0;
    session.graveyard = [dead];
    session.applyMagieOnGraveyardUnit(costly({ type: 'revive', value: 50 }, 80), dead);
    expect(session.gameState.player_hp).toBe(420);
    expect(dead.is_neutralized).toBe(false);

    // Cible main
    ({ session } = makeSession());
    session.gameState.player_hp = 500;
    session.hand = [makeCard({ id: 'H' }) as any];
    session.applyMagieOnHandCard(costly({ type: 'hand_to_graveyard' }, 80), 0);
    expect(session.gameState.player_hp).toBe(420);
    expect(session.graveyard).toHaveLength(1);
  });

  it('une magie impayable ne coûte RIEN et n\'applique RIEN', () => {
    // La garde et le paiement ne peuvent pas se désolidariser : si l'un des
    // deux tombe, l'autre ment.
    const { session } = makeSession();
    session.gameState.player_hp = 50;
    const m = costly({ type: 'draw_bonus', value: 2 }, 80);

    expect(session.canAffordMagie(m)).toBe(false);
    session.applyGlobalMagie(m);

    expect(session.gameState.player_hp).toBe(50);
    expect(session.gameState.player_extra_draws).toBe(0);
  });

  it('un coût égal aux PV restants est refusé — payer ne tue jamais', () => {
    const { session } = makeSession();
    session.gameState.player_hp = 80;
    const m = costly({ type: 'draw_bonus', value: 1 }, 80);
    expect(session.canAffordMagie(m)).toBe(false);
    session.applyGlobalMagie(m);
    expect(session.gameState.player_hp).toBe(80);

    // Un PV de plus et elle passe, en laissant très exactement 1 PV.
    session.gameState.player_hp = 81;
    expect(session.canAffordMagie(m)).toBe(true);
    session.applyGlobalMagie(m);
    expect(session.gameState.player_hp).toBe(1);
  });

  it('le refus n\'ampute NI la main NI le board', () => {
    const { session } = makeSession();
    session.gameState.player_hp = 10;
    session.hand = [makeCard({ id: 'H' }) as any];
    const u = place(session, makeCard({ id: 'A', stats: { hp: 90 } as any }), { col: 0, row: 0 });

    expect(session.applyMagieOnHandCard(costly({ type: 'hand_to_graveyard' }, 500), 0)).toBeNull();
    session.applyMagieOnUnit(costly({ type: 'drain_life' }, 500), u);

    expect(session.hand).toHaveLength(1);
    expect(session.graveyard).toHaveLength(0);
    expect(session.board.getUnit({ col: 0, row: 0 })).toBe(u);
    expect(session.gameState.player_hp).toBe(10);
  });

  it('⚠️ drain_life ne finance PAS son propre contrecoup', () => {
    // Le coût est prélevé AVANT l'effet, et l'accessibilité se juge sur les PV
    // d'avant : sinon une magie coûteuse deviendrait payable grâce aux PV
    // qu'elle rapporte, et le plancher de 1 PV ne tiendrait plus.
    const { session } = makeSession();
    session.gameState.player_hp = 60;
    const u = place(session, makeCard({ id: 'A', stats: { hp: 300 } as any }), { col: 0, row: 0 });
    u.current_hp = 300;

    // 100 > 60 : refusée, malgré les 300 PV qu'elle aurait rapportés.
    expect(session.canAffordMagie(costly({ type: 'drain_life' }, 100))).toBe(false);
    session.applyMagieOnUnit(costly({ type: 'drain_life' }, 100), u);
    expect(session.gameState.player_hp).toBe(60);
    expect(session.board.getUnit({ col: 0, row: 0 })).toBe(u);

    // Payable : on paie 50, puis on encaisse les 300.
    session.applyMagieOnUnit(costly({ type: 'drain_life' }, 50), u);
    expect(session.gameState.player_hp).toBe(310);
  });

  it('le contrecoup peut faire descendre sous le seuil, mais jamais à zéro', () => {
    const { session } = makeSession();
    session.gameState.player_hp = 1000;
    const m = costly({ type: 'draw_bonus', value: 1 }, 999);
    session.applyGlobalMagie(m);
    expect(session.gameState.player_hp).toBe(1);
    // La partie n'est PAS finie : rester à 1 PV est une position, pas une mort.
    expect(session.isGameOver()).toBe(false);
    // …et la même magie est désormais hors de portée.
    expect(session.canAffordMagie(m)).toBe(false);
  });

  it('⚠️ un contrecoup impayable ne retire PAS la magie de l\'offre', () => {
    // La couture entre les deux mécaniques, et c'est une décision, pas un
    // oubli : le filtre de pertinence (`MagieOffer.isMagieRelevant`) écarte ce
    // qui ne FERAIT rien, là où une magie trop chère ferait quelque chose — le
    // joueur n'a simplement pas les PV. Elle est donc proposée et VERROUILLÉE
    // (grisée, avec sa raison), ce qui lui apprend qu'elle existe et pourquoi
    // elle lui échappe. La filtrer la rendrait invisible au moment précis où
    // elle est la plus intéressante à connaître.
    const chere = magie(ALWAYS, { id: 'CHERE', cost_hp: 900 });
    const { session } = makeSession({ magies: [chere] });
    session.gameState.player_hp = 100;

    expect(offeredIds(session)).toContain('CHERE');
    expect(session.canAffordMagie(chere as any)).toBe(false);
  });

  it('une magie sans contrecoup reste gratuite', () => {
    const { session } = makeSession();
    session.gameState.player_hp = 1000;
    session.applyGlobalMagie(magie({ type: 'draw_bonus', value: 1 }) as any);
    expect(session.gameState.player_hp).toBe(1000);
  });
});

describe('Shopping — heal (soin total)', () => {
  it('remonte les PV de la cible à son maximum', () => {
    const { session } = makeSession();
    const u = place(session, makeCard({ id: 'A', stats: { hp: 120 } as any }), { col: 0, row: 0 });
    u.current_hp = 7;
    session.applyMagieOnUnit(magie({ type: 'heal' }) as any, u);
    expect(u.current_hp).toBe(120);
  });

  it('ne cible que les unités VIVANTES du joueur', () => {
    const { session } = makeSession();
    const alive = place(session, makeCard({ id: 'A' }), { col: 0, row: 0 });
    const dead = place(session, makeCard({ id: 'D' }), { col: 1, row: 0 });
    dead.current_hp = 0;
    dead.is_neutralized = true;
    expect(session.magieUnitTargets(magie({ type: 'heal' }) as any)).toEqual([alive]);
  });
});

describe('Shopping — drain_life (absorption de PV)', () => {
  it('détruit l\'unité vers le cimetière ET verse ses PV courants au joueur', () => {
    const { session } = makeSession();
    const u = place(session, makeCard({ id: 'A', stats: { hp: 80 } as any }), { col: 2, row: 1 });
    u.current_hp = 55;
    session.gameState.player_hp = 400;

    expect(session.magieNeedsUnitTarget(magie({ type: 'drain_life' }) as any)).toBe(true);
    session.applyMagieOnUnit(magie({ type: 'drain_life' }) as any, u);

    expect(session.board.getUnit({ col: 2, row: 1 })).toBeNull();
    expect(session.graveyard).toContain(u);
    expect(u.is_neutralized).toBe(true);
    expect(session.gameState.player_hp).toBe(455);
  });

  it('verse les PV COURANTS, pas le max : une unité blessée rapporte moins', () => {
    const { session } = makeSession();
    const u = place(session, makeCard({ id: 'A', stats: { hp: 200 } as any }), { col: 0, row: 0 });
    u.current_hp = 12;
    session.gameState.player_hp = 500;
    session.applyMagieOnUnit(magie({ type: 'drain_life' }) as any, u);
    expect(session.gameState.player_hp).toBe(512);
  });

  it('plafonné à 1000, comme player_hp_bonus', () => {
    const { session } = makeSession();
    const u = place(session, makeCard({ id: 'A', stats: { hp: 300 } as any }), { col: 0, row: 0 });
    session.gameState.player_hp = 950;
    session.applyMagieOnUnit(magie({ type: 'drain_life' }) as any, u);
    expect(session.gameState.player_hp).toBe(1000);
  });

  it('l\'unité absorbée reste un matériau : elle est au cimetière, pas effacée', () => {
    // C'est ce qui fait de drain_life un remplaçant honnête de destroy_unit :
    // on gagne les PV SANS perdre le corps comme matériau d'invocation.
    const { session } = makeSession();
    const u = place(session, makeCard({ id: 'A', stats: { hp: 40 } as any }), { col: 0, row: 0 });
    session.applyMagieOnUnit(magie({ type: 'drain_life' }) as any, u);
    expect(session.graveyard.map(g => g.card_id)).toEqual(['A']);
  });
});

describe('Shopping — hand_to_graveyard (main → cimetière)', () => {
  it('routage : ni board ni cimetière, la cible est une carte de la main', () => {
    const { session } = makeSession();
    const m = magie({ type: 'hand_to_graveyard' }) as any;
    expect(session.magieNeedsHandTarget(m)).toBe(true);
    expect(session.magieNeedsUnitTarget(m)).toBe(false);
    expect(session.magieNeedsGraveyardTarget(m)).toBe(false);
  });

  it('retire la carte de la main et pose une unité NEUTRALISÉE au cimetière', () => {
    const { session } = makeSession();
    session.hand = [
      makeCard({ id: 'KEEP' }) as any,
      makeCard({ id: 'DUMP', stats: { hp: 40 } as any }) as any,
    ];

    const unit = session.applyMagieOnHandCard(magie({ type: 'hand_to_graveyard' }) as any, 1);

    expect(session.hand.map(c => c.id)).toEqual(['KEEP']);
    expect(session.graveyard).toHaveLength(1);
    expect(unit!.card_id).toBe('DUMP');
    expect(unit!.is_neutralized).toBe(true);
    expect(unit!.side).toBe('player');
    // Elle n'occupe AUCUNE case : la magie échange une carte contre un
    // matériau, elle ne pose pas de corps sur le terrain.
    expect(session.board.getLivingUnitsOnSide('player')).toHaveLength(0);
  });

  it('la carte défaussée est utilisable comme matériau de fusion', () => {
    // La raison d'être de la magie : débloquer une fusion dont il manque un
    // matériau. Vérifié par la règle d'invocation, pas par la seule présence
    // dans le tableau.
    const matA = makeCard({ id: 'MAT_A' });
    const matB = makeCard({ id: 'MAT_B' });
    const fus = makeCard({ id: 'FUS', summon_type: 'fusion', cost: { materials: ['MAT_A', 'MAT_B'] } });
    const { session } = makeSession({ cards: [matA, matB, fus] });

    place(session, matA, { col: 0, row: 0 });
    session.hand = [matB as any, fus as any];
    expect(session.isPlayable(fus as any)).toBe(false);

    session.applyMagieOnHandCard(magie({ type: 'hand_to_graveyard' }) as any, 0);

    expect(session.isPlayable(fus as any)).toBe(true);
  });

  it('index hors bornes : ne touche à rien', () => {
    const { session } = makeSession();
    session.hand = [makeCard({ id: 'A' }) as any];
    expect(session.applyMagieOnHandCard(magie({ type: 'hand_to_graveyard' }) as any, 7)).toBeNull();
    expect(session.hand).toHaveLength(1);
    expect(session.graveyard).toHaveLength(0);
  });

  it('un doublon en main ne part qu\'en UN exemplaire', () => {
    const { session } = makeSession();
    session.hand = [makeCard({ id: 'D' }) as any, makeCard({ id: 'D' }) as any];
    session.applyMagieOnHandCard(magie({ type: 'hand_to_graveyard' }) as any, 0);
    expect(session.hand.map(c => c.id)).toEqual(['D']);
    expect(session.graveyard).toHaveLength(1);
  });
});
