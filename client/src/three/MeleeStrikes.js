// MeleeStrikes — attaques au corps à corps élémentaires, sur la base d'EnergyArrows.
// L'unité anticipe, se déplace selon son élément (charge, glisse, téléportation,
// bond, tourbillon…), pivote vers sa cible, frappe (N coups selon le tier) puis revient.
// Chaque coup est un « tranchant » : un projectile EnergyArrows très court qui suit
// une trajectoire propre à l'élément et déclenche les mêmes impacts que les projectiles
// (`EnergyArrows._impact`) — aucune décoration d'impact à dupliquer par-dessus.
//
// Acteur attendu : { obj: Object3D, home: Vector3, baseQuat: Quaternion, baseScale: number,
//                    forward: Vector3, setOpacity?(a) }
import * as THREE from 'three';
import { normalizeElement } from './EnergyArrows.js';

export const TIER_POWER = { 1: 0.7, 2: 0.85, 3: 1, 4: 1.25, 5: 1.6 };
export const TIER_HITS = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3 };

// move : déplacement · slash : forme du tranchant · windup/travel : durées (s) · lean : inclinaison (rad)
export const MELEE_STYLES = {
  feu: { move: 'dash', slash: 'arc', windup: 0.16, travel: 0.22, lean: 0.35, aura: 90 },
  glace: { move: 'glide', slash: 'stab', windup: 0.12, travel: 0.32, lean: 0.15, aura: 50 },
  foudre: { move: 'blink', slash: 'stab', windup: 0.1, travel: 0.16, lean: 0.2, aura: 0 },
  energie: { move: 'dash', slash: 'stab', windup: 0.14, travel: 0.18, lean: 0.3, aura: 60 },
  sorcellerie: { move: 'shadow', slash: 'spiral', windup: 0.18, travel: 0.3, lean: 0.1, aura: 0 },
  air: { move: 'spin', slash: 'spiral', windup: 0.08, travel: 0.3, lean: 0.1, spin: 2, aura: 70 },
  terre: { move: 'leap', slash: 'slam', windup: 0.24, travel: 0.42, lean: 0.25, aura: 30 },
  eau: { move: 'weave', slash: 'wave', windup: 0.12, travel: 0.34, lean: 0.2, aura: 60 },
  metal: { move: 'dash', slash: 'arc', windup: 0.2, travel: 0.2, lean: 0.45, aura: 40 },
  sable: { move: 'weave', slash: 'spiral', windup: 0.12, travel: 0.34, lean: 0.15, spin: 1, aura: 110 },
  plante: { move: 'glide', slash: 'whip', windup: 0.2, travel: 0.38, lean: 0.2, aura: 50 },
  neutral: { move: 'dash', slash: 'arc', windup: 0.14, travel: 0.24, lean: 0.3, aura: 30 },
};

export const DEFAULT_MELEE_GLOBALS = { speed: 1, power: 1, knockback: 1, shake: 1, tierPower: { ...TIER_POWER } };

const UP = new THREE.Vector3(0, 1, 0);
const E = {
  out: (u) => 1 - (1 - u) ** 3,
  in: (u) => u * u,
  io: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
};
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const yawBetween = (f, d) => Math.atan2(f.z * d.x - f.x * d.z, f.x * d.x + f.z * d.z);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _ax = new THREE.Vector3(), _t = new THREE.Vector3();

export class MeleeStrikes {
  constructor(fx, { onHit = null, onShake = null } = {}) {
    this.fx = fx;
    this.onHit = onHit;
    this.onShake = onShake;
    this.globals = { ...DEFAULT_MELEE_GLOBALS, tierPower: { ...TIER_POWER } };
    this.states = new Map();
    this.pose = { pos: new THREE.Vector3(), yaw: 0, lean: 0, leanDir: new THREE.Vector3(0, 0, -1), lift: 0, scale: 1, op: 1 };
  }

  setGlobals(g) {
    const { tierPower, ...rest } = g;
    Object.assign(this.globals, rest);
    if (tierPower) Object.assign(this.globals.tierPower, tierPower);
  }

  get activeCount() { let n = 0; for (const S of this.states.values()) if (S.action) n++; return n; }

  _stateOf(actor) {
    let S = this.states.get(actor);
    if (!S) { S = { actor, action: null, queue: [], kicks: [], op: 1 }; this.states.set(actor, S); }
    return S;
  }

  /** Attaque au corps à corps. Résout quand l'unité est revenue à sa place. */
  strike(attacker, target, element = 'neutral', { tier = 3 } = {}) {
    return new Promise((resolve) => {
      const S = this._stateOf(attacker);
      const job = { target, element, tier, resolve };
      if (S.action) S.queue.push(job); else this._start(S, job);
    });
  }

