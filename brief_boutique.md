# brief_boutique.md

> Document canonique — Système de boutique de Millenium
> Statut : validé sur les axes structurants, chiffrage à confirmer en playtest
> Modèle de sets : **mixte** (plusieurs archétypes par set), validé — découpage effectif à produire
> Dépendances : `brief_progression.md` (revenu, paliers, ladder), `cards.json`, `attributes.json`

---

## 1. Périmètre et principes

Deux boutiques distinctes, deux fonctions non interchangeables :

- **Boutique de cartes** — acquisition compétitive. Alimente la collection, donc les options de deck.
- **Boutique cosmétique** — expression. N'a aucun effet sur le jeu.

### 1.1 Principes directeurs

1. **Aucun achat mort.** Une carte vendue doit être immédiatement jouable ou débloquer quelque chose. Corollaire de la structure d'invocation de Millenium : une fusion sans matériaux et une transformation sans carte de base sont inutilisables.
2. **Zéro doublon.** Les decks n'autorisent qu'un exemplaire par carte. Aucun tirage ne peut produire une carte déjà possédée. Conséquence : aucun système de poussière, de fragments ou de conversion n'est nécessaire.
3. **Les gemmes achètent du volume et de l'expression, jamais de la précision.** Un payeur accumule plus vite ; il ne peut pas obtenir *la* carte qui lui manque plus vite qu'un joueur gratuit.
4. **Toute carte du jeu est accessible sans achat.** Engagement public, vérifiable.
5. **Trois lanes économiques étanches.** Chaque monnaie a une destination principale ; les systèmes ne se cannibalisent pas.
6. **Un archétype vit intégralement dans un seul set.** Les sets sont thématiquement mixtes, mais aucun attribut n'est jamais découpé entre deux sets. Règle non négociable, justifiée en 2.4.

### 1.2 Les trois lanes

| Source | Volume | Destination principale |
|---|---|---|
| Flux de golds (matchs, missions) | 3000 / semaine | Emplacements quotidiens |
| Primes de jalon (paliers de niveau, saison) | ponctuel | Cosmétiques |
| Gemmes (jalons uniquement) | ponctuel | Boosters |

Le flux de golds est calibré pour qu'un joueur régulier ne puisse **pas** acheter les 21 emplacements hebdomadaires proposés. L'arbitrage est intentionnel.

---

## 2. Prérequis bloquant — le champ `set`

L'état actuel de `cards.json` ne permet pas d'implémenter les boosters. Le préfixe d'`id` est un identifiant technique, pas un axe commercial.

### 2.1 Constat

398 cartes. `CORE` (132) et `EXTRA` (95) sont des découpes structurelles (main deck / extra deck), pas thématiques. Les groupes de personnages vont de 8 à 32 cartes. `YGX` contient 24 Tier 1 et un seul Tier 3. La valeur d'un booster varierait d'un facteur 15 selon le groupe, et plusieurs groupes ne peuvent pas satisfaire la garantie de distribution de tiers.

### 2.2 Correctif

Ajouter à chaque carte un champ `set`, indépendant de `id` :

```json
{
  "id": "CORE_042",
  "set": "SET_BLUE_EYES",
  "name": "Dragon étincelant de saphir"
}
```

### 2.3 Modèle retenu — sets thématiquement mixtes

Un set contient **plusieurs archétypes**, à la manière des extensions Yu-Gi-Oh, et non un archétype unique.

Motivation : un set mixte reste désirable pour plusieurs profils de joueurs simultanément, il lève la contrainte de trouver 60 cartes cohérentes par archétype, et il préserve la découverte à l'ouverture.

Contraintes de découpage :

