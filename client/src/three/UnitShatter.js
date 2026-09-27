// Destruction d'unité : la carte se fissure (réseau de fêlures radiales lumineuses
// dans la couleur du tier), marque un temps, puis vole en éclats. Chaque éclat est
// un clone de la carte découpé en clip-path, projeté en 3D (culbute, monte vers la
// caméra, s'efface). Côté WebGL : flash, ondes, paillettes de verre, halo d'élément.
// Le tier règle la PUISSANCE : nombre d'éclats, durée de fissure, force de projection,
// rotation, secousse, et à partir du tier 4 des ondes de rareté supplémentaires.
import { frameForTier } from './cardPalette.js';
import { normalizeElement } from './EnergyArrows.js';
import { LOW_END_DEVICE } from './constants.js';

export const SHATTER_TIER_POWER = { 1: 0.6, 2: 0.8, 3: 1, 4: 1.35, 5: 1.8 };
// rays × rings : réseau de fracture · crack : fissure avant rupture (s) · fly : vol des éclats (s)
export const TIER_FRACTURE = {
  1: { rays: 6, rings: 2, crack: 0.14, fly: 0.6 },
  2: { rays: 7, rings: 2, crack: 0.2, fly: 0.7 },
  3: { rays: 8, rings: 2, crack: 0.28, fly: 0.82 },
  4: { rays: 8, rings: 2, crack: 0.42, fly: 0.98 },
  5: { rays: 9, rings: 2, crack: 0.62, fly: 1.2 },
};
export const DEFAULT_SHATTER_GLOBALS = { speed: 1, power: 1, shake: 1, tierPower: { ...SHATTER_TIER_POWER } };

const TAU = Math.PI * 2, SVGNS = 'http://www.w3.org/2000/svg';
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Sutherland–Hodgman contre le rectangle de la carte
function clipRect(poly, x0, y0, x1, y1) {
  const atX = (a, b, x) => [x, a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1])];
  const atY = (a, b, y) => [a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), y];
  const edges = [
    [(p) => p[0] >= x0, (a, b) => atX(a, b, x0)], [(p) => p[0] <= x1, (a, b) => atX(a, b, x1)],
    [(p) => p[1] >= y0, (a, b) => atY(a, b, y0)], [(p) => p[1] <= y1, (a, b) => atY(a, b, y1)],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length], ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(cut(prev, cur)); out.push(cur); } else if (pi) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}
const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };

// Fracture radiale façon verre : rayons depuis un point d'impact, anneaux irréguliers
function fracture(W, m, F) {
  const x0 = m, y0 = m, x1 = W - m, y1 = W - m;
  const c = [W / 2 + rand(-0.14, 0.14) * W, W / 2 + rand(-0.14, 0.14) * W];
  const R = F.rays, K = F.rings, base = Math.random() * TAU;
  const pts = [];
  for (let i = 0; i < R; i++) {
    const a = base + (i + rand(-0.32, 0.32)) * TAU / R, cs = Math.cos(a), sn = Math.sin(a), row = [];
    for (let j = 0; j < K; j++) { const r = j === K - 1 ? W * 2 : W * 0.55 * ((j + 1) / K) * rand(0.72, 1.25); row.push([c[0] + cs * r, c[1] + sn * r]); }
    pts.push(row);
  }
  const cells = [], rays = [], rings = [];
  for (let i = 0; i < R; i++) {
    const n = (i + 1) % R;
    for (let j = 0; j < K; j++) {
      const poly = clipRect(j === 0 ? [c, pts[i][0], pts[n][0]] : [pts[i][j - 1], pts[i][j], pts[n][j], pts[n][j - 1]], x0, y0, x1, y1);
      if (poly.length < 3 || area(poly) < 6) continue;
      let cx = 0, cy = 0; for (const p of poly) { cx += p[0]; cy += p[1]; } cx /= poly.length; cy /= poly.length;
      cells.push({ poly, cx, cy, d: Math.hypot(cx - c[0], cy - c[1]) });
    }
    rays.push([c, ...pts[i]]);
    for (let j = 0; j < K - 1; j++) rings.push([pts[i][j], pts[n][j]]);
  }
  return { c, cells, rays, rings };
}
const pathD = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');

export class UnitShatter {
  constructor(fx, { onShake = null, onDone = null } = {}) {
    this.fx = fx; this.onShake = onShake; this.onDone = onDone;
    this.globals = { ...DEFAULT_SHATTER_GLOBALS, tierPower: { ...SHATTER_TIER_POWER } };
    this.jobs = new Map();
  }
  setGlobals(g) {
    const { tierPower, ...rest } = g;
    Object.assign(this.globals, rest);
    if (tierPower) Object.assign(this.globals.tierPower, tierPower);
  }
  get activeCount() { return this.jobs.size; }

