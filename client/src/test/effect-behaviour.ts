/* eslint-disable @typescript-eslint/no-explicit-any */
// Le harnais du filet de COMPORTEMENT des effets.
//
// ⚠️ Ce n'est PAS un `*.test.ts` — il n'est donc jamais collecté seul (même
// statut que `http-harness.ts`). Il est importé par `effect-behaviour.test.ts`
// ET par le script qui a capturé la fixture : la scène doit être écrite UNE
// fois, sinon le golden et le test décriraient deux mondes différents et
// l'égalité ne prouverait rien.
//
// ⚠️ Pourquoi ce filet, à côté de celui des libellés : `effect-labels.golden`
// fige ce que le joueur LIT, jamais ce qu'il ENCAISSE. Généraliser une échelle,
// un barème ou une cible ne change aucun mot à l'écran — ça change des chiffres,
// en silence, sur 93 attributs et 25 terrains à la fois. C'est exactement la
// classe de dérive dont ARCH_019 est le précédent.
//
// La scène est FIXE et synthétique : trois unités de chaque côté, des stats
// rondes, aucune dépendance au catalogue de cartes. Seuls les EFFETS viennent
// des données livrées.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttributeManager } from '../logic/AttributeManager.js';
import { applyBoardEffects } from '../logic/BoardEffect.js';
import { applyEffect as applyMagieEffect } from '../logic/MagieEffect.js';
import { GameSession } from '../logic/GameSession.js';
import { GameState } from '../logic/GameState.js';
import { Unit } from '../logic/Unit.js';
import { makeBoard, makeCard, spawn } from './helpers.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (f: string) => require(path.join(ROOT, 'initial-data', f));

/** L'état d'une unité qu'un effet peut toucher. */
function readUnit(u: any) {
  return {
    atk: u.atk, max_hp: u.max_hp, current_hp: u.current_hp, shield: u.shield,
    attack_speed: u.attack_speed, movement_speed: u.movement_speed,
    initiative: u.initiative, range: u.range,
    immune: !!u.is_effect_immune, neutralized: !!u.is_neutralized,
    base: JSON.stringify(u._base),
    shopping: JSON.stringify(u._shopping_bonus ?? null),
    power: JSON.stringify([u.power_id ?? null, u.power_speed, u.power_value ?? null]),
  };
}

/**
 * L'ÉCART d'une unité par rapport à son état neuf — jamais son état complet.
 *
 * ⚠️ Deux raisons, et la seconde compte plus que la première. La fixture passe
 * de 630 Ko à quelques dizaines : c'est agréable. Mais surtout elle devient
 * LISIBLE — on y lit « ARCH_019 → P_A atk +3 » au lieu de six unités inertes
 * répétées quatre fois. Un golden qu'on ne peut pas lire ne se relit jamais, et
 * un changement qu'on ne relit pas se valide au `--update`.
 */
function deltaUnit(u: any, before: ReturnType<typeof readUnit>) {
  const after = readUnit(u) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    if (v !== (before as Record<string, unknown>)[k]) out[k] = v;
  }
  return Object.keys(out).length ? { unit: u.card_id, ...out } : null;
}

/**
 * Une scène neutre, reconstruite à chaque cas.
 *
 * ⚠️ Les DEUX camps portent l'attribut testé : `_applyStartForSide` traite les
 * deux, et une échelle qui compte « les unités d'en face » n'a rien à compter
 * si l'autre camp est vide. Un filet monté sur un seul côté serait aveugle à la
 * moitié de ce qu'il surveille.
 */
