// Pilote du Labo IA — fait délibérer `EnemyAI` sur un état posé à la main et
// rend la trace de ses décisions.
//
// ⚠️ PUR : aucune dépendance à React, Zustand, Three ni au DOM. C'est ce qui le
// rend testable dans une suite qui tourne en node sans jsdom — l'écran
// (`dev/AiLab.tsx`) ne fait que rendre ce qu'il produit. Même partage que
// `sim/runGame.ts`, qui pilote une `GameSession` sans rien afficher.
//
// ⚠️ Il ne RÉIMPLÉMENTE rien. Le placement, les motifs de refus et le
// rangement viennent tous de `logic/EnemyAI` ; une seconde copie des règles
// finirait par ne plus dire la même chose que celle qui est jouée — c'est très
// exactement ce que le labo existe pour constater.
import { Board } from '../logic/Board.js';
import { Unit } from '../logic/Unit.js';
import { EnemyAI } from '../logic/EnemyAI.js';
import { seededRandom } from '../logic/Random.js';
import { materialValueOf } from '../logic/InvocationManager.js';
import type { Card, GuaranteedDraw, Position } from '../logic/types.js';

/** La zone de l'IA — les seules rangées que le labo montre et manipule. */
export const AI_ROW_MIN = 7;
export const AI_ROW_MAX = 10;
export const AI_COLS = 5;

export interface CardDbLike {
  getCard(id: string): Card | null;
}

/** Une unité posée à la main sur la grille du labo. */
export interface LabUnitInput {
  card_id: string;
  col: number;
  row: number;
}

/** Ce que la trace dit d'une unité : son identité, et ce qui décide de son rangement. */
export interface LabUnitRow {
  uid: number;
  card_id: string;
  col: number | null;
  row: number | null;
  range: number;
  max_hp: number;
  atk: number;
}

export interface LabUnitRef {
  uid: number;
  card_id: string;
}

/** Les événements émis par `EnemyAI` à travers le sink de trace. */
export type AiTraceEvent =
  | {
      kind: 'draw';
      round: number;
      tiers: number[];
      pool_size: number;
      /** Ce que l'IA tenait déjà — sa main s'accumule, comme celle du joueur. */
      kept?: string[];
      /** Les cartes ajoutées par CE tirage. */
      drawn?: string[];
      /** La main résultante : `kept` puis `drawn`. */
      hand: string[];
    }
  | { kind: 'pass_start'; pass: number; order: string[] }
  | {
      kind: 'attempt';
      pass: number;
      card_id: string;
      /** L'index de la condition RETENUE quand la carte en a plusieurs.
       *  Remplace le couple `summon_type`/`option_index` : il n'y a plus de
       *  voie à nommer, seulement la condition qu'on a réussi à payer. */
      condition_index: number | null;
      outcome: 'placed' | 'refused';
      reason: string | null;
      detail: Record<string, unknown> | null;
      cell: Position | null;
      consumed: { board: LabUnitRef[]; graveyard: LabUnitRef[] };
    }
  | { kind: 'pass_end'; pass: number; placed: number; unplaced: string[] }
  | { kind: 'rearrange'; before: LabUnitRow[]; after: LabUnitRow[]; dropped: LabUnitRow[] };

export interface AiLabInput {
  /** Deck confié à l'IA : { "1": ["CORE_001", …], … } — la forme de `sets.json`. */
  deck: Record<string, string[]>;
  cardDb: CardDbLike;
  round: number;
  /** `enemy_board_slots` : 5, ou 6 avec certaines synergies. */
  slots: number;
  /** Survivants du round précédent, déjà sur le board. */
  survivors: LabUnitInput[];
  /** Cimetière de l'IA — matériaux disponibles, consommés en place. */
  graveyard: string[];
  /**
   * Cartes que l'IA tient DÉJÀ en entrant dans le round (`null` ≡ aucune) —
   * le report de ce qu'elle n'a pas posé au round précédent, ou une main
   * composée à la main pour reproduire un cas.
   */
  hand: string[] | null;
  /**
   * Piocher les 5 cartes du round PAR-DESSUS ce qu'elle tient.
   *
   * ⚠️ Les deux ne sont pas exclusifs, et c'est tout le sujet : en jeu l'IA
   * pioche à CHAQUE round et sa main s'accumule (`EnemyAI.drawHand` ajoute au
   * lieu de remplacer). Le labo ne savait faire que l'un ou l'autre — piocher
   * dans une main vide, ou imposer une main sans piocher —, si bien qu'un run
   * multi-rounds ne piochait plus rien dès le round 2 : la rétention de main
   * y était invisible, sur l'écran fait pour l'observer.
   */
  draw: boolean;
  /** Graine lisible : un tirage douteux se rejoue au lieu de se raconter. */
  seed: string;
  /** Handicap plat par unité, le réglage de difficulté du mode Arcade. */
  enemyBonus?: { atk: number; hp: number } | null;
  /**
   * `gameState.enemy_extra_draws` / `enemy_guaranteed_draws` du round —
   * pendant enemy des bonus de pioche du joueur (attributs `draw_bonus` /
   * `guaranteed_draw`). En jeu, `GameSession._placeEnemyUnits` les alimente
   * depuis `AttributeManager.applyEndOfCombat` ; le labo ne joue aucun
   * combat, donc pas de source automatique — on les pose ici pour reproduire
   * le round qui aurait suivi un combat où l'IA a déclenché l'attribut.
   * Défauts à « aucun bonus » : un run existant n'a rien à changer.
   */
  extraDraws?: number;
  guaranteedDraws?: GuaranteedDraw[];
}

