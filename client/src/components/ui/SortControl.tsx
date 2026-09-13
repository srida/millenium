// Le tri d'une liste : un critère, deux sens — fusionnés dans UN SEUL bouton
// plutôt qu'un `<select>` (large, redondant avec la barre de requête juste à
// côté) et un bouton de sens séparé. Le bouton ouvre une popup ; retaper le
// critère déjà choisi en bascule le sens, au lieu d'exposer un second contrôle.
//
// ⚠️ Les critères viennent du SCHÉMA de la barre de requête, jamais d'une liste
// à part : filtrer et ordonner posent deux questions sur les mêmes champs, et
// un second inventaire aurait dérivé du premier au premier champ ajouté.
import { useState } from 'react';
import * as Query from '../../../../card-query.mjs';
import { Modal } from './primitives.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SortState = { key: string; dir: 'asc' | 'desc' };

export default function SortControl({ schema, value, onChange, className = '' }: {
  schema: any;
  value: SortState;
  onChange: (next: SortState) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const fields: any[] = Query.sortableFields(schema);
  const current = fields.find(f => f.key === value.key);
  const arrow = value.dir === 'asc' ? '↑' : '↓';

  // Retaper le critère déjà actif bascule son sens ; en choisir un autre
  // l'adopte en croissant. « Ordre du catalogue » n'a pas de sens à basculer.
  function pick(key: string) {
    if (key === '') { onChange({ key: '', dir: 'asc' }); }
    else if (key === value.key) { onChange({ ...value, dir: value.dir === 'asc' ? 'desc' : 'asc' }); }
    else { onChange({ key, dir: 'asc' }); }
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onPointerDown={() => setOpen(true)}
        aria-label="Trier"
        className={`flex min-h-tap shrink-0 items-center gap-1 rounded-lg border border-line bg-surface-raised px-2.5 text-xs text-white/80 ${className}`}
      >
        <span aria-hidden="true">⇅</span>
        <span className="max-w-[8rem] truncate">{current ? current.label : 'Ordre du catalogue'}</span>
        {current && <span aria-hidden="true">{arrow}</span>}
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <p className="mb-2 text-center text-[10px] tracking-widest text-white/40">TRIER PAR</p>
          <div className="flex flex-col gap-1">
            {/* L'ordre du catalogue EST un ordre, et c'est celui d'avant : il
                reste joignable, sinon le tri serait une porte sans retour. */}
            <SortRow active={value.key === ''} label="Ordre du catalogue" onTap={() => pick('')} />
            {fields.map(f => (
              <SortRow
                key={f.key}
                active={f.key === value.key}
                label={f.label}
                arrow={f.key === value.key ? arrow : undefined}
                onTap={() => pick(f.key)}
              />
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function SortRow({ active, label, arrow, onTap }: { active: boolean; label: string; arrow?: string; onTap: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={onTap}
      className={`flex min-h-tap items-center justify-between rounded-lg px-3 text-sm ${active ? 'bg-gold/15 text-gold' : 'text-white/80 active:bg-white/5'}`}
    >
      <span>{label}</span>
      {arrow && <span aria-hidden="true">{arrow}</span>}
    </button>
  );
}
