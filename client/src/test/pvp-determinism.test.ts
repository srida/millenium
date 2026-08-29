/* eslint-disable @typescript-eslint/no-explicit-any */
// Duel en ligne — les trois divergences constatées sur un VRAI log de duel
// (`/api/admin/pvp-logs`, match 779040f9), et ce qui les ferme.
//
// Le PvP repose entièrement sur le déterminisme : les deux clients simulent le
// même combat chacun de son côté, sans échanger un seul résultat. Toute donnée
// qui n'est pas la même des deux côtés au tick 0 fait diverger la partie
// entière — et le désaccord final coûte son gain aux DEUX joueurs
// (`result_mismatch`, cf. ws/MatchRelay).
//
// Le log a montré trois choses, une par round :
//
//   • rounds 2, 3, 4 — `attack_timer` / `move_timer` d'un survivant : 0 chez
//     l'adversaire (unité reconstruite du réseau), non nul chez son
//     propriétaire (unité réelle, qui gardait le reliquat du combat d'avant) ;
//   • round 5 — `blocked_cells` du terrain appliquées VERBATIM des deux côtés
//     alors que le monde du rôle B est le reflet de celui de A : deux plateaux
//     différents, première conséquence au tick 10 ;
//   • round 1 — une FAUSSE divergence : le combat était identique tick pour
//     tick, seul `combat_end.winner` (une valeur du repère local) différait.
//
// ⚠️ Éprouvés dans les deux sens : la mutation qui doit faire tomber chaque cas
// est nommée dans son commentaire.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { mirrorRow, mirrorCells, isMirrorSymmetric, MIRROR_AXIS } from '../logic/BoardMirror.js';
import { CombatRecorder } from '../game/CombatRecorder.js';
import { makeCard } from './helpers.js';
import type { BoardDef } from '../logic/types.js';

const createRequire = (await import('node:module')).createRequire;
const pvplog = createRequire(import.meta.url)('../../../pvplog.js');

// Terrain réellement livré (`initial-data/boards.json`, « Nuit des machines ») :
// c'est celui du round 5 du log. Ses cases ne sont PAS invariantes par le
// miroir — 7 des 14 terrains du jeu sont dans ce cas.
const ASYMETRIQUE: BoardDef = {
  id: 'BOARD_013', name: 'Nuit des machines', effect: null,
  blocked_cells: [{ col: 0, row: 4 }, { col: 1, row: 6 }, { col: 3, row: 4 }, { col: 4, row: 6 }],
} as any;
// Le témoin : sans lui, les cas suivants passeraient aussi avec le miroir cassé.
const SYMETRIQUE: BoardDef = {
  id: 'BOARD_007', name: 'Symétrique', effect: null,
  blocked_cells: [{ col: 2, row: 4 }, { col: 2, row: 5 }, { col: 2, row: 6 }],
} as any;

const cellKeys = (cells: { col: number; row: number }[]) =>
  cells.map(c => `${c.col},${c.row}`).sort();

// ===========================================================================
//  Le miroir, seul
// ===========================================================================
describe('BoardMirror — le repère partagé des deux clients', () => {
  it('est une involution autour de la rangée centrale', () => {
    for (let r = 0; r <= MIRROR_AXIS; r++) expect(mirrorRow(mirrorRow(r))).toBe(r);
    expect(mirrorRow(0)).toBe(10);   // ma première rangée ↔ la dernière d'en face
    expect(mirrorRow(5)).toBe(5);    // l'axe est fixe
  });

  // Mutation : miroiter aussi la colonne → ROUGE. Les deux clients partagent
  // l'axe des colonnes, seul celui des rangées s'inverse.
  it('ne touche JAMAIS à la colonne', () => {
    expect(mirrorCells([{ col: 4, row: 1 }])).toEqual([{ col: 4, row: 9 }]);
  });

  it('reconnaît un terrain symétrique, et refuse celui qui ne l\'est pas', () => {
    expect(isMirrorSymmetric(SYMETRIQUE.blocked_cells)).toBe(true);
    expect(isMirrorSymmetric(ASYMETRIQUE.blocked_cells)).toBe(false);
    expect(isMirrorSymmetric([])).toBe(true);       // un terrain nu est symétrique
    expect(isMirrorSymmetric(null)).toBe(true);
  });
});

// ===========================================================================
//  Round 5 — le terrain est une donnée POSITIONNELLE
// ===========================================================================
function session(opts: { mirrorTerrain?: boolean } = {}): GameSession {
  const card = makeCard({ id: 'P0', summon_type: 'normal' });
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [card] as any },
    enemyDeck: { 1: [] },
    attributeList: [],
    cardDb: { getCard: () => null } as any,
    getAllBoards: () => [],
    getAllMagies: () => [],
    mode: 'pvp',
    mirrorTerrain: opts.mirrorTerrain,
  };
  return new GameSession(deps);
}

