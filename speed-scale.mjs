// L'ÉCHELLE DE TICKS — un compteur de 0 à 100, où plus haut veut dire PLUS FORT.
//
// Deux lectures d'une seule fenêtre (2 à 77 ticks), et c'est tout le module :
//   • un RYTHME (`ticksForRate`) — attaque, déplacement, chargement de pouvoir.
//     Plus haut = période plus COURTE = plus rapide.
//   • une DURÉE (`ticksForDuration`) — paralysie, blocage, confusion,
//     provocation. Plus haut = effet plus LONG.
// Les deux montent donc dans le sens du joueur, alors qu'elles vont en sens
// inverse en ticks. C'est la seule façon d'avoir un chiffre unique dont « 100 »
// veut toujours dire « au maximum ».
//
// Les trois rythmes d'une unité (attaque, déplacement, chargement de pouvoir)
// se paramétraient en **ticks**, c'est-à-dire en PÉRIODE : le seuil que
// `attack_timer` / `move_timer` / `power_gauge` doit atteindre. Plus bas voulait
// donc dire plus rapide, et tous les bonus livrés s'écrivaient en négatif
// (« Raigeki −5 », « Magicien −1/−2/−3/−5 », sept terrains). Un joueur qui lit
// « +10 vitesse » sur une magie n'a aucune raison de comprendre qu'il ralentit.
//
// Le compteur retourne le sens une fois pour toutes : 0 = le plus lent,
// 100 = le plus rapide, et un bonus positif accélère. C'est la SEULE forme
// saisie en admin, transportée par les données et lue par les effets ; les
// ticks n'existent plus que sous ce module, à l'entrée du combat.
//
// ⚠️ PUR et sans aucun import — c'est ce qui permet aux trois mondes du projet
// de partager LA MÊME table : le bundle client l'importe (`logic/Unit.ts`),
// `admin.html` le charge par la route `/admin/speed-scale.js`, et les scripts
// Node passent par un `import()`. Même situation, et même remède, que
// `card-query.mjs`. La recopier, c'est se donner deux échelles qui finiront par
// ne plus dire la même chose — et l'écart serait muet : un combat un peu plus
// lent ne ressemble pas à une panne.

/** Les deux bornes du compteur. */
export const RATE_MIN = 0;
export const RATE_MAX = 100;

/** Ce que valent ces bornes en ticks. Le compteur 0 est le plus LENT. */
export const TICKS_AT_MIN = 77;
export const TICKS_AT_MAX = 2;

/**
 * Combien de ticks vaut un point de compteur : `(77 − 2) / 100`.
 *
 * ⚠️ L'échelle est LINÉAIRE EN PÉRIODE, pas en cadence. La conséquence à
 * connaître : un point ne coûte pas le même pourcentage de rythme selon
 * l'endroit où on le pose (de 99 à 100 on gagne 27 % d'attaques, de 0 à 1 on
 * en gagne 1 %). C'est le prix d'une arithmétique que le joueur peut faire de
 * tête, et c'est ce qui rend les bonus ADDITIFS : `+4` vaut exactement
 * « 3 ticks de moins », où qu'il tombe et quel que soit le nombre de bonus déjà
 * appliqués. Aucun autre choix de courbe ne conserve cette propriété.
 */
export const TICKS_PER_POINT = (TICKS_AT_MIN - TICKS_AT_MAX) / (RATE_MAX - RATE_MIN);

/**
 * Le compteur ramené dans ses bornes, arrondi à l'entier.
 *
 * ⚠️ C'est LE clamp du compteur, pour ses deux lectures : un rythme comme une
 * durée vivent sur le même 0–100. Un second clamp par lecture serait deux
 * bornes à tenir d'accord.
 */
export function clampRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return RATE_MIN;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(n)));
}

/**
 * Le seuil en ticks d'un compteur — la seule traduction du projet.
 *
 * Les trois horloges du combat sont des ENTIERS comparés en `>=`, donc un seuil
 * de 2,75 et un seuil de 3 déclenchent au même tick : l'arrondi ne coûte aucune
 * finesse de jeu.
 *
 * ⚠️ AU SUPÉRIEUR, pour que la période annoncée ne soit jamais PLUS COURTE que
 * le compteur ne le dit — au compteur 1, la valeur exacte est 76,25 ticks, et
 * un arrondi au plus proche ferait agir l'unité au tick 76. Ce n'est pas cet
 * arrondi qui rend `rateForTicks` inversible (cf. plus bas : c'est la largeur
 * de l'intervalle qui s'en charge, et `Math.round` inverserait tout aussi bien
 * les valeurs du catalogue) — c'est simplement le sens honnête.
 */
export function ticksForRate(rate) {
  return Math.ceil(TICKS_AT_MIN - TICKS_PER_POINT * clampRate(rate));
}

/**
 * Le compteur qui rend exactement ce nombre de ticks — l'inverse de
 * `ticksForRate`, utilisé par la reprise de données.
 *
 * ⚠️ C'est la LARGEUR de l'intervalle qui porte la garantie, pas l'arrondi :
 * l'ensemble des compteurs qui donnent `t` ticks est
 * `[(77 − t) / 0,75 ; (78 − t) / 0,75[`, large de 1,33 : il contient donc
 * TOUJOURS au moins un entier, et le plus petit est celui-ci. D'où la garantie
 * `ticksForRate(rateForTicks(t)) === t` pour tout `t` entier de 2 à 77 — la
 * migration des 868 cartes ne change pas un seul combat.
 *
 * Hors bornes, la valeur est écrêtée : un pouvoir à 250 ticks n'a pas
 * d'équivalent sur une échelle qui s'arrête à 77, et c'est le plafonnement
 * voulu, pas un accident.
 */
