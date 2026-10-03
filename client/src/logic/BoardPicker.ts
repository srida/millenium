// Le tirage du terrain de combat : lequel a une chance de PESER sur ce duel-là
// (pertinence vis-à-vis des deux decks), et lequel n'est pas déjà tombé
// (non-répétition).
//
// ⚠️ Module PLAT à dessein — des types, et `boardEffects` pour ne pas se donner
// une seconde lecture de la donnée (cf. `BoardEffect`, qui n'importe lui-même
// que des types). La pertinence est une question sur un ÉTAT, pas sur une
// session : la poser ici la rend testable sans instancier une partie, ce qui
// compte dans une suite vitest qui tourne en node sans DOM. C'est
// `GameSession._boardPickContext()` qui traduit son état en `BoardPickContext`,
// et le deck du joueur ne sort JAMAIS de la session — seule une liste d'ids
// d'attributs en sort.
import { boardEffects } from './BoardEffect.js';
import type { BoardDef, Card } from './types.js';

/** Un attribut doit porter au moins 2 cartes du deck pour l'identifier.
 *
 *  Même seuil et même geste que `data/DeckTags.computeDeckTags` (qui l'importe
 *  d'ici, pour qu'il n'existe qu'une fois côté client) : un attribut porté par
 *  une seule carte sur vingt est un accident de composition, pas une couleur de
 *  deck — et un terrain tiré pour lui n'aurait au mieux qu'une unité à toucher,
 *  si tant est qu'elle soit piochée puis posée. */
export const MIN_ATTRIBUTE_OCCURRENCES = 2;

/** Combien de cartes du deck portent chaque attribut. */
export type AttributeCounts = Record<string, number>;

export interface BoardPickContext {
  /** Attributs qui IDENTIFIENT le deck du joueur (seuil déjà appliqué). */
  playerAttributes: readonly string[];
  /** Idem côté adverse. ⚠️ En PvP, dérivé par le SERVEUR du deck book de
   *  l'adversaire — jamais de `deps.enemyDeck`, qui y est le miroir du deck du
   *  joueur (cf. `GameSession.setEnemyDeckAttributeCounts`). */
  enemyAttributes: readonly string[];
  /** Terrains déjà JOUÉS dans ce duel. */
  usedBoardIds: ReadonlySet<string>;
}

/**
 * Compte les attributs d'une liste de cartes.
 *
 * ⚠️ On compte les ENTRÉES du deck, doublons compris, et jamais les ids
 * distincts : le serveur (`decks.deckAttributeCounts`) compte de la même façon,
 * et les deux doivent dire la même chose du même deck.
 */
