/* eslint-disable @typescript-eslint/no-explicit-any */
// Pilote du Banc d'essai des effets — applique CHAQUE effet écrit dans les trois
// catalogues à une scène type, et rend ce qu'il a fait.
//
// La question à laquelle il répond n'a longtemps eu aucun lecteur : « cet effet
// fait-il quelque chose ? ». `ARCH_019` a passé des mois à ne rien donner, et
// rien dans le jeu ne pouvait le dire — un attribut muet n'a pas d'écran, pas de
// message, pas de trace : il ressemble exactement à un attribut faible.
//
// ⚠️ PUR : aucune dépendance à React, Zustand, Three ni au DOM. C'est ce qui le
// rend testable dans une suite qui tourne en node sans jsdom — l'écran
// (`dev/EffectBench.tsx`) ne fait que rendre ce qu'il produit. Même partage que
// `dev/aiLabRun.ts` et `sim/runGame.ts`.
//
// ⚠️ Il ne RÉIMPLÉMENTE rien. Les effets sont appliqués par les trois moteurs
// eux-mêmes (`AttributeManager`, `BoardEffect`, `MagieEffect` + `GameSession`) ;
// une seconde copie des règles finirait par ne plus dire la même chose que
// celle qui est jouée, ce que le banc existe très exactement pour constater.
//
// ⚠️ Le verdict porte sur la SCÈNE, pas sur l'effet en soi : « muet » se lit
// « n'a rien fait ici », jamais « ne fait jamais rien ». C'est pour ça que la
// scène est décrite en toutes lettres dans le rapport (`report.scene`) et
// affichée par l'écran — un diagnostic dont on ne connaît pas les conditions ne
// vaut rien, et un outil qui crie au loup sur les cas sains est pire qu'un outil
// absent.
import { AttributeManager } from '../logic/AttributeManager.js';
import { applyEffect as applyBoardEffect, boardEffects } from '../logic/BoardEffect.js';
import { applyEffect as applyMagieEffect, effectLabel, magieCostHp } from '../logic/MagieEffect.js';
import { specOf, readsParam, targetFamily } from '../logic/EffectKinds.js';
import { effectScale, scaleAttributeId } from '../logic/EffectScale.js';
import { GameSession } from '../logic/GameSession.js';
import { GameState } from '../logic/GameState.js';
import { Board } from '../logic/Board.js';
import { Unit } from '../logic/Unit.js';
import { boardEffectLabel } from '../data/BoardInfo.js';
import { guaranteedDrawLabel } from '../data/DrawInfo.js';
import { statLabel } from '../data/StatLabels.js';

// ── Ce qu'on rend ────────────────────────────────────────────────────────────

export type EffectDomain = 'attribute' | 'board' | 'magie';

/**
 * Trois verdicts, et le troisième n'est pas une nuance de politesse.
 *
 * `descriptif` désigne ce qui n'a AUCUN effet écrit — un archétype pur
 * (`timing: 'none'`, sans seuil), une magie sans `effect`. Ce n'est pas une
 * panne, c'est une intention, et le compter parmi les muets noierait les vrais
 * dans quarante faux positifs.
 */
export type BenchVerdict = 'actif' | 'muet' | 'descriptif';

export interface BenchObservation {
  /** Qui a bougé : `P_A`, `partie`, `main`… */
  subject: string;
  /** Ce qui a bougé : `ATQ 10 → 13`, `pioche +2`, `+T1_A`. */
  detail: string;
}

export interface BenchRow {
  /** Clé stable et unique — l'écran s'en sert comme `key` React et comme ancre. */
  key: string;
  domain: EffectDomain;
  entity_id: string;
  entity_name: string;
  /** Où l'effet est écrit dans son porteur : `seuil 2 · effet 1/2`. */
  where: string;
  /** Le `timing` de l'attribut porteur — la donnée qui décide QUAND l'effet
   *  tourne, et donc la première suspecte quand il ne tourne pas. */
  timing: string | null;
  type: string | null;
  /** Le libellé que le joueur lit, rendu par le même code que le jeu. */
  label: string;
  /** L'effet brut, pour l'inspecteur de l'écran. */
  effect: Record<string, unknown> | null;
  /** `cost_hp` d'une magie — mesuré à part, JAMAIS compté comme un effet
   *  (une magie qui ne ferait que coûter des PV passerait pour active). */
  cost_hp: number;
  observed: BenchObservation[];
  verdict: BenchVerdict;
  /** Pourquoi c'est muet, quand on peut le dire. */
  note: string | null;
}

export interface BenchReport {
  rows: BenchRow[];
  /** La scène type, en toutes lettres — un verdict sans ses conditions ne vaut rien. */
  scene: string;
  counts: { total: number; actif: number; muet: number; descriptif: number };
  byDomain: Record<EffectDomain, { total: number; actif: number; muet: number; descriptif: number }>;
}

/** De quoi nommer un id — l'écran passe `GAME_NAMES`, un test passe l'identité. */
export interface BenchNames {
  attribute(id: string): string;
  card(id: string): string;
}

export interface BenchInput {
  attributes: any[];
  boards: any[];
  magies: any[];
  names?: Partial<BenchNames>;
}

