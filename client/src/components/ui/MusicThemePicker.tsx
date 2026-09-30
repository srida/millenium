// Choix du thème musical des parties — partagé par les écrans de sélection
// d'adversaire (entraînement, duel en ligne, arcade, tournoi). La préférence
// vit dans `AudioManager` (`setGameThemePreference`) ; « Aléatoire » = un
// tirage par match. Seuls les thèmes qui ont au moins une piste jouable sont
// proposés (`playableGameThemeIds`).
import { useState } from 'react';
import * as Audio from '../../audio/AudioManager.js';
import { playableGameThemeIds } from '../../data/MusicDatabase.js';
import { getAllMusicThemes } from '../../data/MusicThemeDatabase.js';

export default function MusicThemePicker() {
  const [value, setValue] = useState<string>(() => Audio.getGameThemePreference() ?? '');
  const ids = playableGameThemeIds();
  if (!ids.length) return null;
  const nameOf = (id: string) => getAllMusicThemes().find(t => t.id === id)?.name || id;

  return (
    <label className="flex w-full max-w-sm items-center gap-2 text-left">
      <span className="text-[10px] tracking-widest text-white/40">MUSIQUE</span>
      <select
        value={ids.includes(value) ? value : ''}
        onChange={e => { setValue(e.target.value); Audio.setGameThemePreference(e.target.value || null); }}
        className="min-h-tap flex-1 rounded-lg border border-line bg-surface-raised px-3 text-sm text-white/90"
      >
        <option value="">Aléatoire</option>
        {ids.map(id => <option key={id} value={id}>{nameOf(id)}</option>)}
      </select>
    </label>
  );
}