export interface AiLabRound {
  round: number;
  slots: number;
  seed: string;
  enemy_bonus: { atk: number; hp: number } | null;
  /**
   * D'où vient la main de départ : `draw` (piochée seule), `manual` (imposée,
   * sans pioche) ou `carry_draw` (report + pioche par-dessus — ce que fait
   * l'IA en jeu à partir du round 2).
   */
  hand_source: 'draw' | 'manual' | 'carry_draw';
  /** Les cartes DÉJÀ tenues à l'entrée du round, avant la pioche. */
  hand_carried: string[];
  /** La main complète au moment de placer : report + pioche. */
  hand: string[];
  survivors_in: LabUnitRow[];
  graveyard_in: string[];
  events: AiTraceEvent[];
  /** Le board après placement ET rangement — l'état que le round suivant reprend. */
  board_after: LabUnitRow[];
  /** Cartes restées en main : l'IA n'a rien trouvé à en faire. */
  hand_left: string[];
  /** Cimetière après consommation des matériaux. */
  graveyard_left: string[];
  /** Cartes du deck ou du cimetière introuvables au catalogue. */
  unknown_cards: string[];
}

/**
 * Renumérote les `uid` en index LOCAUX au run, dans l'ordre de première
 * apparition.
 *
 * ⚠️ `Unit.uid` sort d'un compteur de MODULE : il grandit sur toute la vie de
 * l'onglet, si bien que deux exécutions du même scénario rendent deux traces
 * différentes — impossibles à differ, alors que le log existe justement pour
 * être comparé et envoyé. Le `uid` garde toute sa valeur À L'INTÉRIEUR d'un run
 * (il distingue deux exemplaires de la même carte au cimetière, là où
 * `card_id` ne suffit pas) ; c'est sa portée globale qui ne veut rien dire
 * dehors. Même leçon que `CombatRecorder`, qui a écarté l'`uid` de sa forme
 * canonique pour exactement cette raison.
 */
function canonicaliseUids<T>(value: T, seen: Map<number, number>): T {
  if (Array.isArray(value)) return value.map(v => canonicaliseUids(v, seen)) as unknown as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'uid' && typeof v === 'number') {
      if (!seen.has(v)) seen.set(v, seen.size);
      out[k] = seen.get(v);
    } else {
      out[k] = canonicaliseUids(v, seen);
    }
  }
  return out as T;
}

function unitRow(u: Unit): LabUnitRow {
  return {
    uid: u.uid,
    card_id: u.card_id,
    col: u.position?.col ?? null,
    row: u.position?.row ?? null,
    range: u.range,
    max_hp: u.max_hp,
    atk: u.atk,
  };
}

/**
 * Handicap plat appliqué aux unités de l'IA.
 *
 * ⚠️ Recopie DÉLIBÉRÉMENT le geste de `GameSession._applyEnemyBonus`, qui est
 * privé et inatteignable depuis le labo : bonus écrit dans `_base` (la seule
 * voie permanente — `_stat_bonuses` est balayé par `resetCombatStats()`), et
 * marqueur d'instance pour qu'un survivant déjà boosté ne le reçoive pas deux
 * fois. Si l'un des deux dérive, `ai-lab.test.ts` le dit.
 */
