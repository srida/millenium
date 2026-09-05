/* eslint-disable @typescript-eslint/no-explicit-any */
// Le Banc d'essai des effets — le détecteur, et ce qu'il trouve sur le catalogue
// livré.
//
// Deux filets, et ils ne surveillent pas la même chose :
//
//  1. **Le détecteur marche.** Sur un catalogue de synthèse dont on sait à
//     l'avance quel effet est muet et pourquoi, le banc doit dire exactement ça.
//     Un détecteur qui ne détecte rien passerait tous les autres tests de ce
//     fichier — c'est la panne que `show.test.ts` a rencontrée deux fois.
//
//  2. **La liste des muets du catalogue est FIGÉE.** C'est le filet qui a de la
//     valeur au quotidien : un effet écrit demain sous la mauvaise horloge
//     rougit ici, au lieu de rejoindre `ARCH_019` dans le silence. La liste
//     n'est pas une liste de fautes acceptées — c'est un inventaire à vider.
//
// L'ÉCRAN n'est pas testé : la suite tourne en node sans jsdom, aucun test de
// composant n'est possible dans ce projet. Toute la décision vit donc dans le
// pilote, qui est pur — même partage que `dev/aiLabRun.ts`.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEffectBench, muteRows, ATTRIBUTE_TIMINGS } from '../dev/effectBenchRun.js';
import { kindsFor } from '../logic/EffectKinds.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (f: string) => require(path.join(ROOT, 'initial-data', f));

const bench = (over: Partial<Parameters<typeof runEffectBench>[0]> = {}) =>
  runEffectBench({ attributes: [], boards: [], magies: [], ...over });

const attr = (id: string, timing: string, effect: any, count = 2) =>
  ({ id, name: id, timing, thresholds: [{ count, effects: [effect] }] });

// ── 1. Le détecteur ──────────────────────────────────────────────────────────

