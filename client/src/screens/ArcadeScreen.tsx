/* eslint-disable @typescript-eslint/no-explicit-any */
// ArcadeScreen — la run solo quotidienne : 4 duels enchaînés contre des decks
// publics tirés par difficulté croissante, l'IA gagnant à chaque échelon un
// handicap d'ATK/PV plus lourd.
//
// Tout l'état vit côté SERVEUR (arcade.js) : cet écran ne fait qu'afficher
// l'instantané et taper deux boutons. C'est ce qui rend la run reprenable —
// s'arrêter entre deux duels, recharger la page ou changer d'appareil retombe
// sur le même parcours, au même échelon.
//
// Le deck engagé est le DECK ACTIF (choisi au menu principal), comme au Tournoi
// et au Duel en ligne : on n'en affiche qu'un récap en lecture seule.
import { useEffect, type ReactNode } from 'react';
import * as PublicDeckDatabase from '../data/PublicDeckDatabase.js';
import * as DeckRepository from '../data/DeckRepository.js';
import { useUiStore } from '../stores/uiStore.js';
import { useDeckStore } from '../stores/deckStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useArcadeStore, currentDuel, wonCount, type ArcadeDuel, type ArcadeBonus } from '../stores/arcadeStore.js';
import { Button, Countdown } from '../components/ui/primitives.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import SelectedDeck from '../components/deck/SelectedDeck.js';

const MIN_DECK = 20;

// Les libellés d'échelon vivent avec la donnée qui les porte
// (PublicDeckDatabase.difficultyLabel) : la sélection d'adversaire solo les
// affiche aussi, et deux copies finiraient par se contredire.
const difficultyLabel = (PublicDeckDatabase as any).difficultyLabel as (d: number) => string;

/** Handicap lisible. Un échelon sans bonus le dit — « rien » est une information. */
function bonusLabel(bonus: ArcadeBonus): string {
  if (!bonus.hp && !bonus.atk) return 'IA sans bonus';
  return `IA +${bonus.hp} PV / +${bonus.atk} ATK`;
}

