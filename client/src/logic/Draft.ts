// Mode DRAFT : le deck se construit PENDANT la run, puis il affronte en ligne
// d'autres joueurs en draft (ou un bot au deck drafté avec les mêmes règles).
// Pur et headless : aucun import data, React ou store — le catalogue est passé
// en argument, comme partout dans `logic/`.
//
// Deux temps : trois LOTS de trois cartes liées par une recette (9 cartes,
// tiers mélangés), puis six choix d'UNE carte, au tier imposé par l'étape.
// Puis, après chaque duel qui ne clôt pas la run, une carte DE PLUS, tous
// tiers confondus.
//
// Trois règles portent tout le reste (cf. docs/draft.md) :
//
//   1. AUCUN TIRAGE N'EST DESSINÉ À LA MAIN. Une offre se tire uniformément
//      dans le catalogue. Un lot n'est pas composé en admin : c'est une carte
//      et les matériels que sa recette NOMME. La couverture des recettes
//      (`logic/DeckCoverage`) donne aux choix d'une carte leur rôle
//      (compléter, jouer sûr, parier).
//   2. L'OFFRE EST UNE FONCTION DE L'ÉTAT. Elle se dérive de (graine, nombre de
//      cartes prises, relances dépensées) : recharger la page rend la même
//      offre, il n'y a donc rien à « reroller » en fermant l'onglet.
//   3. TOUT LE MONDE DRAFTE. Les adversaires construisent leur deck avec la même
//      fonction d'offre. Aucun deck adverse n'est à écrire en admin.
import { makeRandom, hashSeed } from './Random.js';
import { hasTier, tiersOf } from './Tiers.js';
import { isSummonable, coverageOf, missingMaterials, fillsMissing } from './DeckCoverage.js';
import { isAttributeMaterial } from './InvocationManager.js';
import type { Card } from './types.js';

// --- Barème ---

/** Une étape du draft : `cards` cartes prises d'un coup. Sans `tier`, c'est un
 *  LOT lié (tiers mélangés) ; avec, un choix d'une carte de ce tier. */
export interface DraftStep {
  cards: number;
  tier?: number;
  /** La carte de plus d'entre deux duels : une carte, sans tier imposé. */
  bonus?: boolean;
}

/** Les étapes, dans l'ordre : trois lots de trois, puis six cartes en
 *  montant. Les deux choix de tier 1 garantissent de quoi jouer au tour 1
 *  (un lot n'en contient pas forcément).
 *  ⚠️ JUMEAU de `draft.js` (racine), comme les quatre constantes qui suivent :
 *  le serveur valide les choix et compte les défaites. */
export const DRAFT_STEPS: readonly DraftStep[] = Object.freeze([
  { cards: 3 }, { cards: 3 }, { cards: 3 },
  { cards: 1, tier: 1 }, { cards: 1, tier: 1 }, { cards: 1, tier: 2 },
  { cards: 1, tier: 3 }, { cards: 1, tier: 4 }, { cards: 1, tier: 5 },
].map(s => Object.freeze(s)));

/** Taille du deck drafté. */
export const DRAFT_SIZE = DRAFT_STEPS.reduce((n, s) => n + s.cards, 0);

/** La carte de plus, due après chaque duel qui ne clôt pas la run.
 *  ⚠️ JUMEAU de `draft.js` (`BONUS_STEP`). */
export const BONUS_STEP: DraftStep = Object.freeze({ cards: 1, bonus: true });

export const OFFER_SIZE = 3;
/** Relances de l'offre, pour tout le draft. Le levier « chance » du joueur. */
export const DRAFT_REROLLS = 2;
/** La run s'arrête à la 5ᵉ victoire ou à la 2ᵉ défaite… */
export const RUN_WINS = 5;
export const RUN_LOSSES = 2;
/** …sauf vie rachetée en gemmes (une par run, prix fixé par le serveur). */
export const EXTRA_LIVES = 1;

