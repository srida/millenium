// De quoi NOMMER ce que `logic/` ne désigne que par un id.
//
// ⚠️ `logic/` n'importe pas `data/` : ses libellés (`MagieEffect.effectLabel`,
// `DrawInfo.guaranteedDrawLabel`) rendent donc des ids bruts tant que personne
// ne leur passe de résolveur — et c'est ainsi que la Phase Shopping a fini par
// afficher « Pioche garantie ARCH_047 ce tour ». Ce module est le résolveur, et
// tout écran de jeu doit le passer.
//
// Les deux fonctions ne jettent JAMAIS : les databases sont initialisées par
// `initGameData`, mais les bancs de dev (TestBench, CombatLab) fabriquent leurs
// cartes et `getCard`/`getAttribute` y jettent. L'id brut vaut mieux qu'un écran
// blanc — même filet que `AttrIcon`.
import { getCard } from './CardDatabase.js';
import { attributeName } from '../components/ui/AttrIcon.js';

export function cardName(id: string): string {
  try {
    return (getCard as (i: string) => { name?: string } | null)(id)?.name ?? id;
  } catch {
    return id;
  }
}

export { attributeName };

/** Le couple à passer à `effectLabel` — un seul objet, un seul point de vérité. */
export const GAME_NAMES = { attribute: attributeName, card: cardName };
