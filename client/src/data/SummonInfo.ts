// SummonInfo — lecture PRÉSENTABLE des conditions d'invocation d'une carte.
//
// Pur, sans aucun import de React / Zustand / base de données. Les matériels
// sont rendus par leur **id** ; c'est l'appelant qui résout les noms (le
// tooltip via CardDatabase). C'est ce qui rend le module testable dans la suite
// vitest, qui tourne en node sans jsdom — même raison que `data/BoardInfo.ts`.
//
// ⚠️ **Aucune des cinq voies historiques n'existe plus ici.** Il n'y a qu'un
// COÛT — un nombre de slots de matériau, dont certains peuvent être nommés — et
// tout ce que le tooltip disait par voie se dérive maintenant de ce coût :
//   « Transformation » = une condition à un matériel nommé ;
//   « Fusion »         = autant d'exigences nommées que de slots ;
//   « Héritage »       = moins d'exigences que de slots (d'où le « dont ») ;
//   « Sacrifice »      = aucune exigence nommée ;
//   « Normale »        = aucune condition.
// Les libellés restent lisibles par le joueur sous forme d'ATTRIBUTS de carte,
// affichés comme n'importe quel autre archétype.
import type { Card, SummonCondition } from '../logic/types.js';
import {
  isAttributeMaterial, summonConditions, conditionMaterials, conditionRequires,
} from '../logic/InvocationManager.js';

/**
 * Un matériel exigé. `kind: 'attribute'` désigne **n'importe quelle** unité
 * portant l'attribut, là où `'card'` nomme une carte précise — deux exigences
 * qui ne se lisent pas pareil, et que l'appelant ne peut pas résoudre dans la
 * même base (cf. `matchesMaterial`).
 */
export interface SummonMaterial {
  id: string;
  kind: 'card' | 'attribute';
}

export interface SummonRecipe {
  /** Index dans `summon_conditions`, ou `null` quand la carte n'en a aucune. */
  index: number | null;
  /** Slots de matériau exigés, comptés en `material_value`. Zéro = pose directe. */
  materials: number;
  /** Les exigences NOMMÉES — un sous-ensemble des slots ci-dessus. */
  requires: SummonMaterial[];
  /** Le coût d'AVANT la remise quand une magie est passée par là, sinon `null`. */
  discountedFrom: { materials: number; requires: number } | null;
}

function material(id: string): SummonMaterial {
  return { id, kind: isAttributeMaterial(id) ? 'attribute' : 'card' };
}

function recipe(condition: SummonCondition | null, index: number | null, before: SummonCondition | null): SummonRecipe {
  const materials = condition ? conditionMaterials(condition) : 0;
  const requires = condition ? conditionRequires(condition) : [];
  const original = before
    ? { materials: conditionMaterials(before), requires: conditionRequires(before).length }
    : null;
  return {
    index,
    materials,
    requires: requires.map(material),
    // Une remise qui n'a rien changé à CETTE condition ne s'annonce pas : la
    // magie a bien été jouée, mais pas sur cette voie-là.
    discountedFrom: original && (original.materials !== materials || original.requires !== requires.length)
      ? original
      : null,
  };
}

/**
 * Les voies d'invocation de la carte — une par condition. Une carte SANS
 * condition en rend quand même une (coût nul) : l'appelant a toujours une
 * recette à lire, et `recipeIsFree` lui dit qu'il n'y a rien à afficher.
 */
export function summonRecipes(card: Card): SummonRecipe[] {
  const conditions = summonConditions(card);
  const before = card._discounted_from ?? null;
  if (conditions.length === 0) return [recipe(null, null, null)];
  return conditions.map((cd, index) => recipe(cd, index, before?.[index] ?? null));
}

/**
 * Le coût de la carte en un seul chiffre : sa voie la moins chère. C'est ce que
 * la vignette affiche — un nombre, sans icône de voie ni libellé, puisqu'il n'y
 * a plus de voie à nommer.
 *
 * ⚠️ Même définition que `InvocationManager.summonCost`, dont il est le pendant
 * d'affichage ; il la RÉUTILISE plutôt que de la recalculer.
 */
export function summonCostOf(card: Card): number {
  const recipes = summonRecipes(card);
  return Math.min(...recipes.map(r => r.materials));
}

/**
 * Ce que coûte la recette, en toutes lettres et sans les matériels nommés
 * (l'appelant les rend à part, il est seul à savoir les nommer).
 * `null` quand il n'y a rien à exiger — invocation directe.
 */
export function recipeCostText(r: SummonRecipe): string | null {
  const parts: string[] = [];
  if (r.materials > 0) parts.push(`${r.materials} matériel${r.materials > 1 ? 's' : ''}`);
  if (r.discountedFrom !== null) {
    // La remise se dit sur ce qu'elle a réellement bougé : baisser le prix et
    // lever une contrainte sont deux gestes distincts (cf. `reduce_materials`
    // et `remove_requirements`), et les confondre ferait mentir l'infobulle.
    if (r.discountedFrom.materials !== r.materials) parts.push(`au lieu de ${r.discountedFrom.materials} (magie)`);
    else parts.push(`${r.discountedFrom.requires - r.requires.length} exigence(s) levée(s) (magie)`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Libellé du bloc « matériels ». Deux sens, et ils se dérivent du coût seul :
 * quand la condition nomme AUTANT d'exigences qu'elle a de slots, elle les
 * liste tous (« Matériels ») ; quand elle en nomme moins, les autres slots
 * restent libres et les exigences sont prises **dedans** (« dont »).
 *
 * C'était la distinction Fusion / Héritage, écrite en dur ; elle tombe du coût.
 */
export function materialsLabel(r: SummonRecipe): string {
  if (r.requires.length < r.materials) return 'dont';
  return r.requires.length > 1 ? 'Matériels' : 'Matériel';
}

/** Une carte n'exigeant rien du tout : elle se pose, point. */
export function recipeIsFree(r: SummonRecipe): boolean {
  return r.materials === 0 && r.requires.length === 0 && r.discountedFrom === null;
}
