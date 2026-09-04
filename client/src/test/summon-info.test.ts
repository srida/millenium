/// <reference types="node" />
// Golden tests de `data/SummonInfo` — la lecture présentable des conditions
// d'invocation affichée par le tooltip de carte.
//
// La suite tourne en node pur, sans jsdom : aucun composant n'est testable.
// C'est exactement pourquoi toute la lecture (quel coût, quels matériels, quel
// mot pour les introduire) vit dans des fonctions pures — le tooltip ne fait
// que les rendre.
//
// Le catalogue est lu depuis `initial-data/cards.json`, versionné et toujours
// présent (`data/` n'est créé qu'au démarrage du serveur). Une donnée qui
// dériverait — un matériel pointant sur un id inconnu — casse ici, plutôt qu'en
// affichant un identifiant brut au joueur.
//
// ⚠️ Ce fichier ne connaît plus aucune des cinq voies. Ce qu'elles disaient se
// dérive du COÛT, et c'est précisément ce que ces tests verrouillent.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  summonRecipes, summonCostOf, recipeCostText, materialsLabel, recipeIsFree,
} from '../data/SummonInfo.js';
import type { Card } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'initial-data', f), 'utf8'));
const CARDS = readJson('cards.json') as Card[];
const ATTRIBUTES = readJson('attributes.json') as { id: string }[];

const card = (over: Partial<Card>): Card => ({
  id: 'X', name: 'X', tier: 1, summon_conditions: [],
  stats: { atk: 1, hp: 1, movement_speed: 1, attack_speed: 1, initiative: 1, range: 1 },
  ...over
} as Card);

// ── Une recette par condition ───────────────────────────────────────────────

describe('summonRecipes — cartes à condition unique', () => {
  it('une carte SANS condition rend quand même une recette, à coût nul', () => {
    const rs = summonRecipes(card({ summon_conditions: [] }));
    expect(rs).toHaveLength(1);
    expect(rs[0].index).toBeNull();
    expect(rs[0].materials).toBe(0);
    expect(recipeIsFree(rs[0])).toBe(true);
    expect(recipeCostText(rs[0])).toBeNull();
  });

  it('compte les matériels et accorde le pluriel', () => {
    expect(recipeCostText(summonRecipes(card({ summon_conditions: [{ materials: 2 }] }))[0])).toBe('2 matériels');
    expect(recipeCostText(summonRecipes(card({ summon_conditions: [{ materials: 1 }] }))[0])).toBe('1 matériel');
  });

  // ⚠️ C'était la distinction Fusion / Héritage, écrite en dur dans deux tables
  // par voie. Elle tombe du coût seul : autant d'exigences que de slots → on
  // les liste toutes ; moins d'exigences que de slots → les autres slots sont
  // libres, et les nommées sont prises DEDANS.
  // Mutation : rendre toujours « Matériels » → ROUGE sur le cas « dont ».
  it('« Matériels » quand la condition nomme TOUS ses slots', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 2, requires: ['CORE_005', 'CORE_006'] }] }));
    expect(r.requires.map(m => m.id)).toEqual(['CORE_005', 'CORE_006']);
    expect(r.requires.every(m => m.kind === 'card')).toBe(true);
    expect(materialsLabel(r)).toBe('Matériels');
  });

  it('« dont » quand elle en nomme MOINS — les autres slots restent libres', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 2, requires: ['CORE_005'] }] }));
    expect(r.materials).toBe(2);
    expect(r.requires.map(m => m.id)).toEqual(['CORE_005']);
    expect(materialsLabel(r)).toBe('dont');
    expect(recipeCostText(r)).toBe('2 matériels');
  });

  it('« Matériel » au singulier sur une condition à un seul slot nommé', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 1, requires: ['CORE_055'] }] }));
    expect(materialsLabel(r)).toBe('Matériel');
  });

  it('distingue un matériel d\'ATTRIBUT d\'un matériel de carte', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 1, requires: ['ARCH_005'] }] }));
    expect(r.requires).toEqual([{ id: 'ARCH_005', kind: 'attribute' }]);
  });

  it('une condition sans exigence nommée n\'a rien à lister', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 3 }] }));
    expect(r.requires).toEqual([]);
    expect(recipeIsFree(r)).toBe(false);
  });
});

// ── summonCostOf — le chiffre de la vignette ────────────────────────────────

describe('summonCostOf — la voie la moins chère', () => {
  // ⚠️ Même définition que `InvocationManager.summonCost`, dont c'est le
  // pendant d'affichage : une vignette qui annoncerait un autre chiffre que
  // celui que le moteur applique serait pire qu'aucun chiffre.
  it('rend zéro sans condition, le minimum sinon', () => {
    expect(summonCostOf(card({ summon_conditions: [] }))).toBe(0);
    expect(summonCostOf(card({ summon_conditions: [{ materials: 3 }] }))).toBe(3);
    expect(summonCostOf(card({
      summon_conditions: [{ materials: 3, requires: ['A'] }, { materials: 1, requires: ['B'] }],
    }))).toBe(1);
  });
});

