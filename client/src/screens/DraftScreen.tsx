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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as PvpConnection from '../net/PvpConnection.js';
import MatchFoundReveal, { MATCH_REVEAL_MS, type MatchOpponent } from '../components/online/MatchFoundReveal.js';
import { illustrationUrl } from '../data/CardArt.js';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useDraftStore, getDraftPool, type DraftRun, type DraftSnapshot } from '../stores/draftStore.js';
import {
  DRAFT_STEPS, DRAFT_SIZE, DRAFT_REROLLS, RUN_WINS, RUN_LOSSES,
  offerFor, applyMod, modLabel, moddedCards, currentStep, stepOf, pendingBonus, currentOpponent, canReroll, deckOf, deckIds, currentRemoval, maxLosses,
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
import { useWebLayout, useTabletLayout } from '../components/system/useWebLayout.js';
import { primaryTier } from '../logic/Tiers.js';
import type { Card } from '../logic/types.js';

/** Ce que l'écran dit de chaque emplacement. Le PARI est le seul à porter un
 *  avertissement : c'est la carte qu'on ne peut pas encore jouer. */
const KIND_LABEL: Record<Exclude<OfferKind, 'bundle'>, { text: string; tone: string }> = {
  complement: { text: 'Complète une recette', tone: 'text-success' },
  buildable: { text: 'Jouable', tone: 'text-white/50' },
  bet: { text: 'Pari : matériaux absents', tone: 'text-gold' },
  link: { text: 'Lien avec ton deck', tone: 'text-success' },
};

const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

// Les quatre mises en page (INTEGRATION-Draft.md). `phone` est le rendu d'origine.
type Layout = 'phone' | 'phoneLandscape' | 'wide' | 'tabletPortrait';
const isLandscape = (l: Layout) => l === 'phoneLandscape' || l === 'wide';

// Classes littérales : Tailwind ne voit pas une classe composée à l'exécution.
const TIER_BAR: Record<number, string> = {
  1: 'bg-tier-1', 2: 'bg-tier-2', 3: 'bg-tier-3', 4: 'bg-tier-4', 5: 'bg-tier-5',
};

interface ShellBase { layout: Layout; status: ReactNode; loadState: ReactNode }

export default function DraftScreen() {
  const user = useAuthStore(s => s.user);
  const userId = user?.id ?? null;
  const snapshot = useDraftStore(s => s.snapshot);
  const loading = useDraftStore(s => s.loading);
  const error = useDraftStore(s => s.error);
  const load = useDraftStore(s => s.load);
  // L'ID, jamais l'objet `user` (cf. authStore) : sinon la lecture boucle.
  useEffect(() => { if (userId) void load(true); }, [userId, load]);

  const web = useWebLayout();
  const tablet = useTabletLayout();
  const layout: Layout = web ? (tablet ? 'wide' : 'phoneLandscape') : (tablet ? 'tabletPortrait' : 'phone');

  if (!user) return <GuestGate reason="Le Draft a besoin d'un compte : la run du jour et ses gemmes sont gardées côté serveur." />;

  const run = snapshot?.run ?? null;
  const status = run && (run.status === 'drafting' || run.status === 'playing') ? (
    <span className="ml-auto text-xs text-white/50">
      {run.status === 'drafting'
        ? `Étape ${(currentStep(run)?.index ?? 0) + 1}/${DRAFT_STEPS.length}`
        : `${run.wins} V · ${run.losses} D`}
    </span>
  ) : snapshot && <Countdown at={snapshot.next_rotation_at} title="Prochain draft" className="ml-auto text-xs text-white/50" />;
  const shell: ShellBase = {
    layout,
    status,
    loadState: <LoadState error={error} loading={loading} hasContent={!!snapshot} />,
  };

  if (!snapshot) return <Shell {...shell} main={null} />;
  if (!run) return <IntroPhase snapshot={snapshot} shell={shell} />;
  if (run.status === 'drafting') return <PickPhase state={run} shell={shell} />;
  if (run.status === 'playing') {
    return pendingBonus(run)
      ? <PickPhase state={run} shell={shell} />
      : <LadderPhase snapshot={snapshot} run={run} shell={shell} />;
  }
  return <FinishedPhase snapshot={snapshot} run={run} shell={shell} />;
}

/**
 * Le cadre de l'écran. `phone` et `tabletPortrait` : barre de titre, corps qui
 * défile, pied collant facultatif. Paysage : le titre passe dans la colonne
 * gauche (`left`), `main` au centre, `side` (deck) à droite en tablette.
 */
function Shell({ layout, status, loadState, left, main, side, foot }: ShellBase & {
  left?: ReactNode; main: ReactNode; side?: ReactNode; foot?: ReactNode;
}) {
  const hideTooltip = useUiStore(s => s.hideTooltip);
  const title = <h1 className={`${layout === 'wide' ? 'text-xl' : 'text-lg'} font-bold tracking-wide`}>Draft du jour</h1>;

  if (isLandscape(layout)) {
    const wide = layout === 'wide';
    const grid = wide
      ? `mx-auto w-full max-w-[1280px] gap-6 px-6 ${side ? 'grid-cols-[280px_minmax(0,1fr)_320px]' : 'grid-cols-[280px_minmax(0,1fr)]'}`
      : 'grid-cols-[260px_minmax(0,1fr)] gap-4 pl-[max(88px,env(safe-area-inset-left))] pr-[max(88px,env(safe-area-inset-right))]';
    return (
      <main className={`relative z-10 grid h-full min-h-0 text-white ${grid}`} onPointerDown={() => hideTooltip()}>
        <aside className={`flex min-h-0 flex-col ${wide ? 'gap-3 py-5' : 'gap-2.5 pb-3.5 pt-2.5'}`}>
          <div className="flex items-center gap-2">{title}{status}</div>
          {left}
        </aside>
        <section className={`min-h-0 overflow-y-auto ${wide ? 'py-5' : ''}`}>
          {loadState}
          {main}
        </section>
        {side}
      </main>
    );
  }

  const tab = layout === 'tabletPortrait';
  return (
    <main className={`relative z-10 flex flex-col text-white ${tab ? 'h-full min-h-0' : 'min-h-full'}`} onPointerDown={() => hideTooltip()}>
      <div className="flex items-center gap-3 border-b border-line px-6 py-3">{title}{status}</div>
      <div className={tab ? 'min-h-0 flex-1 overflow-y-auto p-6' : 'flex-1 space-y-4 overflow-y-auto p-4'}>
        {loadState}
        {tab ? <div className="mx-auto flex max-w-[640px] flex-col gap-[18px]">{main}</div> : main}
      </div>
      {foot && (
        <div className="shrink-0 border-t border-line bg-surface/95 px-6 pb-5 pt-3.5">
          <div className="mx-auto max-w-[640px]">{foot}</div>
        </div>
      )}
    </main>
  );
}

const Spacer = () => <div className="min-h-0 flex-1" />;

// ─── Accueil ──────────────────────────────────────────────────────────────

function IntroRules({ big = false }: { big?: boolean }) {
  const snapshot = useDraftStore(s => s.snapshot);
  const p = big ? 'text-[15px]' : 'text-sm';
  const q = big ? 'text-[13px]' : 'text-xs';
  return (
    <div className="flex flex-col gap-3">
      <p className={`${p} text-white/70`}>
        Construis un deck de {DRAFT_SIZE} cartes en jouant, tirées dans tout le catalogue — de quoi découvrir
        des cartes que tu n'as pas. D'abord trois lots de trois cartes liées par une recette, puis six cartes
        à choisir une par une, du tier 1 au tier 5.
      </p>
      <ul className={`w-full space-y-1.5 text-left ${q} text-white/50`}>
        <li><span className="text-violet">Lot</span> : une carte et les matériels que sa recette nomme.</li>
        <li><span className="text-success">Complète une recette</span> : la carte apporte un matériel qui te manque.</li>
        <li><span className="text-white/70">Jouable</span> : tu peux la poser avec ce que tu as déjà.</li>
        <li><span className="text-gold">Pari</span> : ses matériaux te manquent encore. À toi de les trouver.</li>
      </ul>
      <p className={`${q} text-white/50`}>
        {DRAFT_REROLLS} relances pour toute la run. Ensuite, des duels en ligne contre d'autres joueurs en draft :
        {' '}{RUN_WINS} victoires pour gagner la run, {RUN_LOSSES} défaites y mettent fin
        (une vie de plus se rachète <Amount currency="gems" value={snapshot?.rules.extra_life_price_gems ?? 0} />).
        Après chaque duel, tu draftes une carte de plus : un lien avec ton deck (avec un malus), une carte jouable, ou un pari (avec un bonus).
      </p>
    </div>
  );
}

function IntroGains({ snapshot }: { snapshot: DraftSnapshot }) {
  return (
    <p className="text-xs text-white/70">
      Chaque victoire rapporte des gemmes, jusqu'à <Amount currency="gems" value={sum(snapshot.rules.win_gems)} /> pour une run parfaite.
      Un draft par jour.
    </p>
  );
}

function IntroStart() {
  const start = useDraftStore(s => s.start);
  const busy = useDraftStore(s => s.busy);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      {err && <p className="text-xs text-danger">{err}</p>}
      <Button variant="primary" className="px-6 py-3" disabled={busy} onPointerDown={async () => setErr(await start())}>
        Lancer le draft du jour
      </Button>
    </>
  );
}

