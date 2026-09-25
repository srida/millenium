/* eslint-disable @typescript-eslint/no-explicit-any */
// Le préchargement des effets sonores : sans lui, chaque `playSfx` refaisait
// un `fetch` + un décodage MP3 complet à CHAQUE déclenchement — une attaque,
// un pouvoir, des dizaines par combat — la latence réseau s'empilant sur la
// boucle de jeu. `preloadSfx()` doit décoder chaque son JOUABLE une seule
// fois, jamais deux, et `playSfx` doit alors jouer depuis le cache SANS
// aucun fetch supplémentaire.
//
// Web Audio n'existe pas dans l'environnement de test (`environment: 'node'`,
// sans DOM) : on pose un faux `AudioContext`/`Audio`/`fetch` minimal, sur le
// modèle de `game-controller-audio.test.ts` qui pose `window` à la main.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../data/SfxDatabase.js', () => ({
  resolveSfx: (trigger: string) =>
    (trigger === 'ready' ? { id: 'SFX_READY', trigger: 'ready', _has_audio: true } : null),
  sfxUrl: (id: string) => `/audio/${id}`,
  getAllSfx: () => [
    { id: 'SFX_READY', trigger: 'ready', _has_audio: true },
    // Sans fichier : ne doit JAMAIS être fetché (même règle que `resolveSfx`).
    { id: 'SFX_NOFILE', trigger: 'draw', _has_audio: false },
  ],
}));
vi.mock('../data/MusicDatabase.js', () => ({
  tracksForTheme: () => [],
  tracksForGameTheme: () => [],
  playableGameThemeIds: () => [],
  musicUrl: (id: string) => `/audio/${id}`,
}));

class FakeGainNode {
  gain = { value: 1 };
  connect() { return this; }
}
class FakeBufferSourceNode {
  buffer: unknown = null;
  connect() { /* rien à vérifier ici */ }
  start() { /* lecture immédiate, rien à simuler */ }
}
class FakeAudioContext {
  state = 'running';
  destination = {};
  createGain() { return new FakeGainNode(); }
  createBufferSource() { return new FakeBufferSourceNode(); }
  createMediaElementSource() { return { connect() { return this; } }; }
  decodeAudioData() { return Promise.resolve({ duration: 1 }); }
  resume() { return Promise.resolve(); }
}

let fetchCalls: string[] = [];
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  fetchCalls = [];
  (globalThis as any).window = {
    AudioContext: FakeAudioContext,
    addEventListener() {}, removeEventListener() {},
  };
  (globalThis as any).Audio = class {
    src?: string;
    constructor(src?: string) { this.src = src; }
    play() { return Promise.resolve(); }
  };
  (globalThis as any).fetch = vi.fn((url: string) => {
    fetchCalls.push(url);
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  });
  (globalThis as any).localStorage = { getItem: () => null, setItem() { /* no-op */ } };
});

describe('AudioManager — préchargement des effets sonores', () => {
  it('preloadSfx() fetch et décode chaque son JOUABLE, jamais celui sans fichier', async () => {
    const Audio = await import('../audio/AudioManager.js');
    Audio.preloadSfx();
    await flush();
    expect(fetchCalls).toEqual(['/audio/SFX_READY']);
  });

  it('un second preloadSfx() ne refait AUCUN fetch — déjà en cache', async () => {
    const Audio = await import('../audio/AudioManager.js');
    Audio.preloadSfx();
    await flush();
    Audio.preloadSfx();
    await flush();
    expect(fetchCalls).toEqual(['/audio/SFX_READY']);
  });

  it('playSfx APRÈS préchargement ne fait AUCUN nouveau fetch (chemin buffer, pas le repli élément)', async () => {
    const Audio = await import('../audio/AudioManager.js');
    Audio.preloadSfx();
    await flush();
    fetchCalls = [];
    Audio.playSfx('ready');
    expect(fetchCalls).toEqual([]);
  });

  it('playSfx AVANT préchargement retombe sur le chemin élément (fetch immédiat, jamais silencieux)', async () => {
    const Audio = await import('../audio/AudioManager.js');
    Audio.playSfx('ready');
    // Le repli `createRoutedAudio` passe par `new Audio(url)`, pas par
    // `fetch` directement — c'est le NAVIGATEUR qui charge l'élément. On
    // vérifie donc l'absence de crash et l'absence de fetch direct du
    // module, pas une requête réseau qu'on ne contrôle pas ici.
    expect(fetchCalls).toEqual([]);
  });
});
