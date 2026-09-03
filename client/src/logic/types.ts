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
  /** Vide/absent = tous les archétypes. */
  target_attributes?: string[];
  /**
   * Voies d'invocation visées — clés du catalogue `summon_types` (`normal`,
   * `sacrifice`, `fusion`, `heritage`, `transformation`, `multi`). Vide/absent
   * = toutes.
   *
   * ⚠️ Les deux ciblages se CUMULENT (ET) : un effet qui porte les deux ne
   * touche qu'une unité qui satisfait les deux. Cf. `BoardEffect.effectTargets`.
   */
  target_summon_types?: string[];
}

export interface BoardDef {
  id: string;
  name: string;
  blocked_cells?: Position[];
  /**
   * ⚠️ Forme HISTORIQUE — un seul effet, encore portée par les terrains livrés
   * et par `data/boards.json` sur le volume. `effects` la remplace et l'emporte
   * quand elle est présente ; `BoardEffect.boardEffects()` est le SEUL lecteur
   * des deux, personne d'autre ne doit lire l'un ou l'autre champ.
   */
  effect?: BoardEffectDef | null;
  /** Effets CUMULÉS du terrain — tous appliqués, dans l'ordre de la liste. */
  effects?: BoardEffectDef[] | null;
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
  /** `guaranteed_draw` : voie d'invocation exigée (`summon_type` de la carte).
   *  Se cumule avec `tier` — les deux filtres sont ET-és par `startPreparation`.
   *  Nommé `category` et non `summon_type` pour coller à `GuaranteedDraw`, la
   *  forme que le moteur consomme déjà pour les effets d'attribut. */
  category?: string;
  /** `grant_power` : le pouvoir posé sur l'unité, et sa vitesse de chargement.
   *  ⚠️ La vitesse est OBLIGATOIRE — sans elle l'unité hérite de 9999
   *  (`Unit`), c'est-à-dire d'un pouvoir qui ne part jamais. */
  power_id?: string;
  power_speed?: number;
}

/** Palier de rareté d'une magie : 1 Commune · 2 Rare · 3 Légendaire. */
export type MagieRarity = 1 | 2 | 3;

export interface Magie {
  id: string;
  name: string;
  effect: MagieEffectDef | null;
  /** ⚠️ À la RACINE, pas dans `effect` : une magie sans effet a quand même une
   *  rareté, et deux magies du même type d'effet peuvent différer de palier
   *  (MAGIE_016 « -2 sacrifices » contre MAGIE_017 « -1 »). FACULTATIF —
   *  absent ou hors bornes = Commune (`MagieOffer.rarityOf`), ce qui rend
   *  inoffensives les magies écrites avant l'existence du champ. */
  rarity?: MagieRarity;
  /** Contrecoup : PV du joueur prélevés à l'application. À la RACINE pour la
   *  même raison que `rarity` — il est orthogonal au type d'effet, et son
   *  absence vaut « aucun contrecoup » (cf. `MagieEffect.magieCostHp`). */
  cost_hp?: number;
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

/**
 * D'OÙ vient une pioche supplémentaire — une ligne par octroi.
 *
 * `player_extra_draws` est UN nombre, écrit par trois modules qui ne se
 * connaissent pas (magie, attribut, terrain) : la provenance y était perdue, et
 * c'est justement ce que la popup de pioche doit montrer. Ce registre est le
 * même octroi, raconté ; il n'entre dans aucun calcul.
 *
 * ⚠️ On stocke des IDS, jamais des libellés : `logic/` n'importe pas `data/`.
 * C'est la couche React qui résout `ARCH_012` → « Magiciens Sombres ».
 */
export interface DrawSourceEntry {
  kind: 'magie' | 'attribut' | 'terrain';
  /** Id de la magie, de l'attribut ou du terrain qui a crédité la pioche. */
  ref: string;
  /** Cartes créditées. 0 pour une pioche garantie, qui prend un slot existant. */
  value: number;
  /** Pioche GARANTIE (un slot de la main normale, pas une carte de plus). */
  guaranteed?: boolean;
}

/** Résultat de AttributeManager.applyEndOfCombat(). */
export interface EndOfCombatAttributeResult {
  revived?: Unit[];
  draw_bonus?: number;
  guaranteed_draws?: GuaranteedDraw[];
  board_slot_bonus?: number;
  damage_multiplier_bonus?: number;
  shopping_bonus?: number;
  /** Provenance des deux précédents, attribut par attribut (cf. DrawSourceEntry).
   *  ⚠️ Inscrit APRÈS le plafond `max` : le registre annonce ce qui est
   *  réellement crédité, pas ce que l'effet demandait. */
  draw_sources?: DrawSourceEntry[];
}

/**
 * Ce que le tour vient de donner au joueur — rendu par
 * `GameSession.startPreparation()` et affiché par la popup de pioche.
 *
 * ⚠️ La popup RÉVÈLE, elle ne PIOCHE pas : le tirage a déjà eu lieu quand ce
 * résumé est rendu. Le différer jusqu'au tap du joueur décalerait le flux semé
 * de la simulation et du filet de déterminisme PvP, et déplacerait le point de
 * capture de « Tout annuler ».
 */
export interface DrawSummary {
  round: number;
  /** Les tiers piochables ce tour (`Draw.tiersForRound`). */
  tiers: number[];
  /** La pioche de base, avant tout bonus (`HAND_SIZE`). */
  baseCount: number;
  /** Cartes EN PLUS, consommées de `player_extra_draws`. */
  extraDraws: number;
  /** Pioches garanties honorées — elles occupent un slot de la main normale. */
  guaranteed: GuaranteedDraw[];
  /** Ce qui est RÉELLEMENT entré en main : mesuré, jamais recalculé. */
  drawnCount: number;
  /** Taille de la main après pioche (elle s'accumule entre les tours). */
  handSizeAfter: number;
  /** D'où viennent les bonus — vide au tour d'ouverture. */
  sources: DrawSourceEntry[];
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
