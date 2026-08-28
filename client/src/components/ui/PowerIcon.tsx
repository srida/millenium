// Le pictogramme d'un pouvoir : son IMAGE si elle a été importée depuis
// l'admin, son EMOJI sinon. Même règle que AttrIcon.tsx — c'est ce mécanisme,
// éprouvé sur les attributs, qui est repris ici à l'identique.
//
// L'art vit dans le dossier des illustrations, sous l'id du pouvoir : même
// espace de noms plat que les cartes, attributs, terrains, magies et variantes.
import { getPower } from '../../data/PowerDatabase.js';
import { Illustration } from './primitives.js';

export default function PowerIcon({ id, fallback, className = '' }: {
  id: string;
  /** Emoji de secours quand la database n'est pas joignable (snapshot de jeu). */
  fallback?: string;
  /** Porte la taille de BOÎTE (image) *et* la taille de POLICE (emoji). */
  className?: string;
}) {
  // `getPower` JETTE tant que la database n'est pas initialisée — même
  // précaution qu'AttrIcon pour TestBench/CombatLab.
  let power: { icon?: string; _has_illustration?: boolean } | null = null;
  try {
    power = (getPower as (id: string) => typeof power)(id);
  } catch { /* database non initialisée */ }

  if (power?._has_illustration) {
    return <Illustration id={id} fit="contain" className={className} />;
  }

  const emoji = power?.icon ?? fallback;
  if (!emoji) return null;
  return (
    <span className={`inline-flex flex-shrink-0 items-center justify-center leading-none ${className}`}>{emoji}</span>
  );
}
