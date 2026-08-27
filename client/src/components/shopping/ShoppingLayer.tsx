// ShoppingLayer — surface UI de la Phase Shopping. Deux états, pilotés par
// gameStore.shopping :
//   • choix       → modal de 3+ magies (ShoppingOverlay)
//   • ciblage     → bannière d'instruction + bouton Annuler (TargetBanner) ;
//                   les cibles sont tapées sur le board (scene highlight) ou
//                   dans le cimetière (GraveyardTray).
// Toute la logique (application, ciblage, carry-over) vit dans GameSession ;
// ici on ne fait que router les gestes vers le controller.
import { useGameStore } from '../../stores/gameStore.js';
import { canAffordMagie } from '../../logic/MagieEffect.js';
import { Button, Modal } from '../ui/primitives.js';
import MagieCard from './MagieCard.js';

export default function ShoppingLayer() {
  const shopping = useGameStore(s => s.shopping);
  const controller = useGameStore(s => s.controller);
  const remaining = useGameStore(s => s.shoppingRemaining);
  // Le verrou se dérive des PV de l'instantané : la règle vit dans
  // `MagieEffect`, l'écran ne fait que la lire.
  const playerHp = useGameStore(s => s.playerHp);
  if (!shopping || !controller) return null;

  if (shopping.awaitingTarget) {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex flex-col items-center gap-2 px-4">
        <div className="rounded-lg border border-gold bg-surface/95 px-4 py-2 text-center text-sm font-semibold text-gold shadow-lg">
          ✨ {shopping.banner}
          <span className="ml-2 font-normal tabular-nums text-gold/70">· {remaining}s</span>
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
        <div className="mt-1 text-xs font-semibold tabular-nums text-gold/80">{remaining}s</div>
      </div>
      <div className="space-y-2">
        {shopping.magies.map(m => (
          <MagieCard
            key={m.id}
            magie={m}
            affordable={canAffordMagie(m, playerHp)}
            onChoose={mm => controller.chooseMagie(mm)}
          />
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
