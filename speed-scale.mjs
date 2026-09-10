// L'ÉCHELLE DE VITESSE — un compteur de 0 à 100, où plus haut veut dire plus vite.
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

/** Le compteur ramené dans ses bornes, arrondi à l'entier. */
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
