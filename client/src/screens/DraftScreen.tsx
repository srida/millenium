/* eslint-disable @typescript-eslint/no-explicit-any */
// DraftScreen — le draft du jour : trois lots de trois cartes liées, puis six
// choix d'une carte parmi trois (15 cartes), puis des duels EN LIGNE contre
// d'autres joueurs en draft (5 victoires pour gagner la run, 2 défaites la
// closent, une vie rachetable en gemmes). Après chaque duel qui ne clôt pas la
// run, une carte de plus à drafter. Chaque victoire paie des gemmes, 60 pour
// une run parfaite.
//
// La run est SERVEUR (`draft.js`) ; l'offre se dérive de sa graine
// (`logic/Draft.ts`). Le duel passe par la file du Duel en ligne (mode
// `draft`) et se joue dans `GameScreenPvp` ; c'est le serveur qui le solde.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as PvpConnection from '../net/PvpConnection.js';
import MatchFoundReveal, { MATCH_REVEAL_MS, type MatchOpponent } from '../components/online/MatchFoundReveal.js';
import { illustrationUrl } from '../data/CardArt.js';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useDraftStore, getDraftPool, type DraftRun, type DraftSnapshot } from '../stores/draftStore.js';
import {
  DRAFT_STEPS, DRAFT_SIZE, DRAFT_REROLLS, RUN_WINS, RUN_LOSSES,
  offerFor, currentStep, stepOf, pendingBonus, currentOpponent, canReroll, deckOf, maxLosses,
  type OfferKind, type OfferSlot, type DraftState,
} from '../logic/Draft.js';
import DeckTierGrid from '../components/deck/DeckTierGrid.js';
import Card3D, { cardVisualProps } from '../components/ui/Card3D.js';
import { Amount, Button, Countdown, LoadState } from '../components/ui/primitives.js';
import HoldConfirmButton from '../components/ui/HoldConfirmButton.js';
import { CURRENCY, fmt } from '../components/ui/currency.js';
import { GuestGate } from '../components/ui/GuestGate.js';
import MusicThemePicker from '../components/ui/MusicThemePicker.js';
import UiIcon from '../components/ui/UiIcon.js';
import { useWebLayout } from '../components/system/useWebLayout.js';
import type { Card } from '../logic/types.js';

/** Ce que l'écran dit de chaque emplacement. Le PARI est le seul à porter un
 *  avertissement : c'est la carte qu'on ne peut pas encore jouer. */
const KIND_LABEL: Record<Exclude<OfferKind, 'bundle'>, { text: string; tone: string }> = {
  complement: { text: 'Complète une recette', tone: 'text-success' },
  buildable: { text: 'Jouable', tone: 'text-white/50' },
  bet: { text: 'Pari : matériaux absents', tone: 'text-gold' },
};

const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

export default function DraftScreen() {
  const user = useAuthStore(s => s.user);
  const userId = user?.id ?? null;
  const snapshot = useDraftStore(s => s.snapshot);
  const loading = useDraftStore(s => s.loading);
  const error = useDraftStore(s => s.error);
  const load = useDraftStore(s => s.load);
  const hideTooltip = useUiStore(s => s.hideTooltip);
  // L'ID, jamais l'objet `user` (cf. authStore) : sinon la lecture boucle.
  useEffect(() => { if (userId) void load(true); }, [userId, load]);

  const web = useWebLayout();
  const pad = web ? ' px-22' : '';

  if (!user) return <GuestGate reason="Le Draft a besoin d'un compte : la run du jour et ses gemmes sont gardées côté serveur." />;

  const run = snapshot?.run ?? null;
  return (
    <main className="relative z-10 flex min-h-full flex-col text-white" onPointerDown={() => hideTooltip()}>
      <div className={`flex items-center gap-3 border-b border-line py-3${web ? ' px-22' : ' px-6'}`}>
        <h1 className="text-lg font-bold tracking-wide">Draft du jour</h1>
        {run && (run.status === 'drafting' || run.status === 'playing') ? (
          <span className="ml-auto text-xs text-white/50">
            {run.status === 'drafting'
              ? `Étape ${(currentStep(run)?.index ?? 0) + 1}/${DRAFT_STEPS.length}`
              : `${run.wins} V · ${run.losses} D`}
          </span>
        ) : snapshot && <Countdown at={snapshot.next_rotation_at} title="Prochain draft" className="ml-auto" />}
      </div>
      <div className={`flex-1 space-y-4 overflow-y-auto p-4${pad}`}>
        <LoadState error={error} loading={loading} hasContent={!!snapshot} />
        {snapshot && (!run ? <Intro snapshot={snapshot} />
          : run.status === 'drafting' ? <Picking state={run} />
            : run.status === 'playing' ? (pendingBonus(run) ? <Picking state={run} /> : <Ladder snapshot={snapshot} run={run} />)
              : <Finished snapshot={snapshot} run={run} />)}
      </div>
    </main>
  );
}

