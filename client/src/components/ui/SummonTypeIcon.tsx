// Le pictogramme d'un type d'invocation : son IMAGE si elle a été importée
// depuis l'admin, son EMOJI sinon. Même règle que AttrIcon.tsx / PowerIcon.tsx.
//
// Résolu par `type` (la clé brute `normal`/`sacrifice`/…), pas par l'id du
// catalogue admin — c'est ce que porte `SummonRecipe.summon_type` côté appelant.
import { getSummonTypeByType } from '../../data/SummonTypeDatabase.js';
import { Illustration } from './primitives.js';

export default function SummonTypeIcon({ type, fallback, className = '' }: {
  type: string;
  /** Emoji de secours (le repli codé en dur de SummonInfo.ts, `recipe.icon`). */
  fallback?: string;
  /** Porte la taille de BOÎTE (image) *et* la taille de POLICE (emoji). */
  className?: string;
}) {
  // `getSummonTypeByType` JETTE tant que la database n'est pas initialisée —
  // même précaution qu'AttrIcon pour TestBench/CombatLab.
  let entry: { id?: string; icon?: string; _has_illustration?: boolean } | null = null;
  try {
    entry = (getSummonTypeByType as (type: string) => typeof entry)(type);
  } catch { /* database non initialisée */ }

  if (entry?._has_illustration && entry.id) {
    return <Illustration id={entry.id} fit="contain" className={className} />;
  }

  const emoji = entry?.icon ?? fallback;
  if (!emoji) return null;
  return (
    <span className={`inline-flex flex-shrink-0 items-center justify-center leading-none ${className}`}>{emoji}</span>
  );
}
