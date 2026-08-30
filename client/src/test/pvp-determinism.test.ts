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
import { Board } from '../logic/Board.js';
import { Unit } from '../logic/Unit.js';
import { makeRandom } from '../logic/Random.js';
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
function session(opts: { mirroredRole?: boolean } = {}): GameSession {
  const card = makeCard({ id: 'P0', summon_type: 'normal' });
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [card] as any },
    enemyDeck: { 1: [] },
    attributeList: [],
    cardDb: { getCard: () => null } as any,
    getAllBoards: () => [],
    getAllMagies: () => [],
    mode: 'pvp',
    mirroredRole: opts.mirroredRole,
  };
  return new GameSession(deps);
}

/** Les cases telles que le client les applique VRAIMENT (le board fait foi). */
function appliedCells(mirroredRole: boolean, board: BoardDef): { col: number; row: number }[] {
  const s = session({ mirroredRole });
  s.startPreparation();
  s.startCombat(board);
  return s.board.blockedCells();
}

describe('Terrain — les deux clients doivent décrire le MÊME plateau', () => {
  // ⚠️ LE test du lot. Le rôle B applique le reflet, si bien qu'une fois
  // ramenées dans le repère commun les deux vues coïncident.
  // Mutation : `mirroredRole` ignoré dans `startCombat` → ROUGE.
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

  // Mutation : poser `mirroredRole` par défaut, ou le dériver du seul mode
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

// ===========================================================================
//  L'ORDRE d'énumération du plateau — la troisième cause, vue sur un 2ᵉ duel
// ===========================================================================
// Match `a9c8c4a6`, une fois le terrain et les horloges corrigés : round 1
// impeccable (150 ticks), puis trois rounds divergents pour une raison neuve.
//
// `Board.getUnitsOnSide` balayait les rangées en ordre CROISSANT. Le même camp
// étant en rows 0–3 chez son propriétaire et en 7–10 chez son adversaire, les
// deux clients obtenaient l'ordre relatif INVERSE — et cet ordre est de la
// logique de jeu : il départage les égalités du choix de cible, du plus court
// chemin et l'ordre des `stat_change` d'attribut.
//
// Round 2, tick 85 : quatre cibles à égale distance de Chebyshev de
// `A:CORE_109`. Un client a trouvé sa première candidate déjà à portée et n'a
// pas bougé, l'autre en a trouvé une différente et a avancé d'une case.
describe('Ordre du plateau — les deux clients énumèrent le même monde', () => {
  function boardWith(mirrored: boolean, cells: [number, number][]): Board {
    const b = new Board();
    b.mirroredFrame = mirrored;
    for (const [col, row] of cells) {
      const c = makeCard({ id: `U${col}${row}`, summon_type: 'normal' });
      const u = new (Unit as any)(c, 'player') as Unit;
      b.placeUnit(u, { col, row: mirrored ? MIRROR_AXIS - row : row });
    }
    return b;
  }

  /** Les unités dans l'ordre du balayage, nommées par leur cellule CANONIQUE. */
  function scanned(mirrored: boolean, cells: [number, number][]): string[] {
    return boardWith(mirrored, cells).getUnitsOnSide('player').map(u => u.card_id);
  }

  // ⚠️ LA régression du 2ᵉ duel. Trois unités dans la même colonne, à trois
  // profondeurs : c'est la configuration exacte du round 2 (col 2, rows 7/8/9).
  // Mutation : `_rowScan` rendant toujours les rangées croissantes → ROUGE.
  it('rend le même ordre relatif des deux côtés', () => {
    const camp: [number, number][] = [[2, 7], [2, 8], [2, 9], [0, 7], [4, 7]];
    expect(scanned(true, camp)).toEqual(scanned(false, camp));
  });

  it('laisse le rôle A exactement dans l\'ordre historique (col, puis row croissante)', () => {
    expect(scanned(false, [[2, 9], [2, 7], [0, 8], [2, 8]]))
      .toEqual(['U27', 'U28', 'U29'].map(String).length ? ['U08', 'U27', 'U28', 'U29'] : []);
  });

  // ⚠️ `row - 1` et `row + 1` désignent deux directions PHYSIQUES opposées d'un
  // client à l'autre. Le BFS rend le premier plus court chemin trouvé et
  // `stepTowardOrNearest` la première voisine la plus proche : sans cet ordre,
  // deux chemins de même longueur se départagent en sens inverse.
  // Mutation : ordre des voisines figé à `[row-1, row+1]` → ROUGE.
  it('énumère les voisines d\'une case dans le même ordre physique', () => {
    const canon = (mirrored: boolean) => {
      const b = new Board();
      b.mirroredFrame = mirrored;
      const pos = { col: 2, row: mirrored ? MIRROR_AXIS - 5 : 5 };
      return b.getNeighbors(pos).map(n => `${n.col},${mirrored ? MIRROR_AXIS - n.row : n.row}`);
    };
    expect(canon(true)).toEqual(canon(false));
    expect(canon(false)).toEqual(['1,5', '3,5', '2,4', '2,6']);
  });

  it('n\'est PAS miroité hors du rôle B — le plateau du solo est inchangé', () => {
    expect(new Board().mirroredFrame).toBe(false);
  });
});

// ===========================================================================
//  Le filet : un MÊME combat physique, simulé dans les deux repères
// ===========================================================================
// C'est l'invariant que tout ce chapitre défend, et le seul test qui aurait
// attrapé les quatre causes d'un coup : deux `GameSession` complètes, l'une
// dans le repère de référence et l'autre dans son miroir, jouant le même
// combat physique, doivent rendre le MÊME log canonique — celui-là même que
// `/api/admin/pvp-logs` compare.
describe('Un même combat physique rend le même log dans les deux repères', () => {
  interface Placed { card: any; col: number; row: number }

  /**
   * Monte une session du rôle demandé et rejoue le combat jusqu'au bout, à
   * travers le VRAI enregistreur.
   *
   * Les positions sont données dans le repère CANONIQUE ; chaque rôle les
   * traduit dans le sien, exactement comme le fait `reconstructOpponentUnits`.
   */
  function playAs(role: 'A' | 'B', a: Placed[], b: Placed[], board: BoardDef): any {
    const mirrored = role === 'B';
    const localRow = (row: number) => (mirrored ? MIRROR_AXIS - row : row);
    const mine = mirrored ? b : a;
    const theirs = mirrored ? a : b;

    const byId = new Map([...a, ...b].map(p => [p.card.id, p.card]));
    const s = new GameSession({
      cardsByTier: { 1: [] },
      enemyDeck: { 1: [] },
      attributeList: [],
      cardDb: { getCard: (id: string) => (byId.get(id) as any) ?? null },
      getAllBoards: () => [],
      getAllMagies: () => [],
      mode: 'pvp',
      mirroredRole: mirrored,
    } as any);
    s.startPreparation();
    for (const p of mine) s.board.placeUnit(new (Unit as any)(p.card, 'player'), { col: p.col, row: localRow(p.row) });
    for (const p of theirs) s.board.placeUnit(new (Unit as any)(p.card, 'enemy'), { col: p.col, row: localRow(p.row) });

    const rec = new CombatRecorder({ matchId: 'm', round: 1, role });
    const { combat } = s.startCombat(board);
    // Le terrain journalisé est celui qui est JOUÉ, comme le fait GameController.
    rec.header(combat, { ...board, blocked_cells: s.board.blockedCells() });
    while (!combat.winner) rec.capture(combat, combat.step());
    return rec.payload().payload;
  }

  /** Un plateau semé : positions et stats variées, mais toujours les mêmes. */
  function scenario(seed: number): { a: Placed[]; b: Placed[]; board: BoardDef } {
    const rand = makeRandom(seed);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    const taken = new Set<string>();
    const place = (side: 'A' | 'B', i: number): Placed => {
      let col = 0, row = 0;
      do {
        col = Math.floor(rand() * 5);
        row = (side === 'A' ? 0 : 7) + Math.floor(rand() * 4);
      } while (taken.has(`${col},${row}`));
      taken.add(`${col},${row}`);
      // Les pouvoirs retenus sont ceux qui LISENT un tableau ou une case
      // voisine, donc ceux qu'un ordre non canonique peut faire diverger :
      // le soin balaie les alliés (plus bas PV, le premier gagne à égalité),
      // la téléportation et la poussée cherchent une case libre, la provocation
      // détourne le ciblage de tout un camp.
      const power = pick([
        null, null,
        { id: 'POWER_HEAL', speed: 12, value: null },
        { id: 'POWER_TELEPORT', speed: 15, value: null },
        { id: 'POWER_PUSH', speed: 10, value: null },
        { id: 'POWER_TAUNT', speed: 14, value: null },
        { id: 'POWER_FREEZE', speed: 18, value: null },
      ]);
      return {
        col, row,
        card: makeCard({
          id: `${side}_${i}`, summon_type: 'normal', power: power as any,
          stats: {
            atk: pick([6, 9, 14]), hp: pick([60, 90, 130]),
            movement_speed: pick([2, 3, 4]), attack_speed: pick([3, 5, 8]),
            // Initiative et range volontairement peu variées : ce sont les
            // ÉGALITÉS qu'on cherche à provoquer, pas les départages.
            initiative: pick([4, 5]), range: pick([1, 2]),
          },
        }),
      };
    };
    return {
      a: Array.from({ length: 4 }, (_, i) => place('A', i)),
      b: Array.from({ length: 4 }, (_, i) => place('B', i)),
      // BOARD_005, celui du round 2 du duel : ses cases sont symétriques, donc
      // seul l'ORDRE d'énumération peut encore faire diverger ce combat.
      board: {
        id: 'BOARD_005', name: 'Duel', effect: null,
        blocked_cells: [{ col: 0, row: 5 }, { col: 2, row: 4 }, { col: 2, row: 6 }, { col: 4, row: 5 }],
      } as any,
    };
  }

  // 300 graines tiennent en ~2 s. Le chiffre n'est pas un rite : c'est le point
  // où toutes les régressions connues de ce chapitre sortent au rouge, mesuré
  // en les réintroduisant une par une.
  const SEEDS = 300;

  // ⚠️ LE filet. Mutation : n'importe laquelle des cinq corrections retirée
  // (miroir du terrain, horloges, balayage des rangées, ordre des voisines) →
  // ROUGE sur plusieurs graines.
  it(`${SEEDS} combats semés donnent des logs rigoureusement identiques`, () => {
    const divergents: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { a, b, board } = scenario(seed);
      const d = pvplog.diff(playAs('A', a, b, board), playAs('B', a, b, board));
      if (d) divergents.push(`graine ${seed} : ${d.kind} @ tick ${d.tick} · ${d.detail?.field ?? d.detail?.unit ?? ''}`);
    }
    expect(divergents).toEqual([]);
  });

  // ⚠️ Le cas que les 300 graines ne peuvent PAS produire : elles nomment les
  // cartes par leur camp (`A_0`, `B_0`), si bien que le départage par `card_id`
  // tranche toujours. Or deux joueurs peuvent parfaitement jouer LA MÊME carte
  // — c'est même le cas du miroir. À initiative, vitesse et `card_id` égaux, il
  // ne restait que la concaténation `[...playerUnits, ...enemyUnits]`, qui met
  // « mes » unités en tête sur CHAQUE client : les deux clients faisaient donc
  // agir les deux unités dans l'ordre inverse l'un de l'autre.
  //
  // ⚠️ Il faut une COURSE pour que l'ordre se voie : deux jumelles qui
  // s'entretuent meurent de toute façon, la phase d'attaque résolvant tous les
  // coups avant le décompte des morts. Ici le terrain n'ouvre qu'UNE case dans
  // la rangée centrale — celle qui joue la première la prend, l'autre la trouve
  // occupée.
  //
  // ⚠️ Mutation : l'ordre de camp retiré du moteur — `_frameOrderedUnits` ET le
  // départage `_frameSide` — → ROUGE. Retirer le seul `_frameSide` ne suffit
  // pas : les deux se recouvrent tant que `sort` est stable (cf. le commentaire
  // du tri dans `CombatManager`).
  it('tranche l\'égalité PARFAITE — même initiative, même vitesse, même carte', () => {
    const twin = () => makeCard({
      id: 'MIRROR_1', summon_type: 'normal',
      stats: { atk: 1, hp: 40, movement_speed: 1, attack_speed: 2, initiative: 5, range: 1 },
    });
    const a: Placed[] = [{ card: twin(), col: 2, row: 3 }];
    const b: Placed[] = [{ card: twin(), col: 2, row: 7 }];
    // Goulet : (2,5) est la seule case libre de la rangée centrale. Symétrique
    // par le miroir (row 5 est l'axe, 4 ↔ 6), donc le terrain n'est pas en cause.
    const goulet: BoardDef = {
      id: 'BOARD_GOULET', name: 'Goulet', effect: null,
      blocked_cells: [{ col: 0, row: 5 }, { col: 1, row: 5 }, { col: 3, row: 5 }, { col: 4, row: 5 }],
    } as any;

    const vueA = playAs('A', a, b, goulet);
    const vueB = playAs('B', a, b, goulet);
    // Témoin : la course a bien eu lieu — une des deux a franchi la rangée
    // centrale, sans quoi le cas ne prouverait rien.
    const rows = vueA.ticks.flatMap((t: any) => t.units.map((u: any[]) => u[2]));
    expect(rows).toContain(5);
    expect(pvplog.diff(vueA, vueB)).toBeNull();
  });

  // Le témoin : sans lui, le cas précédent passerait aussi sur des combats qui
  // se terminent au premier tick sans que rien n'ait le temps de diverger.
  it('ces combats sont bien de VRAIS combats, longs et décisifs', () => {
    const { a, b, board } = scenario(1);
    const log = playAs('A', a, b, board);
    expect(log.tick_count).toBeGreaterThan(20);
    expect(['A', 'B', 'draw', 'timeout']).toContain(log.winner);
  });
});
