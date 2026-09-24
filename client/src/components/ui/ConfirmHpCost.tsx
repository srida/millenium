// Confirmation d'un geste payé en PV — le mulligan (barre de préparation).
//
// Une modale plutôt qu'un `confirm()` du bouton : ce qu'on achète, ce qu'il en
// coûte, ce qu'il restera après — et c'est la dernière ligne qui a de la
// valeur, le prix étant déjà sur le bouton. Le bouton du mulligan voisine
// PRÊT ▸ dans une barre dense de 375 px : le tap malheureux est à un pouce du
// geste voulu, et il ne se reprend pas.
//
// ⚠️ Le reroll de la Phase Shopping n'en a PAS (ni la modale de magies elle-
// même) : son contrecoup est déjà lisible sur son propre libellé et le geste
// est déjà à l'intérieur d'une modale de choix, pas voisin d'un bouton PRÊT.
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
