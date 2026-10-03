// Powers — animations des 16 pouvoirs + effets d'état persistants, sur la base
// d'EnergyArrows. Remplaçant de three/PowerVfx.ts (qui reste la couche de
// composition : c'est elle qui résout un `Unit` en acteur de scène et appelle
// `cast()` — ce module-ci ne connaît que des acteurs et des cellules).
//
// Mêmes règles de design que l'original (session Claude Design, Powers.dc.html) :
//   1. la GRAMMAIRE distingue les pouvoirs (direction, silhouette, locus), la
//      teinte vient ensuite ;
//   2. la forme et la couleur appartiennent au pouvoir, la signature élémentaire
//      au lanceur (sauf Super attaque et Attaque massive, indexées sur le tier) ;
//   3. tout se lit à PLAT (caméra zénithale) : anneaux, disques, trajets au sol.
// Les pouvoirs qui posent un état installent une boucle persistante sur l'unité
// (particules + calque CSS sur la carte) tant que `PowerVfx.syncPowerStatuses`
// (appelé chaque tick avec l'état RÉEL de l'unité) la maintient active.
//
// ⚠️ Différences délibérées avec la version démo (`Powers.dc.html`) : ce
// module ne DÉCIDE jamais rien que la simulation a déjà tranché — cf. « Le
// board est la source de vérité » (CLAUDE.md). Poussée, Gel, Téléportation,
// Invocation de token et Attaque Zone lisent donc leur résultat dans `extra`/
// les cibles déjà résolues, au lieu de recalculer une case libre ou un
// adversaire via des hooks `isFree`/`relocate`/`summon`/`opponents` — ces
// hooks n'existent plus ici. Le déplacement physique des unités reste où il a
// toujours été : `CombatAnimator3D` (Poussée/Gel) et `Scene3D.playLunge`/
// `playBlink` (Super Attaque au contact, Téléportation) sont les SEULS
// endroits qui écrivent une position d'acteur ; ce module ne fait que décorer
// autour, jamais en concurrence sur le même `obj.position`.
//
// Hooks attendus (posés par Scene3D) : posOf(u), cellPos(c, r), alive(u),
// opponents(u), allies(u), shake(a). Acteur : { obj, home, baseScale,
// dom: { card, flash }, col, row, tier, el, side, range, uid, setOpacity }.
import * as THREE from 'three';
import { ELEMENT_PRESETS, normalizeElement } from './EnergyArrows.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const rr = (r) => rand(r[0], r[1]);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const E = {
  out: (u) => 1 - (1 - u) ** 3,
  in: (u) => u * u * u,
  back: (u) => { const c = 1.7, k = u - 1; return 1 + (c + 1) * k * k * k + c * k * k; },
};
const TIER_AURA = { 1: '#5ad0a0', 2: '#6fb2dc', 3: '#9d74dc', 4: '#cba85a', 5: '#d86a7e' };
const TIER_K = { 1: 0.7, 2: 0.85, 3: 1, 4: 1.25, 5: 1.55 };

// Teintes de POWER_COLORS (l'ancien PowerVfx.ts), éclaircies pour le blending
// additif sur plateau sombre.
export const POWERS = [
  { id: 'POWER_HEAL', label: 'Soin', color: '#5fe0a0', target: 'ally' },
  { id: 'POWER_PUSH', label: 'Poussée', color: '#f0b060', target: 'enemy' },
  { id: 'POWER_SUPER_ATTACK', label: 'Super attaque', color: '#ffd060', target: 'enemy', elemental: true },
  { id: 'POWER_AOE_ATTACK', label: 'Attaque massive', color: '#ff8a3c', target: 'self', elemental: true },
  { id: 'POWER_BURN', label: 'Brûlure', color: '#ff6a2a', target: 'enemy', status: 'burn' },
  { id: 'POWER_POISON', label: 'Poison', color: '#9de87a', target: 'enemy', status: 'poison' },
  { id: 'POWER_FREEZE', label: 'Gel', color: '#8fd6ff', target: 'enemy' },
  { id: 'POWER_PARALYSIS', label: 'Paralysie', color: '#ffe066', target: 'enemy', status: 'paralysis' },
  { id: 'POWER_DEBUFF', label: 'Silence', color: '#c4c8d6', target: 'enemy' },
  { id: 'POWER_BLOCK', label: 'Blocage', color: '#9aa6ff', target: 'enemy', status: 'block' },
  { id: 'POWER_TAUNT', label: 'Provocation', color: '#ff5a44', target: 'self', status: 'taunt' },
  { id: 'POWER_TELEPORT', label: 'Téléportation', color: '#b070ff', target: 'self' },
  { id: 'POWER_SUMMON_TOKEN', label: 'Invocation', color: '#40e8c0', target: 'self' },
  { id: 'POWER_SHIELD', label: 'Bouclier', color: '#8fd0ff', target: 'self', status: 'shield' },
  { id: 'POWER_WEAKEN', label: 'Affaiblissement', color: '#c08a5e', target: 'enemy', status: 'weaken' },
  { id: 'POWER_CONFUSION', label: 'Confusion', color: '#d08aff', target: 'enemy', status: 'confusion' },
];
const PC = Object.fromEntries(POWERS.map((p) => [p.id, p.color]));

