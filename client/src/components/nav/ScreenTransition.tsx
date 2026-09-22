// Rejoue une petite entrée (fondu + glissement) à chaque changement d'écran
// non immersif — cf. `styles/screenTransition.css`. Purement décoratif :
// aucune règle de jeu, aucun état, un seul `<div>` reclé par une clé fournie
// par l'appelant (nom d'écran, ou onglet interne d'un écran).
//
// ⚠️ Keyée sur le SCREEN (ou l'onglet) seul, jamais sur des `params` annexes :
// changer les params d'un même écran (ex. DeckBuilder qui reçoit un autre
// `deckName`) ne doit pas rejouer l'entrée ni démonter l'écran — seul un
// changement de PAGE (ou d'onglet, pour un usage interne) le fait.
//
// ⚠️ Monté uniquement pour les écrans HORS `IMMERSIVE_SCREENS` (App.tsx) :
// `game` / `game_pvp` ont déjà les leurs (`DuelIntro` au lancement,
// `OutcomeTransition` à la fin), et le passage menu ↔ partie change de
// branche de rendu entière — ce composant ne les voit jamais.
//
// `className` par défaut suppose un parent NON flex (App.tsx : une simple
// zone de défilement) ; un appelant qui insère ce wrapper DANS une colonne
// flex (ex. l'onglet Bibliothèque/Deck du DeckBuilder, dont le panneau actif
// est lui-même `flex-1 min-h-0 overflow-y-auto`) doit repasser les classes
// flex nécessaires, sinon le panneau perd sa hauteur et son défilement.
import type { ReactNode } from 'react';

export function ScreenTransition(
  { screenKey, children, className = 'min-h-full' }: { screenKey: string; children: ReactNode; className?: string },
) {
  return (
    <div key={screenKey} className={`screen-transition ${className}`}>
      {children}
    </div>
  );
}
