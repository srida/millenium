// Effets visuels des 16 pouvoirs. Ce module vit dans three/ et compose les
// primitives publiques de Scene3D — il n'en connaît que le type, jamais son
// implémentation, et n'importe ni React ni Zustand (garde-fous ESLint).
//
// ⚠️ Depuis la refonte « Powers.dc.html » (session Claude Design), les 16
// recettes vivent dans `three/Powers.js` (moteur EnergyArrows, ribbons,
// particules shader) et non plus ici : ce fichier ne fait plus que RÉSOUDRE
// un `Unit`/`CombatEvent` en acteur de scène et appeler `scene.powers`, sur
// le même principe que `Scene3D._actorFor` pour `spawns`/`melee`/`shatter`.
// Il garde en revanche la charge des mots-clés (Explosif…), qui restent sur
// les primitives historiques de `Scene3D` — une surface de design distincte,
// non couverte par cette refonte.
import type { Scene3D } from './Scene3D.js';
import type { Unit } from '../logic/Unit.js';
// ⚠️ La clé de recette d'un mot-clé est ÉCRITE dans `logic/effects/types.ts`, et
// importée ici : c'est ce qui interdit structurellement la dérive entre ce que
// le compilateur estampille et ce que cette table indexe (cf. `VFX_EXPLOSIF`).
import { VFX_EXPLOSIF } from '../logic/effects/types.js';

// Doit rester synchronisé avec CombatAnimator3D / CombatManager (logic/
// n'importe jamais three/, la constante est dupliquée des deux côtés).
const BASE_TICK_MS = 180;

// ⚠ Le blending additif d'une couleur SOMBRE n'enregistre presque rien sur un
// plateau sombre : un rayon en 0xc83020 (Provocation) était purement et
// simplement invisible. Les traits fins se peignent donc dans une version
// éclaircie de la teinte du pouvoir, qui garde la couleur sans la perdre en
// blanc. Mélange composante par composante, sans dépendance à three/. Utilisé
// par le seul mot-clé qui reste sur les primitives historiques (Explosif).
function brighten(color: number, amount: number): number {
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff);
}

// ── Contexte d'un lancement ────────────────────────────────────────────────

