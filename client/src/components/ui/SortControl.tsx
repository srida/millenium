// Le tri d'une liste : un critère, deux sens.
//
// ⚠️ Les critères viennent du SCHÉMA de la barre de requête, jamais d'une liste
// à part : filtrer et ordonner posent deux questions sur les mêmes champs, et
// un second inventaire aurait dérivé du premier au premier champ ajouté.
//
// ⚠️ Le sens est un BOUTON séparé du critère, pas deux entrées par champ dans
// une même liste. Vingt champs y auraient fait quarante lignes à parcourir pour
// choisir entre deux, et le sens courant ne se lirait nulle part.
import * as Query from '../../../../card-query.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SortState = { key: string; dir: 'asc' | 'desc' };

export default function SortControl({ schema, value, onChange, className = '' }: {
  schema: any;
  value: SortState;
  onChange: (next: SortState) => void;
  className?: string;
}) {
  const fields: any[] = Query.sortableFields(schema);
  const flip = () => onChange({ ...value, dir: value.dir === 'asc' ? 'desc' : 'asc' });

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <select
        value={value.key}
        onChange={(e) => onChange({ ...value, key: e.target.value })}
        aria-label="Critère de tri"
        className="min-h-tap min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-2 text-xs text-white"
      >
        {/* L'ordre du catalogue EST un ordre, et c'est celui d'avant : il reste
            joignable, sinon le tri serait une porte sans retour. */}
        <option value="">Ordre du catalogue</option>
        {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      <button
        type="button"
        onPointerDown={flip}
        disabled={!value.key}
        // Le sens n'a pas de sens sans critère — le bouton s'éteint plutôt que
        // de basculer un état que rien ne lit.
        aria-label={value.dir === 'asc' ? 'Tri croissant — basculer' : 'Tri décroissant — basculer'}
        title={value.dir === 'asc' ? 'Croissant' : 'Décroissant'}
        className="min-h-tap min-w-tap shrink-0 rounded-lg border border-line bg-surface-raised text-sm text-white/70 disabled:opacity-30"
      >{value.dir === 'asc' ? '↑' : '↓'}</button>
    </div>
  );
}