function scene(attrId: string) {
  const board = makeBoard();
  const mk = (id: string, side: 'player' | 'enemy', col: number, row: number, attrs: string[]) =>
    spawn(board, makeCard({ id, attributes: attrs, stats: { atk: 10, hp: 100 } as any }), side, { col, row });
  const player = [
    mk('P_A', 'player', 0, 0, [attrId]),
    mk('P_B', 'player', 1, 0, [attrId]),
    mk('P_C', 'player', 2, 0, []),
  ];
  const enemy = [
    mk('E_A', 'enemy', 0, 10, [attrId]),
    mk('E_B', 'enemy', 1, 10, [attrId]),
    mk('E_C', 'enemy', 2, 10, []),
  ];
  return { board, player, enemy };
}

/**
 * Chaque attribut livré, joué en entier : début de combat, une mort (pour les
 * `during_combat`), puis fin de combat.
 *
 * ⚠️ La mort est celle de `P_C`, qui ne porte PAS l'attribut : c'est ce qui
 * laisse les seuils intacts et rend l'observation des `stat_modifier` propre.
 */
export function attributeBehaviour(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const attr of load('attributes.json') as any[]) {
    if (!attr.thresholds?.length) continue;
    const { player, enemy } = scene(attr.id);
    const all = player.concat(enemy);
    const pristine = all.map(readUnit);
    const deltas = () => all.map((u, i) => deltaUnit(u, pristine[i])).filter(Boolean);

    const am = new (AttributeManager as any)([attr], player, enemy);
    am.applyStartOfCombat();
    const start = deltas();

    player[2].is_neutralized = true;
    const events = am.onUnitNeutralized(player[2], player, enemy)
      .map((e: any) => ({ type: e.type, unit: e.unit?.card_id, stat: e.stat, value: e.value }));
    const during = deltas();

    // ⚠️ `applyEndOfCombat` MUTE ses listes de neutralisés (`revive` y fait un
    // `splice`) : on lui en donne des copies fraîches, sinon le cas suivant
    // hériterait d'un tableau déjà vidé.
    const result = am.applyEndOfCombat([player[2]], [enemy[2]]);
    out[attr.id] = {
      start, events, during,
      end: deltas(),
      result: {
        revived: result.revived.map((u: any) => u.card_id),
        enemyRevived: result.enemyRevived.map((u: any) => u.card_id),
        draw_bonus: result.draw_bonus, guaranteed_draws: result.guaranteed_draws,
        board_slot_bonus: result.board_slot_bonus,
        damage_multiplier_bonus: result.damage_multiplier_bonus,
        shopping_bonus: result.shopping_bonus, draw_sources: result.draw_sources,
        enemy_draw_bonus: result.enemy_draw_bonus,
        enemy_guaranteed_draws: result.enemy_guaranteed_draws,
      },
    };
  }
  return out;
}

/** Chaque terrain livré, appliqué sur la même scène. */
export function boardBehaviour(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const bd of load('boards.json') as any[]) {
    // ⚠️ L'attribut de la scène est celui que le terrain VISE, sinon
    // `target_attributes` ne trouverait jamais personne et le filet ne verrait
    // que des zéros — vert quoi qu'on fasse au ciblage.
    const list = bd.effects?.length ? bd.effects : (bd.effect ? [bd.effect] : []);
    const aimed = list.map((e: any) => e?.target_attributes?.[0]).find(Boolean) ?? 'ARCH_NONE';
    const { player, enemy } = scene(aimed);
    const all = player.concat(enemy);
    const pristine = all.map(readUnit);
    const gameState: any = { player_extra_draws: 0, player_draw_sources: [] };
    applyBoardEffects(bd, { playerUnits: player, enemyUnits: enemy, gameState });
    out[bd.id] = {
      units: all.map((u, i) => deltaUnit(u, pristine[i])).filter(Boolean),
      draws: gameState.player_extra_draws, sources: gameState.player_draw_sources,
    };
  }
  return out;
}

/**
 * Chaque magie livrée, appliquée sur une unité et un `gameState` neutres.
 *
 * ⚠️ Les onze types délégués à `GameSession` (duplications, remplacements,
 * transferts de zone) sont des no-op dans `applyEffect` : le filet les traverse
 * donc sans rien voir, et c'est correct — ce qu'ils font ne vit pas ici.
 */
