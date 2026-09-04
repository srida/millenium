// Agrégats par famille — ce que le rapport par carte ne peut pas dire.
//
// Une ligne par carte répond à « celle-ci est-elle trop forte ». Elle ne répond
// pas à « quel archétype domine », ni à « le jeu récompense-t-il la distance ou
// le contact » — ce sont ces questions-là que l'émission doit trancher.
//
// ⚠️ DEUX AVERTISSEMENTS QUI VOYAGENT AVEC LES CHIFFRES, et que l'émission
// prononce en clair :
//
//  1. **Une carte porte jusqu'à quatre attributs.** Le même résultat est donc
//     compté dans plusieurs familles : la somme des poses par attribut dépasse
//     largement le nombre de poses réelles. Un agrégat par attribut n'est pas
//     un « winrate d'attribut ».
//  2. **C'est CORRÉLATIONNEL, comme le détecteur.** Le score d'un attribut est
//     contaminé par les cartes qui le portent : un archétype qui contient un
//     Dieu Égyptien remonte grâce à lui, pas grâce à son thème. Isoler un
//     attribut demanderait un A/B par attribut, qu'on ne fait pas.
//
// La pondération est le **nombre de poses**, jamais le nombre de cartes : une
// carte posée 300 fois pèse plus qu'une posée douze.
import type { AttributeDef, Card } from '../logic/types.js';
import type { CardRow } from './metrics.js';

export interface FamilyRow {
  /** Clé technique (id d'attribut, nom de voie, numéro de tier…). */
  key: string;
  /** Ce que l'émission prononce. */
  label: string;
  /** Cartes distinctes retenues dans la famille. */
  cards: number;
  /** Poses cumulées — c'est le poids, et le seul dénominateur honnête. */
  played: number;
  /** Winrate pondéré par les poses. */
  winrate: number;
  /** Écart à la ligne de base du run, en fraction. */
  delta: number;
  survival: number;
  damage: number;
}

export interface Aggregates {
  attributes: FamilyRow[];
  summonTypes: FamilyRow[];
  tiers: FamilyRow[];
  /** Axes de style de jeu, chacun rendu comme un couple à comparer. */
  playstyles: FamilyRow[];
  /** Le rappel de méthode, transporté avec les chiffres plutôt qu'à côté. */
  caveats: string[];
}

/** Les seuls nombres que l'émission prononce en toutes lettres. */
const EN_TOUTES_LETTRES = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq',
  'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze',
];

/**
 * Le nom parlé d'un coût d'invocation. Remplace la table des cinq voies —
 * l'émission dit maintenant « les invocations à deux matériels » là où elle
 * disait « les fusions », ce qui reste vrai quand le catalogue change de
 * vocabulaire.
 *
 * ⚠️ Le compte s'écrit EN TOUTES LETTRES. Ce n'est pas une coquetterie : le
 * script est lu à voix haute, et surtout `show.ts` exige que tout CHIFFRE
 * prononcé soit passé par l'un de ses formateurs — un coût n'est pas une
 * mesure, il n'a rien à y faire. En lettres, il n'y a pas de chiffre à
 * enregistrer, et le contrôle reste entier pour les vraies mesures. Au-delà de
 * la table, le chiffre revient et le test le signalera : un coût à treize
 * matériels serait de toute façon la nouvelle à annoncer.
 */
export function summonCostLabel(cost: number): string {
  if (cost <= 0) return 'invocation sans condition';
  if (cost === 1) return 'invocation à un matériel';
  return `invocation à ${EN_TOUTES_LETTRES[cost] ?? cost} matériels`;
}

/** Sous le seuil, une famille n'est pas rendue : elle ne mesurerait rien. */
const MIN_PLAYED = 200;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Une famille = un groupe de lignes, replié en une seule pondérée par les poses. */
function fold(key: string, label: string, rows: CardRow[], baseline: number): FamilyRow | null {
  const played = rows.reduce((s, r) => s + r.played, 0);
  if (played === 0) return null;
  const wins = rows.reduce((s, r) => s + r.wins, 0);
  const combats = rows.reduce((s, r) => s + r.combats, 0);
  const survived = rows.reduce((s, r) => s + r.survived, 0);
  const damage = rows.reduce((s, r) => s + r.damageDealt, 0);
  const winrate = wins / played;
  return {
    key, label,
    cards: rows.length,
    played,
    winrate,
    delta: winrate - baseline,
    survival: combats > 0 ? survived / combats : 0,
    damage: combats > 0 ? damage / combats : 0,
  };
}

