// SummonInfo — lecture PRÉSENTABLE des recettes d'invocation d'une carte.
//
// Pur, sans aucun import : ni React, ni Zustand, ni base de données. Les
// matériels sont rendus par leur **id** ; c'est l'appelant qui résout les noms
// (le tooltip via CardDatabase). C'est ce qui rend le module testable dans la
// suite vitest, qui tourne en node sans jsdom — même raison que
// `data/tutorialScript.ts`.
//
// Une carte à `summon_options` porte plusieurs recettes ; sa `summon_type` /
// son `cost` de premier niveau ne sont alors qu'un miroir de l'une d'elles et
// ne sont PAS lus (`summon()` ne regarde que les options).
import type { Card, SummonCost, SummonType } from '../logic/types.js';
import { isAttributeMaterial } from '../logic/InvocationManager.js';

export const SUMMON_LABELS: Record<string, string> = {
  normal: 'Normale', sacrifice: 'Sacrifice', fusion: 'Fusion',
  heritage: 'Héritage', transformation: 'Transformation',
};

export const SUMMON_ICONS: Record<string, string> = {
  normal: '✋', sacrifice: '💀', fusion: '⚗', heritage: '🔮', transformation: '🔄',
};

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
  /** Index dans `summon_options`, ou `null` quand la carte n'a qu'une recette. */
  index: number | null;
  summon_type: SummonType;
  label: string;
  icon: string;
  /** Matériels requis (fusion / héritage) ou monstre à transformer. */
  materials: SummonMaterial[];
  /** Nombre de tributs (sacrifice / héritage). */
  sacrifice: number;
  /** Transformation offerte par une magie : plus de cible à désigner. */
  free: boolean;
  /** Coût en tributs d'origine quand une magie l'a réduit, sinon `null`. */
  discountedFrom: number | null;
}

// Ce que chaque voie LIT réellement dans son coût (cf. InvocationManager) : un
// `sacrifice` posé sur une fusion, ou des `materials` posés sur un sacrifice,
// ne sont jamais vérifiés — les afficher ferait mentir le tooltip.
const READS_MATERIALS: Record<string, boolean> = {
  normal: false, sacrifice: false, fusion: true, heritage: true, transformation: true,
};
const READS_SACRIFICE: Record<string, boolean> = {
  normal: false, sacrifice: true, fusion: false, heritage: true, transformation: false,
};

function recipe(card: Card, type: SummonType, cost: SummonCost | undefined, index: number | null): SummonRecipe {
  const free = type === 'transformation' && card._free_transformation === true;
  const sacrifice = READS_SACRIFICE[type] ? (cost?.sacrifice ?? 0) : 0;
  const original = card._original_sacrifice ?? null;
  return {
    index,
    summon_type: type,
    label: SUMMON_LABELS[type] ?? type,
    icon: SUMMON_ICONS[type] ?? '',
    materials: free || !READS_MATERIALS[type] ? [] : (cost?.materials ?? []).map(id => ({
      id, kind: isAttributeMaterial(id) ? 'attribute' as const : 'card' as const,
    })),
    sacrifice,
    free,
    discountedFrom: type === 'sacrifice' && original !== null && original !== sacrifice ? original : null,
  };
}

/** Les voies d'invocation de la carte — une par `summon_options`, sinon une seule. */
export function summonRecipes(card: Card): SummonRecipe[] {
  const options = card.summon_options;
  if (Array.isArray(options) && options.length > 0) {
    return options.map((opt, index) => recipe(card, opt.summon_type, opt.cost, index));
  }
  return [recipe(card, card.summon_type ?? 'normal', card.cost, null)];
}

/**
 * Ce que coûte la recette, en toutes lettres et sans les matériels nommés
 * (l'appelant les rend à part, il est seul à savoir les nommer).
 * `null` quand il n'y a rien à exiger — invocation directe.
 */
export function recipeCostText(r: SummonRecipe): string | null {
  const parts: string[] = [];
  if (r.sacrifice > 0) parts.push(`${r.sacrifice} tribut${r.sacrifice > 1 ? 's' : ''}`);
  if (r.free) parts.push('sans cible (magie)');
  if (r.discountedFrom !== null) parts.push(`réduit de ${r.discountedFrom}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Libellé du bloc « matériels ». Trois sens différents, d'où trois mots :
 * la transformation désigne une **cible** qu'elle remplace ; l'héritage
 * contraint les tributs déjà comptés (« dont »), il n'en exige pas en plus ;
 * la fusion, elle, liste bien ses matériaux.
 */
export function materialsLabel(r: SummonRecipe): string {
  if (r.summon_type === 'transformation') return 'Transforme';
  if (r.summon_type === 'heritage') return 'dont';
  return r.materials.length > 1 ? 'Matériels' : 'Matériel';
}

/** Une carte n'exigeant rien du tout (normale, sans tribut ni matériel). */
export function recipeIsFree(r: SummonRecipe): boolean {
  return r.materials.length === 0 && r.sacrifice === 0 && !r.free && r.discountedFrom === null;
}