describe('Banc d\'essai — le détecteur', () => {
  it('voit un effet qui agit', () => {
    const r = bench({ attributes: [attr('A_OK', 'start_of_combat', { type: 'stat_bonus', stat: 'atk', value: 5 })] });
    expect(r.rows[0].verdict).toBe('actif');
    expect(r.rows[0].observed).toContainEqual({ subject: 'P_A', detail: 'ATQ 10 → 15' });
  });

  it('voit un effet rangé sous la mauvaise horloge, et le DIT', () => {
    // La panne la plus fréquente du catalogue livré : la donnée est
    // impeccable, elle est simplement écrite sous un `timing` qui ne la
    // regarde pas. Rien dans l'admin ne l'annonce.
    const r = bench({ attributes: [attr('A_CLOCK', 'start_of_combat', { type: 'guaranteed_draw', tier: 3 })] });
    expect(r.rows[0].verdict).toBe('muet');
    expect(r.rows[0].note).toContain('n\'est lu qu\'en « end_of_combat »');
  });

  it('voit un type qui n\'existe pas pour son domaine', () => {
    const r = bench({ attributes: [attr('A_GHOST', 'start_of_combat', { type: 'heal', value: 10 })] });
    expect(r.rows[0].verdict).toBe('muet');
    expect(r.rows[0].note).toContain('n\'existe pas pour ce domaine');
  });

  it('voit une valeur laissée à zéro — et ne confond PAS un malus avec une absence', () => {
    const zero = bench({ attributes: [attr('A_ZERO', 'start_of_combat', { type: 'stat_bonus', stat: 'atk', value: 0 })] });
    expect(zero.rows[0].verdict).toBe('muet');
    expect(zero.rows[0].note).toContain('absente ou nulle');
    // ⚠️ L'autre sens, et c'est lui qui a failli passer : `-5` n'est pas `0`.
    // Sept effets livrés sont des malus ; les annoncer « valeur absente »
    // serait dire le contraire de ce qui se passe.
    const malus = bench({ attributes: [attr('A_MALUS', 'start_of_combat', { type: 'stat_bonus', stat: 'atk', value: -5 })] });
    expect(malus.rows[0].verdict).toBe('actif');
    expect(malus.rows[0].observed).toContainEqual({ subject: 'P_A', detail: 'ATQ 10 → 5' });
  });

  it('voit une échelle qui ne compte rien, et nomme l\'attribut en cause', () => {
    const r = bench({
      attributes: [attr('A_SCALE', 'start_of_combat',
        { type: 'stat_bonus', stat: 'atk', value: 5, value_per: 'ally:ARCH_INEXISTANT' })],
    });
    expect(r.rows[0].verdict).toBe('muet');
    expect(r.rows[0].note).toContain('ARCH_INEXISTANT');
  });

  it('voit un bonus INSCRIT que plus aucune stat ne relit', () => {
    // ⚠️ Le diagnostic le plus fin du banc, et il ne désigne PAS la donnée :
    // `Unit._recomputeStats` recopie `_base.movement_speed` sans jamais y
    // ajouter `_stat_bonuses.movement_speed`. L'effet est écrit, appliqué,
    // enregistré — et invisible. Même trou sur `initiative`.
    const r = bench({
      attributes: [attr('A_ORPHAN', 'start_of_combat', { type: 'stat_bonus', stat: 'movement_speed', value: -2 })],
    });
    expect(r.rows[0].verdict).toBe('muet');
    expect(r.rows[0].note).toContain('_stat_bonuses.movement_speed');
    expect(r.rows[0].note).toContain('aucune stat lue ne le reprend');
  });

  it('ne compte PAS un archétype sans seuil parmi les muets', () => {
    const r = bench({ attributes: [{ id: 'A_PUR', name: 'A_PUR', timing: 'none', thresholds: [] }] });
    expect(r.rows[0].verdict).toBe('descriptif');
    expect(r.counts.muet).toBe(0);
  });

  it('signale l\'archétype qui annonce un timing sans porter de seuil', () => {
    const r = bench({ attributes: [{ id: 'A_VIDE', name: 'A_VIDE', timing: 'end_of_combat', thresholds: [] }] });
    expect(r.rows[0].verdict).toBe('descriptif');
    expect(r.rows[0].note).toContain('aucun seuil');
  });

  it('isole CHAQUE effet d\'un seuil, pas seulement le seuil', () => {
    // ⚠️ C'est l'écart de maille avec `effect-behaviour`, et c'est la raison
    // d'être du banc : à la maille de l'attribut, un seuil dont un effet sur
    // deux fonctionne se lit « actif », et le muet ne se voit jamais.
    const r = bench({
      attributes: [{
        id: 'A_MIXTE', name: 'A_MIXTE', timing: 'start_of_combat',
        thresholds: [{
          count: 2,
          effects: [
            { type: 'stat_bonus', stat: 'atk', value: 5 },
            { type: 'guaranteed_draw', tier: 3 },
          ],
        }],
      }],
    });
    expect(r.rows.map(x => x.verdict)).toEqual(['actif', 'muet']);
    expect(r.rows.map(x => x.where)).toEqual(['seuil 2 · effet 1/2', 'seuil 2 · effet 2/2']);
  });

  it('mesure ce qu\'une magie FAIT, jamais ce qu\'elle coûte', () => {
    // ⚠️ Une magie sans effet mais avec un contrecoup ferait bouger les PV du
    // joueur : comptée, elle passerait pour active. Le coût est relevé à part.
    const r = bench({ magies: [{ id: 'M_COUT', name: 'M_COUT', cost_hp: 40, effect: null }] });
    expect(r.rows[0].verdict).toBe('descriptif');
    expect(r.rows[0].cost_hp).toBe(40);
    expect(r.rows[0].observed).toEqual([]);
  });

  it('voit les magies déléguées à GameSession, qui sont des no-op dans applyEffect', () => {
    // ⚠️ Sans la scène des zones, ces onze-là seraient toutes déclarées muettes
    // — le pire faux positif possible, puisqu'il porterait sur les magies les
    // plus élaborées du jeu. Et la liste des onze n'est écrite nulle part : le
    // banc rejoue chaque magie et regarde ce qui a bougé.
    const r = bench({
      magies: [
        { id: 'M_DUP', name: 'M_DUP', effect: { type: 'duplicate_unit', value: 1 } },
        { id: 'M_DRAIN', name: 'M_DRAIN', effect: { type: 'drain_life' } },
      ],
    });
    expect(r.rows.map(x => x.verdict)).toEqual(['actif', 'actif']);
    expect(r.rows[0].observed).toContainEqual({ subject: 'main', detail: '+T2_FUSION' });
    expect(r.rows[1].observed).toContainEqual({ subject: 'cimetière', detail: '+T2_FUSION' });
  });
});

