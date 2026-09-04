/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />
// Le tier est un ATTRIBUT, et la règle qui le résout existe en DEUX exemplaires
// — `tiers.js` (serveur, CJS) et `logic/Tiers.ts` (client, ESM TS) — parce que
// la frontière des deux runtimes interdit un module partagé (même situation que
// `XP_PER_LEVEL` et `BASE_TICK_MS`).
//
// ⚠️ Ce fichier est le SEUL filet contre leur dérive : il les fait répondre sur
// le catalogue livré, carte par carte. Sans lui, un jour, le serveur vendrait
// une carte « T3 » que le client piocherait au tour 2.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {
  TIER_CATEGORY, DEFAULT_TIER, tierIndex, resolveTiers, tiersOf, primaryTier, displayTier, hasTier,
} from '../logic/Tiers.js';
import type { AttributeDef, Card } from '../logic/types.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const INITIAL = path.join(ROOT, 'initial-data');

// ⚠️ Posé AVANT le require : `asset-dirs.js` fige `DATA_DIR` dans une const au
// chargement, et `tiers.js` en déduit le chemin d'`attributes.json`. Même
// discipline que `http-harness.ts`.
process.env.DATA_DIR = INITIAL;
const server = require(path.join(ROOT, 'tiers.js'));

const load = <T>(f: string): T[] => JSON.parse(fs.readFileSync(path.join(INITIAL, f), 'utf8'));
const CARDS = load<Card>('cards.json');
const ATTRS = load<AttributeDef>('attributes.json');
const INDEX = tierIndex(ATTRS);

/** Une carte écrite à la main : le tier n'existe QUE sous forme d'attributs. */
function card(id: string, attributes: string[]): Card {
  return { id, name: id, attributes, stats: {} as any };
}

const tierAttrs = ATTRS.filter(a => a.categorie === TIER_CATEGORY);
const attrFor = (t: number) => tierAttrs.find(a => Number(a.tier) === t)!.id;

describe('les deux résolveurs disent la même chose', () => {
  it('sur les 868 cartes du catalogue livré', () => {
    // Décoré comme le serveur le fait sur `GET /api/cards` : c'est cette forme
    // que le client lit, jamais les attributs bruts.
    const divergent = CARDS.filter((c) => {
      const mine = resolveTiers(c, INDEX);
      const theirs = server.tiersOf(c);
      return JSON.stringify(mine) !== JSON.stringify(theirs);
    });
    expect(divergent.map(c => c.id)).toEqual([]);
    // Et le catalogue n'est pas vide : un index vide ferait passer le test
    // ci-dessus en rendant deux listes vides partout.
    expect(CARDS.length).toBeGreaterThan(100);
    expect(Object.keys(INDEX).length).toBe(5);
  });

  it('sur le tier retenu quand il en faut UN — le plus haut', () => {
    for (const c of CARDS.slice(0, 200)) {
      const decorated = { ...c, _tiers: resolveTiers(c, INDEX) };
      expect(primaryTier(decorated)).toBe(server.primaryTier(c));
      expect(displayTier(decorated)).toBe(server.displayTier(c));
    }
  });

  it('sur une carte multi-tiers : les deux tiers, et le plus haut en tête', () => {
    const c = card('MULTI_001', [attrFor(2), attrFor(4)]);
    expect(resolveTiers(c, INDEX)).toEqual([2, 4]);
    expect(server.tiersOf(c)).toEqual([2, 4]);
    const decorated = { ...c, _tiers: resolveTiers(c, INDEX) };
    expect(primaryTier(decorated)).toBe(4);
    expect(server.primaryTier(c)).toBe(4);
    expect(hasTier(decorated, 2)).toBe(true);
    expect(hasTier(decorated, 3)).toBe(false);
  });

  it("sur une carte de l'admin — champ `tier`, pas encore l'attribut", () => {
    // ⚠️ Le cas qui ferait disparaître une carte en silence : l'onglet Cartes
    // écrit encore le champ historique, donc `_tiers` sort VIDE. Un tableau
    // vide n'est pas une réponse, et les deux jumeaux portent le même repli.
    const c = { ...card('ADMIN_001', ['ARCH_002']), tier: 3, _tiers: [] } as Card;
    expect(tiersOf(c)).toEqual([3]);
    expect(primaryTier(c)).toBe(3);
    expect(server.tiersOf({ id: 'ADMIN_001', attributes: ['ARCH_002'], tier: 3 })).toEqual([3]);
  });

  it("sur une carte sans aucun tier : un repli côté règle, RIEN côté étiquette", () => {
    const c = card('NOTIER_001', []);
    expect(resolveTiers(c, INDEX)).toEqual([]);
    expect(server.tiersOf(c)).toEqual([]);
    // ⚠️ La différence n'est pas cosmétique : une règle de jeu doit toujours
    // obtenir un chiffre, une étiquette ne doit pas en inventer un.
    expect(primaryTier({ ...c, _tiers: [] })).toBe(DEFAULT_TIER);
    expect(server.primaryTier(c)).toBe(DEFAULT_TIER);
    expect(displayTier({ ...c, _tiers: [] })).toBeNull();
    expect(server.displayTier(c)).toBeNull();
  });
});

