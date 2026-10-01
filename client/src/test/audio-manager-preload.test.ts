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
  disconnect() { /* rien à vérifier ici */ }
}
// Chaque source démarrée est gardée : un test peut ainsi simuler la FIN
// d'un bruitage (`onended`), dont dépend la pause différée de la musique.
// La MUSIQUE est elle aussi une source de buffer, reconnaissable à `loop`.
let startedSources: FakeBufferSourceNode[] = [];
class FakeBufferSourceNode {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  stopped = false;
  startOffset = 0;
  connect() { /* rien à vérifier ici */ }
  disconnect() { /* rien à vérifier ici */ }
  start(...args: number[]) { this.startOffset = args[1] ?? 0; startedSources.push(this); }
  stop() { this.stopped = true; }
  finish() { this.onended?.(); }
}
const sfxCount = () => startedSources.filter(src => !src.loop).length;
const musicSources = () => startedSources.filter(src => src.loop);
/** La source de musique qui joue, s'il y en a une. */
const playingMusic = () => musicSources().filter(src => !src.stopped).at(-1) ?? null;
/** Laisse passer fetch + décodage de la piste (des promesses en chaîne) —
 *  marche aussi sous faux minuteurs, contrairement à `flush`. */
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
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
  // L'horloge avance avec le temps réel (`Date.now()`, simulé par les faux
  // minuteurs) tant que le contexte tourne, s'arrête quand il est suspendu,
  // et ne repart plus après `freeze()` : le contexte figé d'iOS, qui se dit
  // `running` sans que rien ne sorte.
  private clockMs = 0;
  private runningSince: number | null = Date.now();
  private frozen = false;
  get currentTime() {
    const live = this.runningSince !== null ? Date.now() - this.runningSince : 0;
    return (this.clockMs + live) / 1000;
  }
  private stopClock() {
    if (this.runningSince === null) return;
    this.clockMs += Date.now() - this.runningSince;
    this.runningSince = null;
  }
  private startClock() {
    if (this.runningSince === null && !this.frozen) this.runningSince = Date.now();
  }
  freeze() { this.stopClock(); this.frozen = true; }
  resumeCalls = 0;
  constructor() { audioCtxInstances++; setLastAudioCtx(this); }
  addEventListener(type: string, fn: () => void) { (this.listeners[type] ??= []).push(fn); }
  /** Simule un changement d'état imposé par l'OS (iOS : `'interrupted'`). */
  setStateFromOs(state: string) {
    this.state = state;
    if (state === 'running') this.startClock(); else this.stopClock();
    this.listeners.statechange?.forEach(fn => fn());
  }
  createGain() { return new FakeGainNode(); }
  createBufferSource() { return new FakeBufferSourceNode(); }
  createMediaElementSource() { return { connect() { return this; } }; }
  decodeAudioData() { return Promise.resolve({ duration: 120 }); }
  // Asynchrone et suivi d'un `statechange`, comme le vrai `resume()`.
  resume() {
    this.resumeCalls++;
    return Promise.resolve().then(() => this.setStateFromOs('running'));
  }
  suspend() { this.state = 'suspended'; this.stopClock(); return Promise.resolve(); }
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
  decodeAudioData() { return Promise.resolve({ duration: 120 }); }
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

describe('AudioManager — la musique est une piste DÉCODÉE, jamais un <audio>', () => {
  // Un <audio> branché au contexte faisait accélérer la musique sur iOS, le
  // temps de rattraper un retard pris dans le branchement.
  it('setMusicTheme joue la piste depuis un buffer en boucle, sans aucun élément <audio>', async () => {
    const Audio = await import('../audio/AudioManager.js');
    Audio.unlock();
    Audio.setMusicTheme('menu');
    await settle();
    expect(fetchCalls).toContain('/audio/MUSIC_MENU');
    expect(playingMusic()).not.toBeNull();
    expect(createdAudioEls).toEqual([]);
  });

  it('une seule piste vit à la fois : la sortante est arrêtée avant que l\'entrante parte', async () => {
    const Audio = await import('../audio/AudioManager.js');
    Audio.unlock();
    Audio.setMusicTheme('menu');
    await settle();
    const first = playingMusic()!;
    vi.useFakeTimers();
    try {
      Audio.setMusicTheme('menu', { force: true });
      vi.advanceTimersByTime(1000);
      await settle();
    } finally { vi.useRealTimers(); }
    expect(first.stopped).toBe(true);
    expect(musicSources().filter(src => !src.stopped)).toHaveLength(1);
  });
});

