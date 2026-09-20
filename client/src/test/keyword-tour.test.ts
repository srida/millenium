/* eslint-disable @typescript-eslint/no-explicit-any */
// TOUR — le mot-clé qui ne bouge pas, et que rien ne bouge.
//
// ⚠️ Il est entièrement DATA-DRIVEN : un `stat_bonus range` et un `immobile`,
// deux effets sur un palier à 1, compilés et appliqués comme n'importe quel
// archétype. Ce fichier n'éprouve donc pas une traduction (c'est le travail
// d'`effect-schema.test.ts`) mais ce que le moteur de COMBAT en fait — la seule
// partie qui a demandé du code.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttributeManager } from '../logic/AttributeManager.js';
import { CombatManager } from '../logic/CombatManager.js';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { makeCard, spawn, makeBoard, runCombat } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const attributs: any[] = JSON.parse(readFileSync(path.join(ROOT, 'initial-data/attributes.json'), 'utf8'));

/** L'attribut Tour, tel qu'il est LIVRÉ — jamais une copie écrite ici. */
const TOUR = attributs.find(a => a.name === 'Tour');

/** Un catalogue minimal : Tour, plus un archétype neutre. */
const CATALOGUE = [TOUR, { id: 'NEUTRE', name: 'Neutre', categorie: 'Archetype', timing: 'none', thresholds: [] }];

function armer(board: any, playerUnits: any[], enemyUnits: any[]) {
  const mgr = new (AttributeManager as any)(CATALOGUE, playerUnits, enemyUnits);
  mgr.applyStartOfCombat();
  return mgr;
}

/** Une unité lente et molle, pour que seule l'immobilité se lise. */
function carte(id: string, attrs: string[] = [], stats: any = {}) {
  return makeCard({ id, attributes: attrs, stats: { atk: 1, hp: 500, range: 1, attack_rate: 0, movement_rate: 100, ...stats } });
}

describe('Tour — la donnée livrée', () => {
  it('existe, en catégorie MotCle, et porte ses DEUX effets sur un palier à 1', () => {
    expect(TOUR, 'attribut « Tour » absent du catalogue').toBeTruthy();
    expect(TOUR.categorie).toBe('MotCle');
    expect(TOUR.thresholds).toHaveLength(1);
    expect(TOUR.thresholds[0].count).toBe(1);
    expect(TOUR.thresholds[0].effects.map((e: any) => e.type).sort()).toEqual(['immobile', 'stat_bonus']);
  });

  // ⚠️ La portée doit couvrir le plateau : la Manhattan maximale d'un 5×11 est
  // 4 + 10 = 14. En dessous, « portée maximale » serait un chiffre qui ment.
  it('sa portée couvre tout le plateau', () => {
    const bonus = TOUR.thresholds[0].effects.find((e: any) => e.type === 'stat_bonus');
    expect(bonus.stat).toBe('range');
    expect(bonus.value).toBeGreaterThanOrEqual(14);
  });
});

