# Brief – Progression, Missions et Économie

> Document de design canonique. Complète le GDD Millenium (sections à insérer après §15).
> Statut : proposition de V1, chiffres à valider en playtest.

---

## 1. Principes directeurs

1. **Une seule progression principale.** Le niveau joueur et la collection portent la progression ; le ladder ne porte que le prestige. Les deux ne doivent jamais se disputer le temps du joueur.
2. **Monnaie unique de dépense.** Les **golds** achètent tout : pack, craft, cosmétiques. Aucune monnaie de saison, aucune poussière, aucun jeton parallèle. Les **gemmes** restent une monnaie d'accélération, jamais une monnaie obligatoire.
3. **L'engagement paie, pas la performance.** L'XP et les golds récompensent le fait de jouer. La victoire est un accélérateur (×1.5 à ×2), jamais une condition.
4. **Le joueur arbitre ses dépenses.** Toute récompense est fongible ; c'est lui qui décide entre une carte, un pack et un cosmétique.
5. **Progression identique en ligne et hors ligne.** Le hors-ligne est une voie complète, simplement moins rentable en golds.

---

## 2. Ressources joueur

| Ressource | Source | Usage | Règle |
|---|---|---|---|
| **Niveau** | XP | Débloque paliers de récompense et fonctionnalités | Jamais de perte, jamais de reset |
| **XP** | Missions, parties, saison | Monte le niveau | Indexée sur l'engagement |
| **Golds** | Missions, parties, niveaux, saison, doublons | Pack, craft, cosmétiques | Monnaie unique de dépense |
| **Gemmes** | Paliers de niveau, achat réel | Conversion en golds, cosmétiques exclusifs, passe | **Jamais requises pour une carte** |
| **Cartes** | Pack, craft, paliers | Deckbuilding | Les doublons se reconvertissent en golds |

**Règle d'or gemmes :** aucun contenu de gameplay n'est jamais exclusif aux gemmes. Un joueur F2P doit pouvoir atteindre 100 % de la collection. Les gemmes achètent du **temps** et de l'**apparence**, jamais du **pouvoir**.

---

## 3. Architecture des missions quotidiennes

### 3.1 Structure

- **3 missions actives**, reset à 5h00 heure locale.
- **Accumulation jusqu'à 3 jours** (9 missions en attente maximum). Un joueur absent en semaine retrouve de quoi faire le week-end.
- **1 reroll gratuit par jour** ; rerolls supplémentaires à 100 golds. Jamais en gemmes — on ne monétise pas la frustration.
- **Difficulté échelonnée par slot** :
  - Slot 1 (facile) — validable en 1 partie
  - Slot 2 (moyen) — 2 parties
  - Slot 3 (engagé) — 3 à 4 parties maximum, **jamais plus**

### 3.2 Calibration temporelle

Un tour ≈ 70 s (30 s préparation + ~25 s combat + ~10 s shopping) → **une partie complète = 4 à 6 minutes**.

Cible : 3 missions ≈ 3 à 5 parties ≈ **20 minutes de session quotidienne**. Au-delà, le taux de complétion s'effondre et le rituel devient corvée.

### 3.3 Garde-fous

| Risque | Parade |
|---|---|
| **Concede-farm** (abandon au tour 1 pour enchaîner) | Une partie n'est comptabilisée qu'à partir du **lancement du 2ᵉ combat**. En deçà : aucune mission, aucun gold, aucun XP, pour les deux joueurs. |
| **Dépendance à l'adversaire** | Toute mission de slot obligatoire porte sur des actions **contrôlées par le joueur** (invoquer, fusionner, atteindre un palier). Les objectifs dépendant de l'adversaire (neutralisations, dégâts subis) sont réservés aux bonus. |
| **Farm hors-ligne** (IA plus tendre) | Progression de mission strictement identique, mais **prime de duel ×1.5 sur les golds** en partie en ligne. |
| **AFK** | Zéro invocation sur toute la partie = aucune récompense. |
| **Mission irréalisable** | Filtrage par collection possédée (voir `requirements`, §4.2). |

### 3.4 Répartition naturelle en ligne / hors ligne

Aucune restriction n'est imposée, mais les familles se répartissent d'elles-mêmes :

- **Familles A, B, D** (présence, mécanique, shopping) — se valident naturellement en duel live.
- **Famille C** (synergies, attribut, paliers Platine) — imposent un deck sous-optimal ; le hors-ligne devient le bac à sable où les valider sans dégrader la qualité du ladder.

---

## 4. Catalogue de missions

### 4.1 Familles

**A — Présence** *(filet de sécurité, toujours faisable)*
- Terminer N parties
- Jouer une partie jusqu'au tour 5
- Lancer un combat dans un mode quelconque

**B — Exécution mécanique** *(cœur du système, exploite le vocabulaire du jeu)*
- Réussir une invocation par Fusion / Héritage / Transformation
- Invoquer N monstres par Sacrifice
- Invoquer une carte de Tier 4 ou 5
- Lancer un combat avec 5 unités sur le terrain
- **Remporter un combat avec 2 unités ou moins** (fait goûter le multiplicateur risk/reward)
- Terminer un combat sans perdre d'unité
- Déclencher N pouvoirs

