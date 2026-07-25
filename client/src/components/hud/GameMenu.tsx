// Menu d'options en jeu (☰, coin haut-droit) — disponible en préparation comme
// en combat. Tant qu'il est ouvert, `menuOpen` gèle le chrono de préparation :
// le combat ne doit pas se lancer pendant qu'on lit le menu. Quitter demande
// confirmation (une partie abandonnée n'est pas reprenable).
import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { Button, Modal } from '../ui/primitives.js';

export default function GameMenu({ onQuit, quitLabel = 'Quitter la partie' }: {
  onQuit: () => void;
  quitLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const applySnapshot = useGameStore(s => s.applySnapshot);

  useEffect(() => {
    applySnapshot({ menuOpen: open });
    return () => applySnapshot({ menuOpen: false });
  }, [open, applySnapshot]);

  const close = () => { setOpen(false); setConfirm(false); };

  return (
    <>
      <button
        aria-label="Options"
        onPointerDown={(e) => { e.stopPropagation(); setOpen(true); }}
        className="pointer-events-auto absolute right-2 top-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] z-30 flex min-h-tap min-w-tap items-center justify-center rounded-lg border border-line bg-surface/80 text-lg text-white/70 active:opacity-80"
      >
        ☰
      </button>

      {open && (
        <Modal onClose={close}>
          <div className="text-xs tracking-widest text-white/50">OPTIONS</div>
          <div className="mb-3 text-base font-bold">Partie en cours</div>
          <div className="space-y-2">
            <Button variant="primary" className="w-full" onPointerDown={(e) => { e.stopPropagation(); close(); }}>
              ▸ Reprendre
            </Button>
            {confirm ? (
              <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-2">
                <p className="text-xs text-white/70">La partie en cours sera perdue.</p>
                <div className="flex gap-2">
                  <Button className="flex-1" onPointerDown={(e) => { e.stopPropagation(); setConfirm(false); }}>Annuler</Button>
                  <Button variant="danger" className="flex-1" onPointerDown={(e) => { e.stopPropagation(); close(); onQuit(); }}>
                    Confirmer
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="danger" className="w-full" onPointerDown={(e) => { e.stopPropagation(); setConfirm(true); }}>
                ✕ {quitLabel}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
