// Choix du thème musical des parties — partagé par les écrans de sélection
// d'adversaire (entraînement, duel en ligne, arcade, tournoi). La préférence
// vit dans `AudioManager` (`setGameThemePreference`) ; « Aléatoire » = un
// tirage par match. Seuls les thèmes qui ont au moins une piste jouable sont
// proposés (`playableGameThemeIds`).
//
// Un sélecteur À FLÈCHES et non un `<select>` : la liste est courte, et le
// natif ouvrait une roue système plein écran pour changer un seul réglage.
import { useState, type ReactNode } from 'react';
import * as Audio from '../../audio/AudioManager.js';
import { playableGameThemeIds } from '../../data/MusicDatabase.js';
import { getAllMusicThemes } from '../../data/MusicThemeDatabase.js';
import { SHADOW_IDLE, SHADOW_SQUASHED, usePressSquash } from './primitives.js';
import UiIcon from './UiIcon.js';

// Au-delà, des pastilles ne se comptent plus : on bascule sur « i / n ».
const MAX_DOTS = 8;

// Le son de bouton part de `usePressSquash` : pas de `playSfx` en plus ici.
function ArrowButton({ label, onTap, children }: { label: string; onTap: () => void; children: ReactNode }) {
  const { squashed, handlers } = usePressSquash<HTMLButtonElement>(onTap, false);
  return (
    <button
      type="button"
      aria-label={label}
      {...handlers}
      className={`flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-gradient-to-b from-[color-mix(in_srgb,white_10%,var(--color-surface-raised))] to-surface text-xl leading-none text-white/90 transition-[transform,box-shadow] duration-100 ease-out ${squashed ? SHADOW_SQUASHED : SHADOW_IDLE}`}
    >
      {children}
    </button>
  );
}

export default function MusicThemePicker() {
  const ids = playableGameThemeIds();
  // Une préférence qui n'est plus jouable retombe sur Aléatoire (index 0).
  const opts = ['', ...ids];
  const [i, setI] = useState(() => Math.max(0, opts.indexOf(Audio.getGameThemePreference() ?? '')));
  if (!ids.length) return null;

  const idx = i < opts.length ? i : 0;
  const cur = opts[idx];
  const nameOf = (id: string) => (id ? getAllMusicThemes().find(t => t.id === id)?.name || id : 'Aléatoire');
  const go = (d: number) => {
    const n = (idx + d + opts.length) % opts.length;
    setI(n);
    Audio.setGameThemePreference(opts[n] || null);
  };

  return (
    <div
      role="group"
      aria-label="Thème musical"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') go(-1);
        if (e.key === 'ArrowRight') go(1);
      }}
      className="grid w-full max-w-sm grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 rounded-xl border border-line bg-surface-raised/70 p-1.5"
    >
      <ArrowButton label="Thème précédent" onTap={() => go(-1)}>‹</ArrowButton>
      <div className="flex min-w-0 flex-col items-center gap-1">
        <span className="text-[10px] tracking-widest text-white/40">MUSIQUE</span>
        <span aria-live="polite" className="flex max-w-full items-center gap-1.5 text-sm font-bold text-gold">
          {!cur && <UiIcon id="UI_REROLL" className="h-3.5 w-3.5" />}
          <span className="truncate">{nameOf(cur)}</span>
        </span>
        {opts.length <= MAX_DOTS ? (
          <span className="flex gap-1" aria-hidden>
            {opts.map((_, k) => (
              <span key={k} className={`h-1 rounded-sm transition-[width] duration-200 ${k === idx ? 'w-3.5 bg-gold' : 'w-1 bg-white/20'}`} />
            ))}
          </span>
        ) : (
          <span className="text-[10px] tabular-nums text-white/40">{idx + 1} / {opts.length}</span>
        )}
      </div>
      <ArrowButton label="Thème suivant" onTap={() => go(1)}>›</ArrowButton>
    </div>
  );
}
