// `tracksForTheme` ne doit jamais rendre une piste sans fichier — sinon
// `AudioManager` la tirerait au sort et l'emplacement resterait silencieux
// sans le dire (même règle que `SfxDatabase.resolveSfx`).
//
// `tracksForGameTheme` / `playableGameThemeIds` sont la vraie règle de ce
// module : un thème de partie (catalogue `music_themes.json`) n'est qu'une
// PRÉFÉRENCE — son absence, ou l'absence de piste qui le porte, ne doit
// jamais laisser une partie sans musique.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const RAW = [
  { id: 'MUSIC_MENU_A', name: 'Menu A', theme: 'menu', _has_audio: true },
  { id: 'MUSIC_MENU_B', name: 'Menu B', theme: 'menu', _has_audio: true },
  { id: 'MUSIC_MENU_C', name: 'Menu C (sans fichier)', theme: 'menu', _has_audio: false },
  { id: 'MUSIC_GAME_GENERIC', name: 'Partie (repli, sans thème)', theme: 'game', _has_audio: true },
  { id: 'MUSIC_GAME_DESERT', name: 'Désert', theme: 'game', game_theme: 'THEME_DESERT', _has_audio: true },
  { id: 'MUSIC_GAME_VOLCAN', name: 'Volcan (sans fichier)', theme: 'game', game_theme: 'THEME_VOLCAN', _has_audio: false },
];

describe('MusicDatabase.tracksForTheme', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(RAW) })));
  });

  it('rend toutes les pistes JOUABLES de l\'emplacement', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    const ids = db.tracksForTheme('menu').map(m => m.id);
    expect(ids.sort()).toEqual(['MUSIC_MENU_A', 'MUSIC_MENU_B']);
  });

  it('exclut une piste sans fichier', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    expect(db.tracksForTheme('menu').some(m => m.id === 'MUSIC_MENU_C')).toBe(false);
  });

  it('un emplacement sans piste rend un tableau vide', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    expect(db.tracksForTheme('inconnu')).toEqual([]);
  });
});

describe('MusicDatabase.tracksForGameTheme', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(RAW) })));
  });

  it('choisit la piste EXACTE du thème demandé', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    const ids = db.tracksForGameTheme('THEME_DESERT').map(m => m.id);
    expect(ids).toEqual(['MUSIC_GAME_DESERT']);
  });

  it('un thème SANS piste jouable retombe sur le pool générique (sans game_theme)', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    const ids = db.tracksForGameTheme('THEME_VOLCAN').map(m => m.id);
    expect(ids).toEqual(['MUSIC_GAME_GENERIC']);
  });

  it('aucun thème verrouillé (`null`) retombe directement sur le pool générique', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    const ids = db.tracksForGameTheme(null).map(m => m.id);
    expect(ids).toEqual(['MUSIC_GAME_GENERIC']);
  });

  it('sans AUCUNE piste générique non plus, retombe sur tout l\'emplacement `game`', async () => {
    const db = await import('../data/MusicDatabase.js');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(RAW.filter(m => m.id !== 'MUSIC_GAME_GENERIC')),
    })));
    await db.init();
    const ids = db.tracksForGameTheme('THEME_VOLCAN').map(m => m.id).sort();
    expect(ids).toEqual(['MUSIC_GAME_DESERT']);
  });
});

describe('MusicDatabase.playableGameThemeIds', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(RAW) })));
  });

  it('ne rend que les thèmes avec au moins une piste JOUABLE', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    expect(db.playableGameThemeIds()).toEqual(['THEME_DESERT']);
  });
});