function Intro({ snapshot }: { snapshot: DraftSnapshot }) {
  const start = useDraftStore(s => s.start);
  const busy = useDraftStore(s => s.busy);
  const [err, setErr] = useState<string | null>(null);
  const total = sum(snapshot.rules.win_gems);
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-4 text-center">
      <UiIcon id="UI_CARD" className="h-10 w-10" />
      <p className="text-sm text-white/70">
        Construis un deck de {DRAFT_SIZE} cartes en jouant, tirées dans tout le catalogue — de quoi découvrir
        des cartes que tu n'as pas. D'abord trois lots de trois cartes liées par une recette, puis six cartes
        à choisir une par une, du tier 1 au tier 5.
      </p>
      <ul className="w-full space-y-1.5 text-left text-xs text-white/50">
        <li><span className="text-violet">Lot</span> : une carte et les matériels que sa recette nomme.</li>
        <li><span className="text-success">Complète une recette</span> : la carte apporte un matériel qui te manque.</li>
        <li><span className="text-white/70">Jouable</span> : tu peux la poser avec ce que tu as déjà.</li>
        <li><span className="text-gold">Pari</span> : ses matériaux te manquent encore. À toi de les trouver.</li>
      </ul>
      <p className="text-xs text-white/50">
        {DRAFT_REROLLS} relances pour toute la run. Ensuite, des duels en ligne contre d'autres joueurs en draft :
        {' '}{RUN_WINS} victoires pour gagner la run, {RUN_LOSSES} défaites y mettent fin
        (une vie de plus se rachète <Amount currency="gems" value={snapshot.rules.extra_life_price_gems} />).
        Après chaque duel, tu draftes une carte de plus.
      </p>
      <p className="text-xs text-white/70">
        Chaque victoire rapporte des gemmes, jusqu'à <Amount currency="gems" value={total} /> pour une run parfaite.
        Un draft par jour.
      </p>
      {err && <p className="text-xs text-danger">{err}</p>}
      <Button variant="primary" className="px-6 py-3" disabled={busy} onPointerDown={async () => setErr(await start())}>
        Lancer le draft du jour
      </Button>
    </div>
  );
}