// --- État ---

export type DraftStatus = 'drafting' | 'playing' | 'won' | 'lost';

/** La run telle que le serveur la tient (`draft.js`) — le client n'en garde
 *  aucune copie à lui. */
export interface DraftState {
  seed: number;
  /** Cartes prises, à plat, dans l'ordre des étapes. */
  picks: string[];
  /** Relances dépensées. */
  rerolls: number;
  wins: number;
  losses: number;
  /** Vie rachetée : la run tolère une défaite de plus. */
  extra_life: boolean;
  status: DraftStatus;
  /** Cartes de plus prises avec un malus ou un bonus, par id (cf. `DraftMod`).
   *  Absent sur une run qui n'en a pris aucune. */
  mods?: Record<string, ModSign>;
  /** Cartes retirées du deck, une par étape de carte de plus, sous la clé de
   *  l'étape (`picks.length` au moment du retrait). Absent sans retrait. */
  removals?: Record<string, string>;
}

/** Le rôle d'un choix — ce que l'écran annonce. `link` n'existe qu'à la carte
 *  de plus : une carte qui a un vrai lien avec le deck. */
export type OfferKind = 'bundle' | 'complement' | 'buildable' | 'bet' | 'link';

// --- Malus et bonus de la carte de plus ---

/** Le lien se paie (malus), le pari se récompense (bonus). */
export type ModSign = 'malus' | 'bonus';
/** Sur les stats (ATQ et PV) ou sur le nombre de matériels de chaque recette. */
export type ModKind = 'stats' | 'materials';
export interface DraftMod { sign: ModSign; kind: ModKind }

/** Part d'ATQ et de PV retirée (malus) ou ajoutée (bonus). */
export const MOD_STAT_RATIO = 0.2;

/** ⚠️ JUMEAU de `draft.js` (`MOD_SIGNS`) : le serveur borne le signe reçu. */
export const MOD_SIGNS: readonly ModSign[] = Object.freeze(['malus', 'bonus']);

/** Le décalage de matériels a-t-il un sens sur cette carte ? Il faut une
 *  recette ; un bonus exige en plus qu'AUCUNE ne soit déjà gratuite (on ne
 *  descend pas sous zéro). */
function canShiftMaterials(card: Card, sign: ModSign): boolean {
  const cds = card.summon_conditions ?? [];
  return cds.length > 0 && (sign === 'malus' || cds.every(cd => (cd.materials ?? 0) >= 1));
}

/** Le modificateur d'une carte : son signe vient de son rôle dans l'offre, sa
 *  nature est tirée de (graine, carte) — donc la même à chaque lecture, sans
 *  rien d'autre à stocker que le signe. */
export function modFor(seed: number, card: Card, sign: ModSign): DraftMod {
  const materials = canShiftMaterials(card, sign) && makeRandom(hashSeed(seed, 'mod', card.id))() < 0.5;
  return { sign, kind: materials ? 'materials' : 'stats' };
}

/** La carte telle qu'elle se joue avec son modificateur — un objet NEUF, le
 *  catalogue n'est jamais touché. Matériels : ±1 sur chaque recette, les
 *  exigences nommées rognées pour tenir dans le nouveau compte (le geste de la
 *  magie `reduce_materials`). Stats : ATQ et PV à ±20 %, plancher à 1. */
export function applyMod(card: Card, mod: DraftMod): Card {
  const d = mod.sign === 'bonus' ? 1 : -1;
  if (mod.kind === 'materials') {
    return {
      ...card,
      summon_conditions: (card.summon_conditions ?? []).map(cd => {
        const materials = Math.max(0, (cd.materials ?? 0) - d);
        return { ...cd, materials, ...(cd.requires ? { requires: cd.requires.slice(0, materials) } : {}) };
      }),
    };
  }
  const scale = (v: number | undefined) => Math.max(1, Math.round((v ?? 0) * (1 + d * MOD_STAT_RATIO)));
  return { ...card, stats: { ...card.stats, atk: scale(card.stats?.atk), hp: scale(card.stats?.hp) } };
}