  /**
   * Annule toute action/file/recul en cours pour cet acteur, sans résoudre les
   * promesses en attente. Appelé par le porteur quand il quitte le plateau
   * (mort, retrait) pendant que son propre élan est encore en vol — sans ça la
   * carte continuerait de charger/frapper/revenir sur un objet 3D déjà remplacé
   * par l'explosion de mort.
   */
  cancel(actor) {
    const S = this.states.get(actor);
    if (!S) return;
    this.states.delete(actor);
  }

  _start(S, job) {
    const list = [].concat(job.element).filter(Boolean).map(normalizeElement);
    if (!list.length) list.push('neutral');
    const st = MELEE_STYLES[list[0]] || MELEE_STYLES.neutral;
    const g = this.globals, sp = Math.max(0.1, g.speed);
    const pw = (g.tierPower[job.tier] ?? 1) * g.power;
    const H = S.actor.home.clone(), T = job.target.home.clone();
    const d0 = _t.subVectors(T, H).setY(0);
    if (d0.lengthSq() < 1e-6) d0.set(0, 0, -1);
    d0.normalize();
    const d0c = d0.clone();
    // point d'approche légèrement décalé autour de la cible pour éviter l'empilement
    const back = d0c.clone().negate().applyAxisAngle(UP, (Math.random() - 0.5) * 1.3);
    const A = T.clone().addScaledVector(back, 0.62); A.y = H.y;
    const d = back.clone().negate();
    const W = H.clone().addScaledVector(d0c, -0.14 * (0.7 + 0.3 * pw));
    S.action = {
      job, list, st, pw, sp, H, A, T, W, d0: d0c, d, t: 0, phase: 'windup',
      hits: TIER_HITS[job.tier] ?? 1, fired: -1, side: Math.random() < 0.5 ? 1 : -1,
      tw: (st.windup * (0.75 + 0.3 * pw)) / sp, tt: st.travel / sp, th: 0.24 / sp, tr: 0.36 / sp,
      yaw0: yawBetween(S.actor.forward, d0c), yaw1: yawBetween(S.actor.forward, d),
      P: this.fx.resolveParams(list[0], { tier: job.tier }), auraAcc: 0, mark: {},
    };
  }

  _next(a, phase) { a.phase = phase; a.t = 0; }

  update(dt) {
    dt = Math.min(dt, 0.05);
    for (const S of this.states.values()) {
      const p = this.pose, ac = S.actor;
      p.pos.copy(ac.home); p.yaw = 0; p.lean = 0; p.lift = 0; p.scale = 1; p.op = 1; p.leanDir.copy(ac.forward);
      if (S.action && this._step(S, S.action, dt, p)) {
        S.action.job.resolve();
        S.action = null;
        if (S.queue.length) this._start(S, S.queue.shift());
      }
      for (let i = S.kicks.length - 1; i >= 0; i--) {
        const k = S.kicks[i]; k.t += dt;
        const e = k.t / k.dur;
        if (e >= 1) { S.kicks.splice(i, 1); continue; }
        const f = Math.sin(e * Math.PI) * (1 - e) * 2.2;
        p.pos.addScaledVector(k.dir, k.amp * f);
        p.yaw += k.yaw * f;
        p.lean -= k.tilt * f; p.leanDir.copy(k.dir).negate();
      }
      this._apply(S, p);
      if (!S.action && !S.queue.length && !S.kicks.length) this.states.delete(ac);
    }
  }

  _apply(S, p) {
    const ac = S.actor, o = ac.obj;
    o.position.copy(p.pos); o.position.y += p.lift;
    _q1.setFromAxisAngle(UP, p.yaw);
    _ax.crossVectors(UP, p.leanDir);
    if (_ax.lengthSq() > 1e-6 && p.lean) _q2.setFromAxisAngle(_ax.normalize(), p.lean); else _q2.identity();
    o.quaternion.copy(_q2).multiply(_q1).multiply(ac.baseQuat);
    o.scale.setScalar(ac.baseScale * p.scale);
    if (ac.setOpacity && S.op !== p.op) { S.op = p.op; ac.setOpacity(p.op); }
  }

