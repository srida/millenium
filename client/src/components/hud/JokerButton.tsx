// Le joker du joueur, dans la barre de préparation (`PhaseControls`), juste
// après le chrono. Un bouton joker (`UI_JOKER`) qui ouvre deux choix (×2, ×0,5) vers le haut ;
// posé, il affiche le facteur en or, et retoucher le choix actif le retire. En
// combat il n'est pas monté : il n'y a plus rien à choisir, le facteur posé se
// lit sous la barre de PV (`JokerChip` du HUD). Il disparaît une fois le joker
// joué (un seul par partie).
//
// ⚠️ Aucune règle ici : disponibilité et pose passent par le contrôleur
// (`canPlayJoker`, `setJoker`), qui ajoute le verrou d'engagement du PvP.
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { Button } from '../ui/primitives.js';
import UiIcon from '../ui/UiIcon.js';
import { JOKER_CHOICES, jokerLabel } from '../../data/JokerInfo.js';
import type { JokerKind } from '../../logic/GameState.js';

const HINT = 'Joker : multiplie les dégâts de ce round, dans les deux sens';

export default function JokerButton() {
  const { controller, playerJoker, playerJokerUsed, canPlayJoker } = useGameStore();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Un tap n'importe où ailleurs referme le choix.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  // Le choix se referme de lui-même quand le geste cesse d'être disponible
  // (PRÊT tapé, chrono à 0).
  useEffect(() => { if (!canPlayJoker) setOpen(false); }, [canPlayJoker]);

  if (!controller) return null;
  const armed = jokerLabel(playerJoker);
  if (playerJokerUsed && !armed) return null;
  const pick = (kind: JokerKind | null) => { controller.setJoker(kind); setOpen(false); };

  return (
    <div ref={root} className="relative shrink-0">
      <Button
        variant={armed ? 'primary' : 'ghost'}
        aria-label={armed ? `Joker ${armed} posé${canPlayJoker ? ' — toucher pour changer' : ''}` : 'Poser le joker'}
        aria-expanded={open}
        title={HINT}
        disabled={!canPlayJoker}
        className={(armed ? 'shrink-0 px-2! ' : 'min-w-tap shrink-0 px-2.5! ') + (!canPlayJoker
          ? 'text-white/40'
          : armed ? '' : 'border-gold shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-gold)_40%,transparent),0_0_12px_color-mix(in_srgb,var(--color-gold)_30%,transparent)]!')}
        onPointerDown={(e) => { e.stopPropagation(); if (canPlayJoker) setOpen(o => !o); }}
      >
        <UiIcon id="UI_JOKER" className={armed ? 'h-4 w-4' : 'h-5 w-5'} />
        {armed && <span className="-ml-1.5 text-sm font-bold tabular-nums text-gold">{armed}</span>}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-1/2 z-30 mb-2 flex -translate-x-1/2 gap-1.5 rounded-[10px] border border-gold/50 bg-surface-raised p-1.5 shadow-lg"
        >
          {JOKER_CHOICES.map(c => (
            <button
              key={c.kind}
              type="button"
              role="menuitemradio"
              aria-checked={playerJoker === c.kind}
              title={c.hint}
              className={'flex h-[52px] w-16 items-center justify-center rounded-lg border bg-gradient-to-b from-[#272a33] to-[#0f1117] text-xl font-bold tabular-nums text-gold '
                + (playerJoker === c.kind ? 'border-gold' : 'border-line')}
              onPointerDown={(e) => { e.stopPropagation(); pick(playerJoker === c.kind ? null : c.kind); }}
            >
              {c.label}
            </button>
          ))}
          {/* La flèche, entre les deux chiffres, pointe vers le bouton. */}
          <span aria-hidden className="absolute -bottom-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-gold/50 bg-surface-raised" />
        </div>
      )}
    </div>
  );
}
