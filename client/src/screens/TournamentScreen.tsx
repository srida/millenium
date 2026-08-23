/* eslint-disable @typescript-eslint/no-explicit-any */
// TournamentScreen — tournoi local à 8 (le joueur + 7 IA sur decks publics).
// Bracket entièrement côté client via logic/Tournament.js.
//
// Les matchs entre IA sont résolus par simulation déterministe (MatchSimulator,
// headless) dès qu'un round est ouvert ; le match du joueur, lui, se JOUE :
// chaque manche du Bo5 lance une vraie partie (GameScreen, mode tournoi) et le
// résultat est reporté dans le bracket au retour. Le bracket vit dans
// `tournamentStore` — cet écran est démonté pendant qu'on joue.
import { useEffect, useState, type ReactNode } from 'react';
import * as CardDatabase from '../data/CardDatabase.js';
import * as AttributeDatabase from '../data/AttributeDatabase.js';
import * as PublicDeckDatabase from '../data/PublicDeckDatabase.js';
import * as DeckRepository from '../data/DeckRepository.js';
import {
  createTournament, resolveAiMatches, findPlayerMatch, isRoundComplete,
  buildNextRound, isTournamentComplete, getChampion, isPlayerEliminated,
} from '../logic/Tournament.js';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useTournamentStore } from '../stores/tournamentStore.js';
import { Button } from '../components/ui/primitives.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import SelectedDeck from '../components/deck/SelectedDeck.js';

const ROUND_LABELS = ['Quarts de finale', 'Demi-finales', 'Finale'];