  // renvoie true quand l'action est terminée
  _step(S, a, dt, p) {
    a.t += dt;
    const { st, pw, d, d0 } = a;
    if (a.phase === 'windup') {
      const e = E.out(clamp01(a.t / a.tw));
      p.pos.lerpVectors(a.H, a.W, e);
      p.yaw = a.yaw0 * e; p.lean = -st.lean * 0.8 * e; p.leanDir.copy(d0);
      p.lift = 0.04 * e; p.scale = 1 + 0.05 * e * pw;
      if (a.t >= a.tw) this._next(a, 'travel');
      return false;
    }
    if (a.phase === 'travel') {
      const u = clamp01(a.t / a.tt);
      this._travel(S, a, u, p, dt);
      if (a.t >= a.tt) this._next(a, 'strike');
      return false;
    }
    if (a.phase === 'strike') {
      const i = Math.min(a.hits - 1, Math.floor(a.t / a.th));
      if (i > a.fired && a.t < a.hits * a.th) { a.fired = i; this._slash(a, i); }
      const v = clamp01((a.t - i * a.th) / a.th), s = Math.sin(v * Math.PI);
      const sgn = i % 2 ? -a.side : a.side;
      p.pos.copy(a.A).addScaledVector(d, 0.2 * s * (0.8 + 0.2 * pw));
      p.yaw = a.yaw1 + sgn * 0.5 * s; p.lean = st.lean * (0.6 + 0.4 * s); p.leanDir.copy(d);
      p.lift = 0.06; p.scale = 1 + 0.06 * pw * s;
      if (a.t >= a.hits * a.th + 0.1 / a.sp) this._next(a, 'return');
      return false;
    }
    // return
    const u = clamp01(a.t / a.tr), e = E.io(u);
    const blinky = st.move === 'blink' || st.move === 'shadow';
    if (blinky) {
      if (!a.mark.back) { a.mark.back = 1; this._vanish(a, a.A, a.H); }
      p.pos.copy(u < 0.5 ? a.A : a.H);
      p.op = u < 0.5 ? 1 - u * 2 : (u - 0.5) * 2;
    } else {
      p.pos.lerpVectors(a.A, a.H, e);
      p.lift = 0.06 + 0.1 * Math.sin(u * Math.PI);
    }
    p.yaw = a.yaw1 * (1 - e); p.lean = st.lean * 0.6 * (1 - u); p.leanDir.copy(d);
    return a.t >= a.tr;
  }

  _travel(S, a, u, p, dt) {
    const { st, pw, d } = a;
    let e = E.io(u);
    p.yaw = a.yaw0 + (a.yaw1 - a.yaw0) * e; p.lean = st.lean; p.leanDir.copy(d); p.lift = 0.06;
    switch (st.move) {
      case 'dash':
        e = E.in(u);
        p.pos.lerpVectors(a.W, a.A, e);
        p.lift = 0.05 + 0.08 * Math.sin(u * Math.PI); p.scale = 1 + 0.06 * pw;
        break;
      case 'glide':
        p.pos.lerpVectors(a.W, a.A, e); p.lean = st.lean * 0.7; p.lift = 0.08;
        break;
      case 'weave': {
        p.pos.lerpVectors(a.W, a.A, e);
        _ax.crossVectors(UP, _t.subVectors(a.A, a.W).setY(0).normalize());
        p.pos.addScaledVector(_ax, Math.sin(u * Math.PI * 2) * 0.32 * (1 - u * 0.4) * a.side);
        p.yaw += Math.cos(u * Math.PI * 2) * 0.45 * a.side;
        p.lift = 0.07;
        break;
      }
      case 'spin':
        p.pos.lerpVectors(a.W, a.A, e);
        p.yaw += e * Math.PI * 2 * (st.spin || 1) * a.side; p.lean = st.lean * 0.5; p.lift = 0.1;
        break;
      case 'leap': {
        p.pos.lerpVectors(a.W, a.A, e);
        const h = Math.sin(u * Math.PI);
        p.lift = 0.05 + h * (0.8 + 0.35 * pw); p.scale = 1 + h * 0.3;
        p.lean = st.lean * -Math.cos(u * Math.PI);
        if (u >= 1 && !a.mark.land) {
          a.mark.land = 1;
          const P = a.P, halo = P.haloColor.getStyle();
          this.fx._ring(a.A, halo, 0.7 * pw, 0.4, { width: 0.16 });
          this.fx._burst(a.A, 14, { colors: ['#8a6232', '#5c3f1c', '#b88a4e'], speed: [0.6, 1.6], life: [0.3, 0.6], size: [0.06, 0.12], sizeEnd: 0.1, drag: 3, blend: 'normal', alpha: 0.8, s: pw });
          this.onShake?.(0.05 * pw * this.globals.shake);
        }
        break;
      }
      case 'blink':
      case 'shadow':
        if (!a.mark.go) { a.mark.go = 1; this._vanish(a, a.W, a.A); }
        p.pos.copy(u < 0.5 ? a.W : a.A);
        p.op = u < 0.5 ? 1 - u * 2 : (u - 0.5) * 2;
        p.lean = st.lean * 0.4;
        break;
    }
    if (st.aura) this._aura(a, p, dt);
  }