export function magieBehaviour(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const magie of load('magies.json') as any[]) {
    const { player } = scene('ARCH_NONE');
    const target = player[0];
    target.current_hp = 40;
    const pristine = player.map(readUnit);
    // ⚠️ Un VRAI `GameState`, jamais un objet littéral : un faux qui doit
    // miroiter une API finit par ne plus la miroiter. Celui-ci a jeté le jour
    // où le crédit de PV est devenu une méthode — le filet est tombé en
    // « Failed Suite », sans qu'aucune assertion ne rougisse.
    const gameState = new GameState() as any;
    gameState.player_hp = 500;
    applyMagieEffect(magie, { gameState, targetUnit: target, targetUnits: player });
    out[magie.id] = {
      units: player.map((u, i) => deltaUnit(u, pristine[i])).filter(Boolean),
      state: {
        player_hp: gameState.player_hp, draws: gameState.player_extra_draws,
        sources: gameState.player_draw_sources, guaranteed: gameState.player_guaranteed_draws,
        modifiers: gameState.player_hand_modifiers,
        slot: gameState.player_board_slots,
        multiplier: gameState.player_damage_multiplier_bonus,
      },
    };
  }
  return out;
}

export function allBehaviour() {
  return {
    attributes: attributeBehaviour(),
    boards: boardBehaviour(),
    magies: magieBehaviour(),
    zones: magieZoneBehaviour(),
  };
}

// ── Les onze magies « avancées », au niveau des ZONES ─────────────────────────
//
// ⚠️ Elles sont des NO-OP dans `MagieEffect.applyEffect` — tout leur travail vit
// dans `GameSession`, qui déplace des cartes et des unités entre la main, le
// board, le cimetière et le néant. `magieBehaviour()` les traverse donc sans
// rien voir : ce filet-ci est le seul qui les regarde.
//
// ⚠️ Et c'est le seul qui puisse dire qu'un refactor de ces onze n'a rien
// changé. Ce qu'elles font ne se lit sur aucune stat : une carte qui part au
// mauvais endroit, une case perdue, un contrecoup prélevé pour rien ne se
// voient que dans l'inventaire des zones.

/** Un deck synthétique couvrant trois tiers — de quoi nourrir les pools. */
function zoneCards() {
  const at = (id: string, tier: number, over: Record<string, unknown> = {}) =>
    makeCard({ id, tier, stats: { atk: 10, hp: 100 } as any, ...over });
  return [
    at('T1_A', 1), at('T1_B', 1), at('T1_C', 1),
    at('T2_A', 2), at('T2_B', 2),
    // La fusion : deux matériels NOMMÉS, seuls ceux que `defuse_fusion` sait rendre.
    at('T2_FUSION', 2, { summon_conditions: [{ materials: 2, requires: ['T1_A', 'T1_B'] }] }),
    at('T3_A', 3),
  ];
}

/** L'inventaire des quatre zones — ce que ces magies déplacent, et rien d'autre. */
function zones(session: any) {
  return {
    hand: session.hand.map((c: any) => c.id),
    board: session.board.getUnitsOnSide('player')
      .map((u: any) => `${u.card_id}@${u.position.col},${u.position.row}${u.is_neutralized ? ' †' : ''}`)
      .sort(),
    graveyard: session.graveyard.map((u: any) => u.card_id).sort(),
    player_hp: session.gameState.player_hp,
  };
}

/**
 * La scène des zones, reconstruite pour chaque magie.
 *
 * ⚠️ `rand` est FIGÉ : trois de ces magies tirent (`_pickFrom`, `_drawMaterial`)
 * et un flux libre rendrait le golden différent à chaque exécution. Un tirage
 * constant n'appauvrit rien ici — ce qu'on surveille est le DÉPLACEMENT, pas
 * lequel des candidats sort.
 */
