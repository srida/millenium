// Primitives du design system Millenium (Tailwind v4, mobile-first, tap ≥ 44px).
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gold/20 border-gold text-gold hover:bg-gold/30',
  ghost: 'bg-surface-raised border-line text-white/90 hover:bg-white/5',
  danger: 'bg-danger/15 border-danger text-danger hover:bg-danger/25',
};

export function Button({
  variant = 'ghost', className = '', children, ...rest
}: { variant?: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold tracking-wide transition-colors active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border border-line bg-surface-raised/80 backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

// Jauge horizontale (HP, etc.), remplie de 0→1.
export function Gauge({ value, className = '', fillClassName = 'bg-player' }: { value: number; className?: string; fillClassName?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-black/50 ${className}`}>
      <div className={`h-full rounded-full transition-[width] duration-300 ${fillClassName}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

// Bannière flottante (annonces phase / erreurs / ciblage magie).
export function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' }) {
  const toneCls = tone === 'error' ? 'border-danger text-danger' : 'border-gold text-gold';
  return (
    <div className={`pointer-events-none fixed left-1/2 top-16 z-40 -translate-x-1/2 rounded-lg border bg-surface/95 px-4 py-2 text-sm font-semibold shadow-lg ${toneCls}`}>
      {text}
    </div>
  );
}
