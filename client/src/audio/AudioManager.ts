// Le moteur audio du jeu : lecture des effets sonores et musique de fond par
// THÈME, avec fondu enchaîné. Même statut que `three/` — aucun import React
// ni Zustand, piloté par des appels explicites (`GameController`, `App.tsx`,
// les composants HUD) plutôt qu'abonné à un store.
//
// ⚠️ RIEN n'est lu au niveau module (`Audio`, `localStorage`, `AudioContext`) :
// la suite de test tourne en `environment: 'node'`, sans DOM — même
// discipline que `three/constants.ts`.
//
// ⚠️ Un son manqué n'est JAMAIS une erreur qui remonte : catalogue vide,
// fichier absent, autoplay bloqué avant le premier geste utilisateur — dans
// les trois cas, le jeu continue silencieusement. L'audio est un habillage,
// pas une donnée de jeu (même doctrine que `CardBackDatabase`).
//
// ⚠️ Le VOLUME passe par un `GainNode` (Web Audio), jamais par
// `HTMLMediaElement.volume` seul : Safari iOS IGNORE silencieusement cette
// propriété — un slider qui bouge sans le moindre effet sur le son, sur cette
// seule plateforme, est la signature exacte de ce piège documenté. Un
// `GainNode` fonctionne partout, y compris là où `.volume` ne fait rien.
// `.volume` reste le repli quand la connexion Web Audio échoue (contexte
// indisponible, CORS) — mieux que rien ailleurs, sans effet sur iOS de toute
// façon.
//
// ⚠️ Les EFFETS SONORES sont PRÉCHARGÉS et DÉCODÉS une fois pour toutes
// (`preloadSfx`), jamais rejoués à la volée : un `attack` ou un `power` part
// des dizaines de fois par combat, et refaire un `fetch` + un décodage MP3
// complet À CHAQUE déclenchement empilait une vraie latence réseau sur la
// boucle de combat — la lenteur perçue en jeu. Une fois le catalogue en
// cache (`AudioBuffer`), jouer un son ne fait plus que planifier un
// `AudioBufferSourceNode` déjà décodé : aucun réseau, aucun décodage, juste
// une lecture quasi instantanée. `createRoutedAudio` (l'ancien chemin, un
// `<audio>` par lecture) reste le REPLI pour un son pas encore préchargé —
// jamais silencieux, seulement plus lent le temps que le cache se remplisse.
// La MUSIQUE est décodée elle aussi (`MusicTrack`), mais piste par piste, au
// moment où elle démarre, et une seule à la fois en mémoire : un `<audio>`
// branché au contexte (`createMediaElementSource`) faisait parfois ACCÉLÉRER
// la musique sur iOS, quelques secondes, le temps de rattraper un retard pris
// dans le branchement — cf. `MusicTrack`.
//
// ⚠️ `preloadSfxAsync` (avec sa progression) est ATTENDU par l'écran de
// chargement (`App.tsx`) AVANT que le menu ne s'affiche — c'est aussi ce qui
// rend la musique de menu fiable : sur Safari, un `play()` déclenché en
// dehors du geste utilisateur qui l'accompagne peut rester bloqué même après
// un premier clic ailleurs sur la page. En gardant l'écran de chargement
// jusqu'à la fin du préchargement, PUIS en exigeant un tap explicite pour
// entrer, le tout premier `setMusicTheme('menu')` part synchrone DANS ce tap.
//
// ⚠️ `suspendForBackground` / `resumeFromBackground` coupent la musique
// quand l'onglet passe en arrière-plan (`visibilitychange`) : sans ça, une
// PWA installée peut continuer à jouer du son hors champ.
import { resolveSfx, sfxUrl, getAllSfx, type SfxVariant } from '../data/SfxDatabase.js';
import { tracksForTheme, tracksForGameTheme, playableGameThemeIds, musicUrl } from '../data/MusicDatabase.js';
import { GAME_MUSIC_SLOTS } from '../../../sound-schema.mjs';

const SETTINGS_KEY = 'millenium_audio_settings_v1';
// Durée de CHAQUE demi-fondu (descente puis montée) d'une transition
// musicale — assez long pour qu'un changement de thème de partie (tours 1-2
// → 3-4 → 5) se fasse sentir comme une transition et non une coupure, assez
// court pour ne pas laisser le silence entre les deux s'étirer.
const FADE_PHASE_MS = 900;
const FADE_STEP_MS = 50;

interface AudioSettings {
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  /** Thème de partie choisi par le joueur ; `null` = tirage au sort. */
  gameTheme: string | null;
}

const DEFAULT_SETTINGS: AudioSettings = { sfxVolume: 0.7, musicVolume: 0.5, muted: false, gameTheme: null };

let settings: AudioSettings | null = null;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Chargé une fois, à la première lecture ou écriture — jamais au chargement du module. */
function loadSettings(): AudioSettings {
  if (settings) return settings;
  settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.sfxVolume === 'number') settings.sfxVolume = clamp01(parsed.sfxVolume);
      if (typeof parsed.musicVolume === 'number') settings.musicVolume = clamp01(parsed.musicVolume);
      if (typeof parsed.muted === 'boolean') settings.muted = parsed.muted;
      if (typeof parsed.gameTheme === 'string') settings.gameTheme = parsed.gameTheme;
    }
  } catch { /* stockage refusé ou absent : les défauts suffisent */ }
  return settings;
}

function saveSettings(): void {
  try { if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* rien à faire */ }
}

export function getSettings(): AudioSettings {
  return { ...loadSettings() };
}

