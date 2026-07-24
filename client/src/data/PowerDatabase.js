let list = null;
let byId = null;

export async function init() {
  if (list) return list;
  const res = await fetch('/api/powers');
  if (!res.ok) throw new Error(`PowerDatabase: fetch failed (${res.status})`);
  list = await res.json();
  byId = Object.fromEntries(list.map(p => [p.id, p]));
  return list;
}

export function getPower(id) {
  if (!byId) throw new Error('PowerDatabase not initialised — call init() first');
  return byId[id] ?? null;
}

export function getAllPowers() {
  if (!list) throw new Error('PowerDatabase not initialised — call init() first');
  return list;
}
