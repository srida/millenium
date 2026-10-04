# Mode Draft — note de design

> Livré (écran `draft`, bouton **Draft** du menu, compte requis). Ce document
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
  façon, dans **tout le catalogue** (les cartes qui ont leur illustration).
- **Un lot n'est pas composé à la main non plus** : c'est une carte et les
  matériels que sa recette nomme déjà. Le catalogue dit lui-même quelles cartes
  vont ensemble.
- **La seule « intelligence » est la couverture des recettes**, qui existait déjà
  pour la simulation et le tutoriel : une carte de haut tier est-elle invocable
  avec ce que le deck contient ? Elle vit désormais dans
  `logic/DeckCoverage.ts`, partagée avec `sim/decks.ts`.
- **Les adversaires draftent aussi**, avec la même fonction d'offre : aucun deck
  adverse n'est à écrire en admin. Un catalogue qui grandit enrichit le mode tout
  seul.

## Le déroulé

0. **Un draft par jour**, comme l'Arcade (rotation de 5 h).
1. **Trois lots de trois cartes liées**, un lot parmi trois à chaque étape :
   9 cartes, tiers mélangés.
2. **Six choix d'une carte parmi trois**, aux tiers 1, 1, 2, 3, 4 et 5 : 15 cartes
   en tout. Les deux choix de tier 1 garantissent de quoi jouer au premier tour,
   qu'un lot ne contient pas forcément. Tout est tiré dans **tout le catalogue**
   (pas la collection du joueur) : le mode fait découvrir des cartes.
3. **2 relances** pour toute la run, lots et cartes de plus compris.
4. **Une échelle de duels en ligne**, contre d'autres joueurs en draft : la run
   est gagnée à **5 victoires** et se termine à **2 défaites**. Sans adversaire
   dans la file, un **bot** au deck drafté prend la place (le joueur ne le sait
   pas). Une égalité se rejoue, abandonner ou quitter un duel le concède. Une
   fois la run perdue, **une vie se rachète 20 gemmes**, une seule fois.
5. **Une carte de plus après chaque duel** qui ne clôt pas la run (victoire ou
   défaite) : une parmi trois, tous tiers, avant de chercher le duel suivant.
6. **Chaque victoire paie des gemmes** : 6, 9, 12, 15 puis 18, soit **60** pour une
   run parfaite, plus le gain d'XP d'un duel en ligne.

## Les lots

Un lot part d'une carte « tête » qui nomme des matériels dans sa recette : elle
et deux de ces matériels. Si la recette n'en nomme qu'un, le troisième est un
matériel de ce matériel, à défaut une carte qui se sert de l'un des deux. Un lot
doit mélanger les tiers (au moins deux tiers différents) ; les trois lots d'une
offre ne partagent aucune carte. L'écran dit si tout le lot se joue tel quel ou
combien de ses cartes attendent encore un matériel — ce que les choix d'une
carte viendront compléter.

Le serveur rejoue le même verdict (`isLinkedBundle`) : trois cartes sans lien
entre elles sont refusées, même s'il ne peut pas vérifier que le lot était dans
l'offre.

## Les trois emplacements d'un choix d'une carte

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
paris finit avec **72 %** de cartes jouables (les lots, liés par construction,
amortissent le risque), et le complément apparaît environ **1,5 fois par
draft**. Les adversaires, qui prennent le choix jouable le plus fort, finissent
à **99,5 %**.

## Les choix techniques

- **La run est serveur** (`draft.js`, table `user_draft_state`) : verrou
  quotidien, graine, choix, relances, duels, vie rachetée et gemmes. Un
  rechargement ou un autre appareil reprend la run.
- **L'offre reste calculée côté client**, depuis la graine du serveur : elle lit
  les règles d'invocation (`logic/DeckCoverage.ts`), que Node ne porte pas. Le
  serveur vérifie qu'un choix est du bon tier (ou forme un lot lié) et pas déjà
  pris, mais ne peut pas vérifier qu'il figurait dans l'offre : une run par
  jour, 60 gemmes au plus.
- **Le résultat d'un duel est soldé par le serveur**, à la clôture du match en
  ligne (`ws/MatchRelay`, `ws/BotMatch`) : le client ne rapporte rien.
- **L'offre est une fonction de l'état** (graine, nombre de cartes prises,
  relances dépensées) : recharger la page rend la même offre.
- **Toute la règle de l'offre est pure** dans `logic/Draft.ts`, testée dans
  `test/draft.test.ts` ; le serveur dans `test/draft-server.test.ts`.
- L'écran de jeu est celui du Duel en ligne (`GameScreenPvp`, `params.draft`),
  avec le deck drafté passé à `buildSession`. Contre un bot, son deck est
  drafté chez le client avec la même fonction d'offre, à la taille du deck du
  joueur.

## Ce qui reste ouvert

- **Le dosage** : un deck de 15 cartes pioche 5 cartes par tour dans un sac
  plus petit, donc les mêmes cartes reviennent plus souvent. À rejouer pour
  voir si 15 tient ou s'il faut remonter. Taille, relances, échelle, prix de la
  vie et barème de gemmes sont des constantes en tête de `draft.js` (et de
  `logic/Draft.ts` pour les jumelles).
- **Plus de leviers de chance**, si le cœur plaît : une offre « rare » de temps en
  temps, un choix de pack thématique en début de draft (le pool devient un pack
  au lieu du catalogue, sans rien concevoir de plus), une magie ou un terrain à
  drafter entre deux duels.
- **Le bot** reste `EnemyAI` : il drafte bien (carte jouable la plus forte),
  mais il joue comme partout ailleurs.
- **L'appariement** est le premier venu en draft, sans tenir compte du nombre de
  victoires : à revoir si la file se peuple.
