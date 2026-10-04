// DraftScreen — la run de Draft : 20 choix d'une carte parmi trois, puis une
// échelle de duels (5 victoires pour la gagner, 2 défaites la closent) contre
// des adversaires qui ont drafté avec les mêmes règles.
//
// Toute la règle vit dans `logic/Draft.ts` (offre, rôles des emplacements,
// adversaires) ; cet écran ne fait que rendre l'état et taper trois boutons.
import { useEffect, useMemo, useState } from 'react';
import { useUiStore } from '../stores/uiStore.js';
import { useDraftStore, getDraftPool } from '../stores/draftStore.js';
import {
  DRAFT_SCHEDULE, DRAFT_REROLLS, RUN_WINS, RUN_LOSSES,
  offerFor, currentTier, currentOpponent, canReroll, deckOf,
  type OfferKind, type DraftState,
} from '../logic/Draft.js';
import * as CardDatabase from '../data/CardDatabase.js';
import Card3D, { cardVisualProps } from '../components/ui/Card3D.js';
import { Button, Illustration } from '../components/ui/primitives.js';
import MusicThemePicker from '../components/ui/MusicThemePicker.js';
import UiIcon from '../components/ui/UiIcon.js';
import { useWebLayout } from '../components/system/useWebLayout.js';
import type { Card } from '../logic/types.js';

/** Ce que l'écran dit de chaque emplacement. Le PARI est le seul à porter un
 *  avertissement : c'est la carte qu'on ne peut pas encore jouer. */
const KIND_LABEL: Record<OfferKind, { text: string; tone: string }> = {
  complement: { text: 'Complète une recette', tone: 'text-success' },
  buildable: { text: 'Jouable', tone: 'text-white/50' },
  bet: { text: 'Pari : matériaux absents', tone: 'text-gold' },
};

// Classes littérales : Tailwind ne voit pas une classe composée à l'exécution.
const TIER_TEXT: Record<string, string> = {
  '1': 'text-tier-1', '2': 'text-tier-2', '3': 'text-tier-3', '4': 'text-tier-4', '5': 'text-tier-5',
};

const cardOf = (id: string): Card | null => {
  try { return (CardDatabase as { getCard(id: string): Card | null }).getCard(id) ?? null; } catch { return null; }
};

export default function DraftScreen() {
  const state = useDraftStore(s => s.state);
  const hydrate = useDraftStore(s => s.hydrate);
  const hideTooltip = useUiStore(s => s.hideTooltip);
  useEffect(() => { hydrate(); }, [hydrate]);

  const web = useWebLayout();
  const pad = web ? ' px-22' : '';

  return (
    <main className="relative z-10 flex min-h-full flex-col text-white" onPointerDown={() => hideTooltip()}>
      <div className={`flex items-center gap-3 border-b border-line py-3${web ? ' px-22' : ' px-6'}`}>
        <h1 className="text-lg font-bold tracking-wide">Draft</h1>
        {state && state.status !== 'won' && state.status !== 'lost' && (
          <span className="ml-auto text-xs text-white/50">
            {state.status === 'drafting'
              ? `Choix ${state.picks.length + 1}/${DRAFT_SCHEDULE.length}`
              : `${state.wins} V · ${state.losses} D`}
          </span>
        )}
      </div>
      <div className={`flex-1 space-y-4 overflow-y-auto p-4${pad}`}>
        {!state ? <Intro />
          : state.status === 'drafting' ? <Picking state={state} />
            : state.status === 'playing' ? <Ladder state={state} />
              : <Finished state={state} />}
      </div>
    </main>
  );
}

function Intro() {
  const start = useDraftStore(s => s.start);
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-4 text-center">
      <UiIcon id="UI_CARD" className="h-10 w-10" />
      <p className="text-sm text-white/70">
        Construis ton deck en jouant : {DRAFT_SCHEDULE.length} choix d'une carte parmi trois, du tier 1 au tier 5,
        dans tout le catalogue.
      </p>
      <ul className="w-full space-y-1.5 text-left text-xs text-white/50">
        <li><span className="text-success">Complète une recette</span> : la carte apporte un matériel qui te manque.</li>
        <li><span className="text-white/70">Jouable</span> : tu peux la poser avec ce que tu as déjà.</li>
        <li><span className="text-gold">Pari</span> : ses matériaux te manquent encore. À toi de les trouver.</li>
      </ul>
      <p className="text-xs text-white/50">
        {DRAFT_REROLLS} relances pour tout le draft. Ensuite, des duels contre des adversaires qui ont drafté eux aussi :
        {' '}{RUN_WINS} victoires pour gagner la run, {RUN_LOSSES} défaites y mettent fin.
      </p>
      <Button variant="primary" className="px-6 py-3" onPointerDown={() => start()}>Lancer un draft</Button>
    </div>
  );
}

