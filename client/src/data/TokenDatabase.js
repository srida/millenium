// Catalogue des TOKENS — `data/tokens.json`, édité depuis le panneau
// d'administration (onglet 🪙 Tokens). Même patron que les autres databases :
// un `init()` async, puis un cache mémoire.
//
// Un token est l'unité éphémère que POWER_SUMMON_TOKEN invoque en plein
// combat (`logic/CombatManager.js`) — jamais posée par l'invocation normale,
// jamais dans un deck. Son art vit dans le dossier des ILLUSTRATIONS, sous
// l'id du token, comme les dos de cartes et les variantes : `/illustrations/<id>`
// le sert sans nouvelle route.
let list = null;
let byId = null;

export async function init() {
  if (list) return list;
  const res = await fetch('/api/tokens');
  if (!res.ok) throw new Error(`TokenDatabase: fetch failed (${res.status})`);
  list = await res.json();
  byId = Object.fromEntries(list.map(t => [t.id, t]));
  return list;
}

export function getToken(id) {
  if (!byId) throw new Error('TokenDatabase not initialised — call init() first');
  return byId[id] ?? null;
}

export function getAllTokens() {
  if (!list) throw new Error('TokenDatabase not initialised — call init() first');
  return list;
}