function Picking({ state }: { state: DraftState }) {
  const pick = useDraftStore(s => s.pick);
  const reroll = useDraftStore(s => s.reroll);
  const busy = useDraftStore(s => s.busy);
  const [err, setErr] = useState<string | null>(null);
  const pool = getDraftPool();
  const offer = useMemo(() => offerFor(state, pool), [state, pool]);
  // La sélection est attachée à SON offre : un choix fait ou une relance
  // change la clé, et la sélection d'avant ne vaut plus rien.
  const offerKey = `${state.picks.length}:${state.rerolls}`;
  const [choice, setChoice] = useState<{ key: string; index: number } | null>(null);
  const selected = choice?.key === offerKey ? choice.index : null;
  const setSelected = (index: number) => setChoice({ key: offerKey, index });
  const step = stepOf(state)?.step;
  const bonus = !!step?.bonus;
  const bundles = step?.tier == null && !bonus;
  const slot = selected != null ? offer[selected] : null;

  return (
    <>
      <div className="text-center">
        <div className="text-[10px] tracking-widest text-white/40">
          {bundles ? 'CHOISIS UN LOT DE 3 CARTES' : bonus ? 'CARTE DE PLUS · TOUS TIERS' : `TIER ${step?.tier} · CHOISIS UNE CARTE`}
        </div>
        {bonus && <p className="mt-1 text-xs text-white/60">Ton duel est joué : ajoute une carte à ton deck avant le suivant.</p>}
      </div>
      {bundles ? (
        <div className="mx-auto max-w-md space-y-3">
          {offer.map((s, i) => (
            <BundleRow key={s.cards[0].id} slot={s} selected={selected === i} onTap={() => setSelected(i)} />
          ))}
        </div>
      ) : (
        // `pt-4` : la carte retenue se lève, elle ne doit pas recouvrir la consigne.
        <div className="mx-auto grid max-w-md grid-cols-3 gap-3 pt-4">
          {offer.map((s, i) => {
            const card = s.cards[0];
            const label = KIND_LABEL[s.kind as Exclude<OfferKind, 'bundle'>];
            return (
              <div key={card.id} className="flex min-w-0 flex-col items-center gap-1.5">
                <Card3D
                  {...cardVisualProps(card, 'player', { plain: true })}
                  size="h-auto w-full"
                  tapOn="up"
                  highlight={selected === i ? 'selected' : 'none'}
                  onTap={() => setSelected(i)}
                />
                {label && <span className={`text-center text-[10px] leading-tight ${label.tone}`}>{label.text}</span>}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-center text-[11px] text-white/40">
        Touche {bundles ? 'un lot' : 'une carte'} pour {bundles ? 'le' : 'la'} choisir, appui long sur une carte pour la détailler.
      </p>
      {err && <p className="text-center text-xs text-danger">{err}</p>}
      <div className="mx-auto flex max-w-md gap-2">
        <Button
          className="flex-1 whitespace-nowrap py-3"
          disabled={busy || !canReroll(state)}
          onPointerDown={async () => { if (canReroll(state)) setErr(await reroll()); }}
        >
          <UiIcon id="UI_REROLL" className="h-4 w-4" /> Relancer · {DRAFT_REROLLS - state.rerolls}
        </Button>
        <Button
          variant="primary"
          className="flex-1 py-3"
          disabled={busy || !slot}
          onPointerDown={async () => { if (slot) setErr(await pick(slot.cards.map(c => c.id))); }}
        >
          Prendre
        </Button>
      </div>
      <DeckSummary state={state} />
    </>
  );
}

/** Un lot de l'offre : ses trois cartes côte à côte, tapables d'un bloc. Le
 *  titre nomme la carte dont la recette lie les deux autres. */
function BundleRow({ slot, selected, onTap }: { slot: OfferSlot; selected: boolean; onTap: () => void }) {
  const [head] = slot.cards;
  const missing = slot.missing ?? 0;
  return (
    <div className={`rounded-xl border p-2 pt-1.5 ${selected ? 'border-gold bg-gold/10' : 'border-line bg-surface-raised/50'}`}>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="min-w-0 truncate text-xs font-bold text-violet">Lot · {head.name}</span>
        <span className={`ml-auto shrink-0 text-[10px] ${missing ? 'text-gold' : 'text-success'}`}>
          {missing ? `${missing} carte${missing > 1 ? 's' : ''} à compléter` : 'Tout se joue'}
        </span>
      </div>
      {/* `pt-4` : une carte survolée se lève, elle ne doit pas recouvrir le titre. */}
      <div className="grid grid-cols-3 gap-2 pt-4">
        {slot.cards.map(card => (
          <Card3D
            key={card.id}
            {...cardVisualProps(card, 'player', { plain: true })}
            size="h-auto w-full"
            tapOn="up"
            highlight={selected ? 'selected' : 'none'}
            onTap={onTap}
          />
        ))}
      </div>
    </div>
  );
}

function Ladder({ snapshot, run }: { snapshot: DraftSnapshot; run: DraftRun }) {
  const nextGems = snapshot.rules.win_gems[run.wins] ?? 0;
  return (
    <>
      <div className="mx-auto flex max-w-sm justify-center gap-6">
        <Pips label="VICTOIRES" filled={run.wins} total={RUN_WINS} tone="bg-success" />
        <Pips label="DÉFAITES" filled={run.losses} total={maxLosses(run)} tone="bg-danger" />
      </div>
      <GemsLine run={run} />
      <div className="mx-auto flex max-w-sm items-center gap-3 rounded-lg border border-gold/60 bg-surface-raised/60 px-3 py-2">
        <UiIcon id="UI_DUEL" className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gold">Duel {run.wins + run.losses + 1}</div>
          <div className="text-[11px] text-white/50">En ligne, contre un autre joueur en draft</div>
        </div>
        {nextGems > 0 && <Amount currency="gems" value={nextGems} sign className="text-sm font-bold" />}
      </div>
      <div className="mx-auto max-w-sm space-y-2">
        <div className="flex justify-center"><MusicThemePicker /></div>
        <DuelSearch run={run} />
      </div>
      <DeckSummary state={run} />
    </>
  );
}

type SearchStatus = 'idle' | 'connecting' | 'searching' | 'found' | 'error';

/**
 * La recherche d'un duel : la file du Duel en ligne, en mode `draft`. Le
 * serveur lit le deck dans la run et refuse (`draft_unavailable`) une run sans
 * duel à jouer. Même patron que `OnlineLobby` : abonnement au montage, sortie
 * de file au démontage tant qu'aucun match n'est trouvé.
 */
function DuelSearch({ run }: { run: DraftRun }) {
  const navigate = useUiStore(s => s.navigate);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [opponent, setOpponent] = useState<MatchOpponent | null>(null);
  const foundRef = useRef(false);
  const revealRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lu par le handler, abonné une seule fois : la run à jour sans relancer l'effet.
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const onFound = (msg: any) => {
      if (msg?.mode !== 'draft') return;
      foundRef.current = true;
      // Un bot de Draft n'a pas d'avatar annoncé : son visage est la carte la
      // plus forte de son deck drafté, celui que l'écran de jeu lui donnera.
      const face = msg?.bot ? currentOpponent(runRef.current, getDraftPool())?.faceCardId : null;
      setOpponent({ ...(msg?.opponent ?? {}), avatar: msg?.opponent?.avatar ?? (face ? illustrationUrl(face) : null) });
      setStatus('found');
      revealRef.current = setTimeout(() => navigate('game_pvp', { draft: true }), MATCH_REVEAL_MS);
    };
    const onError = (msg: any) => {
      if (msg?.code !== 'draft_unavailable') return;
      setError(msg?.message ?? 'Duel impossible.');
      setStatus('error');
    };
    PvpConnection.on('match:found', onFound);
    PvpConnection.on('error', onError);
    return () => {
      PvpConnection.off('match:found', onFound);
      PvpConnection.off('error', onError);
      if (revealRef.current) { clearTimeout(revealRef.current); revealRef.current = null; }
      if (!foundRef.current) { try { PvpConnection.send('queue:leave'); } catch { /* noop */ } }
    };
  }, [navigate]);

  async function search() {
    if (status === 'connecting' || status === 'searching') return;
    setError(null);
    setStatus('connecting');
    try {
      await (PvpConnection as any).connect();
      setStatus('searching');
      (PvpConnection as any).send('queue:join', { mode: 'draft' });
    } catch (e: any) {
      setError(e?.message ?? 'Connexion impossible.');
      setStatus('error');
    }
  }

  function cancel() {
    try { (PvpConnection as any).send('queue:leave'); } catch { /* noop */ }
    (PvpConnection as any).disconnect();
    setStatus('idle');
  }

  return (
    <>
      {(status === 'idle' || status === 'error') && (
        <Button variant="primary" className="w-full py-3" onPointerDown={search}>
          Chercher un adversaire
        </Button>
      )}
      {(status === 'connecting' || status === 'searching') && (
        <div className="flex flex-col items-center gap-2">
          <p className="animate-pulse text-sm text-white/70">
            {status === 'connecting' ? 'Connexion…' : 'Recherche d\'un adversaire…'}
          </p>
          <Button onPointerDown={cancel}>Annuler</Button>
        </div>
      )}
      {error && <p className="text-center text-xs text-danger">{error}</p>}
      {status === 'found' && <MatchFoundReveal opponent={opponent} />}
    </>
  );
}

/** Ce que la run a déjà rapporté, sur ce qu'elle peut rapporter. */
function GemsLine({ run }: { run: DraftRun }) {
  const total = useDraftStore(s => sum(s.snapshot?.rules.win_gems ?? []));
  return (
    <p className="text-center text-xs text-white/50">
      Gagné : <Amount currency="gems" value={run.gems_earned} /> sur {fmt.format(total)}
    </p>
  );
}

function Finished({ snapshot, run }: { snapshot: DraftSnapshot; run: DraftRun }) {
  const buyLife = useDraftStore(s => s.buyLife);
  const busy = useDraftStore(s => s.busy);
  const gems = useAuthStore(s => s.user?.gems ?? 0);
  const [err, setErr] = useState<string | null>(null);
  const won = run.status === 'won';
  const price = snapshot.rules.extra_life_price_gems;
  const canBuy = !won && !run.extra_life;
  const affordable = gems >= price;
  return (
    <div className="mx-auto max-w-sm space-y-3">
      <div className={`rounded-xl border p-4 text-center ${won ? 'border-gold/40 bg-gold/10' : 'border-line bg-surface-raised/60'}`}>
        <UiIcon id={won ? 'UI_VICTORY' : 'UI_DEFEAT'} className="mx-auto h-8 w-8" />
        <div className={`mt-1 text-sm font-bold ${won ? 'text-gold' : 'text-danger'}`}>
          {won ? 'Run gagnée !' : `Run terminée à ${run.wins} victoire${run.wins > 1 ? 's' : ''}.`}
        </div>
        <div className="mt-1 text-xs text-white/60">
          <Amount currency="gems" value={run.gems_earned} sign /> gagnées aujourd'hui
        </div>
      </div>
      {canBuy && (
        <div className="space-y-1.5 rounded-xl border border-violet/40 bg-surface-raised/60 p-3 text-center">
          <p className="text-xs text-white/70">Une vie de plus pour un dernier duel ? Une seule par run.</p>
          <HoldConfirmButton
            icon={<UiIcon id={CURRENCY.gems.icon} className="h-5 w-5" />}
            label={`Racheter une vie · ${fmt.format(price)}`}
            actionLabel="racheter une vie"
            cost={price}
            currency="gems"
            fullWidth
            disabled={busy || !affordable}
            title={affordable ? undefined : 'Pas assez de gemmes'}
            onConfirm={async () => setErr(await buyLife())}
          />
          {err && <p className="text-xs text-danger">{err}</p>}
        </div>
      )}
      <p className="text-center text-xs text-white/50">
        Prochain draft dans <Countdown at={snapshot.next_rotation_at} className="text-white/60" />
      </p>
      <DeckSummary state={run} />
    </div>
  );
}

function Pips({ label, filled, total, tone }: { label: string; filled: number; total: number; tone: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] tracking-widest text-white/40">{label}</span>
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-3 w-3 rounded-full ${i < filled ? tone : 'bg-surface ring-1 ring-line'}`} />
        ))}
      </div>
    </div>
  );
}

/** Le deck en cours, rangé par tier comme l'onglet « Deck » du DeckBuilder.
 *  Lecture seule : l'appui long détaille une carte, le tap ne fait rien. */
function DeckSummary({ state }: { state: DraftState }) {
  const pool = getDraftPool();
  const deck = useMemo(() => {
    const byId = new Map(pool.map(c => [c.id, c]));
    const ids = deckOf(state, pool);
    return Object.fromEntries([1, 2, 3, 4, 5].map(t =>
      [t, ids[String(t)].map(id => byId.get(id)).filter((c): c is Card => !!c)]));
  }, [state, pool]);
  if (state.picks.length === 0) return null;
  return (
    <section className="mx-auto max-w-md">
      <h2 className="mb-1.5 text-[10px] tracking-widest text-white/40">TON DECK ({state.status === 'drafting' ? `${state.picks.length}/${DRAFT_SIZE}` : `${state.picks.length} cartes`})</h2>
      <DeckTierGrid
        deck={deck}
        renderCard={(c, _t, idx) => (
          <Card3D key={`${c.id}-${idx}`} {...cardVisualProps(c, 'player', { plain: true })} size="h-auto w-full" />
        )}
      />
    </section>
  );
}
