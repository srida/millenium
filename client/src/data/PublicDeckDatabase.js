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

// Portrait de l'adversaire. Le serveur retombe sur l'avatar par défaut quand le
// deck n'a pas le sien : l'URL est donc toujours affichable, aucun écran n'a à
// gérer le cas « pas d'avatar ».
export function avatarUrl(id) {
  return `/avatars/${id}`;
}
