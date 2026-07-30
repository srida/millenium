// MissionsScreen — missions quotidiennes et jauge hebdomadaire.
//
// Écran de LECTURE : rien ne s'y réclame. Une mission terminée est créditée à
// l'instant où le serveur la valide (fin de partie), pas au moment où le joueur
// tape dessus — un gain qu'il faut penser à récupérer est un gain qu'on perd.
// L'écran montre donc l'état, et n'offre qu'une seule action : le reroll.
//
// Toutes les valeurs viennent du serveur (missions.js) : barème, cible,
// progression, paliers. Le client n'en calcule aucune.
import { useEffect, useState } from 'react';
import { useUiStore } from '../stores/uiStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useMissionStore, type Mission, type WeeklyMilestone } from '../stores/missionStore.js';
import { Button, Panel, Gauge, Countdown } from '../components/ui/primitives.js';
import { ScreenHeader } from '../components/ui/ScreenHeader.js';

const fmt = new Intl.NumberFormat('fr-FR');

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

  if (!user) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-center text-white">
        <p className="text-sm text-white/60">
          Les missions quotidiennes suivent ta progression :<br />elles demandent un compte.
        </p>
        <Button variant="primary" onPointerDown={() => navigate('auth')}>Se connecter</Button>
        <Button onPointerDown={() => navigate('main_menu')}>◂ Menu</Button>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-surface text-white">
      <ScreenHeader
        title="Missions"
        onBack={() => navigate('main_menu')}
        safeAreaTop
        right={snapshot && <Countdown at={snapshot.cycle.next_reset_at} title="Prochaines missions" />}
      />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
        {error && <p className="text-xs text-danger">{error}</p>}
        {loading && !snapshot && <p className="text-sm text-white/40">Chargement…</p>}

        {snapshot && (
          <>
            <WeeklyGauge points={snapshot.weekly.points} max={snapshot.weekly.max} milestones={snapshot.weekly.milestones} />

            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-[10px] tracking-widest text-white/40">
                EN COURS — {snapshot.missions.filter(m => m.status === 'active').length}/{snapshot.cycle.max_active}
              </h2>
              <span className="text-[10px] text-white/30">
                {snapshot.reroll.free_available
                  ? '1 reroll gratuit'
                  : `reroll : ${fmt.format(snapshot.reroll.cost)} 💰`}
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
              {' '}d'absence pardonnées). Les récompenses sont créditées dès qu'une mission se termine.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function WeeklyGauge({ points, max, milestones }: { points: number; max: number; milestones: WeeklyMilestone[] }) {
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

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {milestones.map(ms => (
          <li
            key={ms.points}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] tabular-nums ${
              ms.claimed ? 'border-success/50 bg-success/10 text-success' : 'border-line bg-surface/60 text-white/60'
            }`}
          >
            <span className="font-semibold">{ms.claimed ? '✓' : ms.points}</span>
            <RewardList rewards={ms.rewards} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MissionCard({ mission, rerollCost }: { mission: Mission; rerollCost: number }) {
  const reroll = useMissionStore(s => s.reroll);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const done = mission.status === 'completed';
  const slot = SLOTS[mission.slot_weight] ?? SLOTS[1];

  async function doReroll() {
    setBusy(true);
    setErr(await reroll(mission.id));
    setBusy(false);
  }

  return (
    <Panel className={`flex flex-col gap-2 p-3 ${done ? 'border-success/40 bg-success/5' : ''}`}>
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

      <div className="flex items-center gap-2">
        <RewardList rewards={mission.rewards} className={done ? 'text-success' : 'text-white/60'} />
        {!done && (
          <button
            disabled={busy}
            onPointerDown={doReroll}
            title={rerollCost ? `Changer de mission — ${fmt.format(rerollCost)} golds` : 'Changer de mission (gratuit)'}
            aria-label="Changer de mission"
            className="ml-auto flex min-h-tap min-w-tap items-center justify-center rounded-lg border border-line px-2 text-xs text-white/50 active:opacity-70 disabled:opacity-30"
          >
            {busy ? '…' : rerollCost ? `🎲 ${fmt.format(rerollCost)}` : '🎲'}
          </button>
        )}
      </div>
      {err && <p className="text-[10px] text-danger">{err}</p>}
    </Panel>
  );
}

// Récompenses d'une mission ou d'un palier. Mêmes icônes et mêmes couleurs que
// ProgressionStats : un gold doit se lire pareil partout.
export function RewardList({ rewards, className = '' }: { rewards: { xp?: number; gold?: number; gems?: number }; className?: string }) {
  const parts: string[] = [];
  if (rewards.xp) parts.push(`✨ ${fmt.format(rewards.xp)}`);
  if (rewards.gold) parts.push(`💰 ${fmt.format(rewards.gold)}`);
  if (rewards.gems) parts.push(`💎 ${fmt.format(rewards.gems)}`);
  if (!parts.length) return null;
  return <span className={`text-[11px] tabular-nums ${className}`}>{parts.join('  ')}</span>;
}
