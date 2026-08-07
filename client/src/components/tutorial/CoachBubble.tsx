// Bulle du coach — le seul rendu partagé entre la partie guidée et le
// DeckBuilder guidé. Elle dit une chose à la fois : un titre, une phrase, et
// un bouton seulement quand l'étape attend vraiment un geste.
//
// Elle ne prend jamais le pointeur au-delà d'elle-même : en jeu, le canvas 3D
// est en dessous et doit continuer à recevoir les taps pour son raycast.
import type { ReactNode } from 'react';

export function CoachBubble({
  title, text, action, onAction, footer, className = '',
}: {
  title: string;
  text: string;
  /** Libellé du bouton. Absent = la bulle est purement informative. */
  action?: string;
  onAction?: () => void;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`pointer-events-auto rounded-xl border border-gold/50 bg-surface/97 p-3 shadow-2xl backdrop-blur ${className}`}>
      <div className="flex items-start gap-2">
        <span className="text-base leading-none" aria-hidden>🎓</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gold">{title}</div>
          <p className="mt-0.5 text-xs leading-relaxed text-white/80">{text}</p>
          {footer}
        </div>
      </div>
      {action && (
        <button
          type="button"
          onPointerDown={(e) => { e.stopPropagation(); onAction?.(); }}
          className="mt-2 min-h-tap w-full rounded-lg border border-gold bg-gold/20 text-sm font-semibold text-gold active:opacity-80"
        >
          {action}
        </button>
      )}
    </div>
  );
}

export default CoachBubble;