/** Ce que l'écran annonce, en mots. */
export function modLabel(mod: DraftMod): string {
  if (mod.kind === 'materials') return mod.sign === 'bonus' ? '1 matériel de moins' : '1 matériel de plus';
  const pct = Math.round(MOD_STAT_RATIO * 100);
  return mod.sign === 'bonus' ? `ATQ et PV +${pct}\u00a0%` : `ATQ et PV −${pct}\u00a0%`;
}

/** Les cartes modifiées d'une run, par id. Le deck engagé se joue avec elles. */
export function moddedCards(state: Pick<DraftState, 'seed' | 'mods'>, pool: readonly Card[]): Map<string, Card> {
  const out = new Map<string, Card>();
  const byId = indexOf(pool);
  for (const [id, sign] of Object.entries(state.mods ?? {})) {
    const c = byId.get(id);
    if (c && (sign === 'malus' || sign === 'bonus')) out.set(id, applyMod(c, modFor(state.seed, c, sign)));
  }
  return out;
}

/** Un choix de l'offre : une carte, ou un lot de trois. */
export interface OfferSlot {
  cards: Card[];
  kind: OfferKind;
  /** Lot seulement : ses cartes encore impayables avec le deck ET le lot —
   *  ce que les choix d'une carte devront venir compléter. */
  missing?: number;
  /** Carte de plus seulement : le malus du lien, le bonus du pari. */
  mod?: DraftMod;
}

export function newDraft(seed: number): DraftState {
  return { seed: seed >>> 0, picks: [], rerolls: 0, wins: 0, losses: 0, extra_life: false, status: 'drafting' };
}

/** L'étape en cours (et son rang), ou `null` une fois le deck complet. Se
 *  déduit du nombre de cartes prises : l'état n'a rien d'autre à porter. */
export function currentStep(state: Pick<DraftState, 'picks'>): { index: number; step: DraftStep } | null {
  let taken = 0;
  for (let index = 0; index < DRAFT_STEPS.length; index++) {
    if (state.picks.length === taken) return { index, step: DRAFT_STEPS[index] };
    taken += DRAFT_STEPS[index].cards;
  }
  return null;
}

/** L'étape d'un deck qui compte `picksCount` cartes : celle du draft, puis la
 *  carte de plus au-delà. Ne dit pas si elle est DUE (cf. `stepOf`). */
function stepAt(picksCount: number): { index: number; step: DraftStep } {
  let taken = 0;
  for (let index = 0; index < DRAFT_STEPS.length; index++) {
    if (picksCount === taken) return { index, step: DRAFT_STEPS[index] };
    taken += DRAFT_STEPS[index].cards;
  }
  return { index: DRAFT_STEPS.length + Math.max(0, picksCount - DRAFT_SIZE), step: BONUS_STEP };
}

/** Une carte de plus est-elle due ? Une par duel joué tant que la run
 *  continue — déduit des cartes prises et des duels, comme côté serveur.
 *  ⚠️ JUMEAU de `draft.js` (`pendingBonus`). */
export function pendingBonus(state: Pick<DraftState, 'status' | 'picks' | 'wins' | 'losses'>): boolean {
  return state.status === 'playing' && state.picks.length < DRAFT_SIZE + state.wins + state.losses;
}

/** L'étape à jouer maintenant : celle du draft, la carte de plus, ou `null`. */
export function stepOf(state: Pick<DraftState, 'status' | 'picks' | 'wins' | 'losses'>): { index: number; step: DraftStep } | null {
  if (state.status === 'drafting') return currentStep(state);
  return pendingBonus(state) ? stepAt(state.picks.length) : null;
}

