// Où ranger les cartes d'un deck dans les lanes de tier, quand une carte peut
// porter PLUSIEURS tiers. Pur, testable — cf. Tiers.ts pour la même discipline.
//
// ⚠️ Une carte multi-tiers ne compte QUE POUR UNE, dans une SEULE lane : c'est
// le DeckBuilder qui vérifie l'unicité sur tout le deck (jamais la seule lane
// visée), ce module ne fait que dire OÙ la ranger.
import type { Card } from './types.js';
import { tiersOf } from './Tiers.js';

export type DeckLanes = Record<number, Card[]>;

/** La lane où cette carte est rangée, ou `null`. */
export function laneOf(d: DeckLanes, id: string): number | null {
  return [1, 2, 3, 4, 5].find(t => d[t].some(x => x.id === id)) ?? null;
}

/**
 * Cherche une place pour un des tiers de `eligibleTiers`, quitte à faire
 * BASCULER un occupant multi-tiers vers un AUTRE de ses tiers pour la libérer
 * (chemin augmentant, façon couplage biparti — chaque tier est un panier à
 * capacité `tierMax[t]`). `visited` empêche qu'un occupant soit bougé deux fois
 * dans la même recherche, donc aucune boucle.
 *
 * Rend le tier retenu ET l'état qui en résulte (occupants déjà déplacés en
 * cascade) — jamais l'état FINAL avec la carte posée, ça reste à l'appelant.
 * `null` = aucune place, même en poussant tout ce qui peut l'être.
 */
function findRoom(
  eligibleTiers: number[],
  d: DeckLanes,
  tierMax: Record<number, number>,
  visited: Set<string>,
): { tier: number; next: DeckLanes } | null {
  for (const t of eligibleTiers) {
    if (d[t].length < tierMax[t]) return { tier: t, next: d };
  }
  for (const t of eligibleTiers) {
    for (const occupant of d[t]) {
      if (visited.has(occupant.id)) continue;
      const elsewhere = tiersOf(occupant).filter(x => x !== t);
      if (elsewhere.length === 0) continue;
      visited.add(occupant.id);
      const freed = findRoom(elsewhere, d, tierMax, visited);
      if (!freed) continue;
      return {
        tier: t,
        next: {
          ...freed.next,
          [t]: freed.next[t].filter(x => x.id !== occupant.id),
          [freed.tier]: [...freed.next[freed.tier], occupant],
        },
      };
    }
  }
  return null;
}

/** La carte peut-elle rejoindre le deck, quitte à faire basculer un occupant
 *  multi-tiers vers un autre de ses tiers ? Pure — ne modifie rien. */
export function canPlace(c: Card, d: DeckLanes, tierMax: Record<number, number>): boolean {
  return findRoom(tiersOf(c), d, tierMax, new Set([c.id])) !== null;
}

/**
 * Où ranger une carte NEUVE : le plus bas de ses tiers qui a de la place —
 * directement, ou en poussant un occupant multi-tiers vers un autre de ses
 * tiers (cf. `findRoom`). `null` = injouable, personne ne peut bouger.
 *
 * ⚠️ C'est ce qui donne son sens au multi-tier : la carte COMBLE LES TROUS d'un
 * deck au lieu d'occuper d'office le haut du panier, et un ajout qui bloque sur
 * un tier plein peut quand même passer en poussant l'occupant qui, lui, a un
 * autre tier où aller.
 */
export function placeCard(c: Card, d: DeckLanes, tierMax: Record<number, number>): DeckLanes | null {
  const found = findRoom(tiersOf(c), d, tierMax, new Set([c.id]));
  if (!found) return null;
  return { ...found.next, [found.tier]: [...found.next[found.tier], c] };
}

/**
 * Fait DESCENDRE toute carte multi-tiers vers le plus bas de ses tiers qui a
 * de la place, en cascade : libérer une case dans un tier peut à son tour
 * permettre à une carte plus haut de descendre. Appelé après un RETRAIT — un
 * ajout passe déjà par `placeCard`, qui place directement au plus bas.
 *
 * ⚠️ Un ajout qui a dû POUSSER un occupant (`placeCard` → `findRoom`) ne doit
 * jamais être suivi d'un `settle` : la place que l'occupant vient de libérer
 * est aussitôt reprise par la carte qu'on ajoute, donc `settle` n'y trouve rien
 * à tirer — sans quoi la bascule de l'occupant serait défaite au tour suivant.
 */
export function settle(d: DeckLanes, tierMax: Record<number, number>): DeckLanes {
  let next = d;
  for (let t = 1; t <= 4; t++) {
    for (;;) {
      if (next[t].length >= tierMax[t]) break;
      let candidate: { tier: number; card: Card } | null = null;
      for (let t2 = t + 1; t2 <= 5; t2++) {
        for (const card of next[t2]) {
          if (!tiersOf(card).includes(t)) continue;
          if (!candidate || t2 < candidate.tier || (t2 === candidate.tier && card.id < candidate.card.id)) {
            candidate = { tier: t2, card };
          }
        }
      }
      if (!candidate) break;
      const { tier: fromTier, card } = candidate;
      next = {
        ...next,
        [fromTier]: next[fromTier].filter(x => x.id !== card.id),
        [t]: [...next[t], card],
      };
    }
  }
  return next;
}
