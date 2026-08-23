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
import { useEffect, useState } from 'react';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useMissionStore, markMissionsSeen, claimableMissions, type Mission, type WeeklyMilestone } from '../stores/missionStore.js';
import { Button, Countdown, Gauge, LoadState, Panel } from '../components/ui/primitives.js';
import { CURRENCY, fmt, XP_ICON } from '../components/ui/currency.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';
import { GuestGate } from '../components/ui/GuestGate.js';

// Difficulté du slot (brief §3.1) : facile = 1 partie, moyen = 2, engagé = 3-4.
const SLOTS: Record<number, { label: string; cls: string }> = {
  1: { label: 'Facile',  cls: 'border-success/50 text-success' },
  2: { label: 'Moyen',   cls: 'border-gold/50 text-gold' },
  3: { label: 'Engagé',  cls: 'border-tier-5/60 text-tier-5' },
};

const FAMILY_ICONS: Record<string, string> = {
  presence: '🎮', mechanical: '⚔️', synergy: '🧬', shopping: '✨', meta: '🗂️',
};

export default function MissionsScreen() {
  const navigate = useUiStore(s => s.navigate);
  const user = useAuthStore(s => s.user);
  const { snapshot, loading, error, load } = useMissionStore();

  useEffect(() => { void load(true); }, [load]);
  // La dépendance est le CHAMP, pas l'instantané : ce dernier change d'identité
  // à chaque réponse (envoi d'événements, récupération d'une mission), et on ne
  // veut re-marquer « vu » que quand le cycle, lui, a tourné.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cf. ci-dessus
  useEffect(() => { if (user && snapshot) markMissionsSeen(user.id, snapshot.cycle.next_reset_at); }, [user, snapshot?.cycle.next_reset_at]);

  const pending = claimableMissions(snapshot);

  if (!user) return <GuestGate reason="Les missions quotidiennes suivent ta progression : elles demandent un compte." />;

  return (
    <main className="flex min-h-dvh flex-col relative z-10 text-white">
      <ScreenHeader
        title="Missions"
        onBack={() => navigate('main_menu')}
        right={snapshot && <Countdown at={snapshot.cycle.next_reset_at} title="Prochaines missions" />}
      />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
        <LoadState error={error} loading={loading} hasContent={!!snapshot} />

        {snapshot && (
          <>
            <WeeklyGauge points={snapshot.weekly.points} max={snapshot.weekly.max} milestones={snapshot.weekly.milestones} />

            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-[10px] tracking-widest text-white/40">
                EN COURS — {snapshot.missions.filter(m => m.status === 'active').length}/{snapshot.cycle.max_active}
                {pending > 0 && (
                  <span className="ml-2 text-success">
                    · {pending} GAIN{pending > 1 ? 'S' : ''} À RÉCUPÉRER
                  </span>
                )}
              </h2>
              <span className="text-[10px] text-white/30">
                {snapshot.reroll.free_available
                  ? '1 reroll gratuit'
                  : `reroll : ${fmt.format(snapshot.reroll.cost)} ${CURRENCY.gold.icon}`}
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {snapshot.missions.map(m => (
                <MissionCard key={m.id} mission={m} rerollCost={snapshot.reroll.free_available ? 0 : snapshot.reroll.cost} />
              ))}
            </div>

            {/* Le plafond d'accumulation est une règle, pas une punition : on le
                dit, sinon un joueur absent croit avoir perdu ses missions. */}
            <p className="px-1 text-[10px] leading-relaxed text-white/30">
              {snapshot.cycle.count} nouvelles missions toutes les {snapshot.cycle.hours} h, cumulables
              {' '}jusqu'à {snapshot.cycle.max_active} ({Math.round(snapshot.cycle.max_active / snapshot.cycle.count * snapshot.cycle.hours)} h
              {' '}d'absence pardonnées). Un gain terminé t'attend aussi longtemps qu'il le faut :
              {' '}seules les missions déjà récupérées s'effacent au reset.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function WeeklyGauge({ points, max, milestones }: { points: number; max: number; milestones: WeeklyMilestone[] }) {
  const claimMilestone = useMissionStore(s => s.claimMilestone);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Le prochain palier ENCORE À ATTEINDRE est signalé : à cinq marches, « où
  // j'en suis » ne se lit plus d'un coup d'œil sur la seule couleur.
  const next = milestones.find(ms => points < ms.points)?.points ?? null;

  async function claim(p: number) {
    setBusy(p);
    setErr(await claimMilestone(p));
    setBusy(null);
  }

  return (
    <Panel className="p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] tracking-widest text-white/40">SEMAINE</span>
        <span className="text-sm font-bold tabular-nums text-gold">{points} / {max}</span>
      </div>

      {/* Jauge + jalons posés à leur position réelle sur la barre : la distance
          au prochain palier se lit d'un coup d'œil, sans compter. */}
      <div className="relative mt-2">
        <Gauge value={points / max} className="h-2.5" fillClassName="bg-gold" />
        {milestones.map(ms => (
          <span
            key={ms.points}
            className="absolute top-0 h-2.5 w-px bg-black/60"
            style={{ left: `${(ms.points / max) * 100}%` }}
          />
        ))}
      </div>

      {/* Un palier atteint est un BOUTON : c'est le même geste que sur une carte
          de mission, et il doit se voir comme tel (pastille pleine, 🎁). Les
          autres restent des pastilles inertes — rien à y faire. */}
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {milestones.map(ms => {
          const claimable = !ms.claimed && points >= ms.points;
          const chip = 'flex min-h-tap items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] tabular-nums';
          if (claimable) {
            return (
              <li key={ms.points}>
                <button
                  disabled={busy === ms.points}
                  onPointerDown={() => void claim(ms.points)}
                  aria-label={`Récupérer le palier ${ms.points}`}
                  className={`${chip} border-success bg-success/25 font-semibold text-success active:opacity-70 disabled:opacity-40`}
                >
                  {busy === ms.points ? '…' : <>🎁 <RewardList rewards={ms.rewards} className="text-success" /></>}
                </button>
              </li>
            );
          }
          return (
            <li
              key={ms.points}
              className={`${chip} ${
                ms.claimed ? 'border-success/40 bg-success/5 text-success/60'
                  : ms.points === next ? 'border-gold/60 bg-gold/10 text-white/80'
                  : 'border-line bg-surface/60 text-white/60'
              }`}
            >
              <span className="font-semibold">{ms.claimed ? '✓' : ms.points}</span>
              <RewardList rewards={ms.rewards} />
            </li>
          );
        })}
      </ul>
      {err && (
        <p role="alert" className="mt-2 rounded-lg border border-danger/50 bg-danger/10 px-2 py-1.5 text-xs leading-snug text-danger">
          {err}
        </p>
      )}
    </Panel>
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
        <span aria-hidden="true" className="text-base leading-tight">{FAMILY_ICONS[mission.family] ?? '🎯'}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold leading-tight ${done ? 'text-success' : 'text-white'}`}>
            {done && '✓ '}{mission.label}
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
              onPointerDown={() => void run(reroll)}
              title={rerollCost ? `Changer de mission — ${fmt.format(rerollCost)} golds` : 'Changer de mission (gratuit)'}
              aria-label="Changer de mission"
              className="ml-auto flex min-h-tap min-w-tap items-center justify-center rounded-lg border border-line px-2 text-xs text-white/50 active:opacity-70 disabled:opacity-30"
            >
              {busy ? '…' : rerollCost ? `🎲 ${fmt.format(rerollCost)}` : '🎲'}
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
export function RewardList({ rewards, className = '' }: { rewards: { xp?: number; gold?: number; gems?: number }; className?: string }) {
  const parts: string[] = [];
  if (rewards.xp) parts.push(`${XP_ICON} ${fmt.format(rewards.xp)}`);
  if (rewards.gold) parts.push(`${CURRENCY.gold.icon} ${fmt.format(rewards.gold)}`);
  if (rewards.gems) parts.push(`${CURRENCY.gems.icon} ${fmt.format(rewards.gems)}`);
  if (!parts.length) return null;
  return <span className={`text-[11px] tabular-nums ${className}`}>{parts.join('  ')}</span>;
}
