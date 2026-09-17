/* eslint-disable @typescript-eslint/no-explicit-any */
// Régression sur POWER_SUMMON_TOKEN : invocation d'une unité ÉPHÉMÈRE en plein
// combat (CLAUDE.md, section Pouvoirs). Deux garanties, chacune éprouvée dans
// les deux sens :
//   1. Le pouvoir ne se déclenche QUE si une case adjacente est libre ET que
//      le token est résolvable dans le catalogue injecté — sinon il se
//      comporte comme Gel/Téléportation sans cible : la jauge reste pleine.
//   2. Le token disparaît PUREMENT à la fin du combat qui l'a vu naître —
//      GameSession.finishCombat — jamais au cimetière, jamais de vétérance.
import { describe, it, expect } from 'vitest';
import { makeBoard, makeCard, spawn } from './helpers.js';
import { CombatManager } from '../logic/CombatManager.js';
import { GameSession } from '../logic/GameSession.js';
import type { GameSessionDeps } from '../logic/GameSession.js';

const TOKEN_DEF = {
  id: 'TOK_TEST', name: 'Esprit',
  stats: { atk: 3, hp: 12, movement_rate: 80, attack_rate: 80, range: 1 },
};
const tokenDb = { getToken: (id: string) => (id === TOKEN_DEF.id ? TOKEN_DEF : null) };

function arena(
  power: any = { id: 'POWER_SUMMON_TOKEN', power_rate: 100, token_id: TOKEN_DEF.id },
  db: any = tokenDb,
) {
  const board = makeBoard();
  const caster = spawn(board, makeCard({
    id: 'P_CASTER', power,
    stats: { atk: 10, hp: 100, attack_rate: 100, movement_rate: 100, range: 1 },
  }), 'player', { col: 2, row: 2 });
  const combat = new (CombatManager as any)(board, [caster], [], null, db);
  const fire = () => {
    const events: any[] = [];
    const fired = combat._firePower(caster, null, events);
    return { fired, events };
  };
  return { board, combat, caster, fire };
}

describe('POWER_SUMMON_TOKEN — invocation', () => {
  it('invoque sur une case ADJACENTE libre, avec is_token = true', () => {
    const a = arena();
    const { fired, events } = a.fire();
    expect(fired).toBe(true);
    expect(a.combat.playerUnits).toHaveLength(2);
    const token = a.combat.playerUnits.find((u: any) => u !== a.caster);
    expect(token.is_token).toBe(true);
    expect(token.card_id).toBe(TOKEN_DEF.id);
    expect(token.atk).toBe(3);
    const d = Math.abs(token.position.col - a.caster.position.col)
            + Math.abs(token.position.row - a.caster.position.row);
    expect(d).toBe(1);   // adjacente, jamais plus loin (pas de repli plateau entier)
    expect(events).toHaveLength(1);
    expect(events[0].power_id).toBe('POWER_SUMMON_TOKEN');
    expect(events[0].targets[0]).toBe(token);
  });

  it('ne se déclenche PAS sans case adjacente libre — la jauge reste pleine, comme Gel/Téléportation', () => {
    const a = arena();
    const [before, after] = a.board.rowNeighbourOffsets();
    const around = [
      { col: a.caster.position.col, row: a.caster.position.row + before },
      { col: a.caster.position.col, row: a.caster.position.row + after },
      { col: a.caster.position.col - 1, row: a.caster.position.row },
      { col: a.caster.position.col + 1, row: a.caster.position.row },
    ];
    for (const pos of around) spawn(a.board, makeCard({ id: 'FILLER' }), 'player', pos);

    expect(a.combat._isPowerRelevant(a.caster, null)).toBe(false);
    const { fired } = a.fire();
    expect(fired).toBe(false);
    expect(a.combat.playerUnits).toHaveLength(1);   // rien d'invoqué
  });

  it('ne se déclenche PAS sans catalogue de tokens injecté', () => {
    const a = arena(undefined, null);
    expect(a.combat._isPowerRelevant(a.caster, null)).toBe(false);
    expect(a.fire().fired).toBe(false);
  });

  it('ne se déclenche PAS sur un id de token absent du catalogue', () => {
    const a = arena({ id: 'POWER_SUMMON_TOKEN', power_rate: 100, token_id: 'TOK_INCONNU' });
    expect(a.combat._isPowerRelevant(a.caster, null)).toBe(false);
    expect(a.fire().fired).toBe(false);
  });
});

describe('POWER_SUMMON_TOKEN — disparition en fin de combat', () => {
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

  it('un token survivant ne rejoint ni le board ni le cimetière, et ne gagne aucune vétérance', () => {
    const session = makeSession();
    const board = session.board;
    const survivor = spawn(board, makeCard({ id: 'SURVIVOR' }), 'player', { col: 0, row: 0 });
    const token = spawn(board, makeCard({ id: TOKEN_DEF.id, stats: TOKEN_DEF.stats }), 'player', { col: 1, row: 0 });
    token.is_token = true;

    (session as any)._combat = { winner: 'player' };
    (session as any)._attributeManager = {
      applyEndOfCombat: () => ({ revived: [], enemyRevived: [] }),
    };
    (session as any)._combatPlayerUnits = [survivor, token];
    session.enemyUnits = [];

    const result = session.finishCombat();

    expect(board.getUnit({ col: 1, row: 0 })).toBeNull();   // retiré du plateau
    expect(session.graveyard).not.toContain(token);
    expect(board.getLivingUnitsOnSide('player')).not.toContain(token);
    expect(token.veterancy_points).toBe(0);
    expect(survivor.veterancy_points).toBe(1);   // le vrai survivant, lui, gagne bien son point
    expect(result.winner).toBe('player');
  });

  it('un token NEUTRALISÉ ne rejoint pas non plus le cimetière — il n\'a rien à y transporter', () => {
    const session = makeSession();
    const board = session.board;
    const token = spawn(board, makeCard({ id: TOKEN_DEF.id, stats: TOKEN_DEF.stats }), 'player', { col: 1, row: 0 });
    token.is_token = true;
    token.is_neutralized = true;

    (session as any)._combat = { winner: 'enemy' };
    (session as any)._attributeManager = {
      applyEndOfCombat: () => ({ revived: [], enemyRevived: [] }),
    };
    (session as any)._combatPlayerUnits = [token];
    session.enemyUnits = [];

    session.finishCombat();

    expect(session.graveyard).toEqual([]);
  });
});
