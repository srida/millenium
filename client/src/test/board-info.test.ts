/* eslint-disable @typescript-eslint/no-explicit-any */
// Golden tests de `data/BoardInfo.ts` — ce qu'on DIT d'un effet de terrain.
//
// Le module est pur à dessein : la suite vitest tourne en node SANS DOM, aucun
// test de composant n'est possible dans ce projet. Sortir la description des
// composants est donc ce qui la rend vérifiable — et l'infobulle 🗺️ comme
// l'annonce de terrain la partagent, pour ne pas décrire le même terrain de deux
// façons.
//
// ⚠️ Éprouvés dans les deux sens : la mutation qui doit faire tomber chaque cas
// est nommée dans son commentaire.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardEffectLabel, boardTargetsUnits, boardTargetAttributes } from '../data/BoardInfo.js';
import { statLabel, STAT_LABELS } from '../data/StatLabels.js';
import { boardEffects } from '../logic/BoardEffect.js';
import type { BoardDef } from '../logic/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const boards: BoardDef[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/boards.json'), 'utf8'));
const attributes: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));

describe('BoardInfo — quels effets visent des unités', () => {
  // Mutation : ajouter 'draw_bonus' à la liste → ROUGE.
  it('draw_bonus ne vise AUCUNE unité — il crédite le joueur quoi qu\'il arrive', () => {
    expect(boardTargetsUnits({ type: 'draw_bonus', value: 1, target_attributes: ['ARCH_003'] } as any)).toBe(false);
  });

  // Mutation : retirer un des trois de la liste → ROUGE.
  it('stat_bonus, stat_modifier et shield lisent bien target_attributes', () => {
    for (const type of ['stat_bonus', 'stat_modifier', 'shield']) {
      expect(boardTargetsUnits({ type } as any)).toBe(true);
    }
  });

  it('un effet absent ne vise rien', () => {
    expect(boardTargetsUnits(null)).toBe(false);
    expect(boardTargetsUnits(undefined)).toBe(false);
  });

  // Les deux listes de puces de l'écran. Un effet qui ne vise pas d'unité n'en
  // rend AUCUNE : c'est ce qui empêche `draw_bonus` d'afficher des archétypes
  // ou des voies qu'il n'applique pas.
  // Mutation : garde `boardTargetsUnits` retirée des deux lecteurs → ROUGE.
  it('les cibles affichables sont vides sous un effet qui ne vise pas d\'unité', () => {
    const draw = { type: 'draw_bonus', value: 1, target_attributes: ['ARCH_003'], target_summon_types: ['fusion'] } as any;
    expect(boardTargetAttributes(draw)).toEqual([]);
  });

  it('les deux familles de cibles se lisent séparément', () => {
    const effect = { type: 'shield', value: 20, target_attributes: ['ARCH_003'], target_summon_types: ['fusion', 'multi'] } as any;
    expect(boardTargetAttributes(effect)).toEqual(['ARCH_003']);
    expect(boardTargetAttributes({ type: 'shield', value: 1 } as any)).toEqual([]);
  });
});

describe('BoardInfo — le libellé d\'un effet', () => {
  it('chaque type connu rend un libellé français chiffré', () => {
    expect(boardEffectLabel({ type: 'stat_bonus', stat: 'atk', value: 10 } as any)).toBe('+10 ATQ');
    expect(boardEffectLabel({ type: 'stat_modifier', stat: 'hp', value: 2 } as any)).toBe('×2 PV');
    expect(boardEffectLabel({ type: 'shield', value: 20 } as any)).toBe('Bouclier +20');
    expect(boardEffectLabel({ type: 'draw_bonus', value: 1 } as any)).toBe('+1 pioche');
    expect(boardEffectLabel({ type: 'guaranteed_draw' } as any)).toBe('Pioche garantie');
    expect(boardEffectLabel({ type: 'revive' } as any)).toBe('Réanimation');
    expect(boardEffectLabel({ type: 'board_slot_bonus', value: 1 } as any)).toBe('+1 slot');
  });

  // ⚠️ Mutation : repli sur '' → ROUGE. Un blanc dans l'annonce se lirait comme
  // un bug d'affichage, pas comme un terrain neutre.
  it('un effet absent rend « Aucun effet », jamais une chaîne vide', () => {
    expect(boardEffectLabel(null)).toBe('Aucun effet');
    expect(boardEffectLabel(undefined)).toBe('Aucun effet');
    expect(boardEffectLabel({} as any)).toBe('Aucun effet');
  });

  // Mutation : `default: return ''` → ROUGE. Un type ajouté à `applyEffect` mais
  // oublié ici doit se VOIR, pas disparaître.
  it('un type inconnu retombe sur son nom brut, jamais sur du vide', () => {
    expect(boardEffectLabel({ type: 'damage_multiplier_bonus', value: 2 } as any)).toBe('damage_multiplier_bonus');
  });

  // Mutation : appender les cibles hors des trois types qui les lisent → ROUGE.
  it('les cibles ne sont annoncées QUE pour les effets qui les lisent', () => {
    const names = (ids: string[]) => ids.join(' & ');
    expect(boardEffectLabel({ type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: ['A', 'B'] } as any, names))
      .toBe('+10 ATQ (A & B)');
    expect(boardEffectLabel({ type: 'draw_bonus', value: 1, target_attributes: ['A'] } as any, names))
      .toBe('+1 pioche');
  });

  it('sans résolveur de noms, aucune cible n\'est annoncée — l\'infobulle les met en puces', () => {
    expect(boardEffectLabel({ type: 'stat_bonus', stat: 'atk', value: 10, target_attributes: ['A'] } as any))
      .toBe('+10 ATQ');
  });

  it('une stat inconnue retombe sur sa clé brute', () => {
    expect(statLabel('inconnue')).toBe('inconnue');
    expect(Object.keys(STAT_LABELS)).toContain('movement_speed');
  });
});

describe('BoardInfo — les catalogues livrés', () => {
  // Le pendant du test de catalogue de `magie-offer.test.ts` : une donnée qui
  // perdrait son effet en admin casse ICI, pas en montrant un blanc au joueur.
  it('les 14 terrains livrés rendent tous un libellé non vide et chiffré', () => {
    expect(boards.length).toBeGreaterThan(0);
    for (const b of boards) {
      // ⚠️ Par `boardEffects` : un terrain migré en `effects` depuis l'admin
      // n'a plus de `b.effect`, et le test passerait alors à côté de son sujet.
      const effects = boardEffects(b);
      expect(effects.length).toBeGreaterThan(0);
      for (const e of effects) {
        const label = boardEffectLabel(e);
        expect(label).not.toBe('');
        expect(label).not.toBe('Aucun effet');
        expect(label).not.toBe(e.type);   // aucun type inconnu au catalogue
      }
    }
  });

  // ⚠️ Le refactor a sorti cette description de `TooltipHost` : ce test est ce
  // qui prouve qu'aucun palier d'attribut livré n'a perdu son libellé au passage
  // (aucun test de composant n'est possible ici).
  it('chaque effet de palier d\'attribut livré rend encore un libellé', () => {
    let seen = 0;
    for (const attr of attributes) {
      for (const t of attr.thresholds ?? []) {
        for (const e of t.effects ?? []) {
          expect(boardEffectLabel(e, ids => ids.join(', '))).toBeTruthy();
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
