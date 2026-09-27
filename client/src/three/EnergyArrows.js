// EnergyArrows — projectiles « flèche d'énergie » élémentaires pour Three.js.
// Aucune forme de flèche : noyau lumineux étiré dans l'axe de vol, traînée-ruban
// bruitée qui ondule, particules. Paramétrable par élément (ELEMENT_PRESETS),
// par tier (TIER_SIZE) et globalement (setGlobals). Un projectile peut mixer
// plusieurs éléments : fire(from, to, ['feu', 'foudre']) → rubans tressés,
// particules des deux éléments, impacts enchaînés.
//
// Intégration Millenium : remplacer l'import par `import * as THREE from 'three'`,
// `new EnergyArrows(scene, camera)` dans Scene3D, `update(dt)` dans la boucle,
// `fire(from, to, element | element[], { tier })` à la place de playProjectile.
// Shaders en alpha prémultiplié : fonctionne sur canvas opaque ou calque FX transparent.
import * as THREE from 'three';

export const TIER_SIZE = { 1: 0.3, 2: 0.5, 3: 1, 4: 1.5, 5: 2 };
export const ELEMENT_ALIASES = { ombre: 'sorcellerie', lumiere: 'energie', vent: 'air', metal: 'metal', 'métal': 'metal' };

export const ELEMENT_PRESETS = {
  feu: {
    label: 'Feu', core: '#fff1c2', halo: '#ff5a1f', size: 0.15, speed: 13, trail: 1.7, bloom: 1, turbulence: 0.55,
    particles: 70, wave: 0.2, flicker: 0.12, impact: 'feu',
    tp: { colors: ['#ffd27a', '#ff7a2e', '#ff3a12'], life: [0.3, 0.6], size: [0.07, 0.16], sizeEnd: 0.02, spread: 0.06, back: 0.15, jitter: 0.6, drag: 2 },
  },
  glace: {
    label: 'Glace', core: '#ffffff', halo: '#5fd0ff', size: 0.12, speed: 14, trail: 1.5, bloom: 0.9, turbulence: 0.15,
    particles: 45, wave: 0.05, flicker: 0.25, impact: 'glace',
    tp: { colors: ['#ffffff', '#c8f4ff', '#7fdcff'], life: [0.4, 0.8], size: [0.03, 0.07], sizeEnd: 0, spread: 0.08, back: 0.05, jitter: 0.25, drag: 3, twinkle: true },
  },
  foudre: {
    label: 'Foudre', core: '#ffffff', halo: '#ffe53a', size: 0.11, speed: 22, trail: 2.2, bloom: 1.3, turbulence: 1,
    particles: 50, wave: 0, flicker: 0.8, jitter: 0.07, arcs: true, impact: 'foudre',
    tp: { colors: ['#ffffff', '#fff59a', '#ffd23a'], life: [0.08, 0.2], size: [0.03, 0.06], sizeEnd: 0.01, spread: 0.05, back: 0, jitter: 2.5, drag: 4 },
  },
  energie: {
    label: 'Énergie', core: '#ffffff', halo: '#ffcf6a', size: 0.14, speed: 15, trail: 1.9, bloom: 1.5, turbulence: 0.1,
    particles: 40, wave: 0.05, flicker: 0.05, impact: 'energie',
    tp: { colors: ['#ffffff', '#fff2c8', '#ffd98a'], life: [0.5, 1], size: [0.03, 0.08], sizeEnd: 0, spread: 0.1, back: 0, jitter: 0.15, drag: 2, twinkle: true },
  },
  sorcellerie: {
    label: 'Sorcellerie', core: '#07030d', halo: '#b35cff', size: 0.16, speed: 11, trail: 1.6, bloom: 0.9, turbulence: 0.7,
    particles: 55, wave: 0.3, flicker: 0, shadow: true, impact: 'sorcellerie',
    tp: { colors: ['#0b0616', '#1a0d2e', '#2a1248'], life: [0.4, 0.8], size: [0.1, 0.2], sizeEnd: 0.28, spread: 0.08, back: 0.1, jitter: 0.3, drag: 2, blend: 'normal', alpha: 0.55 },
    sparks: { colors: ['#d8a8ff', '#a04dff', '#ff7ae0'], ratio: 0.35 },
  },
  air: {
    label: 'Air', core: '#f4fff8', halo: '#7dffc0', size: 0.1, speed: 16, trail: 2.4, bloom: 0.8, turbulence: 0.35,
    particles: 50, wave: 0.6, flicker: 0, impact: 'air',
    tp: { colors: ['#ffffff', '#c8ffe0', '#8dffc4'], life: [0.3, 0.6], size: [0.02, 0.05], sizeEnd: 0, spread: 0.03, back: 0.1, jitter: 0.3, drag: 1.5, spiral: 0.18 },
  },
  terre: {
    label: 'Terre', core: '#ffe6b8', halo: '#c9802e', size: 0.17, speed: 10, trail: 1.1, bloom: 0.6, turbulence: 0.3,
    particles: 40, wave: 0.05, flicker: 0, impact: 'terre',
    tp: { colors: ['#a0743c', '#6b4a22', '#d8a060'], life: [0.4, 0.8], size: [0.06, 0.13], sizeEnd: 0.1, spread: 0.08, back: 0.1, jitter: 0.25, drag: 3, blend: 'normal', alpha: 0.8 },
  },
  eau: {
    label: 'Eau', core: '#e8fbff', halo: '#2f9dff', size: 0.13, speed: 12, trail: 1.8, bloom: 0.9, turbulence: 0.3,
    particles: 55, wave: 0.45, flicker: 0, impact: 'eau',
    tp: { colors: ['#e8fbff', '#7fd0ff', '#2f8cff'], life: [0.3, 0.6], size: [0.03, 0.08], sizeEnd: 0.01, spread: 0.06, back: 0.1, jitter: 0.5, drag: 2.5 },
  },
  metal: {
    label: 'Métal', core: '#ffffff', halo: '#aebccc', size: 0.12, speed: 18, trail: 1.6, bloom: 0.8, turbulence: 0.08,
    particles: 45, wave: 0, flicker: 0.1, impact: 'metal',
    tp: { colors: ['#ffffff', '#dfe6ee', '#9aa8b8'], life: [0.2, 0.45], size: [0.02, 0.05], sizeEnd: 0, spread: 0.03, back: 0.05, jitter: 0.3, drag: 2.5, twinkle: true },
    sparks: { colors: ['#ffd08a', '#ff9a3a', '#fff2d0'], ratio: 0.3 },
  },
  sable: {
    label: 'Sable', core: '#fff4d6', halo: '#e3b264', size: 0.14, speed: 12, trail: 1.5, bloom: 0.6, turbulence: 0.8,
    particles: 90, wave: 0.25, flicker: 0, impact: 'sable',
    tp: { colors: ['#e8c27e', '#c9994e', '#f3dcaa'], life: [0.4, 0.8], size: [0.02, 0.045], sizeEnd: 0.01, spread: 0.1, back: 0.12, jitter: 0.6, drag: 2.2, blend: 'normal', alpha: 0.9, spiral: 0.12 },
  },
  plante: {
    label: 'Plante', core: '#f0ffd8', halo: '#5fd66a', size: 0.13, speed: 12, trail: 1.8, bloom: 0.8, turbulence: 0.35,
    particles: 45, wave: 0.5, flicker: 0, impact: 'plante',
    tp: { colors: ['#b8f27a', '#5fd66a', '#2e9e4a'], life: [0.5, 0.9], size: [0.04, 0.08], sizeEnd: 0.02, spread: 0.05, back: 0.05, jitter: 0.2, drag: 2.5, spiral: 0.16 },
    sparks: { colors: ['#ffe98a', '#f7ffd0'], ratio: 0.15 },
  },
  neutral: {
    label: 'Neutre', core: '#ffffff', halo: '#9fb4ff', size: 0.12, speed: 14, trail: 1.5, bloom: 0.8, turbulence: 0.25,
    particles: 30, wave: 0.1, flicker: 0, impact: 'neutral',
    tp: { colors: ['#ffffff', '#c8d4ff'], life: [0.3, 0.5], size: [0.03, 0.06], sizeEnd: 0, spread: 0.05, back: 0.1, jitter: 0.3, drag: 2 },
  },
};