export function setSfxVolume(v: number): void {
  loadSettings().sfxVolume = clamp01(v);
  saveSettings();
  applySfxGain();
}

export function setMusicVolume(v: number): void {
  loadSettings().musicVolume = clamp01(v);
  saveSettings();
  applyMusicVolume();
}

/** Le thème de partie choisi (`null` = aléatoire). Lu par `rollGameTheme()` au
 *  début de chaque match ; un thème devenu injouable retombe sur le tirage. */
export function setGameThemePreference(id: string | null): void {
  loadSettings().gameTheme = id;
  saveSettings();
}

export function getGameThemePreference(): string | null {
  return loadSettings().gameTheme;
}

export function setMuted(muted: boolean): void {
  loadSettings().muted = muted;
  saveSettings();
  applyMusicVolume();
  applySfxGain();
}

// ================== Contexte Web Audio (volume réel, y compris iOS) ==================

let audioCtx: AudioContext | null = null;

/**
 * ⚠️ **`'interrupted'` est un état À PART, propre à Safari/iOS** : c'est lui,
 * et non `'suspended'`, que prend le contexte quand l'OS coupe la session
 * audio (pause du dernier élément média, bannière, appel). Tester
 * `=== 'suspended'` laissait ce cas sans relance : le bruitage en cours
 * s'arrêtait net. On relance donc tout ce qui n'est ni en lecture ni fermé.
 */
function needsResume(ctx: AudioContext | null): ctx is AudioContext {
  const state = ctx?.state as string | undefined;
  return !!state && state !== 'running' && state !== 'closed';
}

/**
 * ⚠️ **UN SEUL `AudioContext` dans toute l'appli.** Un second contexte (le
 * clic synthétisé des boutons, retiré) fait changer la fréquence
 * d'échantillonnage matérielle sur iOS : les pistes déjà en lecture
 * s'accélèrent alors sans raison — la musique d'accueil qui s'emballait.
 * Jamais lu au niveau module.
 *
 * ⚠️ **NE JAMAIS appeler ceci en dehors d'un geste utilisateur (`unlock`,
 * `playSfx`, `setMusicTheme`…).** Ce contexte est celui qui joue RÉELLEMENT
 * le son ; le créer plus tôt (ex. pendant le préchargement, sur l'écran de
 * chargement) le fait naître `suspended` AVANT tout geste — et sur certains
 * moteurs (constaté : premier lancement d'une page neuve), `resume()` sur un
 * contexte né hors geste ne débloque pas la lecture aussi fiablement qu'un
 * contexte créé PENDANT le geste, même si le contexte rapporte `'running'`.
 * C'était la cause exacte de « la musique ne démarre pas au premier
 * lancement » : `loadSfxBuffer` (préchargement, avant tout tap) appelait
 * CE getter pour décoder — il utilise désormais `getDecodeCtx()` à la
 * place, qui ne joue jamais rien et n'est donc soumis à AUCUNE politique
 * d'autoplay. Cette fonction-ci ne doit être atteinte, pour la première
 * fois, que depuis `unlock()`.
 */
function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
      // ⚠️ iOS (Safari comme PWA installée) SUSPEND le contexte tout seul sur
      // une interruption audio (bannière de notification, Centre de
      // contrôle, coupe-son matériel, appel) SANS qu'aucun `visibilitychange`
      // ne se déclenche — la page reste au premier plan, seule la session
      // audio est coupée. `suspendForBackground`/`resumeFromBackground` ne
      // voient donc rien passer, et le son en cours (le plus exposé : une
      // fanfare de plusieurs secondes, pas un clic d'un dixième de seconde)
      // s'arrête net sans jamais reprendre. On écoute le contexte lui-même
      // et on le relance dès qu'il retombe `suspended` alors que rien
      // n'explique la coupure côté app — seul filet pour cette classe
      // d'interruption, propre au mobile et particulièrement au mode PWA.
      audioCtx.addEventListener?.('statechange', onCtxStateChange);
      resetProbe(audioCtx);
    } catch { return null; }
  }
  return audioCtx;
}

/** Relance un contexte qui cesse de tourner sans que l'app l'ait voulu
 *  (interruption iOS, sans `visibilitychange`). La musique n'a rien à faire :
 *  jouée depuis un buffer, elle s'arrête et repart AVEC l'horloge du
 *  contexte, sans rien accumuler. */
function onCtxStateChange(): void {
  if (!audioCtx) return;
  if (audioCtx.state === 'running') {
    stuckSince = null;
    resetProbe(audioCtx);
    return;
  }
  probe = null;
  if (backgroundPaused) return;
  if (needsResume(audioCtx)) audioCtx.resume().catch(() => {});
}

// ================== Sonde de vie du contexte ==================

/**
 * ⚠️ **`state === 'running'` ne prouve PAS que le contexte joue.** Constaté
 * sur iOS au retour d'une appli qui a pris la session audio (Instagram) : le
 * contexte se déclare en lecture, mais son horloge (`currentTime`) est
 * FIGÉE. Rien ne sort, chaque `start(0)` se met en file, et le jour où l'OS
 * rend la session, toute la file part d'un coup. Seule l'horloge dit la
 * vérité : on la compare au temps réel.
 */
let probe: { ctxTime: number; wall: number } | null = null;
let stalled = false;
/** En dessous, deux mesures sont trop proches pour conclure. */
const PROBE_MIN_MS = 250;

function resetProbe(ctx: AudioContext | null): void {
  probe = ctx ? { ctxTime: ctx.currentTime, wall: Date.now() } : null;
  stalled = false;
}

