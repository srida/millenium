# Comportements de combat — pistes pour le placement

> Document de réflexion, **rien n'est implémenté**. Il prolonge les trois lots qui
> ont redonné du poids au placement : terrain révélé en début de tour, pouvoirs
> de zone (Attaque Zone, Provocation) et rééquilibrage portée / PV / vitesse.

## Pourquoi

Aujourd'hui chaque unité vise l'ennemi **le plus proche** (Manhattan) et marche
vers lui (BFS). Les deux camps se rejoignent en une mêlée compacte, et le seul
réflexe de placement utile est « la mêlée devant, les tireurs derrière » — l'IA
le fait déjà seule.

Pour que le placement devienne un **choix**, il faut des unités qui :

- **menacent la ligne arrière** (un tireur fragile mal protégé doit se payer) ;
- **récompensent une formation** (côte à côte, en ligne, sur un bord) ;
- **punissent une formation** (trop groupé, trop étalé).

## Trois familles

### 1. Qui je vise (ciblage)

| Mot-clé | Règle | Ce qu'il change au placement |
|---|---|---|
| 🗡️ **Assassin** | Au premier tick, saute sur une case libre **derrière la ligne ennemie**, puis vise l'ennemi aux PV les plus bas | Protéger ses tireurs (les entourer, les mettre sur un bord) |
| 🎯 **Tireur d'élite** | Vise l'ennemi **le plus éloigné** à portée | Rien n'est à l'abri derrière ; récompense une portée longue |
| 🩸 **Chasseur** | Vise l'ennemi aux **PV les plus bas** à portée | Les unités blessées (PV non régénérés entre les rounds) deviennent des cibles |
| 🔨 **Briseur** | Vise l'ennemi aux **PV max les plus hauts** | Contre direct des tanks et de la Provocation |

### 2. Où je vais (déplacement)

| Mot-clé | Règle | Ce qu'il change au placement |
|---|---|---|
| 🕳️ **Embusqué** | Ne bouge pas tant qu'aucun ennemi n'est à portée | Placer en fonction des couloirs (le terrain révélé prend tout son sens) |
| 🛡️ **Garde du corps** | Reste au contact de l'allié aux PV les plus bas | Construire autour d'une unité à protéger |
| 🐎 **Flanc** | Préfère les colonnes du bord pour avancer | Contourner la mêlée centrale |
| 🧲 **Harponneur** | Son attaque tire la cible d'une case vers lui | Déformer la ligne adverse, à combiner avec une Attaque Zone |

### 3. D'où je pars (récompense de position)

Ces règles sont des **effets** du moteur (paliers d'attribut à 1), il suffit
d'un nouveau critère de sélecteur — pas de nouvelle boucle de combat.

| Mot-clé | Règle | Ce qu'il change au placement |
|---|---|---|
| 🧱 **Phalange** | +X bouclier par allié **adjacent** au début du combat | Formation serrée… exposée aux zones |
| ⚔️ **Avant-garde** | Bonus si l'unité démarre sur la **rangée de front** | Choisir qui ouvre |
| 🏹 **Arrière-garde** | Bonus si l'unité démarre sur la **rangée du fond** | Choisir qui reste loin |
| 🔱 **Lancier** | L'attaque touche aussi l'unité **derrière** la cible | Ne pas s'aligner en colonne |
| 🌊 **Balayage** | L'attaque touche les deux voisines latérales de la cible | Ne pas s'aligner en rangée |

## Les deux premiers à faire

**Assassin** et **Phalange**, ensemble : l'un punit un tireur exposé, l'autre
récompense une formation serrée, et une formation serrée s'expose aux Attaques
Zone. Les trois forment un triangle qui oblige à choisir.

## Contraintes techniques (à respecter pour tout mot-clé)

- **Déterminisme PvP.** Toute politique de ciblage se départage en dernier par
  `card_id` (comme l'ordre d'action), jamais par l'ordre d'un tableau d'unités.
  Le filet `pvp-determinism.test.ts` doit couvrir chaque nouveau mot-clé.
- **Jamais de rangée absolue.** « Front », « fond », « derrière la ligne » se
  définissent par rapport au **camp** de l'unité (rangée 3 = front joueur,
  rangée 7 = front ennemi), sinon le miroir du rôle B diverge. Passer par les
  énumérateurs de `Board` (`rowScan`, `rowNeighbourOffsets`).
- **Une seule fonction de ciblage paramétrée.** `findAttackTarget` reçoit une
  politique de tri (`plus_proche` par défaut, `plus_loin`, `pv_bas`,
  `pv_max_haut`) plutôt que quatre fonctions recopiées. La pertinence des
  pouvoirs (`_isPowerRelevant`) reste sur la cible ainsi choisie.
- **Mots-clés = attributs `MotCle`.** Ciblage et déplacement ne sont pas des
  tâches du moteur d'effets : ils entrent dans `MOTS_CLES` (comme Multiple ou
  Unique). Les récompenses de position, elles, sont des effets avec un nouveau
  filtre de sélecteur (`adjacents`, `rangee: 'front' | 'fond'`).
- **L'IA doit les connaître.** `EnemyAI.rearrangeUnits` place aujourd'hui
  mêlée devant / distance derrière ; elle devra poser un Assassin n'importe où,
  un Tireur d'élite au fond, une Phalange en ligne, et ses tireurs à l'abri d'un
  Assassin adverse connu.
- **L'auto-joueur de la simulation aussi**, sinon la mesure d'équilibrage ne
  verra pas la valeur d'un bon placement.
- **Effets visuels** : planaires (caméra verticale), pas sous la carte CSS3D
  (une carte masque toute sa case) — cf. « Rendu 3D » dans `CLAUDE.md`.

## Mesurer

Chaque mot-clé arrive avec :

1. un rapport de simulation avant / après (agrégat par portée et par mot-clé) ;
2. un A/B sur les cartes qui le portent ;
3. une vérification que l'écart entre portées reste dans ±2 points.