  /** Brise la carte de l'unité. Résout quand le dernier éclat a disparu. */
  shatter(actor, element = 'neutral', { tier = 3, delay = 0 } = {}) {
    this.cancel(actor);
    const list = [].concat(element).filter(Boolean).map(normalizeElement);
    const g = this.globals, sp = Math.max(0.1, g.speed), t = Math.max(1, Math.min(5, tier | 0 || 3));
    const pw = (g.tierPower[t] ?? 1) * g.power;
    let F = TIER_FRACTURE[t];
    // Appareil modeste : le réseau de fracture est moins dense (même levier que
    // les fragments de l'ancienne explosion en grille, `KILL_CFG.fc`/`fr`).
    if (LOW_END_DEVICE) F = { ...F, rays: Math.max(4, F.rays - 2) };
    const P = this.fx.resolveParams(list[0] || 'neutral', { tier: t });
    const P2 = list[1] ? this.fx.resolveParams(list[1], { tier: t }) : null;
    return new Promise((resolve) => {
      this.jobs.set(actor, {
        actor, t: -delay, phase: 'wait', tier: t, pw, sp, F, P, P2, T: frameForTier(t).edge, resolve,
        crack: F.crack / sp, fly: F.fly / sp, end: 0, svg: null, shards: null,
      });
    });
  }

  cancel(actor) {
    const j = this.jobs.get(actor); if (!j) return;
    j.svg?.remove(); j.shards?.remove();
    const card = actor.dom?.card; if (card) { card.getAnimations().forEach((a) => a.cancel()); card.style.visibility = ''; }
    this.jobs.delete(actor); j.resolve();
  }

  update(dt) {
    for (const j of [...this.jobs.values()]) {
      j.t += dt;
      if (j.phase === 'wait' && j.t >= 0) { j.phase = 'crack'; this._crack(j); }
      if (j.phase === 'crack' && j.t >= j.crack) { j.phase = 'fly'; this._break(j); }
      if (j.phase === 'fly' && j.t >= j.end) {
        j.shards?.remove(); this.jobs.delete(j.actor); j.resolve(); this.onDone?.(j.actor);
      }
    }
  }

  _pos(j) { const p = j.actor.obj.position.clone(); p.y = 0.12; return p; }
  _N(n, s) { return Math.max(2, Math.round(n * Math.max(0.35, this.fx.globals.particles) * s)); }