// ── La scène ─────────────────────────────────────────────────────────────────

/** Le profil d'une unité de banc — ce que ses stats doivent permettre d'observer. */
export interface UnitProfile {
  atk: number; hp: number;
  movement_speed: number; attack_speed: number; initiative: number; range: number;
  power: { id: string; power_speed: number; value: number | null } | null;
}

/**
 * Le profil du banc — et chacune de ses valeurs est un faux positif évité.
 *
 * ⚠️ **De la MARGE sur chaque stat.** Les stats d'unité ont un plancher à 1
 * (`Unit._recomputeStats`, `applyPermanentStat`) : sur une unité à
 * `movement_speed: 1`, un « −5 DEP » ne retire rien et le banc le déclarerait
 * muet. Sept effets livrés sont des malus — les mesurer demande de quoi
 * descendre.
 *
 * ⚠️ **Un POUVOIR.** `power_cooldown` ne touche que les unités qui en portent
 * un (`if (targetUnit.power_id)`), et `grant_power` en REMPLACE un. Sans
 * pouvoir de départ, la première est muette et la seconde ne montre pas ce
 * qu'elle recouvre.
 */
export const BENCH_PROFILE: UnitProfile = {
  atk: 10, hp: 100,
  movement_speed: 5, attack_speed: 10, initiative: 5, range: 3,
  power: { id: 'POWER_HEAL', power_speed: 20, value: null },
};

export interface SceneOptions {
  /** Unités PORTANT les attributs demandés, par camp. */
  carriers?: number;
  /** Unités vivantes n'en portant aucun — de quoi voir un ciblage rater. */
  extras?: number;
  /**
   * Unités déjà neutralisées, par camp : la matière d'un `revive`.
   *
   * ⚠️ Elles sont marquées AVANT le relevé de référence, jamais pendant : une
   * neutralisation posée par la scène apparaîtrait sinon dans l'écart comme si
   * l'effet l'avait causée.
   */
  dead?: number;
  /** Le gabarit des unités vivantes. */
  profile?: UnitProfile;
}

export const SCENE: Required<Omit<SceneOptions, 'profile'>> = { carriers: 5, extras: 1, dead: 3 };

/**
 * Trois PV/ATK distincts chez les neutralisées, et ce n'est pas décoratif : les
 * trois cibles d'un `revive` d'attribut (`first`, `highest_hp`, `highest_atk`)
 * doivent désigner trois unités DIFFÉRENTES, sinon le banc ne saurait pas dire
 * laquelle a été relevée.
 */
const DEAD_STATS = [
  { atk: 10, hp: 100 },  // la première morte  → `first`
  { atk: 10, hp: 300 },  // la plus endurante  → `highest_hp`
  { atk: 30, hp: 100 },  // la plus forte      → `highest_atk`
];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Une carte de banc — même forme que `test/helpers.makeCard`, sans son compteur. */
export function benchCard(id: string, attributes: string[], profile: UnitProfile): any {
  const { atk, hp, power, ...speeds } = profile;
  return { id, name: id, _tiers: [1], attributes, power, stats: { atk, hp, ...speeds } };
}

export interface BenchScene {
  board: any;
  player: any[];
  enemy: any[];
  /** Les deux camps, dans l'ordre — l'ordre des relevés de référence. */
  all: any[];
  /** Les neutralisées de chaque camp, dans l'ordre des décès. */
  playerDead: any[];
  enemyDead: any[];
}

/**
 * La scène type.
 *
 * ⚠️ Les DEUX camps portent les attributs demandés : `_applyStartForSide` traite
 * les deux, et une échelle qui compte « les unités d'en face » n'a rien à
 * compter si l'autre camp est vide. Un banc monté sur un seul côté serait
 * aveugle à la moitié de ce qu'il surveille.
 */
export function benchScene(attributes: string | string[], opts: SceneOptions = {}): BenchScene {
  const attrs = (Array.isArray(attributes) ? attributes : [attributes]).filter(Boolean);
  const carriers = opts.carriers ?? SCENE.carriers;
  const extras = opts.extras ?? SCENE.extras;
  const dead = opts.dead ?? SCENE.dead;
  const profile = opts.profile ?? BENCH_PROFILE;
  const board = new (Board as any)();

  const side = (prefix: string, baseRow: number, dir: 1 | -1) => {
    const alive: any[] = [];
    const corpses: any[] = [];
    const total = carriers + extras + dead;
    for (let i = 0; i < total; i++) {
      const isCarrier = i < carriers;
      const isDead = i >= carriers + extras;
      // ⚠️ Les neutralisées portent leurs PROPRES stats : c'est ce qui rend les
      // trois cibles d'un `revive` distinguables. Les vivantes, elles, sont
      // rigoureusement identiques — un écart entre porteuses se lirait comme
      // un effet.
      const card = benchCard(
        `${prefix}_${LETTERS[i]}`,
        isCarrier ? attrs : [],
        isDead ? { ...profile, ...DEAD_STATS[(i - carriers - extras) % DEAD_STATS.length] } : profile,
      );
      const unit = new (Unit as any)(card, prefix === 'P' ? 'player' : 'enemy');
      board.placeUnit(unit, { col: i % 5, row: baseRow + dir * Math.floor(i / 5) });
      // ⚠️ Posée AVANT tout relevé : la scène ne doit pas se lire comme un effet.
      if (isDead) { unit.is_neutralized = true; corpses.push(unit); } else alive.push(unit);
    }
    return { alive, corpses };
  };

  const p = side('P', 0, 1);
  const e = side('E', 10, -1);
  return {
    board,
    player: p.alive.concat(p.corpses),
    enemy: e.alive.concat(e.corpses),
    all: p.alive.concat(p.corpses, e.alive, e.corpses),
    playerDead: p.corpses,
    enemyDead: e.corpses,
  };
}