function Picking({ state }: { state: DraftState }) {
  const pick = useDraftStore(s => s.pick);
  const reroll = useDraftStore(s => s.reroll);
  const pool = getDraftPool();
  const offer = useMemo(() => offerFor(state, pool), [state, pool]);
  // La sélection est attachée à SON offre : un choix fait ou une relance
  // change la clé, et la sélection d'avant ne vaut plus rien.
  const offerKey = `${state.picks.length}:${state.rerolls}`;
  const [choice, setChoice] = useState<{ key: string; id: string } | null>(null);
  const selected = choice?.key === offerKey ? choice.id : null;
  const setSelected = (id: string) => setChoice({ key: offerKey, id });
  const tier = currentTier(state);

  return (
    <>
      <div className="text-center">
        <div className="text-[10px] tracking-widest text-white/40">TIER {tier} · CHOISIS UNE CARTE</div>
      </div>
      {/* `pt-4` : la carte retenue se lève, elle ne doit pas recouvrir la consigne. */}
      <div className="mx-auto grid max-w-md grid-cols-3 gap-3 pt-4">
        {offer.map(({ card, kind }) => (
          <div key={card.id} className="flex min-w-0 flex-col items-center gap-1.5">
            <Card3D
              {...cardVisualProps(card, 'player', { plain: true })}
              size="h-auto w-full"
              tapOn="up"
              highlight={selected === card.id ? 'selected' : 'none'}
              onTap={() => setSelected(card.id)}
            />
            <span className={`text-center text-[10px] leading-tight ${KIND_LABEL[kind].tone}`}>{KIND_LABEL[kind].text}</span>
          </div>
        ))}
      </div>
      <p className="text-center text-[11px] text-white/40">Touche une carte pour la choisir, appui long pour la détailler.</p>
      <div className="mx-auto flex max-w-md gap-2">
        <Button
          className="flex-1 whitespace-nowrap py-3"
          disabled={!canReroll(state)}
          onPointerDown={() => { if (canReroll(state)) reroll(); }}
        >
          <UiIcon id="UI_REROLL" className="h-4 w-4" /> Relancer · {DRAFT_REROLLS - state.rerolls}
        </Button>
        <Button
          variant="primary"
          className="flex-1 py-3"
          disabled={!selected}
          onPointerDown={() => { if (selected) pick(selected); }}
        >
          Prendre
        </Button>
      </div>
      <DeckSummary state={state} />
    </>
  );
}

function Ladder({ state }: { state: DraftState }) {
  const navigate = useUiStore(s => s.navigate);
  const abandon = useDraftStore(s => s.abandon);
  const pool = getDraftPool();
  const opponent = useMemo(() => currentOpponent(state, pool), [state, pool]);
  const [confirmQuit, setConfirmQuit] = useState(false);
  if (!opponent) return null;
  const bonus = opponent.bonus.atk || opponent.bonus.hp
    ? `IA +${opponent.bonus.hp} PV / +${opponent.bonus.atk} ATK`
    : 'IA sans bonus';

  return (
    <>
      <div className="mx-auto flex max-w-sm justify-center gap-6">
        <Pips label="VICTOIRES" filled={state.wins} total={RUN_WINS} tone="bg-success" />
        <Pips label="DÉFAITES" filled={state.losses} total={RUN_LOSSES} tone="bg-danger" />
      </div>
      <div className="mx-auto flex max-w-sm items-center gap-3 rounded-lg border border-gold/60 bg-surface-raised/60 px-3 py-2">
        {opponent.faceCardId && <Illustration id={opponent.faceCardId} framed className="h-12 w-12" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gold">Adversaire {opponent.index + 1}</div>
          <div className="text-[11px] text-white/50">Deck drafté · {bonus}</div>
        </div>
      </div>
      <div className="mx-auto max-w-sm space-y-2">
        <div className="flex justify-center"><MusicThemePicker /></div>
        <Button variant="primary" className="w-full py-3" onPointerDown={() => navigate('game', { draft: true })}>
          DUEL {opponent.index + 1}
        </Button>
        <button
          type="button"
          className="w-full text-center text-[11px] text-white/40 underline"
          onPointerDown={() => { if (confirmQuit) abandon(); else setConfirmQuit(true); }}
        >
          {confirmQuit ? 'Toucher encore pour abandonner la run' : 'Abandonner la run'}
        </button>
      </div>
      <DeckSummary state={state} />
    </>
  );
}

function Finished({ state }: { state: DraftState }) {
  const start = useDraftStore(s => s.start);
  const won = state.status === 'won';
  return (
    <div className="mx-auto max-w-sm space-y-3">
      <div className={`rounded-xl border p-4 text-center ${won ? 'border-gold/40 bg-gold/10' : 'border-line bg-surface-raised/60'}`}>
        <UiIcon id={won ? 'UI_VICTORY' : 'UI_DEFEAT'} className="mx-auto h-8 w-8" />
        <div className={`mt-1 text-sm font-bold ${won ? 'text-gold' : 'text-danger'}`}>
          {won ? 'Run gagnée !' : `Run terminée à ${state.wins} victoire${state.wins > 1 ? 's' : ''}.`}
        </div>
      </div>
      <Button variant="primary" className="w-full py-3" onPointerDown={() => start()}>Nouveau draft</Button>
      <DeckSummary state={state} />
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

/** Le deck en cours, par tier. Les noms suffisent : l'appui long sur une carte
 *  de l'offre détaille, ici on relit ce qu'on a pris. */
function DeckSummary({ state }: { state: DraftState }) {
  const deck = deckOf(state);
  if (state.picks.length === 0) return null;
  return (
    <section className="mx-auto max-w-md space-y-1.5">
      <h2 className="text-[10px] tracking-widest text-white/40">TON DECK ({state.picks.length}/{DRAFT_SCHEDULE.length})</h2>
      {['1', '2', '3', '4', '5'].map(t => deck[t].length > 0 && (
        <div key={t} className="flex gap-2 text-xs">
          <span className={`w-6 flex-shrink-0 font-bold ${TIER_TEXT[t]}`}>T{t}</span>
          <span className="min-w-0 text-white/70">{deck[t].map(id => cardOf(id)?.name ?? id).join(' · ')}</span>
        </div>
      ))}
    </section>
  );
}
