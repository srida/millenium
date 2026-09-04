# CLAUDE.md — Millenium

Auto-Battler web (inspiré de Teamfight Tactics et Marvel Snap). « TFT avec la cadence de Marvel Snap. »

## Règles de contribution

- **Git** : commit et push directement sur `main` autorisés. Ne créer une branche que si la demande le dit explicitement ; pas de PR sauf demande explicite.
- **Ce document** : chaque entrée est **courte et factuelle** — la règle, le chiffre, le piège. Pas de récit de bug, pas de justification de design, pas d'inventaire de tests. Si ça n'aide pas à écrire du code, ça n'a pas sa place ici ; l'historique vit dans git.
- **Avant de committer** : `npm run lint:all` et `npm test` doivent passer.
- **Tests de régression** : à éprouver dans les deux sens — vert sur le code corrigé, **rouge** sur le bug réintroduit exprès.

## Stack

- **Client** (`client/`) : Vite + React + TypeScript + Tailwind v4 + Zustand + **Three.js vanilla** (npm ; un composant React monte un `<canvas>` et délègue à `Scene3D`, qui possède la boucle de rendu — pas de react-three-fiber). PWA via `vite-plugin-pwa`.
- **Serveur** : `app.js` (toute l'app Express, exportée) + `server.js` (port, `http.Server`, attache du WebSocket PvP). Sert `client/dist` en prod.
- **Base** : SQLite (`better-sqlite3`, synchrone) via `db.js`. Catalogues en JSON dans `data/`.
- Repo : `https://github.com/srida/Millenium`

Philosophie : data-driven, mobile-first, déterministe, **séparation stricte logique / visuel**.

## Commandes

```bash
npm start                 # serveur Express — port 3742 (charge .env via --env-file-if-exists)
npm run client:dev        # client Vite — port 5173 (proxifie /api, /illustrations, /ws → 3742)
npm run build             # tsc --noEmit puis build Vite → client/dist
npm run lint              # eslint backend (racine, routes/, ws/, scripts/)
npm run lint:all          # backend + client
npm test                  # = npm --prefix client test (toute la suite)
```

Dans `client/` : `npm test` (vitest run), `npm run lint`, `npm run typecheck`.

⚠️ `--env-file-if-exists` et non `--env-file` : ce dernier **échoue au démarrage** quand `.env` est absent, ce qui casserait la prod (l'hébergeur injecte les variables).
⚠️ `ADMIN_PASS` est **obligatoire** : `app.js` refuse de se charger sans elle.
⚠️ Déployer avec `TZ=Europe/Paris` — tout le calendrier du jeu lit l'heure locale du process. `logTimezone()` la journalise au démarrage.

---

## Architecture

### Frontières (verrouillées par ESLint)

- `client/src/logic/` n'importe **ni React, ni Zustand, ni Three, ni `data/`** — headless et testable.
- `client/src/three/` n'importe **ni React ni Zustand**.
- `client/src/logic/` ne fait aucune manipulation DOM et ne contient aucun `requestAnimationFrame`.
- Les composants UI ne contiennent aucune logique de combat, d'attribut ou d'invocation.

`client/eslint.config.js` encode ces frontières **et** les règles des hooks React. `exhaustive-deps` est en **`error`** : les écarts délibérés portent chacun leur `eslint-disable-next-line` avec sa raison.

`eslint.config.js` (racine) couvre le backend CommonJS. Deux pièges :
- ⚠️ `no-restricted-imports` ne voit **que** les `import` ES. En CJS il faut `n/no-restricted-require` (eslint-plugin-n).
- ⚠️ En config plate, une règle est **remplacée**, pas fusionnée, par le bloc suivant qui la mentionne → ordre puits d'abord, feuilles ensuite, listes cumulées.

`n/no-extraneous-require` attrape la dépendance fantôme (module requis, absent de `package.json`, résolu par la remontée d'un autre paquet).

### `app.js` / `server.js`

- `app.js` porte toute l'application Express et l'exporte ; `server.js` ne fait que le port, le serveur HTTP et l'attache du WS PvP (qui exige un `http.Server`).
- C'est ce découpage qui rend la couche HTTP testable : `client/src/test/http.test.ts` requiert `app.js` et le passe à `http.createServer`.
- `bootstrap()` et `progression.backfillAll()` vivent **dans `app.js`**, au niveau module — un test qui pose un `DATA_DIR` vide obtient un catalogue peuplé par le code de production.
- ⚠️ La garde `ADMIN_PASS` est la **première instruction d'`app.js`**, avant tout `require` (`db.js` crée `DATA_DIR` et ouvre la base au chargement). Elle **jette** au lieu de terminer le process — c'est ce qui la rend observable ; `server.js` traduit en sortie non nulle.
- `compression` et `helmet` sont montés en tête. `compression` fait passer `GET /api/cards` de 268 Ko à 25,8 Ko.
- ⚠️ La **CSP de helmet est désactivée à dessein** : `admin.html` fait 282 Ko de scripts en ligne.
- ⚠️ L'iframe de `/admin/sim` repose sur le `X-Frame-Options: SAMEORIGIN` que helmet pose par défaut — le passer à `DENY` casse l'onglet Équilibrage.
- **Entretien périodique** (`runMaintenance`, au boot puis une fois par jour, `setInterval(...).unref()`) : purge des sessions expirées, des jetons de reset périmés, des seaux de quota, des logs PvP (7 j) et des runs du labo IA (30 j) ; fermeture des matchs restés `active`.

### Données et assets (`asset-dirs.js`)

`data/` et `resources/` sont **gitignorés** : le conteneur est reconstruit à chaque déploiement, tout ce qui doit survivre vit sur un **volume monté**.

`asset-dirs.js` (racine, ne requiert rien — chargeable par `server.js`, `sets.js` et `scripts/sync-data.js` sans cycle) décide seul de ces chemins :

```js
const ASSETS_ROOT = path.dirname(ILLUS_DIR);   // dev : <projet>/resources ; prod : le volume
BOARD_BG_DIR = process.env.BOARD_BG_DIR || path.join(ASSETS_ROOT, 'board_backgrounds')
```

- La racine se **déduit de `ILLUS_DIR`** : une famille ajoutée plus tard suit le volume sans nouvelle variable à régler.
- La variable par famille (`AVATARS_DIR`, `POSTERS_DIR`, `BOARD_BG_DIR`) reste **prioritaire**.
- `bootstrap()` trace le chemin réel de chaque famille (`[assets] …`) et avertit quand un dossier est sous la racine du projet alors que `NODE_ENV=production`.

**Quatre familles d'images** :

| Famille | Dossier | Route |
|---|---|---|
| Cartes, terrains, magies, **variantes**, **icônes d'attributs**, **dos de cartes** | `card_illustrations` (`ILLUS_DIR`) | `GET /illustrations/:id` |
| Avatars de decks publics | `enemy_avatars` | `GET /avatars/:id` (repli serveur `PUBLIC_DECK_000.png`) |
| Affiches de packs | `pack_posters` | `GET /pack-posters/:id` (404 franc, repli client 🎁) |
| Fonds de grille de terrain | `board_backgrounds` | `GET /board-backgrounds/:id` (404 franc, décor par défaut) |

⚠️ **Tout nouveau préfixe d'asset** doit être ajouté au proxy Vite (`client/vite.config.ts`), à la liste d'exclusion du fallback SPA (`app.js`), à `ASSETS` de `scripts/sync-data.js` et à `/api/export`. Une famille qui vit dans `card_illustrations` (variantes, icônes d'attributs, dos de cartes) n'a **rien** de tout ça à faire.
⚠️ `npm run sync:push` **supprime les images distantes absentes en local** — faire un `sync:pull` d'abord, ou `--dry-run`.
⚠️ `bootstrap()` ne recopie **jamais** `initial-data/` sur un `data/` déjà peuplé : éditer `initial-data/` ne change rien à une installation existante. Passer par l'admin, par un `/import` en mode `replace`, ou éditer le fichier du volume.

### Lecture et écriture des catalogues (`app.js`)

- **Un id d'asset ne compose jamais un chemin à la main** : `assetPath(dir, id)` est le seul endroit autorisé, et il refuse tout ce que `safeAssetId` rejette (`[A-Za-z0-9_-]+`, **400** sinon).
- `readJson` **met en cache au `mtime`** (patron de tous les modules de règles). Mesuré sur `GET /api/cards` : handler 16,7 ms → 6,0 ms.
- ⚠️ **CONTRAT : `readJson` rend une copie du TABLEAU, mais en partage les ÉLÉMENTS.** On peut `push`/`splice`/remplacer une case ; on ne mute **jamais** un élément en place — pour modifier une entrée, remplacer la case par un objet neuf (`liste[i] = { ...liste[i], champ: valeur }`). La copie profonde a été essayée et rejetée (plus lente que pas de cache).
- ⚠️ `writeJson` écrit de façon **atomique** (`<file>.tmp` puis `renameSync`) et invalide le cache. L'hébergeur envoie un `SIGTERM` à chaque déploiement.
- **Deux plafonds de corps** : 1 Mo en général, 20 Mo sur les seules routes d'upload d'image. ⚠️ Le choix se fait **avant** le parsing — `express.json` ignore une requête dont le corps est déjà lu.
- `downloadUrl` (import d'illustration par URL) borne redirections (5), délai (10 s) et taille (10 Mo), et **refuse les adresses privées** (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, CGNAT, IPv6 locales, tout protocole hors http(s)). La redirection repasse par le contrôle.
- Les drapeaux calculés (`_has_illustration`, `_starter`, `_has_avatar`, `_has_poster`, `_has_background`) ne sont **jamais persistés** : calculés à la lecture, retirés à l'écriture (`POST`/`PUT`/`import`).

### Accès et sécurité

- Un **write-guard global** met **tout** `POST/PUT/DELETE/PATCH` sous `/api` derrière `requireSiteAdmin`. Il n'y a qu'un seul niveau d'écriture ; les `requireSiteAdmin` explicites encore présents sur certaines routes sont redondants.
- ⚠️ **Les GET sous `/api` sont PUBLICS** — une route de lecture ajoutée là est ouverte à tous par défaut.
- ⚠️ Corollaire : **tout joueur marqué `is_admin` peut réécrire le catalogue de cartes**, pas seulement le porteur des identifiants du site.
- `routes/admin-db.js`, `admin-sim.js`, `admin-pvplog.js` et `admin-ailog.js` sont montés avec un `requireSiteAdmin` **explicite** (leurs GET nomment des joueurs ou des cartes).
- **Rate-limit** (`auth.rateLimit`, seaux en mémoire) : la clé est le **compte** quand il y en a un, l'IP sinon. `app.set('trust proxy', 1)` — la valeur `1` est délibérée : plus permissive, un client forgerait son `X-Forwarded-For`.
- ⚠️ Un `:matchId` / `:id` / une date qui compose un **nom de fichier** (`Content-Disposition`) porte une garde stricte de forme, avec un **400** et non un 404 : le 400 est le canari, un 404 signalerait une normalisation en amont.
- WebSocket PvP (`ws/pvpServer.js`, sur `/ws/pvp`) : `maxPayload` **64 Ko** (le défaut de `ws` est 100 Mo), contrôle de l'en-tête `Origin` (liste blanche `ALLOWED_WS_ORIGINS`, localhost toujours accepté, une requête sans `Origin` passe), et `socket.destroy()` sur un chemin d'upgrade inconnu.

---

## Routes

### Catalogues, assets, admin

| Route | Accès | Description |
|---|---|---|
| `GET /` | Public | SPA React (`client/dist`, fallback SPA sauf préfixes d'assets et `/ws`) |
| `GET /admin` | Site admin | Card Manager (`admin.html`) |
| `GET /api/version` | Public | Version du build |
| `GET /api/{cards,attributes,powers,boards,magies,missions,decks,sets,variants,gifts,card-backs}` | Public | Les catalogues, avec leurs drapeaux calculés |
| `POST/PUT/DELETE /api/<entité>[/:id]` | Site admin | CRUD (`routes/crud-json.js` : ne valide que l'unicité de l'id) |
| `POST /api/<entité>/import` | Site admin | Import en masse, mode `skip`/`replace` |
| `POST/PUT/DELETE /api/<entité>/:id/illustration` | Site admin | Art (URL / base64 / suppression) |
| `POST/PUT/DELETE /api/decks/:id/avatar`, `/api/sets/:id/poster`, `/api/boards/:id/background` | Site admin | Les trois autres familles d'images |
| `GET /illustrations/:id`, `/avatars/:id`, `/pack-posters/:id`, `/board-backgrounds/:id` | Public | Les assets (gardés par `safeAssetId`) |
| `GET /api/export` | Auth | Export complet + checksums des quatre familles |
| `/api/admin/db/*` | Site admin | Inspection SQLite |
| `GET /admin/sim`, `/api/admin/sim/*` | Site admin | Rapport et historique de la simulation d'équilibrage |
| `/api/admin/pvp-logs/*` | Site admin | Logs de combat PvP (**outil temporaire**) |
| `/api/admin/ai-logs/*` | Site admin | Runs du Labo IA |

⚠️ `PUT /api/decks/:id` **fusionne** au lieu de remplacer : le formulaire admin poste le deck complet, le DeckBuilder en iframe ne poste que `{ id, name, deck }`. Un remplacement franc effaçait `difficulty`. Corollaire : `_collectPublicDeckFields` reconstruit l'objet de zéro, toute nouvelle donnée de deck doit y être relue.
⚠️ `POST /api/sets` et `PUT/DELETE /api/sets/:id` **réalignent le miroir `card.set`**.

### API en ligne (`routes/online.js`, montée sur `/api` **avant** le write-guard)

| Route | Accès | Description |
|---|---|---|
| `POST /api/auth/{register,login,logout}` | Public (rate-limité) | Comptes |
| `GET /api/auth/me` | Optionnel | Session courante |
| `POST /api/auth/{forgot,reset}-password` | Public (rate-limité) | **Révoque toutes les sessions du compte** |
| `GET/PUT /api/profile/me` | Connecté | Profil (l'appartenance de l'avatar est vérifiée) |
| `GET /api/users/search`, `/api/friends*` | Connecté | Recherche, amis, demandes |
| `GET/PUT /api/me/decks` | Connecté | Synchro des decks (`DeckRepository.pull` / `flushSync`) |
| `GET /api/me/progression` | Connecté | Progression + collection + barème des paliers |
| `POST /api/me/levels/claim` | Connecté | Récupère **tous** les paliers dus |
| `GET /api/me/missions` · `POST …/events` · `…/:id/claim` · `…/weekly/:points/claim` · `…/:id/reroll` | Connecté (20–30/min) | Missions |
| `GET /api/me/shop` · `POST …/{buy,reroll,pin,booster}` | Connecté (20–30/min) | Boutique de cartes |
| `GET /api/me/cosmetics` · `POST …/buy` | Connecté (30/min) | Boutique cosmétique |
| `GET /api/me/arcade` · `POST …/{start,duel}` | Connecté | Run Arcade du jour |
| `GET /api/me/gifts` · `POST …/daily` · `…/:id/claim` | Connecté | Cadeaux |
| `POST /api/me/pvp-log` | Connecté (20/min) | Dépôt d'une vue de combat (**temporaire**) |

Toutes les mutations renvoient **l'instantané complet + la progression à jour** : aucun rechargement derrière une action.

⚠️ **Les `GET` d'instantané génèrent l'offre du jour au passage** (boutique, cosmétiques, arcade, missions) — il n'y a **aucune tâche planifiée**, le cycle avance à la lecture.
---

## Modules de règles serveur

| Fichier | Rôle |
|---|---|
| `db.js` | SQLite, statements préparés, migrations additives (idiome `PRAGMA table_info`) |
| `auth.js` | Sessions, rate-limit, `publicUser()` |
| `progression.js` | Niveau, XP, monnaies, collection |
| `levels.js` | Ce que le passage d'un niveau **donne** |
| `missions.js` | Missions quotidiennes, jauge hebdomadaire |
| `shop.js` | Boutique de cartes, boosters, calendrier (`dayKey`, `nextRotationAt`, `seededRandom`) |
| `sets.js` | Catalogue de packs (`data/sets.json`) + `POSTERS_DIR` |
| `cosmetics.js` | Avatars et variantes achetables |
| `variants.js` | Catalogue de variantes + `illustrationExists` (test générique « cet id a-t-il son PNG ? ») |
| `gifts.js` | Cadeau quotidien + cadeaux ponctuels |
| `arcade.js` | Run solo quotidienne |
| `decks.js` | Résolution du deck book serveur (`resolveDeck`) + faits dérivés non cosmétiques |
| `bots.js` | Identités et decks des adversaires artificiels |
| `pvplog.js` · `ailog.js` | Outils de diagnostic (feuilles, retirables d'un bloc) |
| `json-cache.js` · `asset-dirs.js` | Cache au mtime, chemins d'assets |

**Règle anti-cycle** — elle n'est écrite nulle part ailleurs que ici :
- **Feuilles** (ne requièrent que `db` / `json-cache`, personne ne les requiert en retour) : `sets.js`, `variants.js`, `decks.js`, `pvplog.js`, `ailog.js`, `asset-dirs.js`.
- **Puits** (requièrent les autres, aucun ne doit les requérir) : `levels.js`, `gifts.js`.
- `sets.js` existe parce que `shop.js` (boosters) et `progression.js` (dotation) en ont tous deux besoin, et que `shop.js` requiert déjà `progression.js`.
- `cosmetics.js`, `gifts.js` et `arcade.js` importent **littéralement** le calendrier de `shop.js` : `const { dayKey, nextRotationAt, seededRandom } = require('./shop')`.

**Calendrier** — un seul rendez-vous à retenir : **rotation à 5 h, fuseau du serveur**, partagée par les missions, la boutique, les cosmétiques, l'arcade et le cadeau quotidien. Les missions ajoutent un **cycle de 8 h** ancré sur 5 h (5 h / 13 h / 21 h) et une semaine du lundi. ⚠️ Jamais le fuseau annoncé par le client : il pourrait en mentir pour se faire délivrer un cycle de plus.

**Tirages déterministes** : xorshift32 semé en SHA-256 (`shop.seededRandom`), clé `(joueur, jour[, slot])`. Un tirage douteux se rejoue au lieu de se raconter.

**Deux règles qui traversent tout l'économique** :
1. ⚠️ **Le client nomme, le serveur chiffre.** Aucun montant ne transite dans le sens client → serveur : le client envoie une *raison*, un *index*, une *ligne*, jamais une valeur.
2. ⚠️ **Les gardes anti-double-récupération sont dans le SQL, jamais en JS** — un compare-and-swap ou un `INSERT OR IGNORE`, la marque posée **avant** la livraison, le tout dans une transaction. Deux taps concurrents ne changent qu'une ligne ; le second voit `changes === 0`.

---

## Progression joueur

| Donnée | Colonne | Défaut | Admin (`is_admin`) |
|---|---|---|---|
| Niveau | `users.level` | 1 | 100 |
| XP **dans le niveau** (0–99) | `users.xp` | 0 | inchangée |
| Gold | `users.gold` | 0 | 9999 |
| Gemmes | `users.gems` | 0 | 9999 |
| Cartes débloquées | table `user_cards` | les cartes du **pack de départ** | tout le catalogue |

`XP_PER_LEVEL = 100`, palier unique. `grant()` absorbe le passage de palier (250 XP = +2 niveaux et 50 de reste). Un débit d'XP ne fait jamais redescendre de niveau.

**Barème des gains** (`progression.REWARDS`) : `ai_win` 10 · `tournament_win` 50 · `pvp_win` 70.

- `pvp_win` est refusé sur la route HTTP (`CLIENT_CLAIMABLE`) : le serveur est seul arbitre du vainqueur PvP et le décerne lui-même (`ws/MatchRelay.endMatch`, `ws/BotMatch.endMatch`).
- Une **manche** de tournoi ne rapporte pas `ai_win` (le tournoi a son gain à la victoire finale).
- Solo et tournoi se déroulent entièrement côté client : le serveur ne peut que croire le joueur, le rate-limit (30/min) borne l'abus sans l'empêcher.

```js
progression.initUser(userId) / applyAdminGrants(userId) / backfillAll()
progression.unlockCard(userId, cardId)        // false si déjà possédée ou id inconnu
progression.grant(userId, { xp, gold, gems }) // relatif, plancher à 0 ; fait monter level, ne DONNE rien
progression.unlockedCardIds(user) / ownsCard(user, cardId) / getProgression(user)
progression.starterCardIds() / allCardIds()
```

- ⚠️ **Le catalogue fait foi, pas la base** : `allCardIds()` lit `cards.json` (cache au mtime) — une carte créée en admin est immédiatement débloquable. Les cartes des admins sont matérialisées **et** recalculées à la lecture.
- `auth.publicUser()` expose `level/xp/gold/gems` et `pending_levels` ; la **liste** des cartes, trop volumineuse, vit sur `GET /api/me/progression`.
- ⚠️ `XP_PER_LEVEL` est **la seule valeur du projet dupliquée côté client** (`components/ui/ProgressionStats.tsx`) — à garder synchronisée à la main. Tout le reste voyage.

### Paliers de niveau (`levels.js`)

État dans `users.levels_claimed`. Deux marches qui **s'ajoutent** aux golds, deux échanges qui les **remplacent** :

| Règle | Gain | Nature |
|---|---|---|
| **Chaque** niveau | 50 golds | la pente |
| Tous les **5** niveaux | 50 gemmes | **en plus** |
| Tous les **10** niveaux | un **objet tiré au sort** (carte, avatar ou variante) | **en plus** |
| Niveaux en **2** et **7** | 20 gemmes | **à la place** des golds |
| Niveaux en **3** et **8** | un **objet tiré au sort** | **à la place** des golds |

Une dizaine vaut 300 golds, 140 gemmes, trois objets.

- ⚠️ « En plus » et « à la place » sont deux règles opposées : les marches tombent sur les rangs 0 et 5, les échanges sur 2, 3, 7, 8 — elles ne se croisent **jamais**. Un rang d'échange devenu multiple de 5 ferait se contredire cumul et remplacement (verrouillé par golden test).
- ⚠️ **`progression.grant` ne connaît pas les paliers** : la dette se **déduit à la lecture** (`level − levels_claimed`), il n'y a donc rien à brancher sur les sources d'XP — donc rien à oublier de brancher.
- ⚠️ **L'objet est tiré au moment du TAP**, pas quand le niveau est gagné : c'est ce qui préserve le zéro doublon. Le tirage a lieu **palier par palier, dans l'ordre**. Ce qui attend est annoncé comme une surprise (`🎁 ×N`), jamais nommé d'avance.
- Pool du tirage : `shop.sellableCards`, `cosmetics.avatarPool`, `cosmetics.variantPool`, moins ce qui est possédé ; les trois familles sont **équiprobables**, entre celles qui ont encore un candidat. Pool épuisé → `item: null`, **aucune compensation**.
- Une carte tirée passe par `progression.unlockCard` puis `shop.settleCollection` (épingle libérée, prime de complétion versée).
- ⚠️ `applyAdminGrants` aligne `levels_claimed` (`stmt.syncLevelsClaimed`) : un admin promu ne trouve pas cent paliers rétroactifs.
- Le gain se **récupère** d'un tap (`POST /api/me/levels/claim`, section Progression du Profil). Rien ne périme un palier.
- Le barème **voyage** dans `GET /api/me/progression` : `rules` (dont `rules.swaps`, des **rangs dans la dizaine** `[2,7]`/`[3,8]`, pas des niveaux), `pending`, `pending_totals`, `upcoming`, `next_gems_level`, `next_draw_level`.
- ⚠️ `next_gems_level` / `next_draw_level` **balaient le barème** (`nextLevelMatching`), ils ne se calculent pas par un multiple : les échanges donnent gemmes et objets *entre* les multiples.
- ⚠️ **Un montant nul ne s'affiche pas** : sur un niveau d'échange, un « 💰 0 » se lirait comme une perte.

---

## Missions quotidiennes

Catalogue `data/missions.json`, tables `user_missions` / `user_mission_state`.

| Règle | Valeur |
|---|---|
| Missions par cycle | **2** — deux difficultés sur trois, par **rotation** du créneau (`SLOT_ROTATION` : `[1,2]` → `[2,3]` → `[3,1]`) |
| Cycle | **8 h** (5 h / 13 h / 21 h) |
| Accumulation | **6** actives maximum (= 3 cycles, 24 h d'absence pardonnées) |
| Reroll | 1 gratuit par **jour**, puis **100 golds** (jamais en gemmes) |
| Jauge hebdo | **25** points — 1 par mission **récupérée** |
| Paliers hebdo | 5 / 10 / 15 / 20 / 25 |

| Slot | XP | Golds | | Palier | XP | Golds | Gemmes |
|---|---|---|---|---|---|---|---|
| Facile (1) | 6 | 50 | | 5 pts | 3 | 100 | 5 |
| Moyen (2) | 10 | 100 | | 10 pts | 5 | 150 | 10 |
| Engagé (3) | 15 | 175 | | 15 pts | 6 | 175 | 15 |
| | | | | 20 pts | 8 | 200 | 20 |
| | | | | 25 pts | 13 | 275 | 35 |

Dotation hebdo totale : 35 XP / 900 golds / 85 gemmes. Revenu quotidien : 650 golds / 62 XP. **Les missions sont la source de golds ; l'XP se gagne en jouant** (toute l'XP des missions est divisée par 10 par rapport au brief).

- Sur trois cycles consécutifs, chaque difficulté sort **deux fois** : rattraper 24 h d'absence donne la même chose que d'être passé aux trois rendez-vous. Un lot rattrapé garde la paire de **son** cycle.
- `cycleKey(ts)` → `2026-07-27#1` ; `cycleNumber(key)` en donne un rang **absolu** (pour que `cyclesBetween` marche de part et d'autre de minuit). Le reroll gratuit et la purge restent indexés sur la **journée** (`dayKey`). Une clé sans `#` est lue comme le premier créneau de sa journée — pas de migration à écrire.
- **Le gain se récupère** : `active` → `completed` → `claimed`. La **jauge avance au tap**, pas au franchissement.
- ⚠️ **Une mission terminée mais non récupérée n'est jamais purgée** — `deleteStaleClaimedMissions` n'emporte que les soldées. Le crédit est différé, pas confisqué.
- ⚠️ **Un palier atteint et jamais réclamé est soldé d'office au changement de semaine**, avant la remise à zéro : une jauge qui repart de zéro ne peut pas porter ses restes.
- Corollaire assumé : thésauriser des missions terminées concentre la jauge sur une semaine. Ça ne crée aucune valeur (plafond 25) — non traité.
- **Filtrage par collection** (`requirements.owns_cards_matching`) : une mission Fusion ne sort pas si le joueur n'a pas assez de cartes Fusion. ⚠️ Le filtre porte sur un **attribut** (`attribute`), des deux côtés — l'objectif comme l'éligibilité. Une carte à plusieurs conditions compte pour chacune de ses voies.
- Le cache de `catalog()` est invalidé au mtime : l'admin écrit à chaud.

### Flux d'événements

Le système ne lit **jamais** l'état du jeu : il consomme des **événements nommés**. `logic/` l'ignore ; c'est `GameController` qui les nomme.

| Événement | Payload | Émis par |
|---|---|---|
| `combat_started` | `unit_count`, `attribute_count`, `max_attribute_units` | `_beginCombatAnimation` |
| `combat_ended` | `result`, `unit_count`, `units_lost` | `_onCombatFinished` |
| `summon_performed` | `card_id`, `tier`, `attributes` | `_tryPlace` |
| `power_triggered` | `power_id` | flux `onStep` de `CombatManager` |
| `magic_selected` | `magic_id`, `effect_type` | `_noteMagie` |
| `match_completed` | `result`, `rounds_played` | `_reportMatchCompleted` |
| `deck_saved` | `card_count` | `DeckBuilder.save` (méta, envoyé seul) |

⚠️ **Un lot = une partie.** `missionStore` accumule et n'envoie qu'en fin de partie (ou au démontage de l'écran de jeu). C'est ce découpage qui permet au serveur de **dériver lui-même** ses garde-fous au lieu de croire un drapeau :
- **anti-concede** : lot rejeté s'il porte moins de **2 `combat_started`** ;
- **anti-AFK** : rejeté s'il ne porte **aucun `summon_performed`** ;
- hors partie (`match_id` absent), seuls les `META_EVENTS` sont retenus.

**Portées** (`objective.scope`) : `cumulative` · `single_match` (dans le lot) · `single_combat` (max par `combat_index`). Sans la distinction, « 6 pouvoirs dans un même combat » se validerait avec 6 combats à 1 pouvoir. Le client affiche la portée en chip (`scope_hint`) — elle n'est **pas** répétée dans le libellé du catalogue.

Contrepartie assumée : les missions n'avancent pas pendant qu'on joue.

---

## Boutique de cartes (`shop.js`)

Table `user_shop_state`. Deux systèmes qui ne se recouvrent pas : les **emplacements quotidiens** (vitrine à l'unité, 6/jour dont 1 épinglable) et le **booster** (volume brut sur un set choisi, sans plafond).

**Trois invariants portent tout le reste** :
1. **Zéro doublon** — aucun tirage, nulle part, ne produit une carte possédée. C'est ce qui dispense le jeu de poussière, de fragments et de conversion de doublons. C'est aussi la **seule** contrainte qui pèse sur un tirage : emplacements comme boosters tirent **uniformément** (`shop.pick`), sans poids de tier, sans affinité, sans garantie de composition.
2. **L'offre est serveur** — générée, horodatée et **persistée** (`user_shop_state.offer`). Aucune action client ne la régénère.
3. **Une carte sans illustration ne se vend pas** — `hasArt(id)` via `variants.illustrationExists`, aucun drapeau persisté : la règle porte sur le **fichier**.

⚠️ Le filtre sur l'art vit dans les **six** lectures de la boutique, pas seulement à l'entrée du tirage : `drawablePool`, `buildOffer`, `buyBooster`, `setsView` (`card_count`/`owned_count`/`complete`/`card_ids`), `claimSetCompletions` (sinon prime jamais versée) et `collection`. Elles se contrediraient sinon.
⚠️ La **dotation** (`progression.starterCardIds`) n'est pas concernée : elle est offerte, pas vendue. Une carte de départ sans art reste possédée mais n'est comptée ni au numérateur ni au dénominateur.

| | Prix | Détail |
|---|---|---|
| Emplacement | **500 golds ou 20 gemmes** | 6 cartes **distinctes**, prix unique quel que soit le tier |
| Booster | **1000 golds ou 40 gemmes** | 5 cartes distinctes du pack, disponible en permanence |
| Prime de complétion | — | `completion_reward.gems` (300), versée **une fois, automatiquement** |

- **Reroll** : 1 gratuit par jour, **jamais payant** (un reroll achetable ferait de la boutique une machine à sous). La carte rerollée quitte le pool du jour. Un emplacement épinglé ne se reroule pas — le dé disparaît côté client.
- **Épingle** : `PINNED_SLOTS_MAX = 1`, gratuite, sans délai. L'emplacement traverse la rotation à l'identique. L'état persisté est l'emplacement **entier**. Désigner un autre emplacement **déplace** l'épingle. Elle se libère à l'achat, si la carte tombe au booster, et au `sync` suivant si elle est obtenue autrement.
- ⚠️ **Le prix n'est pas figé** : `withSlotPrices` le ré-estampille à la lecture depuis `SLOT_PRICE` — sinon un emplacement épinglé garderait à vie le barème du jour où il a été mis de côté.
- ⚠️ `slot.pinned` est **dérivé à la lecture** de `state.pinned`, jamais recopié dans l'offre.
- **Verrou d'offre** : l'achat porte `slot` **et** `card_id` → **409** si l'offre a tourné.
- ⚠️ `card_count` est un **plafond, pas une promesse** : les dernières ouvertures d'un pack rendent ce qu'il reste, au plein tarif. L'écran affiche le nombre de cartes restantes. **Ne jamais indexer le prix sur le taux de complétion.**
- Booster **grisé** quand le set est complet.
- ⚠️ **Rattrapage d'une offre plus courte** : `sync` la **complète** (`fillSlots`), ne la régénère jamais — seul écart toléré à « l'offre est figée », et il n'est pas déclenchable par le client.
- ⚠️ **Écart assumé avec le brief** : la Convoitise (épingler n'importe quelle carte du catalogue) n'existe pas ; on garde une *proposition*, on ne commande pas une carte.

### Packs (`sets.js` + onglet 🎁 Packs)

Le préfixe d'`id` (`CORE`, `EXTRA`, `YGX`…) est technique, pas commercial. Chaque carte porte un champ **`set`** ; `data/sets.json` décrit les packs (nom, archétypes, `booster_enabled`, `starter`, `signature_card`, `completion_reward`, liste `cards`).

**Vocabulaire** : le code dit `set`, **l'interface dit « pack »**.

```js
sets.all() / byId(id) / cardIdsOf(def)
sets.isStarter(def) / starterPacks() / starterCardIds()
sets.boosterPacks()            // = tout sauf les packs de départ
sets.posterExists(id) / sets.POSTERS_DIR
```

`shop.sets` **est** `sets.boosterPacks` et `shop.setCardIds` **est** `sets.cardIdsOf`.

- `sets.json` **fait foi** pour le pool d'un booster ; `card.set` en est le **miroir**, réaligné par les écritures — une carte n'appartient qu'à **un** pack commercial. Un pack de départ ne touche pas au miroir.
- À l'enregistrement, `card_count` et `archetypes` sont **dérivés** de la composition, jamais saisis.
- Le sélecteur d'admin **affiche** sans jamais bloquer : répartition par tier, matériaux hors pack, cartes déjà vendues ailleurs (badge orange = **conflit**), cartes du pack de départ (badge vert 🎓 = **information**), cartes dans aucun pack. C'est un tableau de bord, pas un validateur.
- ⚠️ **Depuis que le booster tire uniformément, la composition du pack EST la distribution des drops.** Un pack sans Tier 5 n'en donnera jamais ; plus aucune garantie ne rattrape un découpage déséquilibré.
- `packMissingMaterials` exclut les matériaux du pack lui-même, ceux du **pack de départ** (tout joueur les possède) et ceux désignés par attribut (`ARCH_*`, qui ne sont pas des cartes). Le pack **en cours d'édition** est écarté : sa composition à l'écran fait foi.
- ⚠️ **La prime de complétion est mémorisée par id** (`sets_claimed`) : changer l'`id` d'un pack la fait re-verser. Même piège pour un cadeau supprimé/recréé. L'écran d'admin le dit.
- `scripts/build-sets.js` reste un **point de départ éditable** ; son `--write` réécrit `sets.json` *et* le champ `set` de toutes les cartes — il écrase le travail fait en admin. Il garantit **aucune carte orpheline** (fermeture par union-find sur le graphe de matériaux) ; il ne garantit **pas** la distribution de tiers, et « un archétype jamais découpé » est **impossible** sur le pool actuel (composante unique de 223 cartes).

### Pack de départ (`starter: true`)

Un pack marqué `starter: true` n'est pas un produit : c'est la **dotation offerte à la création de chaque compte**. `progression.starterCardIds()` en est l'union ; sans aucun pack de départ, repli sur le préfixe `STARTER_PREFIX = 'CORE'`. Les données livrées **portent** un pack de départ (`SET_008`, 50 cartes).

⚠️ **Trois exclusions**, sans lesquelles un pack de départ casse la boutique (verrouillées par `packs.test.ts`) : `setsView` (sinon éternellement « ✓ complet »), `claimSetCompletions` (sinon **prime versée à l'inscription**) et `buyBooster` (sinon achetable puis « Collection complète »).

- Un pack de départ ne listant que des ids inconnus retombe sur le repli : un id mal saisi ne doit pas produire des comptes sans aucune carte.
- La dotation voyage sur chaque carte de `GET /api/cards` via **`_starter`** (calculé, jamais persisté). `collectionStore` l'utilise pour son repli invité.

---

## Boutique cosmétique (`cosmetics.js`)

Second **onglet** de `ShopScreen`. Tables `user_cosmetics`, `user_cosmetic_state`.

| Famille | Pool | Prix | Condition |
|---|---|---|---|
| **Avatar** | toute illustration existante (carte, terrain, magie) | **5 💎** | — |
| **Variante** | illustration alternative d'une carte | **50 💎** | posséder la **carte** |
| **Dos de carte** | `data/card_backs.json`, hors dos offerts, art existant | **`price_gems` du catalogue** | — |

3 avatars + 3 variantes + 2 dos par jour, même rotation de 5 h. Les deux invariants de la boutique de cartes s'appliquent tels quels (zéro doublon, offre serveur ; l'achat porte `kind` **et** `id` → 409).

- **Ni reroll ni épingle** : les prix sont bas et un cosmétique manqué **revient** (il ne quitte pas le pool à l'achat).
- **Pool d'avatars automatique**, sans curation ; les 7 avatars offerts (`DEFAULT_AVATARS`) en sont exclus. ⚠️ `avatarPool` itère `SOURCES` (`cards.json`/`boards.json`/`magies.json`) — il ne scanne pas le dossier, donc une icône d'attribut ne devient jamais un visage achetable.
- **Dégénérescence assumée** : moins de trois candidats donnent moins de trois emplacements, voire zéro. Le client affiche un message, pas des cases vides.
- `cosmetics.unlock(userId, kind, id)` débloque sans vendre. ⚠️ Un **avatar** exige que son **illustration existe** (`canUseAvatar` ne teste que la possession — un avatar offert sans PNG serait portable et cassé).
- **Écarts assumés avec le brief** : gemmes uniquement (le brief dit golds), variantes achetables (le brief les classe non achetables). Cadres d'avatar et styles procéduraux n'existent pas.
- ⚠️ **`OFFER_KEY` est une TABLE, pas un ternaire** : `kind === 'avatar' ? avatars : variants` servait le mauvais pool à tout `kind` inconnu. Avec la table, il ne trouve rien — donc il est refusé.

### Dos de cartes

Catalogue `data/card_backs.json` (`{ id, name, default?, price_gems }`), onglet 🂠 de l'admin, art dans `ILLUS_DIR` sous l'id du dos. Montré par la **popup de pioche**, et nulle part ailleurs. Colonne `users.card_back` (`NULL` = le dos par défaut), portée depuis `ProfileScreen`, validée par `cosmetics.canUseCardBack` au `PUT /api/profile/me` — trajet exact de l'avatar, à ceci près qu'on stocke l'**id nu** et non une URL.

- **Le prix est ÉDITORIAL** : il vient du catalogue, `PRICE.card_back` n'est qu'un repli pour une entrée sans prix. C'est le seul cosmétique dans ce cas.
- ⚠️ **`default: true` = offert**, jamais vendu, jamais tiré — le rôle de `DEFAULT_AVATARS`, mais en **donnée** (l'admin l'édite). `owned.card_backs` joint offerts et achetés : sans ça, un joueur qui n'a rien acheté verrait une grille vide alors qu'il porte bien un dos.
- ⚠️ **Un dos retiré du catalogue cesse d'être portable**, même possédé (`canUseCardBack` teste l'existence **et** la possession) ; le client retombe alors sur le dos par défaut.
- ⚠️ **Sans art, ni vendu ni portable** — la règle porte sur le **fichier** (`variants.illustrationExists`), comme partout ailleurs. Catalogue vide ou PNG absent → `DrawPopup` dessine un dos **procédural**, jamais un `<img>` cassé.
- `data/CardBackDatabase.js` **ne jette pas** sur une réponse en erreur, contrairement aux autres databases : un dos n'est pas une donnée de jeu, un serveur en retard de déploiement ne doit pas empêcher de jouer.

**Choix PAR DECK** — onglet Deck du DeckBuilder, section « Dos de carte » (n'existe que si le joueur a au moins un dos débloqué). Comme les variantes, jamais comme l'avatar : `DeckRepository.getDeckCardBack`/`setDeckCardBack`, même patron localStorage + sync que `getDeckColor`/`getDeckVariants`. `RoundStart.DrawPopup` résout trois rangs, du plus spécifique au plus général : le dos du **deck actif** (`DeckRepository.getActiveDeck()`, lu en direct comme partout ailleurs) → celui du **profil** (`ProfileScreen`) → le défaut du catalogue. `null` à un rang retombe sur le suivant.

### Variantes (`variants.js`)

`{ id, card_id }` dans `data/variants.json` — **pas de nom propre** : une variante est une illustration de plus pour une carte. Elle s'annonce par le nom de sa **carte** (`card_name`) ; un `name` résiduel est **ignoré**. L'art vit dans `ILLUS_DIR`, donc aucune famille d'assets à créer.

**Où le choix s'applique** :
- **Avatar** → `ProfileScreen`. `PUT /api/profile/me` **valide l'appartenance** (`cosmetics.canUseAvatar`) et stocke la forme `/illustrations/<id>`.
- **Variante** → **par deck**, dans le DeckBuilder (`meta[nom].variants = { card_id: variant_id }`, à côté de la couleur et des tags, donc déjà synchronisé). Revenir à l'origine **retire** l'entrée.

⚠️ **`client/src/data/CardArt.ts` est le seul point de résolution `card_id → id d'illustration`.** Deux tables, une par camp, et **aucun import** — c'est ce qui autorise `three/UnitCardEl.ts` à s'en servir. Trois invariants, dont aucun ne se voit à l'écran quand il casse : le repli systématique sur `cardId`, **l'étanchéité des deux tables** (les variantes de l'adversaire ne doivent jamais habiller les cartes du joueur) et la purge du seul camp adverse par `setEnemyVariants(null)`. Remplissage : `game/bootstrap.buildSession`, `deckStore.refresh()`, `PvpController.begin()`, `GameController.dispose()`.

---

## Cadeaux (`gifts.js`)

Ce que le jeu **donne**. Catalogue `data/gifts.json`, tables `user_gift_state` / `user_gifts`.

| Famille | Contenu | Rythme |
|---|---|---|
| **Quotidien** | 200 golds + 5 gemmes | une fois par rotation de 5 h |
| **Ponctuel** | plusieurs **lots** (`contents`) écrits en admin | une fois **par compte**, sans limite de durée |

Six types de lot : `gold`, `gems`, `card`, `pack`, `avatar`, `variant`.

1. **Un cadeau se récupère, il ne tombe pas.**
2. ⚠️ **Le cadeau est consommé par le GESTE, pas par son rendement.** Une ligne dont le joueur ne peut pas profiter (carte possédée, pack complet) ne fait **pas** échouer la récupération : le cadeau est soldé et le compte rendu dit la vérité ligne par ligne.
3. **Le module ne connaît aucun montant qui ne soit pas le sien** : un lot `pack` livre **un** booster par `shop.deliverBooster`. Tirage, zéro-doublon, filtre sur l'art, épingle et primes sont ceux de la boutique.
4. ⚠️ **Ancienneté** : `gift.created_at >= user.created_at`. Un cadeau ne s'adresse qu'aux comptes créés **avant** lui.

- ⚠️ **Il n'y a pas de `sync` dans `gifts.js`, et ce n'est pas un oubli** : le module ne tire aucune offre, tout se déduit à la lecture. `refresh` n'est qu'un alias de `getSnapshot`.
- Gardes SQL : quotidien `ON CONFLICT(user_id) DO UPDATE … WHERE daily_day IS NOT @day` — ⚠️ **`IS NOT` et non `!=`**, qui rendrait `NULL` (donc faux) à la première récupération ; ponctuels `INSERT OR IGNORE` sur `(user_id, gift_id)`.
- ⚠️ `created_at` est **estampillé par le serveur** à la création et **préservé** par le `PUT`, jamais lu du corps. L'import le **conserve** quand il en reçoit un (sinon `sync-data.js` re-daterait tout).
- ⚠️ **Un `created_at` absent fait tomber le cadeau au chargement** (avec un `console.warn`) : c'est le seul champ sans lecture de repli sûre.
- Un lot mal formé est **ignoré** (`normalizeLot`) ; un cadeau dont **tous** les lots sont invalides n'existe pas. `validateGift` rend le même verdict à l'écriture (400) qu'au chargement.
- **Plafonds** : `MAX_LOT_AMOUNT = 100 000` par lot de monnaie, `MAX_LOTS_PER_GIFT = 12`.
- 🎀 et non 🎁 : les Packs occupent déjà ce glyphe.

**Ce que `gifts.js` a exigé d'ailleurs** — deux extractions, pour ne pas se donner deux versions d'une règle :
- `shop.deliverBooster(user, def, rand)` et `shop.settleCollection(userId, cardIds)` — la part **livraison** de la boutique, sans la caisse. ⚠️ Le débit de `buyBooster` a migré **après** la livraison : c'est ce qui garantit structurellement qu'un pool vide ne fait payer personne. ⚠️ Les refus **commerciaux** (`isStarter`, `booster_enabled: false`) restent dans `buyBooster` et ne sont pas rejoués par un cadeau — un cadeau n'est pas une vente.
- `settleCollection` est aussi appelée par un lot `card` : ce sont des conséquences de la **possession**, pas de l'achat.

---

## Mode Arcade (`arcade.js`)

Une run par jour, **4 duels solo enchaînés** contre des decks publics de difficulté croissante. Table `user_arcade_state`.

| Duel | Difficulté du deck | Handicap IA |
|---|---|---|
| 1 | 1 — Initiation | +0 PV / +0 ATK |
| 2 | 2 — Confirmé | +10 PV / +2 ATK |
| 3 | 3 — Vétéran | +30 PV / +3 ATK |
| 4 | 4 — Élite | +50 PV / +5 ATK |

Gain de fin de parcours : **200 golds + 50 XP**, une seule fois au 4ᵉ duel gagné. Une défaite **clôt la run**. Croissance stricte des trois axes verrouillée par golden test.

1. **Une run par jour** : `start` refuse dès qu'une run porte la date courante, **quel que soit son état**. Lire ne consomme rien.
2. **La run est serveur, donc reprenable** (contrairement au Tournoi, dont le bracket vit en mémoire et se perd au F5).
3. **Le client nomme, le serveur chiffre** : il rapporte `win`/`loss` sur un **index** de duel.

- Le blob de run porte la **composition** du deck adverse, pas seulement son id (un deck retouché en admin ne doit pas casser la reprise). Le deck du joueur est figé au lancement (`run.deck_name`) ; son *contenu* ne l'est pas.
- **Difficulté des decks publics** : champ `difficulty` (1–4), **absente lue comme 1**. Repli : un niveau vide se rabat sur le plus proche non vide (égalité → le plus haut), puis sur tout le pool. **L'échelon garde son handicap** — c'est le duel qui durcit, pas le deck.
- Un deck public de **moins de 20 cartes** n'est jamais proposé (même seuil que le DeckSelector).
- **Écarts assumés** : `ai_win` reste crédité à chaque duel (run parfaite = 90 XP) ; **pas de gemmes** ; fermer l'onglet en plein duel laisse ce duel rejouable (le prix de la reprise) ; une **égalité** n'est pas rapportée, le duel se rejoue.

### Le handicap IA — un primitif de `logic/`, pas une notion « arcade »

`GameSessionDeps.enemyBonus` (`{ atk, hp }`, 6ᵉ paramètre de `buildSession`) : `logic/` ne sait pas que l'Arcade s'en sert. Appliqué dans **`GameSession._placeEnemyUnits()`**, seul entonnoir des unités créées par l'IA.

- Le bonus s'écrit dans **`unit._base`**, jamais dans `_stat_bonuses` (balayé par `resetCombatStats()`).
- Idempotence par marqueur `unit._enemy_bonus_applied`. ⚠️ Ne **pas** passer par `_shopping_bonus`, que `InvocationManager._transferShoppingBonuses` **somme** sur le composite.
- Appliqué **après** `rearrangeUnits()`, qui trie par PV.
- Absent partout ailleurs (`null`) : solo, tournoi, tutoriel et PvP sont inchangés. Réutilisé par la simulation d'équilibrage (`ENEMY_HANDICAP`).

---

## Adversaires artificiels (`bots.js`, `ws/BotMatch.js`)

Ce que le lobby sert quand la file ne trouve personne. Catalogue `initial-data/bot_decks.json`.

| Règle | Valeur |
|---|---|
| Délai avant repli | **tiré entre 10 s et 20 s** (`BOT_DELAY_MIN_MS`/`MAX_MS`) — une échéance fixe serait un tell |
| Priorité | un **vrai joueur arrivé avant l'échéance l'emporte toujours** |
| Deck | l'un des 10 de `bot_decks.json`, tiré au hasard |
| Gain | **`pvp_win` (70 XP)**, décerné par le serveur |

⚠️ **Le joueur n'apprend jamais que son adversaire en est un.** Rien dans `GameScreenPvp` ni dans la présentation du lobby ne doit prendre de branche visible sur `bot` : même écran, même HUD, même chrono, même écran de résultat — il n'y a qu'un **contrôleur** de différence.

**Le bot est joué par le CLIENT**, pas par le serveur : le PvP est un relais opaque, faire jouer un bot au serveur exigerait de porter tout `logic/` côté Node. La partie est donc **un solo** (`buildSession(deckName, 'ai', pseudo, botDeck)`), avec l'`EnemyAI` habituelle.

| | Duel réel | Duel bot |
|---|---|---|
| Contrôleur | `PvpController` | **`BotController`** |
| Session | `mode: 'pvp'`, board adverse reconstruit du réseau | `mode: 'ai'`, deck adverse annoncé par le serveur |
| Serveur | `ws/MatchRelay.js` | **`ws/BotMatch.js`** (identité + horloge + caisse) |
| Table `matches` | ligne insérée | **aucune** |

- **`match:found` porte un champ `bot`** (le deck) — c'est la seule chose qui distingue les deux messages. `PvpConnection.getBotMatch()` le rend.
- ⚠️ Corollaire heureux : le deck du bot voyageant en clair, la session `mode: 'ai'` le reçoit comme `enemyDeck` — le **terrain** se choisit donc sur les deux vrais decks, sans une ligne dans `BotController`.
- ⚠️ Un match bot n'est **pas** écrit dans `matches` : la table sert à retrouver le match **actif** d'un joueur qui recharge, or un match bot n'est pas reprenable. Fermer l'onglet efface le match, sans gain ni défaite.
- **Latence de « PRÊT »** (`READY_MIN_MS` 3 s → `READY_MAX_MS` 22 s), comptée **depuis le début de la préparation** et non depuis le tap du joueur : celui qui prend son temps ne l'attend jamais. Le plafond reste bien sous `PREP_DURATION_S` (60 s).
- **La caisse** : le résultat est rapporté par le client, mais il ne nomme **jamais** un montant. Deux plafonds larges à dessein : durée plancher **60 s** (`MIN_MATCH_MS`) et **20 victoires/heure** (`MAX_REWARDS_PER_WINDOW`). Un match refusé est quand même **soldé** — c'est le gain qu'on retire, pas la partie.

**La socket d'un duel bot est MUETTE** (rien entre `match:found` et le rapport final) — exactement ce qu'un NAT recycle, d'où trois garde-fous :
- **Battement de cœur client → serveur** (`PvpConnection.KEEPALIVE_MS`, 25 s). ⚠️ Pas redondant avec le `ping` de `pvpServer` (30 s), qui ne produit que du trafic **descendant**. Le serveur reconnaît le type `ping` **avant** le `default` qui relaie.
- ⚠️ **`_socket_closed` ne se met jamais en tampon** (`PvpConnection.TRANSIENT`), et `connect()` **vide le tampon**. Le tampon existe pour une course réseau de round ; appliqué à un événement de cycle de vie, il rejouait la coupure d'une socket morte au `begin()` du duel suivant. Chaque handler porte en plus une garde de génération (`ws === sock`).
- **`PvpConnection.send` rend un booléen**, et `BotController` s'en sert : sur une socket morte on se rabat sur le résultat local (`_resolveLocally`), avec un plafond `MATCH_END_TIMEOUT_MS` (10 s). ⚠️ **Aucun gain n'est appliqué**, et on le **dit** (prop `note` de `GameOverScreen`).

⚠️ **`PvpController` (duel réel) n'a PAS de repli équivalent**, et c'est délibéré : sans réseau, un vrai duel n'a plus d'adversaire à qui opposer sa simulation, et le serveur donne la victoire à celui qui reste. Se solder localement y inventerait un résultat.

**Les decks** (`scripts/build-bot-decks.js`) : 10 decks, un par archétype, 24–26 cartes, avec un profil de jeu (aggro/tank/distance/pouvoirs/essaim).

```
node scripts/build-bot-decks.js [--write|--check]
```

- ⚠️ **Le catalogue est du CODE, pas de la donnée** : lu depuis `initial-data/`, sans copie sur le volume ni CRUD d'admin. On le **regénère**.
- **La contrainte qui commande le générateur** : au-delà du tier 2, le catalogue n'a presque aucune invocation *normale*. Les hauts tiers ne sont retenus que si le deck **couvre déjà** leurs matériaux (ids *et* attributs), la couverture s'accumulant tier par tier. Même règle que `game/tutorialDeck.ts` et `sim/decks.ts`.
- Plancher de puissance par haut tier (p25) ; Dieux Égyptiens (`ARCH_031`) exclus ; hors-thème en dernier recours ; les decks se construisent à la suite et s'évitent.
- ⚠️ **Le pseudo est découplé du deck** et tiré à chaque match (les apparier serait le tell le plus facile). L'**avatar** vient des cartes du deck, et n'est retenu que si son PNG existe.
---

# Le jeu

## Boucle de partie

**5 tours. PV des joueurs : 1000.** Chaque tour :

1. **Préparation** (`PREP_DURATION = 60` s — placement, chrono tenu par l'écran React, lance le combat à 0)
2. **Combat** (auto-résolu, animé, coupé à 60 s de temps réel)
3. **Fin de combat** (dégâts aux PV, nettoyage)
4. **Phase Shopping** (sauf dernier tour) — une magie parmi 3 (+ `shopping_bonus`), 45 s en PvP
5. Tour suivant

Fin de partie : tour 5 terminé, un joueur à 0 PV, ou abandon par le menu.

**Menu d'options** (`components/hud/GameMenu.tsx`, ouvert par ☰ de `PhaseControls`) : `menuOpen` du store est la source de vérité. En solo, l'ouvrir gèle le chrono de préparation ; **en PvP le chrono continue** — l'adversaire attend à la barrière réseau et ne doit pas pouvoir être bloqué. En PvP, « quitter » = `PvpController.forfeit()`.

### Ouverture d'un tour (`components/overlays/RoundStart.tsx`)

Deux beats avant que le joueur ne reprenne la main : l'annonce du changement de tour (`ROUND_INTRO_MS` 1,4 s) puis la **popup de pioche**, congédiée d'un tap sur le dos de carte.

- ⚠️ **La popup RÉVÈLE, elle ne PIOCHE pas** : le tirage a déjà eu lieu quand elle s'affiche. Le différer jusqu'au tap décalerait le flux semé de `sim/` et du filet de déterminisme PvP, et déplacerait le point de capture de « Tout annuler ». **Le tap ne consomme aucun hasard** (verrouillé par golden test).
- **Un seul minuteur, et il vit dans `GameController`** (`_openRound` / `_introTimer` / `_pendingDraw`) — même règle que `TERRAIN_ALERT_MS`. Le tap sur l'annonce et l'horloge ouvrent la **même** popup, une fois ; `dispose()` annule les deux.
- ⚠️ Ouvert aux **deux** entrées de tour — `begin()` et `_proceedNextRound()` — sinon un round sur cinq n'aurait pas sa popup. `_closeRoundOpening()` est appelé par les deux `startCombat` : sans lui l'overlay reste posé sur tout le combat quand le chrono tombe à 0 par-dessous.
- **Chronos** : en solo la popup **gèle** la préparation (`roundIntro`/`drawPopup` dans le prédicat du `PhaseTimer`, modèle `menuOpen`) ; **en PvP il continue**, et la popup se congédie seule (`DRAW_POPUP_AUTO_MS` 8 s). Rien n'y prend de branche sur `bot`.
- Le tutoriel s'efface derrière elle : `gameCoachStep` rend `null` sur `roundOpening`, en **règle globale** (la popup revient à chaque tour, pas seulement au premier).
- ⚠️ `prefers-reduced-motion` : la popup reste et **le tap reste requis** — c'est le vol des dos qu'on retire, pas l'information.
- ⚠️ **`HandBar` se masque tant que `roundIntro`/`drawPopup` sont posés** : `session.hand` porte déjà les cartes du tour dès `startPreparation()`, et la bande les affichait en clair sous la popup avant le tap — le spoil que la popup existe pour éviter. Elle réapparaît au même instant que le tap ferme la popup.

### « Tout annuler » — le point de retour d'un tour

Bouton **↺** de `PhaseControls`. Tout est dans `GameSession.undoPreparation()` ; le contrôleur ne fait qu'appeler.

- **Le point de capture est la dernière instruction de `startPreparation()`**, pas le début du round : la Phase Shopping a lieu **avant**, donc une magie choisie au shopping n'est **jamais** annulable.
- Seules deux choses mutent l'état joueur en préparation : l'invocation (`place` → `InvocationManager.summon`) et le déplacement (`reposition` / `board.moveUnit`).
- ⚠️ **Rien n'est cloné**, et c'est ce qui rend la restauration exacte : `summon()` ne mute jamais les unités qu'elle consomme, donc garder les **références** rend `_base`, `_shopping_bonus`, `veterancy_points`, `current_hp`, `shield` et l'`uid` intacts. Un clone ferait payer au joueur ce qu'il avait acquis. Seules les **positions** sont copiées.
- Garder l'`uid` rend le rendu gratuit : `Scene3D.refresh()` est un diff indexé par uid.
- ⚠️ **On vide TOUTES les cases joueur avant d'en reposer une seule** : `placeUnit` jette sur case occupée.
- **La disponibilité se calcule structurellement** (`canUndoPreparation`, comparaison à l'état capturé), jamais par un drapeau posé par les mutateurs — le déplacement tap-tap passe par `board.moveUnit` sans traverser `GameSession`. Le bouton est **masqué** tant que c'est faux.
- **`GameSession.prepId`** (incrémenté à chaque `startPreparation()`) est le repère qui permet à la couche app de savoir si un état mémorisé parle encore du tour à l'écran — sans avoir à être *prévenue* du passage au tour suivant. Deux usages, tous deux dans `GameController` :
  - ⚠️ **Verrou d'engagement (`_committedPrepId`)**, posé **au tap** sur PRÊT : la phase reste `PREPARATION` pendant la poignée de main PvP et pendant la latence du bot, la barre est encore à l'écran sous l'overlay. Sans lui, ↺ reviendrait sur un board déjà annoncé à l'adversaire.
  - ⚠️ **Rollback des missions (`_eventMark` / `_markPrepId`)** : `_tryPlace` mémorise la longueur de la file avant la **première** invocation du tour, l'annulation y revient. Sans le test sur `prepId`, annuler un tour où l'on n'a fait que **déplacer** rejouerait une marque périmée.
- **Rien côté réseau** : l'annulation est purement locale et précède toujours l'envoi.

## Pioche (`Draw.drawHand`)

5 cartes au début de chaque tour. Pool par tour :

| Tour | Tiers |
|---|---|
| 1 | 1 |
| 2 | 1, 2 |
| 3 | 1, 2, 3 |
| 4 | 2, 3, 4 |
| 5+ | 3, 4, 5 |

La main est **conservée entre les tours** (taille illimitée) ; les cartes non jouées s'accumulent, sans effet sur le pool de tiers.

**Règle du doublon** (`InvocationManager._canSummonWith`, **côté joueur uniquement**) : jamais deux exemplaires vivants de la même `card_id` sur le board joueur. La règle vaut pour **toutes** les cartes, sans exception de coût : un doublon vivant refuse l'invocation **sauf s'il figure lui-même parmi les matériaux consommés**.
- ⚠️ Elle ne se branche nulle part sur « invocation normale » : une carte **sans condition** n'a aucun matériau à sélectionner, donc le doublon ne peut jamais y figurer, donc elle est refusée. Il n'y a rien d'écrit pour ce cas.
- ⚠️ C'est cet invariant qui autorise l'identité `(camp, card_id)` du log PvP et de `refUnit` : **le relâcher casse les deux**.

**Pioches garanties** (`gameState.player_guaranteed_draws`, alimenté par les effets d'attribut `guaranteed_draw` et les magies du même nom) :
- Elles **occupent un slot de la main normale** : `randomCount = 5 + extra_draws − guaranteed_draws.length`.
- Elles **ignorent la restriction de tier du tour** : recherche dans tout le deck, filtrée par `tier`/`attribute` selon les champs présents ; **repli progressif** (sans le tier, puis n'importe quelle carte).

**Résumé de pioche** — `startPreparation()` rend un `DrawSummary` (tour, tiers, `baseCount`, `extraDraws`, garanties, `drawnCount`, `sources`), affiché par la popup de pioche. `startNextRound()` le relaie, ou `null` sur une fin de partie.

- ⚠️ **`drawnCount` est MESURÉ** (`hand.length` après − avant), jamais recalculé : les garanties ont un double repli et un pool vide ne rend rien — une soustraction annoncerait des cartes que la main n'a pas. Même discipline que le décompte de `TerrainAlert`.
- **Provenance des bonus** : `gameState.player_draw_sources` (`{ kind, ref, value, guaranteed? }`) raconte le même octroi que `player_extra_draws`. Trois émetteurs, un par source : `MagieEffect` (`draw_bonus`/`guaranteed_draw`), `AttributeManager.applyEndOfCombat` (via `draw_sources`, plafond `max` **déjà appliqué**) et `BoardEffect` (`applyBoardEffects` pose le `sourceId`).
- ⚠️ **INVARIANT : `sum(sources.value) === extraDraws`**, et le registre se **vide avec** le compteur (`draw-summary.test.ts`). Un quatrième émetteur qui oublierait son inscription ferait annoncer un « +2 » venu de nulle part.
- ⚠️ Le registre ne porte que des **ids** — `logic/` n'importe pas `data/`. `data/DrawInfo.ts` (pur) met la pioche en mots, `RoundStart.tsx` résout les noms.

**Affichage** (`GameController._groupHand`) : `session.hand` reste une liste plate (l'ordre de pioche fait foi côté logique) ; l'instantané React regroupe les exemplaires identiques (badge ×N, `HandEntry.count`) et trie par tier puis nom. **`HandEntry.idx` pointe l'exemplaire représentatif** — c'est lui qui quitte la main à l'invocation. ⚠️ La signature de regroupement **inclut le coût** : une carte remisée par une magie de main ne fusionne pas avec un exemplaire normal.

## Multiplicateur de dégâts

Calculé au lancement du combat, **indépendamment pour chaque côté** :

| Unités sur le terrain | Multiplicateur |
|---|---|
| ≥ 5 | 1.0 |
| 4 | 1.2 |
| 3 | 1.5 |
| 2 | 2.0 |
| 0–1 | 3.0 |

```js
multiplicateur_final = multiplier(unitCount) × round      // tour 1 = ×1 … tour 5 = ×5
```

`gameState.startCombat(playerUnitCount, enemyUnitCount)` calcule `player_multiplier` / `enemy_multiplier` ; `player_unit_multiplier` garde la composante « nombre d'unités » seule, pour l'affichage du détail. L'effet d'attribut `end_of_combat` `damage_multiplier_bonus` s'y **ajoute** (côté joueur).

## Board (`logic/Board.ts`)

**5 colonnes × 11 rangées.** Joueur 0–3 · zone neutre 4–6 (inoccupable en préparation) · ennemi 7–10. Maximum **5** unités (6 avec certaines synergies). Stockage **col-major** : `grid[col][row]`.

⚠️ **`Board.ts` est la source de vérité.** Ne jamais déduire une position depuis un élément DOM. Lors d'un déplacement, dans cet ordre : `board.grid` → `unit.position` → animation. `board.moveUnit(unit, to)` fait les deux premiers ensemble.

Pendant la préparation le joueur ne voit que son côté (ennemis masqués) ; pendant le combat, tout le board.

**Cases bloquées** — deux collections, clés `"col,row"` :
- `_blockedCells` (`Set`) — blocages **permanents** du terrain, posés au lancement du combat
- `_temporaryBlockedCells` (`Map` → step d'expiration) — `POWER_FREEZE`

```js
board.setBlockedCells(cells)                  // réinitialise AUSSI les temporaires
board.clearBlockedCells() / isBlocked(pos)    // isBlocked : l'une OU l'autre
board.setTemporaryBlock(pos, expiresAtStep)   // un seul bloc de glace : le nouveau remplace l'ancien
board.purgeExpiredTemporaryBlocks(step)       // début de chaque step
board.blockedCells()                          // ⚠️ la SEULE lecture juste pour le rendu et le log
```

`getNeighbors(pos)` exclut automatiquement les deux sortes — le BFS les contourne sans modification. Tout est réinitialisé en préparation.

⚠️ **Ne jamais relire `boardData.blocked_cells`** pour le rendu, le décor ou un log : depuis que le rôle B applique le terrain miroité, la définition et le plateau réellement joué diffèrent. `Board.blockedCells()` est la seule lecture qui ne peut pas se désaligner.

## Terrains de combat

```json
{
  "id": "BOARD_001", "name": "Désert Maudit",
  "blocked_cells": [{ "col": 2, "row": 5 }],
  "effects": [
    { "type": "stat_bonus", "stat": "atk", "value": 10,
      "target_attributes": ["ARCH_DRAGON"] },
    { "type": "shield", "value": 20 }
  ]
}
```

Actif **pendant le combat uniquement** (en préparation le terrain n'est pas encore tiré et le cadrage ne montre que les rangées 0–3).

| `type` | Effet |
|---|---|
| `stat_bonus` | Bonus additif (`stat`, `value`) |
| `stat_modifier` | Multiplicateur — converti en additif via `_base[stat] × (value − 1)` |
| `shield` | Bouclier initial |
| `draw_bonus` | Pioche supplémentaire — **joueur uniquement, sans ciblage** |

- ⚠️ **`BoardEffect.boardEffects(board)` est le SEUL lecteur de la donnée**, et il lit **deux formes** : `effects` (la liste) l'emporte dès qu'elle porte quelque chose, `effect` (l'effet unique historique) sert de repli. Les 14 terrains livrés sont encore en `effect` — le repli est ce qui dispense de migration. L'admin écrit `effects`. Tout écran qui lirait `board.effect` afficherait « Aucun effet » sur un terrain migré.
- ⚠️ **Le cumul est ADDITIF et l'ordre de la liste n'y change rien** : tous les effets écrivent dans `_stat_bonuses` (ou le bouclier), jamais dans `_base` que `stat_modifier` relit. Deux « ×2 PV » donnent **×3**, pas ×4.
- ⚠️ **Il n'y a plus qu'UN ciblage, `target_attributes`** : les cinq voies d'invocation sont devenues des attributs de carte (`ARCH_086`…`ARCH_090`), donc `BoardEffect.effectTargets` est le seul filtre, et une carte à plusieurs conditions les porte **toutes**.
- Les trois premiers types **visent des unités** (`BoardInfo.boardTargetsUnits`) et lisent le ciblage ; `draw_bonus` n'en lit aucun — ni l'admin, ni l'annonce, ni l'infobulle ne lui en proposent.
- Effets appliqués via `applyStatBonus()` / `applyShield()`, donc nettoyés par `resetCombatStats()`.
- Éditeur d'effets **répétable** en admin. ⚠️ `_syncBoardDraft()` recopie la saisie avant chaque re-render, **cases bloquées comprises** (`renderBoardDetail` reconstruit `_boardBlockedSet` depuis `selectedBoard.blocked_cells`, donc ajouter un effet effacerait les cases qu'on vient de poser).

### Le tirage du terrain (`logic/BoardPicker.pickBoard`)

Deux règles, de poids inégal :

| Règle | Nature |
|---|---|
| Le terrain doit **affecter au moins un des deux camps** (pertinence) | **préférence** |
| Un terrain **ne revient jamais deux fois** dans un duel | **règle absolue** |

**Pertinent** = le terrain porte un `target_attributes` qu'au moins **2 cartes** de l'un des deux decks portent (`MIN_ATTRIBUTE_OCCURRENCES`, dans `BoardPicker`, **importé** par `data/DeckTags.ts` — même question posée pour deux usages).

**Échelle de repli** : ① pertinent **et** pas encore joué → ② pas encore joué → ③ tout le pool.

- ⚠️ **La non-répétition l'emporte sur la pertinence** : revoir un terrain déjà joué se remarque à tous les coups ; jouer un terrain qui ne touche personne ne se remarque pas. 14 terrains pour 5 combats — l'échelon ③ n'existe que pour un catalogue amputé.
- ⚠️ **La pertinence se juge sur les DECKS, pas sur les unités posées** : au moment où le rôle A choisit, il n'a pas encore reçu le board adverse. Le deck est la seule chose connue des deux côtés, et c'est ce qui permet au solo, au bot et au PvP d'appliquer **littéralement la même règle**. Prix assumé : un terrain pertinent peut tomber sur un tour où aucune carte porteuse n'a été piochée.
- ⚠️ **La pertinence est une PRÉFÉRENCE, pas une table fermée** (contrairement à `MagieOffer`) : un oubli de règle ne peut que rendre un terrain **moins probable**, jamais invisible. Verdict : aucun effet → non pertinent ; `target_attributes` vide/absent sur **un** effet → toujours pertinent ; sinon **un** effet au moins dont le ciblage croise les deux decks.
- ⚠️ **Exactement UN appel à `rand` par tirage, et AUCUN sur un pool vide** — c'est ce qui garde le flux semé de la simulation en phase.
- ⚠️ **C'est `startCombat` qui marque le terrain comme joué, jamais `pickCombatBoard`** : on marque celui qui est **joué**. Une seule ligne tient donc l'historique dans tous les modes, y compris quand le terrain arrive de l'extérieur (`agreedBoard`).
- **Portée de l'historique : le DUEL.** Il vit dans la `GameSession` — rien à réinitialiser. Une run d'Arcade enchaîne 4 sessions, donc 4 historiques.
- **PvP** : seul le rôle **A** tire (`session.pickCombatBoard()`, qui ne consomme rien), diffuse l'`id`, et les deux clients rejouent l'id renvoyé par `round:go`. ⚠️ `deps.enemyDeck` est **inutilisable** en PvP (`buildSession` y retombe sur le deck du joueur) : les attributs adverses viennent du **serveur** via `setEnemyDeckAttributeCounts`. Sans ça le rôle A compterait **deux fois son propre deck** — erreur parfaitement silencieuse, puisqu'elle rend quand même un terrain pertinent pour quelqu'un.
- **Duels contre bot, solo, arcade, tournoi, tutoriel : rien à brancher** — tous passent par `buildSession`, dont la dérivation est déjà juste.
- ⚠️ **La symétrie des terrains est une question d'ÉQUITÉ, pas de déterminisme** : 7 des 14 terrains livrés donnent un couvert à un camp que l'autre n'a pas. `BoardMirror.isMirrorSymmetric` existe pour le signaler ; rien ne s'en sert.

### L'annonce du terrain

`TerrainAlert` (`components/overlays/Overlays.tsx`) pendant `TERRAIN_ALERT_MS` (2,5 s) : illustration **carrée** (`/illustrations/<id>`, jamais le fond 5:11), nom, effets, cibles, et **combien d'unités de chaque camp** sont touchées.

- ⚠️ **Le combat attend l'annonce, et il n'y a QU'UN minuteur** : `_beginCombatAnimation` allonge le délai existant de la cascade d'arrivée de l'IA à `max(revealMs, TERRAIN_ALERT_MS)`. Deux horloges pour un même départ finiraient par ne plus s'accorder.
- ⚠️ Le tap qui passe l'annonce **réarme pour le reliquat** (`_combatStartAt`) : sinon un tap à 0,3 s lancerait le premier coup pendant que l'adversaire est encore en l'air.
- ⚠️ **`_pendingCombatStart` est un champ, pas une closure** : le tap et le minuteur doivent déclencher le **même** départ, une seule fois. `dispose()` l'annule *et* vide le minuteur.
- ⚠️ **Le décompte ne peut pas contredire l'effet** : `BoardEffect.effectTargets` est extrait d'`applyEffect`, qui l'appelle, et `terrainAlertFor` compte avec **la même fonction**. Le décompte est l'**union** des unités touchées, jamais la somme.
- Un terrain qui ne touche personne le **dit**. `draw_bonus` n'affiche aucun décompte (`boosted: null`).
- Pas de `Modal` (elle poserait un voile sur ce qu'on annonce) : couche transparente **`z-40`** — pas plus, `TutorialCoach` est en `z-50`. Contrepartie : pendant 2,5 s la barre de combat n'est pas tapable.
- ⚠️ En `prefers-reduced-motion: reduce` l'annonce **reste et le combat attend toujours** : c'est le mouvement qu'on retire, pas l'information.

### Rendu du terrain

`GameSession.startCombat` pose les cases sur le `Board` ; `GameController` les transmet à la scène (`Scene3D.setBlockedCells`) et les efface en fin de combat. Le **fond de grille** suit le même trajet (`Scene3D.setTerrainBackground(boardData)` / `(null)`).

- `Scene3D` construit l'URL `/board-backgrounds/<id>` lui-même (`three/` n'importe pas `data/`).
- Plan `PlaneGeometry(5, 11)` en `MeshBasicMaterial` (*Basic* pour que l'éclairage n'assombrisse pas l'illustration), à `y = -0.08`. Hors ratio → **rogné au centre**, jamais déformé (`coverFitTexture`).
- Les 55 tuiles passent en **voile translucide** (`TERRAIN_TILE_OPACITY`), le **même** pour les trois zones (les différencier créerait une couture en travers de l'image) ; c'est le contraste tuile/interstice qui redessine la grille.
- ⚠️ **Le chargement est asynchrone et annulable** (`_terrainToken`) : une texture qui arrive après la fin du combat ne doit pas se rattacher à une scène morte. Un 404 ne fait rien.
- **Case bloquée = un creux avec des éclats de roche** (`spawnBlockedDecor`), pas une case rouge (le rouge est déjà pris par la zone ennemie et les dégâts). ⚠️ La dalle reste **opaque** sous un fond (`BLOCKED_LEDGE_OPACITY`) — c'est ce qui fait le trou ; et c'est la **roche claire** qui porte la lecture (la zone neutre est déjà quasi noire). Dalle **sans emissive** : la lueur est le registre du retour à un geste, pas du décor. Décor **semé par `(col, row)`** (`cellRandom`) — deux combats sur le même terrain montrent les mêmes rochers.
- ⚠️ La case **gelée** garde ses cristaux cyan et son test passe **après** celui des cases bloquées dans `_updateTileColor`.

## Invocation (`InvocationManager`)

Une carte porte **zéro, une ou plusieurs CONDITIONS** (`summon_conditions`) ; elle est jouable dès qu'**une** est satisfaite. Une condition réclame un nombre de slots de matériau (`materials`, compté en `material_value`) dont une partie peut être **nommée** (`requires` : ids de carte ou d'attribut, `requires.length <= materials`). Aucune condition = placement direct. Une invocation peut être immédiatement suivie d'une autre (**chaînage**).

⚠️ **Il n'y a plus de « voie » d'invocation.** Les cinq notions historiques (normale, sacrifice, fusion, héritage, transformation) sont devenues des **attributs de carte** (`ARCH_086`…`ARCH_090`), purement descriptifs ; le moteur ne connaît qu'un coût. Chacune des cinq branches de l'ancien `switch` était un cas particulier de l'une des règles ci-dessous.

```js
canSummon(card, pos, board, hand, graveyard, selectedMaterials, conditionIndex)
  → { ok, reason }                          // + { options: [...] } si la carte a plusieurs conditions
summon(card, pos, board, hand, materials, handIdx, conditionIndex) → Unit
summonConditions / conditionAt / conditionMaterials / conditionRequires / conditionIsFree
summonCost(card) / hasMultipleConditions(card) / autoSelectMaterials(card, condition, board, graveyard)
forcedCell(condition, materials, board) / exceedsBoardSlots(...)
matchesMaterial / materialLineageLegit / materialLineageMatches / sumMaterialValue
materialValueOf(card) / isAttributeMaterial(matId)
```

**Les cinq règles de `_canSummonWith`**, et rien d'autre :

1. **Où l'unité se pose.** Une condition à **UN matériel** impose la case de ce matériel ; sinon la case doit être libre, ou occupée par un matériau consommé (il part avant la pose).
2. **Le doublon** — cf. la règle du doublon, plus haut.
3. **Quantité** — `sum(material_value)` des unités disponibles (terrain **et** cimetière) ≥ `materials`.
4. **Exigences nommées** — appariées à des unités **distinctes** (glouton), chacune une doublure légitime (lignée).
5. **Slots** — `vivants − matériaux_du_board + 1 ≤ plafond`.

- ⚠️ **`summonCost(card)` est le SEUL endroit qui répond à « quel genre d'invocation est-ce »** (le minimum de `materials` sur ses conditions). Il y en avait trois : la table de priorité de l'IA, celle de l'auto-joueur, et l'agrégat par voie du rapport d'équilibrage.
- ⚠️ **`forcedCell` est le SEUL endroit qui répond à « où l'unité se pose »**, et ses trois appelants — la validation, la pose, l'IA — ne peuvent donc pas se contredire. C'est l'ancienne Transformation, énoncée sur le **coût** : à un matériel, le résultat prend la place de sa cible, d'où qu'elle vienne. La case retenue est celle que le matériel **occupe encore** (`board.getUnit(pos) === u`) : une unité retirée du board garde une `position` périmée, que quelqu'un d'autre occupe peut-être.
- ⚠️ **Les matériaux partent AVANT la pose**, cimetière compris (un corps neutralisé occupe encore une case). C'est ce qui rend les règles 1 et 5 vraies sans une ligne pour les dire.
- ⚠️ **Le cimetière ne libère aucun SLOT** (il n'en occupe pas) mais libère bien une **case**. La Transformation échappait au plafond par exception ; la règle unifiée ne regarde que ce qui est libéré, donc une condition payée au seul cimetière est refusée sur un board plein.

`InvocationRules` (pur, sans mutation) alimente l'UI : `isPlayable`, `needsMaterials`, `materialsComplete`, `forcedMaterials`, `validCells`, `materialCandidateCells`, `materialCandidateGraveyard`, `summonConditionsStatus`, `getUncoveredRequirements`, `hasEmptyPlayerCell`. `GameSession` les ré-expose en injectant board/main/cimetière/slots.

**Conditions multiples** — tous les points d'entrée acceptent un `conditionIndex` ; `null` = la première (`summon`) ou l'évaluation de **toutes** (`canSummon`). `isPlayable` est vrai dès qu'**une** condition l'est. L'IA les essaie de la **moins chère à la plus chère** — c'était « la transformation d'abord », qui disait la même chose.

**Unités composites** — deux propriétés lues par `matchesMaterial` / `canSummon` :
- **`represented_ids`** — les ids que l'unité « représente », **pré-déterminés sur la carte** (section « Lignée » de l'admin), jamais calculés à l'invocation. ⚠️ `Unit` y ajoute toujours son propre `card.id` : la donnée ne porte que la lignée **héritée**. Affiché au tooltip (🧬).
  - **Légitimité** (`materialLineageLegit`) : toute la lignée héritée d'un matériel doit être **elle-même exigée** par la condition en cours. « Aile de feu » (Avian + Burstinatrix) ne remplace pas Avian seul, mais comble à elle seule les deux exigences d'une condition qui demande les deux.
- **`material_value`** — le nombre de slots que l'unité représente si elle est consommée. ⚠️ C'est une **donnée de carte**, saisie en admin, lue par le constructeur d'`Unit` pour les **deux camps** : elle était dérivée en quatre exemplaires dans le `switch`, si bien que l'IA et le joueur n'avaient pas la même règle.

Un matériel `ARCH_*` désigne **n'importe quelle** unité portant l'attribut, pas une carte (`isAttributeMaterial`).

## Modèle d'unité (`logic/Unit.ts`)

```js
uid                    // identifiant d'instance, unique par partie
material_value         // slots représentés si l'unité est consommée — DONNÉE de carte, jamais dérivée

_base                  // stats de base gelées — SEUL endroit modifié en PERMANENT (magies, handicap IA)
_stat_bonuses          // bonus plats du combat en cours (attributs, terrain, vétérance)
_shopping_bonus        // delta permanent cumulé des magies — transféré aux invocations composites
atk / max_hp / current_hp / movement_speed / attack_speed / initiative / range
shield / power_gauge
power_id / power_speed / power_value            // réécrits durablement par grant_power et power_cooldown

dot_effects            // poison — pulse sur un timer global
burn_stacks            // brûlure — pulse sur les attaques de l'unité elle-même
paralysis_remaining / attack_speed_modifier
is_power_blocked / power_block_remaining
confusion_remaining    // > 0 → cible ses propres alliés
taunt_remaining        // > 0 → force les ennemis à la cibler
is_effect_immune       // attribut effect_immunity

position / initial_position / is_neutralized / veterancy_points
attack_timer / move_timer                        // ⚠️ remis à zéro à chaque startCombat
```

Les unités persistent entre les tours. Détruites → retirées définitivement. Survivantes → retour à `initial_position`.

**Traçage des bonus permanents** : `stat_bonus` / `stat_modifier` écrivent dans `_base` **et** cumulent le delta réel dans `_shopping_bonus[stat]`. `InvocationManager._transferShoppingBonuses` reporte sur le composite quand l'unité est consommée ou remplacée : deltas de stats **sommés** sur tous les matériaux, bouclier restant **sommé**, points de vétérance en **maximum** (jamais la somme — enchaîner les invocations ne permet pas de farmer la vétérance).

**Vétérance** : +1 point par combat survécu (`finishCombat`, les deux camps). À partir de `VETERANCY_THRESHOLD = 2`, bonus appliqué par `AttributeManager._applyVeterancyBonuses()` au `start_of_combat` :

```js
atk += veterancy_points × 2      // VETERANCY_ATK_PER_POINT
hp  += veterancy_points × 15     // VETERANCY_HP_PER_POINT
```

Comme c'est un bonus de combat, il est nettoyé par `resetCombatStats()` et recalculé, et restauré par `reapplyBonuses()` après un `POWER_DEBUFF`. Les points sont perdus si l'unité est neutralisée sans être consommée.

## Cimetière et fin de combat

Les unités neutralisées entrent dans `graveyard[]` / `enemyGraveyard[]`.

- Elles **restent sur le board** après le combat et toute la phase de préparation suivante, disponibles comme **matériaux d'invocation**.
- Elles sont **définitivement retirées au lancement du combat suivant** si non consommées.
- Une unité venant du cimetière **ne consomme pas de slot de board** lors d'une transformation.

**Dégâts** (`GameState.applyEndOfCombat(winner, playerSurvivorsAtk, enemySurvivorsAtk, attributeResult)`) — reçoit une **somme d'ATK**, pas un nombre d'unités :

```js
// l'ennemi encaisse si winner ∈ { 'player', 'draw', 'timeout' }
enemy_hp  -= round(sum(survivingPlayerUnits.atk) × (player_multiplier + damage_multiplier_bonus))
// le joueur encaisse si winner ∈ { 'enemy', 'draw', 'timeout' }
player_hp -= round(sum(survivingEnemyUnits.atk) × enemy_multiplier)
// PV clampés à 0
```

⚠️ **`draw` et `timeout` font encaisser les DEUX camps.** Le `draw` (annihilation mutuelle) laisse en pratique deux sommes nulles ; le `timeout` fait mal aux deux — c'est ce qui dissuade les boards purement défensifs.

`attributeResult` (de `AttributeManager.applyEndOfCombat()`) apporte `damage_multiplier_bonus`, `draw_bonus`, `guaranteed_draws`, `board_slot_bonus`, `shopping_bonus`, `revived`.

⚠️ **Ne jamais modifier un tableau pendant son itération** : `for (const unit of [...units])`.

## Attributs (`AttributeManager`)

Un monstre peut porter plusieurs attributs. **Un seul palier est actif à la fois** (le plus élevé atteint).

| Effet | Timing | Détail |
|---|---|---|
| `stat_bonus` | `start_of_combat` | Bonus plat ; `value_per` optionnel (× nb d'unités **adverses** portant l'attribut). La stat `power_charge` accélère la jauge (`+1 + power_charge` par step) |
| `shield` | `start_of_combat` | `value` × nombre d'**alliés vivants** |
| `effect_immunity` | `start_of_combat` | Pose `is_effect_immune` — annule les pouvoirs de debuff |
| `stat_modifier` | `during_combat` | Déclenché par `trigger` : `on_ally_neutralized` / `on_enemy_neutralized` |
| `revive` | `end_of_combat` | Réanime une unité neutralisée à `hp_percent` % (déf. 50) |
| `draw_bonus` | `end_of_combat` | Pioches supplémentaires (plafonné par `max`) |
| `guaranteed_draw` | `end_of_combat` | Pousse `{ attribute }` dans `player_guaranteed_draws` |
| `board_slot_bonus` | `end_of_combat` | Via `grantLimitedBoardSlotBonus` — **cap +1 partagé avec les magies de slot** |
| `damage_multiplier_bonus` | `end_of_combat` | S'ajoute au `player_multiplier` **de ce round** |
| `shopping_bonus` | `end_of_combat` | Magies supplémentaires au Shopping suivant (plafonné par `max`) |

`timing: 'none'` = archétype purement descriptif.

Le manager est **reconstruit à chaque combat** (`new AttributeManager(attributeList, playerUnits, enemyUnits)` dans `startCombat`) :

```js
applyStartOfCombat()                       // stats, boucliers, immunités, vétérance + verrouillage des seuils during_combat
onUnitNeutralized(unit, pU, eU)            // appelé par CombatManager sur chaque mort → events stat_change
applyEndOfCombat(pNeutralized, eNeutralized)
getActiveSynergies(units)                  // → [{ attr, count, activeThreshold, nextThreshold }]
```

- **Comptage des liens** : seules les unités **distinctes par `card_id`** comptent — deux exemplaires de la même carte ne valent 1.
- Le décompte `end_of_combat` inclut les unités **neutralisées** (le palier tient même si les porteurs sont morts) ; les autres timings ne comptent que les vivantes.
- ⚠️ Les seuils `during_combat` sont **verrouillés au début du combat** : les morts en cours de combat ne désactivent pas les effets déjà actifs.
- Tous les bonus d'attribut sont réinitialisés en fin de combat. ⚠️ `finishCombat` balaie **tous les participants** (`combatants`, capturé avant les filtres), neutralisés compris — sinon une unité morte garde ses bonus, `max_hp` gonflé compris, et le round suivant les recumule.
- ⚠️ `applyEndOfCombat` traite les **deux camps** (`_applyEndForSide`) : `revive` remet une unité sur le plateau et vaut donc des deux côtés ; les effets de **ressource** (pioches, slot, multiplicateur, shopping) restent au joueur, seul destinataire possible.
- ⚠️ **Un effet d'attribut n'existe pour de bon qu'aux TROIS endroits à la fois** : le moteur, le `<select>` de l'onglet Attributs (avec son champ `max` si le type en accepte un), et le libellé français (`BoardInfo.boardEffectLabel`). Deux sur trois donnent une fonctionnalité que personne ne peut ni écrire ni lire — c'est arrivé à `shopping_bonus`.

**L'icône d'un attribut est une image ; l'emoji n'est que le repli.** Art dans `ILLUS_DIR` sous l'`id` de l'attribut, importé depuis l'onglet Attributs. Le champ `icon` du JSON reste l'emoji de repli.
- **`components/ui/AttrIcon.tsx` est le seul composant qui décide du repli** (image si `_has_illustration`, emoji sinon, rien si ni l'un ni l'autre). Quatre sites : puce du `SynergyPanel` (`h-4`), titre du tooltip d'attribut (`h-7`), chips `Keywords` (`h-3.5`), codex (`h-5`).
- **`object-contain`, jamais `object-cover`** : une icône rognée perd sa silhouette.
- ⚠️ `getAttribute` **jette** tant que la database n'est pas initialisée (TestBench, CombatLab) : `AttrIcon` l'entoure d'un `try/catch` et retombe sur son `fallback`. `attributeName` (exporté par le même fichier) porte le même garde.
- Le panneau de synergies pose l'icône sur **toutes** les puces, actives comme incomplètes (c'est *avant* d'avoir le palier qu'on décide d'ajouter une carte) ; l'incomplet s'éteint en `opacity-60`.
- ⚠️ L'image est nommée par l'`id` : le renommer en admin la détache silencieusement.

## Pouvoirs

Une unité a **zéro ou un** pouvoir. La jauge gagne `1 + _stat_bonuses.power_charge` par step, prête à `power_gauge >= power_speed` (`isPowerReady()`, faux si `is_power_blocked`). Le pouvoir part **dans la phase d'attaque**, **remplace** l'attaque du step et vide la jauge.

**Chaque constante n'est qu'un repli** : la carte porte son chiffre dans `power.value`, et c'est lui qui prime.

| Pouvoir | Effet (sans `value`) | `value` = |
|---|---|---|
| `POWER_HEAL` | Soigne l'allié au plus bas (soi inclus) de 40 % du `max_hp` du **lanceur** | PV plats |
| `POWER_SHIELD` | Bouclier sur soi = `atk × 2` | bouclier plat |
| `POWER_SUPER_ATTACK` | `atk × 3` sur la cible | dégâts plats |
| `POWER_AOE_ATTACK` | `atk` sur **tous** les ennemis vivants | dégâts plats par cible |
| `POWER_POISON` | DOT `max(1, atk/2)`, 1 pulse tous les `DOT_INTERVAL` (3) steps, **jusqu'à la fin du round** | dégâts par pulse |
| `POWER_BURN` | `max(1, atk/2)` **à chacune des attaques de la cible**, jusqu'à la fin du round | dégâts par attaque |
| `POWER_PARALYSIS` | **`attack_speed` doublé** pendant 20 steps — ralentit, ne bloque pas | la **durée en steps** |
| `POWER_PUSH` | Repousse de 2 cases en ligne droite (s'arrête aux bords, unités, cases bloquées) | nombre de cases |
| `POWER_DEBUFF` | `resetCombatStats()` sur la cible — efface bonus **et** statuts | — |
| `POWER_BLOCK` | Empêche la cible d'utiliser son pouvoir 25 steps | nombre de steps |
| `POWER_CONFUSION` | 20 steps : la cible prend ses **propres alliés** pour cibles | nombre de steps |
| `POWER_TAUNT` | 20 steps : le lanceur force les ennemis à le cibler | nombre de steps |
| `POWER_TELEPORT` | Au contact de l'ennemi au plus bas PV. Sans destination, la jauge **reste pleine** | — |
| `POWER_FREEZE` | Repousse d'1 case et **gèle la case libérée** jusqu'à la fin du round | — |

- ⚠️ **`powerValue(unit, fallback)` est le seul lecteur de `power_value`, et il utilise `||` et non `??`** : une **Valeur laissée à 0** en admin est le *défaut du champ*, pas une intention. Lue strictement, elle donnerait un blocage de 0 step — un pouvoir qui consomme sa jauge sans effet.
- **Un montant plat n'est pas un multiplicateur** : `HAGA_008` a `atk: 1, hp: 400, value: 80` — sous `atk × 2` ce mur se poserait un bouclier de 2. Le soin est indexé sur le `max_hp` du **lanceur** : un soigneur ne doit pas soigner moins parce qu'il est fragile.
- ⚠️ **La paralysie chiffre sa DURÉE, pas sa sévérité** (seul pouvoir dont le sens de `value` a changé) : un `+6` plat coûtait trois quarts de ses attaques à une unité rapide et rien à une lente. Un doublement coûte **la moitié** quel que soit le rythme. Un second tir **rafraîchit** au lieu d'empiler.
- ⚠️ **Poison et brûlure n'expirent pas** (plus de `DOT_PULSES` / `BURN_ATTACKS`) : ils courent jusqu'à la fin du round, et n'ont que les purges de statuts pour sortie. Ce qui les sépare est leur **horloge** : le poison bat sur l'horloge globale, la brûlure sur les **attaques de la cible** — d'où un contre-jeu que le poison n'a pas (une cible paralysée, hors de portée ou sans cible cesse de brûler). ⚠️ Corollaire assumé : **les piles cumulent sans plafond** ; le jour où ça pose problème, le geste est de **rafraîchir**, pas de rétablir un compteur.
- Un pouvoir ne part **jamais** en préparation. Un `power_id` inconnu retombe sur une attaque normale.
- Une unité `is_effect_immune` annule poison, burn, paralysie, push, freeze, block et confusion — l'événement `power` est émis avec `extra: { immune: true }`.

### Pertinence vis-à-vis de la cible (`CombatManager._isPowerRelevant`)

**Une jauge pleine ne suffit pas** : le pouvoir ne part que s'il a quelque chose à faire à la cible que `findAttackTarget` vient de désigner ; sinon l'unité **attaque normalement et garde sa jauge pleine**.

⚠️ **La règle est étroite à dessein : « est-ce que ça ne ferait RIEN ? », jamais « y a-t-il une meilleure cible ? ».** Le choix de cible reste celui de `findAttackTarget` et n'est pas réordonné — un pouvoir qui trie ses propres cibles serait une seconde politique de ciblage à tenir d'accord avec celle du déplacement, et un déterminisme PvP de plus à prouver.

| Pouvoir | **Retenu** quand |
|---|---|
| `POWER_HEAL` | aucun allié vivant n'est blessé (lanceur compris) |
| `POWER_BLOCK` | la cible n'a pas de pouvoir, ou est déjà bloquée |
| `POWER_DEBUFF` | la cible ne porte **rien** de ce que `resetCombatStats()` efface |
| `POWER_PARALYSIS` | la cible est déjà paralysée |
| `POWER_CONFUSION` | la cible est déjà confuse, ou n'a aucun autre allié vivant |
| `POWER_TAUNT` | la provocation du lanceur court encore |
| `POWER_PUSH` · `POWER_FREEZE` | la case de retraite est hors board, occupée ou bloquée |
| `POWER_TELEPORT` | le saut ne **rapprocherait pas** du plus faible |
| les autres | jamais — dégâts, bouclier, poison et brûlure posent toujours quelque chose |

- Les trois statuts **assignés** (`power_block_remaining`, `paralysis_remaining`, `confusion_remaining`) sont **écrits, pas maximisés** : rejouer le pouvoir sur un statut plus long le **raccourcissait**. Ne pas rejouer tant qu'il court ferme le cas, et la charge retenue re-part au tick où il lapse.
- ⚠️ **`POWER_DEBUFF` ignore la JAUGE de la cible** : `resetCombatStats()` la remet à zéro, mais c'est un effet de bord du balayage, pas ce que le pouvoir dissipe. La compter rendrait le dissipateur pertinent contre **tout** ennemi doté d'un pouvoir.
- ⚠️ **L'IMMUNITÉ n'est pas un motif de retenue**, alors qu'elle est bien un no-op : `effect_immunity` a une issue *designée* (la déflexion, `extra: { immune: true }`) et c'est un contre que le joueur a **gagné** — laisser les lanceurs garder leur charge le rendrait gratuit.
- `_teleportPlan()` est le calcul partagé entre la question et le pouvoir.

### Pouvoirs sans portée (`RANGELESS_POWERS`)

**Trois pouvoirs partent hors de portée** : `POWER_HEAL`, `POWER_TAUNT`, `POWER_TELEPORT`. Sans la règle, un soigneur de ligne arrière ne soignait jamais, le tank ne provoquait qu'au contact (trop tard), et le téléport devait être à portée pour se mettre à portée.

**Le critère est structurel** : ce sont exactement les pouvoirs de `_firePower` qui **ne lisent jamais `primaryTarget`**. ⚠️ **Un pouvoir ajouté à `RANGELESS_POWERS` ne doit pas lire la cible**, qui vaut alors `null` — la première ligne de `_isPowerRelevant` est le filet correspondant.

- La pertinence s'applique quand même : « sans portée » lève une condition, il n'en dispense aucune autre.
- Hors de portée et sans pouvoir à lancer, l'unité n'émet plus rien et avance.
- ⚠️ **La brûlure pulse sur un tir hors de portée** : `_applyBurnStacks` suit l'**action**, et un pouvoir *remplace* l'attaque. Ce qui borne la brûlure, c'est de ne **rien faire**, pas de ne pas frapper.
- ⚠️ **Un téléporteur peut MARCHER puis se téléporter dans le même tick** (horloges indépendantes) → le step émet **deux `move`**. `CombatAnimator3D` ne joue que le **dernier** `move` d'une unité téléportée sur le tick, sinon `animateUnitMove` et `playBlink` se disputent la position. Rien n'est corrigé côté logique : la marche a bien eu lieu, elle est recouverte.

### Effets visuels (`three/PowerVfx.ts`)

Une **grammaire** par pouvoir — direction, silhouette, locus —, car c'est elle qui distingue, pas la teinte (poison `0xc878e0` et confusion `0xa040c8` sont indiscernables en mouvement).

| Grammaire | Pouvoirs |
|---|---|
| Explosion radiale | Super Attaque, Attaque Zone |
| Implosion (`spawnConvergence`) | Débuff, Téléportation (départ), Soin |
| Faisceau (`spawnBeam`) | Super Attaque, Blocage, Provocation |
| Dôme (`spawnDome`) | Bouclier, **déflexion d'immunité** |
| Orbite (`spawnOrbit`) | Confusion |
| Nuage bas persistant | Poison |
| Arcs rasants + anneau rentrant | Paralysie |
| Cône directionnel | Poussée |
| Sceau runique (`spawnMagicCircle`) | Blocage |
| Cristaux au sol (`spawnIceBlock`) | Gel |

- **Le module est séparé de `Scene3D`** : `Scene3D` reste une bibliothèque de primitives (géométrie et éléments), une recette parle d'un `CombatEvent`. `PowerVfx.ts` n'importe de `Scene3D` que son **type**.
- **Hybride** : la forme et la couleur appartiennent au **pouvoir**, la signature élémentaire au **lanceur** (`elementAccent`, sur **sa** case seulement, ~30 % du budget d'un impact). Sans ce cantonnement, une Attaque Zone sur cinq cibles devient illisible.
- Aucun `shakeCamera` sur les pouvoirs — réservé à l'élément `terre`.
- **Persistance ciblée** (pulse de poison, pulse de brûlure, orbite de confusion, cristaux de gel) ; paralysie, blocage et provocation restent portés par le médaillon de `UnitCardEl`. ⚠️ L'orbite vit **tant que le statut dure** (`alive: () => target.confusion_remaining > 0`), jamais sur une durée figée.
- L'événement `dot` **ne dit pas d'où vient le pulse** : on le déduit de l'état de l'unité (`dot_effects` / `burn_stacks`) plutôt que d'élargir le contrat d'événements de `logic/`.
- **Déflexion d'immunité** : une seule recette pour les sept pouvoirs déviés, et **aucun** effet du pouvoir.
- ⚠️ Toutes les primitives sont bâties sur **`Scene3D.anims`** (`{ update(dt): boolean }`, la closure possède sa géométrie et son nettoyage) et **jamais** sur `bursts`, dont chaque variante coûte trois branches à tenir d'accord.
- Budget et durées en un seul endroit (`vfxBudget` / `life`), `LOW_END_DEVICE` dans `three/constants.ts` (pour que `CombatAnimator3D` le lise sans faire entrer Three.js dans son graphe).
- ⚠️ **Rien côté serveur, rien dans `logic/`, aucune donnée** : tous les payloads `extra` nécessaires étaient déjà émis, ils n'étaient pas lus. `powers.json` reste à trois champs.
- **Banc d'essai** : `dev/CombatLab.tsx` (`?screen=combatlab`) déclenche les 14 pouvoirs, la poussée butée et une cible immunisée, en passant par le **vrai** `_apply` de l'animateur (ces branches ne se rencontrent pas en jouant, une carte portant au plus un pouvoir).

## Combat (`CombatManager`)

**Aucun DOM, aucun `setTimeout`, aucun hasard.** Le combat est entièrement déterministe — `CombatManager` ne reçoit ni `rand` ni graine.

`step()` retourne un tableau d'événements :

```js
{ type: 'move',        unit, from, to }
{ type: 'attack',      attacker, target, damage }
{ type: 'power',       unit, targets, power_id, extra: {...} }
{ type: 'dot',         unit, damage }               // poison OU brûlure
{ type: 'stat_change', unit, stat, value }          // effet attribut during_combat
{ type: 'freeze',      cell, expiresAtStep }
{ type: 'death',       unit }
{ type: 'combat_end',  winner }                     // 'player' | 'enemy' | 'draw' | 'timeout'
```

`POWER_TELEPORT` émet `power` + `move`, `POWER_FREEZE` émet `power` + `freeze` : le `power` sert au toast/flash, le second porte la donnée de l'animateur.

**Cinq phases par step**, sur les unités vivantes triées par initiative :
1. Ticks passifs (jauge, décomptes paralysie/block/confusion/taunt, pulses de DOT)
2. Morts dues aux DOT → fin de combat éventuelle
3. Déplacements (`move_timer >= movement_speed`)
4. Attaques / pouvoirs (`attack_timer >= effectiveAttackSpeed()`), puis pulses de brûlure du lanceur
5. Morts dues aux attaques → fin de combat, sinon vérification du timeout

**Timing** : `BASE_TICK_MS = 180`, vitesse effective `BASE_TICK_MS / speed` (1 | 2 | 4). ⚠️ Dupliqué dans `CombatManager` et `CombatAnimator3D` (`logic/` n'importe jamais depuis `three/`) — à garder synchronisés à la main. `CombatAnimator3D` consomme les événements via `requestAnimationFrame` ; **le timing n'est jamais géré par `CombatManager`**.

**Timeout** : `MAX_COMBAT_TICKS = 60_000 / 180` (≈ 333 steps, 60 s à ×1) → `winner = 'timeout'`, **les deux joueurs encaissent**.

**Ordre d'initiative** : `initiative` décroissante → `effectiveAttackSpeed()` décroissante → **`card_id` croissant** (`localeCompare`). ⚠️ Le 3ᵉ critère n'est pas cosmétique : c'est une valeur **absolue**, identique sur les deux clients PvP, là où l'ordre d'insertion dans le tableau ne l'est pas.

**Ciblage** — pool résolu par `_targetCandidates(unit, { requireLOS })` :
1. **Provocation** — un ennemi à `taunt_remaining > 0` est la seule cible (le plus proche s'il y en a plusieurs). En résolution d'attaque (`requireLOS: true`), un provocateur hors LOS ne force plus rien ; en déplacement, l'unité marche vers lui pour regagner la LOS.
2. **Confusion** — sinon, si `confusion_remaining > 0`, les cibles deviennent **ses propres alliés vivants**.
3. Sinon, tous les ennemis vivants.

Dans ce pool, `findAttackTarget` (`PathFinder.ts`) choisit : les cibles avec **LOS** s'il en existe → la plus proche en **Manhattan** → la première dans l'ordre du pool. **Pas** de départage par PV, **pas** de priorité à la ligne de front.

Pour le **déplacement**, les candidats sont triés par **Chebyshev** croissante et l'unité essaie chaque cible dans l'ordre ; en dernier recours `stepTowardOrNearest` la rapproche par la case libre voisine la plus proche.

**Portée** : distance de **Manhattan** (`|dx| + |dy|`, 4 directions, pas de diagonales) — `isInAttackRange(a, t) → manhattan <= a.range`.

**Ligne de vue** (`PathFinder.ts`, Bresenham sur les deux collections de cases bloquées) :

```js
hasLineOfSight(board, from, to)
canAttack(attacker, target, board)   // isInAttackRange() && hasLineOfSight()
```

Aucune case bloquée → LOS toujours `true` (court-circuit). Une unité sans LOS **continue à se déplacer** vers sa cible.

**Déplacement** : BFS dans `PathFinder.ts`, pas de chevauchement (les unités neutralisées ne bloquent pas le BFS). Les cases bloquées sont exclues par `getNeighbors()`. `POWER_TELEPORT` est la **seule** exception : `board.moveUnit` direct, sans BFS.
---

## Phase Shopping et magies

Après le combat, 3 magies proposées (+ `player_extra_shopping_magies`, accumulé par l'attribut `shopping_bonus` et consommé au tirage). L'offre est **filtrée par pertinence** puis **tirée pondérée par rareté, sans remise**, dans le flux `rand` **semé** de la partie (`logic/MagieOffer.ts`).

**Sautée** si `gameState.isGameOver()`, ou si l'offre est **vide** → `_startShopping` fait `_proceedNextRound()`.

- ⚠️ **Aucun repli sur une magie non pertinente.** L'offre peut être plus courte que `3 + extra`, et l'extra est alors **perdu** (la remise à zéro précède le filtre) : le re-créditer transformerait un octroi *pour ce tour* en dette.
- ⚠️ **Le shopping n'entre pas dans le déterminisme PvP** : il n'est pas synchronisé, et le contexte de pertinence **diffère structurellement** entre les deux clients (board, main, cimetière, deck). Deux joueurs voient des offres différentes, et c'est correct — rien de tout ça ne traverse `round:board_ready`.
- ⚠️ **L'offre ne se re-tire pas après un `undoPreparation()`** : le shopping a lieu **avant** `startPreparation()`.

```ts
// logic/GameSession.ts — headless
getShoppingMagies()
magieNeedsUnitTarget / magieNeedsGraveyardTarget(magie)
magieUnitTargets(magie) / magieHandTargets(magie)
applyMagieOnUnit / applyMagieOnGraveyardUnit / applyMagieOnHandCard / applyGlobalMagie
// game/GameController.ts — orchestration
dismissEndRound() → _startShopping() → chooseMagie(magie) → skipShopping() / _proceedNextRound()
// components/shopping/ShoppingLayer.tsx — rendu
```

### Modèle de données

```json
{ "id": "MAGIC_001", "name": "Pot de Cupidité", "rarity": 2,
  "cost_hp": 0, "effect": { "type": "draw_bonus", "value": 2 } }
```

`id` (`MAGIC_NNN` livré, `MAGIE_NNN` auto-généré par l'admin) · `name` · `effect` (`{ type, ...params }` ou `null`) · `rarity` · `cost_hp` · `_has_illustration` (calculé).

⚠️ **`getRandomMagies` a été supprimée** de `MagieDatabase` : la laisser aurait maintenu un second chemin de tirage, ni filtré ni semé, portant le nom que la prochaine fonctionnalité aurait repris. La dep de `GameSession` est `getAllMagies: () => Magie[]` — la couche data **fournit**, elle ne décide plus. Même geste pour `BoardDatabase.getRandomBoard`.

### Pertinence de l'offre (`logic/MagieOffer.ts`)

Une magie n'est proposée que si elle a un **effet réel dans l'état courant** (le refus arrivait auparavant *après* le tap, en toast). Le module est **plat** — il n'importe que des types ; la pertinence est une question sur un **état**, pas sur une session. C'est `GameSession._offerContext()` qui traduit, et **le deck du joueur ne sort pas de la session** (seuls des booléens et une liste de tiers en sortent).

Détection **automatique** dérivée de `effect.type` — **aucun champ admin à saisir**.

| Condition | Types |
|---|---|
| une unité vivante au board | `stat_bonus`, `stat_modifier`, `shield`, `heal`, `team_stat_bonus`, `team_heal`, `destroy_unit`, `drain_life` |
| une Fusion **avec matériaux** au board | `defuse_fusion` |
| cimetière non vide | `revive` |
| main non vide | `hand_to_graveyard`, `duplicate_card` |
| une unité du board dont la **carte est au catalogue** | `duplicate_unit` |
| une unité du cimetière dont la carte est au catalogue | `duplicate_graveyard_unit` |
| le deck porte **le** tier demandé | `guaranteed_draw` |
| le cap partagé +1 slot est encore libre | `board_slot_bonus` |
| `player_hp < PLAYER_HP_CAP` | `player_hp_bonus` |
| le deck porte une carte à coût en matériels — **portant l'`attribute`** s'il y en a un | `reduce_materials` |
| le deck porte une carte à exigence **nommée** — même règle | `remove_requirements` |
| une carte en main **et** le deck porte son tier voisin | `shift_tier_card` |
| une unité au board **et** le deck porte son tier voisin | `shift_tier_unit` |
| une carte en main dont un **matériel** est résolvable | `draw_material` |
| une carte en main **et** `player_hp < PLAYER_HP_CAP` | `sacrifice_card_hp` |
| toujours | `draw_bonus` |

- ⚠️ **La table est FERMÉE (`default: false`)** : un `effect` nul ou d'un type inconnu traverse `applyEffect` sans rien faire. **Corollaire : un type ajouté à `applyEffect` mais oublié dans `isMagieRelevant` disparaît silencieusement du jeu.** `magie-offer.test.ts` relit `initial-data/magies.json` et exige que chaque magie livrée soit offrable sous un contexte permissif.
- ⚠️ **Les deux modificateurs de main se testent sur le DECK, jamais sur la main** : ils sont **différés** au `startPreparation()` suivant, donc appliqués après une pioche de cinq cartes neuves. `_retouchable(type)` est le **prédicat exact** que `startPreparation` appliquera, et l'offre comme l'application l'appellent — une carte sans coût, ou sans exigence nommée, n'est jamais retouchée.
- ⚠️ **Le booléen et la liste d'attributs ne disent pas la même chose, et la liste ne remplace pas le booléen** : une carte retouchable qui ne porte **aucun** attribut rend `deckHasMaterialCost` vrai sans rien ajouter à `deckMaterialCostAttributes`. Une remise visée lit la liste, une remise nue lit le booléen. Tester « attribut présent » et « carte retouchable » **séparément** offrirait la magie sur un deck où ce sont deux cartes différentes.
- ⚠️ **`guaranteed_draw` hors deck n'est pas un no-op** : `startPreparation` a un **double repli** et pioche quand même, parfois au-dessus de ce que le round autorise. Le filtre supprime là un effet accidentellement bon, délibérément — la magie **promet un tier qu'elle ne rend pas**.
- ⚠️ **`board_slot_bonus` est la seule magie qui peut s'appliquer sans erreur et ne rien donner** (`grantLimitedBoardSlotBonus` rend 0 en silence une fois le cap consommé) → `GameState.hasLimitedBoardSlotBonusLeft()`.
- Les règles servant à la fois le **ciblage** et la **pertinence** n'existent qu'à un endroit : `_defusableFusions`, `_poweredUnits`, `_cataloguedUnits`, `_drawableMaterialIds`, `_boardTierShiftPool`.
- **Limite connue** : `heal` / `team_heal` sont offertes dès qu'une unité est au board, **même à PV pleins** (`current_hp` n'est pas restauré entre les rounds, le cas est marginal).
- Les trois gardes « aucune cible valide » de `GameController.chooseMagie` sont devenues quasi inatteignables mais sont **gardées** : ce sont les seuls filets si un type sortait de la table. Elles ne consomment pas la magie.

### Rareté

Champ **racine** `rarity: 1 | 2 | 3` (Commune / Rare / Légendaire). ⚠️ **Pas dans `effect`** : une magie sans effet a quand même une rareté, et deux magies du même type peuvent différer de palier. **Facultatif** : absent ou hors bornes = Commune (`rarityOf`), ce qui rend inoffensives les magies écrites avant le champ. ⚠️ `rarityOf` passe par `Number()` — un `<select>` d'admin peut avoir persisté `"2"`.

`RARITY_WEIGHTS = { 1: 6, 2: 3, 3: 1 }`. Sur le catalogue livré (10/10/4) : Commune 63,8 % · Rare 31,9 % · Légendaire 4,3 % par emplacement. 12 emplacements par partie → une run sur 2,4 croise une Légendaire.

- ⚠️ **Pas de garde-fou sur la composition** : deux Légendaires dans une offre de 3 = **0,44 %**, et c'est un bon moment, pas un défaut.
- ⚠️ **La rareté est CONDITIONNELLE à la pertinence** (le filtre passe d'abord) : dans un état pauvre, la part de Légendaire monte bien au-dessus. Aucune renormalisation.
- ⚠️ **L'offre n'est pas triée par rareté** — trier ferait de la position un spoiler.
- **Affichage** (`components/shopping/MagieCard.tsx`) : liseré gauche 4 px + chip texte, sur **les trois** paliers. Commune `--color-tier-1`, Rare `--color-tier-3`, Légendaire `--color-tier-4`. ⚠️ **Pas d'or pour la Légendaire** : le nom, le titre et le décompte sont déjà `text-gold` — il faut **contraster avec l'accent du panneau**. Vert et rouge portent déjà « validé » et « danger ».
- **Admin** : `<select id="mf-rarity">` dans la grille **Identité** (pas Effet). ⚠️ `parseInt` obligatoire à la collecte. ⚠️ **`_collectMagieFields` repart de `...selectedMagie`** au lieu de reconstruire de zéro (la version « from scratch » détruisait `description` à chaque enregistrement) ; le sauvetage s'arrête au **premier niveau** — `effect` reste reconstruit depuis le formulaire, sinon un changement de type traînerait les champs de l'ancien.
- **Serveur : rien à faire** — `rarity` et `cost_hp` traversent GET/POST/PUT/import tel quel.

### Types d'effets (`logic/MagieEffect.js`)

`effectLabel(magie)` génère la description ; `applyEffect(magie, { gameState, targetUnit, targetUnits })` applique. ⚠️ `targetUnits` n'est **pas** une variante de `targetUnit` : il porte les magies d'**équipe**, qui n'ont aucune cible à désigner — seul `applyGlobalMagie` le remplit.

| `type` | Champs | Effet |
|---|---|---|
| `stat_bonus` | `stat`, `value` | Bonus additif **permanent** sur `_base[stat]` (min 1) + `_recomputeStats()`. Si `stat === 'hp'`, augmente aussi `current_hp` |
| `team_stat_bonus` | `stat`, `value` | Le geste de `stat_bonus` sur **toutes** les unités du joueur. Global, permanent, **tracé** (`_shopping_bonus`) |
| `stat_modifier` | `stat`, `value` | Multiplicateur permanent : `_base[stat] += round(_base[stat] × (value − 1))` |
| `heal` | — | Soin **TOTAL** : `heal(max_hp)`. ⚠️ `value` n'est **pas lu** (des entrées anciennes en portent un) ; suit le max **courant**, bonus et vétérance compris |
| `team_heal` | `value` | Soigne de `value` PV **toutes** les unités du joueur. ⚠️ **Chiffré** là où `heal` est total : un soin de masse complet n'aurait aucun contrepoids |
| `shield` | `value` | `applyShield(value)` |
| `revive` | `value` (% PV max) | Unité du **cimetière** : `is_neutralized = false`, `current_hp = max(1, round(max_hp × value/100))`, purge de tous les statuts |
| `player_hp_bonus` | `value` | `player_hp = min(player_hp + value, 1000)` |
| `board_slot_bonus` | `value` | `grantLimitedBoardSlotBonus(value \|\| 1)` — **cap partagé +1 sur toute la partie**, pool commun avec l'attribut Yeux Bleus |
| `draw_bonus` | `value` | `player_extra_draws += (value \|\| 1)` |
| `guaranteed_draw` | `tier`, `attribute` | Pousse dans `player_guaranteed_draws` — les **deux filtres sont facultatifs et se cumulent** |
| `grant_power` | `power_id`, `power_speed`, `value` | Pose (ou **remplace**) le pouvoir, remet la jauge à zéro, lève un blocage en cours |
| `power_cooldown` | `value` (facteur, déf. 2) | **DIVISE** `power_speed` (plancher 1). Ne cible que les unités **portant** un pouvoir |
| `damage_multiplier_bonus` | `value` | **Permanent et cumulatif**, s'ajoute au multiplicateur du joueur à chaque fin de combat |
| `defuse_fusion` | — | `GameSession._defuseFusion()` — sépare la fusion en ses matériaux (au cimetière s'il n'y a plus de slot) |
| `destroy_unit` | — | `_destroyUnit()` — retire du board et envoie au cimetière (libère un slot, rend disponible comme matériau) |
| `drain_life` | — | `_drainLife()` — `destroy_unit` **plus** le versement des PV de l'unité au joueur |
| `hand_to_graveyard` | — | Cible une carte de la **main** : elle devient une unité **neutralisée** au cimetière |
| `duplicate_unit` | `value` (copies, déf. 1) | Cible une **unité du board**, ajoute sa **carte de catalogue** à la main. L'unité reste en jeu |
| `duplicate_graveyard_unit` | `value` | Cible une unité du **cimetière**, ajoute sa carte à la main. Le corps y **reste** |
| `duplicate_card` | `value` | Cible une carte de la **main** et en ajoute une copie. **L'originale est conservée** |
| `shift_tier_card` | `value` (décalage, déf. **+1**) | **Remplace** une carte de la main par une carte du **deck** au tier voisin |
| `shift_tier_unit` | `value` | **Remplace** une unité du board par une unité du **deck** au tier voisin, **sur sa case** |
| `draw_material` | — | Cible une carte de la main, ajoute l'un de ses **matériels**. La source reste en place |
| `sacrifice_card_hp` | `value` (% des PV, déf. **100**) | **Brûle** une carte de la main et verse ses PV au joueur |
| `reduce_materials` | `value` (déf. 1), `attribute` | `player_hand_modifiers` — baisse le coût de N slots ; les `requires` sont rognées pour tenir dans le nouveau compte |
| `remove_requirements` | `value` (déf. 1), `attribute` | `player_hand_modifiers` — retire N exigences **nommées**, le compte de slots inchangé |

Les `player_hand_modifiers` sont consommés **au tour suivant**, dans `startPreparation()`.

⚠️ **Les deux gestes sont ORTHOGONAUX** : `reduce_materials` baisse le prix, `remove_requirements` lève une contrainte. L'ancienne « retire un matériel de Fusion » faisait les deux à la fois — mais seulement parce que le coût d'une fusion **était** la longueur de sa liste de matériaux. Ce couplage n'existe plus, il faut donc choisir lequel des deux une magie porte.

⚠️ **`attribute` est un filtre FACULTATIF, et il vaut pour les deux** : c'est lui qui rend « −1 matériel de Fusion » exprimable maintenant qu'il n'y a plus de voie à nommer. Absent, la remise tombe sur la première carte retouchable. Il **voyage** dans le `player_hand_modifiers` : la magie est jouée un tour avant que la main retouchée n'existe, elle ne peut donc pas désigner la carte elle-même. Une remise visée qui ne trouve personne est **perdue**, jamais reportée.

**Trois familles de cibles, et elles s'excluent** — `GameController.chooseMagie` les teste dans l'ordre unité → cimetière → main ; un type reconnu par deux d'entre elles n'atteindrait jamais la troisième branche.

- `needsUnitTarget` → `stat_bonus`, `stat_modifier`, `shield`, `heal`, `defuse_fusion`, `destroy_unit`, `drain_life`, `grant_power`, `power_cooldown`, `duplicate_unit`, `shift_tier_unit`. ⚠️ `magieUnitTargets` passe par `getPlayerUnits()` — **vivantes seulement**, aucun soin ne tombe sur un neutralisé encore posé.
- `needsGraveyardTarget` → `revive` et `duplicate_graveyard_unit`. ⚠️ Ils n'en font **pas** le même usage : `revive` l'**en sort**, `duplicate_graveyard_unit` la **laisse**.
- `needsHandTarget` → `hand_to_graveyard`, `duplicate_card`, `shift_tier_card`, `draw_material`, `sacrifice_card_hp`. ⚠️ Aucune n'y fait le même geste — seule la façon de **désigner** est commune. Et elles n'acceptent pas les mêmes cartes : **`magieHandTargets(magie)`** rend les index recevables (`shift_tier_card` écarte un tier voisin absent du deck, `draw_material` une carte sans matériel résolvable ; les trois autres acceptent tout, **carte injouable comprise** — c'est souvent celle qu'on veut brûler). Il voyage par `shopping.handTargets` (`null` = aucune restriction) et `resolveMagieHandTarget` le **revérifie** : le HUD montre la règle, il ne la tient pas.
- ⚠️ `magieHandTargets` ne consomme **aucun** hasard (vérifié par golden test) : il est interrogé à chaque rendu de la main, un `rand()` dépensé par une question d'affichage décalerait toute la pioche.
- Tous les autres types sont **globaux**, les magies d'équipe comprises.

⚠️ **Chaque magie d'équipe est le pendant d'une magie à cible unique, et les deux ne se dosent pas pareil.** Copier le barème de l'un sur l'autre est l'erreur qui rend l'une des deux sans objet.

### Règles transversales des magies

- ⚠️ **`power_cooldown` DIVISE au lieu de soustraire** : `power_speed` est un **seuil de jauge**, un `−4` plat ne veut pas dire la même chose sur un pouvoir à 6 et sur un pouvoir à 40. Plancher à 1 ; une `value` absente/nulle/négative → doublement.
- ⚠️ **`grant_power` remet la jauge à zéro** (héritée pleine, le nouveau pouvoir partirait au premier step) et lève un `POWER_BLOCK` en cours. ⚠️ **`power_speed` y est obligatoire** : sans elle l'unité hérite du `9999` d'`Unit` (« pas de pouvoir ») et le pouvoir ne partirait **jamais** — l'admin impose le champ (défaut 20).
- ⚠️ **La jauge de pouvoir de la carte 3D est TOUJOURS dans le balisage**, masquée en `display:none` tant que l'unité n'a pas de pouvoir : `_inner()` ne s'exécute qu'au **spawn**, donc émise conditionnellement elle n'existait pas sur une unité née sans pouvoir. Même patron que `unit-vet-badge` et `unit-medallion`.
- ⚠️ **`damage_multiplier_bonus` n'est pas offert en PvP** (`ctx.damageMultiplierMatters`) : `enemy_hp` y est réécrit à chaque round depuis le `player_hp` autoritaire de l'adversaire, qui a calculé ses dégâts sans connaître ce bonus. Il ne peut donc que faire déclarer une fin de partie que l'adversaire ne voit pas — un `result_mismatch` qui prive **les deux** joueurs. ⚠️ L'attribut `ARCH_043` (Spectre, +2) porte la **même** asymétrie et n'est pas neutralisé (le rendre symétrique demanderait de toucher au contrat de déterminisme).
- **`damage_multiplier_bonus` de magie est permanent**, volontairement hors de `nextRound()` ; celui d'**attribut** ne vaut que pour son round. Les deux s'**additionnent**.
- ⚠️ **`drain_life` verse les PV COURANTS**, pas le `max_hp`, et l'unité **part au cimetière** (elle n'est pas effacée) : c'est ce qui en fait un remplaçant honnête de `destroy_unit`.
- ⚠️ **`hand_to_graveyard` ne pose aucun corps sur le terrain** : la carte devient un matériau, et rien d'autre — elle disparaît au lancement du combat si personne ne l'a consommée. La magie ne met pas une carte en réserve, elle la brûle pour un tour. ⚠️ C'est elle qui a ouvert le ciblage de la **main** : `HandBar` se masquait sur `combatActive`, or le Shopping a lieu **après** le combat, drapeau encore levé → même exception que `GraveyardTray` (`awaitingTarget === 'hand'`).
- **Duplication** — les deux duplications d'unité sont **la même méthode** (`_duplicateFromUnit`) : ce qu'on lit sur une unité ne dépend pas de l'endroit où elle se trouve. Elles rendent la **carte de catalogue**, jamais l'unité : ni `_shopping_bonus`, ni vétérance, ni PV courants, ni bouclier, ni pouvoir posé ne voyagent — sans cette étanchéité, la magie **rendrait deux fois un investissement de Shopping**. ⚠️ **La règle du doublon ne pèse que sur la copie prise au BOARD** : copie du terrain = un **remplaçant** (injouable tant que l'original vit, sauf comme matériau), copie du cimetière = une **seconde chance** (jouable tout de suite). C'est le sens des deux magies, pas un effet de bord.
- **Remplacement par tier** — ⚠️ **le pool est le DECK, jamais le catalogue** (la seule réserve qu'une partie connaisse). Sur une unité c'est une **substitution** : l'ancienne quitte la partie **sans passer par le cimetière** (l'y laisser ferait payer la magie deux fois), ne garde aucun acquis, et la **case** est conservée (`initial_position` comprise). ⚠️ `_boardTierShiftPool` retire les cartes **déjà vivantes** : une magie n'ouvre pas une porte que l'invocation ferme. ⚠️ Corollaire : la pertinence est **optimiste d'un cheveu** côté board (`MagieOffer` ne connaît que des tiers) — le cas retombe sur la garde « Aucune cible valide », qui ne consomme pas la magie.
- **`draw_material`** — ⚠️ « a des matériels » ne suffit pas : un id peut avoir quitté le catalogue, et un matériel désigné par **attribut** n'est pas une carte. Un matériel nommé par **id** vient du **catalogue** (la carte exacte que la recette exige), un matériel d'**attribut** vient du **deck**. **Double repli** : on tire d'abord parmi les matériels que le joueur n'a **pas** (board, cimetière et main confondus), à défaut parmi tous. Le joueur ne choisit pas lequel (ce serait un second temps de ciblage).
- **`sacrifice_card_hp`** — ⚠️ la carte est **brûlée**, elle ne va pas au cimetière (sinon le choix avec `hand_to_graveyard` serait sans objet). Les PV lus sont ceux de la **carte** (`stats.hp`). La pertinence exige les **deux** conditions (main non vide *et* `player_hp < PLAYER_HP_CAP`) : une partie **commence** au plafond, la magie n'est donc jamais offerte avant le premier round encaissé.
- ⚠️ **`value` à 0 vaut TOUJOURS le défaut** (`||`, jamais `??`) : `duplicateCopies` → 1 copie, `tierShift` → +1 tier, pourcentages → 100. `0` est le **défaut du champ** de l'admin, jamais une intention. ⚠️ `MagieOffer` **importe** `tierShift` au lieu de le recopier — offerte sur un décalage et appliquée sur un autre serait le pire des deux mondes.
- **La copie est prise TELLE QU'ELLE EST**, remises comprises (`_discounted_from` garde les conditions d'origine) : le joueur duplique la carte que son tooltip annonce, et elle rejoint le même groupe (badge ×N).
- Un remplacement posé en main est un **objet neuf**, jamais la référence du deck (`canUndoPreparation` compare la main par référence, une retouche muterait le deck).
- **Rien côté PvP / réseau / HUD** pour les duplications et remplacements : la main ne voyage pas dans `round:board_ready`, le ciblage réutilise les familles existantes, et l'application précède la capture du point de retour.

### Contrecoup (`cost_hp`)

N'importe quelle magie peut coûter des **PV du joueur**. Champ de **premier niveau** (orthogonal au type d'effet).

| | |
|---|---|
| Lecture | `magieCostHp(magie)` — le **seul** lecteur |
| Accessibilité | `canAffordMagie(magie, playerHp)` → `playerHp > cost` |
| Prélèvement | `GameSession._payMagieCost`, appelé par les **quatre** chemins d'application |

- ⚠️ **La comparaison est STRICTE** : payer laisse toujours **1 PV**. Une magie impayable est **verrouillée** dans la modale (grisée, liserée de rouge, avec sa raison) plutôt que refusée au tap — la modale n'a **aucune confirmation**, un tap malheureux perdrait la partie.
- ⚠️ **Prélevé À L'APPLICATION, pas au choix de la carte** : le ciblage est annulable (`cancelMagieTargeting`).
- ⚠️ **Prélevé AVANT l'effet, et l'accessibilité se juge sur les PV d'avant** — sinon `drain_life` **financerait son propre contrecoup**.
- ⚠️ **La garde et le paiement ne se désolidarisent jamais** : les quatre chemins portent les deux. Celle de `chooseMagie` est en plus, pour que la règle ne dépende pas du seul rendu — un refus ne doit **rien** amputer.
- ⚠️ La carte est résolue **avant** le contrecoup (`_duplicateFromUnit`) : un coût prélevé pour une copie qui n'arrive jamais serait pire qu'un refus.
- Une donnée absente/nulle/négative/illisible vaut « aucun contrecoup » (le cas normal).
- ⚠️ **L'accessibilité n'est PAS un critère de pertinence** : le filtre écarte ce qui ne **ferait rien**, là où une magie trop chère **ferait** quelque chose. La filtrer la rendrait invisible au moment où il est le plus utile de savoir qu'elle existe.
- Un coût ≥ `PLAYER_HP_CAP` rend la magie injouable toute la partie. L'admin le dit ; rien ne l'interdit.
- **Rien côté PvP** : `player_hp` voyage déjà, chaque joueur étant la source de vérité des siens.

### Admin (onglet Magies)

⚠️ **Le champ `Valeur` ne veut pas dire la même chose d'un type à l'autre** (copies, décalage de tier signé, pourcentage, facteur de division…) — d'où les notes conditionnelles du formulaire. Le seul invariant : **`0` est le défaut du champ, jamais une intention**. Un type qui ne lit pas de valeur doit rejoindre les **deux** listes `noValue` du fichier (celle du rendu **et** celle de `_collectMagieFields`), sinon un `value: 0` parasite est persisté.

---

## EnemyAI

**Quand l'IA joue : en dernier.** Son placement a lieu au **lancement du combat** (`GameSession.startCombat` → `_placeEnemyUnits`, avant la purge des cimetières qui lui sert de matériaux), donc quand le joueur tape PRÊT ou que le chrono tombe à 0. Le joueur pose son board sans adversaire, puis voit l'IA arriver (`Scene3D.revealEnemyUnits` la fait tomber en cascade, `refresh()` ne passant plus une fois en mode combat). En PvP, `_placeEnemyUnits` est un **no-op**.

⚠️ **`revealEnemyUnits` est une SYNCHRO du côté ennemi, pas un simple ajout** : le tour de l'IA peut aussi **retirer** des unités (survivant consommé comme matériau, remplacé par une transformation, écarté par le plafond de `rearrangeUnits`). Ces unités ont déjà une carte à l'écran et `refresh()` ne repasse plus : sans purge, un **fantôme** reste affiché tout le combat. La purge est un retrait franc (`_removeUnitObj`), pas un `killUnitObj` — une explosion de mort avant le premier coup mentirait. Le côté joueur n'est jamais touché ici.

**Placement en deux passes** : cartes normales d'abord (elles libèrent les matériaux), puis invocations spéciales (qui peuvent les consommer).

**`rearrangeUnits`** : mêlée (`range ≤ 1`) → rangées 7–8, distance → 9–10 ; colonnes `[2, 1, 3, 0, 4]` (centre vers bords) ; PV le plus élevé en rangée la plus avancée ; **3 unités max par rangée**, débordement vers la suivante. ⚠️ Les unités au-delà du cap sont **jetées en silence** (ni mort, ni cimetière) — le labo IA les nomme dans `dropped`.

### La main s'accumule

`drawHand` **ajoute** les cartes piochées à la main, comme `GameSession.startPreparation` côté joueur. Elle était écrasée à chaque round, ce qui perdait précisément ce que `placeFromHand` avait retenu — une fusion tirée au round 1 ne revenait **jamais**, et n'était même plus tirable, le pool de tiers ayant glissé.

- ⚠️ **Un pool VIDE ne défausse pas la main non plus** (second point d'écrasement, le plus silencieux).
- ⚠️ **Le nombre d'appels à `rand` est inchangé** : exactement `HAND_SIZE` dès que le pool n'est pas vide, zéro sinon.

### Le choix des matériaux

L'IA prenait le **premier candidat venu** et ne savait pas ce qu'une unité vaut. Quatre règles, toutes dans `_attempt`, une seule idée : **dépenser le moins possible, et jamais vers le bas.**

| Règle | Nature |
|---|---|
| Une unité de tier **strictement supérieur** au résultat ne se consomme jamais | **règle dure** — la carte est refusée (`material_outranks_result`) |
| À matériau éligible égal, on prend le **moins cher** | préférence |
| Le **cimetière** passe avant le terrain sur un **sacrifice** | préférence |
| `material_value` est **dérivée** (`materialValueOf`), comme chez le joueur | correction d'une divergence |

- ⚠️ **La garde de tier est `>` et non `>=`** : consommer un **pair** reste légitime (deux Tier 2 pour un Tier 3 via un intermédiaire de même rang). Passée en `>=`, elle fait tomber 11 tests d'`ai-lab.test.ts` — c'est la mesure de ce qu'elle refermerait.
- **Le coût d'une unité est `atk × 20 + current_hp`** (la métrique de `sim/autoPlayer.materialCost` : ce sont les survivants et leur ATK qui infligent les dégâts de fin de combat). Départage par `uid` à coût égal, sinon le choix ne serait pas déterministe.
- ⚠️ **Le cimetière d'abord sur un sacrifice, le terrain d'abord sur une fusion** — ce n'est pas une incohérence : une unité du cimetière est déjà perdue, mais une unité du **terrain** libère une **case**, et c'est ce qui permet à une fusion de passer sur un plateau plein.

### Ce que l'IA ne fait PAS (mesuré par le labo, non corrigé)

Les toucher déplacerait le placement dans tous les modes et ferait bouger les goldens de `sim.test.ts` :
- **L'IA ne regarde jamais le camp adverse** (`_tryPlace` et `rearrangeUnits` ne lisent que leur propre côté) — c'est le premier levier d'un comportement par difficulté.
- **Aucun scoring de CARTE ni de CASE** : tri fixe `_summonPriority`, puis « premier qui passe » ; la case est toujours `_freeCells(...)[0]`. Seul le choix du **matériau** est arbitré.
- **`COL[i % 5]` avec `Math.floor(i / 3)`** (`EnemyAI.js`) : les deux modulos ne s'accordent pas, « centre vers bords » n'est tenu que sur la première rangée.
- `EnemyAI.getHand()` et `computeMultiplier()` sont du **code mort** (la formule vivante est `GameState._multiplier`).

⚠️ **Les deux corrections ci-dessus sont des changements d'ÉQUILIBRAGE majeurs, et aucun test ne les voit** : ligne de base mesurée au détecteur (4 000 parties, même graine, vrai catalogue) **51,7 % → 39,5 %** (rétention de main) puis **38,6 % → 15,9 %** (choix des matériaux), soit ≈ **36 points** repris au joueur en deux lots. La suite passe **sans une seule mise à jour de snapshot** : `sim.test.ts` fige des scénarios inline sur des decks synthétiques de normales de tier 1, où la règle du doublon plafonne ce que l'IA peut poser et où aucun matériau n'est jamais choisi. **Le trou de couverture est réel : ces effets n'existent que sur un vrai catalogue.**

⚠️ Conséquence non traitée : **le tutoriel devient plus dur**, alors qu'il est conçu pour être gagné. Le levier propre est le comportement par difficulté, pas un rétropédalage sur des règles justes.
---

# PvP en ligne

`ws/pvpServer.js` sur **`/ws/pvp`** (le fallback SPA exclut tout le préfixe `/ws`). Le serveur fait matchmaking + **relais opaque** ; chaque client simule le combat localement, le déterminisme garantissant le même vainqueur des deux côtés. L'adversaire est reconstruit **en miroir** (rows 7–10) par `net/PvpOpponentProvider.js`. `GameSession` a un mode `'pvp'` (pas d'`EnemyAI`, terrain convenu).

**Parité avec le solo** : cimetière, options d'invocation et **Phase Shopping** sont présents. Le shopping n'est pas synchronisé (chaque joueur tire et applique localement) ; le résultat est transmis dans le `round:board_ready` du round suivant. Un chrono de 45 s le borne pour ne pas bloquer l'adversaire à la barrière.

## Contrat de déterminisme

⚠️ **Tout état persistant d'une unité doit voyager dans `round:board_ready`**, sinon les deux clients simulent des combats différents. Le payload transporte par unité :

`card_id` · `position` · `veterancy_points` · `base` (stats de base, modifiées en permanent par les magies) · `current_hp` (les PV ne se régénèrent pas entre rounds) · `shield` · **`power_id` / `power_speed` / `power_value`** (`grant_power` et `power_cooldown` réécrivent durablement le pouvoir) — plus **`player_hp`** au niveau du message, chaque joueur étant la source de vérité de ses propres PV.

Verrouillé par `client/src/test/pvp.test.ts`.

⚠️ **Le contrat a une seconde moitié : un état qui n'a AUCUNE raison de survivre au combat doit être SUPPRIMÉ, pas transporté.** `attack_timer` et `move_timer` n'étaient remis à zéro nulle part et se reportaient chez leur propriétaire, quand l'unité reconstruite du réseau naissait avec des horloges neuves. **Avant de grossir le payload, se demander pourquoi la donnée persiste.**

⚠️ **La reconstruction teste `'power_id' in entry`**, jamais `entry.power_id ?? unit.power_id` : un pouvoir peut être légitimement **absent** sur une unité dont la carte en porte un. Une clé absente (payload antérieur au champ) garde le pouvoir de la carte.

⚠️ **L'`uid` voyage mais n'est jamais relu** : `reconstructOpponentUnits` le jette et laisse `new Unit` en tirer un neuf. Il n'a **aucune valeur commune aux deux clients** — ne jamais s'en servir comme identité partagée (utiliser `(owner, card_id)`, la règle du doublon garantissant l'unicité par camp).

⚠️ **Le terrain n'entre pas dans ce payload** : son **id** voyage dans `round:go` (le serveur arbitre), et les **attributs du deck adverse** dans `match:found`, une fois pour tout le match.

## L'asymétrie qui transforme n'importe quelle rémanence en divergence

⚠️ **Le propriétaire garde ses objets `Unit` d'un round à l'autre, tandis que son adversaire les reconstruit depuis `_base` à chaque round.** Tout ce qui traîne sur l'objet sans voyager diverge donc **systématiquement**, et l'inverse n'est jamais vrai — c'est **toujours le camp du propriétaire qui a tort**.

**Le monde du rôle B est le reflet de celui de A** (`mirrorRow = 10 - row`). Les invariants qui en découlent, tous vivants — un changement qui en casse un fait diverger la partie entière, et un désaccord final prive **les deux** joueurs de leur gain (`result_mismatch`) :

| Invariant | Où |
|---|---|
| Le terrain est une donnée **positionnelle** : le rôle B applique `mirrorCells(blocked_cells)` | `logic/BoardMirror.ts`, drapeau `deps.mirroredRole` posé à la **construction** de la session |
| Les horloges de combat sont remises à zéro à chaque `startCombat` | `Unit.resetCombatClocks()` — **séparée** de `resetCombatStats`, que `POWER_DEBUFF` appelle en plein combat |
| Le balayage des rangées et l'énumération des voisines se font dans le repère de **référence** | drapeau `Board.mirroredFrame`, posé une fois par `GameSession` |
| Les deux camps sont rendus dans l'ordre du repère de référence | `CombatManager._frameOrderedUnits()` + départage `_frameSide` |
| `finishCombat` remet à zéro **tous les participants**, neutralisés compris | `combatants`, capturé avant les filtres |
| `Board.rowNeighbourOffsets()` / `Board.rowScan()` sont les **seuls** énumérateurs de cases | `getNeighbors` **et** `CombatManager._teleportPlan` |
| `applyEndOfCombat` traite les **deux camps** (`revive` remet une unité sur le plateau) | `AttributeManager._applyEndForSide` |

- ⚠️ **`logic/BoardMirror` est le seul module qui sache traduire une rangée d'un camp à l'autre** : `net/PvpOpponentProvider` et lui partagent un unique `mirrorRow`.
- ⚠️ Le drapeau de miroir est posé à la **construction** de la session, pas passé à `startCombat` : il n'y aurait sinon qu'à l'oublier sur un chemin d'appel pour que la divergence revienne en silence.
- ⚠️ **Seul le rôle B change.** Le rôle A balaie exactement comme avant → solo, arcade, tournoi, tutoriel et simulation sont **inchangés au bit près**. C'est la propriété qui rend ces corrections sûres : elles n'introduisent pas un nouvel ordre, elles imposent aux deux clients **celui qui existait déjà** d'un des deux côtés.
- ⚠️ **Une règle de repère recopiée à deux endroits est une règle qu'on corrige à un seul.** C'est arrivé trois fois (l'énumérateur de la téléportation, le tri d'initiative recopié par `CombatRecorder`, la traduction du vainqueur). **Avant d'ajouter un énumérateur de cases, se demander si `Board` n'en a pas déjà un.**
- ⚠️ **Le déterminisme ne demande PAS que le terrain soit symétrique** — c'est le miroir à l'application qui le garantit. Le **fond de grille** suit (`Scene3D.setTerrainMirrored`, posé par `PvpController.attachScene` — la scène est attachée par `Board3DCanvas` sans ordre garanti vis-à-vis de `begin()`) : plan retourné sur l'axe des rangées (`scale.y = -1`, d'où le `DoubleSide` — une échelle négative inverse l'enroulement des faces).
- ⚠️ **Le combat n'est pas tout le round** : ce qui arrive **après le dernier tick** (la réanimation d'attribut, donc les survivants et les dégâts) peut diverger sans qu'aucun tick ne diffère. D'où l'épilogue du log.

## Barrières réseau (`ws/MatchRelay.js`)

⚠️ **La barrière de lancement de combat est indexée par ROUND** (`ackRound`, `combatStartAcks`, `terrainByRound`). Les deux joueurs ne traversent pas la fin d'un round à la même vitesse (récapitulatif 22 s, Shopping 45 s, préparation 60 s) : `round:next_ready` vidait la barrière **sans regarder de quel round il parlait**, effaçant l'acquittement déjà posé — chaque client n'acquittant qu'une fois par round, elle ne repassait **jamais** à deux et le match figeait sans erreur ni déconnexion. `round:next_ready` n'est donc plus qu'un **relais**, et la barrière se referme sur elle-même.

⚠️ **Une barrière à moitié franchie ne dure pas** : `BARRIER_TIMEOUT_MS` (180 s, armé au premier acquittement) la tranche selon la règle de Marvel Snap — on joue le round si on **peut** le jouer, sinon le silencieux perd (`endMatch(..., 'timeout')`). C'est le second gel possible, distinct du précédent : un onglet gelé n'acquitte jamais **sans se déconnecter**.

- ⚠️ **« Jouer sans lui » n'est possible que si son BOARD est arrivé** : le client présent attend aussi `round:board_ready` (`waitForOpponentBoard`) et le serveur n'en garde **aucune copie**. La grâce ne vaut donc que si seul l'acquittement manque — structurellement rare, board et acquittement partant du même appel synchrone.
- ⚠️ **« Une seule grâce » est une CONSÉQUENCE, pas un compteur** : après un `round:go` de grâce, un client muet n'annoncera pas non plus le board suivant → la barrière suivante retombe sur le forfait, sans état à tenir.
- ⚠️ **Le délai ne borne pas la lenteur d'un joueur, il détecte un client MORT**, d'où sa générosité : le pire écart légitime se dérive des chronos du client (animation ×1/×4 ≈ 27 s + récap 22 s + Shopping 45 s + préparation 60 s ≈ **155 s**).

## Arbitrage du résultat

⚠️ **Un désaccord entre les deux rapports n'a PAS de vainqueur** : le match est clos en `draw` avec `reason: 'result_mismatch'`, **aucun gain n'est versé**, et les deux `userId` sont journalisés. Le rôle A faisait autorité auparavant, ce qui était exploitable de la façon la plus simple qui soit. Coût assumé : sur une vraie divergence de simulation, un joueur honnête perd son gain.

## Le serveur dérive, il ne croit pas le client

`match:found` **et `match:rejoined`** portent deux faits dérivés du **deck book serveur**, par un seul point d'appel (`MatchRelay.deckDerived`) — les laisser se séparer voudrait dire qu'un client reconnecté n'a qu'une moitié de son adversaire :

| Champ | Nature | Sert à |
|---|---|---|
| `variants` | cosmétique | l'art des cartes adverses |
| `deck_attribute_counts` | **PAS cosmétique** | le choix du terrain, donc des bonus de stats réels |

- `cosmetics.deckVariantMap(userId, deckName)` filtre par **possession** et par **cohérence** (`variants.byId(id).card_id === cardId`) : le méta de deck vient du client, sans ce filtre n'importe qui afficherait une variante non achetée. Le `deckName` annoncé ne sert qu'à choisir une clé du **propre** livre de ce joueur.
- ⚠️ **`deck_attribute_counts` vit dans `decks.js`** et non dans `cosmetics.js` : c'est la première valeur dérivée du serveur qui n'est pas cosmétique, la loger là aurait donné à ce module un nom qui mente. `decks.js` possède aussi `resolveDeck` (repli « nom inconnu → deck actif »), que `deckVariantMap` open-codait — deux lectures du même livre finissent par ne plus s'accorder.
- ⚠️ **Le serveur envoie des COMPTES, pas une liste déjà seuillée** : renvoyer les attributs filtrés mettrait `MIN_ATTRIBUTE_OCCURRENCES` **des deux côtés du fil**, à tenir synchronisé à la main. Le serveur **compte**, le client **seuille** (`BoardPicker.dominantAttributes`).
- ⚠️ **Divulgation assumée** : l'adversaire apprend les attributs dominants du deck avant la première unité posée. La puce 🗺️ du terrain l'annonce déjà un round plus tard, et l'alternative (faire choisir le terrain par le serveur) mettrait de la logique de jeu dans un relais dont tout le principe est d'être **opaque**.
- `OnlineLobby` force `DeckRepository.flushSync()` **avant** `queue:join` : la synchro est debouncée à 500 ms.
- Sur `match:found`, le lobby **présente l'adversaire** (avatar + pseudo + tag, overlay plein écran) pendant `MATCH_REVEAL_MS` (3 s) avant de naviguer — `MatchRelay.handleReady` n'a pas de chrono, les deux clients peuvent donc tenir cette pause chacun de leur côté. ⚠️ L'overlay **couvre le `◂`** à dessein : le match existe déjà côté serveur, quitter pendant la présentation le laisserait orphelin. Le décompte affiché ne pilote rien — le départ est tenu par le `setTimeout`, **annulé au démontage** (sinon un retour navigateur ferait naviguer l'écran suivant).

## Log de combat par tick — outil de diagnostic temporaire

`client/src/game/CombatRecorder.ts` + `pvplog.js` + `routes/admin-pvplog.js` + onglet 🔬 Logs PvP. Enregistre chaque combat PvP **des deux côtés**, tick par tick, et met les deux vues face à face en nommant la **première** différence (`diff` : `header` → `order` → `state` → `events` → `length` → `epilogue`, avec le champ fautif **nommé**).

⚠️ **Ce lot est fait pour disparaître.** Tout est **additif**, en sept points : la table `pvp_combat_logs` (`db.js`), `pvplog.js`, la route `POST /me/pvp-log`, `routes/admin-pvplog.js` + son `app.use`, la purge dans `runMaintenance`, l'onglet d'`admin.html`, et côté client `CombatRecorder.ts` + les deux crochets `protected` de `GameController` (`_newRecorder` / `_flushRecorder`, no-op dans la classe de base) + leurs surcharges dans `PvpController` + `getMatchId()` + `postPvpLog`. **Rien n'est touché dans `logic/`.**

**La forme canonique commande tout le reste** — le client normalise **à la capture, dans le repère du rôle A** ; le serveur compare sans savoir de quel côté il regarde. `row_canon = (role === 'B') ? 10 - row : row`, **uniforme** (mes unités comme celles d'en face ; `col` ne se miroite pas) ; `owner = (u.side === 'player') ? monRôle : l'autre` ; identité `` `${owner}:${card_id}` `` — ⚠️ **surtout pas l'`uid`**. ⚠️ Les positions portées par les **événements** se normalisent aussi (`move.from/to`, `freeze.cell`).

- ⚠️ **Il vit dans `game/` et PAS dans `logic/`** : branché sur le crochet `onStep` que `GameController` possédait déjà — il lit, il ne participe pas.
- ⚠️ **Les événements se copient EN PROFONDEUR à l'émission** : ils portent des références vivantes que les steps suivants mutent.
- ⚠️ **L'envoi est « pose et oublie »** (jamais attendu, `catch` muet) et **ne passe pas par le WebSocket** (`maxPayload` 64 Ko, et tout type inconnu y serait **relayé à l'adversaire**). Plafond `MAX_LOG_BYTES = 700_000`, troncature annoncée. Rien n'est enregistré en duel contre **bot**.
- ⚠️ **`record` vérifie l'appartenance au match** (match existant, `user.id` l'un des deux joueurs, `role` correspondant à sa **place réelle**) : la clé primaire étant `(match_id, round, role)`, un rôle usurpé empêcherait la vue de l'adversaire d'être enregistrée. **`INSERT OR IGNORE` : le premier écrit gagne.**
- ⚠️ **`_onCombatFinished` appelle `finishCombat()` AVANT d'expédier le log** — il partait auparavant *avant* la résolution, si bien que cette moitié du round n'était jamais enregistrée.
- ⚠️ **Le log lit `session.board.blockedCells()`**, jamais la définition du terrain.

⚠️ **Deux leçons de méthode, valables au-delà de cet outil :**
1. **Une divergence en cache une autre** — le diff s'arrête à la première différence, donc un rapport « diverged » n'est jamais la liste des pannes, c'est la plus précoce.
2. **Un outil de diagnostic qui crie au loup sur les cas sains est pire qu'un outil absent.** Arrivé trois fois : le vainqueur non traduit (`'player'`/`'enemy'` sont des valeurs du repère **local**, donc *tout* duel sain était rapporté divergent), le tri d'initiative recopié sans son départage, et le labo IA qui affichait le contraire de la rétention de main.

---

# Client React

## Navigation

Écrans routés par `uiStore.screen` (Zustand, parité `?screen=`, pas de react-router).

⚠️ **Ajouter un écran se fait à UN endroit** : le tableau `SCREEN_NAMES` (`uiStore.ts`), dont `ScreenName` est **dérivé** (`as const` + `typeof […][number]`). Les deux existaient en double et une seule était gardée par le compilateur : un écran ajouté à l'union mais pas au tableau était navigable en SPA et refusé au deep-link. Le rendu est apparié dans `App.tsx` par un `Record<ScreenName, ComponentType>` — TypeScript y vérifie l'**exhaustivité**. `IMMERSIVE_SCREENS` est typé `Set<ScreenName>` pour la même raison.

⚠️ **`GameScreen`, `GameScreenPvp`, `TestBench` et `CombatLab` sont chargés en `lazy()`** — non pour leur taille, mais parce qu'ils sont les seuls à tirer `three/Scene3D`, donc Three.js entier (≈ 560 Ko). En statique, ouvrir la boutique faisait télécharger le moteur 3D : bundle d'entrée **1 058 Ko → 447 Ko** (295 → 133 Ko gzip). Une frontière `Suspense` unique entoure le routage. **Tout nouvel écran qui importe `three/` doit rejoindre cette liste**, sinon il annule le découpage d'un coup.

⚠️ **Invariant de fond d'écran : soit l'écran est dans `IMMERSIVE_SCREENS`, soit sa racine porte `relative z-10`.** Le décor spatial est `position: fixed; z-index: 0` et **opaque** : dans l'ordre de peinture CSS, un descendant positionné à `z-index: 0` passe **après** tous les descendants non positionnés — un écran sans `z-10` est **intégralement recouvert**. Vérifiable d'un coup d'œil (les seuls écrans sans `z-10` sont exactement les immersifs) et verrouillé par `ai-lab.test.ts`.

⚠️ **`IMMERSIVE_SCREENS` désigne les écrans qui posent leur PROPRE décor plein cadre**, pas ceux qui ont un canvas : un `bg-surface` sur une racine `h-dvh` suffit, et c'est le cas des trois bancs de dev.

⚠️ Le `z-10` du `<main>` crée un **contexte d'empilement** : une `Modal` d'écran (`z-40`) y est confinée, là où `TooltipHost` et `RewardToasts` (`z-50`, montés par l'App) restent au-dessus. Les modales en `createPortal(…, document.body)` sortent du contexte et passent devant tout.

⚠️ **`navigate()` n'écrit pas dans l'URL** : un `location.reload()` ramène toujours au menu, quel que soit l'écran affiché.

## Data layer

Chaque database expose `init()` async ; les données sont cachées en mémoire après le premier fetch. `initGameData` les initialise.

```js
CardDatabase.getCard(id) / getCardsByTier(tier) / getAllCards() / illustrationUrl(id) / costHint(card)
CardBackDatabase.resolveCardBack(id) / defaultCardBack()            // ⚠️ init() ne jette jamais
AttributeDatabase.getAttribute(id) / getAllAttributes()      // Array — injecté dans GameSession
PowerDatabase.getPower(id) / getAllPowers()
BoardDatabase.getBoard(id) / getAllBoards()                  // ⚠️ plus de getRandomBoard
MagieDatabase.getAllMagies()                                 // ⚠️ plus de getRandomMagies
PublicDeckDatabase.getAllDecks() / avatarUrl(id) / difficultyOf(deck) / difficultyLabel(n)
```

**DeckRepository** persiste en `localStorage` (decks + méta couleur/tags/variantes) ; chaque mutation planifie un push serveur debouncé si l'utilisateur est connecté, tout reste local en invité.

```js
saveDeck / loadDeck / deleteDeck / renameDeck / deckExists / findFreeName
getActiveDeck / setActiveDeck / listDecks
getDeckColor / setDeckColor / getDeckTags / setDeckTags
getDeckVariants / setDeckVariants        // { card_id: variant_id }
await pull()        // GET /api/me/decks → écrase le local
await flushSync()   // PUT /api/me/decks — push debouncé, forcé
handleLogout()      // coupe la synchro, garde le local
```

Structure d'un deck : `{ "1": ["CORE_001", …], "2": […], "3": […], "4": […], "5": […] }`.

## DeckBuilder et deck actif

- **Unicité** : une carte ne figure qu'**une seule fois** dans un deck (cohérent avec la règle du doublon). Maximum par tier : `min(8, pool_size)`. **Minimum pour sauvegarder : 20 cartes au total**, réparties librement.
- Les cartes **non débloquées sont masquées** par défaut (chip `🔒 Verrouillées` pour les révéler, grisées et intapables). `addCard` **revérifie la possession** : l'ajout ne dépend jamais du seul état d'affichage.
- **Le tap de la bibliothèque fait l'aller ET le retour** : sur une carte déjà prise (liserée d'or), il la **retire** — le retrait s'y fait **par `card_id`** (`removeCardById`), l'unicité garantissant qu'il n'y a qu'une carte à désigner. ⚠️ « Déjà dans le deck » **prime sur** « verrouillée » et sur « tier plein » : c'est sur un tier plein qu'on a besoin de faire de la place. Une carte verrouillée **hors** du deck reste intapable.
- Un deck **déjà enregistré** contenant des cartes non possédées n'est **pas amputé** : elles sont signalées (cadenas + bandeau) et restent retirables à la main.
- **Invité** : repli sur les cartes de départ, reconnues au drapeau `_starter` (préfixe `CORE_*` en second repli). Le jeu se joue sans compte, et ce qui est bâti reste valable après inscription.
- ⚠️ **`CardTile` en `tapOn="up"`** n'arme le tap que si le `pointerdown` a eu lieu **sur la vignette** : sans ce garde-fou, les boutons du DeckSelector naviguant au `pointerdown`, le `pointerup` retombait sur la grille fraîchement montée et ajoutait une carte à l'ouverture de l'écran. L'appui long (tooltip) arme `suppressTap` et ne touche jamais au deck.
- Mode édition : `navigate('deck_builder', { deckName })` — le nom voyage dans les params de navigation, et **de nulle part ailleurs**. Les decks enregistrés avant la règle d'unicité sont dédoublonnés au chargement, avec un bandeau (le total change à l'écran).
- À l'enregistrement, `if (!hasActiveDeck()) setActiveDeck(finalName)` — sinon un premier deck ne serait jouable nulle part.

**Le deck du joueur se choisit à un seul endroit** : la **pastille du deck actif** du menu principal (`ActiveDeckPill`) ouvre `DeckSelector` en `params.mode = 'manage'`. C'est ce deck que jouent **tous** les modes.

| `params.mode` | Liste | Rôle | Action |
|---|---|---|---|
| `'manage'` | les decks du **joueur** (`deckStore`) | choisir le deck **actif** + gérer (✏️ 📋 🏷️ 🗑️) | ＋ Créer |
| `'play'` | les decks **publics** | choisir **uniquement le deck de l'IA** | ⚔ Jouer |

- **L'adversaire solo se choisit parmi les decks publics**, jamais parmi ceux du joueur. Le deck public **voyage en clair** dans les params (`enemyDeck`), pas seulement par son nom : il ne vit pas dans `DeckRepository`. `enemyDeckName` n'est plus qu'un libellé.
- **La carte d'un deck public ne montre pas la même chose** : la répartition par tier est réservée aux siens (devant un adversaire, on ne choisit pas une composition) — elle cède la place à sa **difficulté** (`DifficultyChip` : le libellé **et** 4 pastilles) et à ses **tags**.
- **Tags** (`data/DeckTags.computeDeckTags`) : deux attributs dominants (≥ 2 cartes) puis un mot de profil (Mêlée / Distance / Brutal / Offensif), 3 max. **Un seul calcul, deux moments** : figés à l'enregistrement pour le deck du joueur, **dérivés à l'affichage** pour un deck public. ⚠️ **Le tri a DEUX critères** : effectif décroissant, puis `id` d'attribut — sans le second, un deck public réordonné en admin changeait de tags sans changer de contenu (même geste que le départage par `card_id` de l'initiative).
- Deux raccourcis en mode `'play'` : **🪞 Miroir** (état par défaut, `enemyId = null` → l'IA joue le deck du joueur) et **🎲 Aléatoire** (tire un deck public jouable, en évitant le tirage précédent). Ne retient que les decks ≥ 20 cartes.
- **Tournoi et Duel en ligne n'ont pas d'étape de sélection** : ils consomment `getActiveDeck()` et n'affichent qu'un récap **en lecture seule** (`components/deck/SelectedDeck.tsx`). Seul cas navigable : aucun deck actif → CTA « Mes decks ». Un tournoi lancé garde son deck figé (`tournament.playerDeckName`).

```js
buildSession(deckName, mode, enemyDeckName, enemyDeck, playerDeck, enemyBonus)
// enemyDeckName + enemyDeck absents en mode 'ai' → l'IA joue le deck du joueur (miroir)
```

## Tournoi

Bracket local à 8, **entièrement client** (`logic/Tournament.js`), élimination directe, chaque match en Bo5.
- Les matchs **entre IA** sont simulés (`MatchSimulator`, headless déterministe), résolus dès l'ouverture d'un round.
- Les matchs **du joueur** se **jouent** : chaque manche lance une vraie partie solo (`GameScreen` avec `params.tournament`) contre le deck public adverse injecté via `buildSession`. Victoire/défaite créditée, **égalité non comptée** (manche rejouée), abandon = manche concédée.
- Le bracket vit dans `stores/tournamentStore.ts` et non dans l'état du composant (l'écran est démonté pendant qu'on joue) ; `pendingGame` est le contrat entre les deux écrans. ⚠️ Il vit en **mémoire** et se perd au F5 — c'est la différence de fond avec l'Arcade.
- `logic/Tournament.js` transporte un `avatarId` par participant et **ne construit aucune URL**.
- ⚠️ **`MatchSimulator` n'est PAS la simulation d'équilibrage** : il rejoue une boucle allégée (pas de vétérance, unités réanimées ignorées, aucun terrain). Seul `Tournament.js` en dépend.

## Mode tutoriel

Codex de 11 chapitres + partie guidée + création accompagnée du premier deck. Écran `tutorial`.

**Entièrement client, zéro ligne serveur** : pas de route, pas de table, aucune récompense — donc aucune surface de triche. La progression tient dans **une seule clé localStorage**, `millenium_tutorial_v1`.

⚠️ Cette clé ne porte **pas** d'`user.id`, contrairement à `hasUnseenShop` / `hasUnseenMissions` : le public visé est celui qui n'a pas encore de compte. Tout le mode est accessible en **invité** — ne pas y recopier le `if (!user) return null` des boutons Missions et Boutique.

**Le coach observe, il ne pilote pas** : il s'abonne à `gameStore`, que `GameController` republie déjà après chaque mutation. Conséquence : **`logic/`, `GameController` et `Scene3D` ne sont pas touchés**. Toute la **décision** vit dans des **fonctions pures** (`data/tutorialScript.ts`) ; les composants ne font que les rendre — c'est ce qui le rend testable alors que la suite tourne sans DOM.

| Fichier | Rôle |
|---|---|
| `data/tutorialContent.ts` | Les 11 chapitres : copie + **sélecteurs** d'exemples, purs |
| `data/tutorialScript.ts` | `advanceGameSteps` / `gameCoachStep` / `deckCoachStep` |
| `data/tutorialProgress.ts` | localStorage (`shouldInvite`) |
| `game/tutorialDeck.ts` | `buildTutorialDecks(cards)` — dérivés du catalogue |
| `screens/TutorialScreen.tsx` | Sommaire **et** lecteur de chapitre |
| `components/tutorial/` | `ChapterBlocks`, `CoachBubble`, `TutorialCoach`, `DeckCoach` |

- Un chapitre ne contient **jamais d'`id` de carte en dur** : ses exemples sont des sélecteurs `(cards) => Card[]` évalués sur le catalogue réel. Le codex suit donc les données.
- **Les decks** ne vivent pas dans `DeckRepository` → 5ᵉ paramètre **optionnel** `playerDeck` de `buildSession`, symétrique d'`enemyDeck`. Construction en deux temps imposée par les données (le catalogue n'a presque aucune invocation **normale** au-delà du tier 2) : tiers 1–2 en normales, tiers 3–5 **uniquement des cartes dont les matériaux sont déjà dans le deck**. L'**ATK pèse 20× les PV** dans le classement (ce sont les survivants et leur ATK qui infligent les dégâts ; un mur à 1 ATK partirait au **timeout**, qui blesse les *deux* joueurs).
- ⚠️ **Le gel des chronos est le seul vrai piège du mode** : sans lui `PrepTimer` lance le combat au bout de 60 s en pleine explication. D'où **`coachBlocking`** dans `GameSnapshot`, sur le modèle exact de `menuOpen` — lu par `prepActive`, `ShoppingTimer` et le décompte d'`EndRoundOverlay`. **Toujours faux hors tutoriel.**
- **`ai_win` n'est pas crédité** ; les **missions**, en revanche, ne sont *pas* neutralisées (une partie d'entraînement est une partie solo au regard des garde-fous serveur, et la contourner demanderait de toucher `GameController`).
- La bulle se pose **au-dessus de la main** en portrait ; pendant les trois modales centrées (récapitulatif, Shopping, fin de partie) elle passe **en haut**.
- Le script s'arrête au **tour 2**.
- `DeckCoach` est rendu **dans** `DeckBuilder`, en flux au-dessus du pied de page, et reçoit les valeurs **déjà dérivées à chaque rendu** (`total`, `perTier`, `tierMax`, `name`, `tab`, `valid`) : aucun refactor, **aucune règle réimplémentée**. Il n'a pas d'index d'étape, seulement l'état — un joueur qui retire des cartes revient donc au message précédent.

## Rendu 3D

Un seul pont React ↔ Three : `components/board/Board3DCanvas.tsx` monte un `<canvas>`, instancie `Scene3D` et délègue tout le rendu. `Scene3D` possède la scène, le renderer WebGL et le `CSS3DRenderer` ; `CombatAnimator3D` consomme les événements de `CombatManager`.

⚠️ **Deux contraintes qui ne se devinent pas** — elles ont coûté trois effets de pouvoir invisibles, et s'appliquent à **tout** ce qu'on ajoute dans `three/` :

1. **La caméra regarde DROIT vers le bas** (`camera.position.set(0, _camH, _camCenterZ)` puis `lookAt(0, 0, _camCenterZ)`, aucune inclinaison). Conséquence : **tout ce qui doit se lire est planaire**. Une barre verticale, une colonne montante, une cage se projettent sur un point. Les particules qui montent doivent aussi **s'écarter** ; les arcs se referment **sur le plan du sol**.
2. **Une carte CSS3D occupe une case ENTIÈRE et masque tout ce qu'il y a dessous** (`CARD_PX × CSS_SCALE` = 1 unité = 1 case, et le `CSS3DRenderer` rend dans un élément DOM **empilé au-dessus** du canvas WebGL — aucun tampon de profondeur partagé). **Rien de ce qui est dessiné à moins de ~0,5 unité du centre d'une unité n'est visible, quelle que soit sa hauteur `y`** → dômes (rayon 0,9), orbites (0,76), convergences (1,5), sceau de Blocage à `scale: 1.7`.

⚠️ **Corollaire de blending** : `AdditiveBlending` d'une couleur **sombre** n'enregistre presque rien sur un plateau sombre (les rayons de Provocation en `0xc83020` étaient invisibles). Les traits fins passent par `brighten()` de `PowerVfx.ts`.

⚠️ **Corollaire de perf** : `Scene3D._animate` fait du **rendu à la demande** (il saute la frame quand `anims`, `bursts`, `_shake` et `_needsRender` sont vides). Un effet qui doit vivre longtemps se pose **statique** et se retire par un disposer — une animation permanente annulerait cette économie pour tout le combat.

**Cadrage préparation** — le seuil est le même des deux côtés (écran plus large que haut : `useWebLayout` côté React, `aspect > 1` dans `Scene3D._cameraFraming`) et les deux **doivent rester d'accord**, sinon les rails recouvrent le board.

| | Portrait | Web (desktop, tablette, **téléphone en paysage**) |
|---|---|---|
| Main | bande horizontale en bas | rail vertical à gauche |
| Neutralisées | bandeau au-dessus de la main | rail vertical à droite |
| Bloc joueur | remonté à `PREP_FOCUS_Y` (40 %) | centré verticalement |
| Cadrage | les 5 colonnes tiennent en largeur | idem, **moins les deux rails** (`WEB_RAIL_PX` = 208, à garder synchronisé avec le `w-52` des rails) |

## UI et mobile

- **Pointer Events API** sur tous les éléments interactifs (pas de `mousedown`/`touchstart` séparés).
- **Cible tactile ≥ 44 px** (`--spacing-tap`), portée par `Button` et `IconButton`. ⚠️ Le mode **`compact`** d'`IconButton` garde le chip visible à 28 px mais porte bien une cible de 44 px, le `-my-2` empêchant cette cible de faire grandir la ligne.
- ⚠️ **16 px minimum sur toute saisie** (`input, textarea, select` dans `styles/index.css`, en `!important`) : **Safari iOS zoome le viewport** dès qu'un champ passe sous 16 px, et ne redescend pas seul. `user-scalable=no` **ne protège pas** (ignoré depuis iOS 10) et a été retiré, où il ne bloquait plus que le pincer-zoomer là où il *est* honoré. La règle est posée sur l'élément, pas sur chaque champ.
- ⚠️ **Aucun geste natif ne doit concurrencer l'appui long** : `user-select: none`, `-webkit-touch-callout: none` et `-webkit-tap-highlight-color: transparent` sur `<body>`, donc **hérités** par tout l'arbre — HUD React comme cartes CSS3D. Sans ça, l'appui de 500 ms qui ouvre le tooltip déclenche d'abord la sélection (poignées, loupe, menu « Enregistrer l'image »). `Scene3D` les répète sur son canvas et son conteneur CSS3D.
  - **Exception : les champs de saisie** rétablissent `user-select: auto` (sinon plus corrigeables au doigt sur iOS).
  - `touch-action: manipulation` sur les commandes supprime le délai de double-tap ; le canvas garde `touch-action: none`.
- **Tooltip** — instance globale unique (`components/tooltip/TooltipHost.tsx`, pilotée par `uiStore.tooltip`). Tap carte/unité → afficher, tap ailleurs → masquer (géré au niveau de `App`) ; `navigate()` remet `tooltip` à `null`. Mobile-first, **aucune dépendance au hover**.
- ⚠️ **Une `Modal` déclenchée depuis un `Panel` DOIT passer par `createPortal(…, document.body)`** : `Panel` porte `backdrop-blur`, et un `filter`/`backdrop-filter` sur un ancêtre crée un **bloc conteneur** — le `position: fixed` de `Modal` se résout alors sur la tuile et la modale se retrouve enfermée dans une colonne de la grille, boutons rognés. Vaut pour `ConfirmBuy`, `GiftReveal`, `PackContents`, la révélation de palier.
- ⚠️ **Une tuile dense posée dans une `grid` a besoin de `min-w-0`** : le `min-width` d'un item de grille vaut `auto`, elle refuse donc de descendre sous sa largeur de min-content et **débordait l'écran par la droite en portrait** (mesuré : 413 px pour 390 de large), donnant une barre horizontale à tout le document.
- ⚠️ **Un portal monté sur `document.body` n'est pas couvert par le `onPointerDown` du `<main>`** : il doit poser le sien (`hideTooltip`), sinon un tooltip ouvert à l'appui long n'a plus rien pour le refermer.
- **Tout achat passe par une confirmation** (`useBuyConfirm` / `<ConfirmBuy>`, partagés par emplacements, boosters et cosmétiques) : c'est le seul geste du jeu qui débite un solde, il est définitif, et les deux boutons de prix sont côte à côte. La modale montre **le solde qu'il restera**. Le bouton se verrouille pendant l'appel (l'achat n'est **pas** idempotent côté serveur).
- **Icônes et couleurs de monnaie sont définies une seule fois** — `components/ui/currency.ts`, avec la primitive **`<Amount currency value sign />`** comme point de rendu. ⚠️ La table vivait en privé dans `ProgressionStats`, donc illisible de l'extérieur, et les glyphes étaient réécrits à la main dans une vingtaine d'endroits : `--color-tier-5` et `--color-gold` valant la **même** valeur, gold et gemmes sortaient dans la même couleur sur le seul écran qui montre les deux côte à côte. Le module porte aussi `fmt` (`Intl.NumberFormat('fr-FR')`) et **`CURRENCY_BY_WIRE`** (pont entre la clé du joueur `gold` et celle du fil `golds`). 💰 et non 🪙, qui retombe en disque gris.
- **Notifications** définies une fois pour toutes dans les primitives : **`CountBadge`** (pastille verte chiffrée — une valeur dénombrable et actionnable, effacée quand tout est récupéré, **pas** à la visite) et **`NewDot`** (point doré « pas encore vu », effacé à la visite, `localStorage`). La verte prime. Missions, Cadeaux, Arcade, Boutique, Tutoriel et paliers de niveau les partagent. **Rien n'est rendu en invité** (sauf Tutoriel).
- **Les compteurs sont DÉRIVÉS de l'instantané, jamais transmis** : une valeur dérivée qu'on transporte est une valeur qui peut contredire sa source.
- **`components/ui/RewardToasts.tsx` est LE hub de toasts** : missions terminées, paliers hebdo et niveaux gagnés s'y annoncent ensemble, seule l'icône les distingue (🎯 / 🏅 / ⬆). Monté au niveau de **l'App** (la réponse du lot arrive souvent une fois revenu au menu), à la hauteur de `Banner` (`top-16`) pour ne pas recouvrir la barre de PV, et **non interactif** — un toast qui se solde au tap se solderait aussi à côté, en pleine partie, sur un geste destiné au board. ⚠️ Chaque file reste dans **son** store (`missionStore.toasts`, `authStore.levelToasts`).
- `Countdown` (`primitives.tsx`) se rafraîchit **à la minute** : un repère, pas un chronomètre.
- **Pas de styles inline.**

## Fond spatial et logo

`components/ui/SpaceBackground.tsx` + `styles/space.css`. Aucun état de jeu, aucun store, aucune ligne serveur.

⚠️ **Monté UNE FOIS par `App.tsx`, jamais par un écran** : une seule boucle rAF pour tout le jeu, et surtout **le ciel ne se réinitialise pas à chaque navigation**. D'où le `fixed` de la couche (elle ne vit pas dans le `<main>` et ne défile pas).

**Le partage CSS / canvas n'est pas arbitraire** : le vide profond et les deux nébuleuses sont en **CSS** (large et lent → composé par le GPU, sans une frame de JS) ; les étoiles et l'étoile filante au **`<canvas>` 2D** (ponctuel → chacune sa dérive, son scintillement). Les mêmes nébuleuses au canvas coûteraient un remplissage plein écran par image ; les mêmes étoiles en CSS demanderaient un élément par point.

- **Trois sorties de secours, toutes obligatoires** : `prefers-reduced-motion: reduce` → **aucune boucle rAF**, une seule frame ; `LOW_END_DEVICE` (`three/constants.ts`) → moitié moins d'étoiles ; `devicePixelRatio` plafonné à 2.
- ⚠️ **Le `dt` est plafonné à 50 ms** (un onglet revenu au premier plan rend un `dt` de plusieurs minutes) ; `visibilitychange` recale l'horloge.
- **Densité, pas nombre** : une étoile par tranche de surface (`AREA_PER_STAR`), plafonnée. Halo par dégradé **pré-rendu** (une texture par teinte), jamais un disque plat à faible alpha ni un `createRadialGradient` par frame. ⚠️ **Pas de `filter: blur()`** sur les nébuleuses (déjà continues, et c'est l'effet le plus cher sur mobile) : `mix-blend-mode: screen`.
- La **vignette** n'est pas cosmétique : les écrans sont du texte blanc et des boutons fins. `ScreenHeader` reste **opaque** — un `backdrop-filter` y créerait un bloc conteneur qui piégerait les `fixed` de ses descendants. La couche est `aria-hidden` + `pointer-events-none`.

⚠️ **En appli installée, iOS donne un viewport TROP COURT.** Avec `apple-mobile-web-app-status-bar-style: black-translucent`, le contenu est posé à `y=0` mais reçoit la hauteur qu'il aurait eue **sous** la barre d'état : le viewport est trop court de très exactement `safe-area-inset-top`, et il manque **en bas** (mesuré iPhone 16 Pro Max : 62,0 pt pour une encoche de 62 pt). `.space-bg` se prolonge donc de `env(safe-area-inset-top)` — ce qu'un élément `fixed` peut faire sans créer de défilement fantôme —, derrière **`@media (display-mode: standalone)`** (en navigateur le viewport est juste). C'est pour cette media query que le placement vit en CSS et non en Tailwind.

⚠️ **Le même raccourcissement touche tout `min-h-dvh` / `h-dvh`** et n'est compensé que pour le décor : en jeu, `PhaseControls` (`absolute bottom-0`) flotte 62 pt au-dessus du bas réel. **Non traité** — la correction demande de reprendre les ~25 usages de `dvh`.

⚠️ **Le fond du DOCUMENT n'est pas `--color-surface`.** La couche étant `fixed`, tout ce qu'elle ne peint pas laisse voir le canevas (rebond d'overscroll, bande sous l'indicateur d'accueil). Le décor tend au quasi-noir à ses bords (`#080a13` en bas, `#0b0e1c` en haut) là où `#0f1117` est plus clair de 7 points : la bande se lisait comme **une barre grise franche**, permanente en appli installée. `<html>` porte donc un dégradé entre les deux teintes mesurées (`--color-space-edge-top` → `--color-space-edge`), `no-repeat`, adossé à `background-color`. Posé sur `<html>` **seul** — un fond sur `<html>` est propagé au canevas, en poser un second sur `<body>` le repeindrait dans la seule boîte du body.

⚠️ **`--color-space-edge` est MIROITÉE hors CSS**, là où aucune variable ne voyage : `<meta name="theme-color">` (`index.html`) et `theme_color` du manifeste (`vite.config.ts`) — les trois se règlent **ensemble**, sur la teinte **du bas** (Android peint ses deux barres avec une seule couleur). ⚠️ `background_color` du manifeste **reste `#0f1117`** : c'est l'écran de démarrage, il précède l'écran de chargement (`bg-surface`), pas le décor. Deux couleurs, deux moments.

**Logo animé** (`components/ui/AnimatedLogo.tsx`) — boucle de 20 s, trois PNG dans `client/public/logo/` quantifiés à 256 couleurs (**202 Ko** contre 1,6 Mo pour le `logo.png` statique). Il se pose **sur** le décor : fond opaque, vignette et poussières de la composition d'origine retirés, toutes les couches lumineuses en `mix-blend-mode: screen`.

- ⚠️ **Aucun re-render React par frame** : le DOM est monté une fois, la boucle rAF mute les `style` par référence (même geste que `three/`).
- ⚠️ **La première frame est posée SYNCHRONEMENT au montage**, avant la boucle : un onglet ouvert en arrière-plan ne reçoit aucun `requestAnimationFrame` et resterait sur ses styles neutres. C'est aussi cette frame, et elle seule, que voit `prefers-reduced-motion`.
- ⚠️ **Les rayons de `blur()` sont constants** — animer un flou re-rasterise la couche à chaque frame, animer son opacité ne coûte qu'une composition. Même raison pour les volutes coniques, qui **tournent** au lieu de voir leur `conic-gradient` réécrit.
- Deux transforms imbriqués (l'extérieur porte l'échelle, mesurée une fois par `ResizeObserver` ; l'intérieur le balancement). Largeur par `className`, hauteur par `aspect-ratio` — aucune taille écrite deux fois. Fréquences en **multiples entiers de la boucle** (couture exacte) ; braises et runes **semées**.
- ⚠️ **L'écran de chargement garde le `logo.png` statique** : il s'affiche avant que les données soient là. `logo.png` reste la source des icônes PWA.

## Mise à jour de l'appli installée (`app/pwaUpdate.ts`)

Reprendre une PWA depuis les tâches de fond **n'est pas une navigation** : le navigateur n'interroge le serveur pour un nouveau service worker qu'au chargement d'une page ou sur un `registration.update()` explicite. Deux moitiés, et il faut les deux :

| | Déclencheur | Rôle |
|---|---|---|
| **Demander** | `visibilitychange`, `pageshow`, `online`, + une passe horaire | `registration.update()` |
| **Appliquer** | l'écran devient `main_menu` (abonnement `uiStore`) | `skipWaiting` + rechargement |

- ⚠️ **`registerType: 'prompt'`, alors que le rechargement EST automatique** : la différence n'est pas la confirmation, c'est **le moment**. `autoUpdate` pose `skipWaiting` + `clientsClaim` → la nouvelle version prend la main **sous la page en cours** et purge le précache de l'ancienne ; les écrans de jeu étant en `lazy()`, un `import()` parti après la bascule demande un chunk dont le nom a changé, le serveur répond par le fallback SPA, et le navigateur essaie de lire `index.html` comme un module.
- ⚠️ **`injectRegister: null`** : le script injecté par défaut se contente d'un `register()` au chargement — il n'a rien pour interroger le serveur au réveil, ce qui est précisément le trou qu'on bouche.
- ⚠️ **Le rechargement n'a lieu QU'AU MENU PRINCIPAL** : `navigate()` n'écrivant pas dans l'URL, un `reload()` ramène toujours au menu. Recharger en pleine partie perdrait le combat.
- ⚠️ **Le menu ne suffit pas à dire que rien n'est en cours** : le bracket de tournoi vit en mémoire et se perd, or on revient au menu entre deux manches → seconde clause de `isIdle()`.
- **Plancher de 60 s entre deux interrogations** (iOS émet `visibilitychange` à chaque bascule d'appli). Le compteur part **chargé**, `register()` venant d'en faire une.
- ⚠️ **Piège de vérification : changer un commentaire ne fait PAS une nouvelle version** — la minification l'efface, le hash ne bouge pas, `sw.js` est identique et le test passe à vide. Vérifier que `sw.js` a changé avant de conclure.
---

# Outils d'admin et de mesure

## `admin.html` (Card Manager)

Page autonome, **14 onglets**, aucun build. ⚠️ **Aucun test automatisé ne la couvre** (`npm test` est purement client) : la vérification se fait **au navigateur** (Chromium et Playwright préinstallés, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` — ne **pas** lancer `playwright install`).

**Ce qu'il faut mesurer plutôt que regarder** : `document.documentElement.scrollWidth <= clientWidth` (`body { overflow-x: hidden }` **masque** le symptôme), un seul `.main:not(.hidden)` et un seul `#main-tabs .tab.active` par onglet, les chips d'attributs toujours visibles et actifs après un `switchTab()`, et l'échelle réelle des SVG du rapport (`svg.getScreenCTM().a` — un `getComputedStyle` rendrait `11px` même à l'échelle 0,4).

⚠️ **`.tabs` et `.tab` sont RÉUTILISÉS hors de la topbar — c'est le piège du fichier.** Les flèches du pager SQL et les chips de catégorie du sélecteur d'attributs les portent : un `querySelectorAll('.tab')` global les dépouille de leur `.active`, masquer `.tabs` en mobile ferait **disparaître les chips**, et une délégation de clic sur `.tabs` capterait le pager. D'où **`id="main-tabs"` sur la seule barre du haut**, et la règle : **tout sélecteur de navigation — CSS comme JS — passe par cet id.** Le pager a sa propre classe (`.db-pager-btn`).

⚠️ **Le bloc `@media (max-width: 768px)` doit rester le DERNIER de la feuille.** À spécificité égale la dernière règle gagne : posé au milieu du fichier, une douzaine de surcharges mobiles étaient **mortes en silence**. Toute règle desktop se pose **au-dessus** de ce bloc.

- `switchTab` apparie par **`data-tab`**, plus par sous-chaîne de libellé — un libellé se renomme donc librement.
- ⚠️ La bande d'onglets porte `flex-wrap: wrap` : sans lui elle **débordait aussi sur desktop**, et `overflow-x: hidden` **coupait** le dépassement sans laisser de barre (mesuré : à 1280 px, ⚖️ Équilibrage était inatteignable).
- Sur mobile, la bande est remplacée par une **feuille plein écran** (`#tab-sheet`, ☰) dont les entrées sont **clonées depuis `#main-tabs` à chaque ouverture** — une seule liste d'onglets dans le fichier.
- ⚠️ **`viewport-fit=cover` est la condition d'existence de `env(safe-area-inset-*)`** : sans lui les retraits valent `0px` et tout le travail de zone sûre est un no-op silencieux.
- ⚠️ Un `showModal` qui pose une largeur **en ligne** bat la requête média → `min(580px, 96vw)`.
- **Éditeurs répétables** (lots de cadeau, effets de terrain) : ils tiennent un état local (le DOM ne peut pas servir de source de vérité pour une liste dont on retire des éléments au milieu) et un `_sync…Draft()` recopie la saisie **avant** chaque re-render — sans quoi ajouter une ligne effacerait ce qu'on venait de taper.
- ⚠️ **Un `_collect…Fields` qui reconstruit l'objet de zéro détruit tout champ qu'il ne connaît pas.** C'est arrivé à `description` (magies) et à `difficulty` (decks publics). Repartir de `...selectedX`, en s'arrêtant au **premier niveau**.
- Les onglets sans barre latérale (`#tab-db`, Logs PvP, Logs IA) sont chargés **paresseusement** au premier clic et ajoutés à `NO_FAB_TABS`.
- ⚠️ La glose française des motifs / verdicts est **recopiée** dans `admin.html` (`AI_REASONS`, `AI_HAND_SOURCES`, `PVP_KINDS`) : le fichier ne peut rien importer d'un module TS. Un motif ajouté côté TS est à reporter là-bas ; la dérive est bénigne (un motif sans glose s'affiche par son slug).

## Simulation d'équilibrage (`client/src/sim/`)

Répond à « quelle carte est trop forte ? » sans attendre qu'un joueur le dise. **Ne réimplémente RIEN** : pilote une vraie `GameSession` en mode `'ai'` — c'est la partie solo, moins l'animation. Terrain, vétérance, réanimation, règle du doublon, pioches garanties et cimetière viennent gratuitement.

| Fichier | Rôle |
|---|---|
| `logic/Random.ts` | xorshift32 semé, **pur** (aucun import, pas même `node:crypto`) — le seul ajout à `logic/` |
| `sim/catalog.ts` | `data/` s'il existe, sinon `initial-data/` ; empreinte du catalogue |
| `sim/autoPlayer.ts` | Tient le siège du joueur, **via la seule API publique de `GameSession`** |
| `sim/decks.ts` | Decks aléatoires à **couverture de matériaux**, fermeture pour l'A/B |
| `sim/runGame.ts` · `metrics.ts` · `protocol.ts` · `aggregate.ts` | Boucle, agrégation (Wilson), les deux passes, agrégats |
| `sim/show.ts` · `report.ts` · `run.ts` | Émission parlée, forme JSON, CLI |

```bash
cd client && npx vite-node src/sim/run.ts -- --games=60000 --ab-top=20 --seed=2026-08-24
```

⚠️ **Depuis `client/`, jamais `npx --prefix client` depuis la racine** : `--prefix` ne déplace que la résolution du binaire, le cwd reste la racine et vite-node cherche un `src/sim/run.ts` qui n'y est pas.
⚠️ **`vite-node` et non `node`** : `logic/` est en ESM TypeScript avec des imports en `.js`. Il arrive avec vitest — **aucune dépendance nouvelle**. Le module vit sous `client/src/` pour être couvert par le lint et `tsc` ; rien ne l'importe, il n'entre dans aucun bundle.

**Le hasard est SEMÉ** : `rand` est une dep injectée, défaut `Math.random` — **aucun appelant existant ne change**. Quatre points de branchement : `Draw.drawHand`, le constructeur d'`EnemyAI`, `GameSessionDeps.rand`, et le **terrain** (`BoardPicker`). ⚠️ À **exactement un appel par combat**, au même point du flux qu'avant : un appel de plus décalerait toutes les pioches et tous les choix d'IA qui suivent.

**Les trois constats qui commandent le protocole** :
1. ⚠️ **Le siège n'est pas neutre** — à égalité totale d'initiative, de vitesse et de `card_id`, le tri stable laisse le joueur frapper le premier : **61 % pour le côté A sur un miroir strict**. Le départage par `card_id` porte le déterminisme PvP, on n'y touche pas : on joue **chaque appariement dans les deux sens** et on ne mesure que le siège du joueur.
2. ⚠️ **Appartenir au deck n'est pas être posée** — sans filtre de couverture, **130 cartes sur 653 ne sont jamais posées** en 1000 parties. Le dénominateur d'un winrate est donc le nombre de parties où la carte a été **posée**.
3. ⚠️ **1000 parties par jour ne mesurent rien** (46 poses par carte en médiane, ±14 points). Il faut ~2400 observations pour ±2 points, soit ~60 000 parties — 11 minutes.

⚠️ **`ENEMY_HANDICAP` est un instrument de mesure, pas un réglage de difficulté** (l'auto-joueur battait `EnemyAI` 80 % sur un miroir strict, où tout se tasse contre le plafond) : **il doit rester FIGÉ** d'un jour sur l'autre, sinon le rapport d'hier devient incomparable — et c'est le diff qui fait tout l'intérêt de la routine. Le rapport publie la ligne de base réalisée : si elle dérive à handicap constant, c'est le jeu qui a bougé.

**Deux passes, qui ne disent pas la même chose** :

| Passe | Ce qu'elle fait | Ce qu'elle vaut |
|---|---|---|
| **Détecteur** | ~60 000 parties, decks aléatoires couvrants, les deux sens | **Signale.** Le winrate y reste contaminé par le deck porteur |
| **A/B** | Deck témoin figé, un seul slot qui change | **Tranche.** Le seul chiffre qui isole la carte |

Mesuré : Ra le Dragon Ailé ressort à **+35,9 pt** au détecteur et **+8,3 pt** en A/B — l'écart **est** le biais de deck. L'A/B ne part **que des lignes significatives** ; le témoin est construit **autour** de la carte (`materialClosure`), le bras « sans » est le même deck moins elle ; la carte évincée n'est jamais un matériau dont une autre dépend ; une carte qu'on ne peut pas rendre invocable est **« non testable »**, jamais dotée d'un chiffre qui ne mesure rien.

**Ce qu'un chiffre a le droit d'affirmer** :
- ⚠️ **Intervalle de Wilson**, jamais l'intervalle normal : ce dernier rend une largeur **nulle** sur un taux de 0 ou 1, et une carte posée trois fois et gagnante trois fois passerait pour une certitude.
- ⚠️ **Le classement trie par l'écart amputé de son incertitude** (`effectSize`). Trier par |Δ| brut remonte en tête les cartes posées une seule fois : +50 points d'écart, ±40 d'intervalle qui dit exactement qu'on n'en sait rien.
- ⚠️ **Les dégâts sur la durée ne sont pas attribués au lanceur** : l'événement `dot` ne nomme pas sa source, et élargir le contrat d'événements de `logic/` casserait les golden tests. Ils sont comptés au débit de la victime, et le rapport le dit.

**Consultation `/admin/sim`** — runs dans `DATA_DIR/sim-reports/<AAAA-MM-JJ>.json` (le **volume**, donc l'historique survit au déploiement et le diff avec hier est gratuit). Écriture atomique, rétention 30 jours purgée **à l'écriture**.
- ⚠️ La date compose un **nom de fichier** : garde stricte `^\d{4}-\d{2}-\d{2}$`. Et `/latest` est enregistré **avant** `/:date`, qui le capturerait sinon.
- ⚠️ **Le rapport ne transporte que des agrégats par carte** (~200 Ko, plafond `/api` à 1 Mo) : aucune ligne par partie n'y entre jamais (verrouillé par golden test).
- `sim-report.html` (racine) est une page autonome, affichée par l'onglet ⚖️ Équilibrage dans une **iframe** sur `/admin/sim?embed=1&theme=dark`, chargée au **premier clic**. ⚠️ **Une iframe et non un inline** : le fichier redéfinit `--surface`/`--border`/`--muted` en **clair**, style `*`, `body`, `h1`, `a`, `svg`, `table`, et son bloc `select, input, button` repeindrait **tous** les onglets de l'admin ; il déclare aussi un `esc()` global qui écraserait celui d'`admin.html` (la seconde déclaration gagne pour **les deux** fichiers). Le défilement imbriqué est ici un **avantage** — le `th { position: sticky }` colle au viewport du cadre.
- Le contrat tient en deux paramètres d'URL, lus par un script du **`<head>`** (depuis `<body>` on verrait un éclair de thème clair) : `theme=dark|light` pose `data-theme`, `embed=1` masque titre et lien de retour.

**La routine** (`.github/workflows/balance-sim.yml`) — cron quotidien + `workflow_dispatch`.
- ⚠️ **Les trois secrets (`SYNC_URL`, `ADMIN_USER`, `ADMIN_PASS`) sont des secrets de DÉPÔT, jamais d'environnement**, et le job ne porte volontairement aucun `environment:` : un nom qui ne correspond à rien est **créé à la volée, vide**, si bien que `${{ secrets.X }}` rend une chaîne vide sans la moindre erreur ; et une règle de protection laisserait le cron nocturne en attente d'approbation indéfiniment.
- ⚠️ **Le `sync-data.js pull` en tête n'est pas optionnel** : le runner clone le dépôt, donc `initial-data/` — le catalogue joué vit dans `data/`, gitignoré. Sans ce pull la routine mesure un catalogue périmé.
- ⚠️ **Le cron GitHub est en UTC** (l'heure de Paris visée et l'offset retenu sont écrits dans le fichier). L'artifact part `if: always()`.

**L'émission** (`sim/show.ts`) — chronique parlée de 5–6 min lue par la voix du navigateur (Web Speech API : aucune dépendance, aucune clé, aucun coût) ; le script voyage dans le rapport. Six catégories : trop fortes / trop faibles / **injouables** (en deck et jamais invoquée — un problème de constructibilité, pas de puissance) / sous-estimées (gagne, posée < 35 %) / pièges (perd, posée > 60 %) / bien réglées.
- ⚠️ **Sous-estimée et piège sont des LENTILLES, pas des cases** : une carte peut être à la fois trop forte et sous-estimée — c'est l'information la plus actionnable qui soit.
- ⚠️ **Elles exigent la significativité** : sans ce filtre, le segment citait « posée dans 100 % des parties, pour 0,0 % de victoires » sur une carte vue **une** fois. Le seuil de « bien réglée » est **relatif** (médiane des poses) : en dur, il vide le segment sur un petit run et le noie sur un grand.
- ⚠️ **Un agrégat par attribut n'est PAS un winrate d'attribut** : une carte porte jusqu'à quatre attributs, et le chiffre reste **corrélationnel**. L'émission le dit à voix haute.
- **Écrit pour être DIT** : pas de `Δ`, pas de `±`, pas de `+35.9pt` (un moteur vocal les rend de façon imprévisible d'une voix à l'autre). On dit « 35,9 points au-dessus de la moyenne », « le test A B », la date en toutes lettres.
- ⚠️ **Aucun chiffre n'est inventé, et c'est VÉRIFIÉ** : tous les formateurs enregistrent ce qu'ils produisent et `show.test.ts` exige que chaque nombre **prononcé** soit passé par l'un d'eux (`silently()` pour le reste). Le test a dû être resserré deux fois — comparé à « tous les taux du rapport », l'ensemble des pourcentages à une décimale est **saturé** par 550 cartes. ⚠️ Pour l'éprouver, injecter le faux chiffre dans une branche **réellement exercée** par le run.
- **Cinq pièges de `speechSynthesis`, tous traités** : `getVoices()` est asynchrone (`voiceschanged`) ; Chrome **tronque** une énonciation longue (d'où le découpage phrase par phrase, qui sert aussi au surlignage et au chapitrage) ; la lecture démarre sur un **geste utilisateur** (Safari iOS exige un appel synchrone) ; `cancel()` sur `pagehide` et `visibilitychange` ; **aucune voix installée** est un cas réel — le bouton se désactive en **disant pourquoi**. Un `resume()` périodique contourne la suspension de Chrome.

**Périmètre assumé** : **ni magies ni Phase Shopping** (il faudrait une politique de magies pour l'IA, qui n'existe nulle part — c'est de la nouvelle IA de jeu, et une mauvaise politique fausserait le verdict sur les cartes). Les **terrains** sont dedans, et **choisis**. L'adversaire est `EnemyAI`, constante et plus faible que l'auto-joueur : les cartes sont comparées **entre elles**, jamais à un absolu.

⚠️ **Trois fois, la ligne de base a fait un PAS le jour d'un changement de règle** (terrain sélectif, rétention de main de l'IA, choix des matériaux). Le « Δ hier » de ces jours-là dit « la règle a changé », pas « le jeu a dérivé » — c'est la seule lecture juste, et elle ne se devine pas après coup.

## Labo IA (`?screen=ailab`)

Répond à « pourquoi l'IA n'a pas joué cette fusion ? ». Écran `dev/AiLab.tsx`, pilote pur `dev/aiLabRun.ts`, dépôt `ailog.js` + `routes/admin-ailog.js`, onglet 🧠 Logs IA.

Il existe parce que `EnemyAI` **n'émettait rien**, et surtout parce que son `_tryPlace` avait une quinzaine de `return null` **tous indiscernables**. C'est le préalable à des comportements par difficulté : on ne diversifie pas un comportement qu'on ne sait pas constater.

**`_tryPlace` est devenu `_attempt`**, qui rend `{ unit, cell, consumed, option_index }` ou `{ unit: null, reason, detail }`. Motifs (slugs stables) : `board_full`, `duplicate_on_board`, `no_free_cell`, `not_enough_material`, `would_exceed_slots`, `missing_material` (le matériau **nommé**), `material_outranks_result`, `all_conditions_failed`.

- ⚠️ **L'observateur est un PARAMÈTRE, jamais un état d'instance** : `drawHand(round, trace)`, `placeFromHand(board, max, graveyard, trace)`, `rearrangeUnits(board, max, trace)` l'appellent en `trace?.(event)` — une fonction nue, donc aucun import neuf et `logic/` ignore qu'un écran l'observe (même geste que `deps.rand`). **Il n'y a pas de `setTrace()`** : une partie réelle ne peut structurellement pas se retrouver tracée par un sink oublié sur l'objet.
- ⚠️ **Addition de métadonnées, rien d'autre** : aucune condition, aucun ordre, aucune case ne change. La suite passe **sans une seule mise à jour de snapshot**.
- ⚠️ **Le pilote est PUR** (aucune dépendance React/Zustand/Three/DOM) et ne réimplémente **aucune** règle : une seconde copie finirait par ne plus dire la même chose que celle qui est jouée, ce que le labo existe pour constater.
- ⚠️ **Les `uid` sont renumérotés en index LOCAUX au run** (`canonicaliseUids`) : `Unit.uid` sort d'un compteur de module et grandit sur toute la vie de l'onglet — deux exécutions du même scénario rendaient deux traces impossibles à differ. Même leçon que `CombatRecorder`.
- Un run multi-rounds n'est qu'une **liste** de `AiLabRound` : le `board_after` de l'un devient les `survivors` du suivant, aucun état caché.
- ⚠️ **`runAiPlacement` prend DEUX champs pour la main, et ils ne sont pas exclusifs** : `hand` (ce que l'IA tient déjà) et `draw` (piocher les 5 cartes du round **par-dessus**). Le pilote ne savait faire que l'un ou l'autre, donc à partir du round 2 **l'IA ne tirait plus une seule carte** — le labo montrait l'exact **contraire** de la rétention de main qu'il servait à observer. D'où `hand_source` à **trois** valeurs (`draw`, `manual`, **`carry_draw`** — le cas normal dès le round 2) et `hand_carried` à côté de `hand`. ⚠️ Ce qu'on tient ne décale pas le flux semé (verrouillé par golden test).
- **Grille 5×4, la seule zone de l'IA** (rangées 7–10, gardant leurs **numéros réels**), **pas de `Scene3D`** — c'est ce qui permet d'annoter chaque case (quelle passe l'a posée, quels matériaux ont été consommés), précisément ce qu'un board 3D ne sait pas montrer.
- ⚠️ **Toute édition d'entrée efface le RÉSULTAT affiché** (`editInputs`) : la grille rend `board_after`, donc un survivant ajouté ensuite serait invisible et deux matériaux ajoutés à la suite atterrissaient sur la même case.
- **La main affichée suit le même partage que la grille** : après un « Placer » elle rend `hand_left` — les cartes posées en disparaissent —, sans rien recopier dans l'entrée, donc retaper « Placer » rejoue le même round. C'est `nextRound` qui reporte le reliquat, et lui seul.
- ⚠️ **Retoucher ce reliquat COUPE la pioche** (`handAfterEdit`) : `drawHand` ajoute à la main et le tirage est semé sur (graine, round) — figer le reliquat pioche armée ferait retomber les mêmes cinq cartes par-dessus, et l'IA délibérerait sur des doublons qu'elle n'a jamais tenus. Une main **vidée** ne fige rien et garde la pioche, sinon « Vider » rendrait le round injouable.
- **Le dépôt est ADMIN, pas joueur** (`POST /api/admin/ai-logs`) : un run de labo ne peut venir que de l'écran de dev — ni match à vérifier, ni rôle à usurper, ni quota. ⚠️ Les colonnes de liste sont **dénormalisées à l'insertion** : la liste ne parse **jamais** un payload (contrairement à `pvplog.list`). Aucun `diff` : il n'y a qu'un point de vue — ce qui remplace le verdict, c'est le compte de refus **par motif**.

⚠️ **Deux leçons de vérification, valables pour tout écran du projet :**
1. **Sur un écran, la seule preuve est le PIXEL.** Le labo a été livré intégralement invisible (racine sans `z-10`, recouverte par `.space-bg`) et ce défaut est **indétectable à l'inspection du DOM** : `innerText` rend le texte, les boîtes ont leurs vraies dimensions, `scrollWidth <= clientWidth` passe au vert, et `.space-bg` étant `pointer-events: none`, même `elementFromPoint` désigne le bon élément. L'écran était parfaitement mesurable, parfaitement tapable, et parfaitement invisible.
2. **Et il faut LIRE le pixel, pas seulement le capturer.** Une note affichée sous la main disait, en toutes lettres, « L'IA écrase sa main à chaque pioche » — vraie quand elle a été écrite, fausse depuis, et lue par-dessus l'épaule du joueur au moment précis où il cherchait à vérifier le contraire. Aucun test, aucun `innerText`, aucune mesure ne peut attraper une phrase juste qui a cessé d'être vraie.

## TestBench (`?screen=testbench`) et CombatLab (`?screen=combatlab`)

`TestBench` réutilise `Scene3D` + `CombatAnimator3D` directement, sans `GameController` : placement libre pour les deux équipes (pas de règles d'invocation, pas de main, pas de deck), filtre par coût d'invocation, suppression au clic droit / appui long, board inspector live, bouton Pause, **sélecteur de terrain manuel** (cases visibles immédiatement, effets appliqués au lancement, bouton ℹ). Pas de tours, pas de PV joueur, pas de multiplicateur.

`CombatLab` déclenche les 14 pouvoirs à la main, en passant par le **vrai** `_apply` de l'animateur.

---

# Tests

`npm test` = vitest, **en node SANS DOM**. ⚠️ **Aucun test de composant n'est possible dans ce projet** — c'est ce qui explique que toute décision testable vive dans une **fonction pure** (`data/tutorialScript.ts`, `data/SummonInfo.ts`, `data/BoardInfo.ts`, `logic/MagieOffer.ts`, `logic/BoardPicker.ts`, `dev/aiLabRun.ts`, `sim/show.ts`). Le rendu se vérifie **au navigateur**.

| Harnais | Usage |
|---|---|
| `test/helpers.ts` | Combat et unités (`refUnit` clé sur `(owner, card_id)`, jamais l'`uid`) |
| `test/http-harness.ts` | Démarre `app.js` sur un port éphémère (pas un `*.test.ts`, donc jamais collecté seul) |
| harnais serveur de `shop.test.ts` | `createRequire`, `DATA_DIR` temporaire, env posées **avant** le premier `require` |

- **Aucun catalogue n'est recopié à la main** : `bootstrap()` peuple un `DATA_DIR` vide depuis `initial-data/`, par le code de production lui-même. Les tests qui portent **sur** un catalogue écrivent le leur (`arcade.test.ts` son `public_decks.json`, `gifts.test.ts` ses `gifts.json`/`sets.json`, `packs.test.ts` réécrit `sets.json`).
- ⚠️ **`ILLUS_DIR` doit être un ENFANT d'une racine à nous** : `asset-dirs.js` déduit les trois autres familles de `path.dirname(ILLUS_DIR)` — le poser dans `os.tmpdir()` ferait pondre `$TMPDIR/enemy_avatars`, partagé entre fichiers de tests et avec la machine du développeur. C'est aussi ce qui donne un « au-dessus d'`ILLUS_DIR` » propre pour le test de traversée.
- Les tests de boutique/cosmétiques/paliers déposent de **vrais PNG** dans un `ILLUS_DIR` temporaire : sans art, les pools sont vides et les fichiers ne prouveraient rien. `levels.test.ts` laisse une carte volontairement **sans art** — elle ne doit jamais tomber.
- ⚠️ **`http-boot.test.ts` est un fichier SÉPARÉ, et pas par goût** : les modules racine sont chargés par `createRequire`, donc mis en cache par Node, et `vi.resetModules()` ne vide pas ce cache. Un second `require('app.js')` dans le même fork rendrait l'export mémorisé sans rejouer la garde. Vitest donne un processus par fichier (`pool: 'forks'`) — c'est la seule isolation qui marche.
- ⚠️ **Le test de traversée passe par `node:http`, pas par supertest** (helper `raw()`) : un client de plus haut niveau ré-analyse l'URL et peut réécrire `..%2F`.
- ⚠️ **Un refus ne se prouve JAMAIS par un code de statut seul** — un 401 sur une URL mal orthographiée en rendrait un aussi. Chaque test vérifie l'**état** après coup : la ligne en base, le fichier sur le disque, le catalogue inchangé.
- ⚠️ **Un test de régression doit être éprouvé DANS LES DEUX SENS** : vert sur le code corrigé, **rouge** sur le comportement d'avant réintroduit exprès. Un test qui passe aussi sur la faille ne vaut rien, et c'est invérifiable après coup.
- ⚠️ `arcade-store.test.ts` et `prep-undo-events.test.ts` sont les **seuls tests de store** : ce qu'ils éprouvent (l'ordre d'arrivée de deux réponses HTTP, une file d'événements) ne se voit pas côté serveur. `window.location` et l'utilisateur y sont posés à la main.
- ⚠️ `pvp-connection.test.ts` pose `WebSocket` et `location` à la main, et le module étant **singleton**, chaque cas fait un `vi.resetModules()`.
- **Le filet de déterminisme PvP** (`pvp-determinism.test.ts`) ne teste pas une cause, il teste l'**invariant** : deux `GameSession` complètes, l'une dans le repère de référence et l'autre dans son miroir, jouent le **même combat physique** et doivent rendre le même log canonique. 300 combats semés + un cas d'égalité parfaite en goulet + une forme **multi-rounds** (trois rounds, vrai aller-retour réseau, une résurrection après chaque combat). ⚠️ C'est ce qui l'a fait attraper **six des huit** causes de divergence, y compris celles que personne n'avait nommées.
  - ⚠️ Il fait passer les cases bloquées par une **vraie `GameSession`** de chaque rôle, jamais par un miroir écrit à la main : sinon il ré-implémenterait la correction au lieu de l'exercer, et resterait vert avec le miroir retiré (constaté).
  - ⚠️ La **résurrection** est indispensable : sans elle le filet reste vert avec la correction retirée (les morts resteraient morts).
  - ⚠️ Les 300 graines ne peuvent **pas** produire l'égalité parfaite (elles nomment les cartes par leur camp, `card_id` tranche toujours) — d'où le cas du goulet, qui a besoin d'une **course** pour que l'ordre d'action se voie.
  - ⚠️ **Piège du harnais** : le champ de la carte est `power.power_speed`, pas `power.speed`. Écrit `speed`, le pouvoir hérite du `9999` d'`Unit` et **aucun** pouvoir ne part — les 300 graines ont tourné un temps avec des pouvoirs muets.

---

# Règles de conception

**Logique ≠ Visuel.** `logic/` ne manipule aucun DOM, n'importe aucun composant, ne contient aucun `requestAnimationFrame`. L'UI ne contient aucune logique de combat, d'attribut ou d'invocation.

**Le board est la source de vérité.** Ne jamais déduire une position depuis un élément DOM. Des bugs ont découlé de désynchronisations entre `unit.position`, `board.grid` et la position DOM.

**Une règle n'existe qu'à un endroit.** Si le ciblage et la pertinence posent la même question, elles appellent la même fonction. Une règle recopiée à deux endroits est une règle qu'on corrige à un seul.

**Préférer** : systèmes simples · comportement déterministe · design data-driven · UX mobile-first · UI en composants réutilisables.

**Éviter** : hasard caché · state machines complexes · logique visuelle mélangée à la logique de jeu · styles inline.
