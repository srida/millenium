import { lazy, Suspense } from 'react';

const CombatLab = lazy(() => import('../dev/CombatLab'));

// Shell provisoire : le vrai routage d'écrans (uiStore + ScreenRouter) arrive
// en Phase 3. Le paramètre ?screen= reprend la convention de l'ancienne app.
const screen = new URLSearchParams(window.location.search).get('screen');

export default function App() {
  if (screen === 'combatlab') {
    return (
      <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-surface text-white">Chargement…</div>}>
        <CombatLab />
      </Suspense>
    );
  }
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-surface text-white">
      <h1 className="text-3xl font-bold tracking-wide text-gold">Millenium</h1>
      <p className="text-sm opacity-70">Refonte en cours — Phase 2 : scène 3D portée</p>
      <a className="text-sm text-gold underline" href="/?screen=combatlab">Ouvrir le CombatLab (dev)</a>
    </main>
  );
}
