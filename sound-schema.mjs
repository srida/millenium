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
];

/**
 * Les EMPLACEMENTS fixes de la musique — pas les pistes elles-mêmes.
 * ⚠️ « Menu » couvre le menu principal, la connexion ET tous les autres
 * menus : ils partagent UN seul emplacement (ce sont des pistes différentes
 * du catalogue `music.json` qui font la variété, pas des emplacements
 * séparés).
 *
 * ⚠️ Les trois emplacements « Partie » suivent toujours la progression du
 * match (tours 1-2 / 3-4 / 5), CROISÉE avec un THÈME DE PARTIE — tiré au
 * hasard une fois par match parmi le catalogue `data/music_themes.json`
 * (comme un pack pour les cartes). Le thème choisit la PALETTE (quelles
 * pistes sont éligibles), l'emplacement choisit LE MOMENT ; les deux jouent
 * ensemble, et le thème reste le même du premier au dernier tour — seule la
 * piste change en suivant les trois emplacements. Le champ `game_theme`
 * d'une entrée `music.json` la range dans ce catalogue ; une entrée d'un
 * emplacement `game_*` sans `game_theme` sert de repli commun tant qu'aucune
 * piste du thème tiré ne couvre ce moment (cf. `MusicDatabase.tracksForGameTheme`).
 */
export const MUSIC_THEMES = [
  { id: 'menu', label: 'Menu (principal, connexion, autres menus)' },
  { id: 'game_early', label: 'Partie — Tours 1-2' },
  { id: 'game_mid', label: 'Partie — Tours 3-4' },
  { id: 'game_late', label: 'Partie — Tour 5' },
];

/** Les emplacements « Partie », dans l'ordre où une partie les traverse. */
export const GAME_MUSIC_SLOTS = ['game_early', 'game_mid', 'game_late'];

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
