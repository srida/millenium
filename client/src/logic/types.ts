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

/**
 * Une condition d'invocation : ce que la carte exige pour être posée.
 *
 * `materials` est le nombre de **slots** de matériau à consommer (compté en
 * `material_value`, pas en unités) ; `requires` contraint une partie de ces
 * slots à des cartes ou des attributs (`ARCH_*`) précis — la sémantique « dont »,
 * jamais « en plus ». D'où l'invariant `requires.length <= materials`.
 *
 * Une carte sans condition (`summon_conditions` absent ou vide) se pose
 * directement : c'est l'ancienne invocation « normale ».
 */
export interface SummonCondition {
  materials: number;
  requires?: string[];
}

export interface Card {
  id: string;
  name: string;
  /**
   * Les tiers RÉSOLUS depuis les attributs, triés. Calculé au chargement du
   * catalogue et jamais persisté — même statut que `_has_illustration` et
   * `_starter`. Se lit par `logic/Tiers.tiersOf`, jamais à la main.
   */
  _tiers?: number[];
  stats: CardStats;
  power?: CardPower | null;
  attributes?: string[];
  /** Lignée : IDs que l'unité résultante « représente » pour le matching de matériaux. */
  represented_ids?: string[];
  /**
   * Les voies d'invocation de la carte : la carte est jouable dès qu'**une**
   * condition est satisfaite. Absent ou vide = aucune condition.
   */
  summon_conditions?: SummonCondition[];
  /**
   * Combien de slots de matériau vaut l'unité produite quand elle est
   * consommée. Donnée de carte (saisie en admin), plus jamais dérivée de la
   * recette jouée — sans quoi une carte à conditions multiples vaudrait deux
   * choses différentes selon la voie empruntée, et l'IA une troisième.
   */
  material_value?: number;
  _has_illustration?: boolean;
  /**
   * Conditions remisées par une magie de main, et la condition d'origine pour
   * que le tooltip puisse dire ce qui a été retiré. Posé sur la copie en main,
   * jamais sur la carte du catalogue.
   */
  _discounted_from?: SummonCondition[];
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
  hp_percent?: number;
  max?: number;
  /**
   * `guaranteed_draw` : les critères de la carte promise, **exactement** ceux
   * d'une magie du même type (cf. `GuaranteedDraw`) — l'effet d'attribut et
   * l'effet de magie alimentent la même file et sont résolus par le même
   * `Draw.resolveGuaranteedDraws`. Les tenir séparés donnait deux pouvoirs
   * d'expression différents pour une seule mécanique.
   */
  tier?: number;
  attribute?: string | null;
  attributes?: string[];
  card_ids?: string[];
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
  /**
   * Sur un attribut de catégorie `Tiers` uniquement : QUEL tier il désigne.
   * La catégorie dit qu'un attribut est un tier, ce champ dit lequel — cf.
   * `logic/Tiers.ts`, seul lecteur des deux.
   */
  tier?: number;
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
  /**
   * Vide/absent = tous les archétypes. Les voies d'invocation étant désormais
   * des attributs comme les autres (catégorie « Invocation »), un terrain qui
   * veut viser le Sacrifice nomme son attribut ici — il n'y a plus qu'un seul
   * ciblage, donc plus de cumul en ET à tenir.
   */
  target_attributes?: string[];
  /**
   * Par quoi `value` est multipliée — même vocabulaire que sur un attribut
   * (`logic/EffectScale`), et pour la même raison : c'était déjà la question
   * qu'un attribut posait, la reposer autrement ici aurait donné deux réponses.
   *
   * ⚠️ Un effet de terrain touche les DEUX camps : l'échelle se compte donc
   * dans le camp de chaque unité TOUCHÉE, pas dans un camp de l'effet — il n'en
   * a pas. Absent = ×1, ce que portent les 25 terrains livrés.
   */
  value_per?: string;
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
  /**
   * `guaranteed_draw` : les critères de la carte promise — tier, attributs
   * (cumulés), cartes acceptables. ⚠️ **Exactement** ceux d'un effet d'ATTRIBUT
   * du même type (cf. `AttributeEffect` et `GuaranteedDraw`) : les deux
   * alimentent la même file et sont résolus par le même
   * `Draw.resolveGuaranteedDraws`.
   */
  tier?: number;
  attribute?: string;
  attributes?: string[];
  card_ids?: string[];
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

/**
 * Ce qu'une pioche garantie PROMET. Tous les critères sont facultatifs et se
 * CUMULENT (ET) — une carte doit satisfaire tout ce qui est écrit.
 *
 * ⚠️ `attribute` (singulier) et `attributes` (liste) disent la même chose et se
 * cumulent : le premier est la forme historique, qu'aucune migration n'a à
 * réécrire. `card_ids` est le seul critère qui soit un OU entre ses entrées —
 * c'est une liste de cartes ACCEPTABLES, pas une liste de conditions.
 * Cf. `Draw.guaranteedDrawCriteria`, seul lecteur de cette forme.
 */
export interface GuaranteedDraw {
  tier?: number;
  attribute?: string | null;
  attributes?: string[];
  card_ids?: string[];
}

export interface HandModifier {
  /**
   * Les quatre remises d'invocation se réduisent à deux gestes sur une
   * condition : baisser son nombre de matériels, ou lui retirer des exigences
   * nommées. L'ancienne « transformation offerte » est les deux à la fois, et
   * s'écrit donc comme une remise assez large pour vider la condition.
   */
  type: 'reduce_materials' | 'remove_requirements';
  value?: number;
  /**
   * Ne retoucher qu'une carte PORTANT cet attribut. Absent = n'importe laquelle.
   *
   * C'est ce qui redonne aux remises la visée qu'elles avaient quand elles
   * nommaient une voie (« -1 matériel de Fusion »), mais en donnée : le moteur
   * ne connaît toujours qu'un coût et un attribut.
   */
  attribute?: string | null;
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
  /**
   * Pendant de `draw_bonus` / `guaranteed_draws`, côté ENNEMI : contrairement
   * aux autres ressources de fin de combat (slot, multiplicateur, Shopping),
   * la pioche a un destinataire des deux côtés — `EnemyAI` pioche aussi. Pas
   * de `enemy_draw_sources` : rien n'affiche la provenance de la pioche
   * adverse, à la différence de la popup du joueur.
   */
  enemy_draw_bonus?: number;
  enemy_guaranteed_draws?: GuaranteedDraw[];
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
