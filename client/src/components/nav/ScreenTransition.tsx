// Rejoue une petite entrée (fondu + glissement) à chaque changement d'écran
// non immersif — cf. `styles/screenTransition.css`. Purement décoratif :
// aucune règle de jeu, aucun état, un seul `<div>` reclé par le nom d'écran.
//
// ⚠️ Keyé sur le SCREEN seul, pas sur `params` : changer les params d'un même
// écran (ex. DeckBuilder qui reçoit un autre `deckName`) ne doit pas rejouer
// l'entrée ni démonter l'écran — seul un changement de PAGE le fait.
//
// ⚠️ Monté uniquement pour les écrans HORS `IMMERSIVE_SCREENS` (App.tsx) :
// `game` / `game_pvp` ont déjà les leurs (`DuelIntro` au lancement,
// `OutcomeTransition` à la fin), et le passage menu ↔ partie change de
// branche de rendu entière — ce composant ne les voit jamais.
import type { ReactNode } from 'react';

export function ScreenTransition({ screenKey, children }: { screenKey: string; children: ReactNode }) {
  return (
    <div key={screenKey} className="screen-transition min-h-full">
      {children}
    </div>
  );
}
