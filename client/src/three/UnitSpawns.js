// UnitSpawns — apparition élémentaire des unités, sur la base d'EnergyArrows.
// Trois temps : charge (la case s'éveille, carte invisible), formation (la carte
// entre selon son élément : chute, éruption, éclair, tourbillon…), impact (effet
// d'élément + onde de tier). L'élément décide de la FORME, le tier de la PUISSANCE :
// rayon, densité, durée de charge, secousse, et au-delà du tier 3 des couches
// supplémentaires dans la couleur du tier (cf. `cardPalette.frameForTier`, la
// même palette que le cadre de la carte — deux couleurs de tier qui diraient
// autre chose se remarqueraient).
// Un deuxième élément (unité mixte) nourrit la charge et ajoute son propre impact.
//
// Acteur attendu : { obj: Object3D, home: Vector3, baseQuat: Quaternion, baseScale: number, setOpacity?(a) }
import * as THREE from 'three';
import { normalizeElement } from './EnergyArrows.js';
import { frameForTier } from './cardPalette.js';

export const SPAWN_TIER_POWER = { 1: 0.6, 2: 0.8, 3: 1, 4: 1.35, 5: 1.8 };

// form : entrée de la carte · charge/dur : durées de base (s) · shake : secousse à l'impact
export const SPAWN_STYLES = {
  feu: { form: 'rise', charge: 0.34, dur: 0.36, shake: 0.02 },
  glace: { form: 'crystal', charge: 0.4, dur: 0.32, shake: 0.012 },
  foudre: { form: 'blink', charge: 0.3, dur: 0.22, shake: 0.03 },
  energie: { form: 'pop', charge: 0.42, dur: 0.28, shake: 0.018 },
  sorcellerie: { form: 'shadow', charge: 0.48, dur: 0.44, shake: 0.012 },
  air: { form: 'spin', charge: 0.3, dur: 0.46, turns: 2, shake: 0.01 },
  terre: { form: 'drop', charge: 0.3, dur: 0.3, height: 3, shake: 0.06 },
  eau: { form: 'wobble', charge: 0.34, dur: 0.44, shake: 0.012 },
  metal: { form: 'drop', charge: 0.26, dur: 0.2, height: 2.2, spin: 1, shake: 0.045 },
  sable: { form: 'spin', charge: 0.38, dur: 0.5, turns: 1, shake: 0.015 },
  plante: { form: 'grow', charge: 0.4, dur: 0.5, shake: 0.01 },
  neutral: { form: 'drop', charge: 0.2, dur: 0.24, height: 2, shake: 0.02 },
};

export const DEFAULT_SPAWN_GLOBALS = { speed: 1, power: 1, shake: 1, tierPower: { ...SPAWN_TIER_POWER } };

const UP = new THREE.Vector3(0, 1, 0), TAU = Math.PI * 2;
const E = {
  out: (u) => 1 - (1 - u) ** 3,
  in: (u) => u * u,
  back: (u) => { const c = 1.7, k = u - 1; return 1 + (c + 1) * k * k * k + c * k * k; },
};
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const rand = (a, b) => a + Math.random() * (b - a);
const rr = (r) => rand(r[0], r[1]);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const _q = new THREE.Quaternion();

