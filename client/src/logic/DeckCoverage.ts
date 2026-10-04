// Ce qu'un deck « couvre » : ses cartes et leurs attributs — et donc les
// recettes d'invocation qu'il peut déjà payer. Pur, sans dépendance data.
//
// ⚠️ La contrainte qui commande ce module : au-delà du tier 2, le catalogue
// n'a presque aucune invocation NORMALE. Tout générateur de deck (simulation,
// tutoriel, draft) doit donc savoir si une carte de haut tier est invocable
// avec ce qu'il a déjà retenu. La question n'existe qu'ici.
import { isAttributeMaterial } from './InvocationManager.js';
import type { Card, SummonCondition } from './types.js';

/** Les conditions d'une carte ; une liste vide = aucune exigence. */
function conditionsOf(card: Card): SummonCondition[] {
  return card.summon_conditions ?? [];
}

/** Les matériels NOMMÉS d'une condition — les seuls qu'une couverture puisse
 *  garantir ; un coût purement chiffré se paie avec n'importe quoi. */
function requiresOf(condition: SummonCondition | undefined): string[] {
  return condition?.requires ?? [];
}

/** Une condition suffit. Un matériau `ARCH_*` désigne n'importe quel porteur de
 *  l'attribut, pas une carte — d'où les deux couvertures. */
export function isSummonable(card: Card, ids: ReadonlySet<string>, attrs: ReadonlySet<string>): boolean {
  const conditions = conditionsOf(card);
  if (conditions.length === 0) return true;
  return conditions.some(cd =>
    requiresOf(cd).every(m => (isAttributeMaterial(m) ? attrs.has(m) : ids.has(m))));
}

export interface Coverage {
  ids: Set<string>;
  attrs: Set<string>;
}

/** La couverture d'une liste de cartes. */
export function coverageOf(cards: readonly Card[]): Coverage {
  const ids = new Set<string>();
  const attrs = new Set<string>();
  for (const c of cards) {
    ids.add(c.id);
    for (const a of c.attributes ?? []) attrs.add(a);
  }
  return { ids, attrs };
}

/**
 * Les matériels nommés qui MANQUENT aux cartes du deck encore impayables : ceux
 * de leur recette la plus proche d'être couverte (le moins d'exigences
 * manquantes, à égalité la première). Une carte invocable ne manque de rien.
 */
export function missingMaterials(cards: readonly Card[], cov: Coverage = coverageOf(cards)): Coverage {
  const ids = new Set<string>();
  const attrs = new Set<string>();
  for (const card of cards) {
    if (isSummonable(card, cov.ids, cov.attrs)) continue;
    let best: string[] | null = null;
    for (const cd of conditionsOf(card)) {
      const lack = requiresOf(cd).filter(m => (isAttributeMaterial(m) ? !cov.attrs.has(m) : !cov.ids.has(m)));
      if (best === null || lack.length < best.length) best = lack;
    }
    for (const m of best ?? []) (isAttributeMaterial(m) ? attrs : ids).add(m);
  }
  return { ids, attrs };
}

/** La carte comble-t-elle l'un des manques ? (par son id, ou un attribut). */
export function fillsMissing(card: Card, missing: Coverage): boolean {
  if (missing.ids.has(card.id)) return true;
  return (card.attributes ?? []).some(a => missing.attrs.has(a));
}
