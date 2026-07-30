import { Board } from './Board.js';
import { GameState } from './GameState.js';
import { EnemyAI } from './EnemyAI.js';
import { AttributeManager } from './AttributeManager.js';
import { CombatManager, MAX_COMBAT_TICKS } from './CombatManager.js';

/**
 * Headless resolution for AI-vs-AI tournament matches: no DOM, no
 * requestAnimationFrame, no terrain/magies (those are cosmetic/bonus layers
 * reserved for the player's own animated matches via GameScreen3D).
 * Runs the core rules only: draw / place / combat / HP over up to 5 rounds.
 */

/**
 * Simulate a single full game (up to 5 rounds) between two AI decks.
 * @param {Object} deckA - side 'player'
 * @param {Object} deckB - side 'enemy'
 * @param {Object} deps  - { attributeList, cardDb }
 * @returns {'player'|'enemy'} winner (never 'draw' — see _breakTie)
 */
export function simulateGame(deckA, deckB, { attributeList, cardDb }) {
  const board = new Board();
  const gameState = new GameState();
  const aiA = new EnemyAI(deckA, cardDb, 'player');
  const aiB = new EnemyAI(deckB, cardDb, 'enemy');
  let graveyardA = [];
  let graveyardB = [];

  for (;;) {
    aiA.drawHand(gameState.round);
    aiB.drawHand(gameState.round);
    aiA.placeFromHand(board, gameState.player_board_slots, graveyardA);
    aiB.placeFromHand(board, gameState.enemy_board_slots, graveyardB);
    aiA.rearrangeUnits(board, gameState.player_board_slots);
    aiB.rearrangeUnits(board, gameState.enemy_board_slots);

    const unitsA = board.getLivingUnitsOnSide('player');
    const unitsB = board.getLivingUnitsOnSide('enemy');

    gameState.startCombat(unitsA.length, unitsB.length);
    const attributeManager = new AttributeManager(attributeList, unitsA, unitsB);
    attributeManager.applyStartOfCombat();

    const combat = new CombatManager(board, unitsA, unitsB, attributeManager);
    let events = [];
    for (let i = 0; i < MAX_COMBAT_TICKS && !combat.isOver; i++) {
      events = combat.step();
    }
    if (!combat.isOver) combat.winner = 'draw';

    const neutralizedA = unitsA.filter(u => u.is_neutralized);
    const neutralizedB = unitsB.filter(u => u.is_neutralized);
    const attributeResult = attributeManager.applyEndOfCombat(neutralizedA, neutralizedB);

    const survivorsA = unitsA.filter(u => !u.is_neutralized);
    const survivorsB = unitsB.filter(u => !u.is_neutralized);
    const atkA = survivorsA.reduce((s, u) => s + u.atk, 0);
    const atkB = survivorsB.reduce((s, u) => s + u.atk, 0);

    const roundWinner = combat.winner === 'draw' || combat.winner == null ? 'draw' : combat.winner;
    gameState.applyEndOfCombat(roundWinner, atkA, atkB, attributeResult);

    // Dead units leave the board and join their graveyard; survivors reset & return home.
    for (const u of unitsA) if (u.is_neutralized) board.removeUnit(u);
    for (const u of unitsB) if (u.is_neutralized) board.removeUnit(u);
    graveyardA = unitsA.filter(u => u.is_neutralized);
    graveyardB = unitsB.filter(u => u.is_neutralized);
    for (const u of survivorsA) u.resetCombatStats();
    for (const u of survivorsB) u.resetCombatStats();
    _returnHome(board, survivorsA);
    _returnHome(board, survivorsB);

    if (gameState.isGameOver()) break;
    gameState.nextRound();
  }

  const winner = gameState.getWinner();
  return winner === 'draw' ? _breakTie(gameState) : winner;
}

function _returnHome(board, units) {
  const toReposition = units.filter(u =>
    u.initial_position &&
    (u.position.col !== u.initial_position.col || u.position.row !== u.initial_position.row)
  );
  for (const u of toReposition) board.removeUnit(u);
  for (const u of toReposition) {
    const dest = !board.isOccupied(u.initial_position)
      ? u.initial_position
      : (u.side === 'player' ? board.firstEmptyPlayerCell() : board.firstEmptyEnemyCell());
    if (dest) board.moveUnit(u, dest);
  }
}

// Draws never resolve a tournament bracket: pick a side deterministically-ish
// (higher remaining HP, or a coin flip if truly tied) rather than looping forever.
function _breakTie(gameState) {
  if (gameState.player_hp !== gameState.enemy_hp) {
    return gameState.player_hp > gameState.enemy_hp ? 'player' : 'enemy';
  }
  return Math.random() < 0.5 ? 'player' : 'enemy';
}

/**
 * Simulate a best-of-5 match between two AI decks.
 * @returns {{ wins: [number, number], winnerSlot: 0|1 }}
 */
export function simulateMatch(deckA, deckB, deps) {
  const wins = [0, 0];
  let attempts = 0;
  while (wins[0] < 3 && wins[1] < 3) {
    attempts++;
    const winner = simulateGame(deckA, deckB, deps);
    if (winner === 'player') wins[0]++;
    else wins[1]++;
    if (attempts > 20) break; // safety net, should never trigger
  }
  return { wins, winnerSlot: wins[0] > wins[1] ? 0 : 1 };
}
