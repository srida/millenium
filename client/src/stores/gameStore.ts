import { create } from 'zustand';
import type { Card, Position, SummonCondition } from '../logic/types.js';
import type { Unit } from '../logic/Unit.js';
import type { PhaseValue } from '../logic/GameState.js';
import type { GameController } from '../game/GameController.js';
import type { EndRoundResult } from '../logic/GameSession.js';
import { MULLIGAN_COST_HP } from '../logic/GameState.js';
import { SHOPPING_DURATION_S } from '../game/timings.js';

export interface HandEntry {
  key: string;      // identité stable pour React (signature de la carte)
  idx: number;      // index dans session.hand de l'exemplaire représentatif
  card: Card;
  count: number;    // exemplaires identiques regroupés sous cette entrée
  playable: boolean;
  selected: boolean;
}

export interface GraveyardEntry {
  uid: number;
  unit: Unit;
  candidate: boolean;  // sélectionnable comme matériau pour la carte en cours
  selected: boolean;   // déjà sélectionné comme matériau
}

export interface SynergyEntry {
  attr: { id: string; name: string; icon?: string };
  count: number;
  activeThreshold: unknown | null;
  nextThreshold: { count: number } | null;
}

export interface ShoppingState {
  magies: import('../logic/types.js').Magie[];
  awaitingTarget: 'unit' | 'graveyard' | 'hand' | null;
  /**
   * Ciblage de MAIN : les index de `session.hand` que cette magie peut servir
   * — le pendant du `setHighlight` que le ciblage d'unité pose sur le board.
   * `null` = toutes les cartes (`hand_to_graveyard`, `duplicate_card`,
   * `sacrifice_card_hp`), le cas de trois magies sur cinq.
   *
   * ⚠️ Des INDEX et non des cartes : `HandEntry.idx` désigne l'exemplaire
   * représentatif d'un groupe, et c'est lui que le tap transmet. Les
   * exemplaires d'un même groupe portent la même carte, donc la même validité.
   */
  handTargets: number[] | null;
  banner: string | null;
  /**
   * Le reroll de l'offre est-il proposé ? Faux quand le joueur n'a pas les PV,
   * quand le catalogue n'a plus rien de pertinent à montrer qu'il n'ait déjà vu
   * cette phase, et pendant un ciblage.
   *
   * ⚠️ FIGÉ à la publication de l'offre, pas relu à chaque rendu : la règle vit
   * dans `GameSession.canRerollShopping()` et balaie le catalogue de magies —
   * cf. `GameController._shoppingChoice`.
   */
  canReroll: boolean;
  /** Le prix du reroll en PV, pour que le bouton l'annonce sans le recopier. */
  rerollCost: number;
  /**
   * Ce que l'offre CONTIENT, à annoncer une fois — `shopping_bonus` (magies
   * supplémentaires) et/ou `guaranteed_magie` (magie garantie), posé par
   * `GameController._startShopping` depuis `GameSession.getLastShoppingBonusInfo()`.
   * Distinct de `banner` : celui-ci nomme une INSTRUCTION de ciblage, celui-là
   * une INFORMATION sur l'offre elle-même — les deux ne s'affichent jamais en
   * même temps (`info` seulement à l'écran de choix, `banner` seulement en
   * ciblage). `null` quand rien de tout ça ne s'est produit ce tour.
   */
  info: string | null;
}

/**
 * Le terrain annoncé à l'entrée en combat — `null` dès que le premier coup part.
 *
 * ⚠️ `boosted` compte les unités RÉELLEMENT touchées, avec le filtre même de
 * `BoardEffect.applyEffect` (`effectTargets`) : l'annonce ne peut donc pas dire
 * autre chose que ce que l'effet a fait. `null` quand l'effet ne lit pas
 * `target_attributes` (`draw_bonus`), auquel cas il n'y a aucun décompte à
 * afficher.
 */
