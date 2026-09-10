import type { Card, DotEffect, BurnStack, Position, Side } from './types.js';
import { primaryTier } from './Tiers.js';
// L'échelle de vitesse vit À LA RACINE et nulle part ailleurs (cf. l'en-tête de
// `speed-scale.mjs`) : le bundle client, `admin.html` et les scripts Node y
// lisent la même table. Pur, sans import — il n'entre dans aucune frontière.
import { clampRate, ticksForRate, RATE_STATS } from '../../../speed-scale.mjs';

let _nextUid = 0;

/**
 * Combien de slots de matériau vaut l'unité que cette carte produit.
 *
 * ⚠️ C'est désormais une DONNÉE de carte (saisie en admin), plus une table
 * dérivée de la voie d'invocation jouée : la même carte valait deux choses
 * selon le camp qui la posait (l'IA laissait tous ses composites à 1), et une
 * carte à recettes multiples deux choses selon la recette. Lue ici, dans le
 * constructeur, les deux camps ne peuvent structurellement plus diverger.
 *
 * ⚠️ Vit dans `Unit` et non dans `InvocationManager`, qui importe déjà ce
 * module — l'y loger fermerait un cycle d'imports pour une ligne.
 */
export function materialValueOf(card: Pick<Card, 'material_value'>): number {
  const value = card?.material_value;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

interface BaseStats {
  atk: number;
  hp: number;
  /** Compteurs 0–100, plus haut = plus vite (cf. `speed-scale.mjs`). */
  movement_rate: number;
  attack_rate: number;
  range: number;
  // _transferShoppingBonuses / MagieEffect écrivent des stats arbitraires dans _base
  [stat: string]: number;
}

export class Unit {
  uid: number;
  card_id: string;
  name: string;
  side: Side;
  /**
   * Le tier de l'unité, en UN chiffre : le plus haut de sa carte. Une unité
   * n'en porte qu'un parce que ses deux seuls lecteurs (l'échelle des effets
   * visuels de `three/`, la garde de matériau de l'IA) demandent une puissance,
   * pas un ensemble de rounds. Les tiers complets se lisent sur la CARTE.
   */
  tier: number;
  attributes: string[];

  // Card IDs this unit "counts as" when it stands in for a summon requirement.
  // Pre-determined on the card definition (admin panel) rather than computed at summon time.
  represented_ids: string[];
  // How many material "slots" this unit counts as when consumed. Read straight
  // off the card, like represented_ids — never derived from the condition that
  // produced it, which is what used to give the AI and the player two different
  // values for the same card.
  material_value: number;
  power_id: string | null;
  /**
   * Le compteur de chargement du pouvoir, 0–100 (`speed-scale.mjs`).
   *
   * ⚠️ `null` ne veut PAS dire « lent », il veut dire « jamais » :
   * `powerPeriod()` rend alors `Infinity`. C'est le rôle que tenait le `9999`
   * d'avant, et il faut un sentinelle distincte parce que 0 est désormais une
   * valeur légitime (77 ticks, donc quatre tirs par combat). Le piège qu'il
   * signale est celui d'une magie `grant_power` sans vitesse : l'admin impose
   * le champ, et une unité qui hériterait d'un pouvoir muet doit rester muette
   * plutôt que de gagner par surprise le pouvoir le plus lent de l'échelle.
   */
  power_rate: number | null;
  power_value: number | null;
  /**
   * Le compteur de DURÉE du pouvoir, 0–100 (`speed-scale.mjs`), pour les seuls
   * pouvoirs de `DURATION_POWERS` (paralysie, blocage, confusion, provocation).
   *
   * ⚠️ Un champ à part de `power_value`, et pas par goût : `value` chiffre dix
   * choses différentes selon le pouvoir (des dégâts, un bouclier, des cases),
   * et c'est le seul cas où elle chiffrait des TICKS. Les séparer est ce qui
   * rend la reprise de données idempotente — sur ces quatre pouvoirs, un
   * `value` résiduel ne peut vouloir dire qu'« encore en ticks ».
   *
   * `null` = pas de durée saisie, donc le repli du pouvoir (`CombatManager`).
   */
  power_duration: number | null;

  // Frozen base stats (for reset)
  _base: BaseStats;
  // Start-of-combat flat bonuses (from stat_bonus attribute effects)
  _stat_bonuses: Record<string, number>;
  // Bonus permanents de la Phase Shopping, transférés aux invocations composites
  // (posé par MagieEffect._trackShoppingBonus / InvocationManager)
  _shopping_bonus?: Record<string, number>;
  // Posé par CombatManager._checkDeaths pour ne pas ré-émettre 'death'
  _deathEmitted?: boolean;
  // Posé par GameSession._applyEnemyBonus : le handicap d'une unité IA est
  // définitif (écrit dans _base) et ne doit donc être versé qu'une fois, alors
  // que le placement de l'IA repasse sur les survivants à chaque round.
  _enemy_bonus_applied?: boolean;

  // Effective combat stats
  atk: number;
  max_hp: number;
  current_hp: number;
  /**
   * Les deux rythmes, en COMPTEUR (0–100, plus haut = plus vite) : c'est la
   * forme que lisent l'écran, les bonus et les données. Le combat, lui, ne
   * connaît que les périodes en ticks ci-dessous — la traduction se fait une
   * fois, dans `_recomputeStats`.
   */
  movement_rate: number;
  attack_rate: number;
  /** Seuils en ticks dérivés des compteurs. Jamais saisis, jamais persistés. */
  movement_period: number;
  attack_period: number;
  range: number;

  // Runtime state
  shield: number;
  power_gauge: number;
  dot_effects: DotEffect[];
  burn_stacks: BurnStack[]; // self-inflicted on this unit's next attacks
  paralysis_remaining: number; // steps left of paralysis
  /**
   * Ce que la paralysie ajoute à la PÉRIODE d'attaque, en ticks.
   *
   * ⚠️ Le seul état de rythme qui reste chiffré en ticks, et c'est délibéré :
   * la paralysie DOUBLE la période (« la moitié de ses attaques, quel que soit
   * le rythme »), or un doublement ne s'écrit pas comme un delta de compteur
   * constant — il vaut −19 points sur une unité rapide et −51 sur une lente.
   * Exprimé ici, il reste exactement ce qu'il était. Un bonus, lui, n'a rien à
   * faire dans cet espace : il passe par `_stat_bonuses.attack_rate`.
   */
  attack_period_modifier: number;
  is_power_blocked: boolean;
  power_block_remaining: number;
  confusion_remaining: number; // steps left of confusion (targets own allies)
  taunt_remaining: number; // steps left this unit forces enemies to target it
  is_effect_immune: boolean; // granted by effect_immunity attribute — blocks debuff powers

  position: Position | null;
  initial_position: Position | null;
  is_neutralized: boolean;

  // Number of past combats this unit survived without being neutralized.
  // Lost when the unit is neutralized and never consumed as summon material
  // before the next combat (it simply stops existing). Carried over to
  // composite units the same way as Shopping Phase bonuses (see InvocationManager).
  veterancy_points: number;

  // Internal action timers (tick up each step)
  attack_timer: number;
  move_timer: number;

  constructor(card: Card, side: Side) {
    this.uid = _nextUid++;
    this.card_id = card.id;
    this.name = card.name;
    this.side = side;
    this.tier = primaryTier(card);
    this.attributes = card.attributes || [];

    this.represented_ids = [...new Set([card.id, ...(card.represented_ids || [])])];
    this.material_value = materialValueOf(card);
    this.power_id = card.power?.id ?? null;
    this.power_rate = card.power?.power_rate ?? null;
    this.power_value = card.power?.value ?? null;
    this.power_duration = card.power?.duration ?? null;

    this._base = {
      atk: card.stats.atk,
      hp: card.stats.hp,
      movement_rate: clampRate(card.stats.movement_rate),
      attack_rate: clampRate(card.stats.attack_rate),
      range: card.stats.range,
    };

    this._stat_bonuses = {};

    this.atk = card.stats.atk;
    this.max_hp = card.stats.hp;
    this.current_hp = card.stats.hp;
    this.movement_rate = this._base.movement_rate;
    this.attack_rate = this._base.attack_rate;
    this.movement_period = ticksForRate(this.movement_rate);
    this.attack_period = ticksForRate(this.attack_rate);
    this.range = card.stats.range;

    this.shield = 0;
    this.power_gauge = 0;
    this.dot_effects = [];
    this.burn_stacks = [];
    this.paralysis_remaining = 0;
    this.attack_period_modifier = 0;
    this.is_power_blocked = false;
    this.power_block_remaining = 0;
    this.confusion_remaining = 0;
    this.taunt_remaining = 0;
    this.is_effect_immune = false;

    this.position = null;
    this.initial_position = null;
    this.is_neutralized = false;

    this.veterancy_points = 0;

    this.attack_timer = 0;
    this.move_timer = 0;
  }

  // --- Combat queries ---

  /**
   * La période d'attaque réellement jouée, en ticks : le seuil que
   * `attack_timer` doit atteindre. Plus haute = plus lente.
   */
  effectiveAttackPeriod(): number {
    return Math.max(1, this.attack_period + this.attack_period_modifier);
  }

  /**
   * Le seuil de jauge du pouvoir, en ticks. `Infinity` quand aucune vitesse
   * n'est déclarée — cf. `power_rate` : un pouvoir sans rythme ne part jamais,
   * il ne part pas lentement.
   */
  powerPeriod(): number {
    return this.power_rate == null ? Infinity : ticksForRate(this.power_rate);
  }

  isPowerReady(): boolean {
    return !!this.power_id && !this.is_power_blocked && this.power_gauge >= this.powerPeriod();
  }

  isAlive(): boolean {
    return !this.is_neutralized;
  }

  // --- Damage / healing ---

  takeDamage(amount: number): number {
    let dmg = Math.max(0, amount);
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
    }
    this.current_hp = Math.max(0, this.current_hp - dmg);
    if (this.current_hp === 0) {
      this.is_neutralized = true;
      this.power_gauge = 0;
    }
    return dmg; // actual damage dealt (after shield)
  }

  heal(amount: number): void {
    this.current_hp = Math.min(this.max_hp, this.current_hp + Math.max(0, amount));
  }

  applyShield(amount: number): void {
    this.shield += Math.max(0, amount);
  }

  // --- Stat management ---

  applyStatBonus(stat: string, value: number): void {
    this._stat_bonuses[stat] = (this._stat_bonuses[stat] || 0) + value;
    this._recomputeStats();
    // For HP bonuses, also increase current_hp so the unit benefits immediately
    if (stat === 'hp') this.current_hp += value;
  }

  // Called by during_combat stat_modifier effects (rage stacks, etc.)
  applyStatModifier(stat: string, value: number): void {
    if (stat === 'atk') {
      this.atk = Math.max(1, this.atk + value);
    } else if (stat === 'hp') {
      this.max_hp += value;
      this.current_hp = Math.min(this.current_hp + value, this.max_hp);
    } else if (RATE_STATS.includes(stat)) {
      // ⚠️ Un rythme passe par `_stat_bonuses`, jamais par une écriture directe
      // sur la stat effective comme `atk` : les compteurs sont RECALCULÉS depuis
      // `_base` à chaque `_recomputeStats()`, donc un bonus posé à côté serait
      // effacé au premier `stat_bonus` venu. C'est ce qui rendait muet le seul
      // attribut du catalogue qui s'en sert (`ARCH_045` Volant).
      this.applyStatBonus(stat, value);
    }
  }

  /**
   * Les deux horloges internes du combat — elles ne portent aucun acquis du
   * joueur (ni stat, ni statut) : seulement « où en est cette unité de son
   * cycle d'attaque / de déplacement ».
   *
   * ⚠️ SÉPARÉE de `resetCombatStats`, que `POWER_DEBUFF` appelle EN PLEIN
   * COMBAT : la dissipation efface bonus et statuts, elle n'a pas à décaler le
   * prochain coup de sa cible. C'est `GameSession.startCombat` qui remet les
   * horloges à zéro, une fois par combat et pour les deux camps.
   */
  resetCombatClocks(): void {
    this.attack_timer = 0;
    this.move_timer = 0;
  }

  // Called by POWER_DEBUFF and at end of combat — strip all bonuses and status effects
  resetCombatStats(): void {
    this._stat_bonuses = {};
    this.power_gauge = 0;
    this.attack_period_modifier = 0;
    this.paralysis_remaining = 0;
    this.is_power_blocked = false;
    this.power_block_remaining = 0;
    this.confusion_remaining = 0;
    this.taunt_remaining = 0;
    this.is_effect_immune = false;
    this.dot_effects = [];
    this.burn_stacks = [];
    this._recomputeStats();
    this.current_hp = Math.min(this.current_hp, this.max_hp);
  }

  _recomputeStats(): void {
    this.atk = Math.max(1, this._base.atk + (this._stat_bonuses.atk || 0));
    this.max_hp = Math.max(1, this._base.hp + (this._stat_bonuses.hp || 0));
    // ⚠️ Les deux rythmes se cumulent puis s'ÉCRÊTENT à [0, 100], et c'est tout
    // le propos de l'échelle : un empilement de bonus ne peut plus descendre
    // sous 2 ticks. La borne est dans `clampRate`, jamais recopiée ici.
    //
    // ⚠️ Le déplacement lisait `_base` SEUL et ignorait son bonus : tous les
    // effets de déplacement livrés (attributs Bête et Aquatique, terrains
    // Cimetière, Vallée des rois, Mur du Labyrinthe, Monde transparent) étaient
    // muets. Ils s'appliquent depuis que cette ligne lit `_stat_bonuses`.
    this.attack_rate = clampRate(this._base.attack_rate + (this._stat_bonuses.attack_rate || 0));
    this.movement_rate = clampRate(this._base.movement_rate + (this._stat_bonuses.movement_rate || 0));
    this.attack_period = ticksForRate(this.attack_rate);
    this.movement_period = ticksForRate(this.movement_rate);
    this.range = Math.max(1, this._base.range + (this._stat_bonuses.range || 0));
  }

  // Serialise l'état pour le Board Inspector (debug)
  toDebugInfo() {
    return {
      uid: this.uid, name: this.name, side: this.side,
      hp: `${this.current_hp}/${this.max_hp}`, shield: this.shield,
      atk: this.atk, pos: this.position,
      rates: `atq ${this.attack_rate} (${this.attack_period}t) · dep ${this.movement_rate} (${this.movement_period}t)`,
      power: `${this.power_gauge}/${this.powerPeriod()}`,
    };
  }
}