function IntroCta({ snapshot }: { snapshot: DraftSnapshot }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <UiIcon id="UI_CARD" className="h-10 w-10" />
      <IntroGains snapshot={snapshot} />
      <IntroStart />
    </div>
  );
}

function IntroPhase({ snapshot, shell }: { snapshot: DraftSnapshot; shell: ShellBase }) {
  const { layout } = shell;
  if (layout === 'phoneLandscape') {
    return (
      <Shell {...shell}
        left={<><Spacer /><IntroCta snapshot={snapshot} /><Spacer /></>}
        main={<div className="flex min-h-full flex-col justify-center py-3"><IntroRules /></div>}
      />
    );
  }
  if (layout === 'wide') {
    return (
      <Shell {...shell}
        left={<><Spacer /><IntroCta snapshot={snapshot} /><Spacer /></>}
        main={<div className="mx-auto flex min-h-full max-w-[560px] flex-col justify-center"><IntroRules big /></div>}
      />
    );
  }
  if (layout === 'tabletPortrait') {
    return (
      <Shell {...shell}
        main={(
          <div className="flex flex-col items-center gap-3 text-center">
            <UiIcon id="UI_CARD" className="h-10 w-10" />
            <IntroRules big />
            <IntroGains snapshot={snapshot} />
          </div>
        )}
        foot={<div className="flex justify-center"><IntroStart /></div>}
      />
    );
  }
  return (
    <Shell {...shell} main={(
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-4 text-center">
        <UiIcon id="UI_CARD" className="h-10 w-10" />
        <IntroRules />
        <IntroGains snapshot={snapshot} />
        <IntroStart />
      </div>
    )} />
  );
}

