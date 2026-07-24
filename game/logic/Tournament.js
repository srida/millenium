import * as PublicDeckDatabase from '../data/PublicDeckDatabase.js';
import * as DeckRepository from '../data/DeckRepository.js';
import { simulateMatch } from './MatchSimulator.js';

let _nextMatchId = 1;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createMatch(pA, pB) {
  return { id: _nextMatchId++, players: [pA, pB], wins: [0, 0], games: [], winner: null };
}

/**
 * Build a fresh 8-player tournament: the human player + 7 AI, each AI assigned
 * a distinct random public deck. Bracket seeding is random.
 * @param {string} playerDeckName - name of a deck saved in DeckRepository
 */
export async function createTournament(playerDeckName) {
  await PublicDeckDatabase.init();
  const publicDecks = shuffle(PublicDeckDatabase.getAllDecks()).slice(0, 7);

  const participants = [
    { id: 0, name: 'Vous', isPlayer: true, deckName: playerDeckName, deck: DeckRepository.loadDeck(playerDeckName) },
    ...publicDecks.map((d, i) => ({ id: i + 1, name: d.name, isPlayer: false, deck: d.deck })),
  ];

  const seeded = shuffle(participants);
  const round1 = [];
  for (let i = 0; i < seeded.length; i += 2) {
    round1.push(createMatch(seeded[i], seeded[i + 1]));
  }

  return {
    playerDeckName,
    participants,
    rounds: [round1],
    currentRoundIndex: 0,
  };
}

export function recordGameResult(match, winnerSlot) {
  match.wins[winnerSlot]++;
  match.games.push(winnerSlot);
  if (match.wins[winnerSlot] >= 3) match.winner = match.players[winnerSlot];
}

/** Resolves every match in `round` that does not involve the human player. */
export function resolveAiMatches(round, deps) {
  for (const match of round) {
    if (match.winner) continue;
    if (match.players.some(p => p.isPlayer)) continue;
    const { wins, winnerSlot } = simulateMatch(match.players[0].deck, match.players[1].deck, deps);
    match.wins = wins;
    match.winner = match.players[winnerSlot];
  }
}

/** The player's current unfinished match in the current round, or null. */
export function findPlayerMatch(tournament) {
  const round = tournament.rounds[tournament.currentRoundIndex];
  return round.find(m => m.players.some(p => p.isPlayer) && !m.winner) || null;
}

export function isRoundComplete(round) {
  return round.every(m => m.winner);
}

export function buildNextRound(tournament) {
  const round = tournament.rounds[tournament.currentRoundIndex];
  const winners = round.map(m => m.winner);
  const nextRound = [];
  for (let i = 0; i < winners.length; i += 2) {
    nextRound.push(createMatch(winners[i], winners[i + 1]));
  }
  tournament.rounds.push(nextRound);
  tournament.currentRoundIndex++;
  return nextRound;
}

export function isTournamentComplete(tournament) {
  const lastRound = tournament.rounds[tournament.rounds.length - 1];
  return lastRound.length === 1 && !!lastRound[0].winner;
}

export function getChampion(tournament) {
  const lastRound = tournament.rounds[tournament.rounds.length - 1];
  return lastRound[0]?.winner ?? null;
}

export function isPlayerEliminated(tournament) {
  const allMatches = tournament.rounds.flat();
  return allMatches.some(m => m.winner && !m.winner.isPlayer && m.players.some(p => p.isPlayer));
}
