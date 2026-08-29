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

# Qualité :
npm run lint              # eslint BACKEND (racine, routes/, ws/, scripts/)
npm run lint:all          # backend + client
npm test                  # = npm --prefix client test (toute la suite)

# Qualité (dans client/) :
npm test                  # vitest run — golden tests logique + serveur + HTTP
npm run lint              # eslint client — garde-fous d'archi logic/ et three/
npm run typecheck         # tsc --noEmit
```

⚠️ **`npm start` charge `.env`** via `--env-file-if-exists` (natif Node ≥ 20.6). C'est bien la variante `-if-exists` qu'il faut : `--env-file` tout court **échoue au démarrage** quand le fichier est absent, ce qui casserait la production, où `.env` n'existe pas et où l'hébergeur injecte les variables directement. `ADMIN_PASS` y est **obligatoire** — sans elle le serveur refuse de démarrer (cf. « Niveaux d'accès »).

En dev, on développe sur **http://localhost:5173** (HMR) ; en prod, Express sert le SPA sur `/`.

Repo : `https://github.com/srida/Millenium`

### Outillage de qualité

**Simulation d'équilibrage** (`.github/workflows/balance-sim.yml`) — routine quotidienne qui simule ~60 000 parties contre le catalogue de production et dépose son rapport sur `/admin/sim`. Voir « Simulation d'équilibrage » plus bas.

**CI** (`.github/workflows/ci.yml`) — lint backend + client, toute la suite de tests, `tsc --noEmit`, et `npm audit --omit=dev --audit-level=high` (le bruit des devDependencies rendrait le signal inutile). Même garde `[skip ci]` que le workflow de version, sinon chaque commit de bump relancerait la suite.

**ESLint client** (`client/eslint.config.js`) — encode les frontières d'architecture (`logic/` n'importe ni React, ni Zustand, ni Three, ni `data/` ; `three/` n'importe ni React ni Zustand) **et les règles des hooks React**. ⚠️ Ces dernières manquaient sur une soixantaine de composants : `rules-of-hooks`, celle qui attrape les plantages réels (un hook sous condition, dans une boucle, après un `return`), n'était vérifiée nulle part — le code la respectait, rien ne le maintenait. `exhaustive-deps` est en **`error`** et non en `warn` : les six écarts du projet sont tous délibérés (montage unique de `GameScreen`/`GameScreenPvp`, dépendance sur un *champ* plutôt que sur l'instantané entier dans `MissionsScreen`/`ShopScreen`…) et portent chacun leur `eslint-disable-next-line` avec sa raison. Une fois ces six-là nommés il ne reste aucun bruit ; en avertissement, la règle aurait rejoint la liste de ce qu'on ne lit plus.

**ESLint backend** (`eslint.config.js` à la racine) — les 7 700 lignes de Node n'avaient aucun linter, celui du client s'arrêtant à `client/src`. Sa valeur principale n'est pas de traquer les variables inutilisées : c'est d'**encoder en règles les invariants d'architecture que ce document énonce en prose**. Deux pièges le concernant, tous deux trouvés en vérifiant que les règles se déclenchent plutôt qu'en constatant un lint vert :

- ⚠️ **`no-restricted-imports` ne voit QUE les `import` ES.** Le backend est en CommonJS : c'est `n/no-restricted-require` (eslint-plugin-n) qu'il faut, et lui seul. Se tromper de règle donne une config qui passe au vert sans jamais rien vérifier — le pire des deux mondes.
- ⚠️ **En config plate, une règle est REMPLACÉE, pas fusionnée**, par le bloc suivant qui la mentionne. `sets.js` étant à la fois une feuille et un module de règles, sa restriction de feuille était écrasée par celle des puits. D'où l'ordre (puits d'abord, feuilles ensuite) et la liste cumulée.

`n/no-extraneous-require` attrape la dépendance **fantôme** — un module requis mais absent de `package.json`, qui ne se résout que par la remontée d'un autre paquet. C'est ce qui était arrivé à `cookie`, requis dans le chemin d'authentification et résolu par la seule copie hissée d'express.

**`compression` et `helmet`** sont montés en tête d'`app.js`. `compression` fait passer `GET /api/cards` de 268 Ko à 25,8 Ko (×10,4) — c'est la route la plus chaude du jeu, traversée à chaque démarrage de client. ⚠️ La **CSP de helmet est désactivée à dessein** : `admin.html` fait 282 Ko de scripts en ligne, que la politique par défaut casserait net. La régler proprement est un travail à part ; à moitié, on la désactiverait au premier bug.

### `app.js` et `server.js`

`app.js` porte **toute** l'application Express et l'exporte ; `server.js` ne fait plus que le port, le serveur HTTP et l'attache du WebSocket PvP (qui prend un `http.Server`, pas un app Express).

C'est ce découpage qui rend la couche HTTP testable : `client/src/test/http.test.ts` requiert `app.js` directement et le passe à `http.createServer` sur un port éphémère. `bootstrap()` et `progression.backfillAll()` restent **dans `app.js`**, au niveau module — un test qui pose un `DATA_DIR` vide obtient ainsi un catalogue peuplé par le code de production, pas par une copie parallèle qui dériverait.

⚠️ La garde `ADMIN_PASS` est la **première instruction d'`app.js`**, avant tout `require` : `db.js` crée `DATA_DIR` et ouvre la base au chargement, et un démarrage refusé ne doit laisser aucune trace. Elle **jette** au lieu de terminer le processus — c'est ce qui la rend observable ; `server.js` traduit en sortie non nulle.

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
| `GET /api/cards` | Public | Le catalogue complet, avec `_has_illustration` et `_starter` |
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
| `GET /illustrations/:id` | Public | Art des cartes, terrains, magies, **variantes** et **icônes d'attributs** (PNG sans extension, id gardé par `safeAssetId`) |
| `GET /avatars/:id` | Public | Avatar d'un deck public (repli sur l'avatar par défaut) |
| `GET /pack-posters/:id` | Public | Affiche d'un pack (404 s'il n'en a pas — pas d'affiche par défaut) |
| `GET /board-backgrounds/:id` | Public | Fond de grille d'un terrain (404 s'il n'en a pas — le décor par défaut reste) |
| `POST /api/cards/import` | Auth | Import en masse (mode skip/replace) |
| `POST /api/cards/:id/illustration` | Auth | Upload illustration (URL ou base64) |
| `POST /api/attributes/import` | Auth | Import attributs en masse |
| `POST/PUT/DELETE /api/attributes/:id/illustration` | Auth | Icône d'un attribut (URL / base64 / suppression) |
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
| `GET /admin/sim` | Site admin | Rapport de la simulation d'équilibrage (`sim-report.html`) |
| `/api/admin/sim/*` | Site admin | Dépôt et historique des runs (`routes/admin-sim.js`) |
| `/api/admin/pvp-logs/*` | Site admin | Logs de combat PvP — **outil de diagnostic temporaire** (`routes/admin-pvplog.js`) |

### Responsivité d'`admin.html` — navigation et pièges

Les 13 onglets tenaient dans une seule bande horizontale. Trois choses en découlaient,
dont deux invisibles à qui développe sur grand écran :

- ⚠️ **La bande débordait aussi sur DESKTOP, et le débordement était masqué.** Les
  libellés demandent ~1 100 px ; `#main-tabs` n'avait ni `flex-wrap` ni `overflow-x`, et
  `body { overflow-x: hidden }` **coupait** le dépassement sans laisser de barre pour y
  aller. Mesuré : à **1024 px**, quatre onglets (🎨 Variantes, 📊 Stats, 🗄️ Base SQL,
  ⚖️ Équilibrage) débordaient du viewport ; à **1280 px** — un portable courant — ⚖️
  Équilibrage restait inatteignable. Un `flex-wrap: wrap` sur `#main-tabs` ferme tout.
- **Sur mobile, la bande est remplacée par une feuille plein écran** (`#tab-sheet`, ☰
  dans la topbar) : 13 entrées en grille 2 colonnes, toutes visibles d'un coup. Les
  entrées sont **clonées depuis `#main-tabs` à chaque ouverture** — une seule liste
  d'onglets dans le fichier, un onglet ajouté au balisage y apparaît sans qu'on y pense.
- `switchTab` apparie par **`data-tab`**, plus par sous-chaîne de libellé.

⚠️ **`.tabs` et `.tab` sont RÉUTILISÉS hors de la topbar — c'est le piège du fichier.**
Les flèches `‹` `›` du pager SQL portaient `class="tab"`, et les chips de catégorie du
sélecteur d'attributs `class="tab ap-tab"` dans un conteneur `class="tabs"`. Un
`querySelectorAll('.tab')` global les dépouillait donc déjà de leur `.active` à chaque
changement d'onglet (inoffensif par pur hasard d'ordonnancement), masquer `.tabs` en
mobile ferait **disparaître les chips**, et une délégation de clic sur `.tabs` capterait
le pager. D'où **`id="main-tabs"` sur la seule barre du haut**, et la règle : tout
sélecteur de navigation — CSS comme JS — passe par cet id. Le pager a reçu sa propre
classe (`.db-pager-btn`).

⚠️ **Le bloc `@media (max-width: 768px)` doit rester le DERNIER de la feuille.** Il
vivait au milieu du fichier, **avant** les sections « Stats tab » et « DB explorer » : à
spécificité égale la dernière règle gagne, et une douzaine de surcharges mobiles étaient
mortes en silence (`.stat-panel`, `.tier-overview-table`, `.mini-bar-track`, le slider de
seuil, la mise à plat des `.anomaly-row`). Elles existaient dans le fichier et ne
s'appliquaient jamais. Toute règle desktop se pose **au-dessus** de ce bloc.

⚠️ **`viewport-fit=cover` est la condition d'existence de `env(safe-area-inset-*)`** :
sans lui les retraits valent `0px` et tout le travail de zone sûre est un no-op silencieux
(FAB et toast repassent sous la barre d'accueil iOS).

Autres correctifs, chacun invisible tant qu'on ne le cherche pas : `showModal` posait une
largeur **en ligne** (`580px`), qui bat la requête média — d'où `min(580px, 96vw)` ; le
FAB et le toast occupaient le **même coin** bas-droit ; `.content` ne réservait pas la
place du FAB, qui recouvrait la dernière ligne ; l'en-tête du sélecteur de cartes d'un
pack alignait un titre et **quatre boutons** sans `flex-wrap` ; et une des quatre tables
de stats était enfermée dans un `overflow: hidden` qui coupait son contenu sans recours.

**Aucun test automatisé ne couvre `admin.html`** (`npm test` est purement client). La
vérification se fait au navigateur — Chromium et Playwright sont préinstallés dans
l'environnement, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (ne **pas** lancer
`playwright install`). Ce qu'il faut mesurer plutôt que regarder :
`document.documentElement.scrollWidth <= clientWidth` — `body { overflow-x: hidden }`
**masque** le symptôme —, un seul `.main:not(.hidden)` et un seul `#main-tabs .tab.active`
par onglet, les chips d'attributs toujours visibles et actifs après un `switchTab()`, et
l'échelle réelle des SVG du rapport (`svg.getScreenCTM().a`) : un `getComputedStyle`
rendrait `11px` même à l'échelle 0,4.

### Lecture et écriture des catalogues (`readJson` / `writeJson`, `app.js`)

**Un id d'asset ne compose JAMAIS un chemin à la main.** `assetPath(dir, id)` est le seul endroit du fichier autorisé à le faire, et il refuse tout ce que `safeAssetId` rejette. Ce n'est pas une commodité : `safeAssetId` gardait une vingtaine de routes et était **oublié sur huit autres** — la répétition du même quintuplet CRUD pour dix entités fait qu'un garde-fou ajouté aux copies récentes ne l'est pas aux anciennes, et rien ne peut le signaler. Une forme unique dans le fichier, c'est une seule chose à vérifier.

**`readJson` met en cache au `mtime`** — le patron que tous les modules de règles appliquent déjà (`progression.allCardIds`, `sets.cards`, `variants.all`…), et que les routes HTTP étaient les seules à ne pas avoir. Mesuré sur `GET /api/cards` : lecture + parse **4,62 ms → 0,03 ms**, handler complet **16,7 ms → 6,0 ms** (×2,8).

⚠️ **CONTRAT : `readJson` rend une copie du TABLEAU, mais en PARTAGE les éléments.** On peut `push`, `splice` ou remplacer une case ; on ne mute **jamais** un élément en place — pour modifier une entrée, on remplace la case par un objet neuf (`liste[i] = { ...liste[i], champ: valeur }`), comme le fait `syncCardSetMirror`. La copie **profonde** a été essayée et rejetée : `structuredClone` du catalogue coûte plus cher que la lecture + parse qu'il remplace, le cache devenait plus lent que pas de cache.

⚠️ **`writeJson` écrit de façon ATOMIQUE** (`<file>.tmp` puis `renameSync`) et invalide le cache explicitement. Un `writeFileSync` direct sur la destination laissait un catalogue **tronqué** si le processus s'arrêtait au mauvais moment — et l'hébergeur envoie un `SIGTERM` à chaque déploiement. La base SQLite était protégée (WAL + transactions) ; les catalogues JSON, qui portent autant de valeur, ne l'étaient pas.

**Deux plafonds de corps de requête**, pas un seul : 1 Mo en général, 20 Mo sur les seules routes d'upload d'image. ⚠️ Le choix se fait **avant** le parsing — `express.json` ignore une requête dont le corps est déjà lu, donc monter la limite haute *en aval* de la basse serait un no-op silencieux. Et 1 Mo plutôt que 256 Ko : un import en masse depuis l'admin poste `cards.json` tel quel (~320 Ko), le catalogue doit pouvoir grandir.

**`downloadUrl`** (import d'illustration par URL) borne les redirections (5), le délai (10 s) et la taille (10 Mo), et **refuse les adresses privées** — 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16 (métadonnées cloud), CGNAT, IPv6 locales, et tout protocole autre que http(s). La redirection repasse par le contrôle : rediriger vers 169.254.169.254 est le vecteur SSRF classique. « Admin » ne veut pas dire « de confiance pour atteindre le réseau interne ».

**Niveaux d'accès** : un write-guard global (`app.js`) met **TOUT** `POST/PUT/DELETE/PATCH` sous `/api` derrière `requireSiteAdmin` — cartes et attributs comme terrains ou packs. Il n'y a donc qu'un seul niveau d'écriture, et `requireAuth` (la basic-auth seule) n'est jamais monté directement sur une route : on ne l'atteint qu'en repli de `requireSiteAdmin`.

⚠️ Corollaire à connaître : **tout joueur marqué `is_admin` peut réécrire le catalogue de cartes**, pas seulement le porteur des identifiants du site. Les `requireSiteAdmin` explicites qu'on croise encore sur certaines routes (magies, terrains…) sont redondants avec le garde global — ils ne restreignent rien de plus.

⚠️ **`ADMIN_PASS` est OBLIGATOIRE et son absence est fatale** : `app.js` refuse de se charger sans elle, avant même d'ouvrir la base ou de créer un dossier. Le repli permissif d'autrefois (`if (!ADMIN_PASS) return next()`) ouvrait toute l'écriture `/api` aux requêtes anonymes, promotion admin comprise — et comme rien ne chargeait `.env`, un `npm start` local tournait toujours ainsi. `npm start` passe désormais `--env-file-if-exists=.env` (natif Node ≥ 20.6 ; `--env-file` tout court échoue quand le fichier est absent, ce qui casserait la production). Verrouillé par `client/src/test/http-boot.test.ts`.

⚠️ **Les GET sous `/api` sont PUBLICS** — le write-guard ne couvre que les écritures. C'est voulu (le jeu lit ses catalogues sans compte), mais ça veut dire qu'une route de lecture ajoutée sous `/api` est ouverte à tous par défaut : `GET /api/export/illustration/:id` a ainsi rendu, un temps, le contenu de n'importe quel `.png` du système de fichiers à un appelant anonyme, faute de `safeAssetId`.

### API en ligne (`routes/online.js`, montée sur `/api`)

| Route | Accès | Description |
|---|---|---|
| `POST /api/auth/register` \| `login` \| `logout` | Public (rate-limité) | Comptes |
| `GET /api/auth/me` | Optionnel | Session courante |
| `POST /api/auth/forgot-password` \| `reset-password` | Public (rate-limité) | Réinitialisation mot de passe — **révoque toutes les sessions du compte** |
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
| `POST /api/me/pvp-log` | Connecté | Dépôt d'une vue de combat PvP — **outil de diagnostic temporaire** |

**Rate-limit** (`auth.rateLimit`, seaux en mémoire) : la clé est le **compte** quand il y en a un, l'IP sinon. ⚠️ Elle était l'IP dans tous les cas, et derrière le proxy de l'hébergeur `req.ip` est celui du **proxy** — identique pour tout le monde : tous les joueurs partageaient un seul seau par route (15 connexions par minute pour le jeu ENTIER), et le quota ne protégeait plus du bourrage d'identifiants, qui vient lui aussi d'une IP unique. `app.set('trust proxy', 1)` est l'autre moitié du correctif ; la valeur `1` est délibérée — plus permissive, un client forgerait son propre `X-Forwarded-For` et se donnerait une IP neuve à volonté. Les seaux expirés sont purgés par la routine d'entretien.

Le PvP temps réel ne passe pas par HTTP : `ws/pvpServer.js` (matchmaking + relais opaque) sur **`/ws/pvp`** — le fallback SPA d'`app.js`, lui, exclut tout le préfixe `/ws`. Le message `match:found` (et `match:rejoined`) transporte les **variantes d'illustration** du deck adverse **et les comptes d'attributs de son deck** (`deck_attribute_counts`, qui décident du terrain de combat), tous deux dérivés côté serveur — cf. « PvP — le serveur dérive ».

Trois garde-fous sur la poignée de main, tous absents à l'origine : `maxPayload` à **64 Ko** (le défaut de `ws` est 100 Mo, et le relais transmet des blobs opaques à l'adversaire), contrôle de l'en-tête **`Origin`** (liste blanche via `ALLOWED_WS_ORIGINS`, localhost toujours accepté, une requête sans `Origin` — client non navigateur — passe), et `socket.destroy()` sur un chemin d'upgrade non reconnu, où un simple `return` laissait la socket ouverte sans propriétaire.

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

La dotation d'un compte neuf se **designe en admin** : c'est le pack marqué « départ » (`starter: true` dans `sets.json`), cf. « Le pack de départ » plus bas. `STARTER_PREFIX = 'CORE'` n'est plus que le repli quand aucun pack ne porte le drapeau. ⚠️ Les données livrées **portent désormais un pack de départ** (`SET_008`, 50 cartes) : c'est lui qui dote un compte neuf, pas les 132 `CORE_*` du repli historique.

