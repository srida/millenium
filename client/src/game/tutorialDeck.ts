// Decks de la partie d'entraînement — dérivés du catalogue, jamais écrits en dur.
//
// Un tutoriel qui nommerait ses cartes se casserait à la première retouche de
// `cards.json` depuis l'admin, et personne ne s'en apercevrait avant qu'un
// joueur tombe sur une main injouable. On sélectionne donc par RÈGLE, et un
// golden test vérifie que la règle rend encore un deck cohérent.
//
// La contrainte qui commande tout le reste : le catalogue ne contient presque
// aucune carte d'invocation NORMALE au-delà du tier 2 (5 en tier 3, 1 en tier 4,
// 1 en tier 5). Les hauts tiers sont faits pour être invoqués avec des
// matériaux — c'est le jeu. On construit donc le deck en deux temps :
//
//   1. tiers 1 et 2 : des cartes normales, le socle qu'on pose sans rien payer ;
//   2. tiers 3 à 5 : uniquement des cartes dont les matériaux sont DÉJÀ dans le
//      deck. Sans ce filtre, la main des derniers tours se remplirait de cartes
//      définitivement injouables.
//
// Module pur : il prend le catalogue en argument et ne connaît ni les
// databases, ni les stores. C'est ce qui le rend testable en node.
import type { Card, SummonCost } from '../logic/types.js';

export type DeckIds = Record<string, string[]>;

/** `_starter` est calculé par le serveur sur `/api/cards` (jamais persisté). */
type CatalogCard = Card & { _starter?: boolean };

/** Repli historique quand aucun pack n'est marqué « départ » — même règle que collectionStore. */
const STARTER_PREFIX = 'CORE';

/** Ce que le joueur emporte, par tier. Assez pour tenir les 5 tours sans main vide. */
const PLAYER_PER_TIER: Record<number, number> = { 1: 8, 2: 6, 3: 4, 4: 2, 5: 2 };
/** L'adversaire est volontairement plus maigre : le tutoriel doit se gagner. */
const ENEMY_PER_TIER: Record<number, number> = { 1: 4, 2: 3, 3: 2, 4: 1, 5: 1 };

/** Les deux tiers qui se posent sans matériau — le socle de n'importe quel deck. */
const BASE_TIERS = [1, 2];
const HIGH_TIERS = [3, 4, 5];

function isNormal(c: Card): boolean {
  return (c.summon_type ?? 'normal') === 'normal';
}

/**
 * Puissance brute, pour départager les candidats. L'ATK pèse lourd devant les
 * PV : ce sont les survivants et leur ATK qui infligent les dégâts de fin de
 * combat, donc qui gagnent la partie. Un mur à 1 ATK et 1000 PV ne tue rien et
 * ne meurt pas — il ferait un mauvais allié, et un pire adversaire (le combat
 * partirait au bout des 60 secondes, ce qui blesse les DEUX joueurs).
 */
function power(c: Card): number {
  return (c.stats?.atk ?? 0) * 20 + (c.stats?.hp ?? 0);
}

/** Tri stable : à catalogue égal, deck identique. */
function sortBy(cards: CatalogCard[], rank: (c: Card) => number): CatalogCard[] {
  return [...cards].sort((a, b) => (rank(a) - rank(b)) || a.id.localeCompare(b.id));
}

/**
 * La dotation d'un compte neuf, quand elle est identifiable : le joueur doit
 * reconnaître dans le tutoriel les cartes qu'il possède déjà.
 */
function starterPool(cards: CatalogCard[]): CatalogCard[] {
  const designed = cards.filter(c => c._starter);
  if (designed.length) return designed;
  const prefixed = cards.filter(c => String(c.id).toUpperCase().startsWith(STARTER_PREFIX));
  return prefixed.length ? prefixed : cards;
}

/** Toutes les recettes d'une carte : ses alternatives, ou son coût unique. */
function costsOf(card: Card): (SummonCost | undefined)[] {
  return card.summon_options?.length ? card.summon_options.map(o => o.cost) : [card.cost];
}

/**
 * La carte est invocable avec ce que le deck contient déjà. Un matériau est
 * désigné soit par id de carte, soit par attribut (`ARCH_*`) — auquel cas
 * n'importe quel porteur convient. Il suffit qu'UNE recette soit satisfaite.
 */
function summonableFrom(card: Card, ids: Set<string>, attrs: Set<string>): boolean {
  return costsOf(card).some(cost =>
    (cost?.materials ?? []).every(m => ids.has(m) || attrs.has(m)));
}

/** Accumulateur de ce que le deck « couvre » : ses cartes et leurs attributs. */
function collector() {
  const ids = new Set<string>();
  const attrs = new Set<string>();
  return {
    ids,
    attrs,
    take(card: Card) {
      ids.add(card.id);
      for (const a of card.attributes ?? []) attrs.add(a);
    },
  };
}

function buildDeck(
  pool: CatalogCard[],
  all: CatalogCard[],
  perTier: Record<number, number>,
  rank: (c: Card) => number,
): DeckIds {
  const deck: DeckIds = {};
  const owned = collector();

  const commit = (tier: number, cards: CatalogCard[]) => {
    deck[String(tier)] = cards.map(c => c.id);
    for (const c of cards) owned.take(c);
  };

  // 1. Le socle : des cartes normales, en préférant la dotation de départ pour
  //    que le joueur reconnaisse sa collection. Repli sur le catalogue entier
  //    si le pool de départ ne suffit pas.
  for (const t of BASE_TIERS) {
    const count = perTier[t] ?? 0;
    const preferred = sortBy(pool.filter(c => c.tier === t && isNormal(c)), rank);
    const rest = sortBy(all.filter(c => c.tier === t && isNormal(c)), rank);
    const picked: CatalogCard[] = [];
    const seen = new Set<string>();
    for (const c of [...preferred, ...rest]) {
      if (picked.length >= count) break;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      picked.push(c);
    }
    commit(t, picked);
  }

  // 2. Les hauts tiers : seulement ce que le socle permet réellement d'invoquer.
  //    Les cartes retenues alimentent à leur tour la couverture, de sorte
  //    qu'une fusion de tier 3 peut servir de matériau à un tier 4.
  for (const t of HIGH_TIERS) {
    const count = perTier[t] ?? 0;
    const candidates = all.filter(c => c.tier === t && summonableFrom(c, owned.ids, owned.attrs));
    commit(t, sortBy(candidates, rank).slice(0, count));
  }

  return deck;
}

/**
 * Les deux decks de la partie d'entraînement.
 *
 * Joueur : les cartes les plus solides ; IA : les plus faibles, et moins
 * nombreuses. Le tutoriel enseigne la boucle, il doit se gagner.
 */
export function buildTutorialDecks(cards: CatalogCard[]): { player: DeckIds; enemy: DeckIds } {
  const all = cards ?? [];
  const pool = starterPool(all);
  return {
    // `rank` est croissant : on inverse la puissance pour prendre les meilleures.
    player: buildDeck(pool, all, PLAYER_PER_TIER, c => -power(c)),
    enemy: buildDeck(pool, all, ENEMY_PER_TIER, c => power(c)),
  };
}