/** Les cases telles que le client les applique VRAIMENT (le board fait foi). */
function appliedCells(mirrorTerrain: boolean, board: BoardDef): { col: number; row: number }[] {
  const s = session({ mirrorTerrain });
  s.startPreparation();
  s.startCombat(board);
  return s.board.blockedCells();
}

describe('Terrain — les deux clients doivent décrire le MÊME plateau', () => {
  // ⚠️ LE test du lot. Le rôle B applique le reflet, si bien qu'une fois
  // ramenées dans le repère commun les deux vues coïncident.
  // Mutation : `mirrorTerrain` ignoré dans `startCombat` → ROUGE.
  it('sur un terrain NON symétrique, les deux rôles voient le même monde', () => {
    const vueA = appliedCells(false, ASYMETRIQUE);
    const vueB = appliedCells(true, ASYMETRIQUE);
    // Ce que B applique localement n'est pas ce que A applique…
    expect(cellKeys(vueB)).not.toEqual(cellKeys(vueA));
    // …mais ramené dans le repère de A, c'est exactement le même plateau.
    expect(cellKeys(mirrorCells(vueB))).toEqual(cellKeys(vueA));
  });

  it('le rôle A applique le terrain tel qu\'il est décrit', () => {
    expect(cellKeys(appliedCells(false, ASYMETRIQUE)))
      .toEqual(cellKeys(ASYMETRIQUE.blocked_cells as any));
  });

  // Le témoin : c'est parce qu'un terrain symétrique masquait le défaut qu'il a
  // fallu un vrai duel pour le voir. 7 terrains sur 14 le masquent.
  it('un terrain symétrique s\'applique à l\'identique des deux côtés', () => {
    expect(cellKeys(appliedCells(true, SYMETRIQUE)))
      .toEqual(cellKeys(appliedCells(false, SYMETRIQUE)));
  });

  // Mutation : poser `mirrorTerrain` par défaut, ou le dériver du seul mode
  // 'pvp' → ROUGE. Solo, arcade, tournoi, tutoriel et rôle A sont déjà dans le
  // repère de description.
  it('n\'est pas miroité hors du rôle B', () => {
    const s = session();
    s.startPreparation();
    s.startCombat(ASYMETRIQUE);
    expect(cellKeys(s.board.blockedCells()))
      .toEqual(cellKeys(ASYMETRIQUE.blocked_cells as any));
  });
});

// ===========================================================================
//  Rounds 2–4 — les horloges de combat
// ===========================================================================
describe('Horloges de combat — remises à zéro à chaque combat', () => {
  /** Une session solo qui laisse survivre les deux camps (PV hauts, ATK basse). */
  function duelSansMort(): GameSession {
    const mine = makeCard({ id: 'P0', summon_type: 'normal', stats: { atk: 3, hp: 500, movement_speed: 3, attack_speed: 5, initiative: 5, range: 1 } });
    const his = makeCard({ id: 'E0', summon_type: 'normal', stats: { atk: 3, hp: 500, movement_speed: 3, attack_speed: 7, initiative: 4, range: 1 } });
    const byId = new Map([mine, his].map(c => [c.id, c]));
    const s = new GameSession({
      cardsByTier: { 1: [mine] as any },
      enemyDeck: { 1: [his.id] },
      attributeList: [],
      cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
      getAllBoards: () => [],
      getAllMagies: () => [],
    } as any);
    s.startPreparation();
    s.place(s.hand[0] as any, { col: 2, row: 0 }, [], 0);
    return s;
  }

  /** Joue un combat complet et rend les unités encore en vie des deux camps. */
  function joue(s: GameSession) {
    const { combat } = s.startCombat();
    while (!combat.winner) combat.step();
    return [...s.getPlayerUnits(), ...s.enemyUnits];
  }

  // ⚠️ LE cas des rounds 2, 3 et 4 du log. Invisible en solo (une seule
  // simulation), fatal en duel : l'unité reconstruite du réseau naît avec des
  // horloges neuves, celle de son propriétaire non.
  // Mutation : retirer les `resetCombatClocks()` de `startCombat` → ROUGE.
  it('un survivant ne garde PAS le reliquat de son dernier coup', () => {
    const s = duelSansMort();
    const survivants = joue(s);
    // Le combat s'est bien arrêté sur des horloges non nulles — sans quoi le
    // test ne prouverait rien.
    expect(survivants.some(u => u.attack_timer > 0 || u.move_timer > 0)).toBe(true);

    s.finishCombat();
    s.startNextRound();
    s.startCombat();
    for (const u of [...s.getPlayerUnits(), ...s.enemyUnits]) {
      expect(u.attack_timer).toBe(0);
      expect(u.move_timer).toBe(0);
    }
  });

  // Mutation : déplacer la remise à zéro dans `resetCombatStats` → ROUGE.
  // `POWER_DEBUFF` l'appelle EN PLEIN COMBAT : la dissipation efface bonus et
  // statuts, elle n'a pas à décaler le prochain coup de sa cible.
  it('`resetCombatStats` (POWER_DEBUFF) ne touche pas aux horloges', () => {
    const s = duelSansMort();
    const cible = joue(s).find(u => u.attack_timer > 0 || u.move_timer > 0)!;
    const avant = { atk: cible.attack_timer, mv: cible.move_timer };
    cible.resetCombatStats();
    expect(cible.attack_timer).toBe(avant.atk);
    expect(cible.move_timer).toBe(avant.mv);
    expect(cible.power_gauge).toBe(0);   // celle-là, si
  });
});

