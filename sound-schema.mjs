// Le vocabulaire du son : quels DÉCLENCHEURS d'effets sonores existent, et
// quels THÈMES de musique existent. Même statut que `effect-schema.mjs` et
// `speed-scale.mjs` : pur, à la racine, SANS AUCUN IMPORT — `admin.html` le
// charge par `GET /admin/sound-schema.js`, le bundle client l'importe
// directement. Une table déclarée ici et pas côté moteur serait un
// déclencheur que l'admin propose et que rien ne joue jamais.
//
// ⚠️ Un déclencheur est un SLUG STABLE, jamais un id d'attribut ou de pouvoir :
// il se lit dans le code du jeu (`Audio.play('attack', { element })`), pas
// dans un catalogue qui peut changer de forme.

/**
 * `variant: null`    — un seul son pour ce déclencheur.
 * `variant: 'tier'`   — un son PEUT être décliné par tier (1 à 5) ; une
 *                        entrée sans tier sert de repli pour les tiers non
 *                        couverts.
 * `variant: 'element'` — un son PEUT être décliné par attribut de catégorie
 *                        `Element` ; une entrée sans élément sert de repli.
 * `variant: 'power'`   — un son PEUT être décliné par POUVOIR (`POWER_HEAL`,
 *                        `POWER_PARALYSIS`…) ; une entrée sans pouvoir sert
 *                        de repli.
 */
export const SFX_TRIGGERS = [
  { id: 'draw',                label: 'Piocher',                              variant: null },
  { id: 'card_tap',            label: 'Cliquer sur une carte',                variant: null },
  { id: 'drag',                label: 'Glisser une carte',                    variant: null },
  { id: 'summon',               label: 'Invocation',                           variant: 'tier' },
  { id: 'move_unit',           label: 'Bouger une unité',                     variant: null },
  { id: 'mulligan_reroll',     label: 'Mulligan / Reroll (coût en PV)',       variant: null },
  { id: 'ready',                label: 'Bouton Prêt',                          variant: null },
  { id: 'undo',                 label: "Bouton Annuler les actions",           variant: null },
  { id: 'menu_ingame',          label: 'Ouverture du menu en partie',          variant: null },
  { id: 'menu_resume',          label: 'Bouton Reprendre la partie',           variant: null },
  { id: 'menu_quit',            label: 'Bouton Quitter la partie',             variant: null },
  { id: 'use_material',        label: 'Utiliser un matériel',                 variant: null },
  { id: 'attack',                label: 'Attaque',                              variant: 'element' },
  { id: 'power',                 label: 'Pouvoir déclenché',                    variant: 'power' },
  { id: 'hp_loss',              label: 'Perte de vie (joueur)',                variant: null },
  { id: 'unit_destroyed',      label: 'Unité détruite',                       variant: null },
  { id: 'round_change',        label: 'Changement de tour',                   variant: null },
  { id: 'phase_combat',        label: 'Passage en phase Combat',              variant: null },
  { id: 'phase_shopping',      label: 'Passage en phase Shopping',            variant: null },
  { id: 'round_recap_dismiss', label: 'Bouton de la popup de résultat',       variant: null },
  { id: 'shopping_choose',     label: 'Choix d\'un objet en Phase Shopping',  variant: null },
  { id: 'shopping_skip',       label: 'Passer la Phase Shopping',             variant: null },
  { id: 'match_win',            label: 'Écran de victoire',                    variant: null },
  { id: 'match_lose',           label: 'Écran de défaite',                     variant: null },
  { id: 'match_draw',           label: 'Écran d\'égalité',                     variant: null },
  { id: 'summon_menu_open',    label: 'Popup d\'invocation à choix multiple', variant: null },
  { id: 'duel_start',           label: 'Animation de lancement du duel',       variant: null },
  // Bouton d'achat de la boutique (emplacement, booster, cosmétique) — geste
  // à MAINTENIR (`HoldConfirmButton`, `currency` posé), distinct de
  // `menu_button` : c'est un débit, pas une simple navigation de menu.
  { id: 'shop_buy',             label: 'Achat validé (boutique)',              variant: null },
  // ⚠️ Déclencheur GÉNÉRIQUE, câblé une seule fois dans `usePressSquash`
  // (`components/ui/primitives.tsx`) — pas un site par bouton. Couvre tout
  // `Button`/`IconButton` hors partie (menu principal, boutique, decks,
  // missions…) ; les boutons EN PARTIE qui jouent déjà leur propre son
  // dédié (`ready`, `undo`, `menu_ingame`…) le désactivent explicitement
  // (`sfx={false}`) pour ne pas sonner deux fois.
  // Récompenses récupérées d'un tap — joués À LA RÉPONSE du serveur (le gain
  // est acquis), jamais au tap.
  { id: 'reward_mission',      label: 'Récompense de mission récupérée',      variant: null },
  { id: 'reward_weekly',       label: 'Palier hebdomadaire récupéré',         variant: null },
  { id: 'reward_daily_gift',   label: 'Cadeau quotidien récupéré',            variant: null },
  { id: 'reward_level',        label: 'Paliers de niveau récupérés',          variant: null },
  // Notifications (toasts de `RewardToasts`) — jouées UNE fois par lot reçu,
  // à la création du toast, pas à la récupération du gain.
  { id: 'notify_mission',      label: 'Notification : mission accomplie',     variant: null },
  { id: 'notify_weekly',       label: 'Notification : palier hebdo atteint',  variant: null },
  { id: 'notify_level',        label: 'Notification : passage de niveau',     variant: null },
  // Chrono de préparation : joué UNE fois, au passage à `TIMER_LOW_S` (10 s).
  { id: 'timer_low',           label: 'Chrono bas (10 dernières secondes)',   variant: null },
  { id: 'menu_button',          label: 'Bouton de menu (générique, hors partie)', variant: null },
];

