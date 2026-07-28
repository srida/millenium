# CLAUDE.md — Millenium

## Project Overview

Port web d'un Auto-Battler inspiré de :

- Teamfight Tactics
- Marvel Snap

Gameplay-complete pour le premier vertical slice.

**Stack :**
- **Client** (`client/`) : Vite + React + TypeScript + Tailwind CSS v4 + Zustand + **Three.js vanilla** (npm, WebGL + CSS3D — pas de react-three-fiber : un composant React monte un `<canvas>` et délègue à la classe `Scene3D` qui possède la boucle de rendu). PWA via `vite-plugin-pwa`.
- **Serveur** (`server.js`) : Express (API données + comptes/PvP), sert le build client (`client/dist`) en prod.

> Historique : refonte du client vanilla-JS (dossier `game/`, supprimé) vers Vite/React documentée dans [PLAN_REFONTE.md](PLAN_REFONTE.md). La logique de jeu (`client/src/logic/`) reste **headless** et testable (golden tests de déterminisme du combat).

La philosophie du projet :

- Data-driven gameplay
- Mobile-first UX
- Simple mais tactiquement profond
- **Séparation stricte logique / visuel** : `client/src/logic/` n'importe jamais React, Zustand ni Three.

---

## Déploiement

```
# Dev (deux process) :
npm start                 # serveur Express — port 3742 (API + prod build)
npm run client:dev        # client Vite — port 5173 (proxifie /api, /illustrations, /ws → 3742)

# Prod :
npm run build             # tsc --noEmit puis build Vite → client/dist
npm start                 # Express sert client/dist sur / (fallback SPA)

# Qualité (dans client/) :
npm test                  # vitest run — golden tests logique (déterminisme combat, PvP…)
npm run lint              # eslint — inclut les garde-fous d'archi logic/ et three/
```

En dev, on développe sur **http://localhost:5173** (HMR) ; en prod, Express sert le SPA sur `/`.

Repo : `https://github.com/srida/Millenium`

---

## Routes Express

| Route | Accès | Description |
|---|---|---|
| `GET /` | Public | Jeu (SPA React servi depuis `client/dist`) |
| `GET /admin` | Site admin | Card Manager (`admin.html`) |
| `GET /api/version` | Public | Version du build (`package.json`) |
| `GET /api/cards` | Public | 398 cartes |
| `GET /api/attributes` | Public | Attributs |
| `GET /api/powers` | Public | Pouvoirs |
| `GET /api/boards` | Public | Terrains de combat |
| `GET /api/magies` | Public | Magies (Phase Shopping) |
| `GET /api/decks` | Public | Decks publics (`PublicDeckDatabase`), avec `_has_avatar` |
| `POST/PUT/DELETE /api/*` | Auth | Écriture admin |
| `GET /illustrations/:id` | Public | Art des cartes (PNG sans extension) |
| `GET /avatars/:id` | Public | Avatar d'un deck public (repli sur l'avatar par défaut) |
| `POST /api/cards/import` | Auth | Import en masse (mode skip/replace) |
| `POST /api/cards/:id/illustration` | Auth | Upload illustration (URL ou base64) |
| `POST /api/attributes/import` | Auth | Import attributs en masse |
| `POST /api/powers/import` | Auth | Import pouvoirs en masse |
| `POST /api/decks/import` | Site admin | Import decks publics en masse |
| `POST/PUT/DELETE /api/decks/:id/avatar` | Site admin | Avatar d'un deck public (URL / base64 / suppression) |
| `GET /api/export` | Auth | Export complet avec checksums illustrations **et avatars** |
| `/api/admin/db/*` | Site admin | Inspection de la base SQLite (`routes/admin-db.js`) |

**Niveaux d'accès** : l'écriture sur `cards` / `attributes` / `powers` passe par le middleware d'auth générique ; `boards`, `magies` et `decks` exigent en plus `requireSiteAdmin` (`auth.js`).

### API en ligne (`routes/online.js`, montée sur `/api`)

| Route | Accès | Description |
|---|---|---|
| `POST /api/auth/register` \| `login` \| `logout` | Public (rate-limité) | Comptes |
| `GET /api/auth/me` | Optionnel | Session courante |
| `POST /api/auth/forgot-password` \| `reset-password` | Public (rate-limité) | Réinitialisation mot de passe |
| `GET/PUT /api/profile/me` | Connecté | Profil (pseudo, avatar) |
| `GET /api/users/search` | Connecté | Recherche de joueurs |
| `GET /api/friends`, `GET /api/friends/requests` | Connecté | Liste d'amis / demandes |
| `POST /api/friends/request`, `POST /api/friends/:id/accept` \| `decline`, `DELETE /api/friends/:id` | Connecté | Gestion des amis |
| `GET/PUT /api/me/decks` | Connecté | Synchro serveur des decks (`DeckRepository.pull` / `flushSync`) |
| `GET /api/me/progression` | Connecté | Progression + collection (`{ level, xp, gold, gems, unlocked_count, unlocked_cards }`) |
| `GET /api/me/missions` | Connecté | Missions du jour + jauge hebdomadaire (délivre les lots manquants) |
| `POST /api/me/missions/events` | Connecté | Lot d'événements de partie (voir Missions quotidiennes) |
| `POST /api/me/missions/:id/reroll` | Connecté | Reroll d'une mission |
| `GET /api/me/shop` | Connecté | Boutique du jour (emplacements, Convoitise, sets) — génère l'offre au passage |
| `POST /api/me/shop/buy` \| `reroll` \| `covet` \| `booster` | Connecté | Achat d'emplacement, reroll, épingle, ouverture de booster |

Le PvP temps réel ne passe pas par HTTP : `ws/pvpServer.js` (matchmaking + relais opaque) sur `/ws`.

---

## Progression joueur (niveau, monnaies, collection)

Stockée en base (`db.js`), règles dans **`progression.js`** (racine — le serveur, pas le client) :

| Donnée | Colonne `users` | Défaut | Admin (`is_admin`) |
|---|---|---|---|
| Niveau | `level` | 1 | 100 |
| Expérience | `xp` | 0 | inchangée |
| Gold | `gold` | 0 | 9999 |
| Gemmes | `gems` | 0 | 9999 |
| Cartes débloquées | table `user_cards` | toutes les `CORE_*` (132) | **tout** le catalogue |

