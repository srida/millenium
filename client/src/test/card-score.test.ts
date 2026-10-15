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
    expect(note({ attributes: ['T1', 'FUS', 'SAC'] }).score).toBe(29.5);
  });

  it('mots-clés au coût propre, synergies au tarif, matériaux sur la recette la moins chère', () => {
    const n = note({
      attributes: ['T1', 'BOOM', 'DRAGON'],
      summon_conditions: [{ materials: 2 }, { materials: 1 }],
    });
    expect(n.score).toBe(30 + 2 + 0.5 - 3);
  });

  it('la vitesse de pouvoir ne compte qu\'avec un pouvoir, autour de 50', () => {
    expect(note({ power: { id: 'POWER_HEAL', power_rate: 70 } }).score).toBe(30 + 4 + 2);
    expect(note({ power: {} }).score).toBe(30);
  });

  it('le verdict suit la tolérance', () => {
    expect(note({ stats: { atk: 36 } }).verdict).toBe('dessus');
    expect(note({ stats: { atk: 35 } }).verdict).toBe('dans');
    expect(note({ stats: { atk: 24 } }).verdict).toBe('dessous');
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
