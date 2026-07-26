// Menu d'options en jeu — disponible en préparation comme en combat. Le bouton
// ☰ qui l'ouvre vit dans PhaseControls (barre du bas, à côté de PRÊT / Pause) ;
// `menuOpen` du store est la source de vérité de l'ouverture, et gèle au passage
// le chrono de préparation (solo) : le combat ne doit pas se lancer pendant
// qu'on lit le menu. Quitter demande confirmation (une partie abandonnée n'est
// pas reprenable).
import { useEffect, useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { Button, Modal } from '../ui/primitives.js';

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