**Courbe de niveau** : palier unique de `XP_PER_LEVEL = 100`. `users.xp` stocke la progression **dans le niveau** (0–99), pas un cumul de carrière — `grant()` absorbe le passage de palier (250 XP d'un coup = +2 niveaux et 50 de reste), et la jauge de l'UI va donc de 0 à 100 sans calcul côté client. Un débit d'XP ne fait jamais redescendre de niveau.

**Barème des gains** (`progression.REWARDS`) :

| Événement | Gain | Décerné par |
|---|---|---|
| `ai_win` — victoire solo contre l'IA | 10 | Client → `POST /api/me/progression/reward` (`GameScreen`) |
| `tournament_win` — tournoi remporté | 50 | Client → même route (`tournamentStore.finishGame`, quand la finale est scellée) |
| `pvp_win` — victoire sur un joueur en ligne | 70 | **Serveur** (`ws/MatchRelay.endMatch`), transmis dans `match:end` |

- Le client envoie une **raison**, jamais un montant — sinon n'importe qui s'attribuerait le gain de son choix. `pvp_win` est refusé sur la route HTTP (`CLIENT_CLAIMABLE`) : le serveur est seul arbitre du vainqueur PvP (rapports croisés, forfait, timeout), il le décerne lui-même.
- Limite assumée : solo et tournoi se déroulent **entièrement côté client**, le serveur ne peut que croire le joueur. Le rate-limit (30/min) borne l'abus sans l'empêcher.
- Une **manche** de tournoi ne rapporte pas `ai_win` : le tournoi a son propre gain à la victoire finale (sinon un tournoi rapporterait jusqu'à 9×10 + 50).

```js
progression.initUser(userId)              // dotation d'un compte neuf — appelé par /api/auth/register
progression.applyAdminGrants(userId)      // niveau/monnaies (MAX, jamais de rétrogradation) + toutes les cartes
progression.unlockCard(userId, cardId)    // → false si déjà possédée ou id inconnu
progression.grant(userId, { xp, gold, gems })   // crédit/débit relatif, plancher à 0
progression.unlockedCardIds(user) / ownsCard(user, cardId) / getProgression(user)
progression.backfillAll()                 // rattrapage au boot (server.js, après bootstrap())
```

- **Le catalogue fait foi, pas la base** : `allCardIds()` lit `cards.json` (cache invalidé au mtime), donc une carte créée depuis l'admin est immédiatement débloquable.
- **Admins** : les cartes sont matérialisées en base *et* recalculées à la lecture (`unlockedCardIds`) — une carte ajoutée après la promotion leur appartient sans resynchronisation. Une rétrogradation ne dépouille pas le compte.
- `auth.publicUser()` expose `level/xp/gold/gems` (donc `/auth/me`, login, register) ; la **liste** des cartes, trop volumineuse, vit sur `GET /api/me/progression`.
- **Affichage** : `components/ui/ProgressionStats.tsx` — `<ProgressionPills>` (ligne compacte `Nv. 2 ▓▒░ 25/100 · 💰 · 💎`, menu principal, sous l'identité) et `<ProgressionPanel>` (jauge pleine largeur + soldes, écran Profil). Les deux lisent `authStore.user`, **sans fetch** : les valeurs arrivent déjà avec la session. Rien n'est rendu en invité. Icônes et couleurs sont définies une seule fois (`CURRENCIES`) ; 💰 et non 🪙, qui retombe en disque gris faute de glyphe couleur.
- **L'XP n'a pas de compteur à elle** : elle n'existe qu'au travers de la jauge de niveau (primitive `Gauge`, 0 → 100), avec le décompte exact en petit sous la barre. C'est la seule lecture qui compte (« où j'en suis du palier ») là où un nombre nu ne dit rien sans son plafond. Gold et gemmes, eux, sont des **soldes** → chiffres.
- `XP_PER_LEVEL` est dupliqué côté client (`ProgressionStats.tsx`) — à garder synchronisé avec `progression.js` à la main.

## Missions quotidiennes

Règles dans **`missions.js`** (racine, à côté de `progression.js` dont il est le client pour créditer les gains), catalogue dans **`data/missions.json`**, tables `user_missions` / `user_mission_state`.

| Règle | Valeur |
|---|---|
| Missions délivrées par cycle | **3** — une par difficulté de slot (facile / moyen / engagé) |
| Cycle | **8 h**, ancré sur 5 h → **5 h / 13 h / 21 h**, dans le fuseau du **serveur** |
| Accumulation | **9** missions actives maximum (= 3 cycles, soit 24 h d'absence pardonnées) |
| Reroll | 1 gratuit par **jour**, puis **100 golds** (jamais en gemmes) |
| Jauge hebdomadaire | **30** points — 1 par mission terminée, semaine du lundi |
| Paliers hebdo | **10 / 20 / 30** |

**Barème** (`SLOT_REWARDS`, `WEEKLY_MILESTONES`) :

| Slot | XP | Golds | | Palier | XP | Golds | Gemmes |
|---|---|---|---|---|---|---|---|
| Facile (1) | 60 | 50 | | 10 pts | 50 | 150 | 10 |
| Moyen (2) | 100 | 100 | | 20 pts | 100 | 250 | 25 |
| Engagé (3) | 150 | 175 | | 30 pts | 200 | 500 | 50 |

**Calendrier** : `cycleKey(ts)` → `2026-07-27#1` (jour de mission + rang du créneau) ; `cycleNumber(key)` en donne un rang **absolu** pour que `cyclesBetween` fonctionne de part et d'autre de minuit. Le reroll gratuit et la purge des missions terminées restent indexés sur la **journée** (`dayKey`) : une mission bouclée à 12 h 55 ne doit pas disparaître de l'écran à 13 h. Une clé d'état sans `#` (antérieure aux cycles) est lue comme le premier créneau de sa journée — le joueur reçoit les cycles écoulés depuis, il n'y a pas de migration à écrire.

- **Rien ne se réclame** : mission terminée = créditée dans la seconde (idem paliers hebdo). Un gain qu'il faut penser à récupérer est un gain qu'on perd. L'écran Missions est donc en lecture seule, sa seule action est le reroll.
- **Le fuseau du reset est celui du serveur**, pas du joueur : un client qui annonce son fuseau pourrait en mentir pour se faire délivrer un cycle de plus. Déployer avec `TZ=Europe/Paris`.
- Les missions **terminées restent affichées** jusqu'à la fin de la journée (`deleteStaleCompletedMissions`), puis s'effacent. Le plafond de 9 ne compte que les **actives**.
- **Filtrage par collection** (`requirements.owns_cards_matching`) : une mission Fusion ne sort pas si le joueur ne possède pas assez de cartes Fusion.

### Flux d'événements

Le système ne lit **jamais** l'état du jeu : il consomme des **événements nommés**. `logic/` l'ignore complètement — c'est `GameController` (couche app) qui les nomme, et le serveur qui les confronte à son catalogue.

| Événement | Payload | Émis par |
|---|---|---|
| `combat_started` | `unit_count`, `attribute_count`, `max_attribute_units` | `GameController._beginCombatAnimation` |
| `combat_ended` | `result`, `unit_count`, `units_lost` | `GameController._onCombatFinished` |
| `summon_performed` | `card_id`, `tier`, `summon_type` | `GameController._tryPlace` |
| `power_triggered` | `power_id` | flux d'événements de `CombatManager` (`onStep`) |
| `magic_selected` | `magic_id`, `effect_type` | `GameController._noteMagie` |
| `match_completed` | `result`, `rounds_played` | `GameController._reportMatchCompleted` |
| `deck_saved` | `card_count` | `DeckBuilder.save` (événement méta, envoyé seul) |

**Un lot = une partie.** `missionStore` accumule les événements et ne les envoie qu'en **fin de partie** (ou au démontage de l'écran de jeu : quitter en cours de route ne fait pas perdre ce qui a été joué). Ce découpage n'est pas cosmétique — c'est lui qui permet au serveur de **dériver lui-même** les garde-fous du contenu du lot, au lieu de croire un drapeau du client :

- **anti-concede** : le lot est rejeté en bloc s'il porte moins de **2 `combat_started`** ;
- **anti-AFK** : rejeté s'il ne porte **aucun `summon_performed`** ;
- hors partie (`match_id` absent), seuls les événements de `META_EVENTS` sont retenus.

Contrepartie assumée : les missions n'avancent pas pendant qu'on joue (l'écran Missions n'est de toute façon pas accessible en partie).

**Portées** (`objective.scope`) : `cumulative` (cumul entre parties) · `single_match` (dans le lot) · `single_combat` (max par `combat_index`). La distinction est critique — sans elle, « 6 pouvoirs dans un même combat » se validerait avec 6 combats à 1 pouvoir. Le client affiche la portée en chip sous le libellé (`scope_hint`), elle n'est donc **pas** répétée dans le libellé du catalogue.

Comme pour `progression.reward`, **le client nomme, le serveur chiffre** : aucun montant ne transite dans le sens client → serveur. La limite reste la même que pour le solo (la partie se déroule côté client, le serveur ne peut que croire la teneur du lot) ; le rate-limit (30/min) borne l'abus.

### Routes API

| Route | Accès | Description |
|---|---|---|
| `GET /api/me/missions` | Connecté | Instantané (missions, `cycle`, jauge hebdo, reroll). **Délivre les lots manquants au passage** — le cycle avance à la lecture, il n'y a pas de tâche planifiée |
| `POST /api/me/missions/events` | Connecté (30/min) | Lot d'événements → `{ countable, completed, milestones, granted, … }` |
| `POST /api/me/missions/:id/reroll` | Connecté (20/min) | Remplace une mission par une autre du même slot |

### Client

- `stores/missionStore.ts` — instantané + file d'événements (`startMatch` / `emit` / `emitCombatStarted` / `flushMatch` / `emitMeta`).
- `screens/MissionsScreen.tsx` — jauge hebdomadaire avec jalons posés à leur position réelle sur la barre, cartes de mission, reroll. Une cible de 1 n'affiche pas de barre de progression (elle serait toujours vide ou pleine).
- `components/ui/MissionToasts.tsx` — monté au niveau de **l'App**, pas d'un écran : la réponse du lot arrive souvent une fois revenu au menu. Positionné à la hauteur de `Banner` (`top-16`) pour ne pas recouvrir la barre de PV.
- `MainMenu` — bouton `🎯 Missions` avec le nombre d'actives et de terminées. Rien n'est rendu en invité : le cycle a besoin d'un compte.

### Collection & DeckBuilder

Le DeckBuilder ne laisse sélectionner que les cartes **possédées** (`stores/collectionStore.ts`, alimenté par `GET /api/me/progression`) :

- Les cartes non débloquées sont **masquées par défaut** ; le chip `🔒 Verrouillées` les révèle, grisées et intapables (cadenas via la prop `locked` de `CardTile`). Le compteur affiche `133/398 cartes débloquées`.
- `addCard` revérifie la possession : l'ajout ne dépend jamais du seul état d'affichage.
- **Invité** : repli sur les cartes de départ (`CORE_*`), la dotation d'un compte neuf. Le jeu se joue sans compte — un invité sans aucune carte ne pourrait plus construire de deck, et ce qu'il bâtit reste valable s'il s'inscrit.
- Un deck **déjà enregistré** contenant des cartes non possédées n'est **pas** amputé au chargement : les cartes concernées sont signalées (cadenas + bandeau) et restent retirables à la main. Effacer le travail du joueur sans qu'il l'ait demandé serait pire que l'incohérence.
- La table `user_cards` est créée **après** la migration `tag` de `users` : un `ALTER TABLE … RENAME` réécrit les FK des tables dépendantes vers `users_v1`, qui est ensuite supprimée (même raison pour le correctif FK de `sessions`/`friendships`/`deck_books`/`reset_tokens`/`matches`).

---

## Boutique de cartes

Règles dans **`shop.js`** (racine, à côté de `progression.js` dont il est le client pour débiter et débloquer, et de `missions.js` dont il reprend le calendrier), sets dans **`data/sets.json`**, table `user_shop_state`. La boutique **cosmétique** du brief n'est pas implémentée.

Trois systèmes, trois fonctions qui ne se recouvrent pas :

| Système | Fonction | Plafond |
|---|---|---|
| **Emplacements quotidiens** | Construction de deck — conscients du graphe d'invocation et du deck actif | 3 / jour |
| **Booster** | Collection — volume brut sur un set choisi | aucun |
| **Convoitise** | Précision absolue — une carte nommée | 1 à la fois, 3 jours |

Deux invariants portent tout le reste :

1. **Zéro doublon** — aucun tirage, nulle part, ne produit une carte possédée. C'est ce qui dispense le jeu de poussière, de fragments et de conversion de doublons.
2. **L'offre est serveur** — générée, horodatée et **persistée** (`user_shop_state.offer`). Aucune action client (changement de deck, rechargement, fuseau annoncé) ne la régénère : une offre re-tirable se re-tirerait jusqu'à satisfaction. Vérifié par golden test.

### Prérequis — le champ `set`

Le préfixe d'`id` (`CORE`, `EXTRA`, `YGX`…) est un identifiant technique, pas un axe commercial : les groupes vont de 8 à 32 cartes et plusieurs ne peuvent pas satisfaire la garantie de tiers. Chaque carte porte donc un champ **`set`**, et `data/sets.json` décrit les sets (nom, archétypes, `booster_enabled`, `signature_card`, `completion_reward`, liste `cards`).

**Le découpage actuel est PROVISOIRE**, produit par `scripts/build-sets.js` (`--write` pour écrire) : 7 sets de ~57 cartes. Ce qu'il garantit et ce qu'il ne garantit pas :

- ✔ **aucune carte orpheline** — fermeture par union-find sur le graphe de matériaux : une fusion/héritage/transformation est toujours dans le set de ses matériaux. C'est la contrainte dure ;
- ~ distribution de tiers : rapportée, pas garantie (le booster se rabat silencieusement) ;
- ✘ **« un archétype n'est jamais découpé entre deux sets » : impossible sur le pool actuel** — unir les cartes par archétype produit une composante unique de 223 cartes (une carte porte jusqu'à 4 attributs d'archétype, qui se chevauchent). C'est un travail éditorial sur `attributes.json`, pas un calcul — le brief le classe d'ailleurs en décision ouverte.

`sets.json` **fait foi** pour le pool d'un booster ; le champ `set` de la carte en est le miroir (il rattrape une carte créée depuis l'admin après la rédaction du set). Remplacer les deux suffit à substituer le découpage à la main : `shop.js` ne lit rien d'autre.

Le **set de fondation** (§2.5 du brief : cartes Tier 1 transverses attribuées par la progression de niveau) n'est **pas** implémenté — la fermeture par matériaux le rend inutile ici, et son attribution dépend de la courbe de niveau, décision ouverte de `brief_progression.md`. `booster_enabled: false` est prêt à l'accueillir.

### Emplacements quotidiens

Rotation à **5 h**, même reset que les missions (`shop.dayKey === missions.dayKey` — un seul rendez-vous quotidien à retenir). Composition fixe, contenu variable :

| Slot | Nom | Règle de tirage | `reason` |
|---|---|---|---|
| 1 | **Le Maillon** | carte dont tous les matériaux sont possédés, **ou** matériau manquant d'une carte possédée | `unlocks` / `material` |
| 2 | **L'Affinité** | carte partageant un attribut vu **≥ 2 fois** dans le deck actif | `affinity` |
| 3 | **L'Inconnu** | tirage libre pondéré par tier | `random` |

- **Pondération par tier** : 30 / 28 / 22 / 14 / 6 — volontairement plus plate que la distribution du pool (T1 38 %). Les tiers élevés coûtent plus cher : ils doivent sortir assez souvent pour que l'arbitrage budgétaire existe.
- **Prix** : 75 / 125 / 200 / 350 / 550 golds. Le client ne transmet **jamais** de montant.
- C'est le **badge** qui porte la valeur perçue, pas la carte : « une carte au hasard à 350 golds » et « la pièce qui manque à ta fusion à 350 golds » ne sont pas la même proposition.
- Un matériau désigné par **attribut** (`cost.materials` mélange ids de cartes et `ARCH_*`) est couvert par n'importe quel porteur possédé.
- **Dégénérescence en fin de collection** : les slots 1 et 2 se replient naturellement sur le tirage libre, aucun traitement particulier.
- **Reroll** : 1 gratuit par jour, jamais payant (un reroll achetable ferait de la boutique une machine à sous et casserait le plafond de 3 cartes/jour). La carte rerollée quitte le pool du **jour** et le slot est re-tiré **en conservant sa règle** — un reroll du Maillon rend un autre Maillon.
- **Verrou d'offre** : l'achat porte `slot` **et** `card_id`. Un tap au moment exact de la rotation échoue en 409 au lieu d'acheter la carte qui vient de prendre la place.
- Le tirage est **déterministe** à `(player_id, jour, slot)` (xorshift32 semé en SHA-256) : un tirage douteux se rejoue au lieu de se raconter.

### Convoitise

Une seule carte épinglée, gratuitement, à tout moment. Après **3 jours**, elle occupe le **slot 1** et court-circuite le Maillon. Prix : **double du tarif de son tier**. **Golds uniquement** — c'est le point de rupture du principe « les gemmes n'achètent jamais de précision ».

- Changer de carte remet le compteur à zéro (sinon on épinglerait n'importe quoi 3 jours avant de basculer sur la vraie cible).
- Une carte convoitée **ne se reroule pas** : ce n'est pas une proposition de la boutique mais une demande du joueur.
- L'épingle se vide d'elle-même si la carte est obtenue autrement (achat, booster) — laisser une carte possédée épinglée gèlerait le slot 1.


### Boosters

3 cartes, ciblées sur un set, **disponibles en permanence**, **600 golds ou 100 gemmes**, sans plafond d'achat. Tirage **à l'achat** (jamais à l'avance) : le cas « deck actif modifié entre la génération et l'ouverture » est donc sans objet.

Ordre de résolution du tirage — qui est aussi l'ordre d'**abandon** des garanties :

1. une carte **Tier 3+** comme ancre (c'est elle qui donne son thème au booster) ;
2. **garantie de tier** : 2 cartes Tier 1-2 + 1 carte Tier 3+ ;
3. **cohérence de lignée** : les matériaux manquants de l'ancre d'abord ;
4. **cohérence d'attribut** : les cartes partageant un attribut avec l'ancre ;
5. **pondération d'affinité** ×2 pour les attributs du deck actif (non exclusif — la découverte reste possible).

Chaque cran tombe **silencieusement** quand le pool résiduel ne peut plus le satisfaire (priorité d'abandon : cohérence d'attribut d'abord, garantie de tier ensuite, **jamais** le zéro doublon). Sur données réelles, la cohérence d'attribut est régulièrement abandonnée à bon droit : une partie du catalogue ne porte **aucun** attribut.

- Booster **grisé** quand le set est complet — jamais de vente ne pouvant rien produire.
- **Ne jamais indexer le prix sur le taux de complétion** : la valeur croissante à mesure que le set se vide est la propriété la plus vertueuse du système, elle récompense l'engagement au lieu de le taxer. L'écran affiche le nombre de cartes restantes pour la rendre visible.
- **Prime de complétion** (`completion_reward.gems`, 300) : versée **une seule fois**, automatiquement, jamais à réclamer — même règle que les paliers de missions.

### Routes API

| Route | Accès | Description |
|---|---|---|
| `GET /api/me/shop` | Connecté | Instantané (emplacements, Convoitise, sets, prix). **Génère l'offre du jour au passage** — pas de tâche planifiée |
| `POST /api/me/shop/buy` | Connecté (30/min) | `{ slot, card_id }` — 409 si l'offre a tourné |
| `POST /api/me/shop/reroll` | Connecté (20/min) | `{ slot }` |
| `POST /api/me/shop/covet` | Connecté (20/min) | `{ card_id }` — `null` retire l'épingle |
| `POST /api/me/shop/booster` | Connecté (30/min) | `{ set_id, currency }` |

Toutes les mutations renvoient l'instantané complet + la progression à jour : aucun rechargement derrière une action.

### Client

- `stores/shopStore.ts` — instantané + actions. Absorbe chaque réponse (solde via `authStore.applyProgression`, cartes via `collectionStore.add` — on ne recharge pas les 398 ids après chaque achat).
- `screens/ShopScreen.tsx` — emplacements, Convoitise (avec sélecteur de carte non possédée), boosters, révélation en modale.
- `MainMenu` — bouton `🛒 Boutique` avec le nombre d'emplacements restants, et un ⚡ quand un Maillon est proposé : c'est la seule chose qui mérite d'ouvrir l'écran aujourd'hui plutôt que demain.
- `components/ui/primitives.tsx` — `Countdown` (rafraîchi à la **minute** : un repère, pas un chronomètre), partagé avec l'écran Missions.
- Verrouillé par `client/src/test/shop.test.ts` (34 golden tests, même harnais serveur que `missions.test.ts`).

---

## Data Layer

Chaque database expose `init()` async. Les données sont cachées en mémoire après le premier fetch.

```js
await CardDatabase.init()       // charge /api/cards
CardDatabase.getCard(id)
CardDatabase.getCardsByTier(tier)
CardDatabase.getAllCards()
CardDatabase.buildDeckFromIds(idsByTier)
CardDatabase.illustrationUrl(id)
CardDatabase.costHint(card)

await AttributeDatabase.init()
AttributeDatabase.getAttribute(id)
AttributeDatabase.getAttributes()        // Dictionary { id: attr }
AttributeDatabase.getAllAttributes()     // Array — injecté dans GameSession/MatchSimulator

await PowerDatabase.init()
PowerDatabase.getPower(id)
PowerDatabase.getAllPowers()

await BoardDatabase.init()
BoardDatabase.getBoard(id)
BoardDatabase.getAllBoards()
BoardDatabase.getRandomBoard()   // injecté dans GameSession — tiré à chaque round de combat

await MagieDatabase.init()
MagieDatabase.getAllMagies()
MagieDatabase.getRandomMagies(count = 3)   // tirage sans remise — Phase Shopping

await PublicDeckDatabase.init()            // /api/decks — decks pré-construits
PublicDeckDatabase.getAllDecks()

DeckRepository.saveDeck(name, deck)
DeckRepository.loadDeck(name)
DeckRepository.deleteDeck(name)
DeckRepository.renameDeck(oldName, newName)
DeckRepository.deckExists(name)
DeckRepository.findFreeName(baseName)    // "Mon deck" → "Mon deck 2" (duplication)
DeckRepository.getActiveDeck()
DeckRepository.setActiveDeck(name)
DeckRepository.listDecks()
DeckRepository.getDeckColor(name) / setDeckColor(name, color)
DeckRepository.getDeckTags(name)  / setDeckTags(name, tags)
DeckRepository.setPendingEdit(name)      // stocke en sessionStorage
DeckRepository.consumePendingEdit()      // lit ET efface le pendingEdit

// Synchro serveur (compte connecté uniquement)
await DeckRepository.pull()              // GET /api/me/decks → écrase le local
await DeckRepository.flushSync()         // PUT /api/me/decks — push debouncé, forcé
DeckRepository.handleLogout()            // coupe la synchro, garde le local
```

**DeckRepository** persiste en `localStorage` (decks + méta couleur/tags). Chaque mutation planifie un push serveur debouncé si l'utilisateur est connecté ; en invité, tout reste local. Structure d'un deck :
```json
{ "1": ["CORE_001", ...], "2": [...], "3": [...], "4": [...], "5": [...] }
```

---

## CombatManager — Pattern headless

`CombatManager` ne contient aucune manipulation DOM.

`step()` retourne un tableau d'événements :

```js
{ type: 'move',        unit, from, to }
{ type: 'attack',      attacker, target, damage }
{ type: 'power',       unit, targets, power_id, extra: {...} }
{ type: 'dot',         unit, damage }               // pulse de poison OU de brûlure
{ type: 'stat_change', unit, stat, value }          // effet attribut during_combat
{ type: 'freeze',      cell, expiresAtStep }        // POWER_FREEZE — case gelée
{ type: 'death',       unit }
{ type: 'combat_end',  winner }                     // 'player' | 'enemy' | 'draw' | 'timeout'
```

Certains pouvoirs émettent **deux** événements : `POWER_TELEPORT` émet `power` + `move`, `POWER_FREEZE` émet `power` + `freeze`. Le `power` sert au toast/flash standard, le second porte la donnée exploitée par l'animateur.

`CombatAnimator3D` consomme ces événements via `requestAnimationFrame` et applique les animations.

Le timing est géré par `CombatAnimator3D`, jamais par `CombatManager`. Pas de `setTimeout` dans la logique.

**Timing :** `BASE_TICK_MS = 180` — intervalle de base entre les steps. Vitesse effective : `BASE_TICK_MS / speed` (speed = 1 | 2 | 4).

**Timeout de combat :** `MAX_COMBAT_TICKS = 60_000 / 180` (≈ 333 steps, soit 60 s de temps réel à ×1). Passé ce seuil sans qu'un camp soit entièrement neutralisé, `CombatManager` clôt le combat avec `winner = 'timeout'` — **les deux joueurs encaissent les dégâts de leurs survivants respectifs** (voir End of Combat Rules). `BASE_TICK_MS` est dupliqué dans `CombatManager` et `CombatAnimator3D` (logic/ n'importe jamais depuis three/) : les garder synchronisés à la main.

---

## Core Game Loop

Chaque partie dure 5 tours.

Pour chaque tour :

1. Préparation (`PREP_DURATION = 60` secondes — placement des cartes — timer géré par l'écran React, lance le combat automatiquement à 0)
2. Combat (auto-résolu, animé — coupé à 60 s de temps réel, cf. timeout ci-dessus)
3. Fin de combat (dégâts aux HP, nettoyage)
4. Phase Shopping (sauf dernier tour) — choix d'une magie parmi 3 (+ bonus `shopping_bonus`)
5. Tour suivant

Fin de partie :
- Tour 5 terminé
- OU un joueur atteint 0 HP
- OU abandon via le menu d'options

**Menu d'options** (`components/hud/GameMenu.tsx`, ouvert par le bouton ☰ de `PhaseControls`, à côté de PRÊT en préparation et de Pause en combat ; `menuOpen` du store est la source de vérité de l'ouverture) : disponible en préparation comme en combat, dans les deux écrans de jeu. Reprendre / quitter (confirmation obligatoire). En solo, l'ouvrir gèle le chrono de préparation (`menuOpen` dans le snapshot) ; en PvP le chrono continue — l'adversaire attend à la barrière réseau et ne doit pas pouvoir être bloqué. En PvP, « quitter » = `PvpController.forfeit()`.

**HP des joueurs : 1000.**

À la fin de la phase de combat :
```js
damage = sum(unit.atk for unit of survivingEnemyUnits) × multiplier
```

---

## Draw System

Pioche de 5 cartes au début de chaque tour.

Le pool dépend du tour :

| Tour | Tiers disponibles |
|---|---|
| 1 | Tier 1 |
| 2 | Tier 1, 2 |
| 3 | Tier 1, 2, 3 |
| 4 | Tier 2, 3, 4 |
| 5+ | Tier 3, 4, 5 |

La main est conservée entre les tours (taille illimitée) — les cartes non jouées s'accumulent avec la nouvelle pioche au tour suivant, sans impact sur le pool de tiers disponible.

**Affichage de la main** (`GameController._groupHand`) : `session.hand` reste une liste plate (l'ordre de pioche fait foi côté logique), mais l'instantané React regroupe les exemplaires identiques sous une seule entrée (badge ×N, `HandEntry.count`) et trie par tier croissant puis nom. `HandEntry.idx` pointe l'exemplaire représentatif — c'est lui qui quitte la main à l'invocation. La signature de regroupement inclut le coût : une carte remisée par une magie de main (`reduce_sacrifice_cost`, `free_transformation`…) ne fusionne pas avec un exemplaire normal.

**Règle du doublon** (`InvocationManager._canSummonForType`, côté joueur uniquement — l'IA n'est pas concernée) : jamais deux exemplaires vivants de la même `card_id` sur le board joueur.
- Invocation **normale** (et sacrifice dont le coût est tombé à 0 via magie) : refusée si un doublon est déjà vivant (carte grisée en main).
- **Sacrifice / Fusion / Heritage / Transformation** : autorisées par-dessus un doublon, **à condition que ce doublon soit sélectionné comme matériau** (pour la transformation : comme cible). Sinon → « Le doublon présent sur le terrain doit être sélectionné comme matériau ».

**Pioches garanties** (`gameState.player_guaranteed_draws`, alimenté par les effets d'attribut `guaranteed_draw` — `{ category, attribute }` — et par les magies `guaranteed_draw` — `{ tier }`) :
- Elles **occupent un slot de la main normale**, ce ne sont pas des cartes en plus : `randomCount = 5 + extra_draws − guaranteed_draws.length`.
- Elles **ignorent la restriction de tier du tour** : la recherche se fait dans tout le deck, filtrée par `tier` / `attribute` / `summon_type` selon les champs présents ; repli progressif (sans le tier, puis n'importe quelle carte) si aucune correspondance.
- Ordre de priorité de résolution : Transformation > Heritage > Fusion > Pioche normale.

---

## Damage Multiplier

Le multiplicateur est calculé au lancement du combat, en fonction du nombre d'unités présentes sur le terrain de chaque côté :

| Unités sur le terrain | Multiplicateur |
|---|---|
| ≥ 5 | 1.0 |
| 4 | 1.2 |
| 3 | 1.5 |
| 2 | 2.0 |
| 0–1 | 3.0 |

Appliqué symétriquement (calculé indépendamment pour chaque côté). Tension risk/reward : un board peu rempli encaisse moins de dégâts entrants mais en infligera davantage en cas de victoire.

**Multiplicateur de tour :** se multiplie au multiplicateur ci-dessus. Progression linéaire — `round` (tour 1 = ×1, tour 5 = ×5). Appliqué symétriquement aux deux joueurs.

```js
multiplicateur_final = multiplier(unitCount) × round
```

Implémenté dans `GameState.ts` :
```js
gameState.startCombat(playerUnitCount, enemyUnitCount)  // calcule player_multiplier / enemy_multiplier (× round)
gameState.player_multiplier
gameState.enemy_multiplier
gameState.player_unit_multiplier   // composante « nombre d'unités » seule, pour l'affichage du détail
```

**Bonus d'attribut :** l'effet `end_of_combat` `damage_multiplier_bonus` s'ajoute (additivement) au `player_multiplier` au moment d'appliquer les dégâts — côté joueur uniquement.

---

## Phase Shopping

Après la phase de combat (et l'écran de résultat de fin de round), le joueur se voit proposer **3 magies aléatoires** avant de passer au tour suivant — plus `gameState.player_extra_shopping_magies`, accumulé par l'effet d'attribut `shopping_bonus` et consommé au tirage.

**Sautée** :
- Sur le dernier tour / fin de partie (`gameState.isGameOver()`)
- Si le tirage ne renvoie aucune magie (`MagieDatabase.getAllMagies()` vide) → passage direct au tour suivant

Répartie entre la logique headless et la glue UI (plus d'écran monolithique) :

```ts
// client/src/logic/GameSession.ts — headless
getShoppingMagies()                      // 3 + extra, via la dep getRandomMagies
magieNeedsUnitTarget(magie) / magieNeedsGraveyardTarget(magie)
magieUnitTargets(magie)                  // cibles valides sur le board (defuse : fusions seulement)
applyMagieOnUnit(magie, unit) / applyMagieOnGraveyardUnit(magie, unit) / applyGlobalMagie(magie)
_defuseFusion(unit) / _destroyUnit(unit) // effets qui ne passent pas par applyEffect

// client/src/game/GameController.ts — orchestration + snapshot Zustand
dismissEndRound() → _startShopping() → chooseMagie(magie) → skipShopping() / _proceedNextRound()

// client/src/components/shopping/ShoppingLayer.tsx — rendu
```
---

## Magies

Système de cartes magiques tirées pendant la Phase Shopping. Chargées depuis `/api/magies`.

### Modèle de données

`initial-data/magies.json` :

```json
{
  "id": "MAGIC_001",
  "name": "Pot de Cupidité",
  "effect": {
    "type": "draw_bonus",
    "value": 2
  }
}
```

- `id` — identifiant unique (`MAGIC_NNN` dans les données initiales, `MAGIE_NNN` auto-généré par l'admin)
- `name`
- `effect` — `{ type, ...paramètres }` ou `null`
- `_has_illustration` (calculé côté serveur, non persisté)

### MagieDatabase

`client/src/data/MagieDatabase.js` — même pattern que `CardDatabase` / `PowerDatabase` / `BoardDatabase` :

```js
await MagieDatabase.init()              // fetch /api/magies, cache mémoire
MagieDatabase.getAllMagies()
MagieDatabase.getRandomMagies(count = 3) // tirage sans remise
```

### Types d'effets (`client/src/logic/MagieEffect.js`)

`effectLabel(magie)` génère la description affichée, `applyEffect(magie, { gameState, targetUnit })` applique l'effet.

| `type` | Champs | Effet |
|---|---|---|
| `stat_bonus` | `stat`, `value` | Bonus additif **permanent** sur `targetUnit._base[stat]` (min 1) + `_recomputeStats()`. Si `stat === 'hp'`, augmente aussi `current_hp`. |
| `stat_modifier` | `stat`, `value` | Multiplicateur **permanent** : `_base[stat] += round(_base[stat] * (value - 1))` + `_recomputeStats()`. |
| `heal` | `value` | `targetUnit.heal(value)` |
| `shield` | `value` | `targetUnit.applyShield(value)` |
| `revive` | `value` (% PV max) | Unité du **cimetière** : `is_neutralized = false`, `current_hp = max(1, round(max_hp * value/100))`, et purge de tous les statuts (dot, burn, paralysie, block). |
| `player_hp_bonus` | `value` | `gameState.player_hp = min(player_hp + value, 1000)` |
| `board_slot_bonus` | `value` | `gameState.grantLimitedBoardSlotBonus(value \|\| 1)` — **cap partagé, non cumulable : +1 slot au total** sur toute la partie, pool commun avec l'attribut Yeux Bleus. Une seconde magie de slot ne donne rien. |
| `draw_bonus` | `value` | `gameState.player_extra_draws += (value \|\| 1)` — pioches supplémentaires ce tour |
| `guaranteed_draw` | `tier` | `gameState.player_guaranteed_draws.push({ tier })` |
| `defuse_fusion` | — | No-op dans `applyEffect` ; géré par `GameSession._defuseFusion()` — sépare la fusion en ses matériaux (au cimetière s'il n'y a plus de slot). |
| `destroy_unit` | — | No-op dans `applyEffect` ; géré par `GameSession._destroyUnit()` — retire l'unité du board et l'envoie au cimetière (libère un slot, la rend disponible comme matériau). |
| `reduce_sacrifice_cost` | `value` (déf. 1) | `gameState.player_hand_modifiers.push({ type: 'reduce_sacrifice_cost', value })` — réduit le coût en sacrifices d'une carte Sacrifice en main |
| `free_transformation` | — | `gameState.player_hand_modifiers.push({ type: 'free_transformation' })` — invoque une Transformation sans son monstre cible |
| `remove_heritage_material` | — | `gameState.player_hand_modifiers.push({ type: 'remove_heritage_material' })` — retire le matériel Heritage obligatoire |

**Helpers de routage** :
- `needsUnitTarget(magie)` → `stat_bonus`, `stat_modifier`, `shield`, `heal`, `defuse_fusion`, `destroy_unit` (cible une unité du board joueur)
- `needsGraveyardTarget(magie)` → `revive` uniquement (cible une unité du cimetière)
- Tous les autres types sont des effets globaux appliqués immédiatement.

Les `player_hand_modifiers` (`reduce_sacrifice_cost`, `free_transformation`, `remove_heritage_material`) sont consommés au tour suivant (différé), dans `GameSession.startPreparation()`.

**Traçage des bonus permanents** : `stat_bonus` / `stat_modifier` écrivent dans `unit._base` **et** cumulent le delta réel dans `unit._shopping_bonus[stat]`. `InvocationManager._transferShoppingBonuses` reporte ces bonus sur l'unité composite quand l'unité est consommée comme matériau (sacrifice/fusion/heritage) ou remplacée (transformation) — un investissement de Shopping n'est jamais perdu par une invocation. Sont transférés : les deltas de stats (**sommés** sur tous les matériaux), le bouclier restant (sommé) et les points de vétérance (**maximum**, pas somme).

### Admin panel

Onglet "Magies" dans `admin.html` : CRUD complet, sélecteur `effect.type` avec champs conditionnels (`stat`, `value`, `tier`), import JSON en masse, gestion d'illustration. ID auto-généré au format `MAGIE_<next>`.

### Routes API

| Route | Accès | Description |
|---|---|---|
| `GET /api/magies` | Public | Liste toutes les magies |
| `POST /api/magies` | Site admin | Créer une magie |
| `POST /api/magies/import` | Site admin | Import en masse (mode skip/replace) |
| `PUT /api/magies/:id` | Site admin | Modifier une magie |
| `DELETE /api/magies/:id` | Site admin | Supprimer une magie |
| `POST /api/magies/:id/illustration` | Site admin | Upload illustration |
| `DELETE /api/magies/:id/illustration` | Site admin | Supprimer illustration |

Incluses dans `GET /api/export` avec checksums illustrations.

---

## Board

Taille : 5 colonnes × 11 rangées

Joueur : rangées 0–3
Zone neutre : rangées 4–6 (inoccupables en préparation)
Ennemi : rangées 7–10

Maximum d'unités sur le board : **5** (6 avec certaines synergies d'attribut).

Pendant la préparation :
- Joueur voit uniquement son côté
- Ennemis masqués (classe CSS `.hidden`)

Pendant le combat :
- Board entier visible
- Les deux côtés affichés

**`Board.ts` est la source de vérité.**

Ne jamais déduire une position depuis un élément DOM.

Toujours faire confiance à :
```js
unit.position
board.grid
```

**Structure interne :** `grid[col][row]` — stockage en ordre col-major.

```js
board.grid[2][0]  // unité en colonne 2, rangée 0 (milieu haut, côté joueur)
```

### Cases bloquées

`Board.ts` maintient **deux** collections de cases bloquées, toutes deux clés `"col,row"` :
- `_blockedCells` (`Set`) — blocages **permanents** du terrain, posés au lancement du combat
- `_temporaryBlockedCells` (`Map` → step d'expiration) — blocages **dynamiques** créés en cours de combat par `POWER_FREEZE`

```js
board.setBlockedCells(cells)              // cells: [{col, row}, ...] — réinitialise AUSSI les blocages temporaires
board.clearBlockedCells()                 // vide les deux collections
board.isBlocked(pos)                      // → bool — vrai si dans l'une OU l'autre

board.setTemporaryBlock(pos, expiresAtStep)  // POWER_FREEZE
board.clearTemporaryBlocks()                 // un seul bloc de glace à la fois : le nouveau remplace l'ancien
board.purgeExpiredTemporaryBlocks(step)      // appelé au début de chaque step par CombatManager
```

`getNeighbors(pos)` exclut automatiquement les cases bloquées (permanentes **et** temporaires) — le BFS les contourne donc sans modification.

Les cases bloquées sont réinitialisées entre deux combats (`GameSession.startPreparation()` appelle `clearBlockedCells()`).

---

## Board Terrain (Terrains de combat)

Chaque combat tire aléatoirement un terrain depuis `BoardDatabase`. Le terrain est actif uniquement pendant la phase de combat.

### Modèle de données

```json
{
  "id": "BOARD_001",
  "name": "Désert Maudit",
  "_has_illustration": true,
  "blocked_cells": [{ "col": 2, "row": 5 }],
  "effect": {
    "type": "stat_bonus",
    "stat": "atk",
    "value": 10,
    "target_attributes": ["ARCH_DRAGON"]
  }
}
```

`effect` peut être `null` (aucun effet). `target_attributes` vide = toutes les unités des deux joueurs.

### Types d'effets supportés

| `type` | Description |
|---|---|
| `stat_bonus` | Bonus additif permanent sur une stat (`stat`, `value`) |
| `stat_modifier` | Multiplicateur de stat — converti en additif via `unit._base[stat] × (value - 1)` |
| `shield` | Bouclier initial (`value`) |
| `draw_bonus` | Pioche supplémentaire (`value` cartes) — alimente `gameState.player_extra_draws`, joueur uniquement |

Les effets sont appliqués via `applyStatBonus()` / `applyShield()`, donc nettoyés automatiquement par `resetCombatStats()` en fin de combat.

### Rendu en jeu

`GameSession.startCombat` pose les cases bloquées sur le `Board` (logique) ; c'est `GameController` qui les transmet à la scène (`Scene3D.setBlockedCells`) au lancement de l'animation et les efface en fin de combat — sans quoi les unités contourneraient des cases visuellement libres. Le terrain tiré est aussi affiché dans la barre de combat (chip `🗺️`, tap → tooltip nom + effet).

### Ligne de vue (LOS)

`PathFinder.ts` expose :

```js
hasLineOfSight(board, from, to) → bool   // Bresenham sur _blockedCells + _temporaryBlockedCells
canAttack(attacker, target, board)       // isInAttackRange() && hasLineOfSight()
findAttackTarget(unit, enemies, board)   // préfère les cibles avec LOS
```

**Règles LOS :**
- Si aucune case bloquée (permanente **ni** temporaire) → LOS toujours `true` (court-circuit)
- Une case bloquée sur la ligne entre attaquant et cible → LOS `false`
- Une unité sans LOS sur sa cible **continue à se déplacer** vers elle (le check `canAttack` dans la boucle de mouvement force la progression)

### TestBench

TestBench expose un sélecteur de terrain manuel (dropdown `🗺️`) dans la colonne board. Sélectionner un terrain :
1. Affiche les cases bloquées sur la grille immédiatement
2. Active un bouton ℹ pour voir le tooltip du terrain
3. Applique les effets au lancement du combat
4. Les effets sont annulés (`resetCombatStats`) à l'arrêt du combat

---

## Unit Model

Propriétés runtime (`client/src/logic/Unit.ts`) :

```js
uid                       // identifiant d'instance, unique par partie

// Stats
_base                     // stats de base gelées — SEUL endroit modifié en permanent (magies)
_stat_bonuses             // bonus plats du combat en cours (attributs, terrain, vétérance)
_shopping_bonus           // delta permanent cumulé des magies — transféré aux invocations composites
atk / max_hp / current_hp / movement_speed / attack_speed / initiative / range
shield
power_gauge

// Statuts (tous purgés par resetCombatStats)
dot_effects               // [] — poison, pulse sur un timer global
burn_stacks               // [] — brûlure, pulse sur les attaques de l'unité elle-même
paralysis_remaining       // steps restants de paralysie
attack_speed_modifier     // ajouté à attack_speed tant que la paralysie dure
is_power_blocked / power_block_remaining
confusion_remaining       // > 0 → l'unité cible ses propres alliés
taunt_remaining           // > 0 → l'unité force les ennemis à la cibler
is_effect_immune          // attribut effect_immunity — annule les pouvoirs de debuff

// Position / état
position                  // { col, row }
initial_position
is_neutralized
veterancy_points          // combats survécus (voir Vétérance)

// Timers internes (incrémentés à chaque step)
attack_timer / move_timer
```

Les unités persistent entre les tours.

Unités détruites : retirées définitivement.

Survivants : retournent à `initial_position` après le combat.

### Vétérance

Une unité encore active en fin de combat gagne **1 `veterancy_point`** (`GameSession.finishCombat`, joueur et ennemi).

À partir de `VETERANCY_THRESHOLD = 2` points, elle reçoit un bonus permanent, appliqué par `AttributeManager._applyVeterancyBonuses()` au `start_of_combat`, exactement comme un `stat_bonus` d'attribut :

```js
atk += veterancy_points × VETERANCY_ATK_PER_POINT   // 2
hp  += veterancy_points × VETERANCY_HP_PER_POINT    // 15
```

Comme c'est un bonus de combat, il est nettoyé par `resetCombatStats()` puis recalculé au combat suivant, et restauré par `reapplyBonuses()` après un `POWER_DEBUFF`. Les points sont perdus si l'unité est neutralisée et non consommée comme matériau. Si elle est consommée, l'unité composite hérite du **maximum** des points de ses matériaux (jamais de la somme — enchaîner les invocations ne permet pas de farmer la vétérance). En PvP, ils voyagent dans le payload `round:board_ready` (obligatoire pour le déterminisme).

---

## Graveyard (Cimetière)

Les unités neutralisées entrent dans `graveyard[]` (joueur) ou `enemyGraveyard[]` (ennemi).

Rôle pendant la phase de préparation :
- Disponibles comme matériaux d'invocation (sacrifice, fusion, heritage, transformation)
- Une unité venant du cimetière **ne consomme pas de slot de board** lors d'une transformation (elle est déjà hors jeu)
- Supprimées définitivement au lancement du combat si non consommées

---

## End of Combat Rules

**Fin du combat → fin de la phase de préparation suivante :**

Unités neutralisées :
- Restent sur le board après le combat
- Restent disponibles toute la phase de préparation suivante
- Peuvent être utilisées comme matériaux d'invocation (sacrifice, fusion, heritage)
- Sont définitivement retirées au lancement du combat suivant si non consommées

Survivantes :
- Retournent à `initial_position`
- La grille est reconstruite

**À la fin du combat, les dégâts sont appliqués** (`GameState.applyEndOfCombat`) :

```js
// L'ennemi encaisse si winner ∈ { 'player', 'draw', 'timeout' }
enemy_hp -= round(sum(survivingPlayerUnits.atk) × (player_multiplier + damage_multiplier_bonus))

// Le joueur encaisse si winner ∈ { 'enemy', 'draw', 'timeout' }
player_hp -= round(sum(survivingEnemyUnits.atk) × enemy_multiplier)

// HP clampés à 0 (jamais négatifs)
```

⚠️ **`draw` et `timeout` font encaisser les DEUX camps**, chacun subissant les dégâts des survivants adverses. Le `draw` (annihilation mutuelle) laisse en pratique deux sommes d'ATK nulles ; le `timeout` (combat coupé à 60 s) fait en revanche mal aux deux joueurs — c'est ce qui dissuade les boards purement défensifs.

`applyEndOfCombat(winner, playerSurvivorsAtk, enemySurvivorsAtk, attributeResult)`
— reçoit la somme d'ATK, pas un nombre d'unités. `attributeResult` provient de `AttributeManager.applyEndOfCombat()` et apporte `damage_multiplier_bonus`, `draw_bonus`, `guaranteed_draws`, `board_slot_bonus`, `shopping_bonus`, `revived`.

Effets des pouvoirs : prennent fin à la fin du combat (sauf indication contraire).

Ne jamais modifier un tableau pendant son itération :

```js
for (const unit of [...units]) {
```

---

## Summoning System

### Normal

Placement direct.

---

### Tribute (Sacrifice)

```json
{ "summon_type": "sacrifice" }
```

Consomme des unités alliées.

---

### Fusion

Requiert des matériaux spécifiques.

Consomme les matériaux.

---

### Heritage

Requiert :
- Matériau Heritage
- Tributs supplémentaires

---

### Transformation

Requiert une unité spécifique déjà en jeu.

La remplace. Conserve la position du monstre d'origine.

---

**Chaînage :** une invocation peut être immédiatement suivie d'une autre (sacrifice, fusion, heritage, transformation) tant que les conditions sont remplies.

`InvocationManager` expose :
```js
canSummon(card, pos, board, hand, graveyard = [], selectedMaterials = [], optionIndex = null)
  → { ok: bool, reason: string }                 // + { options: [...] } si la carte a des summon_options
summon(card, pos, board, hand, sacrificeTargets = null, handIdx = null, optionIndex = null)
  → Unit | null
exceedsBoardSlots(card, selectedMaterials, board, graveyard, playerBoardSlots, type?)
hasSummonOptions(card) / resolveTransformationTarget(card, board)
matchesMaterial(unit, matId) / materialLineageLegit(unit, required) / materialLineageMatches(unit, matId, required)
sumMaterialValue(units)
```

`InvocationRules` (pur, sans mutation) alimente l'UI : `isPlayable`, `needsMaterials`, `materialsComplete`, `validCells`, `materialCandidateCells`, `materialCandidateGraveyard`, `transformTargetCells`, `summonOptionsStatus`, `getUncoveredRequirements`, `hasEmptyPlayerCell`. `GameSession` les ré-expose en injectant board/main/cimetière/slots.

### Invocations à alternatives (`summon_options`)

Une carte peut proposer **plusieurs recettes d'invocation** via `card.summon_options` (19 cartes actuellement) : chaque option porte son propre `summon_type` et son propre `cost`.

- `hasSummonOptions(card)` → `true` si le tableau est non vide.
- Tous les points d'entrée acceptent un `optionIndex` ; `null`/absent = première option (`summon`) ou évaluation de **toutes** les options (`canSummon` renvoie alors `{ options: [{ index, summon_type, cost, ok, reason }] }` au lieu de `{ ok, reason }`).
- `summonOptionsStatus(card, board, graveyard, maxSlots)` → `[{ index, summon_type, cost, ok }]` pour l'UI ; `isPlayable` est vrai dès qu'**une** option est jouable.

### Représentation des unités composites

Chaque `Unit` porte deux propriétés utilisées par `_matchesMaterial` / `canSummon` :

- **`represented_ids`** (`string[]`, init. `[card.id, ...(card.represented_ids ?? [])]`) — IDs de cartes que l'unité « représente » pour le matching de matériaux fusion/heritage/transformation. **Pré-déterminé sur la définition de la carte** (champ `represented_ids` paramétrable dans le panneau d'administration, section « Lignée (cartes représentées) ») plutôt que calculé dynamiquement à l'invocation à partir des matériaux consommés. Une carte de type Fusion/Heritage/Transformation doit donc lister explicitement les IDs de ses matériaux (et leur propre lignée, le cas échéant) pour que l'unité résultante compte comme eux dans une fusion/heritage ultérieure. Affiché dans le tooltip d'unité (icône 🧬) quand la lignée dépasse la carte de base.
- **Légitimité d'un matériel composite (Fusion et Transformation)** : `InvocationManager.materialLineageLegit`/`materialLineageMatches` exigent que TOUTE la lignée héritée d'un matériel (ses `represented_ids` au-delà de son propre `card_id`) soit elle-même requise par l'invocation en cours. Ex : une unité « Aile de feu » (fusion d'Avian + Burstinatrix) ne peut pas remplacer Avian seul (ni pour une Fusion, ni pour une Transformation comme Neo-Avian) car elle représente aussi Burstinatrix, non requis ; elle peut en revanche combler à elle seule les deux slots Avian+Burstinatrix d'une fusion qui les requiert tous les deux (ex : Electrum).
- **`material_value`** (`number`, init. `1`) — nombre de « slots » de matériau que l'unité représente si elle est elle-même consommée par un sacrifice/heritage ultérieur. Fixé lors de `summon()` :
  - Fusion → `card.cost.materials.length` (ou 1)
  - Heritage → `card.cost.sacrifice` (ou 1)
  - Sacrifice → `card.cost.sacrifice`
  - Normal / Transformation → reste à `1`

Les coûts `sacrifice`/`heritage` (`canSummon`, `isPlayable`, sélection de matériaux dans `InvocationRules`) sont vérifiés via la **somme des `material_value`** des unités sélectionnées (`sumMaterialValue`), pas via leur nombre.

---

## Attributs

Chargés depuis `/api/attributes`.

Un monstre peut posséder un ou plusieurs attributs. Un seul palier d'attribut est actif à la fois (le plus élevé atteint).

Effets supportés (`AttributeManager`) :

| Effet | Timing | Détail |
|---|---|---|
| `stat_bonus` | `start_of_combat` | Bonus plat ; champ `value_per` optionnel (× nb d'unités adverses portant cet attribut). La stat `power_charge` n'est pas une stat de combat : elle accélère la charge de la jauge de pouvoir (`+1 + power_charge` par step). |
| `shield` | `start_of_combat` | `value` × nombre d'alliés vivants |
| `effect_immunity` | `start_of_combat` | Pose `unit.is_effect_immune` — les pouvoirs de debuff (poison, paralysie, push, burn, freeze, block, confusion) sont annulés sur cette unité |
| `stat_modifier` | `during_combat` | Déclenché par `trigger` : `on_ally_neutralized` / `on_enemy_neutralized` |
| `revive` | `end_of_combat` | Réanime une unité neutralisée à `hp_percent` % (déf. 50) |
| `draw_bonus` | `end_of_combat` | Pioches supplémentaires (plafonné par `max`) |
| `guaranteed_draw` | `end_of_combat` | Pousse `{ category, attribute }` dans `player_guaranteed_draws` |
| `board_slot_bonus` | `end_of_combat` | Passe par `grantLimitedBoardSlotBonus` — **cap +1 partagé avec les magies de slot** |
| `damage_multiplier_bonus` | `end_of_combat` | S'ajoute au `player_multiplier` pour les dégâts de ce round |
| `shopping_bonus` | `end_of_combat` | Magies supplémentaires à la Phase Shopping suivante (plafonné par `max`) |

### Timings

Les effets se déclenchent à trois moments précis (`attr.timing`) :

- `start_of_combat` — bonus initiaux (stats, boucliers, immunités)
- `during_combat` — effets réactifs aux événements (neutralisation d'un allié / d'un ennemi)
- `end_of_combat` — effets différés (pioches garanties, réanimation, slots, shopping)

Un attribut peut aussi porter `timing: 'none'` — archétype purement descriptif, sans effet.

### Réinitialisation

Tous les bonus d'attribut sont réinitialisés à la fin de chaque combat.

Les effets `start_of_combat` sont recalculés au prochain combat en fonction des unités présentes au lancement. Le bonus de slot (ex: Yeux Bleus +1) est plafonné à +1 pour toute la partie, pool partagé avec les magies `board_slot_bonus`.

Le manager est **reconstruit à chaque combat** (`new AttributeManager(attributeList, playerUnits, enemyUnits)` dans `GameSession.startCombat`), puis :
```js
attributeManager.applyStartOfCombat()                    // stats, boucliers, immunités, vétérance + verrouillage des seuils during_combat
attributeManager.onUnitNeutralized(unit, pU, eU)         // appelé par CombatManager sur chaque mort → events stat_change
attributeManager.applyEndOfCombat(pNeutralized, eNeutralized)  // → { revived, draw_bonus, guaranteed_draws, board_slot_bonus, damage_multiplier_bonus, shopping_bonus }
```

### Détails d'implémentation

- **Comptage des liens (thresholds)** : seules les unités **distinctes** (par `card_id`) sont comptées — deux exemplaires de la même carte ne comptent que pour 1 dans le décompte d'attribut (`_countAttribute`, et le décompte `end_of_combat`).
- Le décompte `end_of_combat` inclut les unités **neutralisées** pendant le combat (le palier tient même si les porteurs sont morts) ; les autres timings ne comptent que les vivantes.
- `stat_bonus` avec champ `value_per` : la valeur est multipliée par le nombre d'unités **ennemies** portant cet attribut (bonus contextuel)
- `shield` : la valeur est multipliée par le nombre d'unités **alliées vivantes** au moment du déclenchement
- Les seuils `during_combat` sont **verrouillés au début du combat** — les morts en cours de combat ne désactivent pas les effets déjà actifs
- `reapplyBonuses(unit)` : ré-applique les bonus `start_of_combat` après un `POWER_DEBUFF` (qui réinitialise les stats de la cible)
- `getActiveSynergies(units)` → `[{attr, count, activeThreshold, nextThreshold}]` — utilisé par le panneau d'attributs de l'UI

---

## Powers

Chargés depuis `/api/powers`.

Une unité peut avoir : zéro ou un pouvoir.

La jauge gagne `1 + _stat_bonuses.power_charge` par step. Elle est prête à `power_gauge >= power_speed` (`Unit.isPowerReady()`, faux si `is_power_blocked`). Le pouvoir se déclenche alors **dans la phase d'attaque**, donc uniquement si l'unité a une cible à portée et en ligne de vue — sinon la jauge reste pleine et attend. Quand il part :
- Il remplace l'attaque normale du step
- La jauge se réinitialise (sauf pouvoir non résolu, cf. `POWER_TELEPORT`)

Les 14 pouvoirs implémentés (constantes en tête de `CombatManager.js`) :

| Pouvoir | Effet |
|---|---|
| `POWER_HEAL` | Soigne l'allié au plus bas `current_hp` (soi-même inclus) de 40 % du `max_hp` du lanceur |
| `POWER_SHIELD` | Bouclier sur soi = `atk × 2` |
| `POWER_SUPER_ATTACK` | `atk × 3` sur la cible |
| `POWER_AOE_ATTACK` | `atk` sur **tous** les ennemis vivants |
| `POWER_POISON` | DOT : `atk / 2` par pulse, 5 pulses, 1 pulse tous les 3 steps (`dot_effects`) |
| `POWER_BURN` | Malédiction : `atk / 2` infligés à la cible **sur ses 3 prochaines attaques** (`burn_stacks`, `power_value` surcharge le nombre) |
| `POWER_PARALYSIS` | `attack_speed_modifier += 6` pendant 20 steps (`paralysis_remaining`) — ralentit, ne bloque pas |
| `POWER_PUSH` | Repousse la cible de `power_value` cases (déf. 2) en ligne droite ; s'arrête aux bords, unités et cases bloquées |
| `POWER_DEBUFF` | `resetCombatStats()` sur la cible — efface bonus **et** statuts |
| `POWER_BLOCK` | Empêche la cible d'utiliser son pouvoir pendant 25 steps |
| `POWER_CONFUSION` | 20 steps : la cible prend ses **propres alliés** pour cibles |
| `POWER_TAUNT` | 20 steps (ou `power_value`) : le lanceur force les ennemis à le cibler |
| `POWER_TELEPORT` | Se téléporte au contact de l'ennemi au plus bas `current_hp` (case adjacente libre, sinon case libre la plus proche). Sans destination, la jauge **reste pleine** et l'unité réessaie au step suivant |
| `POWER_FREEZE` | Repousse la cible d'1 case et **gèle la case libérée** jusqu'à la fin du round (`board.setTemporaryBlock`). Un seul bloc de glace à la fois : le nouveau remplace l'ancien |

**Règles importantes :**
- Un pouvoir ne se déclenche jamais pendant la phase de préparation
- Le pouvoir **remplace** l'attaque du step ; la jauge se vide, sauf si le pouvoir n'a pas pu se résoudre (`POWER_TELEPORT` sans case libre)
- Une unité `is_effect_immune` (attribut `effect_immunity`) annule poison, burn, paralysie, push, freeze, block et confusion — l'événement `power` est émis avec `extra: { immune: true }`
- Les effets de pouvoir prennent fin à la fin du combat (`resetCombatStats`)
- Un `power_id` inconnu retombe sur une attaque normale

---

## Combat Rules

Chaque `step()` déroule 5 phases, dans cet ordre, sur la liste des unités vivantes triée par initiative :

1. Ticks passifs (jauge de pouvoir, décomptes paralysie / block / confusion / taunt, pulses de DOT)
2. Morts dues aux DOT → fin de combat éventuelle
3. Déplacements (timer indépendant : agit quand `move_timer >= movement_speed`)
4. Attaques / pouvoirs (`attack_timer >= effectiveAttackSpeed()`), puis pulses de brûlure du lanceur
5. Morts dues aux attaques → fin de combat, sinon vérification du timeout

### Ciblage

Le pool de cibles est résolu par `_targetCandidates(unit, { requireLOS })` :

1. **Provocation** — si un ennemi a `taunt_remaining > 0`, il est la seule cible possible (le plus proche s'il y en a plusieurs). En résolution d'attaque (`requireLOS: true`), un provocateur hors ligne de vue ne force plus rien ; en déplacement (`requireLOS: false`), l'unité continue de marcher vers lui pour regagner la LOS.
2. **Confusion** — sinon, si l'unité a `confusion_remaining > 0`, ses cibles deviennent **ses propres alliés vivants**.
3. Sinon : tous les ennemis vivants.

Dans ce pool, `findAttackTarget` (`PathFinder.ts`) choisit :
1. Les cibles avec **ligne de vue** si au moins une existe, sinon toutes
2. Parmi elles, la plus proche en **distance de Manhattan**
3. En cas d'égalité, la première rencontrée dans l'ordre du pool (pas de départage par HP)

Il n'y a **pas** de priorité à la ligne de front : seules la LOS et la distance comptent.

Pour le **déplacement**, les candidats sont triés par distance de **Chebyshev** croissante et l'unité essaie chaque cible dans l'ordre : si le chemin vers la plus proche est bloqué, elle tente la suivante ; en dernier recours, `stepTowardOrNearest` la rapproche de la cible principale par la case libre voisine la plus proche.

Aucun hasard. Le combat est entièrement déterministe.

### Ligne de vue (LOS)

Une unité ne peut attaquer que si elle a **ligne de vue** sur sa cible (algorithme de Bresenham sur les cases bloquées du terrain). `findAttackTarget` préfère les cibles avec LOS ; si aucune n'est accessible en LOS, l'unité continue à se déplacer vers la cible la plus proche jusqu'à obtenir LOS.

```js
canAttack(attacker, target, board) = isInAttackRange() && hasLineOfSight()
```

### Initiative et ordre de jeu

Au début de chaque step, les unités sont triées par :
1. `initiative` décroissante (haute initiative = agit en premier)
2. En cas d'égalité : `effectiveAttackSpeed()` décroissante (vitesse d'attaque la plus haute = agit en premier)
3. En cas d'égalité encore : `card_id` croissant (`localeCompare`)

Le 3ᵉ critère n'est pas cosmétique : c'est une valeur **absolue**, identique sur les deux clients PvP, là où l'ordre d'insertion dans le tableau ne l'est pas. Sans lui, deux unités aux stats égales pourraient agir dans un ordre différent de chaque côté et faire diverger la simulation.

### Portée des attaques

Toutes les unités utilisent la **distance de Manhattan** — `|dx| + |dy|` (4 directions cardinales uniquement, pas de diagonales).

```js
isInAttackRange(attacker, target) → manhattanDistance(pos, target.pos) <= attacker.range
```

---

## Movement

Pathfinding BFS implémenté dans `PathFinder.ts`.

Les unités ne peuvent pas se chevaucher.

Exception : les unités neutralisées peuvent temporairement rester jusqu'au nettoyage (elles ne bloquent pas le BFS).

Les **cases bloquées** (terrain permanent **et** glace temporaire) sont exclues par `Board.getNeighbors()` — le BFS les contourne automatiquement sans modification dans PathFinder.

`POWER_TELEPORT` est la seule exception au pathfinding : il déplace l'unité directement via `board.moveUnit`, sans BFS ni coût de déplacement.

L'occupancy du board doit toujours être mise à jour lors d'un déplacement :

```js
board.moveUnit(unit, to)  // met à jour grid + unit.position ensemble
```

---

## EnemyAI — Stratégie de placement

**Quand l'IA joue** : en dernier. Son placement n'a pas lieu à l'ouverture de la préparation mais au **lancement du combat** (`GameSession.startCombat` → `_placeEnemyUnits`, avant la purge des cimetières qui lui sert de matériaux) — donc quand le joueur tape PRÊT ou que le chrono tombe à 0. Le joueur pose son board sans adversaire à l'écran, puis voit l'IA arriver : `Scene3D.revealEnemyUnits` fait tomber les nouvelles unités en cascade (`refresh()` ne passe plus une fois en mode combat) et `GameController` retarde le premier step de la durée de la cascade. En PvP, `_placeEnemyUnits` est un no-op (board adverse reconstruit par `PvpController`) et `revealEnemyUnits` ne trouve rien à faire tomber : comportement inchangé.

L'IA place les unités en deux passes :
1. Cartes normales en premier (libèrent les matériaux potentiels)
2. Cartes à invocation spéciale (peuvent consommer les unités posées)

Arrangement post-placement (`rearrangeUnits`) :
- Unités mêlée (range ≤ 1) → rangées 7–8 (front)
- Unités à distance (range > 1) → rangées 9–10 (back)
- Ordre de colonnes : `[2, 1, 3, 0, 4]` (centre vers bords)
- HP le plus élevé → rangée la plus avancée dans chaque groupe
- Maximum 3 unités par rangée, débordement vers la rangée suivante

---

## Tooltip System

Mobile-first. Pas de dépendance au hover.

Comportement :

- Tap carte → afficher
- Tap unité → afficher
- Tap ailleurs → masquer

Instance globale unique : `components/tooltip/TooltipHost.tsx`, piloté par `uiStore.tooltip` (`{ content, anchor }`) — remplace l'ancien singleton DOM `Tooltip.js`. La fermeture au tap ailleurs est gérée au niveau de `App`, et `navigate()` remet `tooltip` à `null`.

Contenu : nom, stats, pouvoir, attributs, coût d'invocation, lignée (🧬).

---

## Drag & Drop

Repositionnement d'unités pendant la préparation.

Implémenté avec Pointer Events API :
- `pointerdown`, `pointermove`, `pointerup`
- Unifie click et touch

Validation `board.isOccupied(pos)` avant le drop.

---

## DeckBuilder

- **Unicité** : une carte ne peut figurer qu'**une seule fois** dans un deck (cohérent avec la règle du doublon, qui interdit deux exemplaires vivants de la même `card_id` sur le board). Dans la bibliothèque, une carte déjà prise est intapable, grisée et liserée d'or ; un tier plein est grisé franc.
- Maximum par tier : `min(8, pool_size)` cartes
- Minimum pour sauvegarder : **20 cartes au total** (réparties librement entre les tiers, aucun minimum par tier)

Validation bloquante : le deck ne peut être sauvegardé que si le nom est renseigné et que le total ≥ 20.

Mode édition : déclenché via `DeckRepository.setPendingEdit(deckName)` avant de naviguer vers DeckBuilder. Les decks enregistrés **avant** la règle d'unicité sont dédoublonnés au chargement, avec un bandeau qui l'annonce (le total change à l'écran, le joueur ne doit pas avoir à le deviner).

⚠️ **`CardTile` en `tapOn="up"`** (DeckBuilder) n'arme le tap que si le `pointerdown` a eu lieu **sur la vignette**. Sans ce garde-fou, un relâchement dont l'appui vient d'ailleurs déclenche l'action : les boutons du DeckSelector naviguant au `pointerdown`, le `pointerup` retombait sur la grille fraîchement montée et ajoutait une carte au deck à l'ouverture de l'écran.

---

## Deck actif & DeckSelector

**Le deck du joueur se choisit à un seul endroit** : la **pastille du deck actif** du menu principal (couleur + nom + nombre de cartes, `ActiveDeckPill` dans `MainMenu.tsx`, à côté du profil) ouvre `DeckSelector` en `params.mode = 'manage'`. C'est le seul accès — pas de bouton « Mes decks » en double, la pastille disant déjà avec quoi on joue. Un tap sur un deck le promeut **deck actif** (`DeckRepository.setActiveDeck`), et c'est ce deck que jouent **tous** les modes — partie solo, tournoi, duel en ligne.

`DeckSelector` (`screens/DeckSelector.tsx`) a donc exactement deux modes, avec la même carte de deck — mais **pas la même liste** :

| `params.mode` | Ouvert par | Liste affichée | Rôle | Action du bas |
|---|---|---|---|---|
| `'manage'` | la pastille du deck actif | les decks du **joueur** (`deckStore`) | Choisir le deck **actif** + gérer (éditer → DeckBuilder, dupliquer, renommer, supprimer) | ＋ Créer un nouveau deck |
| `'play'` | « Jouer » | les decks **publics** (`PublicDeckDatabase`, `GET /api/decks`) | Choisir **uniquement le deck de l'IA** ; le deck du joueur est le deck actif, rappelé en récap non modifiable | ⚔ Jouer [contre X] → `navigate('game', { deckName: actif, enemyDeckName, enemyDeck })` |

- **L'adversaire solo se choisit parmi les decks publics, jamais parmi ceux du joueur** — les mêmes que ceux du Tournoi : un adversaire est un archétype construit, pas un brouillon de collection (et faire jouer l'IA avec un deck à moitié fini n'a d'intérêt pour personne).
- Le deck public **voyage en clair** dans les params (`enemyDeck`), pas seulement par son nom : il ne vit pas dans `DeckRepository`, `GameScreen` ne pourrait pas le recharger. `enemyDeckName` n'est plus qu'un libellé (et le repli historique sur un deck local, si jamais seul le nom arrive).
- Les actions de gestion n'apparaissent qu'en `'manage'` : en partie solo, la carte de deck ne sert qu'à désigner l'adversaire. Elles sont réduites à des icônes (✏️ éditer, 📋 dupliquer, 🏷️ renommer, 🗑️ supprimer) ; le libellé vit dans `title` + `aria-label` (`IconButton`, local à l'écran).
- La liste passe à **2 colonnes dès `sm`, 3 dès `lg`** (grille Tailwind sur la largeur, pas `useWebLayout` qui raisonne en ratio : trois colonnes tiennent à la largeur disponible, pas à l'orientation).
- Deux raccourcis en tête de la section « DECK DE L'IA » (mode `'play'`) : **`🪞 Miroir`** (état par défaut, `enemyId = null` → l'IA joue le deck du joueur) et **`🎲 Aléatoire`** (action : tire un deck public jouable au hasard, affiché comme un choix normal ; re-taper relance le tirage, en évitant le tirage précédent tant qu'il y a le choix). Ne retient que les decks ≥ 20 cartes.
- **Garde-fou** : sans deck actif, ou si celui-ci fait moins de 20 cartes, le lancement est bloqué (bouton désactivé + rappel).
- Le mode est propagé au DeckBuilder pour que son retour revienne dans le contexte d'origine. À l'enregistrement, `DeckBuilder` adopte le deck comme actif s'il n'y en a pas de valide (`hasActiveDeck()`) — sinon un premier deck créé ne serait jouable nulle part.
```js
buildSession(deckName, 'ai', enemyDeckName, enemyDeck)   // les deux absents → l'IA joue le deck du joueur (miroir)
```

### Avatars des decks publics

Un deck public porte un **portrait** — c'est le visage de l'adversaire, en sélection solo comme dans le bracket de tournoi. Fichiers dans **`resources/enemy_avatars/<DECK_ID>.png`** (`AVATARS_DIR`, surchargeable en prod), servis par `GET /avatars/:id`.

- **Le repli est serveur, pas client** : `/avatars/:id` renvoie `PUBLIC_DECK_000.png` quand le deck n'a pas le sien. L'URL est donc toujours affichable et aucun écran n'a de branche « pas d'avatar » — `PublicDeckDatabase.avatarUrl(id)` la construit, point final. `_has_avatar` (calculé dans `GET /api/decks`, jamais persisté) ne sert qu'à l'admin, pour distinguer « son portrait » de « le portrait par défaut ».
- L'id d'un asset sert de nom de fichier : `safeAssetId()` refuse tout ce qui n'est pas `[A-Za-z0-9_-]+` (400), sinon `../` remonterait l'arborescence.
- **Admin** (onglet Decks publics) : boîte d'illustration cliquable → import par URL ou depuis l'appareil, suppression. Même triptyque que les illustrations de cartes. L'URL étant stable, le remplacement d'un avatar s'accompagne d'un cache-buster (`avatarBust`), sans quoi le navigateur continuerait d'afficher l'ancien.
- **Déploiement** : `resources/` est gitignoré — les avatars voyagent par `scripts/sync-data.js` (clé `avatars` de `/api/export`, routes `/api/avatars/:id`), exactement comme les illustrations ; `--no-illustrations` coupe les deux. Le `bootstrap()` du serveur dépose l'avatar par défaut sur le volume s'il n'y est pas.
- **Affichage** : `DeckSelector` en mode `'play'` (vignette 36 px sur la carte de deck, à la place de la pastille de couleur, réservée aux decks du joueur) et `TournamentScreen` (`Portrait`, dans chaque slot de match et sur le champion). Dans le bracket, le joueur est représenté par son **avatar de profil** (ou ★ en invité) : sept portraits et un trou se lirait comme un bug.
- `logic/Tournament.js` transporte un `avatarId` sur chaque participant et **ne construit aucune URL** — la couche logique ignore qu'il existe des images.

**Tournoi et Duel en ligne n'ont plus d'étape de sélection** : le menu y entre directement et les deux écrans consomment `getActiveDeck()`. Ils partagent le même en-tête (retour `◂`, titre, `deck : X` à droite — dans `OnlineLobby`, le `◂` passe par `cancel()` pour sortir de la file) et n'affichent qu'un récap **en lecture seule** (`components/deck/SelectedDeck.tsx`). Seul cas navigable de ce composant : aucun deck actif → CTA « Mes decks », pour ne pas laisser l'écran en cul-de-sac. Un tournoi déjà lancé garde le deck figé dans son bracket (`tournament.playerDeckName`) : changer de deck actif ensuite ne l'affecte pas.

---

## TestBench

Écran développeur (`client/src/dev/TestBench.tsx`, route `?screen=testbench`) accessible depuis `MainMenu` (bouton "TestBench (dev)"). Réutilise `Scene3D` + `CombatAnimator3D` directement (sans `GameController`).

Différences avec l'écran de jeu :
- Placement libre pour les deux équipes (pas de règles d'invocation, pas de main, pas de deck)
- Filtre par `summon_type` dans le browser de cartes
- Suppression d'une unité par clic droit (ou long press mobile)
- Pas de tours, pas de HP joueur, pas de multiplicateur
- Board inspector : overlay live avec stats de toutes les unités pendant le combat
- Unités ennemies masquées visuellement en phase de préparation post-combat
- Bouton Pause pour le combat
- **Sélecteur de terrain** : dropdown `🗺️` pour choisir un board manuellement — cases bloquées visibles immédiatement, effets appliqués au lancement du combat, bouton ℹ pour afficher le tooltip du terrain

---

## Mode 3D

Rendu du board en Three.js (WebGL + CSS3D). **Three.js est une dépendance npm** (`client/package.json`, `three` + `@types/three`), résolue par Vite — plus d'importmap CDN. `Scene3D` (`client/src/three/Scene3D.ts`) possède la scène, le renderer WebGL et le `CSS3DRenderer` (importés depuis le paquet `three`) ; `CombatAnimator3D` consomme les événements de `CombatManager` et applique les animations.

Un seul pont React ↔ Three : `client/src/components/board/Board3DCanvas.tsx` monte un `<canvas>`, instancie `Scene3D` et délègue tout le rendu (pas de react-three-fiber).

### Navigation client

Écrans routés par `uiStore.screen` (Zustand, parité `?screen=`, pas de react-router) : `main_menu`, `auth`, `reset_password`, `profile`, `friends`, `deck_selector`, `deck_builder`, `tournament`, `missions`, `shop`, `online_lobby`, `game`, `game_pvp`, `combatlab` (dev), `testbench` (dev).

### Online (Phase 7)

- **Auth optionnelle** (`authStore`) : jeu jouable en invité ; se connecter active la synchro serveur des decks. `AuthScreen`/`ResetPasswordScreen`, `ProfileScreen`, `FriendsScreen` sur les API `routes/online.js`.
- **Tournoi** (`TournamentScreen`) : bracket local à 8 entièrement client (`logic/Tournament.js`), élimination directe, chaque match en Bo5. Le deck engagé est le **deck actif** (choisi au menu, aucune sélection ici) et est figé dans le bracket au lancement.
  - Les matchs **entre IA** sont simulés (`MatchSimulator`, headless déterministe), résolus dès l'ouverture d'un round.
  - Les matchs **du joueur** se **jouent** : chaque manche du Bo5 lance une vraie partie solo (`GameScreen` avec `params.tournament`), contre le deck public de l'adversaire injecté via `buildSession(..., enemyDeck)`. Le résultat est reporté dans le bracket au retour (`tournamentStore.finishGame`) : victoire/défaite créditée, égalité non comptée (manche rejouée), abandon = manche concédée.
  - Le bracket vit dans `stores/tournamentStore.ts` (et non dans l'état du composant) : l'écran Tournoi est démonté pendant qu'on joue. `pendingGame` est le contrat entre les deux écrans — posé avant de naviguer, consommé au montage de `GameScreen`, soldé au retour.
- **PvP** (`OnlineLobby` + `GameScreenPvp` + `game/PvpController.ts`) : le lobby joue le **deck actif** (choisi au menu, aucune sélection ici), envoyé avec `queue:join`. Le serveur (`ws/`) fait matchmaking + relais **opaque** ; chaque client simule le combat localement (déterminisme → même vainqueur des deux côtés). L'adversaire est reconstruit **en miroir** (rows 7–10) depuis `net/PvpOpponentProvider.js`. `GameSession` a un mode `'pvp'` (pas d'EnemyAI, terrain convenu).

  **Parité avec le mode solo** : cimetière, menu d'options d'invocation et **Phase Shopping** sont présents en PvP. Le shopping n'est pas synchronisé — chaque joueur tire et applique ses magies localement ; le résultat est transmis à l'adversaire dans le payload `round:board_ready` du round suivant. Un chrono de 45 s le borne (passage automatique) pour ne pas bloquer l'adversaire à la barrière réseau ; le décalage résiduel est absorbé par la barrière `round:combat_start_ack`.

  **Contrat de déterminisme** : tout état persistant d'une unité doit voyager dans `round:board_ready`, sinon les deux clients simulent des combats différents. Le payload transporte par unité `card_id`, `position`, `veterancy_points`, `base` (stats de base, modifiées en permanence par les magies), `current_hp` (les PV ne se régénèrent pas entre rounds) et `shield` ; plus `player_hp` au niveau du message — chaque joueur est la source de vérité de ses propres PV (les magies globales type `player_hp_bonus` sont invisibles de l'adversaire). Verrouillé par `client/src/test/pvp.test.ts`.

---

## Correspondance ancienne archi (`game/`, supprimée) → nouvelle (`client/src/`)

L'ancien `GameScreen3D.js` mélangeait orchestration et rendu. La refonte le scinde ;
cette table sert de repère historique (le reste du document ne référence plus que
les chemins actuels) :

| Ancien (`game/`) | Nouveau (`client/src/`) | Rôle |
|---|---|---|
| `ui/screens/GameScreen3D.js` (orchestration) | `logic/GameSession.ts` | Boucle de jeu **headless pure** (deps data injectées) |
| `ui/screens/GameScreen3D.js` (glue UI) | `game/GameController.ts` | Session ↔ `Scene3D` ↔ stores Zustand |
| `ui/screens/GameScreen3D.js` (DOM) | `screens/GameScreen.tsx` + `components/` | Composants React (HUD, main, overlays, shopping…) |
| `rendering/Board3D.js` | `three/Scene3D.ts` | Scène Three (WebGL + CSS3D) |
| `logic/`, `data/`, `net/` | `logic/`, `data/`, `net/` (copiés, en cours de migration TS) | Inchangés fonctionnellement |
| `ui/screens/TestBench3D.js` | `dev/TestBench.tsx` | Banc de test dev |

La couche `logic/` reste **headless** : aucun import de React/Zustand/Three (garde-fous ESLint).

---

## Mobile Rules

- Pointer Events API sur tous les éléments interactifs (pas de `mousedown`/`touchstart` séparés)
- Tester sur Safari iOS en portrait (priorité)
- Portrait recommandé, **paysage jamais bloqué** : un téléphone tourné franchit le seuil d'aspect et bascule sur le **mode web** (rails latéraux + cadrage caméra correspondant), exactement comme un desktop
- `manifest.json` PWA : icône, nom, couleurs de thème
- Bouton plein écran (Fullscreen API)

### Cadrage préparation : portrait vs web

Le seuil est le même des deux côtés — écran plus large que haut (`useWebLayout`
côté React, `aspect > 1` dans `Scene3D._cameraFraming`) — et les deux **doivent
rester d'accord**, sinon les rails recouvrent le board.

| | Portrait (mobile) | Web (écran large — desktop, tablette, **téléphone en paysage**) |
|---|---|---|
| Main | bande horizontale en bas | rail vertical à gauche |
| Neutralisées | bandeau horizontal au-dessus de la main | rail vertical à droite |
| Bloc joueur | remonté à `PREP_FOCUS_Y` (40 % de la hauteur) | centré verticalement |
| Contrainte de cadrage | les 5 colonnes doivent tenir en largeur | idem, mais dans la largeur **moins les deux rails** (`WEB_RAIL_PX` = 208, à garder synchronisé avec le `w-52` des rails) |

---

## Important Design Rules

Toujours garder :

**Logique ≠ Visuel**

Les classes `logic/` ne doivent jamais :
- Manipuler le DOM
- Importer des composants UI
- Contenir de `requestAnimationFrame`

Les classes `ui/` ne doivent jamais contenir :
- Logique de combat
- Logique d'attribut
- Logique d'invocation

---

## Known Technical Lessons

Le board est la source de vérité.

Ne jamais déduire une position depuis la position d'un élément DOM.

Des bugs ont déjà découlé de désynchronisations entre :
- `unit.position`
- `board.grid`
- Position DOM

Lors d'un déplacement d'unité :

1. Mettre à jour `board.grid`
2. Mettre à jour `unit.position`
3. Animer visuellement

Dans cet ordre.

---

## Development Philosophy

Préférer :

- Systèmes simples
- Comportement déterministe
- Design data-driven
- UX mobile-friendly
- Zéro bundler tant que la complexité ne l'exige pas
- Standardiser un maximum, UI divisé en composants réutilisables

Éviter :

- Hasard caché
- State machines complexes
- Logique visuelle mélangée à la logique de jeu
- Styles inline

Le jeu doit ressembler à :

"TFT avec la cadence de Marvel Snap."
