/* eslint-disable @typescript-eslint/no-explicit-any */
// Le filet du registre des primitives d'effet.
//
// ⚠️ Il ne vérifie PAS que le registre est cohérent avec lui-même — ça, le JSON
// le fait tout seul. Il vérifie qu'il est d'accord avec les TROIS MOTEURS, qui
// eux restent des `switch` écrits à la main : appliquer un effet est du code, et
// le registre ne le remplace pas. C'est précisément à cette jointure que les
// règles dérivaient, dans les deux sens :
//   · le moteur sait faire un effet que le registre ignore → la magie n'est
//     jamais offerte, le libellé sort en id brut, l'admin ne le propose pas.
//     C'est la disparition SILENCIEUSE que documente `MagieOffer` ;
//   · le registre annonce un effet que le moteur ne fait pas → le formulaire le
//     propose, l'auteur l'écrit, et rien n'arrive. C'est `value_per` sur un
//     `shield`, et c'est ce qui a rendu ARCH_019 et ARCH_020 muets.
//
// Les `case` sont lus dans la SOURCE des moteurs. C'est frustre, et c'est
// assumé : c'est la seule lecture qui ne puisse pas, elle, se désynchroniser du
// code qu'elle décrit.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  allKinds, kindsFor, specOf, targetFamily, relevanceRule, paramsOf, renderLabel,
} from '../logic/EffectKinds.js';
import registry from '../logic/effect-kinds.json';
import { effectLabel, needsUnitTarget, needsGraveyardTarget, needsHandTarget } from '../logic/MagieEffect.js';
import { boardEffectLabel } from '../data/BoardInfo.js';
import type { MagieOfferContext } from '../logic/MagieOffer.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(here, '../..');
const ROOT = path.resolve(CLIENT, '..');

const src = (rel: string) => fs.readFileSync(path.join(CLIENT, 'src', rel), 'utf8');

/**
 * Les `case '<type>':` d'un `switch`, à partir du corps d'une fonction.
 *
 * ⚠️ On borne la lecture à la fonction visée : `MagieEffect.js` porte AUSSI les
 * tables de libellés, et `MagieOffer` un `switch` qui n'existe plus — sans la
 * borne, le filet compterait des `case` qui ne sont pas des primitives.
 */
function switchCases(source: string, marker: string): string[] {
  const start = source.indexOf(marker);
  expect(start, `marqueur introuvable : ${marker}`).toBeGreaterThan(-1);
  const body = source.slice(start);
  return [...new Set([...body.matchAll(/case '([a-z_]+)':/g)].map(m => m[1]))];
}

describe('Registre des primitives — recouvrement avec les moteurs', () => {
  // `applyEffect` est le dernier `switch` de magie écrit à la main : c'est lui
  // qui FAIT l'effet. Les types délégués à `GameSession` y figurent en no-op
  // commenté, donc en `case` — ils comptent, et c'est voulu : ils existent bien.
  it('magie — le registre et MagieEffect.applyEffect se recouvrent', () => {
    const cases = switchCases(src('logic/MagieEffect.js'), 'export function applyEffect');
    expect([...cases].sort()).toEqual([...kindsFor('magie')].sort());
  });

  it('terrain — le registre et BoardEffect.applyEffect se recouvrent', () => {
    const cases = switchCases(src('logic/BoardEffect.ts'), 'export function applyEffect');
    expect([...cases].sort()).toEqual([...kindsFor('board')].sort());
  });

  // ⚠️ Les effets d'attribut sont éclatés sur DEUX temps (`_applyStartForSide`
  // et `_applyEndForSide`) et le second mélange `switch` et `if` — d'où une
  // lecture du fichier entier, et une comparaison par INCLUSION dans ce sens-là.
  // L'autre sens (aucun type du registre absent du moteur) est le vrai filet,
  // et il est ci-dessous.
  it('attribut — aucun type du registre n\'est inconnu du moteur', () => {
    const engine = src('logic/AttributeManager.js');
    const missing = kindsFor('attribute').filter(t => !engine.includes(`'${t}'`));
    expect(missing).toEqual([]);
  });

  it('attribut — aucun type du moteur n\'est absent du registre', () => {
    const engine = src('logic/AttributeManager.js');
    const cited = [...new Set([...engine.matchAll(/effect\.type === '([a-z_]+)'|case '([a-z_]+)':/g)]
      .map(m => m[1] ?? m[2]))];
    expect(cited.filter(t => !kindsFor('attribute').includes(t))).toEqual([]);
  });
});

