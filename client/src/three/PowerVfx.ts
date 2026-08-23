// Effets visuels des 14 pouvoirs. Ce module vit dans three/ et compose les
// primitives publiques de Scene3D — il n'en connaît que le type, jamais son
// implémentation, et n'importe ni React ni Zustand (garde-fous ESLint).
//
// Il est SÉPARÉ de Scene3D pour la même raison que Scene3D est séparé de
// CombatAnimator3D : Scene3D est une bibliothèque de primitives (elle ne parle
// que de géométrie et d'éléments), là où une recette de pouvoir parle d'un
// CombatEvent. Le précédent de composition est `Scene3D.spawnElementImpact`.
//
// Trois règles de design portent les 14 recettes :
//   1. ce qui distingue un pouvoir d'un autre est sa GRAMMAIRE (direction,
//      silhouette, locus), pas sa teinte — deux violets voisins sont
//      indiscernables en mouvement ;
//   2. HYBRIDE : la forme et la couleur appartiennent au pouvoir, la signature
//      élémentaire au lanceur (`elementAccent`, posé sur SA case seulement) ;
//   3. SOBRE : aucun `shakeCamera` ici — il reste réservé à l'élément `terre`.
//
// ⚠ Deux contraintes du rendu dictent la moitié des réglages ci-dessous, et
// elles ne se devinent pas :
//   • la caméra du board regarde DROIT vers le bas — tout ce qui doit se lire
//     est planaire, une barre verticale s'y projette sur un point ;
//   • une carte CSS3D occupe une case ENTIÈRE et vit dans un calque DOM empilé
//     au-dessus du canvas WebGL : sous 0,5 unité du centre d'une unité, rien
//     n'est visible, quelle que soit la hauteur.
// D'où les rayons larges, les dômes et orbites qui débordent la case, et les
// tailles de particules nettement supérieures à celles d'un impact d'attaque.
import { ELEMENT_STYLES, elementsForUnit } from './constants.js';
import type { Scene3D } from './Scene3D.js';
import type { Unit } from '../logic/Unit.js';
import type { Position } from '../logic/types.js';

// Doit rester synchronisé avec CombatAnimator3D / CombatManager (logic/
// n'importe jamais three/, la constante est dupliquée des deux côtés).
const BASE_TICK_MS = 180;

// Les 14 teintes. Les quatre dernières manquaient et retombaient sur un rouge
// générique — dont le Débuff et le Blocage, qui n'infligent aucun dégât.
export const POWER_COLORS: Record<string, number> = {
  POWER_HEAL:         0x4caf80,
  POWER_SHIELD:       0x6ab4e8,
  POWER_POISON:       0xc878e0,
  POWER_PARALYSIS:    0xf0c040,
  POWER_PUSH:         0xf0a040,
  POWER_BURN:         0xff6020,
  POWER_FREEZE:       0x8fd6ff,
  POWER_TELEPORT:     0xb070ff,
  POWER_CONFUSION:    0xa040c8,
  POWER_TAUNT:        0xc83020,
  POWER_SUPER_ATTACK: 0xffd060,
  POWER_AOE_ATTACK:   0xff8a3c,
  POWER_DEBUFF:       0x7a7f98,
  POWER_BLOCK:        0x6e7ac8,
};

const IMMUNE_COLOR = 0xffe9a8;

function powerColor(powerId: string): number {
  return POWER_COLORS[powerId] ?? 0xd8d8e0;
}

// ⚠ Le blending additif d'une couleur SOMBRE n'enregistre presque rien sur un
// plateau sombre : un rayon en 0xc83020 (Provocation) était purement et
// simplement invisible. Les traits fins se peignent donc dans une version
// éclaircie de la teinte du pouvoir, qui garde la couleur sans la perdre en
// blanc. Mélange composante par composante, sans dépendance à three/.
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
  /** Toutes les unités vivantes du camp adverse au lanceur (Provocation). */
  opponents: () => Unit[];
  /** Réduction de budget de l'appareil (LOW_END_DEVICE). */
  deviceScale: number;
}

// ── Budget & cadencement ───────────────────────────────────────────────────

