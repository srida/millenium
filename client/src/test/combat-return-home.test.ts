/* eslint-disable @typescript-eslint/no-explicit-any */
// Régression sur `GameSession._returnHome` (repositionnement des survivants à
// `initial_position` en fin de combat, cf. CLAUDE.md « Modèle d'unité »).
//
// Deux défauts corrigés, chacun avec son scénario :
//
// 1. Une unité déplacée pendant le combat dont NI sa case d'origine NI aucun
//    repli n'est disponible disparaissait silencieusement de `board.grid`
//    (retirée à l'étape ①, jamais replacée à l'étape ②) : elle survivait dans
//    les listes logiques mais `Scene3D.refresh()`, qui n'énumère que
//    `board.grid`, ne la dessinait plus jamais. Le filet : elle rejoint le
//    cimetière et est signalée dans `overflowUnits`.
//
// 2. Deux unités peuvent partager la même `initial_position` (un repli d'un
//    tour passé laisse un survivant sur une case dont il n'est pas
//    propriétaire ; une carte invoquée plus tard hérite de cette même case
//    comme SA case d'origine). Un unique passage qui mélange vérification et
//    déplacement pouvait alors faire piocher, par le REPLI d'une unité, la
//    case d'origine d'une autre pas encore traitée — une unité dont la case
//    n'avait pourtant jamais été touchée se retrouvait déplacée. Le fix :
//    deux passes, la reprise de case d'origine d'abord pour toutes, le repli
//    ensuite pour ce qui reste.
import { describe, it, expect } from 'vitest';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';
import { makeCard, spawn } from './helpers.js';

function makeSession(): GameSession {
  const playerCard = makeCard({ id: 'P1', summon_conditions: [] });
  const deps: GameSessionDeps = {
    cardsByTier: { 1: [playerCard as any] },
    enemyDeck: { 1: [] },
    attributeList: [],
    cardDb: { getCard: () => null },
    getAllBoards: () => [],
    getAllMagies: () => [],
  };
  return new GameSession(deps);
}

describe('GameSession._returnHome — filet de repositionnement', () => {
  it('une unité sans case d\'origine ni repli rejoint le cimetière plutôt que de disparaître', () => {
    const session = makeSession();
    const board = session.board;
    const card = makeCard({ id: 'FIX', summon_conditions: [] });

    // Remplit les 20 cases joueur (rows 0-3) : aucune case de repli possible.
    const anchored = [];
    for (let row = 0; row <= 3; row++) {
      for (let col = 0; col < 5; col++) {
        anchored.push(spawn(board, card, 'player', { col, row }));
      }
    }

    // Deux survivants dont la case d'origine a été « héritée » de deux des
    // unités ancrées (scénario réaliste : ces cases furent jadis les leurs,
    // une invocation ultérieure les a reprises) — déplacés en zone neutre
    // pendant le combat.
    const u1 = spawn(board, card, 'player', { col: 0, row: 4 });
    u1.initial_position = { col: anchored[0].position!.col, row: anchored[0].position!.row };
    const u2 = spawn(board, card, 'player', { col: 1, row: 4 });
    u2.initial_position = { col: anchored[1].position!.col, row: anchored[1].position!.row };

    const overflow = (session as any)._returnHome([...anchored, u1, u2], 'player');

    expect(overflow).toEqual(expect.arrayContaining([u1, u2]));
    expect(overflow).toHaveLength(2);
    expect(u1.is_neutralized).toBe(true);
    expect(u2.is_neutralized).toBe(true);
    // Les 20 ancrées n'ont pas bougé : aucune case ne leur a été volée pour
    // « faire de la place » aux deux surnuméraires.
    for (const u of anchored) {
      expect(board.getUnit(u.position!)).toBe(u);
    }
  });

  it('une unité dont la case d\'origine est toujours libre la reprend, même si une autre unité a besoin d\'un repli', () => {
    const session = makeSession();
    const board = session.board;
    const card = makeCard({ id: 'FIX', summon_conditions: [] });

    // O occupe (0,0) en permanence : cette case fut jadis celle de A, qui l'a
    // perdue pour de bon (O ne bougera jamais).
    const occupant = spawn(board, card, 'player', { col: 0, row: 0 });

    // A : sa case d'origine (0,0) est déjà prise par `occupant` — A devra se
    // replier. Terminé le combat en (2,1) pour être énuméré AVANT B.
    const unitA = spawn(board, card, 'player', { col: 2, row: 1 });
    unitA.initial_position = { col: 0, row: 0 };

    // B : sa vraie case d'origine, (1,0), n'a jamais été touchée par personne.
    // Terminé le combat en (3,1), donc énuméré après A.
    const unitB = spawn(board, card, 'player', { col: 3, row: 1 });
    unitB.initial_position = { col: 1, row: 0 };

    const overflow = (session as any)._returnHome([occupant, unitA, unitB], 'player');

    expect(overflow).toHaveLength(0);
    // B doit reprendre SA case, quel que soit le sort de A : le repli de A ne
    // doit jamais la lui souffler au passage.
    expect(unitB.position).toEqual({ col: 1, row: 0 });
    expect(board.getUnit({ col: 1, row: 0 })).toBe(unitB);
    // A, dont la vraie case reste indisponible, atterrit ailleurs — mais
    // jamais en écrasant B.
    expect(unitA.position).not.toEqual({ col: 1, row: 0 });
    expect(board.getUnit(unitA.position!)).toBe(unitA);
  });
});
