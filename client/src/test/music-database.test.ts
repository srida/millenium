// `tracksForTheme` ne doit jamais rendre une piste sans fichier — sinon
// `AudioManager` la tirerait au sort et l'emplacement resterait silencieux
// sans le dire (même règle que `SfxDatabase.resolveSfx`).
//
// `tracksForGameRound` / `playableGameThemeIds` sont la vraie règle de ce
// module : un thème de partie (catalogue `music_themes.json`) n'est qu'une
// PRÉFÉRENCE, croisée avec le TOUR — ni l'absence de thème, ni la
// couverture partielle d'un thème, ne doivent jamais laisser un tour sans
// musique. Une piste porte la liste de ses tours (`rounds`) ; les anciens
// emplacements `game_early` / `game_mid` / `game_late` sont lus comme
// « 1-2 » / « 3-4 » / « 5 ».
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { musicRounds, normalizeMusic, roundsLabel } from '../../../sound-schema.mjs';

const RAW = [
  { id: 'MUSIC_MENU_A', name: 'Menu A', theme: 'menu', _has_audio: true },
  { id: 'MUSIC_MENU_B', name: 'Menu B', theme: 'menu', _has_audio: true },
  { id: 'MUSIC_MENU_C', name: 'Menu C (sans fichier)', theme: 'menu', _has_audio: false },
  { id: 'MUSIC_GENERIC', name: 'Tous les tours (repli, sans thème)', theme: 'game', rounds: [1, 2, 3, 4, 5], _has_audio: true },
  // Le Désert : deux pistes qui se chevauchent au tour 3, rien au tour 5.
  { id: 'MUSIC_DESERT_A', name: 'Désert — Tours 1-2-3', theme: 'game', rounds: [3, 1, 2, 2], game_theme: 'THEME_DESERT', _has_audio: true },
  { id: 'MUSIC_DESERT_B', name: 'Désert — Tours 3-4', theme: 'game', rounds: [3, 4], game_theme: 'THEME_DESERT', _has_audio: true },
  { id: 'MUSIC_VOLCAN', name: 'Volcan (sans fichier)', theme: 'game', rounds: [1, 2, 3, 4, 5], game_theme: 'THEME_VOLCAN', _has_audio: false },
  // Ancienne forme, telle qu'un volume non repris la garde.
  { id: 'MUSIC_LEGACY_LATE', name: 'Glacier — Tour 5', theme: 'game_late', game_theme: 'THEME_GLACIER', _has_audio: true },
  { id: 'MUSIC_NO_ROUND', name: 'Sans tour', theme: 'game', rounds: [], game_theme: 'THEME_VIDE', _has_audio: true },
];

const stubFetch = (raw: unknown[] = RAW) =>
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) })));

describe('MusicDatabase.tracksForTheme', () => {
  beforeEach(() => { vi.resetModules(); stubFetch(); });

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

describe('sound-schema — tours d\'une piste', () => {
  it('normalise la liste : triée, sans doublon, bornée à 1-5', () => {
    expect(musicRounds({ theme: 'game', rounds: [3, 1, 2, 2, 9, 0, '4'] })).toEqual([1, 2, 3, 4]);
  });

  it('lit les trois anciens emplacements comme 1-2 / 3-4 / 5', () => {
    expect(musicRounds({ theme: 'game_early' })).toEqual([1, 2]);
    expect(musicRounds({ theme: 'game_mid' })).toEqual([3, 4]);
    expect(musicRounds({ theme: 'game_late' })).toEqual([5]);
    expect(normalizeMusic({ id: 'X', theme: 'game_mid', game_theme: 'T' }))
      .toEqual({ id: 'X', theme: 'game', rounds: [3, 4], game_theme: 'T' });
  });

  it('une piste de menu ne couvre aucun tour et n\'est pas retouchée', () => {
    const menu = { id: 'M', theme: 'menu' };
    expect(musicRounds(menu)).toEqual([]);
    expect(normalizeMusic(menu)).toBe(menu);
  });

  it('met les tours en mots', () => {
    expect(roundsLabel([1, 2, 3, 4, 5])).toBe('Tous les tours');
    expect(roundsLabel([3, 4])).toBe('Tours 3, 4');
    expect(roundsLabel([5])).toBe('Tour 5');
    expect(roundsLabel([])).toBe('Aucun tour');
  });
});

describe('MusicDatabase.tracksForGameRound', () => {
  beforeEach(() => { vi.resetModules(); stubFetch(); });

  it('rend les pistes du thème qui couvrent CE tour, chevauchement compris', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    expect(db.tracksForGameRound(1, 'THEME_DESERT').map(m => m.id)).toEqual(['MUSIC_DESERT_A']);
    expect(db.tracksForGameRound(3, 'THEME_DESERT').map(m => m.id)).toEqual(['MUSIC_DESERT_A', 'MUSIC_DESERT_B']);
    expect(db.tracksForGameRound(4, 'THEME_DESERT').map(m => m.id)).toEqual(['MUSIC_DESERT_B']);
  });

  it('un tour que le thème ne couvre pas retombe sur le pool commun', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    expect(db.tracksForGameRound(5, 'THEME_DESERT').map(m => m.id)).toEqual(['MUSIC_GENERIC']);
    // Le Volcan n'a qu'une piste SANS fichier : même repli.
    expect(db.tracksForGameRound(1, 'THEME_VOLCAN').map(m => m.id)).toEqual(['MUSIC_GENERIC']);
    expect(db.tracksForGameRound(1, null).map(m => m.id)).toEqual(['MUSIC_GENERIC']);
  });

  it('une ancienne piste `game_late` joue toujours au tour 5, et seulement là', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    expect(db.tracksForGameRound(5, 'THEME_GLACIER').map(m => m.id)).toEqual(['MUSIC_LEGACY_LATE']);
    expect(db.tracksForGameRound(4, 'THEME_GLACIER').map(m => m.id)).toEqual(['MUSIC_GENERIC']);
  });

  it('sans AUCUNE piste générique non plus, retombe sur toutes les pistes du tour', async () => {
    const db = await import('../data/MusicDatabase.js');
    stubFetch(RAW.filter(m => m.id !== 'MUSIC_GENERIC'));
    await db.init();
    expect(db.tracksForGameRound(5, 'THEME_DESERT').map(m => m.id)).toEqual(['MUSIC_LEGACY_LATE']);
  });
});

describe('MusicDatabase.playableGameThemeIds', () => {
  beforeEach(() => { vi.resetModules(); stubFetch(); });

  it('ne rend que les thèmes avec au moins une piste JOUABLE sur au moins un tour', async () => {
    const db = await import('../data/MusicDatabase.js');
    await db.init();
    // Volcan : sans fichier. Vide : une piste qui ne couvre aucun tour.
    expect(db.playableGameThemeIds().sort()).toEqual(['THEME_DESERT', 'THEME_GLACIER']);
  });
});