describe('AudioManager — pause en arrière-plan', () => {
  async function menuPlaying() {
    const Audio = await import('../audio/AudioManager.js');
    Audio.unlock();
    Audio.setMusicTheme('menu');
    await settle();
    expect(playingMusic()).not.toBeNull();
    return Audio;
  }

  it('suspendForBackground arrête la piste sans toucher au thème', async () => {
    const Audio = await menuPlaying();
    Audio.suspendForBackground();
    expect(playingMusic()).toBeNull();
    Audio.setMusicTheme('menu');
    expect(Audio.currentMusicTheme()).toBe('menu');
  });

  it('resumeFromBackground relance la piste à la position où elle s\'était arrêtée', async () => {
    const Audio = await menuPlaying();
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(30_000);
      Audio.suspendForBackground();
      Audio.resumeFromBackground();
    } finally { vi.useRealTimers(); }
    const resumed = playingMusic()!;
    expect(resumed).not.toBeNull();
    expect(resumed.startOffset).toBeCloseTo(30, 0);
  });

  it('resumeFromBackground est un NO-OP si rien n\'a été suspendu par lui', async () => {
    const Audio = await menuPlaying();
    const before = musicSources().length;
    Audio.resumeFromBackground();
    expect(musicSources().length).toBe(before);
  });

  it('un aller-retour en arrière-plan SANS musique en cours suspend et reprend quand même le contexte, pour les bruitages', async () => {
    // Fin de combat, écran de résultat : aucune piste ne joue, et les
    // bruitages ne doivent pas rester muets après l'aller-retour.
    const Audio = await import('../audio/AudioManager.js');
    Audio.preloadSfx();
    await flush();
    Audio.playSfx('ready');
    Audio.suspendForBackground();
    Audio.resumeFromBackground();
    await flush();
    fetchCalls = [];
    const before = sfxCount();
    expect(() => Audio.playSfx('ready')).not.toThrow();
    expect(fetchCalls).toEqual([]);
    expect(sfxCount()).toBe(before + 1);
  });
});

