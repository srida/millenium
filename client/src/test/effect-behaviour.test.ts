/* eslint-disable @typescript-eslint/no-explicit-any */
// Ce que le catalogue livré FAIT, figé.
//
// ⚠️ Le pendant chiffré d'`effect-labels.golden` : celui-là fige ce que le
// joueur lit, celui-ci ce qu'il encaisse. Généraliser une échelle, un barème ou
// une cible ne change aucun mot à l'écran — ça change des nombres, sur 53
// attributs et 25 terrains à la fois, sans que rien ne le dise. C'est la classe
// de dérive dont `ARCH_019` est le précédent : six seuils muets pendant des
// mois, et aucun test rouge.
//
// ⚠️ Ce filet n'a de valeur QUE relu. Une divergence ici n'est pas
// nécessairement une faute — elle peut être le changement voulu — mais elle
// doit toujours être REGARDÉE, jamais absorbée par une regénération.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { allBehaviour } from './effect-behaviour.js';

const require = createRequire(import.meta.url);
const golden = require('./fixtures/effect-behaviour.golden.json');

describe('Comportement des effets — catalogue livré', () => {
  const actual = allBehaviour() as any;

  it('chaque attribut livré applique exactement ce qu\'il appliquait', () => {
    expect(actual.attributes).toEqual(golden.attributes);
  });

  it('chaque terrain livré applique exactement ce qu\'il appliquait', () => {
    expect(actual.boards).toEqual(golden.boards);
  });

  it('chaque magie livrée applique exactement ce qu\'elle appliquait', () => {
    expect(actual.magies).toEqual(golden.magies);
  });

  // ⚠️ LE filet du lot des zones : ces onze magies sont des no-op dans
  // `MagieEffect.applyEffect` — tout leur travail vit dans `GameSession`, et
  // aucun autre golden ne le regarde. Chaque cas est joué DEUX fois, sans puis
  // avec contrecoup : le moment du prélèvement diffère d'une magie à l'autre
  // (avant l'effet, ou seulement si la résolution aboutit), et c'est l'invariant
  // le plus facile à perdre en refactorant.
  it('chaque magie avancée déplace exactement ce qu\'elle déplaçait', () => {
    expect(actual.zones).toEqual(golden.zones);
  });

  it('aucune magie avancée n\'est observée en train de ne RIEN faire', () => {
    // Un cas inerte rendrait le golden vert quoi qu'on change — la panne la
    // plus coûteuse d'un filet, puisqu'elle est invisible.
    const inertes = Object.entries(actual.zones as Record<string, any>)
      .filter(([, v]) => JSON.stringify(v.before) === JSON.stringify(v.after))
      .map(([k]) => k);
    expect(inertes).toEqual([]);
  });

  it('le golden couvre bien tout le catalogue', () => {
    // Sans ça, un catalogue amputé rendrait les trois cas ci-dessus verts à
    // vide — la panne la plus bête qu'un golden puisse avoir.
    expect(Object.keys(actual.attributes).length).toBe(Object.keys(golden.attributes).length);
    expect(Object.keys(actual.attributes).length).toBeGreaterThan(50);
    expect(Object.keys(actual.boards).length).toBeGreaterThan(20);
    expect(Object.keys(actual.magies).length).toBeGreaterThan(45);
  });

  // ⚠️ Deux barèmes que le filet doit voir NOMMÉMENT, parce qu'ils sont les
  // deux qu'on s'apprête à généraliser et que leur valeur juste ne se devine
  // pas d'une ligne de golden parmi cinquante.
  it('ARCH_019 (Démon) échelonne sur les alliés vivants', () => {
    // 10 d'ATK + 1 × 3 alliés vivants. Ce chiffre valait 10 avant le lot 0 :
    // l'attribut ne donnait rien.
    expect(actual.attributes.ARCH_019.start).toContainEqual({ unit: 'P_A', atk: 13 });
  });

  it('ARCH_066 garde son bouclier × alliés vivants, sans value_per', () => {
    // 50 × 3 alliés. Le barème du bouclier est FIXE : le rendre configurable
    // avec un défaut « ×1 » retirerait 100 points à cette unité, en silence.
    expect(actual.attributes.ARCH_066.start).toContainEqual({ unit: 'P_A', shield: 150 });
  });
});
