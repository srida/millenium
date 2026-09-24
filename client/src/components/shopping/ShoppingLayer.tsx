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
import { Button, IconButton, Modal } from '../ui/primitives.js';
import { useWebLayout } from '../system/useWebLayout.js';
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
  useEffect(() => { setHidden(false); }, [round]);
  // Paysage téléphone / tablette / desktop (même seuil que le reste du HUD) :
  // les magies passent en grille plutôt qu'en liste, pour tenir dans une
  // hauteur disponible courte sans que « Passer » ne sorte de l'écran.
  const isWeb = useWebLayout();
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
    <Modal maxWidth={isWeb ? 'max-w-xl' : 'max-w-sm'}>
      <div className="relative mb-2 text-center">
        <IconButton
          label="Cacher"
          icon={<span aria-hidden="true" className="block h-px w-3 rounded-full bg-current" />}
          compact
          chipClassName="border-line bg-surface-raised text-white/70"
          className="absolute right-0 top-0"
          onTap={() => setHidden(true)}
        />
        <div className="text-xs tracking-widest text-gold">✦ PHASE SHOPPING ✦</div>
        <div className="text-sm text-white/60">Choisis une magie</div>
        <div className="mt-1 text-xs font-semibold tabular-nums text-gold/80">{remaining}s</div>
        {shopping.info && (
          <div className="mt-1.5 text-[11px] font-semibold text-gold">{shopping.info}</div>
        )}
      </div>
      <div className={isWeb ? 'grid grid-cols-3 gap-2' : 'space-y-2'}>
        {shopping.magies.map(m => (
          <MagieCard
            key={m.id}
            magie={m}
            affordable={canAffordMagie(m, playerHp)}
            onChoose={mm => controller.chooseMagie(mm)}
            compact={isWeb}
          />
        ))}
      </div>
      {/* Reroll et Passer côte à côte : c'est le même geste de fin de modale,
          qu'on choisisse de rerouler ou de renoncer. Le reroll n'a plus de
          confirmation (contrairement au mulligan) — le contrecoup se lit déjà
          sur son propre libellé, et un second écran surchargeait la modale
          pour un geste réversible en un tap de plus. Absent quand le joueur
          ne peut pas payer ou qu'il ne reste plus rien de pertinent à
          montrer : « Passer » prend alors toute la largeur. */}
      <div className="mt-3 flex gap-2">
        {shopping.canReroll && (
          <Button
            className="min-w-0 flex-1 whitespace-nowrap px-2 text-xs"
            onPointerDown={(e) => { e.stopPropagation(); controller.rerollShopping(); }}
          >
            🎲 Re-roll −{shopping.rerollCost}PV
          </Button>
        )}
        <Button
          variant="ghost"
          className="min-w-0 flex-1 px-2 text-xs"
          onPointerDown={(e) => { e.stopPropagation(); controller.skipShopping(); }}
        >
          Passer →
        </Button>
      </div>
    </Modal>
  );
}