/** Ce que la scène offre, en une phrase — affichée par l'écran, à côté du verdict. */
export function sceneSummary(): string {
  return `${SCENE.carriers} porteuses + ${SCENE.extras} non-porteuse vivantes et `
    + `${SCENE.dead} neutralisées par camp — ATQ 10, PV 100 (les neutralisées : `
    + DEAD_STATS.map(s => `${s.atk}/${s.hp}`).join(', ') + ').';
}

// ── Le relevé ────────────────────────────────────────────────────────────────

/**
 * L'état d'une unité qu'un effet peut toucher.
 *
 * ⚠️ Cette liste est le DÉNOMINATEUR de « rien ne s'est passé » : un champ qui
 * n'y figure pas est un effet que le banc ne verra jamais, et qu'il déclarera
 * muet en toute confiance. La compléter est le seul entretien qu'il demande.
 */
export function readUnit(u: any) {
  return {
    atk: u.atk, max_hp: u.max_hp, current_hp: u.current_hp, shield: u.shield,
    attack_speed: u.attack_speed, movement_speed: u.movement_speed,
    initiative: u.initiative, range: u.range,
    // ⚠️ La charge de pouvoir est la seule stat qui n'ait pas de champ à elle :
    // elle ne vit que dans `_stat_bonuses` et c'est la boucle de combat qui la
    // lit (`1 + power_charge` par step). Sans cette ligne, les deux attributs
    // qui l'accélèrent étaient observés en train de ne rien faire.
    power_charge: u._stat_bonuses?.power_charge ?? 0,
    immune: !!u.is_effect_immune, neutralized: !!u.is_neutralized,
    base: JSON.stringify(u._base),
    // ⚠️ Le REGISTRE des bonus de combat, à côté des stats qu'il est censé
    // produire. Les deux ensemble disent ce qu'aucun ne dit seul : un bonus
    // inscrit ici sans qu'aucune stat ne bouge est un trou du moteur, pas une
    // donnée fautive — et c'est le seul moyen de faire la différence.
    bonuses: JSON.stringify(u._stat_bonuses ?? null),
    shopping: JSON.stringify(u._shopping_bonus ?? null),
    power: JSON.stringify([u.power_id ?? null, u.power_speed, u.power_value ?? null]),
  };
}

export type UnitReading = ReturnType<typeof readUnit>;

/**
 * L'ÉCART d'une unité par rapport à un relevé — jamais son état complet.
 *
 * ⚠️ Deux raisons, et la seconde compte plus que la première. La fixture de
 * `effect-behaviour` passe de 630 Ko à quelques dizaines : c'est agréable. Mais
 * surtout elle devient LISIBLE — on y lit « ARCH_019 → P_A atk +3 » au lieu de
 * six unités inertes répétées quatre fois. Un golden qu'on ne peut pas lire ne
 * se relit jamais, et un changement qu'on ne relit pas se valide au `--update`.
 */
export function deltaUnit(u: any, before: UnitReading) {
  const after = readUnit(u) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    if (v !== (before as Record<string, unknown>)[k]) out[k] = v;
  }
  return Object.keys(out).length ? { unit: u.card_id, ...out } : null;
}

const NUMERIC_FIELDS = [
  'atk', 'max_hp', 'current_hp', 'shield',
  'attack_speed', 'movement_speed', 'initiative', 'range', 'power_charge',
] as const;

const FIELD_LABELS: Record<string, string> = {
  max_hp: 'PV max', current_hp: 'PV', shield: 'bouclier', initiative: 'INI',
  power_charge: 'charge de pouvoir',
};

const fieldLabel = (f: string) => FIELD_LABELS[f] ?? statLabel(f);

/** Le même écart, mis en mots. */
function describeUnit(before: UnitReading, after: UnitReading): string[] {
  const out: string[] = [];
  for (const f of NUMERIC_FIELDS) {
    if (before[f] !== after[f]) out.push(`${fieldLabel(f)} ${before[f]} → ${after[f]}`);
  }
  if (!before.immune && after.immune) out.push('immunisée aux effets');
  if (before.neutralized && !after.neutralized) out.push('relevée');
  if (!before.neutralized && after.neutralized) out.push('neutralisée');
  if (before.power !== after.power) {
    const [id, speed] = JSON.parse(after.power) as [string | null, number];
    out.push(id ? `pouvoir ${id} (seuil ${speed})` : `seuil de pouvoir → ${speed}`);
  }
  // ⚠️ Le socle et le suivi de Shopping sont annoncés SÉPARÉMENT des stats :
  // une magie permanente écrit dans `_base`, une magie de combat n'y touche
  // pas, et c'est très exactement ce qui les distingue.
  if (before.base !== after.base) out.push('socle permanent modifié');
  if (before.shopping !== after.shopping) out.push('bonus de Shopping tracé');
  return out;
}

