# Mode Draft — note de design

> Prototype jouable livré (écran `draft`, bouton **Draft** du menu). Ce document
> dit ce qu'il fait, pourquoi, et ce qui reste ouvert.

## L'intention

Ajouter de la **chance** au jeu, à la façon du mode Draft de Marvel Snap, de TFT
ou de Balatro, **sans avoir à concevoir des tirages à la main**. Le joueur ne
choisit plus un deck : il le construit en jouant, avec des options qu'il ne
contrôle pas. Ce qui rend chaque run différente, c'est l'offre, et le talent
consiste à en tirer un deck qui tient.

## Pourquoi il n'y a aucun tirage à concevoir

Le jeu a déjà tout ce qu'il faut :

- **Le tirage uniforme est déjà la règle du jeu** : la boutique et les boosters
  tirent sans poids de tier ni affinité (`shop.pick`). Le Draft tire de la même
  façon, dans **tout le catalogue** (les cartes qui ont leur illustration), filtré
  par le tier de l'étape.
- **La seule « intelligence » est la couverture des recettes**, qui existait déjà
  pour la simulation et le tutoriel : une carte de haut tier est-elle invocable
  avec ce que le deck contient ? Elle vit désormais dans
  `logic/DeckCoverage.ts`, partagée avec `sim/decks.ts`.
- **Les adversaires draftent aussi**, avec la même fonction d'offre : aucun deck
  adverse n'est à écrire en admin. Un catalogue qui grandit enrichit le mode tout
  seul.

## Le déroulé

1. **20 choix d'une carte parmi trois**, en montant les tiers :
   6 × T1, 5 × T2, 4 × T3, 3 × T4, 2 × T5 (le plancher d'un deck).
2. **2 relances** pour tout le draft.
3. **Une échelle de duels** contre l'IA : la run est gagnée à **5 victoires** et se
   termine à **2 défaites**. Une égalité se rejoue, abandonner un duel le concède.
4. Le handicap de l'IA monte avec les victoires (`LADDER_BONUS`, de +0 à
   +4 ATK / +30 PV) : c'est le primitif `enemyBonus` de l'Arcade, plus doux
   puisque l'adversaire a lui aussi un deck drafté.

## Les trois emplacements de l'offre

C'est là que se joue la chance, et c'est la seule règle qui a été écrite :

| Emplacement | Ce qu'il propose | Ce qu'il dit au joueur |
|---|---|---|
| **Complément** | une carte jouable qui apporte un matériel qu'attend une carte déjà prise | « Complète une recette » |
| **Sûr** | une carte jouable avec ce que le deck contient | « Jouable » |
| **Pari** | une carte dont les matériaux manquent encore | « Pari : matériaux absents » |

Un emplacement sans candidat retombe sur une carte jouable. Le **pari** est le
levier façon Balatro : une fusion de haut tier qu'on prend en espérant que la
suite du draft apporte ses matériaux, ce que l'emplacement **complément** vient
justement chercher.

Mesuré sur le catalogue livré (200 drafts) : un joueur qui prend **tous** les
paris ne finit qu'avec **47 %** de cartes jouables, et le complément n'apparaît
qu'environ **une fois par draft**. Le pari est donc un vrai risque, pas une
option gratuite.

## Les choix techniques

- **Entièrement client**, comme le tutoriel : pas de route, pas de table. La run
  tient dans une clé localStorage (`millenium_draft_v1`), donc le mode est
  **ouvert aux invités** et se reprend après un rechargement.
- **L'offre est une fonction de l'état** (graine, nombre de choix, relances
  dépensées) : recharger la page rend la même offre, fermer l'onglet ne relance
  rien.
- **Toute la règle est pure** dans `logic/Draft.ts`, testée dans
  `test/draft.test.ts` sur le catalogue livré.
- L'écran de jeu est le vrai `GameScreen` (`params.draft`), avec le deck drafté
  passé à `buildSession` comme le deck du tutoriel.

## Ce qui reste ouvert

- **Récompenses.** Aucune pour l'instant, hormis l'XP habituelle d'une victoire
  solo (`ai_win`). Payer la run (golds selon le nombre de victoires, un ticket
  d'entrée façon Snap) demanderait de passer la run côté serveur, puisque le
  client ne peut pas chiffrer un gain.
- **Le dosage** : taille du deck, nombre de relances, longueur de l'échelle,
  handicap. Tous sont des constantes en tête de `logic/Draft.ts`.
- **Plus de leviers de chance**, si le cœur plaît : une offre « rare » de temps en
  temps, un choix de pack thématique en début de draft (le pool devient un pack
  au lieu du catalogue, sans rien concevoir de plus), une magie ou un terrain à
  drafter entre deux duels.
- **L'IA adverse** reste `EnemyAI` : elle drafte bien (carte jouable la plus
  forte), mais elle joue comme partout ailleurs.
