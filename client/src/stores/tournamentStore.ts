/* eslint-disable @typescript-eslint/no-explicit-any */
// tournamentStore — état du tournoi en cours, HORS composant : le bracket doit
// survivre à la navigation `tournament → game → tournament` (le joueur joue
// réellement ses matchs, l'écran Tournoi est donc démonté entre deux manches).
//
// Connecté, le bracket est aussi gardé en base (`/api/me/tournament`) : on le
// reprend sur un autre appareil, ou après un F5. ⚠️ `pendingGame` N'EST PAS
// persisté : une manche en cours qu'on abandonne en changeant d'appareil est
// simplement rejouée. En invité, le bracket reste en mémoire.
//
// Les matchs IA restent simulés (MatchSimulator) ; seul le match du joueur
// passe par GameScreen. `pendingGame` est le contrat entre les deux écrans :
// posé par l'écran Tournoi avant de naviguer, consommé par GameScreen au
// montage, soldé par `finishGame()` au retour.
import { create } from 'zustand';
import {
  recordGameResult, isTournamentComplete, getChampion,
  serializeTournament, restoreTournament,
} from '../logic/Tournament.js';
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
  /** Numéro de la manche dans le Bo3 (1-indexé). */
  gameNumber: number;
  /** Score du match au lancement de la manche, [joueur, adversaire]. */
  score: [number, number];
}

interface TournamentStoreState {
  tournament: any | null;
  /** Révision du bracket persisté (compteur monotone, garde contre un appareil périmé). */
  rev: number;
  pendingGame: PendingGame | null;
  /** Compteur de rendu : le bracket est muté en place par logic/Tournament.js. */
  version: number;

  setTournament: (t: any | null) => void;
  bump: () => void;
  clear: () => void;
  /** Oublie le bracket SANS toucher au serveur (déconnexion). */
  reset: () => void;
  /** Reprend le bracket du compte s'il est plus récent que le local. */
  hydrate: () => Promise<void>;
  startGame: (match: any) => void;
  finishGame: (winner: 'player' | 'enemy' | 'draw' | null) => void;
}

const PERSIST_DELAY_MS = 300;
let _persistTimer: ReturnType<typeof setTimeout> | null = null;

const loggedIn = () => !!useAuthStore.getState().user;

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

function schedulePersist(bumpRev = true): void {
  if (!loggedIn()) return;
  const { tournament } = useTournamentStore.getState();
  if (!tournament) return;
  if (bumpRev) useTournamentStore.setState(s => ({ rev: s.rev + 1 }));
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => { _persistTimer = null; void pushNow(); }, PERSIST_DELAY_MS);
}

async function pushNow(): Promise<void> {
  const { tournament, rev } = useTournamentStore.getState();
  if (!tournament || !loggedIn()) return;
  try {
    const res = await fetch('/api/me/tournament', {
      method: 'PUT',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournament: serializeTournament(tournament), rev }),
    });
    if (res.status === 409) {
      // Un autre appareil a avancé : on adopte sa version.
      const j = await readJson(res);
      if (j && Number.isInteger(j.rev)) {
        useTournamentStore.setState(s => ({
          tournament: restoreTournament(j.tournament), rev: j.rev, pendingGame: null, version: s.version + 1,
        }));
      }
    }
  } catch { /* hors-ligne : repoussé à la prochaine mutation / hydratation */ }
}

export const useTournamentStore = create<TournamentStoreState>((set, get) => ({
  tournament: null,
  rev: 0,
  pendingGame: null,
  version: 0,

  setTournament: (tournament) => {
    set(s => ({ tournament, pendingGame: null, version: s.version + 1 }));
    schedulePersist();
  },
  bump: () => {
    set(s => ({ version: s.version + 1 }));
    schedulePersist();
  },
  clear: () => {
    if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
    set(s => ({ tournament: null, pendingGame: null, version: s.version + 1 }));
    if (!loggedIn()) return;
    // Pierre tombale côté serveur : la révision continue de monter.
    void fetch('/api/me/tournament', { method: 'DELETE', credentials: 'include' })
      .then(readJson)
      .then(j => { if (j && Number.isInteger(j.rev)) set(s => ({ rev: Math.max(s.rev, j.rev) })); })
      .catch(() => { /* hors-ligne : le bracket reviendra à la prochaine hydratation */ });
  },
  reset: () => {
    if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
    set(s => ({ tournament: null, rev: 0, pendingGame: null, version: s.version + 1 }));
  },

  hydrate: async () => {
    if (!loggedIn()) return;
    let j: any = null;
    try {
      const res = await fetch('/api/me/tournament', { credentials: 'include' });
      if (!res.ok) return;
      j = await readJson(res);
    } catch { return; /* hors-ligne */ }
    if (!j || !Number.isInteger(j.rev)) return;
    const { rev, pendingGame, tournament } = get();
    // Une manche est en cours sur CET appareil : on ne la lui retire pas.
    if (pendingGame) return;
    if (j.rev > rev) {
      set(s => ({ tournament: restoreTournament(j.tournament), rev: j.rev, version: s.version + 1 }));
    } else if (tournament && rev > j.rev) {
      schedulePersist(false); // progrès fait hors-ligne : on le pousse
    }
  },

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
    schedulePersist();
  },
}));
