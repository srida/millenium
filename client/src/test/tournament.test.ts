/* eslint-disable @typescript-eslint/no-explicit-any */
// Tournoi — le bracket local à 8. Verrouille le contrat introduit avec les
// matchs joués : les matchs IA sont simulés, celui du joueur ne l'est JAMAIS
// (il se joue manche par manche via GameScreen), et le report du résultat
// dans le bracket passe par tournamentStore.finishGame().
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTournament, resolveAiMatches, findPlayerMatch, isRoundComplete,
  buildNextRound, isTournamentComplete, getChampion, isPlayerEliminated,
} from '../logic/Tournament.js';
import { useTournamentStore } from '../stores/tournamentStore.js';

const DECK = { '1': ['A'], '2': [], '3': [], '4': [], '5': [] };

function makeTournament() {
  const publicDecks = Array.from({ length: 7 }, (_, i) => ({ name: `IA ${i + 1}`, deck: { ...DECK } }));
  return createTournament('Mon deck', { playerDeck: { ...DECK }, publicDecks });
}

// Résolution IA factice : le slot 0 gagne toujours 3-0. Évite de faire tourner
// MatchSimulator (lent, et hors sujet ici).
const FAKE_DEPS = { attributeList: [], cardDb: { getCard: () => null } };

describe('Tournament — bracket', () => {
  beforeEach(() => { useTournamentStore.getState().clear(); });

  it('monte un bracket de 8 avec le joueur dedans', () => {
    const t = makeTournament();
    expect(t.participants).toHaveLength(8);
    expect(t.participants.filter((p: any) => p.isPlayer)).toHaveLength(1);
    expect(t.rounds[0]).toHaveLength(4);
  });

  it('resolveAiMatches laisse le match du joueur intact', () => {
    const t = makeTournament();
    resolveAiMatches(t.rounds[0], FAKE_DEPS as any);
    const playerMatch = t.rounds[0].find((m: any) => m.players.some((p: any) => p.isPlayer)) as any;
    expect(playerMatch.winner).toBeNull();
    expect(playerMatch.wins).toEqual([0, 0]);
    // Les trois autres sont tranchés → le round attend le seul match du joueur.
    expect(t.rounds[0].filter((m: any) => m.winner)).toHaveLength(3);
    expect(isRoundComplete(t.rounds[0])).toBe(false);
    expect(findPlayerMatch(t)).toBe(playerMatch);
  });
});

describe('tournamentStore — report des manches jouées', () => {
  beforeEach(() => { useTournamentStore.getState().clear(); });

  function armPlayerMatch() {
    const t = makeTournament();
    resolveAiMatches(t.rounds[0], FAKE_DEPS as any);
    const store = useTournamentStore.getState();
    store.setTournament(t);
    const match = findPlayerMatch(t);
    useTournamentStore.getState().startGame(match);
    return { t, match, pending: useTournamentStore.getState().pendingGame! };
  }

  it('startGame décrit la manche à jouer (adversaire, deck, score)', () => {
    const { match, pending } = armPlayerMatch();
    const opponent = match.players.find((p: any) => !p.isPlayer);
    expect(pending.matchId).toBe(match.id);
    expect(pending.opponentName).toBe(opponent.name);
    expect(pending.opponentDeck).toBe(opponent.deck);
    expect(pending.playerDeckName).toBe('Mon deck');
    expect(pending.gameNumber).toBe(1);
    expect(pending.score).toEqual([0, 0]);
  });

  it('crédite la victoire au bon slot, quel que soit le côté du joueur', () => {
    const { match, pending } = armPlayerMatch();
    useTournamentStore.getState().finishGame('player');
    expect(match.wins[pending.playerSlot]).toBe(1);
    expect(match.wins[1 - pending.playerSlot]).toBe(0);
    expect(useTournamentStore.getState().pendingGame).toBeNull();
  });

  it('une défaite (ou un abandon) crédite l’adversaire, et 3 manches closent le match', () => {
    const { match, pending } = armPlayerMatch();
    for (let i = 0; i < 3; i++) {
      useTournamentStore.getState().startGame(match);
      useTournamentStore.getState().finishGame('enemy');
    }
    expect(match.wins[1 - pending.playerSlot]).toBe(3);
    expect(match.winner).toBe(match.players[1 - pending.playerSlot]);
    expect(match.winner.isPlayer).toBe(false);
  });

  it('une égalité ne compte pour personne — la manche est rejouée', () => {
    const { match } = armPlayerMatch();
    useTournamentStore.getState().finishGame('draw');
    expect(match.wins).toEqual([0, 0]);
    expect(match.winner).toBeNull();
  });

  it('gagner son match débloque le round et qualifie le joueur au suivant', () => {
    const { t, match } = armPlayerMatch();
    for (let i = 0; i < 3; i++) {
      useTournamentStore.getState().startGame(match);
      useTournamentStore.getState().finishGame('player');
    }
    expect(isRoundComplete(t.rounds[0])).toBe(true);
    expect(isPlayerEliminated(t)).toBe(false);

    // Demi-finale : le joueur a de nouveau un match à jouer, pas à simuler.
    buildNextRound(t);
    resolveAiMatches(t.rounds[1], FAKE_DEPS as any);
    const semi = findPlayerMatch(t);
    expect(semi).toBeTruthy();
    expect(semi.wins).toEqual([0, 0]);
    expect(isRoundComplete(t.rounds[1])).toBe(false);
  });

  it('une fois éliminé, les rounds restants se déroulent entièrement en IA', () => {
    const { t, match } = armPlayerMatch();
    for (let i = 0; i < 3; i++) {
      useTournamentStore.getState().startGame(match);
      useTournamentStore.getState().finishGame('enemy');
    }
    expect(isPlayerEliminated(t)).toBe(true);
    expect(findPlayerMatch(t)).toBeNull();

    for (const ri of [1, 2]) {
      buildNextRound(t);
      resolveAiMatches(t.rounds[ri], FAKE_DEPS as any);
      expect(isRoundComplete(t.rounds[ri])).toBe(true);
    }
    expect(isTournamentComplete(t)).toBe(true);
    expect(getChampion(t).isPlayer).toBe(false);
  });
});