- **Cible : 55 à 65 cartes par set.**
- **3 à 4 archétypes par set**, de **12 à 18 cartes chacun**.
- **Un archétype n'est jamais découpé entre deux sets.** Matériaux de fusion, héritages et transformations compris. Règle absolue.
- **Distribution de tiers par set** : au moins 8 cartes Tier 3+, au moins 3 Tier 4+, idéalement 1 à 2 Tier 5. La garantie du booster en dépend.
- **Ne pas concentrer tous les Tier 5 sur un même archétype d'un set.** Sinon le set se réduit de fait à cet archétype et le mélange ne sert plus à rien.
- **Au moins un archétype par set doit pouvoir soutenir seul un deck de 20 cartes.** Sans ça, le set n'a aucun acheteur naturel.
- **Aucune carte orpheline** : toute carte fusion/héritage/transformation doit avoir ses matériaux dans le même set, ou dans le set de fondation (cf. 2.5).

Cible : environ 7 sets sur le pool actuel, 9 avec *Course au Sommet* (38) et *Le Plus Fort* (65).

**Le plancher de 12 cartes par archétype n'est pas arbitraire.** Les seuils d'attributs exigent 2 à 4 unités portant l'attribut simultanément sur le board, avec une pioche de 5 cartes par tour depuis un pool dépendant du tour et un deck de 20 cartes minimum. En dessous de 12 cartes d'un archétype dans la collection, le joueur ne peut pas en placer assez dans son deck pour que le seuil se déclenche de façon fiable. L'archétype existe sur le papier et ne se joue jamais. Six archétypes de 10 cartes dans un set, c'est six archétypes injouables.

### 2.4 Conséquence du modèle mixte — la queue de collection

Dans un système de tirage sans doublon, les dernières cartes d'un archétype arrivent statistiquement à la fin du set. Pour un set de 60 cartes contenant un archétype de 15 :

| Cartes de l'archétype obtenues | Boosters nécessaires (espérance) |
|---|---|
| 8 | 11 |
| 10 | 13 |
| 12 | 16 |
| 15 (complet) | **19 sur 20** |

Compléter un archétype coûte donc pratiquement le prix du set entier. Sur un set mono-archétype, un noyau de 12 cartes coûtait 4 boosters ; ici il en coûte 16 — un facteur **3,5×** sur la vitesse de montée en puissance d'un deck ciblé.

C'est le prix assumé du modèle mixte. Deux correctifs le ramènent à un niveau acceptable (cf. 3.4) : la **cohérence intra-booster** et la **pondération d'affinité**, qui font retomber le noyau de 12 cartes à ~10 boosters, soit un facteur 2,5×.

C'est aussi la raison pour laquelle un archétype ne doit jamais être découpé entre deux sets : la queue de collection se multiplierait par le nombre de sets concernés. Un joueur devrait vider deux sets de 60 cartes pour compléter un archétype de 15. C'est le mode d'échec historique de Yu-Gi-Oh, et il serait bien plus sévère chez toi à cause du tirage sans remise.

### 2.5 Cas particulier — le set de fondation

Certaines cartes Tier 1 sont des matériaux transverses utilisés par plusieurs archétypes. Les dupliquer dans chaque set casserait le principe « zéro doublon ».

Solution : un set `SET_FOUNDATION`, non vendu en booster, dont les cartes sont **attribuées gratuitement** à la progression de niveau (onboarding et premiers paliers). Elles restent achetables à l'unité dans les emplacements quotidiens.

Bénéfice secondaire : ça résout aussi la livraison de cartes d'onboarding, listée comme décision ouverte dans `brief_progression.md`.

---

## 3. Boutique de cartes

### 3.1 Les trois emplacements quotidiens

Composition fixe, contenu variable. Rotation toutes les 24 h, alignée sur le reset des missions quotidiennes.

| Slot | Nom | Règle de tirage | Rôle |
|---|---|---|---|
| 1 | **Le Maillon** | Carte non possédée dont le joueur possède tous les matériaux, **ou** matériau manquant d'une carte qu'il possède déjà | Débloque immédiatement une invocation |
| 2 | **L'Affinité** | Carte non possédée partageant un attribut avec ≥ 2 cartes de son deck actif | Pousse vers les seuils d'attributs |
| 3 | **L'Inconnu** | Tirage libre pondéré par tier, hors slots 1 et 2 | Découverte, ouverture d'archétype |