describe('Tour — elle ne se déplace pas', () => {
  it('le début de combat pose l\'immobilité et la portée sur le seul porteur', () => {
    const board = makeBoard();
    const tour = spawn(board, carte('TOUR', [TOUR.id]) as any, 'player', { col: 0, row: 0 });
    const autre = spawn(board, carte('AUTRE', ['NEUTRE']) as any, 'player', { col: 1, row: 0 });
    const ennemi = spawn(board, carte('E', ['NEUTRE']) as any, 'enemy', { col: 0, row: 10 });

    armer(board, [tour, autre], [ennemi]);

    expect(tour.is_immobile).toBe(true);
    expect(tour.range).toBeGreaterThanOrEqual(14);
    expect(autre.is_immobile).toBe(false);
    expect(autre.range).toBe(1);
  });

  /**
   * Le scénario qui MORD — et il a fallu le chercher.
   *
   * ⚠️ Une Tour à portée du plateau entier n'a **jamais** besoin de bouger :
   * `canAttack` est vrai dès le premier tick, la boucle sort par `break` et
   * aucun pas n'est tenté. Un cas monté comme ça reste VERT avec le garde
   * retiré — il constate la portée, pas l'immobilité (vérifié).
   *
   * Ce qui fait marcher une unité malgré une portée infinie, c'est la LIGNE DE
   * VUE : un mur entre les deux et `canAttack` redevient faux, donc la Tour
   * chercherait à contourner. C'est aussi le vrai cas de jeu — une Tour derrière
   * un mur doit rester plantée, pas faire le tour du plateau.
   */
  function derriereUnMur() {
    const board = makeBoard();
    // Un mur qui ferme les colonnes 0 à 3 : la seule route passe par la 4.
    board.setBlockedCells([0, 1, 2, 3].map(col => ({ col, row: 5 })));
    const tour = spawn(board, carte('TOUR', [TOUR.id]) as any, 'player', { col: 0, row: 0 });
    const jumeau = spawn(board, carte('JUMEAU', ['NEUTRE']) as any, 'player', { col: 1, row: 0 });
    const ennemi = spawn(board, carte('E', ['NEUTRE'], { atk: 1, hp: 9999, movement_rate: 0 }) as any, 'enemy', { col: 0, row: 10 });
    return { board, tour, jumeau, ennemi, mgr: armer(board, [tour, jumeau], [ennemi]) };
  }

  // Mutation : retirer le `continue` de la phase 3 → ROUGE (vérifié).
  it('sans ligne de vue, elle reste plant\'ee là où son jumeau contourne', () => {
    const { board, tour, jumeau, ennemi, mgr } = derriereUnMur();
    const { events } = runCombat(board, [tour, jumeau], [ennemi], mgr, 60);

    // ⚠️ `runCombat` sérialise les unités en `camp:card_id` (`refUnit`) : jamais
    // l'objet, jamais l'`uid`.
    const bouges = new Set(events.filter(e => e.type === 'move').map(e => e.unit));
    expect(bouges.has('player:JUMEAU'), 'le jumeau mobile doit contourner — sinon le cas ne prouve rien').toBe(true);
    expect(bouges.has('player:TOUR')).toBe(false);
    expect(tour.position).toEqual({ col: 0, row: 0 });
  });

  // ⚠️ L'horloge ne tourne pas non plus : un compteur qui avance dans le vide
  // déclencherait le pas à l'instant où l'immobilité tomberait.
  it('son horloge de déplacement n\'avance même pas', () => {
    const { board, tour, jumeau, ennemi, mgr } = derriereUnMur();
    runCombat(board, [tour, jumeau], [ennemi], mgr, 30);

    expect(tour.move_timer).toBe(0);
  });

  // ⚠️ Elle TIRE, elle ne fait pas que rester plantée : sans la portée, le
  // mot-clé ne serait qu'un handicap.
  it('elle attaque d\'un bout à l\'autre du plateau sans bouger', () => {
    const board = makeBoard();
    // ⚠️ `attack_rate: 100` : le défaut de ce fixture est 0, c'est-à-dire le
    // rythme le plus LENT de l'échelle (77 ticks) — la Tour n'aurait pas frappé
    // une fois dans la fenêtre, et le cas aurait constaté l'inverse de ce qu'il
    // teste. Le piège de `clampRate(0)`, en petit.
    const tour = spawn(board, carte('TOUR', [TOUR.id], { atk: 50, attack_rate: 100 }) as any, 'player', { col: 0, row: 0 });
    // Manhattan (0,0) → (4,10) = 14, la distance maximale du plateau.
    const ennemi = spawn(board, carte('E', ['NEUTRE'], { atk: 1, hp: 9999, movement_rate: 0 }) as any, 'enemy', { col: 4, row: 10 });

    const mgr = armer(board, [tour], [ennemi]);
    const { events } = runCombat(board, [tour], [ennemi], mgr, 40);

    expect(events.some(e => e.type === 'attack' && e.attacker === 'player:TOUR')).toBe(true);
    expect(tour.position).toEqual({ col: 0, row: 0 });
  });
});