// Contexte d'effet : positions et échelles déjà résolues pour une apparition
class Ctx {
  constructor(fx, a, P, s) {
    this.fx = fx; this.a = a; this.P = P; this.s = s;
    this.pos = a.pos; this.tier = a.tier; this.T = frameForTier(a.tier).edge;
    this.core = P.coreColor.getStyle(); this.halo = P.haloColor.getStyle();
    this.tp = P.tp; this.sparks = P.sparks?.colors || [this.core, this.halo];
    this.pm = Math.max(0.35, fx.globals.particles); this.acc = {};
  }
  get tc() { return this.a.tc; }
  get tf() { return this.a.tf; }
  N(n) { return Math.max(2, Math.round(n * this.pm * this.s)); }
  ring(color, r, dur, o = {}) { this.fx._ring(this.pos, color, r * this.s, dur, o); }
  flash(color, r, dur, alpha = 1) { this.fx._flash(this.pos, color, r * this.s, dur, alpha); }
  burst(n, o) { this.fx._burst(this.pos, this.N(n), { ...o, s: this.s }); }
  shards(n, len, speed, colors, size, life) { this.fx._shards(this.pos, n, len * this.s, speed * Math.sqrt(this.s), colors, size * Math.sqrt(this.s), life); }
  swirl(n, colors, pool, o) { this.fx._swirl(this.pos, this.N(n), this.s, colors, pool, o); }
  bolt(len, segs, colors, size, life, jag = 0.1) {
    const a = Math.random() * TAU, L = len * this.s;
    this.fx._bolt(this.pos, { x: this.pos.x + Math.cos(a) * L, y: this.pos.y, z: this.pos.z + Math.sin(a) * L }, segs, jag, colors, size * Math.sqrt(this.s), life);
  }
  later(t, fn) { this.fx.timers.push({ t, fn }); }
  stream(key, rate, dt, fn) {
    this.acc[key] = (this.acc[key] || 0) + rate * this.pm * Math.sqrt(this.s) * dt;
    while (this.acc[key] >= 1) { this.acc[key] -= 1; fn(); }
  }
  _pool(blend) { return blend === 'normal' ? this.fx.pNorm : this.fx.pAdd; }
  // particule qui monte depuis la case (vers la caméra)
  up(colors, { r = 0.35, vy = [0.5, 1.5], out = 0.2, swirl = 0, life = [0.3, 0.6], size = [0.04, 0.09], sizeEnd = 0, drag = 1.5, grav = 0, blend = 'add', alpha = 1, tw = false } = {}) {
    const k = Math.sqrt(this.s), a = Math.random() * TAU, c = Math.cos(a), sn = Math.sin(a), d = Math.sqrt(Math.random()) * r * this.s, p = this.pos;
    this._pool(blend).spawn(p.x + c * d, p.y + 0.02, p.z + sn * d, (c * out - sn * swirl) * k, rr(vy) * k, (sn * out + c * swirl) * k,
      rr(life), rr(size) * k, sizeEnd * k, pick(colors), alpha, drag, grav, tw);
  }
  // particule aspirée vers le centre de la case, en spirale si swirl > 0
  inward(colors, { R = 1, swirl = 0, life = [0.35, 0.5], size = [0.03, 0.06], sizeEnd = 0, blend = 'add', alpha = 1, tw = false, y = 0.05 } = {}) {
    const k = Math.sqrt(this.s), L = rr(life), a = Math.random() * TAU, c = Math.cos(a), sn = Math.sin(a), d = R * this.s * rand(0.8, 1.1), v = d / L, p = this.pos;
    this._pool(blend).spawn(p.x + c * d, p.y + y, p.z + sn * d, (-c - sn * swirl) * v, 0, (-sn + c * swirl) * v,
      L, rr(size) * k, sizeEnd * k, pick(colors), alpha, 0, 0, tw);
  }
}

