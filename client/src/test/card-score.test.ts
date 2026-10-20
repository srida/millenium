/* eslint-disable @typescript-eslint/no-explicit-any */
// LE BARÈME DES CARTES (`card-score.mjs` + `initial-data/scoring.json`).
//
// Trois choses : les règles que la formule porte seule (tier le plus bas,
// score libre, voie d'invocation la plus facile), le barème LIVRÉ (chaque id
// qu'il nomme existe, chaque carte livrée reçoit une note).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreCard, scoreCatalog, attributeIndex } from '../../../card-score.mjs';

const ROOT = join(__dirname, '../../..');
const read = (f: string) => JSON.parse(readFileSync(join(ROOT, 'initial-data', f), 'utf8'));

const ATTRS = [
  { id: 'T1', categorie: 'Tiers', tier: 1, name: 'Tier 1' },
  { id: 'T3', categorie: 'Tiers', tier: 3, name: 'Tier 3' },
  { id: 'FUS', categorie: 'Invocation', name: 'Fusion' },
  { id: 'SAC', categorie: 'Invocation', name: 'Sacrifice' },
  { id: 'NOR', categorie: 'Invocation', name: 'Normal' },
  { id: 'DRAGON', categorie: 'Archetype', name: 'Dragon' },
  { id: 'BOOM', categorie: 'MotCle', name: 'Explosif' },
];
const B = {
  budget: { 1: 30, 3: 45 }, tolerance: 5, material: -3,
  stats: { atk: 1, hp: 0, range: 0, attack_rate: 0, movement_rate: 0, material_value: 0, synergy: 0.5, power_rate: 0.1 },
  attributes: { FUS: -3, SAC: -0.5, BOOM: 2 },
  powers: { POWER_HEAL: 4 },
};
const card = (o: any) => ({ id: 'C', name: 'C', stats: { atk: 30 }, attributes: ['T1'], ...o });
const note = (o: any) => scoreCard(card(o), attributeIndex(ATTRS), B);

