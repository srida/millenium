/* eslint-disable @typescript-eslint/no-explicit-any */
// Composition de l'offre de la Phase Shopping — `logic/MagieOffer.ts`, module
// pur : ces tests n'instancient aucune `GameSession`, ils nourrissent un
// contexte à la main. Le pendant au niveau session vit dans `shopping.test.ts`.
//
// ⚠️ Tous éprouvés DANS LES DEUX SENS (règle du projet) : filtre retiré → les
// cas de pertinence passent au rouge ; poids égalisés → les deux cas de
// pondération passent au rouge ; tirage avec remise → le cas « sans remise »
// passe au rouge.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { makeRandom } from '../logic/Random.js';
import {
  RARITY_WEIGHTS, RARITY_LABELS, rarityOf, isMagieRelevant, pickMagies,
} from '../logic/MagieOffer.js';
import type { MagieOfferContext } from '../logic/MagieOffer.js';
import type { Magie } from '../logic/types.js';

const magie = (effect: any, over: any = {}): Magie =>
  ({ id: over.id ?? 'M', name: over.name ?? 'Test', effect, ...over }) as Magie;

/** Le contexte le plus PAUVRE : rien sur le board, rien en main, rien nulle part. */
const BARREN: MagieOfferContext = {
  boardUnitCount: 0,
  defusableFusionCount: 0,
  poweredUnitCount: 0,
  duplicableUnitCount: 0,
  graveyardCount: 0,
  handCount: 0,
  deckTiers: [],
  deckSummonTypes: [],
  damageMultiplierMatters: false,
  deckHasSacrificeCost: false,
  deckHasTransformation: false,
  deckHasHeritageMaterial: false,
  deckHasFusionMaterial: false,
  boardSlotBonusAvailable: false,
  playerHpBelowCap: false,
};

/** Le contexte le plus RICHE : tout est possible. */
const LUSH: MagieOfferContext = {
  boardUnitCount: 3,
  defusableFusionCount: 1,
  poweredUnitCount: 2,
  duplicableUnitCount: 3,
  graveyardCount: 2,
  handCount: 5,
  deckTiers: [1, 2, 3, 4, 5],
  deckSummonTypes: ['normal', 'sacrifice', 'fusion', 'heritage', 'transformation'],
  damageMultiplierMatters: true,
  deckHasSacrificeCost: true,
  deckHasTransformation: true,
  deckHasHeritageMaterial: true,
  deckHasFusionMaterial: true,
  boardSlotBonusAvailable: true,
  playerHpBelowCap: true,
};

describe('rarityOf', () => {
  it('défaut à 1 sur tout ce qui n\'est pas 2 ou 3', () => {
    // ⚠️ `rarity` est facultatif dans la donnée : les magies écrites avant
    // l'existence du champ n'en ont pas, et le défaut est ce qui rend l'oubli
    // inoffensif.
    for (const r of [undefined, null, 0, 1, 4, -1, NaN, 'foo', {}, []]) {
      expect(rarityOf(magie(null, { rarity: r }))).toBe(1);
    }
    expect(rarityOf(null)).toBe(1);
    expect(rarityOf(undefined)).toBe(1);
    expect(rarityOf(magie(null))).toBe(1);
  });

  it('rend 2 et 3 tels quels, y compris en CHAÎNE — le cas du <select> d\'admin', () => {
    expect(rarityOf(magie(null, { rarity: 2 }))).toBe(2);
    expect(rarityOf(magie(null, { rarity: 3 }))).toBe(3);
    expect(rarityOf(magie(null, { rarity: '2' }))).toBe(2);
    expect(rarityOf(magie(null, { rarity: '3' }))).toBe(3);
  });

  it('les trois paliers ont un poids et un libellé', () => {
    for (const r of [1, 2, 3] as const) {
      expect(RARITY_WEIGHTS[r]).toBeGreaterThan(0);
      expect(RARITY_LABELS[r]).toBeTruthy();
    }
    // Strictement décroissants : c'est toute la promesse faite au joueur.
    expect(RARITY_WEIGHTS[1]).toBeGreaterThan(RARITY_WEIGHTS[2]);
    expect(RARITY_WEIGHTS[2]).toBeGreaterThan(RARITY_WEIGHTS[3]);
  });
});

describe('isMagieRelevant — la table est FERMÉE', () => {
  it('une magie sans effet n\'est jamais offerte, même dans l\'état le plus riche', () => {
    expect(isMagieRelevant(magie(null), LUSH)).toBe(false);
    expect(isMagieRelevant(magie({}), LUSH)).toBe(false);
    expect(isMagieRelevant(magie({ type: '' }), LUSH)).toBe(false);
  });

  it('un type INCONNU n\'est pas offert non plus', () => {
    // `applyEffect` le traverse sans rien faire : l'offrir serait offrir un
    // blanc, ce que ce filtre existe pour supprimer. Corollaire assumé : un
    // type ajouté à applyEffect mais oublié ici disparaît du jeu — c'est le
    // test « catalogue livré » plus bas qui l'attrape.
    expect(isMagieRelevant(magie({ type: 'wat' }), LUSH)).toBe(false);
  });

  it('guaranteed_draw sans tier n\'est pas offerte', () => {
    expect(isMagieRelevant(magie({ type: 'guaranteed_draw' }), LUSH)).toBe(false);
  });
});