// Habillage visuel des huit statuts persistants. La DURÉE réelle n'est jamais
// lue ici : `PowerVfx.syncPowerStatuses` pose/retire ces clés depuis les
// champs `Unit` (paralysis_remaining, etc.), tick par tick — ce module ne fait
// que rejouer l'entrée/sortie sur l'overlay et la boucle de particules tant
// qu'elle est présente dans `this.status`.
export const STATUS = {
  burn: { color: '#ff6a2a',
    overlay: 'box-shadow:inset 0 0 14px 2px rgba(255,90,40,.8);background:linear-gradient(0deg, rgba(255,90,30,.38), transparent 62%)',
    ov: [{ opacity: 0.65 }, { opacity: 1 }, { opacity: 0.75 }, { opacity: 0.95 }, { opacity: 0.65 }], ovDur: 700 },
  poison: { color: '#9de87a',
    overlay: 'box-shadow:inset 0 0 12px 2px rgba(110,220,80,.7);background:radial-gradient(circle at 50% 70%, rgba(120,220,80,.3), rgba(120,50,150,.22) 70%, transparent)',
    ov: [{ opacity: 0.6 }, { opacity: 1 }, { opacity: 0.6 }], ovDur: 1600 },
  paralysis: { color: '#ffe066',
    overlay: 'box-shadow:inset 0 0 10px 2px rgba(245,210,40,.8);background:rgba(255,230,90,.1)',
    ov: [{ opacity: 1 }, { opacity: 0.4, offset: 0.1 }, { opacity: 1, offset: 0.14 }, { opacity: 0.8, offset: 0.6 }, { opacity: 0.3, offset: 0.64 }, { opacity: 1 }], ovDur: 900,
    card: [{ transform: 'translate(0,0)' }, { transform: 'translate(0,0)', offset: 0.7 }, { transform: 'translate(2px,-1px)', offset: 0.74 },
      { transform: 'translate(-2px,1px)', offset: 0.78 }, { transform: 'translate(1px,1px)', offset: 0.82 }, { transform: 'translate(0,0)', offset: 0.86 }, { transform: 'translate(0,0)' }], cardDur: 900 },
  block: { color: '#9aa6ff',
    overlay: 'box-shadow:inset 0 0 12px 2px rgba(110,122,200,.8);background:repeating-linear-gradient(45deg, rgba(120,132,220,.26) 0 3px, transparent 3px 9px)',
    ov: [{ opacity: 0.8 }, { opacity: 1 }, { opacity: 0.8 }], ovDur: 2000 },
  taunt: { color: '#ff5a44',
    overlay: 'box-shadow:inset 0 0 14px 3px rgba(255,88,55,.85)',
    ov: [{ opacity: 0.35 }, { opacity: 1, offset: 0.15 }, { opacity: 0.35 }], ovDur: 1100 },
  weaken: { color: '#c08a5e',
    overlay: 'background:linear-gradient(180deg, rgba(20,10,4,.1), rgba(40,20,8,.5));box-shadow:inset 0 0 10px 2px rgba(138,90,60,.7)',
    ov: [{ opacity: 1 }, { opacity: 1 }], ovDur: 1000,
    card: [{ transform: 'scale(.92)', filter: 'saturate(.45) brightness(.8)' }, { transform: 'scale(.92)', filter: 'saturate(.45) brightness(.8)' }], cardDur: 1000 },
  confusion: { color: '#d08aff',
    overlay: 'box-shadow:inset 0 0 12px 2px rgba(180,90,240,.75);background:rgba(160,64,200,.12)',
    ov: [{ opacity: 0.6 }, { opacity: 1 }, { opacity: 0.6 }], ovDur: 1400,
    card: [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(0deg)' }], cardDur: 1800 },
  shield: { color: '#8fd0ff',
    overlay: 'box-shadow:inset 0 0 0 1px rgba(200,235,255,.7), inset 0 0 14px 2px rgba(106,180,232,.7)',
    ov: [{ opacity: 0.7 }, { opacity: 1 }, { opacity: 0.7 }], ovDur: 2200 },
};

export const DEFAULT_POWER_GLOBALS = { speed: 1, power: 1, shake: 1 };

const PAL = {
  heal: ['#ffffff', '#c8ffe0', '#5fe0a0', '#2fae6e'],
  shield: ['#ffffff', '#e0f4ff', '#8fd0ff'],
  fire: ['#ffd27a', '#ff7a2e', '#ff3a12'],
  toxic: ['#d8ffb0', '#9de87a', '#5fc24a'],
  toxicDark: ['#3a1550', '#5a2a78', '#24401a'],
  ice: ['#ffffff', '#c8f4ff', '#7fdcff'],
  volt: ['#ffffff', '#fff59a', '#ffe066'],
  wind: ['#ffffff', '#ffe2b0', '#f0b060'],
  hush: ['#0c0d14', '#1a1c26', '#2a2d3a'],
  rune: ['#ffffff', '#c8ceff', '#9aa6ff', '#6e7ac8'],
  taunt: ['#ffd0c4', '#ff8a70', '#ff5a44'],
  warp: ['#f0e0ff', '#c89aff', '#b070ff', '#7a3cff'],
  summon: ['#eafffa', '#9af5dc', '#40e8c0'],
  weak: ['#6a4028', '#4a2a16', '#2a160c'],
  conf: ['#ffffff', '#ff9ae8', '#d08aff', '#a040c8'],
  dust: ['#6b5a44', '#8a765a', '#4a3e30'],
};

export class Powers {
  constructor(fx, hooks = {}) {
    this.fx = fx; this.h = hooks;
    this.anims = []; this.status = new Map(); this.time = 0;
    this.g = { ...DEFAULT_POWER_GLOBALS };
  }
  setGlobals(g) { Object.assign(this.g, g); }
  get activeCount() { return this.anims.length; }

  // ── outils ──────────────────────────────────────────────────────────────
  N(n) { return Math.max(1, Math.round(n * this.g.power * Math.max(0.35, this.fx.globals.particles))); }
  later(t, fn) { this.fx.timers.push({ t: t / this.g.speed, fn }); }
  anim(dur, fn) { return new Promise((res) => this.anims.push({ t: 0, dur: dur / this.g.speed, fn, res })); }
  shake(a) { this.h.shake?.(a * this.g.shake); }
  ring(p, c, r, d, o) { this.fx._ring(p, c, r, d / this.g.speed, o && o.delay ? { ...o, delay: o.delay / this.g.speed } : o); }
  flash(p, c, r, d, a = 1) { this.fx._flash(p, c, r, d / this.g.speed, a); }
  pool(b) { return b === 'normal' ? this.fx.pNorm : this.fx.pAdd; }
  sp(x, y, z, vx, vy, vz, life, s0, s1, c, a = 1, drag = 0, grav = 0, tw = false, blend = 'add') {
    this.pool(blend).spawn(x, y, z, vx, vy, vz, life, s0, s1, c, a, drag, grav, tw);
  }
  edge(p, h = 0.44) {
    const t = rand(-h, h), s = (Math.random() * 4) | 0;
    return s === 0 ? { x: p.x + t, z: p.z - h } : s === 1 ? { x: p.x + t, z: p.z + h } : s === 2 ? { x: p.x - h, z: p.z + t } : { x: p.x + h, z: p.z + t };
  }
  hexPt(p, r, i, rot) { const a = rot + (i * TAU) / 6; return { x: p.x + Math.cos(a) * r, y: p.y, z: p.z + Math.sin(a) * r }; }
  // particules montantes (vers la caméra) ; edge : partent du bord de la carte
  up(p, n, colors, { r = 0.4, edge = false, vy = [0.4, 1.2], out = 0.3, swirl = 0, life = [0.4, 0.8], size = [0.05, 0.1], sizeEnd = 0, drag = 1.5, grav = 0, blend = 'add', alpha = 1, tw = false } = {}) {
    for (let i = 0; i < n; i++) {
      let x, z;
      if (edge) ({ x, z } = this.edge(p, edge === true ? 0.44 : edge));
      else { const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * r; x = p.x + Math.cos(a) * d; z = p.z + Math.sin(a) * d; }
      const dx = x - p.x, dz = z - p.z, L = Math.hypot(dx, dz) || 1, c = dx / L, s = dz / L;
      this.sp(x, p.y + 0.02, z, c * out - s * swirl, rr(vy), s * out + c * swirl, rr(life), rr(size), sizeEnd, pick(colors), alpha, drag, grav, tw, blend);
    }
  }
  // particules aspirées vers le centre
  inward(p, n, colors, { R = 1.2, swirl = 0, life = [0.35, 0.5], size = [0.03, 0.06], sizeEnd = 0, blend = 'add', alpha = 1, tw = false } = {}) {
    for (let i = 0; i < n; i++) {
      const L = rr(life), a = Math.random() * TAU, c = Math.cos(a), s = Math.sin(a), d = R * rand(0.8, 1.1), v = d / L;
      this.sp(p.x + c * d, p.y + 0.04, p.z + s * d, (-c - s * swirl) * v, 0, (-s + c * swirl) * v, L, rr(size), sizeEnd, pick(colors), alpha, 0, 0, tw, blend);
    }
  }
  // trait statique pointillé
  line(a, b, colors, { step = 0.035, size = 0.04, life = 0.3, alpha = 1, blend = 'add', jitter = 0, tw = false } = {}) {
    const dx = b.x - a.x, dz = b.z - a.z, n = Math.max(2, Math.ceil(Math.hypot(dx, dz) / step));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      this.sp(a.x + dx * f + rand(-jitter, jitter), (a.y ?? 0.12) + 0.03, a.z + dz * f + rand(-jitter, jitter), 0, 0, 0, life * rand(0.85, 1.15), size, size * 0.5, pick(colors), alpha, 0, 0, tw, blend);
    }
  }
  hex(p, r, rot, colors, o) { for (let i = 0; i < 6; i++) this.line(this.hexPt(p, r, i, rot), this.hexPt(p, r, i + 1, rot), colors, o); }
  // particules qui voyagent de a à b
  travel(a, b, n, colors, { life = [0.25, 0.35], size = [0.03, 0.06], spread = 0.06, alpha = 1, blend = 'add', tw = false, stagger = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      const go = () => {
        const L = rr(life) / this.g.speed, ox = rand(-spread, spread), oz = rand(-spread, spread);
        this.sp(a.x + ox, (a.y ?? 0.12) + 0.03, a.z + oz, (b.x - a.x) / L, 0, (b.z - a.z) / L, L * 1.05, rr(size), rr(size) * 0.6, pick(colors), alpha, 0, 0, tw, blend);
      };
      if (stagger) this.later(i * stagger, go); else go();
    }
  }
  // trait mobile : chaîne de particules à même vitesse
  streak(p, dx, dz, speed, len, colors, size, life, alpha = 1) {
    for (let k = 0; k < 7; k++) {
      const b = -(k * len) / 7;
      this.sp(p.x + dx * b, p.y + 0.04, p.z + dz * b, dx * speed, 0, dz * speed, life, size * (1 - k / 9), 0, pick(colors), alpha * (1 - k / 8), 1.2, 0);
    }
  }
  dirOf(a, b) { const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1; return { x: dx / L, z: dz / L, L }; }

  // ── mouvements de carte ─────────────────────────────────────────────────
  // ⚠️ Réservés aux acteurs qu'AUCUN autre système n'anime en même temps
  // (cf. l'en-tête du fichier) : jamais sur la cible d'une Poussée/d'un Gel,
  // jamais sur le lanceur d'une Super Attaque au contact ou d'une
  // Téléportation, qui ont leur propre tween ailleurs.
  pose(u, { dx = 0, dz = 0, lift = 0, scale = 1 } = {}) {
    const o = u.obj; o.position.copy(u.home); o.position.x += dx; o.position.z += dz; o.position.y += lift;
    o.scale.setScalar(u.baseScale * scale);
  }
  nudge(u, d, amt = 0.12, dur = 0.3) {
    return this.anim(dur, (t) => { const f = Math.sin(t * Math.PI) * (1 - t * 0.4) * amt; this.pose(u, { dx: d.x * f, dz: d.z * f }); if (t >= 1) this.pose(u); });
  }
  pulseCard(u, s = 1.08, dur = 220) {
    u.dom?.card.animate([{ transform: 'scale(1)' }, { transform: `scale(${s})` }, { transform: 'scale(1)' }], { duration: dur / this.g.speed, easing: 'ease-out', composite: 'add' });
  }
  flashCard(u, color, dur = 360, a = 0.95) {
    if (!u.dom?.flash) return;
    u.dom.flash.style.background = `radial-gradient(circle at 50% 50%, ${color} 0%, transparent 75%)`;
    u.dom.flash.animate([{ opacity: a }, { opacity: 0 }], { duration: dur / this.g.speed, easing: 'ease-out' });
  }

  // ── résolution de cible (repli seulement — l'appelant fournit toujours une
  // cible explicite dans l'intégration réelle ; ce repli n'existe que pour ne
  // pas planter si `cast()` était un jour appelé sans, comme dans la démo) ──
  resolveTarget(id, caster, clicked) {
    const def = POWERS.find((p) => p.id === id);
    if (id === 'POWER_HEAL') {
      if (clicked && clicked.side === caster.side) return clicked;
      const al = this.h.allies?.(caster) || []; return al.reduce((a, b) => (b.hp < a.hp ? b : a), al[0] || caster);
    }
    if (def.target === 'self') return caster;
    if (clicked && clicked !== caster) return clicked;
    const op = this.h.opponents?.(caster) || []; return op.length ? pick(op) : null;
  }

  // ── point d'entrée ──────────────────────────────────────────────────────
  // `opt.extra` porte ce que la simulation a déjà décidé (montant poussé,
  // origine/destination d'une téléportation, liste des cibles d'une Attaque
  // Zone…) — cf. l'en-tête du fichier.
  cast(id, caster, target, opt = {}) {
    const el = [].concat(opt.el && opt.el.length ? opt.el : caster.el).map(normalizeElement);
    const tier = opt.tier || caster.tier;
    target = target || this.resolveTarget(id, caster, null);
    if (!target) return;
    const c = {
      id, caster, target, el, tier, k: TIER_K[tier] || 1, T: TIER_AURA[tier] || TIER_AURA[3],
      Ps: el.map((e) => this.fx.resolveParams(e, { tier })), from: this.h.posOf(caster), to: this.h.posOf(target),
      range: opt.range === 'melee' || opt.range === 'ranged' ? opt.range : (caster.range ?? 3) <= 1 ? 'melee' : 'ranged',
      color: PC[id], extra: opt.extra || {},
    };
    if (!POWERS.find((p) => p.id === id).elemental) this.accent(c);
    this.pulseCard(caster, 1.07);
    const fn = RECIPES[id];
    if (fn) fn.call(this, c);
  }

  // Signature élémentaire du lanceur, à budget réduit (règle hybride historique)
  accent(c) {
    for (const P of c.Ps) {
      const halo = P.haloColor.getStyle();
      this.ring(c.from, halo, 0.75, 0.3, { reverse: 1, width: 0.08, alpha: 0.8 });
      this.up(c.from, this.N(10), P.tp.colors, { edge: true, vy: [0.3, 0.9], out: 0.4, life: [0.3, 0.55], size: [0.04, 0.08], blend: P.tp.blend || 'add', alpha: P.tp.alpha ?? 1 });
    }
    this.ring(c.from, c.color, 0.9, 0.35, { width: 0.04, delay: 0.05 });
  }

  // Couches de rareté (même grammaire que l'apparition d'unité par tier)
  tierLayers(p, tier, T) {
    this.ring(p, T, 0.6 + 0.2 * tier, 0.45 + 0.05 * tier, { width: 0.03 + 0.01 * tier });
    if (tier >= 3) this.ring(p, T, 0.9 + 0.25 * tier, 0.6, { width: 0.025, delay: 0.1, alpha: 0.8 });
    if (tier >= 4) {
      this.flash(p, T, 1 + 0.25 * tier, 0.4, 0.45);
      this.fx._burst(p, this.N(14 * (tier - 3)), { colors: [T, '#ffffff'], speed: [1.6, 3.4], life: [0.4, 0.8], size: [0.03, 0.06], drag: 2.4, twinkle: true });
    }
    if (tier >= 5) { this.flash(p, '#ffffff', 1.2, 0.16); this.later(0.16, () => this.ring(p, T, 2.8, 0.7, { width: 0.05 })); }
  }
  fizzle(p) {
    this.fx._burst(p, this.N(12), { colors: ['#8a8fa4', '#c4c8d6'], speed: [0.4, 1], life: [0.3, 0.5], size: [0.04, 0.07], drag: 3 });
    this.ring(p, '#8a8fa4', 0.6, 0.3, { reverse: 1, width: 0.05 });
  }

  // Déflexion d'immunité — une seule recette pour les sept pouvoirs qui
  // peuvent la rendre (`effect_immunity`) : AUCUN effet du pouvoir, jouer sa
  // recette complète sur une cible immunisée la rendrait indiscernable d'un
  // effet qui a pris.
  deflect(u) {
    const p = this.h.posOf(u);
    this.ring(p, '#ffe9a8', 0.86, 0.5, { width: 0.05 });
    this.ring(p, '#fff6df', 0.6, 0.32, { width: 0.03, delay: 0.05, alpha: 0.8 });
    this.flash(p, '#ffe9a8', 0.9, 0.28, 0.55);
    this.fx._burst(p, this.N(14), { colors: ['#ffe9a8', '#ffffff'], speed: [0.5, 1.1], life: [0.28, 0.5], size: [0.04, 0.08], drag: 3 });
  }

  // Pulse de dégâts sur la durée (poison/brûlure) — rejoué à CHAQUE tick réel
  // (l'événement `dot`), en plus de la respiration périodique de la boucle
  // persistante (`_tickStatus`, indépendante) : c'est ce qui garde le dégât
  // visible exactement quand il tombe, même quand la boucle en est loin dans
  // son propre cycle.
  pulseBurn(u) {
    const p = this.h.posOf(u);
    this.up(p, this.N(16), PAL.fire, { r: 0.3, vy: [1, 2], out: 0.5, life: [0.3, 0.55], size: [0.07, 0.14], sizeEnd: 0.02 });
    this.ring(p, '#ff7a2e', 0.75, 0.4, { width: 0.08 });
  }
  pulsePoison(u) {
    const p = this.h.posOf(u);
    this.ring(p, '#9de87a', 0.65, 0.4, { width: 0.06 });
    this.fx._burst(p, this.N(10), { colors: PAL.toxic, speed: [0.6, 1.3], life: [0.3, 0.5], size: [0.04, 0.07], drag: 3 });
  }

  // ── états persistants ───────────────────────────────────────────────────
  // ⚠️ Le cycle de vie (quand un statut apparaît/disparaît) est décidé par
  // `PowerVfx.syncPowerStatuses`, depuis les champs `Unit` — jamais ici. Ce
  // module se contente d'installer/retirer l'overlay et la boucle de
  // particules quand on le lui demande, idempotent dans les deux sens.
  setStatus(u, key) {
    let m = this.status.get(u);
    if (!m) { m = new Map(); this.status.set(u, m); }
    if (m.has(key)) return;
    const def = STATUS[key];
    const s = { key, t: 0, acc: {}, next: 0.2, ph: Math.random() * TAU, anims: [] };
    const host = u.dom?.card.firstElementChild;
    if (host) {
      s.el = document.createElement('div');
      s.el.style.cssText = `position:absolute;inset:0;border-radius:11px;pointer-events:none;opacity:0;${def.overlay}`;
      host.appendChild(s.el);
      s.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 }).onfinish = () => {
        if (s.el.isConnected) s.anims.push(s.el.animate(def.ov, { duration: def.ovDur, iterations: Infinity, easing: 'ease-in-out' }));
      };
      s.el.style.opacity = '1';
      if (def.card) s.anims.push(u.dom.card.animate(def.card, { duration: def.cardDur, iterations: Infinity, easing: 'ease-in-out', composite: 'add' }));
    }
    m.set(key, s);
  }
  statusesOf(u) { return [...(this.status.get(u)?.keys() || [])]; }
  clearStatus(u, key) {
    const m = this.status.get(u); if (!m) return;
    for (const k of key ? [key] : [...m.keys()]) {
      const s = m.get(k); if (!s) continue;
      s.anims.forEach((a) => a.cancel());
      if (s.el) { const el = s.el; el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350 }).onfinish = () => el.remove(); el.style.opacity = '0'; }
      m.delete(k);
    }
    if (!m.size) this.status.delete(u);
  }
  // Entrée/sortie idempotente, pilotée par la vérité — cf. `PowerVfx.syncPowerStatuses`.
  setStatusActive(u, key, active) { if (active) this.setStatus(u, key); else this.clearStatus(u, key); }
  clearAll() { for (const u of [...this.status.keys()]) this.clearStatus(u); }
  forget(u) { this.clearStatus(u); }

  stream(s, key, rate, dt, fn) {
    s.acc[key] = (s.acc[key] || 0) + rate * Math.sqrt(this.g.power) * dt;
    while (s.acc[key] >= 1) { s.acc[key] -= 1; fn(); }
  }
  every(s, key, period, dt, fn) {
    s.acc[key] = (s.acc[key] ?? period * 0.6) + dt;
    if (s.acc[key] >= period) { s.acc[key] = 0; fn(); }
  }

  _tickStatus(u, s, dt) {
    const p = this.h.posOf(u), T = this.time;
    switch (s.key) {
      case 'burn':
        this.stream(s, 'e', 26, dt, () => this.up(p, 1, PAL.fire, { edge: true, vy: [0.5, 1.3], out: 0.35, life: [0.35, 0.7], size: [0.05, 0.11], sizeEnd: 0.01 }));
        this.stream(s, 's', 4, dt, () => this.up(p, 1, ['#3a1a10', '#221008'], { edge: 0.36, vy: [0.3, 0.7], out: 0.3, life: [0.7, 1.1], size: [0.14, 0.22], sizeEnd: 0.36, blend: 'normal', alpha: 0.3 }));
        this.every(s, 'pulse', 1.8, dt, () => {
          this.up(p, this.N(16), PAL.fire, { r: 0.3, vy: [1, 2], out: 0.5, life: [0.3, 0.55], size: [0.07, 0.14], sizeEnd: 0.02 });
          this.ring(p, '#ff7a2e', 0.75, 0.4, { width: 0.08 });
        });
        break;
      case 'poison':
        this.stream(s, 'b', 11, dt, () => this.up(p, 1, PAL.toxic, { r: 0.36, vy: [0.25, 0.6], out: 0.04, life: [0.6, 1], size: [0.025, 0.05], sizeEnd: 0.11, drag: 1, alpha: 0.9 }));
        this.stream(s, 'm', 5, dt, () => this.up(p, 1, ['#7a3a98', '#5a2a78'], { edge: 0.4, vy: [0.05, 0.2], out: 0.25, life: [1, 1.5], size: [0.16, 0.24], sizeEnd: 0.4, blend: 'normal', alpha: 0.28 }));
        this.every(s, 'pulse', 1.5, dt, () => {
          this.ring(p, '#9de87a', 0.65, 0.4, { width: 0.06 });
          this.fx._burst(p, this.N(10), { colors: PAL.toxic, speed: [0.6, 1.3], life: [0.3, 0.5], size: [0.04, 0.07], drag: 3 });
        });
        break;
      case 'paralysis':
        s.next -= dt;
        if (s.next <= 0) {
          s.next = rand(0.14, 0.45);
          const n = Math.random() < 0.3 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            const a = this.edge(p, 0.46), b = this.edge(p, 0.46);
            this.fx._bolt({ x: a.x, y: p.y, z: a.z }, { x: b.x, y: p.y, z: b.z }, 5, 0.18, PAL.volt, 0.035, 0.09);
          }
          if (Math.random() < 0.25) this.flash(p, '#ffe066', 0.55, 0.08, 0.35);
        }
        break;
      case 'block': {
        const rot = T * 0.7 + s.ph;
        for (let i = 0; i < 6; i++) { const q = this.hexPt(p, 0.64, i, rot); this.sp(q.x, p.y + 0.03, q.z, 0, 0, 0, 0.18, 0.075, 0.03, i % 2 ? '#9aa6ff' : '#e0e4ff', 1, 0, 0); }
        this.stream(s, 'r', 40, dt, () => {
          const i = (Math.random() * 6) | 0, f = Math.random(), a = this.hexPt(p, 0.64, i, rot), b = this.hexPt(p, 0.64, i + 1, rot);
          this.sp(a.x + (b.x - a.x) * f, p.y + 0.03, a.z + (b.z - a.z) * f, 0, 0, 0, 0.35, 0.03, 0.02, '#9aa6ff', 0.6, 0, 0);
        });
        break;
      }
      case 'confusion':
        for (let i = 0; i < 3; i++) {
          const a = s.ph + T * 3.4 + (i * TAU) / 3;
          this.sp(p.x + Math.cos(a) * 0.62, p.y + 0.05, p.z + Math.sin(a) * 0.62, 0, 0, 0, 0.24, 0.1, 0.02, PAL.conf[i + 1], 1, 0, 0);
        }
        this.stream(s, 'tw', 8, dt, () => this.up(p, 1, PAL.conf, { r: 0.7, vy: [0.1, 0.3], out: 0.1, life: [0.3, 0.6], size: [0.025, 0.045], tw: true }));
        break;
      case 'taunt':
        this.every(s, 'ping', 1.1, dt, () => { this.ring(p, '#ff5a44', 1.05, 0.6, { width: 0.05 }); this.ring(p, '#ffd0c4', 0.7, 0.35, { width: 0.03 }); });
        this.stream(s, 'e', 7, dt, () => this.up(p, 1, PAL.taunt, { edge: true, vy: [0.3, 0.8], out: 0.3, life: [0.4, 0.7], size: [0.03, 0.06] }));
        break;
      case 'weaken':
        this.stream(s, 'd', 9, dt, () => this.up(p, 1, PAL.weak, { edge: 0.42, vy: [0, 0.1], out: 0.22, life: [0.8, 1.2], size: [0.06, 0.1], sizeEnd: 0.18, blend: 'normal', alpha: 0.55, drag: 1 }));
        this.every(s, 'press', 1.6, dt, () => this.ring(p, '#c08a5e', 0.9, 0.5, { reverse: 1, width: 0.05, alpha: 0.7 }));
        break;
      case 'shield': {
        for (const off of [0, 0.5]) {
          const f = ((T * 0.3 + off + s.ph) % 1) * 6, i = Math.floor(f), a = this.hexPt(p, 0.66, i, s.ph), b = this.hexPt(p, 0.66, i + 1, s.ph), q = f - i;
          this.sp(a.x + (b.x - a.x) * q, p.y + 0.03, a.z + (b.z - a.z) * q, 0, 0, 0, 0.3, 0.06, 0.02, '#e0f4ff', 1, 0, 0);
        }
        this.every(s, 'sheen', 2.2, dt, () => this.hex(p, 0.66, s.ph, PAL.shield, { size: 0.03, life: 0.5, alpha: 0.45 }));
        break;
      }
    }
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i]; a.t += dt;
      const u = clamp01(a.t / a.dur);
      a.fn(u, dt);
      if (u >= 1) { this.anims.splice(i, 1); a.res(); }
    }
    for (const [u, m] of this.status) {
      if (!this.h.alive(u)) { this.clearStatus(u); continue; }
      for (const s of [...m.values()]) {
        s.t += dt;
        this._tickStatus(u, s, dt);
      }
    }
  }

  dispose() { this.clearAll(); this.anims = []; }
}