/** Le relevé complet d'une scène, unité par unité. */
const readAll = (scene: BenchScene) => scene.all.map(readUnit);

/** Ce qui a bougé depuis un relevé, en observations. */
function observeUnits(scene: BenchScene, before: UnitReading[]): BenchObservation[] {
  const out: BenchObservation[] = [];
  scene.all.forEach((u, i) => {
    for (const detail of describeUnit(before[i], readUnit(u))) out.push({ subject: u.card_id, detail });
  });
  return out;
}

// ── Le diagnostic d'un effet muet ────────────────────────────────────────────

/**
 * POURQUOI rien ne s'est passé, quand on peut le dire.
 *
 * ⚠️ L'ordre des questions va du plus structurel au plus circonstanciel : une
 * faute de saisie (type inconnu, timing incompatible) est une certitude, un
 * « le moteur n'a rien appliqué » n'est qu'un constat. Rendre le constat en
 * premier masquerait la certitude derrière lui.
 */
function diagnose(
  domain: EffectDomain,
  effect: any,
  timing: string | null,
  scene: BenchScene,
  before: UnitReading[],
  known: Set<string> | null,
): string {
  const type = effect?.type;
  if (!specOf(type, domain)) {
    return `le type « ${type} » n'existe pas pour ce domaine — le moteur le traverse sans rien faire`;
  }
  // ⚠️ Le diagnostic le plus précis du banc, et il est DÉDUIT, pas écrit : le
  // bonus a bien été inscrit sur les unités, mais aucune des stats que le jeu
  // lit ne le reprend. Ça ne désigne pas une donnée fautive — ça désigne un
  // trou dans `Unit._recomputeStats`, et c'est la seule façon de faire la
  // différence entre « mal écrit » et « pas implémenté ».
  const orphan = scene.all
    .map((u, i) => [u, before[i]] as const)
    .find(([u, b]) => readUnit(u).bonuses !== b.bonuses);
  if (orphan) {
    const posees = JSON.parse(readUnit(orphan[0]).bonuses ?? '{}') as Record<string, number>;
    const avant = JSON.parse(orphan[1].bonuses ?? '{}') as Record<string, number>;
    const stats = Object.keys(posees).filter(k => posees[k] !== avant[k]);
    return `le bonus est inscrit sur l'unité (${stats.map(s => `_stat_bonuses.${s}`).join(', ')}), `
      + 'mais aucune stat lue ne le reprend';
  }
  // ⚠️ Le cas le plus fréquent du catalogue livré, et le plus invisible : le
  // `timing` vit sur l'ATTRIBUT, pas sur l'effet. Un `guaranteed_draw` écrit
  // sous un attribut `start_of_combat` n'est lu par personne — la donnée est
  // parfaitement valide, elle est simplement rangée sous une horloge qui ne la
  // regarde pas.
  if (domain === 'attribute' && timing) {
    const expected = ATTRIBUTE_TIMINGS[type];
    if (expected && expected !== timing) {
      return `écrit sous un attribut « ${timing} », mais ce type n'est lu qu'en « ${expected} »`;
    }
  }
  // ⚠️ `0` seulement, jamais « pas > 0 » : sept effets livrés portent un MALUS
  // (`-5 DEP`), et les traiter comme une valeur manquante ferait dire au banc
  // le contraire de ce qui se passe.
  if (readsParam(type, domain, 'value') && (effect.value == null || Number(effect.value) === 0)) {
    return 'la valeur est absente ou nulle';
  }
  const scaleId = scaleAttributeId(effect.value_per);
  if (scaleId && known && !known.has(scaleId)) {
    return `l'échelle « ${effect.value_per} » nomme un attribut qui n'existe pas au catalogue`;
  }
  if (effect.value_per && effectScale(effect.value_per, scene.player, scene.enemy) === 0) {
    return `l'échelle « ${effect.value_per} » ne compte aucune unité sur la scène`;
  }
  const inconnus: string[] = (effect.target_attributes ?? []).filter((a: string) => known && !known.has(a));
  if (inconnus.length) {
    return `le ciblage nomme ${inconnus.length > 1 ? 'des attributs qui n\'existent pas' : `un attribut qui n'existe pas`} au catalogue (${inconnus.join(', ')})`;
  }
  return 'le moteur n\'a rien appliqué sur la scène type';
}

/**
 * QUELLE horloge lit chaque type d'effet d'attribut.
 *
 * ⚠️ Ce n'est pas une règle de plus : c'est la lecture d'`AttributeManager`,
 * dont les trois passes se partagent les types sans qu'aucune ne le dise —
 * `_applyStartForSide` a son `switch`, `_triggerStatModifiers` sa condition,
 * `_applyEndForSide` le sien. Un effet rangé sous la mauvaise horloge est donc
 * silencieusement ignoré, ce que rien dans l'admin n'annonce. Verrouillé par
 * `effect-bench.test.ts`, qui exige qu'un type absent d'ici ne le soit pas du
 * moteur.
 */
