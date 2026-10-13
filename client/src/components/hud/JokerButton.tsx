// Le joker du joueur, dans le HUD à côté de ses PV. Une pastille 🃏 qui ouvre
// deux choix (×2, ×0,5) en préparation ; posé, elle affiche le facteur en or,
// et un nouveau tap rouvre le choix pour le changer ou le retirer. Elle
// disparaît une fois le joker joué (un seul par partie).
// ⚠️ Dans le HUD et non dans la barre de phase : à 375 px de large, un bouton
// de plus y poussait PRÊT hors de l'écran.
//
// ⚠️ Aucune règle ici : disponibilité et pose passent par le contrôleur
// (`canPlayJoker`, `setJoker`), qui ajoute le verrou d'engagement du PvP.
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { Button } from '../ui/primitives.js';
import { JOKER_CHOICES, jokerLabel } from '../../data/JokerInfo.js';
import type { JokerKind } from '../../logic/GameState.js';

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
  // Joué : le facteur reste affiché tout le combat, puis plus rien.
  if (playerJokerUsed && !armed) return null;
  const pick = (kind: JokerKind | null) => { controller.setJoker(kind); setOpen(false); };

  return (
    <div ref={root} className="pointer-events-auto relative shrink-0">
      {/* Cible tactile de 44 px : `-my-3` l'empêche de faire grandir la ligne. */}
      <button
        type="button"
        aria-label={armed ? `Joker ${armed} posé${canPlayJoker ? ' — toucher pour changer' : ''}` : 'Poser le joker'}
        aria-expanded={open}
        title="Joker : multiplie les dégâts de ce round, dans les deux sens"
        disabled={!canPlayJoker}
        className="-my-3 flex min-h-[44px] items-center px-1 disabled:cursor-default"
        onPointerDown={(e) => { e.stopPropagation(); if (canPlayJoker) setOpen(o => !o); }}
      >
        <span
          className={'flex h-6 items-center gap-0.5 rounded-full border px-1.5 text-[11px] font-bold tabular-nums ' +
            (armed ? 'border-gold bg-gold/15 text-gold' : canPlayJoker ? 'border-gold/60 text-white' : 'border-line text-white/40')}
        >
          <span aria-hidden>🃏</span>
          {armed}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 flex w-60 flex-col gap-1.5 rounded-lg border border-line bg-surface-raised p-2 text-xs shadow-lg"
        >
          <p className="text-white/60">Un seul joker par partie. Il vaut pour <b>les deux camps</b> : si tu perds le round, il joue contre toi.</p>
          {JOKER_CHOICES.map(c => (
            <Button
              key={c.kind}
              role="menuitemradio"
              aria-checked={playerJoker === c.kind}
              className={'w-full justify-start text-left' + (playerJoker === c.kind ? ' border-gold text-gold' : '')}
              onPointerDown={(e) => { e.stopPropagation(); pick(c.kind); }}
            >
              <span className="w-10 text-base font-bold tabular-nums">{c.label}</span>
              <span className="text-[11px] font-normal text-white/70">{c.hint}</span>
            </Button>
          ))}
          {playerJoker && (
            <Button
              role="menuitem"
              className="w-full text-[11px]"
              onPointerDown={(e) => { e.stopPropagation(); pick(null); }}
            >
              Retirer le joker
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