export const DEFAULT_GLOBALS = {
  size: 1, speed: 1, trail: 1, bloom: 1, turbulence: 1, particles: 1,
  arc: 2, streak: 1, ribbon: 1, wave: 1, coreColor: null, haloColor: null,
  tierSize: { ...TIER_SIZE },
};

export const normalizeElement = (e) => (ELEMENT_PRESETS[e] ? e : ELEMENT_ALIASES[e] || 'neutral');

const GLSL_NOISE = `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }`;

function setBlend(mat, mode) {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = mode === 'normal' ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// ── Particules : un Points par mode de mélange, tampons fixes ──────────────
class ParticlePool {
  constructor(max, mode) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.sz = new Float32Array(max); this.al = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max); this.drag = new Float32Array(max);
    this.grav = new Float32Array(max); this.tw = new Uint8Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSz = new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAl = new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSz); g.setAttribute('aAlpha', this.aAl);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      transparent: true, depthWrite: false, depthTest: false,
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vC; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1., aSize * uScale / -mv.z); vC = aColor; vA = aAlpha; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ vec2 q = gl_PointCoord * 2. - 1.; float d = dot(q, q); if (d > 1.) discard;
          float m = (1. - d); m *= m; gl_FragColor = vec4(vC * m * vA, m * vA); }`,
    });
    setBlend(this.mat, mode);
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = mode === 'normal' ? 1 : 3;
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, color, alpha = 1, drag = 2, grav = 0, twinkle = false) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    _c.set(color);
    this.col[i3] = _c.r; this.col[i3 + 1] = _c.g; this.col[i3 + 2] = _c.b;
    this.life[i] = 0; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.a0[i] = alpha; this.drag[i] = drag; this.grav[i] = grav; this.tw[i] = twinkle ? 1 : 0;
    this.sz[i] = s0; this.al[i] = 0;
  }
  _copy(src, dst) {
    const s3 = src * 3, d3 = dst * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[d3 + k] = this.pos[s3 + k]; this.vel[d3 + k] = this.vel[s3 + k]; this.col[d3 + k] = this.col[s3 + k];
    }
    this.life[dst] = this.life[src]; this.maxLife[dst] = this.maxLife[src]; this.s0[dst] = this.s0[src];
    this.s1[dst] = this.s1[src]; this.a0[dst] = this.a0[src]; this.drag[dst] = this.drag[src];
    this.grav[dst] = this.grav[src]; this.tw[dst] = this.tw[src]; this.sz[dst] = this.sz[src]; this.al[dst] = this.al[src];
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this.n--; if (i !== this.n) this._copy(this.n, i); continue; }
      const i3 = i * 3, k = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.sz[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      let a = this.a0[i] * Math.min(1, t * 10) * (1 - t);
      if (this.tw[i]) a *= 0.35 + 0.65 * Math.random();
      this.al[i] = a;
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSz.needsUpdate = this.aAl.needsUpdate = true;
  }
}

// ── Anneaux / flashs au sol ────────────────────────────────────────────────
const RING_GEO = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
function makeRingMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uP: { value: 0 }, uW: { value: 0.1 }, uA: { value: 1 }, uFill: { value: 0 }, uRev: { value: 0 } },
    transparent: true, depthWrite: false, depthTest: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uP, uW, uA, uFill, uRev; varying vec2 vUv;
      void main(){ float r = length(vUv * 2. - 1.);
        float p = mix(uP, 1. - uP, uRev);
        float e = 1. - pow(1. - p, 3.);
        float ring = exp(-pow((r - e) / uW, 2.));
        float disk = exp(-r * r * 5.);
        float m = mix(ring, disk, uFill) * uA * pow(1. - uP, 1.4);
        gl_FragColor = vec4(uColor * m, m); }`,
  });
}

