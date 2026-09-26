// Menu d'options en jeu — disponible en préparation comme en combat. Le bouton
// ☰ qui l'ouvre vit dans PhaseControls (barre du bas, à côté de PRÊT / Pause) ;
// `menuOpen` du store est la source de vérité de l'ouverture, et gèle au passage
// le chrono de préparation (solo) : le combat ne doit pas se lancer pendant
// qu'on lit le menu. Quitter demande confirmation (une partie abandonnée n'est
// pas reprenable).
import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { Button, Modal } from '../ui/primitives.js';
import * as Audio from '../../audio/AudioManager.js';

/**
 * Volumes des sons et de la musique — deux curseurs 0–100, écrits dans
 * `AudioManager` (persisté en `localStorage`) à chaque glissement. L'état
 * React n'est qu'un MIROIR d'affichage : `AudioManager` reste la seule
 * source de vérité, relue une fois à l'ouverture du menu.
 */
function VolumeSliders() {
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
          <span>🔊 Effets sonores</span>
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
          <span>🎵 Musique</span>
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

export default function GameMenu({ onQuit, quitLabel = 'Quitter la partie' }: {
  onQuit: () => void;
  quitLabel?: string;
}) {
  const open = useGameStore(s => s.menuOpen);
  const [confirm, setConfirm] = useState(false);
  const applySnapshot = useGameStore(s => s.applySnapshot);

  useEffect(() => () => applySnapshot({ menuOpen: false }), [applySnapshot]);
  useEffect(() => { if (!open) setConfirm(false); }, [open]);

  const close = () => { applySnapshot({ menuOpen: false }); setConfirm(false); };

  return (
    <>
      {open && (
        <Modal onClose={close}>
          <div className="text-xs tracking-widest text-white/50">OPTIONS</div>
          <div className="mb-3 text-base font-bold">Partie en cours</div>
          <div className="space-y-2">
            <VolumeSliders />
            <Button variant="primary" className="w-full" onPointerDown={(e) => { e.stopPropagation(); Audio.playSfx('menu_resume'); close(); }} sfx={false}>
              ▸ Reprendre
            </Button>
            {confirm ? (
              <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-2">
                <p className="text-xs text-white/70">La partie en cours sera perdue.</p>
                <div className="flex gap-2">
                  <Button className="flex-1" onPointerDown={(e) => { e.stopPropagation(); setConfirm(false); }} sfx={false}>Annuler</Button>
                  <Button variant="danger" className="flex-1" onPointerDown={(e) => { e.stopPropagation(); Audio.playSfx('menu_quit'); close(); onQuit(); }} sfx={false}>
                    Confirmer
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="danger" className="w-full" onPointerDown={(e) => { e.stopPropagation(); setConfirm(true); }} sfx={false}>
                ✕ {quitLabel}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
