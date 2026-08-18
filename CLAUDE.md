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

### Où vivent les images (`asset-dirs.js`)

`data/` et `resources/` sont **gitignorés** : ils ne sont pas dans l'image, et le conteneur est reconstruit à chaque déploiement. Tout ce qui doit survivre vit donc sur un **volume monté**, et un dossier d'assets mal résolu perd son contenu au déploiement suivant — panne invisible au démarrage, qui ne se constate qu'après coup.

**`asset-dirs.js`** (racine, ne requiert rien — donc chargeable par `server.js`, `sets.js` et `scripts/sync-data.js` sans cycle) est seul à décider de ces chemins :

```js
const ASSETS_ROOT = path.dirname(ILLUS_DIR);   // dev : <projet>/resources ; prod : le volume
BOARD_BG_DIR = process.env.BOARD_BG_DIR || path.join(ASSETS_ROOT, 'board_backgrounds')
```

- La racine se **déduit de `ILLUS_DIR`** au lieu d'être recalculée depuis le projet. C'est ce qui fait qu'une famille ajoutée plus tard suit le volume **sans nouvelle variable à régler** — l'inverse a coûté la disparition des fonds de terrain à chaque déploiement, leur `BOARD_BG_DIR` n'étant réglé nulle part.
- La variable par famille (`AVATARS_DIR`, `POSTERS_DIR`, `BOARD_BG_DIR`) reste **prioritaire** : une configuration existante n'est jamais contredite.
- `bootstrap()` trace au démarrage le chemin réel de chaque famille (`[assets] …`) et **avertit franchement** quand un dossier se trouve sous la racine du projet alors que `NODE_ENV=production` : c'est le test exact de la panne, pas une heuristique.

⚠️ `npm run sync:push` **supprime les images distantes absentes en local** — lancé depuis une machine dont une famille est vide, il l'efface en prod. Faire un `sync:pull` d'abord, ou `--dry-run`.

---

## Routes Express

| Route | Accès | Description |
|---|---|---|
| `GET /` | Public | Jeu (SPA React servi depuis `client/dist`) |
| `GET /admin` | Site admin | Card Manager (`admin.html`) |
| `GET /api/version` | Public | Version du build (`package.json`) |
| `GET /api/cards` | Public | 398 cartes, avec `_has_illustration` et `_starter` |
| `GET /api/attributes` | Public | Attributs |
| `GET /api/powers` | Public | Pouvoirs |
| `GET /api/boards` | Public | Terrains de combat |
| `GET /api/magies` | Public | Magies (Phase Shopping) |
| `GET /api/missions` | Public | Catalogue des missions quotidiennes |
| `GET /api/decks` | Public | Decks publics (`PublicDeckDatabase`), avec `_has_avatar` et `difficulty` (échelon Arcade) |
| `GET /api/sets` | Public | Packs de boutique, avec `_has_poster` |
| `GET /api/variants` | Public | Variantes d'illustration, avec `_has_illustration` |
| `GET /api/gifts` | Public | Catalogue des cadeaux ponctuels |
| `POST/PUT/DELETE /api/*` | Auth | Écriture admin |
| `GET /illustrations/:id` | Public | Art des cartes, terrains, magies **et variantes** (PNG sans extension, id gardé par `safeAssetId`) |
| `GET /avatars/:id` | Public | Avatar d'un deck public (repli sur l'avatar par défaut) |
| `GET /pack-posters/:id` | Public | Affiche d'un pack (404 s'il n'en a pas — pas d'affiche par défaut) |
| `GET /board-backgrounds/:id` | Public | Fond de grille d'un terrain (404 s'il n'en a pas — le décor par défaut reste) |
| `POST /api/cards/import` | Auth | Import en masse (mode skip/replace) |
| `POST /api/cards/:id/illustration` | Auth | Upload illustration (URL ou base64) |
| `POST /api/attributes/import` | Auth | Import attributs en masse |
| `POST /api/powers/import` | Auth | Import pouvoirs en masse |
| `POST /api/decks/import` | Site admin | Import decks publics en masse |
| `POST/PUT/DELETE /api/decks/:id/avatar` | Site admin | Avatar d'un deck public (URL / base64 / suppression) |
| `POST/PUT/DELETE /api/sets` \| `/api/sets/:id` | Site admin | CRUD des packs (réaligne le miroir `card.set`) |
| `POST /api/sets/import` | Site admin | Import packs en masse |
| `POST/PUT/DELETE /api/sets/:id/poster` | Site admin | Affiche d'un pack (URL / base64 / suppression) |
| `POST/PUT/DELETE /api/boards/:id/illustration` | Site admin | Illustration d'un terrain (URL / base64 / suppression) |
| `POST/PUT/DELETE /api/boards/:id/background` | Site admin | Fond de grille d'un terrain (URL / base64 / suppression) |
| `GET /api/export` | Auth | Export complet avec checksums illustrations, avatars, affiches de packs **et fonds de terrain** |
| `/api/admin/db/*` | Site admin | Inspection de la base SQLite (`routes/admin-db.js`) |

**Niveaux d'accès** : l'écriture sur `cards` / `attributes` / `powers` passe par le middleware d'auth générique ; `boards`, `magies`, `missions`, `decks` et `sets` exigent en plus `requireSiteAdmin` (`auth.js`).

### API en ligne (`routes/online.js`, montée sur `/api`)

| Route | Accès | Description |
|---|---|---|
| `POST /api/auth/register` \| `login` \| `logout` | Public (rate-limité) | Comptes |
| `GET /api/auth/me` | Optionnel | Session courante |
| `POST /api/auth/forgot-password` \| `reset-password` | Public (rate-limité) | Réinitialisation mot de passe |
| `GET/PUT /api/profile/me` | Connecté | Profil (pseudo, avatar — l'appartenance de l'avatar est vérifiée) |
| `GET /api/users/search` | Connecté | Recherche de joueurs |
| `GET /api/friends`, `GET /api/friends/requests` | Connecté | Liste d'amis / demandes |
| `POST /api/friends/request`, `POST /api/friends/:id/accept` \| `decline`, `DELETE /api/friends/:id` | Connecté | Gestion des amis |
| `GET/PUT /api/me/decks` | Connecté | Synchro serveur des decks (`DeckRepository.pull` / `flushSync`) |
| `GET /api/me/progression` | Connecté | Progression + collection + barème des paliers (`{ level, xp, gold, gems, unlocked_count, unlocked_cards, levels }`) |
| `POST /api/me/levels/claim` | Connecté | Récupère TOUS les paliers de niveau dus |
| `GET /api/me/missions` | Connecté | Missions du jour + jauge hebdomadaire (délivre les lots manquants) |
| `POST /api/me/missions/events` | Connecté | Lot d'événements de partie (voir Missions quotidiennes) |
| `POST /api/me/missions/:id/reroll` | Connecté | Reroll d'une mission |
| `GET /api/me/shop` | Connecté | Boutique du jour (emplacements, épingle, sets) — génère l'offre au passage |
| `POST /api/me/shop/buy` \| `reroll` \| `pin` \| `booster` | Connecté | Achat d'emplacement, reroll, épingle, ouverture de booster |
| `GET /api/me/cosmetics` | Connecté | Offre cosmétique du jour + cosmétiques possédés — génère l'offre au passage |
| `POST /api/me/cosmetics/buy` | Connecté | Achat d'un avatar ou d'une variante |
| `GET /api/me/arcade` | Connecté | Run Arcade du jour (parcours, échelon courant) — aligne la ligne sur le jour au passage |
| `POST /api/me/arcade/start` \| `duel` | Connecté | Lance la run du jour, solde un duel |
| `GET /api/me/gifts` | Connecté | Cadeau quotidien + cadeaux ponctuels éligibles |
| `POST /api/me/gifts/daily` | Connecté | Récupère le cadeau quotidien |
| `POST /api/me/gifts/:id/claim` | Connecté | Récupère un cadeau ponctuel |

Le PvP temps réel ne passe pas par HTTP : `ws/pvpServer.js` (matchmaking + relais opaque) sur `/ws`. Le message `match:found` (et `match:rejoined`) transporte les **variantes d'illustration** du deck adverse, dérivées côté serveur.

---

## Progression joueur (niveau, monnaies, collection)

Stockée en base (`db.js`), règles dans **`progression.js`** (racine — le serveur, pas le client) :

| Donnée | Colonne `users` | Défaut | Admin (`is_admin`) |
|---|---|---|---|
| Niveau | `level` | 1 | 100 |
| Expérience | `xp` | 0 | inchangée |
| Gold | `gold` | 0 | 9999 |
| Gemmes | `gems` | 0 | 9999 |
| Cartes débloquées | table `user_cards` | les cartes du **pack de départ** (à défaut : les `CORE_*`, 132) | **tout** le catalogue |