export default function ArcadeScreen() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const snapshot = useArcadeStore(s => s.snapshot);
  const loading = useArcadeStore(s => s.loading);
  const busy = useArcadeStore(s => s.busy);
  const error = useArcadeStore(s => s.error);
  const granted = useArcadeStore(s => s.granted);
  const reportError = useArcadeStore(s => s.reportError);
  const dismissReportError = useArcadeStore(s => s.dismissReportError);
  const load = useArcadeStore(s => s.load);
  const start = useArcadeStore(s => s.start);

  const decks = useDeckStore(s => s.decks);
  const refreshDecks = useDeckStore(s => s.refresh);
  const deckName = ((DeckRepository as any).getActiveDeck?.() as string | null) ?? null;

  useEffect(() => { refreshDecks(); void load(true); }, [load, refreshDecks]);

  const activeDeck = deckName ? decks.find(d => d.name === deckName) ?? null : null;
  const deckReady = !!activeDeck && activeDeck.count >= MIN_DECK;

  if (!user) {
    return (
      <Center>
        <div className="text-4xl">🕹</div>
        <p className="text-sm text-white/60">L'Arcade a besoin d'un compte : la run du jour est gardée côté serveur.</p>
        <Button variant="primary" onPointerDown={() => navigate('auth')}>Se connecter</Button>
      </Center>
    );
  }

  if (!snapshot) {
    return (
      <Center>
        <span className={error ? 'text-danger' : 'text-gold'}>{error ?? (loading ? 'Chargement…' : 'Arcade indisponible.')}</span>
        <Button onPointerDown={() => navigate('main_menu')}>◂ Menu</Button>
      </Center>
    );
  }

  const run = snapshot.run;
  const duel = currentDuel(snapshot);
  const finished = !!run && run.status !== 'in_progress';

  return (
    <main className="flex min-h-dvh flex-col relative z-10 text-white">
      <ScreenHeader
        title="Arcade"
        onBack={() => navigate('main_menu')}
        right={<Countdown at={snapshot.next_rotation_at} title="Prochaine run" />}
        safeAreaTop
      />

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!run ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="text-4xl">🕹</div>
            <p className="max-w-xs text-sm text-white/60">
              {snapshot.duel_count} duels d'affilée contre des adversaires de plus en plus coriaces.
              Une seule run par jour, et une défaite y met fin.
            </p>
            <div className="w-full max-w-sm text-left">
              <SelectedDeck deckName={deckName} emptyHint="Choisis un deck avant de lancer une run." />
            </div>

            <section className="w-full max-w-sm space-y-1.5 text-left">
              <h2 className="text-[10px] tracking-widest text-white/40">LE PARCOURS</h2>
              {snapshot.plan.map(step => (
                <div key={step.index} className="flex items-center gap-3 rounded-lg border border-line bg-surface-raised/60 px-3 py-2">
                  <StepNumber n={step.index + 1} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white/70">
                      Adversaire {difficultyLabel(step.difficulty)}
                    </div>
                    <div className="text-[11px] text-white/40">{bonusLabel(step.bonus)}</div>
                  </div>
                </div>
              ))}
            </section>

            <p className="text-xs text-white/40">
              Parcours complet : <span className="text-gold">+{snapshot.reward.gold} 💰</span>
              {' · '}
              <span className="text-gold">+{snapshot.reward.xp} XP</span>
            </p>

            <Button
              variant="primary"
              className="px-6 py-3"
              disabled={!deckReady || busy}
              onPointerDown={() => { if (deckReady && !busy) void start(deckName); }}
            >
              Lancer la run
            </Button>
            {!deckReady && (
              <p className="text-xs text-white/40">
                Il faut un deck actif d'au moins {MIN_DECK} cartes pour engager une run.
              </p>
            )}
          </div>
        ) : (
          <>
            <section className="space-y-1.5">
              <h2 className="text-[10px] tracking-widest text-white/40">
                PARCOURS DU {snapshot.day} — {wonCount(run)}/{snapshot.duel_count}
              </h2>
              {run.duels.map(d => (
                <DuelRow key={d.index} duel={d} live={d.index === run.current && !finished} />
              ))}
            </section>

            <div className="space-y-2 pt-2">
              {duel ? (
                <>
                  <Button
                    variant="primary"
                    className="w-full py-3"
                    onPointerDown={() => navigate('game', { arcade: true })}
                  >
                    ▸ DUEL {duel.index + 1}/{snapshot.duel_count}
                  </Button>
                  <p className="text-center text-xs text-white/40">
                    vs {duel.deck_name} — {bonusLabel(duel.bonus)}.
                  </p>
                </>
              ) : run.status === 'won' ? (
                <div className="rounded-xl border border-gold/40 bg-gold/10 p-4 text-center">
                  <div className="text-3xl">👑</div>
                  <div className="mt-1 text-sm font-bold text-gold">Parcours complet !</div>
                  <div className="mt-1 text-xs text-success">
                    +{snapshot.reward.gold} 💰 · +{snapshot.reward.xp} XP
                  </div>
                  <p className="mt-2 text-xs text-white/40">
                    Prochaine run dans <Countdown at={snapshot.next_rotation_at} className="text-white/60" />
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-line bg-surface-raised/60 p-4 text-center">
                  <div className="text-3xl">💀</div>
                  <div className="mt-1 text-sm text-danger">
                    Run stoppée au duel {wonCount(run) + 1}.
                  </div>
                  <p className="mt-2 text-xs text-white/40">
                    Prochaine run dans <Countdown at={snapshot.next_rotation_at} className="text-white/60" />
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {granted && (
          <div className="rounded-lg border border-success/50 bg-success/10 p-3 text-center text-xs text-success">
            Récompense de run versée : +{granted.gold} 💰 · +{granted.xp} XP
          </div>
        )}
        {/* Un rapport de duel qui n'a pas pu partir se DIT. Le parcours affiché,
            lui, reste juste : il est relu du serveur au montage de l'écran. Le
            mot ne prétend donc pas ce qu'est devenu le duel (la requête a pu
            aboutir et seule la réponse se perdre) — il explique l'écart entre ce
            que le joueur vient de vivre et ce qu'il a sous les yeux, et désigne
            l'arbitre. Sans lui, une victoire retrouvée « à jouer » passe pour un
            vol. */}
        {reportError && (
          <div className="rounded-lg border border-danger/50 bg-danger/10 p-3 text-center text-xs text-danger">
            <div>Résultat du dernier duel non transmis ({reportError})</div>
            <div className="mt-1 text-white/50">Le parcours ci-dessus vient du serveur : c'est lui qui fait foi.</div>
            <button
              type="button"
              className="mt-2 text-[11px] text-white/40 underline"
              onPointerDown={dismissReportError}
            >
              Compris
            </button>
          </div>
        )}
        {error && <p className="text-center text-xs text-danger">{error}</p>}
      </div>
    </main>
  );
}

// Une ligne du parcours. L'adversaire porte le portrait de son deck public —
// le même visage qu'en sélection solo et dans le bracket de tournoi.
function DuelRow({ duel, live }: { duel: ArcadeDuel; live: boolean }) {
  const done = duel.result !== null;
  const won = duel.result === 'win';
  const tone = won ? 'text-success' : duel.result === 'loss' ? 'text-danger' : live ? 'text-gold' : 'text-white/50';
  const border = live ? 'border-gold/60' : 'border-line';

  return (
    <div className={`flex items-center gap-3 rounded-lg border bg-surface-raised/60 px-3 py-2 ${border} ${done && !won ? 'opacity-70' : ''}`}>
      <StepNumber n={duel.index + 1} live={live} />
      <img
        src={(PublicDeckDatabase as any).avatarUrl(duel.deck_id)}
        alt=""
        className={`h-9 w-9 flex-shrink-0 overflow-hidden rounded-lg bg-surface object-cover ring-1 ${live ? 'ring-gold/60' : 'ring-line'}`}
      />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${live ? 'font-bold text-gold' : 'text-white/80'}`}>{duel.deck_name}</div>
        <div className="text-[11px] text-white/40">
          {difficultyLabel(duel.difficulty)} · {bonusLabel(duel.bonus)}
        </div>
      </div>
      <span className={`text-sm ${tone}`}>{won ? '✓' : duel.result === 'loss' ? '✗' : live ? '▸' : '·'}</span>
    </div>
  );
}

function StepNumber({ n, live }: { n: number; live?: boolean }) {
  return (
    <span
      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
        live ? 'bg-gold/20 text-gold' : 'bg-surface text-white/40'
      }`}
    >
      {n}
    </span>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 relative z-10 p-6 text-center text-white">{children}</main>;
}
