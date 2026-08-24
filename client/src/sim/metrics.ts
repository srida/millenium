// Agrégation des mesures, carte par carte.
//
// Deux règles portent tout ce fichier :
//
// 1. ⚠️ **Le dénominateur d'un winrate est le nombre de parties où la carte a
//    été POSÉE**, jamais celui où elle était dans le deck. Mesuré sur ce
//    dépôt : 130 cartes sur 653 ne quittent jamais la main faute de matériaux.
//    Les compter comme « jouées et perdantes » ferait passer un problème de
//    constructibilité pour un problème de puissance.
// 2. **Un taux sans son intervalle de confiance ne veut rien dire.** À 46
//    observations — ce que rendent 1000 parties — l'intervalle fait ±14 points :
//    on ne distingue pas une carte à 55 % d'une carte à 45 %. Le rapport porte
//    donc l'intervalle partout, et l'écart n'est retenu que s'il le dépasse.
import type { Card } from '../logic/types.js';
import type { GameResult } from './runGame.js';

export interface CardMetrics {
  card_id: string;
  name: string;
  tier: number;
  summon_type: string;
  /** Parties où la carte était dans le deck du joueur. */
  inDeck: number;
  /** Parties où elle a effectivement été posée. */
  played: number;
  /** Parties gagnées parmi `played`. */
  wins: number;
  /** Nombre d'unités invoquées (une partie peut en poser plusieurs). */
  summons: number;
  /** Combats entamés avec l'unité sur le board (unités × rounds). */
  combats: number;
  /** Combats terminés vivante. */
  survived: number;
  damageDealt: number;
  damageTaken: number;
}

export interface CardRow extends CardMetrics {
  /** `played / inDeck` — une carte qu'on ne parvient pas à poser est un
   *  problème de construction, pas d'équilibrage. */
  playRate: number | null;
  winrate: number | null;
  /** Demi-largeur de l'intervalle de Wilson à 95 %. */
  ci: number | null;
  survivalRate: number | null;
  damagePerCombat: number | null;
  /** Écart à la ligne de base du run, en points. C'est LUI qu'on lit — pas
   *  l'écart à 50 %, la ligne de base dépendant du handicap IA. */
  delta: number | null;
  /** L'écart dépasse-t-il son propre intervalle de confiance ? */
  significant: boolean;
}

export class MetricsCollector {
  private rows = new Map<string, CardMetrics>();
  games = 0;
  playerWins = 0;
  draws = 0;
  rounds = 0;
  timeouts = 0;

  constructor(private cardDb: { getCard(id: string): Card | null }) {}

  private row(cardId: string): CardMetrics {
    let r = this.rows.get(cardId);
    if (!r) {
      const c = this.cardDb.getCard(cardId);
      r = {
        card_id: cardId,
        name: c?.name ?? cardId,
        tier: c?.tier ?? 0,
        summon_type: c?.summon_type ?? 'normal',
        inDeck: 0, played: 0, wins: 0, summons: 0, combats: 0, survived: 0,
        damageDealt: 0, damageTaken: 0,
      };
      this.rows.set(cardId, r);
    }
    return r;
  }

  /** @param deckCardIds les cartes du deck JOUEUR de cette partie. */
  add(result: GameResult, deckCardIds: string[]): void {
    this.games++;
    this.rounds += result.rounds;
    this.timeouts += result.timeouts;
    const won = result.winner === 'player';
    if (won) this.playerWins++;
    if (result.winner === 'draw') this.draws++;

    for (const id of new Set(deckCardIds)) this.row(id).inDeck++;

    const playedThisGame = new Set<string>();
    for (const u of result.units) {
      if (u.side !== 'player') continue; // seul le siège du joueur est mesuré
      const r = this.row(u.card_id);
      r.summons++;
      r.combats += u.combats;
      r.survived += u.survived;
      r.damageDealt += u.damageDealt;
      r.damageTaken += u.damageTaken;
      playedThisGame.add(u.card_id);
    }
    for (const id of playedThisGame) {
      const r = this.row(id);
      r.played++;
      if (won) r.wins++;
    }
  }

  /** Ligne de base du run : le winrate moyen du siège joueur. C'est la
   *  référence, et non 50 % — le handicap IA la déplace à dessein. */
  get baseline(): number {
    return this.games > 0 ? this.playerWins / this.games : 0;
  }

  /** @param minPlayed en dessous, la ligne est rendue mais jamais « significative ». */
  toRows(minPlayed = 100): CardRow[] {
    const base = this.baseline;
    return [...this.rows.values()].map(m => {
      const winrate = m.played > 0 ? m.wins / m.played : null;
      const ci = m.played > 0 ? wilsonHalfWidth(m.wins, m.played) : null;
      const delta = winrate === null ? null : winrate - base;
      return {
        ...m,
        playRate: m.inDeck > 0 ? m.played / m.inDeck : null,
        winrate,
        ci,
        survivalRate: m.combats > 0 ? m.survived / m.combats : null,
        damagePerCombat: m.combats > 0 ? m.damageDealt / m.combats : null,
        delta,
        significant: delta !== null && ci !== null && m.played >= minPlayed && Math.abs(delta) > ci,
      };
    }).sort((a, b) =>
      Number(b.significant) - Number(a.significant) ||
      effectSize(b) - effectSize(a) ||
      b.played - a.played ||
      a.card_id.localeCompare(b.card_id));
  }
}

/**
 * Ce par quoi le rapport est TRIÉ : l'écart amputé de son incertitude, jamais
 * l'écart brut.
 *
 * ⚠️ Trier par |écart| remonte en tête les cartes posées UNE fois — une seule
 * victoire vaut +53 points d'écart, avec un intervalle de ±40 qui dit
 * exactement qu'on n'en sait rien. La borne basse de l'effet met d'office ces
 * lignes-là à zéro, et laisse remonter celles qui ont à la fois un écart et de
 * quoi l'affirmer. Les lignes SIGNIFICATIVES passent devant tout le reste : à
 * borne basse égale, une carte posée 8 fois n'a pas le même poids qu'une carte
 * posée 200 fois, et c'est ce classement-là que le rapport présente par défaut.
 */
export function effectSize(row: CardRow): number {
  if (row.delta === null || row.ci === null) return 0;
  return Math.max(0, Math.abs(row.delta) - row.ci);
}

/**
 * Demi-largeur de l'intervalle de Wilson à 95 %.
 *
 * ⚠️ Wilson et non l'intervalle normal : ce dernier rend une largeur NULLE
 * quand le taux vaut 0 ou 1, ce qui ferait passer une carte posée trois fois et
 * gagnante trois fois pour une certitude absolue — exactement le cas qu'un
 * rapport d'équilibrage doit refuser de croire.
 */
export function wilsonHalfWidth(successes: number, trials: number, z = 1.96): number {
  if (trials === 0) return 1;
  const p = successes / trials;
  const d = 1 + (z * z) / trials;
  const spread = (z / d) * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return spread;
}