// start : début de charge · charge/form : émission continue · burst : début de formation · land : impact
export const SPAWN_FX = {
  feu: {
    start(k) { k.ring(k.halo, 0.6, k.tc, { reverse: 1, width: 0.12 }); k.flash(k.halo, 0.45, k.tc, 0.45); },
    charge(k, dt) { k.stream('e', 70, dt, () => k.up(k.tp.colors, { r: 0.4, vy: [0.4, 1.4], size: [0.06, 0.13], sizeEnd: 0.02 })); },
    form(k, dt) {
      k.stream('p', 170, dt, () => k.up(k.tp.colors, { r: 0.22, vy: [2, 4.2], out: 0.6, life: [0.25, 0.5], size: [0.08, 0.18], sizeEnd: 0.02 }));
      k.stream('s', 18, dt, () => k.up(['#3a1a10', '#221008'], { r: 0.3, vy: [0.6, 1.4], size: [0.16, 0.26], sizeEnd: 0.4, blend: 'normal', alpha: 0.35, life: [0.6, 1] }));
    },
    land(k) {
      k.flash(k.halo, 0.9, 0.28); k.flash(k.core, 0.4, 0.16);
      k.ring(k.halo, 1.1, 0.45, { width: 0.12 });
      k.burst(40, { colors: k.tp.colors, speed: [1, 3.2], life: [0.3, 0.75], size: [0.06, 0.14], sizeEnd: 0.01, drag: 3.2 });
    },
  },
  glace: {
    start(k) { k.ring('#e8fbff', 0.95, k.tc, { reverse: 1, width: 0.04 }); k.ring(k.halo, 0.7, k.tc * 0.7, { reverse: 1, width: 0.06, delay: k.tc * 0.3 }); },
    charge(k, dt) { k.stream('e', 70, dt, () => k.inward(['#ffffff', '#c8f4ff', k.halo], { R: 1, life: [0.3, 0.45], tw: true })); },
    form(k, dt) { k.stream('e', 30, dt, () => k.inward(['#ffffff', '#c8f4ff'], { R: 0.5, life: [0.2, 0.3], tw: true })); },
    land(k) {
      k.flash(k.core, 0.6, 0.2);
      k.shards(10, 0.25, 3, ['#ffffff', '#c8f4ff', k.halo], 0.05, 0.34);
      k.ring(k.halo, 1, 0.4, { width: 0.06 }); k.ring('#e8fbff', 0.7, 0.55, { width: 0.03, delay: 0.08, alpha: 0.7 });
      k.burst(26, { colors: k.tp.colors, speed: [0.2, 0.9], life: [0.6, 1.1], size: [0.03, 0.06], drag: 2, twinkle: true });
    },
  },
  foudre: {
    start(k) { k.flash(k.halo, 0.3, k.tc, 0.4); },
    charge(k, dt) { k.stream('b', 16, dt, () => k.bolt(rand(0.3, 0.7), 4, ['#ffffff', k.halo], 0.03, 0.08, 0.14)); },
    burst(k) {
      k.flash('#ffffff', 1.2, 0.14); k.flash(k.halo, 1.6, 0.3, 0.6);
      const strike = () => { for (let i = 0; i < 4 + k.tier; i++) k.bolt(rand(0.8, 1.4), 7, ['#ffffff', k.halo], 0.04, 0.1, 0.12); };
      strike(); k.later(0.06, strike); k.later(0.12, strike);
    },
    form(k, dt) { k.stream('s', 40, dt, () => k.up(k.tp.colors, { r: 0.3, vy: [0.5, 2], out: 2.5, life: [0.08, 0.2], size: [0.02, 0.05], drag: 4 })); },
    land(k) {
      k.ring(k.halo, 1.1, 0.25, { width: 0.05 });
      k.burst(30, { colors: k.tp.colors, speed: [2, 5], life: [0.1, 0.3], size: [0.02, 0.05], drag: 5 });
    },
  },
  energie: {
    start(k) { k.ring(k.halo, 1.1, k.tc, { reverse: 1, width: 0.04 }); k.ring(k.core, 0.7, k.tc * 0.75, { reverse: 1, width: 0.03, delay: k.tc * 0.25 }); },
    charge(k, dt) { k.stream('e', 110, dt, () => k.inward(k.tp.colors, { R: 1.2, swirl: 0.4, life: [0.35, 0.5], tw: true })); },
    land(k) {
      k.flash(k.core, 0.8, 0.2); k.flash(k.halo, 1.6, 0.5, 0.55);
      k.ring(k.halo, 1.3, 0.5, { width: 0.05 }); k.ring(k.core, 0.8, 0.4, { width: 0.03, delay: 0.1 });
      k.shards(8 + k.tier, 0.3, 2.6, ['#ffffff', k.halo], 0.035, 0.35);
      k.burst(28, { colors: k.tp.colors, speed: [0.2, 1], life: [0.7, 1.3], size: [0.03, 0.07], drag: 1.5, twinkle: true });
    },
  },
  sorcellerie: {
    start(k) {
      k.ring('#1a0d2e', 1, k.tc + k.tf, { reverse: 1, width: 0.25, blend: 'normal', alpha: 0.8 });
      k.ring(k.halo, 0.95, k.tc, { reverse: 1, width: 0.05 }); k.ring(k.halo, 0.6, k.tc * 0.65, { reverse: 1, width: 0.03, delay: k.tc * 0.35 });
    },
    charge(k, dt) {
      k.stream('e', 60, dt, () => k.inward(k.sparks, { R: 0.9, swirl: 1.2, life: [0.35, 0.5], size: [0.03, 0.05] }));
      k.stream('s', 25, dt, () => k.up(k.tp.colors, { r: 0.4, vy: [0.2, 0.6], size: [0.12, 0.22], sizeEnd: 0.3, blend: 'normal', alpha: 0.55, life: [0.5, 0.9] }));
    },
    form(k, dt) { k.stream('s', 30, dt, () => k.up(k.tp.colors, { r: 0.3, vy: [0.3, 0.8], size: [0.12, 0.2], sizeEnd: 0.3, blend: 'normal', alpha: 0.5, life: [0.4, 0.7] })); },
    land(k) {
      k.flash(k.halo, 1, 0.3, 0.8);
      k.ring('#1a0d2e', 1.2, 0.55, { width: 0.2, blend: 'normal', alpha: 0.8 }); k.ring(k.halo, 1.1, 0.4, { width: 0.04 });
      k.burst(20, { colors: k.sparks, speed: [1.5, 3], life: [0.2, 0.45], size: [0.03, 0.06], drag: 3.5 });
      k.burst(12, { colors: k.tp.colors, speed: [0.3, 0.9], life: [0.4, 0.7], size: [0.15, 0.25], sizeEnd: 0.4, drag: 2, blend: 'normal', alpha: 0.6 });
    },
  },
  air: {
    start(k) { k.ring(k.halo, 1, k.tc, { reverse: 1, width: 0.03 }); },
    charge(k, dt) { k.stream('e', 90, dt, () => k.inward(k.tp.colors, { R: 1.1, swirl: 2.2, life: [0.4, 0.6], size: [0.02, 0.05] })); },
    form(k, dt) { k.stream('e', 60, dt, () => k.inward(k.tp.colors, { R: 0.7, swirl: 2.2, life: [0.3, 0.45], size: [0.02, 0.05] })); },
    land(k) {
      k.flash(k.core, 0.5, 0.18);
      k.ring(k.halo, 1.2, 0.45, { width: 0.03 }); k.ring(k.core, 0.85, 0.4, { width: 0.02, delay: 0.08, alpha: 0.8 });
      k.swirl(30, k.tp.colors);
    },
  },
  terre: {
    start(k) { k.ring('#2a1a0c', 0.7, k.tc, { fill: 1, alpha: 0.6, blend: 'normal' }); },
    charge(k, dt) {
      k.stream('c', 12, dt, () => k.bolt(rand(0.35, 0.75), 4, [k.halo, '#8a5a24'], 0.03, 0.45, 0.16));
      k.stream('d', 30, dt, () => k.up(k.tp.colors, { r: 0.5, vy: [0.2, 0.7], size: [0.05, 0.1], sizeEnd: 0.08, blend: 'normal', alpha: 0.7, drag: 3 }));
    },
    land(k) {
      k.ring(k.halo, 1.1, 0.45, { width: 0.16 });
      k.burst(24, { colors: k.tp.colors, speed: [0.8, 2.2], life: [0.4, 0.7], size: [0.07, 0.14], sizeEnd: 0.06, drag: 3, blend: 'normal', alpha: 0.9 });
      k.burst(14, { colors: ['#8a6232', '#5c3f1c', '#b88a4e'], speed: [0.4, 1.2], life: [0.6, 1], size: [0.16, 0.26], sizeEnd: 0.4, drag: 2, blend: 'normal', alpha: 0.5 });
      k.rocks?.(k.tier);
    },
  },
  eau: {
    start(k) { k.ring(k.halo, 0.5, k.tc * 0.6, { width: 0.04 }); k.ring('#e8fbff', 0.7, k.tc * 0.6, { width: 0.03, delay: k.tc * 0.35 }); },
    charge(k, dt) { k.stream('e', 70, dt, () => k.up(k.tp.colors, { r: 0.45, vy: [0.8, 1.8], grav: 4, life: [0.35, 0.6], size: [0.03, 0.08] })); },
    form(k, dt) { k.stream('e', 55, dt, () => k.up(k.tp.colors, { r: 0.3, vy: [1.5, 2.8], out: 0.6, grav: 5, life: [0.3, 0.5], size: [0.03, 0.08] })); },
    land(k) {
      k.burst(36, { colors: k.tp.colors, speed: [1, 2.6], life: [0.3, 0.6], size: [0.03, 0.08], sizeEnd: 0.01, drag: 2.5, grav: 3 });
      k.ring(k.halo, 1, 0.45, { width: 0.05 }); k.ring('#e8fbff', 1.3, 0.6, { width: 0.03, delay: 0.1 });
      k.ring(k.halo, 1.6, 0.75, { width: 0.02, delay: 0.22, alpha: 0.6 });
    },
  },
  metal: {
    start(k) { k.ring(k.core, 0.7, k.tc, { reverse: 1, width: 0.02 }); },
    charge(k, dt) { k.stream('e', 45, dt, () => k.inward(k.sparks, { R: 0.9, life: [0.2, 0.35], size: [0.02, 0.04] })); },
    land(k) {
      k.flash('#ffffff', 0.7, 0.12);
      k.ring(k.halo, 1, 0.3, { width: 0.08 });
      k.shards(12, 0.3, 3.4, ['#ffffff', '#dfe6ee', ...k.sparks], 0.04, 0.35);
      k.burst(26, { colors: k.sparks, speed: [2, 4], life: [0.2, 0.45], size: [0.02, 0.04], drag: 3, grav: 3 });
      k.metal?.(k.tier);
    },
  },
  sable: {
    start(k) { k.ring(k.halo, 1, k.tc + k.tf, { reverse: 1, width: 0.14, blend: 'normal', alpha: 0.5 }); },
    charge(k, dt) { k.stream('e', 160, dt, () => k.inward(k.tp.colors, { R: 1.1, swirl: 1.8, life: [0.4, 0.6], size: [0.02, 0.045], blend: 'normal', alpha: 0.9 })); },
    form(k, dt) { k.stream('e', 120, dt, () => k.inward(k.tp.colors, { R: 0.7, swirl: 1.8, life: [0.3, 0.45], size: [0.02, 0.045], blend: 'normal', alpha: 0.9 })); },
    land(k) {
      k.burst(40, { colors: k.tp.colors, speed: [0.8, 2.4], life: [0.4, 0.8], size: [0.02, 0.05], drag: 2.2, blend: 'normal', alpha: 0.9 });
      k.ring(k.halo, 1, 0.45, { width: 0.1 });
      k.swirl(40, k.tp.colors, k.fx.pNorm, { alpha: 0.9 });
    },
  },
  plante: {
    start(k) { k.ring(k.halo, 0.75, k.tc, { reverse: 1, width: 0.05 }); },
    charge(k, dt) { k.stream('e', 60, dt, () => k.up(k.tp.colors, { r: 0.5, vy: [0.4, 1], out: -0.3, swirl: 1.4, life: [0.5, 0.8], size: [0.04, 0.08], sizeEnd: 0.02, drag: 1 })); },
    form(k, dt) { k.stream('f', 40, dt, () => k.up(k.sparks, { r: 0.35, vy: [0.8, 1.6], swirl: 1, life: [0.4, 0.7], size: [0.02, 0.04], tw: true })); },
    land(k) {
      k.flash(k.core, 0.5, 0.2, 0.6);
      k.ring(k.halo, 1, 0.5, { width: 0.06 });
      k.burst(34, { colors: k.tp.colors, speed: [0.6, 1.8], life: [0.5, 0.9], size: [0.04, 0.09], sizeEnd: 0.02, drag: 2.5 });
      k.burst(12, { colors: k.sparks, speed: [0.3, 1], life: [0.6, 1.1], size: [0.02, 0.04], drag: 1.5, twinkle: true });
    },
  },
  neutral: {
    start(k) { k.ring(k.halo, 0.7, k.tc, { reverse: 1, width: 0.04 }); },
    land(k) {
      k.flash(k.core, 0.6, 0.2); k.ring(k.halo, 1, 0.4, { width: 0.06 });
      k.burst(24, { colors: k.tp.colors, speed: [1, 2.4], life: [0.3, 0.6], size: [0.03, 0.06], drag: 3 });
    },
  },
};