export interface PowerVfxContext {
  /** Intervalle réel entre deux steps (BASE_TICK_MS / vitesse de combat). */
  interval: number;
  /** uids qui meurent dans le même step : leur impact est coupé, l'explosion de mort se lit seule. */
  dying: Set<number>;
  /** Réduction de budget de l'appareil (LOW_END_DEVICE). */
  deviceScale: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ⚠️ Un seul endroit traduit (appareil, vitesse de combat) en (compteur de
// particules, durées) de `Powers.js` — sinon un combat à ×4 (45 ms/step)
// laisserait les recettes déborder largement sur le step suivant, exactement
// ce que la vitesse de combat existe pour éviter. Les deux planchers (0.4 et
// 0.55) reprennent ceux de l'ancienne version Scene3D-primitives : les durées
// tolèrent un raccourcissement plus dur que les compteurs de particules, dont
// descendre sous ~55 % vide des recettes entières.
function applyGlobals(scene: Scene3D, ctx: PowerVfxContext): void {
  const speedFactor = clamp(ctx.interval / BASE_TICK_MS, 0.4, 1);
  const powerFactor = ctx.deviceScale * clamp(ctx.interval / BASE_TICK_MS, 0.55, 1);
  scene.powers.setGlobals({ speed: 1 / speedFactor, power: powerFactor });
}

// ── Statuts persistants ────────────────────────────────────────────────────

// ⚠️ La SEULE lecture de « ce statut est-il actif ? », et elle porte sur les
// champs `Unit` — jamais sur une horloge décorative interne à `Powers.js`.
// C'est ce qui rend l'overlay + la boucle de particules d'un statut
// AUTO-CORRECTEURS : une confusion purgée par un Débuff, un bouclier qui
// encaisse jusqu'à 0, une paralysie qui expire — tout se referme au tick
// suivant sans qu'un événement dédié doive le dire.
const STATUS_ACTIVE: Record<string, (u: Unit) => boolean> = {
  burn: (u) => (u.burn_stacks?.length ?? 0) > 0,
  poison: (u) => (u.dot_effects?.length ?? 0) > 0,
  paralysis: (u) => (u.paralysis_remaining ?? 0) > 0,
  block: (u) => u.is_power_blocked || (u.power_block_remaining ?? 0) > 0,
  taunt: (u) => (u.taunt_remaining ?? 0) > 0,
  weaken: (u) => (u.weaken_remaining ?? 0) > 0,
  confusion: (u) => (u.confusion_remaining ?? 0) > 0,
  shield: (u) => (u.shield ?? 0) > 0,
};

/**
 * Appelé à CHAQUE tick (`CombatAnimator3D._refreshPowerGauges`, déjà un
 * balayage de toutes les unités vivantes) pour garder l'overlay de statut de
 * chaque carte en phase avec la vérité. Idempotent dans les deux sens : une
 * unité déjà marquée ne rejoue pas son entrée, une absence de statut ne fait
 * rien si rien n'était affiché.
 */
export function syncPowerStatuses(scene: Scene3D, units: Unit[]): void {
  for (const unit of units) {
    if (!unit.isAlive()) continue;
    const actor = scene.actorForUid(unit.uid);
    if (!actor) continue;
    for (const key of Object.keys(STATUS_ACTIVE)) {
      scene.powers.setStatusActive(actor, key, STATUS_ACTIVE[key](unit));
    }
  }
}

// ── Pulses de statut (poison / brûlure) ────────────────────────────────────

// Rejoué à chaque tick de dégâts réel, EN PLUS de la respiration périodique de
// la boucle persistante : c'est ce qui garde le dégât visible exactement
// quand il tombe, plutôt que soumis au seul rythme décoratif de l'ambiance.
export function playPoisonPulse(scene: Scene3D, unit: Unit, ctx: PowerVfxContext): void {
  const actor = scene.actorForUid(unit.uid);
  if (!actor) return;
  applyGlobals(scene, ctx);
  scene.powers.pulsePoison(actor);
}

export function playBurnPulse(scene: Scene3D, unit: Unit, ctx: PowerVfxContext): void {
  const actor = scene.actorForUid(unit.uid);
  if (!actor) return;
  applyGlobals(scene, ctx);
  scene.powers.pulseBurn(actor);
}

// ── Déflexion d'immunité ───────────────────────────────────────────────────

/** Sept pouvoirs peuvent rendre `extra.immune` — une seule recette pour eux. */
export function playImmuneVfx(scene: Scene3D, target: Unit, ctx: PowerVfxContext): void {
  const actor = scene.actorForUid(target.uid);
  if (!actor) return;
  applyGlobals(scene, ctx);
  scene.powers.deflect(actor);
}

// ── Point d'entrée des 16 pouvoirs ─────────────────────────────────────────

/**
 * Joue la recette d'un pouvoir. Résout `caster`/`targets` (des `Unit`) en
 * acteurs de scène et délègue à `scene.powers.cast()` — cf. l'en-tête de
 * `Powers.js` pour ce que chaque recette lit dans `extra` plutôt que de le
 * recalculer (Poussée, Gel, Téléportation, Invocation de token, Attaque Zone).
 */
export function playPowerVfx(
  scene: Scene3D,
  caster: Unit,
  targets: Unit[],
  powerId: string,
  extra: Record<string, unknown>,
  ctx: PowerVfxContext,
): void {
  const casterActor = scene.actorForUid(caster.uid);
  if (!casterActor) return;
  applyGlobals(scene, ctx);

  // Super Attaque au contact : le lanceur s'élance déjà via `playLunge`
  // (posé sur `scene.anims`, indépendant de `Powers.js`) — la recette ne
  // touche alors jamais sa position (cf. l'en-tête de `Powers.js`).
  if (powerId === 'POWER_SUPER_ATTACK' && (caster.range ?? 3) <= 1 && caster.position && targets[0]?.position) {
    scene.playLunge(caster.uid, targets[0].position);
  }

  const recipeExtra: Record<string, unknown> = { ...extra };
  if (powerId === 'POWER_AOE_ATTACK') {
    // La liste de cibles EST celle que la simulation a déjà résolue — jamais
    // recalculée depuis le camp adverse à cet instant (cf. `ctx.dying`).
    recipeExtra.targets = targets
      .filter((t) => t.position && !ctx.dying.has(t.uid))
      .map((t) => scene.actorForUid(t.uid))
      .filter((a): a is NonNullable<typeof a> => a != null);
  }

  const targetActor = targets.map((t) => scene.actorForUid(t.uid)).find((a) => a != null) ?? casterActor;
  scene.powers.cast(powerId, casterActor, targetActor, { tier: caster.tier, extra: recipeExtra });
}

// ── Les mots-clés — une table à part, distincte des 16 pouvoirs ───────────
//
// ⚠️ Restent sur les primitives historiques de `Scene3D` (`spawnFlash`,
// `spawnRing`, `spawnBurst`) : cette refonte ne couvre que les pouvoirs de
// carte (`Powers.dc.html`), pas les mécaniques d'attribut. Fusionner les deux
// tables rendrait indiscernable, à la lecture, ce qui est un pouvoir et ce qui
// est un mot-clé — et un repli générique les confondrait en silence.
type KeywordRecipe = (scene: Scene3D, caster: Unit, targets: Unit[], ctx: PowerVfxContext) => void;

// Reprend budget()/life() de l'ancienne version : Explosif n'a pas migré vers
// `Powers.js`, il a donc toujours besoin de sa propre échelle appareil/vitesse.
function keywordBudget(ctx: PowerVfxContext, base: number): number {
  return Math.max(1, Math.round(base * ctx.deviceScale * clamp(ctx.interval / BASE_TICK_MS, 0.55, 1)));
}
function keywordLife(ctx: PowerVfxContext, seconds: number): number {
  return seconds * clamp(ctx.interval / BASE_TICK_MS, 0.4, 1);
}

const RECIPES_MOT_CLE: Record<string, KeywordRecipe> = {
  /**
   * **Explosif** — une déflagration orange qui part de la case du porteur, pas
   * de celle de sa victime : c'est LUI qui explose, elle ne fait qu'encaisser.
   *
   * ⚠️ Tout se lit à PLAT (la caméra regarde droit vers le bas) : l'anneau
   * rasant porte la portée, les motes s'écartent au lieu de monter, et le flash
   * marque le foyer. Une colonne verticale se projetterait sur un point.
   */
  [VFX_EXPLOSIF](scene, caster, targets, ctx) {
    const from = caster.position;
    if (!from) return;
    const color = 0xff7a2a;

    scene.spawnFlash(scene.tilePosition(from), color, 3.2, 3.4, keywordLife(ctx, 0.35));
    scene.spawnRing(from, color, keywordLife(ctx, 0.45), 6);
    scene.spawnBurst(from, color, keywordBudget(ctx, 42), {
      size: 0.15, speed: [1.6, 3.2], lift: [0.2, 0.7], maxLife: keywordLife(ctx, 0.5),
    });

    for (const t of targets) {
      if (!t.position) continue;
      // ⚠️ Pas de garde `ctx.dying` ici, contrairement au repli des pouvoirs :
      // la victime est JUSTEMENT en train de mourir, et c'est l'explosion qui
      // la tue. La sauter reviendrait à ne rien montrer.
      scene.spawnBurst(t.position, brighten(color, 0.3), keywordBudget(ctx, 26), {
        size: 0.13, speed: [0.9, 1.9], maxLife: keywordLife(ctx, 0.4),
      });
      scene.spawnRing(t.position, color, keywordLife(ctx, 0.35), 4);
    }
  },
};

/** Le pendant de `playPowerVfx` pour un événement `keyword`. */
export function playKeywordVfx(
  scene: Scene3D,
  bearer: Unit,
  targets: Unit[],
  keywordVfx: string,
  ctx: PowerVfxContext,
): void {
  // ⚠️ **Aucun repli générique** : un mot-clé sans recette ne doit RIEN
  // dessiner. Un pouvoir sans recette reste un coup porté ; un mot-clé, lui,
  // est souvent purement passif (Tour, Second souffle) — une explosion par
  // défaut en inventerait un à chacun.
  RECIPES_MOT_CLE[keywordVfx]?.(scene, bearer, targets, ctx);
}