export interface TerrainAlertSnapshot {
  board: import('../logic/types.js').BoardDef;
  boosted: { player: number; enemy: number } | null;
}

/**
 * Le changement de tour, annoncé à l'ouverture de la préparation, puis la
 * pioche du tour.
 *
 * ⚠️ Les deux sont des ÉTATS, pas des minuteurs : `GameController` possède
 * l'horloge qui les enchaîne (`roundIntro` → `drawPopup`), exactement comme il
 * possède celle de `terrainAlert`. Deux horloges pour un même départ finiraient
 * par ne plus s'accorder.
 *
 * ⚠️ La popup RÉVÈLE, elle ne PIOCHE pas : quand `drawPopup` apparaît, la main
 * est déjà remplie. Cf. `DrawSummary`.
 */
export interface RoundIntroSnapshot {
  round: number;
}

/**
 * Le volet de passage d'une phase à l'autre — préparation → combat, puis
 * récapitulatif → Phase Shopping.
 *
 * ⚠️ Il ne RETIENT rien, jamais : l'état de jeu est publié en même temps que
 * lui et le volet ne fait que le découvrir. C'est ce qui le distingue de
 * `terrainAlert` et de `combatOutro`, qui tiennent l'un le premier coup et
 * l'autre le récapitulatif. Le minuteur qui le retire vit quand même dans
 * `GameController` — comme toutes les horloges de la partie.
 *
 * ⚠️ `pointer-events-none` côté rendu : le volet recouvre l'annonce de terrain,
 * qui est justement tapable pendant qu'il passe.
 */
export interface PhaseWipeSnapshot {
  kind: 'combat' | 'shopping';
}

/**
 * La frappe finale, entre le dernier tick du combat et le récapitulatif.
 *
 * ⚠️ Les montants sont ceux qui ont DÉJÀ été appliqués (`finishCombat` précède
 * la publication) : l'outro donne à voir ce que les barres de vie sont en train
 * d'encaisser, il ne l'invente pas. Un camp qui n'encaisse pas ce round porte 0
 * — c'est la règle de `EndRoundResult.playerDamageDealt`, pas une absence.
 *
 * ⚠️ `combatActive` RESTE vrai tant qu'il dure : l'outro est la queue du
 * combat, pas une phase de plus. Sans ça la main, le cimetière et le panneau de
 * synergies réapparaîtraient une seconde et demie avant la popup.
 */
export interface CombatOutroSnapshot {
  winner: import('../logic/types.js').RoundWinner;
  /** Dégâts que les survivants du JOUEUR viennent d'infliger (0 si aucun). */
  playerDamage: number;
  enemyDamage: number;
}

/**
 * Le menu de choix d'une carte à plusieurs conditions.
 *
 * ⚠️ Une option ne porte PLUS de libellé : il n'y a plus de voie d'invocation à
 * nommer, une condition se dit par son coût. C'est `components/ui/SummonRecipe`
 * qui la met en mots, exactement comme dans le tooltip. Le champ `label` avait
 * survécu ici seul et rendait la modale muette.
 */
export interface SummonOptionMenuSnapshot {
  card: Card;
  options: { index: number; condition: SummonCondition; ok: boolean; reason?: string }[];
}