const byWeight = (a: FamilyRow, b: FamilyRow) => b.delta - a.delta || b.played - a.played;

export function buildAggregates(
  rows: CardRow[],
  cards: Card[],
  attributes: AttributeDef[],
  baseline: number,
): Aggregates {
  const played = rows.filter(r => r.played > 0);
  const cardById = new Map(cards.map(c => [c.id, c]));
  const attrName = new Map(attributes.map(a => [a.id, a.name]));

  // ── Attributs ─────────────────────────────────────────────────────────
  const byAttr = new Map<string, CardRow[]>();
  for (const row of played) {
    for (const attr of cardById.get(row.card_id)?.attributes ?? []) {
      if (!byAttr.has(attr)) byAttr.set(attr, []);
      byAttr.get(attr)!.push(row);
    }
  }
  const attrRows = [...byAttr.entries()]
    .map(([id, group]) => fold(id, attrName.get(id) ?? id, group, baseline))
    .filter((r): r is FamilyRow => !!r && r.played >= MIN_PLAYED)
    .sort(byWeight);

  // ── Voies d'invocation ────────────────────────────────────────────────
  const byType = new Map<number, CardRow[]>();
  for (const row of played) {
    const t = row.summon_cost;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(row);
  }
  const typeRows = [...byType.entries()]
    .map(([t, group]) => fold(String(t), summonCostLabel(t), group, baseline))
    // Même seuil que les attributs : une voie vue trois fois n'a pas de winrate,
    // elle a un accident. « fusion ferme la marche à 0,0 % » venait de là.
    .filter((r): r is FamilyRow => !!r && r.played >= MIN_PLAYED)
    .sort(byWeight);

  // ── Tiers ─────────────────────────────────────────────────────────────
  const byTier = new Map<number, CardRow[]>();
  for (const row of played) {
    if (!byTier.has(row.tier)) byTier.set(row.tier, []);
    byTier.get(row.tier)!.push(row);
  }
  const tierRows = [...byTier.entries()]
    .map(([t, group]) => fold(String(t), `tier ${t}`, group, baseline))
    .filter((r): r is FamilyRow => !!r)
    .sort((a, b) => Number(a.key) - Number(b.key));

  // ── Styles de jeu ─────────────────────────────────────────────────────
  // Les seuils sont les MÉDIANES DU CATALOGUE MESURÉ, pas des constantes : un
  // catalogue retouché déplace ses propres médianes, et un seuil en dur
  // finirait par ranger les trois quarts des cartes du même côté.
  const statOf = (r: CardRow) => cardById.get(r.card_id)?.stats;
  const medAtk = median(played.map(r => statOf(r)?.atk ?? 0));
  const medHp = median(played.map(r => statOf(r)?.hp ?? 0));

  const split = (
    key: string, label: string, keep: (r: CardRow) => boolean,
  ): FamilyRow | null => fold(key, label, played.filter(keep), baseline);

  const playstyles = [
    split('melee', 'les unités au contact', r => (statOf(r)?.range ?? 1) <= 1),
    split('ranged', 'les unités à distance', r => (statOf(r)?.range ?? 1) > 1),
    split('atk', 'les cartes taillées pour l’attaque', r => (statOf(r)?.atk ?? 0) > medAtk && (statOf(r)?.hp ?? 0) <= medHp),
    split('tank', 'les cartes taillées pour encaisser', r => (statOf(r)?.hp ?? 0) > medHp && (statOf(r)?.atk ?? 0) <= medAtk),
    split('power', 'les cartes à pouvoir', r => !!cardById.get(r.card_id)?.power?.id),
    split('nopower', 'les cartes sans pouvoir', r => !cardById.get(r.card_id)?.power?.id),
  ].filter((r): r is FamilyRow => !!r && r.played >= MIN_PLAYED);

  return {
    attributes: attrRows,
    summonTypes: typeRows,
    tiers: tierRows,
    playstyles,
    caveats: [
      'Une carte porte jusqu’à quatre attributs : le même résultat compte dans plusieurs familles, la somme des poses dépasse donc le nombre de poses réelles.',
      'Ces chiffres sont corrélationnels, comme ceux du détecteur : le score d’une famille est contaminé par les cartes qui la composent, il ne dit pas que la famille elle-même est forte.',
    ],
  };
}
