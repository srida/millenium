// OwnershipToggle — bascule cyclique à 3 états (Toutes → Obtenues → À obtenir
// → Toutes), en UNE icône plutôt que 3 chips séparés : c'est ce qui lui permet
// de tenir sur la même ligne que la recherche, les tiers et le tri.
//
// ⚠️ Contrôlé, pas d'état interne pour `value` : `CardCatalogGrid` le pose
// dans la requête (`debloquee:oui` / `debloquee:non` / absent), comme tout le
// reste du filtrage — une seule source de vérité, jamais un état à part qui
// pourrait la contredire.
//
// Le changement d'état se dit par un petit toast LOCAL (pas de store à faire
// parler pour ça) : le geste est silencieux sinon — on vient de changer ce que
// montre toute la grille sans qu'aucune ligne de texte permanente ne le dise.
import { useEffect, useRef, useState } from 'react';
import { usePressSquash } from '../ui/primitives.js';

export type Ownership = 'all' | 'owned' | 'missing';

const ORDER: Ownership[] = ['all', 'owned', 'missing'];
const META: Record<Ownership, { icon: string; label: string }> = {
  all: { icon: '🃏', label: 'Toutes les cartes' },
  owned: { icon: '✅', label: 'Cartes obtenues' },
  missing: { icon: '🎯', label: 'Cartes à obtenir' },
};
const TOAST_MS = 1600;

export default function OwnershipToggle({ value, onChange }: {
  value: Ownership;
  onChange: (next: Ownership) => void;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(value) + 1) % ORDER.length];
    onChange(next);
    setToast(META[next].label);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }

  const { squashed, handlers } = usePressSquash<HTMLButtonElement>(cycle, false);
  const meta = META[value];

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={meta.label}
        title={meta.label}
        className={`flex min-h-tap min-w-tap items-center justify-center rounded-lg border border-line bg-surface-raised text-base transition-transform duration-100 ease-out ${squashed ? 'scale-95' : ''}`}
        {...handlers}
      >
        <span aria-hidden="true">{meta.icon}</span>
      </button>
      {/* Toast local : ancré au bouton, pas de conflit avec le hub global
          (`RewardToasts`, réservé aux gains à récupérer). */}
      {toast && (
        <span
          role="status"
          className="pointer-events-none absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-lg border border-gold/40 bg-surface px-2 py-1 text-[11px] font-semibold text-gold shadow-lg"
        >
          {toast}
        </span>
      )}
    </div>
  );
}
