// Le TIER d'une carte est un ATTRIBUT, pas un champ.
//
// Les cinq tiers sont des attributs de catégorie `Tiers` (`ARCH_091`…`ARCH_095`)
// exactement comme les cinq voies d'invocation sont des attributs de catégorie
// `Invocation` : le moteur ne connaît plus qu'un catalogue d'attributs, et une
// carte peut en porter PLUSIEURS de la même catégorie. Une carte à deux tiers
// est piochable aux deux, et se range dans les deux lanes du deck.
//
// ⚠️ Ce module ne nomme AUCUN id d'attribut. La catégorie dit qu'un attribut
// est un tier, le champ `tier` de l'attribut dit LEQUEL. Un id en dur ici
// rendrait le catalogue non éditable, et une dérivation depuis le `name`
// (« Tier 3 ») casserait au premier renommage en admin.
//
// ⚠️ JUMEAU : `tiers.js` (racine) porte la même règle côté serveur — la
// frontière CJS / ESM-TS interdit un module partagé (même situation que
// `XP_PER_LEVEL` et `BASE_TICK_MS`). `test/tiers.test.ts` compare les deux sur
// le catalogue entier : c'est le seul filet contre la dérive.
//
// Pur, sans aucun import : `logic/` n'importe pas `data/`, et c'est ce qui
// autorise `sim/`, `dev/` et les tests à s'en servir sur du JSON brut.
import type { AttributeDef, Card } from './types.js';

/** La catégorie qui porte les tiers. Elle vit ICI et dans son jumeau CJS. */
export const TIER_CATEGORY = 'Tiers';

/** Repli quand une carte ne porte aucun attribut de tier (donnée en retard de
 *  migration) : le tier le plus bas, celui du premier round. La LECTURE est
 *  tolérante ; c'est l'écriture qui refuse, et l'audit qui le signale. */
export const DEFAULT_TIER = 1;

/** `{ [attributeId]: tier }`. */
export type TierIndex = Record<string, number>;

/** L'index des attributs de tier, construit une fois par catalogue. */
export function tierIndex(attributes: readonly AttributeDef[] | null | undefined): TierIndex {
  const map: TierIndex = {};
  for (const a of attributes ?? []) {
    if (!a || a.categorie !== TIER_CATEGORY) continue;
    const t = Number(a.tier);
    if (Number.isFinite(t) && t > 0) map[a.id] = t;
  }
  return map;
}

/**
 * Les tiers portés par une carte, d'après ses attributs. Triés, sans doublon.
 *
 * C'est la RÉSOLUTION, faite une fois au chargement du catalogue (le serveur
 * pose `_tiers` sur `GET /api/cards`, `sim/catalog.ts` fait de même sur le JSON
 * brut). Le jeu, lui, ne fait que LIRE — cf. `tiersOf`.
 *
 * ⚠️ Faire cette résolution ailleurs qu'au chargement casserait le déterminisme
 * PvP le jour où une unité serait reconstruite depuis le réseau sans catalogue
 * d'attributs sous la main.
 */
export function resolveTiers(card: Pick<Card, 'attributes'>, index: TierIndex): number[] {
  const out = new Set<number>();
  for (const id of card.attributes ?? []) {
    const t = index[id];
    if (t != null) out.add(t);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Les tiers d'une carte déjà résolue. `[]` si elle n'en porte aucun.
 *
 * ⚠️ Il n'y a PLUS de repli : le champ `tier` a quitté les données, et une
 * carte sans attribut de tier n'entre donc dans aucun pool de pioche. C'est le
 * contrat d'écriture (`card-contract.js`, 400 en POST/PUT) et l'audit
 * (`npm run audit:cards`) qui garantissent qu'elle n'existe pas — pas une
 * clause de lecture qui inventerait un tier.
 */
export function tiersOf(card: Card | null | undefined): number[] {
  return card?._tiers ?? [];
}

/**
 * Le tier d'une carte quand il en faut UN SEUL : son plus haut.
 *
 * ⚠️ Le maximum et pas le minimum : les trois consommateurs scalaires (échelle
 * des effets visuels, garde « un matériel ne se consomme jamais vers le haut »
 * de l'IA, `tier_min` des missions) demandent tous « quelle est la puissance de
 * cette carte », pas « à partir de quand se pioche-t-elle ».
 */
export function primaryTier(card: Card | null | undefined): number {
  const t = tiersOf(card);
  return t.length ? t[t.length - 1] : DEFAULT_TIER;
}

/**
 * Le tier à AFFICHER sur une étiquette, ou `null` quand il n'y a rien à dire.
 *
 * ⚠️ Distinct de `primaryTier`, et la différence n'est pas cosmétique : une
 * règle de jeu doit toujours obtenir un chiffre (d'où le repli), une étiquette
 * ne doit pas inventer un « T1 » sur une carte qui ne porte aucun tier.
 */
export function displayTier(card: Card | null | undefined): number | null {
  const t = tiersOf(card);
  return t.length ? t[t.length - 1] : null;
}

/** La carte est-elle piochable au tier `t` ? */
export function hasTier(card: Card | null | undefined, t: number): boolean {
  return tiersOf(card).includes(t);
}