describe('isMagieRelevant — les deux branches de chaque famille', () => {
  // [type, effet complet, champ du contexte qui l'autorise, valeur autorisante]
  const CASES: Array<[string, any, keyof MagieOfferContext, any]> = [
    ['stat_bonus', { type: 'stat_bonus', stat: 'atk', value: 1 }, 'boardUnitCount', 1],
    ['stat_modifier', { type: 'stat_modifier', stat: 'atk', value: 2 }, 'boardUnitCount', 1],
    ['shield', { type: 'shield', value: 10 }, 'boardUnitCount', 1],
    ['heal', { type: 'heal' }, 'boardUnitCount', 1],
    ['team_stat_bonus', { type: 'team_stat_bonus', stat: 'atk', value: 1 }, 'boardUnitCount', 1],
    ['team_heal', { type: 'team_heal', value: 10 }, 'boardUnitCount', 1],
    ['destroy_unit', { type: 'destroy_unit' }, 'boardUnitCount', 1],
    ['drain_life', { type: 'drain_life' }, 'boardUnitCount', 1],
    ['defuse_fusion', { type: 'defuse_fusion' }, 'defusableFusionCount', 1],
    ['revive', { type: 'revive', value: 50 }, 'graveyardCount', 1],
    ['hand_to_graveyard', { type: 'hand_to_graveyard' }, 'handCount', 1],
    ['guaranteed_draw', { type: 'guaranteed_draw', tier: 3 }, 'deckTiers', [3]],
    ['board_slot_bonus', { type: 'board_slot_bonus', value: 1 }, 'boardSlotBonusAvailable', true],
    ['player_hp_bonus', { type: 'player_hp_bonus', value: 100 }, 'playerHpBelowCap', true],
    ['reduce_sacrifice_cost', { type: 'reduce_sacrifice_cost', value: 1 }, 'deckHasSacrificeCost', true],
    ['free_transformation', { type: 'free_transformation' }, 'deckHasTransformation', true],
    ['remove_heritage_material', { type: 'remove_heritage_material' }, 'deckHasHeritageMaterial', true],
    ['remove_fusion_material', { type: 'remove_fusion_material', value: 1 }, 'deckHasFusionMaterial', true],
    ['duplicate_unit', { type: 'duplicate_unit', value: 1 }, 'duplicableUnitCount', 1],
    ['duplicate_card', { type: 'duplicate_card', value: 1 }, 'handCount', 1],
  ];

  it.each(CASES)('%s : absente du contexte pauvre, présente dès que sa condition est remplie', (_name, effect, field, value) => {
    expect(isMagieRelevant(magie(effect), BARREN)).toBe(false);
    expect(isMagieRelevant(magie(effect), { ...BARREN, [field]: value })).toBe(true);
  });

  it('draw_bonus est le SEUL effet qui ne dépend de rien', () => {
    expect(isMagieRelevant(magie({ type: 'draw_bonus', value: 1 }), BARREN)).toBe(true);
  });

  it('duplicate_unit ne se contente PAS de boardUnitCount', () => {
    // ⚠️ Le piège : une unité sur le board dont la carte a quitté le catalogue
    // n'est pas copiable. L'offrir ferait encaisser le contrecoup pour rien —
    // exactement le « blanc » que ce filtre existe pour supprimer. Le compteur
    // dédié est ce qui garde le ciblage et la pertinence d'accord.
    const dup = magie({ type: 'duplicate_unit', value: 1 });
    expect(isMagieRelevant(dup, { ...BARREN, boardUnitCount: 3 })).toBe(false);
    expect(isMagieRelevant(dup, { ...BARREN, duplicableUnitCount: 1 })).toBe(true);
  });

  it('guaranteed_draw : le deck doit porter LE tier demandé, pas un autre', () => {
    const g5 = magie({ type: 'guaranteed_draw', tier: 5 });
    expect(isMagieRelevant(g5, { ...BARREN, deckTiers: [1, 2, 3, 4] })).toBe(false);
    expect(isMagieRelevant(g5, { ...BARREN, deckTiers: [1, 5] })).toBe(true);
  });
});

// ── Le tirage ──────────────────────────────────────────────────────────────

const always = (id: string, rarity?: number) =>
  magie({ type: 'draw_bonus', value: 1 }, { id, ...(rarity ? { rarity } : {}) });

