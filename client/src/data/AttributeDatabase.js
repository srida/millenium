let list = null;
let byId = null;

export async function init() {
  if (list) return list;
  const res = await fetch('/api/attributes');
  if (!res.ok) throw new Error(`AttributeDatabase: fetch failed (${res.status})`);
  list = await res.json();
  byId = Object.fromEntries(list.map(a => [a.id, a]));
  return list;
}

export function getAttribute(id) {
  if (!byId) throw new Error('AttributeDatabase not initialised — call init() first');
  return byId[id] ?? null;
}

export function getAllAttributes() {
  if (!list) throw new Error('AttributeDatabase not initialised — call init() first');
  return list;
}

// Dictionnaire direct : { [id]: attribute }
export function getAttributes() {
  if (!byId) throw new Error('AttributeDatabase not initialised — call init() first');
  return byId;
}