// ── 2. La table des horloges, prouvée contre le moteur ───────────────────────

describe('Banc d\'essai — quelle horloge lit quel effet', () => {
  const TIMINGS = ['start_of_combat', 'during_combat', 'end_of_combat'];

  /** Un effet VALIDE de chaque type d'attribut — de quoi le voir agir. */
  const SAMPLE: Record<string, any> = {
    stat_bonus: { type: 'stat_bonus', stat: 'atk', value: 5 },
    shield: { type: 'shield', value: 50 },
    effect_immunity: { type: 'effect_immunity' },
    stat_modifier: { type: 'stat_modifier', stat: 'atk', trigger: 'on_ally_neutralized', value: 2 },
    revive: { type: 'revive', hp_percent: 50 },
    draw_bonus: { type: 'draw_bonus', value: 2 },
    guaranteed_draw: { type: 'guaranteed_draw', tier: 3 },
    board_slot_bonus: { type: 'board_slot_bonus', value: 1 },
    damage_multiplier_bonus: { type: 'damage_multiplier_bonus', value: 1 },
    shopping_bonus: { type: 'shopping_bonus', value: 1 },
  };

  it('la table couvre exactement les types d\'attribut du registre', () => {
    // Un type absent de la table ne reçoit aucun diagnostic d'horloge : il
    // serait déclaré muet sans qu'on dise pourquoi, ce qui est la moitié de
    // l'information. Un type en trop désignerait une horloge qui n'existe pas.
    expect(Object.keys(ATTRIBUTE_TIMINGS).sort()).toEqual([...kindsFor('attribute')].sort());
    expect(Object.keys(SAMPLE).sort()).toEqual([...kindsFor('attribute')].sort());
  });

  // ⚠️ La table n'est pas prouvée sur parole : chaque type est joué sous les
  // TROIS horloges et doit n'agir que sous la sienne. C'est le seul filet
  // contre une dérive d'`AttributeManager`, dont les trois passes se partagent
  // les types sans qu'aucune ne l'écrive.
  for (const [type, expected] of Object.entries(ATTRIBUTE_TIMINGS)) {
    it(`« ${type} » n'agit que sous « ${expected} »`, () => {
      const verdicts = TIMINGS.map(timing =>
        bench({ attributes: [attr(`A_${type}`, timing, SAMPLE[type], 3)] }).rows[0].verdict);
      expect(verdicts).toEqual(TIMINGS.map(t => (t === expected ? 'actif' : 'muet')));
    });
  }
});

// ── 3. Le catalogue livré ────────────────────────────────────────────────────

