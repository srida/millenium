// MissionsScreen — missions quotidiennes et jauge hebdomadaire.
//
// Le gain d'une mission terminée SE RÉCUPÈRE : le serveur la valide en fin de
// partie, le joueur la solde d'un tap. Contrepartie assumée de ce geste : une
// mission terminée mais non récupérée n'est jamais purgée (le reset quotidien
// n'emporte que les soldées), sinon oublier de taper reviendrait à perdre.
//
// La jauge hebdomadaire avance elle aussi AU TAP, d'un cran par mission
// récupérée : le joueur voit la barre bouger devant lui au lieu de la découvrir
// déjà remplie. Et un palier atteint se récupère de la même façon, en tapant sa
// pastille — le serveur le solde d'office au changement de semaine s'il a été
// oublié, aucun gain mérité ne se perd.
//
// Toutes les valeurs viennent du serveur (missions.js) : barème, cible,
// progression, paliers. Le client n'en calcule aucune.
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore.js';
import { useMissionStore, markMissionsSeen, claimableMissions, type Mission, type WeeklyMilestone } from '../stores/missionStore.js';
import { Button, Countdown, Gauge, LoadState, Panel, SHADOW_IDLE, SHADOW_SQUASHED, usePressSquash } from '../components/ui/primitives.js';
import { CURRENCY, fmt, XP_ICON } from '../components/ui/currency.js';
import { GuestGate } from '../components/ui/GuestGate.js';
import UiIcon, { type UiIconId } from '../components/ui/UiIcon.js';
import { useWebLayout } from '../components/system/useWebLayout.js';
import * as Audio from '../audio/AudioManager.js';

// Difficulté du slot (brief §3.1) : facile = 1 partie, moyen = 2, engagé = 3-4.
const SLOTS: Record<number, { label: string; cls: string }> = {
  1: { label: 'Facile',  cls: 'border-success/50 text-success' },
  2: { label: 'Moyen',   cls: 'border-gold/50 text-gold' },
  3: { label: 'Engagé',  cls: 'border-gold/60 text-gold' },
};

const FAMILY_ICONS: Record<string, UiIconId> = {
  presence: 'UI_GAMEPAD', mechanical: 'UI_DUEL', synergy: 'UI_LINKED', shopping: 'UI_XP', meta: 'UI_FOLDER',
};

