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
  TIER_FRAMES, FALLBACK_TIER, frameForTier, frameVars, type TierFrame,
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

describe('le miroir avec styles/index.css — une seule palette de tier', () => {
  // ⚠️ `--color-tier-N` et `TIER_FRAMES` sont des JUMEAUX, séparés par la
  // frontière CSS / TypeScript : Tailwind génère `text-tier-3` depuis la
  // variable, la carte 3D lit la table. Aucun module ne peut les réunir, ce
  // test est donc le SEUL filet contre leur dérive — et cette dérive a déjà eu
  // lieu : les deux palettes étaient décalées d'un rang, un tier 3 sortait
  // violet sur le plateau et bleu en main.
  const sheet = fs.readFileSync(path.join(SRC, 'styles', 'index.css'), 'utf8');
  const declared = new Map<number, string>();
  for (const [, tier, hex] of sheet.matchAll(/--color-tier-(\d+):\s*([^;]+);/g)) {
    declared.set(Number(tier), hex.trim());
  }

  it('la feuille déclare bien des tiers (le test ne sonde pas dans le vide)', () => {
    expect(declared.size).toBeGreaterThan(0);
  });

  it('chaque tier de la table a sa variable, et de la même couleur', () => {
    for (const [tier, frame] of Object.entries(TIER_FRAMES)) {
      expect(declared.get(Number(tier)), `--color-tier-${tier}`).toBe(frame.edge);
    }
  });

  it('la feuille ne déclare aucun tier que la table ignore', () => {
    // Un `--color-tier-6` sans cadre serait une couleur que la carte 3D ne sait
    // pas rendre : le badge et le liseré se contrediraient.
    expect([...declared.keys()].sort()).toEqual(Object.keys(TIER_FRAMES).map(Number).sort());
  });

  it("le tier 5 ne partage plus la couleur de l'or", () => {
    // ⚠️ Ils valaient la MÊME valeur (#d4af61), et c'est ce qui faisait sortir
    // gold et gemmes dans la même couleur sur l'écran des cadeaux. Les monnaies
    // ont depuis leur propre teinte, mais la collision ne doit pas revenir.
    const gold = sheet.match(/--color-gold:\s*([^;]+);/)?.[1].trim();
    expect(gold).toBeTruthy();
    expect(TIER_FRAMES[5].edge).not.toBe(gold);
  });
});

describe('frameVars — le contrat avec styles/board3d.css', () => {
  const sheet = fs.readFileSync(path.join(SRC, 'styles', 'board3d.css'), 'utf8');
  const readBySheet = new Set(sheet.match(/--uc-[a-z-]+/g) ?? []);
  const produced = new Set(Object.keys(frameVars([3, 4])));

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

  it('un tier inconnu produit quand même les cinq variables', () => {
    expect(Object.keys(frameVars(undefined))).toHaveLength(5);
  });
});

describe('frameVars — un seul tier : identique au rendu d’avant cette table', () => {
  it('une seule bande, à la couleur du tier, aucun `%` autre que 50/100', () => {
    const f = TIER_FRAMES[3];
    const v = frameVars(3);
    expect(v['--uc-edge']).toBe(f.edge);
    expect(v['--uc-glow']).toBe(f.glow);
    // Une seule bande : `size` = 100% de hauteur, `position` = 50% (sans
    // effet, l'image occupe déjà toute la zone) — PIXEL POUR PIXEL le dégradé
    // plein d'avant cette table, jamais un empilement à moitié vide.
    expect(v['--uc-frame-bg']).toBe(
      `linear-gradient(155deg, ${f.ink} 0%, ${f.edge} 44%, ${f.deep} 100%) 0% 50% / 100% 100% no-repeat`,
    );
    expect(v['--uc-frame-art']).toBe(`${f.art} 0% 50% / 100% 100% no-repeat`);
  });

  it('un tier scalaire se comporte comme un tableau à un élément', () => {
    expect(frameVars(3)).toEqual(frameVars([3]));
  });

  it('aucun tier : repli sur le tier de secours', () => {
    expect(frameVars([])).toEqual(frameVars(FALLBACK_TIER));
  });
});

describe('frameVars — plusieurs tiers : une bande par tier DISTINCT', () => {
  it('deux tiers : le plus BAS en haut (0%), le plus HAUT en bas (100%), moitié chacun', () => {
    const [t3, t4] = [TIER_FRAMES[3], TIER_FRAMES[4]];
    const v = frameVars([3, 4]);
    expect(v['--uc-edge']).toBe(t3.edge); // le liseré du haut : le plus bas des deux
    expect(v['--uc-frame-bg']).toBe([
      `linear-gradient(155deg, ${t3.ink} 0%, ${t3.edge} 44%, ${t3.deep} 100%) 0% 0% / 100% 50% no-repeat`,
      `linear-gradient(155deg, ${t4.ink} 0%, ${t4.edge} 44%, ${t4.deep} 100%) 0% 100% / 100% 50% no-repeat`,
    ].join(', '));
  });

  it('trois, quatre, cinq tiers distincts : autant de bandes, réparties à intervalle égal', () => {
    for (const tiers of [[1, 3, 5], [1, 2, 3, 4], [1, 2, 3, 4, 5]] as const) {
      const v = frameVars(tiers);
      const n = tiers.length;
      const layers = v['--uc-frame-bg'].split(/(?<=no-repeat),\s*/);
      expect(layers).toHaveLength(n);
      tiers.forEach((tier, i) => {
        const f = TIER_FRAMES[tier];
        const pos = (i / (n - 1)) * 100;
        expect(layers[i]).toBe(
          `linear-gradient(155deg, ${f.ink} 0%, ${f.edge} 44%, ${f.deep} 100%) 0% ${pos}% / 100% ${100 / n}% no-repeat`,
        );
      });
    }
  });

  it('les doublons ne comptent qu’une fois, et l’ordre d’entrée n’importe pas', () => {
    expect(frameVars([4, 3, 4])).toEqual(frameVars([3, 4]));
  });

  it('la lueur (`--uc-frame-shadow`) porte une paire de rayons par bande', () => {
    const v = frameVars([1, 2, 3]);
    // Un split naïf sur `, ` casserait le `var(--card-glow-near, 10px)`
    // imbriqué — on ne sépare qu'aux virgules HORS parenthèses.
    const layers = v['--uc-frame-shadow'].split(/,(?![^(]*\))/).map(s => s.trim());
    expect(layers).toHaveLength(6); // 2 rayons (near/far) × 3 bandes
  });
});
