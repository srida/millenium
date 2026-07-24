// MainMenu — navigation vers la partie (DeckBuilder/DeckSelector arrivent en
// Phase 5 ; ici on lance directement une partie sur le deck actif ou un deck
// de repli auto-généré). Lien dev vers le CombatLab.
import { useUiStore } from '../stores/uiStore.js';
import { Button } from '../components/ui/primitives.js';

export default function MainMenu() {
  const navigate = useUiStore(s => s.navigate);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface p-6 text-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-[0.2em] text-gold">MILLENIUM</h1>
        <p className="mt-1 text-sm text-white/50">Auto-battler tactique</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button variant="primary" className="w-full py-3 text-base" onPointerDown={() => navigate('game')}>
          Jouer
        </Button>
        <Button className="w-full text-xs opacity-70" onPointerDown={() => navigate('combatlab')}>
          CombatLab (dev)
        </Button>
      </div>
      <p className="text-[11px] text-white/30">Refonte — Phase 3 : boucle de jeu complète</p>
    </main>
  );
}