  _crack(j) {
    const { actor, tier: t, T, crack, pw } = j, wrap = actor.dom.wrap, card = actor.dom.card;
    const W = wrap.offsetWidth || 90;
    j.W = W; j.frac = fracture(W, 3, j.F);
    // Gèle toute animation/transition CSS de la carte avant de la fissurer :
    // même précaution que l'ancienne explosion en fragments — sans elle, l'idle
    // bob et la dérive de l'illustration continuent de muter `transform` sous le
    // tremblement de la fissure.
    wrap.querySelectorAll('*').forEach((el) => { el.style.animation = 'none'; el.style.transition = 'none'; });
    wrap.style.animation = 'none'; wrap.style.transition = 'none';
    wrap.style.transformStyle = 'preserve-3d'; wrap.style.opacity = '1';
    const ms = crack * 1000;
    // tremblement croissant + surexposition
    const amp = 0.6 + 0.45 * t, kf = [];
    for (let i = 0; i <= 10; i++) { const a = amp * (i / 10); kf.push({ transform: `translate(${rand(-a, a).toFixed(2)}px,${rand(-a, a).toFixed(2)}px)`, filter: `brightness(${(1 + (0.3 + 0.08 * t) * (i / 10)).toFixed(2)})` }); }
    card.animate(kf, { duration: ms, fill: 'forwards' });
    // fêlures lumineuses
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${W}`); svg.setAttribute('width', W); svg.setAttribute('height', W);
    svg.style.cssText = `position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;clip-path:inset(3px round 13px)`;
    const add = (pts, color, width, delay, dur) => {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', pathD(pts)); p.setAttribute('pathLength', '1');
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', width);
      p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
      p.style.strokeDasharray = '1 1'; p.style.strokeDashoffset = '1';
      svg.appendChild(p);
      p.animate([{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }], { duration: dur, delay, easing: 'cubic-bezier(.3,.8,.4,1)', fill: 'forwards' });
    };
    for (const r of j.frac.rays) { const d = rand(0, ms * 0.12), du = ms * rand(0.4, 0.6); add(r, T, 3.2, d, du); add(r, '#ffffff', 0.9, d, du); }
    for (const r of j.frac.rings) { const d = ms * rand(0.35, 0.55), du = ms * 0.25; add(r, T, 2, d, du); add(r, '#ffffff', 0.7, d, du); }
    wrap.appendChild(svg); j.svg = svg;
    // énergie aspirée (tier 3+) et anneau de rareté
    const fx = this.fx, pos = this._pos(j);
    if (t >= 2) fx._ring(pos, T, 0.75 + 0.12 * t, crack, { reverse: 1, width: 0.03, alpha: 0.7 });
    if (t >= 3) {
      const n = this._N(2 * t, 1);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, R = (0.8 + 0.12 * t) * rand(0.8, 1.1), L = crack * rand(0.6, 1), v = R / L;
        fx.pAdd.spawn(pos.x + Math.cos(a) * R, pos.y + 0.05, pos.z + Math.sin(a) * R, -Math.cos(a) * v, 0, -Math.sin(a) * v, L, rand(0.02, 0.045), 0, pick([T, '#ffffff']), 1, 0, 0, true);
      }
    }
    if (t >= 5) fx._flash(pos, T, 0.7, crack, 0.3);
  }

  _break(j) {
    const { actor, tier: t, T, pw, sp, fly, W, frac, P } = j, wrap = actor.dom.wrap, card = actor.dom.card;
    j.svg?.remove(); j.svg = null;
    card.getAnimations().forEach((a) => a.cancel());
    const tpl = card.cloneNode(true);
    card.style.visibility = 'hidden';
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;transform-style:preserve-3d;pointer-events:none';
    let last = 0;
    for (const cell of frac.cells) {
      const { poly, cx, cy, d } = cell;
      const sh = document.createElement('div');
      sh.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${W}px;clip-path:polygon(${poly.map((p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`).join(',')});transform-origin:${cx.toFixed(1)}px ${cy.toFixed(1)}px;will-change:transform,opacity`;
      sh.appendChild(tpl.cloneNode(true));
      box.appendChild(sh);
      let dx = cx - frac.c[0], dy = cy - frac.c[1];
      const L = Math.hypot(dx, dy) || 1, ja = rand(-0.35, 0.35), ca = Math.cos(ja), sa = Math.sin(ja);
      dx /= L; dy /= L; [dx, dy] = [dx * ca - dy * sa, dx * sa + dy * ca];
      const dist = pw * (W * 0.35 + d * 1.1) * rand(0.7, 1.3), z = pw * W * rand(0.15, 0.6);
      const rx = rand(-1, 1) * pw * rand(140, 420), ry = rand(-1, 1) * pw * rand(140, 420), rz = rand(-1, 1) * pw * rand(40, 200);
      const X = dx * dist, Y = dy * dist;
      const dur = fly * rand(0.85, 1.15) * 1000, delay = (d / W) * 110 / sp;
      last = Math.max(last, dur + delay);
      sh.animate([
        { transform: 'translate3d(0,0,0) rotateX(0deg) rotateY(0deg) rotateZ(0deg)', opacity: 1 },
        { transform: `translate3d(${(X * 0.5).toFixed(1)}px,${(Y * 0.5).toFixed(1)}px,${z.toFixed(1)}px) rotateX(${(rx * 0.4).toFixed(0)}deg) rotateY(${(ry * 0.4).toFixed(0)}deg) rotateZ(${(rz * 0.4).toFixed(0)}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate3d(${X.toFixed(1)}px,${Y.toFixed(1)}px,${(z * 0.3).toFixed(1)}px) rotateX(${rx.toFixed(0)}deg) rotateY(${ry.toFixed(0)}deg) rotateZ(${rz.toFixed(0)}deg)`, opacity: 0 },
      ], { duration: dur, delay, easing: 'cubic-bezier(.16,.72,.3,1)', fill: 'both' });
    }
    wrap.appendChild(box); j.shards = box;
    j.end = j.t + last / 1000 + 0.05;
    this._burstFx(j);
  }

  _burstFx(j) {
    const { tier: t, T, pw, P, P2 } = j, fx = this.fx, pos = this._pos(j), s = pw, k = Math.sqrt(s);
    const halo = P.haloColor.getStyle(), core = P.coreColor.getStyle();
    fx._flash(pos, '#ffffff', 0.55 * s, 0.14);
    fx._flash(pos, T, 1.2 * s, 0.35, 0.55);
    fx._ring(pos, T, 1.05 * s, 0.42, { width: 0.05 });
    if (t >= 3) fx._ring(pos, '#ffffff', 0.8 * s, 0.35, { width: 0.025, delay: 0.06, alpha: 0.8 });
    if (t >= 4) fx._ring(pos, T, 1.7 * s, 0.7, { width: 0.035, delay: 0.12, alpha: 0.85 });
    if (t >= 5) {
      fx._ring(pos, halo, 2.3 * s, 0.9, { width: 0.03, delay: 0.22, alpha: 0.7 });
      fx.timers.push({ t: 0.2, fn: () => fx._flash(pos, T, 1.6 * s, 0.4, 0.35) });
    }
    // paillettes de verre
    fx._burst(pos, this._N(12, Math.min(s, 1.2)), { colors: ['#ffffff', T, T, core], speed: [0.6, 2.6], life: [0.45, 1], size: [0.02, 0.05], drag: 2.4, twinkle: true, y: 0.9 });
    fx._shards(pos, 3 + t, 0.22 * s, 2.8 * k, ['#ffffff', T], 0.03 * k, 0.3);
    // halo de l'élément de l'unité
    for (const Q of [P, P2].filter(Boolean)) {
      fx._burst(pos, this._N(Q === P ? 8 : 5, Math.min(s, 1.2)), { colors: Q.tp.colors, speed: [0.4, 1.6], life: [0.35, 0.7], size: [0.05, 0.1], sizeEnd: 0.01, drag: 2.8 });
    }
    this.onShake?.((0.012 + 0.01 * t) * pw * this.globals.shake);
  }

  dispose() { for (const a of [...this.jobs.keys()]) this.cancel(a); }
}