/** Les cartes retirées du deck. `before` ne garde que les retraits des étapes
 *  PRÉCÉDANT ce nombre de cartes prises : l'offre de l'étape en cours se
 *  calcule sans son propre retrait, sinon retirer puis remettre une carte
 *  servirait de relance gratuite.
 *  ⚠️ JUMEAU de `draft.js` (`removedIds`). */
export function removedIds(state: Pick<DraftState, 'removals'>, before = Infinity): Set<string> {
  return new Set(Object.entries(state.removals ?? {}).filter(([k]) => Number(k) < before).map(([, id]) => id));
}

/** Le deck : tout ce qui a été pris, moins les retraits.
 *  ⚠️ JUMEAU de `draft.js` (`deckIds`). */
export function deckIds(state: Pick<DraftState, 'picks' | 'removals'>, before = Infinity): string[] {
  const removed = removedIds(state, before);
  return state.picks.filter(id => !removed.has(id));
}

/** Le retrait de l'étape en cours, s'il y en a un. */
export function currentRemoval(state: Pick<DraftState, 'picks' | 'removals'>): string | null {
  return state.removals?.[String(state.picks.length)] ?? null;
}

/** Retire une carte à l'étape de la carte de plus (`null` : annule) — le même
 *  verdict que `draft.remove`. Un second retrait remplace le premier. */
export function removeCard(state: DraftState, cardId: string | null): DraftState | null {
  if (!pendingBonus(state)) return null;
  const key = String(state.picks.length);
  const removals = { ...state.removals };
  delete removals[key];
  if (cardId != null) {
    if (!state.picks.includes(cardId) || Object.values(removals).includes(cardId)) return null;
    removals[key] = cardId;
  }
  const { removals: _old, ...rest } = state;
  void _old;
  return Object.keys(removals).length ? { ...rest, removals } : rest;
}

/** Le plus bas tier d'une carte : celui où elle se range dans le deck. */
export function laneTier(card: Card): number {
  return tiersOf(card)[0] ?? 1;
}

/** Le deck tel que `buildSession` l'attend : `{ "1": [...], …, "5": [...] }`.
 *  Chaque carte se range à son plus bas tier — la pioche se dérive de toute
 *  façon des tiers de la carte (`Draw.deckPoolByTier`), pas de sa lane. */
export function deckOf(state: Pick<DraftState, 'picks' | 'removals'>, pool: readonly Card[]): Record<string, string[]> {
  const deck: Record<string, string[]> = { '1': [], '2': [], '3': [], '4': [], '5': [] };
  const byId = indexOf(pool);
  for (const id of deckIds(state)) {
    const c = byId.get(id);
    deck[String(c ? laneTier(c) : 1)]?.push(id);
  }
  return deck;
}

// --- Lots liés ---

/** Les ids de carte NOMMÉS par les recettes d'une carte (jamais un `ARCH_*`). */
function namedIds(card: Card): Set<string> {
  const out = new Set<string>();
  for (const cd of card.summon_conditions ?? []) {
    for (const m of cd.requires ?? []) if (!isAttributeMaterial(m)) out.add(m);
  }
  return out;
}

/**
 * Le lot est-il LIÉ ? Deux cartes le sont quand l'une nomme l'autre dans une
 * recette ; le lot l'est quand ces liens relient toutes ses cartes. Tiers
 * mélangés en plus : au moins deux « plus bas tiers » distincts.
 * ⚠️ JUMEAU de `draft.js` (`isLinkedBundle`) : le serveur rejoue ce verdict.
 */
export function isLinkedBundle(cards: readonly Card[]): boolean {
  if (cards.length < 2) return false;
  if (new Set(cards.map(laneTier)).size < 2) return false;
  const named = cards.map(namedIds);
  const linked = (i: number, j: number) => named[i].has(cards[j].id) || named[j].has(cards[i].id);
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    for (let j = 0; j < cards.length; j++) {
      if (!seen.has(j) && linked(i, j)) { seen.add(j); queue.push(j); }
    }
  }
  return seen.size === cards.length;
}

