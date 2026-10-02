/* eslint-disable @typescript-eslint/no-explicit-any */
// TournamentScreen — tournoi local à 16 (le joueur + 15 IA sur decks publics).
// Bracket entièrement côté client via logic/Tournament.js.
//
// Les matchs entre IA sont résolus par simulation déterministe (MatchSimulator,
// headless) dès qu'un round est ouvert ; le match du joueur, lui, se JOUE :
// chaque manche du Bo3 (2 victoires) lance une vraie partie (GameScreen, mode
// tournoi) et le résultat est reporté dans le bracket au retour. Le bracket vit dans
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
import { Button, Modal } from '../components/ui/primitives.js';
import UiIcon from '../components/ui/UiIcon.js';
import SelectedDeck from '../components/deck/SelectedDeck.js';
import MusicThemePicker from '../components/ui/MusicThemePicker.js';
import { useWebLayout } from '../components/system/useWebLayout.js';

const ROUND_LABELS = ['Huitièmes de finale', 'Quarts de finale', 'Demi-finales', 'Finale'];

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

  const web = useWebLayout();
  const classname_title = `border-b border-line py-3${web ? ' px-22' : ' px-6'}`;
  const classname_body = `flex-1 space-y-4 overflow-y-auto p-4${web ? ' px-22' : ' px-6'}`;
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  // ⚠️ Le `.catch` n'est pas décoratif : sans lui, un catalogue injoignable
  // (hors ligne, 500) laissait `ready` à false pour toujours, avec une
  // promesse rejetée non gérée en prime. Même geste qu'`App.tsx`, seul site
  // du projet qui le faisait déjà.
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

  const complete = !!tournament && isTournamentComplete(tournament);
  const champion = tournament && getChampion(tournament);
  const eliminated = !!tournament && isPlayerEliminated(tournament);
  const playerMatch = tournament && !complete ? findPlayerMatch(tournament) : null;

  const header = (
    <div className={classname_title}>
      <h1 className="text-lg font-bold tracking-wide">Tournoi</h1>
    </div>
  );

  if (error || !ready) {
    return (
      <main className="flex min-h-full flex-col relative z-10 text-white">
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

  if (!tournament) {
    return (
      <main className="flex min-h-full flex-col relative z-10 text-white">
        {header}
        <div className={classname_body}>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <UiIcon id="UI_TOURNAMENT" className="h-10 w-10" />
            <p className="max-w-xs text-sm text-white/60">
              16 joueurs (toi + 15 IA sur decks publics), élimination directe, chaque match en Bo3
              (2 manches gagnantes). Tes matchs se jouent manche par manche ; ceux des IA sont simulés.
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
        </div>
      </main>
    );
  }

  // Un seul calcul de vue, partagé par les deux mises en page.
  const view = buildView(tournament, { playerMatch, complete, eliminated, champion });
  const showMusic = !complete && !eliminated;

  const abandon = !complete && (
    <button
      type="button"
      onPointerDown={() => setConfirmAbandon(true)}
      className={`flex items-center gap-1 text-xs font-semibold text-danger/85 ${web ? 'min-h-9 px-1' : 'min-h-11 px-2.5'}`}
    >
      <UiIcon id="UI_CLOSE" className="h-3.5 w-3.5 opacity-80" /> Abandonner
    </button>
  );

  const mainButton = (
    <div className="flex flex-col gap-2.5">
      <Button
        variant="primary"
        className="min-h-tap w-full py-3 text-base"
        onPointerDown={() => (playerMatch ? playMatch(playerMatch) : complete ? clearTournament() : nextRound())}
      >
        <UiIcon id="UI_DUEL" className="h-4 w-4" />
        {playerMatch ? `Jouer la manche ${playerMatch.wins[0] + playerMatch.wins[1] + 1}` : complete ? 'Nouveau tournoi' : 'Round suivant'}
      </Button>
      {eliminated && !complete && (
        <p className="text-center text-xs text-white/40">Tu es éliminé · déroule le bracket pour voir le champion.</p>
      )}
    </div>
  );

  const confirm = confirmAbandon && (
    <Modal onClose={() => setConfirmAbandon(false)}>
      <div className="flex flex-col gap-3 text-center">
        <div className="text-sm font-bold">Abandonner le tournoi ?</div>
        <p className="text-xs text-white/60">Ta progression sera perdue.</p>
        <div className="flex gap-2">
          <Button className="flex-1" onPointerDown={() => setConfirmAbandon(false)}>Annuler</Button>
          <Button variant="danger" className="flex-1" onPointerDown={() => { setConfirmAbandon(false); clearTournament(); }}>Abandonner</Button>
        </div>
      </div>
    </Modal>
  );

  if (web) {
    return (
      <main className="relative z-10 grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] gap-4 text-white pl-[max(5.5rem,env(safe-area-inset-left))] pr-[max(5.5rem,env(safe-area-inset-right))]">
        <aside className="flex min-h-0 flex-col gap-2.5 pb-3.5 pt-2.5">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-wide">Tournoi</h1>
            <span className="ml-auto">{abandon}</span>
          </div>
          <VsHero compact view={view} />
          {showMusic && <MusicThemePicker />}
          {mainButton}
        </aside>
        <section className="flex min-h-0 flex-col gap-3.5 overflow-y-auto pb-4 pt-3.5">
          <PathTimeline view={view} />
          <OtherMatches view={view} />
        </section>
        {confirm}
      </main>
    );
  }

  return (
    <main className="relative z-10 flex h-full min-h-0 flex-col text-white">
      <div className="flex items-center border-b border-line px-6 py-1">
        <h1 className="text-lg font-bold tracking-wide">Tournoi</h1>
        <span className="ml-auto">{abandon}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-4">
        <VsHero view={view} />
        <PathTimeline view={view} />
        <OtherMatches view={view} />
      </div>
      <div className="flex shrink-0 flex-col gap-2.5 border-t border-line bg-surface/95 px-4 pb-4 pt-3">
        {showMusic && <MusicThemePicker />}
        {mainButton}
      </div>
      {confirm}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Vue dérivée du bracket — fonctions pures, sans mutation de `t`.

type StepTone = 'won' | 'lost' | 'current' | 'todo';
interface Step {
  label: string; tone: StepTone; dim: boolean;
  opponents: any[];            // 0 (inconnu), 1 ou 2 (« A ou B »)
  unknownCount: number;        // nb d'adversaires possibles quand aucun n'est connu
  score: string | null;
}
interface View {
  heroLabel: string; heroTone: 'gold' | 'success' | 'danger'; champion: boolean;
  opp: any | null; playerWins: number; oppWins: number;
  steps: Step[]; others: any[]; othersLabel: string;
}

// Arbre projeté sur 4 rounds : slots inconnus = null.
function projectBracket(t: any) {
  const rounds: any[][] = [];
  let seats = t.rounds[0].flatMap((m: any) => m.players);
  for (let r = 0; r < 4; r++) {
    const real = t.rounds[r];
    const ms = real ?? Array.from({ length: seats.length / 2 }, (_, k) => ({ players: [seats[2 * k], seats[2 * k + 1]], wins: [0, 0], winner: null }));
    rounds.push(ms);
    seats = ms.map((m: any) => m.winner ?? null);
  }
  return rounds;
}

function buildView(t: any, s: { playerMatch: any; complete: boolean; eliminated: boolean; champion: any }): View {
  const ri: number = t.currentRoundIndex;
  const roundName = (r: number) => (ROUND_LABELS[r] ?? `Round ${r + 1}`).toUpperCase();
  const projected = projectBracket(t);
  const first: any[] = t.rounds[0];
  const pIdx = first.findIndex(m => m.players.some((p: any) => p.isPlayer));
  const pos = pIdx * 2 + (first[pIdx].players[0].isPlayer ? 0 : 1);

  // Dernier match du joueur (le plus récent round où il figure).
  let lastR = -1; let last: any = null;
  t.rounds.forEach((round: any[], r: number) => {
    const m = round.find(x => x.players.some((p: any) => p.isPlayer));
    if (m) { lastR = r; last = m; }
  });
  const slotOf = (m: any) => (m.players[0].isPlayer ? 0 : 1);

  const steps: Step[] = [];
  let lostAt = -1;
  for (let r = 0; r < 4; r++) {
    const real = t.rounds[r]?.find((x: any) => x.players.some((p: any) => p.isPlayer));
    const label = ROUND_LABELS[r] ?? `Round ${r + 1}`;
    if (real) {
      const sl = slotOf(real);
      const lost = !!real.winner && !real.winner.isPlayer;
      const won = !!real.winner && real.winner.isPlayer;
      if (lost) lostAt = r;
      steps.push({
        label, tone: lost ? 'lost' : won ? 'won' : 'current', dim: false,
        opponents: [real.players[1 - sl]], unknownCount: 0,
        score: `${real.wins[sl]}–${real.wins[1 - sl]}`,
      });
      continue;
    }
    if (lostAt >= 0) { steps.push({ label, tone: 'todo', dim: true, opponents: [], unknownCount: 0, score: null }); continue; }
    const mi = pos >> (r + 1);
    const sd = (pos >> r) & 1;
    const opp = projected[r][mi]?.players[1 - sd] ?? null;
    let opponents: any[] = opp ? [opp] : [];
    let unknownCount = 0;
    if (!opp && r > 0) {
      const feeder = projected[r - 1][2 * mi + (1 - sd)];
      if (feeder?.players[0] && feeder?.players[1]) opponents = [feeder.players[0], feeder.players[1]];
      else unknownCount = 2 ** r;
    }
    steps.push({ label, tone: 'todo', dim: false, opponents, unknownCount, score: null });
  }

  let heroLabel: string; let heroTone: View['heroTone'] = 'gold'; let opp: any = null; let pw = 0; let ow = 0;
  const m = s.playerMatch ?? last;
  if (m) {
    const sl = slotOf(m);
    opp = m.players[1 - sl]; pw = m.wins[sl]; ow = m.wins[1 - sl];
  }
  const isChampion = s.complete && !!s.champion?.isPlayer;
  if (s.playerMatch) heroLabel = `${roundName(ri)} · MANCHE ${pw + ow + 1} / 3`;
  else if (isChampion) heroLabel = 'CHAMPION DU TOURNOI';
  else if (s.eliminated) { heroLabel = `ÉLIMINÉ EN ${roundName(lastR)}`; heroTone = 'danger'; }
  else { heroLabel = `QUALIFIÉ POUR ${roundName(Math.min(ri + 1, 3))}`; heroTone = 'success'; }

  const others = (t.rounds[ri] as any[]).filter(x => !x.players.some((p: any) => p.isPlayer));
  return {
    heroLabel, heroTone, champion: isChampion, opp, playerWins: pw, oppWins: ow, steps, others,
    othersLabel: ROUND_LABELS[ri] ?? `Round ${ri + 1}`,
  };
}

// ---------------------------------------------------------------------------
// Composants

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <h2 className="text-[10px] font-semibold tracking-widest text-white/40">{children}</h2>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function BoPips({ wins, side, compact }: { wins: number; side: 'player' | 'enemy'; compact?: boolean }) {
  const dot = compact ? 'h-2 w-2' : 'h-2.5 w-2.5';
  return (
    <div className="flex gap-1" aria-label={`${wins} manche${wins > 1 ? 's' : ''} gagnée${wins > 1 ? 's' : ''}`}>
      {[0, 1].map(i => (
        <span
          key={i}
          className={`${dot} rounded-full ${wins > i ? (side === 'player' ? 'bg-gold' : 'bg-enemy') : 'shadow-[inset_0_0_0_1px_rgba(255,255,255,.25)]'}`}
        />
      ))}
    </div>
  );
}

function VsHero({ view, compact }: { view: View; compact?: boolean }) {
  const tone = view.heroTone === 'gold' ? 'text-gold' : view.heroTone === 'success' ? 'text-success' : 'text-danger';
  const border = view.heroTone === 'danger' ? 'border-danger/50' : 'border-gold/50';
  const size = compact ? 'h-11 w-11' : 'h-[72px] w-[72px]';
  return (
    <div className={`flex flex-col border bg-surface-raised/70 ${border} ${compact ? 'min-h-0 flex-1 justify-center gap-2 rounded-xl px-3 py-2.5' : 'gap-3 rounded-2xl px-3 py-4'}`}>
      <div className={`flex items-center justify-center gap-1.5 font-semibold tracking-widest ${compact ? 'text-[9px]' : 'text-[10px]'} ${tone}`}>
        {view.champion && <UiIcon id="UI_VICTORY" className="h-4 w-4" />}
        <span className="text-center">{view.heroLabel}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <Portrait p={{ isPlayer: true }} size={size} round="rounded-[14px]" ring="ring-2 ring-gold" />
          <span className="text-sm font-bold text-gold">Vous</span>
          <BoPips wins={view.playerWins} side="player" compact={compact} />
        </div>
        <span className="text-xs font-bold tracking-widest text-white/35">VS</span>
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          {view.opp && <Portrait p={view.opp} size={size} round="rounded-[14px]" ring="ring-2 ring-enemy" />}
          <span className="max-w-full truncate text-sm font-bold">{view.opp?.name ?? '—'}</span>
          <BoPips wins={view.oppWins} side="enemy" compact={compact} />
        </div>
      </div>
      {!compact && <p className="text-center text-xs text-white/50">Bo3 · 2 manches gagnantes</p>}
    </div>
  );
}

const TONE: Record<StepTone, { dot: string; line: string; text: string }> = {
  won: { dot: 'border-success bg-success', line: 'bg-success', text: 'text-success' },
  lost: { dot: 'border-danger bg-danger', line: 'bg-danger', text: 'text-danger' },
  current: { dot: 'border-gold bg-surface shadow-[0_0_10px_-1px_var(--color-gold)]', line: 'bg-line', text: 'text-gold' },
  todo: { dot: 'border-line', line: 'bg-line', text: 'text-white/40' },
};

function PathTimeline({ view }: { view: View }) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeader>MON PARCOURS</SectionHeader>
      <div className="flex flex-col">
        {view.steps.map((st, i) => {
          const c = TONE[st.tone];
          const last = i === view.steps.length - 1;
          const names = st.opponents.length
            ? st.opponents.map((o: any) => o.name).join(' ou ')
            : st.unknownCount ? `${st.unknownCount} adversaires possibles` : '—';
          return (
            <div key={i} className={`grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 ${st.dim ? 'opacity-40' : st.tone === 'todo' ? 'opacity-70' : ''}`}>
              <div className="flex flex-col items-center">
                <span className={`mt-3.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${c.dot}`} />
                {!last && <span className={`w-0.5 flex-1 ${c.line}`} />}
              </div>
              <div className="flex min-h-11 items-center gap-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className={`text-[10px] font-semibold tracking-widest ${c.text}`}>
                    {st.label.toUpperCase()}{st.tone === 'current' && ' · EN COURS'}
                  </div>
                  <div className="truncate text-[13px] font-semibold">{names}</div>
                </div>
                {st.opponents.length > 0 && (
                  <div className="flex shrink-0">
                    {st.opponents.map((o: any, k: number) => (
                      <Portrait key={k} p={o} size="h-7 w-7" round="rounded-[7px]" ring={`ring-2 ring-surface${k ? ' -ml-1.5' : ''}`} />
                    ))}
                  </div>
                )}
                <span className={`w-[34px] shrink-0 text-right text-xs font-bold tabular-nums ${c.text}`}>{st.score ?? ''}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OtherMatches({ view }: { view: View }) {
  if (view.others.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeader>AUTRES MATCHS · {view.othersLabel.toUpperCase()}</SectionHeader>
      <div className="flex flex-col">
        {view.others.map((m: any) => {
          const [a, b] = m.players;
          const done = !!m.winner;
          const side = (p: any, w: number, right?: boolean) => (
            <div className={`flex min-w-0 items-center gap-1.5 ${right ? 'flex-row-reverse text-right' : ''} ${done && m.winner !== p ? 'opacity-45' : ''}`}>
              <Portrait p={p} size="h-[22px] w-[22px]" round="rounded-md" />
              <span className={`min-w-0 truncate ${done && m.winner === p ? 'text-gold' : ''}`}>{p.name}</span>
              <span className="sr-only">{w}</span>
            </div>
          );
          return (
            <div key={m.id} className="grid min-h-9 grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] items-center gap-1.5 text-xs">
              {side(a, m.wins[0])}
              <span className="text-center font-bold tabular-nums text-white/50">{done ? `${m.wins[0]}–${m.wins[1]}` : '–'}</span>
              {side(b, m.wins[1], true)}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Portrait d'un participant : celui du deck public pour une IA (`avatarId`),
// l'avatar de profil pour le joueur — qui peut être une image ou un emoji, et
// retombe sur ★ en invité. Un slot vide au milieu de sept portraits se lirait
// comme un bug, donc chaque branche rend quelque chose.
function Portrait({ p, size = 'h-8 w-8', round = 'rounded-lg', ring = 'ring-1 ring-line' }: { p: any; size?: string; round?: string; ring?: string }) {
  const user = useAuthStore(s => s.user);
  const frame = `${size} flex-shrink-0 overflow-hidden ${round} bg-surface object-cover ${ring}`;

  if (!p.isPlayer) {
    return <img src={(PublicDeckDatabase as any).avatarUrl(p.avatarId ?? 'PUBLIC_DECK_000')} alt="" className={frame} />;
  }
  const avatar = ((user as any)?.avatar ?? '').trim();
  if (avatar && /^(https?:|data:|\/)/i.test(avatar)) return <img src={avatar} alt="" className={frame} />;
  return (
    <span className={`${frame} flex items-center justify-center bg-surface-raised text-sm`}>
      {avatar ? avatar.slice(0, 2) : <UiIcon id="UI_VETERAN" className="h-1/2 w-1/2 opacity-70" />}
    </span>
  );
}

// Corps centré, rendu SOUS l'en-tête — et non à sa place. C'était un `<main>`
// tant qu'il remplaçait l'écran entier ; il est désormais imbriqué dans celui de
// l'écran, où un second `<main>` serait du HTML invalide.
function Center({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">{children}</div>;
}
