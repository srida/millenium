// Le moteur audio du jeu : lecture des effets sonores et musique de fond par
// THÈME, avec fondu enchaîné. Même statut que `three/` — aucun import React
// ni Zustand, piloté par des appels explicites (`GameController`, `App.tsx`,
// les composants HUD) plutôt qu'abonné à un store.
//
// ⚠️ RIEN n'est lu au niveau module (`Audio`, `localStorage`, `AudioContext`) :
// la suite de test tourne en `environment: 'node'`, sans DOM — même
// discipline que `three/constants.ts` et `components/ui/feedback.ts`.
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
// La MUSIQUE, elle, reste sur ce chemin élément : des pistes qui bouclent
// plusieurs minutes coûteraient bien plus cher décodées entières en mémoire
// qu'en flux, et un changement d'emplacement est rare (par round, pas par
// attaque) — le coût d'un `fetch` n'y est structurellement pas sensible.
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
}

const DEFAULT_SETTINGS: AudioSettings = { sfxVolume: 0.7, musicVolume: 0.5, muted: false };

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

export function setMuted(muted: boolean): void {
  loadSettings().muted = muted;
  saveSettings();
  applyMusicVolume();
  applySfxGain();
}

// ================== Contexte Web Audio (volume réel, y compris iOS) ==================

let audioCtx: AudioContext | null = null;

/**
 * Même garde que `components/ui/feedback.ts` : jamais lu au niveau module.
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
    try { audioCtx = new Ctor(); } catch { return null; }
  }
  return audioCtx;
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
 * c'est la primitive commune aux effets sonores (un élément par lecture) et
 * à la musique (un élément par piste). `el.volume` est laissé à 1 dès que le
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
  if (buffer && ctx) {
    try {
      const gain = ensureSfxGain(ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(0);
      return;
    } catch { /* repli ci-dessous */ }
  }

  try {
    const routed = createRoutedAudio(sfxUrl(entry.id));
    setRoutedVolume(routed, s.sfxVolume);
    routed.el.play().catch(() => { /* autoplay bloqué avant le premier geste : silencieux */ });
  } catch { /* jamais remonté */ }
}

// ================== Musique ==================

let currentTheme: string | null = null;
let current: RoutedAudio | null = null;
/** Le thème de PARTIE verrouillé pour le match en cours — tiré une fois par
 *  `rollGameTheme()`, jamais rejoué à chaque round. */
let lockedGameTheme: string | null = null;

function effectiveMusicVolume(): number {
  const s = loadSettings();
  return s.muted ? 0 : s.musicVolume;
}

function applyMusicVolume(): void {
  if (current) setRoutedVolume(current, effectiveMusicVolume());
}

/**
 * À appeler sur un geste utilisateur (le tap d'entrée dans `App.tsx`, ET un
 * écouteur `click` global permanent — cf. plus bas) : la lecture audio est
 * bloquée jusque-là par les navigateurs.
 *
 * ⚠️ Résume aussi l'`AudioContext` : il naît `suspended` tant qu'aucun geste
 * ne l'a débloqué (même contrainte que la lecture elle-même), et un élément
 * routé à travers lui reste MUET tant qu'il n'a pas repris — `resume()` est
 * retenté à CHAQUE appel, jamais une seule fois, sur le modèle de
 * `playClick()`.
 *
 * ⚠️ Le rattrapage d'une piste restée en pause (`current.el.paused`) tourne
 * lui aussi À CHAQUE appel, PAS seulement au premier — `unlocked` ne garde
 * que la mémoire du fait qu'un geste a déjà eu lieu, il ne doit RIEN empêcher
 * de rejouer. C'est ce filet qui rattrape un premier `play()` resté muet sur
 * Safari mobile : le tap d'entrée utilise `onClick` (le seul geste que
 * `<audio>.play()` y reconnaît de façon fiable), mais si jamais CE play()
 * précis échouait quand même, le tout PROCHAIN clic ailleurs dans l'appli
 * (n'importe quel bouton de menu) le retente ici.
 */
export function unlock(): void {
  const ctx = getAudioCtx();
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  if (typeof Audio === 'undefined') return;
  if (current?.el.paused) current.el.play().catch(() => { /* toujours refusé : tant pis, silencieux */ });
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
 */
export function suspendForBackground(): void {
  if (!current || current.el.paused) return;
  backgroundPaused = true;
  current.el.pause();
}

/** Symétrique de `suspendForBackground()` — NO-OP si la coupure ne venait
 *  pas de là (le joueur a coupé le son lui-même, ou rien ne jouait). */
export function resumeFromBackground(): void {
  if (!backgroundPaused) return;
  backgroundPaused = false;
  // L'OS suspend souvent le contexte lui-même en fond, pas seulement
  // l'élément — sans le reprendre, la piste resterait MUETTE bien qu'en
  // lecture.
  if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
  if (current) current.el.play().catch(() => { /* toujours refusé : tant pis, silencieux */ });
}

/**
 * Tire et VERROUILLE le thème de partie pour le match qui commence — à
 * appeler UNE fois, à `GameController.begin()`, jamais à chaque round
 * (sinon la palette changerait de tour en tour, ce que la demande d'un
 * thème « par partie » exclut). Ne tire que parmi les thèmes qui ont au
 * moins une piste jouable — un thème créé en admin mais encore sans fichier
 * ne doit jamais réduire une partie au silence.
 *
 * `null` quand aucun thème n'a de piste : `setMusicTheme('game')` retombe
 * alors sur le pool commun (`MusicDatabase.tracksForGameTheme`).
 */
export function rollGameTheme(): void {
  const ids = playableGameThemeIds();
  lockedGameTheme = ids.length ? ids[Math.floor(Math.random() * ids.length)] : null;
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

function fadeOutCurrent(): void {
  const outgoing = current;
  current = null;
  if (!outgoing) return;
  const startVolume = effectiveMusicVolume();
  runFade((t) => setRoutedVolume(outgoing, startVolume * (1 - t)), () => outgoing.el.pause());
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
  runFade((t) => setRoutedVolume(outgoing, startVolume * (1 - t)), () => {
    outgoing.el.pause();
    startIncoming(id);
  });
}

function startIncoming(id: string): void {
  const incoming = createRoutedAudio(musicUrl(id));
  incoming.el.loop = true;
  setRoutedVolume(incoming, 0);
  current = incoming;
  // Refusé tant qu'aucun geste utilisateur n'a eu lieu — `unlock()` relance
  // alors l'élément resté en pause, sans qu'on ait à s'en soucier ici.
  incoming.el.play().catch(() => { /* silencieux, cf. unlock() */ });
  const target = effectiveMusicVolume();
  runFade((t) => setRoutedVolume(incoming, target * t));
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