// ─── Draft ────────────────────────────────────────────────────────────────

/** La sélection et l'erreur, remontées : l'offre, la liste de lots et les
 *  actions ne sont plus voisins dans l'arbre. Appelé au-dessus du choix de
 *  mise en page, il survit à une rotation d'appareil. */
function usePickState(state: DraftState) {
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
  return {
    offer, selected, setSelected, bonus, bundles, slot, err, busy, tier: step?.tier ?? null,
    rerollsLeft: DRAFT_REROLLS - state.rerolls,
    canReroll: !busy && canReroll(state),
    doReroll: async () => { if (canReroll(state)) setErr(await reroll()); },
    doPick: async () => { if (slot) setErr(await pick(slot.cards.map(c => c.id), slot.mod?.sign)); },
  };
}
type PickState = ReturnType<typeof usePickState>;

function PickHeading({ p, align = 'center' }: { p: PickState; align?: 'center' | 'left' }) {
  return (
    <div className={align === 'center' ? 'text-center' : ''}>
      <div className="text-[10px] tracking-widest text-white/40">
        {p.bundles ? 'CHOISIS UN LOT DE 3 CARTES' : p.bonus ? 'CARTE DE PLUS · TOUS TIERS' : `TIER ${p.tier} · CHOISIS UNE CARTE`}
      </div>
      {p.bonus && <p className="mt-1 text-xs text-white/60">Ton duel est joué : ajoute une carte à ton deck avant le suivant. Tu peux aussi en retirer une.</p>}
    </div>
  );
}

