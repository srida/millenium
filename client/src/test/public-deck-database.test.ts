// Golden test de l'exclusion des decks de bots ET des decks invité côté client.
//
// `/api/decks` porte les decks publics, les decks de bots (`bot: true`, cf.
// `bots.js`) et les decks invité (`guest: true`, réservés aux joueurs sans
// compte pour essayer le jeu) depuis leur fusion dans le même fichier.
// `getAllDecks()` est le SEUL funnel par lequel un joueur peut choisir un
// adversaire (DeckSelector 'play', 🎲 Aléatoire, Tournoi) — s'il ne filtrait
// pas, un deck de bot OU un deck invité deviendrait un adversaire solo
// choisissable, exactement ce que la fusion ne doit jamais laisser passer.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const RAW = [
  { id: 'PUBLIC_DECK_001', name: 'Jaden', deck: {}, difficulty: 2 },
  { id: 'BOT_DECK_001', name: 'Nid du Dragon', deck: {}, difficulty: 4, bot: true },
  { id: 'GUEST_DECK_001', name: 'Essai — Raptors', deck: {}, difficulty: 1, guest: true },
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

  it('exclut aussi les decks `guest: true` — jamais un adversaire choisissable', async () => {
    const db = await import('../data/PublicDeckDatabase.js');
    await db.init();
    const ids = db.getAllDecks().map((d: { id: string }) => d.id);
    expect(ids).not.toContain('GUEST_DECK_001');
  });

  it('`getDeck` reste sans filtre : l\'admin doit pouvoir composer un deck de bot ou invité', async () => {
    const db = await import('../data/PublicDeckDatabase.js');
    await db.init();
    expect(db.getDeck('BOT_DECK_001')?.id).toBe('BOT_DECK_001');
    expect(db.getDeck('GUEST_DECK_001')?.id).toBe('GUEST_DECK_001');
  });
});

describe('PublicDeckDatabase.getGuestDecks', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve(RAW) })));
  });

  it('ne rend que les decks `guest: true`', async () => {
    const db = await import('../data/PublicDeckDatabase.js');
    await db.init();
    const ids = db.getGuestDecks().map((d: { id: string }) => d.id);
    expect(ids).toEqual(['GUEST_DECK_001']);
  });
});