/** Vrai si le contexte se dit en lecture mais que son horloge n'avance pas
 *  (au moins deux fois moins vite que le temps réel). Mesure paresseuse :
 *  rendue par les appels eux-mêmes (`playSfx`, `unlock`), sans minuteur. */
function isStalled(ctx: AudioContext): boolean {
  if (ctx.state !== 'running') return false;
  const wall = Date.now();
  if (!probe) { probe = { ctxTime: ctx.currentTime, wall }; return stalled; }
  const elapsed = wall - probe.wall;
  if (elapsed < PROBE_MIN_MS) return stalled;
  stalled = (ctx.currentTime - probe.ctxTime) * 1000 < elapsed * 0.5;
  probe = { ctxTime: ctx.currentTime, wall };
  return stalled;
}

let decodeCtx: OfflineAudioContext | null = null;

/**
 * Contexte de DÉCODAGE seul, jamais connecté à la sortie audio réelle —
 * `OfflineAudioContext` n'est soumis à AUCUNE politique d'autoplay dans
 * aucun moteur (il ne produit jamais de son audible), ce qui en fait le
 * seul endroit sûr où décoder AVANT le premier geste utilisateur. Un
 * `AudioBuffer` qu'il produit reste parfaitement lisible sur le "vrai"
 * contexte de lecture créé plus tard par `getAudioCtx()` — ce sont des
 * données PCM neutres, pas liées au contexte qui les a décodées.
 */
function getDecodeCtx(): OfflineAudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
    ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctor) return null;
  if (!decodeCtx) {
    // Dimensions arbitraires : on n'appelle jamais `startRendering()`, seul
    // `decodeAudioData` nous intéresse ici.
    try { decodeCtx = new Ctor(1, 1, 44100); } catch { return null; }
  }
  return decodeCtx;
}

/** Un son en cours : l'élément qui décode le fichier, le nœud de gain qui en
 *  pilote le volume — `null` quand la connexion Web Audio a échoué, auquel
 *  cas `.volume` sert de repli (dégradé, silencieux sur iOS, mais jamais
 *  d'erreur). */
interface RoutedAudio {
  el: HTMLAudioElement;
  gain: GainNode | null;
}

/**
 * Crée un `<audio>` et le route à travers un `GainNode` fraîchement créé —
 * c'est le REPLI des effets sonores pas encore préchargés (un élément par
 * lecture). La musique n'y passe plus (cf. `MusicTrack`). `el.volume` est laissé à 1 dès que le
 * `GainNode` a pris la main : c'est LUI qui porte le volume, un `.volume`
 * résiduel ne ferait qu'atténuer deux fois sur les plateformes où il compte.
 */
function createRoutedAudio(url: string): RoutedAudio {
  const el = new Audio(url);
  const ctx = getAudioCtx();
  if (!ctx) return { el, gain: null };
  try {
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    el.volume = 1;
    return { el, gain };
  } catch {
    // Contexte fermé, CORS sur l'origine du fichier… : `.volume` reste un
    // repli valide partout SAUF iOS, qui n'aurait de toute façon pas laissé
    // la connexion échouer pour cette raison.
    return { el, gain: null };
  }
}

function setRoutedVolume(a: RoutedAudio, v: number): void {
  if (a.gain) a.gain.gain.value = clamp01(v);
  else a.el.volume = clamp01(v);
}

// ================== Effets sonores ==================

/** Les buffers déjà DÉCODÉS, par id de `SfxEntry` — c'est le cache que
 *  `preloadSfx()` remplit et que `playSfx` consulte en premier. */
const sfxBufferCache = new Map<string, AudioBuffer>();
/** Une seule promesse par id en vol, pour qu'un `preloadSfx()` rejoué (au
 *  début d'un match, par sécurité) ne relance pas un fetch déjà en cours. */
const sfxLoading = new Map<string, Promise<void>>();

/** Le nœud de gain PARTAGÉ de tous les effets sonores joués depuis le cache
 *  — une seule création, jamais un par lecture (contrairement à la musique,
 *  qui n'a qu'UNE piste à la fois). Les `AudioBufferSourceNode` s'y
 *  connectent et se somment naturellement, comme plusieurs sons superposés
 *  le feraient dans la réalité. */
let sfxGain: GainNode | null = null;

function ensureSfxGain(ctx: AudioContext): GainNode {
  if (!sfxGain) {
    sfxGain = ctx.createGain();
    const s = loadSettings();
    sfxGain.gain.value = s.muted ? 0 : s.sfxVolume;
    sfxGain.connect(ctx.destination);
  }
  return sfxGain;
}

function applySfxGain(): void {
  if (!sfxGain) return;
  const s = loadSettings();
  sfxGain.gain.value = s.muted ? 0 : s.sfxVolume;
}

function loadSfxBuffer(id: string): Promise<void> {
  const cached = sfxLoading.get(id);
  if (cached) return cached;
  const p = (async () => {
    if (sfxBufferCache.has(id)) return;
    // ⚠️ `getDecodeCtx()`, PAS `getAudioCtx()` : ceci tourne pendant le
    // préchargement, avant tout geste utilisateur (cf. l'avertissement sur
    // `getAudioCtx`) — décoder ne doit jamais faire naître le contexte de
    // lecture réel trop tôt.
    const ctx = getDecodeCtx();
    if (!ctx) return;
    try {
      const res = await fetch(sfxUrl(id));
      if (!res.ok) return;
      const bytes = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(bytes);
      sfxBufferCache.set(id, buffer);
    } catch { /* le repli `createRoutedAudio` de `playSfx` prend le relais */ }
  })();
  sfxLoading.set(id, p);
  return p;
}

