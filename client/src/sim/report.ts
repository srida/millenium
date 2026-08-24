// Le rapport : la forme JSON publiée, et rien d'autre.
//
// ⚠️ Il ne transporte que des AGRÉGATS par carte. Le corps d'une requête `/api`
// est plafonné à 1 Mo hors routes d'upload (`app.js`) — une ligne par partie y
// tiendrait le temps d'un run de démonstration, puis casserait en silence le
// jour où la routine passe à l'échelle. Les nombres sont arrondis à la
// quatrième décimale pour la même raison : au-delà, c'est du bruit qui pèse.
import type { Catalog } from './catalog.js';
import type { AbResult, DetectorResult } from './protocol.js';
import { ENEMY_HANDICAP } from './protocol.js';

export const REPORT_VERSION = 1;

const r4 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10000) / 10000);

export interface SimReport {
  version: number;
  date: string;
  generated_at: string;
  seed: string;
  catalog: Catalog['fingerprint'];
  protocol: {
    games: number;
    handicap: { atk: number; hp: number };
    ab_candidates: number;
    ab_games_per_arm: number;
    /** Ce que la simulation ne couvre PAS — écrit dans le rapport pour que
     *  personne n'en tire une conclusion qu'il ne porte pas. */
    excludes: string[];
  };
  health: {
    baseline: number;
    draw_rate: number;
    timeouts_per_game: number;
    rounds_per_game: number;
    cards_measured: number;
    cards_never_played: number;
    significant: number;
  };
  cards: Record<string, unknown>[];
  ab: Record<string, unknown>[];
  never_played: DetectorResult['neverPlayed'];
}

export function buildReport(
  cat: Catalog,
  detector: DetectorResult,
  ab: AbResult[],
  opts: { seed: string; abGamesPerArm: number; date: string },
): SimReport {
  return {
    version: REPORT_VERSION,
    date: opts.date,
    generated_at: new Date().toISOString(),
    seed: opts.seed,
    catalog: cat.fingerprint,
    protocol: {
      games: detector.games,
      handicap: ENEMY_HANDICAP,
      ab_candidates: ab.length,
      ab_games_per_arm: opts.abGamesPerArm,
      excludes: [
        'Phase Shopping (magies) — exigerait une politique de magies pour l\'IA',
        'PvP — le combat y est le même code déterministe',
        'Dégâts sur la durée non attribués au lanceur (le flux d\'événements ne nomme pas la source d\'un pulse)',
      ],
    },
    health: {
      baseline: r4(detector.baseline)!,
      draw_rate: r4(detector.drawRate)!,
      timeouts_per_game: r4(detector.timeoutsPerGame)!,
      rounds_per_game: r4(detector.roundsPerGame)!,
      cards_measured: detector.rows.filter(r => r.played > 0).length,
      cards_never_played: detector.neverPlayed.length,
      significant: detector.rows.filter(r => r.significant).length,
    },
    cards: detector.rows.map(r => ({
      id: r.card_id, name: r.name, tier: r.tier, type: r.summon_type,
      in_deck: r.inDeck, played: r.played, summons: r.summons, combats: r.combats,
      play_rate: r4(r.playRate), winrate: r4(r.winrate), ci: r4(r.ci), delta: r4(r.delta),
      significant: r.significant,
      survival: r4(r.survivalRate), dmg: r4(r.damagePerCombat),
      dmg_taken: r.combats > 0 ? r4(r.damageTaken / r.combats) : null,
    })),
    ab: ab.map(a => ({
      id: a.card_id, name: a.name, tier: a.tier,
      delta: r4(a.delta), with: r4(a.withRate), without: r4(a.withoutRate),
      ci: r4(a.ci), games: a.games, untestable: a.untestable,
    })),
    never_played: detector.neverPlayed,
  };
}
