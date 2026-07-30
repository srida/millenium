/* eslint-disable @typescript-eslint/no-explicit-any */
// tournamentStore — état du tournoi en cours, HORS composant : le bracket doit
// survivre à la navigation `tournament → game → tournament` (le joueur joue
// réellement ses matchs, l'écran Tournoi est donc démonté entre deux manches).
//
// Les matchs IA restent simulés (MatchSimulator) ; seul le match du joueur
// passe par GameScreen. `pendingGame` est le contrat entre les deux écrans :
// posé par l'écran Tournoi avant de naviguer, consommé par GameScreen au
// montage, soldé par `finishGame()` au retour.
import { create } from 'zustand';
import { recordGameResult, isTournamentComplete, getChampion } from '../logic/Tournament.js';
import { useAuthStore } from './authStore.js';

export type DeckIds = Record<string, string[]>;

export interface PendingGame {
  matchId: number;
  playerSlot: 0 | 1;
  opponentName: string;
  opponentDeck: DeckIds;
  /** Id du deck public adverse — pour retrouver son avatar (`PublicDeckDatabase.avatarUrl`). */
  opponentAvatarId: string | null;
  playerDeckName: string;
  /** Numéro de la manche dans le Bo5 (1-indexé). */
  gameNumber: number;
  /** Score du match au lancement de la manche, [joueur, adversaire]. */
  score: [number, number];
}

interface TournamentStoreState {
  tournament: any | null;
  pendingGame: PendingGame | null;
  /** Compteur de rendu : le bracket est muté en place par logic/Tournament.js. */
  version: number;

  setTournament: (t: any | null) => void;
  bump: () => void;
  clear: () => void;
  startGame: (match: any) => void;
  finishGame: (winner: 'player' | 'enemy' | 'draw' | null) => void;
}

export const useTournamentStore = create<TournamentStoreState>((set, get) => ({
  tournament: null,
  pendingGame: null,
  version: 0,

  setTournament: (tournament) => set(s => ({ tournament, pendingGame: null, version: s.version + 1 })),
  bump: () => set(s => ({ version: s.version + 1 })),
  clear: () => set(s => ({ tournament: null, pendingGame: null, version: s.version + 1 })),

  startGame: (match) => {
    const playerSlot = match.players.findIndex((p: any) => p.isPlayer) as 0 | 1 | -1;
    if (playerSlot < 0) return;
    const other = (1 - playerSlot) as 0 | 1;
    const t = get().tournament;
    set(s => ({
      pendingGame: {
        matchId: match.id,
        playerSlot: playerSlot as 0 | 1,
        opponentName: match.players[other].name,
        opponentDeck: match.players[other].deck,
        opponentAvatarId: match.players[other].avatarId ?? null,
        playerDeckName: t?.playerDeckName ?? match.players[playerSlot].deckName,
        gameNumber: match.wins[0] + match.wins[1] + 1,
        score: [match.wins[playerSlot], match.wins[other]],
      },
      version: s.version + 1,
    }));
  },

  // Solde la manche jouée. Une égalité (PV identiques après 5 tours) ne compte
  // pour personne : la manche est simplement rejouée.
  finishGame: (winner) => {
    const { tournament, pendingGame } = get();
    if (tournament && pendingGame && (winner === 'player' || winner === 'enemy')) {
      const match = tournament.rounds.flat().find((m: any) => m.id === pendingGame.matchId);
      if (match && !match.winner) {
        const slot = winner === 'player' ? pendingGame.playerSlot : (1 - pendingGame.playerSlot);
        recordGameResult(match, slot);
        // Manche qui scelle la finale → tournoi remporté. Crédité ici et pas
        // dans l'écran Tournoi : c'est le seul point de passage obligé, et il
        // ne s'exécute qu'une fois (l'écran, lui, se rend en boucle).
        if (isTournamentComplete(tournament) && getChampion(tournament)?.isPlayer) {
          void useAuthStore.getState().claimReward('tournament_win');
        }
      }
    }
    set(s => ({ pendingGame: null, version: s.version + 1 }));
  },
}));
