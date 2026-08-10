// Toasts de mission terminée / palier hebdomadaire franchi.
//
// Monté au niveau de l'App, pas d'un écran : le lot d'événements part en fin de
// partie et la réponse arrive souvent après la navigation vers le menu — un
// toast rendu par l'écran de jeu ne serait jamais vu.
//
// Volontairement non interactif (pointer-events-none) : un toast qui se solde
// au tap se solderait aussi à côté, en pleine partie, sur un geste destiné au
// board. Il ANNONCE le gain ; c'est l'écran Missions qui le remet, et la
// pastille verte du menu qui le rappelle jusque-là.
//
// Les deux familles annoncent la même chose depuis que le palier se réclame
// lui aussi : « à récupérer ». Seule l'icône les distingue.
import { useEffect } from 'react';
import { useMissionStore } from '../../stores/missionStore.js';
import { RewardList } from '../../screens/MissionsScreen.js';

// Court et sur le côté : le toast est une NOTIFICATION, pas une récompense à
// contempler — il n'y a rien à y faire (le gain se récupère à l'écran
// Missions, et la pastille verte du menu le rappelle indéfiniment). Il n'a
// donc pas à occuper le centre de l'écran ni à y rester : 3 s en vignette
// contre 6 s en bandeau centré.
const TOAST_MS = 3000;

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
    // Collé au bord DROIT, sous la barre de PV (top-16, hauteur de `Banner`) :
    // au centre, la vignette recouvrait les synergies d'attributs et le haut du
    // board. À droite, elle empiète au pire sur le cimetière — un rail qui n'a
    // rien d'actionnable pendant qu'un toast s'affiche.
    <div className="pointer-events-none fixed right-[max(0.5rem,env(safe-area-inset-right))] top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex w-[min(11rem,calc(100vw-1rem))] flex-col items-end gap-1">
      {toasts.map(t => (
        <div
          key={t.key}
          className={`flex max-w-full items-center gap-1.5 rounded-lg border bg-surface/95 px-2 py-1 shadow-lg backdrop-blur ${
            t.kind === 'milestone' ? 'border-gold/60' : 'border-success/60'
          }`}
        >
          <span className="text-[11px]" aria-hidden="true">{t.kind === 'milestone' ? '🏅' : '🎯'}</span>
          <div className="min-w-0">
            {/* Le libellé de la mission tient sur une ligne, tronqué : c'est un
                rappel de ce qui vient de tomber, il n'a pas à être lisible en
                entier — l'écran Missions le redonne en clair. */}
            <p className="truncate text-[10px] font-semibold leading-tight text-white">{t.label}</p>
            <div className="flex items-baseline gap-1">
              <RewardList rewards={t.rewards} className="text-white/60" />
              <span className="text-[9px] text-success">à récupérer</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
