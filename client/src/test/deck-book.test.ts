/// <reference types="node" />
// Fusion du deck book entre appareils (deck-book.js) : le cœur de la synchro
// multi-support. Pur — aucun serveur, aucun stockage.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { mergeBooks } = require(path.join(ROOT, 'deck-book.js'));

const NOW = 1_800_000_000_000;
const D = (id: string) => ({ '1': [id], '2': [], '3': [], '4': [], '5': [] });

describe('mergeBooks — par deck, dernière modification gagnante', () => {
  it('deux appareils qui créent des decks DIFFÉRENTS les gardent tous les deux', () => {
    const server = { decks: { A: D('a') }, meta: {}, active: 'A', stamps: { A: NOW - 10 }, deleted: {}, active_ts: NOW - 10 };
    const client = { decks: { B: D('b') }, meta: {}, active: 'B', stamps: { B: NOW - 5 }, deleted: {}, active_ts: NOW - 5 };
    const m = mergeBooks(server, client, NOW);
    expect(Object.keys(m.decks).sort()).toEqual(['A', 'B']);
    expect(m.active).toBe('B'); // le changement le plus récent
  });

  it('le même deck : la modification la plus récente gagne, méta comprise', () => {
    const server = { decks: { A: D('new') }, meta: { A: { color: 'red' } }, stamps: { A: NOW - 1 } };
    const client = { decks: { A: D('old') }, meta: { A: { color: 'blue' } }, stamps: { A: NOW - 100 } };
    const m = mergeBooks(server, client, NOW);
    expect(m.decks.A['1']).toEqual(['new']);
    expect(m.meta.A.color).toBe('red');
  });

  it('une suppression plus récente efface le deck de l\'autre appareil', () => {
    const server = { decks: { A: D('a') }, stamps: { A: NOW - 100 } };
    const client = { decks: {}, deleted: { A: NOW - 1 } };
    const m = mergeBooks(server, client, NOW);
    expect(m.decks.A).toBeUndefined();
    expect(m.deleted.A).toBe(NOW - 1);
  });

  it('un deck recréé APRÈS sa suppression revit', () => {
    const server = { decks: {}, deleted: { A: NOW - 100 } };
    const client = { decks: { A: D('a') }, stamps: { A: NOW - 1 } };
    expect(mergeBooks(server, client, NOW).decks.A).toBeDefined();
  });

  it('égalité présent/supprimé : le deck survit', () => {
    const server = { decks: { A: D('a') }, stamps: { A: NOW - 5 } };
    const client = { decks: {}, deleted: { A: NOW - 5 } };
    expect(mergeBooks(server, client, NOW).decks.A).toBeDefined();
  });

  it('un ancien client sans horodatage ne peut ni écraser ni supprimer', () => {
    const server = { decks: { A: D('serveur') }, stamps: { A: NOW - 50 }, active: 'A', active_ts: NOW - 50 };
    const legacy = { decks: { A: D('perime'), C: D('c') }, meta: {}, active: 'C' };
    const m = mergeBooks(server, legacy, NOW);
    expect(m.decks.A['1']).toEqual(['serveur']);
    expect(m.decks.C).toBeDefined();          // il peut AJOUTER
    expect(m.active).toBe('A');               // active_ts 0 < serveur
  });

  it('un livre serveur vide / absent rend le livre client tel quel', () => {
    const client = { decks: { A: D('a') }, stamps: { A: NOW - 1 }, active: 'A', active_ts: NOW - 1 };
    expect(mergeBooks(null, client, NOW).decks.A).toBeDefined();
    expect(mergeBooks(undefined, undefined, NOW)).toMatchObject({ decks: {}, active: null });
  });

  it('un horodatage dans le futur est ramené à « maintenant + marge »', () => {
    const futur = { decks: { A: D('gele') }, stamps: { A: NOW + 10 * 365 * 24 * 3600 * 1000 } };
    const m = mergeBooks(futur, { decks: { A: D('reel') }, stamps: { A: NOW + 10 * 60 * 1000 } }, NOW);
    // Les deux sont plafonnés à NOW + 5 min : égalité → le serveur, mais surtout
    // le deck n'est plus gelé jusqu'en 2036.
    expect(m.stamps.A).toBeLessThanOrEqual(NOW + 5 * 60 * 1000);
  });

  it('le deck actif supprimé retombe sur l\'autre appareil, puis sur rien', () => {
    const server = { decks: { A: D('a') }, stamps: { A: NOW - 10 }, active: 'A', active_ts: NOW - 10 };
    const client = { decks: {}, deleted: { A: NOW - 1 }, active: null, active_ts: NOW - 1 };
    expect(mergeBooks(server, client, NOW).active).toBeNull();
  });

  it('les pierres tombales périmées (> 90 j) sont purgées', () => {
    const old = NOW - 91 * 24 * 3600 * 1000;
    const m = mergeBooks({ decks: {}, deleted: { A: old, B: NOW - 1000 } }, null, NOW);
    expect(m.deleted.A).toBeUndefined();
    expect(m.deleted.B).toBeDefined();
  });

  it('tolère des entrées mal formées', () => {
    const m = mergeBooks({ decks: 'x', stamps: [], deleted: null }, { decks: [], meta: 3 }, NOW);
    expect(m.decks).toEqual({});
  });
});
