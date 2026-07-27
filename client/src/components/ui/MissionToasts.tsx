// Toasts de mission terminée / palier hebdomadaire franchi.
//
// Monté au niveau de l'App, pas d'un écran : le lot d'événements part en fin de
// partie et la réponse arrive souvent après la navigation vers le menu — un
// toast rendu par l'écran de jeu ne serait jamais vu.
//
// Volontairement non interactif (pointer-events-none) : rien à réclamer, la
// récompense est déjà créditée. Le toast informe, il ne demande rien.
import { useEffect } from 'react';
import { useMissionStore } from '../../stores/missionStore.js';
import { RewardList } from '../../screens/MissionsScreen.js';

const TOAST_MS = 6000;

export default function MissionToasts() {
  const toasts = useMissionStore(s => s.toasts);
  const dismiss = useMissionStore(s => s.dismissToast);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map(t => setTimeout(() => dismiss(t.key), TOAST_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (!toasts.length) return null;

  return (
    // Même hauteur que `Banner` (top-16) : en jeu, le haut de l'écran est
    // occupé par la barre de PV — un toast posé plus haut la recouvrirait.
    <div className="pointer-events-none fixed left-1/2 top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.key}
          className={`flex items-center gap-2 rounded-xl border bg-surface/95 px-3 py-2 shadow-lg backdrop-blur ${
            t.kind === 'milestone' ? 'border-gold/60' : 'border-success/60'
          }`}
        >
          <span aria-hidden="true">{t.kind === 'milestone' ? '🏅' : '🎯'}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{t.label}</p>
            <RewardList rewards={t.rewards} className="text-white/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
