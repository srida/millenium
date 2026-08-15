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

// Échelle de difficulté d'un deck public (1..4), posée en admin et lue par le
// mode Arcade (`arcade.difficultyOf`) comme par la sélection d'adversaire solo.
// Une difficulté ABSENTE vaut 1 : le champ est postérieur aux decks livrés, et
// une base déjà déployée n'est pas rétro-alimentée par `initial-data/`.
export const MAX_DIFFICULTY = 4;
const DIFFICULTY_LABELS = { 1: 'Initiation', 2: 'Confirmé', 3: 'Vétéran', 4: 'Élite' };

export function difficultyOf(deck) {
  const raw = Math.round(Number(deck?.difficulty));
  if (!Number.isFinite(raw)) return 1;
  return Math.min(MAX_DIFFICULTY, Math.max(1, raw));
}

export function difficultyLabel(difficulty) {
  return DIFFICULTY_LABELS[difficulty] ?? `Niveau ${difficulty}`;
}

// Portrait de l'adversaire. Le serveur retombe sur l'avatar par défaut quand le
// deck n'a pas le sien : l'URL est donc toujours affichable, aucun écran n'a à
// gérer le cas « pas d'avatar ».
export function avatarUrl(id) {
  return `/avatars/${id}`;
}
