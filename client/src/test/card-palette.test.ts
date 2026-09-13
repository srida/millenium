// `three/cardPalette` — la palette de tier d'une carte, et le contrat de noms
// qu'elle passe à `styles/board3d.css`.
//
// Ce fichier ne relit PAS les valeurs hexadécimales une à une : recopier une
// table dans son propre test ne prouve rien et s'appelle un détecteur de
// changement. Il éprouve les deux choses qui peuvent casser en silence — le
// repli, et l'accord entre les variables produites et celles que la feuille
// lit.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TIER_FRAMES, FALLBACK_TIER, frameForTier, tierFrameVars, type TierFrame,
} from '../three/cardPalette.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELDS: (keyof TierFrame)[] = ['edge', 'deep', 'ink', 'glow', 'art'];

describe('la table', () => {
  it('porte exactement les cinq tiers', () => {
    expect(Object.keys(TIER_FRAMES).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('chaque tier porte les cinq champs, tous renseignés', () => {
    // Un champ absent ne jette pas : il pose `--uc-edge: undefined`, donc un
    // cadre sans couleur — ça se lit comme une illustration qui n'a pas chargé,
    // pas comme une donnée manquante.
    for (const [tier, frame] of Object.entries(TIER_FRAMES)) {
      for (const field of FIELDS) {
        expect(frame[field], `tier ${tier}, champ ${field}`).toBeTruthy();
      }
    }
  });

  it('les cinq cadres se distinguent — un tier est une COULEUR', () => {
    const edges = Object.values(TIER_FRAMES).map(f => f.edge);
    expect(new Set(edges).size).toBe(edges.length);
  });
});

describe('frameForTier — le repli, et lui seul', () => {
  it('rend le cadre du tier demandé', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      expect(frameForTier(tier)).toBe(TIER_FRAMES[tier]);
    }
  });

  const ABSENTS = [
    ['absent', undefined],
    ['nul', null],
    ['zéro', 0],
    ['hors bornes', 9],
    ['négatif', -1],
    ['non entier', 2.5],
    ['NaN', NaN],
  ] as const;

  for (const [label, tier] of ABSENTS) {
    it(`tier ${label} → le cadre de repli`, () => {
      // ⚠️ `tiersOf` n'a AUCUN repli : une carte sans attribut de tier rend
      // `[]`, donc un appelant peut légitimement n'avoir rien à passer.
      expect(frameForTier(tier as number)).toBe(TIER_FRAMES[FALLBACK_TIER]);
    });
  }

  it('le repli n’est pas le tier le plus bas', () => {
    // Sinon un cadre de repli se confondrait avec un tier 1 réel, qui est une
    // information légitime.
    expect(FALLBACK_TIER).not.toBe(1);
  });
});

describe('tierFrameVars — le contrat avec styles/board3d.css', () => {
  const sheet = fs.readFileSync(path.join(SRC, 'styles', 'board3d.css'), 'utf8');
  const readBySheet = new Set(sheet.match(/--uc-[a-z-]+/g) ?? []);
  const produced = new Set(Object.keys(tierFrameVars(3)));

  it('la feuille lit bien des variables de cadre (le test ne sonde pas dans le vide)', () => {
    expect(readBySheet.size).toBeGreaterThan(0);
  });

  it('toute variable LUE par la feuille est produite', () => {
    // Sens 1 : une variable que personne n'écrit rend un cadre sans couleur.
    const orphelines = [...readBySheet].filter(v => !produced.has(v));
    expect(orphelines).toEqual([]);
  });

  it('toute variable PRODUITE est lue par la feuille', () => {
    // Sens 2 : une variable que personne ne lit est du poids mort, et surtout
    // le signe qu'un effet visuel a été retiré de la feuille sans l'être ici.
    const inutiles = [...produced].filter(v => !readBySheet.has(v));
    expect(inutiles).toEqual([]);
  });

  it('les valeurs sont celles du cadre demandé', () => {
    const f = TIER_FRAMES[4];
    expect(tierFrameVars(4)).toEqual({
      '--uc-edge': f.edge, '--uc-deep': f.deep, '--uc-ink': f.ink,
      '--uc-glow': f.glow, '--uc-art': f.art,
    });
  });

  it('un tier inconnu produit quand même les cinq variables', () => {
    expect(Object.keys(tierFrameVars(undefined))).toHaveLength(FIELDS.length);
  });
});