describe('AudioManager — bruitage long pendant l\'arrêt de la musique (iOS)', () => {
  // `duel_start`, `match_win` et `match_lose` partent juste avant un
  // `setMusicTheme(null)` : l'arrêt de la piste, 900 ms plus tard, coupait
  // le bruitage en plein vol.
  async function menuThenSfx() {
    const Audio = await import('../audio/AudioManager.js');
    await Audio.preloadSfxAsync();
    Audio.unlock();
    Audio.setMusicTheme('menu');
    await settle();
    const track = playingMusic()!;
    Audio.playSfx('ready');
    const sfx = startedSources.filter(src => !src.loop).at(-1)!;
    return { Audio, track, sfx };
  }

  it('la piste descendue au silence n\'est PAS arrêtée tant qu\'un bruitage joue', async () => {
    const { Audio, track, sfx } = await menuThenSfx();
    vi.useFakeTimers();
    try {
      Audio.setMusicTheme(null);
      vi.advanceTimersByTime(2000);
      expect(track.stopped).toBe(false);
      sfx.finish();
      expect(track.stopped).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('sans bruitage en vol, la piste est arrêtée à la fin du fondu', async () => {
    const { Audio, track, sfx } = await menuThenSfx();
    sfx.finish();
    vi.useFakeTimers();
    try {
      Audio.setMusicTheme(null);
      vi.advanceTimersByTime(1000);
      expect(track.stopped).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('un bruitage qui ne finit jamais ne laisse pas la piste muette tourner indéfiniment', async () => {
    const { Audio, track } = await menuThenSfx();
    vi.useFakeTimers();
    try {
      Audio.setMusicTheme(null);
      vi.advanceTimersByTime(12_000);
      expect(track.stopped).toBe(true);
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

describe('AudioManager — retour d\'arrière-plan avec un contexte qui ne repart pas', () => {
  async function inGame() {
    const Audio = await import('../audio/AudioManager.js');
    await Audio.preloadSfxAsync();
    Audio.unlock();
    Audio.setMusicTheme('menu');
    await settle();
    return { Audio, track: playingMusic()!, ctx: lastAudioCtx! };
  }

  it('aucun bruitage n\'est mis en file sur un contexte à l\'arrêt (pas de rafale à la reprise)', async () => {
    const { Audio, ctx } = await inGame();
    ctx.breakResume();
    ctx.state = 'interrupted';
    const before = sfxCount();
    Audio.playSfx('ready');
    Audio.playSfx('ready');
    Audio.playSfx('ready');
    expect(sfxCount()).toBe(before);
    // Pas de repli élément non plus : il est routé dans le même contexte.
    expect(createdAudioEls).toEqual([]);
  });

  it('un contexte bloqué est RECRÉÉ au geste suivant, et la musique reprend à sa position', async () => {
    vi.useFakeTimers();
    try {
      const { Audio, ctx } = await inGame();
      vi.advanceTimersByTime(42_000);
      ctx.breakResume();
      Audio.suspendForBackground();
      Audio.resumeFromBackground();
      expect(ctx.state).toBe('suspended');

      Audio.unlock();                 // premier geste : on laisse sa chance au resume()
      expect(lastAudioCtx).toBe(ctx);
      vi.advanceTimersByTime(1500);
      Audio.unlock();                 // toujours bloqué : contexte neuf

      expect(ctx.closed).toBe(true);
      expect(lastAudioCtx).not.toBe(ctx);
      const resumed = playingMusic()!;
      expect(resumed).not.toBeNull();
      expect(resumed.startOffset).toBeCloseTo(42, 0);
      expect(musicSources().filter(src => !src.stopped)).toHaveLength(1);

      await settle();
      const before = sfxCount();
      Audio.playSfx('ready');
      expect(sfxCount()).toBe(before + 1);
    } finally { vi.useRealTimers(); }
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

describe('AudioManager — contexte « running » mais figé (retour d\'Instagram)', () => {
  async function inGame() {
    const Audio = await import('../audio/AudioManager.js');
    await Audio.preloadSfxAsync();
    vi.useFakeTimers();
    Audio.unlock();
    Audio.setMusicTheme('menu');
    await settle();
    return { Audio, track: playingMusic()!, ctx: lastAudioCtx! };
  }

  it('un contexte figé ne reçoit plus aucun bruitage', async () => {
    try {
      const { Audio, ctx } = await inGame();
      ctx.freeze();
      vi.advanceTimersByTime(1000);
      const before = sfxCount();
      Audio.playSfx('ready');
      Audio.playSfx('ready');
      expect(ctx.state).toBe('running');
      expect(sfxCount()).toBe(before);
    } finally { vi.useRealTimers(); }
  });

  it('un contexte figé est recréé au geste suivant, musique comprise', async () => {
    try {
      const { Audio, track, ctx } = await inGame();
      ctx.freeze();
      vi.advanceTimersByTime(1000);
      Audio.unlock();
      expect(ctx.closed).toBe(true);
      expect(lastAudioCtx).not.toBe(ctx);
      const fresh = playingMusic()!;
      expect(fresh).not.toBe(track);
      const before = sfxCount();
      Audio.playSfx('ready');
      expect(sfxCount()).toBe(before + 1);
    } finally { vi.useRealTimers(); }
  });

  it('un contexte sain n\'est jamais pris pour figé, même après une longue pause', async () => {
    try {
      const { Audio, ctx } = await inGame();
      vi.advanceTimersByTime(120_000);
      Audio.unlock();
      const before = sfxCount();
      Audio.playSfx('ready');
      expect(lastAudioCtx).toBe(ctx);
      expect(sfxCount()).toBe(before + 1);
    } finally { vi.useRealTimers(); }
  });

  it('une recréation par fenêtre au plus, si le contexte neuf naît figé lui aussi', async () => {
    try {
      const { Audio, ctx } = await inGame();
      ctx.freeze();
      vi.advanceTimersByTime(1000);
      Audio.unlock();
      const second = lastAudioCtx!;
      second.freeze();
      vi.advanceTimersByTime(500);
      Audio.unlock();
      expect(lastAudioCtx).toBe(second);
      vi.advanceTimersByTime(2000);
      Audio.unlock();
      expect(lastAudioCtx).not.toBe(second);
    } finally { vi.useRealTimers(); }
  });
});
