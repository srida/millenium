let _boards = [];
let _byId = {};
let _initialized = false;

export async function init() {
  if (_initialized) return;
  const res = await fetch('/api/boards');
  _boards = await res.json();
  _byId = Object.fromEntries(_boards.map(b => [b.id, b]));
  _initialized = true;
}

export function getBoard(id) {
  if (!_initialized) throw new Error('BoardDatabase not initialized');
  return _byId[id] ?? null;
}

// ⚠️ `getRandomBoard` a été SUPPRIMÉE : le tirage du terrain vit dans
// `logic/BoardPicker.pickBoard` — filtré par pertinence vis-à-vis des deux
// decks, conscient des terrains déjà joués, et SEMÉ par le `rand` de la partie.
// La laisser aurait maintenu un second chemin de tirage, ni filtré ni semé,
// portant très exactement le nom que la prochaine fonctionnalité aurait repris
// (même geste que `MagieDatabase.getRandomMagies`).
export function getAllBoards() {
  if (!_initialized) throw new Error('BoardDatabase not initialized');
  return _boards;
}
