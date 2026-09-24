// CardLinks — les cartes LIÉES à une carte : ses matériels, sa lignée, et les
// cartes dont une recette la nomme comme matériel.
//
// Pur, comme `SummonInfo` dont il réutilise les primitives — testable sans DOM,
// et surtout SANS ré-écrire une seconde fois la lecture de `summon_conditions`
// que `SummonInfo`/`InvocationManager` possèdent déjà.
//
// ⚠️ « Qui consomme cette carte ? » est la question que le champ `materiau` de
// `card-query.mjs` pose déjà à la barre de recherche (`materiau:CORE_001`) —
// mais en SOUS-CHAÎNE (`:` sur un champ texte), ce qui convient à une recherche
// libre et pas à une liste fermée. Ici la comparaison est stricte : les deux
// posent la même question, sur les mêmes données (`summon_conditions[].requires`
// via `InvocationManager`), sans jamais pouvoir diverger sur CE qu'elles lisent —
// seulement sur la tolérance de la comparaison, qui est tout l'objet des deux.
import type { Card } from '../logic/types.js';
import { summonConditions, conditionRequires } from '../logic/InvocationManager.js';
import { summonRecipes } from './SummonInfo.js';

export interface LinkedCardGroups {
  /** Ce que SES recettes consomment — matériels NOMMÉS par id de carte (les
   *  matériels d'attribut, `ARCH_*`, ne désignent pas une fiche à lister ici). */
  materials: Card[];
  /** Sa lignée héritée (`represented_ids`, moins elle-même). */
  lineage: Card[];
  /** Les cartes dont au moins une recette la nomme comme matériel. */
  usedBy: Card[];
}

function resolve(ids: Iterable<string>, byId: Map<string, Card>): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = byId.get(id);
    // Un id sans fiche (catalogue édité entre-temps) est silencieusement omis,
    // comme partout ailleurs pour une référence qui a quitté le catalogue.
    if (c) out.push(c);
  }
  return out;
}

/**
 * Les trois groupes, résolus contre `allCards` — le catalogue complet, pas
 * seulement le pool visible à l'écran d'où le tooltip a été ouvert : une
 * carte qui la consomme peut très bien vivre hors du deck ou du pack en cours.
 */
export function linkedCardGroups(card: Card, allCards: Card[]): LinkedCardGroups {
  const byId = new Map(allCards.map(c => [c.id, c]));
  const materialIds = summonRecipes(card).flatMap(r => r.requires)
    .filter(m => m.kind === 'card').map(m => m.id);
  const lineageIds = (card.represented_ids ?? []).filter(id => id !== card.id);
  const usedBy = allCards.filter(c => c.id !== card.id
    && summonConditions(c).some(cond => conditionRequires(cond).includes(card.id)));
  return {
    materials: resolve(materialIds, byId),
    lineage: resolve(lineageIds, byId),
    usedBy,
  };
}

export function hasLinkedCards(groups: LinkedCardGroups): boolean {
  return groups.materials.length > 0 || groups.lineage.length > 0 || groups.usedBy.length > 0;
}