export default function TournamentScreen() {
  const navigate = useUiStore(s => s.navigate);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tournament = useTournamentStore(s => s.tournament);
  const setTournament = useTournamentStore(s => s.setTournament);
  const clearTournament = useTournamentStore(s => s.clear);
  const startGame = useTournamentStore(s => s.startGame);
  const bump = useTournamentStore(s => s.bump);
  // Re-rendu quand le bracket (muté en place) change.
  useTournamentStore(s => s.version);
  // Deck engagé dans le tournoi = deck actif (choisi au menu). Le bracket est
  // bâti dessus au lancement : changer de deck actif ensuite ne le modifie plus.
  const deckName = ((DeckRepository as any).getActiveDeck?.() as string | null) ?? null;

  // ⚠️ Le `.catch` n'est pas décoratif : sans lui, un catalogue injoignable
  // (hors ligne, 500) laissait `ready` à false pour toujours — et comme l'écran
  // retournait AVANT son ScreenHeader, le joueur restait sur « Chargement… »
  // sans titre ni bouton retour, avec une promesse rejetée non gérée en prime.
  // Même geste qu'`App.tsx`, seul site du projet qui le faisait déjà.
  useEffect(() => {
    (PublicDeckDatabase as any).init()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  const playerDeck = deckName ? (DeckRepository as any).loadDeck(deckName) : null;

  function resolveAiOfCurrentRound(t: any) {
    const deps = { attributeList: (AttributeDatabase as any).getAllAttributes(), cardDb: CardDatabase };
    resolveAiMatches(t.rounds[t.currentRoundIndex], deps);
  }

  function start() {
    if (!deckName || !playerDeck) return;
    const publicDecks = ((PublicDeckDatabase as any).getAllDecks() as any[]).map(d => ({ id: d.id, name: d.name, deck: d.deck }));
    const t = createTournament(deckName, { playerDeck, publicDecks });
    resolveAiOfCurrentRound(t);
    setTournament(t);
  }

  function nextRound() {
    const t = tournament;
    if (!isRoundComplete(t.rounds[t.currentRoundIndex])) return;
    if (!isTournamentComplete(t)) { buildNextRound(t); resolveAiOfCurrentRound(t); }
    bump();
  }

  function playMatch(match: any) {
    startGame(match);
    navigate('game', { tournament: true });
  }

  const complete = tournament && isTournamentComplete(tournament);
  const champion = tournament && getChampion(tournament);
  const eliminated = tournament && isPlayerEliminated(tournament);
  const playerMatch = tournament && !complete ? findPlayerMatch(tournament) : null;

  // ⚠️ L'en-tête est rendu AVANT tout état, jamais après : c'est lui qui porte
  // le bouton retour. Un écran qui le saute pour afficher « Chargement… » ou
  // une erreur enferme le joueur dedans.
  const header = <ScreenHeader title="Tournoi" onBack={() => navigate('main_menu')} />;

  if (error || !ready) {
    return (
      <main className="flex min-h-dvh flex-col relative z-10 text-white">
        {header}
        <Center>
          {error
            ? <>
                <p className="text-sm font-semibold text-danger">Impossible de charger les decks adverses</p>
                <p className="text-xs text-white/40">{error}</p>
              </>
            : <span className="text-gold">Chargement…</span>}
        </Center>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col relative z-10 text-white">
      {header}

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!tournament ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="text-4xl">🏆</div>
            <p className="max-w-xs text-sm text-white/60">
              8 joueurs (toi + 7 IA sur decks publics), élimination directe, chaque match en Bo5.
              Tes matchs se jouent manche par manche ; ceux des IA sont simulés.
            </p>
            <div className="w-full max-w-sm text-left">
              <SelectedDeck deckName={deckName} emptyHint="Choisis un deck pour entrer en tournoi." />
            </div>
            {playerDeck && (
              <Button variant="primary" className="px-6 py-3" onPointerDown={start}>
                Lancer le tournoi
              </Button>
            )}
          </div>
        ) : (
          <>
            {tournament.rounds.map((round: any[], ri: number) => (
              <section key={ri}>
                <h2 className="mb-1.5 text-[10px] tracking-widest text-white/40">
                  {(ROUND_LABELS[ri] ?? `Round ${ri + 1}`).toUpperCase()}
                </h2>
                <div className="space-y-1.5">
                  {round.map((m: any) => <MatchRow key={m.id} match={m} live={m === playerMatch} />)}
                </div>
              </section>
            ))}

            <div className="space-y-2 pt-2">
              {complete ? (
                <div className="rounded-xl border border-gold/40 bg-gold/10 p-4 text-center">
                  <div className="text-3xl">👑</div>
                  {champion && (
                    <div className="mt-1 flex justify-center">
                      <Portrait p={champion} won size="h-12 w-12" />
                    </div>
                  )}
                  <div className="mt-1 text-sm">Champion : <span className="font-bold text-gold">{champion?.isPlayer ? 'Vous' : champion?.name}</span></div>
                  <div className={`mt-1 text-xs ${champion?.isPlayer ? 'text-success' : eliminated ? 'text-danger' : 'text-white/50'}`}>
                    {champion?.isPlayer ? '🎉 Tu remportes le tournoi !' : eliminated ? 'Tu as été éliminé.' : 'Tournoi terminé.'}
                  </div>
                  <Button className="mt-3" onPointerDown={clearTournament}>Nouveau tournoi</Button>
                </div>
              ) : playerMatch ? (
                <>
                  <Button variant="primary" className="w-full py-3" onPointerDown={() => playMatch(playerMatch)}>
                    ▸ JOUER LA MANCHE {playerMatch.wins[0] + playerMatch.wins[1] + 1}
                  </Button>
                  <p className="text-center text-xs text-white/40">
                    vs {playerMatch.players.find((p: any) => !p.isPlayer)?.name} — premier à 3 manches.
                  </p>
                </>
              ) : (
                <>
                  <Button variant="primary" className="w-full py-3" onPointerDown={nextRound}>Round suivant ▸</Button>
                  {eliminated && <p className="text-center text-xs text-white/40">Tu es éliminé — déroule le bracket pour voir le champion.</p>}
                </>
              )}
              {!complete && <Button className="w-full" onPointerDown={clearTournament}>✕ Abandonner le tournoi</Button>}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function MatchRow({ match, live }: { match: any; live?: boolean }) {
  const [a, b] = match.players;
  return (
    <div className={`flex items-stretch overflow-hidden rounded-lg border bg-surface-raised/60 text-sm ${live ? 'border-gold/60' : 'border-line'}`}>
      <Slot p={a} score={match.wins[0]} won={match.winner === a} />
      <div className="flex items-center px-1 text-[10px] text-white/30">vs</div>
      <Slot p={b} score={match.wins[1]} won={match.winner === b} right />
    </div>
  );
}

function Slot({ p, score, won, right }: { p: any; score: number; won: boolean; right?: boolean }) {
  return (
    <div className={`flex flex-1 items-center gap-2 p-2 ${right ? 'flex-row-reverse text-right' : ''} ${won ? 'text-gold' : 'text-white/70'}`}>
      <span className={`tabular-nums text-xs font-bold ${won ? 'text-gold' : 'text-white/40'}`}>{score}</span>
      <Portrait p={p} won={won} />
      <span className={`min-w-0 flex-1 truncate ${p.isPlayer ? 'font-bold' : ''}`}>{p.isPlayer ? 'Vous' : p.name}</span>
    </div>
  );
}

// Portrait d'un participant : celui du deck public pour une IA (`avatarId`),
// l'avatar de profil pour le joueur — qui peut être une image ou un emoji, et
// retombe sur ★ en invité. Un slot vide au milieu de sept portraits se lirait
// comme un bug, donc chaque branche rend quelque chose.
function Portrait({ p, won, size = 'h-8 w-8' }: { p: any; won?: boolean; size?: string }) {
  const user = useAuthStore(s => s.user);
  const ring = won ? 'ring-gold/60' : 'ring-line';
  const frame = `${size} flex-shrink-0 overflow-hidden rounded-lg bg-surface object-cover ring-1 ${ring}`;

  if (!p.isPlayer) {
    return <img src={(PublicDeckDatabase as any).avatarUrl(p.avatarId ?? 'PUBLIC_DECK_000')} alt="" className={frame} />;
  }
  const avatar = ((user as any)?.avatar ?? '').trim();
  if (avatar && /^(https?:|data:|\/)/i.test(avatar)) return <img src={avatar} alt="" className={frame} />;
  return (
    <span className={`${frame} flex items-center justify-center bg-surface-raised text-sm`}>
      {avatar ? avatar.slice(0, 2) : '★'}
    </span>
  );
}

// Corps centré, rendu SOUS l'en-tête — et non à sa place. C'était un `<main>`
// tant qu'il remplaçait l'écran entier ; il est désormais imbriqué dans celui de
// l'écran, où un second `<main>` serait du HTML invalide.
function Center({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">{children}</div>;
}
