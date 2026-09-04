import { tiersOf } from '../logic/Tiers.js';

let cards = null;
let byId = null;
let byTier = null;

export async function init() {
  if (cards) return cards;
  const res = await fetch('/api/cards');
  if (!res.ok) throw new Error(`CardDatabase: fetch failed (${res.status})`);
  cards = await res.json();
  byId = Object.fromEntries(cards.map(c => [c.id, c]));
  // ⚠️ Le tier est un ATTRIBUT, et une carte peut en porter plusieurs : elle
  // entre alors dans PLUSIEURS cases. Les tiers sont déjà résolus par le
  // serveur (`_tiers`, calculé et jamais persisté) — on ne fait que les lire,
  // et l'ORDRE d'insertion reste celui de `cards.json` : c'est lui que la
  // pioche semée indexe.
  byTier = {};
  for (const c of cards) {
    for (const t of tiersOf(c)) {
      if (!byTier[t]) byTier[t] = [];
      byTier[t].push(c);
    }
  }
  return cards;
}

export function getCard(id) {
  if (!byId) throw new Error('CardDatabase not initialised — call init() first');
  return byId[id] ?? null;
}

export function getCardsByTier(tier) {
  if (!byTier) throw new Error('CardDatabase not initialised — call init() first');
  return byTier[tier] ?? [];
}

export function getAllCards() {
  if (!cards) throw new Error('CardDatabase not initialised — call init() first');
  return cards;
}


// ⚠️ `costHint` a disparu : elle décrivait une pastille PAR VOIE d'invocation,
// une notion que le moteur n'a plus. Le coût d'une carte est un nombre, et il
// se lit en un seul endroit — `data/SummonInfo.summonCostOf`, qui délègue à
// `InvocationManager.summonCost`.
