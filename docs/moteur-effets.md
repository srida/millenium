# Moteur d'effets — cartographie de l'existant, architecture cible

> Document de conception. Il ne décrit **aucun code écrit** : il décrit ce qui
> existe aujourd'hui (mesuré sur le catalogue du volume) et la forme visée.
> Tant qu'une décision de la section 7 n'est pas prise, rien ne se code.

---

## 0. Révision du 11 septembre 2026 — ce que `main` a changé sous ce document

Trois changements ont atterri sur `main` entre la rédaction de cette
cartographie et l'étape 0. Ils ne déplacent pas le plan ; ils en **retirent la
première moitié**, déjà faite par une autre route.

| Ce qui a changé | Conséquence sur ce document |
|---|---|
| **L'échelle 0–100** (`speed-scale.mjs`) remplace les périodes en ticks : `attack_speed`/`movement_speed`/`power_speed` deviennent `attack_rate`/`movement_rate`/`power_rate`, **plus haut = plus rapide**. Les durées de pouvoir (paralysie, blocage, confusion, provocation) passent sur la même fenêtre, dans `power.duration`. | §1.3 : **la première famille d'effets morts est corrigée**, et la question du signe (§7) est tranchée par l'échelle elle-même. |
| **La stat `initiative` est retirée** — l'ordre d'action se dérive. | Le vocabulaire de stats perd une entrée ; le §4.1 en tient compte. |
| **Les deux familles ont été reprises en donnée** (`timing` et formes d'effet réalignés, puis les deux derniers reliquats). | §1.4 bis : **21 effets morts → 0**. |
| **Le catalogue est passé de 868 à 953 cartes.** | Les chiffres du §1.1 sont ceux de la rédaction ; seuls ceux du §1.4 bis sont à jour. |

**Les deux corrections que cette branche portait sont donc caduques** :
`_recomputeStats` relit désormais les deux rythmes, et `applyStatModifier`
traite `RATE_STATS`. `speed-scale.test.ts` les éprouve dans les deux sens. Il
n'y avait aucune raison de les livrer deux fois — la branche a été rebasée sans
elles.

**Ce qui reste vrai, et c'est l'essentiel :** le diagnostic de fond du §2 n'a pas
bougé d'un pouce. Les quatre moteurs ne partagent toujours rien, le vocabulaire
de stats n'existe toujours pas en un seul endroit, et **rien ne sait encore dire
qu'un effet ne fait rien**. Les 21 ont été trouvés par un audit écrit à la main
et réparés un par un ; le compteur est à zéro parce qu'on est allé les chercher,
pas parce que quelque chose les surveille. C'est exactement ce que le moteur
générique existe pour rendre impossible.

### ⚠️ Le `data/` d'un conteneur de dév vieillit sans le dire

**Ce n'est pas une alerte sur la production** — la version précédente de cette
section en tirait une, à tort, et le piège vaut d'être écrit pour lui-même.

`bootstrap()` peuple un `data/` vide depuis `initial-data/`, et **la suite de
tests suffit à le déclencher**. Le dossier qui en sort est daté du jour où il a
été créé et **ne se remet jamais à jour** : `bootstrap()` ne recopie jamais
`initial-data/` sur un `data/` déjà peuplé. Une session de dév d'avant une
reprise de données laisse donc un catalogue figé à l'état d'avant, sans un mot.

Constaté ici : un `data/` du 10 septembre (868 cartes, en ticks) survivait à la
bascule vers les compteurs du 11. Ce que le moteur actuel en fait :

```
CORE_001  data/ périmé  dep 0 (77t) · atq 0 (77t) · POWER_DEBUFF seuil Infinity
CORE_001  initial-data/ dep 90 (10t) · atq 84 (14t) · POWER_DEBUFF seuil 60

Sur les 868 cartes de cette copie périmée :
  au plancher de l'échelle (77 ticks pour les deux rythmes) : 868
  pouvoirs qui ne partiront jamais                          : 436 / 436
```

Un compteur absent rend `NaN`, que `clampRate` ramène à `RATE_MIN` — **le plus
lent**. Un `power_rate` absent rend `null`, et `powerPeriod()` rend `Infinity` :
le pouvoir **ne part jamais**. Les deux replis sont justes pris un par un ; posés
sur un catalogue entier resté en ticks, ils donnent un jeu au ralenti et sans un
seul pouvoir. C'est exactement la panne muette que `CLAUDE.md` documente, et que
les trois gardes de `main` (contrat en **400**, `audit:cards --check`,
avertissement `[catalogue]` au démarrage) existent pour nommer.

⚠️ **Ce qui est à retenir pour la MESURE, et c'est le vrai enjeu ici** :
`sim/catalog.ts` charge `data/` **en priorité**, `initial-data/` seulement en
repli. Un détecteur d'équilibrage lancé dans un conteneur qui traîne un `data/`
périmé mesure donc un jeu que personne ne joue — et **rien ne le signale** : le
run aboutit, la ligne de base sort, elle est simplement fausse. Or ce détecteur
est l'oracle de la bascule (§6). **Avant toute mesure qui compte, vérifier la
date et la forme de `data/`**, ou l'effacer pour que `bootstrap()` le refasse.

---

## 1. L'existant : quatre moteurs qui ne partagent rien

Le jeu a **quatre porteurs d'effet**. Chacun a sa donnée, son moteur, son
déclenchement, son vocabulaire de types, et son éditeur d'admin. Aucune ligne
n'est partagée entre eux — sauf `guaranteed_draw` et `board_slot_bonus`, les
deux seuls cas où la mutualisation a été faite exprès.

| Porteur | Donnée | Moteur | Déclenchement | Types codés | Types utilisés | Objets |
|---|---|---|---|---|---|---|
| **Magie** | `magies.json` → `effect{}` (**un seul**, jamais une liste) | `logic/MagieEffect.applyEffect` + **11 branches** dans `GameSession` | tap du joueur, Phase Shopping | 27 | 23 | 51 |
| **Attribut** | `attributes.json` → `thresholds[].effects[]` | `logic/AttributeManager` | 3 timings fixes | 10 | 8 | 93 (53 avec seuils) |
| **Terrain** | `boards.json` → `effects[]` (repli `effect`) | `logic/BoardEffect.applyEffect` | lancement du combat | 4 | 3 | 25 |
| **Pouvoir** | `powers.json` (3 champs) + **id en dur dans le moteur** | `logic/CombatManager._firePower` | jauge pleine ∧ pertinent | 14 | 14 | 14 |

### 1.1 Les chiffres, et ce qu'ils disent

**Magies — 51 objets pour 23 types.**

```
guaranteed_draw:10  grant_power:6  stat_bonus:5  reduce_materials:4  draw_bonus:3
team_stat_bonus:2  revive:2  shield:2  player_hp_bonus:2  shift_tier_unit:2
board_slot_bonus:1  defuse_fusion:1  remove_requirements:1  team_heal:1
hand_to_graveyard:1  drain_life:1  heal:1  duplicate_unit:1  duplicate_card:1
duplicate_graveyard_unit:1  power_cooldown:1  sacrifice_card_hp:1  draw_material:1
```

- **13 types sur 23 ne portent qu'UNE magie.**
- **4 types sont codés, testés, documentés et portés par ZÉRO magie** :
  `stat_modifier`, `damage_multiplier_bonus`, `shift_tier_card`, `destroy_unit`.

Lecture : côté magies, **un type d'effet ≈ une intention de design ≈ une carte**.
Écrire une magie neuve, c'est écrire du code — dans `applyEffect`, dans la table
de pertinence `MagieOffer`, dans `effectLabel`, dans une des trois familles de
ciblage, et dans les deux listes `noValue` d'`admin.html`. Le « moteur » de
magies n'en est pas un : c'est un catalogue de 27 fonctions.

**Attributs — 93 objets pour 8 types.**

```
stat_bonus:40  guaranteed_draw:23  stat_modifier:10  draw_bonus:4  revive:4
shield:4  damage_multiplier_bonus:2  effect_immunity:1
```

**Terrains — 25 objets pour 3 types.**

```
stat_bonus:30  shield:2  draw_bonus:1
```

Lecture : **l'attribut et le terrain sont déjà data-driven** (2 types couvrent
72 % des 88 effets d'attribut et 91 % des 33 effets de terrain). La douleur
n'est pas répartie — elle est concentrée
sur les magies, et sur le fait que les quatre porteurs ne savent pas dire la
même chose.

### 1.2 Le même mot, trois implémentations

C'est le cœur du diagnostic. Un même `type` ne fait pas le même geste selon
qui le porte :

| Type | Magie | Attribut | Terrain |
|---|---|---|---|
| `stat_bonus` | écrit `_base` → **PERMANENT**, trace `_shopping_bonus`, `_recomputeStats()`, et bump `current_hp` si `hp` | `applyStatBonus` → `_stat_bonuses` → **combat seul**, enregistré pour rejeu après `POWER_DEBUFF`, facteur `value_per` | `applyStatBonus` → `_stat_bonuses` → **combat seul**, filtre `target_attributes` |
| `stat_modifier` | `_base += round(base × (v−1))` — permanent | `applyStatModifier` sur trigger de mort — combat, **n'écrit ni `_base` ni `_stat_bonuses`** (mute `atk`/`max_hp` en direct) | converti en additif dans `_stat_bonuses` |
| `shield` | `applyShield(v)` | `applyShield(v × nb alliés vivants)` | `applyShield(v)` |
| `draw_bonus` | `+= v`, source `magie` | `min(+v, max)`, source `attribut`, **crédite les deux camps** | `+= v`, source `terrain` |
| `revive` | sort du cimetière, purge **8 champs** de statut, `value` = % | 1er mort de la liste, purge **3 champs** de statut, `hp_percent` (déf. 50) | — |
| `damage_multiplier_bonus` | **permanent** (hors `nextRound`) | **ce round seulement** | — |
| `guaranteed_draw` | même forme, même file, même lecteur ✅ | idem ✅ | — |
| `board_slot_bonus` | cap +1 partagé ✅ | cap +1 partagé ✅ | — |

Les deux ✅ sont les seuls endroits où quelqu'un a dit « c'est la même
mécanique, elle n'existe qu'une fois ». Partout ailleurs, le mot est commun et
la règle ne l'est pas.

### 1.3 Les registres d'écriture d'une `Unit` — le vrai sujet

Un effet qui touche une unité doit choisir **où il écrit**. Il y a quatre
registres, aux durées de vie différentes, et le choix se fait à la main sur
chaque site d'appel :

| Registre | Durée de vie | Effacé par | Voyage en PvP ? |
|---|---|---|---|
| `_base` | **toute la partie** | rien | **oui** (`base` dans `round:board_ready`) |
| `_stat_bonuses` | **le combat** | `resetCombatStats()` (fin de combat, `POWER_DEBUFF`) | non — recalculé des deux côtés |
| `_shopping_bonus` | toute la partie, **transféré** aux composites | rien | non — dérivé de `_base` |
| champs directs (`current_hp`, `shield`, `power_id`, statuts…) | variable, un cas par champ | `resetCombatStats()` pour les statuts | **partiellement** (`current_hp`, `shield`, `power_*` voyagent) |

⚠️ **CORRIGÉ depuis** (cf. §0) : `_recomputeStats()` relisait 4 stats sur 6 —
`atk`, `hp`, `attack_speed`, `range` — et lisait `movement_speed` et
`initiative` **depuis `_base` seul**. L'échelle 0–100 a emporté la correction
avec elle : les deux rythmes se cumulent puis s'écrêtent, et `initiative`
n'existe plus. Le tableau ci-dessous est conservé **comme diagnostic**, pas
comme état courant.

⚠️ `power_charge` **n'est pas** dans ce cas, alors qu'il n'est pas non plus dans
`_recomputeStats` : `CombatManager` le lit directement sur `_stat_bonuses`
(`u.power_gauge += 1 + (u._stat_bonuses.power_charge || 0)`). Une stat vivante
peut donc être lue ailleurs — d'où l'audit ci-dessous plutôt qu'une lecture de
`_recomputeStats` seule.

**Première famille d'effets morts — la stat n'est jamais relue (10) :**

| Porteur | Palier | Effet | Valeur |
|---|---|---|---|
| `ARCH_021` Bête | 2 · 3 | `stat_bonus movement_speed` | −1 · −3 |
| `ARCH_035` Aquatique | 2 · 3 · 4 · 5 | `stat_bonus movement_speed` | −1 · −3 · −5 · −10 |
| `BOARD_008` Cimetière | — | `stat_bonus movement_speed` | −5 |
| `BOARD_009` Vallée des rois | — | `stat_bonus movement_speed` | −5 |
| `BOARD_010` Mur du Labyrinthe | — | `stat_bonus movement_speed` | −5 |
| `BOARD_025` Monde transparent | — | `stat_bonus movement_speed` | −4 |

Les quatre terrains **annoncent** leur `−5 mouvement` dans `TerrainAlert`, avec
le décompte des unités touchées. Le même `stat_bonus movement_speed` porté par
une **magie** fonctionnerait, lui, parce qu'il écrit dans `_base`.

C'est le symptôme exact de l'architecture actuelle : **le registre d'écriture et
le registre de lecture sont décorrélés, et rien ne peut dire qu'un effet ne fait
rien.**

### 1.4 Le `timing` vit sur l'attribut, la forme de l'effet vit sur l'effet

Seconde famille, plus grosse, et d'un autre mécanisme : `AttributeManager` a
**trois passes**, chacune ne connaissant qu'une poignée de types. Un effet dont
le type n'est pas au menu de la passe correspondant au `timing` de **son
attribut** est sauté sans un mot.

| Passe | Condition | Types exécutés |
|---|---|---|
| `_applyStartForSide` | `attr.timing === 'start_of_combat'` | `stat_bonus` · `shield` · `effect_immunity` |
| `_triggerStatModifiers` | `attr.timing === 'during_combat'` | `stat_modifier` **avec** un `trigger` connu |
| `_applyEndForSide` | `attr.timing === 'end_of_combat'` | `revive` · `draw_bonus` · `guaranteed_draw` · `board_slot_bonus` · `damage_multiplier_bonus` · `shopping_bonus` |

**Seconde famille d'effets morts — le type n'est pas au menu du timing (11) :**

| Porteur | `timing` | Effet écrit | Pourquoi il meurt |
|---|---|---|---|
| `ARCH_010` Noble | `none` | `stat_bonus hp 50` (palier 3) | `none` n'a aucune passe |
| `ARCH_017` Rage de Vaincre | `during_combat` | `damage_multiplier_bonus 1.5` | la passe ne lit que `stat_modifier` |
| `ARCH_036` Harpie | `start_of_combat` | `guaranteed_draw` | type de fin de combat |
| `ARCH_042` Gardiens | `start_of_combat` | `guaranteed_draw` ×2 (paliers 1 et 2) | idem |
| `ARCH_068` Dragon légendaires | `start_of_combat` | `guaranteed_draw` ×2 (même palier) | idem |
| `ARCH_043` Spectre | `end_of_combat` | `stat_modifier atk 2` + `trigger` | forme de `during_combat` |
| `ARCH_045` Volant | `start_of_combat` | `stat_modifier attack_speed` ×3 (−1 · −2 · −3) + `trigger` | forme de `during_combat` |

⚠️ **`ARCH_043` Spectre est documenté à tort dans `CLAUDE.md`** comme portant un
`damage_multiplier_bonus` de +2 avec une asymétrie PvP assumée. La donnée dit
`stat_modifier atk 2`, et l'effet **ne s'exécute pas** : la justification d'un
choix de déterminisme repose donc sur un effet qui n'existe pas.

⚠️ Les cinq `guaranteed_draw` de cette famille portent un champ **`category`**
(`"fusion"`, `"sacrifice"`, `"transformation"`) qui n'existe plus depuis que les
voies d'invocation sont des attributs. Réparer leur `timing` ne les rendrait donc
pas à ce qui était écrit : `guaranteedDrawCriteria` ignore `category` et ne
retiendrait que le filtre `attribute`. **C'est une décision de design, pas une
correction mécanique.**

**Total à la rédaction : 21 effets morts sur 13 porteurs**, soit 12,5 % des
effets d'attribut du catalogue.

### 1.4 bis — Le même audit, rejoué le 11 septembre : **0 effet mort**

Rejoué contre les trois passes d'`AttributeManager` et la liste de `case` de
`BoardEffect`, sur les 953 cartes, 93 attributs et 25 terrains d'`initial-data/`
**la dette est soldée en entier** :

| Famille | À la rédaction | Ce qui l'a emportée |
|---|---|---|
| 1 — la stat n'est jamais relue | 10 | la bascule vers l'échelle 0–100 (`_recomputeStats` relit les deux rythmes) |
| 2 — le type n'est pas au menu du `timing` | 11 | la reprise de `timing` en donnée, `category` comprise |
| dernier reliquat (`ARCH_020`, `ARCH_073`) | 2 | deux `timing` passés en `end_of_combat` |

⚠️ **Zéro est un instantané, pas une propriété.** Rien dans le jeu ne calcule ce
chiffre : il sort d'un script d'audit écrit à la main, rejoué à la demande. Les
21 ont vécu des mois sans que personne les voie, et un 22ᵉ écrit demain en admin
serait tout aussi muet. C'est **la** justification du moteur générique, et le
critère auquel le mesurer : un effet doit pouvoir dire qu'il ne fait rien.

⚠️ Mesuré sur `initial-data/`. Le catalogue **joué** vit dans `data/`, que
`bootstrap()` ne réécrit jamais et que l'admin édite à chaud : sur une
installation en service, l'audit ne vaut qu'après un `npm run sync:pull` — et
§0 dit ce qui arrive quand on oublie de regarder la date de ce dossier.

### 1.5 Les triggers qui existent déjà, sans porter ce nom

| Point de branchement | Où | Qui s'y accroche |
|---|---|---|
| entrée en préparation | `GameSession.startPreparation()` | pioche, `player_hand_modifiers`, `player_guaranteed_draws`, capture « Tout annuler » |
| invocation | `GameSession.place()` → `InvocationManager.summon` | mission `summon_performed` — **aucun effet** |
| lancement du combat | `GameSession.startCombat()` | `AttributeManager.applyStartOfCombat`, `applyBoardEffects`, terrain, horloges |
| chaque step | `CombatManager.step()` | jauges, DOT, pouvoirs |
| mort d'une unité | `CombatManager._checkDeaths` → `AttributeManager.onUnitNeutralized` | `stat_modifier` `on_ally_neutralized` / `on_enemy_neutralized` |
| pouvoir lancé | `CombatManager._firePower` | mission `power_triggered` — **aucun effet** |
| fin de combat | `GameSession.finishCombat()` → `AttributeManager.applyEndOfCombat` | `revive`, `draw_bonus`, `guaranteed_draw`, `board_slot_bonus`, `damage_multiplier_bonus`, `shopping_bonus`, vétérance |
| entrée en shopping | `GameController._startShopping` | `getShoppingMagies` (pertinence + rareté) |
| application d'une magie | 4 méthodes `applyMagie*` de `GameSession` | les 27 types |

**`fin de combat` est le timing le plus chargé du jeu** (6 des 10 types
d'attribut) et il ne figure pas dans la liste de triggers proposée.

### 1.6 Les cinq files d'« effets en attente », toutes écrites à la main

Un effet qui ne s'applique pas tout de suite a aujourd'hui sa propre file, son
propre point de consommation et sa propre règle de vidage :

| File | Posée par | Consommée par | Durée |
|---|---|---|---|
| `player_guaranteed_draws` | magie, attribut | `startPreparation` | 1 pioche |
| `player_hand_modifiers` | magie (`reduce_materials`, `remove_requirements`) | `startPreparation` | 1 pioche |
| `player_draw_sources` | magie, attribut, terrain | popup de pioche | 1 pioche (purement descriptif) |
| `dot_effects` / `burn_stacks` | pouvoir | `CombatManager` (2 horloges différentes) | le round |
| `player_damage_multiplier_bonus` | magie | `applyEndOfCombat` | la partie |

Cinq mécanismes pour une seule idée : **un effet qui vit plus longtemps que son
application**. C'est le premier candidat à la mutualisation.

---

## 2. Diagnostic — six constats

1. **Il n'y a pas un moteur d'effets, il y en a quatre**, et le mot commun
   (`stat_bonus`) masque trois règles différentes.
2. **Le vocabulaire n'est pas fermé** : 27 types de magie, dont 13 à un seul
   exemplaire. Ajouter une magie coûte du code à **six** endroits.
3. **Rien ne relie l'écriture à la lecture** : **21 effets livrés ne font rien**,
   par deux mécanismes distincts — une stat jamais relue (10) et un type absent
   du menu de son timing (11). Aucun des deux n'est détectable autrement qu'en
   lisant le moteur ligne à ligne.
4. **La pertinence est une table écrite à la main** (`MagieOffer`), et
   `CLAUDE.md` en documente déjà le piège : *« un type ajouté à `applyEffect`
   mais oublié dans `isMagieRelevant` disparaît silencieusement du jeu »*. Elle
   devrait se **dériver** de l'effet.
5. **La durée de vie d'un effet n'est écrite nulle part** — elle se déduit du
   registre choisi sur chaque site d'appel. C'est le point qui fait diverger un
   duel : le contrat PvP dit qu'un état permanent doit voyager, mais rien dans
   la donnée ne dit qu'un effet est permanent.
6. **Deux systèmes s'en sortent bien** (attribut, terrain) parce qu'ils ont
   1 lecteur, ~3 types et une durée unique. C'est la forme à généraliser, pas
   celle des magies.

---

## 3. La cible — le modèle proposé, et ce qu'il faut y ajouter

Le modèle de départ :

> ressources (Joueur, Board, Cimetière, Main, Shop, Carte, Unité) · phases
> (Préparation, Combat, Shop) · triggers · un **Effet** = un trigger + N
> **tâches** · une **tâche** = une cible + une action.

**Il est bon** : c'est la forme canonique d'un moteur d'effets (trigger →
tâches), et c'est ce qui manque aujourd'hui. Six choses lui manquent, et
chacune correspond à un endroit où le code actuel s'est déjà cassé.

### 3.1 Conteneur ≠ entité (et le CRUD ne vaut que pour l'un des deux)

Les sept « ressources » ne sont pas de même nature :

| | Ce que c'est | Actions qui ont un sens |
|---|---|---|
| **Conteneurs** : `joueur`, `main`, `board`, `cimetière`, `offre` | des **contenants** (le joueur contient ses compteurs) | `ajouter` · `retirer` · `déplacer` · `remplacer` |
| **Entités** : `unité`, `carte` | ce qui **vit dans** un conteneur | `modifier` · `poser_statut` · `retirer_statut` |
| **Sources** : `deck`, `catalogue` | des réserves en **lecture seule** | aucune — on y **sélectionne**, on n'y écrit jamais |

`ajouter/modifier/supprimer` est **exactement juste** sur les conteneurs et
**exactement faux** sur les entités : « modifier une unité » ne veut rien dire
tant qu'on n'a pas dit quel champ, de combien, et pour combien de temps.

⚠️ `Carte` n'est pas une ressource au même rang que `Main` : une carte n'existe
que **dans** une main, un deck, une offre ou le catalogue. Et `deck` /
`catalogue` doivent apparaître dans le modèle : cinq effets actuels en
dépendent (`shift_tier_*`, `draw_material`, `defuse_fusion`, `duplicate_*`).

### 3.2 Une cible n'est pas une ressource — c'est un sélecteur

`cible: unité` est sous-spécifié. Aujourd'hui la question « laquelle ? » est
posée dans sept endroits distincts (`target_attributes` du terrain,
`attributes.includes` de l'attribut, `magieUnitTargets` par type,
`magieHandTargets` par type, `_defusableFusions`, `_poweredUnits`,
`findAttackTarget`).

Un sélecteur, c'est cinq champs :

```
{
  conteneur : board | main | cimetière | offre | deck | catalogue
  camp      : allié | ennemi | les_deux          (défaut : allié)
  filtre    : <requête>                          (facultatif)
  combien   : 1 | N | tous                       (défaut : tous)
  choix     : automatique | joueur | plus_faible | aléatoire | le_plus_proche
}
```

**Suggestion forte : `filtre` réutilise `card-query.mjs`.** Le langage de
requête existe déjà, il est pur, sans import, partagé admin ↔ client, testé sur
le catalogue livré, avec autocomplétion et chips. Écrire
`filtre: "tier:4,5 ET attribut:ARCH_012"` donne **gratuitement** l'éditeur
d'admin, la grammaire, la négation et le OU. C'est le plus gros gain de ce
projet pour le plus petit coût — et ça ferme la porte à l'invention d'un second
langage.

⚠️ `choix: joueur` est un **champ**, pas une famille. Aujourd'hui le trio
`needsUnitTarget` / `needsGraveyardTarget` / `needsHandTarget` est une partition
exclusive et fragile (`CLAUDE.md` : *« un type reconnu par deux d'entre elles
n'atteindrait jamais la troisième branche »*). En faire un champ du sélecteur
fait disparaître les trois listes.

### 3.3 Une tâche doit dire sa DURÉE

C'est la dimension la plus importante, et elle est absente du modèle proposé.

```
durée : combat | round | partie
```

Elle détermine **seule** le registre d'écriture — ce qui est aujourd'hui décidé
à la main sur chaque site :

| `durée` | Registre | Effacé par |
|---|---|---|
| `combat` | `_stat_bonuses` | `resetCombatStats()` |
| `round` | registre d'effets actifs (n'existe pas encore) | fin de round |
| `partie` | `_base` + trace `_shopping_bonus` | rien |

Et c'est **le contrat PvP** : `durée: partie` ⇒ la donnée doit voyager dans
`round:board_ready`. Aujourd'hui c'est une discipline humaine ; là, ce serait
une propriété du schéma, vérifiable par un test unique.

### 3.4 Un effet doit pouvoir porter une CONDITION

`Effet = trigger + tâches` n'a pas de « si ». Or il y en a partout :

- seuil d'attribut (`count >= N`) — 53 attributs en vivent ;
- pertinence d'une magie (`MagieOffer`) — 27 branches ;
- pertinence d'un pouvoir (`_isPowerRelevant`) — 14 branches ;
- seuil de vétérance, cap partagé de slot, plafond `max` des pioches.

```
Effet = { trigger, condition?, tâches[] }
```

La condition utilise **la même requête** que les sélecteurs.

**Le gain majeur est ici** : une fois qu'une tâche déclare son sélecteur et son
delta, `pertinent(effet, état)` se **dérive** — « au moins une tâche a une cible
non vide et un delta non nul ». La table fermée de `MagieOffer` disparaît, et
avec elle le piège documenté du type oublié. `_isPowerRelevant` devient le même
calcul.

### 3.5 Le trigger a besoin d'une portée, et la liste est incomplète

Liste proposée, complétée par ce que le code exige déjà :

| Trigger | Existe aujourd'hui ? |
|---|---|
| `immédiat` | oui — c'est l'application d'une magie. ⚠️ Ce n'est pas un trigger, c'est l'**absence** de trigger : à garder, mais à nommer `à_l_usage`. |
| `début_préparation` | oui (`startPreparation`) — **manquant dans la liste** |
| `avant_pioche` / `après_pioche` | oui, mais **implicite** : les deux files sont consommées *dans* `startPreparation` |
| `à_l_invocation` | **n'existe pas** — et c'est le trigger n°1 d'un auto-battler. Le point de branchement existe (`GameSession.place`), il ne sert qu'aux missions. |
| `début_combat` | oui (`applyStartOfCombat`) |
| `allié_détruit` / `ennemi_détruit` | oui (`onUnitNeutralized`) |
| `pouvoir_utilisé` | point de branchement présent, **aucun effet** |
| `fin_combat` | oui — **le timing le plus chargé du jeu, manquant dans la liste** |
| `début_shop` | oui |
| `unité_blessée` / `avant_attaque` / `après_attaque` | n'existent pas ; à décider (section 7) |

Et chaque trigger a besoin d'une **portée**, sans quoi « allié détruit » est
ambigu :

```
portée : à_chaque_fois | une_fois_par_combat | une_fois_par_round | une_fois_par_partie
verrouillé : true|false   // le seuil est-il figé au début du combat ?
```

⚠️ `verrouillé` n'est pas un raffinement : c'est la règle actuelle des
`during_combat` (*« les morts en cours de combat ne désactivent pas les effets
déjà actifs »*). Sans le champ, elle redevient du code.

### 3.6 Un effet doit pouvoir POSER un effet

Les cinq files de la section 1.6 sont toutes ce cas. Dans le modèle cible, il
n'y en a plus qu'une : **un registre d'effets actifs**, où une tâche peut
inscrire un nouvel effet avec sa durée.

```
tâche: { action: 'poser_effet', effet: { trigger: 'après_pioche', tâches: [...] }, durée: 'round' }
```

`reduce_materials`, `guaranteed_draw`, le poison, la brûlure et le
multiplicateur permanent deviennent le **même** mécanisme.

⚠️ **Profondeur 1, jamais récursif.** Un effet peut poser un effet ; l'effet
posé ne peut pas en poser un autre. Sans cette borne, l'ordre de résolution
devient impossible à prouver identique sur deux clients PvP.

---

## 4. Le schéma cible

```jsonc
{
  "id": "EFF_001",
  "porteur": "MAGIE_012",              // qui l'apporte — carte, attribut, terrain, magie, pouvoir
  "trigger": { "quand": "fin_combat", "portée": "à_chaque_fois", "verrouillé": false },
  "condition": "unités:>=2 ET attribut:ARCH_012",
  "tâches": [
    {
      "cible": {
        "conteneur": "board", "camp": "allié",
        "filtre": "attribut:ARCH_012", "combien": "tous", "choix": "automatique"
      },
      "action": "modifier",
      "champ": "atk",
      "opérateur": "+",                // + | − | × | ÷ | =
      "valeur": 10,
      "durée": "combat"
    }
  ]
}
```

### 4.1 Le vocabulaire d'actions — table FERMÉE

**Sept actions.** Le reste est un champ typé.

| Action | Sur | Signature |
|---|---|---|
| `ajouter` | conteneur | `(conteneur, sélecteur_source, quantité)` |
| `retirer` | conteneur | `(sélecteur)` |
| `déplacer` | conteneur → conteneur | `(sélecteur, destination)` |
| `remplacer` | conteneur | `(sélecteur, sélecteur_source)` |
| `modifier` | entité \| joueur | `(sélecteur, champ, opérateur, valeur, durée)` |
| `poser_statut` | entité | `(sélecteur, statut, valeur, durée)` |
| `poser_effet` | — | `(effet, durée)` |

Champs modifiables, par ressource — **c'est ça, la partie « codée » incompressible** :

| Ressource | Champs |
|---|---|
| `joueur` | `pv` · `slots_board` · `multiplicateur` · `pioches` · `pioches_garanties` · `magies_shop` |
| `unité` | `atk` · `pv` · `pv_max` · `bouclier` · `vitesse_attaque` · `vitesse_déplacement` · `portée` · `initiative` · `pouvoir` · `vitesse_pouvoir` · `jauge` · `position` · `vétérance` |
| `carte` | `coût_matériels` · `exigences` |
| `board` | `case_bloquée` |
| `statuts` (unité) | `poison` · `brûlure` · `paralysie` · `confusion` · `provocation` · `blocage_pouvoir` · `immunité` |

### 4.2 Preuve : les 55 branches actuelles réécrites

| Aujourd'hui | Cible |
|---|---|
| `stat_bonus` · `team_stat_bonus` · `stat_modifier` (×3 porteurs, 6 implémentations) | `modifier(unité, stat, ±/×, durée)` — **1 action** |
| `shield` (×3) | `modifier(unité, bouclier, +)` |
| `heal` · `team_heal` | `modifier(unité, pv, +)` |
| `grant_power` · `power_cooldown` | `modifier(unité, pouvoir\|vitesse_pouvoir)` |
| `effect_immunity` | `poser_statut(unité, immunité, durée: combat)` |
| `revive` (×2, deux purges différentes) | `déplacer(cimetière→board)` + `modifier(pv, =%)` + `retirer_statut(tous)` |
| `destroy_unit` | `déplacer(board→cimetière)` |
| `drain_life` | `déplacer(board→cimetière)` + `modifier(joueur.pv, +)` |
| `defuse_fusion` | `retirer(board)` + `ajouter(board\|cimetière, sélecteur matériaux)` |
| `shift_tier_unit` · `shift_tier_card` | `remplacer(board\|main, sélecteur deck filtre:tier)` |
| `hand_to_graveyard` | `déplacer(main→cimetière)` |
| `duplicate_unit` · `duplicate_graveyard_unit` · `duplicate_card` | `ajouter(main, sélecteur, ×N)` — **une action, trois sélecteurs** |
| `draw_material` | `ajouter(main, sélecteur matériaux)` |
| `sacrifice_card_hp` | `retirer(main)` + `modifier(joueur.pv, +%)` |
| `draw_bonus` (×3) | `modifier(joueur.pioches, +)` |
| `guaranteed_draw` (×2) | `poser_effet(après_pioche → ajouter(main, sélecteur filtré), durée: round)` |
| `board_slot_bonus` · `player_hp_bonus` · `damage_multiplier_bonus` · `shopping_bonus` | `modifier(joueur.<champ>, +, durée)` |
| `reduce_materials` · `remove_requirements` | `poser_effet(après_pioche → modifier(carte, coût\|exigences, −))` |
| `POWER_PUSH` · `POWER_FREEZE` · `POWER_TELEPORT` | `modifier(unité.position)` + `modifier(board.case_bloquée, durée: round)` |
| `POWER_POISON` · `POWER_BURN` | `poser_statut(unité, poison\|brûlure, durée: round)` |
| `POWER_DEBUFF` | `retirer_statut(unité, tous)` |
| `POWER_HEAL` · `SHIELD` · `SUPER_ATTACK` · `AOE` | `modifier(unité, pv\|bouclier)` avec sélecteur |

**55 branches → 7 actions × ~30 champs typés.** Et surtout : les 3 gestes de
`stat_bonus` deviennent 1 geste + 1 champ `durée`, ce qui **supprime par
construction** les 10 effets morts de la section 1.3 ; le champ `trigger`,
porté par l'EFFET et non par son porteur, supprime les 11 de la section 1.4.

### 4.3 Ce qui n'entre PAS dans le moteur

Honnêteté sur le périmètre :

- **L'ordonnanceur de combat.** `CombatManager` décide *quand* un pouvoir part
  (jauge, pertinence, cible de `findAttackTarget`, ordre d'initiative). Ses
  **tâches** entrent dans le moteur ; sa **boucle** n'y entre pas. Vouloir les
  deux, c'est réécrire le cœur du déterminisme PvP pour un gain nul.
- **L'invocation.** `InvocationManager` est un système de **coût et de
  placement**, pas d'effet. Il ne bouge pas.
- **Le ciblage de combat.** `findAttackTarget` reste une politique de combat.
  Le sélecteur du moteur ne la remplace pas (`CLAUDE.md` : *« un pouvoir qui
  trie ses propres cibles serait une seconde politique de ciblage à tenir
  d'accord avec celle du déplacement »*).

---

## 5. Les invariants non négociables

Un moteur d'effets touche exactement ce que le déterminisme PvP protège. Cinq
règles à tenir **dès la première ligne**, pas après :

1. **Ordre total et absolu.** Deux clients doivent résoudre les mêmes tâches
   dans le même ordre. Tri par `(trigger, clé absolue du porteur, index de
   tâche)` — **jamais** l'ordre d'insertion. Précédent : le départage par
   `card_id` de l'ordre d'initiative.
2. **Un seul flux de hasard.** Le moteur prend `rand` en dépendance injectée,
   jamais `Math.random`. ⚠️ **Le nombre d'appels doit être stable** : les golden
   tests de `sim/` et le filet PvP en dépendent. Règle à copier de
   `BoardPicker` : *exactement un appel par tirage, aucun sur un pool vide*.
3. **`durée: partie` ⇒ la donnée voyage** dans `round:board_ready`. Soit le
   champ est dans la liste fermée du payload, soit le registre d'effets actifs
   voyage lui-même. À trancher **avant** d'écrire le schéma.
4. **Toute tâche portant une position passe par `BoardMirror`.** D'où : la
   position est un type distinct dans les payloads de tâche, pas un `{col,row}`
   anonyme — pour qu'on puisse la **trouver**.
5. **`logic/` n'importe pas `data/`.** Le moteur manipule des ids et rend des
   ids ; c'est la couche React qui nomme. Précédent : `DrawSourceEntry`.

---

## 6. Migration — comment y aller sans casser 1065 tests

**Ne pas réécrire.** Le projet a un filet rare : 1065 tests, des golden tests de
simulation, un filet de déterminisme PvP à 300 graines, et un **détecteur
d'équilibrage à 60 000 parties dont la ligne de base est historisée**. C'est
l'oracle de migration — il faut s'en servir, pas le contourner.

| Étape | Contenu | Fin quand |
|---|---|---|
| **0 — Geler** | Tests de caractérisation sur les 51 magies × 8 attributs types × 25 terrains. Aucun code de production touché. | La suite décrit le comportement actuel, **effets morts compris**. |
| **1 — Le moteur à côté** | Le moteur + un **compilateur** pur `magie \| attribut \| terrain → Effet[]`. Mode ombre : les deux chemins s'exécutent, on **compare**. Le geste de `CombatRecorder`, appliqué aux effets. | 100 % des effets livrés compilent et produisent le même état. |
| **2 — Bascule, par porteur** | **Terrain** (33 effets, 1 lecteur) → **attribut** (88 effets, 3 timings) → **magie** (51) → **tâches** de pouvoir. | À chaque bascule : `lint:all` + `test` verts **et la ligne de base du détecteur ne bouge pas**. |
| **3 — L'admin** | UN éditeur d'effet, partagé par les 4 onglets. Le filtre = `card-query.mjs`. | Un effet neuf s'écrit sans toucher au code. |
| **4 — Le contenu** | `à_l_invocation`, `pouvoir_utilisé`, les triggers qui n'existaient pas. | — |

⚠️ **Le détecteur est le juge de la bascule.** `CLAUDE.md` documente que la
ligne de base a fait un pas trois fois, chaque fois le jour d'un changement de
règle. Une bascule qui la fait bouger n'est pas une dérive : c'est une
régression, et on sait le jour même.

⚠️ **Une étape = un porteur = un commit qui passe.** Pas de branche longue : le
mode ombre de l'étape 1 est précisément ce qui permet de livrer par morceaux.

### 6.1 État de l'étape 0

**✅ TERRAIN FAIT** — `client/src/test/board-characterization.test.ts` : l'oracle
des 25 terrains livrés (effets, delta par unité des deux camps, pioches et leur
source) plus **six invariants de catalogue**, chacun une panne rendue
impossible à relivrer :

1. aucun `type` que `applyEffect` n'exécute ;
2. toute stat nommée **bouge quelque chose** sur l'unité — vérifié par une
   **sonde** qui pose le bonus et regarde, jamais par une table de noms
   recopiée : c'est la décorrélation écriture/lecture qu'on refuse de
   reproduire dans le test qui la surveille ;
3. tout attribut visé existe ;
4. toute case bloquée est dans les bornes, **et son miroir aussi** (contrat PvP) ;
5. le décompte de `TerrainAlert` est l'union exacte des unités touchées ;
6. aucun terrain ne crédite le camp adverse.

L'oracle observe les deux rythmes **en compteur et en période** (`*_rate` et
`*_period`) : un compteur qui monterait sans que la période bouge serait la
panne d'origine déplacée d'un cran.

**✅ MAGIES FAIT** — `magie-characterization.test.ts` : l'oracle des 51 magies
livrées (ce que chacune change, famille de ciblage et cible comprises) plus six
invariants de catalogue.

⚠️ L'oracle passe par une **vraie `GameSession`**, pas par `applyEffect` seul :
**11 des 23 types vivent dans la session** et non dans `MagieEffect` (les deux
duplications, les deux remplacements par tier, la main, le cimetière, les deux
remises de coût). Les figer depuis `applyEffect` aurait montré une moitié de
porteur — précisément la moitié que l'étape 1 devra absorber.

Un invariant y est neuf, et il ne vient pas du terrain : **un `grant_power`
chiffre sa DURÉE ou sa VALEUR selon le pouvoir donné, jamais l'autre.**
`card-contract.js` ne garde que les cartes ; côté magie, rien ne le vérifiait.
Un `grant_power POWER_PARALYSIS` écrit avec une `value` verrait sa durée
ignorée — l'unité retomberait sur le repli du moteur, et la magie promettrait
une paralysie qu'elle ne pose pas.

**✅ ATTRIBUTS FAIT** — `attribute-characterization.test.ts` : l'oracle
**palier par palier** des 57 attributs à seuils, plus sept invariants.

⚠️ C'est le porteur le plus riche des trois, et la seule raison en est le
`timing` : les mêmes huit types passent par **trois passes**, chacune n'en
exécutant qu'une poignée. L'oracle exerce donc chaque palier dans la passe que
son `timing` désigne — `applyStartOfCombat` d'abord pour les `during_combat`
(c'est lui qui **verrouille** les seuils), les deux déclencheurs dans un ordre
fixe, un mort de chaque côté pour la fin de combat.

Deux pièges de harnais y sont documentés parce qu'ils font figer un silence :
- **l'égalité de référence** de `_triggerStatModifiers`
  (`affectedUnits === this.playerUnits`) — un tableau neuf portant les mêmes
  unités lit le cache du camp adverse et ne déclenche rien ;
- **`value_per` ne nomme pas l'attribut porteur** mais un autre (`ARCH_016`
  multiplie par les ennemis portant `ARCH_003`) : un casting qui ne peuple le
  camp adverse que de porteurs de l'attribut testé rend un multiplicateur nul,
  et `applyStartOfCombat` sort sur `if (bonus === 0) break`.

⚠️ **Un piège de DONNÉE trouvé au passage, et il est à un clic** : le `<select>`
de l'admin propose `active_unit` (« unités alliées vivantes ») comme `value_per`
sur n'importe quel type d'effet. Or **seul `stat_bonus` lit `value_per`**, et il
y attend un **id d'attribut** : `active_unit` ne désignant aucun attribut, le
multiplicateur vaudrait 0 et le bonus serait **nul, en silence**. Les trois
paliers d'`ARCH_023` (Elfe) le portent déjà — mais sur un `shield`, qui ignore
`value_per` de bout en bout et multiplie toujours par le nombre d'alliés
vivants. Le champ y est décoratif et le résultat se trouve être celui qu'il
annonce ; c'est pour ça que rien ne se voit. Un invariant ferme la porte côté
`stat_bonus`.

**L'étape 0 est terminée pour les trois porteurs du POC.** Les pouvoirs restent
hors périmètre (décision 2 du §7).

### 6.2 État de l'étape 1 — le moteur à côté

**✅ TERRAIN FAIT.** Trois modules dans `logic/effects/`, plus le mode ombre :

| Module | Rôle | Ce qu'il ne fait PAS |
|---|---|---|
| `types.ts` | le schéma et ses **tables fermées** (8 `quand`, 7 actions, 3 durées, les champs typés d'unité et de joueur) | aucune logique, aucun état |
| `compile.ts` | `terrain → Effet[]`, **pur** | n'applique rien |
| `engine.ts` | exécute des `Effet[]` | ne connaît **aucun porteur** |

Trois propriétés portent tout le reste :

1. **Le moteur ignore les porteurs.** Il reçoit des effets compilés. Un porteur
   de plus est un compilateur de plus, jamais une branche de plus dans le
   moteur — c'est précisément ce que les quatre moteurs actuels ne savent pas
   faire.
2. **Le compilateur REFUSE, il ne se tait pas.** Un effet qu'il ne sait pas
   traduire sort dans `CompilationResult.refus`, nommé. C'est la différence de
   fond avec les `switch` d'aujourd'hui, dont chaque `default` est muet — la
   mécanique exacte des vingt-et-un effets morts.
3. **La durée choisit le registre.** `combat` → `_stat_bonuses`, `partie` →
   `_base` (§5.3). Les trois gestes écrits à la main sur chaque site d'appel
   deviennent une **donnée** ; il n'y a plus de site d'appel où se tromper.

**Les quatre types de terrain se réduisent à UNE action, `modifier`** — ce qui
les distinguait n'était pas le geste mais le champ visé et l'opérateur. La
démonstration en petit de ce que vaut le §4.2.

**Le mode ombre** (`effects-shadow.test.ts`) exécute les deux chemins sur le
même monde et compare **l'état**, jamais la forme des tâches : deux chemins qui
écrivent le même état par des routes différentes sont d'accord. Critère
d'acceptation tenu — **zéro refus et zéro écart sur les 25 terrains livrés**.

⚠️ **Les 25 terrains ne suffisaient pas, et c'est le vrai enseignement de
l'étape.** Le catalogue ne porte que `stat_bonus` (31×) et `shield` (2×) :
`stat_modifier` et `draw_bonus` sont **codés des deux côtés et exercés par
aucun**. Le mode ombre joué sur le seul catalogue ne prouvait donc que la
moitié du compilateur — vérifié en mutant `stat_modifier` en additif, qui ne
faisait tomber **aucun** test. D'où un second bloc de terrains **synthétiques**,
qui ferme les quatre branches, dont le cumul de deux multiplicateurs (×3 et non
×4) et l'inscription au registre de provenance des pioches.

⚠️ **Un cas de test a dû être réécrit pour la même raison** : celui de l'ordre
de résolution comparait deux ensembles triés — donc à lui-même — et ne tombait
sur aucune mutation. Il compare maintenant la **séquence de la trace**, pas
l'état : sur le terrain tout est additif, donc l'état ne dépend pas de l'ordre
et ne peut rien prouver. Le jour où une tâche non commutative arrivera (`=`,
`remplacer`, une position), l'état en dépendra — et il serait trop tard pour
s'en apercevoir alors.

**✅ ATTRIBUTS FAIT** — `effects-shadow-attributes.test.ts`, un cas par
**palier** (106 cas). C'est le porteur qui a produit onze des vingt-et-un effets
morts, et le schéma les supprime **par construction** :

⚠️ **Le `quand` est dérivé du TYPE de l'effet, jamais du `timing` de son
porteur.** Un `revive` est de fin de combat où que son attribut prétende vivre.
Le `timing` déclaré ne sert plus qu'à **vérifier** — et le désaccord, qui était
un silence, est devenu un refus nommé (`timing incohérent`, avec les deux
moments en clair). Éprouvé : remettre `ARCH_020` sous `start_of_combat` fait
rougir trois cas au lieu de ne rien faire.

Trois choses que le mode ombre a forcé à écrire noir sur blanc, parce que les
deux chemins divergeaient tant qu'elles restaient implicites :

1. **Le moteur tourne une fois PAR CAMP.** Un attribut profite à qui le
   **porte**, des deux côtés — ce n'est pas un effet « allié », c'est un effet de
   porteur. Un sélecteur `les_deux` ne suffit pas : `parAttributAdverse` lit « le
   camp d'en face », qui n'a pas le même sens selon le côté d'où l'on part.
2. **Une mort déclenche les DEUX triggers, un par camp** : le camp du mort reçoit
   `allie_detruit`, celui d'en face `ennemi_detruit`. N'en jouer qu'un laisse la
   moitié des porteurs muets — et c'est invisible, puisque l'autre moitié réagit
   normalement.
3. **Le camp adverse ne reçoit que la PIOCHE** (`Monde.ressourcesLimitees`,
   le `resources: false` d'aujourd'hui). Asymétrie assumée, reproduite parce que
   le critère est « zéro changement observable » ; c'est la décision 3 du §7 qui
   la lèvera à l'étape 4, et elle deviendra alors un `camp` comme un autre.

⚠️ **Le schéma a gagné un champ en route : `condition`.** Le compilateur émet
**tous** les paliers d'un attribut ; c'est la condition qui dit lequel
s'applique. Sans elle, un effet compilé ne saurait pas dire à quel palier il
appartient et il faudrait le redemander à la donnée — donc se donner deux
sources pour une même question. La règle « un seul palier actif, le plus élevé
atteint » reste celle d'`AttributeManager` et vit dans `attributes.test.ts`.

⚠️ **Et la même leçon que le terrain, une seconde fois** : le catalogue
n'exerce que 8 des 10 types codés (`board_slot_bonus` et `shopping_bonus` sont
orphelins), et son unique plafond `max` ne mord jamais. Vérifié en retirant le
plafond du compilateur — **aucun cas ne tombait**. D'où un second bloc
d'attributs synthétiques. **C'est désormais un réflexe à avoir pour chaque
porteur : mesurer ce que le catalogue exerce AVANT de croire le mode ombre.**

**✅ MAGIES FAIT — 50 des 51.** `effects-shadow-magies.test.ts` : chacune
produit le même état qu'une vraie `GameSession`. La 51ᵉ est **refusée
nommément**, et la frontière est figée par un test.

Les trois mécanismes que le §6.4 chiffrait ont été écrits, chacun pour une
raison différente :

| Mécanisme | Pourquoi il a été jugé rentable |
|---|---|
| actions de **conteneur** (`ajouter`, `retirer`, `deplacer` généralisé) | le geste « une entité change de conteneur » se répète dans 7 magies **et** reviendra à chaque famille suivante — c'est du vocabulaire, pas un cas |
| **pool injecté** (`TacheRemplacer` + `Monde.pool`) | le moteur **demande** des candidats pour un usage, il ne connaît ni deck ni catalogue — la dep suit `deps.rand` |
| **champs de CARTE** (`cout_materiels`, `exigences`) | remplace l'effet différé (voir juste en dessous) |

⚠️ **Le troisième n'a pas été écrit : la RÈGLE a changé.** Les deux remises
d'invocation étaient différées d'un tour, appliquées à la première carte
retouchable venue par `player_hand_modifiers`. Elles sont désormais
**immédiates et ciblées** : le joueur désigne la carte, comme pour les cinq
autres magies de main. Cela supprime la cinquième file d'effets en attente du
§1.6, `GameState.player_hand_modifiers`, le bloc différé de `startPreparation()`
et le type `HandModifier` — et, au passage, la pertinence se lit maintenant sur
la **main** et non plus sur le deck, ce qui est la vraie question. **Un
mécanisme retiré du moteur parce que la règle qu'il servait était mal posée vaut
mieux qu'un mécanisme bien écrit.**

Ce qui reste dehors est **`defuse_fusion`, et seulement lui** : il ne lit pas un
champ, il lit une **règle d'invocation** (la lignée d'un composite, et le repli
au cimetière quand il n'y a plus de case). Le traduire demanderait de donner
`InvocationManager` au moteur, c'est-à-dire de recopier la règle du doublon.

⚠️ **La comparaison d'état ne voit PAS le flux de hasard**, et c'est le seul
endroit du moteur qui en consomme. Deux chemins qui tirent le même remplaçant
s'accordent quel que soit le nombre d'appels dépensés pour y arriver — or c'est
le nombre qui compte, le flux étant partagé avec la pioche, l'IA et le tirage du
terrain. D'où deux cas qui **comptent les appels**, sur la règle de
`BoardPicker` au mot près : *exactement un par tirage, AUCUN sur un pool vide*.
Les deux tombent sur leur mutation.

⚠️ **Une branche du moteur a été retirée plutôt que gardée** : `retirer` sur le
board. Aucun compilateur n'en émet (une unité qui quitte le board part toujours
quelque part, donc `deplacer` ou `remplacer`), donc rien ne la prouvait — la
neutraliser ou non ne faisait tomber aucun cas. Elle est devenue un `ignore`
nommé : le jour où un compilateur en émettrait une, l'exécution la dit au lieu
de faire un geste que personne n'a éprouvé.

Deux choses trouvées en chemin, qui manquaient au compilateur :

- **Le contrecoup (`cost_hp`) est une TÂCHE, et elle part en premier.** Champ de
  premier niveau, orthogonal au type d'effet, que les quatre chemins
  d'application prélèvent — **avant** l'effet, faute de quoi `drain_life`
  financerait son propre contrecoup. Une liste de tâches est résolue dans
  l'ordre ; le mettre en tête est la seule façon de le dire. La garde
  d'accessibilité l'accompagne toujours (`condition.pvJoueurSuperieurA`) : une
  magie impayable ne s'applique pas **du tout**, elle n'ampute rien au passage.
- **`pv` (le maximum) et `pv_courant` (la jauge) sont deux champs.** Un
  `stat_bonus hp` monte le socle *et* la jauge ; un `heal` ne touche que la
  jauge. Un seul nom rendrait l'un des deux gestes inexprimable.

### 6.4 Le compilateur de magie : ce que la mesure a servi à décider

Le §1.1 l'annonçait, l'étape 1 l'a chiffré : **côté magies, un type d'effet ≈ une
intention de design ≈ une carte.** 13 des 23 types ne portent qu'UNE magie. La
mesure a été posée ainsi — 36 magies traduites d'emblée, 15 demandant trois
mécanismes neufs — précisément pour que le choix se fasse sur des chiffres et
non sur une intuition d'architecture.

**Décision prise : aller au bout, mais pas comme prévu.** Deux des trois
mécanismes ont été écrits parce que ce sont du **vocabulaire** (ils reviendront
à chaque famille suivante), pas des cas particuliers. Le troisième — les effets
différés — n'a pas été écrit : la règle qu'il servait a été **changée**, et les
deux remises sont devenues immédiates et ciblées (§6.2).

Le résultat se lit dans ce qui a **disparu** autant que dans ce qui est apparu :

| Retiré | Où |
|---|---|
| `GameState.player_hand_modifiers` — la 5ᵉ file du §1.6 | `GameState.ts` |
| le bloc différé de `startPreparation()` | `GameSession.ts` |
| le type `HandModifier` | `logic/types.ts` |
| les deux branches de `applyEffect` correspondantes | `MagieEffect.js` |
| la pertinence lue sur le DECK au lieu de la MAIN | `MagieOffer.ts` |

⚠️ **La leçon est de méthode, et elle vaut pour les étapes suivantes** : avant
de se donner un mécanisme pour reproduire un comportement, vérifier que le
comportement mérite d'être reproduit. Le différé n'avait aucune raison de
design — il venait de ce que la remise ne savait pas désigner de cible.

**Puis la bascule (étape 2).**

### 6.5 État de l'étape 2 — la bascule

**✅ TERRAIN BASCULÉ.** `BoardEffect.applyBoardEffects` **est** désormais
`compileBoard` + `executer`. Le `switch` de quatre `case` a disparu du fichier,
qui garde la **lecture** de la donnée (`boardEffects`, `effectTargets`) — que
l'UI, `BoardPicker` et l'annonce de terrain partagent — et perd l'exécution.

Deux conséquences qui ne se devinent pas :

- **La conversion du multiplicateur a changé de couche.** Elle vivait dans
  `applyEffect` (`_base[stat] × (value − 1)`) ; le compilateur garde maintenant
  l'INTENTION (`operateur: '*'`) et c'est le moteur, seul à connaître les
  registres, qui traduit. Un opérateur de plus ne se réécrira donc pas à chaque
  porteur.
- **`applyBoardEffects` REND ses refus** au lieu de se taire. Un effet nommant
  une stat que `_recomputeStats` ne relit pas — la première famille d'effets
  morts du §1.4 — est désormais un refus nommé, disponible pour qui veut le
  lire. ⚠️ Pas de `console.warn` : `logic/` n'en contient aucun, et ce n'est pas
  au moteur de décider comment une panne de donnée se raconte.

**Comment on a prouvé que c'était un no-op**, et c'est la méthode pour les
porteurs suivants :

1. **Le snapshot de `board-characterization.test.ts` n'a pas bougé d'un
   caractère.** Il a été enregistré contre l'ANCIEN chemin, à l'étape 0 ; il
   garde le nouveau. C'est le seul artefact qui survit à la disparition d'un
   chemin — et c'est pour ça que l'étape 0 précédait tout le reste.
2. **Le détecteur rend un rapport IDENTIQUE**, horodatage mis à part : 1 200
   parties semées sur les 953 cartes de `data/`, avant et après. ⚠️ **1 200 et
   non 60 000, et ce n'est pas une économie** : une bascule censée ne rien
   changer se juge par un diff DÉTERMINISTE, pas par une comparaison de lignes
   de base. La puissance statistique sert à comparer deux jeux différents ; ici
   on prouve que c'est le même, et un seul écart suffirait à le dire.
3. **Seize mutations** — sept sur le compilateur, deux sur le moteur, sept sur
   les conteneurs — toutes rouges, et toutes attrapées par au moins un test qui
   **survit à la bascule**.

⚠️ **Un mode ombre est CONSOMMÉ par sa propre bascule.** Une fois
`applyBoardEffects` devenu le chemin compilé, `effects-shadow.test.ts`
comparait le moteur à lui-même : ses deux `it.each` de comparaison d'état ont
été retirés, et le fichier ne garde que ce qui prouve encore quelque chose (la
compilation, les invariants du schéma, et un **snapshot** des deux branches que
le catalogue n'exerce pas). **Le laisser vert sans le relire aurait été pire que
de le supprimer** : un test vacieux occupe la place de celui qui prouverait
quelque chose, et sa couleur ne dit rien de ce qu'il couvre.

⚠️ **Une doublure de test a dû devenir une vraie `Unit`.** `board-alert.test.ts`
comptait les appels à `applyStatBonus` sur un objet duck-typé ; le moteur
demande en plus `isAlive()` et `_base`. Maintenir la doublure serait tenir une
seconde implémentation de ce qu'on mesure — elle a été remplacée par de vraies
unités dont on lit le **bonus posé**, ce qui est de toute façon un témoin plus
juste que le nombre d'appels. ⚠️ Le filtre `isAlive()` n'est PAS un changement
de comportement : le seul appelant de production lui passe déjà
`getLivingUnitsOnSide`.

**✅ ATTRIBUT BASCULÉ.** `AttributeManager` ne garde plus que les **seuils** —
quel palier est actif, sur quel camp — et les trois passes appellent le moteur.
C'est le partage visé : le compilateur émet tous les paliers, cette classe
choisit, le moteur applique.

Le moteur a gagné **un champ pour cette bascule, et un seul** : `Trace.ecritures`,
le journal des écritures de stat. Deux besoins l'exigeaient, tous deux venus
d'`AttributeManager` : **`reapplyBonuses`** (`POWER_DEBUFF` appelle
`resetCombatStats()` en plein combat, il faut savoir quoi remettre) et les
**événements `stat_change`** que `CombatManager` relaie à l'animateur. Les
dériver après coup demanderait de comparer deux états, donc de réinventer ce que
le moteur vient de faire — seul celui qui a écrit sait ce qu'il a écrit.

⚠️ **Deux écarts observables, tranchés par l'auteur du jeu, pas par le
refactor.** Contrairement au terrain, la bascule des attributs n'est PAS un
no-op : ligne de base **12,78 % → 12,85 %**, |Δwinrate| médian **0,39 pt** sur
les cartes significatives (max 1,44 pt), 74 → 72 significatives (8 000 parties,
même graine, `data/`).

1. **Un bonus `during_combat` sur ATQ ou PV ne s'efface plus en plein combat.**
   `Unit.applyStatModifier` écrivait `this.atk = atk + v` **directement sur la
   stat effective**, hors registre — or `atk` est recalculé depuis
   `_base` + `_stat_bonuses` à chaque `_recomputeStats()`, donc le bonus
   disparaissait au premier bonus suivant sur la même unité. C'est la panne déjà
   corrigée pour les rythmes (`ARCH_045` Volant, cf. `Unit.ts`), restée sur ATQ
   et PV. Le moteur écrit tout `duree: 'combat'` dans `_stat_bonuses`, donc le
   bonus tient. ⚠️ **La remise à zéro de fin de combat, elle, ne change pas** :
   `finishCombat` appelle `resetCombatStats()` sur tous les participants, avant
   comme après. Cinq attributs : `ARCH_018`, `ARCH_033`, `ARCH_043`, `ARCH_046`,
   `ARCH_061`.
2. **L'ordre des effets de fin de combat devient ABSOLU.** Il suivait l'ordre
   d'apparition des attributs sur les unités du camp — donc la disposition du
   plateau ; il suit maintenant `cleDeTri` (§5.1). Les mêmes effets ont lieu,
   dans un autre ordre, et chaque pioche garantie consomme un tirage : c'est
   **cela seul** qui décale le flux semé et fait bouger le détecteur. Aucun des
   deux ordres n'est « juste », mais le nouveau ferme une divergence PvP
   latente : deux `revive` à `hp_percent` différents rendaient des PV
   différents selon l'ordre, et l'ordre d'avant dépendait côté adversaire du
   plateau **reconstruit**, qui n'a aucune raison d'être celui du propriétaire.

⚠️ **Un resserrement de contrat, mesuré et assumé** : un `value_per` qui ne nomme
aucun attribut **connu** ne compile plus (c'est la garde contre `active_unit`).
En jeu, `attributeList` est toujours le catalogue entier, donc le cas ne se
présente pas ; il n'a mordu que sur une fixture de test synthétique et partielle.

⚠️ **Deux gardes qui se couvrent, donc aucune prouvable seule.** La règle « le
camp adverse ne reçoit que la pioche » est tenue **deux fois** : par
`Monde.ressourcesLimitees` (le moteur n'accumule pas) et par le versement
(l'appelant ne lit pas ces champs sur l'accumulateur adverse). Retirer l'une des
deux ne fait tomber aucun test ; les retirer **ensemble** fait rouge. Ce n'est
pas un défaut — c'est la propriété d'une double garde, et elle mérite d'être
écrite, parce qu'une mutation isolée y donne un faux négatif.

⚠️ **Et le mode ombre des attributs a été consommé à son tour** — même geste
que pour le terrain, même raison. Mais cette fois **la perte a été mesurée
avant de retirer quoi que ce soit** : sur huit mutations du compilateur
d'attribut, **sept restent rouges sans lui** (l'oracle de l'étape 0,
`attributes.test.ts`, les goldens, le filet PvP). La huitième — le `quand`
dérivé du `timing` du porteur au lieu du TYPE, c'est-à-dire la panne des onze
effets morts — n'est attrapée que par ce fichier, parce qu'aucun attribut livré
ne l'exerce. Elle vit dans le bloc « ce que le schéma rend impossible », qui ne
compare rien : elle reste, et le fichier avec.

⚠️ **Une leçon sur ce que l'oracle de l'étape 0 NE couvre PAS.** Le snapshot des
57 attributs n'a pas bougé d'un caractère à la bascule — alors que deux
comportements ont changé. Ce n'est pas une contradiction : l'oracle exerce **un
palier à la fois**, donc il ne peut voir ni l'ordre entre deux attributs, ni la
durabilité d'un bonus à l'intérieur du combat. Les deux écarts n'ont été vus
**que par le détecteur**. C'est la justification du §6, « le détecteur est le
juge de la bascule », rendue concrète : une suite verte n'est pas une preuve de
no-op, elle est une preuve sur ce que la suite sait regarder.

**Reste à basculer** : magie (51), puis les tâches de pouvoir.

### 6.3 Ce que l'étape 1 a appris sur la façon de prouver

**Six fois sur trois porteurs**, un test qui semblait probant ne l'était pas :

| Ce qui semblait couvert | Ce qui l'était vraiment | Comment on l'a su |
|---|---|---|
| les 4 types de terrain | 2 (`stat_bonus`, `shield`) | muter le multiplicateur ne faisait rougir personne |
| les 10 types d'attribut | 8, et aucun plafond | retirer le plafond ne faisait rougir personne |
| l'ordre de résolution | rien (le cas comparait un ensemble trié à lui-même) | retirer le tri ne faisait rougir personne |
| le REGISTRE d'écriture d'une magie | rien (les deux rendent la même stat effective) | muter `partie` en `combat` ne faisait rougir personne → d'où l'observation **après `resetCombatStats()`** |
| les 5 remises d'invocation | rien (aucune carte de la main ne portait l'attribut visé, les deux chemins s'accordaient sur un SILENCE) | leur donner une cible a fait rougir les 5 |
| la discipline d'appel à `rand` | rien (l'état ne dépend pas du nombre d'appels) | d'où deux cas qui **comptent** les appels |

⚠️ **Le piège qui revient le plus souvent n'est pas une branche non couverte,
c'est un SILENCE partagé.** Quand le monde d'essai ne donne pas de cible à un
effet, les deux chemins ne font rien — et ne rien faire à l'identique est un
accord parfait. Cinq fois sur trois porteurs. Le réflexe : pour chaque famille,
**vérifier que la trace du chemin compilé n'est pas vide** (le cas « le chemin
compilé écrit vraiment quelque chose »), et non se fier à la couleur.

**La mutation n'est pas une formalité de fin de course : c'est elle qui dit ce
qu'un test couvre.** Un mode ombre vert sur un catalogue qui n'exerce que la
moitié des branches est un mode ombre qui ne prouve que la moitié — et rien dans
sa couleur ne le dit.

Ordre choisi à dessein : le terrain a **1 lecteur et 3 types**, c'est le
prototype le moins risqué ; les pouvoirs viennent en dernier parce qu'ils sont
dans la boucle de combat, là où une divergence coûte un duel aux deux joueurs.

---

## 7. Ce qu'il faut trancher avant de coder

1. ~~**Le but.**~~ **TRANCHÉ : unifier la dette d'abord, écrire du contenu
   ensuite.** Quatre conséquences, toutes structurantes :
   - **Le critère d'acceptation de l'étape 2 devient « zéro changement
     observable ».** Le détecteur d'équilibrage passe d'utile à **non
     négociable** : c'est le seul instrument qui sache dire qu'une bascule n'a
     rien changé.
   - **Le moteur doit exprimer 100 % de l'existant avant qu'une seule bascule
     ait lieu** — les 4 types sans magie et les 21 effets morts compris. Donc
     la question 4 ci-dessous se tranche à l'**étape 0**, pas à l'étape 4 : on
     ne compile pas un effet qui n'a pas de sémantique.
   - **Aucun trigger neuf avant la fin de l'unification.** `à_l_invocation` et
     `pouvoir_utilisé` n'ont aucun effet existant à porter ; les ajouter en
     cours de route mélangerait « le comportement n'a pas changé » et « voici
     du contenu neuf », c'est-à-dire perdrait l'oracle.
   - **Corollaire heureux : le schéma de départ est plus PETIT.** Il n'a besoin
     que des triggers et des actions que l'existant exerce réellement. Tout le
     reste de la section 3.5 attend l'étape 4.
2. ~~**Les pouvoirs entrent-ils ?**~~ **TRANCHÉ : hors POC.** Le POC porte sur le
   **terrain seul**. Les pouvoirs ne sont ni compilés ni basculés ; leur
   ordonnanceur (`CombatManager`) n'est pas touché.
3. ~~**L'IA porte-t-elle des effets ?**~~ **TRANCHÉ : oui, comme un vrai joueur.**
   Le sélecteur `camp` existe donc dès le premier schéma, et
   `_applyEndForSide(resources: false)` est appelé à disparaître.
   ⚠️ **Mais c'est un changement de comportement**, donc il ne peut pas atterrir
   pendant les étapes 0 à 2, dont le critère est « zéro changement observable » :
   aujourd'hui `enemy_board_slots` existe sans qu'aucun effet ne le crédite, et
   `enemy_multiplier` n'a aucune voie de bonus. **Le moteur doit savoir
   l'exprimer dès le départ ; le branchement se fait à l'étape 4**, et il se
   mesure au détecteur comme n'importe quel changement d'équilibrage.
4. ~~**Les effets morts**~~ **TRANCHÉ — et soldé en donnée : 21 → 0**
   (§1.4 bis). La bascule vers l'échelle 0–100 a emporté la famille « stat
   jamais relue », la reprise de `timing` a emporté la famille « mauvais
   timing » (`category` comprise), et les deux derniers reliquats sont passés
   en `end_of_combat`. **L'étape 0 n'est plus bloquée par rien.**
   ⚠️ Ce que l'épisode laisse au moteur générique, et c'est le seul point à en
   retenir : les 21 ont été trouvés **par un audit écrit à la main**, et
   réparés **un par un**. Rien dans la suite ne les voyait ; rien ne verrait le
   22ᵉ. Le zéro d'aujourd'hui est un instantané, pas une garantie — la garantie,
   c'est le moteur qui doit la porter. Un effet doit pouvoir dire qu'il ne fait
   rien : c'est le §2 en une phrase, et le critère d'acceptation de l'étape 1.
5. ~~**Registre d'effets actifs dans le payload PvP**~~ **TRANCHÉ : il voyage.**
   `durée: round` devient donc exprimable en duel. Trois contraintes qui en
   découlent, à tenir dès le premier schéma :
   - le registre est **ordonné par une clé absolue**, jamais par ordre
     d'insertion (précédent : le départage par `card_id` de l'initiative) ;
   - ses entrées ne portent **que des ids et des valeurs**, jamais une
     référence d'objet ni un `uid` (cf. le contrat : l'`uid` n'a aucune valeur
     commune aux deux clients) ;
   - toute entrée portant une **position** passe par `BoardMirror`.
6. **Combien de triggers au lancement ?** *Recommandation : les 9 qui ont déjà
   un point de branchement. `unité_blessée` et `avant/après_attaque` sont du
   contenu neuf — ils attendent l'étape 4.*

---

## 8. Ce qu'il ne faut PAS faire

- **Pas de langage de script, pas d'évaluateur d'expression.** Le vocabulaire
  reste une **table fermée**, comme `MagieOffer` (*« `default: false` — la table
  est FERMÉE, et c'est délibéré »*). Un moteur d'effets qui devient un langage
  ne se teste plus, ne se prouve plus déterministe, et ne s'édite plus en admin.
- **Pas de second langage de requête.** `card-query.mjs` existe.
- **Pas de « big bang ».** Le mode ombre, ou rien.
- **Pas de généralisation du ciblage de combat.** Deux politiques de ciblage à
  tenir d'accord, c'est le bug qu'on n'attrape jamais.
