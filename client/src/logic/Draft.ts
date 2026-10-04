// Mode DRAFT : le deck se construit PENDANT la run, une carte parmi trois à
// chaque étape, puis il affronte une échelle d'adversaires qui ont drafté avec
// les mêmes règles. Pur et headless : aucun import data, React ou store — le
// catalogue est passé en argument, comme partout dans `logic/`.
//
// Trois règles portent tout le reste (cf. docs/draft.md) :
//
//   1. AUCUN TIRAGE N'EST DESSINÉ À LA MAIN. Une offre se tire uniformément
//      dans le catalogue, filtrée par le tier de l'étape. La SEULE intelligence
//      est la couverture des recettes (`logic/DeckCoverage`) : elle dit quelle
//      carte est jouable avec ce qui est déjà pris, et c'est elle qui donne aux
//      trois emplacements leur rôle (compléter, jouer sûr, parier).
//   2. L'OFFRE EST UNE FONCTION DE L'ÉTAT. Elle se dérive de (graine, nombre de
//      choix, relances dépensées) : recharger la page rend la même offre, il
//      n'y a donc rien à « reroller » en fermant l'onglet.
//   3. TOUT LE MONDE DRAFTE. Les adversaires construisent leur deck avec la même
//      fonction d'offre, en prenant à chaque étape la carte la plus forte
//      qu'ils savent jouer. Aucun deck adverse n'est à écrire en admin.
import { makeRandom, hashSeed } from './Random.js';
import { hasTier } from './Tiers.js';
import { isSummonable, coverageOf, missingMaterials, fillsMissing } from './DeckCoverage.js';
import type { Card } from './types.js';

// --- Barème ---

/** Le tier de chaque étape, dans l'ordre : on monte, pour que les cartes de
 *  bas tier déjà prises disent quelles fusions deviennent jouables. 15 cartes.
 *  ⚠️ JUMEAU de `draft.js` (racine), comme les quatre constantes qui suivent :
 *  le serveur valide les choix et compte les défaites. */
export const DRAFT_SCHEDULE: readonly number[] = Object.freeze([
  1, 1, 1, 1, 1,
  2, 2, 2, 2,
  3, 3, 3,
  4, 4,
  5,
]);

export const OFFER_SIZE = 3;
/** Relances de l'offre, pour tout le draft. Le levier « chance » du joueur. */
export const DRAFT_REROLLS = 2;
/** La run s'arrête à la 5ᵉ victoire ou à la 2ᵉ défaite… */
export const RUN_WINS = 5;
export const RUN_LOSSES = 2;
/** …sauf vie rachetée en gemmes (une par run, prix fixé par le serveur). */
export const EXTRA_LIVES = 1;

/** Handicap plat de l'IA selon le nombre de victoires déjà acquises : le même
 *  primitif que l'Arcade (`enemyBonus`), plus doux puisque l'adversaire a lui
 *  aussi un deck drafté. */
export const LADDER_BONUS: readonly { atk: number; hp: number }[] = Object.freeze([
  { atk: 0, hp: 0 },
  { atk: 1, hp: 5 },
  { atk: 2, hp: 10 },
  { atk: 3, hp: 20 },
  { atk: 4, hp: 30 },
]);

// --- État ---

export type DraftStatus = 'drafting' | 'playing' | 'won' | 'lost';

/** La run telle que le serveur la tient (`draft.js`) — le client n'en garde
 *  aucune copie à lui. */
export interface DraftState {
  seed: number;
  /** Cartes prises, dans l'ordre des étapes : la lane de la i-ème est
   *  `DRAFT_SCHEDULE[i]`. */
  picks: string[];
  /** Relances dépensées. */
  rerolls: number;
  wins: number;
  losses: number;
  /** Vie rachetée : la run tolère une défaite de plus. */
  extra_life: boolean;
  status: DraftStatus;
}

/** Le rôle d'un emplacement d'offre — ce que l'écran annonce. */
export type OfferKind = 'complement' | 'buildable' | 'bet';

export interface OfferSlot {
  card: Card;
  kind: OfferKind;
}

export function newDraft(seed: number): DraftState {
  return { seed: seed >>> 0, picks: [], rerolls: 0, wins: 0, losses: 0, extra_life: false, status: 'drafting' };
}

/** Tier de l'étape en cours, ou `null` une fois le deck complet. */
export function currentTier(state: DraftState): number | null {
  return DRAFT_SCHEDULE[state.picks.length] ?? null;
}