describe('Registre des primitives — cohérence interne', () => {
  it('chaque type déclare au moins un domaine', () => {
    const orphans = allKinds().filter(t => !specOf(t, 'magie') && !specOf(t, 'attribute') && !specOf(t, 'board'));
    expect(orphans).toEqual([]);
  });

  it('chaque magie déclare une famille de ciblage ET une règle de pertinence', () => {
    // ⚠️ Les deux ensemble : sans ciblage la magie est traitée comme globale et
    // s'applique dans le vide ; sans pertinence elle n'est jamais offerte. Les
    // deux pannes sont muettes.
    const bad = kindsFor('magie').filter(t => !targetFamily(t) || !relevanceRule(t));
    expect(bad).toEqual([]);
  });

  it('chaque compteur de pertinence existe dans le contexte d\'offre', () => {
    // ⚠️ Un `gt0` mal orthographié lit `undefined > 0` — donc `false`, donc une
    // magie jamais offerte, sans erreur. Même classe de bug que `active_unit`.
    const ctxKeys = new Set(Object.keys(RICH_CONTEXT));
    const bad = kindsFor('magie')
      .map(t => ({ t, rule: relevanceRule(t) }))
      .filter(({ rule }) => rule && typeof rule === 'object' && ('gt0' in rule || 'flag' in rule))
      .map(({ t, rule }) => ({ t, key: (rule as any).gt0 ?? (rule as any).flag }))
      .filter(({ key }) => !ctxKeys.has(key));
    expect(bad).toEqual([]);
  });

  it('les gabarits n\'appellent que des champs que le type LIT', () => {
    // ⚠️ `targets` et `stat` sont fournis par l'appelant, pas par l'effet — ils
    // sont donc admis en plus des `params`. Tout le reste doit être un champ
    // déclaré, sans quoi le gabarit rend un blanc à l'écran.
    const extra = new Set(['targets', 'stat']);
    const bad: string[] = [];
    for (const domain of ['magie', 'attribute', 'board'] as const) {
      for (const t of kindsFor(domain)) {
        const label = specOf(t, domain)!.label;
        if (typeof label !== 'string') continue;
        for (const [, key] of label.matchAll(/\{(\w+)\}/g)) {
          if (!extra.has(key) && !paramsOf(t, domain).includes(key)) bad.push(`${domain}/${t} → {${key}}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  // ⚠️ Les trois formulaires d'admin sont GÉNÉRÉS depuis ces champs, et
  // `admin.html` n'est couverte par aucun test — c'est ici, et nulle part
  // ailleurs, que leur absence se voit autrement qu'à l'œil.
  it('chaque type sait se nommer dans le <select> de l\'admin', () => {
    const raw = registry as unknown as Record<string, { admin_label?: string }>;
    expect(allKinds().filter(t => !raw[t].admin_label)).toEqual([]);
  });

  it('admin_group ne prend que la valeur qui range sous « Effets avancés »', () => {
    // Un groupe mal orthographié ne jette pas : le type retombe dans la liste de
    // tête, et personne ne s'aperçoit qu'il a changé de place.
    const raw = registry as unknown as Record<string, { admin_group?: string }>;
    const bad = allKinds().filter(t => raw[t].admin_group && raw[t].admin_group !== 'advanced');
    expect(bad).toEqual([]);
  });

  it('la forme courte, quand elle existe, est plus courte que le libellé', () => {
    // Sinon elle ne sert à rien et devient un second libellé à tenir à jour.
    const raw = registry as unknown as Record<string, { admin_label: string; admin_short?: string }>;
    const bad = allKinds()
      .filter(t => raw[t].admin_short && raw[t].admin_short!.length >= raw[t].admin_label.length)
      .map(t => `${t} : « ${raw[t].admin_short} » ≥ « ${raw[t].admin_label} »`);
    expect(bad).toEqual([]);
  });

  it('chaque résolveur nommé répond — libellés comme pertinences', () => {
    // ⚠️ Un `{ fn: … }` qui ne trouve pas sa fonction JETTE à l'appel, en pleine
    // partie. Ici, il jette au test.
    for (const t of kindsFor('magie')) {
      expect(() => effectLabel({ id: 'X', name: 'X', effect: { type: t, value: 2 } } as any)).not.toThrow();
    }
    for (const domain of ['attribute', 'board'] as const) {
      for (const t of kindsFor(domain)) {
        expect(() => boardEffectLabel({ type: t, value: 2 } as any)).not.toThrow();
      }
    }
  });
});

describe('renderLabel', () => {
  it('interpole les champs présents', () => {
    expect(renderLabel('+{value} {stat} ici', { value: 3, stat: 'ATK' })).toBe('+3 ATK ici');
  });

  it('rend une chaîne VIDE sur un champ absent, jamais « undefined »', () => {
    expect(renderLabel('+{value} PV{targets}', { value: 3 })).toBe('+3 PV');
  });

  it('ne reconnaît aucune autre syntaxe', () => {
    expect(renderLabel('{value|plural} {a.b}', { value: 1 })).toBe('{value|plural} {a.b}');
  });
});

describe('Familles de ciblage — dérivées du registre', () => {
  const magie = (type: string) => ({ id: 'X', name: 'X', effect: { type } }) as any;

  it('les trois familles s\'excluent, sur chaque type de magie', () => {
    // ⚠️ `GameController.chooseMagie` les teste dans l'ordre unité → cimetière →
    // main : un type reconnu par deux d'entre elles n'atteindrait jamais la
    // troisième branche.
    for (const t of kindsFor('magie')) {
      const hits = [needsUnitTarget, needsGraveyardTarget, needsHandTarget].filter(f => f(magie(t))).length;
      expect(hits, `${t} appartient à ${hits} familles`).toBeLessThanOrEqual(1);
    }
  });

  it('un type inconnu n\'appartient à aucune famille', () => {
    for (const f of [needsUnitTarget, needsGraveyardTarget, needsHandTarget]) {
      expect(f(magie('type_qui_nexiste_pas'))).toBe(false);
      expect(f(null as any)).toBe(false);
      expect(f({ id: 'X', name: 'X', effect: null } as any)).toBe(false);
    }
  });
});

// Un contexte permissif : tout est disponible, tout est possible. Il sert à
// vérifier les CLÉS, pas les valeurs.
const RICH_CONTEXT: MagieOfferContext = {
  boardUnitCount: 3, defusableFusionCount: 1, poweredUnitCount: 1,
  duplicableUnitCount: 1, duplicableGraveyardCount: 1, graveyardCount: 1,
  handCount: 3, handTiers: [1, 2], boardTiers: [1, 2], materialSourceCount: 1,
  deckTiers: [1, 2, 3], deckAttributes: ['ARCH_001'], deckCardIds: ['CORE_001'],
  deckHasMaterialCost: true, deckHasNamedRequirement: true,
  deckMaterialCostAttributes: ['ARCH_001'], deckNamedRequirementAttributes: ['ARCH_001'],
  boardSlotBonusAvailable: true, playerHpBelowCap: true, damageMultiplierMatters: true,
};

describe('Catalogue livré — les libellés ne bougent pas', () => {
  // ⚠️ Le filet du lot : le registre a remplacé trois `switch`, et PAS UNE
  // chaîne vue par le joueur ne doit avoir changé. Les 172 entrées ont été
  // capturées sur l'implémentation d'avant, puis figées ici.
  const golden: Record<string, string> = require('./fixtures/effect-labels.golden.json');
  const magies: any[] = require(path.join(ROOT, 'initial-data', 'magies.json'));
  const boards: any[] = require(path.join(ROOT, 'initial-data', 'boards.json'));
  const attrs: any[] = require(path.join(ROOT, 'initial-data', 'attributes.json'));

  const actual: Record<string, string> = {};
  for (const m of magies) actual['magie:' + m.id] = effectLabel(m);
  for (const b of boards) {
    const list = b.effects?.length ? b.effects : (b.effect ? [b.effect] : []);
    list.forEach((e: any, i: number) => { actual[`board:${b.id}:${i}`] = boardEffectLabel(e); });
  }
  for (const a of attrs) for (const [ti, t] of (a.thresholds ?? []).entries())
    for (const [ei, e] of (t.effects ?? []).entries()) actual[`attr:${a.id}:${ti}:${ei}`] = boardEffectLabel(e);

  it('chaque effet du catalogue rend exactement le libellé figé', () => {
    expect(actual).toEqual(golden);
  });

  it('le golden couvre bien tout le catalogue livré', () => {
    // Sans ça, un catalogue amputé rendrait le test précédent vert à vide.
    expect(Object.keys(golden).length).toBe(Object.keys(actual).length);
    expect(Object.keys(golden).length).toBeGreaterThan(150);
  });
});
