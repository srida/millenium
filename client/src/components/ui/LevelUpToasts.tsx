// Toasts de PALIER DE NIVEAU franchi.
//
// Monté au niveau de l'App, pas d'un écran, pour la même raison que
// MissionToasts : un niveau se gagne n'importe où — fin de duel, lot de
// missions, cadeau récupéré, victoire PvP — et souvent sur l'écran qu'on vient
// de quitter.
//
// ⚠️ Il ANNONCE un gain DÉJÀ VERSÉ, il ne le remet pas. C'est toute la
// différence avec un toast de mission, qui dit « à récupérer » : un palier de
// niveau n'a pas d'écran où se réclamer (cf. l'en-tête de levels.js), le
// serveur l'a donc crédité en même temps qu'il l'a annoncé. Le toast reste
// non interactif — il n'y a rien à y taper.
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore.js';

const fmt = new Intl.NumberFormat('fr-FR');

// Plus long que le toast de mission (3 s) : celui-ci porte parfois un objet
// tiré au sort, dont le nom demande à être lu. Il reste une notification — le
// détail des paliers vit à l'écran Profil.
const TOAST_MS = 4500;

const ITEM_ICONS: Record<string, string> = { card: '🃏', avatar: '🎭', variant: '🎨' };

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
    <div className="pointer-events-none fixed left-[max(0.5rem,env(safe-area-inset-left))] top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex w-[min(12rem,calc(100vw-1rem))] flex-col gap-1">
      {toasts.map(t => (
        <div key={t.key} className="rounded-lg border border-gold/60 bg-surface/95 px-2 py-1 shadow-lg backdrop-blur">
          <p className="text-[11px] font-bold leading-tight text-gold">⬆ Niveau {fmt.format(t.level)} !</p>
          <div className="flex items-baseline gap-2 text-[10px] tabular-nums">
            <span className="text-gold/90">💰 {fmt.format(t.gold)}</span>
            {t.gems > 0 && <span className="text-tier-4">💎 {fmt.format(t.gems)}</span>}
          </div>
          {t.item && (
            // L'objet est nommé : c'est la seule partie du palier que le joueur
            // ne peut pas deviner, et elle ne se retrouve nulle part ailleurs.
            <p className="truncate text-[10px] leading-tight text-white/70">
              <span aria-hidden="true">{ITEM_ICONS[t.item.type] ?? '🎁'}</span> {t.item.label}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
