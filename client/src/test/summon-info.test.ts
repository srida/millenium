/// <reference types="node" />
// Golden tests de `data/SummonInfo` — la lecture présentable des recettes
// d'invocation affichée par le tooltip de carte.
//
// La suite tourne en node pur, sans jsdom : aucun composant n'est testable.
// C'est exactement pourquoi toute la lecture (quelles voies, quels matériels,
// quel coût) vit dans des fonctions pures — le tooltip ne fait que les rendre.
//
// Le catalogue est lu depuis `initial-data/cards.json`, versionné et toujours
// présent (`data/` n'est créé qu'au démarrage du serveur). Une donnée qui
// dériverait — un matériel pointant sur un id inconnu, une voie d'invocation
// inédite — casse ici, plutôt qu'en affichant un identifiant brut au joueur.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  summonRecipes, recipeCostText, materialsLabel, recipeIsFree,
  SUMMON_LABELS, SUMMON_ICONS
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

// ── Une recette par voie ────────────────────────────────────────────────────

describe('summonRecipes — cartes à voie unique', () => {
  it('rend une seule recette, sans index d\'option', () => {
    const [r] = summonRecipes(card({ summon_conditions: [] }));
    expect(summonRecipes(card({ summon_conditions: [] }))).toHaveLength(1);
    expect(r.index).toBeNull();
    expect(r.label).toBe(SUMMON_LABELS.normal);
    expect(r.icon).toBe(SUMMON_ICONS.normal);
  });

  it('n\'exige rien d\'une normale — le tooltip peut taire le bloc', () => {
    const [r] = summonRecipes(card({ summon_conditions: [] }));
    expect(recipeIsFree(r)).toBe(true);
    expect(recipeCostText(r)).toBeNull();
  });

  it('compte les tributs d\'un sacrifice, et rien d\'autre', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 2 }] }));
    expect(r.sacrifice).toBe(2);
    expect(r.materials).toEqual([]);
    expect(recipeCostText(r)).toBe('2 tributs');
    expect(recipeIsFree(r)).toBe(false);
  });

  it('accorde le singulier sur un tribut unique', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 1 }] }));
    expect(recipeCostText(r)).toBe('1 tribut');
  });

  it('liste les matériaux d\'une fusion, sans tribut', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 2, requires: ['CORE_005', 'CORE_006'] }] }));
    expect(r.materials.map(m => m.id)).toEqual(['CORE_005', 'CORE_006']);
    expect(r.materials.every(m => m.kind === 'card')).toBe(true);
    expect(r.sacrifice).toBe(0);
    expect(materialsLabel(r)).toBe('Matériels');
  });

  it('dit d\'un héritage que ses matériaux sont PRIS DANS ses tributs', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 2, requires: ['CORE_005'] }] }));
    expect(r.sacrifice).toBe(2);
    expect(r.materials.map(m => m.id)).toEqual(['CORE_005']);
    // « dont » et non « Matériel » : le matériau est compté dans les 2 tributs,
    // il ne s'y ajoute pas (cf. InvocationManager, cas heritage).
    expect(materialsLabel(r)).toBe('dont');
  });

  it('nomme la cible d\'une transformation, qui n\'est pas un matériau', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 1, requires: ['CORE_055'] }] }));
    expect(r.materials.map(m => m.id)).toEqual(['CORE_055']);
    expect(materialsLabel(r)).toBe('Transforme');
  });

  it('distingue un matériel d\'ATTRIBUT d\'un matériel de carte', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 1, requires: ['ARCH_005'] }] }));
    expect(r.materials).toEqual([{ id: 'ARCH_005', kind: 'attribute' }]);
  });

  it('ignore un coût que la voie ne lit pas', () => {
    // Un `sacrifice` posé sur une fusion, des `materials` posés sur un
    // sacrifice : InvocationManager ne les vérifie jamais.
    const [fusion] = summonRecipes(card({ summon_conditions: [{ materials: 1, requires: ['CORE_005'] }] }));
    expect(fusion.sacrifice).toBe(0);
    const [sacr] = summonRecipes(card({ summon_conditions: [{ materials: 1 }] }));
    expect(sacr.materials).toEqual([]);
  });
});

// ── Les alternatives (`summon_options`) ─────────────────────────────────────

describe('summonRecipes — cartes à alternatives', () => {
  const dual = card({
    summon_conditions: [{ materials: 1, requires: ['CORE_035'] }],
    summon_options: [
      { summon_conditions: [{ materials: 2 }] },
      { summon_conditions: [{ materials: 1, requires: ['CORE_035'] }] }
    ] });

  it('rend une recette par option, indexée dans l\'ordre', () => {
    const rs = summonRecipes(dual);
    expect(rs.map(r => r.index)).toEqual([0, 1]);
    expect(rs.map(r => r.summon_type)).toEqual(['sacrifice', 'transformation']);
  });

  it('lit chaque option, jamais le coût de premier niveau', () => {
    // Le summon_type/cost de la carte n'est qu'un miroir de l'une des options :
    // `summon()` ne regarde que `summon_options[index]`.
    const [first] = summonRecipes(dual);
    expect(first.sacrifice).toBe(2);
    expect(first.materials).toEqual([]);
  });
});