// ── Traînée-ruban ──────────────────────────────────────────────────────────
const RIB_N = 32;
function makeRibbon() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(RIB_N * 2 * 3), uv = new Float32Array(RIB_N * 2 * 2), idx = [];
  for (let i = 0; i < RIB_N; i++) {
    const u = 1 - i / (RIB_N - 1);
    uv.set([u, -1, u, 1], i * 4);
    if (i < RIB_N - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCore: { value: new THREE.Color() }, uHalo: { value: new THREE.Color() }, uTime: { value: 0 },
      uTurb: { value: 0.3 }, uOp: { value: 1 }, uSeed: { value: 0 }, uFlicker: { value: 0 }, uShadow: { value: 0 },
    },
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 uCore, uHalo; uniform float uTime, uTurb, uOp, uSeed, uFlicker, uShadow; varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){ float u = vUv.x, v = vUv.y;
        float n = (n2(vec2(u * 7. - uTime * 5. + uSeed, v * 1.5 + uSeed)) + .5 * n2(vec2(u * 16. - uTime * 11., v * 3. - uSeed))) / 1.5;
        float edge = abs(v) + (n - .5) * uTurb * (1.3 - u * .6);
        float body = 1. - smoothstep(.15, 1., edge);
        float core = 1. - smoothstep(0., .38, edge);
        float fade = smoothstep(0., .7, u) * (1. - smoothstep(.97, 1., u) * .5);
        float stri = .78 + .22 * sin(u * 46. - uTime * 38. + uSeed * 6.);
        float fl = 1. - uFlicker * step(.5, h21(vec2(floor(uTime * 32.), uSeed))) * .75;
        float a = body * fade * uOp * stri * fl;
        if (uShadow > .5) {
          float rim = clamp(body - core * 1.2, 0., 1.);
          vec3 col = uCore * core + uHalo * rim * 1.2; a = max(core, rim) * fade * uOp * stri;
          gl_FragColor = vec4(col * a, a);
        } else {
          vec3 col = mix(uHalo, uCore, core * (.25 + .75 * u)) * 1.25;
          gl_FragColor = vec4(col * a, a);
        } }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 2;
  return mesh;
}

