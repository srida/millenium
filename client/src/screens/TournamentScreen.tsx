/* eslint-disable @typescript-eslint/no-explicit-any */
// TournamentScreen — tournoi local à 8 (le joueur + 7 IA sur decks publics).
// Bracket entièrement côté client via logic/Tournament.js ; chaque match (y
// compris celui du joueur) est résolu par simulation déterministe du combat
// (MatchSimulator, headless). Révélé round par round.
import { useEffect, useState, type ReactNode } from 'react';
import * as CardDatabase from '../data/CardDatabase.js';
import * as AttributeDatabase from '../data/AttributeDatabase.js';
import * as PublicDeckDatabase from '../data/PublicDeckDatabase.js';
import * as DeckRepository from '../data/DeckRepository.js';
import { simulateMatch } from '../logic/MatchSimulator.js';
import {
  createTournament, resolveAiMatches, findPlayerMatch, isRoundComplete,
  buildNextRound, isTournamentComplete, getChampion, isPlayerEliminated,
} from '../logic/Tournament.js';
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';
import DeckPicker from '../components/deck/DeckPicker.js';

const ROUND_LABELS = ['Quarts de finale', 'Demi-finales', 'Finale'];

export default function TournamentScreen() {
  const navigate = useUiStore(s => s.navigate);
  const [ready, setReady] = useState(false);
  const [tournament, setTournament] = useState<any>(null);
  const [, bump] = useState(0);
  // Deck engagé dans le tournoi : initialisé sur le deck actif, choisi
  // explicitement avant le lancement (le bracket est bâti dessus, il ne change
  // plus une fois le tournoi démarré).
  const [deckName, setDeckName] = useState<string | null>(
    () => ((DeckRepository as any).getActiveDeck?.() as string | null) ?? null,
  );

  useEffect(() => { (PublicDeckDatabase as any).init().then(() => setReady(true)); }, []);

  const playerDeck = deckName ? (DeckRepository as any).loadDeck(deckName) : null;
  const deps = { attributeList: (AttributeDatabase as any).getAllAttributes(), cardDb: CardDatabase };

  function resolveCurrentRound(t: any) {
    const round = t.rounds[t.currentRoundIndex];
    const pm = findPlayerMatch(t);
    if (pm) {
      const { wins, winnerSlot } = simulateMatch(pm.players[0].deck, pm.players[1].deck, deps);
      pm.wins = wins;
      pm.winner = pm.players[winnerSlot];
    }
    resolveAiMatches(round, deps);
  }

  function start() {
    if (!deckName || !playerDeck) return;
    const publicDecks = ((PublicDeckDatabase as any).getAllDecks() as any[]).map(d => ({ name: d.name, deck: d.deck }));
    const t = createTournament(deckName, { playerDeck, publicDecks });
    resolveCurrentRound(t);
    setTournament(t);
  }

  function nextRound() {
    const t = tournament;
    if (!isRoundComplete(t.rounds[t.currentRoundIndex])) return;
    if (!isTournamentComplete(t)) { buildNextRound(t); resolveCurrentRound(t); }
    bump(n => n + 1);
  }

  if (!ready) return <Center><span className="text-gold">Chargement…</span></Center>;

  const complete = tournament && isTournamentComplete(tournament);
  const champion = tournament && getChampion(tournament);
  const eliminated = tournament && isPlayerEliminated(tournament);

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-white">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Button className="px-3" onPointerDown={() => navigate('main_menu')}>◂</Button>
        <h1 className="text-lg font-bold tracking-wide">Tournoi</h1>
        <span className="ml-auto truncate text-xs text-white/40">deck : {deckName ?? '—'}</span>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!tournament ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="text-4xl">🏆</div>
            <p className="max-w-xs text-sm text-white/60">8 joueurs (toi + 7 IA sur decks publics), élimination directe, chaque match en Bo5 simulé.</p>
            <div className="w-full max-w-sm text-left">
              <DeckPicker
                value={deckName}
                onChange={setDeckName}
                emptyHint="Crée un deck pour entrer en tournoi."
              />
            </div>
            <Button variant="primary" disabled={!playerDeck} className="px-6 py-3" onPointerDown={start}>
              Lancer le tournoi
            </Button>
            {!playerDeck && <p className="text-xs text-white/40">Choisis un deck pour lancer le tournoi.</p>}
          </div>
        ) : (
          <>
            {tournament.rounds.map((round: any[], ri: number) => (
              <section key={ri}>
                <h2 className="mb-1.5 text-[10px] tracking-widest text-white/40">
                  {(ROUND_LABELS[ri] ?? `Round ${ri + 1}`).toUpperCase()}
                </h2>
                <div className="space-y-1.5">
                  {round.map((m: any) => <MatchRow key={m.id} match={m} />)}
                </div>
              </section>
            ))}

            <div className="pt-2">
              {complete ? (
                <div className="rounded-xl border border-gold/40 bg-gold/10 p-4 text-center">
                  <div className="text-3xl">👑</div>
                  <div className="mt-1 text-sm">Champion : <span className="font-bold text-gold">{champion?.name}</span></div>
                  <div className={`mt-1 text-xs ${champion?.isPlayer ? 'text-success' : eliminated ? 'text-danger' : 'text-white/50'}`}>
                    {champion?.isPlayer ? '🎉 Tu remportes le tournoi !' : eliminated ? 'Tu as été éliminé.' : 'Tournoi terminé.'}
                  </div>
                  <Button className="mt-3" onPointerDown={() => setTournament(null)}>Nouveau tournoi</Button>
                </div>
              ) : (
                <Button variant="primary" className="w-full py-3" onPointerDown={nextRound}>Round suivant ▸</Button>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function MatchRow({ match }: { match: any }) {
  const [a, b] = match.players;
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-line bg-surface-raised/60 text-sm">
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
      <span className={`min-w-0 flex-1 truncate ${p.isPlayer ? 'font-bold' : ''}`}>{p.isPlayer ? '★ Vous' : p.name}</span>
    </div>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-white">{children}</main>;
}