describe('Tour — rien ne la déplace', () => {
  /**
   * Un combat où `lanceur` a le pouvoir donné, jauge pleine, face à une cible
   * qui ne peut pas marcher.
   *
   * ⚠️ **Les deux réglages sont la condition d'existence du cas**, et chacun a
   * d'abord manqué :
   *   • `attack_rate: 100` sur le lanceur — le défaut du fixture est 0, donc 77
   *     ticks, donc la phase d'attaque (où les pouvoirs partent) ne tourne pas
   *     une fois dans la fenêtre : le pouvoir ne partait JAMAIS et le cas restait
   *     vert avec le garde retiré ;
   *   • `movement_rate: 0` sur la cible — sinon elle MARCHE, sa case change, et
   *     le cas témoin passait au vert en mesurant un déplacement qui n'était pas
   *     une poussée.
   */
  function avecPouvoir(powerId: string, cibleAttrs: string[]) {
    const board = makeBoard();
    const lanceur = spawn(board, carte('LANCEUR', ['NEUTRE'], { atk: 1, hp: 9999, range: 3, attack_rate: 100 }) as any, 'player', { col: 2, row: 3 });
    const cible = spawn(board, carte('CIBLE', cibleAttrs, { atk: 1, hp: 9999, movement_rate: 0 }) as any, 'enemy', { col: 2, row: 5 });
    lanceur.power_id = powerId;
    lanceur.power_rate = 100;
    const mgr = armer(board, [lanceur], [cible]);
    const combat = new (CombatManager as any)(board, [lanceur], [cible], mgr);
    // ⚠️ On collecte les ÉVÉNEMENTS, pas la jauge : elle se recharge en deux
    // ticks, donc « pleine à la fin » est vrai que le pouvoir soit parti ou non.
    // Un `power` émis, ou aucun, est le seul signal qui ne dépend pas du moment
    // où l'on regarde.
    const jouer = (n: number) => { const evts: any[] = []; for (let i = 0; i < n; i++) evts.push(...combat.step()); return evts; };
    return { board, lanceur, cible, combat, jouer };
  }

  for (const pouvoir of ['POWER_PUSH', 'POWER_FREEZE']) {
    // Mutation : retirer le refus de `_canPush` → ROUGE (vérifié).
    it(`${pouvoir} ne la pousse pas, et le lanceur GARDE sa jauge`, () => {
      const { cible, jouer } = avecPouvoir(pouvoir, [TOUR.id]);
      const depart = { ...cible.position };
      const evts = jouer(8);

      expect(cible.position).toEqual(depart);
      // ⚠️ Le pouvoir n'est même pas PARTI : le refus vit dans `_canPush`, donc
      // `_isPowerRelevant` répond non avant le tir. Le lanceur frappe
      // normalement et garde sa charge pour une cible qui, elle, bouge.
      expect(evts.filter(e => e.type === 'power')).toEqual([]);
    });

    it(`${pouvoir} pousse bien une cible ORDINAIRE — sinon le cas ne prouve rien`, () => {
      const { cible, jouer } = avecPouvoir(pouvoir, ['NEUTRE']);
      const depart = { ...cible.position };
      const evts = jouer(8);

      expect(cible.position).not.toEqual(depart);
      expect(evts.some(e => e.type === 'power' && e.power_id === pouvoir)).toBe(true);
    });
  }

  /** Le porteur du téléport, face à un ennemi à l'autre bout du plateau. */
  function avecTeleport(attrs: string[]) {
    const board = makeBoard();
    const porteur = spawn(board, carte('PORTEUR', attrs, { atk: 1, attack_rate: 100 }) as any, 'player', { col: 0, row: 0 });
    const ennemi = spawn(board, carte('E', ['NEUTRE'], { atk: 1, hp: 9999, movement_rate: 0 }) as any, 'enemy', { col: 4, row: 10 });
    porteur.power_id = 'POWER_TELEPORT';
    porteur.power_rate = 100;
    const mgr = armer(board, [porteur], [ennemi]);
    const combat = new (CombatManager as any)(board, [porteur], [ennemi], mgr);
    return { porteur, combat };
  }

  // Mutation : retirer le refus de `_teleportPlan` → ROUGE (vérifié).
  it('une Tour ne se téléporte pas non plus', () => {
    const { porteur, combat } = avecTeleport([TOUR.id]);
    for (let i = 0; i < 8; i++) combat.step();
    expect(porteur.position).toEqual({ col: 0, row: 0 });
  });

  it('une unité ORDINAIRE se téléporte bien — sinon le cas ne prouve rien', () => {
    const { porteur, combat } = avecTeleport(['NEUTRE']);
    for (let i = 0; i < 8; i++) combat.step();
    expect(porteur.position).not.toEqual({ col: 0, row: 0 });
  });
});

describe('Tour — l\'immobilité survit à la dissipation', () => {
  // ⚠️ `POWER_DEBUFF` appelle `resetCombatStats()` EN PLEIN COMBAT, et
  // `reapplyBonuses` ne rejoue que les STATS. Si l'immobilité vivait dans ce
  // balayage, une Tour dissipée deviendrait un tireur longue portée MOBILE —
  // l'exact contraire de ce que la dissipation fait.
  // Mutation : remettre `is_immobile = false` dans `resetCombatStats` → ROUGE.
  it('resetCombatStats ne rend pas sa mobilité', () => {
    const board = makeBoard();
    const tour = spawn(board, carte('TOUR', [TOUR.id]) as any, 'player', { col: 0, row: 0 });
    const ennemi = spawn(board, carte('E', ['NEUTRE']) as any, 'enemy', { col: 0, row: 10 });
    armer(board, [tour], [ennemi]);

    expect(tour.is_immobile).toBe(true);
    tour.resetCombatStats();
    expect(tour.is_immobile).toBe(true);
  });

  // ⚠️ …mais elle repart bien à CHAQUE combat, sans quoi une unité ayant perdu
  // l'attribut (magie, substitution) resterait plantée pour toujours.
  it('startCombat la remet à zéro avant de la reposer', () => {
    const deps: GameSessionDeps = {
      cardsByTier: { 1: [makeCard({ id: 'P1', summon_conditions: [] }) as any] },
      enemyDeck: { 1: [] },
      attributeList: CATALOGUE as any,
      cardDb: { getCard: () => null } as any,
      getAllBoards: () => [],
      getAllMagies: () => [],
    };
    const session = new GameSession(deps);
    // Une unité SANS le mot-clé, marquée à la main comme si un combat passé
    // l'avait laissée immobile.
    const unit = spawn(session.board, carte('U', ['NEUTRE']) as any, 'player', { col: 0, row: 0 });
    unit.is_immobile = true;

    session.startCombat(null);

    expect(unit.is_immobile).toBe(false);
  });
});