/**
 * Le lot d'une carte « tête » : elle, et les matériels que sa recette nomme.
 * Sa recette la plus riche en matériels nommés disponibles d'abord ; avec un
 * seul, le troisième est un matériel de ce matériel, à défaut une carte qui se
 * sert de l'un des deux. `null` si aucun lot lié ne se forme.
 */
function bundleFor(head: Card, byId: ReadonlyMap<string, Card>, blocked: ReadonlySet<string>, sorted: readonly Card[]): Card[] | null {
  const free = (id: string) => id !== head.id && !blocked.has(id) && byId.has(id);
  let best: string[] = [];
  for (const cd of head.summon_conditions ?? []) {
    const ids = [...new Set((cd.requires ?? []).filter(m => !isAttributeMaterial(m) && free(m)))];
    if (ids.length > best.length) best = ids;
  }
  if (best.length === 0) return null;
  const bundle = [head, ...best.slice(0, 2).map(id => byId.get(id)!)];
  if (bundle.length === 2) {
    const inBundle = new Set(bundle.map(c => c.id));
    const mat = bundle[1];
    const third = [...namedIds(mat)].sort().find(id => free(id) && !inBundle.has(id))
      ?? sorted.find(c => !inBundle.has(c.id) && free(c.id)
        && (namedIds(c).has(head.id) || namedIds(c).has(mat.id)))?.id;
    if (!third) return null;
    bundle.push(byId.get(third)!);
  }
  return isLinkedBundle(bundle) ? bundle : null;
}

/** Trois lots disjoints, tirés dans les têtes possibles. */
function bundleOffer(
  state: Pick<DraftState, 'seed' | 'picks'>, pool: readonly Card[], stepIndex: number, rerolls: number,
): OfferSlot[] {
  const byId = indexOf(pool);
  const taken = new Set(state.picks);
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  const heads = sorted.filter(c => !taken.has(c.id));
  const rand = makeRandom(hashSeed(state.seed, 'bundle', stepIndex, rerolls));
  const picked = cardsOf(state.picks, byId);
  const out: OfferSlot[] = [];
  const used = new Set(taken);
  while (out.length < OFFER_SIZE && heads.length > 0) {
    const head = heads.splice(Math.floor(rand() * heads.length), 1)[0];
    if (used.has(head.id)) continue;
    const bundle = bundleFor(head, byId, used, sorted);
    if (!bundle) continue;
    for (const c of bundle) used.add(c.id);
    const cov = coverageOf([...picked, ...bundle]);
    const missing = bundle.filter(c => !isSummonable(c, cov.ids, cov.attrs)).length;
    out.push({ cards: bundle, kind: 'bundle', missing });
  }
  return out;
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
 * L'offre de l'étape en cours. Sur une étape de LOT : trois lots liés et
 * disjoints. Sur une étape d'une carte, trois emplacements, trois rôles :
 *
 *   - **complément** : une carte jouable qui comble un matériel qu'attend une
 *     carte déjà prise (à défaut, une carte jouable) ;
 *   - **sûr** : une carte jouable avec ce que le deck contient ;
 *   - **pari** : une carte dont les matériaux manquent encore (à défaut, une
 *     carte jouable).
 *
 * Chaque emplacement retombe sur tout ce qui reste quand son rôle n'a plus de
 * candidat : une offre plus courte que trois n'arrive que sur un catalogue
 * presque vide.
 */
export function offerFor(
  state: Pick<DraftState, 'seed' | 'picks' | 'rerolls' | 'removals'>,
  pool: readonly Card[],
  rerolls: number = state.rerolls,
): OfferSlot[] {
  const at = stepAt(state.picks.length);
  if (at.step.tier == null && !at.step.bonus) return bundleOffer(state, pool, at.index, rerolls);
  const tier = at.step.tier;
  const byId = indexOf(pool);
  // Une carte retirée ne revient pas (`taken` garde tout ce qui a été pris),
  // mais elle ne compte plus dans le deck dont l'offre se nourrit.
  const taken = new Set(state.picks);
  const deck = deckIds(state, state.picks.length);
  const picked = cardsOf(deck, byId);
  const cov = coverageOf(picked);
  const missing = missingMaterials(picked, cov);

  // Ordre du catalogue normalisé par id : la même graine doit rendre la même
  // offre quel que soit l'ordre dans lequel le serveur a servi les cartes.
  const eligible = pool
    .filter(c => !taken.has(c.id) && (tier == null || hasTier(c, tier)))
    .sort((a, b) => a.id.localeCompare(b.id));
  const buildable = eligible.filter(c => isSummonable(c, cov.ids, cov.attrs));
  const complement = buildable.filter(c => fillsMissing(c, missing));
  const bets = eligible.filter(c => !isSummonable(c, cov.ids, cov.attrs));

  if (at.step.bonus) return bonusOffer(state, deck, eligible, picked, cov, rerolls);

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
    out.push({ cards: [card], kind: actual });
  }
  return out;
}