// Un seul endroit décide du nombre de particules. Deux facteurs : l'appareil
// (déjà connu de Scene3D) et la vitesse de combat — à ×4 un step dure 45 ms, les
// effets s'empilent plus vite qu'ils ne s'éteignent.
function budget(ctx: PowerVfxContext, base: number): number {
  return Math.max(1, Math.round(base * ctx.deviceScale * speedScale(ctx)));
}

function speedScale(ctx: PowerVfxContext): number {
  return clamp(ctx.interval / BASE_TICK_MS, 0.55, 1);
}

// Les durées suivent la vitesse pour la même raison que les budgets.
function life(ctx: PowerVfxContext, seconds: number): number {
  return seconds * clamp(ctx.interval / BASE_TICK_MS, 0.4, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Retard bâti sur `scene.anims` et JAMAIS sur un setTimeout nu : un timer
// survivrait à la fin du combat et se réveillerait sur une scène détruite.
function after(scene: Scene3D, seconds: number, fn: () => void): void {
  if (seconds <= 0) { fn(); return; }
  let t = 0;
  scene.anims.push({
    update: (dt: number) => {
      t += dt;
      if (t < seconds) return true;
      fn();
      return false;
    },
  });
}

function tierOf(unit: Unit | null | undefined): number {
  return clamp(unit?.tier ?? 1, 1, 5);
}

function dirBetween(from: Position, to: Position): { x: number; z: number } {
  // Le repère monde : x suit la colonne, z suit la rangée À L'ENVERS
  // (zForRow = (TOTAL_ROWS - 1 - row)), d'où le signe sur la composante z.
  return { x: to.col - from.col, z: -(to.row - from.row) };
}

function manhattan(a: Position, b: Position): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

// ── Signature élémentaire du lanceur ───────────────────────────────────────

// Posée sur la case du LANCEUR uniquement, à budget réduit : la cible ne reçoit
// que l'identité du pouvoir, sans quoi une Attaque Zone sur cinq unités
// deviendrait illisible. C'est la moitié « unité » du choix hybride.
function elementAccent(scene: Scene3D, unit: Unit, ctx: PowerVfxContext): void {
  const pos = unit.position;
  if (!pos) return;
  const elements = elementsForUnit(unit);
  const t = tierOf(unit);
  for (const element of elements) {
    const style = ELEMENT_STYLES[element] || ELEMENT_STYLES.neutral;
    switch (element) {
      case 'feu':
        scene.spawnFlames(pos, t, { count: budget(ctx, 6 + t * 2), maxLife: life(ctx, 0.3), spread: 0.16 });
        break;
      case 'eau':
        scene.spawnSplash(pos, t, { count: budget(ctx, 5 + t * 2), maxLife: life(ctx, 0.28), spread: 0.14 });
        break;
      case 'foudre': {
        const arcs = Math.max(1, budget(ctx, 2 + Math.floor(t / 2)));
        for (let i = 0; i < arcs; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 0.35 + Math.random() * 0.3;
          scene.spawnLightningArc(
            pos,
            { col: pos.col + Math.cos(angle) * dist, row: pos.row + Math.sin(angle) * dist },
            style.color,
            { maxLife: life(ctx, 0.13), branches: 1 },
          );
        }
        break;
      }
      case 'metal':
        scene.spawnSwordSlash(pos, Math.max(1, t - 1));
        break;
      case 'sorcellerie':
        scene.spawnMagicCircle(pos, Math.max(1, t - 2));
        break;
      case 'air':
        scene.spawnTornado(pos, Math.max(1, t - 2), { maxLife: life(ctx, 0.4) });
        break;
      case 'terre':
        // spawnRockShards et NON spawnCrater : le cratère appelle une secousse
        // caméra, et les pouvoirs restent sobres (aucun shakeCamera ici).
        scene.spawnRockShards(pos, Math.max(1, t - 2));
        break;
      default:
        scene.spawnBurst(pos, style.color, budget(ctx, 10), {
          size: style.size * 1.3,
          speed: [style.speed[0] * 0.4, style.speed[1] * 0.4],
          lift: [style.lift[0] * 0.4, style.lift[1] * 0.4],
          maxLife: life(ctx, 0.26),
        });
    }
  }
}

// ── Déflexion d'immunité ───────────────────────────────────────────────────

// Sept pouvoirs peuvent rendre `extra.immune`. Une seule recette pour les sept,
// et AUCUN effet du pouvoir : jouer l'effet complet sur une cible immunisée —
// l'état d'avant — le rendait indiscernable d'un effet qui a pris.
export function playImmuneVfx(scene: Scene3D, target: Unit, ctx: PowerVfxContext): void {
  const pos = target.position;
  if (!pos) return;
  scene.spawnDome(pos, IMMUNE_COLOR, { radius: 0.86, maxLife: life(ctx, 0.5), growth: 0.09, opacity: 0.5 });
  scene.spawnRing(pos, 0xffffff, life(ctx, 0.3), 3);
  scene.spawnBurst(pos, IMMUNE_COLOR, budget(ctx, 10), {
    size: 0.12, speed: [0.5, 1.1], lift: [0.4, 0.9], gravity: 5, maxLife: life(ctx, 0.28),
  });
}

// ── Pulses de statut (poison / brûlure) ────────────────────────────────────

// Un poison est aujourd'hui invisible dès la seconde qui suit son lancement :
// c'est le plus haut rapport lisibilité/coût du lot, quatre motes par pulse.
export function playPoisonPulse(scene: Scene3D, unit: Unit, ctx: PowerVfxContext): void {
  if (!unit.position) return;
  scene.spawnBurst(unit.position, POWER_COLORS.POWER_POISON, budget(ctx, 5), {
    size: 0.15, speed: [0.45, 0.9], lift: [0.5, 1], gravity: -0.6, maxLife: life(ctx, 0.55),
  });
}

export function playBurnPulse(scene: Scene3D, unit: Unit, ctx: PowerVfxContext): void {
  if (!unit.position) return;
  scene.spawnFlames(unit.position, tierOf(unit), {
    count: budget(ctx, 5), maxLife: life(ctx, 0.3), spread: 0.14,
  });
}

// ── Les 14 recettes ────────────────────────────────────────────────────────

type Recipe = (scene: Scene3D, caster: Unit, targets: Unit[], extra: Record<string, unknown>, ctx: PowerVfxContext) => void;

const RECIPES: Record<string, Recipe> = {

  // Soin — colonne montante + convergence. Le vert se rassemble puis monte :
  // la seule grammaire « entrante » du camp allié.
  POWER_HEAL(scene, caster, targets, extra, ctx) {
    const color = POWER_COLORS.POWER_HEAL;
    const target = targets[0];
    const to = target?.position;
    if (!to) return;
    if (caster.position) scene.spawnRing(caster.position, color, life(ctx, 0.3), 2);

    const ratio = clamp(Number(extra.amount ?? 0) / Math.max(1, target.max_hp), 0.15, 1);
    const land = () => {
      scene.spawnConvergence(to, color, budget(ctx, 24 + Math.round(ratio * 24)), {
        radius: 1.55, maxLife: life(ctx, 0.45), height: 0.5, size: 0.12,
      });
      // Les motes montent ET s'écartent : une colonne strictement verticale se
      // projette sur un point sous la carte, elle ne se verrait jamais.
      scene.spawnBurst(to, color, budget(ctx, 16 + Math.round(ratio * 20)), {
        size: 0.13, speed: [0.7, 1.4], lift: [1.2, 2],
        gravity: -2, // la gravité est SOUSTRAITE dans _animate : négative = les motes accélèrent vers le haut
        maxLife: life(ctx, 0.6),
      });
      scene.spawnRing(to, color, life(ctx, 0.5), 5);
      scene.spawnFlash(scene.tilePosition(to), color, 3, 3.2, life(ctx, 0.4));
    };

    // L'orbe ne voyage que s'il y a un trajet : « l'allié au plus bas PV, soi
    // compris » désigne très souvent le lanceur lui-même.
    if (caster.position && caster.uid !== target.uid) {
      scene.playProjectile(caster.position, to, color).then(land);
    } else {
      land();
    }
  },

  // Bouclier — dôme. Rayon indexé sur ce que le bouclier vaut réellement.
  POWER_SHIELD(scene, caster, targets, extra, ctx) {
    const color = POWER_COLORS.POWER_SHIELD;
    const pos = targets[0]?.position ?? caster.position;
    if (!pos) return;
    const ratio = clamp(Number(extra.amount ?? 0) / Math.max(1, caster.max_hp), 0.2, 1);
    // Le rayon déborde la case : sous 0,5 unité le dôme disparaît derrière la
    // carte CSS3D de l'unité (cf. Scene3D.spawnDome).
    scene.spawnDome(pos, color, {
      radius: 0.82 + ratio * 0.28, maxLife: life(ctx, 0.8), growth: 0.13, opacity: 0.42,
    });
    scene.spawnRing(pos, color, life(ctx, 0.4), 3.5);
    scene.spawnFlash(scene.tilePosition(pos), color, 2.5, 3, life(ctx, 0.3));
  },

  // Super Attaque — rayon + explosion en cône dans son axe.
  POWER_SUPER_ATTACK(scene, caster, targets, _extra, ctx) {
    const color = POWER_COLORS.POWER_SUPER_ATTACK;
    const target = targets[0];
    const from = caster.position;
    const to = target?.position;
    if (!from || !to) return;

    if (caster.position) scene.playLunge(caster.uid, to);
    scene.spawnBeam(from, to, color, { width: 0.26, maxLife: life(ctx, 0.26), hold: 0.07, y: 0.3 });

    if (ctx.dying.has(target.uid)) return; // l'explosion de mort se lit seule
    const t = tierOf(caster);
    scene.spawnBurst(to, color, budget(ctx, 40 + t * 8), {
      size: 0.09 + t * 0.015, speed: [0.9, 2.2], lift: [0.6, 1.8], gravity: 7,
      maxLife: life(ctx, 0.38), dir: dirBetween(from, to), cone: Math.PI * 0.9,
    });
    scene.spawnRing(to, 0xffffff, life(ctx, 0.34), 9);
    scene.spawnFlash(scene.tilePosition(to), color, 4, 3.2, life(ctx, 0.25));
  },

  // Attaque Zone — éruption au lanceur, puis une onde qui traverse le board.
  // L'échelonnement EST la recette : cinq impacts simultanés identiques se
  // lisent comme une seule tache, une onde se lit comme une onde.
  POWER_AOE_ATTACK(scene, caster, targets, _extra, ctx) {
    const color = POWER_COLORS.POWER_AOE_ATTACK;
    const from = caster.position;
    if (!from) return;

    scene.spawnBurst(from, color, budget(ctx, 30), {
      size: 0.14, speed: [1.2, 2.6], lift: [3, 6], gravity: -1, maxLife: life(ctx, 0.5),
    });
    scene.spawnRing(from, color, life(ctx, 0.6), 22);
    after(scene, life(ctx, 0.1), () => scene.spawnRing(from, 0xffffff, life(ctx, 0.45), 14));
    scene.spawnFlash(scene.tilePosition(from), color, 4, 5, life(ctx, 0.3));

    // Plafond par lancement : c'est le pire cas de perf du jeu (jusqu'à un
    // board adverse plein). Le budget total est réparti, pas multiplié.
    const hit = targets.filter((t) => t.position && !ctx.dying.has(t.uid));
    if (!hit.length) return;
    const perTarget = Math.max(6, Math.floor(budget(ctx, 90) / hit.length));
    for (const target of hit) {
      const pos = target.position as Position;
      const delay = manhattan(from, pos) * 0.035;
      after(scene, life(ctx, delay), () => {
        scene.spawnBurst(pos, color, perTarget, {
          size: 0.11, speed: [0.6, 1.4], lift: [0.5, 1.3], gravity: 8, maxLife: life(ctx, 0.3),
        });
        scene.spawnRing(pos, color, life(ctx, 0.28), 4);
      });
    }
  },

  // Poison — nuage bas et lent. Aucune primitive nouvelle : c'est spawnBurst
  // sorti de ses réglages d'explosion (vitesse quasi nulle, gravité négative,
  // grosses particules, vie longue).
  POWER_POISON(scene, caster, targets, _extra, ctx) {
    const color = POWER_COLORS.POWER_POISON;
    const to = targets[0]?.position;
    if (!to) return;
    const cloud = () => {
      // Deux temps, et c'est nécessaire : un nuage qui traîne (ce qu'on veut)
      // met ~300 ms à sortir de la case et l'ARRIVÉE du poison ne se verrait
      // pas. Une bouffée rapide marque l'instant, la nappe lente installe le
      // statut. Même raison pour les deux anneaux.
      scene.spawnBurst(to, brighten(color, 0.25), budget(ctx, 22), {
        size: 0.14, speed: [1.3, 2.4], lift: [0.2, 0.6], gravity: 2, maxLife: life(ctx, 0.4),
      });
      scene.spawnBurst(to, color, budget(ctx, 34), {
        size: 0.16, speed: [0.5, 1.1], lift: [0.05, 0.25], gravity: -0.3, maxLife: life(ctx, 1.3),
      });
      scene.spawnRing(to, brighten(color, 0.35), life(ctx, 0.35), 6);
      scene.spawnRing(to, brighten(color, 0.2), life(ctx, 1.1), 4);
    };
    if (caster.position && caster.uid !== targets[0].uid) {
      scene.playProjectile(caster.position, to, color).then(cloud);
    } else {
      cloud();
    }
  },

  // Brûlure — embrasement. spawnFlames existe et fait exactement ça.
  POWER_BURN(scene, _caster, targets, _extra, ctx) {
    const color = POWER_COLORS.POWER_BURN;
    const to = targets[0]?.position;
    if (!to) return;
    scene.spawnFlames(to, tierOf(targets[0]), { count: budget(ctx, 34), maxLife: life(ctx, 0.6) });
    scene.spawnBurst(to, brighten(color, 0.25), budget(ctx, 18), {
      size: 0.14, speed: [0.5, 1.4], lift: [0.8, 1.8], gravity: 5, maxLife: life(ctx, 0.4),
    });
    scene.spawnRing(to, brighten(color, 0.3), life(ctx, 0.45), 4.5);
    scene.spawnFlash(scene.tilePosition(to), color, 3, 3, life(ctx, 0.28));
  },

  // Paralysie — cage verticale + anneau RENTRANT. La paralysie est une
  // constriction : un anneau qui s'ouvre dirait le contraire.
  POWER_PARALYSIS(scene, caster, targets, _extra, ctx) {
    const color = POWER_COLORS.POWER_PARALYSIS;
    const to = targets[0]?.position;
    if (!to) return;
    if (caster.position) {
      for (let i = 0; i < 2; i++) {
        scene.spawnLightningArc(caster.position, to, color, { maxLife: life(ctx, 0.16), branches: 1, jitter: 0.2 });
      }
    }
    // Les arcs se referment SUR LE PLAN DU SOL, pas en cage verticale : la
    // caméra du board regarde droit vers le bas, une barre verticale s'y projette
    // sur un point. Tout ce qui doit se lire est planaire.
    const base = scene.tilePosition(to);
    const bars = Math.max(4, budget(ctx, 7));
    const arcColor = brighten(color, 0.25);
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2 + Math.random() * 0.3;
      const rim = base.clone();
      rim.x += Math.cos(a) * 0.85;
      rim.z += Math.sin(a) * 0.85;
      rim.y += 0.25;
      scene.spawnLightningArc(rim, base, arcColor, {
        maxLife: life(ctx, 0.32), jitter: 0.14, lift: 0.25, branches: 1, segments: 6,
      });
    }
    scene.spawnBurst(to, color, budget(ctx, 22), {
      size: 0.12, speed: [0.5, 1.2], lift: [0.6, 1.4], gravity: 6, maxLife: life(ctx, 0.32),
    });
    // maxScale négatif : spawnRing calcule 1 + p * maxScale, l'anneau passe donc
    // de 1 à 0.3 au lieu de s'étendre. Aucun code nouveau pour ça.
    scene.spawnRing(to, color, life(ctx, 0.4), -4, 5);
  },

  // Poussée — bourrasque en cône. `extra.pushed === 0` (bord, unité ou case
  // bloquée) a sa PROPRE recette : jouer une poussée réussie sur une poussée qui
  // n'a pas eu lieu ment sur ce que la logique vient de faire.
  POWER_PUSH(scene, caster, targets, extra, ctx) {
    const color = POWER_COLORS.POWER_PUSH;
    const target = targets[0];
    const to = target?.position;
    const from = caster.position;
    if (!to || !from) return;
    const pushed = Number(extra.pushed ?? 0);
    const dir = dirBetween(from, to);

    scene.spawnBurst(from, brighten(color, 0.25), budget(ctx, 34), {
      size: 0.16, speed: [1.8, 3.4], lift: [0.3, 0.9], gravity: 3,
      maxLife: life(ctx, 0.4), dir, cone: Math.PI / 4,
    });

    if (pushed <= 0) {
      // Butée : compression au contact, rien qui parte vers l'arrière.
      scene.spawnRing(to, 0xffffff, life(ctx, 0.3), -3.5, 4.5);
      scene.spawnBurst(to, brighten(color, 0.3), budget(ctx, 30), {
        size: 0.16, speed: [1, 2.2], lift: [0.8, 1.8], gravity: 9,
        maxLife: life(ctx, 0.32), dir: { x: -dir.x, z: -dir.z }, cone: Math.PI * 0.8,
      });
      scene.spawnFlash(scene.tilePosition(to), brighten(color, 0.3), 2.5, 2.6, life(ctx, 0.22));
      return;
    }
    // Traînée de poussière sur les cases traversées.
    for (let i = 1; i <= pushed; i++) {
      const trail: Position = {
        col: to.col - Math.sign(dir.x) * i,
        row: to.row + Math.sign(dir.z) * i,
      };
      after(scene, life(ctx, 0.04 * (pushed - i)), () => scene.spawnRing(trail, brighten(color, 0.2), life(ctx, 0.35), 3.5));
    }
    scene.spawnBurst(to, color, budget(ctx, 16), {
      size: 0.12, speed: [0.5, 1.2], lift: [0.4, 1], gravity: 8, maxLife: life(ctx, 0.28),
    });
  },

  // Débuff — implosion descendante, la seule recette sans aucune lumière : un
  // débuff qui brille dirait le contraire de ce qu'il fait.
  POWER_DEBUFF(scene, _caster, targets, _extra, ctx) {
    const color = POWER_COLORS.POWER_DEBUFF;
    const to = targets[0]?.position;
    if (!to) return;
    scene.spawnConvergence(to, brighten(color, 0.3), budget(ctx, 56), {
      radius: 1.6, maxLife: life(ctx, 0.55), height: 0.7, sink: true, size: 0.17,
    });
    scene.spawnRing(to, color, life(ctx, 0.5), -5, 6);
  },

  // Blocage — sceau. Le cercle runique se pose AU-DESSUS de la carte, là où vit
  // la jauge de pouvoir : c'est elle qu'on scelle.
  POWER_BLOCK(scene, caster, targets, _extra, ctx) {
    const color = POWER_COLORS.POWER_BLOCK;
    const to = targets[0]?.position;
    if (!to) return;
    if (caster.position) {
      scene.spawnBeam(caster.position, to, color, { width: 0.1, maxLife: life(ctx, 0.22), hold: 0.05, y: 0.45 });
    }
    // Échelle 1,7 : à l'échelle 1 le sceau tient dans la case et passe derrière
    // la carte de l'unité.
    scene.spawnMagicCircle(to, tierOf(targets[0]), color, 1.7);
    scene.spawnRing(to, color, life(ctx, 0.45), -4, 5);
  },

  // Confusion — orbite persistante. L'image la plus lisible du lot, et la seule
  // qui reste à l'écran tant que le statut dure.
  POWER_CONFUSION(scene, _caster, targets, _extra, ctx) {
    const color = POWER_COLORS.POWER_CONFUSION;
    const target = targets[0];
    const to = target?.position;
    if (!to) return;
    scene.spawnOrbit(to, color, {
      count: 3, radius: 0.76, height: 0.62, speed: 3.6, size: 0.12,
      followUid: target.uid,
      // Le statut fait foi, pas une durée figée : elle mentirait dès que la
      // vitesse de combat change ou qu'un POWER_DEBUFF purge la confusion.
      alive: () => target.isAlive() && target.confusion_remaining > 0,
      maxLife: 12,
    });
    scene.spawnRing(to, color, life(ctx, 0.4), 3);
    scene.spawnFlash(scene.tilePosition(to), color, 2.5, 3, life(ctx, 0.25));
  },

  // Provocation — ping sonar au lanceur, puis un trait DEPUIS chaque ennemi
  // vers lui. C'est la seule recette qui montre la mécanique elle-même : « ils
  // me regardent tous maintenant », ce qu'aucun toast ne peut dire.
  POWER_TAUNT(scene, caster, _targets, _extra, ctx) {
    const color = POWER_COLORS.POWER_TAUNT;
    const from = caster.position;
    if (!from) return;
    [0, 0.12, 0.24].forEach((delay, i) => {
      after(scene, life(ctx, delay), () => scene.spawnRing(from, color, life(ctx, 0.5), 6 + i * 5));
    });
    scene.spawnFlash(scene.tilePosition(from), color, 2.5, 3.2, life(ctx, 0.35));

    for (const foe of ctx.opponents()) {
      if (!foe.position || !foe.isAlive()) continue;
      scene.spawnBeam(foe.position, from, brighten(color, 0.5), {
        width: 0.2, maxLife: life(ctx, 0.5), hold: 0.22, y: 0.38, core: false, opacity: 1,
      });
    }
  },

  // Téléportation — implosion, rémanent, jaillissement. Le déplacement lui-même
  // est traité par CombatAnimator3D (playBlink au lieu du lerp du `move`).
  POWER_TELEPORT(scene, caster, _targets, extra, ctx) {
    const color = POWER_COLORS.POWER_TELEPORT;
    const from = extra.from as Position | undefined;
    const to = (extra.to as Position | undefined) ?? caster.position ?? undefined;
    if (!to) return;
    if (from) {
      scene.spawnConvergence(from, color, budget(ctx, 22), {
        radius: 1.35, maxLife: life(ctx, 0.3), height: 0.6, sink: true, size: 0.13,
      });
      scene.spawnRing(from, color, life(ctx, 0.3), -5, 6);
      scene.spawnBeam(from, to, color, { width: 0.14, maxLife: life(ctx, 0.2), hold: 0.03, y: 0.36, opacity: 0.6 });
    }
    after(scene, life(ctx, 0.11), () => {
      scene.spawnBurst(to, color, budget(ctx, 30), {
        size: 0.13, speed: [1.4, 3], lift: [0.8, 2], gravity: 5, maxLife: life(ctx, 0.4),
      });
      scene.spawnRing(to, color, life(ctx, 0.4), 6);
      scene.spawnFlash(scene.tilePosition(to), color, 4, 4, life(ctx, 0.3));
    });
  },

  // Gel — éclat sur la cible ; les cristaux de la case sont posés par
  // CombatAnimator3D, qui tient déjà le cycle de vie des cases gelées.
  POWER_FREEZE(scene, caster, targets, _extra, ctx) {
    const color = POWER_COLORS.POWER_FREEZE;
    const to = targets[0]?.position;
    if (!to) return;
    const shatter = () => {
      scene.spawnBurst(to, color, budget(ctx, 26), {
        size: 0.13, speed: [0.5, 1.3], lift: [0.6, 1.6], gravity: 4, spin: 1.5, maxLife: life(ctx, 0.5),
      });
      scene.spawnRing(to, 0xc8f4ff, life(ctx, 0.45), 4.5);
      scene.spawnFlash(scene.tilePosition(to), color, 3, 3, life(ctx, 0.25));
    };
    if (caster.position && caster.uid !== targets[0].uid) {
      scene.playProjectile(caster.position, to, color).then(shatter);
    } else {
      shatter();
    }
  },
};

// ── Point d'entrée ─────────────────────────────────────────────────────────

/**
 * Joue la recette d'un pouvoir. L'immunité (`extra.immune`) est traitée en
 * amont par l'appelant : une cible immunisée ne reçoit QUE la déflexion.
 * Un power_id inconnu retombe sur un impact générique plutôt que sur rien.
 */
export function playPowerVfx(
  scene: Scene3D,
  caster: Unit,
  targets: Unit[],
  powerId: string,
  extra: Record<string, unknown>,
  ctx: PowerVfxContext,
): void {
  elementAccent(scene, caster, ctx);

  const recipe = RECIPES[powerId];
  if (recipe) {
    recipe(scene, caster, targets, extra, ctx);
    return;
  }
  const color = powerColor(powerId);
  for (const target of targets) {
    if (!target.position || ctx.dying.has(target.uid)) continue;
    scene.spawnBurst(target.position, color, budget(ctx, 30), { maxLife: life(ctx, 0.4) });
    scene.spawnRing(target.position, color, life(ctx, 0.4), 5);
  }
}