/** Le deck tel que `buildSession` l'attend : `{ "1": [...], …, "5": [...] }`. */
export function deckOf(state: Pick<DraftState, 'picks'>): Record<string, string[]> {
  const deck: Record<string, string[]> = { '1': [], '2': [], '3': [], '4': [], '5': [] };
  state.picks.forEach((id, i) => {
    const t = DRAFT_SCHEDULE[i];
    if (t) deck[String(t)].push(id);
  });
  return deck;
}

// --- Offre ---

function cardsOf(ids: readonly string[], byId: ReadonlyMap<string, Card>): Card[] {
  const out: Card[] = [];
  for (const id of ids) { const c = byId.get(id); if (c) out.push(c); }
  return out;
}

function indexOf(pool: readonly Card[]): Map<string, Card> {
  return new Map(pool.map(c => [c.id, c]));
}

/** Tire une carte d'une liste sans la remettre. Un seul appel à `rand`, et
 *  aucun sur une liste vide. */
function draw(list: Card[], rand: () => number): Card | null {
  if (list.length === 0) return null;
  return list.splice(Math.floor(rand() * list.length), 1)[0];
}

/**
 * L'offre d'une étape. Trois emplacements, trois rôles :
 *
 *   - **complément** : une carte jouable qui comble un matériel qu'attend une
 *     carte déjà prise (à défaut, une carte jouable) ;
 *   - **sûr** : une carte jouable avec ce que le deck contient ;
 *   - **pari** : une carte dont les matériaux manquent encore (à défaut, une
 *     carte jouable). C'est la carte qu'on prend en espérant que la suite du
 *     draft apporte ce qu'il lui faut — et c'est ce que l'emplacement
 *     « complément » viendra ensuite chercher.
 *
 * Chaque emplacement retombe sur tout ce qui reste quand son rôle n'a plus de
 * candidat : une offre plus courte que trois n'arrive que sur un catalogue
 * presque vide.
 */
export function offerFor(
  state: Pick<DraftState, 'seed' | 'picks' | 'rerolls'>,
  pool: readonly Card[],
  rerolls: number = state.rerolls,
): OfferSlot[] {
  const tier = DRAFT_SCHEDULE[state.picks.length];
  if (!tier) return [];
  const byId = indexOf(pool);
  const taken = new Set(state.picks);
  const picked = cardsOf(state.picks, byId);
  const cov = coverageOf(picked);
  const missing = missingMaterials(picked, cov);

  // Ordre du catalogue normalisé par id : la même graine doit rendre la même
  // offre quel que soit l'ordre dans lequel le serveur a servi les cartes.
  const eligible = pool
    .filter(c => !taken.has(c.id) && hasTier(c, tier))
    .sort((a, b) => a.id.localeCompare(b.id));
  const buildable = eligible.filter(c => isSummonable(c, cov.ids, cov.attrs));
  const complement = buildable.filter(c => fillsMissing(c, missing));
  const bets = eligible.filter(c => !isSummonable(c, cov.ids, cov.attrs));

  const rand = makeRandom(hashSeed(state.seed, 'offer', state.picks.length, rerolls));
  const out: OfferSlot[] = [];
  const used = new Set<string>();
  const fresh = (list: Card[]) => list.filter(c => !used.has(c.id));
  const plan: [OfferKind, Card[]][] = [
    ['complement', complement],
    ['buildable', buildable],
    ['bet', bets],
  ];
  for (const [kind, list] of plan) {
    let card = draw(fresh(list), rand);
    let actual: OfferKind = kind;
    if (!card) {
      card = draw(fresh(buildable), rand) ?? draw(fresh(eligible), rand);
      if (!card) continue;
      actual = isSummonable(card, cov.ids, cov.attrs) ? 'buildable' : 'bet';
    }
    // Un complément tiré parmi les jouables reste un complément ; une carte
    // « sûre » qui se trouve combler un manque se dit aussi complément.
    if (actual === 'buildable' && fillsMissing(card, missing)) actual = 'complement';
    used.add(card.id);
    out.push({ card, kind: actual });
  }
  return out;
}

// --- Actions (pures : rendent un nouvel état, ou `null` si refusé) ---

export function pickCard(state: DraftState, cardId: string, pool: readonly Card[]): DraftState | null {
  if (state.status !== 'drafting') return null;
  const offer = offerFor(state, pool);
  if (!offer.some(s => s.card.id === cardId)) return null;
  const picks = [...state.picks, cardId];
  return { ...state, picks, status: picks.length >= DRAFT_SCHEDULE.length ? 'playing' : 'drafting' };
}