// Instantané destiné à React — recalculé après chaque mutation par le controller.
export interface GameSnapshot {
  round: number;
  phase: PhaseValue;
  playerHp: number;
  enemyHp: number;
  playerMultiplier: number;
  enemyMultiplier: number;
  boardSlots: number;
  placedCount: number;
  /** Quelque chose a été posé/déplacé depuis l'ouverture du tour → le bouton
   *  « Tout annuler » de la barre de préparation s'affiche. */
  canUndo: boolean;
  /** Le mulligan est proposé → le bouton 🔄 de la barre de préparation
   *  s'affiche. Vrai au tour 1 seulement, tant que rien n'a été posé ni déplacé
   *  et que le mulligan n'a pas déjà été joué (cf. `GameSession.canMulligan`).
   *  ⚠️ Il s'exclut donc de `canUndo` : les deux ne sont jamais vrais ensemble,
   *  et le 🔄 cède sa place au ↺ dès la première invocation. */
  canMulligan: boolean;
  /** Le prix du mulligan en PV, pour que la confirmation l'annonce sans le
   *  recopier. */
  mulliganCost: number;
  hand: HandEntry[];
  graveyard: GraveyardEntry[];
  synergies: SynergyEntry[];
  invocationBanner: string | null;
  errorFlash: string | null;
  boardTerrain: import('../logic/types.js').BoardDef | null;
  terrainAlert: TerrainAlertSnapshot | null;
  /** « TOUR 3 / 5 », le temps de `ROUND_INTRO_MS`, puis la popup de pioche. */
  roundIntro: RoundIntroSnapshot | null;
  /** La pioche du tour, en attente du tap qui la révèle. Gèle le chrono de
   *  préparation en solo ; en PvP il continue (cf. `DRAW_POPUP_AUTO_MS`). */
  drawPopup: import('../logic/types.js').DrawSummary | null;
  combatActive: boolean;
  /** La frappe finale, tant qu'elle dure — puis `endRound` prend le relais. */
  combatOutro: CombatOutroSnapshot | null;
  /** Le volet de passage entre deux phases. Purement décoratif. */
  phaseWipe: PhaseWipeSnapshot | null;
  combatRemaining: number;   // secondes restantes de combat
  speed: number;
  paused: boolean;
  prepRemaining: number;   // secondes restantes de préparation
  endRound: EndRoundResult | null;
  shopping: ShoppingState | null;
  shoppingRemaining: number;   // secondes restantes de la Phase Shopping
  summonOptions: SummonOptionMenuSnapshot | null;
  menuOpen: boolean;         // menu d'options ouvert → met la préparation en pause
  // Le coach du tutoriel attend un tap → gèle les chronos (préparation,
  // shopping, récapitulatif de round), sur le modèle de `menuOpen`. Toujours
  // faux hors tutoriel : les autres modes sont strictement inchangés.
  coachBlocking: boolean;
  gameOver: boolean;
  winner: 'player' | 'enemy' | 'draw' | null;
  // PvP uniquement
  pvpOpponent: string | null;   // pseudo de l'adversaire
  pvpWaiting: boolean;          // en attente de l'adversaire (poignée de main / résultat)
}

export const EMPTY_SNAPSHOT: GameSnapshot = {
  round: 1, phase: 'preparation', playerHp: 1000, enemyHp: 1000,
  playerMultiplier: 1, enemyMultiplier: 1, boardSlots: 5, placedCount: 0, canUndo: false,
  canMulligan: false, mulliganCost: MULLIGAN_COST_HP,
  hand: [], graveyard: [], synergies: [], invocationBanner: null, errorFlash: null,
  boardTerrain: null, terrainAlert: null, roundIntro: null, drawPopup: null,
  combatActive: false, combatOutro: null, phaseWipe: null, combatRemaining: 60, speed: 2, paused: false,
  prepRemaining: 60, endRound: null, shopping: null, shoppingRemaining: SHOPPING_DURATION_S, summonOptions: null,
  menuOpen: false, coachBlocking: false, gameOver: false, winner: null, pvpOpponent: null, pvpWaiting: false,
};

interface GameStoreState extends GameSnapshot {
  controller: GameController | null;
  setController: (c: GameController | null) => void;
  applySnapshot: (s: Partial<GameSnapshot>) => void;
  reset: () => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  ...EMPTY_SNAPSHOT,
  controller: null,
  setController: (controller) => set({ controller }),
  applySnapshot: (s) => set(s),
  reset: () => set({ ...EMPTY_SNAPSHOT }),
}));

// Sélecteur utilitaire : position d'une cellule sous forme de clé "col,row".
export function cellKey(p: Position): string { return `${p.col},${p.row}`; }