// ── Les conditions multiples ────────────────────────────────────────────────

describe('summonRecipes — cartes à conditions multiples', () => {
  const dual = card({
    summon_conditions: [{ materials: 2 }, { materials: 1, requires: ['CORE_035'] }],
  });

  it('rend une recette par condition, indexée dans l\'ordre', () => {
    const rs = summonRecipes(dual);
    expect(rs.map(r => r.index)).toEqual([0, 1]);
    expect(rs.map(r => r.materials)).toEqual([2, 1]);
  });

  it('chaque recette porte SES exigences, pas celles de sa voisine', () => {
    const rs = summonRecipes(dual);
    expect(rs[0].requires).toEqual([]);
    expect(rs[1].requires.map(m => m.id)).toEqual(['CORE_035']);
  });
});

// ── Les remises posées par une magie ────────────────────────────────────────

describe('summonRecipes — coûts remisés par une magie', () => {
  // Le coût affiché est celui qui RESTE — c'est lui que le joueur doit réunir —
  // mais la remise se dit, sinon la carte a l'air d'avoir toujours exigé si peu.
  it('annonce un coût baissé sans cacher son origine', () => {
    const [r] = summonRecipes(card({
      summon_conditions: [{ materials: 1, requires: ['A'] }],
      _discounted_from: [{ materials: 3, requires: ['A', 'B', 'C'] }],
    }));
    expect(r.materials).toBe(1);
    expect(r.discountedFrom).toEqual({ materials: 3, requires: 3 });
    expect(recipeCostText(r)).toBe('1 matériel · au lieu de 3 (magie)');
  });

  // ⚠️ Les deux gestes sont ORTHOGONAUX : une exigence levée ne baisse pas le
  // prix. Les annoncer pareil ferait mentir l'infobulle sur ce qui reste à
  // payer. Mutation : dire « au lieu de N » dans les deux cas → ROUGE.
  it('annonce une exigence LEVÉE, qui ne baisse pas le coût', () => {
    const [r] = summonRecipes(card({
      summon_conditions: [{ materials: 2, requires: ['A'] }],
      _discounted_from: [{ materials: 2, requires: ['A', 'B'] }],
    }));
    expect(r.materials).toBe(2);
    expect(recipeCostText(r)).toBe('2 matériels · 1 exigence(s) levée(s) (magie)');
  });

  // ⚠️ `_discounted_from` vit sur la CARTE, donc sur TOUTES ses conditions. Une
  // remise qui n'a pas touché cette voie-là ne doit rien y annoncer.
  // Mutation : signaler la remise dès que `_discounted_from` existe → ROUGE.
  it('ne signale rien sur une condition que la remise n\'a pas bougée', () => {
    const [inchangee, remisee] = summonRecipes(card({
      summon_conditions: [{ materials: 2 }, { materials: 1, requires: [] }],
      _discounted_from: [{ materials: 2 }, { materials: 3, requires: ['A'] }],
    }));
    expect(inchangee.discountedFrom).toBeNull();
    expect(recipeCostText(inchangee)).toBe('2 matériels');
    expect(remisee.discountedFrom).toEqual({ materials: 3, requires: 1 });
  });

  it('une carte intacte ne signale aucune remise', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 1, requires: ['CORE_001'] }] }));
    expect(r.discountedFrom).toBeNull();
    expect(recipeCostText(r)).toBe('1 matériel');
  });
});

// ── Le catalogue réel ───────────────────────────────────────────────────────

describe('catalogue livré', () => {
  it('n\'expose que des matériels nommables — aucun id orphelin au tooltip', () => {
    const cardIds = new Set(CARDS.map(c => c.id));
    const attrIds = new Set(ATTRIBUTES.map(a => a.id));
    for (const c of CARDS) {
      for (const r of summonRecipes(c)) {
        for (const m of r.requires) {
          const known = m.kind === 'attribute' ? attrIds.has(m.id) : cardIds.has(m.id);
          expect(known, `${c.id} → ${m.id}`).toBe(true);
        }
      }
    }
  });

  it('respecte l\'invariant du moteur : jamais plus d\'exigences que de slots', () => {
    // Une condition qui nommerait plus de matériels qu'elle n'en consomme est
    // insatisfiable — et le tooltip promettrait une carte injouable.
    for (const c of CARDS) {
      for (const r of summonRecipes(c)) {
        expect(r.requires.length, c.id).toBeLessThanOrEqual(r.materials);
      }
    }
  });

  it('donne à chaque carte à coût quelque chose à annoncer', () => {
    const withCost = CARDS.filter(c => summonCostOf(c) > 0);
    expect(withCost.length).toBeGreaterThan(0);
    for (const c of withCost) {
      expect(summonRecipes(c).some(r => !recipeIsFree(r)), c.id).toBe(true);
    }
  });

  it('rend le même résultat à chaque appel (aucun état caché)', () => {
    const c = CARDS.find(x => (x.summon_conditions ?? []).length > 1)!;
    expect(summonRecipes(c)).toEqual(summonRecipes(c));
  });
});