export function attributeCounts(cards: readonly (Card | null | undefined)[]): AttributeCounts {
  const counts: AttributeCounts = {};
  for (const card of cards) {
    for (const id of card?.attributes ?? []) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/**
 * Les attributs au-dessus du seuil, TRIÉS.
 *
 * ⚠️ C'est le SEUL endroit du client où `MIN_ATTRIBUTE_OCCURRENCES` s'applique,
 * et c'est délibéré : le serveur envoie des COMPTES, pas une liste déjà filtrée.
 * Renvoyer la liste seuillée mettrait le seuil des deux côtés du fil, à tenir
 * synchronisé à la main — le piège de `XP_PER_LEVEL`, la seule valeur du projet
 * dans ce cas, et une de trop.
 *
 * Le tri rend une valeur ABSOLUE : elle ne dépend ni de l'ordre des cartes, ni
 * de l'ordre des clés de l'objet reçu du réseau.
 */
export function dominantAttributes(counts: AttributeCounts): string[] {
  return Object.entries(counts)
    .filter(([, n]) => n >= MIN_ATTRIBUTE_OCCURRENCES)
    .map(([id]) => id)
    .sort();
}

/** Raccourci : les attributs qui identifient un deck, depuis ses cartes. */
export function deckAttributes(cards: readonly (Card | null | undefined)[]): string[] {
  return dominantAttributes(attributeCounts(cards));
}

/**
 * Ce terrain a-t-il une chance de changer quelque chose pour l'un des deux camps ?
 *
 * ⚠️ Le prédicat est le MIROIR de la ligne de ciblage de
 * `BoardEffect.applyEffect` : `target_attributes` vide ou absent y vise TOUTES
 * les unités des deux côtés, le terrain est donc pertinent pour tout le monde.
 * Si le ciblage change là-bas, il change ici.
 *
 * ⚠️ La pertinence est une PRÉFÉRENCE, pas un filtre fermé — c'est ce qui
 * distingue ce module de `MagieOffer`, dont la table est fermée (`default:
 * false`). Un terrain jugé non pertinent reste tirable au deuxième échelon : un
 * oubli de règle ne peut donc pas faire DISPARAÎTRE un terrain du jeu, il peut
 * seulement le rendre moins probable. D'où un prédicat simple ici, là où les
 * magies exigeaient d'énumérer chaque type d'effet.
 *
 * ⚠️ Limite connue : `draw_bonus` IGNORE `target_attributes` dans
 * `applyEffect` (il crédite le joueur quoi qu'il arrive). Un terrain
 * `draw_bonus` dont personne ne porte le ciblage serait donc jugé non pertinent
 * alors qu'il agit. Aucun des 14 terrains livrés n'est dans ce cas ; le jour où
 * l'un le sera, c'est cette ligne qui bouge.
 *
 * ⚠️ UN SEUL effet pertinent suffit : un terrain qui cumule « +10 ATQ aux
 * Dragons » et « Bouclier +20 aux Fusions » pèse sur un duel dès que l'un des
 * deux porte. Exiger que tous portent le rendrait d'autant moins tirable qu'il
 * est riche.
 *
 * ⚠️ Le second ciblage (`target_summon_types`) a disparu : les voies
 * d'invocation sont devenues des attributs, donc un terrain qui vise « les
 * Fusions » le dit dans `target_attributes` et entre dans la pertinence comme
 * n'importe quel archétype — sans un second fait à faire voyager en PvP.
 * Contrepartie : ces attributs-là sont portés par presque tout deck, donc un
 * terrain qui ne vise qu'eux sera presque toujours jugé pertinent. La
 * pertinence n'étant qu'une préférence, ça ne peut rendre un terrain que PLUS
 * probable, jamais invisible.
 */
export function isBoardRelevant(board: BoardDef, ctx: BoardPickContext): boolean {
  return boardEffects(board).some(effect => {
    const targets = effect.target_attributes;
    if (!targets?.length) return true;
    return targets.some(a => ctx.playerAttributes.includes(a) || ctx.enemyAttributes.includes(a));
  });
}

/**
 * Le terrain du prochain combat. Trois échelons, dans cet ordre :
 *
 *   1. pertinent ET pas encore joué — le cas nominal ;
 *   2. pas encore joué — ⚠️ **LA NON-RÉPÉTITION L'EMPORTE.** Revoir un terrain
 *      déjà joué se remarque à tous les coups ; jouer un terrain qui ne touche
 *      personne ne se remarque pas. La pertinence est une préférence, la
 *      non-répétition est une règle ;
 *   3. tout le pool — filet seul : 14 terrains pour 5 combats au maximum
 *      (`MAX_ROUNDS`), l'échelon 2 ne peut pas se vider en jeu. Il existe pour
 *      un catalogue amputé en admin, pas pour un duel.
 *
 * ⚠️ EXACTEMENT UN appel à `rand`, quel que soit l'échelon atteint, et AUCUN sur
 * un pool vide. Ce n'est pas une micro-optimisation : c'est ce qui garde le flux
 * semé de la simulation EN PHASE. Un appel de plus (ou de moins) décalerait
 * toutes les pioches et tous les choix de l'IA qui suivent, et ferait bouger les
 * 23 goldens de déterminisme de `sim.test.ts` pour une raison qui n'a rien à
 * voir avec le terrain.
 */
export function pickBoard(
  pool: readonly (BoardDef | null | undefined)[],
  ctx: BoardPickContext,
  rand: () => number = Math.random,
): BoardDef | null {
  const all = pool.filter((b): b is BoardDef => !!b?.id);
  const unused = all.filter(b => !ctx.usedBoardIds.has(b.id));
  const relevant = unused.filter(b => isBoardRelevant(b, ctx));
  const candidates = relevant.length ? relevant : unused.length ? unused : all;
  if (!candidates.length) return null;
  return candidates[Math.floor(rand() * candidates.length)];
}