Le slot 1 affiche un badge explicite : `⚡ Débloque : Chimère la bête illusion`. C'est le badge qui porte la valeur perçue, pas la carte.

**Les trois emplacements sont achetables le même jour.** Acheter un slot le vide sans rafraîchir les autres ; aucun re-tirage après achat.

### 3.2 Algorithme de sélection

Exécuté au reset quotidien, déterministe à partir d'une graine `(player_id, date)` pour permettre la reproductibilité et le débogage.

```
POOL = toutes les cartes non possédées par le joueur

# --- Slot 1 : Le Maillon ---
CANDIDATS_1 = { c ∈ POOL :
    (c.cost.materials ≠ ∅ ET tous les materials de c sont possédés)
    OU (∃ d possédée telle que c ∈ d.cost.materials) }

# les attributs (ARCH_*) présents dans cost.materials sont satisfaits
# par la possession d'au moins une carte portant cet attribut

si CANDIDATS_1 = ∅ → repli sur CANDIDATS_3
sinon → tirage pondéré par tier

# --- Slot 2 : L'Affinité ---
ATTRS = attributs présents ≥ 2 fois dans le deck actif du joueur
CANDIDATS_2 = { c ∈ POOL \ {slot1} : c.attributes ∩ ATTRS ≠ ∅ }
si CANDIDATS_2 = ∅ → repli sur CANDIDATS_3
sinon → tirage pondéré par tier

# --- Slot 3 : L'Inconnu ---
CANDIDATS_3 = POOL \ {slot1, slot2}
tirage pondéré par tier
```

**Pondération par tier** (identique pour les trois slots) :

| Tier | Poids |
|---|---|
| 1 | 30 |
| 2 | 28 |
| 3 | 22 |
| 4 | 14 |
| 5 | 6 |

Volontairement plus plate que la distribution naturelle du pool (T1 38 % / T5 5 %) : les tiers élevés sont plus désirables et coûtent plus cher, il faut qu'ils apparaissent assez souvent pour que l'arbitrage budgétaire existe.

**Dégénérescence en fin de collection** : quand le graphe est saturé, les slots 1 et 2 se replient naturellement sur le comportement du slot 3. Aucun traitement particulier requis.

**Priorité de la Convoitise** : si une carte est épinglée et son délai écoulé, elle occupe le slot 1 et court-circuite `CANDIDATS_1` (cf. 3.5).

### 3.3 Grille tarifaire — cartes à l'unité

| Tier | Prix (golds) | En jours de revenu |
|---|---|---|
| 1 | 75 | 0,18 |
| 2 | 125 | 0,29 |
| 3 | 200 | 0,47 |
| 4 | 350 | 0,82 |
| 5 | 550 | 1,29 |

Prix moyen pondéré d'un emplacement : **≈ 166 golds**.

Offre hebdomadaire : 21 emplacements ≈ 3490 golds de valeur, pour un revenu de 3000. Le joueur ne peut structurellement pas tout acheter. En tenant compte du fait qu'il ignorera les propositions qui ne l'intéressent pas (conversion estimée 65-75 %), la consommation réelle se situe autour de **14 à 16 cartes par semaine pour ~2400 golds**, laissant ~600 golds de marge hebdomadaire pour les cosmétiques.

> **Levier de tuning** : si l'arbitrage se révèle trop mou en playtest (joueurs achetant systématiquement tout), augmenter la grille de 20 % avant de toucher au revenu. Le prix des slots est le levier le plus sûr de l'économie — il n'affecte ni le ladder ni les missions.

### 3.4 Boosters

**Format** : 3 cartes, ciblé sur un `set`, **disponible en permanence** (pas de rotation).

