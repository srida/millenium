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
  const cards = opts.cards ?? [makeCard({ id: 'PLAIN', summon_conditions: [] })];
  const byId = new Map(cards.map(c => [c.id, c]));
  const magiePool = opts.magies ?? [];
  const deps: GameSessionDeps = {
    cardsByTier: { 1: cards.filter(c => (c.tier ?? 1) === 1) },
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => magiePool,
    rand: opts.rand,
    mode: opts.mode
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
    const fusionCard = makeCard({ id: 'FUS', summon_conditions: [{ materials: 1, requires: ['MAT_A'] }] });
    const emptyFusion = makeCard({ id: 'EMPTY', summon_conditions: [{ materials: 0 }] });
    const plain = makeCard({ id: 'PLAIN', summon_conditions: [] });
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
               magie({ type: 'guaranteed_draw', tier: 5 }, { id: 'G5' })] });
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
    const sac = makeCard({ id: 'SAC', summon_conditions: [{ materials: 3 }] });
    const pool = [magie({ type: 'reduce_materials', value: 1 }, { id: 'RISTOURNE' })];

    const withInDeck = makeSession({ cards: [sac], magies: pool }).session;
    expect(withInDeck.hand).toHaveLength(0);
    expect(offeredIds(withInDeck)).toEqual(['RISTOURNE']);

    const notInDeck = makeSession({ cards: [makeCard({ id: 'PLAIN' })], magies: pool }).session;
    notInDeck.hand = [sac as any, sac as any];
    expect(notInDeck.getShoppingMagies()).toEqual([]);
  });

  it('les deux remises lisent le COÛT, pas la seule présence d\'une condition', () => {
    // Le prédicat doit être celui que startPreparation appliquera : une
    // condition à coût nul n'est jamais retouchée, et une condition qui ne
    // NOMME rien n'a aucune exigence à lever.
    const pool = [
      magie({ type: 'reduce_materials', value: 1 }, { id: 'MOINS' }),
      magie({ type: 'remove_requirements', value: 1 }, { id: 'LIBRE' })
    ];

    // Que des conditions à coût nul : ni l'une ni l'autre n'a prise.
    const inert = makeSession({ magies: pool, cards: [
      makeCard({ id: 'S0', summon_conditions: [{ materials: 0 }] }),
      makeCard({ id: 'H0', summon_conditions: [] })
    ] }).session;
    expect(inert.getShoppingMagies()).toEqual([]);

    // Un coût chiffré mais AUCUN matériel nommé : seule la remise de coût passe.
    // C'est la preuve que les deux drapeaux sont bien distincts.
    const priceOnly = makeSession({ magies: pool, cards: [
      makeCard({ id: 'S1', summon_conditions: [{ materials: 2 }] })
    ] }).session;
    priceOnly.gameState.player_extra_shopping_magies = 1;
    expect(offeredIds(priceOnly)).toEqual(['MOINS']);

    // Un matériel nommé : les deux passent.
    const live = makeSession({ magies: pool, cards: [
      makeCard({ id: 'H1', summon_conditions: [{ materials: 2, requires: ['X'] }] })
    ] }).session;
    live.gameState.player_extra_shopping_magies = 1;
    expect(offeredIds(live).sort()).toEqual(['LIBRE', 'MOINS']);
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
    const fusionCard = makeCard({ id: 'FUS', summon_conditions: [{ materials: 2, requires: ['MAT_A', 'MAT_B'] }] });
    const plainCard = makeCard({ id: 'PLAIN', summon_conditions: [] });
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
    const fusionCard = makeCard({ id: 'FUS', summon_conditions: [{ materials: 2, requires: ['MAT_A', 'MAT_B'] }] });
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
    const fusionCard = makeCard({
      id: 'FUS', summon_conditions: [{ materials: materials.length, requires: materials }] });
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

  // ── Les deux remises d'invocation ────────────────────────────────────────
  //
  // ⚠️ Elles étaient QUATRE, une par voie remisable (sacrifice, transformation
  // offerte, matériel d'héritage, matériel de fusion). Il n'y a plus que deux
  // gestes possibles sur une condition, donc deux magies — et elles sont
  // ORTHOGONALES : `reduce_materials` baisse le prix, `remove_requirements`
  // lève une contrainte sans rien rendre moins cher.

  it('reduce_materials : baisse le coût en matériels d\'une carte en main', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'reduce_materials', value: 1 }) as any);
    session.hand = [makeCard({ id: 'SAC', summon_conditions: [{ materials: 3 }] }) as any];
    session.startPreparation();
    const sac = session.hand.find(c => c.id === 'SAC')!;
    expect(sac.summon_conditions).toEqual([{ materials: 2, requires: [] }]);
    expect(session.gameState.player_hand_modifiers).toHaveLength(0);
  });

  // ⚠️ L'invariant `requires.length <= materials` : une condition qui garderait
  // plus d'exigences que de slots serait insatisfiable — la remise rendrait la
  // carte INJOUABLE. Mutation : ne pas retailler `requires` → ROUGE.
  it('reduce_materials : les exigences suivent la baisse, jamais plus que les slots', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'reduce_materials', value: 2 }) as any);
    session.hand = [makeCard({ id: 'FUS', summon_conditions: [{ materials: 3, requires: ['A', 'B', 'C'] }] }) as any];
    session.startPreparation();
    expect(session.hand.find(c => c.id === 'FUS')!.summon_conditions)
      .toEqual([{ materials: 1, requires: ['A'] }]);
  });

  // ⚠️ L'attribut est ce qui rend « -1 matériel de Fusion » exprimable
  // maintenant qu'il n'y a plus de voie à nommer : la remise doit tomber sur la
  // carte VISÉE, pas sur la première retouchable venue.
  // Mutation : ignorer `mod.attribute` dans le prédicat → ROUGE.
  it('reduce_materials VISÉE : ne retouche que la carte qui porte l\'attribut', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'reduce_materials', value: 1, attribute: 'ARCH_086' }) as any);
    session.hand = [
      makeCard({ id: 'AUTRE', summon_conditions: [{ materials: 3 }], attributes: ['ARCH_089'] }) as any,
      makeCard({ id: 'VISEE', summon_conditions: [{ materials: 3 }], attributes: ['ARCH_086'] }) as any,
    ];
    session.startPreparation();

    expect(session.hand.find(c => c.id === 'AUTRE')!.summon_conditions).toEqual([{ materials: 3 }]);
    expect(session.hand.find(c => c.id === 'VISEE')!.summon_conditions).toEqual([{ materials: 2, requires: [] }]);
  });

  // Le pendant : aucune carte visée en main, et la remise est perdue plutôt que
  // reportée sur une autre. Elle a été consommée par le tour, pas par la carte.
  it('reduce_materials VISÉE : ne se rabat sur personne', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'reduce_materials', value: 1, attribute: 'ARCH_086' }) as any);
    session.hand = [makeCard({ id: 'AUTRE', summon_conditions: [{ materials: 3 }], attributes: ['ARCH_089'] }) as any];
    session.startPreparation();

    expect(session.hand.find(c => c.id === 'AUTRE')!.summon_conditions).toEqual([{ materials: 3 }]);
  });

  it('reduce_materials : ne descend jamais sous zéro', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'reduce_materials', value: 5 }) as any);
    session.hand = [makeCard({ id: 'SAC', summon_conditions: [{ materials: 2 }] }) as any];
    session.startPreparation();
    expect(session.hand.find(c => c.id === 'SAC')!.summon_conditions)
      .toEqual([{ materials: 0, requires: [] }]);
  });

  it('remove_requirements : retire un matériel NOMMÉ sans baisser le coût', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'remove_requirements', value: 1 }) as any);
    session.hand = [makeCard({ id: 'HER', summon_conditions: [{ materials: 3, requires: ['A', 'B'] }] }) as any];
    session.startPreparation();
    // Trois slots à payer, mais un seul encore contraint : c'est bien deux
    // gestes différents, et non deux façons de dire « moins cher ».
    expect(session.hand.find(c => c.id === 'HER')!.summon_conditions)
      .toEqual([{ materials: 3, requires: ['A'] }]);
    expect(session.gameState.player_hand_modifiers).toHaveLength(0);
  });

  it('remove_requirements : ignore une condition qui ne nomme rien', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'remove_requirements', value: 1 }) as any);
    session.hand = [
      makeCard({ id: 'PLAIN', summon_conditions: [{ materials: 2 }] }) as any,
      makeCard({ id: 'NAMED', summon_conditions: [{ materials: 2, requires: ['A'] }] }) as any
    ];
    session.startPreparation();
    expect(session.hand.find(c => c.id === 'PLAIN')!.summon_conditions).toEqual([{ materials: 2 }]);
    expect(session.hand.find(c => c.id === 'NAMED')!.summon_conditions)
      .toEqual([{ materials: 2, requires: [] }]);
  });

  it('la remise garde la trace de la condition d\'ORIGINE, pour le tooltip', () => {
    const { session } = makeSession();
    session.applyGlobalMagie(magie({ type: 'reduce_materials', value: 1 }) as any);
    session.hand = [makeCard({ id: 'SAC', summon_conditions: [{ materials: 3 }] }) as any];
    session.startPreparation();
    expect(session.hand.find(c => c.id === 'SAC')!._discounted_from).toEqual([{ materials: 3 }]);
  });

  it('une carte dépouillée de tout coût s\'invoque directement', () => {
    // C'est bien l'effet voulu : plus rien à réunir, la carte se pose. Vérifié
    // sur la RÈGLE, pas sur la seule forme de la condition.
    const fus = makeCard({ id: 'FUS', summon_conditions: [{ materials: 1, requires: ['A'] }] }) as any;
    const { session } = makeSession({ cards: [makeCard({ id: 'PLAIN' }), fus] });
    session.applyGlobalMagie(magie({ type: 'reduce_materials', value: 1 }) as any);
    session.hand = [fus];
    session.startPreparation();
    const stripped = session.hand.find(c => c.id === 'FUS')!;
    expect(session.needsMaterials(stripped as any)).toBe(false);
    expect(session.isPlayable(stripped as any)).toBe(true);
  });

  it('player_hp_bonus : appliqué immédiatement, cappé à 1000', () => {
    const { session } = makeSession();
    session.gameState.player_hp = 940;
    session.applyGlobalMagie(magie({ type: 'player_hp_bonus', value: 100 }) as any);
    expect(session.gameState.player_hp).toBe(1000);
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

  it('pioche garantie par ATTRIBUT : la carte tirée le porte', () => {
    const fus = makeCard({ id: 'FUS', tier: 1, attributes: ['ARCH_086'] });
    const { session } = makeSession({ cards: [makeCard({ id: 'PLAIN', tier: 1 }), fus] });
    session.applyGlobalMagie(magie({ type: 'guaranteed_draw', attribute: 'ARCH_086' }) as any);
    session.startPreparation();

    expect(session.hand.some(c => c.id === 'FUS')).toBe(true);
    expect(session.gameState.player_guaranteed_draws).toHaveLength(0);
    // Elle OCCUPE un slot de la main, ce n'est pas une carte en plus.
    expect(session.hand).toHaveLength(5);
  });

  it('pioche garantie : tier et attribut se CUMULENT', () => {
    const t3fusion = makeCard({ id: 'T3F', tier: 3, attributes: ['ARCH_086'] });
    const t1fusion = makeCard({ id: 'T1F', tier: 1, attributes: ['ARCH_086'] });
    const { session } = makeSession({ cards: [makeCard({ id: 'PLAIN', tier: 1 }), t1fusion, t3fusion] });
    (session as any).deps.cardsByTier[3] = [t3fusion];

    session.applyGlobalMagie(magie({ type: 'guaranteed_draw', tier: 3, attribute: 'ARCH_086' }) as any);
    session.startPreparation();

    expect(session.hand.some(c => c.id === 'T3F')).toBe(true);
  });

  // ⚠️ Le filtre porte désormais sur un ATTRIBUT, les voies d'invocation en
  // étant devenues. C'est le même geste — « le deck porte-t-il ça ? » — mais
  // posé une seule fois, sur la seule dimension qui existe encore.
  it('une pioche garantie par attribut n\'est offerte que si le DECK le porte', () => {
    const m = magie({ type: 'guaranteed_draw', attribute: 'ARCH_087' }, { id: 'HER' }) as any;
    const sans = makeSession({
      cards: [makeCard({ id: 'PLAIN', attributes: [] })], magies: [m] });
    expect(offeredIds(sans.session)).not.toContain('HER');

    const avec = makeSession({
      cards: [makeCard({ id: 'H', attributes: ['ARCH_087'] })],
      magies: [m] });
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
      makeCard({ id: 'DUMP', stats: { hp: 40 } as any }) as any
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
    const fus = makeCard({ id: 'FUS', summon_conditions: [{ materials: 2, requires: ['MAT_A', 'MAT_B'] }] });
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

// ── Duplication (unité → carte en main, carte → carte en main) ──────────────
//
// ⚠️ Éprouvés DANS LES DEUX SENS (règle du projet) : `duplicateCopies` passée
// en `??` → le cas « Valeur 0 » tombe ; la copie prise par référence → le cas
// d'indépendance tombe ; `duplicate_card` retirant sa cible comme
// `hand_to_graveyard` → le cas « l'originale reste » tombe ; les bonus de
// l'unité recopiés sur la carte → le cas d'étanchéité tombe.

describe('Shopping — duplicate_unit (unité du terrain → sa carte en main)', () => {
  it('routage : la cible est une UNITÉ, jamais une carte de la main', () => {
    const { session } = makeSession();
    const m = magie({ type: 'duplicate_unit', value: 1 }) as any;
    expect(session.magieNeedsUnitTarget(m)).toBe(true);
    expect(session.magieNeedsHandTarget(m)).toBe(false);
    expect(session.magieNeedsGraveyardTarget(m)).toBe(false);
  });

  it('ajoute la carte de l\'unité à la main, sans toucher au board', () => {
    const plain = makeCard({ id: 'PLAIN' });
    const { session } = makeSession({ cards: [plain] });
    const unit = place(session, plain, { col: 2, row: 0 });

    session.applyMagieOnUnit(magie({ type: 'duplicate_unit', value: 1 }) as any, unit);

    expect(session.hand.map(c => c.id)).toEqual(['PLAIN']);
    // L'unité dupliquée RESTE en jeu : on copie, on ne déplace pas.
    expect(session.getPlayerUnits()).toHaveLength(1);
    expect(session.graveyard).toHaveLength(0);
  });

  it('c\'est la CARTE DE CATALOGUE qui revient — les acquis de l\'unité ne voyagent pas', () => {
    // Le cœur de la règle : une duplication n'est pas un clonage. Sans cette
    // étanchéité, la magie rendrait deux fois un investissement de Shopping.
    const plain = makeCard({ id: 'PLAIN', stats: { atk: 5 } as any });
    const { session } = makeSession({ cards: [plain] });
    const unit = place(session, plain, { col: 2, row: 0 });
    // L'unité a été gonflée sur le terrain (magie de stat, vétérance…).
    session.applyMagieOnUnit(magie({ type: 'stat_bonus', stat: 'atk', value: 20 }) as any, unit);
    expect(unit.atk).toBe(25);

    session.applyMagieOnUnit(magie({ type: 'duplicate_unit', value: 1 }) as any, unit);

    expect((session.hand[0] as any).stats.atk).toBe(5);
    expect((session.hand[0] as any)._shopping_bonus).toBeUndefined();
  });

  it('`value` compte les copies, et une Valeur à 0 en rend UNE', () => {
    // ⚠️ Le défaut du champ « Valeur » de l'admin est 0 : lu en `??` il rendrait
    // zéro copie — une magie offerte qui encaisse son contrecoup pour du vide.
    const plain = makeCard({ id: 'PLAIN' });
    for (const [value, expected] of [[3, 3], [0, 1], [undefined, 1], [-2, 1]] as const) {
      const { session } = makeSession({ cards: [plain] });
      const unit = place(session, plain, { col: 2, row: 0 });
      session.applyMagieOnUnit(magie({ type: 'duplicate_unit', value }) as any, unit);
      expect(session.hand).toHaveLength(expected);
    }
  });

  it('la copie est un objet NEUF, indépendant de la carte de catalogue', () => {
    const plain = makeCard({ id: 'PLAIN' });
    const { session } = makeSession({ cards: [plain] });
    const unit = place(session, plain, { col: 2, row: 0 });

    session.applyMagieOnUnit(magie({ type: 'duplicate_unit', value: 2 }) as any, unit);

    expect(session.hand[0]).not.toBe(plain);
    expect(session.hand[0]).not.toBe(session.hand[1]);
  });

  it('RÈGLE DU DOUBLON : la copie n\'est jouable qu\'une fois l\'original parti', () => {
    // Conséquence assumée, et c'est tout le sens de la magie : on met un
    // remplaçant de côté, on ne pose pas un second corps.
    const plain = makeCard({ id: 'PLAIN' });
    const { session } = makeSession({ cards: [plain] });
    const unit = place(session, plain, { col: 2, row: 0 });

    session.applyMagieOnUnit(magie({ type: 'duplicate_unit', value: 1 }) as any, unit);
    expect(session.isPlayable(session.hand[0] as any)).toBe(false);

    session.board.removeUnit(unit);
    expect(session.isPlayable(session.hand[0] as any)).toBe(true);
  });

  it('cibles : une unité dont la carte a quitté le catalogue n\'en est pas une', () => {
    // Même geste que `defuse_fusion` / `power_cooldown` : la règle sert le
    // ciblage ET la pertinence de l'offre, elle n'existe qu'à un endroit.
    const known = makeCard({ id: 'KNOWN' });
    const { session } = makeSession({ cards: [known] });
    place(session, known, { col: 0, row: 0 });
    place(session, makeCard({ id: 'GHOST' }), { col: 1, row: 0 });

    const targets = session.magieUnitTargets(magie({ type: 'duplicate_unit', value: 1 }) as any);
    expect(targets.map(u => u.card_id)).toEqual(['KNOWN']);
  });

  it('offre : absente board vide, présente dès une unité copiable', () => {
    const plain = makeCard({ id: 'PLAIN' });
    const { session } = makeSession({
      cards: [plain], magies: [magie({ type: 'duplicate_unit', value: 1 }, { id: 'CLONE' })] });
    expect(session.getShoppingMagies()).toEqual([]);

    place(session, plain, { col: 0, row: 0 });
    expect(offeredIds(session)).toEqual(['CLONE']);
  });
});

describe('Shopping — duplicate_card (carte de la main → carte en main)', () => {
  it('routage : la cible est une carte de la MAIN', () => {
    const { session } = makeSession();
    const m = magie({ type: 'duplicate_card', value: 1 }) as any;
    expect(session.magieNeedsHandTarget(m)).toBe(true);
    expect(session.magieNeedsUnitTarget(m)).toBe(false);
    expect(session.magieNeedsGraveyardTarget(m)).toBe(false);
  });

  it('l\'ORIGINALE reste en main — c\'est ce qui la sépare de hand_to_graveyard', () => {
    const { session } = makeSession();
    session.hand = [makeCard({ id: 'KEEP' }) as any, makeCard({ id: 'COPY_ME' }) as any];

    const unit = session.applyMagieOnHandCard(magie({ type: 'duplicate_card', value: 1 }) as any, 1);

    expect(session.hand.map(c => c.id)).toEqual(['KEEP', 'COPY_ME', 'COPY_ME']);
    // Aucune unité créée : la duplication ne passe pas par le cimetière.
    expect(unit).toBeNull();
    expect(session.graveyard).toHaveLength(0);
  });

  it('copie la carte TELLE QU\'ELLE EST, remises de magie comprises', () => {
    // Le joueur duplique la carte qu'il a sous les yeux, avec le coût que son
    // tooltip annonce — pas une version que rien à l'écran n'annonce.
    const { session } = makeSession();
    session.hand = [{
      ...makeCard({ id: 'SAC', summon_conditions: [{ materials: 1 }] }),
      _discounted_from: [{ materials: 3 }]
    } as any];

    session.applyMagieOnHandCard(magie({ type: 'duplicate_card', value: 1 }) as any, 0);

    // La condition REMISÉE voyage, et la trace de l'originale avec elle : c'est
    // ce que le tooltip annonce, donc ce que le joueur croit dupliquer.
    expect((session.hand[1] as any).summon_conditions).toEqual([{ materials: 1 }]);
    expect((session.hand[1] as any)._discounted_from).toEqual([{ materials: 3 }]);
    expect(session.hand[1]).not.toBe(session.hand[0]);
  });

  it('`value` compte les copies, et une Valeur à 0 en rend UNE', () => {
    for (const [value, expected] of [[3, 4], [0, 2], [undefined, 2]] as const) {
      const { session } = makeSession();
      session.hand = [makeCard({ id: 'C' }) as any];
      session.applyMagieOnHandCard(magie({ type: 'duplicate_card', value }) as any, 0);
      expect(session.hand).toHaveLength(expected);
    }
  });

  it('index hors bornes : ne touche à rien et ne coûte rien', () => {
    const { session } = makeSession();
    session.gameState.player_hp = 500;
    session.hand = [makeCard({ id: 'A' }) as any];

    expect(session.applyMagieOnHandCard(
      magie({ type: 'duplicate_card', value: 1 }, { cost_hp: 80 }) as any, 7)).toBeNull();

    expect(session.hand).toHaveLength(1);
    expect(session.gameState.player_hp).toBe(500);
  });

  it('contrecoup : prélevé une seule fois, quel que soit le nombre de copies', () => {
    const { session } = makeSession();
    session.gameState.player_hp = 500;
    session.hand = [makeCard({ id: 'C' }) as any];

    session.applyMagieOnHandCard(magie({ type: 'duplicate_card', value: 3 }, { cost_hp: 80 }) as any, 0);

    expect(session.gameState.player_hp).toBe(420);
    expect(session.hand).toHaveLength(4);
  });

  it('offre : absente main vide, présente dès une carte en main', () => {
    const { session } = makeSession({ magies: [magie({ type: 'duplicate_card', value: 1 }, { id: 'CONFORME' })] });
    expect(session.getShoppingMagies()).toEqual([]);

    session.hand = [makeCard({ id: 'PLAIN' }) as any];
    expect(offeredIds(session)).toEqual(['CONFORME']);
  });
});

describe('Shopping — duplicate_graveyard_unit (cimetière → carte en main)', () => {
  /** Une unité neutralisée au cimetière, comme en laisse un combat. */
  function bury(session: any, card: any) {
    const u = new (Unit as any)(card, 'player');
    u.is_neutralized = true;
    session.graveyard.push(u);
    return u;
  }

  it('routage : la cible est une unité du CIMETIÈRE', () => {
    const { session } = makeSession();
    const m = magie({ type: 'duplicate_graveyard_unit', value: 1 }) as any;
    expect(session.magieNeedsGraveyardTarget(m)).toBe(true);
    expect(session.magieNeedsUnitTarget(m)).toBe(false);
    expect(session.magieNeedsHandTarget(m)).toBe(false);
  });

  it('ajoute la carte à la main et LAISSE le corps au cimetière', () => {
    // La différence de fond avec `revive`, qui l'en sort pour la reposer : le
    // corps reste disponible comme matériau d'invocation.
    const plain = makeCard({ id: 'PLAIN' });
    const { session } = makeSession({ cards: [plain] });
    const dead = bury(session, plain);

    session.applyMagieOnGraveyardUnit(magie({ type: 'duplicate_graveyard_unit', value: 1 }) as any, dead);

    expect(session.hand.map(c => c.id)).toEqual(['PLAIN']);
    expect(session.graveyard).toEqual([dead]);
    expect(dead.is_neutralized).toBe(true);
    // Rien n'est posé sur le terrain — ce n'est pas une réanimation.
    expect(session.getPlayerUnits()).toHaveLength(0);
  });

  it('la copie est JOUABLE tout de suite — l\'original n\'est pas vivant', () => {
    // Le tempo qui l'oppose à `duplicate_unit` : depuis le board, la règle du
    // doublon gèle la copie tant que l'original tient ; depuis le cimetière,
    // il n'y a aucun doublon vivant à opposer.
    const plain = makeCard({ id: 'PLAIN' });
    const { session } = makeSession({ cards: [plain] });
    const dead = bury(session, plain);

    session.applyMagieOnGraveyardUnit(magie({ type: 'duplicate_graveyard_unit', value: 1 }) as any, dead);

    expect(session.isPlayable(session.hand[0] as any)).toBe(true);
  });

  it('c\'est la CARTE DE CATALOGUE — les acquis de l\'unité morte ne voyagent pas', () => {
    const plain = makeCard({ id: 'PLAIN', stats: { atk: 5 } as any });
    const { session } = makeSession({ cards: [plain] });
    const dead = bury(session, plain);
    dead._base.atk = 42;
    dead._shopping_bonus = { atk: 37 };

    session.applyMagieOnGraveyardUnit(magie({ type: 'duplicate_graveyard_unit', value: 2 }) as any, dead);

    expect((session.hand[0] as any).stats.atk).toBe(5);
    expect((session.hand[0] as any)._shopping_bonus).toBeUndefined();
    expect(session.hand).toHaveLength(2);
    expect(session.hand[0]).not.toBe(session.hand[1]);
  });

  it('une unité dont la carte a quitté le catalogue ne coûte RIEN et ne rend RIEN', () => {
    // ⚠️ La carte est résolue AVANT le paiement : un contrecoup prélevé pour
    // une copie qui n'arrive jamais serait pire qu'un refus.
    const { session } = makeSession({ cards: [makeCard({ id: 'KNOWN' })] });
    session.gameState.player_hp = 500;
    const ghost = bury(session, makeCard({ id: 'GHOST' }));

    session.applyMagieOnGraveyardUnit(
      magie({ type: 'duplicate_graveyard_unit', value: 1 }, { cost_hp: 80 }) as any, ghost);

    expect(session.hand).toHaveLength(0);
    expect(session.gameState.player_hp).toBe(500);
  });

  it('`revive` n\'est PAS touchée : elle sort toujours l\'unité du cimetière', () => {
    // Les deux magies partagent la famille de ciblage, pas le geste.
    const plain = makeCard({ id: 'PLAIN' });
    const { session } = makeSession({ cards: [plain] });
    const dead = bury(session, plain);

    session.applyMagieOnGraveyardUnit(magie({ type: 'revive', value: 50 }) as any, dead);

    expect(session.graveyard).toHaveLength(0);
    expect(session.getPlayerUnits()).toHaveLength(1);
    expect(session.hand).toHaveLength(0);
  });

  it('offre : absente cimetière vide, présente dès une unité au cimetière', () => {
    const plain = makeCard({ id: 'PLAIN' });
    const { session } = makeSession({
      cards: [plain],
      magies: [magie({ type: 'duplicate_graveyard_unit', value: 1 }, { id: 'EMPREINTE' })] });
    expect(session.getShoppingMagies()).toEqual([]);

    bury(session, plain);
    expect(offeredIds(session)).toEqual(['EMPREINTE']);
  });

  it('offre : une unité sur le BOARD ne la rend pas pertinente', () => {
    const plain = makeCard({ id: 'PLAIN' });
    const { session } = makeSession({
      cards: [plain],
      magies: [magie({ type: 'duplicate_graveyard_unit', value: 1 }, { id: 'EMPREINTE' })] });
    place(session, plain, { col: 0, row: 0 });
    expect(session.getShoppingMagies()).toEqual([]);
  });
});

// ── Les quatre magies de « remplacement / matériel / sacrifice » ────────────
//
// Elles partagent une propriété que le reste du fichier n'avait pas à couvrir :
// **elles peuvent ne rien trouver**. Une carte dont le tier voisin est absent du
// deck, une carte sans matériel résolvable — ce sont des cibles invalides, pas
// des effets vides, et c'est `magieHandTargets` / `magieUnitTargets` qui le dit.
//
// ⚠️ Tous éprouvés DANS LES DEUX SENS (règle du projet) : ciblage rendu
// permissif, paiement déplacé avant la résolution, `tierShift` passé en `??`,
// filtre du doublon retiré, préférence du matériel manquant retirée, carte
// sacrifiée envoyée au cimetière — chacune de ces régressions passe au rouge.

/** Session à DECK MULTI-TIERS. `makeSession` ne peuple que le tier 1 (et deux
 *  tests s'appuient dessus) : il faut un deck complet pour éprouver un
 *  décalage de tier. `extra` sont des cartes au CATALOGUE mais hors deck — le
 *  cas d'un matériel nommé par id que le joueur n'a pas monté. */
function tieredSession(opts: { byTier: Record<number, any[]>; extra?: any[]; magies?: any[]; rand?: () => number }) {
  const all = [...Object.values(opts.byTier).flat(), ...(opts.extra ?? [])];
  const byId = new Map(all.map((c: any) => [c.id, c]));
  return new GameSession({
    cardsByTier: opts.byTier,
    enemyDeck: {},
    attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [],
    getAllMagies: () => opts.magies ?? [],
    rand: opts.rand ?? (() => 0)
  } as any);
}

describe('shift_tier_card — remplacer une carte de la main', () => {
  const T1 = makeCard({ id: 'T1', tier: 1 });
  const T2 = makeCard({ id: 'T2', tier: 2 });
  const T3 = makeCard({ id: 'T3', tier: 3 });
  const up = magie({ type: 'shift_tier_card', value: 1 }, { id: 'UP' });
  const down = magie({ type: 'shift_tier_card', value: -1 }, { id: 'DOWN' });

  it('remplace la carte désignée par une carte du deck au tier du DESSUS', () => {
    const s = tieredSession({ byTier: { 1: [T1], 2: [T2] } });
    s.hand = [T1 as any, T1 as any];
    s.applyMagieOnHandCard(up as any, 0);
    expect(s.hand.map(c => c.id)).toEqual(['T2', 'T1']);
  });

  it('une valeur NÉGATIVE va chercher le tier du dessous', () => {
    const s = tieredSession({ byTier: { 2: [T2], 3: [T3] } });
    s.hand = [T3 as any];
    s.applyMagieOnHandCard(down as any, 0);
    expect(s.hand.map(c => c.id)).toEqual(['T2']);
  });

  it('une VALEUR à 0 vaut le tier du dessus — le défaut du champ d\'admin', () => {
    // ⚠️ Mutation : `tierShift` en `??` → décalage nul, la carte est remplacée
    // par une carte de son PROPRE tier, contrecoup encaissé pour rien.
    const s = tieredSession({ byTier: { 1: [T1], 2: [T2] } });
    s.hand = [T1 as any];
    s.applyMagieOnHandCard(magie({ type: 'shift_tier_card', value: 0 }) as any, 0);
    expect(s.hand.map(c => c.id)).toEqual(['T2']);
  });

  it('tier voisin absent du deck : PAS une cible, et rien n\'est payé', () => {
    const s = tieredSession({ byTier: { 1: [T1] }, magies: [up] });
    s.hand = [T1 as any];
    s.gameState.player_hp = 500;
    expect(s.magieHandTargets(up as any)).toEqual([]);
    // La magie n'est même pas offerte — mais la garde d'application tient seule.
    expect(s.getShoppingMagies()).toEqual([]);
    expect(s.applyMagieOnHandCard({ ...up, cost_hp: 100 } as any, 0)).toBeNull();
    expect(s.hand.map(c => c.id)).toEqual(['T1']);
    expect(s.gameState.player_hp).toBe(500);
  });

  it('le ciblage est par CARTE, pas par main : seules les cartes servables sortent', () => {
    // T3 n'a pas de tier 4 dans ce deck ; T1 et T2 en ont un.
    const s = tieredSession({ byTier: { 1: [T1], 2: [T2], 3: [T3] } });
    s.hand = [T3 as any, T1 as any, T2 as any];
    expect(s.magieHandTargets(up as any)).toEqual([1, 2]);
  });

  it('la carte posée en main est un OBJET NEUF, jamais la référence du deck', () => {
    // Même règle que `_pushHandCopies` : deux cases pointant sur le même objet
    // rendraient la comparaison par référence de `canUndoPreparation` fausse,
    // et une retouche de main muterait le DECK.
    const s = tieredSession({ byTier: { 1: [T1], 2: [T2] } });
    s.hand = [T1 as any];
    s.applyMagieOnHandCard(up as any, 0);
    expect(s.hand[0]).not.toBe(T2);
    expect(s.hand[0]).toEqual(T2);
  });
});

describe('shift_tier_unit — remplacer une unité du terrain', () => {
  const T1 = makeCard({ id: 'T1', tier: 1 });
  const T1B = makeCard({ id: 'T1B', tier: 1 });
  const T2 = makeCard({ id: 'T2', tier: 2 });
  const up = magie({ type: 'shift_tier_unit', value: 1 }, { id: 'ASCENSION' });

  it('remplace l\'unité SUR SA CASE, initial_position comprise', () => {
    const s = tieredSession({ byTier: { 1: [T1], 2: [T2] } });
    const old = new (Unit as any)(T1, 'player');
    s.board.placeUnit(old, { col: 3, row: 2 });
    s.applyMagieOnUnit(up as any, old);

    const fresh = s.board.getUnit({ col: 3, row: 2 })!;
    expect(fresh.card_id).toBe('T2');
    expect(fresh.uid).not.toBe(old.uid);
    expect(fresh.initial_position).toEqual({ col: 3, row: 2 });
    expect(s.getPlayerUnits()).toHaveLength(1);
  });

  it('l\'ancienne unité quitte la partie — elle ne passe PAS par le cimetière', () => {
    // C'est une substitution, pas une mort : garder la dépouille ferait payer
    // la magie deux fois (une unité de plus ET un matériau d'invocation).
    const s = tieredSession({ byTier: { 1: [T1], 2: [T2] } });
    const old = new (Unit as any)(T1, 'player');
    s.board.placeUnit(old, { col: 0, row: 0 });
    s.applyMagieOnUnit(up as any, old);
    expect(s.graveyard).toEqual([]);
  });

  it('rien de ce que l\'ancienne avait acquis ne survit', () => {
    // Même étanchéité que la duplication : la nouvelle est bâtie sur l'entrée
    // du catalogue, sinon une chaîne d'ascensions capitaliserait les
    // investissements de Shopping des rounds précédents.
    const s = tieredSession({ byTier: { 1: [T1], 2: [T2] } });
    const old = new (Unit as any)(T1, 'player');
    old.veterancy_points = 4;
    old._shopping_bonus = { atk: 40 };
    old.current_hp = 1;
    old.shield = 25;
    s.board.placeUnit(old, { col: 0, row: 0 });
    s.applyMagieOnUnit(up as any, old);

    const fresh: any = s.board.getUnit({ col: 0, row: 0 });
    expect(fresh.veterancy_points).toBe(0);
    expect(fresh._shopping_bonus).toBeUndefined();
    expect(fresh.shield).toBe(0);
    expect(fresh.current_hp).toBe(fresh.max_hp);
  });

  it('⚠️ RÈGLE DU DOUBLON : une carte déjà vivante ne sort jamais du tirage', () => {
    // Le pool du tier 2 se réduit à T2, déjà posé : l'unité n'est donc pas une
    // cible, et rien n'est prélevé. Une magie n'ouvre pas une porte que
    // l'invocation ferme.
    const s = tieredSession({ byTier: { 1: [T1], 2: [T2] } });
    const old = new (Unit as any)(T1, 'player');
    s.board.placeUnit(old, { col: 0, row: 0 });
    s.board.placeUnit(new (Unit as any)(T2, 'player'), { col: 1, row: 0 });
    s.gameState.player_hp = 500;

    expect(s.magieUnitTargets(up as any)).toEqual([]);
    s.applyMagieOnUnit({ ...up, cost_hp: 100 } as any, old);
    expect(s.board.getUnit({ col: 0, row: 0 })).toBe(old);
    expect(s.gameState.player_hp).toBe(500);
  });

  it('la même carte reste ciblable dès qu\'un autre tier 2 existe au deck', () => {
    // L'autre sens du cas précédent : le filtre porte sur le POOL, pas sur la
    // magie.
    const s = tieredSession({ byTier: { 1: [T1], 2: [T2, makeCard({ id: 'T2B', tier: 2 })] } });
    const old = new (Unit as any)(T1, 'player');
    s.board.placeUnit(old, { col: 0, row: 0 });
    s.board.placeUnit(new (Unit as any)(T2, 'player'), { col: 1, row: 0 });
    expect(s.magieUnitTargets(up as any)).toEqual([old]);
    s.applyMagieOnUnit(up as any, old);
    expect(s.board.getUnit({ col: 0, row: 0 })!.card_id).toBe('T2B');
  });

  it('une unité sans tier voisin au deck n\'est pas une cible', () => {
    const s = tieredSession({ byTier: { 1: [T1, T1B], 2: [T2] } });
    const t1 = new (Unit as any)(T1, 'player');
    const t2 = new (Unit as any)(T2, 'player');
    s.board.placeUnit(t1, { col: 0, row: 0 });
    s.board.placeUnit(t2, { col: 1, row: 0 });
    // T2 → tier 3 : absent du deck. T1 → tier 2 : présent, mais T2 est vivant…
    expect(s.magieUnitTargets(up as any)).toEqual([]);
  });
});

describe('draw_material — rendre en main un matériel d\'invocation', () => {
  const MAT_A = makeCard({ id: 'MAT_A', tier: 1 });
  const MAT_B = makeCard({ id: 'MAT_B', tier: 1 });
  const FUSION = makeCard({ id: 'FUSION', tier: 2, summon_conditions: [{ materials: 2, requires: ['MAT_A', 'MAT_B'] }] as any });
  const draw = magie({ type: 'draw_material' }, { id: 'QUETE' });

  it('ajoute un matériel à la main, et LAISSE la carte source', () => {
    const s = tieredSession({ byTier: { 1: [MAT_A, MAT_B], 2: [FUSION] } });
    s.hand = [FUSION as any];
    s.applyMagieOnHandCard(draw as any, 0);
    expect(s.hand.map(c => c.id)).toEqual(['FUSION', 'MAT_A']);
  });

  it('préfère le matériel qui MANQUE à celui que le joueur a déjà', () => {
    // Sans ce tri, la magie rendrait le plus souvent le matériau déjà posé —
    // c'est-à-dire rien d'utile. Double repli dans l'esprit des pioches
    // garanties : à défaut de manquant, on tire parmi tous.
    const s = tieredSession({ byTier: { 1: [MAT_A, MAT_B], 2: [FUSION] } });
    s.hand = [FUSION as any];
    s.board.placeUnit(new (Unit as any)(MAT_A, 'player'), { col: 0, row: 0 });
    s.applyMagieOnHandCard(draw as any, 0);
    expect(s.hand.map(c => c.id)).toEqual(['FUSION', 'MAT_B']);
  });

  it('le repli : tous les matériels possédés → on en rend un quand même', () => {
    const s = tieredSession({ byTier: { 1: [MAT_A, MAT_B], 2: [FUSION] } });
    s.hand = [FUSION as any];
    s.board.placeUnit(new (Unit as any)(MAT_A, 'player'), { col: 0, row: 0 });
    s.board.placeUnit(new (Unit as any)(MAT_B, 'player'), { col: 1, row: 0 });
    s.applyMagieOnHandCard(draw as any, 0);
    expect(s.hand).toHaveLength(2);
  });

  it('un matériel nommé par ATTRIBUT rend une carte du DECK qui le porte', () => {
    // `ARCH_*` ne nomme pas une carte : sans cette résolution, la magie serait
    // muette sur la moitié des recettes du catalogue.
    const dragon = makeCard({ id: 'DRAGON', tier: 1, attributes: ['ARCH_DRAGON'] });
    const byArch = makeCard({ id: 'ARCHFUSION', tier: 2, summon_conditions: [{ materials: 1, requires: ['ARCH_DRAGON'] }] as any });
    const s = tieredSession({ byTier: { 1: [dragon], 2: [byArch] } });
    s.hand = [byArch as any];
    expect(s.magieHandTargets(draw as any)).toEqual([0]);
    s.applyMagieOnHandCard(draw as any, 0);
    expect(s.hand.map(c => c.id)).toEqual(['ARCHFUSION', 'DRAGON']);
  });

  it('un matériel d\'attribut que le DECK ne porte pas n\'est pas une cible', () => {
    const byArch = makeCard({ id: 'ARCHFUSION', tier: 2, summon_conditions: [{ materials: 1, requires: ['ARCH_DRAGON'] }] as any });
    const s = tieredSession({ byTier: { 1: [MAT_A], 2: [byArch] } });
    s.hand = [byArch as any];
    expect(s.magieHandTargets(draw as any)).toEqual([]);
  });

  it('un matériel nommé par ID vient du CATALOGUE, deck ou pas', () => {
    // Une recette nomme la carte exacte qu'elle exige : la rendre est le geste
    // de la magie, qu'elle soit montée dans le deck ou non.
    const s = tieredSession({ byTier: { 2: [FUSION] }, extra: [MAT_A, MAT_B] });
    s.hand = [FUSION as any];
    s.applyMagieOnHandCard(draw as any, 0);
    expect(s.hand.map(c => c.id)).toEqual(['FUSION', 'MAT_A']);
  });

  it('carte sans matériel, ou matériel sorti du catalogue : PAS une cible', () => {
    const orphan = makeCard({ id: 'ORPHAN', tier: 2, summon_conditions: [{ materials: 1, requires: ['GONE'] }] as any });
    const s = tieredSession({ byTier: { 1: [MAT_A], 2: [orphan] } });
    s.hand = [MAT_A as any, orphan as any];
    expect(s.magieHandTargets(draw as any)).toEqual([]);
    s.gameState.player_hp = 500;
    expect(s.applyMagieOnHandCard({ ...draw, cost_hp: 100 } as any, 1)).toBeNull();
    expect(s.hand).toHaveLength(2);
    expect(s.gameState.player_hp).toBe(500);
  });

  it('⚠️ magieHandTargets ne consomme AUCUN hasard', () => {
    // Il est interrogé à chaque rendu de la main : un `rand()` consommé par une
    // question d'affichage décalerait toute la pioche d'une partie semée.
    let calls = 0;
    const s = tieredSession({ byTier: { 1: [MAT_A, MAT_B], 2: [FUSION] }, rand: () => { calls++; return 0; } });
    s.hand = [FUSION as any];
    s.magieHandTargets(draw as any);
    s.magieHandTargets(draw as any);
    expect(calls).toBe(0);
  });
});

describe('sacrifice_card_hp — brûler une carte contre des PV joueur', () => {
  const BIG = makeCard({ id: 'BIG', tier: 1, stats: { hp: 240 } as any });
  const sac = magie({ type: 'sacrifice_card_hp', value: 100 }, { id: 'OFFRANDE' });

  it('la carte quitte la main et ses PV vont au joueur', () => {
    const s = tieredSession({ byTier: { 1: [BIG] } });
    s.hand = [BIG as any];
    s.gameState.player_hp = 500;
    s.applyMagieOnHandCard(sac as any, 0);
    expect(s.hand).toEqual([]);
    expect(s.gameState.player_hp).toBe(740);
  });

  it('⚠️ elle est BRÛLÉE, pas envoyée au cimetière', () => {
    // C'est la seule chose qui la distingue de `hand_to_graveyard` : l'y
    // envoyer rendrait le choix entre les deux magies sans objet.
    const s = tieredSession({ byTier: { 1: [BIG] } });
    s.hand = [BIG as any];
    expect(s.applyMagieOnHandCard(sac as any, 0)).toBeNull();
    expect(s.graveyard).toEqual([]);
  });

  it('la valeur est un POURCENTAGE, et 0 vaut 100 %', () => {
    const s = tieredSession({ byTier: { 1: [BIG] } });
    s.hand = [BIG as any, BIG as any];
    s.gameState.player_hp = 100;
    s.applyMagieOnHandCard(magie({ type: 'sacrifice_card_hp', value: 50 }) as any, 0);
    expect(s.gameState.player_hp).toBe(220);
    s.applyMagieOnHandCard(magie({ type: 'sacrifice_card_hp', value: 0 }) as any, 0);
    expect(s.gameState.player_hp).toBe(460);
  });

  it('plafonné à 1000, comme player_hp_bonus et drain_life', () => {
    const s = tieredSession({ byTier: { 1: [BIG] } });
    s.hand = [BIG as any];
    s.gameState.player_hp = 900;
    s.applyMagieOnHandCard(sac as any, 0);
    expect(s.gameState.player_hp).toBe(1000);
  });

  it('elle ne finance PAS son propre contrecoup', () => {
    // Même règle que `drain_life` : le coût est prélevé AVANT l'effet, et
    // l'accessibilité se juge sur les PV d'AVANT.
    const s = tieredSession({ byTier: { 1: [BIG] } });
    s.hand = [BIG as any];
    s.gameState.player_hp = 60;
    const costly = { ...sac, cost_hp: 100 };
    expect(s.canAffordMagie(costly as any)).toBe(false);
    s.applyMagieOnHandCard(costly as any, 0);
    expect(s.gameState.player_hp).toBe(60);
    expect(s.hand).toHaveLength(1);
  });

  it('offre : il faut une main ET des PV à regagner', () => {
    const s = tieredSession({ byTier: { 1: [BIG] }, magies: [sac] });
    s.gameState.player_hp = 500;
    expect(s.getShoppingMagies()).toEqual([]);       // main vide
    s.hand = [BIG as any];
    expect(s.getShoppingMagies().map(m => m.id)).toEqual(['OFFRANDE']);
    // Une partie COMMENCE à PLAYER_HP_CAP : la magie n'est donc pas offerte
    // avant d'avoir encaissé, ce qui est exactement l'intention.
    s.gameState.player_hp = 1000;
    expect(s.getShoppingMagies()).toEqual([]);
  });
});

describe('magieHandTargets — les trois magies « toutes cartes »', () => {
  it('hand_to_graveyard, duplicate_card et sacrifice_card_hp ne filtrent rien', () => {
    // Y compris une carte INJOUABLE : c'est même souvent celle qu'on veut
    // envoyer au cimetière ou brûler.
    const s = tieredSession({ byTier: { 1: [makeCard({ id: 'A' })] } });
    s.hand = [makeCard({ id: 'A' }) as any, makeCard({ id: 'B', tier: 5 }) as any];
    for (const type of ['hand_to_graveyard', 'duplicate_card', 'sacrifice_card_hp']) {
      expect(s.magieHandTargets(magie({ type, value: 1 }) as any)).toEqual([0, 1]);
    }
  });
});
