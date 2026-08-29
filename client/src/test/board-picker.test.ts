/* eslint-disable @typescript-eslint/no-explicit-any */
// Golden tests du tirage de terrain (logic/BoardPicker.ts) — le module PUR.
//
// ⚠️ Chaque cas est ÉPROUVÉ DANS LES DEUX SENS : vert sur la règle actuelle,
// ROUGE quand on réintroduit exprès le comportement d'avant. La mutation qui
// doit faire tomber chaque test est nommée dans son commentaire — un test qui
// passerait aussi sur la régression ne vaut rien, et c'est invérifiable après
// coup.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pickBoard, isBoardRelevant, deckAttributes, dominantAttributes, attributeCounts,
  MIN_ATTRIBUTE_OCCURRENCES,
} from '../logic/BoardPicker.js';
import { makeRandom } from '../logic/Random.js';
import type { BoardDef } from '../logic/types.js';

// Un terrain synthétique. `attrs: null` → aucun effet ; `attrs: []` → un effet
// qui vise tout le monde (les deux cas limites de la pertinence).
function terrain(id: string, attrs: string[] | null = []): BoardDef {
  return {
    id, name: id,
    effect: attrs === null ? null : { type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: attrs },
  } as BoardDef;
}

function ctx(over: Partial<{ player: string[]; enemy: string[]; used: string[] }> = {}) {
  return {
    playerAttributes: over.player ?? [],
    enemyAttributes: over.enemy ?? [],
    usedBoardIds: new Set(over.used ?? []),
  };
}

/** Un `rand` qui compte ses appels — l'invariant du §8/§10 en dépend. */
function countingRand(inner: () => number = () => 0) {
  let calls = 0;
  const fn = () => { calls++; return inner(); };
  return { fn, calls: () => calls };
}

describe('BoardPicker — pertinence', () => {
  it('un terrain dont le ciblage est porté par le deck JOUEUR est pertinent', () => {
    expect(isBoardRelevant(terrain('B', ['ARCH_003']), ctx({ player: ['ARCH_003'] }))).toBe(true);
  });

  // Mutation : retirer `ctx.enemyAttributes` du prédicat → ROUGE.
  it("un terrain ciblant le deck ADVERSE est pertinent tout autant", () => {
    expect(isBoardRelevant(terrain('B', ['ARCH_003']), ctx({ enemy: ['ARCH_003'] }))).toBe(true);
  });

  it('un ciblage que personne ne porte n’est pas pertinent', () => {
    expect(isBoardRelevant(terrain('B', ['ARCH_099']), ctx({ player: ['ARCH_003'] }))).toBe(false);
  });

  // Mutation : `if (!targets?.length) return false` → ROUGE.
  it('target_attributes VIDE vise tout le monde, donc toujours pertinent', () => {
    expect(isBoardRelevant(terrain('B', []), ctx())).toBe(true);
  });

  // Mutation : `if (!effect?.type) return true` → ROUGE.
  it('un terrain SANS effet ne touche personne, donc jamais pertinent', () => {
    expect(isBoardRelevant(terrain('B', null), ctx({ player: ['ARCH_003'] }))).toBe(false);
  });
});

describe('BoardPicker — les attributs qui identifient un deck', () => {
  // Mutation : MIN_ATTRIBUTE_OCCURRENCES = 1 → ROUGE.
  it('un attribut porté par UNE seule carte ne qualifie pas', () => {
    const cards = [{ attributes: ['ARCH_003'] }, { attributes: ['ARCH_001'] }, { attributes: ['ARCH_001'] }] as any;
    expect(deckAttributes(cards)).toEqual(['ARCH_001']);
  });

  it('le seuil est bien de 2', () => {
    expect(MIN_ATTRIBUTE_OCCURRENCES).toBe(2);
  });

  // Mutation : compter les ids DISTINCTS au lieu des entrées → ROUGE.
  it('les doublons du deck sont comptés comme des entrées', () => {
    const cards = [{ attributes: ['ARCH_003'] }, { attributes: ['ARCH_003'] }] as any;
    expect(deckAttributes(cards)).toEqual(['ARCH_003']);
  });

  // Mutation : retirer le `.sort()` → ROUGE.
  it('le résultat est TRIÉ — une valeur absolue, pas un ordre de parcours', () => {
    const counts = { ARCH_ZZ: 5, ARCH_AA: 5, ARCH_MM: 5 };
    expect(dominantAttributes(counts)).toEqual(['ARCH_AA', 'ARCH_MM', 'ARCH_ZZ']);
  });

  it('une carte sans attributs, ou nulle, ne casse rien', () => {
    expect(attributeCounts([null, undefined, { attributes: undefined } as any])).toEqual({});
    expect(deckAttributes([])).toEqual([]);
  });

  // Le pont client/serveur : `dominantAttributes` accepte des comptes VENUS DU
  // RÉSEAU, seuil appliqué ici et nulle part ailleurs.
  it('applique le seuil à des comptes reçus tels quels', () => {
    expect(dominantAttributes({ ARCH_003: 7, ARCH_045: 1 })).toEqual(['ARCH_003']);
  });
});