/** Un emplacement d'offre à trois rôles, avant tout prix. `fallback` : le rôle
 *  n'avait plus de candidat et la carte vient du repli — elle ne porte alors
 *  ni malus ni bonus (Draft), ni le prix de son rôle (Phase Shopping). */
export interface RoleSlot { card: Card; kind: 'link' | 'buildable' | 'bet'; fallback: boolean }

/**
 * Trois rôles jugés contre un ensemble de cartes de RÉFÉRENCE (le deck drafté,
 * ou ce que le joueur a en jeu à la Phase Shopping) :
 *
 *   - **lien** : une carte qu'une carte de référence NOMME dans sa recette, ou
 *     dont la recette nomme une carte de référence — jouable de préférence. À
 *     défaut, un lien par attribut ;
 *   - **jouable** (passe-partout) : une carte qui se pose avec la référence ;
 *   - **pari** : une carte dont les matériaux manquent encore.
 *
 * Un rôle sans candidat retombe sur une carte jouable, puis sur n'importe
 * laquelle (`fallback`). Exactement le tirage de la carte de plus du Draft :
 * même ordre d'appels à `rand`, donc mêmes offres pour une run en cours.
 */
export function roleOffer(
  refIds: readonly string[],
  refCards: readonly Card[],
  cov: ReturnType<typeof coverageOf>,
  eligible: readonly Card[],
  rand: () => number,
): RoleSlot[] {
  const inRef = new Set(refIds);
  const namedByRef = new Set(refCards.flatMap(c => [...namedIds(c)]));
  const attrsWanted = new Set(refCards.flatMap(requiredAttrs));
  const playable = (c: Card) => isSummonable(c, cov.ids, cov.attrs);
  const idLinked = (c: Card) => namedByRef.has(c.id) || [...namedIds(c)].some(id => inRef.has(id));
  const attrLinked = (c: Card) => (c.attributes ?? []).some(a => attrsWanted.has(a))
    || requiredAttrs(c).some(a => cov.attrs.has(a));

  const buildable = eligible.filter(playable);
  const links = eligible.filter(idLinked);
  const linkTiers = [links.filter(playable), links, eligible.filter(c => !idLinked(c) && attrLinked(c))];
  const bets = eligible.filter(c => !playable(c));

  const used = new Set<string>();
  const fresh = (list: readonly Card[]) => list.filter(c => !used.has(c.id));
  const firstFresh = (lists: readonly (readonly Card[])[]) => lists.map(fresh).find(l => l.length > 0) ?? [];
  const out: RoleSlot[] = [];
  const push = (card: Card | null, kind: RoleSlot['kind'] | null) => {
    if (!card) return;
    used.add(card.id);
    out.push({ card, kind: kind ?? (playable(card) ? 'buildable' : 'bet'), fallback: kind === null });
  };
  const fallback = () => draw(fresh(buildable), rand) ?? draw(fresh(eligible), rand);

  const link = draw(firstFresh(linkTiers), rand);
  push(link ?? fallback(), link ? 'link' : null);
  const safe = draw(fresh(buildable.filter(c => !idLinked(c))), rand) ?? draw(fresh(buildable), rand);
  push(safe ?? draw(fresh(eligible), rand), safe ? 'buildable' : null);
  const bet = draw(fresh(bets.filter(c => !idLinked(c))), rand) ?? draw(fresh(bets), rand);
  push(bet ?? fallback(), bet ? 'bet' : null);
  return out;
}

