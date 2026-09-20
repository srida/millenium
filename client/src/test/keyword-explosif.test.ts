/* eslint-disable @typescript-eslint/no-explicit-any */
// EXPLOSIF — le porteur emporte une unité adverse en tombant.
//
// ⚠️ Comme Tour, il est DATA-DRIVEN : un seul effet `destroy_enemy` sur un palier
// à 1, compilé et appliqué par le moteur générique. Ce que ce fichier éprouve,
// c'est ce que le moteur de COMBAT en fait — la seule partie qui a demandé du
// code : un `quand` de plus (`porteur_detruit`), un tri déterministe, et une
// cascade de morts qui doit se résoudre dans le MÊME ordre sur les deux clients
// d'un duel.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttributeManager } from '../logic/AttributeManager.js';
import { CombatManager } from '../logic/CombatManager.js';
import { compileAttributes } from '../logic/effects/compile.js';
import { executer } from '../logic/effects/engine.js';
import { VFX_EXPLOSIF } from '../logic/effects/types.js';
import { makeCard, spawn, makeBoard } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const attributs: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));
const cartes: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/cards.json'), 'utf8'));

/** L'attribut Explosif, tel qu'il est LIVRÉ — jamais une copie écrite ici. */
const EXPLOSIF = attributs.find(a => a.name === 'Explosif');

/** Un catalogue minimal : Explosif, plus un archétype neutre. */
const CATALOGUE = [EXPLOSIF, { id: 'NEUTRE', name: 'Neutre', categorie: 'Archetype', timing: 'none', thresholds: [] }];

function armer(playerUnits: any[], enemyUnits: any[]) {
  const mgr = new (AttributeManager as any)(CATALOGUE, playerUnits, enemyUnits);
  // ⚠️ C'est `applyStartOfCombat` qui VERROUILLE les seuils, et le porteur mort
  // ne compterait plus dans le sien : sans cet appel, aucune explosion ne part.
  mgr.applyStartOfCombat();
  return mgr;
}

/**
 * Une carte volontairement molle et lente.
 *
 * ⚠️ `attack_rate: 0` et `movement_rate: 0` sont le compteur le plus LENT de
 * l'échelle (77 ticks), pas « désactivé » : c'est ce qui garde les positions
 * fixes le temps du cas. Chaque unité qui doit AGIR porte donc son 100 en clair.
 */
function carte(id: string, attrs: string[] = [], stats: any = {}) {
  return makeCard({ id, attributes: attrs, stats: { atk: 1, hp: 500, range: 1, attack_rate: 0, movement_rate: 0, ...stats } });
}

/** Un combat qu'on avance pas à pas, en gardant les événements de chaque step. */
function partie(board: any, playerUnits: any[], enemyUnits: any[], mgr: any) {
  const combat = new (CombatManager as any)(board, playerUnits, enemyUnits, mgr);
  const steps: any[][] = [];
  const jouer = (n: number) => {
    for (let i = 0; i < n && !combat.isOver; i++) steps.push(combat.step());
    return steps.flat();
  };
  return { combat, steps, jouer };
}

describe('Explosif — la donnée livrée', () => {
  it('existe, en catégorie MotCle, et porte son unique effet sur un palier à 1', () => {
    expect(EXPLOSIF, 'attribut « Explosif » absent du catalogue').toBeTruthy();
    expect(EXPLOSIF.categorie).toBe('MotCle');
    expect(EXPLOSIF.thresholds).toHaveLength(1);
    expect(EXPLOSIF.thresholds[0].count).toBe(1);
    expect(EXPLOSIF.thresholds[0].effects.map((e: any) => e.type)).toEqual(['destroy_enemy']);
  });

  // ⚠️ `on_self_neutralized` et rien d'autre : sous n'importe quel autre timing,
  // `compileAttribute` refuse en « timing incohérent » — l'effet serait muet et
  // rien à l'écran ne le dirait.
  it('son timing est celui de sa propre mort', () => {
    expect(EXPLOSIF.timing).toBe('on_self_neutralized');
  });

  it('au moins une carte le porte', () => {
    const porteuses = cartes.filter(c => (c.attributes ?? []).includes(EXPLOSIF.id));
    expect(porteuses.length).toBeGreaterThan(0);
  });
});

