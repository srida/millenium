// Le pictogramme d'un attribut : son IMAGE si elle a été importée depuis
// l'admin, son EMOJI sinon.
//
// La règle de repli n'existe qu'ici. Les quatre sites d'affichage (panneau de
// synergies, tooltip d'attribut, chips des tooltips carte/unité, codex du
// tutoriel) ne font que la rendre à leur taille — les laisser décider chacun
// produirait quatre replis divergents le jour où une icône manque.
//
// L'art vit dans le dossier des illustrations, sous l'id de l'attribut : même
// espace de noms plat que les cartes, les terrains, les magies et les variantes
// (cf. `variants.js`), donc aucune famille d'assets propre.
import { getAttribute } from '../../data/AttributeDatabase.js';
import { Illustration } from './primitives.js';

export default function AttrIcon({ id, fallback, className = '' }: {
  id: string;
  /** Emoji de secours quand la database n'est pas joignable (snapshot de jeu). */
  fallback?: string;
  /** Porte la taille de BOÎTE (image) *et* la taille de POLICE (emoji). */
  className?: string;
}) {
  // `getAttribute` JETTE tant que la database n'est pas initialisée — le cas se
  // présente sur les écrans à cartes fabriquées (TestBench, CombatLab). Même
  // précaution que `attributeName` dans TooltipHost, qui existe pour ça.
  let attr: { icon?: string; _has_illustration?: boolean } | null = null;
  try {
    attr = (getAttribute as (id: string) => typeof attr)(id);
  } catch { /* database non initialisée */ }

  if (attr?._has_illustration) {
    // object-CONTAIN, pas object-cover : une icône rognée perd sa silhouette,
    // qui est justement ce qui la distingue. C'est la seule différence de
    // traitement avec l'art des cartes, qui vit dans le même dossier.
    return <Illustration id={id} fit="contain" className={className} />;
  }

  const emoji = attr?.icon ?? fallback;
  if (!emoji) return null;
  return (
    <span className={`inline-flex flex-shrink-0 items-center justify-center leading-none ${className}`}>{emoji}</span>
  );
}
