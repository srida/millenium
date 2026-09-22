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
// ⚠️ `h-full` (hauteur EXPLICITE), et non `min-h-full` : chaque écran non
// immersif s'attend à recevoir une hauteur DÉFINIE de son parent direct — la
// plupart posent eux-mêmes `min-h-full` sur leur racine (`<main>`) pour au
// moins remplir l'écran, et un écran comme le Catalogue va plus loin, avec un
// bloc interne `flex-1 min-h-0 overflow-y-auto` qui compte sur cette hauteur
// bornée pour devenir une zone de défilement INTERNE plutôt que de laisser
// tout son contenu (868 cartes) s'étaler en pleine hauteur naturelle. Un
// pourcentage (`height` ou `min-height`) ne se résout que si le PARENT porte
// une hauteur EXPLICITE (spec CSS : `min-height` seul ne compte pas, même si
// la boîte s'affiche visuellement à 100 %) — poser `min-h-full` ici cassait
// donc toute la chaîne : `MainMenu` (dont la racine est `h-full`, seul écran à
// exiger l'exactitude pour son `justify-center`) perdait sa hauteur et ses
// blocs se recentraient différemment, ET le Catalogue perdait le bornage de
// sa grille — plus de défilement interne, la page entière grandissait à la
// taille de son contenu, d'où la lenteur perçue (mise en page/peinture de
// tout le catalogue au lieu d'une fenêtre de ~600 px).
//
// Un appelant qui insère ce wrapper DANS une colonne flex existante (ex.
// l'onglet Bibliothèque/Deck du DeckBuilder, dont le panneau actif est
// lui-même `flex-1 min-h-0 overflow-y-auto`) doit repasser les classes flex
// nécessaires (`flex min-h-0 flex-1 flex-col`), pas une hauteur en `%`.
import type { ReactNode } from 'react';

export function ScreenTransition(
  { screenKey, children, className = 'h-full' }: { screenKey: string; children: ReactNode; className?: string },
) {
  return (
    <div key={screenKey} className={`screen-transition ${className}`}>
      {children}
    </div>
  );
}
