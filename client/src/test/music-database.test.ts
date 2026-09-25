// `tracksForTheme` ne doit jamais rendre une piste sans fichier — sinon
// `AudioManager` la tirerait au sort et l'emplacement resterait silencieux
// sans le dire (même règle que `SfxDatabase.resolveSfx`).
//
// `tracksForGameTheme` / `playableGameThemeIds` sont la vraie règle de ce
// module : un thème de partie (catalogue `music_themes.json`) n'est qu'une
// PRÉFÉRENCE, croisée avec le MOMENT de la partie (`game_early` / `game_mid`
// / `game_late`) — ni l'absence de thème, ni la couverture partielle d'un
// thème sur un seul des trois moments, ne doivent jamais laisser un round
// sans musique.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const RAW = [
  { id: 'MUSIC_MENU_A', name: 'Menu A', theme: 'menu', _has_audio: true },
  { id: 'MUSIC_MENU_B', name: 'Menu B', theme: 'menu', _has_audio: true },
  { id: 'MUSIC_MENU_C', name: 'Menu C (sans fichier)', theme: 'menu', _has_audio: false },
  { id: 'MUSIC_EARLY_GENERIC', name: 'Tours 1-2 (repli, sans thème)', theme: 'game_early', _has_audio: true },
  { id: 'MUSIC_EARLY_DESERT', name: 'Désert — Tours 1-2', theme: 'game_early', game_theme: 'THEME_DESERT', _has_audio: true },
  { id: 'MUSIC_MID_DESERT', name: 'Désert — Tours 3-4', theme: 'game_mid', game_theme: 'THEME_DESERT', _has_audio: true },
  // Le Désert n'a AUCUNE piste pour les tours 5 (game_late) : couverture partielle, assumée.
  { id: 'MUSIC_EARLY_VOLCAN', name: 'Volcan — Tours 1-2 (sans fichier)', theme: 'game_early', game_theme: 'THEME_VOLCAN', _has_audio: false },
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

  it('choisit la piste EXACTE du thème demandé, pour l\'emplacement demandé', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    expect(db.tracksForGameTheme('game_early', 'THEME_DESERT').map(m => m.id)).toEqual(['MUSIC_EARLY_DESERT']);
    expect(db.tracksForGameTheme('game_mid', 'THEME_DESERT').map(m => m.id)).toEqual(['MUSIC_MID_DESERT']);
  });

  it('un thème SANS piste jouable pour CE moment retombe sur le pool générique de l\'emplacement', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    // Le Désert n'a rien pour game_late : repli sur le générique de cet emplacement.
    expect(db.tracksForGameTheme('game_late', 'THEME_DESERT')).toEqual([]);
    // Le Volcan n'a qu'une piste SANS fichier sur game_early : même repli.
    const ids = db.tracksForGameTheme('game_early', 'THEME_VOLCAN').map(m => m.id);
    expect(ids).toEqual(['MUSIC_EARLY_GENERIC']);
  });

  it('aucun thème verrouillé (`null`) retombe directement sur le pool générique de l\'emplacement', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    const ids = db.tracksForGameTheme('game_early', null).map(m => m.id);
    expect(ids).toEqual(['MUSIC_EARLY_GENERIC']);
  });

  it('sans AUCUNE piste générique non plus, retombe sur tout l\'emplacement', async () => {
    const db = await import('../data/MusicDatabase.js');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(RAW.filter(m => m.id !== 'MUSIC_EARLY_GENERIC')),
    })));
    await db.init();
    const ids = db.tracksForGameTheme('game_early', 'THEME_VOLCAN').map(m => m.id).sort();
    expect(ids).toEqual(['MUSIC_EARLY_DESERT']);
  });
});

describe('MusicDatabase.playableGameThemeIds', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(RAW) })));
  });

  it('ne rend que les thèmes avec au moins une piste JOUABLE, sur N\'IMPORTE LEQUEL des trois moments', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    // THEME_DESERT n'est éligible que par game_early/game_mid ; THEME_VOLCAN n'a aucune piste
    // avec fichier (sa seule entrée est `_has_audio: false`) et n'est donc jamais tiré.
    expect(db.playableGameThemeIds()).toEqual(['THEME_DESERT']);
  });
});