// ── Noyau étiré (billboard orienté dans l'axe de vol) ──────────────────────
const CORE_GEO = new THREE.PlaneGeometry(1, 1);
function makeCore() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCore: { value: new THREE.Color() }, uHalo: { value: new THREE.Color() }, uGlow: { value: 2 },
      uBloom: { value: 1 }, uOp: { value: 1 }, uTime: { value: 0 }, uFlicker: { value: 0 }, uSeed: { value: 0 }, uShadow: { value: 0 },
    },
    transparent: true, depthWrite: false, depthTest: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 uCore, uHalo; uniform float uGlow, uBloom, uOp, uTime, uFlicker, uSeed, uShadow; varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){ vec2 p = vUv * 2. - 1.;
        p.x = p.x > 0. ? p.x * 1.15 : p.x * .5;
        float d = length(p) * uGlow;
        float core = exp(-d * d * 2.6), hot = exp(-d * d * 11.);
        float glow = exp(-dot(p, p) * 3.2) * uBloom * .6;
        float fl = 1. - uFlicker * h21(vec2(floor(uTime * 40.), uSeed)) * .6;
        if (uShadow > .5) {
          float rim = clamp(glow * 1.4 + core * .8 - hot * 1.3, 0., 1.);
          float a = clamp(hot * 1.4 + rim, 0., 1.) * uOp;
          vec3 col = uCore * hot * 1.4 + uHalo * rim * 1.3;
          gl_FragColor = vec4(col * uOp, a);
        } else {
          float a = clamp(core + glow, 0., 1.) * uOp * fl;
          vec3 col = (uHalo * (core * .9 + glow) + uCore * hot * 1.6) * uOp * fl;
          gl_FragColor = vec4(col, a);
        } }`,
  });
  const mesh = new THREE.Mesh(CORE_GEO, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 4;
  return mesh;
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m = new THREE.Matrix4();

export class EnergyArrows {
  constructor(scene, camera, { maxParticles = 10000, lowEnd = false } = {}) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'EnergyArrows';
    scene.add(this.root);
    const cap = lowEnd ? Math.round(maxParticles / 3) : maxParticles;
    this.pAdd = new ParticlePool(cap, 'add');
    this.pNorm = new ParticlePool(Math.round(cap / 2), 'normal');
    this.root.add(this.pNorm.points, this.pAdd.points);
    this.globals = { ...DEFAULT_GLOBALS, tierSize: { ...TIER_SIZE } };
    this.projectiles = []; this.rings = []; this.timers = [];
    this._ribPool = []; this._corePool = []; this._ringPool = [];
    this._pts = Array.from({ length: RIB_N }, () => new THREE.Vector3());
    this.time = 0;
    this.onImpact = null;
  }

  setGlobals(g) {
    const { tierSize, ...rest } = g;
    Object.assign(this.globals, rest);
    if (tierSize) Object.assign(this.globals.tierSize, tierSize);
  }

  /** Hauteur du canvas en pixels physiques — nécessaire à la taille des particules. */
  setViewport(heightPx) {
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.pAdd.mat.uniforms.uScale.value = s;
    this.pNorm.mat.uniforms.uScale.value = s;
  }

  /** overrides : { tier, arc, size, speed, core, halo, streak, ribbon, tp… } */
  resolveParams(element, overrides = {}) {
    const key = normalizeElement(element);
    const base = ELEMENT_PRESETS[key];
    const P = { ...base, ...overrides, tp: { ...base.tp, ...(overrides.tp || {}) } };
    const g = this.globals;
    P.size *= g.size * (overrides.tier ? (g.tierSize[overrides.tier] ?? 1) : 1);
    P.speed *= g.speed; P.trail *= g.trail; P.bloom *= g.bloom;
    P.turbulence *= g.turbulence; P.particles *= g.particles; P.wave *= g.wave;
    P.arc = overrides.arc ?? g.arc ?? 0;
    P.streak = (overrides.streak ?? 1) * g.streak;
    P.ribbon = (overrides.ribbon ?? 1) * g.ribbon;
    P.coreColor = new THREE.Color(overrides.core || g.coreColor || base.core);
    P.haloColor = new THREE.Color(overrides.halo || g.haloColor || base.halo);
    P.element = key;
    return P;
  }

  /**
   * Lance un projectile. `element` : clé ou tableau de clés (mix).
   * Résout à l'impact avec les paramètres de l'élément principal.
   */
  fire(from, to, element = 'neutral', overrides = {}) {
    const list = (Array.isArray(element) ? element : [element]).filter(Boolean);
    if (!list.length) list.push('neutral');
    const parts = list.map((e) => this.resolveParams(e, overrides));
    const P = parts[0], mixed = parts.length > 1;
    if (mixed) {
      // trajectoire commune : vitesse et longueur de traînée moyennes
      P.speed = parts.reduce((a, p) => a + p.speed, 0) / parts.length;
      P.trail = parts.reduce((a, p) => a + p.trail, 0) / parts.length;
    }
    return new Promise((resolve) => {
      const core = this._acquireCore(P, parts);
      const ribbons = parts.map((p, i) => ({
        P: p, mesh: this._acquireRibbon(p),
        phase: (i / parts.length) * Math.PI * 2,
        amp: mixed ? Math.max(p.wave, 0.7) : p.wave,
        w: mixed ? (i === 0 ? 0.9 : 0.7) : 1,
        rate: mixed ? 0.7 : 1, emitAcc: 0, arcAcc: 0,
      }));
      const dir = new THREE.Vector3().subVectors(to, from);
      const dist = Math.max(dir.length(), 0.001);
      dir.divideScalar(dist);
      this.projectiles.push({
        P, parts, ribbons, core, from: from.clone(), to: to.clone(), dir, dist, tan: dir.clone(),
        dur: dist / P.speed, t: 0, state: 'fly', fadeT: 0,
        head: from.clone(), hist: [from.clone()],
        seed: Math.random() * 100, side: new THREE.Vector3(), resolve,
      });
    });
  }

  /** Adaptateur pour Scene3D.playProjectile(fromPos, toPos, element). */
  playProjectile(fromVec, toVec, element, overrides) { return this.fire(fromVec, toVec, element, overrides); }

  _initMat(m, P) {
    const u = m.material.uniforms;
    u.uCore.value.copy(P.coreColor); u.uHalo.value.copy(P.haloColor);
    u.uShadow.value = P.shadow ? 1 : 0; u.uFlicker.value = P.flicker || 0; u.uSeed.value = Math.random() * 50;
    setBlend(m.material, P.shadow ? 'normal' : 'add');
    m.visible = true;
    if (!m.parent) this.root.add(m);
  }
  _acquireRibbon(P) { const m = this._ribPool.pop() || makeRibbon(); this._initMat(m, P); return m; }
  _acquireCore(P, parts) {
    const m = this._corePool.pop() || makeCore();
    this._initMat(m, P);
    if (parts.length > 1) {
      // halo du noyau teinté par les autres éléments ; un mix avec Sorcellerie garde un noyau lumineux
      const u = m.material.uniforms;
      for (let i = 1; i < parts.length; i++) u.uHalo.value.lerp(parts[i].haloColor, 0.35);
      if (P.shadow) { u.uShadow.value = 0; u.uCore.value.set('#ffffff'); setBlend(m.material, 'add'); }
    }
    return m;
  }
  _release(pr) {
    pr.core.visible = false; this._corePool.push(pr.core);
    for (const r of pr.ribbons) { r.mesh.visible = false; this._ribPool.push(r.mesh); }
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const camPos = this.camera.position;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (!this._updateProjectile(pr, dt, camPos)) { this._release(pr); this.projectiles.splice(i, 1); }
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i]; tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (r.delay > 0) { r.delay -= dt; r.mesh.visible = false; continue; }
      r.mesh.visible = true; r.t += dt;
      const p = r.t / r.dur;
      if (p >= 1) { r.mesh.visible = false; this._ringPool.push(r.mesh); this.rings.splice(i, 1); continue; }
      r.mesh.material.uniforms.uP.value = p;
    }
    this.pAdd.update(dt);
    this.pNorm.update(dt);
  }

  _updateProjectile(pr, dt, camPos) {
    const { P } = pr, T = this.time;
    let lenMul = 1, coreOp = 1;
    if (pr.state === 'fly') {
      pr.t += dt;
      const k = Math.min(pr.t / pr.dur, 1);
      pr.head.lerpVectors(pr.from, pr.to, k);
      pr.head.y += Math.sin(k * Math.PI) * P.arc;
      // tangente réelle (arc compris) pour orienter noyau et particules
      pr.tan.copy(pr.dir).multiplyScalar(pr.dist).addScaledVector(UP, P.arc * Math.PI * Math.cos(k * Math.PI)).normalize();
      _v1.subVectors(camPos, pr.head).normalize();
      pr.side.crossVectors(_v1, pr.tan).normalize();
      const wob = Math.sin(T * 18 + pr.seed) * P.turbulence * 0.02 * Math.sin(k * Math.PI);
      pr.head.addScaledVector(pr.side, wob);
      if (P.jitter) pr.head.addScaledVector(pr.side, (Math.random() - 0.5) * P.jitter * P.turbulence);
      this._pushHist(pr, pr.head, P.trail);
      for (const r of pr.ribbons) {
        this._emitTrail(pr, r, dt);
        if (r.P.arcs) { r.arcAcc += dt; if (r.arcAcc > 0.035) { r.arcAcc = 0; this._miniArc(pr, r.P); } }
      }
      if (k >= 1) {
        pr.state = 'fade';
        pr.parts.forEach((p, i) => {
          const fn = () => this._impact(p, pr.to, pr.dir, i === 0 ? 1 : 0.75);
          if (i === 0) fn(); else this.timers.push({ t: 0.06 * i, fn });
        });
        if (this.onImpact) this.onImpact(pr.to, P, pr.parts);
        pr.resolve(P);
      }
    } else {
      pr.fadeT += dt;
      const f = pr.fadeT / 0.22;
      if (f >= 1) return false;
      lenMul = 1 - f; coreOp = Math.max(0, 1 - f * 2.5);
      this._pushHist(pr, pr.head, P.trail);
    }
    this._sampleTrail(pr, P.trail * lenMul);
    for (const r of pr.ribbons) this._buildRibbon(pr, r, camPos, P.trail * lenMul, T);
    this._placeCore(pr, camPos, coreOp, T);
    return true;
  }

  _pushHist(pr, p, L) {
    const h = pr.hist;
    if (h[0].distanceToSquared(p) > 1e-5) h.unshift(p.clone());
    else h[0].copy(p);
    let acc = 0;
    for (let i = 1; i < h.length; i++) {
      acc += h[i].distanceTo(h[i - 1]);
      if (acc > L * 1.15 && i < h.length - 1) { h.length = i + 1; break; }
    }
    if (h.length > 80) h.length = 80;
  }

  // ré-échantillonne l'historique à longueur d'arc constante depuis la tête
  _sampleTrail(pr, L) {
    const h = pr.hist, pts = this._pts;
    let seg = 0, acc = 0, segLen = h.length > 1 ? h[0].distanceTo(h[1]) : 0;
    for (let i = 0; i < RIB_N; i++) {
      const d = L * i / (RIB_N - 1);
      while (seg < h.length - 1 && acc + segLen < d) { acc += segLen; seg++; segLen = seg < h.length - 1 ? h[seg].distanceTo(h[seg + 1]) : 0; }
      if (seg >= h.length - 1) pts[i].copy(h[h.length - 1]);
      else pts[i].lerpVectors(h[seg], h[seg + 1], segLen > 0 ? (d - acc) / segLen : 0);
    }
  }

  _buildRibbon(pr, r, camPos, L, T) {
    const P = r.P, rib = r.mesh, attr = rib.geometry.attributes.position, arr = attr.array, u = rib.material.uniforms;
    u.uTime.value = T; u.uTurb.value = P.turbulence; u.uOp.value = Math.min(1, P.ribbon);
    const width = P.size * 1.5 * Math.max(0.05, P.ribbon) * r.w;
    const pts = this._pts;
    for (let i = 0; i < RIB_N; i++) {
      const uu = 1 - i / (RIB_N - 1);
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(RIB_N - 1, i + 1)];
      _v1.subVectors(a, b);
      if (_v1.lengthSq() < 1e-8) _v1.copy(pr.tan); else _v1.normalize();
      _v2.subVectors(camPos, pts[i]).normalize();
      _v3.crossVectors(_v2, _v1).normalize();
      const d = L * i / (RIB_N - 1);
      const waveOff = Math.sin(d * 7 - T * 14 + pr.seed + r.phase) * r.amp * P.size * 1.8 * (1 - uu);
      const w = width * Math.pow(uu, 0.65) + 0.004;
      const cx = pts[i].x + _v3.x * waveOff, cy = pts[i].y + _v3.y * waveOff, cz = pts[i].z + _v3.z * waveOff;
      const o = i * 6;
      arr[o] = cx - _v3.x * w; arr[o + 1] = cy - _v3.y * w; arr[o + 2] = cz - _v3.z * w;
      arr[o + 3] = cx + _v3.x * w; arr[o + 4] = cy + _v3.y * w; arr[o + 5] = cz + _v3.z * w;
    }
    attr.needsUpdate = true;
  }

  _placeCore(pr, camPos, op, T) {
    const { P, core } = pr, u = core.material.uniforms;
    const glowScale = 1 + P.bloom * 1.2;
    u.uGlow.value = glowScale; u.uBloom.value = P.bloom; u.uOp.value = op; u.uTime.value = T;
    _v2.subVectors(camPos, pr.head).normalize();
    _v3.crossVectors(_v2, pr.tan).normalize();
    _v1.crossVectors(pr.tan, _v3);
    _m.makeBasis(pr.tan, _v3, _v1);
    core.quaternion.setFromRotationMatrix(_m);
    const len = P.size * (2 + P.streak * 3.2) * glowScale, wid = P.size * 2 * glowScale;
    core.scale.set(len, wid, 1);
    core.position.copy(pr.head).addScaledVector(pr.tan, -len * 0.12);
  }

  _emitTrail(pr, r, dt) {
    const P = r.P, tp = P.tp, speed = pr.P.speed, t = pr.tan;
    r.emitAcc += P.particles * r.rate * dt;
    const pool = tp.blend === 'normal' ? this.pNorm : this.pAdd;
    const up = _v2.crossVectors(t, pr.side);
    const sm = P.size / 0.13;
    while (r.emitAcc >= 1) {
      r.emitAcc -= 1;
      const back = Math.random() * speed * dt;
      let x = pr.head.x - t.x * back, y = pr.head.y - t.y * back, z = pr.head.z - t.z * back;
      const s = tp.spread * sm;
      x += (Math.random() - 0.5) * s * 2; y += (Math.random() - 0.5) * s; z += (Math.random() - 0.5) * s * 2;
      const vx = -t.x * speed * tp.back + (Math.random() - 0.5) * tp.jitter;
      const vy = -t.y * speed * tp.back + (Math.random() - 0.5) * tp.jitter * 0.5;
      const vz = -t.z * speed * tp.back + (Math.random() - 0.5) * tp.jitter;
      if (tp.spiral) {
        const a = this.time * 22 + pr.seed + r.phase + Math.random() * 0.6;
        const rr = tp.spiral * Math.max(P.wave, 0.2) * sm;
        x += (pr.side.x * Math.cos(a) + up.x * Math.sin(a)) * rr;
        y += (pr.side.y * Math.cos(a) + up.y * Math.sin(a)) * rr;
        z += (pr.side.z * Math.cos(a) + up.z * Math.sin(a)) * rr;
      }
      pool.spawn(x, y, z, vx, vy, vz, rand(tp.life[0], tp.life[1]), rand(tp.size[0], tp.size[1]) * sm, tp.sizeEnd * sm,
        pick(tp.colors), tp.alpha ?? 1, tp.drag, 0, !!tp.twinkle);
      if (P.sparks && Math.random() < P.sparks.ratio) {
        this.pAdd.spawn(x, y, z, vx * 2, vy, vz * 2, rand(0.2, 0.4), 0.04 * sm, 0, pick(P.sparks.colors), 1, 3, 0, true);
      }
    }
  }

  _miniArc(pr, P) {
    const a = Math.random() * Math.PI * 2, r = rand(0.15, 0.35) * P.size / 0.11;
    const to = new THREE.Vector3(pr.head.x + Math.cos(a) * r, pr.head.y, pr.head.z + Math.sin(a) * r);
    this._bolt(pr.head, to, 5, 0.06, [P.coreColor.getStyle(), P.haloColor.getStyle()], 0.03 * P.size / 0.11, 0.07);
  }

  // Éclair : chaîne dense de particules le long d'une ligne brisée
  _bolt(from, to, segs, jag, colors, size, life) {
    let px = from.x, pz = from.z;
    const y = from.y + 0.02;
    const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    for (let s = 1; s <= segs; s++) {
      const t = s / segs, off = s === segs ? 0 : (Math.random() - 0.5) * 2 * jag * len;
      const qx = from.x + dx * t + nx * off, qz = from.z + dz * t + nz * off;
      const sl = Math.hypot(qx - px, qz - pz), steps = Math.max(2, Math.ceil(sl / 0.022));
      for (let k = 0; k < steps; k++) {
        const f = k / steps;
        this.pAdd.spawn(px + (qx - px) * f, y, pz + (qz - pz) * f, 0, 0, 0, life * rand(0.8, 1.2), size, size * 0.6, pick(colors), 1, 0, 0, true);
      }
      px = qx; pz = qz;
    }
  }

  _ring(pos, color, radius, dur, { width = 0.08, fill = 0, delay = 0, alpha = 1, reverse = 0, blend = 'add' } = {}) {
    const mesh = this._ringPool.pop() || new THREE.Mesh(RING_GEO, makeRingMat());
    mesh.frustumCulled = false; mesh.renderOrder = fill ? 3 : 2;
    const u = mesh.material.uniforms;
    u.uColor.value.set(color); u.uW.value = width; u.uFill.value = fill; u.uA.value = alpha; u.uRev.value = reverse; u.uP.value = 0;
    setBlend(mesh.material, blend);
    mesh.position.set(pos.x, pos.y + 0.03, pos.z);
    mesh.scale.setScalar(radius);
    mesh.visible = delay <= 0;
    if (!mesh.parent) this.root.add(mesh);
    this.rings.push({ mesh, t: 0, dur, delay });
  }
  _flash(pos, color, radius, dur, alpha = 1) { this._ring(pos, color, radius, dur, { fill: 1, alpha }); }

  _burst(pos, n, { colors, speed = [1, 2], life = [0.3, 0.6], size = [0.04, 0.08], sizeEnd = 0, drag = 3, grav = 0, blend = 'add', alpha = 1, twinkle = false, y = 0.15, dir = null, cone = Math.PI * 2, offset = 0, s = 1 }) {
    const pool = blend === 'normal' ? this.pNorm : this.pAdd;
    const base = dir ? Math.atan2(dir.z, dir.x) : 0;
    const k = Math.sqrt(s);
    for (let i = 0; i < n; i++) {
      const a = dir ? base + (Math.random() - 0.5) * cone : Math.random() * Math.PI * 2;
      const sp = rand(speed[0], speed[1]) * k, c = Math.cos(a), sn = Math.sin(a);
      pool.spawn(pos.x + c * offset, pos.y + 0.05, pos.z + sn * offset, c * sp, rand(-y, y) * sp, sn * sp,
        rand(life[0], life[1]), rand(size[0], size[1]) * k, sizeEnd * k, pick(colors), alpha, drag, grav, twinkle);
    }
  }

  // Éclats : particules alignées lancées à la même vitesse → lisent comme des traits
  _shards(pos, n, len, speed, colors, size, life) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3), c = Math.cos(a), s = Math.sin(a), sp = rand(speed * 0.7, speed);
      for (let k = 0; k < 7; k++) {
        const b = -k * len / 7;
        this.pAdd.spawn(pos.x + c * b, pos.y + 0.05, pos.z + s * b, c * sp, 0, s * sp, life, size * (1 - k / 9), 0, pick(colors), 1 - k / 8, 3.2, 0);
      }
    }
  }

  // Tourbillon tangentiel autour du point d'impact
  _swirl(pos, n, s, colors, pool = this.pAdd, { size = 0.035, alpha = 1, speed = [2, 3.2] } = {}) {
    const k = Math.sqrt(s);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.12 * s, c = Math.cos(a), sn = Math.sin(a), sp = rand(speed[0], speed[1]) * k;
      pool.spawn(pos.x + c * r, pos.y + 0.05, pos.z + sn * r, -sn * sp + c * 0.9 * k, 0, c * sp + sn * 0.9 * k, rand(0.35, 0.6), size * s, 0, pick(colors), alpha, 2.2, 0);
    }
  }

  _impact(P, pos, dir, k = 1) {
    const core = P.coreColor.getStyle(), halo = P.haloColor.getStyle();
    const s = (P.size / 0.13) * k, b = Math.max(0.2, P.bloom), pm = Math.max(0.35, this.globals.particles);
    const N = (n) => Math.max(3, Math.round(n * pm * Math.min(1.4, 0.4 + s * 0.6)));
    const ks = Math.sqrt(s);
    switch (P.impact) {
      case 'feu':
        this._flash(pos, halo, 0.8 * s * b, 0.25);
        this._flash(pos, core, 0.35 * s, 0.14);
        this._ring(pos, halo, 0.95 * s, 0.42, { width: 0.12 });
        this._burst(pos, N(40), { colors: P.tp.colors, speed: [1, 3.4], life: [0.3, 0.75], size: [0.06, 0.14], sizeEnd: 0.01, drag: 3.2, s });
        this._burst(pos, N(10), { colors: ['#3a1a10', '#221008'], speed: [0.3, 0.9], life: [0.6, 1], size: [0.18, 0.3], sizeEnd: 0.45, drag: 2, blend: 'normal', alpha: 0.35, s });
        break;
      case 'glace':
        this._flash(pos, core, 0.55 * s * b, 0.18);
        this._ring(pos, halo, 0.85 * s, 0.35, { width: 0.06 });
        this._ring(pos, '#e8fbff', 0.6 * s, 0.5, { width: 0.04, delay: 0.08, alpha: 0.7 });
        this._shards(pos, 9, 0.22 * s, 3.2 * ks, ['#ffffff', '#c8f4ff', halo], 0.05 * s, 0.32);
        this._burst(pos, N(26), { colors: P.tp.colors, speed: [0.2, 0.9], life: [0.6, 1.1], size: [0.03, 0.06], drag: 2, twinkle: true, s });
        break;
      case 'foudre': {
        this._flash(pos, '#ffffff', 0.9 * s * b, 0.12);
        this._flash(pos, halo, 1.2 * s * b, 0.22, 0.6);
        this._ring(pos, halo, 1 * s, 0.22, { width: 0.05 });
        const strike = () => {
          for (let i = 0; i < 5; i++) {
            const a = Math.random() * Math.PI * 2, r = rand(0.5, 1) * s;
            this._bolt(pos, { x: pos.x + Math.cos(a) * r, y: pos.y, z: pos.z + Math.sin(a) * r }, 6, 0.12, ['#ffffff', halo], 0.035 * ks, 0.09);
          }
        };
        strike();
        this.timers.push({ t: 0.07, fn: strike }, { t: 0.15, fn: strike });
        this._burst(pos, N(30), { colors: P.tp.colors, speed: [2, 5], life: [0.1, 0.3], size: [0.02, 0.05], drag: 5, s });
        break;
      }
      case 'energie':
        this._flash(pos, core, 0.7 * s * b, 0.2);
        this._flash(pos, halo, 1.5 * s * b, 0.45, 0.55);
        this._ring(pos, halo, 1.1 * s, 0.5, { width: 0.05 });
        this._ring(pos, core, 0.7 * s, 0.4, { width: 0.03, delay: 0.1 });
        this._shards(pos, 8, 0.3 * s, 2.6 * ks, ['#ffffff', halo], 0.035 * s, 0.35);
        this._burst(pos, N(28), { colors: P.tp.colors, speed: [0.2, 1], life: [0.7, 1.3], size: [0.03, 0.07], drag: 1.5, twinkle: true, s });
        break;
      case 'sorcellerie': {
        const inward = N(30);
        for (let i = 0; i < inward; i++) {
          const a = Math.random() * Math.PI * 2, r = rand(0.5, 0.8) * s, life = rand(0.22, 0.3);
          const c = Math.cos(a), sn = Math.sin(a);
          this.pNorm.spawn(pos.x + c * r, pos.y + 0.05, pos.z + sn * r, -c * r / life, 0, -sn * r / life, life, 0.2 * ks, 0.05, pick(P.tp.colors), 0.7, 0, 0);
          if (i % 2) this.pAdd.spawn(pos.x + c * r, pos.y + 0.06, pos.z + sn * r, -c * r / life, 0, -sn * r / life, life, 0.04 * ks, 0.02, pick(P.sparks.colors), 1, 0, 0);
        }
        this._ring(pos, halo, 0.9 * s, 0.3, { width: 0.1, reverse: 1 });
        this.timers.push({
          t: 0.26, fn: () => {
            this._flash(pos, halo, 0.9 * s * b, 0.3, 0.8);
            this._ring(pos, '#1a0d2e', 1.1 * s, 0.5, { width: 0.18, blend: 'normal', alpha: 0.8 });
            this._ring(pos, halo, 1 * s, 0.4, { width: 0.04 });
            this._burst(pos, N(20), { colors: P.sparks.colors, speed: [1.5, 3], life: [0.2, 0.45], size: [0.03, 0.06], drag: 3.5, s });
          },
        });
        break;
      }
      case 'air':
        this._flash(pos, core, 0.45 * s * b, 0.18);
        this._ring(pos, halo, 1 * s, 0.4, { width: 0.03 });
        this._ring(pos, core, 0.7 * s, 0.35, { width: 0.02, delay: 0.07, alpha: 0.8 });
        this._swirl(pos, N(34), s, P.tp.colors);
        break;
      case 'terre':
        this._flash(pos, halo, 0.5 * s * b, 0.18);
        this._ring(pos, '#6b4a22', 1 * s, 0.55, { width: 0.2, blend: 'normal', alpha: 0.7 });
        this._ring(pos, halo, 0.8 * s, 0.3, { width: 0.06 });
        this._burst(pos, N(18), { colors: ['#8a6232', '#5c3f1c', '#b88a4e'], speed: [1, 2.4], life: [0.4, 0.7], size: [0.07, 0.14], sizeEnd: 0.05, drag: 4, blend: 'normal', alpha: 0.95, s });
        this._burst(pos, N(14), { colors: ['#6b4a22', '#8a6a44'], speed: [0.3, 0.8], life: [0.7, 1.1], size: [0.2, 0.3], sizeEnd: 0.5, drag: 2, blend: 'normal', alpha: 0.3, s });
        this._burst(pos, N(12), { colors: [core, halo], speed: [1.5, 3], life: [0.15, 0.3], size: [0.025, 0.045], drag: 4, s });
        break;
      case 'eau':
        this._flash(pos, core, 0.4 * s * b, 0.16);
        for (let i = 0; i < 3; i++) this._ring(pos, i ? halo : core, (0.6 + i * 0.25) * s, 0.55, { width: 0.035, delay: i * 0.1, alpha: 1 - i * 0.2 });
        this._burst(pos, N(30), { colors: P.tp.colors, speed: [1.2, 3], life: [0.25, 0.5], size: [0.03, 0.07], sizeEnd: 0.01, drag: 3.8, s });
        this._burst(pos, N(12), { colors: P.tp.colors, speed: [1.5, 2.5], life: [0.3, 0.45], size: [0.04, 0.08], drag: 3, dir, cone: 1.2, s });
        break;
      case 'metal':
        this._flash(pos, '#ffffff', 0.45 * s * b, 0.1);
        this._flash(pos, halo, 0.8 * s * b, 0.2, 0.5);
        this._ring(pos, core, 0.75 * s, 0.22, { width: 0.025 });
        this._ring(pos, halo, 1 * s, 0.3, { width: 0.02, delay: 0.05, alpha: 0.7 });
        this._shards(pos, 12, 0.2 * s, 4.2 * ks, ['#ffffff', '#dfe6ee', halo], 0.03 * s, 0.24);
        this._burst(pos, N(34), { colors: P.sparks.colors, speed: [2, 5], life: [0.15, 0.45], size: [0.02, 0.04], drag: 2, twinkle: true, s });
        break;
      case 'sable':
        this._flash(pos, halo, 0.4 * s * b, 0.2, 0.7);
        this._ring(pos, '#b88a4e', 1.15 * s, 0.7, { width: 0.26, blend: 'normal', alpha: 0.5 });
        this._ring(pos, halo, 0.8 * s, 0.35, { width: 0.05, alpha: 0.8 });
        this._burst(pos, N(50), { colors: P.tp.colors, speed: [1, 2.8], life: [0.4, 0.8], size: [0.02, 0.045], drag: 3, blend: 'normal', alpha: 0.95, s });
        this._burst(pos, N(12), { colors: ['#c9a266', '#a47e48'], speed: [0.3, 0.8], life: [0.8, 1.2], size: [0.2, 0.32], sizeEnd: 0.55, drag: 2, blend: 'normal', alpha: 0.25, s });
        this._swirl(pos, N(24), s, P.tp.colors, this.pNorm, { size: 0.03, alpha: 0.9, speed: [1.6, 2.6] });
        break;
      case 'plante': {
        this._flash(pos, halo, 0.5 * s * b, 0.22);
        this._ring(pos, halo, 0.9 * s, 0.45, { width: 0.05 });
        this._ring(pos, core, 0.6 * s, 0.4, { width: 0.03, delay: 0.08, alpha: 0.8 });
        // vrilles : chaînes de particules qui s'enroulent en poussant depuis le centre
        const tendrils = 6, curl = Math.random() < 0.5 ? 1 : -1;
        for (let t = 0; t < tendrils; t++) {
          let a = (t / tendrils) * Math.PI * 2 + rand(-0.3, 0.3);
          for (let j = 0; j < 16; j++) {
            a += 0.11 * curl;
            const r = (0.08 + j * 0.045) * s;
            this.pAdd.spawn(pos.x + Math.cos(a) * r, pos.y + 0.04, pos.z + Math.sin(a) * r, 0, 0, 0,
              0.25 + j * 0.03, 0.05 * ks * (1 - j / 20), 0.01, pick(P.tp.colors), 1, 0, 0);
          }
        }
        this._burst(pos, N(16), { colors: ['#2e9e4a', '#4cc05a', '#7ed957'], speed: [0.8, 2], life: [0.5, 0.9], size: [0.05, 0.09], sizeEnd: 0.03, drag: 3, blend: 'normal', alpha: 0.9, s });
        this._burst(pos, N(20), { colors: P.sparks.colors, speed: [0.2, 0.7], life: [0.9, 1.4], size: [0.025, 0.05], drag: 1.2, twinkle: true, s });
        break;
      }
      default:
        this._flash(pos, halo, 0.5 * s * b, 0.18);
        this._ring(pos, halo, 0.7 * s, 0.3, { width: 0.06 });
        this._burst(pos, N(18), { colors: P.tp.colors, speed: [1, 2.4], life: [0.2, 0.4], size: [0.03, 0.06], drag: 3.5, s });
    }
  }

  get activeCount() { return this.projectiles.length; }

  dispose() {
    this.root.parent?.remove(this.root);
    this.root.traverse((o) => { if (o.material) o.material.dispose(); if (o.geometry && o.geometry !== RING_GEO && o.geometry !== CORE_GEO) o.geometry.dispose(); });
    this.projectiles.length = this.rings.length = this.timers.length = 0;
  }
}
