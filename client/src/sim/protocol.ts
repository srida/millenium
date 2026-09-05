// Le protocole de mesure — deux passes qui ne disent pas la même chose.
//
//   Passe 1, le DÉTECTEUR : beaucoup de parties, decks aléatoires couvrants,
//   classement de toutes les cartes. Il SIGNALE. Le winrate d'une carte y reste
//   contaminé par le deck qui la porte : une carte médiocre entourée de bonnes
//   cartes affiche un bon score.
//
//   Passe 2, l'A/B : deck témoin figé, un seul slot qui change, N parties de
//   chaque côté. Il TRANCHE. C'est le seul chiffre qui isole la carte, et il
//   coûte trop cher pour être appliqué aux 653 — d'où le ciblage sur ce que la
//   passe 1 a signalé.
import type { Card } from '../logic/types.js';
import { seededRandom } from '../logic/Random.js';
import type { Catalog } from './catalog.js';
import { buildDeck, deckCardIds, deckWithoutCard, isSummonable, materialClosure, type Deck } from './decks.js';
import { MetricsCollector, wilsonHalfWidth, type CardRow } from './metrics.js';
import { runGame } from './runGame.js';
import { summonCost } from '../logic/InvocationManager.js';
import { primaryTier } from '../logic/Tiers.js';

/**
 * Handicap plat donné à chaque unité de l'IA pendant TOUTE la simulation.
 *
 * ⚠️ Ce n'est pas un réglage de difficulté, c'est un instrument de mesure.
 * L'auto-joueur bat `EnemyAI` à 80 % sur un miroir strict (mesuré) : à ce
 * niveau, une carte forte n'a plus que 20 points de marge pour se distinguer,
 * et tout se tasse contre le plafond. `+4 ATK / +40 PV` ramène la ligne de base
 * à ~52 % (mesuré sur 300 parties), où les deux sens du déséquilibre ont la
 * même place pour s'exprimer.
 *
 * ⚠️ Il doit rester FIGÉ d'un jour sur l'autre : le recalibrer rendrait le
 * rapport d'hier incomparable à celui d'aujourd'hui, et c'est le diff qui fait
 * tout l'intérêt de la routine. Le rapport publie la ligne de base réalisée —
 * si elle dérive, c'est le jeu qui a bougé, et c'est une information.
 */
export const ENEMY_HANDICAP = { atk: 4, hp: 40 };

export interface DetectorResult {
  rows: CardRow[];
  games: number;
  baseline: number;
  drawRate: number;
  timeoutsPerGame: number;
  roundsPerGame: number;
  /** Cartes du catalogue jamais posées, avec ce qui les en a empêchées. */
  neverPlayed: { card_id: string; name: string; tier: number; summon_cost: number; inDeck: number }[];
}

/**
 * Passe 1. Chaque appariement de decks est joué DANS LES DEUX SENS.
 *
 * ⚠️ Ce n'est pas une précaution de principe : le siège n'est pas neutre.
 * `CombatManager` trie `[...playerUnits, ...enemyUnits]` et, à égalité totale
 * d'initiative, de vitesse d'attaque et de `card_id`, le tri stable laisse le
 * joueur frapper le premier — mesuré à 61 % pour le côté A sur un miroir. Le
 * départage par `card_id` porte le déterminisme PvP, on n'y touche pas : on
 * joue les deux sens.
 */
export function runDetector(cat: Catalog, games: number, seed: string): DetectorResult {
  const collector = new MetricsCollector(cat.cardDb);
  const deckRand = seededRandom(seed, 'decks');
  const pairs = Math.max(1, Math.ceil(games / 2));

  for (let i = 0; i < pairs; i++) {
    const a = buildDeck(cat.cards, deckRand);
    const b = buildDeck(cat.cards, deckRand);
    for (const [player, enemy, tag] of [[a, b, 'ab'], [b, a, 'ba']] as [Deck, Deck, string][]) {
      const result = runGame({
        playerDeck: player, enemyDeck: enemy,
        attributeList: cat.attributes, cardDb: cat.cardDb, boards: cat.boards,
        rand: seededRandom(seed, i, tag), enemyBonus: ENEMY_HANDICAP,
      });
      collector.add(result, deckCardIds(player));
    }
  }

  const rows = collector.toRows();
  const seen = new Map(rows.map(r => [r.card_id, r]));
  const neverPlayed = cat.cards
    .filter(c => (seen.get(c.id)?.played ?? 0) === 0)
    .map(c => ({
      card_id: c.id, name: c.name, tier: primaryTier(c),
      summon_cost: summonCost(c),
      inDeck: seen.get(c.id)?.inDeck ?? 0,
    }));

  return {
    rows,
    games: collector.games,
    baseline: collector.baseline,
    drawRate: collector.games ? collector.draws / collector.games : 0,
    timeoutsPerGame: collector.games ? collector.timeouts / collector.games : 0,
    roundsPerGame: collector.games ? collector.rounds / collector.games : 0,
    neverPlayed,
  };
}