export const ATTRIBUTE_TIMINGS: Record<string, string> = {
  stat_bonus: 'start_of_combat',
  shield: 'start_of_combat',
  effect_immunity: 'start_of_combat',
  stat_modifier: 'during_combat',
  revive: 'end_of_combat',
  draw_bonus: 'end_of_combat',
  guaranteed_draw: 'end_of_combat',
  board_slot_bonus: 'end_of_combat',
  damage_multiplier_bonus: 'end_of_combat',
  shopping_bonus: 'end_of_combat',
};

// ── Les attributs ────────────────────────────────────────────────────────────

/** Les critères d'une pioche garantie, en une ligne. */
const drawLabel = (g: any, names: BenchNames) =>
  guaranteedDrawLabel(g, names.attribute, names.card);

function observeAttributeResult(result: any, names: BenchNames): BenchObservation[] {
  const out: BenchObservation[] = [];
  const push = (subject: string, detail: string) => out.push({ subject, detail });
  if (result.draw_bonus) push('partie', `pioche +${result.draw_bonus}`);
  for (const g of result.guaranteed_draws ?? []) push('partie', `pioche garantie — ${drawLabel(g, names)}`);
  if (result.board_slot_bonus) push('partie', `+${result.board_slot_bonus} slot de board`);
  if (result.damage_multiplier_bonus) push('partie', `multiplicateur de dégâts +${result.damage_multiplier_bonus}`);
  if (result.shopping_bonus) push('partie', `+${result.shopping_bonus} magie au Shopping`);
  if (result.enemy_draw_bonus) push('adversaire', `pioche +${result.enemy_draw_bonus}`);
  for (const g of result.enemy_guaranteed_draws ?? []) push('adversaire', `pioche garantie — ${drawLabel(g, names)}`);
  return out;
}

/**
 * Un effet d'attribut, joué SEUL et en entier : début de combat, une mort (pour
 * les `during_combat`), puis fin de combat.
 *
 * ⚠️ Seul, et c'est tout l'écart avec `effect-behaviour` : ce filet-là fige ce
 * qu'un attribut ENTIER applique, celui-ci isole chacun de ses effets. Un seuil
 * à deux effets dont un seul fonctionne se lit « actif » à la maille de
 * l'attribut — c'est exactement ce qui laisse un effet muet passer.
 */
function runAttributeEffect(attr: any, threshold: any, effect: any, names: BenchNames, known: Set<string> | null) {
  // ⚠️ La scène ne porte que ce que le CATALOGUE pourrait porter : un
  // `value_per` qui nomme un attribut inexistant ne doit pas se voir offrir des
  // porteurs par le banc, sinon il passerait pour actif ici et resterait muet
  // en jeu. Sans catalogue d'attributs sous la main (un appel de synthèse), on
  // ne juge pas et on injecte.
  const scaleId = scaleAttributeId(effect?.value_per);
  const aimed = scaleId && (!known || known.has(scaleId)) ? [scaleId] : [];
  const scene = benchScene([attr.id, ...aimed]);
  const before = readAll(scene);
  // Un attribut de synthèse : le porteur d'origine, réduit à CE seuil et à CET
  // effet. Le `timing` reste celui de l'attribut — c'est la donnée qu'on teste.
  const solo = { ...attr, thresholds: [{ ...threshold, effects: [effect], effect: undefined }] };
  const am = new (AttributeManager as any)([solo], scene.player, scene.enemy);
  am.applyStartOfCombat();
  // La mort déclencheuse est celle d'une NON-porteuse : les seuils restent
  // intacts, et l'observation d'un `stat_modifier` reste propre.
  const trigger = scene.player[SCENE.carriers];
  trigger.is_neutralized = true;
  am.onUnitNeutralized(trigger, scene.player, scene.enemy);
  // ⚠️ `applyEndOfCombat` MUTE ses listes (`revive` y fait un `splice`) : on lui
  // en donne des copies, sinon la scène suivante hériterait d'un tableau vidé.
  const result = am.applyEndOfCombat([...scene.playerDead], [...scene.enemyDead]);

  const observed = observeUnits(scene, before).concat(observeAttributeResult(result, names))
    // La mort qu'on a provoquée soi-même n'est pas un effet.
    .filter(o => !(o.subject === trigger.card_id && o.detail === 'neutralisée'));
  return { observed, scene, before };
}

// ── Les terrains ─────────────────────────────────────────────────────────────

function runBoardEffect(board: any, effect: any, known: Set<string> | null) {
  const scaleId = scaleAttributeId(effect?.value_per);
  const nameable = (a: string) => !known || known.has(a);
  const aimed: string[] = [
    ...(effect?.target_attributes ?? []).filter(nameable),
    ...(scaleId && nameable(scaleId) ? [scaleId] : []),
  ];
  // ⚠️ La scène vise ce que l'EFFET vise : sans ça `target_attributes` ne
  // trouverait jamais personne et le banc déclarerait muets les 30 terrains
  // livrés — un outil qui crie au loup sur les cas sains est pire qu'un outil
  // absent. Un effet sans ciblage frappe déjà tout le monde.
  const scene = benchScene(aimed.length ? aimed : ['ARCH_BENCH']);
  const before = readAll(scene);
  const gameState = new (GameState as any)();
  applyBoardEffect(effect, {
    playerUnits: scene.player, enemyUnits: scene.enemy, gameState, sourceId: board.id,
  });
  const observed = observeUnits(scene, before);
  if (gameState.player_extra_draws) {
    observed.push({ subject: 'partie', detail: `pioche +${gameState.player_extra_draws}` });
  }
  return { observed, scene, before };
}

