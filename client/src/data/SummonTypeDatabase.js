// Catalogue admin des 6 types d'invocation (normal/sacrifice/fusion/heritage/
// transformation, plus `multi` pour les cartes à `summon_options`) — même
// patron que PowerDatabase.js. Indexé par `type` (la clé brute déjà utilisée
// partout, `normal`/`sacrifice`/…), pas par `id` : tous les appelants
// existants raisonnent en `summon_type` (ou `'multi'`), jamais en id de catalogue.
let list = null;
let byType = null;

export async function init() {
  if (list) return list;
  const res = await fetch('/api/summon-types');
  if (!res.ok) throw new Error(`SummonTypeDatabase: fetch failed (${res.status})`);
  list = await res.json();
  byType = Object.fromEntries(list.map(s => [s.type, s]));
  return list;
}

export function getSummonTypeByType(type) {
  if (!byType) throw new Error('SummonTypeDatabase not initialised — call init() first');
  return byType[type] ?? null;
}

export function getAllSummonTypes() {
  if (!list) throw new Error('SummonTypeDatabase not initialised — call init() first');
  return list;
}
