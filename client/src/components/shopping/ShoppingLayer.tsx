// ShoppingLayer — surface UI de la Phase Shopping. Deux états, pilotés par
// gameStore.shopping :
//   • choix       → modal de 3+ magies (ShoppingOverlay)
//   • ciblage     → bannière d'instruction + bouton Annuler (TargetBanner) ;
//                   les cibles sont tapées sur le board (scene highlight) ou
//                   dans le cimetière (GraveyardTray).
// Toute la logique (application, ciblage, carry-over) vit dans GameSession ;
// ici on ne fait que router les gestes vers le controller.
import { useGameStore } from '../../stores/gameStore.js';
import { Button, Modal } from '../ui/primitives.js';
import MagieCard from './MagieCard.js';

export default function ShoppingLayer() {
  const shopping = useGameStore(s => s.shopping);
  const controller = useGameStore(s => s.controller);
  if (!shopping || !controller) return null;

  if (shopping.awaitingTarget) {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex flex-col items-center gap-2 px-4">
        <div className="rounded-lg border border-gold bg-surface/95 px-4 py-2 text-center text-sm font-semibold text-gold shadow-lg">
          ✨ {shopping.banner}
        </div>
        <Button
          variant="ghost"
          className="pointer-events-auto"
          onPointerDown={(e) => { e.stopPropagation(); controller.cancelMagieTargeting(); }}
        >
          Annuler — choisir une autre magie
        </Button>
      </div>
    );
  }

  return (
    <Modal>
      <div className="mb-2 text-center">
        <div className="text-xs tracking-widest text-gold">✦ PHASE SHOPPING ✦</div>
        <div className="text-sm text-white/60">Choisis une magie</div>
      </div>
      <div className="space-y-2">
        {shopping.magies.map(m => (
          <MagieCard key={m.id} magie={m} onChoose={mm => controller.chooseMagie(mm)} />
        ))}
      </div>
      <button
        onPointerDown={(e) => { e.stopPropagation(); controller.skipShopping(); }}
        className="mt-3 w-full text-center text-xs text-white/50 underline"
      >
        Passer cette phase →
      </button>
    </Modal>
  );
}