// ── Les magies ───────────────────────────────────────────────────────────────

function observeGameState(before: any, after: any, names: BenchNames): BenchObservation[] {
  const out: BenchObservation[] = [];
  const push = (detail: string) => out.push({ subject: 'partie', detail });
  if (before.player_hp !== after.player_hp) push(`PV du joueur ${before.player_hp} → ${after.player_hp}`);
  if (after.player_extra_draws > before.player_extra_draws) {
    push(`pioche +${after.player_extra_draws - before.player_extra_draws}`);
  }
  for (const g of after.player_guaranteed_draws.slice(before.player_guaranteed_draws.length)) {
    push(`pioche garantie — ${drawLabel(g, names)}`);
  }
  for (const m of after.player_hand_modifiers.slice(before.player_hand_modifiers.length)) {
    push(`retouche de main : ${m.type} ×${m.value}${m.attribute ? ` (${names.attribute(m.attribute)})` : ''}`);
  }
  if (after.player_board_slots !== before.player_board_slots) {
    push(`slots de board ${before.player_board_slots} → ${after.player_board_slots}`);
  }
  if (after.player_damage_multiplier_bonus !== before.player_damage_multiplier_bonus) {
    push(`multiplicateur de dégâts +${after.player_damage_multiplier_bonus - before.player_damage_multiplier_bonus}`);
  }
  return out;
}

const stateSnapshot = (gs: any) => ({
  player_hp: gs.player_hp,
  player_extra_draws: gs.player_extra_draws,
  player_guaranteed_draws: [...gs.player_guaranteed_draws],
  player_hand_modifiers: [...gs.player_hand_modifiers],
  player_board_slots: gs.player_board_slots,
  player_damage_multiplier_bonus: gs.player_damage_multiplier_bonus,
});

// ── Les zones : main, terrain, cimetière, PV ─────────────────────────────────
//
// ⚠️ Onze types de magie sont des NO-OP dans `MagieEffect.applyEffect` — tout
// leur travail vit dans `GameSession`, qui déplace des cartes et des unités
// entre les quatre zones. Le relevé d'unités ne les voit donc PAS, et le banc
// les déclarerait toutes muettes : le pire faux positif possible, puisqu'il
// porterait sur les magies les plus élaborées du jeu.
//
// ⚠️ La liste de ces onze n'est écrite NULLE PART ici, et c'est délibéré : le
// banc rejoue chaque magie dans la scène des zones et regarde ce qui a bougé.
// Un douzième type délégué à `GameSession` sera donc observé sans qu'on ait
// pensé à l'inscrire — l'exact inverse de la table fermée de `MagieOffer`, dont
// CLAUDE.md dit qu'un type oublié y disparaît en silence.

/** Un deck synthétique couvrant trois tiers — de quoi nourrir les pools. */
function zoneCards(): any[] {
  const at = (id: string, tier: number, over: Record<string, unknown> = {}) => ({
    ...benchCard(id, [], BENCH_PROFILE), _tiers: [tier], ...over,
  });
  return [
    at('T1_A', 1), at('T1_B', 1), at('T1_C', 1),
    at('T2_A', 2), at('T2_B', 2),
    // La fusion : deux matériels NOMMÉS, seuls ceux que `defuse_fusion` sait rendre.
    at('T2_FUSION', 2, { summon_conditions: [{ materials: 2, requires: ['T1_A', 'T1_B'] }] }),
    at('T3_A', 3),
  ];
}

/** L'inventaire des quatre zones — ce que ces magies déplacent, et rien d'autre. */
export function zoneSnapshot(session: any) {
  return {
    hand: session.hand.map((c: any) => c.id),
    board: session.board.getUnitsOnSide('player')
      .map((u: any) => `${u.card_id}@${u.position.col},${u.position.row}${u.is_neutralized ? ' †' : ''}`)
      .sort(),
    graveyard: session.graveyard.map((u: any) => u.card_id).sort(),
    player_hp: session.gameState.player_hp,
  };
}

export type ZoneReading = ReturnType<typeof zoneSnapshot>;

/**
 * La scène des zones, reconstruite pour chaque magie.
 *
 * ⚠️ `rand` est FIGÉ : trois de ces magies tirent (`_pickFrom`, `_drawMaterial`)
 * et un flux libre rendrait le résultat différent à chaque exécution. Un tirage
 * constant n'appauvrit rien — ce qu'on surveille est le DÉPLACEMENT, pas lequel
 * des candidats sort.
 */
