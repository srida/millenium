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
// Chaque source démarrée est gardée : un test peut ainsi simuler la FIN
// d'un bruitage (`onended`), dont dépend la pause différée de la musique.
let startedSources: FakeBufferSourceNode[] = [];
class FakeBufferSourceNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect() { /* rien à vérifier ici */ }
  start() { startedSources.push(this); }
  finish() { this.onended?.(); }
}
let lastAudioCtx: FakeAudioContext | null = null;
const setLastAudioCtx = (ctx: FakeAudioContext) => { lastAudioCtx = ctx; };
// Le contexte de LECTURE réel — ne doit être instancié qu'APRÈS un geste
// (`unlock`, ou la première lecture qu'il débloque). `audioCtxInstances` en
// compte les créations : le préchargement ne doit JAMAIS en créer un.
let audioCtxInstances = 0;
class FakeAudioContext {
  state = 'running';
  destination = {};
  listeners: Record<string, Array<() => void>> = {};
  resumeCalls = 0;
  constructor() { audioCtxInstances++; setLastAudioCtx(this); }
  addEventListener(type: string, fn: () => void) { (this.listeners[type] ??= []).push(fn); }
  /** Simule un changement d'état imposé par l'OS (iOS : `'interrupted'`). */
  setStateFromOs(state: string) { this.state = state; this.listeners.statechange?.forEach(fn => fn()); }
  createGain() { return new FakeGainNode(); }
  createBufferSource() { return new FakeBufferSourceNode(); }
  createMediaElementSource() { return { connect() { return this; } }; }
  decodeAudioData() { return Promise.resolve({ duration: 1 }); }
  // Asynchrone et suivi d'un `statechange`, comme le vrai `resume()`.
  resume() {
    this.resumeCalls++;
    return Promise.resolve().then(() => this.setStateFromOs('running'));
  }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  closed = false;
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  removeEventListener(type: string, fn: () => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn);
  }
  /** Le contexte cassé d'iOS : `resume()` ne fait plus rien, même dans un geste. */
  breakResume() { this.resume = () => { this.resumeCalls++; return Promise.resolve(); }; }
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
  currentTime = 0;
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

let fetchCalls: string[] = [];
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  fetchCalls = [];
  createdAudioEls = [];
  startedSources = [];
  lastAudioCtx = null;
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

  it('un aller-retour en arrière-plan SANS musique en cours suspend et reprend quand même le contexte, pour les bruitages', async () => {
    // Le cas de partie : entre deux rounds (ou après `setMusicTheme(null)`
    // en fin de match), aucune piste ne joue. Un `suspendForBackground()`
    // survenant à ce moment-là doit quand même suspendre/reprendre le
    // contexte Web Audio — sinon `playSfx` reste silencieux (le contexte
    // resterait `suspended`) jusqu'à ce qu'un vrai `click` (jamais produit
    // par les gestes `pointerdown` du board) vienne le débloquer par accident.
    const Audio = await import('../audio/AudioManager.js');
    Audio.preloadSfx();
    await flush();
    // Force la création du contexte de lecture réel, comme le ferait le
    // premier son joué en partie.
    Audio.playSfx('ready');

    Audio.suspendForBackground();
    // Rien à mettre en pause (aucune musique), mais le contexte lui doit
    // avoir basculé `suspended`.
    Audio.resumeFromBackground();

    // Aucune exception, et surtout aucun repli sur le chemin élément (donc
    // aucun fetch) : le son rejoué passe bien par le buffer déjà décodé,
    // preuve que le contexte est redevenu utilisable après le cycle.
    fetchCalls = [];
    expect(() => Audio.playSfx('ready')).not.toThrow();
    expect(fetchCalls).toEqual([]);
  });
});