La dotation d'un compte neuf se **designe en admin** : c'est le pack marqué « départ » (`starter: true` dans `sets.json`), cf. « Le pack de départ » plus bas. `STARTER_PREFIX = 'CORE'` n'est plus que le repli quand aucun pack ne porte le drapeau — l'état des données livrées.

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
progression.grant(userId, { xp, gold, gems })   // crédit/débit relatif, plancher à 0 (fait monter `level`, ne DONNE rien)
progression.unlockedCardIds(user) / ownsCard(user, cardId) / getProgression(user)
progression.backfillAll()                 // rattrapage au boot (server.js, après bootstrap())
```

- **Le catalogue fait foi, pas la base** : `allCardIds()` lit `cards.json` (cache invalidé au mtime), donc une carte créée depuis l'admin est immédiatement débloquable.
- **Admins** : les cartes sont matérialisées en base *et* recalculées à la lecture (`unlockedCardIds`) — une carte ajoutée après la promotion leur appartient sans resynchronisation. Une rétrogradation ne dépouille pas le compte.
- `auth.publicUser()` expose `level/xp/gold/gems` et `pending_levels` (donc `/auth/me`, login, register) ; la **liste** des cartes, trop volumineuse, vit sur `GET /api/me/progression`.
- **Affichage** : `components/ui/ProgressionStats.tsx` — `<ProgressionPills>` (ligne compacte `Nv. 2 ▓▒░ 25/100 · 💰 · 💎`, menu principal sous l'identité, et en-tête des écrans secondaires en web) et `<ProgressionPanel>` (jauge pleine largeur + soldes, écran Profil). Les deux lisent `authStore.user`, **sans fetch** : les valeurs arrivent déjà avec la session. Rien n'est rendu en invité. Icônes et couleurs sont définies une seule fois (`CURRENCIES`) ; 💰 et non 🪙, qui retombe en disque gris faute de glyphe couleur.
- **La pastille de niveau mène au Profil** (prop `onOpen`, posée par `MainMenu` et `ScreenHeader`) : « combien me reste-t-il avant le prochain niveau » appelle immédiatement « et qu'est-ce que j'y gagne », dont la réponse est là-bas. Seule celle-là est tapable — un solde ne mène nulle part, et un `min-h-tap` sur les trois pastilles ferait deux lignes sous l'identité du menu.
- **L'XP n'a pas de compteur à elle** : elle n'existe qu'au travers de la jauge de niveau (primitive `Gauge`, 0 → 100), avec le décompte exact en petit sous la barre. C'est la seule lecture qui compte (« où j'en suis du palier ») là où un nombre nu ne dit rien sans son plafond. Gold et gemmes, eux, sont des **soldes** → chiffres.
- `XP_PER_LEVEL` est dupliqué côté client (`ProgressionStats.tsx`) — à garder synchronisé avec `progression.js` à la main. C'est la **seule** valeur dans ce cas : le barème des paliers, lui, voyage (cf. ci-dessous).

### Récompenses de palier de niveau (`levels.js`)

Ce que le passage d'un niveau **donne**. Règles dans **`levels.js`** (racine), état dans **`users.levels_claimed`**.

| Marche | Gain |
|---|---|
| **Chaque** niveau | **50 golds** |
| Tous les **5** niveaux | **50 gemmes** en plus |
| Tous les **10** niveaux | un **objet tiré au sort** en plus : carte, avatar ou variante |

Les trois marches se **cumulent** : le niveau 10 donne 50 golds + 50 gemmes + l'objet. C'est ce cumul qui fait du multiple de 10 un rendez-vous plutôt qu'un remplacement.

- 50 golds/niveau ne concurrencent pas les missions (650/jour) : un niveau vaut un dixième de journée de missions, c'est un bonus, pas un revenu. Les **gemmes**, elles, ne se gagnent qu'ici et aux paliers hebdomadaires — 50 tous les 5 niveaux = une variante d'illustration (50 💎) tous les 5 paliers.
- **Le gain se RÉCUPÈRE, il ne tombe pas** (`POST /api/me/levels/claim`), d'un tap dans la section Progression du **Profil** — même règle que les missions terminées et les cadeaux, et pour la même raison : un crédit automatique fait disparaître le gain sous les yeux du joueur. Un niveau se gagne n'importe où (fin de combat, lot de missions, cadeau) ; le geste, lui, tient à un seul endroit. **Rien ne périme un palier** — il n'y a aucune rotation ici, contrairement à la boutique.
- ⚠️ **`progression.grant` ne connaît PAS les paliers** : il fait monter `level`, un point c'est tout. La dette se **déduit à la lecture** (`level − levels_claimed`), il n'y a donc rien à brancher sur les sources d'XP — donc rien à oublier de brancher le jour où une source s'ajoute.
- **L'état tient en une colonne** : les paliers dus sont `levels_claimed + 1 … level`. C'est possible parce qu'un palier ne se saute pas — ils se récupèrent **dans l'ordre et tous à la fois**, le joueur n'a rien à arbitrer et il n'y a pas de file à stocker.
- ⚠️ **Un gain d'XP qui franchit plusieurs paliers les doit TOUS** (250 XP = 2 niveaux = 100 golds) : sauter l'intermédiaire dépouillerait le joueur qui joue rarement mais longtemps.
- ⚠️ **La garde anti-double-récupération est dans le SQL** (`stmt.claimLevels`), jamais en JS — même règle que `claimMission` et `claimGift`. C'est un **compare-and-swap** : `WHERE levels_claimed = @from AND level = @level`, pour qu'un niveau gagné entre la lecture et l'écriture ne soit pas soldé sans avoir été livré. Deux taps concurrents ne changent qu'une ligne, le second voit `changes === 0`. La marque est posée **avant** la livraison, le tout dans une transaction.
- ⚠️ **L'objet du palier de 10 est tiré AU MOMENT DU TAP**, pas quand le niveau est gagné : entre les deux, le joueur a pu acheter la carte ou le cosmétique que le tirage aurait mis de côté — c'est ce qui préserve le **zéro doublon**. Corollaire : ce qui attend est annoncé comme une surprise (`🎁 ×N`), jamais nommé d'avance.
- ⚠️ **Les niveaux posés d'autorité n'ouvrent aucun palier** : `applyAdminGrants` écrit `level: 100` puis aligne `levels_claimed` (`stmt.syncLevelsClaimed`), sinon un admin promu trouverait cent paliers rétroactifs à prendre.
- ⚠️ **Migration** : `users.levels_claimed` est ajoutée de façon additive, et **son absence est le marqueur d'une bascule qui ne doit tourner qu'une fois** — les comptes existants sont alignés sur leur niveau courant (`UPDATE users SET levels_claimed = level`). Sans elle, un joueur déjà niveau 40 ouvrirait l'écran sur quarante paliers rétroactifs, tirages d'objets compris. Même idiome que `user_missions.claimed_at`.
- **Le tirage n'a ni pool ni hasard à lui** : `shop.sellableCards` (donc illustration obligatoire — un palier qui révèle un cadre vide gâche son seul moment), `cosmetics.avatarPool` et `cosmetics.variantPool`, moins ce qui est déjà possédé. Déterministe à `(joueur, niveau)` (`shop.seededRandom`), comme la boutique.
- Les trois familles sont **équiprobables**, et le tirage se fait **entre celles qui ont encore un candidat** — sans ce filtre, un joueur ayant tout acheté d'une famille perdrait le palier une fois sur trois. Pondérer par valeur marchande (une carte à 500 golds contre un avatar à 5 gemmes) reviendrait à promettre surtout des avatars.
- **Une carte tirée est une carte achetée moins la caisse** : `progression.unlockCard` puis `shop.settleCollection` (épingle libérée, prime de complétion du pack terminé versée) — mêmes conséquences que pour un lot de cadeau.
- **Pool entièrement épuisé** (compte qui possède tout) → `item: null`, et **aucune compensation n'est inventée** : le palier verse ses monnaies et le dit. Un lot de repli ferait apparaître une seconde règle, invisible dans le barème affiché au joueur.
- ⚠️ **Règle de dépendances** : `levels.js` est un **puits**, comme `gifts.js` — il requiert `shop.js`, `cosmetics.js` et `progression.js`, aucun ne doit le requérir en retour. C'est aussi pourquoi la dette se déduit au lieu d'être versée par `grant` : `progression.js` n'a jamais à charger les pools du tirage. Seul `auth.js` gagne une dépendance vers `progression.js`, pour la seule dette (`pending_levels` de `publicUser`).

**Client** — rien de tout ça n'est recopié : le barème **voyage** dans `GET /api/me/progression` (`levels.preview` → `rules`, `pending`, `pending_totals`, `upcoming` (4 paliers), `next_gems_level`, `next_draw_level`).

- **`pending_levels` voyage avec CHAQUE réponse qui crédite** (`progression.getProgression`, donc aussi `auth.publicUser` → `/auth/me`, login, register) : la pastille est juste à la seconde où le niveau est gagné, sans second appel.
- `components/ui/ProgressionStats.tsx` — `<LevelRewardsPanel>` porte le **bouton Récupérer** (annonçant le total dû) au-dessus de la règle et des 4 prochains paliers : c'est la seule chose actionnable de l'écran. La **révélation** passe par `createPortal(…, document.body)` — déclenchée depuis un `Panel`, qui porte `backdrop-blur`, elle serait sinon rognée dans sa colonne (cf. `ConfirmBuy`, `GiftReveal`).
- `screens/ProfileScreen.tsx` — le panneau sous la jauge : la règle en une phrase, les 4 prochains paliers (celui à objet souligné), et les deux rendez-vous en clair (la liste ne va pas toujours assez loin — un objet peut être à 10 niveaux). Pas de store dédié : la donnée ne sert qu'à cet écran, et l'écran la recharge après un tap.
- **Pastille verte chiffrée sur la pastille de niveau** (menu et en-tête) quand des paliers attendent : le même `CountBadge` que Missions et Cadeaux, et il ne s'efface pas à la visite mais quand tout est récupéré. Elle prend la place du décompte d'XP plutôt que de s'y ajouter — une quatrième valeur ferait déborder la pastille sur deux lignes.
- **Toast** : celui des missions, pas un second (`components/ui/RewardToasts.tsx`, cf. Missions) — un niveau gagné annonce « à récupérer » exactement comme une mission terminée. Il ne dit pas ce que le palier contient : l'objet n'existe pas encore. Le niveau franchi est **lu des deux instantanés** par `authStore.applyProgression` (`from`/`to`), il n'est pas transmis : le serveur ne dit que l'état. Toutes les réponses qui créditent de l'XP y passent (solo, tournoi, PvP, missions, arcade, cadeaux), il n'y a donc pas d'autre point de branchement à tenir à jour.
- Verrouillé par `client/src/test/levels.test.ts` (30 golden tests, même harnais serveur que `gifts.test.ts` ; catalogues lus depuis `initial-data/`, et une carte volontairement laissée **sans art** — elle ne doit jamais tomber).

## Missions quotidiennes

Règles dans **`missions.js`** (racine, à côté de `progression.js` dont il est le client pour créditer les gains), catalogue dans **`data/missions.json`**, tables `user_missions` / `user_mission_state`.

| Règle | Valeur |
|---|---|
| Missions délivrées par cycle | **2** — deux difficultés sur trois, par **rotation** du créneau |
| Cycle | **8 h**, ancré sur 5 h → **5 h / 13 h / 21 h**, dans le fuseau du **serveur** |
| Accumulation | **6** missions actives maximum (= 3 cycles, soit 24 h d'absence pardonnées) |
| Reroll | 1 gratuit par **jour**, puis **100 golds** (jamais en gemmes) |
| Jauge hebdomadaire | **25** points — 1 par mission **récupérée**, semaine du lundi |
| Paliers hebdo | **5 / 10 / 15 / 20 / 25** (un tous les 5, modèle Marvel Snap) |

**Rotation des difficultés** (`SLOT_ROTATION`, `slotsForCycle`) : deux missions par cycle mais trois difficultés — la paire tourne avec le créneau (`[1,2]` → `[2,3]` → `[3,1]`), elle n'est **pas tirée au hasard**. Sur trois cycles consécutifs — soit exactement une journée, et exactement le plafond d'accumulation — chaque difficulté sort **deux fois** : le joueur qui rattrape 24 h d'absence reçoit la même chose que celui qui est passé aux trois rendez-vous. Un lot rattrapé garde donc la paire de **son** cycle, pas celle du cycle d'arrivée.

**Barème** (`SLOT_REWARDS`, `WEEKLY_MILESTONES`) :

| Slot | XP | Golds | | Palier | XP | Golds | Gemmes |
|---|---|---|---|---|---|---|---|
| Facile (1) | 6 | 50 | | 5 pts | 3 | 100 | 5 |
| Moyen (2) | 10 | 100 | | 10 pts | 5 | 150 | 10 |
| Engagé (3) | 15 | 175 | | 15 pts | 6 | 175 | 15 |
| | | | | 20 pts | 8 | 200 | 20 |
| | | | | 25 pts | 13 | 275 | 35 |

La **dotation hebdomadaire totale est inchangée** par le passage de 3 à 5 paliers — 35 XP / 900 golds / 85 gemmes, comme le barème 10/20/30 précédent — simplement redistribuée sur cinq marches croissantes, la dernière portant la prime : c'est elle qui doit tirer la semaine, sinon la jauge s'abandonne une fois l'avant-dernier palier passé. Verrouillé par golden test (montants croissants, total exact).

⚠️ **Le revenu quotidien des missions baisse d'un tiers** (6 missions/jour au lieu de 9 : 650 golds et 62 XP par jour au lieu de 975 et 93). C'est la conséquence assumée du plafond à 6 — le barème par mission, lui, n'a pas bougé.

⚠️ **Écart assumé avec le brief** (§5.1 : 60 / 100 / 150 par mission, 50 / 100 / 200 par palier) : **toute l'XP des missions est divisée par 10**, missions et paliers hebdomadaires ; golds et gemmes sont inchangés. À 60 XP la mission, une journée de missions valait plus de six victoires PvP (`pvp_win` = 70) — le niveau se serait gagné en écran de menu plutôt qu'en jeu. **Les missions restent la source de golds** ; l'XP, elle, se gagne en jouant.

**Calendrier** : `cycleKey(ts)` → `2026-07-27#1` (jour de mission + rang du créneau) ; `cycleNumber(key)` en donne un rang **absolu** pour que `cyclesBetween` fonctionne de part et d'autre de minuit. Le reroll gratuit et la purge des missions terminées restent indexés sur la **journée** (`dayKey`) : une mission bouclée à 12 h 55 ne doit pas disparaître de l'écran à 13 h. Une clé d'état sans `#` (antérieure aux cycles) est lue comme le premier créneau de sa journée — le joueur reçoit les cycles écoulés depuis, il n'y a pas de migration à écrire.

