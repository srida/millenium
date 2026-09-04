// Génération de decks pour la simulation.
//
// ⚠️ La contrainte qui commande tout ce fichier : au-delà du tier 2, le
// catalogue n'a presque aucune invocation NORMALE. Un deck tiré au hasard sans
// précaution embarque des fusions dont les matériaux sont absents — mesuré sur
// ce dépôt : 130 cartes sur 653 ne sont JAMAIS posées sur 1000 parties, et les
// 130 sont des invocations spéciales. Elles ressortiraient du rapport comme
// « faibles » alors qu'elles n'ont simplement jamais été jouées.
//
// D'où la couverture accumulée tier par tier — même règle que
// `scripts/build-bot-decks.js` et `game/tutorialDeck.ts` : une carte de haut
// tier n'entre que si le deck couvre déjà ses matériaux (ids ET attributs), et
// une fusion retenue au tier 3 alimente à son tour la couverture du tier 4.
import { isAttributeMaterial } from '../logic/InvocationManager.js';
import type { Card, SummonCondition } from '../logic/types.js';

export type Deck = Record<string, string[]>;

/** Le plafond du DeckBuilder : `min(8, pool_size)` cartes par tier. */
export const PER_TIER = 8;

/** Les conditions d'une carte ; une liste vide = aucune exigence. */
function conditionsOf(card: Card): SummonCondition[] {
  return card.summon_conditions ?? [];
}

/** Les matériels NOMMÉS d'une condition — les seuls qu'une couverture puisse
 *  garantir ; un coût purement chiffré se paie avec n'importe quoi. */
function requiresOf(condition: SummonCondition | undefined): string[] {
  return condition?.requires ?? [];
}

/** Une condition suffit. Un matériau `ARCH_*` désigne n'importe quel porteur de
 *  l'attribut, pas une carte — d'où les deux couvertures. */
export function isSummonable(card: Card, ids: Set<string>, attrs: Set<string>): boolean {
  const conditions = conditionsOf(card);
  if (conditions.length === 0) return true;
  return conditions.some(cd =>
    requiresOf(cd).every(m => (isAttributeMaterial(m) ? attrs.has(m) : ids.has(m))));
}

/** Tirage sans remise de `count` éléments. */
function sample<T>(pool: T[], count: number, rand: () => number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  while (out.length < count && copy.length > 0) {
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  }
  return out;
}

/** Posable sans rien consommer : une carte sans condition, ou dont une
 *  condition ne coûte aucun matériel. C'était « summon_type === normal ». */
const isNormal = (c: Card) =>
  conditionsOf(c).length === 0 || conditionsOf(c).some(cd => (cd.materials ?? 0) === 0);

/**
 * Un deck aléatoire mais JOUABLE : socle de cartes posables aux tiers 1-2, puis
 * hauts tiers filtrés par la couverture accumulée.
 *
 * @param pool cartes candidates (le catalogue, ou un sous-ensemble)
 * @param seed cartes imposées, placées avant le tirage (protocole A/B)
 */
export function buildDeck(pool: Card[], rand: () => number, seed: Card[] = []): Deck {
  const deck: Deck = { '1': [], '2': [], '3': [], '4': [], '5': [] };
  const ids = new Set<string>();
  const attrs = new Set<string>();
  const used = new Set<string>();

  const take = (c: Card) => {
    const t = String(c.tier);
    if (!deck[t] || deck[t].length >= PER_TIER || used.has(c.id)) return false;
    deck[t].push(c.id);
    used.add(c.id);
    ids.add(c.id);
    for (const a of c.attributes ?? []) attrs.add(a);
    return true;
  };

  // Les cartes imposées d'abord : un A/B doit pouvoir garantir la présence de
  // la carte testée, quel que soit le tirage.
  for (const c of seed) take(c);

  // Un seul critère pour les cinq tiers : « le deck peut-il déjà l'invoquer ? ».
  // `isSummonable` est vrai sans condition pour une carte sans matériau
  // (normale, sacrifice pur), et exige la couverture pour les autres — au tier
  // 1 la couverture est vide, seules les cartes libres passent, ce qui donne le
  // socle sans avoir à l'énoncer comme une règle à part.
  //
  // ⚠️ L'ORDRE des tiers est la règle : une fusion retenue au tier 3 élargit la
  // couverture du tier 4. Et on repasse plusieurs fois sur un même tier, sans
  // quoi une carte dont le matériau est du MÊME tier ne pourrait jamais entrer.
  for (const t of [1, 2, 3, 4, 5]) {
    const key = String(t);
    for (let pass = 0; pass < 3 && deck[key].length < PER_TIER; pass++) {
      const ok = pool.filter(c => c.tier === t && !used.has(c.id) && isSummonable(c, ids, attrs));
      if (ok.length === 0) break;
      const before = deck[key].length;
      for (const c of sample(ok, PER_TIER - before, rand)) take(c);
      if (deck[key].length === before) break;
    }
  }

  return deck;
}