export default function MissionsScreen() {
  const user = useAuthStore(s => s.user);
  const { snapshot, loading, error, load } = useMissionStore();
  const web = useWebLayout();

  useEffect(() => { void load(true); }, [load]);
  // La dépendance est le CHAMP, pas l'instantané : ce dernier change d'identité
  // à chaque réponse (envoi d'événements, récupération d'une mission), et on ne
  // veut re-marquer « vu » que quand le cycle, lui, a tourné.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cf. ci-dessus
  useEffect(() => { if (user && snapshot) markMissionsSeen(user.id, snapshot.cycle.next_reset_at); }, [user, snapshot?.cycle.next_reset_at]);

  const pending = claimableMissions(snapshot);

  if (!user) return <GuestGate reason="Les missions quotidiennes suivent ta progression : elles demandent un compte." />;

  const gauge = snapshot && <WeeklyGauge points={snapshot.weekly.points} max={snapshot.weekly.max} milestones={snapshot.weekly.milestones} />;
  const cards = snapshot && snapshot.missions.map(m => (
    <MissionCard key={m.id} mission={m} rerollCost={snapshot.reroll.free_available ? 0 : snapshot.reroll.cost} />
  ));
  const title = (bordered: boolean) => (
    <div className={`flex items-center gap-3 ${bordered ? 'border-b border-line px-6 py-3' : ''}`}>
      <h1 className="text-lg font-bold tracking-wide">Missions</h1>
      {snapshot && <Countdown at={snapshot.cycle.next_reset_at} title="Prochaines missions" className="ml-auto" />}
    </div>
  );
  const activeHeader = snapshot && (
    <div className="flex items-baseline justify-between px-1">
      <h2 className="text-[10px] tracking-widest text-white/40">
        EN COURS — {snapshot.missions.filter(m => m.status === 'active').length}/{snapshot.cycle.max_active}
        {pending > 0 && (
          <span className="ml-2 text-success">
            · {pending} GAIN{pending > 1 ? 'S' : ''} À RÉCUPÉRER
          </span>
        )}
      </h2>
      <span className="flex items-center gap-1 text-[10px] text-white/30">
        {snapshot.reroll.free_available
          ? '1 reroll gratuit'
          : <>reroll : {fmt.format(snapshot.reroll.cost)} <UiIcon id={CURRENCY.gold.icon} className="h-3 w-3" /></>}
      </span>
    </div>
  );
  // Le plafond d'accumulation est une règle, pas une punition : on le dit,
  // sinon un joueur absent croit avoir perdu ses missions.
  const footnote = snapshot && (
    <p className="px-1 text-[10px] leading-relaxed text-white/30">
      {snapshot.cycle.count} nouvelles missions toutes les {snapshot.cycle.hours} h, cumulables
      {' '}jusqu'à {snapshot.cycle.max_active} ({Math.round(snapshot.cycle.max_active / snapshot.cycle.count * snapshot.cycle.hours)} h
      {' '}d'absence pardonnées). Un gain terminé t'attend aussi longtemps qu'il le faut :
      {' '}seules les missions déjà récupérées s'effacent au reset.
    </p>
  );
  const load_ = <LoadState error={error} loading={loading} hasContent={!!snapshot} />;

  // Paysage : deux colonnes qui défilent chacune de leur côté — la jauge reste
  // visible pendant qu'on parcourt les missions.
  if (web) {
    return (
      <main className="relative z-10 grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] gap-4 text-white pl-[max(5.5rem,env(safe-area-inset-left))] pr-[max(5.5rem,env(safe-area-inset-right))]">
        <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto py-3">
          {title(false)}
          {load_}
          {gauge}
        </aside>
        <section className="flex min-h-0 flex-col gap-2.5 overflow-y-auto py-3">
          {activeHeader}
          <div className="grid grid-cols-2 gap-2">{cards}</div>
          {footnote}
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-full flex-col relative z-10 text-white">
      {title(true)}

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
        {load_}
        {snapshot && (
          <>
            {gauge}
            {activeHeader}
            <div className="grid gap-2">{cards}</div>
            {footnote}
          </>
        )}
      </div>
    </main>
  );
}

// --- Jauge hebdomadaire : frise de jalons + UNE carte de détail ---
//
// Code couleur d'état, identique aux paliers de niveau (Profil) : vert = à
// récupérer, vert atténué = récupéré, or = prochain, gris = à venir.

const HALO = 'shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-success)_18%,transparent),0_0_12px_color-mix(in_srgb,var(--color-success)_50%,transparent)]';
const CLAIM_BG = 'bg-[color-mix(in_srgb,var(--color-success)_30%,var(--color-surface-raised))]';

function Milestone({ ms, pct, state, busy, onClaim }: {
  ms: WeeklyMilestone; pct: number; state: 'claimed' | 'claim' | 'next' | 'todo'; busy: boolean; onClaim: () => void;
}) {
  const pastille = {
    claimed: (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-success bg-[color-mix(in_srgb,var(--color-success)_28%,var(--color-surface-raised))]">
        <UiIcon id="UI_CHECK" className="h-[11px] w-[11px]" />
      </span>
    ),
    claim: (
      <button
        type="button"
        disabled={busy}
        onPointerDown={() => { Audio.playSfx('menu_button'); onClaim(); }}
        aria-label={`Récupérer le palier ${ms.points}`}
        className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-success ${CLAIM_BG} ${HALO} active:scale-90 disabled:opacity-40`}
      >
        <UiIcon id="UI_GIFTS" className="h-3.5 w-3.5" />
      </button>
    ),
    next: (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-gold bg-surface-raised shadow-[0_0_8px_color-mix(in_srgb,var(--color-gold)_35%,transparent)]">
        <span className="h-1.5 w-1.5 rounded-full bg-gold" />
      </span>
    ),
    todo: <span className="h-3 w-3 rounded-full border-[1.5px] border-line-strong bg-surface-raised" />,
  }[state];
  const nombre = {
    claimed: 'font-medium text-success/60',
    claim: 'font-bold text-success',
    next: 'font-bold text-gold',
    todo: 'font-medium text-white/35',
  }[state];

  return (
    <div className="absolute top-0 flex w-0 flex-col items-center" style={{ left: `${pct}%` }}>
      <div className="flex h-[26px] items-center justify-center">{pastille}</div>
      <span className={`mt-[3px] text-[10px] tabular-nums ${nombre}`}>{ms.points}</span>
    </div>
  );
}

function WeeklyGauge({ points, max, milestones }: { points: number; max: number; milestones: WeeklyMilestone[] }) {
  const claimMilestone = useMissionStore(s => s.claimMilestone);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Le prochain palier ENCORE À ATTEINDRE est signalé : à cinq marches, « où
  // j'en suis » ne se lit plus d'un coup d'œil sur la seule couleur.
  const next = milestones.find(ms => points < ms.points) ?? null;
  const firstClaimable = milestones.find(ms => !ms.claimed && points >= ms.points) ?? null;

  async function claim(p: number) {
    setBusy(p);
    setErr(await claimMilestone(p));
    setBusy(null);
  }

  const stateOf = (ms: WeeklyMilestone) =>
    ms.claimed ? 'claimed' as const
      : points >= ms.points ? 'claim' as const
      : ms === next ? 'next' as const
      : 'todo' as const;

  return (
    <Panel className="flex flex-col gap-2.5 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] tracking-widest text-white/40">SEMAINE</span>
        <span className="text-sm font-bold tabular-nums text-gold">{points} / {max}</span>
      </div>

      {/* Frise : jalons posés à leur position réelle sur la barre — la distance
          au prochain palier se lit sans compter. `mx-[13px]` : le dernier jalon
          (26 px) ne doit pas être rogné par le bord du panneau. */}
      <div className="relative mx-[13px] h-11">
        <div className="absolute inset-x-0 top-[9px] h-2 overflow-hidden rounded-full bg-black/50">
          <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(1, points / max) * 100}%` }} />
        </div>
        {milestones.map(ms => (
          <Milestone
            key={ms.points}
            ms={ms}
            pct={(ms.points / max) * 100}
            state={stateOf(ms)}
            busy={busy === ms.points}
            onClaim={() => void claim(ms.points)}
          />
        ))}
      </div>

      <MilestoneDetail
        points={points}
        claimable={firstClaimable}
        next={next}
        busy={busy !== null}
        onClaim={p => void claim(p)}
      />

      {err && (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-2 py-1.5 text-xs leading-snug text-danger">
          {err}
        </p>
      )}
    </Panel>
  );
}

