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
  /**
   * Les deux rythmes, en COMPTEUR de 0 à 100 : plus haut = plus vite
   * (`speed-scale.mjs`). Ce sont des périodes en ticks qui étaient saisies ici,
   * donc à l'envers — tous les bonus livrés s'écrivaient en négatif.
   */
  movement_rate: number;
  attack_rate: number;
  range: number;
}

export interface CardPower {
  id: string;
  /** Compteur de chargement, 0–100. Absent = le pouvoir ne part JAMAIS. */
  power_rate?: number;
  value?: number | null;
  /**
   * Compteur de DURÉE, 0–100, sur les seuls `DURATION_POWERS` (paralysie,
   * blocage, confusion, provocation).
   *
   * ⚠️ Sur ces quatre pouvoirs, `value` est le champ EN TICKS d'avant la
   * bascule et vaut une faute (`card-contract.missingDurations`). Sur les dix
   * autres, c'est l'inverse : ils gardent `value` et n'ont pas de durée.
   */
  duration?: number | null;
  /**
   * L'id du token à invoquer, sur POWER_SUMMON_TOKEN uniquement — résolu dans
   * le catalogue de tokens (`data/tokens.json`), jamais dans celui des cartes.
   * Donnée de carte, comme `value`/`duration` pour les autres pouvoirs :
   * jamais réécrite à l'exécution par `grant_power`.
   */
  token_id?: string | null;
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
   * Ce que cette carte APPELLE — le paramètre du mot-clé Appelant.
   *
   * ⚠️ **Le premier paramètre d'effet qui vit sur la CARTE et non sur l'effet.**
   * Un attribut ordinaire porte sa charge utile dans son palier, la même pour
   * tous ses porteurs ; Appelant est un effet dont chaque porteur nomme sa
   * propre promesse. La forme est celle des critères d'une pioche garantie —
   * littéralement `GuaranteedDraw`, pas un jumeau : c'est la même file
   * (`player_guaranteed_draws`) et le même `Draw.resolveGuaranteedDraws`.
   *
   * ⚠️ Il ne DÉCLENCHE rien tout seul. Une carte peut le porter sans porter
   * l'attribut : c'est alors une donnée morte, que `npm run audit:cards`
   * signale, et l'inverse (l'attribut sans l'appel) aussi.
   */
  appel?: GuaranteedDraw | null;
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
  type: string; // stat_bonus | stat_modifier | shield | effect_immunity | revive | draw_bonus | guaranteed_draw | board_slot_bonus | damage_multiplier_bonus | shopping_bonus | heal | player_hp_bonus | guaranteed_magie
  stat?: string;
  value?: number;
  /** stat_bonus : multiplie value par le nombre d'ennemis portant cet attribut. */
  value_per?: string;
  /** shield : multiplie value par les alliés vivants du camp visé. Défaut true (absent = multiplie). */
  per_ally?: boolean;
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
  /** `guaranteed_magie` : cf. `GuaranteedMagie`. */
  rarity?: MagieRarity;
  magie_id?: string;
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
  /** Compteur de chargement par défaut du pouvoir, 0–100. */
  power_rate?: number;
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
  /** Qui encaisse un `player_hp_bonus` — `allie` (le joueur) ou `ennemi`
   *  (l'adversaire). Absent = `allie`. */
  target?: 'allie' | 'ennemi';
  /** `guaranteed_magie` — cf. `GuaranteedMagie`. */
  rarity?: MagieRarity;
  magie_id?: string;
  /** `summon_token` — cf. `data/tokens.json`, `TokenDbLike`. */
  token_id?: string;
  /** `summon_token` — quel côté du plateau reçoit le token. Absent = `allie`. */
  camp?: 'allie' | 'ennemi';
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
  /** `grant_power` : le pouvoir posé sur l'unité, et son compteur de
   *  chargement (0–100). ⚠️ Le compteur est OBLIGATOIRE — sans lui l'unité
   *  garde le `null` d'`Unit`, c'est-à-dire un pouvoir qui ne part jamais.
   *  ⚠️ Et `0` en est une valeur LÉGITIME (77 ticks), pas une absence. */
  power_id?: string;
  power_rate?: number;
  /** `grant_power` d'un pouvoir de durée : le compteur 0–100 qu'il pose. */
  duration?: number | null;
  /** `guaranteed_magie` : cf. `GuaranteedMagie`. */
  rarity?: MagieRarity;
  magie_id?: string;
  /**
   * `summon_token` — un token PAR ENTRÉE, choisie une par une : le nombre
   * invoqué est `token_ids.length`, jamais un `value` séparé qui pourrait la
   * contredire. Cf. `effect-schema.mjs` (le champ n'existe que côté magie ;
   * terrain et attribut gardent `token_id`, cf. `BoardEffectDef`).
   */
  token_ids?: string[];
  /** `summon_token` — seul `allie` compile pour une magie (`compileMagie`). */
  camp?: 'allie' | 'ennemi';
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

/**
 * Ce qu'une magie garantie à la Phase Shopping PROMET — le jumeau de
 * `GuaranteedDraw`, en plus simple : une rareté et/ou UNE magie précise, pas
 * une liste (« la rareté OU le nom de la magie cible »). Les deux sont
 * facultatifs et se CUMULENT (ET) quand les deux sont écrits.
 * Cf. `MagieOffer.resolveGuaranteedMagies`, seul lecteur de cette forme.
 */
export interface GuaranteedMagie {
  rarity?: MagieRarity;
  magie_id?: string;
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
export interface BonusSourceEntry {
  kind: 'magie' | 'attribut' | 'terrain';
  /** Id de la magie, de l'attribut ou du terrain qui a crédité le bonus. */
  ref: string;
  /** Montant RÉELLEMENT crédité par cette source (plafond déjà appliqué). */
  value: number;
}

export interface DrawSourceEntry extends BonusSourceEntry {
  /** Cartes créditées : 0 pour une pioche GARANTIE, qui prend un slot existant. */
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
   * Provenance du `damage_multiplier_bonus`, attribut par attribut — le pendant
   * exact de `draw_sources`, et pour la même raison : le récapitulatif de round
   * annonce un bonus, il doit pouvoir DIRE d'où il sort. Rien n'en calcule quoi
   * que ce soit.
   */
  damage_multiplier_sources?: BonusSourceEntry[];
  /**
   * Gain/perte de PV du joueur, versé par un attribut à `fin_combat`
   * (`player_hp_bonus`, self-cible). Pendant de `damage_multiplier_bonus`,
   * même geste, même usage.
   */
  player_hp_bonus?: number;
  /** Provenance du champ ci-dessus — même discipline que `draw_sources`. */
  player_hp_sources?: BonusSourceEntry[];
  /** Magies garanties à la prochaine Phase Shopping — le pendant de
   *  `guaranteed_draws`, sur le vocabulaire de la magie. */
  guaranteed_magies?: GuaranteedMagie[];
  /**
   * Pendant de `draw_bonus` / `guaranteed_draws`, côté ENNEMI : contrairement
   * aux autres ressources de fin de combat (slot, multiplicateur, Shopping),
   * la pioche a un destinataire des deux côtés — `EnemyAI` pioche aussi. Pas
   * de `enemy_draw_sources` : rien n'affiche la provenance de la pioche
   * adverse, à la différence de la popup du joueur.
   */
  enemy_draw_bonus?: number;
  enemy_guaranteed_draws?: GuaranteedDraw[];
  /**
   * Les deux ressources que l'IA sait recevoir — décision 3 du §7.
   *
   * ⚠️ Il n'y en a que deux, et ce n'est pas une limite du moteur : le Shopping
   * n'existe structurellement pas pour elle. Le moteur accumule tout ce que ses
   * attributs donnent ; c'est le VERSEMENT qui n'a que deux destinations.
   */
  enemy_board_slot_bonus?: number;
  enemy_damage_multiplier_bonus?: number;
  /** Pendant de `damage_multiplier_sources` côté IA — la ligne « Dégâts
   *  adverses » du récapitulatif pose la même question que celle du joueur. */
  enemy_damage_multiplier_sources?: BonusSourceEntry[];
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
