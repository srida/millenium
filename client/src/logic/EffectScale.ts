// PAR QUOI la valeur d'un effet est multipliée — le seul lecteur de `value_per`.
//
// ⚠️ Module PLAT, sans le moindre import : la question « combien d'unités
// répondent à ce critère » ne dépend d'aucune session, d'aucun catalogue, et
// surtout d'aucun des trois moteurs. C'est ce qui permet à `AttributeManager` et
// à `BoardEffect` de poser LA MÊME question — elle vivait en deux exemplaires
// qui ne disaient déjà pas la même chose, et un troisième barème (celui du
// bouclier) était écrit en dur sans que rien le nomme.
//
// ⚠️ Le vocabulaire s'ÉLARGIT sans rien renommer : chaque valeur écrite dans les
// données garde exactement le sens qu'elle avait. C'est ce qui dispense de
// migrer 93 attributs, et ce qui garantit qu'aucun effet livré ne bouge.
//
//   `active_unit`      les alliés VIVANTS de ce camp-ci        (historique)
//   `ARCH_xxx`         les unités D'EN FACE qui le portent     (historique)
//   `enemy:ARCH_xxx`   la même chose, dite explicitement       (nouveau)
//   `ally:ARCH_xxx`    les alliés qui le portent               (nouveau)
//   `enemy_unit`       les ennemis vivants — le pendant d'`active_unit`  (nouveau)
//   `one`              ×1, explicitement                       (nouveau)
//
// ⚠️ `one` n'est pas décoratif : il est le SEUL moyen d'annuler une échelle par
// défaut. Le bouclier d'attribut multiplie par les alliés vivants même sans
// `value_per` (c'est son barème, et `ARCH_066` en dépend pour 150 points) — sans
// `one`, un bouclier plat resterait inexprimable.

/** Les alliés vivants de ce camp-ci. */
export const ALLY_COUNT_SCALE = 'active_unit';
/** Les ennemis vivants. */
export const ENEMY_COUNT_SCALE = 'enemy_unit';
/** ×1, explicitement — annule une échelle par défaut. */
export const FLAT_SCALE = 'one';

const ALLY_PREFIX = 'ally:';
const ENEMY_PREFIX = 'enemy:';

interface Sided {
  isAlive(): boolean;
  attributes: string[];
}

/**
 * Le multiplicateur d'un effet.
 *
 * @param spec     la valeur de `value_per`, ou le défaut du type quand elle est absente
 * @param ownSide  les unités du camp qui PORTE l'effet
 * @param foeSide  celles d'en face
 *
 * ⚠️ Un `spec` absent rend 1, jamais 0 : l'absence est « pas d'échelle », et
 * c'est l'appelant qui décide si son type a un défaut. Rendre 0 sur l'absence
 * ferait taire tout effet qui n'en déclare pas — la panne exacte d'`active_unit`.
 *
 * ⚠️ Un `spec` qui ne désigne RIEN rend 0, et l'effet est donc muet. C'est
 * voulu et c'est ce que `attributes.test.ts` surveille sur le catalogue : un
 * critère qui ne peut rien compter est une faute de saisie, pas une intention,
 * et il vaut mieux qu'elle se voie au test que sur un plateau.
 */
export function effectScale(
  spec: string | null | undefined,
  ownSide: readonly Sided[],
  foeSide: readonly Sided[],
): number {
  if (!spec || spec === FLAT_SCALE) return 1;
  const alive = (list: readonly Sided[]) => list.filter(u => u.isAlive());
  if (spec === ALLY_COUNT_SCALE) return alive(ownSide).length;
  if (spec === ENEMY_COUNT_SCALE) return alive(foeSide).length;
  if (spec.startsWith(ALLY_PREFIX)) {
    const id = spec.slice(ALLY_PREFIX.length);
    return alive(ownSide).filter(u => u.attributes.includes(id)).length;
  }
  // ⚠️ Le préfixe `enemy:` et l'id NU disent la même chose. L'id nu est la forme
  // historique, portée par les données livrées ; on ne la migre pas, on la
  // reconnaît. Le préfixe existe pour que « d'en face » puisse s'ÉCRIRE, là où
  // l'id seul ne dit pas de quel côté il compte.
  const id = spec.startsWith(ENEMY_PREFIX) ? spec.slice(ENEMY_PREFIX.length) : spec;
  return alive(foeSide).filter(u => u.attributes.includes(id)).length;
}

/**
 * Cette échelle peut-elle compter quelque chose ?
 *
 * ⚠️ Sert à l'audit du catalogue, jamais au combat : une échelle qui nomme un
 * attribut inexistant rend toujours 0, donc un effet muet. Le combat, lui, n'a
 * pas à en juger — il compte ce qu'il trouve.
 */
export function scaleAttributeId(spec: string | null | undefined): string | null {
  if (!spec || spec === FLAT_SCALE || spec === ALLY_COUNT_SCALE || spec === ENEMY_COUNT_SCALE) return null;
  if (spec.startsWith(ALLY_PREFIX)) return spec.slice(ALLY_PREFIX.length);
  if (spec.startsWith(ENEMY_PREFIX)) return spec.slice(ENEMY_PREFIX.length);
  return spec;
}