/**
 * L'offre de la carte de plus, tous tiers : les trois rôles de `roleOffer`,
 * chacun son prix — le lien se paie (malus), le pari se récompense (bonus).
 * Un rôle de repli ne porte ni malus ni bonus : le prix va avec le rôle.
 */
function bonusOffer(
  state: Pick<DraftState, 'seed' | 'picks'>,
  deck: readonly string[],
  eligible: readonly Card[],
  picked: readonly Card[],
  cov: ReturnType<typeof coverageOf>,
  rerolls: number,
): OfferSlot[] {
  const rand = makeRandom(hashSeed(state.seed, 'bonus', state.picks.length, rerolls));
  return roleOffer(deck, picked, cov, eligible, rand).map(({ card, kind, fallback }) => {
    const mod = fallback ? undefined
      : kind === 'link' ? modFor(state.seed, card, 'malus')
      : kind === 'bet' ? modFor(state.seed, card, 'bonus') : undefined;
    return { cards: [card], kind, ...(mod ? { mod } : {}) };
  });
}

/** Les attributs qu'exigent les recettes d'une carte (`ARCH_*`). */
function requiredAttrs(card: Card): string[] {
  return (card.summon_conditions ?? []).flatMap(cd => (cd.requires ?? []).filter(isAttributeMaterial));
}

// --- Actions (pures : rendent un nouvel état, ou `null` si refusé) ---

/** Prend un choix de l'offre : ses cartes, dans l'ordre de l'offre. */
export function pickCards(state: DraftState, cardIds: readonly string[], pool: readonly Card[]): DraftState | null {
  if (!stepOf(state)) return null;
  const key = [...cardIds].sort().join('|');
  const slot = offerFor(state, pool).find(s => s.cards.map(c => c.id).sort().join('|') === key);
  if (!slot) return null;
  const picks = [...state.picks, ...slot.cards.map(c => c.id)];
  const status = state.status === 'drafting' && picks.length >= DRAFT_SIZE ? 'playing' : state.status;
  const mods = slot.mod ? { ...state.mods, [slot.cards[0].id]: slot.mod.sign } : state.mods;
  return { ...state, picks, status, ...(mods ? { mods } : {}) };
}

/** Les relances valent pour toute la run, cartes de plus comprises. */
export function canReroll(state: DraftState): boolean {
  return !!stepOf(state) && state.rerolls < DRAFT_REROLLS;
}

export function reroll(state: DraftState): DraftState | null {
  return canReroll(state) ? { ...state, rerolls: state.rerolls + 1 } : null;
}

/** Défaites tolérées avant que la run ne s'arrête. */
export function maxLosses(state: Pick<DraftState, 'extra_life'>): number {
  return RUN_LOSSES + (state.extra_life ? EXTRA_LIVES : 0);
}

/** Solde un duel — le même verdict que `draft.recordDuel`, utile aux tests.
 *  Une égalité ne se rapporte pas ; aucun duel tant qu'une carte est due. */