export function deckSize(deck: Deck): number {
  return Object.values(deck).reduce((s, ids) => s + ids.length, 0);
}

export function deckCardIds(deck: Deck): string[] {
  return Object.values(deck).flat();
}

/**
 * Variante d'un deck avec `card` imposée : elle prend la place d'une carte de
 * son tier, tirée au sort. Rend `null` quand la carte ne peut pas être rendue
 * invocable dans ce deck — le protocole A/B la déclare alors « non testable »
 * plutôt que de produire un chiffre qui ne mesurerait rien.
 */
export function deckWithCard(
  deck: Deck,
  card: Card,
  cardDb: { getCard(id: string): Card | null },
  rand: () => number,
): Deck | null {
  const t = String(card.tier);
  if (!deck[t]) return null;
  if (deck[t].includes(card.id)) return cloneDeck(deck);

  const ids = new Set(deckCardIds(deck));
  const attrs = new Set<string>();
  for (const id of ids) for (const a of cardDb.getCard(id)?.attributes ?? []) attrs.add(a);
  if (!isSummonable(card, ids, attrs)) return null;

  const out = cloneDeck(deck);
  const slots = out[t];
  if (slots.length === 0) { slots.push(card.id); return out; }

  // La carte évincée ne doit être le matériau de personne : la retirer
  // casserait la couverture d'une autre carte du deck, et l'écart mesuré ne
  // porterait alors plus seulement sur la carte testée.
  const needed = new Set<string>();
  for (const id of ids) {
    const c = cardDb.getCard(id);
    if (!c) continue;
    for (const cd of conditionsOf(c)) for (const m of requiresOf(cd)) needed.add(m);
  }
  const droppable = slots.filter(id => !needed.has(id));
  if (droppable.length === 0) return null;
  const victim = droppable[Math.floor(rand() * droppable.length)];
  slots[slots.indexOf(victim)] = card.id;
  return out;
}

/** Le même deck sans `card` — le témoin de l'A/B. Rend `null` si elle n'y est pas. */
export function deckWithoutCard(deck: Deck, cardId: string): Deck | null {
  if (!deckCardIds(deck).includes(cardId)) return null;
  const out = cloneDeck(deck);
  for (const t of Object.keys(out)) out[t] = out[t].filter(id => id !== cardId);
  return out;
}

function cloneDeck(deck: Deck): Deck {
  const out: Deck = {};
  for (const [t, ids] of Object.entries(deck)) out[t] = [...ids];
  return out;
}

/**
 * Les cartes à embarquer pour rendre `card` invocable : ses matériaux, et les
 * matériaux de ses matériaux. Un matériau `ARCH_*` désigne un attribut, pas une
 * carte — on lui choisit le porteur le plus bas en tier et posable sans rien
 * (le moins susceptible d'ouvrir une nouvelle dépendance).
 *
 * Glouton, sans retour arrière : la première recette (la plus courte) est
 * tentée, et l'échec rend `null`. C'est assumé — l'appelant déclare alors la
 * carte « non testable en A/B », ce qui vaut mieux qu'un deck bricolé où
 * l'écart mesuré ne porterait plus sur la carte.
 */
export function materialClosure(
  card: Card,
  pool: Card[],
  cardDb: { getCard(id: string): Card | null },
): Card[] | null {
  const chosen = new Map<string, Card>();
  const attrs = new Set<string>();

  const adopt = (c: Card) => {
    chosen.set(c.id, c);
    for (const a of c.attributes ?? []) attrs.add(a);
  };

  const bearerOf = (attrId: string): Card | null =>
    pool
      .filter(c => (c.attributes ?? []).includes(attrId) && isNormal(c))
      .sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))[0] ?? null;

  const resolve = (c: Card, depth: number): boolean => {
    if (depth > 4) return false;
    const recipes = [...conditionsOf(c)].sort(
      (a, b) => requiresOf(a).length - requiresOf(b).length);
    const mats = requiresOf(recipes[0]);
    for (const m of mats) {
      if (isAttributeMaterial(m)) {
        if (attrs.has(m)) continue;
        const bearer = bearerOf(m);
        if (!bearer) return false;
        adopt(bearer);
      } else {
        if (chosen.has(m)) continue;
        const mc = cardDb.getCard(m);
        if (!mc) return false;
        adopt(mc);
        if (!resolve(mc, depth + 1)) return false;
      }
    }
    return true;
  };

  if (!resolve(card, 0)) return null;
  chosen.delete(card.id);
  return [...chosen.values()];
}