describe('card-score — la formule', () => {
  it('une carte multi-tier est jugée sur son tier le plus BAS', () => {
    const n = note({ attributes: ['T3', 'T1'] });
    expect(n.tier).toBe(1);
    expect(n.budget).toBe(30);
    expect(n.tiers).toEqual([1, 3]);
  });

  it('une carte exclue des statistiques a un score mais aucun budget', () => {
    const n = note({ balance_excluded: true });
    expect(n.score).toBe(30);
    expect(n).toMatchObject({ budget: null, ecart: null, verdict: 'libre' });
  });

  it('plusieurs voies d\'invocation : seule la plus facile compte', () => {
    expect(note({ attributes: ['T1', 'FUS', 'SAC'], summon_conditions: [{ materials: 2 }] }).score).toBe(29);
  });

  it('malus d\'invocation = matériaux × coût de la voie, rien sans matériau', () => {
    expect(note({ attributes: ['T1', 'FUS'], summon_conditions: [{ materials: 2 }] }).score).toBe(30 - 6);
    expect(note({ attributes: ['T1', 'FUS'] }).score).toBe(30);
  });

  it('supplément de la voie par tier : Normal gratuite en T1, payante ensuite (tier le plus bas)', () => {
    const b = { ...B, budget: { 1: 30, 3: 45 }, attributes: { ...B.attributes, NOR: 0 },
      invocation_tier: { NOR: { 1: 0, 2: -1, 3: -2, 4: -3, 5: -4 } } };
    const n = (attributes: string[]) => scoreCard(card({ attributes }), attributeIndex(ATTRS), b);
    expect(n(['T1', 'NOR']).score).toBe(30);
    expect(n(['T3', 'NOR']).score).toBe(28);
    expect(n(['T3', 'NOR']).parts).toContainEqual({ label: 'Normal T3', value: -2 });
    expect(n(['T3', 'T1', 'NOR']).score).toBe(30);
    // Une voie sans supplément ne paie rien de plus.
    expect(n(['T3', 'SAC']).score).toBe(30);
  });

  it('mots-clés au coût propre, synergies au tarif, matériaux sur la recette la moins chère', () => {
    const n = note({
      attributes: ['T1', 'BOOM', 'DRAGON'],
      summon_conditions: [{ materials: 2 }, { materials: 1 }],
    });
    expect(n.score).toBe(30 + 2 + 0.5 - 3);
  });

  it('chaque recette au-delà de la première vaut extra_recipe', () => {
    const b = { ...B, extra_recipe: 1 };
    const r = (k: number) => scoreCard(card({ summon_conditions: Array.from({ length: k }, () => ({ materials: 1 })) }), attributeIndex(ATTRS), b);
    expect(r(1).score).toBe(30 - 3);
    expect(r(3).score).toBe(30 - 3 + 2);
    expect(r(3).parts).toContainEqual({ label: 'Recettes supplémentaires ×2', value: 2 });
  });

  it('la vitesse de pouvoir ne compte qu\'avec un pouvoir, autour de 50', () => {
    expect(note({ power: { id: 'POWER_HEAL', power_rate: 70 } }).score).toBe(30 + 4 + 2);
    expect(note({ power: {} }).score).toBe(30);
  });

  it('la portée 1 est gratuite : seules les cases au-delà se paient', () => {
    const b = { ...B, stats: { ...B.stats, atk: 0, range: 2 } };
    const portee = (range: number) => scoreCard(card({ stats: { range } }), attributeIndex(ATTRS), b).score;
    expect([1, 2, 3, 4].map(portee)).toEqual([0, 2, 4, 6]);
  });

  it('le verdict suit la tolérance', () => {
    expect(note({ stats: { atk: 36 } }).verdict).toBe('dessus');
    expect(note({ stats: { atk: 35 } }).verdict).toBe('dans');
    expect(note({ stats: { atk: 24 } }).verdict).toBe('dessous');
  });

  it('±tolérance est INCLUSE, à la précision affichée (le dixième)', () => {
    expect(note({ stats: { atk: 25 } }).verdict).toBe('dans');
    // 35,04 s'affiche « 35 » : il doit être jugé comme 35, donc vert.
    expect(note({ stats: { atk: 35.04 } })).toMatchObject({ score: 35, ecart: 5, verdict: 'dans' });
    expect(note({ stats: { atk: 24.96 } }).verdict).toBe('dans');
    expect(note({ stats: { atk: 35.1 } }).verdict).toBe('dessus');
  });
});

describe('card-score — le barème livré', () => {
  const bareme = read('scoring.json')[0];
  const attributes = read('attributes.json');
  const powers = read('powers.json');

  it('chaque attribut et chaque pouvoir qu\'il chiffre existe', () => {
    const attrIds = new Set(attributes.map((a: any) => a.id));
    const powerIds = new Set(powers.map((p: any) => p.id));
    expect(Object.keys(bareme.attributes).filter(id => !attrIds.has(id))).toEqual([]);
    expect(Object.keys(bareme.powers).filter(id => !powerIds.has(id))).toEqual([]);
  });

  it('chaque tier du catalogue a un budget', () => {
    const tiers = attributes.filter((a: any) => a.categorie === 'Tiers').map((a: any) => String(a.tier));
    for (const t of tiers) expect(typeof bareme.budget[t]).toBe('number');
  });

  it('note chaque carte du catalogue livré, exclues en score libre', () => {
    const cards = read('cards.json');
    const notes = scoreCatalog(cards, attributes, bareme);
    for (const c of cards) {
      const n = notes.get(c.id)!;
      expect(Number.isFinite(n.score), c.id).toBe(true);
      expect(n.verdict === 'libre', c.id).toBe(!!c.balance_excluded);
    }
  });
});