**Prix** : 600 golds **ou** 100 gemmes. Aucun plafond d'achat.

**Règles de tirage** :

1. Tirage exclusivement parmi les cartes **non possédées** du set.
2. **Distribution garantie** : 2 cartes Tier 1-2 + 1 carte Tier 3+.
3. **Cohérence d'attribut** : les 3 cartes d'un booster partagent toujours au moins un attribut. Le tirage sélectionne d'abord une carte, puis restreint le pool aux cartes partageant un de ses attributs.
4. **Pondération d'affinité** : à l'intérieur du set, les cartes portant un attribut présent dans le deck actif du joueur ont un poids ×2. Non exclusif — la découverte reste possible.
5. **Cohérence de lignée** : si le tirage produit une carte fusion/héritage/transformation, les emplacements restants sont remplis en priorité par ses matériaux manquants présents dans le set.
6. Toute garantie qui ne peut pas être satisfaite par le pool restant se rabat **silencieusement** sur ce qui reste. Aucun message d'erreur, aucun blocage.
7. Booster **grisé** quand le set est complet, mention « Collection complète ». Jamais de vente ne pouvant rien produire.

Les règles 3 et 4 sont les correctifs du modèle de sets mixtes (cf. 2.4). La cohérence d'attribut ne change rien à la vitesse de complétion mais transforme le ressenti : le joueur reçoit un trio utilisable au lieu de trois cartes sans rapport — la différence entre « j'ai avancé » et « j'ai eu du déchet ». La pondération d'affinité fait passer l'acquisition d'un noyau de 12 cartes de 16 boosters à environ 10.

**Prix par carte : 200 golds**, contre 166 pour un emplacement quotidien. Écart de 20 %.

**Proposition de valeur du booster : le débit, pas le ciblage.** Avec des sets mixtes, le joueur ne choisit plus vraiment l'archétype vers lequel il progresse — il choisit un set qui en contient trois ou quatre. Le booster perd donc sa prime de ciblage, d'où le prix ramené de 750 à 600 golds. Ce qu'il vend désormais, c'est la seule façon de dépasser **3 cartes par jour**.

Répartition des rôles qui en découle :

| Système | Fonction | Plafond |
|---|---|---|
| Emplacements quotidiens | **Construction de deck** — conscients du graphe de dépendances et du deck actif | 3 / jour |
| Booster | **Collection** — volume brut sur un set choisi | aucun |
| Convoitise | **Précision absolue** — une carte nommée | 1 à la fois, 3 jours |

**Conséquence assumée de la permanence** : l'acquisition reste entièrement déterministe. Un joueur qui veut une carte précise achète des boosters de son set jusqu'à l'obtenir, avec un coût maximum borné et connu d'avance. Le dernier booster d'un set est un jackpot garanti.

> **Ne jamais indexer le prix du booster sur le taux de complétion du set.** La valeur croissante à mesure que le set se complète est la propriété la plus vertueuse du système : elle récompense l'engagement au lieu de le taxer.

**Effet de bord souhaitable** : les joueurs complètent un set à la fois. Comme un archétype vit intégralement dans un seul set, la stratégie économique optimale converge avec la stratégie de deck optimale. C'est précisément ce que garantit la règle de non-découpage des archétypes.

### 3.5 La Convoitise

Mécanique de ciblage transverse — permet d'obtenir une carte précise **sans investir dans son set**.

- Le joueur épingle **une seule** carte non possédée, à tout moment, gratuitement.
- Après **3 jours** consécutifs, elle apparaît automatiquement dans le slot 1 de la boutique quotidienne.
- Prix : **double du tarif de son tier** (150 / 250 / 400 / 700 / 1100 golds).
- **Golds uniquement.** Jamais de gemmes — c'est le point de rupture du principe « les gemmes n'achètent pas de précision ».
- Changer de carte épinglée réinitialise le compteur à zéro.
- Si le joueur n'achète pas la carte le jour où elle apparaît, elle reste épinglée et réapparaît le lendemain.

