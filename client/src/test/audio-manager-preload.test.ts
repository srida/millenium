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
  // Une seule piste jouable, sur l'emplacement `menu` — de quoi éprouver
  // suspend/resume sans reproduire toute la logique de sélection déjà
  // couverte par `music-database.test.ts`.
  tracksForTheme: (theme: string) => (theme === 'menu' ? [{ id: 'MUSIC_MENU', theme: 'menu', _has_audio: true }] : []),
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
// Le contexte de LECTURE réel — ne doit être instancié qu'APRÈS un geste
// (`unlock`, ou la première lecture qu'il débloque). `audioCtxInstances` en
// compte les créations : le préchargement ne doit JAMAIS en créer un.
let audioCtxInstances = 0;
class FakeAudioContext {
  state = 'running';
  destination = {};
  constructor() { audioCtxInstances++; }
  createGain() { return new FakeGainNode(); }
  createBufferSource() { return new FakeBufferSourceNode(); }
  createMediaElementSource() { return { connect() { return this; } }; }
  decodeAudioData() { return Promise.resolve({ duration: 1 }); }
  resume() { return Promise.resolve(); }
}
// Le contexte de DÉCODAGE, utilisé par le préchargement — jamais connecté à
// une sortie audible, jamais gagné par la politique d'autoplay.
let decodeCtxInstances = 0;
class FakeOfflineAudioContext {
  constructor() { decodeCtxInstances++; }
  decodeAudioData() { return Promise.resolve({ duration: 1 }); }
}

// Un faux `<audio>` qui suit son état de lecture — c'est CE qu'on vérifie
// pour suspend/resume, pas un espion sur `Audio` lui-même (plusieurs
// instances coexistent, une par piste/son). Chaque instance créée est
// gardée dans `createdAudioEls`, pour retrouver « la piste musicale en
// cours » sans avoir à instrumenter `AudioManager`.
let createdAudioEls: FakeAudioEl[] = [];
class FakeAudioEl {
  src?: string;
  paused = true;
  loop = false;
  volume = 1;
  constructor(src?: string) { this.src = src; createdAudioEls.push(this); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

let fetchCalls: string[] = [];
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  fetchCalls = [];
  createdAudioEls = [];
  audioCtxInstances = 0;
  decodeCtxInstances = 0;
  (globalThis as any).window = {
    AudioContext: FakeAudioContext,
    OfflineAudioContext: FakeOfflineAudioContext,
    addEventListener() {}, removeEventListener() {},
  };
  (globalThis as any).Audio = FakeAudioEl;
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

  it('preloadSfx() décode via OfflineAudioContext, et NE CRÉE JAMAIS le contexte de lecture réel', async () => {
    // Le bug exact de « la musique ne démarre pas au premier lancement » :
    // le préchargement (avant tout geste) faisait naître le contexte RÉEL
    // trop tôt. Le premier `new AudioContext()` ne doit arriver qu'à un
    // geste (`unlock`), jamais pendant `preloadSfx`.
    const Audio = await import('../audio/AudioManager.js');
    Audio.preloadSfx();
    await flush();
    expect(decodeCtxInstances).toBeGreaterThan(0);
    expect(audioCtxInstances).toBe(0);
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

  it('preloadSfxAsync() rapporte sa progression jusqu\'à `total`/`total`, ATTEND la fin', async () => {
    const Audio = await import('../audio/AudioManager.js');
    const ticks: Array<[number, number]> = [];
    await Audio.preloadSfxAsync((done, total) => ticks.push([done, total]));
    // Un seul son JOUABLE dans ce catalogue (`SFX_NOFILE` est exclu) : un
    // appel à 0/1, un à 1/1 — jamais un total qui change en cours de route.
    expect(ticks[0]).toEqual([0, 1]);
    expect(ticks[ticks.length - 1]).toEqual([1, 1]);
    expect(ticks.every(([, total]) => total === 1)).toBe(true);
  });
});

describe('AudioManager — pause en arrière-plan', () => {
  it('suspendForBackground met la piste en PAUSE sans toucher au thème verrouillé', async () => {
    const Audio = await import('../audio/AudioManager.js');
    Audio.setMusicTheme('menu');
    await flush();
    const track = createdAudioEls[createdAudioEls.length - 1];
    expect(track.paused).toBe(false);

    Audio.suspendForBackground();
    expect(track.paused).toBe(true);
    // `setMusicTheme('menu')` de nouveau ne doit RIEN relancer : c'est
    // toujours le même thème en cours, la coupure n'y a pas touché.
    Audio.setMusicTheme('menu');
    expect(Audio.currentMusicTheme()).toBe('menu');
  });

  it('resumeFromBackground relance la MÊME piste après un suspendForBackground', async () => {
    const Audio = await import('../audio/AudioManager.js');
    Audio.setMusicTheme('menu');
    await flush();
    const track = createdAudioEls[createdAudioEls.length - 1];

    Audio.suspendForBackground();
    expect(track.paused).toBe(true);
    Audio.resumeFromBackground();
    expect(track.paused).toBe(false);
  });

  it('resumeFromBackground est un NO-OP si rien n\'a été suspendu par lui', async () => {
    const Audio = await import('../audio/AudioManager.js');
    Audio.setMusicTheme('menu');
    await flush();
    const track = createdAudioEls[createdAudioEls.length - 1];
    track.pause(); // coupure MANUELLE (le joueur a coupé le son), pas via suspendForBackground

    Audio.resumeFromBackground();
    // Ne doit PAS relancer une piste que le joueur a coupée lui-même — seul
    // un `suspendForBackground()` préalable autorise la reprise.
    expect(track.paused).toBe(true);
  });
});
