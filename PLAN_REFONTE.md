# PLAN_REFONTE.md — Refonte Millenium (Vite + React + TS + Tailwind + Zustand)

> Statut : **validé le 2026-07-24 — décisions D1–D9 tranchées (voir §6), prêt à implémenter**.
> Audit initial du 2026-07-24, révisé après restauration du dépôt (D1) : l'ancienne UI 3D a été récupérée, la Phase 2 est un **portage** et non plus une réécriture.

---

## 1. Audit de l'existant

### 1.1 État réel vs CLAUDE.md — constats majeurs

**✅ Constat n°1 (résolu par D1) — la couche UI, un temps supprimée localement, a été restaurée depuis le dépôt.**
`game/ui/` contient à nouveau les 16 fichiers (~8 600 lignes) : composants `Board3D.js` (1 792 l.), `CombatAnimator3D.js` (288 l.), `HandUI.js`, `Tooltip.js`, `UnitCard.js`, et les écrans `GameScreen3D.js` (2 223 l.), `TestBench3D.js`, `MainMenu.js`, `DeckSelector.js`, `DeckBuilder.js`, `AuthScreen.js`, `OnlineLobby.js`, `TournamentScreen.js`, `ProfileScreen.js`, `FriendsScreen.js`, `ResetPasswordScreen.js`.

Conséquence : la Phase 2 est un **portage** de `Board3D`/`CombatAnimator3D` vers `three/` (npm), pas une réécriture d'après spec. Et l'ancienne app est **exécutable** : elle sert de baseline visuelle et comportementale pour comparer côte à côte pendant toute la migration.

