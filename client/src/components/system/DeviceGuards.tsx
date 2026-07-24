// Garde-fous mobiles (PLAN §Mobile Rules) : superposition « repasse en portrait »
// sur petit écran en paysage, et bouton plein écran (Fullscreen API).
import { useEffect, useState } from 'react';

// Ne cible que les petits écrans (téléphones/petites tablettes) : le desktop en
// paysage n'est jamais bloqué.
const LANDSCAPE_QUERY = '(orientation: landscape) and (max-width: 900px)';

export function LandscapeOverlay() {
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(LANDSCAPE_QUERY);
    const update = () => setLandscape(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (!landscape) return null;
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-surface p-6 text-center text-white">
      <div className="text-5xl">📱↻</div>
      <div className="text-lg font-bold text-gold">Tourne ton appareil</div>
      <p className="max-w-xs text-sm text-white/60">Millenium se joue en mode portrait.</p>
    </div>
  );
}

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