Cas d'usage type : un joueur investi dans *Le Plus Fort* veut une seule pièce de *Course au Sommet* pour compléter un attribut transverse. Sans la Convoitise, il devrait acheter des boosters d'un set qui ne l'intéresse pas.

### 3.6 Reroll

**Un reroll gratuit par jour**, sur un emplacement au choix, avant achat. Reprend la grammaire des missions quotidiennes.

Le reroll retire la carte du pool du jour (elle ne peut pas être re-tirée immédiatement) et relance l'algorithme sur le slot concerné en conservant sa règle. Un reroll du slot 1 produit un autre Maillon, pas une carte aléatoire.

Pas de reroll payant. Un reroll achetable transformerait la boutique quotidienne en machine à sous et casserait le plafond de 3 cartes/jour qui structure toute l'économie.

---

## 4. Boutique cosmétique

### 4.1 Vendu contre golds vs. attribué par progression

Le point de tension identifié en amont : monnaie unique, donc les cosmétiques concurrencent l'acquisition de cartes. La ligne de partage :

| Rareté | Acquisition | Exemples |
|---|---|---|
| Commun, Rare | **Achat en golds** | Avatars de base, cadres simples, styles procéduraux |
| **Prestige** | **Progression uniquement — jamais achetable** | Cadre de rang de pic saisonnier, avatar de palier de niveau, illustration alternative de complétion de set |

Résultat : la boutique cosmétique ne concurrence l'acquisition de cartes que marginalement (~600 golds/semaine de marge), et les objets réellement désirables restent hors marché. Un cadre « Diamant — Saison 3 » vaut plus qu'un cadre acheté, quel que soit son prix.

### 4.2 Styles de carte conditionnés par attribut

Modèle retenu pour les variantes de carte. Un style est un **effet de rendu procédural** (shader) applicable à toute carte possédée **portant l'attribut requis**.

```
Aura de Braise    → ARCH_027 Salamandra
Givre             → ARCH_035 Aquatique
Rouille           → ARCH_025 Machine
Ossuaire          → ARCH_029 Zombie
Chrome            → ARCH_011 Gadget
Poussière d'astre → ARCH_031 Dieu Égyptien
```

Pourquoi ce modèle :

- **Coût de production quasi nul par SKU.** Un shader génère 8 à 12 articles vendables.
- **Le catalogue respire longtemps.** Un joueur ne peut acheter que les styles correspondant aux archétypes qu'il possède, ce qui plafonne naturellement sa consommation sans plafond artificiel.
- **Chaque style raconte quelque chose.** Une aura de braise sur un Salamandra, c'est de la cohérence ; sur n'importe quelle carte, c'est un filtre Instagram.
- **Réutilise `attributes.json`**, déjà en place.

Règle produit : **un style n'est achetable que si le joueur possède au moins une carte portant l'attribut requis.** Les styles non éligibles sont affichés grisés, avec la condition visible — ils servent d'objectif.

> **Dépendance technique** : ce modèle rend le champ VFX/élément par carte **obligatoire**. C'est le point d'accroche des shaders. Cette décision, laissée en attente sur le schéma de données, est désormais forcée par la boutique et doit être tranchée avant la Phase 2 de la refonte UI.

### 4.3 Illustrations alternatives

