// Toasts de GAIN À RÉCUPÉRER — mission terminée, palier hebdomadaire franchi,
// niveau gagné. Un seul hub pour les trois : ils annoncent la même chose (« il
// y a quelque chose à prendre »), tombent souvent ensemble (une mission
// récupérée fait monter de niveau) et se disputeraient l'écran s'ils étaient
// rendus à deux endroits. Seule l'icône les distingue.
//
// Monté au niveau de l'App, pas d'un écran : le lot d'événements part en fin de
// partie et la réponse arrive souvent une fois revenu au menu — un toast rendu
// par l'écran de jeu ne serait jamais vu.
//
// Volontairement non interactif (pointer-events-none) : un toast qui se solde
// au tap se solderait aussi à côté, en pleine partie, sur un geste destiné au
// board. Il ANNONCE le gain ; ce sont l'écran Missions et la section
// Progression du Profil qui le remettent, et les pastilles vertes du menu qui
// le rappellent jusque-là.
//
// ⚠️ Chaque file reste chez elle (`missionStore.toasts`, `authStore.levelToasts`)
// — un store ne cède pas son état à un composant d'affichage. Ce fichier ne
// fait que les rendre ensemble, et rend à chacun son geste de fermeture.
import { useEffect } from 'react';
import { useMissionStore } from '../../stores/missionStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { RewardList } from '../../screens/MissionsScreen.js';

// Court et sur le côté : le toast est une NOTIFICATION, pas une récompense à
// contempler — il n'y a rien à y faire. 3 s en vignette contre 6 s en bandeau
// centré.
const TOAST_MS = 3000;

type Kind = 'mission' | 'milestone' | 'level';

const ICONS: Record<Kind, string> = { mission: '🎯', milestone: '🏅', level: '⬆' };
const BORDERS: Record<Kind, string> = {
  mission: 'border-success/60',
  milestone: 'border-gold/60',
  level: 'border-gold/60',
};

export default function RewardToasts() {
  const missionToasts = useMissionStore(s => s.toasts);
  const dismissMission = useMissionStore(s => s.dismissToast);
  const levelToasts = useAuthStore(s => s.levelToasts);
  const dismissLevel = useAuthStore(s => s.dismissLevelToast);

  // Les clés des deux files sont indépendantes : le préfixe évite qu'un toast
  // de mission et un toast de niveau ne partagent la même clé React.
  const items = [
    ...missionToasts.map(t => ({
      id: `m${t.key}`,
      kind: t.kind as Kind,
      label: t.label,
      // Le barème de la mission est connu du client (il vient de l'instantané).
      rewards: t.rewards ?? {},
    })),
    ...levelToasts.map(t => ({
      id: `l${t.key}`,
      kind: 'level' as Kind,
      label: `Niveau ${t.level} !`,
      // ⚠️ Un palier n'annonce PAS ses montants : son objet n'est tiré qu'au
      // tap (zéro doublon), et afficher les golds sans l'objet donnerait une
      // idée fausse de ce qui attend. Le total exact est à un tap de là.
      rewards: {},
    })),
  ];

  // Les minuteries sont armées sur les FILES elles-mêmes et non sur `items`,
  // reconstruit à chaque rendu : l'effet doit se rejouer quand une file change,
  // pas à chaque passage du composant.
  useEffect(() => {
    const timers = [
      ...missionToasts.map(t => setTimeout(() => dismissMission(t.key), TOAST_MS)),
      ...levelToasts.map(t => setTimeout(() => dismissLevel(t.key), TOAST_MS)),
    ];
    return () => timers.forEach(clearTimeout);
  }, [missionToasts, levelToasts, dismissMission, dismissLevel]);

  if (!items.length) return null;

  return (
    // Collé au bord DROIT, sous la barre de PV (top-16, hauteur de `Banner`) :
    // au centre, la vignette recouvrait les synergies d'attributs et le haut du
    // board. À droite, elle empiète au pire sur le cimetière — un rail qui n'a
    // rien d'actionnable pendant qu'un toast s'affiche.
    <div className="pointer-events-none fixed right-[max(0.5rem,env(safe-area-inset-right))] top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex w-[min(11rem,calc(100vw-1rem))] flex-col items-end gap-1">
      {items.map(t => (
        <div
          key={t.id}
          className={`flex max-w-full items-center gap-1.5 rounded-lg border bg-surface/95 px-2 py-1 shadow-lg backdrop-blur ${BORDERS[t.kind]}`}
        >
          <span className="text-[11px]" aria-hidden="true">{ICONS[t.kind]}</span>
          <div className="min-w-0">
            {/* Le libellé tient sur une ligne, tronqué : c'est un rappel de ce
                qui vient de tomber, il n'a pas à être lisible en entier —
                l'écran qui porte le gain le redonne en clair. */}
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
