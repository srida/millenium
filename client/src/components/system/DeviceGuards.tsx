// Garde-fous mobiles (PLAN §Mobile Rules) : bouton plein écran (Fullscreen API).
//
// Le paysage n'est plus bloqué : un téléphone tourné passe le seuil d'aspect
// (min-aspect-ratio: 1/1) et bascule sur le mode web (rails latéraux + cadrage
// caméra correspondant), comme un desktop.
import { useEffect, useState } from 'react';

export function FullscreenButton({ className = '' }: { className?: string }) {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const onChange = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Safari iOS ne supporte pas l'API Fullscreen sur les éléments arbitraires :
  // on masque le bouton si l'API est absente (l'ajout à l'écran d'accueil PWA
  // fournit alors le plein écran natif).
  if (typeof document === 'undefined' || !document.documentElement.requestFullscreen) return null;

  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  return (
    <button
      onPointerDown={toggle}
      aria-label={fs ? 'Quitter le plein écran' : 'Plein écran'}
      className={`flex min-h-tap min-w-tap items-center justify-center rounded-lg border border-line bg-surface-raised text-white/70 active:opacity-80 ${className}`}
    >
      {fs ? '⤢' : '⛶'}
    </button>
  );
}
