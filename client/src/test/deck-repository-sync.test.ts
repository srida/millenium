/* eslint-disable @typescript-eslint/no-explicit-any */
// DeckRepository — la couche de synchro multi-appareils (horodatage par deck,
// pierres tombales, réponse de fusion appliquée au cache). `localStorage` et
// `fetch` sont posés à la main : la suite tourne en node, sans DOM.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

const D = (id: string) => ({ '1': [id], '2': [], '3': [], '4': [], '5': [] });
let sent: any[] = [];
let respond: (body: any) => any;

async function load() {
  vi.resetModules();
  const Auth = await import('../data/AuthClient.js');
  (globalThis as any).fetch = vi.fn(async (url: string, init?: any) => {
    if (url.endsWith('/auth/me')) return { ok: true, json: async () => ({ user: { id: 'u1' } }) };
    if (init?.method === 'PUT') {
      const body = JSON.parse(init.body);
      sent.push(body.book);
      return { ok: true, json: async () => ({ ok: true, book: await respond(body.book) }) };
    }
    return { ok: true, json: async () => ({ book: null }) };
  });
  await (Auth as any).me();
  localStorage.setItem('soulforge_synced_user', 'u1');   // cache déjà lié à ce compte
  return await import('../data/DeckRepository.js') as any;
}

beforeEach(() => { store.clear(); sent = []; respond = (b) => b; });

describe('DeckRepository — horodatage et fusion', () => {
  it('chaque mutation horodate le deck, la suppression laisse une pierre tombale', async () => {
    const R = await load();
    R.saveDeck('A', D('a'));
    R.setDeckColor('A', 'red');
    R.saveDeck('B', D('b'));
    R.deleteDeck('B');
    await R.flushSync();
    const book = sent.at(-1);
    expect(book.stamps.A).toBeGreaterThan(0);
    expect(book.deleted.B).toBeGreaterThan(0);
    expect(book.stamps.B).toBeUndefined();
    expect(book.decks.B).toBeUndefined();
  });

  it('renommer = pierre tombale sur l\'ancien nom + horodatage du nouveau', async () => {
    const R = await load();
    R.saveDeck('Vieux', D('a'));
    R.renameDeck('Vieux', 'Neuf');
    await R.flushSync();
    const book = sent.at(-1);
    expect(book.deleted.Vieux).toBeGreaterThan(0);
    expect(book.stamps.Neuf).toBeGreaterThan(0);
  });

  it('applique le livre fusionné renvoyé par le serveur (deck venu d\'un autre appareil)', async () => {
    const R = await load();
    R.saveDeck('A', D('a'));
    respond = (b) => ({ ...b, decks: { ...b.decks, DELAUTRE: D('x') }, stamps: { ...b.stamps, DELAUTRE: 1 } });
    const changed = await R.flushSync();
    expect(changed).toBe(true);
    expect(R.listDecks().sort()).toEqual(['A', 'DELAUTRE']);
  });

  it('une modification faite PENDANT le vol n\'est pas écrasée par la réponse', async () => {
    const R = await load();
    R.saveDeck('A', D('v1'));
    respond = async (b) => {
      R.saveDeck('A', D('v2'));          // l'utilisateur édite pendant la requête
      return b;                           // la réponse porte encore v1
    };
    await R.flushSync();
    expect(R.loadDeck('A')['1']).toEqual(['v2']);
  });

  it('hors-ligne : le cache local reste la vérité, rien ne jette', async () => {
    const R = await load();
    R.saveDeck('A', D('a'));
    (globalThis as any).fetch = vi.fn(async () => { throw new Error('offline'); });
    expect(await R.flushSync()).toBe(false);
    expect(R.listDecks()).toEqual(['A']);
  });
});
