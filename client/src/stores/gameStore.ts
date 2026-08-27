import { create } from 'zustand';
import type { Card, Position } from '../logic/types.js';
import type { Unit } from '../logic/Unit.js';
import type { PhaseValue } from '../logic/GameState.js';
import type { GameController } from '../game/GameController.js';
import type { EndRoundResult } from '../logic/GameSession.js';
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
  banner: string | null;
}

export interface SummonOptionMenuSnapshot {
  card: Card;
  options: { index: number; summon_type: string; label: string; ok: boolean }[];
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
  hand: HandEntry[];
  graveyard: GraveyardEntry[];
  synergies: SynergyEntry[];
  invocationBanner: string | null;
  errorFlash: string | null;
  boardTerrain: import('../logic/types.js').BoardDef | null;
  combatActive: boolean;
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
  hand: [], graveyard: [], synergies: [], invocationBanner: null, errorFlash: null,
  boardTerrain: null, combatActive: false, combatRemaining: 60, speed: 2, paused: false,
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