describe('la règle ne nomme aucun id', () => {
  it("un attribut de catégorie Tiers sans champ `tier` est IGNORÉ, il ne devine rien", () => {
    const index = tierIndex([
      { id: 'X_SANS_NUM', name: 'Tier 3', categorie: TIER_CATEGORY, timing: 'start_of_combat', thresholds: [] },
    ] as AttributeDef[]);
    // Le nom dit « Tier 3 » : le déduire du libellé casserait au premier
    // renommage en admin. Seul le champ `tier` fait foi.
    expect(index).toEqual({});
    expect(resolveTiers(card('C', ['X_SANS_NUM']), index)).toEqual([]);
  });

  it('un attribut hors catégorie Tiers portant un champ `tier` ne compte pas', () => {
    const index = tierIndex([
      { id: 'ARCH_FAUX', name: 'Dragon', categorie: 'Archetype', tier: 4, timing: 'start_of_combat', thresholds: [] },
    ] as AttributeDef[]);
    expect(index).toEqual({});
  });
});

describe('le contrat du catalogue livré', () => {
  it('chaque carte porte au moins un attribut de tier, un d’invocation, un d’élément', () => {
    const byId = new Map(ATTRS.map(a => [a.id, a]));
    const missing: Record<string, string[]> = { Tiers: [], Invocation: [], Element: [] };
    for (const c of CARDS) {
      const cats = new Set((c.attributes ?? []).map(id => byId.get(id)?.categorie));
      for (const cat of Object.keys(missing)) if (!cats.has(cat)) missing[cat].push(c.id);
    }
    expect(missing).toEqual({ Tiers: [], Invocation: [], Element: [] });
  });

  it('le champ historique `tier` reste D’ACCORD avec les attributs', () => {
    // ⚠️ C'est l'invariant qui fait du passage aux attributs un REFACTOR et non
    // une nouvelle règle : tant que le champ existe, il doit dire la même chose
    // que la carte. Ce test disparaît avec le champ, pas avant.
    const faux = CARDS.filter(c => c.tier != null && !resolveTiers(c, INDEX).includes(Number(c.tier)));
    expect(faux.map(c => c.id)).toEqual([]);
  });

  it('les cinq attributs de tier portent bien 1 à 5', () => {
    expect(tierAttrs.map(a => Number(a.tier)).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('la lecture est tolérante', () => {
  it('une carte écrite à la main (tests, bancs de dev) garde son champ `tier` pour repli', () => {
    // Le repli existe pour les cartes synthétiques et pour un client servi par
    // un serveur en retard de déploiement. Il disparaît avec le champ.
    expect(tiersOf({ id: 'X', name: 'X', tier: 3 } as Card)).toEqual([3]);
    expect(primaryTier({ id: 'X', name: 'X', tier: 3 } as Card)).toBe(3);
  });

  it('`_tiers` PRIME sur le champ : c’est le résolu qui fait foi', () => {
    const c = { id: 'X', name: 'X', tier: 1, _tiers: [4] } as Card;
    expect(tiersOf(c)).toEqual([4]);
    expect(primaryTier(c)).toBe(4);
  });
});
