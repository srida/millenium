// Le moteur audio du jeu : lecture des effets sonores et musique de fond par
// THÈME, avec fondu enchaîné. Même statut que `three/` — aucun import React
// ni Zustand, piloté par des appels explicites (`GameController`, `App.tsx`,
// les composants HUD) plutôt qu'abonné à un store.
//
// ⚠️ RIEN n'est lu au niveau module (`Audio`, `localStorage`) : la suite de
// test tourne en `environment: 'node'`, sans DOM — même discipline que
// `three/constants.ts` et `components/ui/feedback.ts`.
//
// ⚠️ Un son manqué n'est JAMAIS une erreur qui remonte : catalogue vide,
// fichier absent, autoplay bloqué avant le premier geste utilisateur — dans
// les trois cas, le jeu continue silencieusement. L'audio est un habillage,
// pas une donnée de jeu (même doctrine que `CardBackDatabase`).
import { resolveSfx, sfxUrl, type SfxVariant } from '../data/SfxDatabase.js';
import { tracksForTheme, tracksForGameTheme, playableGameThemeIds, musicUrl } from '../data/MusicDatabase.js';

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

// ================== Effets sonores ==================

/**
 * Joue le son du déclencheur donné, avec sa variante (tier ou élément) si le
 * catalogue en porte une. Un déclencheur sans catalogue, sans fichier, ou une
 * lecture refusée (autoplay) ne produit RIEN — jamais une exception.
 */
export function playSfx(trigger: string, variant?: SfxVariant): void {
  if (typeof Audio === 'undefined') return;
  const s = loadSettings();
  if (s.muted || s.sfxVolume <= 0) return;
  const entry = resolveSfx(trigger, variant);
  if (!entry) return;
  try {
    const el = new Audio(sfxUrl(entry.id));
    el.volume = s.sfxVolume;
    el.play().catch(() => { /* autoplay bloqué avant le premier geste : silencieux */ });
  } catch { /* jamais remonté */ }
}

// ================== Musique ==================

let currentTheme: string | null = null;
let currentEl: HTMLAudioElement | null = null;
let unlocked = false;
/** Le thème de PARTIE verrouillé pour le match en cours — tiré une fois par
 *  `rollGameTheme()`, jamais rejoué à chaque round. */
let lockedGameTheme: string | null = null;

function effectiveMusicVolume(): number {
  const s = loadSettings();
  return s.muted ? 0 : s.musicVolume;
}

function applyMusicVolume(): void {
  if (currentEl) currentEl.volume = effectiveMusicVolume();
}

/**
 * À appeler sur le premier geste utilisateur (`pointerdown` global — cf.
 * `App.tsx`) : la lecture audio est bloquée jusque-là par les navigateurs
 * (iOS Safari en particulier), et `setMusicTheme` peut avoir été appelé
 * avant ce geste (musique du menu au chargement). Idempotent.
 */
export function unlock(): void {
  if (unlocked || typeof Audio === 'undefined') return;
  unlocked = true;
  if (currentEl?.paused) currentEl.play().catch(() => { /* toujours refusé : tant pis, silencieux */ });
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
 * Bascule l'EMPLACEMENT musical courant (`menu` / `game`). NO-OP si c'est
 * déjà l'emplacement en cours (sinon chaque round rejouerait la piste
 * depuis zéro) ; `force: true` pour retirer une nouvelle piste du même
 * emplacement (playlist).
 *
 * `theme: 'game'` joue les pistes du thème de partie VERROUILLÉ par
 * `rollGameTheme()` — c'est lui, pas cette fonction, qui choisit LEQUEL.
 *
 * `theme: null` coupe la musique (fondu vers le silence).
 */
export function setMusicTheme(theme: string | null, opts: { force?: boolean } = {}): void {
  if (typeof Audio === 'undefined') return;
  if (!opts.force && theme === currentTheme) return;
  currentTheme = theme;
  const tracks = theme === 'game' ? tracksForGameTheme(lockedGameTheme)
    : theme ? tracksForTheme(theme) : [];
  if (!tracks.length) { fadeOutCurrent(); return; }
  const pick = tracks[Math.floor(Math.random() * tracks.length)];
  crossfadeTo(pick.id);
}

export function currentMusicTheme(): string | null {
  return currentTheme;
}

function fadeOutCurrent(): void {
  const outgoing = currentEl;
  currentEl = null;
  if (!outgoing) return;
  const startVolume = outgoing.volume;
  runFade((t) => { outgoing.volume = clamp01(startVolume * (1 - t)); }, () => outgoing.pause());
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
  const outgoing = currentEl;
  currentEl = null;
  if (!outgoing) { startIncoming(id); return; }
  const startVolume = outgoing.volume;
  runFade((t) => { outgoing.volume = clamp01(startVolume * (1 - t)); }, () => {
    outgoing.pause();
    startIncoming(id);
  });
}

function startIncoming(id: string): void {
  const incoming = new Audio(musicUrl(id));
  incoming.loop = true;
  incoming.volume = 0;
  currentEl = incoming;
  // Refusé tant qu'aucun geste utilisateur n'a eu lieu — `unlock()` relance
  // alors l'élément resté en pause, sans qu'on ait à s'en soucier ici.
  incoming.play().catch(() => { /* silencieux, cf. unlock() */ });
  const target = effectiveMusicVolume();
  runFade((t) => { incoming.volume = clamp01(target * t); });
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
