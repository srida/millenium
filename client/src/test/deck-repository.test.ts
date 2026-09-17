// `DeckRepository` est un wrapper localStorage — non testable en environnement
// node pur (pas de `localStorage` global, cf. vitest.config.ts). Seul son
// cœur pur, `freeNameAmong`, est importable sans effet de bord et testé ici :
// c'est la règle de nommage partagée par `findFreeName` (deck du joueur) et
// `adoptGuestDeck` (copie d'un deck invité) — une règle recopiée à deux
// endroits est une règle qu'on corrige à un seul.
import { describe, it, expect } from 'vitest';
import { freeNameAmong } from '../data/DeckRepository.js';

describe('DeckRepository.freeNameAmong', () => {
  it('rend le nom tel quel si libre', () => {
    expect(freeNameAmong('Mon deck', [])).toBe('Mon deck');
    expect(freeNameAmong('Mon deck', ['Autre deck'])).toBe('Mon deck');
  });

  it('ajoute " (2)" si le nom est pris', () => {
    expect(freeNameAmong('Mon deck', ['Mon deck'])).toBe('Mon deck (2)');
  });

  it('avance au premier numéro libre', () => {
    expect(freeNameAmong('Mon deck', ['Mon deck', 'Mon deck (2)'])).toBe('Mon deck (3)');
    expect(freeNameAmong('Mon deck', ['Mon deck', 'Mon deck (3)'])).toBe('Mon deck (2)');
  });
});