/**
 * Précharge et décode TOUT le catalogue de sons jouables, en rapportant sa
 * progression — c'est la version que l'écran de chargement ATTEND
 * (`bootstrap.initGameData`), pour que la barre reflète le vrai travail
 * restant plutôt qu'un minuteur inventé. Ne jette jamais : un son qui échoue
 * (fichier absent, réseau) compte quand même comme « traité », son
 * déclencheur retombera simplement sur le chemin `<audio>` d'origine.
 */
export async function preloadSfxAsync(onProgress?: (done: number, total: number) => void): Promise<void> {
  const entries = getAllSfx().filter(s => s._has_audio);
  let done = 0;
  onProgress?.(0, entries.length);
  await Promise.all(entries.map(async (entry) => {
    await loadSfxBuffer(entry.id).catch(() => {});
    done++;
    onProgress?.(done, entries.length);
  }));
}

/**
 * Même précharge, en FIRE-AND-FORGET — pour un appel qui ne doit jamais
 * bloquer (`GameController.begin()`, par sécurité si un son a été ajouté en
 * admin depuis le chargement). Idempotent avec `preloadSfxAsync` : les deux
 * partagent le même cache et la même déduplication par id (`sfxLoading`).
 */
export function preloadSfx(): void {
  preloadSfxAsync().catch(() => {});
}

/**
 * Joue le son du déclencheur donné, avec sa variante (tier, élément ou
 * pouvoir) si le catalogue en porte une. Un déclencheur sans catalogue, sans
 * fichier, ou une lecture refusée (autoplay) ne produit RIEN — jamais une
 * exception.
 *
 * ⚠️ Chemin RAPIDE d'abord (buffer déjà décodé par `preloadSfx` → nœud de
 * gain partagé, aucun réseau) ; repli sur l'ancien chemin élément par
 * élément UNIQUEMENT si le buffer n'est pas encore en cache.
 */