describe('pickMagies', () => {
  it('ne rend JAMAIS une magie non pertinente, même si l\'offre en devient courte', () => {
    const pool = [
      magie({ type: 'heal' }, { id: 'H' }),
      magie({ type: 'revive', value: 50 }, { id: 'R' }),
      magie({ type: 'defuse_fusion' }, { id: 'D' }),
      magie({ type: 'hand_to_graveyard' }, { id: 'G' }),
      magie({ type: 'player_hp_bonus', value: 1 }, { id: 'P' }),
      always('OK'),
    ];
    const picked = pickMagies(pool, BARREN, 3, makeRandom(1));
    expect(picked.map(m => m.id)).toEqual(['OK']);
  });

  it('rend [] quand rien n\'est pertinent — le contrôleur saute alors la phase', () => {
    expect(pickMagies([magie({ type: 'heal' })], BARREN, 3, makeRandom(1))).toEqual([]);
    expect(pickMagies([], LUSH, 3, makeRandom(1))).toEqual([]);
  });

  it('jamais de doublon : sans remise sur toute la longueur du pool', () => {
    const pool = Array.from({ length: 24 }, (_, i) => always(`M${i}`, (i % 3) + 1));
    const ids = pickMagies(pool, BARREN, 24, makeRandom(9)).map(m => m.id);
    expect(ids).toHaveLength(24);
    expect(new Set(ids).size).toBe(24);
  });

  it('ne complète jamais au-delà du pool éligible', () => {
    const pool = [always('A'), always('B')];
    expect(pickMagies(pool, BARREN, 5, makeRandom(3))).toHaveLength(2);
  });

  it('déterministe à graine égale', () => {
    const pool = Array.from({ length: 12 }, (_, i) => always(`M${i}`, (i % 3) + 1));
    const a = pickMagies(pool, BARREN, 3, makeRandom(42)).map(m => m.id);
    const b = pickMagies(pool, BARREN, 3, makeRandom(42)).map(m => m.id);
    expect(a).toEqual(b);
  });

  it('la roulette est PONDÉRÉE, et ça se lit sans statistiques', () => {
    // Pool = 1 Commune (poids 6) + 1 Légendaire (poids 1), total 7. Un tirage
    // uniforme couperait à 0,5 ; la roulette coupe à 6/7 ≈ 0,857.
    const pool = [always('COMMUNE', 1), always('LEGENDAIRE', 3)];
    expect(pickMagies(pool, BARREN, 1, () => 0.8)[0].id).toBe('COMMUNE');
    expect(pickMagies(pool, BARREN, 1, () => 0.9)[0].id).toBe('LEGENDAIRE');
  });

  it('sur un grand nombre d\'offres, la Légendaire sort bien moins que la Commune', () => {
    // 10 Communes / 10 Rares / 4 Légendaires — la composition du catalogue livré.
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => always(`C${i}`, 1)),
      ...Array.from({ length: 10 }, (_, i) => always(`R${i}`, 2)),
      ...Array.from({ length: 4 }, (_, i) => always(`L${i}`, 3)),
    ];
    const rand = makeRandom(2026);
    const seen = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
    const N = 20000;
    for (let i = 0; i < N; i++) seen[rarityOf(pickMagies(pool, BARREN, 1, rand)[0])]++;
    // Attendus (poids 6/3/1, total 94) : 63,8 % · 31,9 % · 4,3 %.
    expect(seen[1] / N).toBeGreaterThan(0.58);
    expect(seen[3] / N).toBeGreaterThan(0.03);
    expect(seen[3] / N).toBeLessThan(0.06);
    // L'ordre des trois parts est la promesse elle-même.
    expect(seen[1]).toBeGreaterThan(seen[2]);
    expect(seen[2]).toBeGreaterThan(seen[3]);
  });
});

describe('Catalogue livré — initial-data/magies.json', () => {
  // ⚠️ C'est le filet du `default: false` d'`isMagieRelevant` : un type d'effet
  // ajouté à `MagieEffect.applyEffect` et aux données, mais oublié dans la table
  // de pertinence, disparaîtrait du jeu SANS UN MOT. Il casse ici à la place.
  const require = createRequire(import.meta.url);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const catalogue: Magie[] = require(path.join(root, 'initial-data', 'magies.json'));

  it('chaque magie livrée est offrable dans un état riche', () => {
    const orphans = catalogue.filter(m => !isMagieRelevant(m, LUSH)).map(m => `${m.id} (${m.effect?.type})`);
    expect(orphans).toEqual([]);
  });

  it('chaque rareté livrée est un palier valide', () => {
    const bad = catalogue.filter(m => ![1, 2, 3].includes((m as any).rarity)).map(m => m.id);
    expect(bad).toEqual([]);
  });

  it('les trois paliers sont représentés — sinon la rareté ne se voit jamais en jeu', () => {
    const byRarity = new Set(catalogue.map(m => rarityOf(m)));
    expect([...byRarity].sort()).toEqual([1, 2, 3]);
  });
});
