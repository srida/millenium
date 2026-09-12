// Golden test de l'exclusion des decks de bots côté client.
//
// `/api/decks` porte les decks publics ET les decks de bots (`bot: true`,
// cf. `bots.js`) depuis leur fusion dans le même fichier. `getAllDecks()` est
// le SEUL funnel par lequel un joueur peut choisir un adversaire (DeckSelector
// 'play', 🎲 Aléatoire, Tournoi) — s'il ne filtrait pas, un deck de bot
// deviendrait un adversaire solo choisissable, exactement ce que la fusion ne
// doit jamais laisser passer.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const RAW = [
  { id: 'PUBLIC_DECK_001', name: 'Jaden', deck: {}, difficulty: 2 },
  { id: 'BOT_DECK_001', name: 'Nid du Dragon', deck: {}, difficulty: 4, bot: true },
];

describe('PublicDeckDatabase.getAllDecks', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve(RAW) })));
  });

  it('exclut les decks `bot: true` — jamais un adversaire choisissable', async () => {
    const db = await import('../data/PublicDeckDatabase.js');
    await db.init();
    const ids = db.getAllDecks().map((d: { id: string }) => d.id);
    expect(ids).toEqual(['PUBLIC_DECK_001']);
  });

  it('`getDeck` reste sans filtre : l\'admin doit pouvoir composer un deck de bot', async () => {
    const db = await import('../data/PublicDeckDatabase.js');
    await db.init();
    expect(db.getDeck('BOT_DECK_001')?.id).toBe('BOT_DECK_001');
  });
});