describe('AudioManager — bruitage long pendant l\'arrêt de la musique (iOS)', () => {
  // `duel_start`, `match_win` et `match_lose` partent juste avant un
  // `setMusicTheme(null)` : la pause de la piste, 900 ms plus tard, pouvait
  // désactiver la session audio iOS et couper le bruitage en plein vol.
  async function menuThenSfx() {
    const Audio = await import('../audio/AudioManager.js');
    await Audio.preloadSfxAsync();
    Audio.setMusicTheme('menu');
    const track = createdAudioEls[createdAudioEls.length - 1];
    Audio.playSfx('ready');
    return { Audio, track };
  }

  it('la piste descendue au silence n\'est PAS mise en pause tant qu\'un bruitage joue', async () => {
    const { Audio, track } = await menuThenSfx();
    vi.useFakeTimers();
    try {
      Audio.setMusicTheme(null);
      vi.advanceTimersByTime(2000);
      expect(track.paused).toBe(false);
      startedSources[0].finish();
      expect(track.paused).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('sans bruitage en vol, la piste est mise en pause à la fin du fondu', async () => {
    const { Audio, track } = await menuThenSfx();
    startedSources[0].finish();
    vi.useFakeTimers();
    try {
      Audio.setMusicTheme(null);
      vi.advanceTimersByTime(1000);
      expect(track.paused).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('un bruitage qui ne finit jamais ne laisse pas la piste muette tourner indéfiniment', async () => {
    const { Audio, track } = await menuThenSfx();
    vi.useFakeTimers();
    try {
      Audio.setMusicTheme(null);
      vi.advanceTimersByTime(12_000);
      expect(track.paused).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('un contexte passé `interrupted` par l\'OS est relancé (pas seulement `suspended`)', async () => {
    await menuThenSfx();
    const ctx = lastAudioCtx!;
    const before = ctx.resumeCalls;
    ctx.setStateFromOs('interrupted');
    expect(ctx.resumeCalls).toBe(before + 1);
  });

  it('unlock() relance un contexte `interrupted`', async () => {
    const { Audio } = await menuThenSfx();
    const ctx = lastAudioCtx!;
    ctx.state = 'interrupted';
    const before = ctx.resumeCalls;
    Audio.unlock();
    expect(ctx.resumeCalls).toBe(before + 1);
  });
});

describe('AudioManager — la musique suit l\'état du contexte (accélération iOS)', () => {
  // Contexte interrompu par l'OS, élément qui continue d'avancer : le retard
  // accumulé était rattrapé d'un coup à la reprise — la musique s'accélérait.
  async function menuPlaying() {
    const Audio = await import('../audio/AudioManager.js');
    Audio.unlock();
    Audio.setMusicTheme('menu');
    const track = createdAudioEls[createdAudioEls.length - 1];
    expect(track.paused).toBe(false);
    return { Audio, track, ctx: lastAudioCtx! };
  }

  it('la piste est mise en pause pendant l\'interruption, puis relancée à la reprise', async () => {
    const { track, ctx } = await menuPlaying();
    ctx.setStateFromOs('interrupted');
    expect(track.paused).toBe(true);
    await flush();
    expect(ctx.state).toBe('running');
    expect(track.paused).toBe(false);
  });

  it('une pause en arrière-plan n\'est PAS relancée par la reprise du contexte', async () => {
    const { Audio, track, ctx } = await menuPlaying();
    Audio.suspendForBackground();
    ctx.setStateFromOs('running');
    expect(track.paused).toBe(true);
  });

  it('une musique coupée pendant l\'interruption n\'est pas ressuscitée', async () => {
    const { Audio, track, ctx } = await menuPlaying();
    ctx.state = 'interrupted';
    ctx.listeners.statechange?.forEach(fn => fn());
    Audio.setMusicTheme(null);
    await flush();
    expect(track.paused).toBe(true);
  });
});

describe('AudioManager — retour d\'arrière-plan avec un contexte qui ne repart pas', () => {
  async function inGame() {
    const Audio = await import('../audio/AudioManager.js');
    await Audio.preloadSfxAsync();
    Audio.unlock();
    Audio.setMusicTheme('menu');
    const track = createdAudioEls[createdAudioEls.length - 1];
    return { Audio, track, ctx: lastAudioCtx! };
  }

  it('aucun bruitage n\'est mis en file sur un contexte à l\'arrêt (pas de rafale à la reprise)', async () => {
    const { Audio, ctx } = await inGame();
    ctx.breakResume();
    ctx.state = 'interrupted';
    const before = startedSources.length;
    Audio.playSfx('ready');
    Audio.playSfx('ready');
    Audio.playSfx('ready');
    expect(startedSources.length).toBe(before);
    // Pas de repli élément non plus : il est routé dans le même contexte.
    expect(createdAudioEls.length).toBe(1);
  });

  it('un contexte bloqué est RECRÉÉ au geste suivant, et la musique reprend sur un élément neuf', async () => {
    const { Audio, track, ctx } = await inGame();
    track.currentTime = 42;
    ctx.breakResume();
    Audio.suspendForBackground();
    Audio.resumeFromBackground();
    expect(ctx.state).toBe('suspended');

    vi.useFakeTimers();
    try {
      Audio.unlock();                 // premier geste : on laisse sa chance au resume()
      expect(lastAudioCtx).toBe(ctx);
      vi.advanceTimersByTime(1500);
      Audio.unlock();                 // toujours bloqué : contexte neuf
    } finally { vi.useRealTimers(); }

    expect(ctx.closed).toBe(true);
    expect(lastAudioCtx).not.toBe(ctx);
    const fresh = createdAudioEls[createdAudioEls.length - 1];
    expect(fresh).not.toBe(track);
    expect(fresh.src).toBe(track.src);
    expect(fresh.currentTime).toBe(42);
    expect(fresh.paused).toBe(false);
    expect(track.paused).toBe(true);

    // Les bruitages repartent sur le nouveau contexte.
    await flush();
    const before = startedSources.length;
    Audio.playSfx('ready');
    expect(startedSources.length).toBe(before + 1);
  });

  it('un contexte qui repart normalement n\'est jamais recréé', async () => {
    const { Audio, ctx } = await inGame();
    Audio.suspendForBackground();
    Audio.resumeFromBackground();
    await flush();
    vi.useFakeTimers();
    try {
      Audio.unlock();
      vi.advanceTimersByTime(5000);
      Audio.unlock();
    } finally { vi.useRealTimers(); }
    expect(lastAudioCtx).toBe(ctx);
    expect(ctx.closed).toBe(false);
  });
});
