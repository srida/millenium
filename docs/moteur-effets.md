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

**Restent les magies et les attributs.** Le terrain était le prototype ; la
forme se transpose telle quelle.

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