// La carte de détail : une seule, par priorité — le gain à récupérer, sinon le
// prochain objectif, sinon la semaine bouclée. Les jalons de la frise (26 px)
// sont trop petits pour un pouce : ce bouton fait la même action en 44 px+.
function MilestoneDetail({ points, claimable, next, busy, onClaim }: {
  points: number; claimable: WeeklyMilestone | null; next: WeeklyMilestone | null; busy: boolean; onClaim: (p: number) => void;
}) {
  const { squashed, handlers } = usePressSquash<HTMLButtonElement>(claimable ? () => onClaim(claimable.points) : undefined, busy);
  const box = 'min-h-[52px] rounded-[10px] px-3 py-2';

  if (claimable) {
    return (
      <button
        type="button"
        disabled={busy}
        {...handlers}
        className={`${box} flex w-full items-center gap-3 border border-success bg-gradient-to-b from-[color-mix(in_srgb,var(--color-success)_28%,var(--color-surface-raised))] to-[color-mix(in_srgb,var(--color-success)_12%,var(--color-surface))] text-left text-success transition-[transform,box-shadow] duration-100 disabled:opacity-60 ${squashed ? SHADOW_SQUASHED : SHADOW_IDLE}`}
      >
        <UiIcon id="UI_GIFTS" className="h-[22px] w-[22px]" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-semibold">Palier {claimable.points} atteint</span>
          <RewardList rewards={claimable.rewards} size="md" />
        </span>
        <span className="text-xs font-bold tracking-wide">{busy ? '…' : 'RÉCUPÉRER'}</span>
      </button>
    );
  }

  if (next) {
    const left = next.points - points;
    return (
      <div className={`${box} flex items-center justify-between gap-3 border border-gold/45 bg-[color-mix(in_srgb,var(--color-gold)_8%,var(--color-surface-sunken))]`}>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] tracking-widest text-white/45">PROCHAIN PALIER · {next.points}</span>
          <RewardList rewards={next.rewards} size="lg" colored />
        </div>
        <div className="flex flex-col items-end leading-none">
          <span className="text-lg font-bold tabular-nums">{left}</span>
          <span className="mt-0.5 text-[10px] text-white/45">mission{left > 1 ? 's' : ''}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${box} flex items-center gap-2.5 border border-success/35 bg-[color-mix(in_srgb,var(--color-success)_6%,var(--color-surface-sunken))]`}>
      <UiIcon id="UI_CHECK" className="h-[18px] w-[18px]" />
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-success">Semaine bouclée</span>
        <span className="text-[11px] text-white/45">Tous les paliers sont récupérés. La jauge repart à zéro lundi.</span>
      </div>
    </div>
  );
}

function MissionCard({ mission, rerollCost }: { mission: Mission; rerollCost: number }) {
  const reroll = useMissionStore(s => s.reroll);
  const claim = useMissionStore(s => s.claim);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const claimable = mission.status === 'completed';   // terminée, gain en attente
  const claimed = mission.status === 'claimed';       // soldée
  const done = claimable || claimed;
  const slot = SLOTS[mission.slot_weight] ?? SLOTS[1];

  async function run(action: (id: string) => Promise<string | null>) {
    setBusy(true);
    setErr(await action(mission.id));
    setBusy(false);
  }

  return (
    // `min-w-0` : item de grille, dont le `min-width` vaut `auto` par défaut —
    // sans lui, la tuile refuse de descendre sous sa largeur de min-content et
    // déborde l'écran par la droite en portrait (cf. `BoosterCard`, ShopScreen).
    <Panel
      className={`flex min-w-0 flex-col gap-2 p-3 ${
        claimable ? 'border-success bg-success/10' : claimed ? 'border-success/30 bg-success/5' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <UiIcon id={FAMILY_ICONS[mission.family] ?? 'UI_MISSIONS'} className="h-4 w-4 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className={`flex items-center gap-1 text-sm font-semibold leading-tight ${done ? 'text-success' : 'text-white'}`}>
            {done && <UiIcon id="UI_CHECK" className="h-3 w-3 flex-shrink-0" />}{mission.label}
          </p>
          {mission.scope_hint && (
            <span className="mt-0.5 inline-block text-[10px] italic text-white/40">{mission.scope_hint}</span>
          )}
        </div>
        <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${slot.cls}`}>{slot.label}</span>
      </div>

      {/* Une cible de 1 n'a pas de progression à montrer : la barre serait
          toujours vide ou pleine. Le libellé et l'état ✓ suffisent. */}
      {mission.target > 1 && !done && (
        <div className="flex items-center gap-2">
          <Gauge value={mission.progress / mission.target} className="h-1.5 flex-1" fillClassName="bg-player" />
          <span className="text-[10px] tabular-nums text-white/40">{mission.progress}/{mission.target}</span>
        </div>
      )}

      {/* Le gain à récupérer prend toute la largeur : c'est la seule chose à
          faire sur cette carte, elle ne se dispute pas la place avec le dé. */}
      {claimable ? (
        <Button
          variant="primary"
          disabled={busy}
          onPointerDown={() => void run(claim)}
          className="w-full justify-center gap-2 border-success bg-success/20 text-success"
        >
          {busy ? '…' : <>Récupérer <RewardList rewards={mission.rewards} className="text-success" /></>}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <RewardList rewards={mission.rewards} className={claimed ? 'text-success/60 line-through' : 'text-white/60'} />
          {!done && (
            <button
              disabled={busy}
              onPointerDown={() => { Audio.playSfx('menu_button'); void run(reroll); }}
              title={rerollCost ? `Changer de mission — ${fmt.format(rerollCost)} golds` : 'Changer de mission (gratuit)'}
              aria-label="Changer de mission"
              className="ml-auto flex min-h-tap min-w-tap items-center justify-center gap-1 rounded-lg border border-line px-2 text-xs text-white/50 active:opacity-70 disabled:opacity-30"
            >
              {busy ? '…' : <><UiIcon id="UI_REROLL" className="h-3.5 w-3.5" />{rerollCost ? ` ${fmt.format(rerollCost)}` : ''}</>}
            </button>
          )}
          {claimed && <span className="ml-auto text-[10px] text-success/60">récupéré</span>}
        </div>
      )}
      {/* Un échec de récupération se lit : à 10 px sous la carte, un bouton qui
          ne fait « rien » passe pour cassé au lieu de pour empêché. */}
      {err && (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-2 py-1.5 text-xs leading-snug text-danger">
          {err}
        </p>
      )}
    </Panel>
  );
}

// Récompenses d'une mission ou d'un palier. Mêmes icônes et mêmes couleurs que
// ProgressionStats : un gold doit se lire pareil partout.
//
// `size` : `sm` (carte de mission), `md` (palier à récupérer), `lg` (prochain
// palier). `colored` teinte chaque monnaie (or / violet / blanc).
const REWARD_SIZES = {
  sm: { text: 'text-[11px]', icon: 'h-3 w-3', gap: 'gap-2' },
  md: { text: 'text-xs', icon: 'h-[13px] w-[13px]', gap: 'gap-2.5' },
  lg: { text: 'text-sm font-semibold', icon: 'h-[15px] w-[15px]', gap: 'gap-3' },
} as const;

export function RewardList({ rewards, className = '', size = 'sm', colored = false }: {
  rewards: { xp?: number; gold?: number; gems?: number }; className?: string; size?: keyof typeof REWARD_SIZES; colored?: boolean;
}) {
  const z = REWARD_SIZES[size];
  const parts: ReactNode[] = [];
  const part = (key: string, icon: UiIconId, value: number, tint: string) =>
    parts.push(
      <span key={key} className={`inline-flex items-center gap-0.5 ${colored ? tint : ''}`}>
        <UiIcon id={icon} className={z.icon} />{fmt.format(value)}
      </span>,
    );
  if (rewards.xp) part('xp', XP_ICON, rewards.xp, 'text-white/85');
  if (rewards.gold) part('gold', CURRENCY.gold.icon, rewards.gold, 'text-gold');
  if (rewards.gems) part('gems', CURRENCY.gems.icon, rewards.gems, 'text-violet');
  if (!parts.length) return null;
  return <span className={`inline-flex items-center ${z.gap} tabular-nums ${z.text} ${className}`}>{parts}</span>;
}
