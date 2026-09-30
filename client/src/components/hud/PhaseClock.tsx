// La pastille d'un chrono de phase. Sous `TIMER_LOW_S` elle vire au rouge et
// pulse ; le son est joué par `useTimerLowSound`, appelé par le propriétaire du
// chrono.
//
// ⚠️ La pulsation vit sur un calque de FOND séparé, jamais sur l'élément qui
// porte le texte : animer l'opacité du conteneur promeut le tout en couche
// composée, et le chiffre précédent y restait peint au passage de 11 à 10.
// `prefers-reduced-motion` retire la pulsation, la couleur reste.
import type { ReactNode } from 'react';
import { isTimerLow } from './timerLow.js';

export default function PhaseClock({ remaining, label, className = '', children }: {
  remaining: number;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const low = isTimerLow(remaining);
  return (
    <span
      role="timer"
      aria-label={label}
      className={'relative inline-flex shrink-0 items-center justify-center rounded-lg border tabular-nums '
        + (low ? 'border-danger text-danger ' : 'border-line text-white/70 ') + className}
    >
      <span
        aria-hidden="true"
        className={'absolute inset-0 rounded-[inherit] ' + (low ? 'bg-danger/20 motion-safe:animate-pulse' : 'bg-surface/80')}
      />
      <span className="relative">{children}</span>
    </span>
  );
}