**✅ Constat n°2 (résolu par D1, un reliquat).** `index.html`, `package.json`, `node_modules/` sont restaurés, le projet démarre. Reste absent : `initial-data/` (référencé par le bootstrap de [server.js](server.js) — sans impact en local puisque `data/*.json` existe, mais un déploiement neuf ne s'auto-amorcerait pas). À vérifier sur le remote ou reconstituer depuis `data/` (Phase 0).

**✅ Constat n°3 (résolu par D1).** Le projet est rattaché à `github.com/srida/millenium.git`, branche `main` propre. ⚠️ Nettoyage : un dossier parasite `https:/` (artefact d'une commande `git clone` malformée) traîne à la racine — à supprimer en Phase 0.

**⚠️ Constat n°4 — un pan entier du jeu n'est pas documenté dans CLAUDE.md** mais existe dans le code et était câblé dans l'ancienne UI :

| Système | Fichiers | État |
|---|---|---|
| Auth obligatoire au bootstrap | [main.js](game/main.js) (`AuthClient.me()` avant tout écran), [AuthClient.js](game/data/AuthClient.js), [routes/online.js](routes/online.js), [auth.js](auth.js), [db.js](db.js) (SQLite `soulforge.db`) | Backend complet, UI supprimée |
| Sync decks serveur | [DeckRepository.js](game/data/DeckRepository.js) : `pull()`, `flushSync()`, `handleLogout()`, + couleurs/tags de deck | Fonctionnel |
| PvP en ligne 1v1 | [ws/pvpServer.js](ws/pvpServer.js) (matchmaking + relais, zéro logique de jeu), [net/PvpConnection.js](game/net/PvpConnection.js), [net/PvpOpponentProvider.js](game/net/PvpOpponentProvider.js) (miroir `row' = 10 - row`) | Backend + client net OK, écran supprimé |
| Tournoi 8 joueurs | [Tournament.js](game/logic/Tournament.js), [MatchSimulator.js](game/logic/MatchSimulator.js) (résolution headless AI vs AI), [PublicDeckDatabase.js](game/data/PublicDeckDatabase.js), `/api/decks` | Logique OK, écran supprimé |
| Amis / profil / reset password | routes `friends/*`, `profile/*`, `auth/forgot-password` | Backend OK, écrans supprimés |

Le plan doit trancher le sort de ces systèmes (voir Décisions D2/D3). Le déterminisme du combat est **une exigence PvP**, pas seulement esthétique : chaque client simule le combat localement et les résultats doivent converger (cf. tie-break par `card_id` dans [CombatManager.js:74](game/logic/CombatManager.js:74)).

**Constat n°5 — CLAUDE.md est en retard sur la logique.** Écarts relevés (le code fait foi) :
- Pouvoirs réels : les 9 documentés **+ `POWER_BURN`, `POWER_CONFUSION`, `POWER_FREEZE` (case gelée temporaire via `Board._temporaryBlockedCells`), `POWER_TAUNT`, `POWER_TELEPORT`**, mécanique `is_effect_immune` (attribut `effect_immunity`).
- Événements de combat réels : `move`, `attack`, `power`, `dot`, **`freeze`**, `death`, `combat_end` ; `stat_change` est émis par [AttributeManager.js:176](game/logic/AttributeManager.js:176) (pas par CombatManager).
- Système de **vétérance** non documenté : `veterancy_points` sur Unit, seuil 2, +2 ATK / +15 HP par point ([AttributeManager.js:16-18](game/logic/AttributeManager.js:16)), transmission au max (pas en somme) lors des invocations composites.
- Magies supplémentaires : `destroy_unit` ; attribut `shopping_bonus` → `player_extra_shopping_magies` ; `_shopping_bonus` persistant par unité transmis aux invocations composites.
- Timeout de combat : `MAX_COMBAT_TICKS` (≈333 ticks = 60 s à ×1), winner `'timeout'` → dégâts appliqués aux **deux** camps ([GameState.js:67-73](game/logic/GameState.js:67)).
- `guaranteed_draws` : structure `{ category, attribute }` (pas `{ tier }` seul).

La mise à jour de CLAUDE.md fait partie du plan (Phase 6).

### 1.2 Inventaire `logic/` et `data/`

**`game/logic/` — 14 modules, ~2 700 lignes, état : excellent.**

| Module | Lignes | Rôle | Fuites DOM/timing |
|---|---|---|---|
| CombatManager.js | 503 | step() à événements, pouvoirs, DOT/burn, timeout | ✅ aucune |
| EnemyAI.js | 390 | pioche IA, placement 2 passes, rearrange | ✅ aucune |
| InvocationManager.js | 360 | canSummon/summon, lignée, material_value | ✅ aucune |
| AttributeManager.js | 290 | synergies 3 timings, vétérance, getActiveSynergies | ✅ aucune |
| InvocationRules.js | 290 | isPlayable, validCells, candidats matériaux | ✅ aucune |
| Unit.js | 167 | modèle runtime complet | ✅ aucune |
| Board.js | 147 | grille col-major, blocked cells + freeze temporaire | ✅ aucune |
| GameState.js | 146 | phases, HP, multiplicateurs, carry-over | ✅ aucune |
| PathFinder.js | 146 | BFS, Bresenham LOS, ciblage | ✅ aucune |
| MatchSimulator.js | 119 | partie complète headless (tournoi) | ✅ (rAF cité en commentaire uniquement) |
| MagieEffect.js | 114 | labels + application des 14 types | ✅ aucune |
| Tournament.js | 100 | bracket 8 joueurs | ⚠️ importe `data/` (voir note) |
| Draw.js | 23 | tiersForRound, drawHand | ✅ aucune |
| BoardEffect.js | 22 | effets de terrain | ✅ aucune |

Chasse aux fuites (`document`, `window`, sélecteurs, `setTimeout`, `setInterval`, `requestAnimationFrame`, `innerHTML`) : **zéro occurrence dans `logic/`**. La règle « Logique ≠ Visuel » a été tenue. Deux dépendances implicites à noter :
- `Tournament.js` importe `PublicDeckDatabase` et `DeckRepository` (couche data → fetch/localStorage). C'est la seule entorse « logic importe data » ; à casser lors du portage (injection des decks en paramètre de `createTournament`).
- `Unit.js` a un compteur module-level `_nextUid` — inoffensif en solo, mais état global à connaître pour les tests (réinitialisation entre runs) et le PvP.
- RNG : `Math.random` uniquement dans la pioche (`Draw.js`, `EnemyAI.js`), le tirage terrain/magies (`data/`), le tie-break tournoi et le shuffle de bracket. **Le combat lui-même est 100 % déterministe** (aucun RNG dans CombatManager/PathFinder/AttributeManager).

**`game/data/` — 8 modules, ~450 lignes.** Couplés au navigateur par nature (fetch, localStorage/sessionStorage) : c'est leur rôle. `DeckRepository` est plus riche que documenté (sync serveur, couleurs, tags, `findFreeName`). À porter quasi tels quels.

**`game/net/` — 2 modules.** Singletons propres (WebSocket + buffering de messages). Aucune dépendance DOM hors `location`/`WebSocket`. Portables tels quels.

### 1.3 Ce que `GameScreen3D` mélange (confirmé sur le fichier restauré) et qui doit être extrait

[GameScreen3D.js](game/ui/screens/GameScreen3D.js) (2 223 lignes) mélange effectivement orchestration et rendu : `setInterval` pour le timer de préparation (l.217) et l'auto-résolution du shopping (l.1705, l.2071), `setTimeout` pour les enchaînements visuels, Phase Shopping complète (`_startShopping` l.1646, `_applyChosenMagie` l.1737, `_defuseFusion` l.1802), résultat de round (`_showEndRound` l.1909). Dans la refonte, ces responsabilités **ne retournent pas dans un composant écran** :

| Responsabilité (ex-GameScreen3D) | Destination cible |
|---|---|
| Orchestration de partie (tours, phases, timer 60 s, lancement combat) | `GameSession` (classe TS sans React ni Three) + `gameStore` |
| Phase Shopping (`_startShopping`, `_applyChosenMagie`, `_defuseFusion`, bannières) | `ShoppingController` (logique) + composants React dédiés |
| Résultat de round / fin de partie (`_showEndRound`) | composants React (`EndRoundOverlay`, `GameOverScreen`) |
| Tirage du terrain (`BoardDatabase.getRandomBoard()` à chaque combat) | `GameSession.startCombat()` |
| Consommation des `player_hand_modifiers` | `GameSession` / logique de main |
| Rendu 3D + animations | `three/` (Scene3D, CombatAnimator3D) |

### 1.4 Décision TypeScript pour `logic/`

Trois options évaluées :

1. **Migration TS immédiate et totale** — risque : réécrire 2 700 lignes de règles subtiles (lignées, material_value, vétérance) en même temps qu'on change de toolchain. Toute divergence casse potentiellement le PvP déterministe.
2. **`allowJs` progressif** ✅ **recommandé** — Phase 1 : copie **byte-for-byte** de `logic/` et `data/` en `.js` sous Vite (`allowJs: true, checkJs: false`), + fichier `src/logic/types.ts` (types `Card`, `Unit`, `CombatEvent`, `Magie`, `AttributeDef`, `BoardDef` — utilisés par le code React/three neuf). Les tests de non-régression (voir Phase 1) sont écrits **avant** toute conversion. Ensuite, conversion mécanique module par module (un module = un commit = suite de tests verte), en commençant par les feuilles (Draw, BoardEffect, PathFinder, Board) et en finissant par CombatManager/InvocationManager.
3. **Pas de TS du tout sur `logic/`** — rejeté : on perd le principal bénéfice de la refonte (contrats typés entre logique, stores et rendu), et les événements de combat sont exactement le genre d'union discriminée où TS paie.

Justification du choix 2 : le gel byte-for-byte donne une baseline de déterminisme **prouvable par test**, complétée depuis D1 par l'ancienne app exécutable comme référence comportementale ; la conversion TS se fait ensuite sous filet. **→ Tranché : option 2 (D4).**

---

## 2. Architecture cible

### 2.1 Layout dépôt

Monorepo simple à deux paquets, sans workspace tooling lourd (contrainte MBP 2015) :

```
Millenium/
├── server.js, auth.js, db.js, routes/, ws/, admin.html   # backend inchangé
├── initial-data/                                          # à restaurer depuis le repo distant
├── client/                                                # ← nouveau projet Vite
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts            # proxy /api, /ws, /illustrations → :3000 en dev
│   ├── tsconfig.json             # strict, allowJs (phase 1)
│   ├── public/
│   │   ├── icon-192.png, icon-512.png
│   └── src/
│       ├── main.tsx              # bootstrap (auth gate) + mount React
│       ├── app/
│       │   ├── App.tsx           # switch d'écran piloté par uiStore
│       │   └── ScreenRouter.tsx  # mapping screen → lazy component (parité ?screen=)
│       ├── logic/                # ⛔ n'importe JAMAIS react/zustand/three (règle ESLint)
│       │   ├── (14 modules portés) + GameSession.ts + ShoppingController.ts
│       │   └── types.ts
│       ├── data/                 # databases + DeckRepository + AuthClient (portés)
│       ├── net/                  # PvpConnection, PvpOpponentProvider (portés)
│       ├── stores/
│       │   ├── gameStore.ts      # partie en cours
│       │   ├── deckStore.ts      # decks + deckbuilder
│       │   ├── uiStore.ts        # navigation, tooltip, overlays, toasts
│       │   └── authStore.ts      # session utilisateur (si D2 validée)
│       ├── three/                # ⛔ n'importe jamais react ; consomme logic/
│       │   ├── Scene3D.ts        # canvas WebGL + CSS3DRenderer, render loop, dispose
│       │   ├── BoardView3D.ts    # grille, cases, highlights, cases bloquées
│       │   ├── UnitView3D.ts     # mesh/carte d'une unité, barre de vie, jauge
│       │   ├── CombatAnimator3D.ts # consomme CombatManager.step() via rAF
│       │   ├── DragController.ts # Pointer Events → picking → logique
│       │   └── assets.ts         # textures, materials partagés, caches
│       ├── components/
│       │   ├── ui/               # design system : Button, Panel, CardFrame, Gauge,
│       │   │                     # Banner, Modal, Timer, StatChip, IconButton
│       │   ├── hud/              # HpBar, RoundIndicator, MultiplierBadge, PhaseControls,
│       │   │                     # SpeedToggle, SynergyPanel
│       │   ├── hand/             # HandBar, HandCard, HandModifierBadge
│       │   ├── shopping/         # ShoppingOverlay, MagieCard, TargetPicker, GraveyardPicker
│       │   ├── tooltip/          # TooltipHost, CardTooltip, UnitTooltip, TerrainTooltip
│       │   └── board/            # Board3DCanvas.tsx (seul pont React→three)
│       ├── screens/
│       │   ├── MainMenu.tsx, GameScreen.tsx, DeckSelector.tsx, DeckBuilder.tsx,
│       │   ├── TestBench.tsx, GameOverScreen.tsx
│       │   └── (post-slice : AuthScreen, OnlineLobby, TournamentScreen, …)
│       ├── styles/
│       │   └── index.css         # @import tailwind + tokens (@theme)
│       └── test/
│           ├── fixtures/         # scénarios de combat scriptés + golden events JSON
│           └── *.test.ts         # Vitest
└── CLAUDE.md                     # mis à jour en Phase 6
```

- **Dev** : `npm run dev` dans `client/` (Vite, port 5173) + `node server.js` (port 3000) ; `vite.config.ts` proxifie `/api`, `/illustrations`, `/ws/pvp` (ws: true).
- **Prod** : `vite build` → `client/dist/` ; `server.js` remplace `GET /` + `/game` statique par `express.static(client/dist)` (fallback SPA). Seule modification backend tolérée.

### 2.2 Flux de données

```
API Express ──fetch──▶ data/ (caches mémoire, inchangés)
                           │ init() au bootstrap
                           ▼
                    GameSession (classe logique : Board, GameState,
                    graveyards, main, CombatManager, AttributeManager)
                     │                                    │
        snapshots/événements                       objets vivants (Board, Unit[])
                     ▼                                    ▼
              stores Zustand  ◀──── sync ciblée ────  three/ (Scene3D + CombatAnimator3D)
                     │                                    ▲
                     ▼                                    │ picking / drag
              composants React ── actions (place, sell, startCombat…) ──▶ GameSession
```

Principes :
- **`GameSession` est la source de commande unique.** React n'appelle jamais `board.placeUnit` directement ; il appelle `session.placeCard(cardId, pos)` qui valide via `InvocationManager` puis notifie store + scène.
- **Les stores contiennent des snapshots immuables** (nombres, ids, positions copiées), jamais les objets `Unit`/`Board` mutables — sinon Zustand ne détecte pas les changements et React lit des données qui mutent sous lui. Un `syncFromSession(session)` recopie ce dont le HUD a besoin.
- **La scène three lit les objets vivants** (`unit.position`, `board.grid`) — c'est conforme à « Board est la source de vérité » et évite tout aller-retour par React pendant le combat.

### 2.3 Découpage des stores Zustand

**`gameStore`** — mapping depuis `GameState` + état de session :

| Slice | Provenance |
|---|---|
| `round, phase, playerHp, enemyHp` | `GameState` (snapshot) |
| `playerMultiplier, enemyMultiplier, unitMultipliers` | `GameState` |
| `boardSlots, extraDraws, guaranteedDraws, handModifiers, extraShoppingMagies` | `GameState` (carry-over) |
| `hand: CardSnapshot[]` (+ `playable`, `grayedReason` par carte) | main + `InvocationRules.isPlayable` |
| `boardUnits / enemyUnits / graveyard: UnitSnapshot[]` | Board + graveyards (affichage HUD/cimetière) |
| `synergies` | `AttributeManager.getActiveSynergies` |
| `prepTimer` (60→0), `combatSpeed` (1\|2\|4), `paused` | session/UI de partie |
| `combatWinner, roundDamage` | fin de combat |
| `shopping: { magies, chosen, awaitingTarget }` | ShoppingController |
| `invocationFlow: { card, optionIndex, selectedMaterials, validCells }` | sélection matériaux en cours |
| actions | `startGame(deck)`, `placeCard`, `moveUnit`, `selectMaterial`, `cancelInvocation`, `startCombat`, `setSpeed`, `chooseMagie`, `applyMagieTarget`, `nextRound` |

**`deckStore`** — état DeckBuilder/DeckSelector : `decks` (méta : nom, couleur, tags, counts), `activeDeck`, `editing { name, byTier, totalCount, isValid }`, actions CRUD déléguées à `DeckRepository` (+ `pendingEdit` conservé en sessionStorage pour la parité).

**`uiStore`** — `screen` + `screenParams` (remplace le router maison, sync `?screen=` en URL), `tooltip: { kind: 'card'|'unit'|'terrain'|null, payload, anchor }`, `banner`, `toasts`, `orientation` (avertissement paysage), `fullscreen`.

**`authStore`** (si D2 validée) — `user`, `status: 'loading'|'authed'|'anon'`, actions login/logout/register déléguées à `AuthClient`.

Le timer de préparation et le tick de combat vivent **hors des stores** (dans `GameSession`/`CombatAnimator3D`) ; les stores ne reçoivent que des mises à jour.

### 2.4 Contrat React ⇄ Three.js

**Qui possède quoi :**
- `Board3DCanvas.tsx` (React) : possède le cycle de vie. `useEffect` de montage → `new Scene3D(canvasEl, css3dContainerEl, session)` ; cleanup → `scene.dispose()` (geometries, materials, textures, renderer, listeners, rAF annulé). Aucun état React lié au rendu.
- `Scene3D` (TS pur) : possède renderer WebGL + CSS3DRenderer, caméra, boucle de rendu **à la demande** hors combat (render sur invalidation : drag, resize, changement de phase) et boucle rAF continue pendant le combat uniquement (perf MBP 2015).
- `CombatAnimator3D` : possède le timing (`BASE_TICK_MS = 180 / speed`). À chaque échéance : `events = combatManager.step()` → file d'animations → application visuelle. **Aucun setTimeout dans la logique**, inchangé.

**Circulation des événements :**
1. React (bouton ou timer à 0) → `gameStore.startCombat()` → `GameSession.startCombat()` : tirage terrain, `setBlockedCells`, `AttributeManager.applyStartOfCombat`, `gameState.startCombat(...)`, création `CombatManager` → la session émet `combat:started`.
2. `Scene3D` (abonné à la session par un mini event-emitter typé) démarre `CombatAnimator3D`.
3. Pendant le combat, l'animator applique les événements visuellement et pousse au store **uniquement** ce que le HUD affiche (compteur de temps restant, morts pour le panneau synergies/cimetière) — throttlé, jamais par frame.
4. Sur `combat_end` : animator → session (`applyEndOfCombat`, nettoyage, retour `initial_position`) → `syncFromSession` → React affiche `EndRoundOverlay`.

**Entrées utilisateur sur le board :** `DragController` (Pointer Events sur le canvas, raycasting) traduit en intents `(unitUid, targetCell)` → `session.moveUnit(...)` valide (`isOccupied`, zone joueur, phase) → si ok : mutation Board **puis** mise à jour visuelle ; sinon : snap-back. Le DOM/React ne porte jamais la position.

### 2.5 Trois.js : npm, plus de CDN

`three` en dépendance npm (version pinnée, ex. `0.16x`), `CSS3DRenderer` importé de `three/addons/renderers/CSS3DRenderer.js`. L'importmap et le CDN disparaissent avec l'ancien `index.html`. Vite tree-shake ; gain offline/PWA.

---

## 3. Reconstruction de l'UI

> Rappel : tout ceci est une **réécriture**, l'ancienne UI n'existe plus. La parité fonctionnelle se juge contre CLAUDE.md + la logique existante.

### 3.1 Design system Tailwind (fondation, Phase 1)

- **Tokens** via `@theme` (Tailwind v4) : palette sombre (base `#0f1117` du manifest), couleurs par tier (1→5), couleurs de camp (player/enemy), états (danger, success, gold/magie), rayons, ombres « carte ».
- **Tap targets ≥ 44 px** : tailles standardisées `tap` (min-h-11 min-w-11) appliquées à tout élément interactif ; espacement de sécurité entre cartes en main.
- **Composants de base** : `Button` (variants primary/ghost/danger, size, loading), `Panel`, `CardFrame` (illustration `/illustrations/:id`, nom, stats, badge tier, état grisé + raison), `Gauge` (HP/power, orientée), `Banner` (annonces phase/magie), `Modal/Overlay` (safe-areas iOS), `Timer` (anneau 60 s), `StatChip`, `IconButton`.
- Interdiction des styles inline (règle existante) → tout en classes Tailwind + quelques CSS vars pour ce qui est dynamique (couleur de deck, etc.).
- Viewport mobile : `100dvh`, `env(safe-area-inset-*)`, `touch-action: none` sur le canvas, `manipulation` ailleurs ; media query `orientation: landscape` → overlay « tournez votre appareil ».

### 3.2 MainMenu

Composants : `MainMenu` (nav vers Jouer → DeckSelector, DeckBuilder, TestBench dev), `VersionTag` (`/api/version`). État : quasi nul (lit `deckStore.activeDeck` pour activer « Jouer »). Interactions : taps simples. Si D2 validée : entrée « Duel en ligne / Tournoi » + avatar profil.

### 3.3 GameScreen (cœur du plan)

Structure : `GameScreen.tsx` = shell plein écran ; au centre `Board3DCanvas` ; par-dessus, en couches DOM (voir risque R1 pour le z-index) :

| Zone | Composants | État consommé | Interactions |
|---|---|---|---|
| HUD haut | `HpBar` ×2 (joueur/ennemi, 1000 max), `RoundIndicator` (n/5), `MultiplierBadge` (breakdown unit_mult × round au tap) | `gameStore` | tap badge → détail |
| Contrôles de phase | `PhaseControls` : `Timer` 60 s, bouton « Lancer le combat », `SpeedToggle` ×1/×2/×4 (visible en combat) | `prepTimer`, `phase`, `combatSpeed` | timer à 0 → auto `startCombat()` |
| Panneau synergies | `SynergyPanel` repliable : liste `{attr, count, activeThreshold, nextThreshold}` | `synergies` | tap → tooltip attribut |
| Main | `HandBar` scrollable horizontale, `HandCard` (grisage doublon normal + raison via `isPlayable`, badges `HandModifierBadge` pour reduce_sacrifice_cost / free_transformation / remove_heritage_material), compteur pioches garanties | `hand`, `handModifiers` | tap → tooltip ; drag (Pointer Events) vers le board → invocation |
| Flux d'invocation | `InvocationHints` (bannière « Sélectionnez N matériaux », coût couvert via `sumMaterialValue`), surbrillance cellules valides (`validCells`) rendue par la scène 3D, sélection matériaux board **et** cimetière, bouton annuler ; chaînage : le flux se relance tant que `canSummon` d'une autre carte passe | `invocationFlow` | taps successifs sur unités/cimetière |
| Cimetière | `GraveyardTray` (unités neutralisées, disponibles comme matériaux, purge au combat suivant) | `graveyard` | tap → tooltip / sélection matériau |
| Fin de round | `EndRoundOverlay` : vainqueur, dégâts infligés (`atk survivants × mult`), bouton « Tour suivant » / « Résultat final » | `combatWinner`, `roundDamage` | — |
| Fin de partie | `GameOverScreen` : vainqueur (`getWinner`), HP finaux, rejouer/menu | `gameStore` | — |

Orchestration : `GameSession` détient la boucle de tours (pioche selon `tiersForRound` + extraDraws + guaranteedDraws avec priorité Transformation > Heritage > Fusion > normale, préparation, combat, fin de round, shopping, `nextRound`). L'IA ennemie (`EnemyAI`) joue en début de préparation, unités masquées (option de la scène) jusqu'au combat.

### 3.4 Phase Shopping (extraite, composants dédiés)

- `ShoppingController` (logic/) : tire `getRandomMagies(3 + extraShoppingMagies)` (cap raisonnable), skip si `isGameOver()` ou zéro magie, applique via `MagieEffect.applyEffect`, route le ciblage avec `needsUnitTarget` / `needsGraveyardTarget`, gère `defuse_fusion` (ex-`_defuseFusion` : reconstruction des matériaux — à réimplémenter dans le controller, pas dans l'écran) et `destroy_unit`.
- Composants : `ShoppingOverlay` (3+ `MagieCard` avec `effectLabel`), `TargetPicker` (mode ciblage : la scène highlighte les unités éligibles, tap pour choisir, annulable), `GraveyardPicker` (pour `revive`), `Banner` de confirmation.
- Les effets différés (`player_hand_modifiers`) restent dans `GameState` — consommés au tour suivant par la logique de main.

### 3.5 DeckSelector & DeckBuilder

- `DeckSelector` : liste des decks (`listDecks` + méta couleur/tags), deck actif, actions jouer/éditer (via `setPendingEdit` → parité)/renommer/dupliquer (`findFreeName`)/supprimer (confirmation).
- `DeckBuilder` : `TierTabs` (1–5, pool filtré par tier), `CardGrid` (CardFrame + compteur), règles : max/tier `min(8, pool)`, total ≥ 20 pour sauver, nom requis — validation bloquante affichée en continu (`DeckCounter`). Mode édition via `consumePendingEdit()`. Long-press/tap carte → tooltip.
- État : `deckStore.editing` ; persistance `DeckRepository` (localStorage + `flushSync` serveur si authé).

### 3.6 Tooltip

- Un seul `TooltipHost` monté dans `App`, piloté par `uiStore.tooltip` (remplace l'instance globale).
- Ouverture : tap carte (main, deckbuilder), tap unité (délégué par la scène 3D via callback picking), tap terrain (bouton ℹ). Fermeture : tap ailleurs (listener `pointerdown` capture au niveau App), changement d'écran, début de drag.
- Contenus : `CardTooltip` (stats, coût d'invocation, pouvoir, attributs), `UnitTooltip` (stats effectives vs base, bonus shopping, vétérance, lignée 🧬 quand `represented_ids.length > 1`), `TerrainTooltip` (cases bloquées miniature + effet).
- Positionnement : ancré (coordonnées écran fournies par l'appelant, y compris projection 3D→2D pour les unités), clampé au viewport, mobile-first (feuille basse sur petit écran).

### 3.7 TestBench (parité)

`TestBench.tsx` réutilise `Board3DCanvas` + une `TestBenchSession` (variante de GameSession sans règles d'invocation/tours/HP) : browser de cartes filtrable par `summon_type` et camp, placement libre des deux côtés, suppression clic droit / long-press, sélecteur de terrain 🗺️ (cases bloquées visibles immédiatement, effets appliqués au start, `resetCombatStats` à l'arrêt, bouton ℹ), bouton Pause (l'animator suspend son horloge), `BoardInspector` (overlay live des stats de toutes les unités, rafraîchi sur événements de combat), vitesses ×1/×2/×4.

### 3.8 Drag & drop (stratégie Pointer Events)

- **Deux surfaces** : (a) main → board : `pointerdown` sur `HandCard` → ghost DOM suit le doigt → au-dessus du canvas, raycast continu pour highlight de cellule → `pointerup` : `session.placeCard` ou ouverture du flux matériaux ; (b) board → board (repositionnement en préparation) : entièrement dans `DragController` (canvas).
- `setPointerCapture` systématique ; seuil de 8 px avant de considérer un drag (sinon c'est un tap → tooltip) ; annulation sur `pointercancel` (Safari iOS le déclenche facilement) ; jamais de dépendance au hover.
- La sélection de matériaux et le chaînage d'invocations sont des **taps**, pas des drags (plus fiable sur mobile).

---

## 4. Plan de migration par phases

> Convention : chaque phase se termine par un commit taggé, l'app démarre et les tests passent.

### Phase 0 — Pré-vol (½ jour) — risque : faible

- [x] Restaurer un dépôt git — fait (D1) : `github.com/srida/millenium.git`, `main` propre
- [x] Récupérer `package.json`, `index.html`, `node_modules`, ancienne UI — fait (D1)
- [x] Supprimer le dossier parasite `https:/` à la racine
- [x] Reconstituer `initial-data/` (copie des 6 JSON de `data/`, jamais présent dans l'historique git) pour que le bootstrap serveur fonctionne sur un déploiement neuf
- [x] Vérifier `npm start` (port **3742**) : `/api/cards` → **398 cartes** (le CLAUDE.md dit 253 — à corriger en Phase 6), attributes 57, powers 14, boards 15, magies 19 ; `GET /` sert l'ancienne app (AuthScreen OK visuellement)
- [x] Branche `refonte/vite-react`
- **Done** : serveur up, ancienne app démarre en local, baseline committée. ✅ 2026-07-24

### Phase 1 — Scaffold + portage logic/data + non-régression (2–4 jours) — risque : moyen

- [ ] `client/` : Vite + React + TS strict (`allowJs`), Tailwind v4 (`@tailwindcss/vite`), Zustand, Vitest
- [ ] ESLint + `eslint-plugin-boundaries` (ou `no-restricted-imports`) : `logic/` ne peut importer ni react, ni zustand, ni three, ni `data/` ; `three/` ne peut importer react
- [ ] Copier `game/logic/` → `client/src/logic/` **byte-for-byte** (sauf : sortir les imports `data/` de Tournament.js → injection de dépendances)
- [ ] Copier `game/data/`, `game/net/` → `client/src/{data,net}/`
- [ ] `src/logic/types.ts` : types Card/Power/Attribute/Magie/BoardDef/CombatEvent (unions discriminées)
- [ ] **Tests de non-régression déterminisme** (Vitest, jsdom inutile — node pur) :
  - [ ] fixtures : 5–6 setups de combat scriptés (unités, positions, terrain avec cases bloquées, pouvoirs variés dont FREEZE/TAUNT/CONFUSION/BURN, synergies actives, timeout) — **sans pioche** (pas de RNG)
  - [ ] golden files : séquence d'événements sérialisée (`type`, uid, positions, dégâts, tick) → `expect(events).toMatchSnapshot()` gelé comme référence
  - [ ] tests unitaires ciblés : multiplicateurs GameState, `tiersForRound`, lignées (`materialLineageLegit` : cas Aile de feu/Electrum du CLAUDE.md), `material_value`, vétérance, magies
  - [ ] reset du compteur `_nextUid` entre tests (exposer un `__resetUidsForTests` ou compter relativement)
- [ ] Conversion TS progressive des feuilles (Draw, BoardEffect, PathFinder, Board, Unit, GameState) — snapshots verts après chaque module
- **Done** : `vitest run` vert, golden files committés, logique consommable en node headless.

### Phase 2 — Three.js npm + portage de la scène board (2–4 jours) — risque : moyen (portage de l'existant restauré)

- [ ] `three` en npm, suppression de l'importmap/CDN dans le nouveau `client/index.html`
- [ ] Porter [Board3D.js](game/ui/components/Board3D.js) (1 792 l.) → `three/Scene3D.ts` + `BoardView3D.ts` + `UnitView3D.ts` + `DragController.ts` : découpage en modules, imports npm, mais **comportement visuel identique** (comparaison côte à côte avec l'ancienne app)
  - [ ] au passage : `dpr = min(devicePixelRatio, 2)`, render à la demande hors combat, `dispose()` complet (l'ancien code étant SPA-naviguée, vérifier ce qu'il libérait réellement)
- [ ] Porter [CombatAnimator3D.js](game/ui/components/CombatAnimator3D.js) (288 l.) → `three/CombatAnimator3D.ts` : horloge `BASE_TICK_MS/speed`, mapping des événements (`move`, `attack`, `power`, `dot`, `freeze`, `stat_change`, `death`, `combat_end`), pause — compléter les événements éventuellement non gérés par l'ancien code
- [ ] Harnais visuel provisoire : page dev qui charge une fixture de Phase 1 et joue le combat (ni HUD ni règles) — sert de proto TestBench
- **Done** : un combat scripté se joue visuellement à ×1/×2/×4 sur Safari iOS et Chrome desktop, rendu comparable à l'ancienne app côte à côte, 60 fps (ou 30 stable) sur MBP 2015, zéro fuite mémoire après 10 montages/démontages (heap snapshot).

### Phase 3 — GameScreen minimal jouable (4–6 jours) — risque : élevé

- [ ] `GameSession` (orchestrateur headless) + `gameStore` + `syncFromSession`
- [ ] Boucle complète : pioche (tiers/round, extraDraws, guaranteedDraws priorisées) → préparation (timer 60 s auto-combat, placement normal, repositionnement drag, EnemyAI + masquage) → combat (terrain aléatoire, multiplicateurs, animator) → fin de round (dégâts HP, cimetière, retour `initial_position`, reset stats) → tour suivant → game over
- [ ] Invocations spéciales complètes : sacrifice, fusion, heritage, transformation, chaînage, matériaux depuis cimetière, `validCells`, doublons grisés
- [ ] HUD : HpBar, RoundIndicator, MultiplierBadge, PhaseControls, SpeedToggle, SynergyPanel, HandBar, GraveyardTray, EndRoundOverlay, GameOverScreen
- [ ] Tooltip (card/unit) via `uiStore`
- [ ] MainMenu + navigation `uiStore` (+ deep-link `?screen=`)
- **Done** : partie complète 5 tours jouable au doigt sur iPhone (deck de test hardcodé si Phase 5 pas faite), déterminisme combat toujours vert.

### Phase 4 — Phase Shopping + magies (2–3 jours) — risque : moyen

- [ ] `ShoppingController` + `ShoppingOverlay`/`MagieCard`/`TargetPicker`/`GraveyardPicker`/`Banner`
- [ ] 14 types d'effets branchés, y compris `defuse_fusion` (réimplémentation documentée), `destroy_unit`, modifiers de main différés, `extraShoppingMagies`, skip fin de partie
- [ ] Tests unitaires ShoppingController (ciblage, application, carry-over)
- **Done** : chaque type de magie démontrable en partie réelle.

### Phase 5 — DeckBuilder + DeckSelector + navigation complète (2–3 jours) — risque : faible

- [ ] `deckStore`, DeckSelector (couleurs/tags/renommage/duplication), DeckBuilder (contraintes min 20 / max tier / pendingEdit)
- [ ] GameScreen consomme le deck actif (`buildDeckFromIds`)
- [ ] Décision D2 appliquée : soit AuthScreen minimal (login/register/logout + gate bootstrap + sync decks `pull/flushSync`), soit bypass dev documenté
- **Done** : boucle complète menu → construire → jouer → rejouer sans recharger.

### Phase 6 — TestBench + PWA + polish mobile (3–4 jours) — risque : moyen

- [ ] TestBench parité (3.7) 
- [ ] `vite-plugin-pwa` : migration du manifest (**Millenium** — cf. D9, portrait, icônes), SW `autoUpdate`, precache app shell, runtime cache illustrations (stale-while-revalidate), **network-only sur `/api/*`**
- [ ] Renommage **Soulforge → Millenium** partout (D9) : manifest (`name`, `short_name`, `description`), `<title>` du client, `admin.html` (titre + libellés), realm basic-auth `"Soulforge Card Manager"` dans [server.js](server.js), chaînes visibles des écrans. Exception recommandée : le fichier `data/soulforge.db` garde son nom sur disque (le renommer casserait les sessions/comptes existants à chaque déploiement pour un gain nul — si tu y tiens, prévoir un `mv` + variable d'env dans un commit dédié)
- [ ] Retrait de l'ancienne UI (`game/ui/`, ancien `index.html`, importmap) une fois la parité validée côte à côte
- [ ] Fullscreen API, overlay paysage, safe-areas, audit tap-targets, test réel Safari iOS portrait
- [ ] Prod : build + `express.static(client/dist)` + fallback SPA ; suppression des routes `/game` statiques
- [ ] Mise à jour CLAUDE.md (nouvelle stack, nouveaux chemins, écarts du §1.1 documentés)
- **Done** : installable sur l'écran d'accueil iOS, lighthouse PWA vert, CLAUDE.md à jour.

### Phase 7 — (optionnelle, selon D3) Online : Auth complet, PvP, Tournoi, Amis/Profil (4–7 jours) — risque : élevé

- [ ] AuthScreen complet + ResetPassword, `authStore`
- [ ] OnlineLobby (matchmaking via `PvpConnection`), GameScreen variante PvP (`PvpOpponentProvider` remplace EnemyAI, miroir des rows, synchro des rounds)
- [ ] Vérification croisée du déterminisme entre 2 clients (test : même seed d'état initial → même `combat_end` ; les golden tests de Phase 1 sont le garde-fou)
- [ ] TournamentScreen (bracket, `resolveAiMatches`, matchs du joueur)
- [ ] Friends/Profile
- **Done** : un duel réel entre deux navigateurs aboutit au même vainqueur des deux côtés.

---

## 5. Risques et points de vigilance

**R1 — CSS3DRenderer × React (élevé).** Deux renderers superposés + l'arbre React = trois couches DOM à empiler. Règles : conteneur unique `relative` ; canvas WebGL `z-0 pointer-events-auto` (cible du DragController) ; conteneur CSS3D `z-10 pointer-events-none` (et `pointer-events: none` sur chaque élément CSS3D — sinon ils avalent les taps destinés au canvas) ; HUD React `z-20`, avec `pointer-events-auto` seulement sur les contrôles réels pour ne pas bloquer le board. React ne rend **jamais** dans le conteneur CSS3D (géré impérativement par `UnitView3D`) — pas de portal croisé, sinon réconciliation React vs manipulation Three = corruption. Double rendu WebGL/CSS3D à synchroniser dans le même rAF pour éviter le jitter.

**R2 — Performance MBP 2015 + iPhone (élevé).** `dpr` cappé à 2 (voire 1.5 sur mesure) ; render à la demande hors combat (une frame sur invalidation) ; géométries/matériaux/textures partagés et cachés (`assets.ts`) ; illustrations en textures ↓ 512 px ; `dispose()` systématique vérifié via `renderer.info` en dev ; pas de shadow maps ; antialias off si nécessaire. Côté React : HUD mis à jour par événements throttlés, jamais par frame ; sélecteurs Zustand fins (`useShallow`).

**R3 — Casse du déterminisme au portage (critique, car le PvP en dépend).** Interdits pendant la conversion TS : changer un ordre d'itération (Set/Map préservent l'insertion — ne pas remplacer par des objets triés), remplacer `sort` (stable, tie-break `card_id`) par un tri « équivalent », toucher aux arrondis (`Math.round` vs `~~`), déplacer l'incrément `_nextUid`, « corriger » un comportement bizarre en passant. Toute correction de bug logique = commit séparé + mise à jour explicite des golden files. Les golden tests de Phase 1 sont le contrat.

**R4 — Zustand et objets mutables (moyen).** `Unit`/`Board` mutent en place (voulu). Ne jamais les mettre tels quels dans un store ; toujours des snapshots copiés. Symptôme sinon : HUD qui ne se met pas à jour ou qui affiche des états intermédiaires de combat.

**R5 — Pointer Events Safari iOS (moyen).** `pointercancel` intempestifs (scroll, edge swipes) : `touch-action: none` sur canvas et cartes draggables, seuil de drag, restauration d'état sur cancel. Tester tôt (Phase 2/3), pas au polish.

**R6 — Divergence silencieuse avec la baseline (faible depuis D1).** L'ancienne app restaurée est exécutable : la garder lançable (`npm start` + `/`) pendant toute la migration et comparer systématiquement (préparation, combat ×1/×2/×4, shopping, tooltips) à chaque phase. Ne retirer l'ancien `index.html`/`game/ui` qu'en Phase 6, une fois la parité validée.

**R7 — Auth au bootstrap (faible mais bloquant au quotidien).** Le jeu exige une session (`AuthClient.me()` avec cap 4 s). En dev, prévoir soit l'AuthScreen dès la Phase 5, soit un bypass `VITE_DEV_NO_AUTH` — sinon chaque rechargement HMR bute sur le gate.

**Hors scope volontaire** : backend Express et `admin.html` (inchangés, sauf le service statique de `client/dist` en Phase 6), `ws/` serveur, scripts GDD/Notion, base SQLite, contenu des données (cartes/magies/terrains).

---

## 6. Décisions — TRANCHÉES le 2026-07-24

| # | Décision | Arbitrage |
|---|---|---|
| **D1** | Restauration du dépôt | ✅ **Fait** : projet rattaché à `github.com/srida/millenium.git`, fichiers manquants récupérés (dont l'ancienne UI 3D → Phase 2 = portage). Reliquats en Phase 0 : `initial-data/` à reconstituer, dossier parasite `https:/` à supprimer. |
| **D2** | Auth dans le vertical slice | ✅ **(a)** AuthScreen minimal en Phase 5 (gate bootstrap + sync decks). |
| **D3** | Scope online | ✅ **(a)** PvP / Tournoi / Amis / Profil inclus, en Phase 7 après validation du slice solo. |
| **D4** | Migration TS de `logic/` | ✅ **Progressive** (`allowJs`, §1.4) : copie gelée + golden tests, puis conversion module par module. |
| **D5** | CSS3DRenderer | ✅ **(a)** hybride WebGL+CSS3D conservé en Phase 2 ; réévaluation perfs iOS en fin de Phase 3. |
| **D6** | Tailwind | ✅ **v4** (`@tailwindcss/vite`, tokens `@theme`). |
| **D7** | Navigation | ✅ **(a)** `uiStore.screen` + sync `?screen=`, pas de react-router. |
| **D8** | Gestionnaire de paquets | ✅ **npm**. |
| **D9** | Nom du produit | ✅ **Millenium partout** : manifest PWA, `<title>`, écrans, `admin.html`, realm basic-auth. Checklist détaillée en Phase 6. Seule exception proposée : le fichier `data/soulforge.db` garde son nom sur disque (renommage = migration de données pour un gain nul ; faisable en commit dédié si souhaité). |

---

*Plan validé — l'implémentation démarre à la Phase 0 (reliquats : `https:/`, `initial-data/`, branche `refonte/vite-react`).*