export function playSfx(trigger: string, variant?: SfxVariant): void {
  if (typeof Audio === 'undefined') return;
  const s = loadSettings();
  if (s.muted || s.sfxVolume <= 0) return;
  const entry = resolveSfx(trigger, variant);
  if (!entry) return;

  const buffer = sfxBufferCache.get(entry.id);
  const ctx = getAudioCtx();
  // ⚠️ **Un contexte à l'arrêt ne reçoit AUCUN son.** `start(0)` veut dire
  // « à `currentTime` », et `currentTime` est figé tant qu'il ne tourne pas :
  // chaque bruitage s'y mettait en FILE, et la reprise les jouait tous d'un
  // coup — une partie entière de sons en une seconde. Un bruitage manqué ne
  // se rattrape pas, il se perd. Le repli élément est routé dans le même
  // contexte : même règle.
  if (ctx && (ctx.state !== 'running' || isStalled(ctx))) {
    if (needsResume(ctx) && !backgroundPaused) ctx.resume().catch(() => {});
    return;
  }
  if (buffer && ctx) {
    try {
      const gain = ensureSfxGain(ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      retainSourceUntilDone(source);
      source.start(0);
      return;
    } catch { /* repli ci-dessous */ }
  }

  try {
    const routed = createRoutedAudio(sfxUrl(entry.id));
    setRoutedVolume(routed, s.sfxVolume);
    retainUntilDone(routed.el);
    routed.el.play().catch(() => { /* autoplay bloqué avant le premier geste : silencieux */ });
  } catch { /* jamais remonté */ }
}

/** Sons en cours sur le chemin de repli (`createRoutedAudio`), le temps de
 *  leur lecture. ⚠️ **Indispensable, pas une prudence** : un `<audio>` créé
 *  sans être posé dans le DOM et sans variable qui le retient au-delà de
 *  l'appel à `playSfx` n'a plus AUCUNE référence vivante une fois la fonction
 *  retournée — un passage du ramasse-miettes peut alors le couper en plein
 *  vol. Un son bref (attaque, tap de menu) a fini de jouer bien avant qu'un
 *  tel passage n'ait une chance de survenir ; une fanfare de plusieurs
 *  secondes (victoire, défaite, lancement de partie) reste en vol assez
 *  longtemps pour l'attraper — exactement les coupures rapportées, et
 *  seulement sur ce chemin (le chemin rapide, lui, tient sa référence par le
 *  `AudioBufferSourceNode` en cours d'exécution, dont le cycle de vie est
 *  automatique tant qu'il joue). */
const routedSfxKeepAlive = new Set<HTMLAudioElement>();

/** Les sons du chemin RAPIDE en cours. La spécification garantit qu'un
 *  `AudioBufferSourceNode` qui joue n'est pas collecté, mais WebKit a déjà
 *  failli sur ce point : on garde la référence jusqu'à `ended`, au même
 *  titre que `routedSfxKeepAlive`. Sert aussi à savoir si un bruitage est
 *  encore en vol (`sfxPlaying`). */
const activeSfxSources = new Set<AudioBufferSourceNode>();

function retainSourceUntilDone(source: AudioBufferSourceNode): void {
  activeSfxSources.add(source);
  source.onended = () => {
    activeSfxSources.delete(source);
    releaseDeferredPauses();
  };
}

function sfxPlaying(): boolean {
  return activeSfxSources.size > 0 || routedSfxKeepAlive.size > 0;
}

function retainUntilDone(el: HTMLAudioElement): void {
  routedSfxKeepAlive.add(el);
  const release = () => {
    routedSfxKeepAlive.delete(el);
    releaseDeferredPauses();
    el.removeEventListener?.('ended', release);
    el.removeEventListener?.('error', release);
  };
  // ⚠️ `addEventListener` optionnel : un faux `<audio>` de test (ou un
  // polyfill minimal) sans cette API ne doit pas faire jeter `playSfx` — la
  // rétention devient alors permanente pour cet élément, sans conséquence
  // hors test (le vrai `HTMLAudioElement` du navigateur la porte toujours).
  if (!el.addEventListener) return;
  el.addEventListener('ended', release);
  el.addEventListener('error', release);
}

// ================== Musique ==================

let currentTheme: string | null = null;
let current: MusicTrack | null = null;
/** Le thème de PARTIE verrouillé pour le match en cours — tiré une fois par
 *  `rollGameTheme()`, jamais rejoué à chaque round. */
let lockedGameTheme: string | null = null;

function effectiveMusicVolume(): number {
  const s = loadSettings();
  return s.muted ? 0 : s.musicVolume;
}

function applyMusicVolume(): void {
  current?.setVolume(effectiveMusicVolume());
}

/**
 * Une piste de musique, DÉCODÉE en entier puis jouée en boucle par un
 * `AudioBufferSourceNode` — jamais par un `<audio>` branché au contexte.
 *
 * ⚠️ **Pourquoi pas un `<audio>` :** branché par `createMediaElementSource`
 * (indispensable pour le volume sur iOS, qui ignore `.volume`), l'élément
 * avance sur sa propre horloge et remplit un tampon que le contexte vide sur
 * la sienne. Quand les deux se décalent, iOS rattrape le retard d'un coup :
 * la musique ACCÉLÈRE quelques secondes puis retombe sur le bon tempo, sans
 * aucune interruption pour l'expliquer. Une source de buffer n'a qu'une
 * horloge, celle du contexte : rien à rattraper.
 *
 * Prix : la piste décodée occupe ~20 Mo par minute (PCM 44,1 kHz stéréo) —
 * d'où une seule piste en mémoire (`dispose()` libère la précédente) et un
 * décodage au démarrage plutôt qu'au chargement de l'appli, avec ~0,5–1 s
 * de délai avant le premier son. Le fondu d'entrée attend ce démarrage
 * (`whenStarted`), sinon il se jouerait dans le vide.
 *
 * Décodée par `getDecodeCtx()` (aucune politique d'autoplay) ; un buffer
 * reste lisible sur n'importe quel contexte, donc une recréation du contexte
 * (`rebind`) reprend la piste à sa position sans la redécoder.
 */
class MusicTrack {
  private buffer: AudioBuffer | null = null;
  private gain: GainNode | null = null;
  private gainCtx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** `currentTime` du contexte qui correspond à la position 0 de la piste. */
  private startedAt = 0;
  /** Position (s) retenue quand la piste ne joue pas. */
  private offset = 0;
  private volume = 0;
  private wantPlaying = false;
  private disposed = false;
  private onStart: (() => void) | null = null;

  constructor(readonly url: string) {
    void this.load();
  }

  private async load(): Promise<void> {
    const ctx = getDecodeCtx();
    if (!ctx) return;
    try {
      const res = await fetch(this.url);
      if (!res.ok) return;
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      if (this.disposed) return;
      this.buffer = buffer;
      this.startIfWanted();
    } catch { /* piste muette : jamais une erreur qui remonte */ }
  }

  get paused(): boolean {
    return !this.wantPlaying;
  }

  /** Octets de PCM décodé gardés par cette piste (float32). */
  get decodedBytes(): number {
    return this.buffer ? this.buffer.length * this.buffer.numberOfChannels * 4 : 0;
  }

  play(): void {
    this.wantPlaying = true;
    this.startIfWanted();
  }

  pause(): void {
    if (this.source) {
      this.offset = this.position();
      this.stopSource();
    }
    this.wantPlaying = false;
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /** `cb` au premier son réellement planifié (tout de suite s'il l'est déjà). */
  whenStarted(cb: () => void): void {
    if (this.source) cb();
    else this.onStart = cb;
  }

  /** Le contexte a été recréé : tout ce qui était branché sur l'ancien est
   *  perdu, le buffer non. Reprend à la même position. */
  rebind(): void {
    if (this.source) this.offset = this.position();
    this.stopSource();
    this.gain = null;
    this.gainCtx = null;
    this.startIfWanted();
  }

  dispose(): void {
    this.disposed = true;
    this.onStart = null;
    this.pause();
    try { this.gain?.disconnect(); } catch { /* déjà détaché */ }
    this.gain = null;
    this.buffer = null;
  }

  private position(): number {
    const ctx = this.gainCtx;
    const d = this.buffer?.duration ?? 0;
    if (!this.source || !ctx || d <= 0) return this.offset;
    return (((ctx.currentTime - this.startedAt) % d) + d) % d;
  }

  private stopSource(): void {
    const src = this.source;
    this.source = null;
    if (!src) return;
    try { src.stop(); } catch { /* jamais démarrée ou déjà arrêtée */ }
    try { src.disconnect(); } catch { /* déjà détachée */ }
  }

  private startIfWanted(): void {
    if (!this.wantPlaying || this.source || !this.buffer || this.disposed) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      if (!this.gain || this.gainCtx !== ctx) {
        this.gain = ctx.createGain();
        this.gain.connect(ctx.destination);
        this.gainCtx = ctx;
      }
      this.gain.gain.value = this.volume;
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = true;
      src.connect(this.gain);
      const d = this.buffer.duration;
      const at = d > 0 ? this.offset % d : 0;
      src.start(0, at);
      this.startedAt = ctx.currentTime - at;
      this.source = src;
    } catch { return; }
    const cb = this.onStart;
    this.onStart = null;
    cb?.();
  }
}

/**
 * À appeler sur un geste utilisateur (le tap d'entrée dans `App.tsx`, ET un
 * écouteur `click` global permanent — cf. plus bas) : la lecture audio est
 * bloquée jusque-là par les navigateurs.
 *
 * ⚠️ Résume aussi l'`AudioContext` : il naît `suspended` tant qu'aucun geste
 * ne l'a débloqué, et tout ce qui le traverse (musique comme bruitages)
 * reste MUET tant qu'il n'a pas repris — `resume()` est retenté à CHAQUE
 * appel, jamais une seule fois. C'est aussi ici, dans le geste, qu'un
 * contexte bloqué ou figé est recréé (`rebuildAudioCtx`).
 *
 * Relance enfin une piste restée en pause hors arrière-plan — filet, rien
 * de plus : une piste décodée n'est pas soumise à l'autoplay, seul le
 * contexte l'est.
 */
export function unlock(): void {
  keepSessionAudible();
  let ctx = getAudioCtx();
  if (ctx && isStalled(ctx) && canRebuild()) {
    // Figé alors qu'il se dit en lecture : `resume()` n'y peut rien.
    ctx = rebuildAudioCtx();
  } else if (needsResume(ctx)) {
    const now = Date.now();
    if (stuckSince === null) stuckSince = now;
    else if (now - stuckSince >= STUCK_CTX_REBUILD_MS && canRebuild()) ctx = rebuildAudioCtx();
    if (needsResume(ctx)) ctx.resume().catch(() => {});
  }
  if (current?.paused && !backgroundPaused) current.play();
}

// ================== Session audio iOS ==================

/**
 * ⚠️ **Sur iOS, Web Audio SEUL est coupé par le bouton silencieux.** Sans
 * aucun élément média en lecture, la page reste dans la catégorie de session
 * « ambiant » : interrupteur sur silencieux, plus RIEN ne sort — musique
 * comme bruitages. C'est l'ancien `<audio>` de la musique qui, en jouant,
 * faisait passer la page en catégorie « lecture » et rendait tout audible ;
 * il a disparu avec `MusicTrack`, et le son avec lui.
 *
 * Deux leviers, posés dans le geste (`unlock`) :
 * - `navigator.audioSession.type = 'playback'` (Safari 16.4+), la voie propre ;
 * - un `<audio>` MUET en boucle, pour les iOS plus anciens. Il n'est PAS
 *   branché au contexte (`createMediaElementSource`) : c'est ce branchement,
 *   pas l'élément, qui faisait accélérer la musique. Il sert aussi de « dernier
 *   élément média » qui ne s'arrête jamais (cf. `deferredPauses`).
 */
let sessionKeeper: HTMLAudioElement | null = null;

/** 0,5 s de silence, WAV PCM 8 bits mono 8 kHz (128 = zéro en 8 bits). */
function silentWavUrl(): string {
  const samples = 4000;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  ascii(36, 'data'); view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function keepSessionAudible(): void {
  try {
    const session = (typeof navigator === 'undefined' ? undefined : navigator) as (Navigator & { audioSession?: { type: string } }) | undefined;
    if (session?.audioSession && session.audioSession.type !== 'playback') session.audioSession.type = 'playback';
  } catch { /* API absente ou refusée : l'élément muet prend le relais */ }
  if (typeof Audio === 'undefined' || backgroundPaused) return;
  try {
    if (!sessionKeeper) {
      sessionKeeper = new Audio(silentWavUrl());
      sessionKeeper.loop = true;
      sessionKeeper.setAttribute?.('playsinline', '');
    }
    if (sessionKeeper.paused) sessionKeeper.play().catch(() => { /* hors geste : retenté au prochain */ });
  } catch { /* jamais remonté */ }
}

/** Depuis quand un GESTE a trouvé le contexte à l'arrêt sans qu'il reparte —
 *  `null` tant qu'il tourne. */
let stuckSince: number | null = null;
/** Au-delà, un geste qui trouve encore le contexte à l'arrêt le RECRÉE. */
const STUCK_CTX_REBUILD_MS = 1000;
/** Au plus une recréation par fenêtre : si l'OS garde la session ailleurs, le
 *  contexte neuf peut naître figé lui aussi — chaque tap ne doit pas en
 *  recréer un. */
const REBUILD_MIN_INTERVAL_MS = 2000;
let lastRebuildAt = -Infinity;

function canRebuild(): boolean {
  return Date.now() - lastRebuildAt >= REBUILD_MIN_INTERVAL_MS;
}

/**
 * ⚠️ **Un contexte peut ne JAMAIS repartir.** Constaté sur iOS au retour d'un
 * passage en arrière-plan en pleine partie : `resume()` ne fait plus rien,
 * même appelé dans un geste, et la partie continue sans aucun son jusqu'au
 * prochain aller-retour. Le seul remède fiable est d'en créer un neuf — dans
 * un geste (`unlock`), sinon il naîtrait lui aussi suspendu.
 *
 * L'ancien est FERMÉ avant (deux contextes vivants font changer la fréquence
 * matérielle sur iOS, cf. `getAudioCtx`). Tout ce qui y était branché est
 * perdu : le gain des bruitages se recrée à la demande, les bruitages en vol
 * sont abandonnés, et la piste en cours est rebranchée (`MusicTrack.rebind`), à la
 * même position, sans être redécodée.
 */
function rebuildAudioCtx(): AudioContext | null {
  const old = audioCtx;
  audioCtx = null;
  sfxGain = null;
  stuckSince = null;
  lastRebuildAt = Date.now();
  if (old) {
    old.removeEventListener?.('statechange', onCtxStateChange);
    old.close?.().catch(() => {});
  }
  activeSfxSources.clear();
  for (const el of routedSfxKeepAlive) el.pause();
  routedSfxKeepAlive.clear();
  for (const track of deferredPauses) track.dispose();
  deferredPauses.clear();

  const ctx = getAudioCtx();
  if (needsResume(ctx)) ctx.resume().catch(() => {});
  if (current) {
    current.rebind();
    if (!backgroundPaused) current.play();
  }
  return ctx;
}

/** Vrai entre un `suspendForBackground()` et son `resumeFromBackground()` —
 *  distingue « en pause parce que l'onglet est en arrière-plan » d'« en
 *  pause parce que le joueur a coupé le son » : seul le premier cas se
 *  relance tout seul au retour. */
let backgroundPaused = false;

/**
 * Coupe la musique en cours quand l'onglet/l'appli passe en arrière-plan —
 * à appeler depuis `App.tsx` sur `visibilitychange` (`document.hidden`).
 * Sans ça la piste continue de jouer hors champ (constaté sur PWA installée,
 * en particulier Android, qui autorise la lecture audio en fond une fois
 * qu'une page a joué du son). Ne touche ni `currentTheme` ni la piste
 * choisie : `resumeFromBackground()` reprend exactement là où c'était.
 *
 * ⚠️ **`backgroundPaused` s'arme MÊME si aucune musique ne jouait à cet
 * instant** (thème coupé — `setMusicTheme(null)` en fin de partie — ou
 * `current` déjà en pause pour une autre raison) : c'est le SEUL signal qui
 * autorise `resumeFromBackground()` à reprendre le contexte Web Audio, et
 * les BRUITAGES en dépendent tout autant que la musique — `playSfx` ne joue
 * rien tant qu'`audioCtx` est suspendu, musique en cours ou pas. Armer le
 * drapeau seulement quand une piste jouait laissait les bruitages de partie
 * muets après un aller-retour en arrière-plan survenu pendant un silence
 * (fin de combat, écran de résultat) — exactement le cas où l'IHM de jeu,
 * faite de gestes `pointerdown` sur le board plutôt que de vrais boutons
 * `click`, n'a ensuite aucune occasion de rattraper le contexte via
 * `unlock()`.
 */
export function suspendForBackground(): void {
  backgroundPaused = true;
  if (audioCtx?.state === 'running') audioCtx.suspend().catch(() => {});
  current?.pause();
  sessionKeeper?.pause();
  // Une piste muette en attente de pause n'a rien à faire en fond.
  for (const track of deferredPauses) track.dispose();
  deferredPauses.clear();
}

/** Symétrique de `suspendForBackground()` — NO-OP si la coupure ne venait
 *  pas de là (le joueur a coupé le son lui-même, ou rien ne jouait). */
export function resumeFromBackground(): void {
  if (!backgroundPaused) return;
  backgroundPaused = false;
  // L'OS suspend souvent le contexte lui-même en fond, pas seulement
  // l'élément — sans le reprendre, ni la piste ni un `playSfx` à venir ne
  // produiraient le moindre son, bien qu'en lecture apparente.
  keepSessionAudible();
  if (needsResume(audioCtx)) audioCtx.resume().catch(() => {});
  current?.play();
}

/**
 * Tire et VERROUILLE le thème de partie pour le match qui commence — à
 * appeler UNE fois, à `GameController.begin()`, jamais à chaque round
 * (sinon la palette changerait de tour en tour, ce que la demande d'un
 * thème « par partie » exclut). Ne tire que parmi les thèmes qui ont au
 * moins une piste jouable — un thème créé en admin mais encore sans fichier
 * ne doit jamais réduire une partie au silence.
 *
 * Le thème choisi par le joueur (`setGameThemePreference`) l'emporte s'il est
 * jouable ; sinon tirage au sort.
 *
 * `null` quand aucun thème n'a de piste : `setMusicTheme('game')` retombe
 * alors sur le pool commun (`MusicDatabase.tracksForGameTheme`).
 */
export function rollGameTheme(): void {
  const ids = playableGameThemeIds();
  const wanted = loadSettings().gameTheme;
  lockedGameTheme = wanted && ids.includes(wanted) ? wanted
    : ids.length ? ids[Math.floor(Math.random() * ids.length)] : null;
}

/**
 * Bascule l'EMPLACEMENT musical courant (`menu` / `game_early` / `game_mid` /
 * `game_late`). NO-OP si c'est déjà l'emplacement en cours (sinon chaque
 * round rejouerait la piste depuis zéro) ; `force: true` pour retirer une
 * nouvelle piste du même emplacement (playlist).
 *
 * Un emplacement `game_*` joue les pistes du thème de partie VERROUILLÉ par
 * `rollGameTheme()` pour CE moment — c'est lui, pas cette fonction, qui
 * choisit LEQUEL. Le thème ne change jamais en cours de match : seul
 * l'emplacement avance (tours 1-2 → 3-4 → 5), et `tracksForGameTheme`
 * retombe sur le pool commun de l'emplacement si le thème verrouillé n'a
 * rien pour ce moment précis.
 *
 * `theme: null` coupe la musique (fondu vers le silence).
 */
export function setMusicTheme(theme: string | null, opts: { force?: boolean } = {}): void {
  if (typeof Audio === 'undefined') return;
  if (!opts.force && theme === currentTheme) return;
  currentTheme = theme;
  const tracks = theme && GAME_MUSIC_SLOTS.includes(theme) ? tracksForGameTheme(theme, lockedGameTheme)
    : theme ? tracksForTheme(theme) : [];
  if (!tracks.length) { fadeOutCurrent(); return; }
  const pick = tracks[Math.floor(Math.random() * tracks.length)];
  crossfadeTo(pick.id);
}

export function currentMusicTheme(): string | null {
  return currentTheme;
}

/**
 * Pistes descendues au silence dont la PAUSE attend la fin des bruitages.
 *
 * ⚠️ Sur iOS, mettre en pause le dernier élément média qui joue peut
 * désactiver la session audio de la page, et avec elle le contexte Web Audio
 * qui porte les bruitages : un son long en cours (`duel_start`, `match_win`,
 * `match_lose` — tous joués juste avant un `setMusicTheme(null)`) était coupé
 * net 900 ms plus tard, à la fin du fondu. La piste reste donc en lecture, à
 * volume nul, tant qu'un bruitage est en vol. La musique n'est plus un
 * élément média depuis `MusicTrack`, mais la règle est gardée : elle ne
 * coûte rien et c'est elle qui a fait disparaître ces coupures.
 */
const deferredPauses = new Set<MusicTrack>();
/** Filet si un `ended` ne vient jamais (contexte resté suspendu) : une piste
 *  muette ne doit pas tourner indéfiniment. */
const DEFERRED_PAUSE_MAX_MS = 10_000;

function pauseWhenSfxIdle(track: MusicTrack): void {
  if (!sfxPlaying()) { track.dispose(); return; }
  deferredPauses.add(track);
  setTimeout(() => {
    if (deferredPauses.delete(track)) track.dispose();
  }, DEFERRED_PAUSE_MAX_MS);
}

function releaseDeferredPauses(): void {
  if (sfxPlaying() || !deferredPauses.size) return;
  for (const track of deferredPauses) track.dispose();
  deferredPauses.clear();
}

function fadeOutCurrent(): void {
  const outgoing = current;
  current = null;
  if (!outgoing) return;
  const startVolume = effectiveMusicVolume();
  runFade((t) => outgoing.setVolume(startVolume * (1 - t)), () => pauseWhenSfxIdle(outgoing));
}

/**
 * ⚠️ SÉQUENTIEL, PAS DE CHEVAUCHEMENT : la sortante descend jusqu'au silence
 * et se COUPE, PUIS l'entrante démarre à 0 et remonte — les deux ne jouent
 * JAMAIS en même temps. Un vrai fondu ENCHAÎNÉ (les deux pistes superposées,
 * l'une montant pendant que l'autre descend) a été essayé et écarté : deux
 * musiques de partie qui se recouvrent, même une fraction de seconde,
 * s'entendent comme un accroc plutôt que comme une transition.
 */
function crossfadeTo(id: string): void {
  const outgoing = current;
  current = null;
  if (!outgoing) { startIncoming(id); return; }
  const startVolume = effectiveMusicVolume();
  runFade((t) => outgoing.setVolume(startVolume * (1 - t)), () => {
    outgoing.dispose();
    startIncoming(id);
  });
}

function startIncoming(id: string): void {
  const incoming = new MusicTrack(musicUrl(id));
  incoming.setVolume(0);
  current = incoming;
  incoming.play();
  // Le fondu part au premier son, pas tout de suite : le décodage prend un
  // instant, et un fondu fini avant lui ferait démarrer la piste à plein
  // volume, d'un coup.
  incoming.whenStarted(() => {
    if (current !== incoming) return;
    const target = effectiveMusicVolume();
    runFade((t) => { if (current === incoming) incoming.setVolume(target * t); });
  });
}

/**
 * La primitive de fondu commune : appelle `step(t)` avec une progression `t`
 * de 0 à 1 à pas fixe, sur UNE SEULE phase (`FADE_PHASE_MS`). Un
 * `setInterval` suffit pour une oreille — pas de `requestAnimationFrame`,
 * réservé au rendu (cf. `logic/` et `three/Scene3D._animate`) : ce module
 * n'anime rien à l'écran.
 */
function runFade(step: (t: number) => void, onDone?: () => void): void {
  const steps = Math.max(1, Math.round(FADE_PHASE_MS / FADE_STEP_MS));
  let i = 0;
  step(0);
  const timer = setInterval(() => {
    i++;
    const t = Math.min(1, i / steps);
    step(t);
    if (t >= 1) {
      clearInterval(timer);
      onDone?.();
    }
  }, FADE_STEP_MS);
}

/**
 * Mémoire audio décodée, pour l'indicateur de diagnostic admin : les effets
 * (gardés toute la session) et la piste de musique en cours (une à la fois).
 */
export function audioMemoryStats(): { sfxCount: number; sfxBytes: number; musicBytes: number } {
  let sfxBytes = 0;
  for (const b of sfxBufferCache.values()) sfxBytes += b.length * b.numberOfChannels * 4;
  return {
    sfxCount: sfxBufferCache.size,
    sfxBytes,
    musicBytes: (current?.decodedBytes ?? 0) + [...deferredPauses].reduce((n, t) => n + t.decodedBytes, 0),
  };
}