/**
 * Les EMPLACEMENTS fixes de la musique — pas les pistes elles-mêmes.
 * ⚠️ « Menu » couvre le menu principal, la connexion ET tous les autres
 * menus : ils partagent UN seul emplacement (ce sont des pistes différentes
 * du catalogue `music.json` qui font la variété, pas des emplacements
 * séparés).
 *
 * ⚠️ L'emplacement « Partie » (`game`) ne découpe plus la partie en trois
 * moments figés : chaque piste porte la LISTE DES TOURS qu'elle accompagne
 * (`rounds`, entiers de 1 à `GAME_ROUNDS.length`). Un thème de partie peut
 * donc tenir en une piste pour tous les tours, ou en deux pistes « 1-2-3 » et
 * « 3-4 ». Le thème — tiré au hasard une fois par match parmi le catalogue
 * `data/music_themes.json` (comme un pack pour les cartes) — choisit la
 * PALETTE, le tour choisit la piste. Le champ `game_theme` d'une entrée
 * `music.json` la range dans ce catalogue ; une piste de partie sans
 * `game_theme` sert de repli commun tant qu'aucune piste du thème tiré ne
 * couvre ce tour (cf. `MusicDatabase.tracksForGameRound`).
 */
export const MUSIC_THEMES = [
  { id: 'menu', label: 'Menu (principal, connexion, autres menus)' },
  { id: 'game', label: 'Partie' },
];

/** L'emplacement des pistes de partie. */
export const GAME_MUSIC_THEME = 'game';

/** Les tours d'une partie, dans l'ordre — ceux qu'une piste peut couvrir. */
export const GAME_ROUNDS = [1, 2, 3, 4, 5];

/**
 * Les trois anciens emplacements de partie et les tours qu'ils couvraient.
 * ⚠️ Lus seulement par `normalizeMusic` : une installation existante (le
 * volume n'est jamais réécrit par `initial-data/`) garde ses pistes
 * `game_early` / `game_mid` / `game_late`, qui doivent continuer de jouer
 * exactement aux mêmes tours sans migration. L'admin réécrit la forme neuve
 * au premier enregistrement.
 */
export const LEGACY_GAME_SLOTS = {
  game_early: [1, 2],
  game_mid: [3, 4],
  game_late: [5],
};

/** Vrai pour une piste de partie, forme neuve comme ancienne. */
export function isGameMusic(entry) {
  const theme = entry?.theme;
  return theme === GAME_MUSIC_THEME || Object.prototype.hasOwnProperty.call(LEGACY_GAME_SLOTS, theme);
}

/**
 * Les tours qu'accompagne une piste — triés, sans doublon, bornés à
 * `GAME_ROUNDS`. LE seul lecteur de `rounds` (et des anciens emplacements).
 * Une piste hors partie, ou de partie sans aucun tour, rend `[]` : elle ne
 * joue jamais en partie.
 */
export function musicRounds(entry) {
  if (!entry) return [];
  if (Object.prototype.hasOwnProperty.call(LEGACY_GAME_SLOTS, entry.theme)) return LEGACY_GAME_SLOTS[entry.theme].slice();
  if (entry.theme !== GAME_MUSIC_THEME || !Array.isArray(entry.rounds)) return [];
  const set = new Set();
  for (const r of entry.rounds) {
    const n = Number(r);
    if (GAME_ROUNDS.includes(n)) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** Une entrée `music.json` dans la forme neuve (`theme: 'game'` + `rounds`).
 *  Rend un objet NEUF ; une piste hors partie est rendue telle quelle. */
export function normalizeMusic(entry) {
  if (!isGameMusic(entry)) return entry;
  return { ...entry, theme: GAME_MUSIC_THEME, rounds: musicRounds(entry) };
}

/** « Tours 1, 2, 3 » / « Tour 5 » / « Tous les tours » — pour l'admin. */
export function roundsLabel(rounds) {
  if (!rounds?.length) return 'Aucun tour';
  if (rounds.length === GAME_ROUNDS.length) return 'Tous les tours';
  return `${rounds.length > 1 ? 'Tours' : 'Tour'} ${rounds.join(', ')}`;
}

export const SFX_TRIGGER_IDS = SFX_TRIGGERS.map(t => t.id);
export const MUSIC_THEME_IDS = MUSIC_THEMES.map(t => t.id);

export function sfxTrigger(id) {
  return SFX_TRIGGERS.find(t => t.id === id) || null;
}

export function musicTheme(id) {
  return MUSIC_THEMES.find(t => t.id === id) || null;
}

/** Tiers valides pour une variante `tier` (mêmes bornes que les attributs de catégorie Tiers). */
export const VARIANT_TIERS = [1, 2, 3, 4, 5];

export const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav', 'm4a'];
