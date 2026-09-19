// ShoppingLayer — surface UI de la Phase Shopping. Deux états, pilotés par
// gameStore.shopping :
//   • choix       → modal de 3+ magies (ShoppingOverlay)
//   • ciblage     → bannière d'instruction + bouton Annuler (TargetBanner) ;
//                   les cibles sont tapées sur le board (scene highlight) ou
//                   dans le cimetière (GraveyardTray).
// Toute la logique (application, ciblage, carry-over) vit dans GameSession ;
// ici on ne fait que router les gestes vers le controller.
import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { canAffordMagie } from '../../logic/MagieEffect.js';
import { Button, Modal } from '../ui/primitives.js';
import ConfirmHpCost from '../ui/ConfirmHpCost.js';
import MagieCard from './MagieCard.js';

export default function ShoppingLayer() {
  const shopping = useGameStore(s => s.shopping);
  const controller = useGameStore(s => s.controller);
  const remaining = useGameStore(s => s.shoppingRemaining);
  // Le verrou se dérive des PV de l'instantané : la règle vit dans
  // `MagieEffect`, l'écran ne fait que la lire.
  const playerHp = useGameStore(s => s.playerHp);
  const round = useGameStore(s => s.round);
  // Le joueur peut cacher la modale pour revoir main, cimetière et board avant
  // de choisir : HandBar/GraveyardTray/le board restent montés en dessous
  // (comme pendant le ciblage), seul le fond opaque de la Modal les masque.
  // Ne pas confondre avec `awaitingTarget`, qui gère le ciblage d'une magie
  // déjà choisie.
  const [hidden, setHidden] = useState(false);
  // Le reroll est payé en PV : il passe par la même confirmation que le
  // mulligan. ⚠️ L'état se remet à zéro au ROUND comme `hidden` — une modale de
  // confirmation laissée armée par un chrono qui tombe se rouvrirait sur l'offre
  // du tour suivant.
  const [askingReroll, setAskingReroll] = useState(false);
  useEffect(() => { setHidden(false); setAskingReroll(false); }, [round]);
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

  if (hidden) {
    // Centré à l'écran, ni collé au Hud (barres de PV) ni au bas (main,
    // cimetière, barre de phase — déjà visibles, puisque c'est justement ce
    // qu'on vient de révéler) : le seul repère qui vaille sur toutes les
    // tailles d'écran est le centre, indépendant des hauteurs de ces bandeaux.
    return (
      <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-4">
        <Button
          variant="primary"
          className="pointer-events-auto shadow-lg"
          onPointerDown={(e) => { e.stopPropagation(); setHidden(false); }}
        >
          👁️ Revoir les magies · {remaining}s
        </Button>
      </div>
    );
  }

  return (
    <Modal>
      <div className="relative mb-2 text-center">
        <button
          onPointerDown={(e) => { e.stopPropagation(); setHidden(true); }}
          className="absolute right-0 top-0 text-xs text-white/50 underline"
        >
          🙈 Cacher
        </button>
        <div className="text-xs tracking-widest text-gold">✦ PHASE SHOPPING ✦</div>
        <div className="text-sm text-white/60">Choisis une magie</div>
        <div className="mt-1 text-xs font-semibold tabular-nums text-gold/80">{remaining}s</div>
        {shopping.info && (
          <div className="mt-1.5 text-[11px] font-semibold text-gold">{shopping.info}</div>
        )}
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
      {/* Le reroll : trois magies qu'on n'a PAS encore vues ce tour, contre des
          PV. Il se pose sous l'offre et au-dessus de « Passer » — c'est l'ordre
          dans lequel on y pense (choisir, puis chercher mieux, puis renoncer).
          Absent quand le joueur ne peut pas payer ou qu'il ne reste plus rien de
          pertinent à montrer : un bouton grisé n'apprendrait rien de plus qu'un
          bouton absent, et la barre du bas de cette modale est déjà chargée. */}
      {shopping.canReroll && (
        <Button
          className="mt-3 w-full"
          onPointerDown={(e) => { e.stopPropagation(); setAskingReroll(true); }}
        >
          🎲 Nouvelle offre · −{shopping.rerollCost} PV
        </Button>
      )}
      <button
        onPointerDown={(e) => { e.stopPropagation(); controller.skipShopping(); }}
        className="mt-3 w-full text-center text-xs text-white/50 underline"
      >
        Passer cette phase →
      </button>
      {askingReroll && (
        <ConfirmHpCost
          title="Tirer une nouvelle offre ?"
          detail="Les magies affichées sont écartées et remplacées par d'autres, jamais déjà vues ce tour. Elles ne reviendront pas."
          cost={shopping.rerollCost}
          playerHp={playerHp}
          confirmLabel="Rerouler"
          onConfirm={() => { setAskingReroll(false); controller.rerollShopping(); }}
          onCancel={() => setAskingReroll(false)}
        />
      )}
    </Modal>
  );
}
