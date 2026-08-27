// Types du domaine — contrat entre logic/, data/, stores/ et three/.
// Source de vérité : les JSON servis par l'API Express (cards, attributes,
// powers, boards, magies) et les shapes runtime de logic/.
import type { Unit } from './Unit.js';

// ── Géométrie ──

export interface Position {
  col: number;
  row: number;
}

export type Side = 'player' | 'enemy';

// ── Cartes ──

export interface CardStats {
  atk: number;
  hp: number;
  movement_speed: number;
  attack_speed: number;
  initiative: number;
  range: number;
}

export interface CardPower {
  id: string;
  power_speed?: number;
  value?: number | null;
}

export type SummonType = 'normal' | 'sacrifice' | 'fusion' | 'heritage' | 'transformation';

export interface SummonCost {
  sacrifice?: number;
  materials?: string[];
}

export interface SummonOption {
  summon_type: SummonType;
  cost?: SummonCost;
}

export interface Card {
  id: string;
  name: string;
  tier: number;
  summon_type: SummonType;
  stats: CardStats;
  cost?: SummonCost;
  power?: CardPower | null;
  attributes?: string[];
  /** Lignée : IDs que l'unité résultante « représente » pour le matching de matériaux. */
  represented_ids?: string[];
  summon_options?: SummonOption[];
  _has_illustration?: boolean;
  /** Posé par le modifier de main free_transformation (magie). */
  _free_transformation?: boolean;
  /** Coût sacrifice d'origine quand reduce_sacrifice_cost l'a modifié. */
  _original_sacrifice?: number;
  /** Nombre de matériels retirés par remove_fusion_material (magie). */
  _removed_materials?: number;
}

// ── Attributs (synergies) ──

export type AttributeTiming = 'start_of_combat' | 'during_combat' | 'end_of_combat';

export interface AttributeEffect {
  type: string; // stat_bonus | stat_modifier | shield | effect_immunity | revive | draw_bonus | guaranteed_draw | board_slot_bonus | damage_multiplier_bonus | shopping_bonus
  stat?: string;
  value?: number;
  /** stat_bonus : multiplie value par le nombre d'ennemis portant cet attribut. */
  value_per?: string;
  /** stat_modifier : on_ally_neutralized | on_enemy_neutralized */
  trigger?: string;
  category?: string;
  attribute?: string | null;
  hp_percent?: number;
  max?: number;
}

export interface AttributeThreshold {
  count: number;
  effects: AttributeEffect[];
}

export interface AttributeDef {
  id: string;
  name: string;
  /** Emoji — REPLI quand aucune image n'a été importée depuis l'admin. */
  icon?: string;
  categorie?: string;
  timing: AttributeTiming;
  thresholds: AttributeThreshold[];
  /**
   * Icône de l'attribut, servie sur /illustrations/<id> — l'art vit dans le
   * dossier des illustrations, sous l'id de l'attribut. Calculé par le serveur
   * à la lecture, jamais persisté (même statut que sur BoardDef).
   */
  _has_illustration?: boolean;
}

// ── Pouvoirs (référentiel affiché ; la résolution vit dans CombatManager) ──

export interface PowerDef {
  id: string;
  name: string;
  description?: string;
  power_speed?: number;
  value?: number | null;
}

// ── Terrains de combat ──

export interface BoardEffectDef {
  type: string; // stat_bonus | stat_modifier | shield | draw_bonus
  stat?: string;
  value?: number;
  /** Vide/absent = toutes les unités des deux camps. */
  target_attributes?: string[];
}

export interface BoardDef {
  id: string;
  name: string;
  blocked_cells?: Position[];
  effect?: BoardEffectDef | null;
  _has_illustration?: boolean;
  // Fond de grille (vue de dessus 5:11) servi sur /board-backgrounds/<id>.
  // Calculé par le serveur à la lecture, jamais persisté — même statut que
  // `_has_illustration`.
  _has_background?: boolean;
}

// ── Magies (Phase Shopping) ──

export interface MagieEffectDef {
  type: string;
  stat?: string;
  value?: number;
  tier?: number;
}

export interface Magie {
  id: string;
  name: string;
  effect: MagieEffectDef | null;
  _has_illustration?: boolean;
}

// ── État de partie ──

export type RoundWinner = 'player' | 'enemy' | 'draw' | 'timeout';

export interface GuaranteedDraw {
  tier?: number;
  category?: string;
  attribute?: string | null;
}

export interface HandModifier {
  type: 'reduce_sacrifice_cost' | 'free_transformation' | 'remove_heritage_material'
    | 'remove_fusion_material';
  value?: number;
}

/** Résultat de AttributeManager.applyEndOfCombat(). */
export interface EndOfCombatAttributeResult {
  revived?: Unit[];
  draw_bonus?: number;
  guaranteed_draws?: GuaranteedDraw[];
  board_slot_bonus?: number;
  damage_multiplier_bonus?: number;
  shopping_bonus?: number;
}

// ── Événements de combat (CombatManager.step()) ──

export interface DotEffect {
  damage: number;
  interval: number;
  timer: number;
  // No `remaining`: a DOT lasts the whole round, cleared only by the status
  // purges (end of combat, POWER_DEBUFF, revive magic).
}

// No `attacksRemaining`: like DotEffect, the curse lasts the whole round.
export interface BurnStack {
  damage: number;
}

export type CombatEvent =
  | { type: 'move'; unit: Unit; from: Position; to: Position }
  | { type: 'attack'; attacker: Unit; target: Unit; damage: number }
  | { type: 'power'; unit: Unit; targets: Unit[]; power_id: string; extra?: Record<string, unknown> }
  | { type: 'dot'; unit: Unit; damage: number }
  | { type: 'freeze'; cell: Position; expiresAtStep: number }
  | { type: 'stat_change'; unit: Unit; stat: string; value: number }
  | { type: 'death'; unit: Unit }
  | { type: 'combat_end'; winner: RoundWinner };
