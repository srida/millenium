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
import * as MagieDatabase from './MagieDatabase.js';
import * as BoardDatabase from './BoardDatabase.js';
import { attributeName } from '../components/ui/AttrIcon.js';
import type { BonusSourceEntry } from '../logic/types.js';

export function cardName(id: string): string {
  try {
    return (getCard as (i: string) => { name?: string } | null)(id)?.name ?? id;
  } catch {
    return id;
  }
}

export { attributeName };

/**
 * Le nom derrière l'id d'un REGISTRE DE PROVENANCE — celui de la pioche
 * (`DrawSourceEntry`) comme celui du multiplicateur (`BonusSourceEntry`).
 *
 * ⚠️ Un seul résolveur pour les deux registres : ils portent la même forme et
 * posent la même question (« d'où sort ce bonus ? »), et la popup de pioche
 * s'en était écrit une copie privée. Chaque lecture est gardée — les databases
 * JETTENT tant qu'elles ne sont pas initialisées, et un id disparu du catalogue
 * s'affiche par son id plutôt que de vider la ligne.
 */
export function bonusSourceName(kind: BonusSourceEntry['kind'], ref: string): string {
  try {
    if (kind === 'attribut') return attributeName(ref);
    if (kind === 'terrain') return (BoardDatabase as { getBoard: (id: string) => { name?: string } | null }).getBoard(ref)?.name ?? ref;
    const magies = (MagieDatabase as { getAllMagies: () => { id: string; name?: string }[] }).getAllMagies();
    return magies.find(m => m.id === ref)?.name ?? ref;
  } catch {
    return ref;
  }
}

/** Le couple à passer à `effectLabel` — un seul objet, un seul point de vérité. */
export const GAME_NAMES = { attribute: attributeName, card: cardName };
