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
//
// ⚠️ `animate={false}` sur le Catalogue et l'onglet Bibliothèque du
// DeckBuilder : les deux montent ~868 `Card3D` NON virtualisés (aucune
// fenêtre, aucun `memo`) — jouer l'entrée y ajoute la mise en calque
// (compositing) de tout ce bloc avant de pouvoir peindre le fondu, un coût
// ponctuel réel sur un aussi gros sous-arbre. Ce n'est PAS ce qui rend ces
// écrans lents au fond (le rendu de 868 cartes l'est déjà sans animation), et
// la correction de fond — virtualiser la grille — reste à faire ; ce
// drapeau n'évite qu'un surcoût que l'animation ajoutait par-dessus.
import type { ReactNode } from 'react';

export function ScreenTransition(
  { screenKey, children, className = 'h-full', animate = true }:
  { screenKey: string; children: ReactNode; className?: string; animate?: boolean },
) {
  return (
    <div key={screenKey} className={animate ? `screen-transition ${className}` : className}>
      {children}
    </div>
  );
}
