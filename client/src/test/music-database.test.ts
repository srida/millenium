// `tracksForTheme` ne doit jamais rendre une piste sans fichier — sinon
// `AudioManager` la tirerait au sort et le thème resterait silencieux sans le
// dire (même règle que `SfxDatabase.resolveSfx`).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const RAW = [
  { id: 'MUSIC_MENU_A', name: 'Menu A', theme: 'menu_main', _has_audio: true },
  { id: 'MUSIC_MENU_B', name: 'Menu B', theme: 'menu_main', _has_audio: true },
  { id: 'MUSIC_MENU_C', name: 'Menu C (sans fichier)', theme: 'menu_main', _has_audio: false },
  { id: 'MUSIC_GAME_EARLY', name: 'Tours 1-2', theme: 'game_early', _has_audio: true },
];

describe('MusicDatabase.tracksForTheme', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(RAW) })));
  });

  it('rend toutes les pistes JOUABLES du thème', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    const ids = db.tracksForTheme('menu_main').map(m => m.id);
    expect(ids.sort()).toEqual(['MUSIC_MENU_A', 'MUSIC_MENU_B']);
  });

  it('exclut une piste sans fichier', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    expect(db.tracksForTheme('menu_main').some(m => m.id === 'MUSIC_MENU_C')).toBe(false);
  });

  it('un thème sans piste rend un tableau vide', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    expect(db.tracksForTheme('game_late')).toEqual([]);
  });
});
