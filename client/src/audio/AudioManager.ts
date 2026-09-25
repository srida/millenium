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
import { tracksForTheme, musicUrl } from '../data/MusicDatabase.js';

const SETTINGS_KEY = 'millenium_audio_settings_v1';
// Durée du fondu enchaîné entre deux musiques — assez long pour qu'un
// changement de thème de partie (tours 1-2 → 3-4 → 5) se fasse sentir comme
// une transition et non une coupure, assez court pour ne pas laisser deux
// thèmes se superposer sur un enchaînement rapide de rounds.
const CROSSFADE_MS = 2000;
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
 * Bascule le thème musical courant. NO-OP si c'est déjà le thème en cours
 * (sinon chaque round d'un même palier — tours 1 et 2 partagent `game_early`
 * — relancerait la piste depuis zéro) ; `force: true` pour retirer une
 * nouvelle piste du même thème (playlist).
 *
 * `theme: null` coupe la musique (fondu vers le silence).
 */
export function setMusicTheme(theme: string | null, opts: { force?: boolean } = {}): void {
  if (typeof Audio === 'undefined') return;
  if (!opts.force && theme === currentTheme) return;
  currentTheme = theme;
  const tracks = theme ? tracksForTheme(theme) : [];
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
  runFade((t) => { outgoing.volume = clamp01(startVolume * Math.cos(t * (Math.PI / 2))); }, () => outgoing.pause());
}

/**
 * ⚠️ Fondu À PUISSANCE ÉGALE (`sin`/`cos`, pas un simple linéaire) : deux
 * volumes qui rampent chacun de leur côté en ligne droite se croisent en
 * creusant un trou audible au milieu du fondu — l'oreille perçoit la SOMME
 * des deux pistes, qui vaut alors `sin²+cos² = 1` à puissance égale, contre
 * `t + (1-t) = 1`... en amplitude, pas en énergie perçue. C'est ce trou que
 * la demande d'une transition « douce » entre les musiques de partie
 * signalait.
 *
 * Un seul minuteur pilote l'ENTRANTE et la SORTANTE ensemble : deux fondus
 * indépendants (l'un sur `from→to`, l'autre sur `to→from`) ne garantissent
 * pas la même progression `t` au même tick.
 */
function crossfadeTo(id: string): void {
  const outgoing = currentEl;
  const outgoingStart = outgoing?.volume ?? 0;
  const incoming = new Audio(musicUrl(id));
  incoming.loop = true;
  incoming.volume = 0;
  currentEl = incoming;
  // Refusé tant qu'aucun geste utilisateur n'a eu lieu — `unlock()` relance
  // alors l'élément resté en pause, sans qu'on ait à s'en soucier ici.
  incoming.play().catch(() => { /* silencieux, cf. unlock() */ });
  const target = effectiveMusicVolume();
  runFade((t) => {
    const angle = t * (Math.PI / 2);
    incoming.volume = clamp01(Math.sin(angle) * target);
    if (outgoing) outgoing.volume = clamp01(Math.cos(angle) * outgoingStart);
  }, () => outgoing?.pause());
}

/**
 * La primitive de fondu commune : appelle `step(t)` avec une progression `t`
 * de 0 à 1 à pas fixe. Un `setInterval` suffit pour une oreille — pas de
 * `requestAnimationFrame`, réservé au rendu (cf. `logic/` et
 * `three/Scene3D._animate`) : ce module n'anime rien à l'écran.
 */
function runFade(step: (t: number) => void, onDone?: () => void): void {
  const steps = Math.max(1, Math.round(CROSSFADE_MS / FADE_STEP_MS));
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