export interface AbResult {
  card_id: string;
  name: string;
  tier: number;
  /** `null` quand la carte n'a pas pu être rendue invocable dans un témoin. */
  delta: number | null;
  withRate: number | null;
  withoutRate: number | null;
  ci: number | null;
  games: number;
  untestable: string | null;
}

/**
 * Passe 2. Le témoin est construit AUTOUR de la carte : elle et sa fermeture de
 * matériaux sont imposées, le reste est tiré. Le bras « sans » est le même deck
 * moins la carte — les matériaux restent en place, pour que l'écart ne mesure
 * qu'elle.
 */
export function runAb(cat: Catalog, cards: Card[], gamesPerArm: number, seed: string): AbResult[] {
  const out: AbResult[] = [];

  for (const card of cards) {
    const closure = materialClosure(card, cat.cards, cat.cardDb);
    if (closure === null) {
      out.push({ card_id: card.id, name: card.name, tier: primaryTier(card), delta: null, withRate: null, withoutRate: null, ci: null, games: 0, untestable: 'matériaux introuvables au catalogue' });
      continue;
    }

    const rand = seededRandom(seed, 'ab', card.id);
    const withDeck = buildDeck(cat.cards, rand, [card, ...closure]);
    const withoutDeck = deckWithoutCard(withDeck, card.id);

    // Garde finale : le plafond de 8 cartes par tier a pu évincer un matériau.
    const ids = new Set(deckCardIds(withDeck));
    const attrs = new Set<string>();
    for (const id of ids) for (const a of cat.cardDb.getCard(id)?.attributes ?? []) attrs.add(a);
    if (!ids.has(card.id) || !isSummonable(card, ids, attrs) || !withoutDeck) {
      out.push({ card_id: card.id, name: card.name, tier: primaryTier(card), delta: null, withRate: null, withoutRate: null, ci: null, games: 0, untestable: 'deck témoin impossible (plafond de 8 par tier)' });
      continue;
    }

    const arm = (deck: Deck, tag: string) => {
      let wins = 0;
      for (let i = 0; i < gamesPerArm; i++) {
        // L'adversaire est tiré du MÊME flux pour les deux bras : les deux
        // affrontent la même suite de decks, seul le slot testé diffère.
        const foe = buildDeck(cat.cards, seededRandom(seed, 'foe', card.id, i));
        const r = runGame({
          playerDeck: deck, enemyDeck: foe,
          attributeList: cat.attributes, cardDb: cat.cardDb, boards: cat.boards,
          rand: seededRandom(seed, 'ab', card.id, tag, i), enemyBonus: ENEMY_HANDICAP,
        });
        if (r.winner === 'player') wins++;
      }
      return wins;
    };

    const wWith = arm(withDeck, 'with');
    const wWithout = arm(withoutDeck, 'without');
    const pWith = wWith / gamesPerArm;
    const pWithout = wWithout / gamesPerArm;
    // Intervalle de la DIFFÉRENCE : les deux bras portent chacun le leur.
    const ci = Math.sqrt(
      wilsonHalfWidth(wWith, gamesPerArm) ** 2 + wilsonHalfWidth(wWithout, gamesPerArm) ** 2);

    out.push({
      card_id: card.id, name: card.name, tier: primaryTier(card),
      delta: pWith - pWithout, withRate: pWith, withoutRate: pWithout,
      ci, games: gamesPerArm * 2, untestable: null,
    });
  }

  return out.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
}
