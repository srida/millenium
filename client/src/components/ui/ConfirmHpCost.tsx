// Confirmation d'un geste payé en PV — le mulligan (barre de préparation) et le
// reroll de la Phase Shopping.
//
// Les deux sont les SEULS gestes de confort du jeu qui débitent une ressource,
// et cette ressource est celle qui décide de la partie. D'où une modale unique
// plutôt qu'un `confirm()` par bouton : les deux disent la même chose (ce qu'on
// achète, ce qu'il en coûte, ce qu'il restera après), et c'est la dernière ligne
// qui a de la valeur — le prix, lui, est déjà sur le bouton.
//
// ⚠️ Ce n'est PAS la doctrine de la modale de magies, qui n'a volontairement
// aucune confirmation : là-bas le contrecoup est lisible sur la carte qu'on
// choisit, et une magie impayable est verrouillée. Ici le bouton du mulligan
// voisine PRÊT ▸ dans une barre dense de 375 px, et celui du reroll voisine les
// magies elles-mêmes : dans les deux cas le tap malheureux est à un pouce du
// geste voulu, et il ne se reprend pas.
import { Button, Modal } from './primitives.js';

export default function ConfirmHpCost({
  title, detail, cost, playerHp, confirmLabel, onConfirm, onCancel,
}: {
  title: string;
  detail: string;
  cost: number;
  playerHp: number;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // ⚠️ Le plancher à 0 est défensif : la règle (`player_hp > cost`, stricte)
  // vit dans `GameSession` et interdit déjà d'arriver ici sans pouvoir payer.
  const after = Math.max(0, playerHp - cost);
  return (
    <Modal onClose={onCancel}>
      <div className="text-center text-[10px] tracking-widest text-white/40">CONFIRMER</div>

      <p className="mt-3 text-center text-sm font-semibold leading-tight">{title}</p>
      <p className="mt-1 text-center text-[11px] text-white/40">{detail}</p>

      <div className="mt-3 space-y-1 rounded-lg border border-line bg-white/5 p-2 text-xs">
        <div className="flex justify-between">
          <span className="text-white/50">Coût</span>
          <span className="font-semibold tabular-nums text-danger">−{cost} PV</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">Il te restera</span>
          <span className="tabular-nums text-white/70">{after} PV</span>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onPointerDown={(e) => { e.stopPropagation(); onCancel(); }}>
          Annuler
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          onPointerDown={(e) => { e.stopPropagation(); onConfirm(); }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