function applyEnemyBonus(units: Unit[], bonus: { atk: number; hp: number } | null | undefined): void {
  if (!bonus || (!bonus.atk && !bonus.hp)) return;
  for (const unit of units) {
    if (unit._enemy_bonus_applied) continue;
    unit._enemy_bonus_applied = true;
    if (bonus.atk) unit._base.atk = Math.max(1, unit._base.atk + bonus.atk);
    if (bonus.hp) {
      unit._base.hp = Math.max(1, unit._base.hp + bonus.hp);
      unit.current_hp += bonus.hp;
    }
    unit._recomputeStats();
  }
}

/**
 * Fait jouer un round de placement à l'IA sur l'état décrit, et rend tout ce
 * qu'elle a décidé — y compris ce qu'elle a REFUSÉ de faire, et pourquoi.
 *
 * Aucun combat : le labo n'observe que le choix des cartes et le placement.
 * Un run multi-rounds n'est qu'une suite d'appels dont le `board_after` de l'un
 * devient les `survivors` du suivant — il n'y a aucun état caché à porter.
 */
/**
 * Une unité d'entrée, reconstruite depuis sa carte.
 *
 * ⚠️ `material_value` est DÉRIVÉE, elle n'est pas laissée à 1. Le labo rebâtit
 * survivants et cimetière depuis leur seul `card_id` — tout le reste de leur
 * histoire est perdu (PV courants, vétérance, bonus de Shopping), et c'est
 * assumé. Mais celle-ci ne dépend que de la carte : la laisser à 1 ferait
 * dépenser au labo plus d'unités que la vraie partie n'en dépense, sur une run
 * multi-rounds — c'est-à-dire mentir sur la chose même que l'écran mesure.
 */
function rebuild(card: Card): Unit {
  const unit = new Unit(card, 'enemy');
  unit.material_value = materialValueOf(card);
  return unit;
}

export function runAiPlacement(input: AiLabInput): AiLabRound {
  const { deck, cardDb, round, slots, seed } = input;
  const unknown: string[] = [];
  const resolve = (id: string): Card | null => {
    const card = cardDb.getCard(id);
    if (!card) unknown.push(id);
    return card;
  };

  const board = new Board();
  const ai = new EnemyAI(deck, cardDb, 'enemy', seededRandom(seed, round));

  // Survivants : reposés tels quels, dans les coordonnées réelles du plateau.
  // Une case déjà prise ou hors zone est ignorée plutôt que fatale — l'écran
  // ne peut pas en produire, mais un run rejoué depuis un JSON édité à la main,
  // si.
  for (const s of input.survivors) {
    const card = resolve(s.card_id);
    if (!card) continue;
    const pos = { col: s.col, row: s.row };
    if (!board.isInBounds(pos) || !board.isEnemyCell(pos) || board.isOccupied(pos)) continue;
    board.placeUnit(rebuild(card), pos);
  }

  // Cimetière : des unités hors board, que l'IA consomme comme matériaux.
  // `EnemyAI` le MUTE en place (splice) — on lui passe donc un tableau à nous.
  const graveyard: Unit[] = [];
  for (const id of input.graveyard) {
    const card = resolve(id);
    if (!card) continue;
    const u = rebuild(card);
    u.is_neutralized = true;
    graveyard.push(u);
  }

  const events: AiTraceEvent[] = [];
  const trace = (evt: AiTraceEvent) => { events.push(evt); };

  const survivorsIn = board.getLivingUnitsOnSide('enemy').map(unitRow);

  // Ce qu'elle tient déjà, PUIS la pioche par-dessus — l'ordre exact du jeu
  // (`GameSession._placeEnemyUnits` appelle `drawHand` sur une IA qui a gardé
  // sa main du round précédent).
  const carried = (input.hand ?? []).map(resolve).filter(Boolean) as Card[];
  if (carried.length > 0) ai.setHand(carried);
  const handCarried = carried.map(c => c.id);

  if (input.draw) {
    ai.drawHand(round, trace, input.extraDraws ?? 0, input.guaranteedDraws ?? []);
  } else {
    // Pas de pioche : la trace dit quand même de quoi la main est faite, pour
    // que le log se lise pareil dans les deux cas.
    trace({
      kind: 'draw', round, tiers: [], pool_size: 0,
      kept: handCarried, drawn: [], hand: handCarried,
    });
  }
  const handSource: AiLabRound['hand_source'] =
    input.draw ? (handCarried.length > 0 ? 'carry_draw' : 'draw') : 'manual';
  const handIn = ai.getHand().map(c => c.id);

  ai.placeFromHand(board, slots, graveyard, trace);
  ai.rearrangeUnits(board, slots, trace);

  const after = board.getLivingUnitsOnSide('enemy');
  applyEnemyBonus(after, input.enemyBonus);

  // Une seule table pour tout le run : `survivors_in`, les événements et
  // `board_after` doivent parler des mêmes unités sous les mêmes numéros.
  const uids = new Map<number, number>();

  return canonicaliseUids({
    round,
    slots,
    seed,
    enemy_bonus: input.enemyBonus ?? null,
    hand_source: handSource,
    hand_carried: handCarried,
    hand: handIn,
    survivors_in: survivorsIn,
    graveyard_in: input.graveyard,
    events,
    board_after: after.map(unitRow),
    hand_left: ai.getHand().map(c => c.id),
    graveyard_left: graveyard.map(u => u.card_id),
    unknown_cards: [...new Set(unknown)],
  }, uids);
}