describe('Banc d\'essai — le catalogue livré', () => {
  const report = runEffectBench({
    attributes: load('attributes.json'),
    boards: load('boards.json'),
    magies: load('magies.json'),
  });

  it('couvre tout le catalogue — sinon le reste passerait à vide', () => {
    expect(report.byDomain.attribute.total).toBeGreaterThan(120);
    expect(report.byDomain.board.total).toBeGreaterThan(30);
    expect(report.byDomain.magie.total).toBeGreaterThan(45);
    for (const row of report.rows) {
      expect(row.key, 'chaque ligne porte une clé').toBeTruthy();
      expect(row.label, `${row.key} n'a pas de libellé`).toBeTruthy();
    }
    // Les clés servent d'identité à l'écran : deux lignes homonymes s'y
    // écraseraient l'une l'autre.
    expect(new Set(report.rows.map(r => r.key)).size).toBe(report.rows.length);
  });

  it('la grande majorité des effets livrés AGIT', () => {
    // Le pendant du filet ci-dessous : un banc qui déclarerait tout muet
    // passerait la liste figée en la remplissant, et ne servirait plus à rien.
    expect(report.counts.actif).toBeGreaterThan(140);
  });

  /**
   * ⚠️ **UN INVENTAIRE À VIDER, PAS UNE LISTE DE FAUTES ACCEPTÉES.**
   *
   * Chaque ligne est un effet écrit dans le catalogue que le jeu n'applique
   * pas. Deux familles, et elles ne se corrigent pas au même endroit :
   *
   *  - **mauvaise horloge** (`ARCH_010`, `ARCH_017`, `ARCH_036`, `ARCH_042`,
   *    `ARCH_043`, `ARCH_045`, `ARCH_068`) — la DONNÉE est à déplacer : le
   *    `timing` vit sur l'attribut, pas sur l'effet.
   *  - **stat inscrite jamais relue** (`ARCH_021`, `ARCH_035`, `BOARD_008`,
   *    `BOARD_009`, `BOARD_010`, `BOARD_025`) — le MOTEUR est à compléter :
   *    `Unit._recomputeStats` recopie `_base.movement_speed` sans y ajouter
   *    `_stat_bonuses.movement_speed`. Même trou sur `initiative`.
   *
   * Corriger l'un ou l'autre fait rougir ce test : c'est le but. On retire la
   * ligne de la liste, on ne regénère jamais l'ensemble.
   */
  it('la liste des effets muets du catalogue est celle qu\'on connaît', () => {
    expect(muteRows(report).map(r => `${r.entity_id} ${r.where} · ${r.type}`)).toEqual([
      'ARCH_010 seuil 3 · stat_bonus',
      'ARCH_017 seuil 3 · damage_multiplier_bonus',
      'ARCH_021 seuil 2 · stat_bonus',
      'ARCH_021 seuil 3 · stat_bonus',
      'ARCH_035 seuil 2 · stat_bonus',
      'ARCH_035 seuil 3 · stat_bonus',
      'ARCH_035 seuil 4 · stat_bonus',
      'ARCH_035 seuil 5 · stat_bonus',
      'ARCH_036 seuil 3 · guaranteed_draw',
      'ARCH_042 seuil 1 · guaranteed_draw',
      'ARCH_042 seuil 2 · guaranteed_draw',
      'ARCH_043 seuil 3 · stat_modifier',
      'ARCH_045 seuil 2 · stat_modifier',
      'ARCH_045 seuil 3 · stat_modifier',
      'ARCH_045 seuil 4 · stat_modifier',
      'ARCH_068 seuil 2 · effet 1/2 · guaranteed_draw',
      'ARCH_068 seuil 2 · effet 2/2 · guaranteed_draw',
      'BOARD_008  · stat_bonus',
      'BOARD_009  · stat_bonus',
      'BOARD_010  · stat_bonus',
      'BOARD_025 effet 3/6 · stat_bonus',
    ]);
  });

  it('aucune magie livrée n\'est muette', () => {
    // Les 51 passent, contrecoup retiré et scène des zones comprise. C'est le
    // domaine le plus riche des trois et le seul entièrement propre.
    expect(muteRows(report).filter(r => r.domain === 'magie')).toEqual([]);
  });

  it('chaque muet porte un diagnostic — un « il ne se passe rien » nu ne sert personne', () => {
    for (const row of muteRows(report)) {
      expect(row.note, `${row.key} est muet sans raison donnée`).toBeTruthy();
    }
  });
});
