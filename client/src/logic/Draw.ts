import type { Card, GuaranteedDraw } from './types.js';

// Tiers available per round:
// T1: R1  T2: R1+  T3: R3+  T4: R4+  T5: R5+
// R1:[1]  R2:[1,2]  R3:[1,2,3]  R4:[2,3,4]  R5+:[3,4,5]
export function tiersForRound(round: number): number[] {
  if (round <= 1) return [1];
  if (round === 2) return [1, 2];
  if (round === 3) return [1, 2, 3];
  if (round === 4) return [2, 3, 4];
  return [3, 4, 5];
}

// Draw `count` cards randomly from the eligible tiers (duplicates allowed).
// `rand` est injecté pour que la simulation d'équilibrage puisse SEMER la
// pioche (cf. logic/Random.ts) ; le défaut laisse le jeu inchangé.
export function drawHand(
  cardsByTier: Record<number, Card[]>,
  round: number,
  count: number,
  rand: () => number = Math.random,
): Card[] {
  const pool = tiersForRound(round).flatMap(t => cardsByTier[t] ?? []);
  if (pool.length === 0) return [];
  const hand: Card[] = [];
  for (let i = 0; i < count; i++) {
    // Clone so two draws of the same card_id are distinct object instances —
    // HandUI's selection (in non-grouped mode) compares cards by reference.
    hand.push({ ...pool[Math.floor(rand() * pool.length)] });
  }
  return hand;
}

/** Les critères d'une pioche garantie, sous leur forme NORMALISÉE. */
export interface GuaranteedDrawCriteria {
  tier: number | null;
  /** Tous exigés (ET). Fond `attribute` (forme historique) et `attributes`. */
  attributes: string[];
  /** Cartes acceptables (OU entre elles). Vide = aucune restriction de carte. */
  cardIds: string[];
}

/**
 * ⚠️ SEUL lecteur de la forme brute d'une pioche garantie. Les deux écritures
 * de l'attribut (`attribute` seul, hérité, et `attributes` en liste) et la
 * liste de cartes se lisent ici et nulle part ailleurs — sinon la magie, le
 * moteur de pioche, le filtre de pertinence et l'annonce finiraient par ne pas
 * lire la même promesse.
 */
export function guaranteedDrawCriteria(draw: GuaranteedDraw | null | undefined): GuaranteedDrawCriteria {
  const attributes = [
    ...(draw?.attribute ? [draw.attribute] : []),
    ...(Array.isArray(draw?.attributes) ? draw.attributes : []),
  ].filter((id): id is string => !!id);
  return {
    tier: draw?.tier || null,
    attributes: [...new Set(attributes)],
    cardIds: [...new Set((Array.isArray(draw?.card_ids) ? draw.card_ids : []).filter(Boolean))],
  };
}

/** Une carte satisfait-elle des critères ? `ignoreTier` sert le repli. */
export function matchesGuaranteedDraw(
  card: Card,
  criteria: GuaranteedDrawCriteria,
  { ignoreTier = false } = {},
): boolean {
  if (!ignoreTier && criteria.tier && card.tier !== criteria.tier) return false;
  if (criteria.cardIds.length > 0 && !criteria.cardIds.includes(card.id)) return false;
  return criteria.attributes.every(id => card.attributes?.includes(id));
}

/** Y a-t-il quelque chose à promettre ? Une pioche garantie sans aucun critère
 *  déplace un slot de pioche aléatoire vers… une pioche aléatoire. */
export function hasGuaranteedDrawCriteria(draw: GuaranteedDraw | null | undefined): boolean {
  const c = guaranteedDrawCriteria(draw);
  return !!c.tier || c.attributes.length > 0 || c.cardIds.length > 0;
}

/**
 * Résout des pioches GARANTIES sur un pool — tout le deck, sans restriction
 * de tier du tour. Une entrée = une carte, avec double repli : d'abord tous
 * les critères, puis sans le tier, puis n'importe quelle carte du pool.
 *
 * Extrait de `GameSession.startPreparation` pour être PARTAGÉ avec `EnemyAI`
 * — la pioche garantie a un destinataire des deux côtés (attributs
 * `guaranteed_draw`), et une règle recopiée à deux endroits est une règle
 * qu'on corrige à un seul. Comportement du joueur inchangé au bit près
 * (mêmes filtres, même ordre de repli, même nombre d'appels à `rand` par
 * entrée) — c'est un refactor, pas une nouvelle règle.
 */
export function resolveGuaranteedDraws(
  fullPool: Card[],
  guaranteedDraws: GuaranteedDraw[],
  rand: () => number = Math.random,
): Card[] {
  const drawn: Card[] = [];
  for (const draw of guaranteedDraws) {
    const criteria = guaranteedDrawCriteria(draw);
    const matches = fullPool.filter(c => matchesGuaranteedDraw(c, criteria));
    if (matches.length > 0) {
      drawn.push({ ...matches[Math.floor(rand() * matches.length)] });
      continue;
    }
    // Premier repli : le TIER saute en premier — c'est le critère que le pool
    // du tour contraint déjà, et le seul dont l'absence ne trahit pas l'intention.
    const fallback = fullPool.filter(c => matchesGuaranteedDraw(c, criteria, { ignoreTier: true }));
    if (fallback.length > 0) {
      drawn.push({ ...fallback[Math.floor(rand() * fallback.length)] });
    } else if (fullPool.length > 0) {
      drawn.push({ ...fullPool[Math.floor(rand() * fullPool.length)] });
    }
  }
  return drawn;
}
