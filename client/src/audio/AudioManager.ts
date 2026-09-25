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
import { resolveSfx, sfxUrl, type SfxVariant } from '../data/SfxDatabase.js';
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
}

// ================== Contexte Web Audio (volume réel, y compris iOS) ==================

let audioCtx: AudioContext | null = null;

/** Même garde que `components/ui/feedback.ts` : jamais lu au niveau module. */
function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try { audioCtx = new Ctor(); } catch { return null; }
  }
  return audioCtx;
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

/**
 * Joue le son du déclencheur donné, avec sa variante (tier, élément ou
 * pouvoir) si le catalogue en porte une. Un déclencheur sans catalogue, sans
 * fichier, ou une lecture refusée (autoplay) ne produit RIEN — jamais une
 * exception.
 */
export function playSfx(trigger: string, variant?: SfxVariant): void {
  if (typeof Audio === 'undefined') return;
  const s = loadSettings();
  if (s.muted || s.sfxVolume <= 0) return;
  const entry = resolveSfx(trigger, variant);
  if (!entry) return;
  try {
    const routed = createRoutedAudio(sfxUrl(entry.id));
    setRoutedVolume(routed, s.sfxVolume);
    routed.el.play().catch(() => { /* autoplay bloqué avant le premier geste : silencieux */ });
  } catch { /* jamais remonté */ }
}

// ================== Musique ==================

let currentTheme: string | null = null;
let current: RoutedAudio | null = null;
let unlocked = false;
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
 * À appeler sur le premier geste utilisateur (`pointerdown` global — cf.
 * `App.tsx`) : la lecture audio est bloquée jusque-là par les navigateurs
 * (iOS Safari en particulier), et `setMusicTheme` peut avoir été appelé
 * avant ce geste (musique du menu au chargement). Idempotent.
 *
 * ⚠️ Résume aussi l'`AudioContext` : il naît `suspended` tant qu'aucun geste
 * ne l'a débloqué (même contrainte que la lecture elle-même), et un élément
 * routé à travers lui reste MUET tant qu'il n'a pas repris — `resume()` est
 * retenté à chaque appel, jamais une seule fois, sur le modèle de
 * `playClick()`.
 */
export function unlock(): void {
  const ctx = getAudioCtx();
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  if (unlocked || typeof Audio === 'undefined') return;
  unlocked = true;
  if (current?.el.paused) current.el.play().catch(() => { /* toujours refusé : tant pis, silencieux */ });
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
