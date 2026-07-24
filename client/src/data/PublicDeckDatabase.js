let _decks = null;

export async function init() {
  if (_decks !== null) return;
  _decks = await fetch('/api/decks').then(r => r.json()).catch(() => []);
  if (!Array.isArray(_decks)) _decks = [];
}

export function getAllDecks() {
  return _decks || [];
}

export function getDeck(id) {
  return (_decks || []).find(d => d.id === id) ?? null;
}