export class UnitSpawns {
  constructor(fx, { onLand = null, onShake = null } = {}) {
    this.fx = fx;
    this.onLand = onLand;
    this.onShake = onShake;
    this.globals = { ...DEFAULT_SPAWN_GLOBALS, tierPower: { ...SPAWN_TIER_POWER } };
    this.actions = new Map();
    this.pose = { lift: 0, yaw: 0, scale: 1, sx: 1, sy: 1, op: 1 };
    this.rocks = [];
  }

  // Éclats de pierre — port de Scene3D.spawnRockShards (Terre) et éclats métalliques façon
  // douilles — port de Scene3D.spawnMetalShards (Métal) : projetés, culbutent, rebondissent une fois.
  _rockShards(pos, tier = 1, kind = 'rock') {
    const t = Math.max(1, Math.min(5, tier)), metal = kind === 'metal';
    const count = metal ? 6 + t * 2 : 7 + t * 3;
    const palette = metal ? [0xd8dee4, 0xb0b8c0, 0x8c94a0, 0xf0f4f8] : [0x6b4a2c, 0x8a6238, 0x4a3318, 0x9c805a, 0x5c4226];
    for (let i = 0; i < count; i++) {
      const size = metal ? 0.05 + Math.random() * (0.04 + t * 0.015) : 0.09 + Math.random() * (0.07 + t * 0.03);
      const geo = metal ? new THREE.BoxGeometry(size, size * 0.4, size * 0.4) : new THREE.DodecahedronGeometry(size, 0);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: palette[(Math.random() * palette.length) | 0], transparent: true, opacity: 1 }));
      mesh.position.set(pos.x, pos.y + (metal ? 0.08 : 0.06), pos.z);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      mesh.renderOrder = 1;
      this.fx.root.add(mesh);
      const a = Math.random() * TAU, sp = metal ? 1.4 + Math.random() * (1.4 + t * 0.4) : 0.9 + Math.random() * (0.9 + t * 0.35);
      const vy = metal ? 1.8 + Math.random() * (1.4 + t * 0.4) : 2.2 + Math.random() * (1.6 + t * 0.4), w = metal ? 14 : 9;
      this.rocks.push({
        mesh, life: 0, bounced: false,
        maxLife: metal ? 0.5 + t * 0.06 : 0.9 + t * 0.12, gravity: metal ? 14 + t : 9 + t * 0.8,
        vel: new THREE.Vector3(Math.cos(a) * sp, vy, Math.sin(a) * sp),
        angVel: new THREE.Vector3((Math.random() - 0.5) * w, (Math.random() - 0.5) * w, (Math.random() - 0.5) * w),
      });
    }
  }

  _updateRocks(dt) {
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i], m = r.mesh;
      r.life += dt;
      const p = r.life / r.maxLife;
      if (p >= 1) { this.fx.root.remove(m); m.geometry.dispose(); m.material.dispose(); this.rocks.splice(i, 1); continue; }
      r.vel.y -= r.gravity * dt;
      m.position.addScaledVector(r.vel, dt);
      if (m.position.y < 0.04) {
        m.position.y = 0.04;
        if (!r.bounced && r.vel.y < 0) { r.bounced = true; r.vel.y *= -0.35; r.vel.x *= 0.5; r.vel.z *= 0.5; }
        else r.vel.set(0, 0, 0);
      }
      m.rotation.x += r.angVel.x * dt; m.rotation.y += r.angVel.y * dt; m.rotation.z += r.angVel.z * dt;
      const fadeStart = 0.6;
      if (p > fadeStart) m.material.opacity = 1 - (p - fadeStart) / (1 - fadeStart);
    }
  }

  setGlobals(g) {
    const { tierPower, ...rest } = g;
    Object.assign(this.globals, rest);
    if (tierPower) Object.assign(this.globals.tierPower, tierPower);
  }

  get activeCount() { return this.actions.size; }

  /**
   * Durée totale (s, `delay` exclu) d'une apparition — charge + formation +
   * tassement. Même calcul que `spawn()`, exposé pour que l'appelant (la
   * cascade d'apparition de l'IA) puisse attendre la VRAIE fin de l'anim
   * plutôt qu'une constante recopiée : la durée varie par élément (une
   * Sorcellerie charge et pose plus longtemps qu'un Feu) et par tier.
   */
  estimateDuration(element, tier = 3) {
    const list = [].concat(element).filter(Boolean).map(normalizeElement);
    const st = SPAWN_STYLES[list[0]] || SPAWN_STYLES.neutral;
    const g = this.globals, sp = Math.max(0.1, g.speed);
    const pw = (g.tierPower[tier] ?? 1) * g.power;
    const tc = (st.charge * (0.8 + 0.25 * pw) + (tier >= 5 ? 0.15 : 0)) / sp;
    const tf = st.dur / sp;
    const ts = 0.32 / sp;
    return tc + tf + ts;
  }

  /** Apparition d'une unité. `delay` en secondes. Résout quand la carte est posée. */
  spawn(actor, element = 'neutral', { tier = 3, delay = 0 } = {}) {
    this.cancel(actor);
    const list = [].concat(element).filter(Boolean).map(normalizeElement);
    if (!list.length) list.push('neutral');
    const st = SPAWN_STYLES[list[0]] || SPAWN_STYLES.neutral;
    const g = this.globals, sp = Math.max(0.1, g.speed);
    const pw = (g.tierPower[tier] ?? 1) * g.power;
    const pos = actor.home.clone(); pos.y = 0.12;
    const a = {
      actor, list, st, tier, pw, sp, pos, phase: 'wait', t: -delay, op: -1, side: Math.random() < 0.5 ? 1 : -1,
      tc: (st.charge * (0.8 + 0.25 * pw) + (tier >= 5 ? 0.15 : 0)) / sp, tf: st.dur / sp, ts: 0.32 / sp,
    };
    a.k = new Ctx(this.fx, a, this.fx.resolveParams(list[0], { tier }), pw);
    a.k.rocks = (t) => this._rockShards(pos, t);
    a.k.metal = (t) => this._rockShards(pos, t, 'metal');
    if (list[1]) { a.k2 = new Ctx(this.fx, a, this.fx.resolveParams(list[1], { tier }), pw * 0.6); a.k2.rocks = (t) => this._rockShards(pos, Math.max(1, t - 2)); a.k2.metal = (t) => this._rockShards(pos, Math.max(1, t - 2), 'metal'); }
    actor.spawning = true;
    actor.setOpacity?.(0);
    return new Promise((resolve) => { a.resolve = resolve; this.actions.set(actor, a); });
  }

  cancel(actor) {
    const a = this.actions.get(actor);
    if (!a) return;
    this.actions.delete(actor);
    this._finish(a);
  }

  _finish(a) {
    const p = this.pose;
    p.lift = 0; p.yaw = 0; p.scale = 1; p.sx = 1; p.sy = 1; p.op = 1;
    this._apply(a, p);
    a.actor.spawning = false;
    a.resolve?.();
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    this._updateRocks(dt);
    for (const a of [...this.actions.values()]) {
      a.t += dt;
      const p = this.pose, h = SPAWN_FX[a.list[0]] || SPAWN_FX.neutral, h2 = a.k2 && SPAWN_FX[a.list[1]];
      p.lift = 0; p.yaw = 0; p.scale = 1; p.sx = 1; p.sy = 1; p.op = 0;
      if (a.phase === 'wait' && a.t >= 0) {
        a.phase = 'charge';
        h.start?.(a.k); this._tierStart(a);
      }
      if (a.phase === 'charge') {
        h.charge?.(a.k, dt); h2?.charge?.(a.k2, dt * 0.5); this._tierCharge(a, dt);
        if (a.t >= a.tc) { a.t -= a.tc; a.phase = 'form'; h.burst?.(a.k); }
      }
      if (a.phase === 'form') {
        const u = clamp01(a.t / a.tf);
        this._form(a, u, p); h.form?.(a.k, dt);
        if (a.t >= a.tf) { a.t -= a.tf; a.phase = 'settle'; this._land(a, h, h2); }
      }
      if (a.phase === 'settle') {
        const v = clamp01(a.t / a.ts), k = Math.sin(v * Math.PI) * (1 - v) * a.pw;
        p.op = 1; p.lift = 0; p.yaw = 0;
        if (a.st.form === 'drop') { p.sx = 1 + 0.16 * k; p.sy = 1 + 0.16 * k; p.scale = 1 - 0.06 * k; }
        else p.scale = 1 + 0.06 * k;
        if (v >= 1) { this.actions.delete(a.actor); this._finish(a); continue; }
      }
      this._apply(a, p);
    }
  }

  // entrée de la carte selon l'élément
  _form(a, u, p) {
    const st = a.st, e = E.out(u);
    p.op = Math.min(1, u * 3);
    switch (st.form) {
      case 'rise':
        p.scale = 0.25 + 0.75 * E.back(u); p.lift = 0.5 * (1 - e);
        if (u < 0.8) p.op *= 0.7 + 0.3 * Math.random();
        break;
      case 'crystal':
        p.scale = 1.35 - 0.35 * e; p.op = e; p.yaw = 0.25 * (1 - e) * a.side;
        break;
      case 'blink':
        p.scale = 1.18 - 0.18 * e;
        p.op = u > 0.85 ? 1 : Math.random() < 0.45 + u * 0.5 ? 1 : 0.12;
        break;
      case 'pop':
        p.scale = Math.max(0.01, E.back(u)); p.op = Math.min(1, u * 4);
        break;
      case 'shadow':
        p.op = E.in(u); p.scale = 1.5 - 0.5 * e; p.yaw = -0.8 * (1 - e) * a.side;
        break;
      case 'spin':
        p.yaw = (st.turns || 1) * TAU * (1 - e) * a.side; p.scale = 0.35 + 0.65 * e; p.lift = 0.8 * (1 - e);
        break;
      case 'drop': {
        const f = E.in(u);
        p.lift = (st.height || 2) * (0.8 + 0.2 * a.pw) * (1 - f); p.op = Math.min(1, u * 5);
        if (st.spin) p.yaw = (1 - f) * Math.PI * st.spin * a.side;
        break;
      }
      case 'wobble': {
        const w = Math.sin(u * Math.PI * 3) * (1 - u) * 0.22;
        p.lift = 0.3 * (1 - e); p.scale = 0.5 + 0.5 * e; p.sx = 1 + w; p.sy = 1 - w;
        break;
      }
      case 'grow':
        p.scale = Math.max(0.01, E.back(u)); p.sy = 0.6 + 0.4 * e; p.yaw = 0.4 * (1 - e) * a.side;
        break;
    }
  }

  _land(a, h, h2) {
    h.land?.(a.k); h2?.land?.(a.k2); this._tierLand(a);
    const g = this.globals;
    this.onShake?.(((a.st.shake || 0.015) * a.pw + (a.tier >= 4 ? 0.03 * (a.tier - 3) : 0)) * g.shake);
    this.onLand?.(a.actor, a.k.P, { tier: a.tier, power: a.pw });
  }

  // Couches de rareté : indépendantes de l'élément, dans la couleur du tier
  _tierStart(a) {
    const k = a.k, t = a.tier, fx = this.fx;
    if (t >= 4) fx._ring(k.pos, k.T, 1.3 + 0.2 * t, a.tc, { reverse: 1, width: 0.03, alpha: 0.7 });
    if (t >= 5) fx._flash(k.pos, k.T, 0.8, a.tc, 0.25);
  }
  _tierCharge(a, dt) {
    const k = a.k;
    if (a.tier >= 4) k.stream('tier', 25 * (a.tier - 3), dt, () => k.inward([k.T, '#ffffff'], { R: 1.4, life: [0.4, 0.55], size: [0.02, 0.04], tw: true }));
  }
  _tierLand(a) {
    const k = a.k, t = a.tier, T = k.T, fx = this.fx, pos = k.pos;
    fx._ring(pos, T, 0.5 + 0.16 * t, 0.45 + 0.05 * t, { width: 0.03 + 0.01 * t });
    if (t >= 3) fx._ring(pos, T, 0.7 + 0.2 * t, 0.6 + 0.05 * t, { width: 0.025, delay: 0.1, alpha: 0.8 });
    if (t >= 4) {
      fx._flash(pos, T, 0.9 + 0.25 * t, 0.4, 0.45);
      fx._burst(pos, 12 * (t - 3), { colors: [T, '#ffffff'], speed: [1.5, 3.2], life: [0.4, 0.8], size: [0.03, 0.06], drag: 2.4, twinkle: true });
    }
    if (t >= 5) {
      fx._flash(pos, '#ffffff', 1.1, 0.16);
      k.later(0.16, () => fx._ring(pos, T, 2.6, 0.7, { width: 0.05 }));
    }
  }

  _apply(a, p) {
    const ac = a.actor, o = ac.obj, bs = ac.baseScale;
    o.position.copy(ac.home); o.position.y += p.lift;
    _q.setFromAxisAngle(UP, p.yaw);
    o.quaternion.copy(_q).multiply(ac.baseQuat);
    o.scale.set(bs * p.scale * p.sx, bs * p.scale * p.sy, bs);
    const op = Math.round(p.op * 100) / 100;
    if (ac.setOpacity && a.op !== op) { a.op = op; ac.setOpacity(op); }
  }

  dispose() {
    for (const a of this.actions.values()) this._finish(a);
    this.actions.clear();
    for (const r of this.rocks) { this.fx.root.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
    this.rocks = [];
  }
}
