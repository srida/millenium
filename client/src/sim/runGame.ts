/* eslint-disable @typescript-eslint/no-explicit-any */
// La boucle d'une partie simulée.
//
// ⚠️ Elle pilote une VRAIE `GameSession` en mode 'ai' — c'est littéralement la
// partie solo, moins l'animation. Terrain, vétérance, réanimation d'attribut,
// règle du doublon, pioches garanties et cimetière viennent gratuitement,
// parce qu'on ne les réimplémente pas.
//
// C'est la différence de fond avec `logic/MatchSimulator.js` (Tournoi), qui
// rejoue une boucle allégée : il n'incrémente PAS la vétérance, ignore les
// unités réanimées et ne pose aucun terrain. Mesurer l'équilibrage dessus
// mesurerait un jeu que personne ne joue.
import { GameSession } from '../logic/GameSession.js';
import { MAX_COMBAT_TICKS } from '../logic/CombatManager.js';
import type { AttributeDef, BoardDef, Card } from '../logic/types.js';
import type { Unit } from '../logic/Unit.js';
import { playPreparation } from './autoPlayer.js';

export interface UnitRecord {
  card_id: string;
  side: 'player' | 'enemy';
  /** Nombre de combats entamés avec cette unité sur le board. */
  combats: number;
  /** Nombre de combats terminés vivante (mesuré AVANT la réanimation de fin
   *  de combat : c'est bien « a-t-elle tenu », pas « est-elle revenue »). */
  survived: number;
  damageDealt: number;
  damageTaken: number;
}

export interface GameResult {
  winner: 'player' | 'enemy' | 'draw';
  rounds: number;
  /** Combats coupés au chrono — un board défensif des deux côtés. */
  timeouts: number;
  playerHp: number;
  enemyHp: number;
  steps: number;
  units: UnitRecord[];
}

export interface RunGameDeps {
  playerDeck: Record<string, string[]>;
  enemyDeck: Record<string, string[]>;
  attributeList: AttributeDef[];
  cardDb: { getCard(id: string): Card | null };
  boards: BoardDef[];
  rand: () => number;
  /** Handicap plat donné à chaque unité de l'IA — cf. ENEMY_HANDICAP. */
  enemyBonus?: { atk: number; hp: number } | null;
}

export function runGame(deps: RunGameDeps): GameResult {
  const { rand } = deps;

  const cardsByTier: Record<number, Card[]> = {};
  for (let t = 1; t <= 5; t++) {
    cardsByTier[t] = (deps.playerDeck[String(t)] ?? [])
      .map(id => deps.cardDb.getCard(id))
      .filter((c): c is Card => !!c);
  }

  const session = new GameSession({
    cardsByTier,
    enemyDeck: deps.enemyDeck,
    attributeList: deps.attributeList,
    cardDb: deps.cardDb,
    // Le terrain est TIRÉ, donc semé comme le reste : cases bloquées et ligne
    // de vue pèsent réellement sur les unités à distance.
    getRandomBoard: () => (deps.boards.length ? deps.boards[Math.floor(rand() * deps.boards.length)] : null),
    // La Phase Shopping est hors périmètre (elle exigerait une politique de
    // magies pour l'IA) : rien ne la déclenche ici, la dep n'est jamais appelée.
    getRandomMagies: () => [],
    mode: 'ai',
    enemyBonus: deps.enemyBonus ?? null,
    rand,
  });

  const records = new Map<number, UnitRecord>();
  const recordOf = (u: Unit): UnitRecord => {
    let r = records.get(u.uid);
    if (!r) {
      r = { card_id: u.card_id, side: u.side as 'player' | 'enemy', combats: 0, survived: 0, damageDealt: 0, damageTaken: 0 };
      records.set(u.uid, r);
    }
    return r;
  };

  let rounds = 0;
  let timeouts = 0;
  let steps = 0;

  session.startPreparation();
  for (;;) {
    rounds++;
    playPreparation(session);

    const { combat, playerUnits, enemyUnits } = session.startCombat();
    for (const u of [...playerUnits, ...enemyUnits]) recordOf(u).combats++;

    // +5 : ceinture et bretelles. `CombatManager` se clôt lui-même à
    // MAX_COMBAT_TICKS (winner = 'timeout'), la borne n'est là que pour qu'un
    // combat qui ne se clôturerait pas ne fige pas 60 000 parties.
    let guard = 0;
    while (!combat.isOver && guard < MAX_COMBAT_TICKS + 5) {
      const events = combat.step() as any[];
      guard++;
      for (const ev of events) {
        if (ev.type === 'attack') {
          recordOf(ev.attacker).damageDealt += ev.damage ?? 0;
          recordOf(ev.target).damageTaken += ev.damage ?? 0;
        } else if (ev.type === 'power' && typeof ev.extra?.damage === 'number') {
          const targets = ev.targets ?? [];
          recordOf(ev.unit).damageDealt += ev.extra.damage * targets.length;
          for (const t of targets) recordOf(t).damageTaken += ev.extra.damage;
        } else if (ev.type === 'dot') {
          // ⚠️ Le flux d'événements ne nomme PAS la source d'un pulse (poison
          // et brûlure le partagent) : les dégâts sur la durée se comptent au
          // débit de la victime, jamais au crédit du lanceur. Élargir le
          // contrat d'événements de `logic/` pour ça casserait les golden tests.
          recordOf(ev.unit).damageTaken += ev.damage ?? 0;
        }
      }
    }
    steps += guard;
    if (combat.winner === 'timeout') timeouts++;

    // Survie relevée AVANT `finishCombat`, qui replace les unités réanimées :
    // la question mesurée est « a-t-elle tenu le combat ».
    for (const u of [...playerUnits, ...enemyUnits]) {
      if (!u.is_neutralized) recordOf(u).survived++;
    }

    const end = session.finishCombat();
    if (end.isGameOver) break;
    session.startNextRound();
    // La Phase Shopping se placerait ici.
  }

  return {
    winner: session.getWinner(),
    rounds,
    timeouts,
    playerHp: session.gameState.player_hp,
    enemyHp: session.gameState.enemy_hp,
    steps,
    units: [...records.values()],
  };
}
