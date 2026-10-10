// ShoppingLayer — surface UI de la Phase Shopping. Deux états, pilotés par
// gameStore.shopping :
//   • étal        → la boutique : magies et cartes payées en ⚡ de réserve,
//                   achetées une à une jusqu'à « Passer »
//   • ciblage     → bannière d'instruction + bouton Annuler (TargetBanner) ;
//                   les cibles sont tapées sur le board (scene highlight) ou
//                   dans le cimetière (GraveyardTray).
// Toute la logique (application, ciblage, carry-over) vit dans GameSession ;
// ici on ne fait que router les gestes vers le controller.
import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { Button, IconButton, Modal } from '../ui/primitives.js';
import { useWebLayout } from '../system/useWebLayout.js';
import HoldConfirmButton from '../ui/HoldConfirmButton.js';
import MagieCard from './MagieCard.js';
import ShopCard from './ShopCard.js';
import UiIcon from '../ui/UiIcon.js';
import PhaseClock from '../hud/PhaseClock.js';
import { useTimerLowSound } from '../hud/useTimerLowSound.js';

export default function ShoppingLayer() {
  const shopping = useGameStore(s => s.shopping);
  const controller = useGameStore(s => s.controller);
  const remaining = useGameStore(s => s.shoppingRemaining);
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
  useTimerLowSound(remaining, !!shopping);
  if (!shopping || !controller) return null;

  if (shopping.awaitingTarget) {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex flex-col items-center gap-2 px-4">
        <div className="rounded-lg border border-gold bg-surface/95 px-4 py-2 text-center text-sm font-semibold text-gold shadow-lg">
          <UiIcon id="UI_XP" className="inline-block h-3.5 w-3.5 align-[-2px]" /> {shopping.banner}
          <PhaseClock remaining={remaining} label={`Temps restant : ${remaining} secondes`} className="ml-2 px-2 text-xs font-semibold">{remaining}s</PhaseClock>
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
          className="pointer-events-auto flex items-center gap-1.5 shadow-lg"
          onPointerDown={(e) => { e.stopPropagation(); setHidden(false); }}
        >
          <UiIcon id="UI_EYE" className="h-3.5 w-3.5" /> Revoir la boutique · <PhaseClock remaining={remaining} label={`Temps restant : ${remaining} secondes`} className="px-1.5 text-xs font-bold">{remaining}s</PhaseClock>
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
        <div className="flex items-center justify-center gap-1.5 text-xs tracking-widest text-gold">
          <UiIcon id="UI_SPARKLE" className="h-3 w-3" /> PHASE SHOPPING <UiIcon id="UI_SPARKLE" className="h-3 w-3" />
        </div>
        <div className="text-sm text-white/60">Achète ce que tu veux, un article à la fois</div>
        <div className="mt-0.5 text-xs font-semibold text-gold">
          Réserve : <UiIcon id="UI_ENERGY" className="inline-block h-3.5 w-3.5 align-[-2px]" />{shopping.reserve}
        </div>
        <PhaseClock remaining={remaining} label={`Temps restant : ${remaining} secondes`} className="mt-1 px-2.5 py-0.5 text-sm font-bold">{remaining}s</PhaseClock>
        {shopping.info && (
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-gold">
            {shopping.info.map((part, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <UiIcon id={part.icon} className="h-3 w-3" /> {part.text}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={isWeb ? 'grid grid-cols-3 gap-2' : 'space-y-2'}>
        {shopping.magies.map(({ magie, price, affordable }) => (
          <MagieCard
            key={magie.id}
            magie={magie}
            price={price}
            affordable={affordable}
            lockReason={price > shopping.reserve ? "Pas assez d'énergie en réserve" : 'PV insuffisants pour le contrecoup'}
            onChoose={mm => controller.chooseMagie(mm)}
            compact={isWeb}
          />
        ))}
      </div>
      {shopping.cards.length > 0 && (
        <>
          <div className="mt-3 text-center text-[10px] tracking-widest text-white/40">CARTES · REJOIGNENT TA MAIN</div>
          {/* `pt-2` : la carte se lève au survol, elle ne doit pas recouvrir l'intitulé. */}
          <div className="mx-auto mt-1 grid max-w-xs grid-cols-3 gap-3 pt-2">
            {shopping.cards.map((entry, i) => (
              <ShopCard key={entry.card.id} entry={entry} onBuy={() => controller.buyShopCard(i)} />
            ))}
          </div>
        </>
      )}
      {/* Reroll et Passer côte à côte : c'est le même geste de fin de modale,
          qu'on choisisse de rerouler ou de renoncer. Le reroll n'a plus de
          confirmation modale (contrairement à l'ancien mulligan) : le bouton
          se maintient (`HoldConfirmButton`), la charge qui le remplit EST la
          confirmation, et le prix ne s'affiche qu'au moment où il est
          débité. `visible`, pas un montage conditionnel : un pool épuisé par
          CE reroll ferait retomber `canReroll` dans le même tick que le
          toast s'arme (cf. le composant). Sans rien à montrer, « Passer »
          prend toute la largeur. */}
      <div className="mt-3 flex gap-2">
        <HoldConfirmButton
          icon={<UiIcon id="UI_REROLL" className="h-5 w-5" />}
          label="Re-roll"
          cost={shopping.rerollCost}
          currency="energy"
          onConfirm={() => controller.rerollShopping()}
          fullWidth
          visible={shopping.canReroll}
        />
        <Button
          variant="ghost"
          className="min-w-0 flex-1 px-2 text-xs"
          onPointerDown={(e) => { e.stopPropagation(); controller.skipShopping(); }}
          sfx={false}
        >
          Passer →
        </Button>
      </div>
    </Modal>
  );
}