- **Le gain d'une mission se RÉCUPÈRE** (`POST /api/me/missions/:id/claim`), d'un tap sur sa carte : `active` → `completed` (terminée, gain en attente) → `claimed` (soldée). Le crédit ne se déplace que dans le temps — le client désigne une **ligne**, jamais un montant, et le barème reste `SLOT_REWARDS`.
  - ⚠️ **Une mission terminée mais non récupérée n'est jamais purgée** : `deleteStaleClaimedMissions` n'emporte au reset que les **soldées**. Sans cette règle, la récupération manuelle ferait perdre le gain d'un joueur qui quitte le jeu sans repasser par l'écran — exactement ce que le crédit automatique évitait.
  - La garde anti-double-crédit est **dans le SQL** (`… WHERE id = ? AND status = 'completed'`) : deux taps concurrents ne changent qu'une ligne, le second appel voit `changes === 0` et ne crédite rien.
  - **La jauge hebdomadaire avance elle aussi au tap** : +1 point par mission **récupérée**, pas par mission terminée. C'est ce décalage qui la fait bouger sous les yeux du joueur au moment du geste, au lieu d'être déjà remplie à l'ouverture de l'écran (`Gauge` anime sa largeur sur 300 ms). Le point n'est jamais perdu pour autant — une mission terminée attend indéfiniment, cf. la purge ci-dessus : le crédit est **différé, pas confisqué**.
  - **Un palier hebdomadaire se récupère pareil** (`POST /api/me/missions/weekly/:points/claim`), en tapant sa pastille. La mission qui le franchit ne fait que le rendre **récupérable** (`claim` → `unlocked`, pour l'annonce), elle ne le verse pas.
  - ⚠️ **Un palier atteint et jamais réclamé est soldé d'office au changement de semaine**, avant la remise à zéro (`sync`). Une jauge qui repart de zéro ne peut pas porter ses restes d'une semaine à l'autre comme le fait une mission terminée : on règle donc l'ardoise **à la frontière** plutôt que de traîner un état en travers, et aucun gain mérité n'est confisqué. Le tap reste le geste normal ; ce n'est que le filet, et il est silencieux.
  - **Aucune migration** pour les paliers : `weekly_claimed` gardait déjà le sens « paliers **payés** », seul le moment du paiement change (au tap, non plus au franchissement).
  - ⚠️ Corollaire assumé : thésauriser des missions terminées pour les récupérer d'un bloc concentre la jauge sur une seule semaine, donc monte plus haut dans l'échelle qu'en étalant. Ça ne crée aucune valeur (une mission = 1 point, plafond 25) et ça coûte la liquidité du gain — non traité.
  - ⚠️ **Migration** : `user_missions.claimed_at` est ajoutée de façon additive (idiome `PRAGMA table_info` de `db.js`), et **son absence est le marqueur d'une bascule qui ne doit tourner qu'une fois** — les missions `completed` de l'ère « crédit automatique » ont déjà été payées et passent en `claimed` au même moment. Un `UPDATE` rejoué à chaque démarrage volerait, lui, les missions légitimement en attente.
- **Le fuseau du reset est celui du serveur**, pas du joueur : un client qui annonce son fuseau pourrait en mentir pour se faire délivrer un cycle de plus. Déployer avec `TZ=Europe/Paris`.
- Les missions **terminées restent affichées** jusqu'à la fin de la journée (`deleteStaleCompletedMissions`), puis s'effacent. Le plafond de 6 ne compte que les **actives**.
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
| `POST /api/me/missions/events` | Connecté (30/min) | Lot d'événements → `{ countable, completed, … }`. **Ne crédite rien et ne touche pas à la jauge** : les missions terminées y sont annoncées, pas soldées |
| `POST /api/me/missions/:id/claim` | Connecté (30/min) | Solde une mission terminée : gain + 1 point de semaine → `{ granted, unlocked, mission, … }` (`unlocked` = paliers rendus récupérables, pas versés) |
| `POST /api/me/missions/weekly/:points/claim` | Connecté (30/min) | Solde un palier **atteint** → `{ granted, milestone, … }`. Le segment `weekly/` supplémentaire évite la collision avec `:id/claim`, que seul l'ordre d'enregistrement départagerait |
| `POST /api/me/missions/:id/reroll` | Connecté (20/min) | Remplace une mission par une autre du même slot |

**Catalogue** (`data/missions.json`, distinct des routes de progression joueur ci-dessus) : CRUD admin sur le modèle des magies, gating identique.

| Route | Accès | Description |
|---|---|---|
| `GET /api/missions` | Public | Liste le catalogue des missions |
| `POST /api/missions` | Site admin | Créer une mission |
| `POST /api/missions/import` | Site admin | Import en masse (mode skip/replace) |
| `PUT /api/missions/:id` | Site admin | Modifier une mission |
| `DELETE /api/missions/:id` | Site admin | Supprimer une mission |

Onglet **Missions** de `admin.html` (Card Manager) : liste + formulaire (champs de filtre conditionnels selon `objective.event`, sur le modèle de l'onglet Magies). Le cache mémoire de `missions.js` (`catalog()`, invalidé au mtime du fichier) prend en compte les écritures admin sans redémarrage serveur.

### Client

- `stores/missionStore.ts` — instantané + file d'événements (`startMatch` / `emit` / `emitCombatStarted` / `flushMatch` / `emitMeta`), plus `claim(id)` et le sélecteur `claimableCount(snapshot)`. Le **nombre de gains en attente est dérivé des `status`, jamais transmis** — une valeur dérivée qu'on transporte est une valeur qui peut contredire sa source.
- `screens/MissionsScreen.tsx` — jauge hebdomadaire avec jalons posés à leur position réelle sur la barre, **pastille de palier tapable** quand il est atteint (bouton 🎁 vert plein ; les autres restent des pastilles inertes), cartes de mission, reroll. Une carte terminée affiche un bouton **Récupérer** pleine largeur (le gain est la seule chose à y faire, il ne se dispute pas la place avec le dé) ; une fois soldée, elle retombe en vert éteint. Une cible de 1 n'affiche pas de barre de progression (elle serait toujours vide ou pleine).
- `components/ui/RewardToasts.tsx` — **le** hub de toasts du jeu : missions terminées, paliers hebdomadaires et niveaux gagnés (`levels.js`) s'y annoncent ensemble, seule l'icône les distingue (🎯 / 🏅 / ⬆). Monté au niveau de **l'App**, pas d'un écran : la réponse du lot arrive souvent une fois revenu au menu. Positionné à la hauteur de `Banner` (`top-16`) pour ne pas recouvrir la barre de PV. Reste **non interactif** : un toast qui se solde au tap se solderait aussi à côté, en pleine partie, sur un geste destiné au board — il annonce « à récupérer », il ne remet rien. ⚠️ Chaque file reste dans **son** store (`missionStore.toasts`, `authStore.levelToasts`) : le composant les rend ensemble, il ne se les approprie pas.
- `MainMenu` — bouton `🎯 Missions` avec **les deux** notifications du jeu, définies une fois pour toutes dans les primitives (`CountBadge` / `NewDot`, partagées par Missions, Cadeaux, Arcade, Boutique, Tutoriel et les paliers de niveau) : une pastille **verte chiffrée** quand des gains attendent (un compteur, pas un point : la valeur est dénombrable et actionnable — elle ne s'efface qu'une fois tout récupéré, pas à la visite), et à défaut le **point doré** « cycle pas encore vu », effacé à la visite comme celui de la Boutique. La verte prime, et elle compte **missions terminées + paliers atteints** (`claimableCount` = `claimableMissions` + `claimableMilestones`). Rien n'est rendu en invité : le cycle a besoin d'un compte.

### Collection & DeckBuilder

Le DeckBuilder ne laisse sélectionner que les cartes **possédées** (`stores/collectionStore.ts`, alimenté par `GET /api/me/progression`) :

- Les cartes non débloquées sont **masquées par défaut** ; le chip `🔒 Verrouillées` les révèle, grisées et intapables (cadenas via la prop `locked` de `CardTile`). Le compteur affiche `133/398 cartes débloquées`.
- `addCard` revérifie la possession : l'ajout ne dépend jamais du seul état d'affichage.
- **Invité** : repli sur les cartes de départ, reconnues au drapeau `_starter` de `GET /api/cards` (préfixe `CORE_*` en second repli) — exactement la dotation d'un compte neuf. Le jeu se joue sans compte — un invité sans aucune carte ne pourrait plus construire de deck, et ce qu'il bâtit reste valable s'il s'inscrit.
- Un deck **déjà enregistré** contenant des cartes non possédées n'est **pas** amputé au chargement : les cartes concernées sont signalées (cadenas + bandeau) et restent retirables à la main. Effacer le travail du joueur sans qu'il l'ait demandé serait pire que l'incohérence.
- La table `user_cards` est créée **après** la migration `tag` de `users` : un `ALTER TABLE … RENAME` réécrit les FK des tables dépendantes vers `users_v1`, qui est ensuite supprimée (même raison pour le correctif FK de `sessions`/`friendships`/`deck_books`/`reset_tokens`/`matches`).

---

## Boutique de cartes

Règles dans **`shop.js`** (racine, à côté de `progression.js` dont il est le client pour débiter et débloquer, et de `missions.js` dont il reprend le calendrier), catalogue de packs dans **`sets.js`** (qui lit `data/sets.json`), table `user_shop_state`. La boutique **cosmétique** est un second onglet du même écran — voir « Boutique cosmétique » plus bas.

⚠️ **Écart assumé avec le brief** : la **Convoitise** (§3.5 — épingler n'importe quelle carte du catalogue, 3 jours d'attente, prix double) n'existe pas. Elle est remplacée par l'**épingle d'un emplacement proposé**, qui le conserve à la rotation suivante. La précision absolue disparaît donc du jeu : on ne commande plus une carte, on garde une proposition.

Deux systèmes, deux fonctions qui ne se recouvrent pas :

| Système | Fonction | Plafond |
|---|---|---|
| **Emplacements quotidiens** | Vitrine à l'unité — tirage libre dans tout le pool non possédé | 6 / jour, dont 1 épinglable |
| **Booster** | Collection — volume brut sur un set choisi | aucun |

Trois invariants portent tout le reste :

1. **Zéro doublon** — aucun tirage, nulle part, ne produit une carte possédée. C'est ce qui dispense le jeu de poussière, de fragments et de conversion de doublons. C'est aussi, désormais, la **seule** contrainte qui pèse sur un tirage : emplacements comme boosters tirent **uniformément** dans leur pool non possédé, sans poids de tier, sans affinité, sans garantie de composition (`shop.pick`).
2. **L'offre est serveur** — générée, horodatée et **persistée** (`user_shop_state.offer`). Aucune action client (changement de deck, rechargement, fuseau annoncé) ne la régénère : une offre re-tirable se re-tirerait jusqu'à satisfaction. Vérifié par golden test.
3. **Une carte sans illustration ne se vend pas** — ce qu'on met en vitrine, c'est une image : un emplacement à 500 golds sur un cadre vide ne donne rien à vouloir, et un booster qui la révèle gâche son seul moment.

### Le catalogue vendable (`shop.sellableCards`)

`hasArt(id)` s'appuie sur **`variants.illustrationExists`** — le test générique « cet id a-t-il son PNG ? », cartes / terrains / magies / variantes partageant l'espace de noms plat du dossier d'illustrations (`cosmetics.js` s'en sert déjà pour composer son pool d'avatars). Aucun drapeau persisté : la règle porte sur le **fichier**, une illustration ajoutée depuis l'admin rend la carte vendable sans redémarrage.

Le filtre ne vit **pas** qu'à l'entrée du tirage : les **cinq** lectures de la boutique partagent le même pool, faute de quoi elles se contrediraient.

| Endroit | Sans le filtre |
|---|---|
| `drawablePool` (emplacements, reroll) | une carte sans art en vitrine à 500 golds |
| `buildOffer` (report de l'épingle) | l'art retiré en admin, la vitrine remet quand même la carte |
| `buyBooster` (pool du pack) | la carte tombe au booster, révélée sur un cadre vide |
| `setsView` (`card_count` / `owned_count` / `complete`) | « 55/57 » sur un pack dont les 2 dernières cartes ne peuvent plus sortir |
| `claimSetCompletions` | pack jamais complet → **prime jamais versée** |
| `collection` (l'instantané) | le compteur n'atteint jamais son total, la vitrine se vide avant |

⚠️ La **dotation** d'un compte neuf n'est pas concernée (`progression.starterCardIds`) : elle est offerte, pas vendue. Corollaire : une carte de départ sans art reste **possédée** mais n'est comptée ni au numérateur ni au dénominateur du compteur de collection — sans quoi un compte neuf afficherait plus de cartes possédées que le total vendable.

⚠️ **L'offre du jour reste figée** : une illustration retirée en admin en cours de journée ne retire pas l'emplacement déjà tiré (il reste achetable jusqu'à la rotation). Seule l'**épingle**, qui est un report explicite, est refusée au passage suivant.

### Les packs — `sets.js` + onglet Packs de l'admin

Le préfixe d'`id` (`CORE`, `EXTRA`, `YGX`…) est un identifiant technique, pas un axe commercial : les groupes vont de 8 à 32 cartes, sans rapport avec ce qu'on veut vendre ensemble. Chaque carte porte donc un champ **`set`**, et `data/sets.json` décrit les packs (nom, archétypes, `booster_enabled`, `starter`, `signature_card`, `completion_reward`, liste `cards`).

**Vocabulaire** : le code et la donnée disent `set` (`sets.json`, `card.set`, `/api/sets`, `shop.setCardIds`) ; l'**interface dit « pack »** — admin comme boutique. Les deux désignent la même chose.

**`sets.js`** (racine) est le propriétaire du catalogue. Il existe pour une raison de dépendances : `shop.js` (boosters) et `progression.js` (dotation) en ont tous deux besoin, et `shop.js` requiert déjà `progression.js` — le cycle serait immédiat. D'où la règle : **`sets.js` ne requiert ni l'un ni l'autre**.

```js
sets.all() / byId(id) / cardIdsOf(def)        // catalogue (cache mémoire au mtime)
sets.isStarter(def) / starterPacks() / starterCardIds()
sets.boosterPacks()                          // = tout sauf les packs de départ
sets.posterExists(id) / sets.POSTERS_DIR
```

`shop.sets` **est** `sets.boosterPacks` et `shop.setCardIds` **est** `sets.cardIdsOf` (mêmes noms exportés qu'avant : les golden tests les appellent directement).

**Les packs se designent depuis l'admin** (onglet 🎁 Packs) : nom, **affiche**, composition carte par carte (sélecteur plein écran avec filtres tier/type/attribut/appartenance et compteurs live), drapeau « pack de départ », `booster_enabled`. À l'enregistrement, `card_count` et `archetypes` (le sous-titre affiché en boutique) sont **dérivés** de la composition, jamais saisis.

Le découpage livré reste celui de `scripts/build-sets.js` (7 packs de ~57 cartes), désormais un simple **point de départ éditable** — attention, son `--write` réécrit `sets.json` *et* les 398 champs `set` : il écrase le travail fait en admin. Ce qu'il garantit et ce qu'il ne garantit pas :

- ✔ **aucune carte orpheline** — fermeture par union-find sur le graphe de matériaux : une fusion/héritage/transformation est toujours dans le pack de ses matériaux. C'est la contrainte dure ;
- ~ distribution de tiers : rapportée, pas garantie — et depuis que le booster tire uniformément, c'est elle **seule** qui décide de ce qui tombe : plus rien ne rattrape un pack déséquilibré ;
- ✘ **« un archétype n'est jamais découpé entre deux packs » : impossible sur le pool actuel** — unir les cartes par archétype produit une composante unique de 223 cartes (une carte porte jusqu'à 4 attributs d'archétype, qui se chevauchent). C'est un travail éditorial sur `attributes.json`, pas un calcul — le brief le classe d'ailleurs en décision ouverte.

Un pack designé à la main ne rétablit **aucune** de ces garanties : le sélecteur les **affiche** (répartition par tier, matériaux hors pack, cartes déjà vendues dans un autre pack, cartes déjà offertes par le pack de départ, cartes du catalogue dans aucun pack) sans jamais bloquer l'enregistrement. C'est un tableau de bord, pas un validateur.

Deux appartenances qui ne se confondent pas, et que le sélecteur distingue par la couleur comme par le filtre :

| | Signal | Nature |
|---|---|---|
| Déjà dans un **pack vendu** | badge orange (id du pack) | **Conflit** — une carte n'est vendue que dans un pack, le serveur réaligne le miroir en conséquence |
| Déjà dans le **pack de départ** | badge vert 🎓 | **Information** — la dotation chevauche les packs vendus par nature, mais revendre une carte que tout le monde possède déjà est une décision, pas un hasard |

Corollaire : « dans aucun pack » veut dire **aucun**, dotation comprise. Une carte du pack de départ est distribuée, elle n'attend pas d'être casée — la compter comme orpheline ferait passer toute la dotation pour du travail restant.

Même raisonnement pour les **matériaux hors pack** (`packMissingMaterials`) : un matériau offert par le pack de départ n'est **pas** un manque — tout joueur le possède avant d'ouvrir le moindre booster, la fusion est invocable dès la carte finale achetée. Il est donc exclu du décompte, au même titre que les matériaux du pack lui-même (et que les matériaux désignés par attribut, `ARCH_*`, qui ne sont pas des cartes). Sans cette exclusion, un pool de départ large noierait les vrais trous sous des alertes sans objet. Le pack **en cours d'édition** est écarté de cette recherche : sa composition à l'écran fait foi, pas la version encore enregistrée.

`sets.json` **fait foi** pour le pool d'un booster ; le champ `set` de la carte en est le miroir (il rattrape une carte créée depuis l'admin après la rédaction du pack). `POST/PUT/DELETE /api/sets` **réalignent le miroir** : le champ `set` est posé sur les cartes listées et effacé sur celles qui sortent du pack — une carte n'appartient donc qu'à **un** pack commercial. Un pack de départ, lui, ne touche pas au miroir (il chevauche les packs vendus par nature).

⚠️ **La prime de complétion est mémorisée par id** (`user_shop_state.sets_claimed`) : changer l'`id` d'un pack revient à en créer un neuf, et les joueurs qui avaient touché la prime de l'ancien la toucheront à nouveau. L'écran d'admin le dit.

### Le pack de départ (`starter: true`) — dotation d'un compte neuf

Le **set de fondation** du brief (§2.5) existe sous cette forme : un pack marqué `starter: true` n'est pas un produit, c'est la **dotation offerte à la création de chaque compte**. `progression.starterCardIds()` en est l'union ; sans aucun pack de départ, il retombe sur le préfixe historique `CORE_*` (`STARTER_PREFIX`) — le comportement livré, puisque les données ne contiennent pas de pack de départ.

Trois exclusions, toutes vérifiées par golden test (`packs.test.ts`) — sans elles un pack de départ casse la boutique :

| Endroit | Sans exclusion |
|---|---|
| `setsView` (l'instantané) | le pack s'affiche en boutique, éternellement « ✓ complet » |
| `claimSetCompletions` | chaque compte neuf le possède en entier → **prime versée à l'inscription** |
| `buyBooster` | achetable, puis « Collection complète » |

- Un pack de départ ne listant que des ids inconnus retombe sur le repli : un id mal saisi en admin ne doit pas produire des comptes sans aucune carte, incapables de construire un deck.
- Côté client, la dotation voyage sur chaque carte de `GET /api/cards` via **`_starter`** (calculé, jamais persisté — même statut que `_has_illustration`). `collectionStore` l'utilise pour son repli invité au lieu de dupliquer la règle ; le préfixe `CORE` n'y reste qu'en repli de repli (serveur antérieur).
- Les avatars sélectionnables au Profil viennent du serveur (`cosmetics.DEFAULT_AVATARS` + ceux achetés) et non plus d'une liste codée en dur — c'est le même module qui valide l'enregistrement, les deux ne peuvent donc pas diverger. `ProfileScreen` garde `FALLBACK_AVATARS` (les 7 mêmes ids) en repli si l'appel échoue.

### Affiche d'un pack

Troisième famille d'assets, calquée sur les avatars de decks publics : fichiers dans **`resources/pack_posters/<PACK_ID>.png`** (`POSTERS_DIR`, surchargeable), servis par `GET /pack-posters/:id` (gardé par `safeAssetId`), triptyque admin `POST` (URL) / `PUT` (base64) / `DELETE /api/sets/:id/poster`.

- **Une seule différence, mais elle compte : pas d'affiche par défaut.** Il n'existe pas d'équivalent de `PUBLIC_DECK_000.png` à livrer, donc la route rend un 404 franc et l'instantané porte **`has_poster`** ; c'est le client qui pose une tuile neutre (🎁). C'est le seul endroit du projet où le repli est côté client plutôt que serveur, et c'est assumé : mieux vaut une tuile qu'une `<img>` cassée.
- L'URL étant stable, le remplacement d'une affiche s'accompagne d'un cache-buster côté admin (`posterBust`), comme `avatarBust` pour les avatars.
- **Déploiement** : `sets.json` et les affiches passent par `scripts/sync-data.js` (entrée `sets` de `ENTITIES`, clé `packPosters` de `ASSETS` / `/api/export`) — `--no-illustrations` coupe les **quatre** familles d'images (illustrations, avatars, affiches de packs, fonds de terrain). Ne pas oublier le proxy de dev (`client/vite.config.ts`) et la liste d'exclusion du fallback SPA (`server.js`) pour tout nouveau préfixe d'asset.

### Emplacements quotidiens

Rotation à **5 h**, même reset que les missions (`shop.dayKey === missions.dayKey` — un seul rendez-vous quotidien à retenir). **`DAILY_SLOTS = 6` emplacements**, tous identiques dans leur règle : un tirage **uniforme** dans le catalogue **non possédé**, sans aucune pondération. Un emplacement ne se distingue d'un autre que par la carte proposée.

⚠️ **Les trois catégories historiques sont supprimées** — Le Maillon (`unlocks` / `material`), L'Affinité (`affinity`) et L'Inconnu (`random`). Avec elles disparaissent `linkCandidates`, `affinityCandidates`, `ctx.ownedAttributes` et les champs **`reason` / `reason_ref`** du slot (donc le badge côté client). Le raisonnement : le badge ne portait sa valeur que quand le graphe d'invocation avait quelque chose à dire — sur une collection jeune, les slots 1 et 2 dégénéraient en tirage libre et le joueur lisait « 🎲 Découverte » sans comprendre pourquoi ses autres emplacements avaient l'air d'être des cadeaux. C'est désormais le **nombre** qui répond à la frustration : sur six cartes, il y a presque toujours quelque chose à vouloir, et l'arbitrage porte sur « laquelle » plutôt que sur « est-ce que ça vaut le coup ».

⚠️ **L'affinité au deck actif ne survit nulle part**, boosters compris : `activeDeckAttributes`, `ctx.affinity` et `AFFINITY_MIN_OCCURRENCES` sont supprimés, et `context()` ne porte plus que `owned`. Ce n'est plus « le deck ne change pas l'offre » mais « le tirage n'a plus de quoi consulter le deck » — la question de l'exploit par changement de deck ne se pose plus nulle part, au lieu de dépendre du moment du tirage. Verrouillé par golden test sur la forme même du contexte.

- ⚠️ **Aucune pondération par tier** : la table 30 / 28 / 22 / 14 / 6 (`TIER_WEIGHTS`, `tierWeight`, `weightedPick`) est supprimée au profit d'un tirage uniforme (`shop.pick`). La distribution de la vitrine est donc celle du pool lui-même — les Tier 1, majoritaires au catalogue (≈38 %), sortent d'autant plus souvent, et les Tier 5 restent rares parce qu'ils sont rares. Assumé : le prix étant unique quel que soit le tier, le poids ne servait plus d'arbitrage budgétaire, il déguisait le hasard en règle.
- **Prix** : **500 golds ou 20 gemmes**, au choix du joueur à l'achat — un seul prix, quel que soit le tier de la carte. Le client ne transmet **jamais** de montant.
- **Six cartes distinctes** : `fillSlots` retire du pool ce qui est déjà placé, un emplacement ne double jamais un autre.
- **Reroll** : 1 gratuit par jour, jamais payant (un reroll achetable ferait de la boutique une machine à sous et casserait le plafond de 6 cartes/jour). La carte rerollée quitte le pool du **jour** — il n'y a plus de règle de slot à conserver, le re-tirage est libre comme les autres.
- **Verrou d'offre** : l'achat porte `slot` **et** `card_id`. Un tap au moment exact de la rotation échoue en 409 au lieu d'acheter la carte qui vient de prendre la place.
- Le tirage est **déterministe** à `(player_id, jour, slot)` (xorshift32 semé en SHA-256) : un tirage douteux se rejoue au lieu de se raconter.
- **Rattrapage d'une offre plus courte** : une offre du jour tirée avant le passage de 3 à 6 est **complétée** par `sync` (`fillSlots`), jamais régénérée — les emplacements existants, achats compris, sont conservés tels quels. C'est le seul écart toléré à « l'offre est figée pour la journée », et il n'est pas déclenchable par le client : le nombre d'emplacements ne vient d'aucune entrée réseau. Une offre déjà complète n'est pas réécrite (ni celle d'un joueur dont le pool est épuisé).

### Épingle

**Un** emplacement peut être épinglé (`PINNED_SLOTS_MAX = 1`) : il traverse la rotation **à l'identique** — même carte, même prix — au lieu d'être re-tiré. Gratuit, sans délai, sans limite de durée.

- Le plafond de 1 n'est pas une avarice : épingler tous les emplacements figerait la boutique et supprimerait la rotation. Épingler, c'est **renoncer à une proposition neuve** — c'est l'arbitrage qui donne son poids au geste. Désigner un autre emplacement **déplace** l'épingle (pas d'erreur « épingle déjà utilisée » : le geste est sans ambiguïté).
- L'état persisté est l'emplacement **entier** (`user_shop_state.pinned`), pas le seul `card_id` : c'est ce qui garantit qu'on retrouve le lendemain exactement la proposition mise de côté.
- ⚠️ **Le prix, lui, n'est pas figé** : `withSlotPrices` le ré-estampille à la lecture depuis `SLOT_PRICE`, les champs `price_golds` / `price_gems` de l'offre persistée n'en étant qu'un miroir. Sans ça, un emplacement épinglé — qui traverse les rotations **indéfiniment** — garderait à vie le barème du jour où il a été mis de côté, et un changement de prix n'atteindrait pas non plus les offres du jour déjà tirées. « Même carte, même prix » ne dit rien de plus tant que le prix est global et ne dépend pas de la carte ; le jour où il en dépendrait, c'est cette dérivation qu'il faudrait revoir.
- Un emplacement épinglé **ne se reroule pas** (le reroll jetterait ce que l'épingle vient de mettre de côté, et consommerait le reroll du jour pour rien) ; le dé disparaît côté client plutôt que d'échouer au tap.
- L'épingle se libère d'elle-même à l'**achat**, si la carte tombe au **booster**, et au `sync` suivant si elle a été obtenue autrement — laisser une carte possédée épinglée gèlerait l'emplacement sur une carte invendable.
- Dans l'instantané, `slot.pinned` est **dérivé à la lecture** de `state.pinned` et non recopié dans l'offre persistée : une seule source de vérité, donc pas de désaccord possible.


### Boosters

**5 cartes**, ciblées sur un set, **disponibles en permanence**, **1000 golds ou 40 gemmes**, sans plafond d'achat. Tirage **à l'achat** (jamais à l'avance) : le cas « deck actif modifié entre la génération et l'ouverture » est donc sans objet.

**Le tirage n'a plus aucune structure** : `BOOSTER.card_count` cartes distinctes prises **uniformément au hasard** dans le pool non possédé du pack. C'est tout ce que fait `drawBooster`.

⚠️ **`card_count` est un plafond, pas une promesse** : les dernières ouvertures d'un pack rendent ce qu'il reste — moins de 5 cartes, au plein tarif — plutôt que d'échouer ou de compléter avec des doublons. C'était déjà vrai à 3 cartes ; ça se produit simplement plus tôt à 5, et l'écran affiche le nombre de cartes restantes pour que la décision soit informée.

⚠️ **Tout ce qui structurait le tirage a été retiré** — ancre Tier 3+, garantie « 2 cartes Tier 1-2 + 1 Tier 3+ » (`tier_guarantee`), cohérence de lignée (les matériaux manquants de l'ancre), cohérence d'attribut, pondération d'affinité ×2 (`affinity_weight`). Avec elles disparaissent `materialsOf` et l'ordre d'abandon des garanties.

Le raisonnement : ces garanties promettaient un booster **thématique**, mais chacune tombait *silencieusement* dès que le pool résiduel ne pouvait plus la satisfaire — c'est-à-dire de plus en plus souvent à mesure que le joueur complétait le pack, donc **exactement quand il y tenait le plus**. La cohérence d'attribut était même abandonnée d'emblée sur une bonne partie du catalogue, qui ne porte aucun attribut. Une règle qui ne tient pas ses promesses au moment où elles comptent vaut moins qu'un hasard franc, qui tient la sienne d'un bout à l'autre de la collection.

Corollaire côté design de packs : **la composition du pack EST la distribution des drops**. Un pack sans Tier 5 n'en donnera jamais ; un pack qui n'a que du Tier 1 n'en donnera pas d'autre. Il n'y a plus de garantie pour rattraper un découpage déséquilibré — c'est l'onglet Packs qui porte cette responsabilité, et il affiche toujours la répartition par tier (mais plus de pastille « garantie de tiers ✓/⚠ », qui n'a plus d'objet).

- Le tirage s'arrête aussi quand le pool est vide : `drawBooster` ne boucle jamais à vide.
- Booster **grisé** quand le set est complet — jamais de vente ne pouvant rien produire.
- **Ne jamais indexer le prix sur le taux de complétion** : la valeur croissante à mesure que le set se vide est la propriété la plus vertueuse du système, elle récompense l'engagement au lieu de le taxer. L'écran affiche le nombre de cartes restantes pour la rendre visible.
- **Prime de complétion** (`completion_reward.gems`, 300) : versée **une seule fois**, automatiquement, jamais à réclamer. ⚠️ Elle ne suit **pas** les paliers de missions, qui se réclament désormais d'un tap.

### Routes API

| Route | Accès | Description |
|---|---|---|
| `GET /api/me/shop` | Connecté | Instantané (emplacements, épingle, sets, prix). **Génère l'offre du jour au passage** — pas de tâche planifiée |
| `POST /api/me/shop/buy` | Connecté (30/min) | `{ slot, card_id }` — 409 si l'offre a tourné |
| `POST /api/me/shop/reroll` | Connecté (20/min) | `{ slot }` |
| `POST /api/me/shop/pin` | Connecté (20/min) | `{ slot }` — `null` détache |
| `POST /api/me/shop/booster` | Connecté (30/min) | `{ set_id, currency }` |

Toutes les mutations renvoient l'instantané complet + la progression à jour : aucun rechargement derrière une action.

### Client

- `stores/shopStore.ts` — instantané + actions. Absorbe chaque réponse (solde via `authStore.applyProgression`, cartes via `collectionStore.add` — on ne recharge pas les 398 ids après chaque achat).
- `screens/ShopScreen.tsx` — emplacements, boosters, révélation en modale. `<PackPoster>` pose l'**affiche du pack** à gauche de son nom (et dans l'en-tête de la révélation), avec une tuile 🎁 quand `has_poster` est faux.
- **Tout achat passe par une confirmation** (`useBuyConfirm` / `<ConfirmBuy>`, partagés par les emplacements, les boosters et les cosmétiques). Un tap de la boutique est le seul geste du jeu qui débite un solde, il est définitif (ni annulation, ni revente, ni conversion de doublon), et les deux boutons de prix sont côte à côte — la mauvaise monnaie se choisit aussi vite que la bonne. La modale montre ce qu'on achète en grand et, surtout, **le solde qu'il restera** : le prix, lui, était déjà sur le bouton. Sur un booster elle annonce aussi le cas « moins de `card_count` cartes restantes », seul endroit où il peut être dit **avant** le débit.
  - ⚠️ **La modale est rendue dans un `createPortal(…, document.body)`, et ce n'est pas optionnel** : elle est déclenchée depuis une tuile, donc sous un `Panel` — qui porte `backdrop-blur`. Un `filter` / `backdrop-filter` sur un ancêtre crée un **bloc conteneur**, le `position: fixed` de `Modal` se résout alors sur la tuile et non sur l'écran : la modale se retrouve enfermée dans une colonne de la grille, boutons rognés. Le piège vaut pour toute `Modal` rendue sous un `Panel`.
  - Le bouton `Acheter` se verrouille pendant l'appel (et la fermeture au fond avec lui) : l'achat n'est **pas** idempotent côté serveur, deux envois débiteraient deux fois.
  - `SlotCard` est **vertical** (tier + icônes en tête, vignette, nom, les deux prix empilés) : six tuiles tiennent en **2 colonnes dès le portrait** (`grid-cols-2 sm:grid-cols-3`), ce que l'ancienne disposition horizontale ne permettait pas. 📌 et 🎲 sont remontés sur la ligne du tier — ils ne se disputent plus la largeur avec les boutons d'achat. Plus de `ReasonBadge` (les catégories ont disparu).
- `MainMenu` — bouton `🛒 Boutique` avec une pastille de nouveauté : un simple point, pas un compteur, effacé dès que l'écran a été ouvert pour le jour en cours (`hasUnseenShop` / `markShopSeen`, localStorage).
- `components/ui/primitives.tsx` — `Countdown` (rafraîchi à la **minute** : un repère, pas un chronomètre), partagé avec l'écran Missions.
- Verrouillé par `client/src/test/shop.test.ts` (45 golden tests) et `client/src/test/packs.test.ts` (14 : dotation, exclusions du pack de départ, miroir, affiche), même harnais serveur que `missions.test.ts`. Les deux fichiers sont **séparés à dessein** : `packs.test.ts` réécrit `sets.json` en cours de route, là où `shop.test.ts` indexe les packs par position. Les deux déposent de **vrais PNG** dans un `ILLUS_DIR` temporaire (comme `cosmetics.test.ts`) : sans art, le pool vendable serait vide et les deux fichiers ne prouveraient plus rien.

---

## Boutique cosmétique (avatars & variantes)

Second **onglet** de `ShopScreen` (`🃏 Cartes` / `🎨 Cosmétiques`). Règles dans **`cosmetics.js`** (racine, à côté de `shop.js` dont il reprend le calendrier — *littéralement* : `const { dayKey, nextRotationAt, seededRandom } = require('./shop')`), catalogue de variantes dans **`variants.js`** (qui lit `data/variants.json`), tables `user_cosmetics` et `user_cosmetic_state`.

⚠️ **Écarts assumés avec le brief** : §4.5 vend les cosmétiques en **golds** et §5.2 réserve les gemmes aux boosters ; §4.3 classe les illustrations alternatives en « prestige, **non achetables** ». Le modèle retenu est **gemmes uniquement**, variantes achetables. Les cadres d'avatar et les styles procéduraux du brief n'existent pas.

| Famille | Pool | Prix | Condition |
|---|---|---|---|
| **Avatar** | toute illustration existante (carte, terrain, magie) | **5 💎** | — |
| **Variante** | illustration alternative d'une carte, écrite en admin | **50 💎** | le joueur doit **posséder la carte** |

3 avatars + 3 variantes par jour, **même rotation de 5 h** que les cartes et les missions. Les deux invariants de la boutique de cartes s'appliquent tels quels : **zéro doublon** (un cosmétique possédé ne ressort jamais du tirage) et **l'offre est serveur** (générée, horodatée, persistée ; l'achat porte `kind` **et** `id` → 409 si l'offre a tourné). Le tirage est déterministe à `(joueur, jour, famille)`.

- **Ni reroll ni épingle**, contrairement aux cartes : les prix sont bas et un cosmétique manqué **revient** — il ne quitte pas le pool à l'achat.
- **Pool d'avatars automatique**, sans curation : tout ce qui a une illustration est un visage possible. Les 7 avatars offerts d'office (`DEFAULT_AVATARS`) en sont exclus — on ne vend pas ce qu'on donne.
- **Dégénérescence assumée** : moins de trois candidats éligibles donnent moins de trois emplacements, voire zéro (joueur ne possédant aucune carte à variante). Le client affiche un message, pas des cases vides.
- Une variante **sans illustration** n'est jamais vendue (l'admin le signale sans bloquer l'enregistrement).

### Les variantes — `variants.js` + onglet 🎨 Variantes de l'admin

`{ id, card_id }` dans `data/variants.json` — **pas de nom propre** : une variante est une illustration de plus pour une carte, pas un objet à part. Elle s'annonce partout par le nom de sa **carte** (`card_name` dans l'instantané) et se distingue de ses sœurs par son image ; l'admin la titre pareil, l'`id` servant à la désigner. Le sélecteur du DeckBuilder numérote (« Variante 1, 2… ») faute de mieux — toutes les options y habillent la même carte, un libellé nominal n'y apprendrait rien. Un `name` résiduel dans la donnée est **ignoré** par le catalogue. **L'art vit dans le dossier d'illustrations existant** (`resources/card_illustrations/<VAR_ID>.png`), où cartes, terrains et magies se côtoient déjà : `/illustrations/:id` le sert, `listPngChecksums(ILLUS_DIR)` le synchronise. **Aucune famille d'assets à créer** — donc rien à ajouter au proxy Vite, à la liste d'exclusion du fallback SPA ni à `ASSETS` de `sync-data.js` (une seule ligne dans `ENTITIES`). `variants.js` possède le dossier et l'exporte à `server.js`, comme `sets.js` possède celui des affiches ; il ne requiert ni `cosmetics.js` ni `progression.js` (même règle anti-cycle que `sets.js`).

### Où le choix s'applique

- **Avatar** → `ProfileScreen`. `PUT /api/profile/me` **valide désormais l'appartenance** (`cosmetics.canUseAvatar`) et stocke la forme URL `/illustrations/<id>` : les 5 sites de rendu existants sont inchangés. Auparavant la valeur était écrite **telle quelle**, donc une chaîne arbitraire finissait dans un `<img src>` ; même verrou à l'inscription, où seuls les avatars offerts sont recevables.
- **Variante** → **par deck**, dans le DeckBuilder. Le choix vit dans le méta de deck (`meta[nom].variants = { card_id: variant_id }`), à côté de la couleur et des tags — il se synchronise donc déjà vers le serveur via `_buildBook()`. Revenir à l'origine **retire** l'entrée : le défaut est une absence.

**`client/src/data/CardArt.ts`** est le seul point de résolution `card_id → id d'illustration`. Deux tables, une par camp, et **aucun import** — c'est ce qui autorise `three/UnitCardEl.ts` à s'en servir (les garde-fous ESLint n'y interdisent que React et Zustand) pendant que `logic/` continue de tout ignorer. Trois sites : `cardTileProps` (main, cimetière, DeckBuilder, boutique, TestBench), `UnitCardEl` (board 3D) et `GraveyardTray`. Les tooltips de carte n'affichent aucune image : il n'y a rien à y câbler.

Qui remplit les tables : `game/bootstrap.ts` (`buildSession`, point de passage unique du solo, du tournoi et du PvP), `stores/deckStore.refresh()` (écrans hors partie → deck actif), `PvpController.begin()` (camp adverse), `GameController.dispose()` (purge du camp adverse — la table joueur reste, les menus s'en servent). `artFor` retombe **toujours** sur `cardId` : une variante supprimée rend l'art d'origine, jamais un trou.

### PvP — le serveur dérive, il ne croit pas le client

`match:found` **et `match:rejoined`** portent `opponent.variants`, calculé par `cosmetics.deckVariantMap(userId, deckName)` à partir du **deck book serveur**, filtré par possession et par cohérence (`variants.byId(id).card_id === cardId`). Le méta de deck vient du client : sans ce filtre, n'importe qui afficherait à son adversaire une variante non achetée. Le `deckName` annoncé ne sert qu'à choisir une clé du **propre** livre de ce joueur.

⚠️ **`round:board_ready` n'est pas touché** — l'illustration n'est jamais simulée, elle n'a rien à faire dans le contrat de déterminisme (verrouillé par `pvp.test.ts`), et elle est constante sur la durée du match. `OnlineLobby` force `DeckRepository.flushSync()` **avant** `queue:join` : la synchro est debouncée à 500 ms, un choix fait juste avant d'entrer dans la file ne serait pas encore en base.

### Routes API

| Route | Accès | Description |
|---|---|---|
| `GET /api/me/cosmetics` | Connecté | Instantané (génère l'offre du jour au passage). Alimente **trois** écrans : boutique (l'offre), profil (avatars portables), DeckBuilder (variantes possédées, en objets — le `card_id` y est nécessaire) |
| `POST /api/me/cosmetics/buy` | Connecté (30/min) | `{ kind, id }` — 409 si l'offre a tourné |
| `GET /api/variants` | Public | Catalogue des variantes (avec `_has_illustration`) |
| `POST/PUT/DELETE /api/variants` \| `/api/variants/:id` | Site admin | CRUD |
| `POST /api/variants/import` | Site admin | Import en masse |
| `POST/PUT/DELETE /api/variants/:id/illustration` | Site admin | Art de la variante (URL / base64 / suppression) |

### Client

- `stores/cosmeticStore.ts` — instantané + `load` / `buy`, plus `ownedVariantsFor(cardId)` (DeckBuilder) et `selectableAvatars()` (Profil).
- `screens/ShopScreen.tsx` — onglet Cosmétiques : deux sections, tuiles carrées, prix en 💎. L'achat passe par la **même confirmation** que les cartes (`useBuyConfirm`, cf. Boutique de cartes). **Pas de modale de révélation** en revanche, contrairement au booster : l'achat est unitaire et son résultat déjà à l'écran. Un bandeau suffit, et il dit **où** s'en servir — sinon le joueur repart avec un objet acheté et invisible.
- `components/deck/IllustrationPicker.tsx` — modale « Origine + variantes possédées ». Dans le DeckBuilder, le badge 🎨 est un **frère** de `CardTile`, pas un enfant : le tap de la vignette retire la carte et l'appui long ouvre le tooltip, les deux gestes sont pris (et un `<button>` imbriqué serait du HTML invalide). Rien de tout ça en édition de deck public — il n'y a pas de joueur propriétaire.
- Verrouillé par `client/src/test/cosmetics.test.ts` (33 golden tests), même harnais serveur que `shop.test.ts`. Il dépose de vrais PNG dans un `ILLUS_DIR` temporaire : sans art, les deux pools sont vides et le fichier ne prouverait rien.

---

## Système de cadeaux (🎁 Cadeaux)

Ce que le jeu **donne**, par opposition à ce qu'il vend (`shop.js`, `cosmetics.js`) et à ce qu'il fait gagner (`missions.js`, `arcade.js`). Règles dans **`gifts.js`** (racine, à côté de `shop.js` dont il reprend le calendrier — *littéralement* : `const { dayKey, nextRotationAt } = require('./shop')`), catalogue dans **`data/gifts.json`**, tables `user_gift_state` et `user_gifts`, écran `gifts`.

| Famille | Contenu | Rythme |
|---|---|---|
| **Quotidien** | **200 golds + 5 gemmes** | une fois par rotation de **5 h** — celle des missions, de la boutique et de l'arcade |
| **Ponctuel** | plusieurs **lots** écrits en admin | une fois **par compte**, sans limite de durée |

Un cadeau ponctuel porte un titre, une description et une **liste de lots** (`contents`) récupérés d'un seul geste. Six types : `gold`, `gems`, `card`, `pack`, `avatar`, `variant`.

Quatre règles portent le reste :

1. **Un cadeau se RÉCUPÈRE, il ne tombe pas.** Même raison qu'une mission terminée : un crédit automatique fait disparaître le gain sous les yeux du joueur. Le tap est le moment où le cadeau existe.
2. **Le cadeau est consommé par le GESTE, pas par son rendement.** Une ligne dont le joueur ne peut pas profiter (carte déjà possédée, cosmétique déjà acquis, pack complet) ne fait **pas** échouer la récupération : le cadeau est soldé et le compte rendu dit la vérité, ligne par ligne. L'inverse ferait de la générosité de l'admin un piège — « reviens quand tu posséderas moins » — et laisserait à l'écran un cadeau que rien ne peut plus effacer.
3. **Le module ne connaît aucun montant qui ne soit pas le sien.** Un lot `pack` n'ouvre pas un pack : il livre **un** booster, par `shop.deliverBooster`. Le tirage, le zéro-doublon, le filtre sur l'art, l'épingle et les primes de complétion sont ceux de la boutique.
4. **Ancienneté du compte** : `gift.created_at >= user.created_at`. Un cadeau ne s'adresse qu'aux comptes créés **avant** lui — un dédommagement pour une panne n'a pas de sens pour qui n'était pas là, et sans cette règle un inscrit du jour ouvrirait le jeu sur toute l'histoire des cadeaux, faisant double emploi avec le pack de départ.

⚠️ **Il n'y a pas de `sync` dans `gifts.js`, et ce n'est pas un oubli.** `shop.js`, `cosmetics.js` et `arcade.js` en exposent un parce qu'ils **tirent une offre** qu'il faut aligner sur le jour et persister. Les cadeaux ne tirent rien : la disponibilité du quotidien se lit dans une colonne, les ponctuels se dérivent du catalogue et du registre. Tout se déduit à la lecture. `refresh` n'est qu'un alias de `getSnapshot`, gardé pour que les routes se lisent comme les autres.

### Les deux gardes anti-double-récupération sont dans le SQL

Jamais en JS — même raison que `stmt.claimMission`. Deux taps concurrents ne doivent changer qu'une ligne, et `changes === 0` vaut « quelqu'un est passé avant » :

- **quotidien** (`user_gift_state`, une ligne par joueur, rien ne s'accumule) : `ON CONFLICT(user_id) DO UPDATE … WHERE user_gift_state.daily_day IS NOT @day`. ⚠️ `IS NOT` et non `!=` : la comparaison doit être vraie quand `daily_day` est `NULL` (première récupération du compte), ce que `!=` rendrait `NULL` — donc faux, et le tout premier cadeau serait refusé.
- **ponctuels** (`user_gifts`, une ligne par cadeau soldé) : `INSERT OR IGNORE` sur la clé `(user_id, gift_id)`, comme `user_cards`.

**La marque se pose AVANT la livraison**, le tout dans un `db.transaction` : un échec de livraison annule la marque, et aucune fenêtre ne permet de livrer deux fois.

### Ce que `gifts.js` a exigé d'ailleurs

Deux extractions, toutes deux motivées par la même règle : ne pas se donner deux versions d'une règle et une occasion de les laisser diverger.

- **`shop.deliverBooster(user, def, rand)`** et **`shop.settleCollection(userId, cardIds)`** — la part LIVRAISON de la boutique, sans la caisse. `buyBooster` mélangeait paiement et livraison ; il est désormais « validation + solde + débit + `deliverBooster` ». `settleCollection` (libération de l'épingle + primes de complétion) est aussi appelée par un lot `card` : ce sont des conséquences de la **possession**, pas de l'achat, et une carte offerte qui termine un pack doit payer sa prime — sinon elle attend la prochaine visite en boutique, c'est-à-dire jamais pour qui n'achète plus.
  - ⚠️ Le débit de `buyBooster` a migré **après** la livraison. C'est ce qui garantit structurellement qu'un pool vide ne fait payer personne, là où l'ordre inverse le devait à deux clauses de garde. Tout tient dans une transaction, et better-sqlite3 est synchrone.
  - ⚠️ Les refus **commerciaux** (`isStarter`, `booster_enabled: false`) restent dans `buyBooster` et ne sont **pas** rejoués par un cadeau : un cadeau n'est pas une vente. Le pack de départ se refuse tout seul — son pool non possédé est vide par construction.
- **`cosmetics.unlock(userId, kind, id)`** — débloque sans vendre. Il valide l'existence lui-même, et la règle n'est pas la même dans les deux familles : un avatar exige que son **illustration existe**, car `canUseAvatar` ne teste que la possession — un avatar offert sans PNG serait portable et cassé, avec un `<img>` vide sur cinq écrans.

### Catalogue et admin (onglet 🎀 Cadeaux)

`data/gifts.json`, cache mémoire au mtime (même patron que `sets.js` / `variants.js` / `cosmetics.js`) : l'admin écrit à chaud.

- ⚠️ **`created_at` est estampillé par le serveur** à la création et **préservé** par le `PUT` ; jamais lu du corps de la requête. C'est lui qui décide de l'éligibilité : le laisser au formulaire, c'est laisser une faute de frappe rendre un cadeau invisible à tous — ou l'ouvrir à toute la base. L'import, lui, le **conserve** quand il en reçoit un, sinon `sync-data.js` re-daterait les cadeaux à chaque aller-retour local ↔ prod.
- ⚠️ **Un `created_at` absent fait tomber le cadeau au chargement**, avec un `console.warn`. C'est le seul champ sans lecture de repli sûre : le compter comme 0 le rend invisible pour toujours, le compter comme « maintenant » l'ouvre aux comptes créés depuis — exactement ce que la règle d'ancienneté interdit. On le nomme plutôt que de le deviner.
- **Un lot mal formé est ignoré, pas fatal** (`normalizeLot`), et un cadeau dont **tous** les lots sont invalides n'existe pas — un cadeau qui ne donne rien est pire qu'un cadeau absent. `validateGift` rend le **même verdict** à l'écriture (400) que le chargement à la lecture : les deux chemins ne peuvent pas diverger sur ce qu'est un cadeau valide.
- **Plafonds** : `MAX_LOT_AMOUNT = 100 000` par lot de monnaie, `MAX_LOTS_PER_GIFT = 12`. Pas une défiance envers l'admin — le zéro en trop, qui ne se rattrape pas une fois les gemmes distribuées.
- ⚠️ **Supprimer un cadeau n'efface pas le registre** : recréer un cadeau sous un id déjà utilisé le laisse silencieusement inaccessible à qui avait pris le premier. Même piège que la prime de complétion d'un pack, mémorisée par id — l'écran d'admin le dit.
- 🎀 et non 🎁 : les **Packs** occupent déjà ce glyphe, et le `switchTab` d'`admin.html` apparie les onglets par **sous-chaîne de libellé** (`t.includes('cadeau')`). Deux onglets au même pictogramme se confondent au coup d'œil.
- **L'éditeur de lots est le seul champ répétable du panneau d'admin.** Il tient un état local `giftLots` (le DOM ne peut pas servir de source de vérité pour une liste dont on retire des éléments au milieu) et `_syncGiftDraft()` recopie la saisie **avant** chaque re-render — nom et description compris, sans quoi ajouter un lot effacerait le nom qu'on vient de taper.

### Client

- `stores/giftStore.ts` — instantané + `claimDaily()` / `claim(id)`. Son `absorb` fait les trois gestes de `shopStore.absorb` : `pickSnapshot`, `authStore.applyProgression`, et `collectionStore.add` des cartes livrées (lot `card` **et** cartes du booster) — un cadeau qui donne des cartes doit les faire apparaître au DeckBuilder sans recharger les 398 ids.
- `screens/GiftsScreen.tsx` — tuile du quotidien (bouton vert, ou `Countdown` vers la prochaine rotation), liste des cadeaux, modale de révélation. **Pas de `ConfirmBuy`** : rien n'est débité, la confirmation n'a pas d'objet. ⚠️ La révélation passe par `createPortal(…, document.body)` — déclenchée depuis un `Panel`, qui porte `backdrop-blur`, elle serait sinon rognée dans sa colonne (cf. `ConfirmBuy`).
- `MainMenu` — bouton `🎁 Cadeaux` avec **une seule** pastille, la verte chiffrée (quotidien disponible + cadeaux non pris). Pas de point doré ni de `localStorage` « déjà vu », contrairement aux Missions et à la Boutique : un cadeau est toujours actionnable ou absent, il n'y a pas de nouveauté à signaler à part. Elle s'efface quand tout est récupéré, pas à la visite. Rien en invité.
- Le compteur est **dérivé** de l'instantané (`claimableCount`), jamais transmis : une valeur dérivée qu'on transporte est une valeur qui peut contredire sa source.
- Verrouillé par `client/src/test/gifts.test.ts` (28 golden tests), même harnais serveur que `shop.test.ts`. Le fichier écrit son **propre** `gifts.json` et son propre `sets.json` — c'est le catalogue qui est l'objet du test (précédents : `arcade.test.ts`, `packs.test.ts`). ⚠️ Les comptes du fichier datent d'un mois et les cadeaux de maintenant : l'inverse les rendrait tous inéligibles, et le fichier passerait à côté de son sujet en échouant partout de la même façon.

---

## Mode Arcade (run solo quotidienne)

Une run par jour, **4 duels solo enchaînés** contre des decks publics tirés par difficulté croissante, l'IA recevant à chaque échelon un handicap plat de plus en plus lourd. Règles dans **`arcade.js`** (racine, à côté de `shop.js` et `cosmetics.js` dont il reprend le calendrier — *littéralement* : `const { dayKey, nextRotationAt, seededRandom } = require('./shop')`), table `user_arcade_state`, écran `arcade`.

Le mode existe pour une raison de game design : c'est le **rendez-vous quotidien qui se joue**. Quatre parties complètes en une assise, de quoi faire tomber une bonne partie des missions du jour — là où les autres écrans quotidiens (Missions, Boutique) se consultent.

| Règle | Valeur |
|---|---|
| Duels par run | **4**, enchaînés |
| Runs par jour | **1** — le verrou est l'existence de la ligne du jour, pas un compteur |
| Rotation | **5 h**, celle de la boutique et des missions (`shop.dayKey`), fuseau du **serveur** |
| Défaite | **clôt la run** — la journée est consommée |
| Adversaires | decks publics, duel N tiré dans la difficulté N |
| Gain de fin de parcours | **200 golds + 50 XP**, versé une seule fois au 4ᵉ duel gagné |

**Échelons** (`arcade.DUELS`) :

| Duel | Difficulté du deck | Handicap IA |
|---|---|---|
| 1 | 1 — Initiation | +0 PV / +0 ATK |
| 2 | 2 — Confirmé | +10 PV / +2 ATK |
| 3 | 3 — Vétéran | +30 PV / +3 ATK |
| 4 | 4 — Élite | +50 PV / +5 ATK |

Le premier duel est **à mains nues** à dessein : c'est l'étalon, le joueur voit d'abord un adversaire non trafiqué avant de sentir la rampe. Croissance stricte des trois axes (difficulté, PV, ATK) verrouillée par golden test — une rampe qui s'aplatit ferait du 4ᵉ duel une formalité.

Trois invariants portent le reste :

1. **Une run par jour.** `start` refuse dès qu'une run porte la date courante, **quel que soit son état** (en cours, gagnée, perdue). Lire (`GET`) ne consomme rien : ouvrir l'écran ne doit pas engager la journée, seul `start` engage.
2. **La run est serveur, donc reprenable.** Adversaires, échelon courant et résultats sont persistés ; s'arrêter entre deux duels, recharger la page ou changer d'appareil ne coûte rien — le client redemande « où j'en suis aujourd'hui ? ». C'est la différence de fond avec le **Tournoi**, dont le bracket vit en mémoire et se perd au F5.
3. **Le client nomme, le serveur chiffre.** Le client rapporte `win`/`loss` sur un **index** de duel : ni bonus, ni deck adverse, ni montant ne remontent. Le tirage et le crédit sont faits par le serveur.

- **Le blob de run porte la composition du deck adverse**, pas seulement son id — même raison que `pendingGame.opponentDeck` côté tournoi : un deck public retouché ou supprimé en admin en cours de run ne doit pas casser la reprise.
- **Le deck du joueur est figé au lancement** (`run.deck_name`) : changer de deck actif en cours de parcours ne change pas d'arme entre deux duels. Son *contenu*, lui, n'est pas figé.
- Tirage **déterministe** à `(player_id, jour)` (xorshift32 semé en SHA-256, comme la boutique) : un tirage douteux se rejoue au lieu de se raconter. Un même deck ne ressort pas deux fois dans une run tant que le pool le permet.
- **Difficulté des decks publics** : champ `difficulty` (1–4) posé depuis l'onglet Decks publics de l'admin. Une difficulté **absente est lue comme 1** — le champ est postérieur aux decks livrés, et `bootstrap()` ne recopie pas `initial-data/` sur un volume déjà peuplé.
- **Repli de difficulté** : un niveau vide se rabat sur le niveau non vide le plus proche (écart croissant, égalité → le plus haut), puis sur tout le pool. Sans lui, un seul niveau laissé vide en admin — ou une base antérieure au champ, où tout est lu comme 1 — rendrait la run impossible à lancer. **L'échelon garde son handicap** : c'est le duel qui durcit, pas le deck.
- Un deck public de **moins de 20 cartes** n'est jamais proposé comme adversaire (même seuil que le DeckSelector).
- ⚠️ **`PUT /api/decks/:id` fusionne désormais** au lieu de remplacer : deux clients y écrivent et ils n'envoient pas le même objet — le formulaire admin poste le deck complet, mais le DeckBuilder en iframe ne poste que `{ id, name, deck }`. Un remplacement franc effaçait `difficulty` à chaque composition. Corollaire côté admin : `_collectPublicDeckFields` **reconstruit l'objet de zéro**, toute nouvelle donnée de deck doit y être relue.

### Le handicap IA — un primitif de `logic/`, pas une notion « arcade »

`GameSessionDeps.enemyBonus` (`{ atk, hp }`, 6ᵉ paramètre de `buildSession`) : `logic/` ne sait pas que le mode Arcade s'en sert. Appliqué dans **`GameSession._placeEnemyUnits()`**, seul entonnoir par lequel passent les unités créées par l'IA — `EnemyAI` construit `new Unit` en **sept** endroits, un par voie d'invocation.

- Le bonus s'écrit dans **`unit._base`**, jamais dans `_stat_bonuses` : c'est la seule voie permanente du jeu (`_stat_bonuses` est balayé par `resetCombatStats()` à chaque fin de combat, et par `POWER_DEBUFF`). Même geste que les magies de Shopping.
- Idempotence par marqueur `unit._enemy_bonus_applied` : un survivant du round précédent est sauté, et une unité **fusionnée** à partir de matériaux déjà boostés est une unité neuve — elle reçoit le handicap une fois, sans cumul. ⚠️ Ne **pas** passer par `_shopping_bonus`, que `InvocationManager._transferShoppingBonuses` **somme** sur l'unité composite.
- Appliqué **après** `rearrangeUnits()`, qui trie par PV : poser le bonus avant décalerait le placement de l'IA. Verrouillé par `enemy-placement.test.ts`.
- Absent partout ailleurs (`null`) : solo, tournoi, tutoriel et PvP sont strictement inchangés.

### Client

- `stores/arcadeStore.ts` — instantané + `load` / `start` / `reportDuel`, sélecteurs `currentDuel(snapshot)` et `wonCount(run)`. **Le contrat entre l'écran Arcade et `GameScreen` est l'instantané serveur lui-même**, pas un objet posé en mémoire avant de naviguer (là où le Tournoi passe par `pendingGame`).
- `screens/ArcadeScreen.tsx` — trois états : parcours annoncé + « Lancer la run » / échelle des 4 duels avec le duel courant en tête / récap et `Countdown` vers la prochaine rotation. Le deck engagé est le **deck actif**, en récap lecture seule (`SelectedDeck`), comme au Tournoi et au Duel en ligne — il n'y a plus de sélecteur par mode.
- `screens/GameScreen.tsx` — drapeau `params.arcade`, sur le patron exact de `params.tournament` / `params.tutorial` : garde de montage (pas de duel en cours → retour à `arcade`), bandeau `ArcadeHeader` (échelon + handicap), `GameOverScreen` et `GameMenu` dédiés.
- ⚠️ **Le rapport de duel et la relecture d'écran écrivent le MÊME instantané, et ils se croisent.** Sortir d'un duel rapporte le résultat (`POST /me/arcade/duel`) puis navigue vers l'écran Arcade, qui recharge (`GET /me/arcade`) : rien n'ordonne les **réponses**. Une lecture partie avant que le rapport ne soit commis rapporte la run d'**avant** le duel — appliquée en dernier, elle efface la victoire de l'affichage. Le joueur rejoue alors un duel que le serveur tient déjà pour soldé, et son second rapport part sur un index périmé (409) : **c'est le score de la partie précédente qui reste au tableau.** Le serveur, lui, n'a jamais tort — la désynchro est entièrement côté client, et elle se ferme des deux côtés :
  - **`revision`** (compteur hors store, dans `arcadeStore`) — toute réponse de **mutation** l'incrémente ; une lecture partie avant est **jetée** à son retour. Elle ne coûte rien : les deux routes renvoient le même instantané complet.
  - **`exitArcadeGame` ATTEND le rapport avant de naviguer** (`GameScreen`), pour que le `GET` de l'écran parte après le commit. Seul, ce garde-fou ne suffirait pas — deux onglets, un retour navigateur ou le rechargement du menu principal recroisent les requêtes sans passer par là.
- **Un rapport qui n'a pas pu partir se DIT** (`reportError`, distinct d'`error` que la relecture remet à zéro) : le parcours affiché reste juste, il vient du serveur, mais il contredit ce que le joueur vient de vivre. Le bandeau nomme l'arbitre au lieu de prétendre ce qu'est devenu le duel — la requête a pu aboutir et seule sa réponse se perdre.
- `MainMenu` — bouton `🕹 Arcade` pleine largeur, avec deux pastilles **dérivées de l'instantané** (et non d'un `localStorage` « déjà vu » comme Missions et Boutique — ce n'est pas une nouveauté qu'on signale, c'est un état de jeu) : verte chiffrée `N/4` quand une run est en cours, point doré quand la run du jour n'est pas lancée, rien une fois la journée soldée. Rien en invité.
- **Missions : aucun câblage.** Chaque duel remonte et démonte `GameScreen`, donc ouvre son propre lot d'événements (`begin()` → `startMatch()`, `dispose()` → `flushMatch()`). Les garde-fous anti-concede / anti-AFK s'appliquent duel par duel.
- Verrouillé par `client/src/test/arcade.test.ts` (29 golden tests, même harnais serveur que `shop.test.ts`), `client/src/test/arcade-store.test.ts` (8 golden tests) et 6 tests de handicap dans `enemy-placement.test.ts`. ⚠️ `arcade-store.test.ts` est le **seul test de store du projet** : ce qu'il éprouve — l'ordre d'arrivée de deux réponses HTTP — ne se voit pas côté serveur. Il tourne en node sans DOM comme le reste de la suite (le store ne touche ni au DOM ni au `localStorage` ; seul `AuthClient` est mocké, et l'utilisateur est posé à la main — une lecture en invité étant un no-op). ⚠️ `arcade.test.ts` **écrit son propre `public_decks.json`** dans le `DATA_DIR` temporaire au lieu de copier celui de `data/` : c'est le catalogue qui est l'objet du test (difficultés connues, un niveau volontairement vide, un deck trop court). Les autres catalogues viennent d'`initial-data/`, versionné (précédent : `tutorial.test.ts`).

### Écarts et limites assumés

- **`ai_win` reste crédité** à chaque duel gagné : un duel Arcade est une victoire solo comme une autre, et plus dure. Une run parfaite vaut donc 4 × 10 XP + 50 XP de fin de parcours = **90 XP**, l'ordre de grandeur d'une journée de missions côté XP (62) pour beaucoup moins de golds (200 contre 650). **Arcade paie en progression, les missions en monnaie.**
- **Pas de gemmes** dans le barème : elles restent la monnaie des boutiques, une source quotidienne gratuite les dévaluerait.
- **Le duel se joue côté client, le serveur ne peut que croire le rapport** — même limite que le solo et le tournoi. Elle est ici plus **serrée** qu'ailleurs : la run est unique par jour et bornée à quatre rapports, l'abus plafonne donc à un gain quotidien au lieu d'être illimité.
- **Fermer l'onglet en plein duel laisse ce duel rejouable**, alors que quitter par le menu ☰ le concède (et clôt donc la run). C'est le prix de la reprise : la seule fermeture honnête de cette faille — annoncer le début du duel au serveur — transformerait un plantage ou une coupure réseau en défaite.
- Une **égalité** (PV identiques au 5ᵉ tour) n'est pas rapportée : le duel se rejoue, comme une manche de tournoi. Ni le joueur ni l'IA n'a pris le dessus, consommer un échelon là-dessus serait arbitraire.
- La répartition de difficulté livrée sur les 14 decks publics est **dérivée** du volume de cartes et du poids des tiers 4-5 (4/4/3/3) : un point de départ éditable en admin, au même titre que le découpage de `scripts/build-sets.js` pour les packs.

---

## Mode tutoriel

Accueil des nouveaux joueurs, en trois temps : un **codex** consultable (11 chapitres), une
**partie d'entraînement guidée**, puis la **création accompagnée du premier deck**. Écran
`tutorial`, bouton `🎓 Tutoriel` au menu principal, plus une invitation au tout premier lancement.

**Entièrement client. Zéro ligne côté serveur** : pas de route, pas de table, aucune récompense —
donc aucune surface de triche à défendre. La progression (chapitres lus, étapes faites, invitation
congédiée) vit dans **une seule clé localStorage**, `millenium_tutorial_v1`.

⚠️ Cette clé ne porte **pas** d'`user.id`, contrairement à `hasUnseenShop` / `hasUnseenMissions` :
le public visé est justement celui qui n'a pas encore de compte. Tout le mode est accessible en
**invité** — ne pas y recopier le `if (!user) return null` des boutons Missions et Boutique.

### Le principe : le coach observe, il ne pilote pas

`GameController` republie déjà tout l'état de la partie dans `gameStore` après chaque mutation.
Le coach s'y **abonne** et avance seul. Conséquence : **`logic/`, `GameController` et `Scene3D`
ne sont pas touchés** — pas de `TutorialController`, pas de crochet dans le chemin de combat
déterministe, aucun risque pour les golden tests.

Toute la **décision** (quelle bulle, quand avancer) vit dans des **fonctions pures**
(`data/tutorialScript.ts`) ; les composants ne font que les rendre. C'est ce qui rend le mode
testable alors que la suite vitest tourne en node **sans jsdom** — aucun test de composant n'est
possible dans ce projet.

| Fichier | Rôle |
|---|---|
| `data/tutorialContent.ts` | Les 11 chapitres : copie + **sélecteurs** d'exemples, purs |
| `data/tutorialScript.ts` | `advanceGameSteps` / `gameCoachStep` / `deckCoachStep` — le cœur testable |
| `data/tutorialProgress.ts` | localStorage (lecture, écriture, `shouldInvite`) |
| `game/tutorialDeck.ts` | `buildTutorialDecks(cards)` — les deux decks, dérivés du catalogue |
| `screens/TutorialScreen.tsx` | Sommaire **et** lecteur de chapitre (un seul écran, état local) |
| `components/tutorial/` | `ChapterBlocks`, `CoachBubble`, `TutorialCoach`, `DeckCoach` |

### Le codex

Un chapitre ne contient **jamais d'`id` de carte en dur** : ses exemples sont des sélecteurs
`(cards) => Card[]` évalués sur le catalogue réel au rendu, et les pouvoirs / attributs / magies /
terrains sont lus dans leurs databases. Le codex suit donc les données — une carte retouchée
depuis l'admin ne le fait pas mentir. `tutorial.test.ts` vérifie que **chaque sélecteur rend
encore au moins une carte** : la donnée qui disparaît casse le test, pas l'écran du joueur.

### La partie guidée — `?screen=game` + `params.tutorial`

Ce n'est **pas un écran à part** : c'est `GameScreen`, avec le vrai board 3D, la vraie
`GameSession` et le vrai combat. Seuls changent le deck et l'accompagnement.

- **Les decks** (`buildTutorialDecks`) ne vivent pas dans `DeckRepository` — même situation que
  les decks publics adverses, d'où le 5ᵉ paramètre **optionnel** `playerDeck` de `buildSession`,
  symétrique d'`enemyDeck`.
- **Construction en deux temps**, imposée par les données : le catalogue n'a presque aucune carte
  d'invocation **normale** au-delà du tier 2 (5 en T3, 1 en T4, 1 en T5). Les tiers 1–2 prennent
  donc des normales ; les tiers 3–5 **uniquement des cartes dont les matériaux sont déjà dans le
  deck** (couverture accumulée tier par tier, ids *et* attributs). Sans ce filtre, la main des
  derniers tours se remplirait de cartes définitivement injouables.
- **L'ATK pèse 20× les PV** dans le classement des candidats : ce sont les survivants et leur ATK
  qui infligent les dégâts de fin de combat. Un mur à 1 ATK / 1000 PV ferait un mauvais allié et
  un pire adversaire — le combat partirait au **timeout**, qui blesse les *deux* joueurs.
- **Le gel des chronos** est le seul vrai piège du mode : sans lui, `PrepTimer` lance le combat au
  bout de 60 s en pleine explication. D'où **`coachBlocking`** dans `GameSnapshot`, sur le modèle
  exact de `menuOpen` — lu par `prepActive` (`GameScreen`), par `ShoppingTimer` et par le décompte
  de `EndRoundOverlay`. **Toujours faux hors tutoriel** : les autres modes sont inchangés.
- **`ai_win` n'est pas crédité** (`AiWinReward`) : l'adversaire est choisi par nous pour être
  battu et la partie se rejoue à volonté. Les **missions**, en revanche, ne sont *pas* neutralisées
  — une partie d'entraînement est une partie solo comme une autre au regard des garde-fous serveur,
  et la contourner demanderait de toucher `GameController`.
- La bulle se pose **au-dessus de la main** en portrait (`useWebLayout` : le bas est libre en mode
  web, où la main est un rail). L'étape qui dit « tape une carte » ne peut pas être celle qui les
  recouvre. Pendant le récapitulatif de round, la Phase Shopping et la fin de partie — trois
  modales centrées — elle passe **en haut**, à la hauteur des bannières.
- Le script s'arrête au **tour 2** : la boucle a été vue en entier, la partie continue normalement.

### Le DeckBuilder guidé — `params.tutorial`

`DeckCoach` est rendu **dans** `DeckBuilder`, en flux juste au-dessus du pied de page (une bulle
flottante masquerait forcément la grille). Il reçoit en props les valeurs **déjà dérivées à chaque
rendu** (`total`, `perTier`, `tierMax`, `name`, `tab`, `valid`) : aucun refactor, aucune remontée
d'état, et **aucune règle réimplémentée**. Il n'a pas d'index d'étape, seulement l'état — un joueur
qui retire des cartes revient donc naturellement au message précédent.

`back()` renvoie vers `tutorial` et `save()` marque l'étape faite ; tout le reste de
l'enregistrement est inchangé, y compris `if (!hasActiveDeck()) setActiveDeck(finalName)` qui fait
déjà exactement ce qu'il faut d'un premier deck.

### Tests

`client/src/test/tutorial.test.ts` (27 golden tests) lit le catalogue depuis
**`initial-data/cards.json`** — versionné et toujours présent, là où `data/` n'est créé qu'au
démarrage du serveur. Couvre : intégrité des chapitres, résolution *et* stabilité des sélecteurs,
déterminisme des decks, **invocabilité réelle de chaque carte de haut tier**, monotonie du script
(une étape franchie ne se rejoue jamais quand sa condition se retourne), étapes conditionnelles,
et la liste exacte des étapes bloquantes — c'est elle qui gèle les chronos.

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
DeckRepository.getDeckVariants(name) / setDeckVariants(name, map)  // { card_id: variant_id }
DeckRepository.setPendingEdit(name)      // stocke en sessionStorage
DeckRepository.consumePendingEdit()      // lit ET efface le pendingEdit

// Synchro serveur (compte connecté uniquement)
await DeckRepository.pull()              // GET /api/me/decks → écrase le local
await DeckRepository.flushSync()         // PUT /api/me/decks — push debouncé, forcé
DeckRepository.handleLogout()            // coupe la synchro, garde le local
```

**DeckRepository** persiste en `localStorage` (decks + méta couleur/tags/variantes d'illustration). Chaque mutation planifie un push serveur debouncé si l'utilisateur est connecté ; en invité, tout reste local. Structure d'un deck :
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
  "_has_background": true,
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

Un terrain porte **deux images distinctes**, calculées à la lecture et jamais persistées (même statut que `_has_illustration` sur une carte) — `POST`/`PUT`/`import` les effacent (`stripBoardComputed`) :

| Drapeau | Dossier | Route | Rôle |
|---|---|---|---|
| `_has_illustration` | `resources/card_illustrations` (partagé avec les cartes) | `GET /illustrations/:id` | Vignette **carrée** du tooltip `🗺️` |
| `_has_background` | `board_backgrounds` (`BOARD_BG_DIR`) | `GET /board-backgrounds/:id` | **Fond de grille**, vue de dessus au ratio 5:11 |

Ce sont bien deux assets et non un seul recadré : un plan de 5 × 11 rogné en vignette carrée ne montrerait qu'une bande centrale illisible, et une vignette carrée étirée sur la grille serait déformée.

### Fond de grille (`board_backgrounds`)

Quatrième famille d'assets, sur le modèle des affiches de packs : triptyque admin `POST` (URL) / `PUT` (base64) / `DELETE /api/boards/:id/background`, gardé par `safeAssetId`, entrée `boardBackgrounds` de `scripts/sync-data.js` et de `/api/export` (checksums + `/api/export/board-background/:id`), routes génériques `PUT`/`DELETE /api/board-backgrounds/:id` pour la sync.

- **Pas d'affiche par défaut**, comme les packs : la route rend un 404 franc. Mais ici le repli n'est ni serveur ni client — il n'y a **rien à poser**, c'est le décor de scène habituel qui reste en place.
- L'onglet Terrains de l'admin expose les deux boîtes d'image côte à côte (`BOARD_ASSETS` décrit la paire, la modale d'import est écrite une seule fois). Deux cache-busters distincts, `boardIllusBust` et `boardBgBust`, les URLs étant stables.

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

Le **fond de grille** suit exactement le même trajet, une ligne plus bas : `Scene3D.setTerrainBackground(boardData)` au lancement du combat, `setTerrainBackground(null)` à sa fin. Le PvP est couvert sans une ligne de plus — `PvpController` passe par le même `_beginCombatAnimation`. Le TestBench fait le même appel dans `startCombat` / `stopCombat`.

- **Combat uniquement.** En préparation le terrain n'est pas encore tiré (l'IA place ses unités au PRÊT), et le cadrage ne montre que les rangées 0–3 : il n'y aurait ni terrain à afficher, ni place pour le montrer.
- `Scene3D` construit l'URL `/board-backgrounds/<id>` lui-même — précédent en place avec `UnitCardEl`, qui pointe directement sur `/illustrations/<card_id>`. `three/` n'importe donc pas `data/`, et `GameController` n'a rien à plomber.
- Le plan texturé (`PlaneGeometry(5, 11)`, `MeshBasicMaterial` — *Basic* pour que l'éclairage de scène n'assombrisse pas l'illustration) est posé à `y = -0.08`, sous les tuiles. Une illustration hors ratio 5:11 est **rognée au centre**, jamais déformée (`coverFitTexture`).
- Les 55 tuiles passent alors en **voile translucide** (`TERRAIN_TILE_OPACITY`) : les rangées neutres et ennemies sont opaques par défaut et masqueraient tout. Les tuiles ne couvrant que 92 % de leur case, c'est le contraste tuile/interstice qui redessine la grille par-dessus l'image. Les trois zones prennent le **même** voile — les différencier par l'opacité créerait une couture en travers de l'illustration ; c'est la couleur des tuiles qui porte seule la lecture des zones. Le voile bleu du bloc joueur (`_playerBg`) est masqué pour la même raison.
- **Le chargement est asynchrone et annulable** : `_terrainToken` invalide une texture qui arrive après la fin du combat ou après un autre terrain, sinon on rattacherait un mesh à une scène morte. Un 404 ne fait rien — le décor par défaut reste en place, ce qui **est** le comportement voulu pour un terrain sans fond.

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
attack_speed_modifier     // ajouté à attack_speed tant que la paralysie dure (= attack_speed → cadence ÷2)
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

Les 14 pouvoirs implémentés (constantes en tête de `CombatManager.js`). **Chaque constante n'est qu'un repli** : la carte porte son propre chiffre dans `power.value` (champ « Valeur » de l'admin), et c'est lui qui prime — colonne « `value` = » ci-dessous.

| Pouvoir | Effet (sans `value`) | `value` = |
|---|---|---|
| `POWER_HEAL` | Soigne l'allié au plus bas `current_hp` (soi-même inclus) de 40 % du `max_hp` du **lanceur** | **PV plats** rendus |
| `POWER_SHIELD` | Bouclier sur soi = `atk × 2` | bouclier **plat** |
| `POWER_SUPER_ATTACK` | `atk × 3` sur la cible | dégâts **plats** |
| `POWER_AOE_ATTACK` | `atk` sur **tous** les ennemis vivants | dégâts **plats** (par cible) |
| `POWER_POISON` | DOT : `max(1, atk / 2)` par pulse, 1 pulse tous les 3 steps, **jusqu'à la fin du round** (`dot_effects`) | dégâts **par pulse** |
| `POWER_BURN` | Malédiction : `max(1, atk / 2)` infligés à la cible **à chacune de ses attaques**, **jusqu'à la fin du round** (`burn_stacks`) | dégâts **par attaque** |
| `POWER_PARALYSIS` | **`attack_speed` doublé** (`attack_speed_modifier = attack_speed`) pendant 20 steps (`paralysis_remaining`) — ralentit, ne bloque pas | la **durée en steps**, pas la sévérité |
| `POWER_PUSH` | Repousse la cible de 2 cases en ligne droite ; s'arrête aux bords, unités et cases bloquées | nombre de cases |
| `POWER_DEBUFF` | `resetCombatStats()` sur la cible — efface bonus **et** statuts | — |
| `POWER_BLOCK` | Empêche la cible d'utiliser son pouvoir pendant 25 steps | nombre de steps |
| `POWER_CONFUSION` | 20 steps : la cible prend ses **propres alliés** pour cibles | nombre de steps |
| `POWER_TAUNT` | 20 steps : le lanceur force les ennemis à le cibler | nombre de steps |
| `POWER_TELEPORT` | Se téléporte au contact de l'ennemi au plus bas `current_hp` (case adjacente libre, sinon case libre la plus proche). Sans destination, la jauge **reste pleine** et l'unité réessaie au step suivant | — |
| `POWER_FREEZE` | Repousse la cible d'1 case et **gèle la case libérée** jusqu'à la fin du round (`board.setTemporaryBlock`). Un seul bloc de glace à la fois : le nouveau remplace l'ancien | — |

### `power.value` — la surcharge par carte

Toute la lecture tient dans un helper de trois lignes, `powerValue(unit, fallback)`, et il est le **seul** endroit qui consulte `unit.power_value`.

- ⚠️ **`||` et non `??`** : une **Valeur laissée à 0** en admin est lue comme « non renseignée » et retombe sur le défaut, jamais comme « ce pouvoir ne fait rien ». Le cas s'est présenté (`CORE_077`, `POWER_BLOCK` à `value: 0`) : un `??` lui aurait donné un blocage de 0 step, c'est-à-dire un pouvoir qui consomme sa jauge et n'a aucun effet — la seule faute d'écriture qui coûte à une carte toute son identité sans que rien ne le signale nulle part.
- **Un montant plat n'est pas un multiplicateur**, et c'est la donnée qui l'impose : `HAGA_008` a `atk: 1, hp: 400, value: 80`. Sous `atk × 2`, ce mur se pose un bouclier de 2. Même raison pour le soin, indexé sur le `max_hp` du **lanceur** faute de mieux — un soigneur ne devrait pas soigner moins parce qu'il est fragile.
- **Le chiffre n'est pas arrondi** : `value` est écrit tel quel (l'admin accepte le pas 0.5). C'est la responsabilité de qui édite la carte, pas du combat.
- ⚠️ **La paralysie chiffre sa DURÉE, pas sa sévérité** — c'est le seul pouvoir dont le sens de `value` a changé. La sévérité est désormais fixe (`attack_speed` doublé, `attack_speed_modifier = attack_speed`) : un `+6` plat coûtait ses trois quarts d'attaques à une unité rapide (`attack_speed: 2`) et ne se voyait pas sur une lente (`attack_speed: 12`) — la même Valeur ne voulait pas dire la même chose selon la cible, ce qui n'est pas chiffrable en admin. Un doublement, lui, coûte **la moitié des attaques** quel que soit le rythme, et `value` sert alors à ce qui reste à doser : le temps que ça dure. Corollaire : un second tir **rafraîchit** la paralysie au lieu de l'empiler — doubler est un plafond, pas un cran (même geste que celui prévu pour poison/brûlure le jour où leur cumul posera problème).
- Verrouillé par `client/src/test/powers.test.ts` (29 golden tests) : les **deux** branches de chaque pouvoir chiffré — avec `value`, sans `value` — plus la règle du 0. Une surcharge silencieusement ignorée (l'état d'avant) ne se voit nulle part en jeu : la carte annonce 100 de soin et en rend 40.

### Poison et brûlure — deux horloges, plus aucun compteur

⚠️ **Ni l'un ni l'autre n'expire** : `DOT_PULSES` et `BURN_ATTACKS` sont supprimés, `DotEffect` n'a plus de `remaining` ni `BurnStack` d'`attacksRemaining`. Les deux courent jusqu'à la fin du round et n'ont plus que les purges de statuts pour sortie — `resetCombatStats` en fin de combat, `POWER_DEBUFF`, magie `revive`.

**Ce qui les sépare n'est donc plus leur durée, c'est leur horloge**, et c'est désormais la seule chose qui les distingue :

| | Bat sur | Bornée par |
|---|---|---|
| `POWER_POISON` | l'**horloge globale** — 1 pulse tous les `DOT_INTERVAL` (3) steps | rien, jusqu'au timeout |
| `POWER_BURN` | les **attaques de la cible** elle-même | le rythme d'attaque de la cible |

C'est ce qui laisse à la brûlure un contre-jeu que le poison n'a pas : une cible paralysée, hors de portée ou qui n'a plus personne à frapper cesse de brûler. Verrouillé par golden test (personne n'attaque → aucun dégât de brûlure sur 20 steps, là où un poison aurait pulsé sept fois).

⚠️ **Corollaire assumé pour les deux : les piles CUMULENT sans plafond.** Chaque tir en ajoute une, aucune ne meurt — un empoisonneur à `power_speed` bas voit ses dégâts croître linéairement jusqu'au timeout. Le jour où ça pose problème, le geste est de **rafraîchir** la pile existante au lieu d'en empiler une, pas de rétablir un compteur.

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

⚠️ **`revealEnemyUnits` est une SYNCHRO du côté ennemi, pas un simple ajout** : le tour de l'IA peut aussi **retirer** des unités du board — un survivant du round précédent consommé comme matériau (sacrifice / fusion / héritage), remplacé par une transformation, ou écarté par le plafond de slots de `rearrangeUnits`. Ces unités-là ont déjà une carte à l'écran, héritée du round précédent, et `refresh()` ne repasse plus une fois en mode combat : sans purge, leur carte reste affichée **tout le combat** alors qu'elles ne sont plus dans `board.grid` — un fantôme qui n'attaque pas, ne bouge pas, n'est pas ciblable, et que seul le `refresh()` d'`exitCombatMode` finit par balayer. La purge est un retrait franc (`_removeUnitObj`) et non un `killUnitObj` : ces unités n'ont pas été tuées, une explosion de mort avant le premier coup mentirait sur ce qui s'est passé. Le côté joueur n'est jamais touché ici — ses invocations ont toutes lieu en préparation, suivies d'un `refresh()`.

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

### Bloc « Invocation » (tooltip de carte)

Le tooltip d'une **carte** (main, cimetière, DeckBuilder, boutique, TestBench — tout ce qui passe par `cardTileProps`) annonce sa **voie d'invocation et ce qu'elle exige**. Toute la lecture vit dans **`data/SummonInfo.ts`**, pur et sans dépendance à une database : il rend les matériels par leur **id**, c'est le tooltip qui les nomme (`getCard` / `getAttribute`). C'est ce qui le rend testable dans une suite vitest qui tourne en node sans jsdom — même raison que `data/tutorialScript.ts`.

- **Une carte à `summon_options` affiche ses voies l'une sous l'autre** (« INVOCATION — AU CHOIX ») : ce sont des alternatives, pas un cumul. Son `summon_type` / `cost` de premier niveau n'est qu'un miroir de l'une d'elles et n'est **pas** lu — `summon()` ne regarde que les options.
- **Chaque voie n'affiche que ce qu'elle LIT réellement** (`READS_MATERIALS` / `READS_SACRIFICE`, calqués sur `InvocationManager`) : un `sacrifice` posé sur une fusion ou des `materials` posés sur un sacrifice ne sont jamais vérifiés — les montrer ferait mentir le tooltip.
- **Trois mots pour trois sens** : la fusion liste ses `Matériels`, la transformation nomme la cible qu'elle remplace (`Transforme`), l'héritage écrit **`dont`** — ses matériaux sont pris **dans** ses tributs, ils ne s'y ajoutent pas.
- Un matériel `ARCH_*` désigne **n'importe quelle** unité portant l'attribut, pas une carte : il se lit « tout porteur de X » et se nomme dans `AttributeDatabase`. La règle du préfixe a désormais un nom (`InvocationManager.isAttributeMaterial`), lu des deux côtés.
- Les **remises des magies** sont visibles là où le joueur en a besoin : coût de sacrifice réduit (`_original_sacrifice` → « réduit de N ») et transformation sans cible (`_free_transformation`).
- Une **normale sans rien à exiger n'affiche pas de bloc** — « la carte se pose » n'apprend rien.
- Rien de tout ça sur un tooltip d'**unité** : elle est déjà invoquée, sa recette n'est plus actionnable (sa lignée 🧬, elle, reste affichée).
- Verrouillé par `client/src/test/summon-info.test.ts` (18 golden tests), qui lit le catalogue depuis `initial-data/cards.json` : un matériel pointant sur un id inconnu casse ici plutôt qu'en affichant un identifiant brut au joueur.

---

## Drag & Drop

Repositionnement d'unités pendant la préparation.

Implémenté avec Pointer Events API :
- `pointerdown`, `pointermove`, `pointerup`
- Unifie click et touch

Validation `board.isOccupied(pos)` avant le drop.

---

## DeckBuilder

- **Illustration par carte** : badge 🎨 sur les vignettes du panneau Deck dont le joueur possède une variante (cf. « Boutique cosmétique »). Le choix vaut **pour ce deck seulement**.
- **Unicité** : une carte ne peut figurer qu'**une seule fois** dans un deck (cohérent avec la règle du doublon, qui interdit deux exemplaires vivants de la même `card_id` sur le board). Dans la bibliothèque, une carte déjà prise est grisée et liserée d'or ; un tier plein est grisé franc.
- **Le tap de la bibliothèque fait l'aller ET le retour** : sur une carte déjà prise (liserée d'or), il la **retire** du deck. La grisaille y dit « déjà prise », pas « intapable » — sans ça, corriger un choix obligeait à changer d'onglet, alors que c'est justement dans la bibliothèque qu'on compare. Le retrait s'y fait **par `card_id`** (`removeCardById`) et non par index : la règle d'unicité garantit qu'il n'y a qu'une carte à désigner.
  - ⚠️ **« Déjà dans le deck » prime sur « verrouillée » et sur « tier plein »** : c'est précisément sur un tier plein qu'on a besoin de faire de la place, et une carte verrouillée héritée d'un ancien deck y reste retirable — même règle que dans l'onglet Deck, où le retrait est la seule action qu'elle accepte. Une carte verrouillée **hors** du deck, elle, reste intapable : `addCard` revérifie de toute façon la possession.
  - Le geste repose sur `tapOn="up"` de `CardTile`, déjà en place : l'appui long (tooltip) arme `suppressTap` et ne touche donc **jamais** au deck.
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
- **La carte d'un deck PUBLIC ne montre pas la même chose que celle d'un deck du joueur** : la **répartition par tier** (les 5 barres) est réservée aux siens — devant un adversaire, on ne choisit pas une composition. Elle cède la place à sa **difficulté** et à ses **tags**, qui disent d'un coup d'œil ce qu'on affronte.
  - **Difficulté** : `DifficultyChip` — le libellé (qui nomme l'échelon) **et** 4 pastilles (qui le situent dans l'échelle) ; le nom seul suppose le barème connu, les pastilles seules ne disent pas ce qu'on affronte. Les libellés vivent avec la donnée qui les porte (`PublicDeckDatabase.difficultyLabel` / `difficultyOf`, mêmes règles que `arcade.difficultyOf` : 1..4, **difficulté absente lue comme 1**) — `ArcadeScreen` s'y branche aussi, deux copies d'un barème de 4 lignes finissant par se contredire.
  - **Tags** : `data/DeckTags.computeDeckTags(cards)` — deux attributs dominants (≥ 2 cartes) puis un mot de profil (Mêlée / Distance / Brutal / Offensif), 3 au maximum. **Un seul calcul, deux moments** : le deck du joueur les fige à l'enregistrement (ils font partie de son méta `DeckRepository`), un deck public les **dérive à l'affichage** — il n'a pas de méta local où les ranger, et sa composition se retouche en admin. Les cartes sont résolues via `CardDatabase` (déjà chargée par `initGameData`), ce qui laisse `computeDeckTags` pur et sans état.
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
- **Déploiement** : `resources/` est gitignoré — les avatars voyagent par `scripts/sync-data.js` (clé `avatars` de `/api/export`, routes `/api/avatars/:id`), exactement comme les illustrations ; `--no-illustrations` coupe toutes les familles d'un coup. Le `bootstrap()` du serveur dépose l'avatar par défaut sur le volume s'il n'y est pas.
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

Écrans routés par `uiStore.screen` (Zustand, parité `?screen=`, pas de react-router) : `main_menu`, `auth`, `reset_password`, `profile`, `friends`, `deck_selector`, `deck_builder`, `tournament`, `arcade`, `missions`, `shop`, `gifts`, `tutorial`, `online_lobby`, `game`, `game_pvp`, `combatlab` (dev), `testbench` (dev).

⚠️ Ajouter un écran se fait à **deux** endroits dans `uiStore.ts` — l'union `ScreenName` *et* le tableau `SCREEN_NAMES`, qui est celui qui valide `?screen=` — puis une ligne dans `App.tsx`.

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
- **Aucun geste natif du navigateur ne concurrence l'appui long** (`styles/index.css`) : `user-select: none`, `-webkit-touch-callout: none` et `-webkit-tap-highlight-color: transparent` sont posés sur `<body>`, donc **hérités** par tout l'arbre — HUD React comme cartes CSS3D du board. Sans ça, l'appui de 500 ms qui ouvre le tooltip (unité, carte en main) déclenche d'abord la sélection : poignées bleues, loupe, menu « Copier » / « Enregistrer l'image » sur iOS. `Scene3D` les répète sur son canvas et sur le conteneur CSS3D — c'est ce canvas qui reçoit le geste, et il vit aussi dans le TestBench.
  - **Exception : les champs de saisie** (`input`, `textarea`, `select`, `contenteditable`) rétablissent `user-select: auto`. Un champ non sélectionnable n'est plus corrigeable au doigt sur iOS (ni curseur déplaçable, ni sélection de mot).
  - `touch-action: manipulation` sur les commandes (`button`, `a`, `label`, `[role=button]`) supprime le délai de double-tap ; le canvas garde son `touch-action: none`, il gère le drag d'unité lui-même.

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
