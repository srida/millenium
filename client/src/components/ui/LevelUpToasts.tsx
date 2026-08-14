// Toasts de NIVEAU GAGNÉ.
//
// Monté au niveau de l'App, pas d'un écran, pour la même raison que
// MissionToasts : un niveau se gagne n'importe où — fin de duel, lot de
// missions, cadeau récupéré, victoire PvP — et souvent sur l'écran qu'on vient
// de quitter.
//
// ⚠️ Il annonce « à récupérer », il ne remet rien — exactement comme un toast
// de mission terminée. Les paliers se prennent d'un tap dans la section
// Progression du Profil (levels.js) ; ici, on signale qu'il y a quelque chose
// à y prendre. Le toast reste donc non interactif : un toast qui se solderait
// au tap se solderait aussi à côté, en pleine partie, sur un geste destiné au
// board. Rien n'est perdu s'il passe inaperçu — la pastille verte de la
// pastille de niveau le rappelle jusqu'à la récupération.
//
// Ce qu'il ne dit PAS : ce que le palier contient. L'objet du multiple de 10
// n'est tiré qu'au moment du tap (zéro doublon) — l'annoncer ici, ce serait
// promettre quelque chose qui n'existe pas encore.
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore.js';

const fmt = new Intl.NumberFormat('fr-FR');

// Même durée que le toast de mission : c'est la même nature d'annonce, et les
// deux tombent souvent ensemble.
const TOAST_MS = 3000;

export default function LevelUpToasts() {
  const toasts = useAuthStore(s => s.levelToasts);
  const dismiss = useAuthStore(s => s.dismissLevelToast);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map(t => setTimeout(() => dismiss(t.key), TOAST_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (!toasts.length) return null;

  return (
    // Collé à GAUCHE, là où les toasts de mission occupent la droite : les deux
    // familles peuvent tomber ensemble (une mission récupérée fait monter de
    // niveau), elles ne doivent pas se recouvrir.
    <div className="pointer-events-none fixed left-[max(0.5rem,env(safe-area-inset-left))] top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex w-[min(11rem,calc(100vw-1rem))] flex-col gap-1">
      {toasts.map(t => (
        <div key={t.key} className="flex items-center gap-1.5 rounded-lg border border-gold/60 bg-surface/95 px-2 py-1 shadow-lg backdrop-blur">
          <span className="text-[11px]" aria-hidden="true">⬆</span>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold leading-tight text-gold">Niveau {fmt.format(t.level)} !</p>
            <p className="text-[9px] leading-tight text-success">palier à récupérer au profil</p>
          </div>
        </div>
      ))}
    </div>
  );
}
