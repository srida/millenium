// Menu d'options en jeu — disponible en préparation comme en combat. Le bouton
// ☰ qui l'ouvre vit dans PhaseControls (barre du bas, à côté de PRÊT / Pause) ;
// `menuOpen` du store est la source de vérité de l'ouverture, et gèle au passage
// le chrono de préparation (solo) : le combat ne doit pas se lancer pendant
// qu'on lit le menu. Quitter demande confirmation (une partie abandonnée n'est
// pas reprenable).
//
// En solo (`soloControls`), il porte aussi la vitesse ×1/×2/×4 et la PAUSE du
// combat : l'ouvrir en combat le fige, le fermer le reprend. La barre de phase
// reste ainsi la même qu'en PvP, où ni l'une ni l'autre n'existe (temps réel
// partagé).
import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { Button, Modal } from '../ui/primitives.js';
import UiIcon from '../ui/UiIcon.js';
import VolumeSliders from '../ui/VolumeSliders.js';
import MemoryToggle from '../ui/MemoryToggle.js';
import * as Audio from '../../audio/AudioManager.js';

const SPEEDS = [1, 2, 4];

export default function GameMenu({ onQuit, quitLabel = 'Quitter la partie', soloControls = false }: {
  onQuit: () => void;
  quitLabel?: string;
  soloControls?: boolean;
}) {
  const open = useGameStore(s => s.menuOpen);
  const controller = useGameStore(s => s.controller);
  const combatActive = useGameStore(s => s.combatActive);
  const speed = useGameStore(s => s.speed);
  const [confirm, setConfirm] = useState(false);
  const applySnapshot = useGameStore(s => s.applySnapshot);

  useEffect(() => () => applySnapshot({ menuOpen: false }), [applySnapshot]);
  useEffect(() => { if (!open) setConfirm(false); }, [open]);
  // `combatActive` dans les deps : le contrôleur remet `paused` à faux à chaque
  // entrée en combat, la pause doit donc être reposée si le menu est ouvert.
  useEffect(() => {
    if (!soloControls || !controller) return;
    controller.setPaused(open && combatActive);
  }, [soloControls, controller, open, combatActive]);

  const close = () => { applySnapshot({ menuOpen: false }); setConfirm(false); };

  return (
    <>
      {open && (
        <Modal onClose={close}>
          <div className="text-xs tracking-widest text-white/50">OPTIONS</div>
          <div className="mb-3 text-base font-bold">
            {soloControls && combatActive ? 'Combat en pause' : 'Partie en cours'}
          </div>
          <div className="space-y-2">
            {soloControls && controller && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-white/70">Vitesse du combat</span>
                <div className="flex shrink-0 overflow-hidden rounded-lg border border-line" role="group" aria-label="Vitesse du combat">
                  {SPEEDS.map(s => (
                    <button
                      key={s}
                      aria-pressed={s === speed}
                      className={`min-h-tap min-w-tap px-2 text-sm font-semibold ${s === speed ? 'bg-[color-mix(in_srgb,var(--color-gold)_20%,var(--color-surface-raised))] text-gold' : 'bg-surface-raised text-white/70'}`}
                      onPointerDown={(e) => { e.stopPropagation(); controller.setSpeed(s); }}
                    >×{s}</button>
                  ))}
                </div>
              </div>
            )}
            <VolumeSliders />
            <MemoryToggle />
            <Button variant="primary" className="w-full" onPointerDown={(e) => { e.stopPropagation(); Audio.playSfx('menu_resume'); close(); }} sfx={false}>
              Reprendre
            </Button>
            {confirm ? (
              <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-2">
                <p className="text-xs text-white/70">La partie en cours sera perdue.</p>
                <div className="flex gap-2">
                  <Button className="flex-1" onPointerDown={(e) => { e.stopPropagation(); setConfirm(false); }}>Annuler</Button>
                  <Button variant="danger" className="flex-1" onPointerDown={(e) => { e.stopPropagation(); Audio.playSfx('menu_quit'); close(); onQuit(); }} sfx={false}>
                    Confirmer
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="danger" className="flex w-full items-center justify-center gap-1.5" onPointerDown={(e) => { e.stopPropagation(); setConfirm(true); }}>
                <UiIcon id="UI_CLOSE" className="h-4 w-4" /> {quitLabel}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