export function recordResult(state: DraftState, result: 'win' | 'loss'): DraftState | null {
  if (state.status !== 'playing' || pendingBonus(state)) return null;
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

/** Puissance d'un choix : la somme de ses cartes. */
function slotPower(slot: OfferSlot): number {
  return slot.cards.reduce((n, c) => n + cardPower(slot.mod ? applyMod(c, slot.mod) : c), 0);
}

/** Le choix de l'IA : le plus fort parmi les jouables, un pari seulement
 *  quand l'offre ne propose rien d'autre. */
function bestSlot(offer: readonly OfferSlot[]): OfferSlot {
  return [...offer].sort((a, b) =>
    (Number(a.kind === 'bet') - Number(b.kind === 'bet'))
    || ((a.missing ?? 0) - (b.missing ?? 0))
    || (slotPower(b) - slotPower(a))
    || a.cards[0].id.localeCompare(b.cards[0].id))[0];
}

/**
 * Un draft complet joué par l'IA, avec la MÊME fonction d'offre, plus `extra`
 * cartes de plus (une par duel déjà joué : le deck d'un adversaire grandit
 * comme celui du joueur). Elle ne relance jamais.
 */
export function autoDraft(seed: number, pool: readonly Card[], extra = 0): Record<string, string[]> {
  return deckOf(autoDraftRun(seed, pool, extra), pool);
}

/** Le draft de l'IA en entier — avec les malus et bonus de ses cartes de plus. */
export function autoDraftRun(seed: number, pool: readonly Card[], extra = 0): DraftState {
  let state: DraftState = newDraft(seed);
  while (state.status === 'drafting') {
    const offer = offerFor(state, pool);
    if (offer.length === 0) break;
    const next = pickCards(state, bestSlot(offer).cards.map(c => c.id), pool);
    if (!next) break;
    state = next;
  }
  for (let i = 0; i < extra && state.picks.length >= DRAFT_SIZE; i++) {
    const offer = offerFor(state, pool);
    if (offer.length === 0) break;
    const slot = bestSlot(offer);
    const id = slot.cards[0].id;
    state = {
      ...state,
      picks: [...state.picks, id],
      ...(slot.mod ? { mods: { ...state.mods, [id]: slot.mod.sign } } : {}),
    };
  }
  return state;
}

export interface DraftOpponent {
  /** Index du duel dans la run (victoires + défaites). */
  index: number;
  deck: Record<string, string[]>;
  /** Ses cartes de plus modifiées (malus du lien, bonus du pari), par id. */
  cards: Map<string, Card>;
  /** Sa carte la plus forte : elle lui sert de visage. */
  faceCardId: string | null;
}

/**
 * Le BOT du duel en cours — servi quand la file d'attente ne trouve aucun
 * joueur en draft —, ou `null` hors phase de duels. Il a drafté autant de
 * cartes que le joueur. Aucun handicap de stats : l'adversaire doit pouvoir
 * passer pour un joueur, et un bonus se lirait dans l'infobulle de ses cartes.
 * Déterministe à (graine, index) : un rechargement retombe sur le même deck.
 */
export function currentOpponent(state: DraftState, pool: readonly Card[]): DraftOpponent | null {
  if (state.status !== 'playing') return null;
  const index = state.wins + state.losses;
  const run = autoDraftRun(hashSeed(state.seed, 'enemy', index), pool, index);
  const deck = deckOf(run, pool);
  const byId = indexOf(pool);
  const cards = cardsOf(Object.values(deck).flat(), byId);
  const face = [...cards].sort((a, b) => (cardPower(b) - cardPower(a)) || a.id.localeCompare(b.id))[0] ?? null;
  return { index, deck, cards: moddedCards(run, pool), faceCardId: face?.id ?? null };
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
  for (const s of DRAFT_STEPS) if (s.tier != null) need[s.tier] = (need[s.tier] ?? 0) + 1;
  const enough = Object.entries(need).every(([t, n]) =>
    withArt.filter(c => hasTier(c, Number(t))).length >= n + OFFER_SIZE);
  return enough ? withArt : [...cards];
}