**C — Synergie et taxonomie** *(levier d'exploration du pool)*
- Activer 2 attributs simultanément au lancement d'un combat
- Aligner 3 unités du même **Type** sur le board
- Jouer une partie avec un deck contenant ≥ 8 cartes d'un **attribut** donnée
- Activer un palier **Platine** *(slot engagé uniquement)*

**D — Phase de shopping**
- Choisir N magies
- Réanimer une unité du cimetière
- Utiliser une magie de type `board_slot_bonus` ou `defuse_fusion`

**E — Méta hors combat** *(permet de valider sans jouer — précieux les jours sans temps)*
- Créer ou modifier un deck
- Débloquer une nouvelle carte

### 4.2 Schéma JSON — `missions.json`

```json
{
  "id": "MISSION_B_012",
  "family": "mechanical",
  "slot_weight": 2,
  "label": "Réussir {target} invocations par Fusion",
  "objective": {
    "event": "summon_performed",
    "filters": { "summon_type": "fusion" },
    "target": 2,
    "scope": "cumulative"
  },
  "rewards": { "xp": 100, "gold": 100 },
  "requirements": {
    "min_owned_cards_matching": { "summon_type": "fusion", "count": 3 }
  },
  "modes": ["online_ranked", "online_casual", "offline"],
  "tags": ["fusion", "exploration"]
}
```

**Champs clés**

- `slot_weight` — 1 (facile) / 2 (moyen) / 3 (engagé). Le tirage quotidien pioche une mission par poids.
- `scope` — `cumulative` (cumul entre parties) · `single_match` (dans une même partie) · `single_combat` (dans un même combat). Distinction critique pour la lisibilité : elle doit apparaître dans le libellé.
- `requirements` — bloque le tirage si le joueur ne possède pas de quoi accomplir la mission. **Non négociable**, c'est la première cause d'abandon des systèmes de missions.
- `modes` — laissé ouvert par défaut ; ne restreindre qu'en cas d'exploit avéré.

### 4.3 Événements à émettre depuis `GameState.js`

Le système de missions ne doit **jamais** lire l'état du jeu ; il consomme un flux d'événements. C'est ce qui garantit que le moteur reste gelé (Phase 0 de la refonte UI).

| Événement | Payload |
|---|---|
| `match_started` | `mode`, `deck_id` |
| `match_completed` | `result`, `rounds_played`, `final_hp`, `countable` |
| `combat_started` | `unit_count`, `board_slots_used`, `active_attributes[]` |
| `combat_ended` | `result`, `units_lost`, `units_neutralized`, `damage_dealt` |
| `summon_performed` | `card_id`, `tier`, `summon_type`, `attribute` |
| `attribute_threshold_reached` | `attribute_id`, `medal` |
| `power_triggered` | `power_id`, `unit_id` |
| `magic_selected` | `magic_id`, `effect_type` |
| `deck_saved` | `deck_id`, `card_count` |

Le flag `countable` sur `match_completed` porte la règle anti-concede (§3.3) : il passe à `true` au lancement du 2ᵉ combat.

---

## 5. Barème économique

### 5.1 Récompenses de mission

| Slot | XP | Golds |
|---|---|---|
| Facile | 60 | 50 |
| Moyen | 100 | 100 |
| Engagé | 150 | 175 |
| **Bonus 3/3 du jour** | 100 | 100 |
| **Total journée** | **410** | **525** |

### 5.2 Récompenses de partie

| Condition | XP | Golds |
|---|---|---|
| Partie comptabilisée (défaite) | 25 | 25 |
| Partie comptabilisée (victoire) | 50 | 50 |
| Modificateur duel en ligne | — | **×1.5** |

### 5.3 Jauge hebdomadaire

Chaque mission complétée = 1 point ; bonus 3/3 = +1 point → **28 points possibles**.

| Jalon | Récompense |
|---|---|
| 5 pts | 150 golds |
| 10 pts | 250 golds + 100 XP |
| 16 pts | 400 golds |
| 22 pts | 600 golds + 200 XP |
| 26 pts | 50 gemmes |

Le plafond à 26 (et non 28) pardonne volontairement deux jours d'absence.

### 5.4 Revenus hebdomadaires cibles

| Profil | Rythme | Golds / semaine |
|---|---|---|
| **Assidu** | 7j, 5 parties/jour | ~6 800 |
| **Régulier** | 4j, 4 parties | ~3 900 |
| **Occasionnel** | 2j, 3 parties (avec accumulation) | ~2 400 |

Ratio assidu/occasionnel ≈ **2.8×**. À surveiller : au-delà de 3×, l'occasionnel décroche.

### 5.5 Prix

**Acquisition de cartes**

| Item | Prix |
|---|---|
| Invocation simple (1 carte, tier pondéré) | 400 golds |
| Invocation dirigée (Pack au choix) | 900 golds |
| Craft ciblé T1 / T2 / T3 / T4 / T5 | 100 / 250 / 600 / 1 400 / 3 000 |
| **Reconversion doublon** T1→T5 | 20 / 50 / 120 / 280 / 600 *(20 %)* |

**Cosmétiques**

| Item | Prix |
|---|---|
| Avatar | 800 golds |
| Cadre d'avatar | 1 500 golds |
| Variante de carte | 2 500 golds |

> **Note design.** La variante de carte est le meilleur cosmétique des trois : elle s'adresse à un joueur qui possède déjà la carte, donc elle ne rentre pas en concurrence avec l'acquisition. C'est le puits de golds à privilégier en fin de courbe.

---

## 6. Courbe de niveaux

| Tranche | XP par niveau | Cumul |
|---|---|---|
| 1 → 10 | 300 | 3 000 |
| 11 → 30 | 600 | 15 000 |
| 31 → 60 | 1 200 | 51 000 |
| 61 + | 2 000 | — |

Revenu XP d'un joueur assidu ≈ 3 500/semaine → **niveau 10 en 1 semaine, niveau 30 en ~5 semaines, niveau 60 en ~15 semaines**.

**Récompenses de palier**

- Chaque niveau : `100 + 20 × niveau` golds
- Tous les 5 niveaux : 50 gemmes
- Tous les 10 niveaux : **1 cosmétique attribué directement** (non achetable)

---

## 7. Ladder et saison

### 7.1 Structure

- **Rangs 1 à 100**, regroupés en 10 paliers de 10.
- **Points de rang indexés sur la marge de victoire en PV** — l'équivalent Millenium des cubes de Snap :

| PV restants à la victoire | Points |
|---|---|
| > 700 | +3 |
| 400 – 700 | +2 |
| < 400 | +1 |
| Défaite | −1 (plancher au palier atteint) |

Ce système exploite une donnée déjà présente dans le moteur, récompense la domination franche, et donne du sens au multiplicateur de dégâts de fin de combat.

### 7.2 Reset partiel

En fin de saison, le joueur **redescend de 20 rangs**, avec un plancher au début du palier atteint. Un joueur rang 74 redescend à 54, jamais en dessous de 70 s'il a franchi le palier Diamant… *(à trancher : plancher souple ou dur — voir §9)*.

### 7.3 Récompenses de saison

Versées **une seule fois, sur le rang maximum atteint dans la saison** — pas sur le rang final.

> C'est le point le plus important de toute la section. Récompenser le rang final pousse le joueur à **arrêter de jouer** pour protéger son score. Récompenser le pic supprime entièrement ce comportement.

| Rang max atteint | XP | Golds |
|---|---|---|
| 20 | 200 | 500 |
| 40 | 400 | 1 200 |
| 60 | 700 | 2 500 |
| 80 | 1 200 | 4 500 |
| 100 | 2 000 | 8 000 |

Les paliers sont cumulatifs sur la saison la plus haute atteinte, non cumulables entre eux.

---

## 8. Cosmétiques

Trois supports en V1 : **avatar**, **cadre d'avatar**, **variante de carte**.

### 8.1 Le problème de fongibilité

Avec une monnaie unique, un joueur rationnel n'achète **jamais** de cosmétique tant qu'il lui manque des cartes : les cartes font gagner, pas les avatars. Sans correctif, tout le contenu cosmétique reste mort pendant les six premiers mois de vie d'un compte.

**Correctif retenu — double voie d'acquisition :**

| Voie | Contenu |
|---|---|
| **Attribution directe** (paliers de niveau, rang de saison, événements) | Cosmétiques **non achetables**. C'est ce qui les rend désirables : ils prouvent quelque chose. |
| **Boutique golds** | Cosmétiques neutres, achetables à tout moment. Sert de puits en fin de courbe. |
| **Boutique gemmes** | Cosmétiques premium exclusifs, rotation mensuelle. |

### 8.2 Recommandation sur le ladder

Le cadre d'avatar est le porteur naturel du prestige de rang. **Réserver les cadres des paliers Diamant et au-dessus à l'attribution par le ladder, sans équivalent achetable.** Sans ce marqueur, un ladder qui ne verse que de l'XP et des golds n'a plus aucune raison d'être : il devient un mode de jeu comme un autre, avec un taux de participation qui s'effondre.

---

## 9. Points ouverts

1. **Plancher de reset** — souple (on peut retomber sous son palier) ou dur (le palier atteint est acquis à vie) ? Le plancher dur est plus généreux mais provoque une inflation des rangs sur 4-5 saisons.
2. **Durée de saison** — 4 semaines (rythme Snap, forte cadence de contenu) ou 8 semaines (moins de pression sur la production) ?
3. **Passe de saison** — pas prévu en V1. À décider avant de figer la boutique gemmes, car il en absorberait la majeure partie de la valeur.
4. **Onboarding** — les 10 premiers niveaux doivent délivrer un deck jouable complet. À chiffrer une fois la triage des ~248 cartes orphelines terminée.
5. **Plafond de golds hebdomadaire** — non prévu. À réévaluer si un exploit de farm hors-ligne apparaît en playtest.