export function zoneScene() {
  const cards = zoneCards();
  const byId = new Map(cards.map(c => [c.id, c]));
  const byTier = (t: number) => cards.filter(c => c._tiers.includes(t));
  const session: any = new (GameSession as any)({
    cardsByTier: { 1: byTier(1), 2: byTier(2), 3: byTier(3) },
    enemyDeck: {}, attributeList: [],
    cardDb: { getCard: (id: string) => byId.get(id) ?? null },
    getAllBoards: () => [], getAllMagies: () => [],
    rand: () => 0.42,
  });
  // ⚠️ Le troisième est la FUSION : `draw_material` a besoin d'une carte qui
  // NOMME des matériels, sans quoi il ne trouve rien à rendre et le banc la
  // regarderait ne rien faire.
  session.hand = [{ ...byId.get('T1_A') }, { ...byId.get('T2_A') }, { ...byId.get('T2_FUSION') }];
  const place = (id: string, col: number) => {
    const u = new (Unit as any)(byId.get(id), 'player');
    u.initial_position = { col, row: 0 };
    session.board.placeUnit(u, { col, row: 0 });
    return u;
  };
  const fusion = place('T2_FUSION', 0);
  const plain = place('T1_C', 1);
  const dead = new (Unit as any)(byId.get('T1_B'), 'player');
  dead.is_neutralized = true;
  session.graveyard.push(dead);
  session.gameState.player_hp = 500;
  return { session, fusion, plain, dead };
}

/** L'index de la main que le banc désigne — celui de la FUSION (cf. `zoneScene`). */
export const ZONE_HAND_INDEX = 2;

function describeZones(before: ZoneReading, after: ZoneReading): BenchObservation[] {
  const out: BenchObservation[] = [];
  const diff = (subject: string, a: string[], b: string[]) => {
    const rest = [...a];
    for (const x of b) {
      const i = rest.indexOf(x);
      if (i >= 0) rest.splice(i, 1); else out.push({ subject, detail: `+${x}` });
    }
    for (const x of rest) out.push({ subject, detail: `−${x}` });
  };
  diff('main', before.hand, after.hand);
  diff('terrain', before.board, after.board);
  diff('cimetière', before.graveyard, after.graveyard);
  if (before.player_hp !== after.player_hp) {
    out.push({ subject: 'partie', detail: `PV du joueur ${before.player_hp} → ${after.player_hp}` });
  }
  return out;
}

/**
 * La magie rejouée dans la scène des zones.
 *
 * ⚠️ Le CONTRECOUP est retiré (`cost_hp: 0`) : le banc mesure ce qu'une magie
 * FAIT, pas ce qu'elle coûte. Sans ça, une magie sans effet mais avec un coût
 * ferait bouger les PV du joueur et passerait pour active — le faux négatif
 * exact que le détecteur existe pour ne pas produire.
 */
function runZoneMagie(magie: any): BenchObservation[] {
  const family = targetFamily(magie?.effect?.type);
  if (family === 'global' || !family) return [];
  const { session, fusion, dead } = zoneScene();
  const free = { ...magie, cost_hp: 0 };
  const before = zoneSnapshot(session);
  try {
    if (family === 'hand') session.applyMagieOnHandCard(free, ZONE_HAND_INDEX);
    else if (family === 'graveyard') session.applyMagieOnGraveyardUnit(free, dead);
    // ⚠️ La cible unité est la FUSION, et non l'unité simple : c'est la seule
    // qui réponde aux onze — `defuse_fusion` a besoin de matériels, et tout le
    // reste s'applique indifféremment. Une table par type serait la même liste
    // fermée qu'on cherche à ne pas écrire.
    else session.applyMagieOnUnit(free, fusion);
  } catch (err) {
    return [{ subject: 'erreur', detail: String((err as Error)?.message ?? err) }];
  }
  return describeZones(before, zoneSnapshot(session));
}

function runMagie(magie: any, names: BenchNames) {
  const scene = benchScene('ARCH_BENCH');
  const target = scene.player[0];
  // Blessée et neutralisée-compatible : `heal`, `team_heal` et `revive`
  // s'appliquent tous sur une cible unité, et à PV pleins ils ne feraient rien.
  target.current_hp = 40;
  const before = readAll(scene);
  const gameState = new (GameState as any)();
  gameState.player_hp = 500;
  const stateBefore = stateSnapshot(gameState);
  applyMagieEffect(magie, { gameState, targetUnit: target, targetUnits: scene.player });
  const observed = observeUnits(scene, before)
    .concat(observeGameState(stateBefore, stateSnapshot(gameState), names))
    // ⚠️ Les magies déléguées à `GameSession` ne se voient QUE là. Rejoué pour
    // toutes, parce que le banc ne sait pas — et n'a pas à savoir — lesquelles.
    .concat(runZoneMagie(magie));
  return { observed, scene, before };
}

// ── Le banc ──────────────────────────────────────────────────────────────────

const RAW_NAMES: BenchNames = { attribute: id => id, card: id => id };

/** Les effets d'un seuil — `effects` d'abord, `effect` en repli, comme le moteur. */
function thresholdEffects(threshold: any): any[] {
  const list = Array.isArray(threshold?.effects) ? threshold.effects.filter(Boolean) : [];
  if (list.length) return list;
  return threshold?.effect ? [threshold.effect] : [];
}

