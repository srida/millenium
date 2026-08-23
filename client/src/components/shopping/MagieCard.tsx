/* eslint-disable @typescript-eslint/no-explicit-any */
// Carte de magie présentée pendant la Phase Shopping : vignette + nom + effet
// (effectLabel). Layout horizontal compact (mobile-first) : les 3 choix tiennent
// dans le modal sans scroll sur un écran portrait. Purement présentationnel —
// l'action de choix est déléguée au parent via onChoose.
import { effectLabel } from '../../logic/MagieEffect.js';
import type { Magie } from '../../logic/types.js';
import { Illustration } from '../ui/primitives.js';

export default function MagieCard({ magie, onChoose }: { magie: Magie; onChoose: (m: Magie) => void }) {
  return (
    <button
      onPointerDown={(e) => { e.stopPropagation(); onChoose(magie); }}
      className="flex w-full items-center gap-3 overflow-hidden rounded-lg border border-line bg-surface-raised p-2 text-left transition-colors hover:border-gold/60 active:opacity-80"
    >
      <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-black/40">
        {(magie as any)._has_illustration && (
          <Illustration id={magie.id} className="h-full w-full" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-gold">{magie.name}</div>
        <div className="text-[11px] leading-tight text-white/60">{(effectLabel as any)(magie)}</div>
      </div>
      <span className="flex-shrink-0 pr-1 text-white/30">▸</span>
    </button>
  );
}