describe('BoardPicker — le tirage', () => {
  const pool = [terrain('B1', ['ARCH_001']), terrain('B2', ['ARCH_002']), terrain('B3', ['ARCH_003'])];

  // Mutation : supprimer le filtre `usedBoardIds` → ROUGE.
  it('un terrain déjà joué ne ressort jamais tant qu’il en reste d’autres', () => {
    for (let seed = 0; seed < 30; seed++) {
      const got = pickBoard(pool, ctx({ used: ['B1', 'B2'] }), makeRandom(seed + 1));
      expect(got?.id).toBe('B3');
    }
  });

  // Mutation : `candidates = unused` inconditionnellement → ROUGE.
  it('à pertinence disponible, c’est un terrain PERTINENT qui sort', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      seen.add(pickBoard(pool, ctx({ player: ['ARCH_002'] }), makeRandom(seed + 1))!.id);
    }
    expect([...seen]).toEqual(['B2']);
  });

  // ⚠️ LE test de l'arbitrage : « jamais deux fois » l'emporte sur la pertinence.
  // Mutation : calculer `relevant` sur `all` au lieu de `unused` (priorité
  // inversée) → ROUGE.
  it('plus aucun pertinent inutilisé → un NEUTRE inutilisé, jamais le pertinent déjà joué', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      seen.add(pickBoard(pool, ctx({ player: ['ARCH_002'], used: ['B2'] }), makeRandom(seed * 7919 + 1))!.id);
    }
    // Ce qui est éprouvé, c'est l'EXCLUSION du pertinent déjà joué — pas la
    // couverture du tirage, qui ne dirait rien de la règle.
    expect(seen.has('B2')).toBe(false);
    for (const id of seen) expect(['B1', 'B3']).toContain(id);
  });

  // Mutation : supprimer le 3ᵉ échelon → ROUGE (rendrait null).
  it('pool entièrement consommé → rend quand même un terrain', () => {
    const got = pickBoard(pool, ctx({ used: ['B1', 'B2', 'B3'] }), makeRandom(7));
    expect(got).not.toBeNull();
    expect(['B1', 'B2', 'B3']).toContain(got!.id);
  });

  it('5 tirages successifs sur 14 terrains donnent 5 terrains DISTINCTS', () => {
    const big = Array.from({ length: 14 }, (_, i) => terrain(`B${String(i).padStart(2, '0')}`, ['ARCH_001']));
    const rand = makeRandom(2026);
    const used = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const got = pickBoard(big, { playerAttributes: [], enemyAttributes: [], usedBoardIds: used }, rand)!;
      expect(used.has(got.id)).toBe(false);
      used.add(got.id);
    }
    expect(used.size).toBe(5);
  });

  it('catalogue vide → null', () => {
    expect(pickBoard([], ctx(), makeRandom(1))).toBeNull();
  });

  it('ignore les entrées nulles du catalogue', () => {
    expect(pickBoard([null, undefined, terrain('OK')] as any, ctx(), makeRandom(1))!.id).toBe('OK');
  });

  // ⚠️ L'invariant qui protège les 23 goldens de déterminisme de sim.test.ts.
  // Mutation : remonter `rand()` avant le test de vacuité → ROUGE.
  it('pool vide → rand n’est PAS appelé', () => {
    const r = countingRand();
    expect(pickBoard([], ctx(), r.fn)).toBeNull();
    expect(r.calls()).toBe(0);
  });

  // Mutation : un re-tirage ou un second `rand()` dans un repli → ROUGE.
  it('EXACTEMENT un appel à rand, à chacun des trois échelons', () => {
    for (const c of [
      ctx({ player: ['ARCH_002'] }),            // échelon 1 — pertinent inutilisé
      ctx({ used: [] }),                         // échelon 2 — aucun pertinent
      ctx({ used: ['B1', 'B2', 'B3'] }),         // échelon 3 — tout consommé
    ]) {
      const r = countingRand();
      pickBoard(pool, c, r.fn);
      expect(r.calls()).toBe(1);
    }
  });

  it('même graine + même contexte → même suite de tirages', () => {
    const draw = (seed: number) => {
      const rand = makeRandom(seed);
      const used = new Set<string>();
      return [0, 1, 2].map(() => {
        const b = pickBoard(pool, { playerAttributes: [], enemyAttributes: [], usedBoardIds: used }, rand)!;
        used.add(b.id);
        return b.id;
      });
    };
    expect(draw(99)).toEqual(draw(99));
  });
});

describe('BoardPicker — le catalogue livré', () => {
  const boards: BoardDef[] = JSON.parse(readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../initial-data/boards.json'), 'utf8'));

  // Le pendant exact du test de catalogue de magie-offer.test.ts : une donnée
  // qui perdrait son effet en admin casse ICI, pas en offrant au joueur un
  // terrain qui ne fait rien.
  it('chaque terrain livré est offrable sous un contexte qui porte son ciblage', () => {
    expect(boards.length).toBeGreaterThan(0);
    for (const b of boards) {
      const targets = b.effect?.target_attributes ?? [];
      expect(isBoardRelevant(b, ctx({ player: targets }))).toBe(true);
    }
  });

  it('les 5 combats d’un duel tiennent dans le catalogue livré, sans répétition', () => {
    const rand = makeRandom(4242);
    const used = new Set<string>();
    for (let i = 0; i < 5; i++) used.add(pickBoard(boards, { playerAttributes: [], enemyAttributes: [], usedBoardIds: used }, rand)!.id);
    expect(used.size).toBe(5);
  });
});
