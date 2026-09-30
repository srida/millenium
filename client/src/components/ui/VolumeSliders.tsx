// Réglage des volumes — partagé par le menu d'options en jeu (`GameMenu`) et
// celui du header des menus (`SettingsMenu`).
import { useState } from 'react';
import UiIcon from './UiIcon.js';
import * as Audio from '../../audio/AudioManager.js';

/**
 * Volumes des sons et de la musique — deux curseurs 0–100, écrits dans
 * `AudioManager` (persisté en `localStorage`) à chaque glissement. L'état
 * React n'est qu'un MIROIR d'affichage : `AudioManager` reste la seule
 * source de vérité, relue une fois à l'ouverture du menu.
 */
export default function VolumeSliders() {
  const [settings, setSettings] = useState(() => Audio.getSettings());

  const pct = (v: number) => Math.round(v * 100);
  const setSfx = (pct: number) => {
    const v = pct / 100;
    Audio.setSfxVolume(v);
    setSettings(s => ({ ...s, sfxVolume: v }));
  };
  const setMusic = (pct: number) => {
    const v = pct / 100;
    Audio.setMusicVolume(v);
    setSettings(s => ({ ...s, musicVolume: v }));
  };

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface/60 p-3">
      <label className="block text-xs text-white/70">
        <span className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1.5"><UiIcon id="UI_SOUND" className="h-4 w-4" /> Effets sonores</span>
          <span className="tabular-nums text-white/50">{pct(settings.sfxVolume)}</span>
        </span>
        <input
          type="range" min={0} max={100} step={1} value={pct(settings.sfxVolume)}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setSfx(Number(e.target.value))}
          className="min-h-tap w-full accent-gold"
        />
      </label>
      <label className="block text-xs text-white/70">
        <span className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1.5"><UiIcon id="UI_MUSIC" className="h-4 w-4" /> Musique</span>
          <span className="tabular-nums text-white/50">{pct(settings.musicVolume)}</span>
        </span>
        <input
          type="range" min={0} max={100} step={1} value={pct(settings.musicVolume)}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setMusic(Number(e.target.value))}
          className="min-h-tap w-full accent-gold"
        />
      </label>
    </div>
  );
}
