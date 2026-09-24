// Le reroll de la Phase Shopping : un bouton ROUGE qu'on MAINTIENT au lieu
// d'un tap suivi d'une confirmation modale. La charge qui remplit le bouton
// EST la confirmation — le prix ne s'affiche qu'au moment où il est débité,
// en toast au-dessus du bouton, jamais écrit sur le bouton lui-même.
//
// ⚠️ Relâcher — ou glisser hors du bouton — avant la fin de la charge annule
// tout : la barre retombe à zéro, rien n'est débité. Même doctrine qu'un
// appui long relâché trop tôt (`cardPress.ts`) : le geste inachevé ne
// compte pas. Pas de tolérance de déplacement comme `usePressSquash` — sortir
// de la boîte du bouton est le seul signal d'annulation, un doigt qui reste
// dessus peut trembler sans rien perdre.
import { useEffect, useRef, useState } from 'react';
import { BUTTON_BASE, SHADOW_IDLE, SURFACE_DANGER } from '../ui/primitives.js';

const HOLD_MS = 600;
const TOAST_VISIBLE_MS = 900;
const TOAST_FADE_MS = 300;

export default function RerollButton({ cost, onConfirm }: { cost: number; onConfirm: () => void }) {
  const [progress, setProgress] = useState(0);
  const [toastPhase, setToastPhase] = useState<'idle' | 'in' | 'out'>('idle');
  const raf = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const toastTimers = useRef<number[]>([]);

  const stopCharge = () => {
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    startedAt.current = null;
  };
  const cancelCharge = () => { stopCharge(); setProgress(0); };

  const tick = (t: number) => {
    if (startedAt.current === null) startedAt.current = t;
    const p = Math.min(1, (t - startedAt.current) / HOLD_MS);
    setProgress(p);
    if (p >= 1) {
      stopCharge();
      setProgress(0);
      onConfirm();
      toastTimers.current.forEach(id => window.clearTimeout(id));
      setToastPhase('in');
      toastTimers.current = [
        window.setTimeout(() => setToastPhase('out'), TOAST_VISIBLE_MS),
        window.setTimeout(() => setToastPhase('idle'), TOAST_VISIBLE_MS + TOAST_FADE_MS),
      ];
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => {
    stopCharge();
    toastTimers.current.forEach(id => window.clearTimeout(id));
  }, []);

  return (
    <div className="relative min-w-0 flex-1">
      {toastPhase !== 'idle' && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-danger px-2.5 py-0.5 text-xs font-extrabold text-white shadow-lg transition-[opacity,transform] duration-300 ${
            toastPhase === 'in' ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
          }`}
        >
          −{cost} PV
        </div>
      )}
      <button
        type="button"
        aria-label={`Maintenir pour tirer une nouvelle offre, moins ${cost} PV`}
        onPointerDown={(e) => { e.stopPropagation(); stopCharge(); raf.current = requestAnimationFrame(tick); }}
        onPointerUp={(e) => { e.stopPropagation(); cancelCharge(); }}
        onPointerLeave={(e) => { e.stopPropagation(); cancelCharge(); }}
        onPointerCancel={(e) => { e.stopPropagation(); cancelCharge(); }}
        className={`${BUTTON_BASE} ${SHADOW_IDLE} ${SURFACE_DANGER} w-full px-2 text-xs text-danger`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-0 bg-white/25"
          style={{ width: `${progress * 100}%` }}
        />
        <span className="relative z-10">🎲 Re-roll</span>
      </button>
    </div>
  );
}