// ── Les modificateurs de main posés par les magies ──────────────────────────

describe('summonRecipes — coûts remisés par une magie', () => {
  it('annonce une transformation sans cible (free_transformation)', () => {
    const [r] = summonRecipes(card({
      summon_conditions: [{ materials: 1, requires: ['CORE_055'] }],
      _free_transformation: true
    }));
    expect(r.free).toBe(true);
    expect(r.materials).toEqual([]);
    expect(recipeCostText(r)).toBe('sans cible (magie)');
  });

  it('annonce un coût de sacrifice réduit sans cacher son origine', () => {
    const [r] = summonRecipes(card({
      summon_conditions: [{ materials: 1 }],  _original_sacrifice: 2
    }));
    expect(r.sacrifice).toBe(1);
    expect(r.discountedFrom).toBe(2);
    expect(recipeCostText(r)).toBe('1 tribut · réduit de 2');
  });

  it('ne signale aucune remise quand le coût n\'a pas bougé', () => {
    const [r] = summonRecipes(card({
      summon_conditions: [{ materials: 2 }],  _original_sacrifice: 2
    }));
    expect(r.discountedFrom).toBeNull();
  });

  it('annonce les matériels retirés d\'une fusion (remove_fusion_material)', () => {
    // Le coût affiché est celui qui RESTE — c'est lui que le joueur doit
    // réunir — mais la remise se dit, sinon la carte a l'air d'avoir toujours
    // exigé si peu.
    const [r] = summonRecipes(card({
      summon_conditions: [{ materials: 1, requires: ['CORE_001'] }],  _removed_materials: 2
    }));
    expect(r.materials.map(m => m.id)).toEqual(['CORE_001']);
    expect(r.materialsRemoved).toBe(2);
    expect(recipeCostText(r)).toBe('2 matériels retirés (magie)');
  });

  it('une fusion intacte ne signale aucun matériel retiré', () => {
    const [r] = summonRecipes(card({ summon_conditions: [{ materials: 1, requires: ['CORE_001'] }] }));
    expect(r.materialsRemoved).toBeNull();
    expect(recipeCostText(r)).toBeNull();
  });

  it('la marque ne déteint pas sur une autre voie que la fusion', () => {
    // `_removed_materials` vit sur la CARTE : une carte à summon_options le
    // porterait pour toutes ses recettes si le champ n'était pas gardé par le
    // type — un héritage annoncerait alors une remise qu'il n'a pas reçue.
    const [r] = summonRecipes(card({
      summon_conditions: [{ materials: 2, requires: ['CORE_001'] }],  _removed_materials: 1
    }));
    expect(r.materialsRemoved).toBeNull();
  });
});

// ── Le catalogue réel ───────────────────────────────────────────────────────

describe('catalogue livré', () => {
  it('donne un libellé et une icône à chaque voie d\'invocation présente', () => {
    const types = new Set<string>();
    for (const c of CARDS) for (const r of summonRecipes(c)) types.add(r.summon_type);
    for (const t of types) {
      expect(SUMMON_LABELS[t], t).toBeTruthy();
      expect(SUMMON_ICONS[t], t).toBeTruthy();
    }
  });

  it('n\'expose que des matériels nommables — aucun id orphelin au tooltip', () => {
    const cardIds = new Set(CARDS.map(c => c.id));
    const attrIds = new Set(ATTRIBUTES.map(a => a.id));
    for (const c of CARDS) {
      for (const r of summonRecipes(c)) {
        for (const m of r.materials) {
          const known = m.kind === 'attribute' ? attrIds.has(m.id) : cardIds.has(m.id);
          expect(known, `${c.id} → ${m.id}`).toBe(true);
        }
      }
    }
  });

  it('donne à chaque carte de haut tier quelque chose à exiger', () => {
    // Une fusion / héritage / transformation sans exigence lisible serait une
    // carte dont le tooltip ne dirait rien de son invocation.
    const composite = CARDS.filter(c => ['fusion', 'heritage', 'transformation'].includes(c.summon_type));
    expect(composite.length).toBeGreaterThan(0);
    for (const c of composite) {
      const rs = summonRecipes(c);
      expect(rs.some(r => !recipeIsFree(r)), c.id).toBe(true);
    }
  });

  it('rend le même résultat à chaque appel (aucun état caché)', () => {
    const c = CARDS.find(x => Array.isArray(x.summon_options) && x.summon_options.length > 0)!;
    expect(summonRecipes(c)).toEqual(summonRecipes(c));
  });
});