// ===========================================================================
//  Round 1 — la fausse divergence
// ===========================================================================
// `'player'` / `'enemy'` sont des valeurs du repère LOCAL, au même titre qu'une
// rangée. Non traduites, un combat parfaitement sain se clôt sur deux
// vainqueurs différents et le diff s'arrête là : TOUT duel était rapporté comme
// divergent, et le verdict du fichier ne distinguait plus rien.
describe('CombatRecorder — le vainqueur est nommé dans le repère local', () => {
  function u(cardId: string, side: 'player' | 'enemy', col: number, row: number) {
    return {
      card_id: cardId, side, position: { col, row },
      current_hp: 100, max_hp: 100, shield: 0, atk: 10, initiative: 5,
      power_gauge: 0, attack_timer: 0, move_timer: 0,
      paralysis_remaining: 0, power_block_remaining: 0,
      confusion_remaining: 0, taunt_remaining: 0,
      dot_effects: [], burn_stacks: [],
      isAlive: () => true,
      effectiveAttackSpeed: () => 4,
    };
  }

  /**
   * Le MÊME combat physique, vu des deux côtés : A tient CORE_001 en (2,1) du
   * repère commun, B tient CORE_002 en (2,9), et B l'emporte.
   *
   * Le terrain est celui que chaque client applique VRAIMENT — miroité pour B,
   * comme le fait désormais `GameSession.startCombat`.
   */
  function record(role: 'A' | 'B', board: BoardDef, winner: string) {
    const mine = role === 'A' ? u('CORE_001', 'player', 2, 1) : u('CORE_002', 'player', 2, 1);
    const theirs = role === 'A' ? u('CORE_002', 'enemy', 2, 9) : u('CORE_001', 'enemy', 2, 9);
    // 'player' chez le vainqueur, 'enemy' chez le perdant : c'est le même fait.
    const local = (winner === 'B') === (role === 'B') ? 'player' : 'enemy';
    const rec = new CombatRecorder({ matchId: 'm', round: 1, role });
    const c: any = { playerUnits: [mine], enemyUnits: [theirs], _stepCount: 1, winner: null };
    // ⚠️ Les cases passent par une VRAIE `GameSession` du rôle en question, et
    // non par un miroir écrit à la main dans le test : c'est ce qui fait que ce
    // cas exerce la correction du terrain au lieu de la ré-implémenter.
    rec.header(c, { ...board, blocked_cells: appliedCells(role === 'B', board) });
    c.winner = local;
    rec.capture(c, [{ type: 'combat_end', winner: local }]);
    return rec.payload().payload;
  }

  // ⚠️ Mutation : `winnerCanon` rendu identité → ROUGE. C'est très exactement
  // ce que rapportait le round 1 du log : 154 ticks identiques, « diverged ».
  it('un combat identique des deux côtés ne diverge PAS sur le vainqueur', () => {
    expect(pvplog.diff(record('A', SYMETRIQUE, 'B'), record('B', SYMETRIQUE, 'B'))).toBeNull();
  });

  it('traduit `player`/`enemy` en rôle, dans l\'en-tête comme dans l\'événement', () => {
    const a = record('A', SYMETRIQUE, 'B');
    const b = record('B', SYMETRIQUE, 'B');
    expect(a.winner).toBe('B');
    expect(b.winner).toBe('B');
    expect(a.ticks[0].events[0]).toEqual({ type: 'combat_end', winner: 'B' });
    expect(b.ticks[0].events[0]).toEqual({ type: 'combat_end', winner: 'B' });
  });

  it('laisse passer `draw` et `timeout`, qui ne désignent personne', () => {
    for (const w of ['draw', 'timeout']) {
      const rec = new CombatRecorder({ matchId: 'm', round: 1, role: 'B' });
      const c: any = { playerUnits: [u('CORE_002', 'player', 2, 1)], enemyUnits: [], _stepCount: 1, winner: w };
      rec.header(c, SYMETRIQUE);
      rec.capture(c, [{ type: 'combat_end', winner: w }]);
      const p = rec.payload().payload;
      expect(p.winner).toBe(w);
      expect(p.ticks[0].events[0].winner).toBe(w);
    }
  });

  // ⚠️ La boucle complète : le cas du round 5 du log, terrain non symétrique
  // compris, ne diverge plus. Mutation : l'une OU l'autre des deux corrections
  // (miroir du terrain, traduction du vainqueur) retirée → ROUGE.
  it('le duel du log ne diverge plus, terrain non symétrique compris', () => {
    expect(pvplog.diff(record('A', ASYMETRIQUE, 'B'), record('B', ASYMETRIQUE, 'B'))).toBeNull();
  });
});