describe('Explosif — ce que le compilateur en fait', () => {
  it('un seul effet, au moment de la mort du porteur, avec sa clé visuelle', () => {
    const { effets, refus } = compileAttributes(CATALOGUE, new Set(CATALOGUE.map((a: any) => a.id)));
    expect(refus).toEqual([]);
    expect(effets).toHaveLength(1);
    const [e] = effets as any[];
    expect(e.trigger.quand).toBe('porteur_detruit');
    expect(e.condition).toEqual({ attribut: EXPLOSIF.id, minimum: 1 });
    // ⚠️ La clé VISUELLE, jamais l'id de l'attribut : `three/` n'importe pas
    // `data/` et ne saurait pas le résoudre (cf. `VFX_EXPLOSIF`).
    expect(e.vfx).toBe(VFX_EXPLOSIF);
    expect(e.taches).toEqual([{
      action: 'deplacer',
      cible: { conteneur: 'board', camp: 'ennemi', combien: 'un', tri: 'proche_du_declencheur' },
      destination: 'cimetiere',
    }]);
  });

  /**
   * Le corps va au cimetière de SON camp.
   *
   * ⚠️ En combat les deux tableaux passés au moteur sont JETABLES
   * (`finishCombat` reconstruit les cimetières depuis `is_neutralized`), donc ce
   * routage ne s'observe QUE sur le moteur — et c'est bien là qu'il vit :
   * `deplacer board→cimetière` sur un `camp: 'ennemi'` n'existait pas avant
   * Explosif, et répondre « le cimetière du joueur » serait faux pour tout
   * appelant qui passerait de vrais cimetières.
   * Mutation : router les deux vers `cimetiere` → ROUGE.
   */
  it('le moteur envoie la victime dans le cimetière de son propre camp', () => {
    const { effets } = compileAttributes(CATALOGUE, new Set(CATALOGUE.map((a: any) => a.id)));
    const board = makeBoard();
    const porteur = spawn(board, carte('EXPLO', [EXPLOSIF.id]) as any, 'player', { col: 2, row: 3 });
    const victime = spawn(board, carte('CIBLE', ['NEUTRE']) as any, 'enemy', { col: 2, row: 4 });
    const cimetiereJoueur: any[] = [];
    const cimetiereAdverse: any[] = [];

    executer(effets, 'porteur_detruit', {
      unitesAlliees: [porteur], unitesEnnemies: [victime],
      ressources: { pioches: 0, garanties: [], slots: 0, multiplicateur: 0, shopping: 0, reanimees: [], sources: [] } as any,
      neutralisees: cimetiereJoueur,
      neutraliseesEnnemies: cimetiereAdverse,
      declencheur: porteur,
    } as any);

    expect(victime.is_neutralized).toBe(true);
    expect(cimetiereAdverse.map((u: any) => u.card_id)).toEqual(['CIBLE']);
    expect(cimetiereJoueur).toEqual([]);
  });
});