export function rateForTicks(ticks) {
  const t = Number(ticks);
  if (!Number.isFinite(t)) return RATE_MAX;
  return clampRate(Math.ceil((TICKS_AT_MIN - t) / TICKS_PER_POINT));
}

/**
 * Un DELTA de ticks traduit en delta de compteur, pour reprendre les bonus
 * écrits à l'ancienne (`stat_bonus attack_speed −5` → `+7`).
 *
 * ⚠️ Le signe s'inverse : retirer des ticks, c'est ajouter du compteur.
 * L'aller-retour n'est ici pas exact (5 ticks valent 6,67 points), et il ne
 * peut pas l'être — un delta doit rester juste quel que soit le compteur sur
 * lequel il tombe, alors que la reprise d'une valeur absolue n'a qu'un cas à
 * traiter. L'écart est d'un quart de tick au pire.
 */
export function rateDeltaForTickDelta(tickDelta) {
  const d = Number(tickDelta);
  if (!Number.isFinite(d)) return 0;
  return Math.round(-d / TICKS_PER_POINT);
}

/**
 * Les stats de compteur, par leur nom de champ.
 *
 * ⚠️ C'est la liste que lisent la reprise de données, l'audit et le `<select>`
 * d'effet de l'admin. Un rythme ajouté au jeu se déclare ICI, pas dans chacun
 * des trois.
 */
export const RATE_STATS = Object.freeze(['attack_rate', 'movement_rate']);

/** Le champ que portait chaque compteur avant la bascule, pour la reprise. */
export const LEGACY_TICK_FIELD = Object.freeze({
  attack_rate: 'attack_speed',
  movement_rate: 'movement_speed',
  power_rate: 'power_speed',
});

// ---------------------------------------------------------------------------
// Les DURÉES — la même fenêtre, lue dans l'autre sens.
// ---------------------------------------------------------------------------

/**
 * Combien de ticks dure un effet au compteur `duration`.
 *
 * Même fenêtre que les rythmes (2 à 77 ticks) et même pas de 0,75 tick par
 * point, mais montante : `0 → 2 ticks`, `100 → 77`. Partager la fenêtre est
 * délibéré — une seconde paire de bornes serait un second réglage à tenir, et
 * l'écart entre les deux ne se verrait nulle part.
 *
 * ⚠️ Le SENS est inversé par rapport à `ticksForRate`, et il le faut : sur un
 * rythme, plus de ticks veut dire plus lent ; sur une durée, plus de ticks veut
 * dire plus long. Les traduire dans le même sens ferait de « 100 » la paralysie
 * la plus COURTE — exactement le contresens que le compteur existe pour lever.
 *
 * ⚠️ L'arrondi est AU SUPÉRIEUR, comme celui des rythmes : c'est le nombre de
 * ticks qui monte, jamais le compteur. Comme là-bas, ce n'est pas lui qui rend
 * `durationForTicks` inversible — c'est la largeur de l'intervalle.
 *
 * Repère : le combat est coupé à ~333 ticks, une durée de 77 en couvre donc
 * moins d'un quart. Le plafond n'a jamais valeur d'« immobilisé tout le round ».
 */
export function ticksForDuration(duration) {
  return Math.ceil(TICKS_AT_MAX + TICKS_PER_POINT * clampRate(duration));
}

/**
 * Le compteur qui rend exactement cette durée en ticks — l'inverse de
 * `ticksForDuration`, utilisé par la reprise de données.
 *
 * ⚠️ Même argument d'inversibilité que `rateForTicks`, et il tient pour la même
 * raison : l'ensemble des compteurs qui donnent `t` ticks est
 * `](t − 3) / 0,75 ; (t − 2) / 0,75]`, large de 1,33 — il contient donc toujours
 * un entier, et le plus grand est celui-ci. D'où
 * `ticksForDuration(durationForTicks(t)) === t` pour tout `t` entier de 2 à 77 :
 * la reprise des 86 cartes concernées ne change aucun combat, hors la seule qui
 * dépassait la fenêtre.
 *
 * ⚠️ Une valeur illisible rend le compteur MINIMAL, jamais le maximal : se
 * tromper dans le sens du plus long donnerait à un pouvoir muet la paralysie la
 * plus dure du jeu.
 */
export function durationForTicks(ticks) {
  const t = Number(ticks);
  if (!Number.isFinite(t)) return RATE_MIN;
  return clampRate(Math.floor((t - TICKS_AT_MAX) / TICKS_PER_POINT));
}

/**
 * Les pouvoirs dont la `value` chiffrait une DURÉE en ticks, et qui portent
 * désormais un compteur dans `power.duration`.
 *
 * ⚠️ C'est la liste que lisent le combat, la reprise de données, le contrat de
 * carte et l'admin. Les DIX autres pouvoirs gardent `power.value`, qui n'a
 * jamais voulu dire des ticks chez eux (des dégâts, un bouclier, un nombre de
 * cases). C'est d'ailleurs ce qui rend la reprise idempotente : sur ces
 * quatre-là, un `value` résiduel ne peut signifier qu'« encore en ticks ».
 */
export const DURATION_POWERS = Object.freeze([
  'POWER_PARALYSIS',
  'POWER_BLOCK',
  'POWER_CONFUSION',
  'POWER_TAUNT',
]);