Refaites à la main, réservées à **10 à 15 cartes iconiques** (une à deux par set, les têtes d'affiche).

Positionnement : rareté **Prestige**. Attribuées par complétion de set à 100 %, ou par rang de pic saisonnier. **Non achetables.** C'est la récompense terminale de la collection — la vendre reviendrait à en détruire le sens.

### 4.4 Rotation

- **Vitrine** : 4 à 6 emplacements, rotation toutes les 24 h, alignée sur la boutique de cartes.
- **Catalogue permanent** : les styles procéduraux de base et les avatars communs, toujours disponibles, sans rotation, sans pression.

**Formulation obligatoire de la rotation** : « Nouvelle sélection dans 14 h ». **Jamais** « Disparaît dans 14 h ».

Un cosmétique acheté ne sort pas du pool (contrairement à une carte). Avec 40 à 60 pièces en catalogue et 5 emplacements quotidiens, chaque objet réapparaît tous les 8 à 12 jours. Habiller cette rotation en rareté serait un mensonge — et un joueur qui croit avoir raté un cadre définitivement puis le revoit une semaine plus tard perd confiance dans tous les autres compteurs du jeu.

### 4.5 Grille tarifaire — cosmétiques

| Article | Prix (golds) |
|---|---|
| Avatar commun | 150 |
| Avatar rare | 400 |
| Cadre commun | 200 |
| Cadre rare | 500 |
| Style de carte (par attribut) | 500 |
| Pack « tous styles d'un set » | 1200 |
| Illustration alternative | **non achetable** |

Budget cible : ~600 golds/semaine de marge sur le flux, plus les primes de jalon. Soit environ **un article par semaine** pour un joueur régulier qui ne sacrifie pas son acquisition de cartes.

---

## 5. Monnaies

### 5.1 Golds — monnaie de flux

Source : matchs, missions quotidiennes, paliers de niveau, récompenses de saison.
Destination : emplacements quotidiens, Convoitise, cosmétiques, boosters d'appoint.

### 5.2 Gemmes — monnaie de jalon

Pas d'argent réel à ce stade. Les gemmes sont donc une monnaie **gagnée**, ce qui entre en tension avec le principe de monnaie unique — sauf si elles ne coulent pas au fil de l'eau.

**Règle : les gemmes ne sont jamais attribuées par match ou par mission.** Uniquement par jalon :

| Événement | Gemmes |
|---|---|
| Palier de niveau (tous les 5 niveaux) | 100 |
| Complétion d'un set à 100 % | 300 |
| Rang de pic saisonnier | 200 à 800 selon le rang |
| Succès / défis ponctuels | 50 à 150 |

Ancrage de valeur : 100 gemmes = 1 booster = 750 golds, soit **1 gemme ≈ 7,5 golds**.

**Non convertibles.** Les gemmes n'achètent ni emplacements quotidiens, ni Convoitise, ni cosmétiques. Uniquement des boosters. C'est ce qui garantit que l'accélération n'achète jamais de précision.

Quand l'argent réel sera introduit, le prix d'un pack de gemmes se déduit de cet ancrage sans rien recalibrer.

---

## 6. Courbes de complétion

Hypothèses : revenu 3000 golds/semaine, conversion 70 % sur les emplacements quotidiens, sets mixtes de 60 cartes contenant 3 à 4 archétypes de 12 à 18 cartes, pondération d'affinité active.

| Objectif | Voie golds | Voie gemmes |
|---|---|---|
| Noyau jouable d'un archétype (12 cartes) | 10 boosters — 6000 golds — **2 semaines** | 1000 gemmes |
| Archétype complet (15 cartes) | ~17 boosters — 10 200 golds — **3,5 semaines** | 1700 gemmes |
| Set complet (60 cartes) | 20 boosters — 12 000 golds — **4 semaines** | 2000 gemmes |
| Collection intégrale (398 cartes) | mixte — **~26 semaines** | — |

L'écart entre « noyau jouable » et « archétype complet » est la signature du modèle mixte : les 3 dernières cartes coûtent aussi cher que les 12 premières. C'est acceptable tant que le noyau de 12 suffit à jouer sérieusement — ce que garantit le plancher fixé en 2.3. À surveiller en playtest : si les joueurs perçoivent les 3 dernières cartes comme indispensables plutôt que comme du confort, c'est que l'archétype est mal équilibré, pas que l'économie est trop lente.

Rythme d'acquisition d'un joueur régulier : **14 à 16 cartes par semaine**.

Points de contrôle à valider en playtest :

- Un nouveau joueur doit pouvoir constituer un deck cohérent de 20 cartes en **moins d'une semaine**. Le set de fondation (cf. 2.3) doit couvrir l'essentiel de ce besoin dès l'onboarding — la boutique ne doit pas être un prérequis pour jouer.
- Le seuil de décrochage se situe autour de 3 semaines sans nouvelle carte marquante. La distribution de tiers des boosters doit garantir un pic régulier.

---

## 7. Garde-fous et cas limites

| Cas | Traitement |
|---|---|
| Pool de cartes non possédées vide (collection complète) | Boutique de cartes remplacée par un message de complétion + redirection cosmétique |
| Set complet | Booster grisé, mention explicite |
| Pool d'un set insuffisant pour la garantie de tier | Repli silencieux sur les cartes restantes |
| Pool insuffisant pour la cohérence d'attribut du booster | Repli silencieux. Priorité d'abandon : cohérence d'attribut d'abord, garantie de tier ensuite, jamais le « zéro doublon » |
| Aucun deck actif — pondération d'affinité | Tirage uniforme dans le set |
| Deck actif modifié après génération d'un booster | Sans objet : le booster est tiré au moment de l'achat, pas à l'avance |
| Aucun deck actif (nouveau joueur) | Slot 2 se replie sur le tirage libre |
| Deck actif supprimé pendant la journée | L'offre du jour est figée, aucun re-tirage |
| Changement de deck actif | L'offre du jour reste figée. Le nouveau deck n'influence l'algorithme qu'au reset suivant — sinon exploit par changement de deck en boucle |
| Achat pendant la seconde de rotation | Verrou transactionnel sur l'offre ; l'achat valide l'offre horodatée, pas la courante |
| Carte épinglée obtenue par booster | La Convoitise se vide automatiquement, compteur remis à zéro, notification |
| Joueur hors ligne plusieurs jours | Pas de rattrapage, pas d'accumulation d'offres. La rotation quotidienne est une opportunité, jamais une punition |
| Style acheté puis toutes les cartes de l'attribut perdues | Impossible — aucune carte n'est retirable de la collection |

**Anti-exploit** : l'offre quotidienne est générée côté serveur et horodatée. Aucune régénération déclenchable par une action client (changement de deck, redémarrage, changement de fuseau horaire).

---

## 8. Schéma de données

### 8.1 `cards.json` — ajout

```json
{
  "id": "CORE_042",
  "set": "SET_BLUE_EYES",
  "vfx_element": "lightning"
}
```

`vfx_element` : point d'accroche des styles procéduraux (cf. 4.2). Valeurs à figer avec le pipeline de rendu.

### 8.2 `sets.json` — nouveau

```json
[
  {
    "id": "SET_01",
    "name": "L'Héritage de Saphir",
    "card_count": 61,
    "booster_enabled": true,
    "archetypes": [
      { "attribute": "ARCH_005", "card_count": 16, "carries_deck": true },
      { "attribute": "ARCH_007", "card_count": 15, "carries_deck": true },
      { "attribute": "ARCH_011", "card_count": 14, "carries_deck": false },
      { "attribute": "ARCH_029", "card_count": 12, "carries_deck": false }
    ],
    "signature_card": "CORE_103",
    "completion_reward": {
      "gems": 300,
      "cosmetic": "COSM_ART_BLUE_EYES"
    }
  },
  {
    "id": "SET_FOUNDATION",
    "name": "Fondations",
    "card_count": 24,
    "booster_enabled": false,
    "granted_by_progression": true
  }
]
```

### 8.3 `shop_config.json` — nouveau

```json
{
  "daily_slots": {
    "count": 3,
    "rotation_hours": 24,
    "free_rerolls_per_day": 1,
    "tier_weights": { "1": 30, "2": 28, "3": 22, "4": 14, "5": 6 }
  },
  "card_prices_golds": { "1": 75, "2": 125, "3": 200, "4": 350, "5": 550 },
  "covet": {
    "delay_days": 3,
    "price_multiplier": 2,
    "currency": "golds"
  },
  "booster": {
    "card_count": 3,
    "price_golds": 600,
    "price_gems": 100,
    "purchase_cap": null,
    "tier_guarantee": { "low": 2, "high": 1, "high_threshold": 3 },
    "attribute_coherence": true,
    "material_coherence": true,
    "affinity_weight": 2,
    "fallback_priority": ["attribute_coherence", "tier_guarantee"]
  },
  "cosmetic_shop": {
    "showcase_slots": 5,
    "rotation_hours": 24
  }
}
```

### 8.4 `cosmetics.json` — nouveau

```json
[
  {
    "id": "COSM_STYLE_EMBER",
    "type": "card_style",
    "name": "Aura de Braise",
    "rarity": "rare",
    "acquisition": "shop",
    "price_golds": 500,
    "requires_attribute": "ARCH_027",
    "shader": "ember_aura"
  },
  {
    "id": "COSM_FRAME_S3_DIAMOND",
    "type": "avatar_frame",
    "name": "Sceau de Diamant — Saison 3",
    "rarity": "prestige",
    "acquisition": "progression",
    "unlock": { "type": "season_peak_rank", "season": 3, "rank": "diamond" }
  },
  {
    "id": "COSM_ART_BLUE_EYES",
    "type": "card_art",
    "name": "Saphir — Illustration d'Origine",
    "rarity": "prestige",
    "acquisition": "progression",
    "target_card": "CORE_103",
    "unlock": { "type": "set_completion", "set": "SET_BLUE_EYES" }
  }
]
```

### 8.5 `player_shop_state.json` — état serveur

```json
{
  "player_id": "...",
  "daily_offer": {
    "generated_at": "2026-07-27T04:00:00Z",
    "seed": "...",
    "slots": [
      { "slot": 1, "card_id": "EXTRA_081", "reason": "unlocks", "price": 350, "purchased": false },
      { "slot": 2, "card_id": "CORE_044", "reason": "affinity:ARCH_003", "price": 125, "purchased": true },
      { "slot": 3, "card_id": "PEGASUS_012", "reason": "random", "price": 75, "purchased": false }
    ],
    "reroll_used": false
  },
  "covet": { "card_id": "EXTRA_084", "pinned_at": "2026-07-25T09:12:00Z" },
  "cosmetic_offer": { "generated_at": "...", "items": ["COSM_STYLE_EMBER", "..."] }
}
```

Le champ `reason` alimente le badge affiché en boutique et sert au débogage de l'algorithme.

---

## 9. Décisions ouvertes

1. **Découpage des sets** — chantier prioritaire, bloque toute implémentation de booster. Modèle mixte validé (cf. 2.3) ; reste à produire le découpage effectif sur `cards.json` + `attributes.json`. Points de contrôle : 3-4 archétypes par set, 12-18 cartes chacun, aucun attribut à cheval sur deux sets, au moins un archétype `carries_deck` par set, Tier 5 répartis.
2. **Composition du set de fondation** — quelles cartes Tier 1 sont réellement transverses, et à quels paliers de niveau sont-elles attribuées ? Recoupe la décision ouverte sur les cibles de livraison de cartes d'onboarding.
3. **Valeurs de `vfx_element`** — à figer avec le pipeline de rendu Babylon.js.
4. **Barème gemmes par rang de pic saisonnier** — à caler sur la structure de ladder de `brief_progression.md`.
5. **Absence de plafond sur les boosters** — validée à ce stade. À réexaminer si l'argent réel est introduit : un plafond hebdomadaire devient alors le principal garde-fou anti-pay-to-win, et recoupe la décision ouverte sur le cap de golds hebdomadaire.
6. **Illustrations alternatives** — quelles 10 à 15 cartes ? Une par set + les têtes d'affiche transverses.