export function canReroll(state: DraftState): boolean {
  return state.status === 'drafting' && state.rerolls < DRAFT_REROLLS;
}

export function reroll(state: DraftState): DraftState | null {
  return canReroll(state) ? { ...state, rerolls: state.rerolls + 1 } : null;
}

/** Défaites tolérées avant que la run ne s'arrête. */
export function maxLosses(state: Pick<DraftState, 'extra_life'>): number {
  return RUN_LOSSES + (state.extra_life ? EXTRA_LIVES : 0);
}

/** Solde un duel — le même verdict que `draft.reportDuel`, utile à l'IA des
 *  tests et à la simulation. Une égalité ne se rapporte pas. */
export function recordResult(state: DraftState, result: 'win' | 'loss'): DraftState | null {
  if (state.status !== 'playing') return null;
  const wins = state.wins + (result === 'win' ? 1 : 0);
  const losses = state.losses + (result === 'loss' ? 1 : 0);
  const status: DraftStatus = wins >= RUN_WINS ? 'won' : losses >= maxLosses(state) ? 'lost' : 'playing';
  return { ...state, wins, losses, status };
}

// --- Adversaires ---

/** Puissance brute : l'ATK pèse 20 fois les PV, comme partout ailleurs
 *  (`sim/autoPlayer.materialCost`, `game/tutorialDeck`) — ce sont les
 *  survivants et leur ATK qui infligent les dégâts. */
export function cardPower(c: Card): number {
  return (c.stats?.atk ?? 0) * 20 + (c.stats?.hp ?? 0);
}

/**
 * Un draft complet joué par l'IA, avec la MÊME fonction d'offre : à chaque
 * étape elle prend la carte jouable la plus forte, un pari seulement quand
 * l'offre ne propose rien d'autre. Elle ne relance jamais.
 */
export function autoDraft(seed: number, pool: readonly Card[]): Record<string, string[]> {
  let state: DraftState = newDraft(seed);
  while (state.status === 'drafting') {
    const offer = offerFor(state, pool);
    if (offer.length === 0) break;
    const ranked = [...offer].sort((a, b) =>
      (Number(a.kind === 'bet') - Number(b.kind === 'bet'))
      || (cardPower(b.card) - cardPower(a.card))
      || a.card.id.localeCompare(b.card.id));
    const next = pickCard(state, ranked[0].card.id, pool);
    if (!next) break;
    state = next;
  }
  return deckOf(state);
}

export interface DraftOpponent {
  /** Index du duel dans la run (victoires + défaites). */
  index: number;
  deck: Record<string, string[]>;
  bonus: { atk: number; hp: number };
  /** Sa carte la plus forte : elle lui sert de visage. */
  faceCardId: string | null;
}

/** L'adversaire du duel en cours, ou `null` hors phase de duels. Déterministe
 *  à (graine, index) : un rechargement retombe sur le même adversaire. */
export function currentOpponent(state: DraftState, pool: readonly Card[]): DraftOpponent | null {
  if (state.status !== 'playing') return null;
  const index = state.wins + state.losses;
  const deck = autoDraft(hashSeed(state.seed, 'enemy', index), pool);
  const byId = indexOf(pool);
  const cards = cardsOf(Object.values(deck).flat(), byId);
  const face = [...cards].sort((a, b) => (cardPower(b) - cardPower(a)) || a.id.localeCompare(b.id))[0] ?? null;
  const bonus = LADDER_BONUS[Math.min(state.wins, LADDER_BONUS.length - 1)];
  return { index, deck, bonus: { ...bonus }, faceCardId: face?.id ?? null };
}

/**
 * Le catalogue du draft : les cartes qui ont leur illustration (même règle que
 * la boutique — une carte sans art ne se propose pas). Si l'art manque au
 * point qu'un tier ne puisse plus remplir ses étapes (installation de dév sans
 * `resources/`), on retombe sur tout le catalogue plutôt que d'offrir un draft
 * impossible.
 */
export function draftPool(cards: readonly Card[]): Card[] {
  const withArt = cards.filter(c => c._has_illustration);
  const need: Record<number, number> = {};
  for (const t of DRAFT_SCHEDULE) need[t] = (need[t] ?? 0) + 1;
  const enough = Object.entries(need).every(([t, n]) =>
    withArt.filter(c => hasTier(c, Number(t))).length >= n + OFFER_SIZE);
  return enough ? withArt : [...cards];
}
