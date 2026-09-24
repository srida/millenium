// Golden tests de `data/CardLinks` — les cartes liées d'une carte (matériels,
// lignée, cartes qui la consomment), servies au bouton 🧬 du tooltip.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkedCardGroups, hasLinkedCards } from '../data/CardLinks.js';
import type { Card } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CARDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'initial-data', 'cards.json'), 'utf8')) as Card[];

const card = (over: Partial<Card>): Card => ({
  id: 'X', name: 'X', tier: 1, summon_conditions: [],
  stats: { atk: 1, hp: 1, movement_rate: 100, attack_rate: 100, range: 1 },
  ...over,
} as Card);

describe('linkedCardGroups — matériels', () => {
  it('ne retient que les matériels NOMMÉS qui désignent une carte, pas un attribut', () => {
    const a = card({ id: 'A' });
    const pool = [
      card({ id: 'X', summon_conditions: [{ materials: 2, requires: ['A', 'ARCH_005'] }] }),
      a,
    ];
    const groups = linkedCardGroups(pool[0], pool);
    expect(groups.materials.map(c => c.id)).toEqual(['A']);
  });

  it('dédoublonne un matériel nommé sur plusieurs recettes', () => {
    const a = card({ id: 'A' });
    const x = card({ id: 'X', summon_conditions: [{ materials: 1, requires: ['A'] }, { materials: 1, requires: ['A'] }] });
    const groups = linkedCardGroups(x, [x, a]);
    expect(groups.materials.map(c => c.id)).toEqual(['A']);
  });

  it('omet un id qui n\'a plus de fiche au catalogue', () => {
    const x = card({ id: 'X', summon_conditions: [{ materials: 1, requires: ['GONE'] }] });
    expect(linkedCardGroups(x, [x]).materials).toEqual([]);
  });
});

describe('linkedCardGroups — lignée', () => {
  it('rend la lignée héritée, moins la carte elle-même', () => {
    const a = card({ id: 'A' });
    const b = card({ id: 'B' });
    const x = card({ id: 'X', represented_ids: ['X', 'A', 'B'] });
    const groups = linkedCardGroups(x, [x, a, b]);
    expect(groups.lineage.map(c => c.id)).toEqual(['A', 'B']);
  });

  it('rend [] sans lignée', () => {
    expect(linkedCardGroups(card({ id: 'X' }), []).lineage).toEqual([]);
  });
});

describe('linkedCardGroups — cartes qui la consomment', () => {
  it('trouve les cartes dont une recette la nomme comme matériel', () => {
    const target = card({ id: 'T' });
    const consumer = card({ id: 'C', summon_conditions: [{ materials: 1, requires: ['T'] }] });
    const other = card({ id: 'O' });
    const groups = linkedCardGroups(target, [target, consumer, other]);
    expect(groups.usedBy.map(c => c.id)).toEqual(['C']);
  });

  it('ne se cite jamais elle-même, même si une recette se nomme elle-même par erreur', () => {
    const x = card({ id: 'X', summon_conditions: [{ materials: 1, requires: ['X'] }] });
    expect(linkedCardGroups(x, [x]).usedBy).toEqual([]);
  });

  // ⚠️ Mutation : comparer en sous-chaîne (comme `materiau:` de la barre de
  // recherche) au lieu d'une égalité stricte → ROUGE sur ce cas.
  it('compare l\'id STRICTEMENT, jamais en sous-chaîne', () => {
    const target = card({ id: 'CORE_001' });
    const decoy = card({ id: 'D', summon_conditions: [{ materials: 1, requires: ['XCORE_0010'] }] });
    expect(linkedCardGroups(target, [target, decoy]).usedBy).toEqual([]);
  });
});

describe('hasLinkedCards', () => {
  it('faux quand les trois groupes sont vides', () => {
    expect(hasLinkedCards({ materials: [], lineage: [], usedBy: [] })).toBe(false);
  });
  it('vrai dès qu\'un seul groupe porte une carte', () => {
    expect(hasLinkedCards({ materials: [card({ id: 'A' })], lineage: [], usedBy: [] })).toBe(true);
  });
});

describe('catalogue livré', () => {
  it('tourne sans jeter sur les 868 cartes réelles', () => {
    for (const c of CARDS) {
      const groups = linkedCardGroups(c, CARDS);
      expect(groups.materials.every(m => m.id !== c.id), c.id).toBe(true);
      expect(groups.usedBy.every(u => u.id !== c.id), c.id).toBe(true);
    }
  });

  it('la réciproque tient : si A liste B en matériel, B liste A dans usedBy', () => {
    const sample = CARDS.filter(c => (c.summon_conditions ?? []).some(cd => (cd.requires ?? []).length > 0)).slice(0, 30);
    for (const a of sample) {
      const groups = linkedCardGroups(a, CARDS);
      for (const material of groups.materials) {
        const back = linkedCardGroups(material, CARDS);
        expect(back.usedBy.map(c => c.id), `${material.id} → ${a.id}`).toContain(a.id);
      }
    }
  });
});