describe('Explosif — en combat', () => {
  /**
   * Un porteur d'un PV, le tueur juste à côté, et une seconde unité adverse
   * plus loin.
   *
   * ⚠️ **L'ordre du tableau met le LOINTAIN en premier**, et c'est toute la
   * raison d'être du cas : sans tri, `combien: 'un'` prend le premier élément du
   * tableau — donc l'unité la plus éloignée, et surtout une unité qui n'est pas
   * la même sur les deux clients d'un duel.
   */
  function scene(attrsPorteur: string[]) {
    const board = makeBoard();
    const explo = spawn(board, carte('EXPLO', attrsPorteur, { hp: 1 }) as any, 'player', { col: 2, row: 3 });
    const tueur = spawn(board, carte('TUEUR', ['NEUTRE'], { atk: 100, hp: 9999, attack_rate: 100 }) as any, 'enemy', { col: 2, row: 4 });
    const loin = spawn(board, carte('LOIN', ['NEUTRE'], { hp: 9999 }) as any, 'enemy', { col: 4, row: 10 });
    const enemyUnits = [loin, tueur];
    return { board, explo, tueur, loin, enemyUnits, mgr: armer([explo], enemyUnits) };
  }

  // Mutation : retirer `tri` du sélecteur compilé → ROUGE (c'est `LOIN` qui tombe).
  it('emporte l\'unité adverse la PLUS PROCHE, pas la première du tableau', () => {
    const { explo, tueur, loin, enemyUnits, board, mgr } = scene([EXPLOSIF.id]);
    const { jouer } = partie(board, [explo], enemyUnits, mgr);
    jouer(6);

    expect(explo.is_neutralized, 'le porteur doit être tombé — sinon le cas ne prouve rien').toBe(true);
    expect(tueur.is_neutralized).toBe(true);
    expect(loin.is_neutralized).toBe(false);
    expect(board.getUnit({ col: 2, row: 4 })).toBeNull();
  });

  // Le témoin : sans le mot-clé, la même mort n'emporte personne.
  it('une unité ORDINAIRE qui meurt n\'emporte personne', () => {
    const { explo, tueur, loin, enemyUnits, board, mgr } = scene(['NEUTRE']);
    const { jouer } = partie(board, [explo], enemyUnits, mgr);
    jouer(6);

    expect(explo.is_neutralized).toBe(true);
    expect(tueur.is_neutralized).toBe(false);
    expect(loin.is_neutralized).toBe(false);
  });

  // ⚠️ Un événement À PART, jamais `power` : `GameController` compte un
  // `power_triggered` de mission sur chaque `power`, et un mot-clé n'en est pas
  // un. Il porte la clé VISUELLE, jamais l'id de l'attribut.
  it('émet un événement `keyword` portant la clé visuelle et sa victime', () => {
    const { explo, enemyUnits, board, mgr } = scene([EXPLOSIF.id]);
    const { jouer } = partie(board, [explo], enemyUnits, mgr);
    const evts = jouer(6);

    const kw = evts.filter(e => e.type === 'keyword');
    expect(kw).toHaveLength(1);
    expect(kw[0].vfx).toBe(VFX_EXPLOSIF);
    expect(kw[0].unit).toBe(explo);
    expect(kw[0].targets.map((u: any) => u.card_id)).toEqual(['TUEUR']);
    expect(evts.some(e => e.type === 'power')).toBe(false);
  });

  // ⚠️ L'explosion se VOIT même sans victime : c'est le porteur qui explose.
  it('explose sans victime quand il ne reste personne à emporter', () => {
    const board = makeBoard();
    const explo = spawn(board, carte('EXPLO', [EXPLOSIF.id], { hp: 1 }) as any, 'player', { col: 2, row: 3 });
    const mgr = armer([explo], []);
    explo.is_neutralized = true;
    const evts = mgr.onBearerNeutralized(explo, [explo], []);

    expect(evts.filter((e: any) => e.type === 'keyword')).toEqual([
      { type: 'keyword', unit: explo, vfx: VFX_EXPLOSIF, targets: [] },
    ]);
  });

  /**
   * ⚠️ **L'immunité ne protège pas**, et c'est une décision de design :
   * `effect_immunity` annule les POUVOIRS de debuff, là où l'explosion est une
   * destruction franche. Le moteur ne consulte `is_effect_immune` nulle part
   * dans `deplacer` — ce test est ce qui interdit de l'y ajouter par réflexe.
   * Mutation : filtrer les immunisés dans `resoudre` → ROUGE.
   */
  it('une cible immunisée aux effets tombe quand même', () => {
    const { explo, tueur, enemyUnits, board, mgr } = scene([EXPLOSIF.id]);
    tueur.is_effect_immune = true;
    const { jouer } = partie(board, [explo], enemyUnits, mgr);
    jouer(6);

    expect(tueur.is_neutralized).toBe(true);
  });

  /**
   * LA CASCADE — le cas qui éprouve la boucle de `_checkDeaths`.
   *
   * ⚠️ La victime de l'explosion est placée AVANT l'explosif dans le balayage
   * (`_frameOrderedUnits` rend le camp joueur d'abord, et c'est un joueur qui
   * tombe sous l'explosion d'un ennemi) : une passe unique l'aurait donc DÉJÀ
   * dépassée, et sa mort n'aurait été vue qu'au tick suivant — un tick pendant
   * lequel elle reste sur le plateau, neutralisée mais occupant sa case.
   * Mutation : revenir à une passe unique → ROUGE (la mort de `TUEUR_P` manque
   * au step de l'explosion).
   */
  it('une mort provoquée par l\'explosion est vue DANS LE MÊME step', () => {
    const board = makeBoard();
    // Le joueur tue l'explosif adverse, et se trouve être sa plus proche cible.
    const tueurP = spawn(board, carte('TUEUR_P', ['NEUTRE'], { atk: 100, hp: 9999, attack_rate: 100 }) as any, 'player', { col: 2, row: 3 });
    const temoinP = spawn(board, carte('TEMOIN_P', ['NEUTRE'], { hp: 9999 }) as any, 'player', { col: 2, row: 2 });
    const exploE = spawn(board, carte('EXPLO_E', [EXPLOSIF.id], { hp: 1 }) as any, 'enemy', { col: 2, row: 4 });

    const player = [tueurP, temoinP];
    const mgr = armer(player, [exploE]);
    const { steps, jouer } = partie(board, player, [exploE], mgr);
    jouer(6);

    const stepExplosion = steps.find(evts => evts.some(e => e.type === 'keyword'));
    expect(stepExplosion, 'aucune explosion — le cas ne prouve rien').toBeTruthy();
    const morts = stepExplosion!.filter(e => e.type === 'death').map(e => e.unit.card_id);
    expect(morts).toEqual(['EXPLO_E', 'TUEUR_P']);
    // La victime est bien le plus proche : (2,3) est à 1 de (2,4), (2,2) à 2.
    expect(temoinP.is_neutralized).toBe(false);
  });

  /**
   * Le pire report, et celui qui se VOIT : quand l'explosion finit le combat.
   *
   * ⚠️ `_checkEnd` suit immédiatement le balayage. Avec une passe unique, la
   * victime — seule unité de son camp — est neutralisée sans que son `death`
   * soit parti, le combat se clôt là, et il n'y aura pas de tick suivant pour
   * rattraper : sa carte reste posée sur le plateau tout le round, exactement le
   * FANTÔME que `revealEnemyUnits` existe pour éviter ailleurs.
   * Mutation : revenir à une passe unique → ROUGE.
   */
  it('une explosion qui FINIT le combat émet quand même la mort de sa victime', () => {
    const board = makeBoard();
    const tueurP = spawn(board, carte('TUEUR_P', ['NEUTRE'], { atk: 100, hp: 9999, attack_rate: 100 }) as any, 'player', { col: 2, row: 3 });
    const exploE = spawn(board, carte('EXPLO_E', [EXPLOSIF.id], { hp: 1 }) as any, 'enemy', { col: 2, row: 4 });

    const { combat, jouer } = partie(board, [tueurP], [exploE], armer([tueurP], [exploE]));
    const evts = jouer(6);

    expect(combat.isOver).toBe(true);
    expect(tueurP.is_neutralized).toBe(true);
    expect(evts.filter(e => e.type === 'death').map(e => e.unit.card_id)).toEqual(['EXPLO_E', 'TUEUR_P']);
    // Et la case est bien rendue : un fantôme occuperait encore la sienne.
    expect(board.getUnit({ col: 2, row: 3 })).toBeNull();
  });

  /**
   * La TERMINAISON de la cascade, sur le cas qui pourrait la faire boucler :
   * deux Explosifs qui s'emportent l'un l'autre.
   *
   * ⚠️ Ce n'est pas un test de régression sur un garde neuf — c'est
   * `_deathEmitted` (qui préexiste) qui rend une unité traitée inéligible, donc
   * borne la chaîne à une explosion par unité. Ce cas CONSTATE que la boucle de
   * cascade ne rouvre rien : elle rendra toujours deux morts et deux explosions,
   * jamais quatre, jamais un `MAX_PASSES` atteint.
   */
  it('deux Explosifs qui s\'emportent l\'un l\'autre terminent le combat', () => {
    const board = makeBoard();
    const exploP = spawn(board, carte('EXPLO_P', [EXPLOSIF.id], { atk: 100, hp: 1, attack_rate: 100 }) as any, 'player', { col: 2, row: 3 });
    const exploE = spawn(board, carte('EXPLO_E', [EXPLOSIF.id], { atk: 100, hp: 1, attack_rate: 100 }) as any, 'enemy', { col: 2, row: 4 });

    const { combat, jouer } = partie(board, [exploP], [exploE], armer([exploP], [exploE]));
    const evts = jouer(20);

    expect(exploP.is_neutralized).toBe(true);
    expect(exploE.is_neutralized).toBe(true);
    expect(combat.isOver).toBe(true);
    // Chacun n'explose qu'une fois, quoi qu'il arrive.
    expect(evts.filter(e => e.type === 'keyword')).toHaveLength(2);
    expect(evts.filter(e => e.type === 'death')).toHaveLength(2);
  });
});