// ── Les 16 recettes ──────────────────────────────────────────────────────
const RECIPES = {
  // Soin — orbe lente qui se pose, spirale entrante puis gerbe montante et croix de lumière.
  POWER_HEAL(c) {
    const land = () => {
      const p = this.h.posOf(c.target);
      this.inward(p, this.N(40 * c.k), PAL.heal, { R: 1.3, swirl: 0.9, life: [0.3, 0.42], size: [0.04, 0.08], tw: true });
      this.ring(p, '#5fe0a0', 1.2, 0.34, { reverse: 1, width: 0.05 });
      this.later(0.3, () => {
        this.flash(p, '#5fe0a0', 1.15, 0.45, 0.6); this.flash(p, '#ffffff', 0.45, 0.2);
        this.ring(p, '#5fe0a0', 1.25, 0.55, { width: 0.05 }); this.ring(p, '#c8ffe0', 0.85, 0.5, { width: 0.03, delay: 0.1 });
        this.line({ x: p.x - 0.28, y: p.y, z: p.z }, { x: p.x + 0.28, y: p.y, z: p.z }, PAL.heal.slice(0, 3), { size: 0.06, life: 0.55 });
        this.line({ x: p.x, y: p.y, z: p.z - 0.28 }, { x: p.x, y: p.y, z: p.z + 0.28 }, PAL.heal.slice(0, 3), { size: 0.06, life: 0.55 });
        this.up(p, this.N(34 * c.k), PAL.heal, { r: 0.45, vy: [1.2, 2.4], out: 0.3, life: [0.6, 1.1], size: [0.05, 0.1], grav: -1, tw: true });
        this.flashCard(c.target, '#5fe0a0', 600);
      });
    };
    if (c.target !== c.caster) this.fx.fire(c.from, c.to, 'plante', { tier: 2, core: '#f4fff8', halo: '#5fe0a0', speed: 7, impactScale: 0.4, tp: { colors: PAL.heal.slice(0, 3) } }).then(land);
    else this.later(0.12, land);
  },

  // Poussée — rafale en cône, choc, glissade avec poussière sur chaque case
  // traversée. ⚠️ Le nombre de cases est celui déjà décidé par la simulation
  // (`c.extra.pushed`) : la case d'arrivée est déjà la position réelle de
  // `c.target`, dont le déplacement physique appartient à CombatAnimator3D.
  POWER_PUSH(c) {
    const d = this.dirOf(c.from, c.to), t = c.target;
    for (let i = 0; i < this.N(9); i++) {
      const a = Math.atan2(d.z, d.x) + rand(-0.32, 0.32), q = { x: c.from.x + rand(-0.2, 0.2), y: c.from.y, z: c.from.z + rand(-0.2, 0.2) };
      this.later(i * 0.018, () => this.streak(q, Math.cos(a), Math.sin(a), rand(8, 11), 0.35, PAL.wind, 0.045, d.L / 9 + 0.1, 0.9));
    }
    this.fx._burst(c.from, this.N(40), { colors: PAL.wind, speed: [4, 7.5], life: [0.25, 0.4], size: [0.03, 0.06], drag: 1.4, dir: d, cone: 0.7, y: 0.02 });
    this.later(d.L / 9, () => {
      const p = c.to;
      const n = Math.max(0, c.extra.pushed | 0);
      if (!n) {
        // Butée (bord, unité, glace) : compression au contact, rien qui parte
        // vers l'arrière. Pas de `nudge` ici : `CombatAnimator3D` rejoue quand
        // même un `animateUnitMove` vers la même case, un aller-retour de
        // pose concurrent se disputerait la position pour rien.
        this.ring(p, '#ffffff', 0.9, 0.3, { reverse: 1, width: 0.06 });
        this.fx._burst(p, this.N(30), { colors: PAL.wind, speed: [1, 2.4], life: [0.25, 0.4], size: [0.04, 0.07], drag: 3, dir: { x: -d.x, z: -d.z }, cone: 2.4 });
        this.flash(p, '#ffe2b0', 0.7, 0.2, 0.7);
        return;
      }
      this.ring(p, '#ffe2b0', 0.9, 0.3, { width: 0.06 });
      this.fx._burst(p, this.N(24), { colors: PAL.wind, speed: [2, 4], life: [0.25, 0.4], size: [0.03, 0.06], drag: 2, dir: d, cone: 1.2, y: 0.02 });
      // `t.col`/`t.row` sont déjà la case d'ARRIVÉE (la relocation a déjà eu
      // lieu) : on reconstruit les cases traversées en remontant vers l'origine.
      const dc = Math.sign(t.col - c.caster.col), dr = Math.sign(t.row - c.caster.row);
      const originCol = t.col - dc * n, originRow = t.row - dr * n;
      for (let i = 1; i <= n; i++) {
        const q = this.h.cellPos(originCol + dc * i, originRow + dr * i);
        this.later(0.04 * (n - i), () => {
          this.ring(q, '#8a765a', 0.6, 0.45, { width: 0.14, blend: 'normal', alpha: 0.6 });
          this.up(q, this.N(10), PAL.dust, { r: 0.35, vy: [0.1, 0.4], out: 0.6, life: [0.5, 0.8], size: [0.1, 0.16], sizeEnd: 0.26, blend: 'normal', alpha: 0.4, drag: 2 });
        });
      }
      this.shake(0.02);
    });
  },

  // Super attaque — charge élémentaire indexée sur le tier, puis frappe au
  // contact (mêlée) ou projectile surchargé (distance). ⚠️ Au contact, le
  // lanceur s'élance déjà via `Scene3D.playLunge` (appelé par PowerVfx AVANT
  // `cast()`) : cette recette ne doit alors JAMAIS poser le lanceur elle-même,
  // les deux tweens se disputeraient `obj.position`. Le frémissement de charge
  // (léger zoom + tremblé) reste réservé au tir à distance.
  POWER_SUPER_ATTACK(c) {
    const u = c.caster, charge = 0.42 + 0.07 * c.tier, acc = { v: 0 };
    const halos = c.Ps.map((P) => P.haloColor.getStyle()), cols = c.Ps.flatMap((P) => P.tp.colors).filter((x) => !/^#[0-3]/.test(x));
    this.ring(c.from, c.T, 1.2 + 0.1 * c.tier, charge, { reverse: 1, width: 0.04 });
    halos.forEach((h, i) => this.ring(c.from, h, 0.9, charge * 0.8, { reverse: 1, width: 0.07, delay: 0.06 * i }));
    if (c.range === 'ranged') this.line(c.from, c.to, [halos[0]], { step: 0.12, size: 0.03, life: charge + 0.1, alpha: 0.45 });
    this.anim(charge, (t, dt) => {
      acc.v += (70 + 20 * c.tier) * dt;
      while (acc.v >= 1) { acc.v--; this.inward(c.from, 1, [...cols, c.T, '#ffffff'], { R: 1.1 + 0.08 * c.tier, swirl: 0.6, life: [0.25, 0.35], size: [0.03, 0.06], tw: true }); }
      if (c.range !== 'melee') {
        const j = 0.02 * t * c.k;
        this.pose(u, { dx: rand(-j, j), dz: rand(-j, j), scale: 1 + 0.12 * E.out(t) });
      }
    }).then(() => {
      if (c.range !== 'melee') this.pose(u);
      const blast = () => {
        const p = c.to, d = this.dirOf(c.from, p);
        c.Ps.forEach((P, i) => this.later(i * 0.06, () => this.fx._impact(P, p, new THREE.Vector3(d.x, 0, d.z), 1.3 + 0.3 * c.tier)));
        this.flash(p, '#ffffff', 0.7, 0.14); this.ring(p, '#ffffff', 1.3, 0.3, { width: 0.04 });
        this.tierLayers(p, c.tier, c.T);
        this.shake(0.04 + 0.02 * c.tier);
        this.nudge(c.target, d, 0.12 + 0.03 * c.tier, 0.3);
        this.flashCard(c.target, halos[0]);
      };
      if (c.range === 'melee') {
        const p = c.to;
        for (const [ax, az] of [[1, 1], [1, -1]]) { const k = 0.5 / Math.SQRT2; this.line({ x: p.x - ax * k, y: p.y, z: p.z - az * k }, { x: p.x + ax * k, y: p.y, z: p.z + az * k }, ['#ffffff', c.T], { size: 0.06, life: 0.22 }); }
        blast();
      } else {
        this.flash(c.from, halos[0], 0.9, 0.2, 0.8);
        this.fx.fire(c.from, c.to, c.el, { tier: c.tier, size: ELEMENT_PRESETS[c.el[0]].size * 1.8, impactScale: 0.6, speed: ELEMENT_PRESETS[c.el[0]].speed * 1.25 }).then(blast);
      }
    });
  },

  // Attaque massive — le lanceur aspire son élément, puis une onde traverse le
  // board et frappe chaque ennemi quand son front l'atteint. ⚠️ La liste de
  // cibles vient de `c.extra.targets` (déjà filtrée des unités mourantes par
  // `PowerVfx`) et jamais d'une relecture du camp adverse à cet instant.
  POWER_AOE_ATTACK(c) {
    const u = c.caster, charge = 0.5 + 0.06 * c.tier, acc = { v: 0 };
    const halos = c.Ps.map((P) => P.haloColor.getStyle()), cols = c.Ps.flatMap((P) => P.tp.colors);
    for (let i = 0; i < 3; i++) this.ring(c.from, halos[i % halos.length], 1.8 - i * 0.4, charge, { reverse: 1, width: 0.05, delay: i * 0.08 });
    this.ring(c.from, c.T, 2.2, charge, { reverse: 1, width: 0.03, alpha: 0.7 });
    this.anim(charge, (t, dt) => {
      acc.v += (90 + 25 * c.tier) * dt;
      while (acc.v >= 1) { acc.v--; this.inward(c.from, 1, cols, { R: 1.9, swirl: 1.1, life: [0.3, 0.45], size: [0.04, 0.08] }); }
      this.pose(u, { scale: 1 + 0.15 * E.out(t), lift: 0.15 * t });
    }).then(() => {
      this.anim(0.25, (t) => { this.pose(u, { scale: 1.15 - 0.15 * E.out(t), lift: 0.15 * (1 - t) }); if (t >= 1) this.pose(u); });
      this.flash(c.from, halos[0], 1.8, 0.35, 0.8); this.flash(c.from, '#ffffff', 0.7, 0.15);
      this.shake(0.05 + 0.025 * c.tier);
      // ⚠️ L'onde part de la CIBLE et s'arrête au bord de la ZONE : c'est elle
      // qui dit au joueur jusqu'où le coup porte (caméra verticale → anneau plat).
      const z = Number(c.extra.zone ?? 1), at = c.to;
      this.flash(at, halos[0], 1.2 + 0.4 * z, 0.3, 0.7);
      const waves = 1 + (c.tier >= 3) + (c.tier >= 5), R = z + 0.6;
      for (let w = 0; w < waves; w++) {
        const h = halos[w % halos.length];
        this.ring(at, h, R, 0.95, { width: 0.03, delay: w * 0.14 });
        this.ring(at, w ? c.T : '#ffffff', R * 0.7, 0.7, { width: 0.02, delay: w * 0.14 + 0.03, alpha: 0.8 });
        this.later(w * 0.14, () => this.fx._burst(at, this.N(80 + 20 * c.tier), { colors: cols, speed: [2 + 2 * z, 3 + 3 * z], life: [0.5, 0.8], size: [0.05, 0.1], drag: 0.9, y: 0.02, blend: c.Ps[w % c.Ps.length].tp.blend || 'add', alpha: c.Ps[w % c.Ps.length].tp.alpha ?? 1 }));
      }
      this.tierLayers(c.from, c.tier, c.T);
      for (const e of c.extra.targets || []) {
        const p = this.h.posOf(e), d = this.dirOf(at, p);
        this.later(0.04 + d.L / 10, () => {
          if (!this.h.alive(e)) return;
          this.fx._impact(c.Ps[0], p, new THREE.Vector3(d.x, 0, d.z), 0.7 + 0.15 * c.tier);
          if (c.Ps[1]) this.later(0.06, () => this.fx._impact(c.Ps[1], p, new THREE.Vector3(d.x, 0, d.z), 0.5 + 0.1 * c.tier));
          this.nudge(e, d, 0.08 + 0.02 * c.tier, 0.26);
          this.flashCard(e, halos[0], 300);
        });
      }
    });
  },

  // Brûlure — une braise lobée, puis la cible s'embrase en couronne de flammes.
  POWER_BURN(c) {
    this.fx.fire(c.from, c.to, 'feu', { tier: 2, size: 0.12, speed: 9, impactScale: 0.5 }).then(() => {
      const p = this.h.posOf(c.target);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU, q = { x: p.x + Math.cos(a) * 0.55, y: p.y, z: p.z + Math.sin(a) * 0.55 };
        this.later(i * 0.012, () => this.up(q, this.N(4), PAL.fire, { r: 0.06, vy: [0.8, 1.8], out: 0.5, life: [0.35, 0.65], size: [0.07, 0.14], sizeEnd: 0.02 }));
      }
      this.up(p, this.N(30), PAL.fire, { r: 0.3, vy: [1, 2.2], out: 0.6, life: [0.3, 0.6], size: [0.08, 0.16], sizeEnd: 0.02 });
      this.up(p, this.N(10), ['#3a1a10', '#221008'], { r: 0.4, vy: [0.4, 0.9], out: 0.4, life: [0.8, 1.2], size: [0.18, 0.28], sizeEnd: 0.45, blend: 'normal', alpha: 0.35 });
      this.flash(p, '#ff6a2a', 1.1, 0.35, 0.8); this.ring(p, '#ffd27a', 1.1, 0.45, { width: 0.1 });
      this.flashCard(c.target, '#ff6a2a');
      this.setStatus(c.target, 'burn');
    });
  },

  // Poison — un globe lobé qui éclate en flaque : gouttes sombres, éclaboussure
  // verte, nappe violette qui traîne.
  POWER_POISON(c) {
    this.fx.fire(c.from, c.to, 'eau', { tier: 2, core: '#f0ffd8', halo: '#8fdc5a', size: 0.15, speed: 7.5, impactScale: 0.35, tp: { colors: ['#d8ffb0', '#8fdc5a', '#c878e0'] } }).then(() => {
      const p = this.h.posOf(c.target);
      this.fx._burst(p, this.N(24), { colors: PAL.toxicDark, speed: [1, 2.4], life: [0.5, 0.9], size: [0.07, 0.14], sizeEnd: 0.1, drag: 4, blend: 'normal', alpha: 0.8 });
      this.fx._burst(p, this.N(30), { colors: PAL.toxic, speed: [1.4, 3], life: [0.3, 0.55], size: [0.04, 0.07], drag: 3.5 });
      this.flash(p, '#8fdc5a', 0.95, 1.2, 0.35); this.ring(p, '#c878e0', 1.05, 0.5, { width: 0.06 }); this.ring(p, '#9de87a', 0.75, 1.1, { width: 0.04, delay: 0.1 });
      this.up(p, this.N(24), ['#c878e0', '#7a3a98'], { r: 0.5, vy: [0.1, 0.3], out: 0.35, life: [1, 1.6], size: [0.18, 0.3], sizeEnd: 0.5, blend: 'normal', alpha: 0.32 });
      this.flashCard(c.target, '#9de87a');
      this.setStatus(c.target, 'poison');
    });
  },

  // Gel — trait de givre puis éclat sur la cible. ⚠️ La cible a DÉJÀ reculé
  // d'une case et la case qu'elle a quittée est déjà gelée par `Scene3D`
  // (`addTemporaryBlockedCell`, sur l'événement `freeze` séparé) : cette
  // recette ne fait que décorer l'impact, elle ne relocalise rien.
  POWER_FREEZE(c) {
    this.fx.fire(c.from, c.to, 'glace', { tier: Math.max(3, c.tier), impactScale: 1.1 }).then(() => {
      const p = c.to;
      this.flash(p, '#ffffff', 0.7, 0.16); this.ring(p, '#c8f4ff', 1, 0.45, { width: 0.05 });
      this.fx._burst(p, this.N(26), { colors: PAL.ice, speed: [0.5, 1.4], life: [0.5, 0.9], size: [0.03, 0.06], twinkle: true });
      this.flashCard(c.target, '#8fd6ff');
    });
  },

  // Paralysie — triple décharge du lanceur, puis des arcs qui se referment du
  // pourtour vers la carte (constriction) et un anneau rentrant.
  POWER_PARALYSIS(c) {
    const strike = () => this.fx._bolt(c.from, c.to, 9, 0.12, PAL.volt, 0.045, 0.14);
    strike(); this.later(0.07, strike); this.later(0.14, strike);
    this.flash(c.from, '#ffe066', 0.6, 0.15, 0.6);
    this.later(0.12, () => {
      const p = this.h.posOf(c.target), rot = Math.random() * TAU;
      for (let i = 0; i < 8; i++) {
        const a = rot + (i / 8) * TAU;
        this.later(i * 0.02, () => this.fx._bolt({ x: p.x + Math.cos(a) * 0.95, y: p.y, z: p.z + Math.sin(a) * 0.95 }, p, 6, 0.2, PAL.volt, 0.035, 0.26));
      }
      this.ring(p, '#ffe066', 1.1, 0.4, { reverse: 1, width: 0.05 });
      this.flash(p, '#ffffff', 0.6, 0.12); this.flash(p, '#ffe066', 1, 0.28, 0.5);
      this.fx._burst(p, this.N(22), { colors: PAL.volt, speed: [0.8, 2], life: [0.15, 0.3], size: [0.03, 0.05], drag: 4, twinkle: true });
      this.flashCard(c.target, '#ffe066');
      this.setStatus(c.target, 'paralysis');
    });
  },

  // Silence (Débuff) — la seule recette sans lumière : un fil pâle, puis une
  // implosion sombre qui ARRACHE chaque état de la cible.
  POWER_DEBUFF(c) {
    this.travel(c.from, c.to, this.N(26), ['#e8eaf2', '#b8bccb'], { life: [0.28, 0.32], size: [0.03, 0.05], spread: 0.03, stagger: 0.006 });
    this.later(0.3, () => {
      const p = this.h.posOf(c.target), t = c.target;
      this.inward(p, this.N(46), PAL.hush, { R: 1.3, life: [0.32, 0.42], size: [0.1, 0.18], blend: 'normal', alpha: 0.8 });
      this.ring(p, '#e8eaf2', 1.15, 0.38, { reverse: 1, width: 0.03 });
      this.later(0.36, () => {
        this.ring(p, '#0c0d14', 1, 0.7, { fill: 1, blend: 'normal', alpha: 0.75 });
        this.ring(p, '#c4c8d6', 1.3, 0.55, { width: 0.02 });
        for (const k of this.statusesOf(t)) {
          const col = STATUS[k].color;
          this.fx._burst(p, this.N(16), { colors: [col, '#ffffff'], speed: [2, 3.6], life: [0.3, 0.5], size: [0.04, 0.07], drag: 3 });
          this.ring(p, col, 0.8, 0.3, { width: 0.05 });
          this.clearStatus(t, k);
        }
        t.dom?.card.animate([{ filter: 'grayscale(1) brightness(.55)' }, { filter: 'grayscale(1) brightness(.55)', offset: 0.4 }, { filter: 'none' }], { duration: 1100 / this.g.speed, composite: 'add' });
      });
    });
  },

  // Blocage — une chaîne runique, trois cercles qui se referment, six glyphes
  // qui se verrouillent en sceau hexagonal.
  POWER_BLOCK(c) {
    this.line(c.from, c.to, ['#9aa6ff', '#6e7ac8'], { step: 0.05, size: 0.035, life: 0.4 });
    this.travel(c.from, c.to, this.N(10), ['#ffffff', '#c8ceff'], { life: [0.18, 0.22], size: [0.05, 0.07], spread: 0.01, stagger: 0.02 });
    this.later(0.16, () => {
      const p = this.h.posOf(c.target), rot = Math.random() * TAU;
      [1.4, 1, 0.7].forEach((r, i) => this.ring(p, i === 1 ? '#ffffff' : '#9aa6ff', r, 0.3, { reverse: 1, width: 0.04, delay: i * 0.07 }));
      for (let i = 0; i < 6; i++) this.travel(this.hexPt(p, 1.3, i, rot + 0.6), this.hexPt(p, 0.64, i, rot), 3, PAL.rune, { life: [0.3, 0.32], size: [0.06, 0.08], spread: 0.01 });
      this.later(0.32, () => {
        this.flash(p, '#9aa6ff', 0.85, 0.22, 0.8); this.ring(p, '#ffffff', 0.75, 0.25, { width: 0.03 });
        this.hex(p, 0.64, rot, PAL.rune, { size: 0.045, life: 0.6 });
        this.flashCard(c.target, '#9aa6ff');
        this.pulseCard(c.target, 0.93, 200);
        this.shake(0.01);
        this.setStatus(c.target, 'block');
      });
    });
  },

  // Provocation — cri en trois anneaux, puis un flux DEPUIS chaque ennemi vers
  // le lanceur (« ils me regardent tous »).
  POWER_TAUNT(c) {
    const p = c.from;
    // Le dernier anneau s'arrête au bord de la ZONE : seuls les ennemis dedans
    // sont provoqués, et c'est d'eux seuls que part le flux.
    const z = Number(c.extra.zone ?? 2);
    [0, 0.12, 0.24].forEach((d, i) => this.ring(p, '#ff5a44', (z + 0.6) * (0.5 + i * 0.25), 0.55, { width: 0.05, delay: d }));
    this.flash(p, '#ff5a44', 1.1, 0.35, 0.6);
    this.pulseCard(c.caster, 1.14, 300);
    for (const e of c.extra.provoked || []) {
      const q = this.h.posOf(e), d = this.dirOf(q, p);
      this.later(0.12 + Math.random() * 0.1, () => {
        this.travel(q, p, this.N(12), PAL.taunt, { life: [0.4, 0.5], size: [0.035, 0.06], spread: 0.04, stagger: 0.015 });
        this.ring(q, '#ff5a44', 0.6, 0.3, { width: 0.06 });
        this.flashCard(e, '#ff5a44', 300, 0.6);
      });
    }
    this.setStatus(c.caster, 'taunt');
  },

  // Téléportation — implosion au départ, rémanent, jaillissement à l'arrivée.
  // ⚠️ Le lanceur DISPARAÎT et RÉAPPARAÎT via `Scene3D.playBlink` (déclenché
  // par l'événement `move` séparé) : cette recette ne touche ni sa position ni
  // son opacité, elle ne fait que décorer les deux cellules. `c.extra.from`/
  // `c.extra.to` sont ceux que la simulation a choisis.
  POWER_TELEPORT(c) {
    const from = c.extra.from ? this.h.cellPos(c.extra.from.col, c.extra.from.row) : c.from;
    const to = c.extra.to ? this.h.cellPos(c.extra.to.col, c.extra.to.row) : null;
    if (!to) return this.fizzle(from);
    this.inward(from, this.N(26), PAL.warp, { R: 1.3, swirl: 0.8, life: [0.24, 0.3], size: [0.04, 0.07] });
    this.ring(from, '#b070ff', 1.2, 0.3, { reverse: 1, width: 0.05 });
    this.later(0.24, () => {
      this.flash(from, '#b070ff', 0.7, 0.2, 0.6);
      this.line(from, to, PAL.warp, { step: 0.05, size: 0.04, life: 0.35, alpha: 0.7 });
      this.travel(from, to, this.N(10), ['#ffffff', '#c89aff'], { life: [0.1, 0.12], size: [0.06, 0.08], spread: 0.02 });
      this.later(0.1, () => {
        this.fx._burst(to, this.N(30), { colors: PAL.warp, speed: [1.4, 3], life: [0.3, 0.5], size: [0.04, 0.07], drag: 3 });
        this.ring(to, '#b070ff', 1.1, 0.4, { width: 0.05 }); this.flash(to, '#b070ff', 1.1, 0.3, 0.8); this.flash(to, '#ffffff', 0.45, 0.14);
      });
    });
  },

  // Invocation de token — un fil d'énergie vers la case du token, un cercle
  // d'appel, un jaillissement. ⚠️ Le token existe déjà (`c.target` EST son
  // acteur, posé par `Scene3D.spawnUnit` avant l'appel) : rien à invoquer ici.
  POWER_SUMMON_TOKEN(c) {
    const to = c.to;
    this.travel(c.from, to, this.N(18), PAL.summon, { life: [0.26, 0.3], size: [0.04, 0.06], spread: 0.05, stagger: 0.008 });
    this.later(0.2, () => {
      this.ring(to, '#40e8c0', 0.95, 0.55, { reverse: 1, width: 0.04 });
      this.hex(to, 0.55, Math.PI / 6, PAL.summon, { size: 0.035, life: 0.7, alpha: 0.8 });
      this.flash(to, '#40e8c0', 0.8, 0.5, 0.35);
    });
  },

  // Bouclier — six plaques convergent et se soudent en hexagone autour du
  // lanceur, éclat, onde.
  POWER_SHIELD(c) {
    const p = c.from, rot = Math.PI / 6;
    for (let i = 0; i < 6; i++) this.travel(this.hexPt(p, 1.6, i, rot), this.hexPt(p, 0.66, i, rot), 5, PAL.shield, { life: [0.22, 0.24], size: [0.05, 0.08], spread: 0.03 });
    this.later(0.22, () => {
      this.hex(p, 0.66, rot, PAL.shield, { size: 0.05, life: 0.9 });
      this.hex(p, 0.42, rot + Math.PI / 6, ['#8fd0ff'], { size: 0.03, life: 0.6, alpha: 0.7 });
      this.flash(p, '#8fd0ff', 1, 0.35, 0.55); this.ring(p, '#ffffff', 0.9, 0.3, { width: 0.04 }); this.ring(p, '#8fd0ff', 1.35, 0.6, { width: 0.05, delay: 0.08 });
      this.flashCard(c.caster, '#8fd0ff');
      this.shake(0.01);
      this.setStatus(c.caster, 'shield');
    });
  },

  // Affaiblissement — un flux terne, puis une pression qui écrase la carte
  // (anneaux rentrants, motes sombres).
  POWER_WEAKEN(c) {
    this.travel(c.from, c.to, this.N(18), ['#c08a5e', '#8a5a3c'], { life: [0.28, 0.32], size: [0.04, 0.06], spread: 0.05, stagger: 0.01 });
    this.later(0.28, () => {
      const p = this.h.posOf(c.target);
      [1.4, 1.05, 0.75].forEach((r, i) => this.ring(p, '#c08a5e', r, 0.32, { reverse: 1, width: 0.05, delay: i * 0.08, alpha: 0.9 }));
      this.inward(p, this.N(36), PAL.weak, { R: 1.2, life: [0.35, 0.45], size: [0.08, 0.14], blend: 'normal', alpha: 0.7 });
      this.later(0.34, () => {
        for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + rand(-0.3, 0.3); this.fx._bolt(p, { x: p.x + Math.cos(a) * 0.5, y: p.y, z: p.z + Math.sin(a) * 0.5 }, 4, 0.2, ['#c08a5e', '#8a5a3c'], 0.03, 0.4); }
        this.ring(p, '#2a160c', 0.9, 0.5, { fill: 1, blend: 'normal', alpha: 0.5 });
        c.target.dom?.card.animate([{ transform: 'scale(1)' }, { transform: 'scale(.84)' }, { transform: 'scale(1)' }], { duration: 380 / this.g.speed, easing: 'ease-out', composite: 'add' });
        this.shake(0.015);
        this.setStatus(c.target, 'weaken');
      });
    });
  },

  // Confusion — un projectile qui zigzague en hélice, tourbillon à l'impact,
  // puis l'orbite persistante (trois étoiles).
  POWER_CONFUSION(c) {
    const a = c.from.clone(), b = c.to.clone(), d = this.dirOf(a, b), n = { x: -d.z, z: d.x };
    const path = (k, out) => {
      const w = Math.sin(k * TAU * 2) * 0.4 * Math.sin(k * Math.PI);
      out.set(a.x + (b.x - a.x) * k + n.x * w, a.y + 0.05, a.z + (b.z - a.z) * k + n.z * w);
    };
    this.fx.fire(a, b, 'air', { tier: 2, core: '#ffffff', halo: '#d08aff', path, duration: d.L / 6, impactScale: 0.4, tp: { colors: PAL.conf.slice(0, 3) } }).then(() => {
      const p = this.h.posOf(c.target);
      this.fx._swirl(p, this.N(40), 1.3, PAL.conf);
      this.ring(p, '#d08aff', 1, 0.4, { width: 0.05 }); this.flash(p, '#d08aff', 0.85, 0.25, 0.7);
      this.flashCard(c.target, '#d08aff');
      this.setStatus(c.target, 'confusion');
    });
  },
};