function zoneScene() {
  const cards = zoneCards();
  const byId = new Map(cards.map(c => [c.id, c]));
  const session: any = new GameSession({
    cardsByTier: { 1: cards.filter(c => c._tiers.includes(1)), 2: cards.filter(c => c._tiers.includes(2)), 3: cards.filter(c => c._tiers.includes(3)) },
    enemyDeck: {}, attributeList: [],
    cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
    getAllBoards: () => [], getAllMagies: () => [],
    rand: () => 0.42,
  } as any);
  // ⚠️ Le troisième est la FUSION : `draw_material` a besoin d'une carte qui
  // NOMME des matériels, sans quoi il ne trouve rien à rendre et le filet le
  // regarderait ne rien faire — vert quoi qu'on change.
  session.hand = [{ ...byId.get('T1_A') }, { ...byId.get('T2_A') }, { ...byId.get('T2_FUSION') }];
  const place = (id: string, col: number) => {
    const u = new Unit(byId.get(id) as any, 'player');
    u.initial_position = { col, row: 0 };
    session.board.placeUnit(u, { col, row: 0 });
    return u;
  };
  const fusion = place('T2_FUSION', 0);
  const plain = place('T1_C', 1);
  const dead = new Unit(byId.get('T1_B') as any, 'player');
  dead.is_neutralized = true;
  session.graveyard.push(dead);
  session.gameState.player_hp = 500;
  return { session, fusion, plain, dead };
}

/** Où chacune des onze se joue — l'entrée d'application n'est pas la même. */
const ZONE_CASES: Record<string, { via: 'unit' | 'fusion' | 'graveyard' | 'hand'; idx?: number; effect: Record<string, unknown> }> = {
  duplicate_unit: { via: 'unit', effect: { type: 'duplicate_unit', value: 2 } },
  duplicate_graveyard_unit: { via: 'graveyard', effect: { type: 'duplicate_graveyard_unit', value: 1 } },
  duplicate_card: { via: 'hand', effect: { type: 'duplicate_card', value: 2 } },
  shift_tier_card: { via: 'hand', effect: { type: 'shift_tier_card', value: 1 } },
  shift_tier_unit: { via: 'unit', effect: { type: 'shift_tier_unit', value: 1 } },
  draw_material: { via: 'hand', idx: 2, effect: { type: 'draw_material' } },
  sacrifice_card_hp: { via: 'hand', effect: { type: 'sacrifice_card_hp', value: 50 } },
  hand_to_graveyard: { via: 'hand', effect: { type: 'hand_to_graveyard' } },
  destroy_unit: { via: 'unit', effect: { type: 'destroy_unit' } },
  drain_life: { via: 'unit', effect: { type: 'drain_life' } },
  defuse_fusion: { via: 'fusion', effect: { type: 'defuse_fusion' } },
};

export function magieZoneBehaviour(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, { via, idx = 0, effect }] of Object.entries(ZONE_CASES)) {
    // ⚠️ Deux passes : sans contrecoup, puis avec. Le coût est prélevé à des
    // moments DIFFÉRENTS selon la magie (avant l'effet, ou seulement si la
    // résolution aboutit), et c'est très exactement l'invariant qu'un refactor
    // de ces onze risque de perdre.
    for (const cost of [0, 40]) {
      const { session, fusion, plain, dead } = zoneScene();
      const magie: any = { id: 'Z', name: 'Z', effect, ...(cost ? { cost_hp: cost } : {}) };
      const before = zones(session);
      if (via === 'hand') session.applyMagieOnHandCard(magie, idx);
      else if (via === 'graveyard') session.applyMagieOnGraveyardUnit(magie, dead);
      else session.applyMagieOnUnit(magie, via === 'fusion' ? fusion : plain);
      out[`${name}${cost ? '+cost' : ''}`] = { before, after: zones(session) };
    }
  }
  return out;
}