function verdictOf(observed: BenchObservation[], hasEffect: boolean): BenchVerdict {
  if (!hasEffect) return 'descriptif';
  return observed.length ? 'actif' : 'muet';
}

export function runEffectBench(input: BenchInput): BenchReport {
  const names: BenchNames = { ...RAW_NAMES, ...input.names };
  // ⚠️ `null` et non un ensemble vide : « je n'ai pas de catalogue d'attributs »
  // n'est pas « aucun attribut n'existe ». Un appel de synthèse qui ne passe que
  // des terrains ne doit pas voir tous ses ciblages déclarés inexistants.
  const known = input.attributes?.length ? new Set<string>(input.attributes.map((a: any) => a.id)) : null;
  const rows: BenchRow[] = [];

  for (const attr of input.attributes ?? []) {
    const thresholds = Array.isArray(attr.thresholds) ? attr.thresholds : [];
    const all = thresholds.flatMap((t: any) => thresholdEffects(t));
    if (!all.length) {
      // Un archétype purement descriptif — 40 des 93 attributs livrés. Il est
      // listé plutôt que passé sous silence : c'est le seul moyen de voir qu'un
      // attribut a PERDU ses seuils, plutôt que de n'en avoir jamais eu.
      rows.push({
        key: `attribute:${attr.id}`, domain: 'attribute',
        entity_id: attr.id, entity_name: attr.name ?? attr.id,
        where: '', timing: attr.timing ?? null, type: null,
        label: 'Aucun effet', effect: null, cost_hp: 0,
        observed: [], verdict: 'descriptif',
        note: attr.timing && attr.timing !== 'none'
          ? `aucun seuil, alors que l'attribut annonce un timing « ${attr.timing} »`
          : null,
      });
      continue;
    }
    thresholds.forEach((threshold: any, ti: number) => {
      const list = thresholdEffects(threshold);
      list.forEach((effect: any, ei: number) => {
        const { observed, scene, before } = runAttributeEffect(attr, threshold, effect, names, known);
        const verdict = verdictOf(observed, !!effect?.type);
        rows.push({
          key: `attribute:${attr.id}:${ti}:${ei}`, domain: 'attribute',
          entity_id: attr.id, entity_name: attr.name ?? attr.id,
          where: `seuil ${threshold.count ?? '?'}` + (list.length > 1 ? ` · effet ${ei + 1}/${list.length}` : ''),
          timing: attr.timing ?? null, type: effect?.type ?? null,
          label: boardEffectLabel(effect, ids => ids.map(names.attribute).join(', '), names.card),
          effect, cost_hp: 0, observed, verdict,
          note: verdict === 'muet' ? diagnose('attribute', effect, attr.timing ?? null, scene, before, known) : null,
        });
      });
    });
  }

  for (const board of input.boards ?? []) {
    const list = boardEffects(board);
    if (!list.length) {
      rows.push({
        key: `board:${board.id}`, domain: 'board',
        entity_id: board.id, entity_name: board.name ?? board.id,
        where: '', timing: null, type: null, label: 'Aucun effet', effect: null,
        cost_hp: 0, observed: [], verdict: 'descriptif', note: null,
      });
      continue;
    }
    list.forEach((effect: any, ei: number) => {
      const { observed, scene, before } = runBoardEffect(board, effect, known);
      const verdict = verdictOf(observed, !!effect?.type);
      rows.push({
        key: `board:${board.id}:${ei}`, domain: 'board',
        entity_id: board.id, entity_name: board.name ?? board.id,
        where: list.length > 1 ? `effet ${ei + 1}/${list.length}` : '',
        timing: null, type: effect?.type ?? null,
        label: boardEffectLabel(effect, ids => ids.map(names.attribute).join(', '), names.card),
        effect, cost_hp: 0, observed, verdict,
        note: verdict === 'muet' ? diagnose('board', effect, null, scene, before, known) : null,
      });
    });
  }

  for (const magie of input.magies ?? []) {
    const effect = magie.effect ?? null;
    const { observed, scene, before } = runMagie(magie, names);
    const verdict = verdictOf(observed, !!effect?.type);
    rows.push({
      key: `magie:${magie.id}`, domain: 'magie',
      entity_id: magie.id, entity_name: magie.name ?? magie.id,
      where: '', timing: null, type: effect?.type ?? null,
      label: effectLabel(magie, names), effect,
      cost_hp: magieCostHp(magie), observed, verdict,
      note: verdict === 'muet' ? diagnose('magie', effect, null, scene, before, known) : null,
    });
  }

  const blank = () => ({ total: 0, actif: 0, muet: 0, descriptif: 0 });
  const counts = blank();
  const byDomain: Record<EffectDomain, ReturnType<typeof blank>> = {
    attribute: blank(), board: blank(), magie: blank(),
  };
  for (const r of rows) {
    counts.total++; counts[r.verdict]++;
    byDomain[r.domain].total++; byDomain[r.domain][r.verdict]++;
  }

  return { rows, scene: sceneSummary(), counts, byDomain };
}

/** Les seuls qui comptent : ce que le catalogue écrit et que le jeu n'applique pas. */
export const muteRows = (report: BenchReport): BenchRow[] =>
  report.rows.filter(r => r.verdict === 'muet');