**Courbe de niveau** : palier unique de `XP_PER_LEVEL = 100`. `users.xp` stocke la progression **dans le niveau** (0–99), pas un cumul de carrière — `grant()` absorbe le passage de palier (250 XP d'un coup = +2 niveaux et 50 de reste), et la jauge de l'UI va donc de 0 à 100 sans calcul côté client. Un débit d'XP ne fait jamais redescendre de niveau.

**Barème des gains** (`progression.REWARDS`) :

| Événement | Gain | Décerné par |
|---|---|---|
| `ai_win` — victoire solo contre l'IA | 10 | Client → `POST /api/me/progression/reward` (`GameScreen`) |
| `tournament_win` — tournoi remporté | 50 | Client → même route (`tournamentStore.finishGame`, quand la finale est scellée) |
| `pvp_win` — victoire sur un joueur en ligne | 70 | **Serveur** (`ws/MatchRelay.endMatch`, et `ws/BotMatch.endMatch` pour un duel contre bot), transmis dans `match:end` |

- Le client envoie une **raison**, jamais un montant — sinon n'importe qui s'attribuerait le gain de son choix. `pvp_win` est refusé sur la route HTTP (`CLIENT_CLAIMABLE`) : le serveur est seul arbitre du vainqueur PvP (rapports croisés, forfait, timeout), il le décerne lui-même.
- ⚠️ **Un désaccord entre les deux rapports n'a PAS de vainqueur** : le match est clos en `draw` avec `reason: 'result_mismatch'`, **aucun gain n'est versé**, et les deux `userId` sont journalisés. Le rôle A faisait autorité auparavant (« Role A is authoritative on mismatch »), ce qui était exploitable de la façon la plus simple qui soit — un client modifié en rôle A déclarait la victoire à chaque partie et encaissait les 70 XP quel que soit le rapport adverse, qui voyait en prime le match se clore contre lui. Coût assumé du correctif : dans le cas — anormal, le combat étant déterministe des deux côtés — d'une vraie divergence de simulation, un joueur honnête perd son gain. Verrouillé par `client/src/test/pvp-relay.test.ts`.
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
- **Affichage** : `components/ui/ProgressionStats.tsx` — `<ProgressionPills>` (ligne compacte `Nv. 2 ▓▒░ 25/100 · 💰 · 💎`, menu principal sous l'identité, et en-tête des écrans secondaires en web) et `<ProgressionPanel>` (jauge pleine largeur + soldes, écran Profil). Les deux lisent `authStore.user`, **sans fetch** : les valeurs arrivent déjà avec la session. Rien n'est rendu en invité.
- **Icônes et couleurs de monnaie sont définies une seule fois — `components/ui/currency.ts`.** ⚠️ Ça ne l'était PAS : la table vivait en privé dans `ProgressionStats`, donc personne ne pouvait la lire, et les glyphes étaient réécrits à la main dans une vingtaine d'endroits (`ShopScreen` entretenait même une table parallèle). Coût constaté : `GiftsScreen` peignait les gemmes en `text-tier-5`, or `--color-tier-5` et `--color-gold` valent la **même** valeur (`#d4af61`) — sur le seul écran qui montre les deux montants côte à côte, ils sortaient dans la même couleur. La primitive **`<Amount currency value sign />`** est désormais le point de rendu d'un solde ou d'un gain : la teinte n'est écrite qu'à un endroit. 💰 et non 🪙, qui retombe en disque gris faute de glyphe couleur. Le module porte aussi `fmt` (`Intl.NumberFormat('fr-FR')`, jusque-là redéclaré dans 4 fichiers) et **`CURRENCY_BY_WIRE`**, qui fait le pont entre la clé du joueur (`gold`) et celle du fil (`golds`, routes d'achat) — les deux ne se confondent pas.
- **La pastille de niveau mène au Profil** (prop `onOpen`, posée par `MainMenu` et `ScreenHeader`) : « combien me reste-t-il avant le prochain niveau » appelle immédiatement « et qu'est-ce que j'y gagne », dont la réponse est là-bas. Seule celle-là est tapable — un solde ne mène nulle part, et un `min-h-tap` sur les trois pastilles ferait deux lignes sous l'identité du menu.
- **L'XP n'a pas de compteur à elle** : elle n'existe qu'au travers de la jauge de niveau (primitive `Gauge`, 0 → 100), avec le décompte exact en petit sous la barre. C'est la seule lecture qui compte (« où j'en suis du palier ») là où un nombre nu ne dit rien sans son plafond. Gold et gemmes, eux, sont des **soldes** → chiffres.
- `XP_PER_LEVEL` est dupliqué côté client (`ProgressionStats.tsx`) — à garder synchronisé avec `progression.js` à la main. C'est la **seule** valeur dans ce cas : le barème des paliers, lui, voyage (cf. ci-dessous).

### Récompenses de palier de niveau (`levels.js`)

Ce que le passage d'un niveau **donne**. Règles dans **`levels.js`** (racine), état dans **`users.levels_claimed`**.

Deux marches qui **s'ajoutent** aux golds, et deux échanges qui les **remplacent** — un cycle de dix niveaux, six figures différentes :

| Règle | Gain | Nature |
|---|---|---|
| **Chaque** niveau | **50 golds** | la pente |
| Tous les **5** niveaux | **50 gemmes** | **en plus** |
| Tous les **10** niveaux | un **objet tiré au sort** : carte, avatar ou variante | **en plus** |
| Niveaux en **2** et **7** | **20 gemmes** | **à la place** des golds |
| Niveaux en **3** et **8** | un **objet tiré au sort** | **à la place** des golds |

Ce que donne une dizaine : **300 golds** (six niveaux), **140 gemmes** (deux échanges à 20, deux marches à 50), **trois objets** (deux échanges, une marche). Le niveau 10 donne toujours les trois choses à la fois — c'est ce cumul qui en fait un rendez-vous plutôt qu'un remplacement.

⚠️ **« En plus » et « à la place » sont deux règles opposées, et c'est TOUTE la lecture du barème.** Les deux marches historiques tombent sur les rangs 0 et 5, les deux échanges sur 2, 3, 7 et 8 : les quatre règles ne se croisent **jamais**. Un rang d'échange qui deviendrait multiple de 5 ferait se contredire le cumul et le remplacement sur un même palier — verrouillé par golden test.

- **La variation existe parce que la pente ne disait plus rien** : neuf paliers sur dix versaient exactement la même chose, et seul le multiple de 5 ou de 10 se remarquait. Les échanges ne montent pas le gain, ils lui changent de nature — c'est le rythme qu'on achète, pas le montant.
- 50 golds/niveau ne concurrencent pas les missions (650/jour) : un niveau vaut un dixième de journée de missions, c'est un bonus, pas un revenu. Le revenu en golds **baisse d'ailleurs de 40 %** (300 par dizaine au lieu de 500), et c'est assumé : ce sont les missions qui paient en golds.
- **20 gemmes et non 50** aux niveaux en 2 et 7 : à deux fois par dizaine, le montant de la marche de 5 perdrait son statut de rendez-vous et les gemmes celui de monnaie rare. Elles ne se gagnent qu'ici et aux paliers hebdomadaires — 50 tous les 5 niveaux = une variante d'illustration (50 💎) tous les 5 paliers.
- ⚠️ **Le palier à objet passe de 1 à 3 par dizaine** — le poste le plus coûteux du barème (une carte se vend 500 golds en boutique). C'est assumé, et ça se borne tout seul : le tirage est plafonné par le **zéro doublon**, il ne peut jamais rendre plus que ce que le joueur ne possède pas encore, et il s'éteint de lui-même sur un compte complet (`item: null`, sans compensation).
- **Le gain se RÉCUPÈRE, il ne tombe pas** (`POST /api/me/levels/claim`), d'un tap dans la section Progression du **Profil** — même règle que les missions terminées et les cadeaux, et pour la même raison : un crédit automatique fait disparaître le gain sous les yeux du joueur. Un niveau se gagne n'importe où (fin de combat, lot de missions, cadeau) ; le geste, lui, tient à un seul endroit. **Rien ne périme un palier** — il n'y a aucune rotation ici, contrairement à la boutique.
- ⚠️ **`progression.grant` ne connaît PAS les paliers** : il fait monter `level`, un point c'est tout. La dette se **déduit à la lecture** (`level − levels_claimed`), il n'y a donc rien à brancher sur les sources d'XP — donc rien à oublier de brancher le jour où une source s'ajoute.
- **L'état tient en une colonne** : les paliers dus sont `levels_claimed + 1 … level`. C'est possible parce qu'un palier ne se saute pas — ils se récupèrent **dans l'ordre et tous à la fois**, le joueur n'a rien à arbitrer et il n'y a pas de file à stocker.
- ⚠️ **Un gain d'XP qui franchit plusieurs paliers les doit TOUS**, chacun selon **son** barème (250 XP depuis le niveau 1 = les paliers 2 et 3 = 20 gemmes et un objet, zéro gold) : sauter l'intermédiaire dépouillerait le joueur qui joue rarement mais longtemps.
- ⚠️ **La garde anti-double-récupération est dans le SQL** (`stmt.claimLevels`), jamais en JS — même règle que `claimMission` et `claimGift`. C'est un **compare-and-swap** : `WHERE levels_claimed = @from AND level = @level`, pour qu'un niveau gagné entre la lecture et l'écriture ne soit pas soldé sans avoir été livré. Deux taps concurrents ne changent qu'une ligne, le second voit `changes === 0`. La marque est posée **avant** la livraison, le tout dans une transaction.
- ⚠️ **L'objet d'un palier est tiré AU MOMENT DU TAP**, pas quand le niveau est gagné : entre les deux, le joueur a pu acheter la carte ou le cosmétique que le tirage aurait mis de côté — c'est ce qui préserve le **zéro doublon**. Corollaire : ce qui attend est annoncé comme une surprise (`🎁 ×N`), jamais nommé d'avance.
- ⚠️ **Les niveaux posés d'autorité n'ouvrent aucun palier** : `applyAdminGrants` écrit `level: 100` puis aligne `levels_claimed` (`stmt.syncLevelsClaimed`), sinon un admin promu trouverait cent paliers rétroactifs à prendre.
- ⚠️ **Migration** : `users.levels_claimed` est ajoutée de façon additive, et **son absence est le marqueur d'une bascule qui ne doit tourner qu'une fois** — les comptes existants sont alignés sur leur niveau courant (`UPDATE users SET levels_claimed = level`). Sans elle, un joueur déjà niveau 40 ouvrirait l'écran sur quarante paliers rétroactifs, tirages d'objets compris. Même idiome que `user_missions.claimed_at`.
- **Le tirage n'a ni pool ni hasard à lui** : `shop.sellableCards` (donc illustration obligatoire — un palier qui révèle un cadre vide gâche son seul moment), `cosmetics.avatarPool` et `cosmetics.variantPool`, moins ce qui est déjà possédé. Déterministe à `(joueur, niveau)` (`shop.seededRandom`), comme la boutique. Il a lieu **palier par palier, dans l'ordre**, et non une fois pour toutes sur l'état de départ : une récupération de dix paliers en tire trois, et le second ne doit pas pouvoir redonner ce que le premier vient de livrer.
- Les trois familles sont **équiprobables**, et le tirage se fait **entre celles qui ont encore un candidat** — sans ce filtre, un joueur ayant tout acheté d'une famille perdrait le palier une fois sur trois. Pondérer par valeur marchande (une carte à 500 golds contre un avatar à 5 gemmes) reviendrait à promettre surtout des avatars.
- **Une carte tirée est une carte achetée moins la caisse** : `progression.unlockCard` puis `shop.settleCollection` (épingle libérée, prime de complétion du pack terminé versée) — mêmes conséquences que pour un lot de cadeau.
- **Pool entièrement épuisé** (compte qui possède tout) → `item: null`, et **aucune compensation n'est inventée** : le palier verse ses monnaies et le dit. Un lot de repli ferait apparaître une seconde règle, invisible dans le barème affiché au joueur.
- ⚠️ **Règle de dépendances** : `levels.js` est un **puits**, comme `gifts.js` — il requiert `shop.js`, `cosmetics.js` et `progression.js`, aucun ne doit le requérir en retour. C'est aussi pourquoi la dette se déduit au lieu d'être versée par `grant` : `progression.js` n'a jamais à charger les pools du tirage. Seul `auth.js` gagne une dépendance vers `progression.js`, pour la seule dette (`pending_levels` de `publicUser`).

**Client** — rien de tout ça n'est recopié : le barème **voyage** dans `GET /api/me/progression` (`levels.preview` → `rules` (échanges compris, via `rules.swaps`), `pending`, `pending_totals`, `upcoming` (4 paliers), `next_gems_level`, `next_draw_level`).

- ⚠️ **`rules.swaps` porte des RANGS dans la dizaine (`[2, 7]`, `[3, 8]`), pas des niveaux** : c'est ce qui permet à la phrase de règle de tenir en une ligne au lieu d'énumérer une suite infinie. Le client écrit « les niveaux en 2 et 7 », il ne calcule rien.
- ⚠️ **`next_gems_level` / `next_draw_level` ne se calculent PLUS par un multiple** (`nextLevelMatching` balaie le barème lui-même). Les échanges donnent gemmes et objets *entre* les multiples : à partir du niveau 11, la version d'avant annonçait « prochain objet : Nv. 20 » alors qu'un objet tombe au 13 — faux de sept niveaux, sur le seul écran qui répond à « et si je monte, qu'est-ce que j'y gagne ? ».
- ⚠️ **Un montant nul ne s'affiche pas** (`UpcomingRow`, le récap du bouton Récupérer, la révélation) : sur un niveau d'échange, un « 💰 0 » se lirait comme une perte au lieu d'un échange. Une série faite d'échanges seuls (le palier 3 pris seul) n'affiche donc aucune ligne de monnaie — les illustrations de l'objet disent déjà ce qui a été gagné.

- **`pending_levels` voyage avec CHAQUE réponse qui crédite** (`progression.getProgression`, donc aussi `auth.publicUser` → `/auth/me`, login, register) : la pastille est juste à la seconde où le niveau est gagné, sans second appel.
- `components/ui/ProgressionStats.tsx` — `<LevelRewardsPanel>` porte le **bouton Récupérer** (annonçant le total dû) au-dessus de la règle et des 4 prochains paliers : c'est la seule chose actionnable de l'écran. La **révélation** passe par `createPortal(…, document.body)` — déclenchée depuis un `Panel`, qui porte `backdrop-blur`, elle serait sinon rognée dans sa colonne (cf. `ConfirmBuy`, `GiftReveal`).
- `screens/ProfileScreen.tsx` — le panneau sous la jauge : la règle en une phrase, les 4 prochains paliers (celui à objet souligné), et les deux rendez-vous en clair (la liste ne va pas toujours assez loin — un objet peut être à 10 niveaux). Pas de store dédié : la donnée ne sert qu'à cet écran, et l'écran la recharge après un tap.
- **Pastille verte chiffrée sur la pastille de niveau** (menu et en-tête) quand des paliers attendent : le même `CountBadge` que Missions et Cadeaux, et il ne s'efface pas à la visite mais quand tout est récupéré. Elle prend la place du décompte d'XP plutôt que de s'y ajouter — une quatrième valeur ferait déborder la pastille sur deux lignes.
- **Toast** : celui des missions, pas un second (`components/ui/RewardToasts.tsx`, cf. Missions) — un niveau gagné annonce « à récupérer » exactement comme une mission terminée. Il ne dit pas ce que le palier contient : l'objet n'existe pas encore. Le niveau franchi est **lu des deux instantanés** par `authStore.applyProgression` (`from`/`to`), il n'est pas transmis : le serveur ne dit que l'état. Toutes les réponses qui créditent de l'XP y passent (solo, tournoi, PvP, missions, arcade, cadeaux), il n'y a donc pas d'autre point de branchement à tenir à jour.
- Verrouillé par `client/src/test/levels.test.ts` (36 golden tests, même harnais serveur que `gifts.test.ts` ; catalogues lus depuis `initial-data/`, et une carte volontairement laissée **sans art** — elle ne doit jamais tomber). Les tests des échanges sont **éprouvés dans les deux sens** : barème remis à la pente uniforme → 19 rouges ; les deux rendez-vous recalculés par un multiple → 3 rouges. ⚠️ Les tests qui isolent **un** tirage visent désormais le **niveau 3**, premier palier à objet du jeu : c'est le seul dont l'état de départ soit exactement celui d'un compte neuf, au-delà un palier antérieur a déjà retiré son objet du pool.

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

- Les cartes non débloquées sont **masquées par défaut** ; le chip `🔒 Verrouillées` les révèle, grisées et intapables (cadenas via la prop `locked` de `CardTile`). Le compteur affiche par exemple `50/653 cartes débloquées` — les deux nombres suivent la donnée (dotation du pack de départ / catalogue vendable).
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

Le filtre ne vit **pas** qu'à l'entrée du tirage : les **six** lectures de la boutique partagent le même pool, faute de quoi elles se contrediraient.

| Endroit | Sans le filtre |
|---|---|
| `drawablePool` (emplacements, reroll) | une carte sans art en vitrine à 500 golds |
| `buildOffer` (report de l'épingle) | l'art retiré en admin, la vitrine remet quand même la carte |
| `buyBooster` (pool du pack) | la carte tombe au booster, révélée sur un cadre vide |
| `setsView` (`card_count` / `owned_count` / `complete` / **`card_ids`**) | « 55/57 » sur un pack dont les 2 dernières cartes ne peuvent plus sortir — et, dans la vue du contenu, deux vignettes que plus aucun tirage ne peut rendre |
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

Le découpage livré reste celui de `scripts/build-sets.js` (7 packs de ~57 cartes), désormais un simple **point de départ éditable** — attention, son `--write` réécrit `sets.json` *et* le champ `set` de toutes les cartes : il écrase le travail fait en admin. Ce qu'il garantit et ce qu'il ne garantit pas :

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

- `stores/shopStore.ts` — instantané + actions. Absorbe chaque réponse (solde via `authStore.applyProgression`, cartes via `collectionStore.add` — on ne recharge pas tout le catalogue d'ids après chaque achat).
- `screens/ShopScreen.tsx` — emplacements, boosters, révélation en modale. `<PackPoster>` pose l'**affiche du pack** à gauche de son nom (et dans l'en-tête de la révélation), avec une tuile 🎁 quand `has_poster` est faux. Il vit désormais dans `components/shop/PackContents.tsx`, que les deux écrans importent.
- `components/shop/PackContents.tsx` — le **contenu d'un pack**, carte par carte. ⚠️ Dossier `shop/` et non `shopping/`, qui est la Phase Shopping **en jeu**. La tuile d'un pack ne dit de son contenu qu'un nombre (« 12/57 ») : assez pour mesurer un avancement, pas pour arbitrer entre deux boosters à 1000 golds. On y **consulte, on n'y vend pas** — l'achat reste sur la tuile, à un seul endroit.
  - **Feuille plein écran**, pas une `Modal` (`max-w-sm`, scroll interne : ses filtres défileraient avec la grille), en `createPortal(…, document.body)` — même piège de bloc conteneur que `ConfirmBuy`, le déclencheur étant sous un `Panel`. `z-40` comme `Modal`, pour que les tooltips de carte (`TooltipHost`, z-50) restent **au-dessus** : c'est tout l'intérêt de l'appui long ici.
  - ⚠️ **Elle pose son PROPRE `onPointerDown={hideTooltip}`** : celui du `<main>` de `ShopScreen` ne couvre pas un portal monté sur `document.body`, et un tooltip ouvert à l'appui long n'aurait plus rien pour le refermer.
  - **Trois filtres**, tous dérivés du pack lui-même : chips de **tier** (seuls les tiers présents, avec leur effectif — depuis que le booster tire uniformément, la composition du pack **est** la distribution des drops), `<select>` d'**attributs** présents dans ce pack triés par effectif décroissant (le catalogue complet en compte 57, dont la moitié sans carte ici), et la **possession** en trois chips exclusifs (`Tout` / `À collecter` / `Possédées`, défaut `Tout` : on vient voir le pack, pas seulement son reste).
  - La **composition** vient de `ShopSet.card_ids` ; la **possession**, elle, ne voyage pas — elle se lit dans `collectionStore`, que `shopStore.absorb` alimente déjà. Une carte qui vient de tomber au booster bascule donc en « possédée » sans rechargement. `ShopScreen` appelle `collectionStore.load()` (sans `force`, l'appel est idempotent).
  - L'en-tête de `BoosterCard` (affiche + nom + compteur) est le déclencheur : un `<button>` dont les boutons d'achat sont les **frères**, jamais les enfants (un `<button>` imbriqué serait du HTML invalide, et le tap d'achat ouvrirait la vue au passage). Ouvrable même sur un pack complet ou `booster_enabled: false` — consulter n'est pas acheter.
  - ⚠️ La tuile de pack porte `min-w-0`, et ce n'est pas décoratif : c'est un **item de grille**, dont le `min-width` vaut `auto` par défaut — elle refuse donc de descendre sous sa largeur de min-content et **débordait l'écran par la droite en portrait**, donnant une barre de défilement horizontale à tout le document (mesuré : 413 px pour 390 de large). Ses enfants tronquent déjà ce qu'il faut ; il ne manquait que l'autorisation de rétrécir. Le piège vaut pour toute tuile dense posée dans une `grid`.
- **Tout achat passe par une confirmation** (`useBuyConfirm` / `<ConfirmBuy>`, partagés par les emplacements, les boosters et les cosmétiques). Un tap de la boutique est le seul geste du jeu qui débite un solde, il est définitif (ni annulation, ni revente, ni conversion de doublon), et les deux boutons de prix sont côte à côte — la mauvaise monnaie se choisit aussi vite que la bonne. La modale montre ce qu'on achète en grand et, surtout, **le solde qu'il restera** : le prix, lui, était déjà sur le bouton. Sur un booster elle annonce aussi le cas « moins de `card_count` cartes restantes », seul endroit où il peut être dit **avant** le débit.
  - ⚠️ **La modale est rendue dans un `createPortal(…, document.body)`, et ce n'est pas optionnel** : elle est déclenchée depuis une tuile, donc sous un `Panel` — qui porte `backdrop-blur`. Un `filter` / `backdrop-filter` sur un ancêtre crée un **bloc conteneur**, le `position: fixed` de `Modal` se résout alors sur la tuile et non sur l'écran : la modale se retrouve enfermée dans une colonne de la grille, boutons rognés. Le piège vaut pour toute `Modal` rendue sous un `Panel`.
  - Le bouton `Acheter` se verrouille pendant l'appel (et la fermeture au fond avec lui) : l'achat n'est **pas** idempotent côté serveur, deux envois débiteraient deux fois.
  - `SlotCard` est **vertical** (tier + icônes en tête, vignette, nom, les deux prix empilés) : six tuiles tiennent en **2 colonnes dès le portrait** (`grid-cols-2 sm:grid-cols-3`), ce que l'ancienne disposition horizontale ne permettait pas. 📌 et 🎲 sont remontés sur la ligne du tier — ils ne se disputent plus la largeur avec les boutons d'achat. Plus de `ReasonBadge` (les catégories ont disparu).
- `MainMenu` — bouton `🛒 Boutique` avec une pastille de nouveauté : un simple point, pas un compteur, effacé dès que l'écran a été ouvert pour le jour en cours (`hasUnseenShop` / `markShopSeen`, localStorage).
- `components/ui/primitives.tsx` — `Countdown` (rafraîchi à la **minute** : un repère, pas un chronomètre), partagé avec l'écran Missions.
- Verrouillé par `client/src/test/shop.test.ts` (45 golden tests) et `client/src/test/packs.test.ts` (15 : dotation, exclusions du pack de départ, miroir, composition servie, affiche), même harnais serveur que `missions.test.ts`. Les deux fichiers sont **séparés à dessein** : `packs.test.ts` réécrit `sets.json` en cours de route, là où `shop.test.ts` indexe les packs par position. Les deux déposent de **vrais PNG** dans un `ILLUS_DIR` temporaire (comme `cosmetics.test.ts`) : sans art, le pool vendable serait vide et les deux fichiers ne prouveraient plus rien.

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

**`client/src/data/CardArt.ts`** est le seul point de résolution `card_id → id d'illustration`. Deux tables, une par camp, et **aucun import** — c'est ce qui autorise `three/UnitCardEl.ts` à s'en servir (les garde-fous ESLint n'y interdisent que React et Zustand) pendant que `logic/` continue de tout ignorer. Trois sites : `cardTileProps` (main, cimetière, DeckBuilder, boutique, TestBench), `UnitCardEl` (board 3D) et `GraveyardTray`. Les tooltips de carte n'affichent aucune image : il n'y a rien à y câbler. Verrouillé par `client/src/test/card-art.test.ts` (13 golden tests) sur ses trois invariants, dont aucun ne se voit à l'écran quand il casse : le repli systématique sur `cardId`, l'étanchéité des deux tables (les variantes de l'adversaire ne doivent jamais habiller les cartes du joueur) et la purge du seul camp adverse par `setEnemyVariants(null)`.

Qui remplit les tables : `game/bootstrap.ts` (`buildSession`, point de passage unique du solo, du tournoi et du PvP), `stores/deckStore.refresh()` (écrans hors partie → deck actif), `PvpController.begin()` (camp adverse), `GameController.dispose()` (purge du camp adverse — la table joueur reste, les menus s'en servent). `artFor` retombe **toujours** sur `cardId` : une variante supprimée rend l'art d'origine, jamais un trou.

### PvP — le serveur dérive, il ne croit pas le client

`match:found` **et `match:rejoined`** portent `opponent.variants`, calculé par `cosmetics.deckVariantMap(userId, deckName)` à partir du **deck book serveur**, filtré par possession et par cohérence (`variants.byId(id).card_id === cardId`). Le méta de deck vient du client : sans ce filtre, n'importe qui afficherait à son adversaire une variante non achetée. Le `deckName` annoncé ne sert qu'à choisir une clé du **propre** livre de ce joueur.

Depuis, `opponent` porte **deux** faits dérivés du deck book serveur, par un seul point d'appel (`MatchRelay.deckDerived`) — les laisser se séparer voudrait dire qu'un client reconnecté n'a qu'une moitié de son adversaire :

| Champ | Nature | Sert à |
|---|---|---|
| `variants` | cosmétique | l'art des cartes adverses |
| `deck_attribute_counts` | **PAS cosmétique** | le choix du terrain de combat, donc des bonus de stats réels |

⚠️ **`deck_attribute_counts` est la première valeur dérivée du serveur qui n'est pas cosmétique**, d'où un module à part : **`decks.js`** (racine — il ne requiert que `db` et `json-cache`, personne ne le requiert en retour). La loger dans `cosmetics.js` aurait donné à ce module un nom qui ment sur ce qu'il porte. Il possède aussi la **résolution du deck book** (`resolveDeck`, repli « nom inconnu → deck actif »), que `deckVariantMap` open-codait : deux lectures du même livre finissent par ne plus s'accorder.

⚠️ **Le serveur envoie des COMPTES, pas une liste déjà seuillée.** Renvoyer les attributs filtrés mettrait `MIN_ATTRIBUTE_OCCURRENCES` **des deux côtés du fil**, à tenir synchronisé à la main — le piège de `XP_PER_LEVEL`, la seule valeur du projet dans ce cas, et une de trop. Le serveur **compte**, le client **seuille** (`BoardPicker.dominantAttributes`).

⚠️ **Divulgation assumée** : l'adversaire apprend les attributs dominants du deck avant la première unité posée. La puce 🗺️ du terrain annonce déjà la même chose un round plus tard, et l'alternative — faire choisir le terrain par le serveur — mettrait de la logique de jeu dans un relais dont tout le principe est d'être **opaque**.

⚠️ **`round:board_ready` n'est pas touché** — ni l'illustration ni le terrain n'y ont leur place : l'illustration n'est jamais simulée, et le terrain voyage par son **id** dans `round:go`, arbitré par le serveur. Le contrat de déterminisme (verrouillé par `pvp.test.ts`) est inchangé, et elles sont constantes sur la durée du match. `OnlineLobby` force `DeckRepository.flushSync()` **avant** `queue:join` : la synchro est debouncée à 500 ms, un choix fait juste avant d'entrer dans la file ne serait pas encore en base.

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
- 🎀 et non 🎁 : les **Packs** occupent déjà ce glyphe, et deux onglets au même pictogramme se confondent au coup d'œil. ⚠️ Ça ne tient plus à une contrainte technique : `switchTab` appariait autrefois par **sous-chaîne de libellé** (`t.includes('cadeau')`), il lit désormais `data-tab` — un libellé se renomme donc librement.
- **L'éditeur de lots est le seul champ répétable du panneau d'admin.** Il tient un état local `giftLots` (le DOM ne peut pas servir de source de vérité pour une liste dont on retire des éléments au milieu) et `_syncGiftDraft()` recopie la saisie **avant** chaque re-render — nom et description compris, sans quoi ajouter un lot effacerait le nom qu'on vient de taper.

### Client

- `stores/giftStore.ts` — instantané + `claimDaily()` / `claim(id)`. Son `absorb` fait les trois gestes de `shopStore.absorb` : `pickSnapshot`, `authStore.applyProgression`, et `collectionStore.add` des cartes livrées (lot `card` **et** cartes du booster) — un cadeau qui donne des cartes doit les faire apparaître au DeckBuilder sans recharger tout le catalogue d'ids.
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

## Adversaires artificiels (Duel en ligne)

Ce que le lobby sert quand la file d'attente ne trouve personne. Règles dans **`bots.js`** (racine) et **`ws/BotMatch.js`**, catalogue de decks dans **`initial-data/bot_decks.json`**, généré par **`scripts/build-bot-decks.js`**.

Ils existent pour une raison de peuplement : une file vide est un cul-de-sac, et un joueur qui cherche un duel trois fois sans rien trouver n'y revient pas. Passé un délai **tiré entre `MatchmakingQueue.BOT_DELAY_MIN_MS` (10 s) et `BOT_DELAY_MAX_MS` (20 s)**, le serveur sert donc un bot plutôt que rien.

| Règle | Valeur |
|---|---|
| Délai avant repli | **tiré entre 10 s et 20 s**, seul dans la file — une échéance fixe serait un tell |
| Priorité | un **vrai joueur arrivé avant l'échéance l'emporte toujours** — un bot ne vole jamais un duel humain |
| Deck | l'un des **10 de `bot_decks.json`**, tiré au hasard |
| Identité | pseudo (48 au catalogue) + tag `#1234` + avatar `/illustrations/<id>` |
| Gain d'une victoire | **`pvp_win` (70 XP)**, décerné par le serveur |

⚠️ **Le joueur n'apprend jamais que son adversaire en est un.** C'est une décision de design, et elle contraint le code : rien dans `GameScreenPvp` — ni dans la présentation d'adversaire du lobby, qui lit le **même** `opponent` — ne doit prendre de branche visible sur `bot`. Un duel bot et un duel réel partagent l'écran, le HUD, les overlays, le chrono, le libellé d'abandon et l'écran de résultat — il n'y a qu'un contrôleur de différence.

### Le bot est joué par le CLIENT, pas par le serveur

Le PvP est un **relais opaque** : aucune logique de jeu ne vit côté serveur, et les deux clients simulent en parallèle grâce au déterminisme de `CombatManager`. Faire jouer un bot au serveur reviendrait à porter tout `client/src/logic/` côté Node — et à casser le principe qui tient tout le mode.

La partie contre bot est donc **un solo** : `buildSession(deckName, 'ai', pseudo, botDeck)`, avec l'`EnemyAI` habituelle. Ce qui reste au serveur, et qui justifie qu'un WebSocket soit encore dans la boucle, c'est la **caisse**.

⚠️ **Corollaire heureux pour le terrain** : le deck du bot voyageant en clair, la session `mode: 'ai'` le reçoit comme `enemyDeck` — un duel contre bot choisit donc son terrain sur les **deux vrais decks**, sans une ligne dans `BotController`, là où le PvP réel a dû faire dériver les attributs adverses par le serveur (cf. « Le tirage du terrain »).

| | Duel réel | Duel bot |
|---|---|---|
| Contrôleur | `PvpController` | **`BotController`** (`client/src/game/`) |
| Session | `mode: 'pvp'`, board adverse reconstruit du réseau | `mode: 'ai'`, deck adverse annoncé par le serveur |
| Serveur | `ws/MatchRelay.js` (relais + arbitrage) | **`ws/BotMatch.js`** (identité + horloge + caisse) |
| Table `matches` | ligne insérée | **aucune** — la FK exige deux `users.id` |

- **`match:found` porte un champ `bot`** (le deck) et c'est la seule chose qui distingue les deux messages. `PvpConnection.getBotMatch()` le rend, `GameScreenPvp` monte l'un ou l'autre contrôleur, et **rien d'autre de l'écran n'en sait quoi que ce soit**.
- ⚠️ **Un match bot n'est PAS écrit dans `matches`**, et ce n'est pas un contournement de la clé étrangère : la table sert à retrouver le match **actif** d'un joueur qui recharge sa page, or un match bot n'est pas reprenable — tout son état de jeu vit dans l'onglet du joueur et meurt avec lui.
- **Fermer l'onglet efface le match**, sans gain ni défaite : il n'y a pas de période de grâce à tenir, aucun adversaire n'attend.

### La latence de « PRÊT » — le seul vrai piège du mode

Sans elle, l'adversaire répond au quart de seconde à **chaque** round, et c'est le tell : un vrai joueur pose ses unités, hésite, choisit sa magie. `BotController` tire donc à chaque round un moment où il est prêt, **compté depuis le début de la préparation** (`READY_MIN_MS` 3 s → `READY_MAX_MS` 22 s), et affiche l'overlay « En attente de l'adversaire… » — celui du PvP réel, pas un second.

- **Depuis le début de la préparation, pas depuis le tap du joueur** : celui qui prend son temps ne l'attend jamais, celui qui expédie son tour patiente. C'est exactement ce que produit un adversaire humain.
- Le plafond reste **bien sous `PREP_DURATION_S`** (60 s) : au-delà, le chrono lancerait le combat avant que le bot ne soit « prêt ». `onPrepTimeout` remet d'ailleurs l'échéance à zéro — l'adversaire a le même chrono, il est réputé prêt lui aussi.

### La caisse — ce que le client ne peut pas s'attribuer

⚠️ **Une victoire contre bot paie `pvp_win` (70 XP), et le résultat est rapporté par le CLIENT.** C'est la limite assumée du choix « bot côté client » : le serveur n'a aucune simulation à opposer au rapport. Le gain reste hors de portée du client — il envoie `match:report_result` et **ne nomme jamais un montant**, exactement comme en PvP réel ; `CLIENT_CLAIMABLE` continue de refuser `pvp_win` sur la route HTTP.

Deux plafonds bornent l'abus sans prétendre le fermer — même posture que le rate-limit des gains solo :

| Garde-fou | Valeur | Raison |
|---|---|---|
| Durée plancher | **60 s** (`MIN_MATCH_MS`) | une partie de 5 tours contre 1000 PV ne se gagne pas en une minute |
| Plafond horaire | **20 victoires** (`MAX_REWARDS_PER_WINDOW`) | un duel légitime dure ≈ 3 min ; le plafond ne touche que la boucle scriptée |

Les deux sont **larges à dessein** : invisibles à qui joue normalement. Un match refusé est quand même **soldé** — c'est le gain qu'on retire, pas la partie.

### La socket d'un duel bot est MUETTE — d'où trois garde-fous

Un duel réel écrit à chaque round (`round:board_ready`, `combat_start_ack`, `next_ready`…). Un duel bot n'envoie **rien** entre `match:found` et le rapport final : la partie est un solo, tout se joue dans l'onglet. Une socket silencieuse dix minutes est exactement ce qu'un NAT ou un proxy inverse recycle — c'est ce qui rend la coupure bien plus probable **contre un bot que contre un joueur**, à code identique.

- **Battement de cœur client → serveur** (`PvpConnection.KEEPALIVE_MS`, 25 s). ⚠️ Il n'est pas redondant avec le `ping` de `pvpServer` (30 s), qui ne produit que du trafic **serveur → client** : ce sont les octets montants qui manquent. Le serveur reconnaît le type `ping` **avant** le `default` qui relaie — un type inconnu relayé s'empilerait indéfiniment dans le tampon du client d'en face.
- ⚠️ **`_socket_closed` ne se met JAMAIS en tampon** (`PvpConnection.TRANSIENT`), et `connect()` **vide le tampon** en ouvrant une socket neuve. Le tampon existe pour une course réseau de round (le serveur relaie avant que le contrôleur n'ait atteint son `on()`) ; appliqué à un événement de cycle de vie, il rejouait la coupure d'une socket **morte** au premier abonné venu — c'est-à-dire au `begin()` du duel suivant. Un échec de `connect()` au lobby, suivi d'un « Réessayer », ouvrait donc un duel parfaitement sain sur **« Connexion perdue »**, bannière que rien n'effaçait et qui masquait ensuite **tout retour d'invocation** (`errorFlash` prime sur `invocationBanner` dans `hud/PhaseTimer.Banners`). Chaque handler porte en plus une garde de génération (`ws === sock`) : une socket remplacée ne parle pas au nom de celle qui la remplace.
- **`PvpConnection.send` rend un booléen**, et `BotController` s'en sert. Une socket morte avalait le `match:report_result` sans un mot : le joueur restait derrière « En attente de l'adversaire… » **pour toujours**, sur une partie dont il connaissait le résultat, sans autre issue que le rechargement. Idem pour l'abandon, qui refermait juste le menu. On se rabat désormais sur le résultat local (`_resolveLocally`), avec un plafond de `MATCH_END_TIMEOUT_MS` (10 s) quand le rapport est bien parti mais que `match:end` ne revient pas. ⚠️ **Aucun gain n'est appliqué** — le serveur reste seul arbitre de la caisse — et on le **dit** : l'écran de résultat porte une `note` (prop de `GameOverScreen`, alimentée par `errorFlash`), la bannière de jeu passant sous la modale. Même posture que le `reportError` de l'Arcade : on nomme l'arbitre au lieu de prétendre.
- Verrouillé par `client/src/test/pvp-connection.test.ts` (7 golden tests, éprouvés dans les deux sens — 4 passent au rouge sur le comportement d'avant). ⚠️ Il pose `WebSocket` et `location` à la main : la suite tourne en node sans DOM, et le module est **singleton** — d'où le `vi.resetModules()` par cas.

⚠️ **`PvpController` (duel réel) n'a PAS de repli équivalent**, et c'est délibéré : sans réseau, un vrai duel n'a plus d'adversaire à qui opposer sa simulation, et le serveur donne la victoire à celui qui reste (`MatchRelay.handleDisconnect`). Se solder localement y inventerait un résultat.

### Les decks — `scripts/build-bot-decks.js`

Dix decks, un par archétype (Dragon, Rouages anciens, Magicien, Aquatique, Insecte, Zombie, Guerrier, Démon, Bête, Dinosaure), 24 à 26 cartes, avec un **profil de jeu** (aggro / tank / distance / pouvoirs / essaim) qui départage les candidats à puissance de thème égale.

```
node scripts/build-bot-decks.js            # rapport
node scripts/build-bot-decks.js --write    # regénère initial-data/bot_decks.json
node scripts/build-bot-decks.js --check    # revalide le fichier livré (exit 1 si KO)
```

- ⚠️ **Le catalogue est du CODE, pas de la donnée** : lu depuis `initial-data/`, sans copie sur le volume (`bootstrap`) ni CRUD d'admin. Un deck de bot n'est pas un contenu qu'on retouche, c'est une dérivation du catalogue de cartes — on le **regénère**. Même statut que l'avatar par défaut des decks publics.
- **La contrainte qui commande tout le générateur** : au-delà du tier 2, le catalogue n'a presque aucune invocation *normale*. Les hauts tiers ne sont donc retenus que si le deck **couvre déjà** leurs matériaux (ids *et* attributs), la couverture s'accumulant tier par tier — une fusion T3 retenue alimente le T4. Sans ce filtre, la main des derniers tours se remplit de cartes définitivement injouables, et un bot ne les remplacera jamais par autre chose. Même règle que `game/tutorialDeck.ts`.
- **Plancher de puissance** par haut tier (p25 du catalogue) : mieux vaut un tier plus court qu'une carte de tier 4 plus faible que le socle qu'elle est censée remplacer.
- **Les Dieux Égyptiens (`ARCH_031`) sont exclus** : une option « sacrifice 3 » suffit à les rendre invocables, ils tombaient dans la moitié des decks.
- **Le hors-thème n'est qu'un dernier recours**, pour atteindre les 24 cartes : un tier plus court vaut mieux qu'une carte que rien dans le deck ne fait résonner. Les decks se construisent **à la suite** et s'évitent les uns les autres, pour que dix bots n'alignent pas les mêmes staples.
- **Le pseudo est DÉCOUPLÉ du deck** et tiré à chaque match : les apparier serait le tell le plus facile du système (« ce pseudo joue toujours des dragons » se remarque au troisième duel). L'**avatar**, lui, vient des cartes du deck — comme un joueur qui porte une carte qu'il aime — et n'est retenu que si son PNG existe : un `<img>` vide dans le HUD adverse serait le tell le plus visible qu'on puisse laisser.
- Verrouillé par `client/src/test/bots.test.ts` (19 golden tests, même harnais serveur que `shop.test.ts`). ⚠️ Il lit le catalogue de decks à son emplacement **réel** et le confronte au **vrai `data/cards.json`** : une carte supprimée en admin doit casser ici, pas en laissant un bot poser une main injouable devant un joueur.

---

## 🔬 Log de combat PvP par tick — OUTIL DE DIAGNOSTIC TEMPORAIRE

> **Ce lot est fait pour disparaître.** Il ne corrige rien : il rend visible une
> panne qu'aucun code du projet ne permettait de constater. Une fois la cause
> établie et corrigée, tout ce qui suit se retire d'un bloc (§ « Comment le
> retirer »).

Un duel en ligne est simulé **en parallèle par les deux clients**, et le combat
ne consomme **aucun hasard** (`CombatManager` ne reçoit ni `rand` ni graine).
Les deux simulations sont donc censées être identiques au tick près. Des écarts
ont pourtant été observés, et le seul signal existant était le `console.warn` de
`ws/MatchRelay.handleReportResult` sur `result_mismatch` — c'est-à-dire à la
toute fin, en disant seulement « les deux joueurs ne sont pas d'accord sur le
vainqueur ». Il n'existait par ailleurs **aucune instrumentation** du chemin de
combat : pas un `console.log`, pas de drapeau debug, et `Unit.toDebugInfo()`
n'avait aucun appelant.

Chaque combat PvP est donc enregistré **des deux côtés**, tick par tick, et
`/admin` sert un fichier qui met les deux vues face à face en nommant la
première différence.

### La forme canonique — le point qui commande tout le reste

Les deux clients ne voient pas le même monde : celui du rôle B est le **reflet**
de celui de A (`mirrorRow = 10 - row`, `net/PvpOpponentProvider.js`). Un diff
brut de deux vues locales ne dirait rien. **Le client normalise donc à la
capture, dans le repère du rôle A** ; le serveur compare champ à champ sans
jamais savoir de quel côté il regarde.

| | Règle |
|---|---|
| Position | `row_canon = (role === 'B') ? 10 - row : row` — **uniforme**, mes unités comme celles d'en face. `col` ne se miroite pas. |
| Propriétaire | `owner = (u.side === 'player') ? monRôle : l'autre` |
| Identité | `` `${owner}:${card_id}` `` |

⚠️ **Surtout pas l'`uid`.** Il voyage bien dans `round:board_ready`, mais
`reconstructOpponentUnits` le **jette** et laisse `new Unit` en tirer un neuf
d'un compteur de module : il n'a aucune valeur commune aux deux clients. La
règle du doublon garantit qu'une `card_id` n'est pas vivante deux fois du même
côté, donc `(owner, card_id)` désigne bien une unité et une seule. C'est déjà le
choix de `refUnit` dans `client/src/test/helpers.ts`, et pour la même raison.

⚠️ **Les positions PORTÉES PAR LES ÉVÉNEMENTS se normalisent aussi**
(`move.from/to`, `freeze.cell`) : laissées brutes, elles divergeraient par
construction entre les deux clients et noieraient toute autre différence.

### Client — `client/src/game/CombatRecorder.ts`

⚠️ **Il vit dans `game/` et PAS dans `logic/`**, et ce n'est pas du rangement :
`logic/` est headless et verrouillé par des golden tests de déterminisme, il n'a
aucune raison d'apprendre qu'un mode de jeu s'observe. L'enregistreur se branche
sur le crochet **`onStep` que `GameController` possédait déjà** — il lit, il ne
participe pas. Aucun import : ni React, ni Zustand, ni Three, ni `logic/`.

- **En-tête** (une fois) : `board_id`, **`blocked_cells`** (tel que vu
  localement), unités de départ. C'est ce dernier champ qui tranche à lui seul
  le suspect n°1 ci-dessous.
- **Par tick** : `t` (le `_stepCount` du moteur), **`order`** (l'ordre
  d'initiative — le champ le plus diagnostique du fichier), une ligne compacte
  par unité, et les événements.
- ⚠️ **Les événements se copient EN PROFONDEUR à l'émission** : ils portent des
  références vivantes vers les `Unit` et vers des objets (`dot`, `extra`) que
  les steps suivants mutent. Le note explicite de `client/src/test/helpers.ts`.
- ⚠️ **Plafond dur `MAX_LOG_BYTES = 700_000`**, et la troncature se **dit**
  (`truncated: true`). Le corps d'une requête `/api` est plafonné à 1 Mo hors
  routes d'upload : un log qui casse son POST ne vaut rien, et un fichier
  silencieusement amputé est pire qu'un fichier absent. Pire cas mesuré
  (12 unités × 333 ticks) ≈ 250 Ko — la troncature ne devrait jamais servir.
- ⚠️ **Rien n'est enregistré en duel contre BOT** : la partie y est un solo, il
  n'existe qu'un point de vue, et le match n'a aucune ligne dans `matches`.
- ⚠️ **L'envoi est « pose et oublie »** : jamais attendu, jamais montré au
  joueur, `catch` muet. Un outil de debug qui peut retarder une navigation ou
  faire perdre un duel est pire que pas d'outil.
- ⚠️ **Ne pas passer par le WebSocket** : `maxPayload` y vaut 64 Ko, et surtout
  tout type inconnu est **relayé à l'adversaire** par le `default` de
  `ws/pvpServer.handleMessage`, où il s'empilerait indéfiniment dans le tampon
  de `PvpConnection`.

Branchements : `PvpConnection.getMatchId()` (nouveau export),
`GameController._newRecorder()` / `_flushRecorder()` (deux crochets `protected`,
no-op dans la classe de base), surchargés par `PvpController`, et
`AuthClient.postPvpLog`.

### Serveur — `pvplog.js` + table `pvp_combat_logs`

`pvplog.js` est une **feuille** : il ne requiert que `db`, et personne ne le
requiert en retour hors des deux routeurs et de la purge d'`app.js`. Même statut
que `decks.js` — un outil qu'on doit pouvoir retirer d'un bloc.

⚠️ **`record` vérifie l'appartenance au match, et ce n'est pas décoratif** :
c'est une écriture ouverte aux joueurs. Le match doit exister, le `user.id` doit
être l'un des deux joueurs, et le `role` annoncé doit correspondre à sa **place
réelle** — la clé primaire étant `(match_id, round, role)`, un rôle usurpé
permettrait d'occuper la place de son adversaire et d'empêcher sa vue d'être
enregistrée. Sans ces contrôles, le fichier qu'on lit ensuite pour arbitrer une
divergence serait exactement ce qu'un tricheur y aurait écrit.

⚠️ **`INSERT OR IGNORE` : le PREMIER écrit gagne.** Un renvoi ne doit pas
pouvoir réécrire après coup ce qu'on est en train de diagnostiquer.

**`diff(a, b)` s'arrête à la PREMIÈRE différence**, du plus structurant au plus
fin — au-delà, tout diverge par ricochet et le rapport ne dirait plus rien de la
cause :

| `kind` | Ce qu'il compare |
|---|---|
| `header` | `board_id`, **`blocked_cells`** (en ENSEMBLE, pas en liste ordonnée), unités de départ |
| `order` | l'ordre d'initiative du tick |
| `state` | le vecteur d'une unité — **le champ fautif est NOMMÉ** |
| `events` | un acte qui diffère à état et ordre identiques |
| `length` | un côté plus court, ou un vainqueur différent |

Le stockage est compact (lignes positionnelles + une légende `columns` écrite
une fois) parce qu'il y a jusqu'à 333 ticks × 12 unités ; le **`detail` d'une
divergence est entièrement expansé en champs nommés**, c'est le seul morceau du
fichier qu'un humain ouvre vraiment.

### Routes

| Route | Accès | Description |
|---|---|---|
| `POST /api/me/pvp-log` | Connecté (20/min) | Dépôt d'une vue. ⚠️ N'existe QUE parce que `routes/online.js` est monté **avant** le write-guard global |
| `GET /api/admin/pvp-logs` | Site admin | Liste + verdict par match |
| `GET /api/admin/pvp-logs/:matchId` | Site admin | Le bundle complet |
| `GET /api/admin/pvp-logs/:matchId/download` | Site admin | Le même en pièce jointe |
| `DELETE /api/admin/pvp-logs/:matchId` | Site admin | Purge d'un match |

`routes/admin-pvplog.js` est monté avec un **`requireSiteAdmin` explicite**,
même raison qu'`admin-db.js` et `admin-sim.js` : les GET sous `/api` sont
publics par défaut, et un log nomme les deux joueurs d'un duel.

⚠️ **Le `:matchId` compose un NOM DE FICHIER** (`Content-Disposition`) → garde
stricte sur la forme UUID réellement produite par `crypto.randomUUID`, **400**
et non 404. Même raison que le `DATE_RE` d'`admin-sim.js` et que `safeAssetId` ;
le 400 strict est le canari, un 404 signalerait une normalisation en amont.

**Rétention** : `KEEP_DAYS = 7`, purgée dans le `runMaintenance` **existant**
d'`app.js`. Pas de nouveau minuteur.

### Admin — onglet `🔬 Logs PvP`

Patron **sans barre latérale** de `#tab-db`, chargement paresseux au premier
clic dans `switchTab`, ajouté à `NO_FAB_TABS`, et sélecteurs portés par
`#main-tabs` (le piège `.tab` réutilisé). Réutilise `.db-table` / `.db-toolbar`
/ `.db-pager` — seul le verdict a son propre style. La liste ne transporte que
le verdict ; le **détail est chargé à la demande**, le bundle pesant
potentiellement plusieurs centaines de Ko. Vérifié au navigateur en 1280 px et
en 390 px (`scrollWidth <= clientWidth`, un seul `.main:not(.hidden)`, un seul
`#main-tabs .tab.active`, le tableau défilant dans son conteneur).

### ⚠️ Ce que le log est fait de prouver — quatre suspects, le premier mesuré

1. **7 terrains sur 14 ont des cases bloquées non symétriques par le miroir.**
   `GameSession.startCombat` applique `boardData.blocked_cells` **verbatim** des
   deux côtés alors que le monde du rôle B est le reflet de celui de A : pour
   que les deux simulations s'accordent, l'ensemble doit être invariant par
   `row → 10-row`. Mesuré sur les données livrées : `BOARD_001, 008, 009, 010,
   011, 013, 014` ne le sont pas (ex. `BOARD_014` : `[{3,6},{1,4}]` → miroir
   `[{3,4},{1,6}]`). Ligne de vue et contournement BFS divergent dès le premier
   tick. **Suspect n°1**, et le champ `blocked_cells` de l'en-tête le tranche
   seul.
2. **L'ordre des tableaux d'unités est inversé entre les deux clients.**
   `Board.getUnitsOnSide` balaie col-major, row **croissante** : un camp aux
   rows 0–3 sort dans l'ordre 0,1,2,3, le même camp miroité aux rows 7–10 sort
   7,8,9,10 — l'ordre relatif **inverse**. Or ce tableau départage
   `findAttackTarget` (`d < bestDist`, premier arrivé), le `reduce` de
   provocation, `POWER_HEAL` et `_teleportPlan`.
3. **Le tri d'initiative n'a pas de départage de camp** : `[...playerUnits,
   ...enemyUnits]` met « mes » unités en tête sur chaque client ; à égalité
   d'initiative, de vitesse **et** de `card_id` (possible — deux joueurs peuvent
   jouer la même carte), le tri stable tranche dans deux sens opposés.
4. **`Board.getNeighbors` n'est pas symétrique par réflexion** (`[col-1, col+1,
   row-1, row+1]`) : le BFS rend le *premier* plus court chemin trouvé.

### Tests

`client/src/test/pvp-log.test.ts` (39 golden tests, harnais HTTP réel de
`http-harness.ts`). Couvre les cinq natures de `diff`, l'arrêt à la première
différence, les refus de `record` — **chacun prouvé par l'ABSENCE DE LIGNE en
base, jamais par un code de statut** —, l'idempotence, les deux routes de bout
en bout, la garde du nom de fichier, la rétention, et surtout **la forme
canonique** : un même combat physique enregistré des deux côtés doit rendre le
**même** log, et un terrain non symétrique doit ressortir en `header` au tick 0.

⚠️ **13 régressions ont été réintroduites une par une**, chacune fait passer la
suite au rouge : normalisation des rows retirée, clé d'unité prise sur le camp
local, positions d'événements non normalisées, plafond de taille retiré,
`blocked_cells` comparées dans l'ordre d'écriture ou pas comparées du tout,
ordre d'initiative non comparé, diff rendant la dernière différence au lieu de
la première, champ fautif non nommé, contrôle d'appartenance ou de rôle retiré,
`INSERT OR IGNORE` passé en `OR REPLACE`, garde du nom de fichier retirée.

### Comment le retirer

Tout est **additif**, en sept points : la table `pvp_combat_logs` et ses
statements dans `db.js`, `pvplog.js`, la route `POST /me/pvp-log` de
`routes/online.js`, `routes/admin-pvplog.js` et son `app.use`, la purge dans
`runMaintenance`, l'onglet d'`admin.html`, et côté client
`CombatRecorder.ts` + les deux crochets `protected` de `GameController`,
leurs surcharges dans `PvpController`, `getMatchId()` et `postPvpLog`.
**Rien n'est touché dans `logic/`**, aucun payload réseau existant n'est
modifié, et le contrat de déterminisme (`round:board_ready`, verrouillé par
`pvp.test.ts`) est intact.

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

## Tests de la couche HTTP et WebSocket

Le reste de ce document nomme, domaine par domaine, le fichier qui verrouille chaque module de règles (`shop.test.ts`, `gifts.test.ts`, `arcade.test.ts`…). Il taisait longtemps un trou : **`routes/online.js`, `auth.js`, `db.js` et `ws/` n'avaient aucune couverture** — les golden tests exercent les règles à travers un harnais qui contourne Express. C'est très exactement là que vivaient tous les constats sérieux de l'audit du 22 août 2026.

| Fichier | Ce qu'il verrouille |
|---|---|
| `client/src/test/http-harness.ts` | Le harnais : démarre `app.js` sur un port éphémère (pas un `*.test.ts`, donc jamais collecté seul) |
| `client/src/test/http.test.ts` | Refus d'écriture anonyme, traversée de répertoire sur trois portes, write-guard, révocation de session au reset, plafonds de corps, recherche par souligné, écriture atomique |
| `client/src/test/http-boot.test.ts` | Le refus de démarrer sans `ADMIN_PASS` — et l'absence d'effet de bord sur le disque |
| `client/src/test/pvp-relay.test.ts` | L'arbitrage du relais : rapports concordants, divergents, forfait ; la **dérivation serveur du deck adverse** et la **barrière du terrain** |

Le harnais suit le patron des tests serveur existants (`createRequire`, `DATA_DIR` temporaire, env posées **avant** le premier `require`), avec deux différences qui comptent :

- **aucun catalogue n'est recopié à la main** : `bootstrap()` vit dans `app.js` et peuple un `DATA_DIR` vide depuis `initial-data/`, par le code de production lui-même ;
- **`ILLUS_DIR` est un ENFANT d'une racine à nous.** `asset-dirs.js` déduit `AVATARS_DIR`/`POSTERS_DIR`/`BOARD_BG_DIR` de `path.dirname(ILLUS_DIR)` : le poser directement dans `os.tmpdir()` ferait pondre `$TMPDIR/enemy_avatars`, partagé entre fichiers de tests et avec la machine du développeur. C'est aussi ce qui donne un « au-dessus d'`ILLUS_DIR` » propre, où déposer le fichier-victime du test de traversée.

⚠️ **`http-boot.test.ts` est un fichier SÉPARÉ, et pas par goût.** Les modules racine sont chargés par `createRequire`, donc mis en cache par Node ; `vi.resetModules()` ne vide pas ce cache-là. Un second `require('app.js')` dans le même fork rendrait l'export mémorisé sans rejouer la garde, et le test passerait à vide. Vitest donne un processus par fichier (`pool: 'forks'`) — c'est la seule isolation qui marche ici.

⚠️ **Le test de traversée passe par `node:http`, pas par supertest** (helper `raw()`). Un client de plus haut niveau ré-analyse l'URL et peut réécrire `..%2F`, auquel cas le test ne prouverait plus rien. Le `toBe(400)` strict est le canari : un 404 signalerait une normalisation, et le test doit échouer bruyamment plutôt que passer à vide.

⚠️ **Un refus ne se prouve JAMAIS par un code de statut seul** — un 401 sur une URL mal orthographiée en rendrait un aussi. Chaque test vérifie l'ÉTAT après coup : la ligne en base, le fichier sur le disque, le catalogue inchangé.

⚠️ **Un test de régression doit être éprouvé DANS LES DEUX SENS** : vert sur le code corrigé, **rouge** sur le comportement d'avant réintroduit exprès. Un test qui passe aussi sur la faille ne vaut rien, et c'est invérifiable après coup. Tous ceux ci-dessus l'ont été.

### Entretien périodique (`app.js`)

Au démarrage puis une fois par jour (`setInterval(...).unref()`, pour ne jamais retenir le processus) : purge des **sessions expirées** (`deleteExpiredSessions` était préparée et appelée nulle part — une ligne par connexion, gardée à vie), des jetons de reset périmés, des seaux de quota, et fermeture des **matchs restés `status='active'`** après un redémarrage. Ce dernier point est sans conséquence aujourd'hui (`activeMatchByUser` n'est branché nulle part) mais c'est la requête qu'on branchera pour la reprise après rechargement, et elle rendrait des fantômes.

### Le fuseau du serveur est journalisé au démarrage

Tout le calendrier du jeu (`missions.dayKey`, `cycleKey`, `weekKey`, dont dérivent boutique, cosmétiques, arcade et cadeau quotidien) lit l'heure **locale du processus**. Si `TZ` n'est pas réglée, Node prend celle du système — UTC sur la plupart des hébergeurs — et tous les rendez-vous quotidiens se décalent sans que rien ne le dise. `logTimezone()` le **nomme** au démarrage, exactement comme `[assets] ⚠` nomme un dossier mal placé : on ne peut pas deviner le bon fuseau, on peut au moins refuser de le taire.

---

## Simulation d'équilibrage (`client/src/sim/`)

Ce qui répond à « quelle carte est trop forte ? » sans attendre qu'un joueur le
dise. Le catalogue s'édite à la main depuis l'admin ; rien ne mesurait ses 653
cartes. Le module simule des dizaines de milliers de parties, classe les cartes,
et une routine quotidienne dépose son rapport sur **`/admin/sim`**.

**Il ne réimplémente RIEN.** Il pilote une vraie `GameSession` en mode `'ai'` —
c'est littéralement la partie solo, moins l'animation. Terrain, vétérance,
réanimation d'attribut, règle du doublon, pioches garanties et cimetière
viennent gratuitement.

⚠️ **Ce n'est PAS `MatchSimulator`**, qui rejoue une boucle allégée pour le
Tournoi : celui-ci n'incrémente pas la vétérance (`u.veterancy_points++` de
`finishCombat` n'y est pas, le seuil `VETERANCY_THRESHOLD` ne s'active donc
jamais), ignore les unités réanimées (`attributeResult.revived` est calculé puis
jeté) et ne pose aucun terrain. Mesurer l'équilibrage dessus mesurerait un jeu
que personne ne joue. Il n'est pas touché — seul `Tournament.js` en dépend.

| Fichier | Rôle |
|---|---|
| `logic/Random.ts` | xorshift32 semé, **pur** (aucun import, pas même `node:crypto`) — le seul ajout à `logic/` |
| `sim/catalog.ts` | `data/` s'il existe, sinon `initial-data/` ; empreinte du catalogue mesuré |
| `sim/autoPlayer.ts` | Tient le siège du joueur, **via la seule API publique de `GameSession`** |
| `sim/decks.ts` | Decks aléatoires à **couverture de matériaux**, fermeture pour l'A/B |
| `sim/runGame.ts` | La boucle d'une partie, instrumentée |
| `sim/metrics.ts` | Agrégation par carte, intervalles de Wilson |
| `sim/protocol.ts` | Les deux passes, et le handicap IA |
| `sim/aggregate.ts` | Agrégats par attribut, voie d'invocation, tier et style de jeu |
| `sim/show.ts` | Le script de l'émission parlée (cf. « L'émission » plus bas) |
| `sim/report.ts` / `sim/run.ts` | Forme JSON publiée, point d'entrée CLI |

```
cd client && npx vite-node src/sim/run.ts -- --games=60000 --ab-top=20 --seed=2026-08-24
```

⚠️ **Depuis `client/`, jamais `npx --prefix client` depuis la racine** :
`--prefix` ne déplace que la résolution du binaire, le répertoire de travail
reste la racine et vite-node cherche alors un `src/sim/run.ts` qui n'y est pas.

⚠️ **`vite-node` et non `node`** : `logic/` est en ESM TypeScript avec des
imports en `.js`, que Node ne résout pas seul. Il arrive avec vitest — **aucune
dépendance nouvelle**. Et le module vit sous `client/src/` pour être couvert par
`npm run lint` et `tsc --noEmit` ; rien dans l'application ne l'importe, il
n'entre donc dans aucun bundle.

### Le hasard est SEMÉ, sinon rien ne se rejoue

`rand` est une dep injectée, à valeur par défaut `Math.random` — **aucun
appelant existant ne change** (`buildSession`, `MatchSimulator`,
`PvpController`). Trois points de branchement : `Draw.drawHand`, le constructeur
d'`EnemyAI`, et `GameSessionDeps.rand` (qui couvre les trois tirages de pioche
garantie et l'IA qu'elle construit) — plus le **terrain**, dont le tirage
(`BoardPicker`) consomme ce même flux depuis qu'il dépend des decks et de
l'historique du duel. ⚠️ À **exactement un appel par combat**, au même point du
flux qu'avant : ni plus, ni moins, sinon toutes les pioches et tous les choix
d'IA qui suivent se décaleraient. `getAllBoards` / `getAllMagies` ne font plus
que fournir un catalogue.

### Les trois constats qui commandent le protocole

1. ⚠️ **Le siège n'est pas neutre.** `CombatManager.step()` trie
   `[...playerUnits, ...enemyUnits]` et, à égalité totale d'initiative, de
   vitesse d'attaque et de `card_id`, le tri stable laisse le joueur frapper le
   premier — **mesuré à 61 % pour le côté A sur un miroir strict**. Le départage
   par `card_id` porte le déterminisme PvP : on n'y touche pas, on joue **chaque
   appariement dans les deux sens** et on ne mesure que le siège du joueur.
2. ⚠️ **Appartenir au deck n'est pas être posée.** Sans filtre de couverture,
   **130 cartes sur 653 ne sont jamais posées** en 1000 parties — toutes des
   invocations spéciales dont les matériaux manquaient. Le dénominateur d'un
   winrate est donc le nombre de parties où la carte a été **posée**, et le
   générateur n'admet une carte que si le deck couvre déjà ses matériaux (ids
   *et* attributs, couverture accumulée tier par tier — même règle que
   `scripts/build-bot-decks.js`).
3. ⚠️ **1000 parties par jour ne mesurent rien.** Elles rendent 46 poses par
   carte en médiane, soit ±14 points d'intervalle de confiance : on ne distingue
   pas une carte à 55 % d'une carte à 45 %. Il faut ~2400 observations pour
   ±2 points, soit ~60 000 parties — **11 minutes** à 10,5 ms la partie.

### `ENEMY_HANDICAP` — un instrument de mesure, pas un réglage de difficulté

L'auto-joueur bat `EnemyAI` **80 % sur un miroir strict** : à ce niveau, une
carte forte n'a plus que 20 points de marge et tout se tasse contre le plafond.
`+4 ATK / +40 PV` (le primitif `enemyBonus` de l'Arcade, réutilisé tel quel)
ramène la ligne de base à **~50 %**, où les deux sens du déséquilibre ont la
même place. ⚠️ Il doit rester **figé** d'un jour sur l'autre : le recalibrer
rendrait le rapport d'hier incomparable, et c'est le diff qui fait tout
l'intérêt de la routine. Le rapport publie la ligne de base réalisée — si elle
dérive à handicap constant, c'est le jeu qui a bougé.

### Deux passes, qui ne disent pas la même chose

| Passe | Ce qu'elle fait | Ce qu'elle vaut |
|---|---|---|
| **Détecteur** | ~60 000 parties, decks aléatoires couvrants, les deux sens | **Signale.** Le winrate y reste contaminé par le deck porteur |
| **A/B** | Deck témoin figé, un seul slot qui change, N parties par bras | **Tranche.** Le seul chiffre qui isole la carte |

Mesuré : Ra le Dragon Ailé ressort à **+35,9 pt** au détecteur et **+8,3 pt** en
A/B — l'écart entre les deux **est** le biais de deck, et c'est la raison d'être
de la seconde passe.

- L'A/B ne part **que des lignes significatives** : envoyer 1200 parties
  confirmer une carte vue trois fois serait du gaspillage déguisé en rigueur.
- Le témoin est construit **autour** de la carte (`materialClosure`), et le bras
  « sans » est le même deck moins elle — les matériaux restent en place.
- La carte évincée n'est jamais un matériau dont une autre carte du deck dépend,
  sinon l'écart ne porterait plus seulement sur la carte testée.
- Une carte qu'on ne peut pas rendre invocable est déclarée **« non testable »**,
  jamais dotée d'un chiffre qui ne mesurerait rien.

### Ce qu'un chiffre a le droit d'affirmer

- **Intervalle de Wilson**, jamais l'intervalle normal : ce dernier rend une
  largeur **nulle** sur un taux de 0 ou 1, et une carte posée trois fois et
  gagnante trois fois passerait pour une certitude.
- **Le classement trie par l'écart amputé de son incertitude** (`effectSize`),
  et présente les lignes **significatives** d'abord. Trier par |Δ| brut remonte
  en tête les cartes posées une seule fois : +50 points d'écart, ±40
  d'intervalle qui dit exactement qu'on n'en sait rien.
- ⚠️ **Les dégâts sur la durée ne sont pas attribués au lanceur** : l'événement
  `dot` ne nomme pas sa source (poison et brûlure le partagent). Élargir le
  contrat d'événements de `logic/` pour ça casserait les golden tests — ils sont
  donc comptés au débit de la victime, et le rapport le dit.

### Consultation — `/admin/sim`

`routes/admin-sim.js`, monté **avec un `requireSiteAdmin` explicite** (même
raison qu'`admin-db.js` : les GET sous `/api` sont publics par défaut, et un
rapport nomme les cartes trop fortes du jeu). Les runs vivent dans
`DATA_DIR/sim-reports/<AAAA-MM-JJ>.json` — le **volume**, donc l'historique
survit au déploiement, et le diff avec hier est gratuit. Écriture atomique,
rétention 30 jours purgée **à l'écriture** (le seul moment où le dossier change).

⚠️ La date compose un **nom de fichier** : garde stricte `^\d{4}-\d{2}-\d{2}$`,
même raison que `safeAssetId`. Et `/latest` est enregistré **avant** `/:date`,
qui le capturerait sinon.

⚠️ **Le rapport ne transporte que des agrégats par carte** (~165 Ko mesuré) : le
corps d'une requête `/api` est plafonné à 1 Mo hors routes d'upload. Aucune
ligne par partie n'y entre jamais — verrouillé par golden test.

`sim-report.html` (racine, à côté d'`admin.html`) est une page autonome qui va
chercher ses données sur `/api/admin/sim` : tuiles de santé, graphique divergent
des écarts, distribution des winrates, verdicts A/B, tableau filtrable des 653
cartes avec la colonne **Δ hier**, et la liste des cartes jamais posées — qui
distingue « jamais retenue en deck » (matériaux non couverts) de « en deck,
jamais invoquée ». Palette de data-viz validée aux six contrôles dans les deux
modes. C'est l'onglet **⚖️ Équilibrage** d'`admin.html` qui l'affiche, dans une
**iframe** sur `/admin/sim?embed=1&theme=dark`, chargée au **premier clic** (un `src`
en dur ferait chercher le rapport à chaque ouverture de l'admin).

⚠️ **Une iframe et non un inline du contenu.** `sim-report.html` redéfinit `--surface`,
`--border` et `--muted` en **clair**, et style `*`, `body`, `h1`, `h2`, `a`, `svg`,
`table` — son bloc `select, input[type=search], button` repeindrait **tous** les onglets
et boutons de l'admin. Il déclare aussi un `esc()` global qui écraserait celui
d'`admin.html` (la seconde déclaration gagne pour **les deux** fichiers), et son `boot()`
part en `fetch` au chargement. L'iframe isole tout ça pour le prix d'un défilement
imbriqué — qui est ici un **avantage** : le `th { position: sticky }` du rapport colle au
viewport du cadre, ce qui est le comportement voulu.

Le contrat entre les deux fichiers tient en deux paramètres d'URL, lus par un script du
**`<head>`** de `sim-report.html` (depuis `<body>`, le corps est déjà peint et on verrait
un éclair de thème clair) : `theme=dark|light` pose `data-theme` — le sélecteur
`:root[data-theme="dark"]` **existait déjà**, il n'y a rien à écrire côté CSS — et
`embed=1` masque le titre et le lien de retour, redondants avec l'onglet. Ouverte seule,
`/admin/sim` reste une page autonome en thème clair, avec son lien retour vers `/admin` —
et c'est toujours là que la routine quotidienne dépose son run.

⚠️ L'iframe repose sur le `X-Frame-Options: SAMEORIGIN` que **helmet pose par défaut** :
le passer à `DENY` casserait l'onglet. L'authentification, elle, ne demande rien — la
requête est de même origine et porte le cookie de session de la page hôte.

### La routine (`.github/workflows/balance-sim.yml`)

Cron quotidien + `workflow_dispatch`. ⚠️ **Les trois secrets (`SYNC_URL`,
`ADMIN_USER`, `ADMIN_PASS`) sont des secrets de DÉPÔT, jamais d'environnement**
— et le job ne porte volontairement aucun `environment:`. Un environnement
ajoute deux pannes muettes à une routine que personne ne regarde tourner : un
nom qui ne correspond à rien est **créé à la volée, vide**, si bien que
`${{ secrets.X }}` rend une chaîne vide sans la moindre erreur (constaté) ; et
une règle de protection laisserait le cron nocturne en attente d'approbation,
indéfiniment. ⚠️ **Le `sync-data.js pull` en tête n'est
pas optionnel** : le runner clone le dépôt, donc `initial-data/` — le catalogue
joué vit dans `data/`, sur le volume, gitignoré, et c'est lui que l'admin
retouche. Sans ce pull la routine mesure un catalogue périmé. ⚠️ **Le cron
GitHub est en UTC** : l'heure de Paris visée et l'offset retenu sont écrits dans
le fichier (même vigilance que `logTimezone`). L'artifact part `if: always()` —
une simulation de 15 minutes ne doit pas être perdue parce que le serveur
redémarrait au moment du dépôt.

### L'émission — le rapport raconté à voix haute (`sim/show.ts`)

Un tableau de 596 lignes justes ne se lit pas chaque matin. `/admin/sim` porte
donc une **chronique parlée de 5 à 6 minutes**, lue par la voix du navigateur
(Web Speech API) : aucune dépendance, aucune clé d'API, aucun coût par tir, et
rien de plus côté serveur — le script voyage dans le rapport.

| Fichier | Rôle |
|---|---|
| `sim/aggregate.ts` | Regroupe les cartes par **attribut, voie d'invocation, tier et style de jeu**, pondéré par le nombre de poses |
| `sim/show.ts` | Le script, **pur** : six catégories de cartes, les archétypes, les façons de jouer |
| `sim-report.html` | Le lecteur : file d'énonciations, chapitres, surlignage, vitesse |

**Les six catégories**, et ce qui les distingue :

| Catégorie | Règle |
|---|---|
| Trop fortes / trop faibles | significative, de part et d'autre de la ligne de base |
| Injouables | en deck et **jamais invoquée** (`in_deck > 0` dans `never_played`) — un problème de constructibilité, pas de puissance |
| Sous-estimées | significative, gagne, et se pose dans moins de 35 % des parties |
| Pièges | significative, perd, et se pose dans plus de 60 % des parties |
| Bien réglées | écart plus petit que son intervalle, sur un échantillon fourni |

⚠️ **Sous-estimée et piège sont des LENTILLES, pas des cases** : elles regardent
les mêmes cartes significatives sous l'angle du taux de pose. Une carte peut être
à la fois trop forte et sous-estimée — c'est même l'information la plus
actionnable qui soit. Seules trop-forte/trop-faible et sous-estimée/piège
s'excluent deux à deux.

⚠️ **Elles exigent la significativité.** Sans ce filtre, le segment citait
« posée dans 100 % des parties, pour 0,0 % de victoires » sur une carte vue
**une** fois — le bruit exact que le reste du module rejette partout ailleurs,
dans la seule partie du rapport qu'on écoute. Le seuil de « bien réglée », lui,
est **relatif** (médiane des poses) : en dur, il vide le segment sur un petit run
et le noie sur un grand.

⚠️ **Un agrégat par attribut n'est PAS un winrate d'attribut** : une carte porte
jusqu'à quatre attributs, le même résultat compte donc dans plusieurs familles ;
et le chiffre reste **corrélationnel** comme celui du détecteur — un archétype
remonte parce qu'il contient une carte forte, pas parce que son thème l'est.
L'émission le dit à voix haute plutôt que de le reléguer en note.

**Écrit pour être DIT** : pas de `Δ`, pas de `±`, pas de `A/B` ni de `+35.9pt` —
un moteur vocal les rend de façon imprévisible d'une voix à l'autre. On dit
« 35,9 points au-dessus de la moyenne », « le test A B », et la date en toutes
lettres. Verrouillé par test.

⚠️ **Aucun chiffre n'est inventé, et c'est VÉRIFIÉ** : tous les formateurs
(`pct`, `ecart`, `nb`, `dec`) enregistrent ce qu'ils produisent, et
`show.test.ts` exige que chaque nombre du texte prononcé soit passé par l'un
d'eux. Ce test a dû être resserré **deux fois** avant de valoir quelque chose —
il comparait d'abord à « tous les taux du rapport » (avec 550 cartes,
l'ensemble des pourcentages à une décimale est saturé : un `87,4 %` inventé
passait), puis il enregistrait aussi les **listes écrites**, qui formatent des
centaines de cartes et saturaient l'ensemble à leur tour. Seul le texte
**prononcé** est enregistré (`silently()` pour le reste). ⚠️ Corollaire pour
qui éprouve ce test : injecter le faux chiffre dans une branche réellement
exercée par le run de test — un segment vide ne dit rien, et le test passe.

**Le lecteur** — cinq pièges de `speechSynthesis`, tous traités :
`getVoices()` est asynchrone (`voiceschanged`) ; Chrome **tronque** une
énonciation longue, d'où le découpage **phrase par phrase** qui sert aussi au
surlignage et au chapitrage ; la lecture démarre sur un **geste utilisateur**
(Safari iOS exige un appel synchrone) ; `cancel()` sur `pagehide` et
`visibilitychange`, sinon la voix continue dans le vide ; et **aucune voix
installée** est un cas réel — le bouton se désactive en **disant pourquoi**, le
texte restant lisible. Un `resume()` périodique contourne la suspension de
Chrome au bout d'une quinzaine de secondes.

⚠️ Le rapport passe de ~161 à ~200 Ko (agrégats + script) — toujours très loin
du plafond de 1 Mo de `/api`.

### Périmètre assumé

- **Ni magies ni Phase Shopping** : il faudrait une politique de magies pour
  l'IA, qui n'existe nulle part. C'est de la nouvelle IA de jeu, et une mauvaise
  politique fausserait le verdict sur les cartes. Les **terrains**, eux, sont
  dedans (cases bloquées et ligne de vue pèsent sur les unités à distance) —
  et ils sont désormais **choisis** (pertinence vis-à-vis des deux decks, pas de
  répétition dans une partie) au lieu d'être tirés uniformément.
  ⚠️ **La ligne de base mesurée a bougé UNE FOIS, le jour du changement** : le
  jeu de terrains candidats n'est plus le catalogue entier. Le diff « Δ hier »
  de `/admin/sim` de ce jour-là dit « la règle a changé », pas « le jeu a
  dérivé » — c'est la seule lecture juste, et elle ne se devine pas après coup.
  Le flux semé, lui, reste **en phase** : un seul `rand` par combat, au même
  point qu'avant (aucun golden de `sim.test.ts` n'a bougé).
- **L'adversaire est `EnemyAI`**, constante et plus faible que l'auto-joueur.
  C'est ce que le handicap compense ; les cartes sont comparées entre elles dans
  des conditions identiques, jamais à un absolu.
- Verrouillé par `client/src/test/sim.test.ts` (23 golden tests), tous
  **éprouvés dans les deux sens** : RNG remis à `Math.random` → le déterminisme
  tombe ; filtre de couverture retiré → `CORE_101` n'est plus invocable dans son
  propre deck ; règle du doublon retirée du moteur → l'auto-joueur pose 5 unités
  au lieu d'1 ; tri par |Δ| brut → le bruit coiffe le signal.

## Data Layer

Chaque database expose `init()` async. Les données sont cachées en mémoire après le premier fetch.

```js
await CardDatabase.init()       // charge /api/cards
CardDatabase.getCard(id)
CardDatabase.getCardsByTier(tier)
CardDatabase.getAllCards()
CardDatabase.illustrationUrl(id)
CardDatabase.costHint(card)

await AttributeDatabase.init()
AttributeDatabase.getAttribute(id)
AttributeDatabase.getAllAttributes()     // Array — injecté dans GameSession/MatchSimulator

await PowerDatabase.init()
PowerDatabase.getPower(id)
PowerDatabase.getAllPowers()

await BoardDatabase.init()
BoardDatabase.getBoard(id)
BoardDatabase.getAllBoards()     // injecté dans GameSession
// ⚠️ plus de getRandomBoard : le tirage vit dans logic/BoardPicker.pickBoard

await MagieDatabase.init()
MagieDatabase.getAllMagies()
// ⚠️ plus de getRandomMagies : le tirage vit dans logic/MagieOffer.pickMagies

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

### « Tout annuler » — le point de retour d'un tour

Un bouton **↺** dans la barre de préparation (`PhaseControls`, entre le remplissage et ☰) remet
**board, main et cimetière du joueur** à l'ouverture du tour — le geste de Marvel Snap. Tout est
dans `GameSession.undoPreparation()` ; le contrôleur ne fait qu'appeler.

Il n'existe que parce que **rien n'était réversible en préparation** : une carte invoquée quitte la
main, ses matériaux quittent le board sans passer par le cimetière, et un repositionnement écrase
`initial_position`. Une fusion lancée avec le mauvais matériau se subissait jusqu'au combat.

- **Le point de capture est la dernière instruction de `startPreparation()`**, pas le début du round.
  La Phase Shopping a lieu **avant** (`dismissEndRound` → `_startShopping` → `_proceedNextRound` →
  `startNextRound()` → `startPreparation()`) : « début de tour » veut donc dire pioche faite,
  magies de main déjà appliquées, et une magie choisie au shopping n'est **jamais** annulable.
- **Seules deux choses mutent l'état joueur en préparation** — l'invocation (`place` →
  `InvocationManager.summon`) et le déplacement (`reposition`, ou `board.moveUnit` par
  `GameController._tryMove`). Il n'y a pas de retrait libre d'unité, pas de magie, et rien côté
  ennemi (`_placeEnemyUnits` n'est appelé qu'à `startCombat`). C'est ce qui rend le point de retour
  petit et complet à la fois.
- ⚠️ **Rien n'est CLONÉ, et ce n'est pas une économie** : c'est ce qui rend la restauration exacte.
  `summon()` ne mute jamais les unités qu'elle consomme — `board.removeUnit` ne fait que vider une
  case (il ne touche même pas `unit.position`) et `_transferShoppingBonuses` **lit** les matériaux
  pour écrire sur le composite ; `_removeFromHand` fait un `splice` du tableau sans toucher aux
  objets `Card`. Garder les **références** rend donc `_base`, `_shopping_bonus`, `veterancy_points`,
  `current_hp`, `shield` et l'`uid` intacts — un clone, lui, aurait fait payer au joueur ce qu'il
  avait acquis les tours d'avant. Les composites créés puis annulés sont simplement abandonnés.
- **Garder l'`uid` rend le rendu gratuit** : `Scene3D.refresh()` est un diff indexé par uid — il
  despawn les composites annulés, respawn les matériaux restaurés et anime les unités remises en
  place, sans une ligne de plus. Seules les **positions** sont copiées à la capture (aucun objet
  `Position` n'est aujourd'hui muté en place, tout écrit un objet neuf : c'est une précaution).
- ⚠️ **On vide TOUTES les cases joueur avant d'en reposer une seule** : `placeUnit` *jette* sur case
  occupée, et une unité déplacée pendant la préparation occupe la case d'une autre.
- **La disponibilité se calcule STRUCTURELLEMENT** (`canUndoPreparation`), en comparant l'état au
  point de retour, et non par un drapeau posé par les mutateurs : le déplacement tap-tap passe par
  `board.moveUnit` sans traverser `GameSession`, un drapeau se ferait oublier au prochain chemin
  ajouté. Sur cinq unités et une dizaine de cartes, le coût est nul. Le bouton est **masqué** tant
  que c'est faux — il n'apparaît qu'après le premier geste du tour.
- **`GameSession.prepId`** est incrémenté à chaque `startPreparation()`. Ce n'est pas un compteur de
  rounds : c'est le repère qui permet à la couche app de savoir si un état qu'elle a mémorisé parle
  encore du tour à l'écran — sans avoir à être **prévenue** du passage au tour suivant, donc sans
  rien à remettre à zéro (et rien à oublier de remettre à zéro au prochain mode de jeu ajouté).
  Deux usages, tous deux dans `GameController` :
  - ⚠️ **Verrou d'engagement (`_committedPrepId`)** — posé à `startCombat()`. Il porte les deux modes
    où **la phase reste `PREPARATION` après le tap sur PRÊT** : en **PvP** pendant toute la poignée
    de main réseau (`pvpWaiting`), alors que le board a déjà été annoncé à l'adversaire ; et en
    **duel contre bot**, où `BotController` retarde le combat de 3 à 22 s pour imiter un adversaire
    humain. Dans les deux cas la barre de préparation est encore à l'écran sous l'overlay et `sync`
    republie l'instantané : sans le verrou, ↺ reviendrait — vingt secondes de rab pour retoucher un
    board déjà validé. Les deux sous-classes le posent donc **au tap**, pas à la fin de l'attente.
  - ⚠️ **Rollback des missions (`_eventMark` / `_markPrepId`)** — `_tryPlace` mémorise la longueur de
    la file d'événements avant la **première** invocation du tour, et l'annulation y revient
    (`missionStore.rollbackEvents`). Sans ça, une boucle poser/annuler ferait avancer une mission
    « invoque N unités » sans jouer une seule partie. Le test sur `prepId` n'est pas décoratif : sans
    lui, annuler un tour où l'on n'a fait que **déplacer** rejouerait une marque périmée et
    effacerait l'invocation d'un tour précédent, qui a bien eu lieu.
- **Rien côté réseau** : `round:board_ready` ne transporte que `card_id`, `position`,
  `veterancy_points`, `base`, `current_hp` et `shield`, tous restaurés à l'identique (l'`uid` est
  envoyé mais jamais relu par `reconstructOpponentUnits`). L'annulation est purement locale et
  précède toujours l'envoi.
- Verrouillé par `client/src/test/prep-undo.test.ts` (14 golden tests sur `GameSession`) et
  `client/src/test/prep-undo-events.test.ts` (6, sur le contrôleur et la file de missions — même
  harnais de store qu'`arcade-store.test.ts`, `window.location` posé à la main). Tous éprouvés dans
  les deux sens.

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

Après la phase de combat (et l'écran de résultat de fin de round), le joueur se voit proposer **3 magies** avant de passer au tour suivant — plus `gameState.player_extra_shopping_magies`, accumulé par l'effet d'attribut `shopping_bonus` et consommé au tirage. L'offre est **filtrée par pertinence** puis **tirée pondérée par rareté, sans remise**, dans le flux `rand` **semé** de la partie (`logic/MagieOffer.ts`, cf. « Pertinence de l'offre » et « Rareté » plus bas).

**Sautée** :
- Sur le dernier tour / fin de partie (`gameState.isGameOver()`)
- Si l'offre est **vide** — catalogue vide, ou plus aucune magie pertinente dans l'état courant → `_startShopping` fait `_proceedNextRound()`

⚠️ **Aucun repli sur une magie non pertinente.** L'offre peut être plus courte que `3 + extra`, et l'extra est alors **perdu** — il ne se reporte pas : la remise à zéro du compteur précède le filtre, et le re-créditer transformerait un octroi *pour ce tour* en dette. Le tour où il ne reste rien à offrir est précisément celui où une magie de plus n'existe pas.

⚠️ **Le shopping n'entre pas dans le déterminisme PvP.** Il n'est pas synchronisé (`PvpController` appelle le `_startShopping` de base), et le contexte de pertinence **diffère structurellement** entre les deux clients — board, main, cimetière, deck. Même semés à l'identique, les deux joueurs voient des offres différentes, et c'est correct : rien de tout ça ne traverse `round:board_ready`.

⚠️ **L'offre ne se re-tire pas après un `undoPreparation()`** : le shopping a lieu **avant** `startPreparation()`, dont la dernière instruction est justement la capture du point de retour. Une magie choisie est déjà cuite dans le snapshot — c'est l'autre face de « une magie choisie au shopping n'est jamais annulable ».

Répartie entre la logique headless et la glue UI (plus d'écran monolithique) :

```ts
// client/src/logic/GameSession.ts — headless
getShoppingMagies()                      // 3 + extra, filtrées + pondérées (MagieOffer)
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
- `rarity` — `1` Commune · `2` Rare · `3` Légendaire (cf. « Rareté » plus bas)
- `_has_illustration` (calculé côté serveur, non persisté)

### MagieDatabase

`client/src/data/MagieDatabase.js` — même pattern que `CardDatabase` / `PowerDatabase` / `BoardDatabase` :

```js
await MagieDatabase.init()              // fetch /api/magies, cache mémoire
MagieDatabase.getAllMagies()
```

⚠️ **`getRandomMagies` a été SUPPRIMÉE** : le tirage de la Phase Shopping vit dans `logic/MagieOffer.pickMagies` — filtré par pertinence, pondéré par rareté, et **semé** par le `rand` de la partie. La dep de `GameSession` est désormais `getAllMagies: () => Magie[]` : la couche data **fournit**, elle ne décide plus. La laisser aurait maintenu un second chemin de tirage, ni filtré ni semé, portant très exactement le nom que la prochaine fonctionnalité aurait repris.

### Pertinence de l'offre (`client/src/logic/MagieOffer.ts`)

Une magie n'est proposée que si elle a un **effet réel** dans l'état courant. Le refus arrivait auparavant **après le tap**, en toast (`GameController.chooseMagie` → « Aucune cible valide ») : sur trois choix, le joueur pouvait n'en avoir aucun d'actionnable.

`MagieOffer.ts` est un module **plat** — il n'importe que des types. La pertinence est une question sur un **état**, pas sur une session : la poser là la rend testable sans instancier une partie (la suite vitest tourne en node sans DOM), au même titre que `data/SummonInfo.ts`. C'est `GameSession._offerContext()` qui traduit son état en `MagieOfferContext`, et **le deck du joueur ne sort pas de la session** — aucun accesseur public n'a été ouvert, seuls des booléens et une liste de tiers en sortent.

Détection **automatique**, dérivée de `effect.type` — **aucun champ admin à saisir**. C'est l'extension de la table de routage de ciblage qui existait déjà (`MagieEffect.needsUnitTarget` / `needsGraveyardTarget` / `needsHandTarget`).

| Condition | Types |
|---|---|
| au moins une unité vivante sur le board | `stat_bonus`, `stat_modifier`, `shield`, `heal`, `team_stat_bonus`, `team_heal`, `destroy_unit`, `drain_life` |
| une Fusion **avec matériaux** sur le board | `defuse_fusion` |
| cimetière non vide | `revive` |
| main non vide | `hand_to_graveyard` |
| le deck porte **le** tier demandé | `guaranteed_draw` |
| le cap partagé +1 slot est encore libre | `board_slot_bonus` |
| `player_hp < PLAYER_HP_CAP` | `player_hp_bonus` |
| le deck porte une carte du `summon_type` visé | `reduce_sacrifice_cost`, `free_transformation`, `remove_heritage_material`, `remove_fusion_material` |
| toujours | `draw_bonus` |

- La règle « Fusion avec matériaux » n'est écrite qu'**une fois** (`GameSession._defusableFusions`) : `magieUnitTargets` la sert au ciblage, `_offerContext` à la pertinence.
- ⚠️ **Les quatre modificateurs de main se testent sur le DECK, jamais sur la main.** Ils sont **différés** au `startPreparation()` suivant, donc appliqués après une pioche de cinq cartes neuves : la main du moment ne dit rien de ce qu'ils vont trouver. Et chaque drapeau reprend le **prédicat exact** que `startPreparation` appliquera — `summon_type` **et** `cost.sacrifice > 0` / `cost.materials.length > 0`. Tester le seul `summon_type` déplacerait le mensonge au lieu de le supprimer : une Fusion sans matériaux n'est jamais retouchée.
- ⚠️ **`guaranteed_draw` hors deck n'est PAS un no-op** : `startPreparation` a un **double repli** et pioche quand même — dans tout le deck, sans la restriction de tier du tour, donc parfois au-dessus de ce que le round autorise. Le filtre supprime là un effet accidentellement bon, délibérément : la magie **promet un tier qu'elle ne rend pas**.
- ⚠️ **`board_slot_bonus` est la seule magie qui peut s'appliquer sans erreur et ne rien donner** : `grantLimitedBoardSlotBonus` rend 0 en silence une fois le cap consommé (par une autre magie **ou** par l'attribut Yeux Bleus). D'où `GameState.hasLimitedBoardSlotBonusLeft()`.
- ⚠️ **La table est FERMÉE (`default: false`)** : un `effect` nul ou d'un type inconnu traverse le `switch` d'`applyEffect` sans rien faire, l'offrir serait offrir un blanc. **Corollaire : un type d'effet ajouté à `applyEffect` mais oublié dans `isMagieRelevant` disparaît silencieusement du jeu.** C'est pour l'attraper que `magie-offer.test.ts` relit `initial-data/magies.json` et exige que chaque magie livrée soit offrable sous un contexte permissif.
- **Limite connue** : `heal` / `team_heal` sont offertes dès qu'une unité est sur le board, **même à PV pleins**. `current_hp` n'étant pas restauré entre les rounds (`resetCombatStats` ne fait que `min(current_hp, max_hp)`), le cas est marginal ; le durcir coûterait un `woundedUnitCount` dans le contexte.
- Les trois gardes « aucune cible valide » de `GameController.chooseMagie` sont devenues **inatteignables** et sont **gardées** : ce sont les seuls filets de `resolveMagie*Target` si un type sortait un jour de la table.

### Rareté

Champ **racine** `rarity: 1 | 2 | 3`. ⚠️ **Pas dans `effect`** : une magie sans effet a quand même une rareté, et deux magies du même type d'effet peuvent différer de palier — `MAGIE_016` (« -2 sacrifices », Légendaire) contre `MAGIE_017` (« -1 », Commune). **Facultatif** : absent ou hors bornes = Commune (`rarityOf`), ce qui rend inoffensives les magies écrites avant le champ. ⚠️ `rarityOf` passe par `Number()` et non par une comparaison stricte — un `<select>` d'admin peut avoir persisté la chaîne `"2"`.

`RARITY_WEIGHTS = { 1: 6, 2: 3, 3: 1 }`. Sur le catalogue livré (10 / 10 / 4, poids total 94) : **Commune 63,8 % · Rare 31,9 % · Légendaire 4,3 %** par emplacement. Une partie compte 4 phases de Shopping (`MAX_ROUNDS` = 5), soit **12 emplacements** : une run sur 2,4 croise une Légendaire.

- ⚠️ **Pas de garde-fou sur la composition de l'offre.** Deux Légendaires dans la même offre de 3 : **0,44 %, soit une offre sur 230** — et ce n'est pas un défaut, c'est un bon moment. Un garde devrait décider quoi faire du tirage rejeté (re-tirer ? rétrograder ?), au prix d'un cas particulier dans une fonction pure.
- ⚠️ **La rareté est CONDITIONNELLE à la pertinence** : le filtre passe d'abord. Les 4,3 % ne valent que pool complet — dans un état pauvre (board, main et cimetière vides) il ne reste qu'une poignée de magies éligibles et la part de Légendaire monte bien au-dessus. Aucune renormalisation : un état pauvre offre peu de choix, et c'est cohérent.
- ⚠️ **Pourquoi pondérer ici alors que la boutique de cartes a SUPPRIMÉ sa table `TIER_WEIGHTS`** : là-bas le **prix était unique quel que soit le tier**, le poids n'arbitrait plus rien et déguisait le hasard en règle. Ici les magies ne s'achètent pas et ne se choisissent pas non plus — c'est l'offre qui décide — leur puissance est réellement inégale, et le palier est **affiché** : le joueur lit la règle au lieu de la subir.
- **Affichage joueur** (`components/shopping/MagieCard.tsx`) : liseré gauche de 4 px + chip texte. Commune `--color-tier-1` (gris), Rare `--color-tier-3` (bleu), Légendaire `--color-tier-4` (violet). ⚠️ **Pas d'or pour la Légendaire** : le nom de la magie, le titre « ✦ PHASE SHOPPING ✦ » et le décompte sont déjà `text-gold` — il faut **contraster avec l'accent du panneau**, pas le prolonger. Vert et rouge sont écartés symétriquement, ils portent déjà « validé » et « danger ». Le `hover:border-gold/60` d'origine a été retiré : il écrasait la seule chose que ce liseré porte.
- Le chip est rendu sur **les trois** paliers : le liseré seul porterait l'information par la seule couleur, et une magie sans chip laisserait le joueur incapable de dire si elle est Commune ou si le jeu a oublié de la marquer.
- ⚠️ **L'offre n'est pas triée par rareté** — `pickMagies` rend l'ordre de tirage, une Légendaire sort en position 1, 2 ou 3. Trier ferait de la position un spoiler et rendrait le liseré redondant.
- **Admin** : `<select id="mf-rarity">` dans la grille **Identité** (pas Effet — la rareté n'est pas persistée *dans* `effect`, l'y loger le laisserait croire). ⚠️ `parseInt` obligatoire à la collecte. ⚠️ **`_collectMagieFields` repart désormais de `...selectedMagie`** au lieu de reconstruire l'objet de zéro : la version « from scratch » détruisait déjà `description` à chaque enregistrement (même piège que `_collectPublicDeckFields`), et `rarity` en aurait été la victime suivante — sur l'écran même où on la saisit. Le sauvetage s'arrête au **premier niveau** : `effect` reste reconstruit depuis le formulaire, sans quoi un changement de type traînerait les champs de l'ancien.
- **Serveur : rien à faire.** Le `strip` de `/api/magies` ne retire que `_has_illustration` et `routes/crud-json.js` ne valide que l'unicité de l'id — `rarity` traverse GET/POST/PUT/import tel quel.
- ⚠️ **`initial-data/magies.json` n'est relu qu'au PREMIER boot** (`bootstrap()` ne recopie rien sur un `data/` déjà peuplé) : y écrire les raretés ne change **rien** sur une installation existante, prod comprise — c'est `data/magies.json`, sur le volume, qui est joué. Passer par l'admin, par `POST /api/magies/import` en mode `replace`, ou éditer le fichier du volume. Le défaut à 1 rend l'oubli inoffensif **et silencieux** : tout redevient Commune et le tirage redevient uniforme sans que rien ne le signale.
- Verrouillé par `client/src/test/magie-offer.test.ts` (36 golden tests sur le module pur) et `client/src/test/shopping.test.ts` (49, au niveau `GameSession`). Tous **éprouvés dans les deux sens** : filtre retiré, poids égalisés, tirage avec remise, `default: true`, défaut de `rarityOf` déplacé — chacune de ces cinq régressions fait passer la suite au rouge.

### Types d'effets (`client/src/logic/MagieEffect.js`)

`effectLabel(magie)` génère la description affichée, `applyEffect(magie, { gameState, targetUnit, targetUnits })` applique l'effet. ⚠️ `targetUnits` n'est PAS une variante de `targetUnit` : il porte les magies d'**équipe**, qui n'ont aucune cible à désigner et frappent tout le board joueur — `applyGlobalMagie` le remplit, les deux autres chemins de ciblage jamais.

| `type` | Champs | Effet |
|---|---|---|
| `stat_bonus` | `stat`, `value` | Bonus additif **permanent** sur `targetUnit._base[stat]` (min 1) + `_recomputeStats()`. Si `stat === 'hp'`, augmente aussi `current_hp`. |
| `team_stat_bonus` | `stat`, `value` | Le geste de `stat_bonus`, répété sur **toutes** les unités du joueur. Effet **global** : aucune cible à taper (`applyGlobalMagie` passe `targetUnits`). Permanent (`_base`) et **tracé** (`_shopping_bonus`), donc transféré à une invocation composite. |
| `stat_modifier` | `stat`, `value` | Multiplicateur **permanent** : `_base[stat] += round(_base[stat] * (value - 1))` + `_recomputeStats()`. |
| `heal` | — | Soin **TOTAL** : `targetUnit.heal(targetUnit.max_hp)`. ⚠️ `value` n'est **pas lu** — les entrées de catalogue antérieures en portent encore un, le lire ferait un soin partiel là où la carte promet un soin complet. Le soin suit le **max courant** (bonus de PV et vétérance compris), pas le `hp` figé de la carte. |
| `team_heal` | `value` | Soigne de `value` PV **toutes** les unités du joueur. Effet **global** (`targetUnits`), plafonné au max de chaque unité. ⚠️ Il est **chiffré** là où `heal` est total : un soin de masse complet n'aurait aucun contrepoids. |
| `shield` | `value` | `targetUnit.applyShield(value)` |
| `revive` | `value` (% PV max) | Unité du **cimetière** : `is_neutralized = false`, `current_hp = max(1, round(max_hp * value/100))`, et purge de tous les statuts (dot, burn, paralysie, block). |
| `player_hp_bonus` | `value` | `gameState.player_hp = min(player_hp + value, 1000)` |
| `board_slot_bonus` | `value` | `gameState.grantLimitedBoardSlotBonus(value \|\| 1)` — **cap partagé, non cumulable : +1 slot au total** sur toute la partie, pool commun avec l'attribut Yeux Bleus. Une seconde magie de slot ne donne rien. |
| `draw_bonus` | `value` | `gameState.player_extra_draws += (value \|\| 1)` — pioches supplémentaires ce tour |
| `guaranteed_draw` | `tier`, `category` | `gameState.player_guaranteed_draws.push({ tier, category })` — les **deux filtres sont facultatifs et se cumulent** (`category` = `summon_type` de la carte). Même forme que les pioches garanties d'attribut, consommée par le même code. |
| `grant_power` | `power_id`, `power_speed`, `value` | Pose (ou **remplace**) le pouvoir d'une unité, remet sa jauge à zéro et lève un blocage en cours. Permanent — `resetCombatStats` ne touche pas à `power_id`. |
| `power_cooldown` | `value` (facteur, déf. 2) | **DIVISE** `unit.power_speed` (plancher 1) : le pouvoir se charge `value` fois plus vite. Ne cible que les unités **portant** un pouvoir. |
| `damage_multiplier_bonus` | `value` | `gameState.player_damage_multiplier_bonus += value` — **permanent et cumulatif**, s'ajoute au multiplicateur du joueur à chaque fin de combat. |
| `defuse_fusion` | — | No-op dans `applyEffect` ; géré par `GameSession._defuseFusion()` — sépare la fusion en ses matériaux (au cimetière s'il n'y a plus de slot). |
| `destroy_unit` | — | No-op dans `applyEffect` ; géré par `GameSession._destroyUnit()` — retire l'unité du board et l'envoie au cimetière (libère un slot, la rend disponible comme matériau). |
| `drain_life` | — | No-op dans `applyEffect` ; géré par `GameSession._drainLife()` — `destroy_unit` **plus** le versement des PV de l'unité au joueur. |
| `hand_to_graveyard` | — | No-op dans `applyEffect` ; géré par `GameSession.applyMagieOnHandCard()` — cible une carte de la **main**, pas une unité. |
| `reduce_sacrifice_cost` | `value` (déf. 1) | `gameState.player_hand_modifiers.push({ type: 'reduce_sacrifice_cost', value })` — réduit le coût en sacrifices d'une carte Sacrifice en main |
| `free_transformation` | — | `gameState.player_hand_modifiers.push({ type: 'free_transformation' })` — invoque une Transformation sans son monstre cible |
| `remove_heritage_material` | — | `gameState.player_hand_modifiers.push({ type: 'remove_heritage_material' })` — retire le matériel Heritage obligatoire |
| `remove_fusion_material` | `value` (déf. 1) | `gameState.player_hand_modifiers.push({ type: 'remove_fusion_material', value })` — retire N matériels requis d'une carte **Fusion** en main |

**Helpers de routage** — **trois** familles de cibles, et elles s'excluent : `GameController.chooseMagie` les teste dans l'ordre unité → cimetière → main, un type reconnu par deux d'entre elles n'atteindrait jamais la troisième branche.
- `needsUnitTarget(magie)` → `stat_bonus`, `stat_modifier`, `shield`, `heal`, `defuse_fusion`, `destroy_unit`, `drain_life` (cible une unité du board joueur — **vivante** : `magieUnitTargets` passe par `getPlayerUnits()`, aucun soin ne tombe donc sur un neutralisé encore posé après le combat)
- `needsGraveyardTarget(magie)` → `revive` uniquement (cible une unité du cimetière)
- `needsHandTarget(magie)` → `hand_to_graveyard` uniquement (cible une **carte de la main**)
- Tous les autres types sont des effets globaux appliqués immédiatement — les magies d'**équipe** comprises (`team_stat_bonus`, `team_heal`) : elles frappent tout le board sans rien demander au joueur.

⚠️ **Chaque magie d'équipe est le pendant d'une magie à cible unique, et les deux ne se dosent pas pareil.** `heal` soigne **tout** parce qu'il ne touche qu'une unité ; `team_heal` porte un **montant** parce qu'il les touche toutes. Copier le barème de l'un sur l'autre est l'erreur qui rend l'une des deux sans objet.

Les `player_hand_modifiers` (`reduce_sacrifice_cost`, `free_transformation`, `remove_heritage_material`, `remove_fusion_material`) sont consommés au tour suivant (différé), dans `GameSession.startPreparation()`.

### Pouvoirs, multiplicateur et pioche par voie

- ⚠️ **`power_cooldown` DIVISE au lieu de soustraire.** `power_speed` est un **seuil de jauge** : un `−4` plat ne veut pas dire la même chose sur un pouvoir à 6 et sur un pouvoir à 40 — c'est exactement le piège qui a fait passer `POWER_PARALYSIS` d'une sévérité plate à un doublement. Une division veut dire « deux fois plus souvent » quel que soit le rythme de départ, et `value` sert alors à doser ce qui reste dosable. Plancher à 1 ; une `value` absente, nulle ou négative retombe sur un doublement.
- ⚠️ **`grant_power` remet la jauge à zéro.** Héritée pleine de l'ancien pouvoir, le nouveau partirait au premier step, ce que rien à l'écran n'annonce. Il lève aussi un `POWER_BLOCK` en cours — le blocage portait sur le pouvoir remplacé.
- ⚠️ **La vitesse de chargement est OBLIGATOIRE dans `grant_power`** : sans elle l'unité hérite du `9999` d'`Unit`, le défaut de « pas de pouvoir », et le pouvoir donné ne partirait **jamais**. L'admin impose donc le champ (défaut 20).
- **La cible de `power_cooldown` se lit sur l'UNITÉ, pas sur sa carte** (`_poweredUnits`) : `grant_power` a pu poser un pouvoir que la définition de carte ne porte pas. Même geste que `_defusableFusions`, et pour la même raison — la règle sert le ciblage *et* la pertinence de l'offre, elle ne doit exister qu'à un endroit.
- **`damage_multiplier_bonus` est PERMANENT**, volontairement hors de `nextRound()` qui remet `player_multiplier` à 1.0 : c'est un investissement, il vaut pour tous les combats restants et se cumule. À ne pas confondre avec l'effet d'**attribut** du même nom, qui ne vaut que pour le round où il se déclenche et arrive par `attributeResult` — les deux s'**additionnent**.
- ⚠️ **`damage_multiplier_bonus` n'est PAS offert en PvP**, et ce n'est pas une restriction arbitraire : `enemy_hp` y est **réécrit à chaque round** depuis le `player_hp` autoritaire de l'adversaire (`PvpController._onRoundGo`), qui a calculé ses propres dégâts subis sans connaître ce bonus. Le bonus n'y change donc rien — sauf à faire déclarer une fin de partie que l'adversaire ne voit pas, c'est-à-dire un `result_mismatch` qui prive **les deux** joueurs de leur gain. Une magie qui ne peut que nuire n'est pas offerte (`ctx.damageMultiplierMatters`). ⚠️ L'attribut `ARCH_043` (Spectre, `+2`) porte la **même** asymétrie et n'est, lui, pas neutralisé : le rendre symétrique demanderait de faire voyager le bonus dans `round:board_ready`, donc de toucher au contrat de déterminisme.
- ⚠️ **Une `guaranteed_draw` sans AUCUN filtre reste non pertinente** : elle déplacerait un slot de pioche aléatoire vers… une pioche aléatoire. C'est le cas « blanc » que le filtre d'offre existe pour supprimer. Corollaire côté admin : le tier est devenu **facultatif** (« — indifférent — »), mais laisser les deux vides rend la magie injouable.

### Contrecoup — une magie qui coûte des PV joueur (`cost_hp`)

N'importe quelle magie peut porter un **coût en PV du joueur**, saisi dans la section « Contrecoup » de l'onglet Magies. C'est un champ de **premier niveau** (`magie.cost_hp`), et non un champ d'`effect` : il est orthogonal au type d'effet, un même contrecoup se pose aussi bien sur une pioche garantie que sur un bonus d'équipe. Corollaire : **rien à changer côté serveur** — `crudRouter` écrit le corps tel quel, et `strip` ne retire que `_has_illustration`.

| | |
|---|---|
| Lecture | `magieCostHp(magie)` — le **seul** endroit qui lit le champ |
| Accessibilité | `canAffordMagie(magie, playerHp)` → `playerHp > cost` |
| Prélèvement | `GameSession._payMagieCost`, appelé par les **quatre** chemins d'application |

- ⚠️ **La comparaison est STRICTE** : payer laisse toujours **1 PV au minimum**. Une magie qu'on ne peut pas payer sans mourir est **verrouillée** dans la modale (grisée, liserée de rouge, avec sa raison) plutôt que refusée au tap. Un choix qui tue n'est pas un choix, et la modale de shopping n'a **aucune confirmation** — un tap malheureux perdrait la partie sur un geste destiné à la gagner. Le joueur garde ses autres magies et le bouton « Passer ». À coût nul la règle se réduit à « le joueur est en vie », ce qui est exactement le comportement voulu pour les magies gratuites, c'est-à-dire presque toutes.
- ⚠️ **Le coût est prélevé À L'APPLICATION, pas au choix de la carte** : le ciblage est **annulable** (`cancelMagieTargeting`), et une magie reposée sans avoir été appliquée ne doit rien coûter.
- ⚠️ **Il est prélevé AVANT l'effet, et l'accessibilité se juge sur les PV d'avant.** Sans quoi `drain_life` **financerait son propre contrecoup** avec les PV qu'il rapporte : une magie hors de portée deviendrait payable par son propre gain, et le plancher de 1 PV ne tiendrait plus.
- ⚠️ **La garde et le paiement ne se désolidarisent jamais** : les quatre chemins (`applyGlobalMagie`, `applyMagieOnUnit`, `applyMagieOnGraveyardUnit`, `applyMagieOnHandCard`) portent les deux. `GameController.chooseMagie` a la sienne en plus, mais elle n'est là que pour que la règle ne dépende pas du seul rendu — un refus ne doit **rien** amputer, ni la main, ni le board.
- **Une donnée absente, nulle, négative ou illisible vaut « aucun contrecoup »** : une magie gratuite est le cas normal, c'est donc la lecture de repli sûre. L'inverse ferait payer des PV sur une faute de saisie en admin.
- **Rien côté PvP** : `player_hp` voyage déjà au niveau du message `round:board_ready`, chaque joueur étant la source de vérité de ses propres PV. Un contrecoup est invisible de l'adversaire jusqu'au round suivant, exactement comme `player_hp_bonus`.
- ⚠️ Un coût **supérieur ou égal aux PV de départ (`PLAYER_HP_CAP`)** rend la magie injouable toute la partie. L'écran d'admin le dit ; rien ne l'interdit.
- ⚠️ **L'accessibilité n'est PAS un critère de pertinence** (`MagieOffer.isMagieRelevant`), et c'est une décision : le filtre d'offre écarte ce qui ne **ferait rien** — un `revive` sans cimetière, un `board_slot_bonus` une fois le cap consommé —, là où une magie trop chère **ferait** quelque chose, le joueur n'ayant simplement pas les PV. Elle est donc proposée et verrouillée plutôt que retirée : la filtrer la rendrait invisible au moment précis où il est le plus utile de savoir qu'elle existe. Verrouillé par golden test.

### Absorption (`drain_life`) et défausse au cimetière (`hand_to_graveyard`)

Les deux magies **échangent une ressource contre une autre**, là où les autres en ajoutent — d'où deux règles qui ne se devinent pas :

- ⚠️ **`drain_life` verse les PV COURANTS, pas le `max_hp`** : absorber une unité qu'on vient de voir encaisser tout un combat ne doit pas rapporter autant qu'absorber une unité intacte. Le plafond reste 1000, celui de `player_hp_bonus`. Et l'unité **part au cimetière**, elle n'est pas effacée : c'est ce qui en fait un remplaçant honnête de `destroy_unit` — on gagne les PV *sans* perdre le corps comme matériau d'invocation.
- ⚠️ **`hand_to_graveyard` ne pose AUCUN corps sur le terrain** : la carte quitte la main et devient une unité **neutralisée** au cimetière, donc un matériau de fusion / héritage / sacrifice / transformation — et rien d'autre. Comme toute unité du cimetière, elle disparaît au lancement du combat si personne ne l'a consommée : la magie ne met pas une carte en réserve, elle la brûle pour un tour.
- ⚠️ **C'est la seule magie qui cible la MAIN**, et c'est ce qui a coûté le plus cher au HUD : `HandBar` se masquait sur `combatActive`, or la Phase Shopping a lieu **après** le combat, drapeau encore levé. Elle porte donc la même exception que `GraveyardTray` pour le ciblage `revive` (`awaitingTarget === 'hand'`), et une carte **injouable y reste tapable** — c'est même souvent celle qu'on veut envoyer au cimetière.
- `remove_fusion_material` est le jumeau de `remove_heritage_material`, à deux différences près : il ne retire que `value` matériels (l'héritage vide la liste entière), et il garde la trace du retrait dans `_removed_materials` — que `SummonInfo` annonce au tooltip, même rôle qu'`_original_sacrifice`. Une fusion dépouillée de **tous** ses matériels s'invoque comme une normale : `InvocationManager` rend `ok()` sur une liste vide, il n'y avait rien à ajouter pour ça.

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

Chaque combat se joue sur un terrain, actif uniquement pendant la phase de combat. Il n'est **plus tiré au hasard** : `logic/BoardPicker.pickBoard` le choisit en fonction des **deux decks engagés**, et **ne le rejoue jamais dans le même duel** (cf. « Le tirage du terrain » plus bas).

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

### Le tirage du terrain

Deux règles, et elles ne pèsent pas le même poids.

| Règle | Nature |
|---|---|
| Le terrain est choisi pour **affecter au moins un des deux camps** (pertinence) | **préférence** |
| Un terrain **ne revient jamais deux fois** dans un duel | **règle absolue** |

Les 14 terrains livrés portent **tous** un `target_attributes`. Un tirage aveugle rendait donc, la plupart du temps, un terrain sans effet : un duel Dragon contre Machine qui tombait sur « Ocean » (Aquatique) jouait sur un décor, pas sur un terrain. Et revoir « Prairie » deux fois en cinq combats effaçait la seule variété que le mode apporte entre les rounds.

**Pertinent** = le terrain porte un `target_attributes` qu'au moins **2 cartes** de l'un des deux decks portent. `MIN_ATTRIBUTE_OCCURRENCES` vit dans `logic/BoardPicker.ts` et **`data/DeckTags.ts` l'y importe** : c'est la même question (« quels attributs identifient ce deck ? ») posée pour deux usages, et un attribut porté par une seule carte sur vingt est un accident de composition, pas une couleur de deck.

**L'échelle de repli**, dans cet ordre : ① pertinent **et** pas encore joué → ② pas encore joué → ③ tout le pool.

⚠️ **LA NON-RÉPÉTITION L'EMPORTE SUR LA PERTINENCE**, et c'est tout l'arbitrage : s'il ne reste aucun terrain pertinent inutilisé, on tire parmi les **inutilisés non pertinents** plutôt que de rejouer le pertinent déjà vu. Revoir un terrain déjà joué se remarque à tous les coups ; jouer un terrain qui ne touche personne ne se remarque pas. 14 terrains pour 5 combats au maximum : la règle est toujours tenable, et l'échelon ③ n'existe que pour un catalogue amputé en admin — pas pour un duel.

⚠️ **La pertinence se juge sur les DECKS, pas sur les unités posées**, alors que le terrain, lui, s'applique aux unités du board. Ce n'est pas une approximation par paresse : au moment où le rôle A doit choisir, il a envoyé son `board_ready` mais **n'a pas encore reçu celui de son adversaire**. Le deck est la seule chose connue des deux côtés, et c'est ce qui permet au solo, au duel contre bot et au PvP d'appliquer **littéralement la même règle**. Prix assumé : un terrain pertinent peut tomber sur un tour où aucune des cartes porteuses n'a été piochée.

⚠️ **La pertinence est une PRÉFÉRENCE, pas une table fermée** — c'est ce qui distingue `BoardPicker` de `MagieOffer`, dont le `default: false` fait disparaître du jeu tout type d'effet oublié. Ici un terrain jugé non pertinent reste tirable à l'échelon ② : un oubli de règle ne peut que le rendre **moins probable**, jamais invisible. D'où un prédicat de trois lignes là où les magies exigeaient d'énumérer chaque type.

| Cas | Verdict |
|---|---|
| `effect` absent ou `null` | **non pertinent** — `applyEffect` sort aussitôt, le terrain ne touche personne |
| `target_attributes` vide/absent | **toujours pertinent** — l'effet vise alors *toutes* les unités des deux camps |
| sinon | intersection non vide avec les attributs des deux decks |

⚠️ **EXACTEMENT UN appel à `rand` par tirage, et AUCUN sur un pool vide.** Ce n'est pas une micro-optimisation : c'est ce qui garde le flux semé de la simulation **en phase**. Un appel de plus décalerait toutes les pioches et tous les choix d'IA qui suivent, et ferait bouger les 23 goldens de déterminisme de `sim.test.ts` pour une raison sans rapport avec le terrain. Vérifié : la suite complète passe **sans une seule mise à jour de snapshot**.

⚠️ **Limite connue : `draw_bonus` ignore `target_attributes`** dans `applyEffect` (il crédite le joueur quoi qu'il arrive). Un terrain `draw_bonus` dont personne ne porte le ciblage serait donc jugé non pertinent alors qu'il agit. Aucun des 14 terrains livrés n'est dans ce cas.

**PvP** — seul le rôle **A** tire (`session.pickCombatBoard()`, qui ne consomme rien), diffuse l'`id`, et **les deux clients rejouent l'id renvoyé par le serveur** dans `round:go`. Le contrat de déterminisme est intact : rien de neuf n'entre dans `round:board_ready`.

⚠️ **C'est `startCombat` qui MARQUE le terrain comme joué, jamais `pickCombatBoard`.** On marque celui qui est **joué**, pas celui qui a été tiré : un `round:terrain_pick` perdu ne doit pas consommer un terrain que personne n'a vu. Et comme le marquage vit là, une seule ligne tient l'historique dans **tous** les modes — y compris ceux où le terrain arrive de l'extérieur (`agreedBoard`), donc pour les deux rôles.

⚠️ **`deps.enemyDeck` est INUTILISABLE en PvP** : `buildSession` y retombe sur le deck du **joueur** (`enemyDeck ?? … ?? rawDeck`), faute d'un deck adverse à injecter. Sans `setEnemyDeckAttributeCounts`, le rôle A choisirait donc le terrain en comptant **deux fois son propre deck** — une erreur parfaitement silencieuse, puisqu'elle rend quand même un terrain pertinent pour quelqu'un. Les attributs adverses viennent du **serveur** (cf. « PvP — le serveur dérive »).

**Duels contre bot : rien à brancher.** Le serveur envoie le vrai deck du bot (`bot: { deck }`) et `GameScreenPvp` bâtit une session `mode: 'ai'` avec ce deck comme `enemyDeck` : la dérivation du constructeur est déjà juste, `BotController` n'a pas une ligne à changer. Même chose pour le solo, l'Arcade, le Tournoi et le tutoriel, qui passent tous par `buildSession`.

**Portée de l'historique : le DUEL, pas la journée.** Il vit dans la `GameSession`, dont la durée de vie est exactement celle du duel — rien à réinitialiser, rien à oublier de réinitialiser au prochain mode ajouté. Une run d'Arcade enchaîne 4 duels, donc 4 sessions : l'historique y repart bien à zéro à chaque duel.

⚠️ **Rien n'est miroité côté serveur, et ce n'est pas un oubli.** Un `match.usedBoardIds` protégerait un chemin **injoignable** : aucun client n'envoie `match:rejoin`, et rien n'écoute `round:restart` — la reprise d'état de jeu PvP n'existe pas, un rechargement de page perd déjà la main, le cimetière, la vétérance et les PV. Faire de l'historique des terrains la seule chose durable serait une incohérence, au prix d'un invariant de plus (⚠️ `round:next_ready` devrait le laisser intact, contrairement à `lastTerrainBoardId` juste à côté) qu'aucun test ne pourrait exercer.

Verrouillé par `client/src/test/board-picker.test.ts` (23 golden tests sur le module pur) et `client/src/test/board-selection.test.ts` (11 au niveau `GameSession`). Tous **éprouvés dans les deux sens** — 19 régressions réintroduites une par une (filtre de non-répétition retiré, échelons inversés, seuil ramené à 1, deck adverse ignoré, `setEnemyDeckAttributeCounts` sans effet, tri supprimé, `rand` appelé sur pool vide, marquage déplacé dans le tirage…), chacune fait passer la suite au rouge.

### L'annonce du terrain (entrée en combat)

Le terrain décide de bonus de stats **réels** et change à chaque round — mais sa seule trace à l'écran était la puce 🗺️ de la barre de combat, qu'il fallait **taper** pour lire l'effet, et qui n'apparaît qu'une fois le combat lancé. `TerrainAlert` (`components/overlays/Overlays.tsx`) l'annonce donc pendant `TERRAIN_ALERT_MS` (2,5 s) : illustration, nom, effet, archétypes ciblés, et **combien d'unités de chaque camp** sont touchées.

⚠️ **Le combat ATTEND l'annonce, et il n'y a QU'UN minuteur pour ça.** `_beginCombatAnimation` retenait déjà le premier coup le temps de la cascade d'arrivée de l'IA (`revealEnemyUnits`) : on **allonge ce délai** à `max(revealMs, TERRAIN_ALERT_MS)` au lieu d'en ajouter un second. Deux horloges pour un même départ finiraient par ne plus s'accorder.

⚠️ **Le tap qui passe l'annonce ne peut PAS démarrer le combat avant la fin de la cascade.** `dismissTerrainAlert` retire l'annonce tout de suite mais **réarme pour le reliquat** (`_combatStartAt`) : sinon un tap à 0,3 s lancerait le premier coup pendant que l'adversaire est encore en l'air.

⚠️ **`_pendingCombatStart` est un CHAMP, pas une closure locale** : le tap et le minuteur doivent déclencher le **même** départ, et une seule fois — il se remet à `null` en partant, donc un double tap ne lance pas deux combats. `dispose()` l'annule *et* vide le minuteur ; sans le `clearTimeout`, la garde d'identité de l'animateur masque la fuite et le test passe au vert (constaté — d'où l'assertion sur `vi.getTimerCount()`).

⚠️ **Le décompte annoncé ne PEUT PAS contredire ce que l'effet a fait** : `logic/BoardEffect.effectTargets` est extrait d'`applyEffect`, qui l'appelle, et `terrainAlertFor` compte avec **la même fonction**. Un second filtre écrit côté annonce aurait fini par dire autre chose.

⚠️ **`draw_bonus` n'affiche aucun décompte** (`boosted: null`) : il crédite le joueur quoi qu'il arrive, sans regarder `target_attributes` — annoncer « 3 unités boostées » sous lui ferait mentir l'écran. La règle est `data/BoardInfo.boardTargetsUnits`, lue aussi par l'infobulle.

- **Un terrain qui ne touche personne le DIT** (« Aucune unité en jeu n'en profite »). La sélection préfère un terrain pertinent mais cède devant la non-répétition : le cas arrive, et le taire laisserait croire à un bonus qu'on n'a pas.
- **Pas de `Modal`** : elle poserait un voile noir sur ce qu'on vient annoncer. Une couche transparente `z-40` suffit, et c'est elle qui capte le tap. ⚠️ `z-40` et pas plus : `TutorialCoach` est en `z-50` avec sa bulle en `pointer-events-auto` — au-dessus, l'annonce lui volerait ses taps. Contrepartie assumée : pendant 2,5 s la barre de combat (`z-20`) n'est pas tapable, le premier tap servant à passer l'annonce.
- **La vignette carrée** (`/illustrations/<id>`), jamais le fond de grille `/board-backgrounds/<id>` — celui-ci est un plan 5:11, il serait déformé dans un cadre carré.
- **Le composant ne pilote rien** : aucun minuteur à lui, il disparaît quand `terrainAlert` repasse à `null`. Le départ du combat appartient au contrôleur.
- **L'animation** reprend la grammaire du toast de pouvoir (`power-toast-anim`) : un seul jeu d'images-clés qui **apparaît / tient / s'efface**, durée posée par une propriété personnalisée depuis `TERRAIN_ALERT_MS` — une seule source, sinon l'animation et l'attente dérivent. ⚠️ En `prefers-reduced-motion: reduce` l'annonce **reste affichée et le combat attend toujours** : c'est le mouvement qu'on retire, pas l'information.
- **PvP** : même chemin (`_onRoundGo` → `_beginCombatAnimation`), et `revealMs` y vaut 0 — l'attente est donc entièrement celle de l'annonce. ⚠️ Aucune désynchronisation possible : le combat est simulé localement des deux côtés et le résultat n'est rapporté qu'à la fin ; un délai d'affichage ne traverse pas le réseau. Le chrono de combat ne dérive pas non plus, il est dérivé des **ticks** de l'animateur, jamais d'une horloge murale.
- Verrouillé par `client/src/test/board-alert.test.ts` (10 golden tests) et `client/src/test/board-info.test.ts` (11). Tous **éprouvés dans les deux sens** — 8 régressions réintroduites une par une. ⚠️ Le rendu, lui, n'est pas testé : la suite tourne en node sans DOM. Il se vérifie au navigateur (cf. « Vérification » ci-dessous).

### Rendu en jeu

`GameSession.startCombat` pose les cases bloquées sur le `Board` (logique) ; c'est `GameController` qui les transmet à la scène (`Scene3D.setBlockedCells`) au lancement de l'animation et les efface en fin de combat — sans quoi les unités contourneraient des cases visuellement libres. Le terrain tiré est aussi affiché dans la barre de combat (chip `🗺️`, tap → tooltip nom + effet).

Le **fond de grille** suit exactement le même trajet, une ligne plus bas : `Scene3D.setTerrainBackground(boardData)` au lancement du combat, `setTerrainBackground(null)` à sa fin. Le PvP est couvert sans une ligne de plus — `PvpController` passe par le même `_beginCombatAnimation`. Le TestBench fait le même appel dans `startCombat` / `stopCombat`.

- **Combat uniquement.** En préparation le terrain n'est pas encore tiré (l'IA place ses unités au PRÊT), et le cadrage ne montre que les rangées 0–3 : il n'y aurait ni terrain à afficher, ni place pour le montrer.
- `Scene3D` construit l'URL `/board-backgrounds/<id>` lui-même — précédent en place avec `UnitCardEl`, qui pointe directement sur `/illustrations/<card_id>`. `three/` n'importe donc pas `data/`, et `GameController` n'a rien à plomber.
- Le plan texturé (`PlaneGeometry(5, 11)`, `MeshBasicMaterial` — *Basic* pour que l'éclairage de scène n'assombrisse pas l'illustration) est posé à `y = -0.08`, sous les tuiles. Une illustration hors ratio 5:11 est **rognée au centre**, jamais déformée (`coverFitTexture`).
- Les 55 tuiles passent alors en **voile translucide** (`TERRAIN_TILE_OPACITY`) : les rangées neutres et ennemies sont opaques par défaut et masqueraient tout. Les tuiles ne couvrant que 92 % de leur case, c'est le contraste tuile/interstice qui redessine la grille par-dessus l'image. Les trois zones prennent le **même** voile — les différencier par l'opacité créerait une couture en travers de l'illustration ; c'est la couleur des tuiles qui porte seule la lecture des zones. Le voile bleu du bloc joueur (`_playerBg`) est masqué pour la même raison.
- **Le chargement est asynchrone et annulable** : `_terrainToken` invalide une texture qui arrive après la fin du combat ou après un autre terrain, sinon on rattacherait un mesh à une scène morte. Un 404 ne fait rien — le décor par défaut reste en place, ce qui **est** le comportement voulu pour un terrain sans fond.

#### À quoi ressemble une case bloquée

Un **creux avec des éclats de roche** (`Scene3D.spawnBlockedDecor`), pas une case rouge.

⚠️ Le rouge d'avant peignait un **état d'UI** par-dessus l'illustration du terrain, dans le vocabulaire déjà pris par la zone ennemie (rangées teintées rosé) et par les dégâts — or une case bloquée n'est pas une menace, c'est un fait de terrain. Et la teinte, posée à 0,52 d'opacité, masquait précisément le fond qu'on venait d'ajouter. Le traitement actuel tient en trois couches : la dalle rabattue en pierre sombre et **sans emissive** (les cinq états au-dessus d'elle dans `_updateTileColor` — survol, candidat matériau, sélection — s'annoncent par une lueur : c'est le registre du retour à un geste, pas celui du décor), un creux posé en retrait qui donne la marche, et quelques éclats de pierre.

- ⚠️ **La dalle reste OPAQUE sous un fond de terrain** (`BLOCKED_LEDGE_OPACITY`), là où les 54 autres passent au voile : c'est ce qui fait le trou. Voilée comme les autres, la case laisserait passer l'illustration et redeviendrait une case normale un peu plus sombre.
- ⚠️ **C'est la ROCHE qui porte la lecture, pas le creux** — la zone neutre est déjà quasi noire (`0x070810`), un trou noir de plus ne s'y distingue de rien. D'où une pierre franchement claire (`BLOCKED_ROCK_COLOR`), qui est le seul contraste disponible.
- Les trois contraintes de forme sont celles de « Deux contraintes du rendu 3D » : silhouette **au sol** (la caméra regarde droit vers le bas — un bloc haut se projette sur un point), décor **dans sa case** (une carte CSS3D voisine occupe une case entière et mangerait tout débordement), et **statique** — seule l'émergence d'un quart de seconde à la pose est animée, et elle se termine, sinon le rendu à la demande de `_animate` serait annulé pour tout le combat.
- Le décor est **semé par `(col, row)`** (`cellRandom`) : deux combats sur le même terrain montrent les mêmes rochers, sinon le terrain ne serait pas un lieu.
- ⚠️ **La case gelée (`POWER_FREEZE`) n'est pas concernée** : elle garde ses cristaux cyan additifs et sa teinte de glace, et son test passe **après** celui des cases bloquées dans `_updateTileColor`. Les deux vocabulaires se séparent maintenant d'eux-mêmes — glace claire et montante contre roche sombre et écrasée — là où le blocage permanent ressemblait à une version fade du gel.

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

### L'icône d'un attribut est une image, l'emoji n'en est que le repli

Un attribut s'annonce par une **image** importée depuis l'onglet Attributs de l'admin (triptyque `POST` URL / `PUT` base64 / `DELETE /api/attributes/:id/illustration`). Le champ `icon` du JSON reste l'**emoji**, et ne sert plus qu'à ça : le repli tant qu'aucune image n'a été importée. Les 57 attributs livrés en ont un, la migration se fait donc attribut par attribut sans rien casser au passage — et elle a une raison d'être : `🔥` et `⚙️` étaient chacun portés par **deux** attributs, et `👁️` / `🏵` sont des emojis à variation qui ne rendent pas pareil d'une plateforme à l'autre. Un jeu qui promet des archétypes lisibles ne peut pas les distinguer avec un jeu de pictogrammes qu'il ne contrôle pas.

**L'art vit dans le dossier d'illustrations existant** (`resources/card_illustrations/<ARCH_ID>.png`), où cartes, terrains, magies et variantes se côtoient déjà : `/illustrations/:id` le sert, `listPngChecksums(ILLUS_DIR)` le synchronise. **Aucune famille d'assets à créer** — donc rien à ajouter à `asset-dirs.js`, au proxy Vite, à la liste d'exclusion du fallback SPA, à `ASSETS` de `sync-data.js` ni à `/api/export` (`attributes` est déjà dans `ENTITIES`). Précédent exact : les variantes.

- ⚠️ **Le pool d'avatars cosmétiques n'est PAS touché** : `cosmetics.avatarPool` itère `SOURCES` (`cards.json` / `boards.json` / `magies.json`), il ne scanne pas le dossier. Une icône d'attribut ne devient donc jamais un visage achetable. Même raisonnement pour `shop.sellableCards` et les tirages de `levels.js`, tous indexés sur des listes d'entités.
- `_has_illustration` est **calculé à la lecture** et retiré aux trois points d'écriture (`POST`, `import`, `PUT`) — même statut que sur une magie ou un terrain. Une icône ajoutée depuis l'admin est donc visible sans redémarrage.
- ⚠️ **L'image est nommée par l'`id` de l'attribut** : le renommer en admin la détache silencieusement (le PNG garde l'ancien nom). Même piège que la prime de complétion d'un pack, mémorisée par id — l'écran d'admin le dit.

**Client** — un seul composant décide du repli : **`components/ui/AttrIcon.tsx`** (image si `_has_illustration`, emoji sinon, rien si ni l'un ni l'autre). Les quatre sites d'affichage ne font que le rendre à leur taille, en passant la taille de boîte *et* la taille de police dans `className` :

| Site | Taille |
|---|---|
| `hud/SynergyPanel.tsx` — puce du panneau de synergies (préparation) | `h-4 w-4` |
| `tooltip/TooltipHost.tsx` — titre du tooltip d'attribut | `h-7 w-7` |
| `tooltip/TooltipHost.tsx` — chips `Keywords` des tooltips carte/unité | `h-3.5 w-3.5` |
| `tutorial/ChapterBlocks.tsx` — codex | `h-5 w-5` |

- **`object-contain`, jamais `object-cover`** : une icône rognée perd sa silhouette, qui est justement ce qui la distingue. C'est la seule différence de traitement avec l'art des cartes, qui vit dans le même dossier.
- `getAttribute` **jette** tant que la database n'est pas initialisée (TestBench, CombatLab et leurs cartes fabriquées) : `AttrIcon` l'entoure d'un `try/catch` et retombe sur le `fallback` reçu en prop — même précaution que `attributeName` dans `TooltipHost`, qui existe pour cette exacte raison.
- **Le panneau de synergies pose l'icône sur TOUTES les puces**, actives comme incomplètes : c'est avant d'avoir le palier que le joueur décide d'ajouter une carte, une puce reconnaissable seulement une fois la synergie acquise arriverait trop tard. La distinction valide / incomplet continue de passer par ce qui la porte déjà — bordure et fond dorés — l'icône se contente de s'éteindre (`opacity-60`).
- ⚠️ **Rien à changer dans `logic/`, `GameController`, `gameStore` ni le snapshot** : `GameController` transportait déjà `{ id, name, icon }` par synergie, ce qui donne au panneau son repli sans surcoût, et `AttrIcon` va chercher le drapeau dans `AttributeDatabase`, déjà initialisée par `initGameData`. C'est ce qui laisse les golden tests du combat rigoureusement intacts.
- **Pas de test de composant** — la suite vitest tourne en node **sans jsdom** (même raison que pour le mode tutoriel) : la règle de repli se vérifie à l'écran.

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

La jauge gagne `1 + _stat_bonuses.power_charge` par step. Elle est prête à `power_gauge >= power_speed` (`Unit.isPowerReady()`, faux si `is_power_blocked`). Le pouvoir se déclenche alors **dans la phase d'attaque**, sous deux conditions : l'unité a une cible à portée et en ligne de vue — **sauf pour les trois pouvoirs sans portée**, cf. plus bas — **et** le pouvoir a quelque chose à faire à cette cible (« Pertinence vis-à-vis de la cible ») ; sinon la jauge reste pleine et attend. Quand il part :
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
- Le pouvoir **remplace** l'attaque du step ; la jauge se vide, sauf si le pouvoir n'a pas pu se résoudre (`POWER_TELEPORT` sans case libre) ou n'avait rien à faire à la cible (cf. ci-dessous)
- **Soin, provocation et téléportation partent hors de portée** (`RANGELESS_POWERS`) ; tous les autres exigent une cible à portée et en ligne de vue
- Une unité `is_effect_immune` (attribut `effect_immunity`) annule poison, burn, paralysie, push, freeze, block et confusion — l'événement `power` est émis avec `extra: { immune: true }`
- Les effets de pouvoir prennent fin à la fin du combat (`resetCombatStats`)
- Un `power_id` inconnu retombe sur une attaque normale

### Pertinence vis-à-vis de la cible (`CombatManager._isPowerRelevant`)

**Une jauge pleine ne suffit plus.** Le pouvoir ne part que s'il a quelque chose à faire à la cible que `findAttackTarget` vient de désigner ; sinon l'unité **attaque normalement et GARDE sa jauge pleine**, jusqu'au tick où la cible le mérite.

Le besoin est celui d'un joueur qui regarde son board : un bloqueur dépensait sa charge sur une cible **sans pouvoir**, un dissipateur sur une cible **qui ne portait rien**, un pousseur sur une cible adossée à un mur. Trois no-ops parfaitement silencieux — même toast, même VFX, même jauge remise à zéro qu'un pouvoir qui a pris.

⚠️ **La règle est étroite à dessein : elle répond à « est-ce que ça ne ferait RIEN ? », jamais à « y a-t-il une meilleure cible ? ».** Le choix de cible reste celui de `findAttackTarget` (portée + ligne de vue) et n'est pas réordonné — un pouvoir qui trie ses propres cibles, c'est une seconde politique de ciblage à tenir d'accord avec celle du déplacement, et un déterminisme PvP de plus à prouver. Ici on ne change **que** le moment du tir.

| Pouvoir | Retenu quand |
|---|---|
| `POWER_HEAL` | aucun allié vivant n'est blessé (le lanceur compris) |
| `POWER_BLOCK` | la cible n'a **pas de pouvoir**, ou est déjà bloquée |
| `POWER_DEBUFF` | la cible ne porte **rien** de ce que `resetCombatStats()` efface |
| `POWER_PARALYSIS` | la cible est déjà paralysée |
| `POWER_CONFUSION` | la cible est déjà confuse, ou n'a **aucun autre allié vivant** à retourner contre elle |
| `POWER_TAUNT` | la provocation du lanceur court encore |
| `POWER_PUSH` · `POWER_FREEZE` | la case de retraite est hors board, occupée ou bloquée — la cible ne bougerait pas |
| `POWER_TELEPORT` | le saut ne **rapprocherait pas** du plus faible (déjà au contact, ou repli sur une case qui n'est pas plus près) |
| les autres | jamais — dégâts, bouclier, poison et brûlure posent toujours quelque chose (les deux derniers cumulent) |

- **Les trois statuts ASSIGNÉS y gagnent un correctif au passage** : `power_block_remaining`, `paralysis_remaining` et `confusion_remaining` sont écrits, pas maximisés — rejouer le pouvoir sur un statut plus long que le nouveau le **raccourcissait**. Ne pas rejouer tant qu'il court ferme le cas, et la charge retenue re-part au tick où il lapse : la couverture est meilleure qu'avec le rafraîchissement, sans le risque.
- ⚠️ **`POWER_DEBUFF` ignore la JAUGE de la cible.** `resetCombatStats()` la remet à zéro, mais c'est un effet de bord du balayage, pas ce que le pouvoir dissipe : la compter rendrait le dissipateur pertinent contre **tout** ennemi doté d'un pouvoir — c'est-à-dire annulerait le filtre sur celui qui en avait le plus besoin.
- ⚠️ **L'IMMUNITÉ n'est PAS un motif de retenue**, alors qu'elle est bien un no-op. `effect_immunity` a déjà une issue *designée* — la déflexion (`extra: { immune: true }`, sa recette VFX dédiée) — et c'est un **contre que le joueur a gagné** par un attribut : laisser les lanceurs garder leur charge le désamorcerait, en rendant l'immunité gratuite pour son porteur. On préfère la voir jouer.
- ⚠️ **`POWER_TELEPORT` y gagne aussi une attaque.** Sans destination, il rendait `false` : la jauge était bien conservée, mais l'unité perdait **son tick entier** (ni pouvoir, ni attaque). Le filtre passant en amont, elle frappe normalement à la place. `_teleportPlan()` est le calcul partagé entre la question et le pouvoir — deux copies de la recherche de case auraient fini par diverger.
- **Tous les prédicats sont des fonctions pures de l'état de combat** : rien de nouveau ne voyage sur le réseau, le contrat de déterminisme PvP (`round:board_ready`) est inchangé et `pvp.test.ts` passe sans modification.
- ⚠️ **Les deux golden combats S4 et S5 ont changé de snapshot, et c'est le sujet même du lot** : S4 montrait un paralyseur re-paralysant une cible qui l'était pour 20 steps encore, S5 un téléporteur sautant à côté d'un ennemi **déjà au contact** — l'un et l'autre perdant le combat que la version filtrée gagne. Un snapshot inchangé aurait voulu dire que rien n'avait bougé.
- Verrouillé par `client/src/test/power-relevance.test.ts` (**éprouvé dans les deux sens** — le filtre neutralisé, 19 de ses cas passent au rouge), qui couvre chaque prédicat par sa paire refus/tir **et** la conséquence en combat : jauge retenue, attaque normale à la place, tir au premier tick où la cible le mérite.

### Pouvoirs sans portée (`RANGELESS_POWERS`)

**Trois pouvoirs n'ont pas besoin d'un ennemi à portée pour partir** : `POWER_HEAL`, `POWER_TAUNT` et `POWER_TELEPORT`. La phase d'attaque s'arrêtait sur le `canAttack` avant même de regarder la jauge, ce qui donnait trois absurdités :

| | Sans la règle |
|---|---|
| `POWER_HEAL` | un soigneur de ligne arrière (`range: 1`) ne soignait **jamais** — il devait être au corps à corps pour soigner quelqu'un derrière lui |
| `POWER_TAUNT` | le tank ne provoquait qu'**une fois au contact**, c'est-à-dire trop tard : provoquer sert à cueillir les ennemis avant qu'ils ne choisissent leur cible |
| `POWER_TELEPORT` | il fallait être **à portée pour se mettre à portée** — le pouvoir dont le métier est de combler la distance était le seul à exiger qu'elle soit déjà comblée |

**Le critère n'est pas un goût de design, il est structurel** : ces trois-là sont exactement les pouvoirs de `_firePower` qui **ne lisent jamais `primaryTarget`** (le soin parcourt `_allies`, la provocation et le téléport lisent `unit`). C'est ce qui rend la règle sûre — et pourquoi elle est écrite ainsi : ⚠️ **un pouvoir ajouté à `RANGELESS_POWERS` ne doit pas lire la cible**, qui vaut alors `null`.

- Hors de portée, `_isPowerRelevant` est donc interrogé avec `target: null`, et sa **première ligne** est le filet correspondant : un pouvoir à cible sans cible ne fait rien, il rend `false` avant d'atteindre le `switch`. Sans elle, une future entrée dans le set jetterait en plein combat.
- **La pertinence s'applique quand même** : un soin sur un camp à PV pleins, une provocation déjà en cours ou un téléport qui ne rapprocherait pas restent retenus, à portée comme hors de portée. « Sans portée » lève une condition, il n'en dispense aucune autre.
- **Hors de portée et sans pouvoir à lancer, l'unité n'émet plus rien** et se contente d'avancer — c'est l'ancien `continue`, simplement déplacé après le test du pouvoir.
- ⚠️ **La brûlure pulse sur un tir hors de portée.** `_applyBurnStacks` suit l'**action** de l'unité, et un pouvoir *remplace* l'attaque du step : un soin lancé de loin brûle comme une frappe. C'est la seule entorse à « une cible hors de portée cesse de brûler » (cf. « Poison et brûlure »), et elle est cohérente — ce qui borne la brûlure, c'est de ne **rien faire**, pas de ne pas frapper.
- ⚠️ **Conséquence côté rendu, invisible depuis `logic/` : un téléporteur peut MARCHER puis se téléporter dans le même tick.** Déplacement et attaque ont des horloges indépendantes, et depuis que le téléport part hors de portée les deux tombent ensemble — le step émet alors **deux `move`** pour la même unité (constaté sur le golden S5). `Scene3D.animateUnitMove` et `playBlink` poussent chacun une animation dans `anims` : les deux se disputeraient la position de l'objet pendant 0,28 s, la marche annulant visuellement le blink. `CombatAnimator3D` ne joue donc que le **dernier** `move` d'une unité téléportée sur le tick — le board fait foi, et il est déjà à la case d'arrivée. Rien n'est corrigé côté logique : la marche a bien eu lieu, elle est seulement recouverte.
- Verrouillé par les 8 golden tests « pouvoirs SANS PORTÉE » de `client/src/test/power-relevance.test.ts` (34 au total), **éprouvés dans les deux sens** — la garde de portée rétablie, 4 passent au rouge. La règle du rendu, elle, n'est pas testée : la suite tourne en node sans DOM (même raison que pour les composants React).

### Effets visuels — une recette par pouvoir (`three/PowerVfx.ts`)

Les 14 pouvoirs jouaient tous le **même** `spawnBurst(50)` + `spawnRing`, avec une classe CSS qui n'en distinguait que 4 : impossible de savoir lequel venait de partir sans lire le toast. Chacun a désormais une **grammaire** à lui — direction, silhouette, locus — parce que c'est elle qui distingue, pas la teinte : poison `0xc878e0` et confusion `0xa040c8` sont indiscernables en mouvement.

| Grammaire | Pouvoirs |
|---|---|
| Explosion radiale | Super Attaque, Attaque Zone |
| Implosion (`spawnConvergence`) | Débuff, Téléportation (départ), Soin |
| Faisceau (`spawnBeam`) | Super Attaque, Blocage, Provocation (retour) |
| Dôme (`spawnDome`) | Bouclier, **déflexion d'immunité** |
| Orbite (`spawnOrbit`) | Confusion |
| Nuage bas persistant | Poison |
| Arcs rasants + anneau rentrant | Paralysie |
| Cône directionnel | Poussée |
| Sceau runique (`spawnMagicCircle`) | Blocage |
| Cristaux au sol (`spawnIceBlock`) | Gel |

**Le module est SÉPARÉ de `Scene3D` et ce n'est pas cosmétique** : `Scene3D` reste une bibliothèque de primitives (elle ne parle que de géométrie et d'éléments, cf. `spawnElementImpact`, le modèle de composition recopié ici), là où une recette parle d'un `CombatEvent`. `PowerVfx.ts` n'importe de `Scene3D` que son **type**.

- **Hybride** : la forme et la couleur appartiennent au **pouvoir**, la signature élémentaire au **lanceur** (`elementAccent`, posé sur **sa** case seulement, à ~30 % du budget d'un impact). Sans ce cantonnement, une Attaque Zone sur cinq cibles devient illisible.
- **Sobre** : aucun `shakeCamera` sur les pouvoirs — il reste réservé à l'élément `terre` (`spawnElementImpact`).
- **Persistance ciblée**, là où l'invisibilité fait le plus mal : pulse de poison, pulse de brûlure, orbite de confusion, cristaux de la case gelée. Paralysie, blocage et provocation restent portés par le médaillon de statut de `UnitCardEl`.
  - ⚠️ L'orbite vit **tant que le statut dure** (prédicat `alive: () => target.confusion_remaining > 0`), jamais sur une durée figée : celle-ci mentirait dès qu'on change la vitesse de combat ou qu'un `POWER_DEBUFF` purge le statut.
  - L'événement `dot` **ne dit pas d'où vient le pulse** — poison et brûlure le partagent. On le déduit de l'état de l'unité (`dot_effects` / `burn_stacks`) plutôt que d'élargir le contrat d'événements de `logic/`, que les golden tests verrouillent.
- **Déflexion d'immunité** : une seule recette pour les **sept** pouvoirs que `effect_immunity` dévie, et **aucun** effet du pouvoir. Avant, l'effet complet se jouait sur une cible immunisée — indiscernable d'un effet qui a pris.
- **5 primitives nouvelles** (`spawnBeam`, `spawnDome`, `spawnConvergence`, `spawnOrbit`, `spawnIceBlock`) et 3 options sur l'existant : `dir`/`cone` sur `spawnBurst` (émission en secteur), couleur + échelle sur `spawnMagicCircle`, `startScale` sur `spawnRing` — c'est lui qui rend l'**anneau rentrant** possible, la géométrie de base ne faisant que 0,18 d'extérieur (un `maxScale` négatif seul ferait rétrécir un point).
- ⚠️ Toutes bâties sur le hook **`Scene3D.anims`** (`{ update(dt): boolean }`, la closure possède sa géométrie et son nettoyage) et **jamais** sur `bursts`, dont chaque variante coûte trois branches à tenir d'accord : mise à jour dans `_animate`, disposal à `p >= 1`, et `destroy()`.
- **Budget et durées se règlent en un seul endroit** (`vfxBudget` / `life`) : `LOW_END_DEVICE` (déplacé dans `three/constants.ts` pour que `CombatAnimator3D` le lise sans faire entrer Three.js dans son graphe de modules) et le paramètre **`interval`**, déjà passé à `_apply` mais jusque-là inutilisé. Plafond par lancement sur l'Attaque Zone, pire cas du jeu. Le toast lui-même raccourcit — à ×4 un step dure 45 ms, un toast de 1,8 s survivrait à quarante ticks.
- ⚠️ **Rien côté serveur, rien dans `logic/`, aucune donnée** : tous les payloads `extra` nécessaires (`amount`, `damage`, `ticks`, `pushed`, `immune`, `cell`, `from`/`to`) étaient déjà émis, ils n'étaient simplement jamais lus. `powers.json` reste à trois champs — la table de recettes vit en TypeScript, comme `POWER_NAMES`. Les golden tests passent donc **sans modification**, `powers.test.ts` et `pvp.test.ts` compris, ce qui est la meilleure preuve de non-régression du lot.
- **Banc d'essai** : `dev/CombatLab.tsx` (`?screen=combatlab`) porte un déclencheur manuel des 14 pouvoirs, plus la poussée butée et une case « cible immunisée ». Il fabrique les événements et les passe par le **vrai** `_apply` de l'animateur. Ces branches ne se rencontrent pas en jouant : une carte porte au plus un pouvoir.

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
- Les **remises des magies** sont visibles là où le joueur en a besoin : coût de sacrifice réduit (`_original_sacrifice` → « réduit de N »), transformation sans cible (`_free_transformation`) et matériels de fusion retirés (`_removed_materials`). ⚠️ Ce dernier est **gardé par le type de voie** : le champ vit sur la *carte*, une carte à `summon_options` l'annoncerait sur toutes ses recettes — un héritage se vanterait d'une remise qu'il n'a pas reçue.
- Une **normale sans rien à exiger n'affiche pas de bloc** — « la carte se pose » n'apprend rien.
- Rien de tout ça sur un tooltip d'**unité** : elle est déjà invoquée, sa recette n'est plus actionnable (sa lignée 🧬, elle, reste affichée).
⚠️ Même patron pour le terrain : **`data/BoardInfo.ts`** (`boardEffectLabel`, `boardTargetsUnits`) et **`data/StatLabels.ts`** (`STAT_LABELS`) sont purs pour la même raison — l'infobulle 🗺️ et l'annonce d'entrée en combat décrivent le même terrain, et deux descriptions finissent par ne plus dire la même chose. Les helpers vivaient en privé dans `TooltipHost` ; `attributeName` est désormais exporté par `components/ui/AttrIcon.tsx`, qui porte déjà le même `try/catch` (`getAttribute` **jette** tant que la database n'est pas initialisée).

- Verrouillé par `client/src/test/summon-info.test.ts` (21 golden tests), qui lit le catalogue depuis `initial-data/cards.json` : un matériel pointant sur un id inconnu casse ici plutôt qu'en affichant un identifiant brut au joueur.

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

Mode édition : `navigate('deck_builder', { deckName })` — le nom du deck voyage dans les params de navigation, et de nulle part ailleurs. ⚠️ Un détour par `sessionStorage` (`setPendingEdit` / `consumePendingEdit`) a existé et a été **supprimé** : plus personne ne posait la clé, le repli rendait toujours `null`, et seul un `?.` défensif le maintenait en vie. Les decks enregistrés **avant** la règle d'unicité sont dédoublonnés au chargement, avec un bandeau qui l'annonce (le total change à l'écran, le joueur ne doit pas avoir à le deviner).

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
  - **Tags** : `data/DeckTags.computeDeckTags(cards)` — deux attributs dominants (≥ 2 cartes) puis un mot de profil (Mêlée / Distance / Brutal / Offensif), 3 au maximum. **Un seul calcul, deux moments** : le deck du joueur les fige à l'enregistrement (ils font partie de son méta `DeckRepository`), un deck public les **dérive à l'affichage** — il n'a pas de méta local où les ranger, et sa composition se retouche en admin. Les cartes sont résolues via `CardDatabase` (déjà chargée par `initGameData`), ce qui laisse `computeDeckTags` pur et sans état. ⚠️ **Le tri des dominants a DEUX critères** : effectif décroissant, puis `id` d'attribut. Le second n'est pas cosmétique — sans lui, à effectif égal c'est l'ordre de parcours des cartes qui tranche, et un deck public réordonné en admin changeait de tags sans avoir changé de contenu. Même geste que le départage par `card_id` de l'ordre d'initiative dans `CombatManager`. Verrouillé par `client/src/test/deck-tags.test.ts` (15 golden tests, éprouvés dans les deux sens : le départage retiré, deux d'entre eux passent au rouge).
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

## Fond spatial (tous les écrans hors jeu)

Décor animé commun — `components/ui/SpaceBackground.tsx` + `styles/space.css`. Aucun état de jeu, aucun store, aucune ligne côté serveur.

⚠️ **Il est monté UNE FOIS par `App.tsx`, jamais par un écran.** C'est ce qui fait qu'il y a une seule boucle rAF pour tout le jeu, et surtout que **le ciel ne se réinitialise pas à chaque navigation** — un fond remonté par écran repartirait d'un tirage neuf à chaque aller-retour vers le menu, ce qui se voit. D'où le `fixed` de la couche : elle ne vit pas dans le `<main>` de l'écran, et ne défile pas avec un écran plus haut que la fenêtre.

- **Les écrans sont TRANSPARENTS** : leur `<main>` a perdu `bg-surface` et porte `relative z-10` — sans le `z-10`, une couche positionnée `z-0` passerait **au-dessus** du contenu non positionné.
- ⚠️ **En appli installée, iOS donne un viewport TROP COURT — et la couche de décor le compense.** Avec `apple-mobile-web-app-status-bar-style: black-translucent`, iOS pose le contenu à `y=0` (sous la barre d'état, ce qu'on veut) mais lui donne la hauteur qu'il aurait eue **en dessous** d'elle : le viewport de mise en page est trop court de très exactement `safe-area-inset-top`, et il manque **en bas**. Mesuré sur un iPhone 16 Pro Max : écran 956 pt, `<main>` et couche de décor arrêtés à 893,7 pt, bande de **62,0 pt** — pour une encoche de **62 pt**. La bande est peignable (elle fait partie de la vue web), elle est simplement hors du viewport : `.space-bg` (`space.css`) se prolonge donc de `env(safe-area-inset-top)` vers le bas, ce qu'un élément `fixed` peut faire **sans créer de défilement fantôme** (vérifié : `scrollHeight` inchangé). Gardé derrière **`@media (display-mode: standalone)`** — en navigateur mobile le viewport est juste, et prolonger le décor y ferait descendre le bord du vignettage sous la zone visible. C'est pour cette `@media` que le placement de la couche vit en CSS et non en utilitaires Tailwind.
- ⚠️ **Le même raccourcissement touche TOUT `min-h-dvh` / `h-dvh`** — il n'est compensé que pour le décor. En jeu, `GameScreen` est en `h-dvh` : la barre de commandes (`PhaseControls`, `absolute bottom-0`) flotte donc 62 pt au-dessus du bas réel de l'écran en appli installée. Non traité ici : la correction demande de reprendre les ~25 usages de `dvh`, pas une ligne de fond.
- ⚠️ **Le fond du DOCUMENT n'est PAS `--color-surface`**, et c'en est le point le plus contre-intuitif. La couche de décor est `position: fixed` : tout ce qu'elle ne peint pas laisse voir le canevas du document — rebond d'overscroll, bande sous l'indicateur d'accueil, instant où le viewport visuel dépasse celui de la mise en page. Or le décor **tend au quasi-noir à ses bords** (mesuré : `#080a13` en bas, `#0b0e1c` en haut, moyenne de la ligne de pixels du bord), là où `#0f1117` est plus clair de 7 points sur R et G. Sur un fond aussi sombre, l'écart relatif est énorme : la bande se lisait comme **une barre grise franche en bas de l'écran**, et surtout en **appli installée**, où l'absence de barre d'URL la rend permanente au lieu de passer avec le défilement. `<html>` porte donc un dégradé vertical entre les deux teintes mesurées (`--color-space-edge-top` → `--color-space-edge`, définies dans `space.css`), `no-repeat`, adossé à `background-color` : la zone au-delà de la boîte de `<html>` — page défilée, rebond bas — rend très exactement la teinte du bord qu'elle prolonge. Écart résiduel mesuré : **1,1/255 en bas, 0,8/255 en haut**. Il est posé sur `<html>` **seul** — un fond sur `<html>` est propagé au canevas, en poser un second sur `<body>` le repeindrait par-dessus dans la seule boîte du body.
- ⚠️ **`--color-space-edge` est MIROITÉE hors CSS**, là où aucune variable ne peut voyager : `<meta name="theme-color">` (`index.html`) et `theme_color` du manifeste (`vite.config.ts`) — les trois se règlent ensemble. C'est **la teinte du bas** qu'elles suivent : Android peint ses deux barres système avec une seule couleur, et c'est celle du bas qui borde le décor sur toute sa largeur. `background_color` du manifeste, lui, **reste `#0f1117`** : c'est l'écran de démarrage, il précède l'écran de chargement de l'app (`bg-surface`), pas le décor. Deux couleurs, deux moments — les confondre était l'erreur.
- **`IMMERSIVE_SCREENS`** (`game`, `game_pvp`, `testbench`, `combatlab`) ne le montent pas : le board 3D y occupe toute la fenêtre — le ciel serait invisible, et une boucle rAF de plus pendant un combat WebGL est une dépense pure.
- ⚠️ **Le `z-10` du `<main>` crée un contexte d'empilement.** Une `Modal` d'écran (`z-40`) y est donc confinée, là où `TooltipHost` et `RewardToasts` (`z-50`, montés par l'App) restent au-dessus — c'est **l'ordre qui prévalait déjà**, il n'y a rien à rattraper. Les modales en `createPortal(…, document.body)` (cf. `ConfirmBuy`) sortent du contexte et passent devant tout : inchangé.

**Le partage CSS / canvas n'est pas arbitraire**, c'est la règle qui décide où va chaque couche :

| | Où | Pourquoi |
|---|---|---|
| Vide profond, **deux nébuleuses** | CSS (`space.css`, `@keyframes`) | large et lent → composé par le GPU, sans une frame de JS |
| **Étoiles**, étoile filante | `<canvas>` 2D | ponctuel → chacune sa dérive, son scintillement, sa teinte |

Les mêmes nébuleuses dessinées au canvas coûteraient un remplissage plein écran à chaque image ; les mêmes étoiles en CSS demanderaient un élément par point.

- **Trois sorties de secours, toutes obligatoires** : `prefers-reduced-motion: reduce` → **aucune boucle rAF**, une seule frame dessinée (le ciel reste, le mouvement part) et les nébuleuses figées ; `LOW_END_DEVICE` (celui des budgets de particules du combat, `three/constants.ts`) → moitié moins d'étoiles ; `devicePixelRatio` plafonné à 2 — au-delà on paie 4× pour des points de 1 px.
- ⚠️ **Le `dt` est plafonné à 50 ms.** Un onglet revenu au premier plan rend un `dt` de plusieurs minutes : sans plafond, les étoiles sauteraient d'un bloc et une filante traverserait l'écran en une image. Le `visibilitychange` recale l'horloge au retour.
- **Densité, pas nombre** : une étoile par tranche de surface (`AREA_PER_STAR`), plafonnée — le ciel suit l'écran au lieu d'être calibré pour un seul.
- Le **halo** des étoiles proches est un dégradé **pré-rendu** (une texture par teinte), jamais un disque plat à faible alpha : un disque plat se lit comme un disque gris, c'est le dégradé qui fait la lueur. Un `createRadialGradient` par étoile et par frame, lui, serait hors budget.
- ⚠️ **Pas de `filter: blur()`** sur les nébuleuses : ces dégradés sont déjà continus, et un flou plein écran est l'effet le plus cher qu'on puisse poser sur un mobile. Elles sont en `mix-blend-mode: screen` — une couche opaque poserait un halo à bord visible sur le vide profond.
- La **vignette** n'est pas cosmétique : les écrans sont du texte blanc et des boutons fins, une nébuleuse qui passe dessous leur ferait perdre leur contraste. L'en-tête collant (`ScreenHeader`) reste **opaque**, comme avant — le contenu défile dessous, et un `backdrop-filter` y créerait un bloc conteneur qui piégerait les `position: fixed` de ses descendants.
- Le décor est `aria-hidden` et `pointer-events-none` : il ne dit rien à un lecteur d'écran et ne mange jamais un tap destiné à un bouton.

---

## Logo animé (menu principal)

Le logo du menu n'est pas une image : c'est le portail, qui **respire**. `components/ui/AnimatedLogo.tsx` — portage de la composition Claude Design « Portail Millenium Ambiance » (boucle de **20 s**) en composant React autonome, sans le runtime de Design. Trois PNG dans `client/public/logo/` (`core`, `ring`, `wordmark`), quantifiés à 256 couleurs : **202 Ko à eux trois**, contre 1 Mo à la sortie de Design et 1,6 Mo pour le `logo.png` statique qu'ils remplacent à l'écran.

- **Il se pose SUR le décor, il ne le remplace pas** : le fond opaque plein cadre, la vignette et les poussières d'ambiance de la composition d'origine sont retirés — c'est `SpaceBackground` qui tient le ciel. Toutes les couches lumineuses sont en `mix-blend-mode: screen`, aucune n'est opaque.
- ⚠️ **Aucun re-render React par frame** : le DOM est monté une fois, la boucle rAF mute les `style` par référence (même geste que `three/`). Une trentaine d'éléments reconciliés soixante fois par seconde pour un décor de menu serait la dépense la plus inutile de l'application.
- ⚠️ **La première frame est posée SYNCHRONEMENT au montage**, avant la boucle : un onglet ouvert en arrière-plan ne reçoit aucun `requestAnimationFrame` et y resterait sur ses styles neutres — anneau et pierre à plat, sans halo ni lueur de cœur. C'est aussi cette frame, et elle seule, que voit `prefers-reduced-motion: reduce`.
- Les **trois sorties de secours** de `SpaceBackground` s'appliquent telles quelles : mouvement réduit → aucune boucle ; `LOW_END_DEVICE` → moitié moins de braises ; et **les rayons de `blur()` sont constants** — animer un flou re-rasterise la couche à chaque frame, animer son opacité ne coûte qu'une composition. Même raison pour les deux volutes coniques, qui **tournent** au lieu de voir leur `conic-gradient` réécrit.
- **Deux transforms imbriqués, qui ne se disputent rien** : l'extérieur porte la mise à l'échelle (mesurée une fois par `ResizeObserver`, le repère interne étant en px « source »), l'intérieur le balancement de caméra. La largeur vient du `className` (`w-44 sm:w-52`), la hauteur d'un `aspect-ratio` — le logo suit l'écran sans qu'aucune taille ne soit écrite deux fois.
- Toutes les fréquences sont des **multiples entiers de la boucle** : la couture des 20 s est exacte, il n'y a pas de saut à reprendre. Braises et runes sont tirées par un générateur **semé** — le logo est le même à chaque chargement.
- Il porte déjà le mot « MILLENIUM » : le sous-titre du menu remonte contre lui (`-mt-2`), la composition réservant sa marge sous le mot.
- ⚠️ **L'écran de chargement (`App.tsx`) garde le `logo.png` statique**, et c'est délibéré : il s'affiche avant que les données de jeu soient là, monter une boucle rAF pour le temps d'un fetch n'a rien à donner. `logo.png` reste par ailleurs la source des icônes PWA.

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

**Ajouter un écran se fait à UN endroit** : le tableau `SCREEN_NAMES` (`uiStore.ts`), dont `ScreenName` est **dérivé** (`as const` + `typeof […][number]`). ⚠️ Les deux existaient en double, et une seule des deux listes était gardée par le compilateur : un écran ajouté à l'union mais pas au tableau était navigable en SPA et refusé au deep-link, sans que rien ne le signale. Le rendu est apparié dans `App.tsx` par un `Record<ScreenName, ComponentType>` — TypeScript y vérifie l'**exhaustivité**, donc un nom ajouté sans composant en face ne compile pas (éprouvé). `IMMERSIVE_SCREENS` est typé `Set<ScreenName>` pour la même raison : une faute de frappe y passait sans bruit.

⚠️ **`GameScreen`, `GameScreenPvp`, `TestBench` et `CombatLab` sont chargés en `lazy()`.** Ce ne sont pas les plus gros écrans en lignes : ce sont les seuls à tirer `three/Scene3D`, donc Three.js tout entier (≈ 560 Ko). Importés en statique, ils le faisaient télécharger **pour afficher le menu** — un joueur qui ouvre la boutique ou lit le codex payait le moteur 3D sans lancer une partie. Mesuré : bundle d'entrée **1 058 Ko → 447 Ko** (295 → 133 Ko gzip). Une frontière `Suspense` unique entoure tout le routage ; les écrans statiques ne suspendent jamais. **Tout nouvel écran qui importe `three/` doit rejoindre cette liste**, sinon il ramène Scene3D dans le chunk d'entrée et annule le découpage d'un coup.

### Online (Phase 7)

- **Auth optionnelle** (`authStore`) : jeu jouable en invité ; se connecter active la synchro serveur des decks. `AuthScreen`/`ResetPasswordScreen`, `ProfileScreen`, `FriendsScreen` sur les API `routes/online.js`.
- **Tournoi** (`TournamentScreen`) : bracket local à 8 entièrement client (`logic/Tournament.js`), élimination directe, chaque match en Bo5. Le deck engagé est le **deck actif** (choisi au menu, aucune sélection ici) et est figé dans le bracket au lancement.
  - Les matchs **entre IA** sont simulés (`MatchSimulator`, headless déterministe), résolus dès l'ouverture d'un round.
  - Les matchs **du joueur** se **jouent** : chaque manche du Bo5 lance une vraie partie solo (`GameScreen` avec `params.tournament`), contre le deck public de l'adversaire injecté via `buildSession(..., enemyDeck)`. Le résultat est reporté dans le bracket au retour (`tournamentStore.finishGame`) : victoire/défaite créditée, égalité non comptée (manche rejouée), abandon = manche concédée.
  - Le bracket vit dans `stores/tournamentStore.ts` (et non dans l'état du composant) : l'écran Tournoi est démonté pendant qu'on joue. `pendingGame` est le contrat entre les deux écrans — posé avant de naviguer, consommé au montage de `GameScreen`, soldé au retour.
- **PvP** (`OnlineLobby` + `GameScreenPvp` + `game/PvpController.ts`) : le lobby joue le **deck actif** (choisi au menu, aucune sélection ici), envoyé avec `queue:join`. Sur `match:found`, le lobby **présente l'adversaire** (avatar + pseudo + tag, overlay plein écran) pendant `MATCH_REVEAL_MS` (3 s) avant de naviguer — `MatchRelay.handleReady` n'a pas de chrono, les deux clients peuvent donc tenir cette pause chacun de leur côté. L'overlay **couvre le `◂`** à dessein : le match existe déjà côté serveur, et quitter pendant la présentation le laisserait orphelin. Le décompte affiché ne pilote rien, le départ est tenu par le `setTimeout` (annulé au démontage, sinon un retour navigateur ferait naviguer l'écran suivant). Sans adversaire au bout de 10 à 20 s (délai tiré), le serveur en sert un **artificiel** — même écran, même contrôleur d'écran, cf. « Adversaires artificiels ». Le serveur (`ws/`) fait matchmaking + relais **opaque** ; chaque client simule le combat localement (déterminisme → même vainqueur des deux côtés). L'adversaire est reconstruit **en miroir** (rows 7–10) depuis `net/PvpOpponentProvider.js`. `GameSession` a un mode `'pvp'` (pas d'EnemyAI, terrain convenu — tiré par le **seul rôle A** depuis sa session, qui porte les terrains déjà joués et les attributs des deux decks ; cf. « Le tirage du terrain »).

  **Parité avec le mode solo** : cimetière, menu d'options d'invocation et **Phase Shopping** sont présents en PvP. Le shopping n'est pas synchronisé — chaque joueur tire et applique ses magies localement ; le résultat est transmis à l'adversaire dans le payload `round:board_ready` du round suivant. Un chrono de 45 s le borne (passage automatique) pour ne pas bloquer l'adversaire à la barrière réseau ; le décalage résiduel est absorbé par la barrière `round:combat_start_ack`.

  **Contrat de déterminisme** : tout état persistant d'une unité doit voyager dans `round:board_ready`, sinon les deux clients simulent des combats différents. Le payload transporte par unité `card_id`, `position`, `veterancy_points`, `base` (stats de base, modifiées en permanence par les magies), `current_hp` (les PV ne se régénèrent pas entre rounds) et `shield` ; plus `player_hp` au niveau du message — chaque joueur est la source de vérité de ses propres PV (les magies globales type `player_hp_bonus` sont invisibles de l'adversaire). Verrouillé par `client/src/test/pvp.test.ts`.

  ⚠️ **Le terrain n'entre pas dans ce payload et n'a rien à y faire** : son **id** voyage dans `round:go` (le serveur arbitre, les deux clients rejouent le même), et les **attributs du deck adverse** dans `match:found`, une fois pour tout le match. Le choix dépend désormais des deux decks, mais le contrat de déterminisme est inchangé — `pvp.test.ts` passe sans modification. La barrière `terrain_pick` → `combat_start_ack` → `round:go`, dont ce choix dépend entièrement, n'avait **aucune couverture** : elle en a deux depuis (`pvp-relay.test.ts`).

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
- **Cible tactile ≥ 44 px (`--spacing-tap`)** — portée par `Button` et par `IconButton` (`components/ui/primitives.tsx`). ⚠️ Le mode **`compact`** d'`IconButton` existe pour les tuiles denses : il garde le chip *visible* à 28 px mais porte bien une cible de 44 px, le `-my-2` empêchant cette cible de faire grandir la ligne. C'est ce qui manquait à l'épingle 📌 et au reroll 🎲 de la boutique, qui s'étaient fabriqué leurs propres boutons 28 × 28 — les seuls contrôles du jeu sous le seuil.
- ⚠️ **16 px minimum sur toute saisie** (`input, textarea, select` dans `styles/index.css`, en `!important` pour l'emporter sur une classe Tailwind). Ce n'est pas un choix de maquette : **Safari iOS zoome le viewport** dès qu'un champ passe sous 16 px à la mise au point, et ne redescend pas seul. `user-scalable=no` **ne protège pas** — Safari iOS l'ignore depuis iOS 10 ; la balise a été retirée, où elle ne faisait plus que bloquer le pincer-zoomer là où il *est* honoré (Chrome Android). La règle est posée sur l'élément et non sur chaque champ : en classe utilitaire, il faudrait y penser au prochain `<input>` ajouté.
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

### Mise à jour de l'appli installée (`app/pwaUpdate.ts`)

Le joueur devait **fermer l'appli de force** pour voir une nouvelle version. Ce
n'était pas un caprice d'iOS : reprendre une PWA depuis les tâches de fond n'est
**pas une navigation**, et le navigateur n'interroge le serveur pour un nouveau
service worker qu'au chargement d'une page ou sur un `registration.update()`
explicite. Une session qui ne fait que se réveiller ne demandait jamais rien —
le geste qu'on demandait au joueur était exactement celui qui provoquait la
seule vérification possible.

Deux moitiés, et il fallait les deux : **demander**, puis **appliquer**.

| | Déclencheur | Rôle |
|---|---|---|
| Demander | `visibilitychange` (retour au premier plan), `pageshow`, `online`, plus une passe horaire | `registration.update()` — la question que personne ne posait |
| Appliquer | l'écran devient `main_menu` (abonnement `uiStore`) | `skipWaiting` + rechargement |

- ⚠️ **`registerType: 'prompt'`, alors que le rechargement EST automatique.** La
  différence n'est pas « avec ou sans confirmation », c'est **le moment**.
  `autoUpdate` pose `skipWaiting` + `clientsClaim` : la nouvelle version prend la
  main **sous la page en cours** et purge le précache de l'ancienne. Les écrans
  de jeu étant en `lazy()` (Three.js), un `import()` parti après cette bascule
  demande un chunk dont le nom a changé — le serveur répond par le fallback SPA,
  et le navigateur essaie de lire `index.html` comme un module. `prompt` laisse
  la version neuve **en attente** : la session en cours garde son précache
  intact, et c'est nous qui déclenchons le basculement.
- ⚠️ **`injectRegister: null`** : le script injecté par défaut se contente d'un
  `register()` au chargement. Il n'a rien pour interroger le serveur au réveil —
  c'est très précisément le trou qu'on bouche, on enregistre donc nous-mêmes.
- ⚠️ **Le rechargement n'a lieu QU'AU MENU PRINCIPAL, et ce n'est pas une
  prudence de principe** : `navigate()` n'écrit pas dans l'URL, donc un
  `location.reload()` ramène toujours au menu quel que soit l'écran affiché.
  Recharger en pleine partie perdrait le combat ; recharger sur la boutique ou
  les missions renverrait le joueur au menu sans qu'il ait rien demandé. Au menu,
  le rechargement ne se voit pas — c'est le seul écran où il est gratuit, et
  c'est le hub par lequel tout repasse.
- ⚠️ **Le menu ne suffit pas à dire que rien n'est en cours** : le bracket de
  tournoi vit en **mémoire** (`tournamentStore`) et se perd au rechargement, or
  on revient au menu entre deux manches. D'où la seconde clause de `isIdle()`.
- **Plancher de 60 s entre deux interrogations** : iOS émet `visibilitychange` à
  chaque bascule d'application — sans lui, un aller-retour vers une autre appli
  redemanderait `sw.js` à chaque fois. Le compteur part **chargé**, `register()`
  venant d'en faire une.
- Une interrogation qui échoue (hors ligne, serveur qui redémarre) est sans
  conséquence : la suivante arrive au prochain réveil.

**Aucun test automatisé** — la suite vitest tourne en node sans DOM, et il n'y a
ni service worker ni cycle de vie d'appli à y simuler. La vérification se fait au
navigateur (Chromium + Playwright préinstallés, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`,
ne **pas** lancer `playwright install`), et ce qu'il faut mesurer tient en deux
scénarios, tous deux joués sur deux vrais builds successifs :

1. **au menu** — page contrôlée par le SW, on déploie, on émet un
   `visibilitychange` : la page doit se recharger seule (mesuré : < 1,5 s) ;
2. **hors du menu** — même chose depuis la boutique : la version doit rester
   `registration.waiting === true` **sans** rechargement, puis s'appliquer au
   premier retour au menu (mesuré : < 1 s après le tap).

⚠️ Le piège du protocole : **changer un commentaire ne fait PAS une nouvelle
version.** La minification l'efface, le hash du bundle ne bouge pas, `sw.js` est
identique au bit près et le test passe à vide en ne prouvant rien. Il faut un
changement qui survive au minifieur — et vérifier que `sw.js` a bien changé
avant de conclure.

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

### Deux contraintes du rendu 3D qui ne se devinent pas

Elles ont coûté trois effets de pouvoir invisibles avant d'être identifiées à l'écran. Elles s'appliquent à **tout** ce qu'on ajoute dans `three/`.

**1. La caméra du board regarde DROIT vers le bas.** `_applyCameraState` pose `camera.position.set(0, _camH, _camCenterZ)` puis `lookAt(0, 0, _camCenterZ)` — il n'y a pas d'inclinaison, seulement la perspective qui écarte les bords. Conséquence : **tout ce qui doit se lire est planaire**. Une barre verticale, une colonne montante, une cage se projettent sur un point. Une première version du Soin (colonne de motes montantes) et de la Paralysie (cage d'arcs verticaux) était rigoureusement invisible. Les particules qui montent doivent aussi **s'écarter** ; les arcs se referment **sur le plan du sol**.

**2. Une carte CSS3D occupe une case ENTIÈRE et masque tout ce qu'il y a dessous.** `CARD_PX × CSS_SCALE` = 1 unité monde, soit exactement une case ; et le `CSS3DRenderer` rend dans un **élément DOM empilé au-dessus du canvas WebGL**. Les deux renderers ne partagent aucun tampon de profondeur : **rien de ce qui est dessiné à moins de ~0,5 unité du centre d'une unité n'est visible, quelle que soit sa hauteur `y`**. D'où les dômes (rayon 0,9), les orbites (0,76) et les convergences (1,5) qui débordent franchement la case, et le `scale: 1.7` du sceau de Blocage.

**Corollaire de blending** : `AdditiveBlending` d'une couleur **sombre** n'enregistre presque rien sur un plateau sombre. Les rayons de Provocation en `0xc83020` étaient purement et simplement invisibles ; les traits fins passent par le helper `brighten()` de `PowerVfx.ts`, qui éclaircit sans partir au blanc.

⚠️ Corollaire de perf : un effet qui doit vivre longtemps (le bloc de glace d'une case gelée) se pose **statique** et se retire par un disposer, il ne s'anime pas en boucle. `Scene3D._animate` fait du **rendu à la demande** — il saute la frame quand `anims`, `bursts`, `_shake` et `_needsRender` sont tous vides — et une animation permanente annulerait cette économie pour tout le combat.

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