function PickTip({ p, align = 'center', className = '' }: { p: PickState; align?: 'center' | 'left'; className?: string }) {
  return (
    <p className={`${align === 'center' ? 'text-center' : ''} text-[11px] text-white/40 ${className}`}>
      Touche {p.bundles ? 'un lot' : 'une carte'} pour {p.bundles ? 'le' : 'la'} choisir, appui long sur une carte pour la détailler.
    </p>
  );
}

/** Les 3 cartes d'une offre simple. `className` porte la grille (et sa
 *  largeur de carte) : elle change avec chaque mise en page. */
function OfferCards({ p, className }: { p: PickState; className: string }) {
  return (
    <div className={`grid ${className}`}>
      {p.offer.map((s, i) => {
        // La carte se montre TELLE QU'ELLE SE JOUERA : stats et coût portent
        // déjà le malus ou le bonus, et l'infobulle aussi.
        const card = s.mod ? applyMod(s.cards[0], s.mod) : s.cards[0];
        const label = KIND_LABEL[s.kind as Exclude<OfferKind, 'bundle'>];
        return (
          <div key={card.id} className="flex min-w-0 flex-col items-center gap-1.5">
            <Card3D
              {...cardVisualProps(card, 'player', { plain: true })}
              size="h-auto w-full"
              tapOn="up"
              highlight={p.selected === i ? 'selected' : 'none'}
              onTap={() => p.setSelected(i)}
            />
            {label && <span className={`text-center text-[10px] leading-tight ${label.tone}`}>{label.text}</span>}
            {s.mod && (
              <span className={`text-center text-[10px] font-bold leading-tight ${s.mod.sign === 'bonus' ? 'text-success' : 'text-danger'}`}>
                {s.mod.sign === 'bonus' ? 'Bonus' : 'Malus'} : {modLabel(s.mod)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Les lots : empilés (cartes en grand) ou en liste compacte, une ligne par lot. */
function BundleList({ p, compact = false, gridClass = 'grid-cols-3 gap-2' }: { p: PickState; compact?: boolean; gridClass?: string }) {
  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        {p.offer.map((s, i) => {
          const missing = s.missing ?? 0;
          const on = p.selected === i;
          return (
            <button
              key={s.cards[0].id}
              type="button"
              onPointerDown={() => p.setSelected(i)}
              className={`flex min-h-11 min-w-0 items-center gap-2 rounded-[10px] border px-2.5 text-left ${on ? 'border-gold bg-gold/10' : 'border-line bg-surface-raised/50'}`}
            >
              <span className="flex shrink-0 gap-0.5">
                {s.cards.map(c => <span key={c.id} className={`h-[18px] w-1.5 rounded-sm ${TIER_BAR[primaryTier(c)] ?? 'bg-white/30'}`} />)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-violet">Lot · {s.cards[0].name}</span>
                <span className={`block text-[10px] ${missing ? 'text-gold' : 'text-success'}`}>
                  {missing ? `${missing} carte${missing > 1 ? 's' : ''} à compléter` : 'Tout se joue'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md space-y-3">
      {p.offer.map((s, i) => (
        <BundleRow key={s.cards[0].id} slot={s} selected={p.selected === i} onTap={() => p.setSelected(i)} gridClass={gridClass} />
      ))}
    </div>
  );
}

/** Un lot de l'offre : ses trois cartes côte à côte, tapables d'un bloc. Le
 *  titre nomme la carte dont la recette lie les deux autres. `preview` : l'aperçu
 *  en grand du paysage téléphone (titre « APERÇU · … » / « LOT RETENU · … »). */
function BundleRow({ slot, selected, onTap, gridClass, preview = false }: {
  slot: OfferSlot; selected: boolean; onTap: () => void; gridClass: string; preview?: boolean;
}) {
  const [head] = slot.cards;
  const missing = slot.missing ?? 0;
  return (
    <div className={`rounded-xl border p-2 pt-1.5 ${selected ? 'border-gold bg-gold/10' : 'border-line bg-surface-raised/50'}`}>
      <div className="mb-1 flex items-baseline gap-2">
        {preview ? (
          <span className={`min-w-0 truncate text-xs font-bold uppercase ${selected ? 'text-gold' : 'text-white/40'}`}>
            {selected ? 'Lot retenu' : 'Aperçu'} · {head.name}
          </span>
        ) : <span className="min-w-0 truncate text-xs font-bold text-violet">Lot · {head.name}</span>}
        <span className={`ml-auto shrink-0 text-[10px] ${missing ? 'text-gold' : 'text-success'}`}>
          {missing ? `${missing} carte${missing > 1 ? 's' : ''} à compléter` : 'Tout se joue'}
        </span>
      </div>
      {/* `pt-4` : une carte survolée se lève, elle ne doit pas recouvrir le titre. */}
      <div className={`grid pt-4 ${gridClass}`}>
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

/** Relancer · n et Prendre, avec l'erreur juste au-dessus. */
function PickActions({ p, direction = 'row', tall = false, className = '' }: {
  p: PickState; direction?: 'row' | 'column'; tall?: boolean; className?: string;
}) {
  const h = tall ? 'min-h-12' : 'py-3';
  const reroll = (
    <Button className={`${direction === 'row' ? 'flex-1' : 'w-full'} whitespace-nowrap ${h}`} disabled={!p.canReroll} onPointerDown={p.doReroll}>
      <UiIcon id="UI_REROLL" className="h-4 w-4" /> Relancer · {p.rerollsLeft}
    </Button>
  );
  const take = (
    <Button variant="primary" className={`${direction === 'row' ? 'flex-1' : 'w-full'} ${h}`} disabled={p.busy || !p.slot} onPointerDown={p.doPick}>
      Prendre
    </Button>
  );
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {p.err && <p className="text-center text-xs text-danger">{p.err}</p>}
      <div className={`flex gap-2 ${direction === 'column' ? 'flex-col' : ''}`}>
        {direction === 'column' ? <>{take}{reroll}</> : <>{reroll}{take}</>}
      </div>
    </div>
  );
}

/** Le deck en cours, rangé par tier ; les cartes de plus modifiées remplacent celles du catalogue. */
function useDeckData(state: DraftState) {
  const pool = getDraftPool();
  const byId = useMemo(() => new Map([...pool.map(c => [c.id, c] as const), ...moddedCards(state, pool)]), [state, pool]);
  const deck = useMemo(() => {
    const ids = deckOf(state, pool);
    return Object.fromEntries([1, 2, 3, 4, 5].map(t =>
      [t, ids[String(t)].map(id => byId.get(id)).filter((c): c is Card => !!c)]));
  }, [state, pool, byId]);
  return { byId, deck };
}

function PickPhase({ state, shell }: { state: DraftState; shell: ShellBase }) {
  const { layout } = shell;
  const p = usePickState(state);
  const [drawer, setDrawer] = useState(false);
  const { byId } = useDeckData(state);

  if (layout === 'phoneLandscape') {
    const removedId = p.bonus ? currentRemoval(state) : null;
    const removed = removedId ? byId.get(removedId) : null;
    // Aperçu : le lot retenu, sinon le premier d'office.
    const previewIdx = p.selected ?? 0;
    const previewSlot = p.offer[previewIdx];
    return (
      <>
        <Shell {...shell}
          left={(
            <>
              <PickHeading p={p} align="left" />
              {p.bundles && <BundleList p={p} compact />}
              <Spacer />
              <button
                type="button"
                onPointerDown={() => setDrawer(true)}
                className="flex min-h-10 min-w-0 items-center gap-2 rounded-[10px] border border-line bg-surface-raised/60 px-3 text-left text-xs"
              >
                <UiIcon id="UI_CARD" className="h-4 w-4" />
                <span className={`min-w-0 flex-1 truncate ${removed ? 'text-danger' : 'text-white/80'}`}>
                  {p.bonus
                    ? (removed ? `Retirée : ${removed.name}` : 'Retirer une carte · facultatif')
                    : `Voir mon deck · ${state.picks.length}/${DRAFT_SIZE}`}
                </span>
                <span className="text-white/40">›</span>
              </button>
              <PickActions p={p} />
            </>
          )}
          main={p.bundles ? (
            <div className="flex min-h-full flex-col justify-center py-3">
              {previewSlot && (
                <BundleRow slot={previewSlot} selected={p.selected === previewIdx} onTap={() => p.setSelected(previewIdx)}
                  gridClass="grid-cols-[repeat(3,118px)] justify-center gap-3.5" preview />
              )}
            </div>
          ) : (
            <div className="flex min-h-full flex-col items-center justify-center gap-2 pb-2 pt-2">
              <OfferCards p={p} className="grid-cols-[repeat(3,118px)] justify-center gap-3.5 pt-2" />
              <PickTip p={p} />
            </div>
          )}
        />
        {drawer && (
          <div className="fixed inset-0 z-40 flex justify-end" onPointerDown={e => { e.stopPropagation(); }}>
            <div className="flex-1 bg-black/55" onPointerDown={() => setDrawer(false)} />
            <div className="flex w-[480px] max-w-[85vw] min-h-0 flex-col gap-2 border-l border-line bg-surface/95 py-3 pl-4 pr-[max(1rem,env(safe-area-inset-right))]">
              <div className="flex justify-end">
                <button type="button" aria-label="Fermer" onPointerDown={() => setDrawer(false)} className="flex h-9 w-9 items-center justify-center rounded-lg">
                  <UiIcon id="UI_CLOSE" className="h-4 w-4" />
                </button>
              </div>
              <DeckSummary state={state} removable={p.bonus} cols={6} scroll showEmpty className="" />
            </div>
          </div>
        )}
      </>
    );
  }

  if (layout === 'wide') {
    return (
      <Shell {...shell}
        left={(
          <>
            <PickHeading p={p} align="left" />
            <PickTip p={p} align="left" />
            <Spacer />
            <PickActions p={p} direction="column" tall />
          </>
        )}
        main={p.bundles ? (
          <BundleList p={p} gridClass="grid-cols-[repeat(3,minmax(0,124px))] justify-center gap-4" />
        ) : (
          <div className="flex min-h-full flex-col justify-center">
            <OfferCards p={p} className="grid-cols-[repeat(3,minmax(0,170px))] justify-center gap-5 pt-3" />
          </div>
        )}
        side={(
          <aside className="flex min-h-0 flex-col gap-2 border-l border-line py-5 pl-5">
            <DeckSummary state={state} removable={p.bonus} cols={5} scroll showEmpty className="" />
          </aside>
        )}
      />
    );
  }

  if (layout === 'tabletPortrait') {
    return (
      <Shell {...shell}
        main={(
          <>
            <PickHeading p={p} />
            {p.bundles
              ? <BundleList p={p} gridClass="grid-cols-[repeat(3,minmax(0,150px))] justify-center gap-4" />
              : <OfferCards p={p} className="grid-cols-3 gap-5 pt-3" />}
            <PickTip p={p} />
            <DeckSummary state={state} removable={p.bonus} cols={8} className="" />
          </>
        )}
        foot={<PickActions p={p} tall />}
      />
    );
  }

  return (
    <Shell {...shell} main={(
      <>
        <PickHeading p={p} />
        {p.bundles
          ? <BundleList p={p} gridClass="grid-cols-3 gap-2" />
          // `pt-4` : la carte retenue se lève, elle ne doit pas recouvrir la consigne.
          : <OfferCards p={p} className="mx-auto max-w-md grid-cols-3 gap-3 pt-4" />}
        <PickTip p={p} />
        <PickActions p={p} className="mx-auto max-w-md" />
        <DeckSummary state={state} removable={p.bonus} />
      </>
    )} />
  );
}

// ─── Duels ────────────────────────────────────────────────────────────────

function LadderStatus({ snapshot, run, compact = false }: { snapshot: DraftSnapshot; run: DraftRun; compact?: boolean }) {
  const nextGems = snapshot.rules.win_gems[run.wins] ?? 0;
  return (
    <>
      <div className="mx-auto flex max-w-sm justify-center gap-6">
        <Pips label="VICTOIRES" filled={run.wins} total={RUN_WINS} tone="bg-success" />
        <Pips label="DÉFAITES" filled={run.losses} total={maxLosses(run)} tone="bg-danger" />
      </div>
      <GemsLine run={run} />
      <div className="mx-auto flex w-full max-w-sm items-center gap-3 rounded-lg border border-gold/60 bg-surface-raised/60 px-3 py-2">
        <UiIcon id="UI_DUEL" className={compact ? 'h-7 w-7' : 'h-8 w-8'} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gold">Duel {run.wins + run.losses + 1}</div>
          <div className="text-[11px] text-white/50">En ligne, contre un autre joueur en draft</div>
        </div>
        {nextGems > 0 && <Amount currency="gems" value={nextGems} sign className="text-sm font-bold" />}
      </div>
    </>
  );
}

function LadderActions({ run, full = false }: { run: DraftRun; full?: boolean }) {
  return (
    <div className={`${full ? '' : 'mx-auto max-w-sm'} w-full space-y-2`}>
      <div className="flex justify-center"><MusicThemePicker full={full} /></div>
      <DuelSearch run={run} />
    </div>
  );
}

function LadderPhase({ snapshot, run, shell }: { snapshot: DraftSnapshot; run: DraftRun; shell: ShellBase }) {
  const { layout } = shell;
  if (layout === 'phoneLandscape' || layout === 'wide') {
    const phoneL = layout === 'phoneLandscape';
    return (
      <Shell {...shell}
        left={<><LadderStatus snapshot={snapshot} run={run} compact={phoneL} /><Spacer /><LadderActions run={run} full /></>}
        main={<DeckSummary state={run} cols={phoneL ? 7 : 10} sideLabel={phoneL} className="" />}
      />
    );
  }
  if (layout === 'tabletPortrait') {
    return (
      <Shell {...shell}
        main={<><LadderStatus snapshot={snapshot} run={run} /><DeckSummary state={run} cols={8} className="" /></>}
        foot={<LadderActions run={run} full />}
      />
    );
  }
  return (
    <Shell {...shell} main={(
      <>
        <LadderStatus snapshot={snapshot} run={run} />
        <LadderActions run={run} />
        <DeckSummary state={run} />
      </>
    )} />
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

// ─── Run terminée ─────────────────────────────────────────────────────────

/** Résultat, rachat de vie, compte à rebours. `spread` : un espaceur sépare le
 *  résultat du reste (colonne gauche du paysage). */
function FinishedStatus({ snapshot, run, spread = false }: { snapshot: DraftSnapshot; run: DraftRun; spread?: boolean }) {
  const buyLife = useDraftStore(s => s.buyLife);
  const busy = useDraftStore(s => s.busy);
  const gems = useAuthStore(s => s.user?.gems ?? 0);
  const [err, setErr] = useState<string | null>(null);
  const won = run.status === 'won';
  const price = snapshot.rules.extra_life_price_gems;
  const canBuy = !won && !run.extra_life;
  const affordable = gems >= price;
  return (
    <>
      <div className={`rounded-xl border p-4 text-center ${won ? 'border-gold/40 bg-gold/10' : 'border-line bg-surface-raised/60'}`}>
        <UiIcon id={won ? 'UI_VICTORY' : 'UI_DEFEAT'} className="mx-auto h-8 w-8" />
        <div className={`mt-1 text-sm font-bold ${won ? 'text-gold' : 'text-danger'}`}>
          {won ? 'Run gagnée !' : `Run terminée à ${run.wins} victoire${run.wins > 1 ? 's' : ''}.`}
        </div>
        <div className="mt-1 text-xs text-white/60">
          <Amount currency="gems" value={run.gems_earned} sign /> gagnées aujourd'hui
        </div>
      </div>
      {spread && <Spacer />}
      {canBuy && (
        <div className="space-y-1.5 rounded-xl border border-violet/40 bg-surface-raised/60 p-3 text-center">
          <p className="text-xs text-white/70">Une vie de plus pour un dernier duel ? Une seule par run.</p>
          {err && <p className="text-xs text-danger">{err}</p>}
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
        </div>
      )}
      <p className="text-center text-xs text-white/50">
        Prochain draft dans <Countdown at={snapshot.next_rotation_at} className="text-white/60" />
      </p>
    </>
  );
}

function FinishedPhase({ snapshot, run, shell }: { snapshot: DraftSnapshot; run: DraftRun; shell: ShellBase }) {
  const { layout } = shell;
  if (layout === 'phoneLandscape' || layout === 'wide') {
    const phoneL = layout === 'phoneLandscape';
    return (
      <Shell {...shell}
        left={<FinishedStatus snapshot={snapshot} run={run} spread />}
        main={<DeckSummary state={run} cols={phoneL ? 7 : 10} sideLabel={phoneL} className="" />}
      />
    );
  }
  if (layout === 'tabletPortrait') {
    return (
      <Shell {...shell} main={(
        <>
          <div className="mx-auto flex w-full max-w-sm flex-col gap-3"><FinishedStatus snapshot={snapshot} run={run} /></div>
          <DeckSummary state={run} cols={8} className="" />
        </>
      )} />
    );
  }
  return (
    <Shell {...shell} main={(
      <div className="mx-auto max-w-sm space-y-3">
        <FinishedStatus snapshot={snapshot} run={run} />
        <DeckSummary state={run} />
      </div>
    )} />
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
 *  L'appui long détaille une carte. À l'étape de la carte de plus
 *  (`removable`), le tap RETIRE la carte du deck — une par étape, révisable
 *  tant que la carte de plus n'est pas prise (`draft.remove`).
 *  `scroll` : la grille défile seule dans une colonne bornée ; `showEmpty` : les
 *  cinq tiers restent visibles même deck vide. */
function DeckSummary({ state, removable = false, cols, sideLabel = false, scroll = false, showEmpty = false, className = 'mx-auto max-w-md' }: {
  state: DraftState; removable?: boolean; cols?: number; sideLabel?: boolean; scroll?: boolean; showEmpty?: boolean; className?: string;
}) {
  const remove = useDraftStore(s => s.remove);
  const busy = useDraftStore(s => s.busy);
  const [err, setErr] = useState<string | null>(null);
  const { byId, deck } = useDeckData(state);
  if (state.picks.length === 0 && !showEmpty) return null;
  const removedId = removable ? currentRemoval(state) : null;
  const removed = removedId ? byId.get(removedId) : null;
  const count = deckIds(state).length;
  const act = async (id: string | null) => { if (!busy) setErr(await remove(id)); };
  return (
    <section className={`${scroll ? 'flex min-h-0 flex-1 flex-col' : ''} ${className}`}>
      <h2 className="mb-1.5 text-[10px] tracking-widest text-white/40">TON DECK ({state.status === 'drafting' ? `${state.picks.length}/${DRAFT_SIZE}` : `${count} cartes`})</h2>
      {removable && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface-raised/50 px-3 py-2 text-xs">
          {removed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-white/70">Retirée : <span className="font-bold text-danger">{removed.name}</span></span>
              <Button className="shrink-0 px-3 py-1.5 text-xs" disabled={busy} onPointerDown={() => act(null)}>Remettre</Button>
            </>
          ) : (
            <span className="text-white/50">Touche une carte de ton deck pour la retirer (facultatif, une par duel).</span>
          )}
        </div>
      )}
      {err && <p className="mb-2 text-center text-xs text-danger">{err}</p>}
      <div className={scroll ? 'min-h-0 flex-1 overflow-y-auto' : ''}>
        <DeckTierGrid
          deck={deck}
          cols={cols}
          sideLabel={sideLabel}
          renderCard={(c, _t, idx) => (
            <Card3D
              key={`${c.id}-${idx}`}
              {...cardVisualProps(c, 'player', { plain: true })}
              size="h-auto w-full"
              {...(removable ? { tapOn: 'up' as const, onTap: () => act(c.id) } : {})}
            />
          )}
        />
      </div>
    </section>
  );
}