  // traînée d'énergie qui suit l'unité pendant son déplacement
  _aura(a, p, dt) {
    const tp = a.P.tp, pool = tp.blend === 'normal' ? this.fx.pNorm : this.fx.pAdd;
    const k = Math.sqrt(a.pw);
    a.auraAcc += a.st.aura * dt * k;
    while (a.auraAcc >= 1) {
      a.auraAcc -= 1;
      const x = p.pos.x + rand(-0.3, 0.3), z = p.pos.z + rand(-0.3, 0.3), y = p.pos.y + p.lift * 0.5 + 0.05;
      pool.spawn(x, y, z, -a.d.x * 0.6 + rand(-0.3, 0.3), rand(0, 0.3), -a.d.z * 0.6 + rand(-0.3, 0.3),
        rand(tp.life[0], tp.life[1]), rand(tp.size[0], tp.size[1]) * k, tp.sizeEnd * k, pick(tp.colors), tp.alpha ?? 1, tp.drag, 0, !!tp.twinkle);
    }
  }

  // téléportation (foudre) ou passage par l'ombre (sorcellerie)
  _vanish(a, from, to) {
    const P = a.P, halo = P.haloColor.getStyle(), fx = this.fx;
    const f = from.clone(), t = to.clone(); f.y = t.y = 0.12;
    if (a.st.move === 'blink') {
      fx._bolt(f, t, 9, 0.07, ['#ffffff', halo], 0.04 * Math.sqrt(a.pw), 0.16);
      fx._flash(f, halo, 0.6 * a.pw, 0.16);
      fx.timers.push({ t: a.tt * 0.5, fn: () => fx._flash(t, '#ffffff', 0.5 * a.pw, 0.14) });
    } else {
      const smoke = (pos) => {
        fx._burst(pos, 18, { colors: P.tp.colors, speed: [0.3, 0.9], life: [0.4, 0.7], size: [0.15, 0.25], sizeEnd: 0.4, drag: 2, blend: 'normal', alpha: 0.6, s: a.pw });
        fx._burst(pos, 8, { colors: P.sparks?.colors || [halo], speed: [0.8, 1.6], life: [0.2, 0.4], size: [0.03, 0.05], drag: 3, s: a.pw });
      };
      smoke(f);
      fx.timers.push({ t: a.tt * 0.5, fn: () => smoke(t) });
    }
  }

  _slash(a, i) {
    const { d, pw, sp, st } = a;
    const T = a.T.clone(); T.y = 0.22;
    const R = 0.42 + 0.1 * pw;
    const s = new THREE.Vector3().crossVectors(UP, d).normalize().multiplyScalar(i % 2 ? -a.side : a.side);
    const type = st.slash;
    const path = (k, out) => {
      const r = 1 - k;
      switch (type) {
        case 'stab': return out.copy(T).addScaledVector(d, -R * 1.4 * r);
        case 'spiral': {
          const th = k * Math.PI * 2.4;
          return out.copy(T).addScaledVector(s, Math.cos(th) * R * r).addScaledVector(d, -Math.sin(th) * R * r).setY(T.y + 0.25 * r);
        }
        case 'slam': return out.copy(T).addScaledVector(d, -0.35 * r).setY(T.y + 1.5 * r * r);
        case 'wave': return out.copy(T).addScaledVector(d, -R * 1.5 * r).addScaledVector(s, Math.sin(k * Math.PI * 2) * R * 0.45 * r);
        case 'whip': return out.copy(T).addScaledVector(d, -R * 1.6 * r).addScaledVector(s, Math.sin(k * Math.PI * 1.5) * R * 0.8 * Math.sqrt(r));
        default: {
          const th = r * Math.PI * 0.62;
          return out.copy(T).addScaledVector(s, Math.sin(th) * R).addScaledVector(d, -(1 - Math.cos(th)) * R);
        }
      }
    };
    const last = i === a.hits - 1;
    const dur = (type === 'spiral' ? 0.22 : type === 'slam' ? 0.16 : 0.13) / sp;
    const target = a.job.target;
    this.fx.fire(path(0, new THREE.Vector3()), T, a.list, {
      tier: a.job.tier, path, duration: dur, impactScale: pw * (last ? 1.2 : 0.8),
    }).then((P) => {
      const g = this.globals, amt = pw * (last ? 1.3 : 0.75);
      this._stateOf(target).kicks.push({
        t: 0, dur: 0.34, dir: d.clone(), amp: 0.09 * amt * g.knockback,
        yaw: (Math.random() - 0.5) * 0.5 * amt * g.knockback, tilt: 0.18 * amt * g.knockback,
      });
      this.onShake?.(0.025 * amt * g.shake);
      this.onHit?.(target, P, { hit: i, last, power: pw });
    });
  }

  dispose() { this.states.clear(); }
}