/** L'état de la main du labo : ce qu'elle tient, et si la pioche du round s'y ajoute. */
export interface LabHandState {
  hand: string[];
  draw: boolean;
}

/**
 * Ce que devient l'état de la main quand on la retouche à l'écran.
 *
 * `kept` est la main VOULUE, telle qu'on vient de l'éditer. Après un placement,
 * l'écran n'affiche plus la main d'entrée mais `hand_left` — ce que l'IA tient
 * ENCORE, les cartes posées en ayant disparu —, si bien que `kept` porte alors
 * des cartes qui sortent du tirage du round.
 *
 * ⚠️ C'est là qu'est le piège : `EnemyAI.drawHand` AJOUTE à la main, et le
 * tirage est SEMÉ sur (graine, round). Garder le reliquat d'un placement avec
 * la pioche encore armée ferait donc retomber les mêmes cinq cartes par-dessus
 * au « Placer » suivant, et l'IA délibérerait sur des doublons qu'elle n'a
 * jamais eus en main. On coupe donc la pioche dès qu'on fige des cartes déjà
 * tirées — le geste exact de « Figer la pioche ». Une main VIDÉE ne fige rien :
 * la pioche y reste armée, sinon « Vider » rendrait le round injouable.
 */
export function handAfterEdit(
  state: LabHandState,
  kept: string[],
  afterPlacement: boolean,
): LabHandState {
  const freezesDrawnCards = afterPlacement && kept.length > 0;
  return { hand: kept, draw: freezesDrawnCards ? false : state.draw };
}

/**
 * Glose française des motifs de refus. Elle vit ICI, contre les slugs qu'elle
 * décrit : ce sont les mots d'`EnemyAI`, pas ceux d'un écran.
 *
 * ⚠️ `admin.html` en tient une COPIE (il ne peut rien importer d'un module TS),
 * exactement comme `PVP_KINDS` recopie le vocabulaire de `pvplog.diff`. La
 * dérive est bénigne — un motif sans glose s'affiche par son slug — mais un
 * motif ajouté ici est à reporter là-bas.
 */
export const REASON_LABELS: Record<string, string> = {
  board_full: 'plus de place — le cap de slots est atteint',
  duplicate_on_board: 'un exemplaire de cette carte est déjà sur le terrain',
  no_free_cell: 'aucune case libre dans la zone',
  not_enough_material: 'pas assez de matériaux (terrain + cimetière)',
  duplicate_needs_extra_material: 'le doublon consommé ne suffit pas',
  would_exceed_slots: 'dépasserait le nombre de slots — pas assez de place libérée',
  missing_material: 'matériau manquant',
  all_conditions_failed: 'aucune de ses conditions ne passe',
};

/** Le motif, glosé, avec le détail qui le rend actionnable (le matériau nommé). */
export function reasonLabel(reason: string | null, detail: Record<string, unknown> | null): string {
  if (!reason) return '';
  const base = REASON_LABELS[reason] ?? reason;
  const material = detail && typeof detail.material === 'string' ? detail.material : null;
  return material ? `${base} : ${material}` : base;
}

/** Compte les refus par motif — la seule agrégation qui dise quelque chose d'un run. */
export function refusalCounts(rounds: AiLabRound[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rounds) {
    for (const e of r.events) {
      if (e.kind !== 'attempt' || e.outcome !== 'refused' || !e.reason) continue;
      counts[e.reason] = (counts[e.reason] ?? 0) + 1;
    }
  }
  return counts;
}

/** Nombre d'unités effectivement posées sur l'ensemble des rounds. */
export function placedCount(rounds: AiLabRound[]): number {
  return rounds.reduce(
    (n, r) => n + r.events.filter(e => e.kind === 'attempt' && e.outcome === 'placed').length,
    0,
  );
}
