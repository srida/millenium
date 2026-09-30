// Tornade vue du dessus pour DuelIntro. Un seul rAF peint le canvas ET
// anime les éléments DOM (refs) : aucune désynchro possible entre le flash
// et l'arrivée des avatars/du titre.
export const DUEL_VORTEX_END = 3.4; // s
const PARTICLES = 950;

export interface VortexRefs {
  overlay: HTMLElement; canvas: HTMLCanvasElement;
  title: HTMLElement; rule: HTMLElement; vs: HTMLElement;
  avP: HTMLElement; avE: HTMLElement; nameP: HTMLElement; nameE: HTMLElement;
}

const cl = (x: number) => Math.max(0, Math.min(1, x));
const sm = (x: number) => x * x * (3 - 2 * x);
const eo = (x: number) => 1 - Math.pow(1 - x, 3);
const eox = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const eio = (x: number) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function spinAt(t: number) {
  const w0 = 4.6, w1 = 0.8, a = 1.3, b = 2.1;
  if (t < a) return w0 * t;
  const dt = Math.min(t, b) - a;
  let v = w0 * a + w0 * dt + (w1 - w0) * dt * dt / (2 * (b - a));
  if (t > b) v += w1 * (t - b);
  return v;
}

type P = { a: number; ph: number; sp: number; len: number; w: number; al: number; c: string };
function makeParticles(n: number): P[] {
  // Déterministe : même motif à chaque partie.
  const cols = ['rgb(138,90,48)', 'rgb(168,112,58)', 'rgb(90,52,24)', 'rgb(212,175,97)', 'rgb(110,64,30)'];
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, () => ({
    a: rnd() * Math.PI * 2, ph: rnd(), sp: 0.16 + rnd() * 0.22, len: 0.025 + rnd() * 0.06,
    w: 0.5 + rnd() * 1.8, al: 0.18 + rnd() * 0.5, c: cols[Math.floor(Math.pow(rnd(), 1.4) * cols.length)],
  }));
}

export function startDuelVortex(r: VortexRefs, opts: { reduced: boolean }) {
  const ctx = r.canvas.getContext('2d')!;
  const parts = makeParticles(PARTICLES);
  let dpr = 1, cssU = 600, raf = 0;

  const resize = () => {
    const b = r.overlay.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    r.canvas.width = Math.max(1, Math.round(b.width * dpr));
    r.canvas.height = Math.max(1, Math.round(b.height * dpr));
    cssU = Math.min(b.width, b.height);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(r.overlay);

  const draw = (t: number) => {
    const seg = (a: number, b: number) => cl((t - a) / (b - a));
    const bump = (a: number, p: number, b: number) => (t < a || t > b ? 0 : t < p ? sm((t - a) / (p - a)) : 1 - sm((t - p) / (b - p)));
    const W = r.canvas.width, H = r.canvas.height;
    const u = Math.min(W, H), cx = W / 2, cy = H / 2 + u * 0.04, R = Math.hypot(W, H) * 0.58;
    const I = sm(seg(0, 0.45));
    const spin = spinAt(t);
    const gather = 1 + 1.2 * Math.pow(1 - sm(seg(0, 1.45)), 2);
    const eye = u * (0.03 + 0.075 * eo(seg(0.2, 1.45))) * (1 + 0.4 * bump(1.42, 1.5, 1.95));
    const spiral = (a0: number, rr: number) => a0 + 1.45 * Math.log(R / Math.max(rr, 1)) + spin * (1 + 0.8 * (1 - Math.min(rr / R, 1)));

    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#040100'; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, u * 0.8);
    g.addColorStop(0, `rgba(80,38,12,${0.6 * I})`); g.addColorStop(0.45, `rgba(36,16,5,${0.45 * I})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Bras de spirale — fusion additive.
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const a0 = k * Math.PI * 2 / 5;
      for (const [lw, al] of [[0.13, 0.028], [0.055, 0.045], [0.018, 0.07]]) {
        ctx.strokeStyle = `rgba(122,70,30,${al * I})`;
        let px = 0, py = 0;
        for (let i = 0; i <= 44; i++) {
          const rr = (eye + (R - eye) * Math.pow(1 - i / 44, 1.7)) * gather;
          const th = spiral(a0, rr), x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr;
          if (i) { ctx.lineWidth = u * lw * (0.25 + 0.75 * Math.min(rr / (u * 0.6), 1.4)); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke(); }
          px = x; py = y;
        }
      }
    }
    // Braises.
    for (const q of parts) {
      const s = (q.ph + t * q.sp) % 1;
      const env = Math.pow(Math.sin(Math.PI * s), 0.8);
      if (env < 0.02) continue;
      ctx.globalAlpha = q.al * env * I; ctx.strokeStyle = q.c; ctx.beginPath();
      for (let j = 0; j <= 3; j++) {
        const sk = Math.max(0, s - q.len * j / 3);
        const rr = (eye * 1.1 + (R - eye) * Math.pow(1 - sk, 1.7)) * gather;
        const th = spiral(q.a, rr), x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr;
        if (!j) { ctx.lineWidth = q.w * dpr * (0.5 + Math.min(rr / (u * 0.5), 1.6)); ctx.moveTo(x, y); } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Vignette + œil.
    ctx.globalCompositeOperation = 'source-over';
    g = ctx.createRadialGradient(cx, cy, u * 0.35, cx, cy, R * 0.95);
    g.addColorStop(0, 'rgba(4,1,0,0)'); g.addColorStop(1, 'rgba(4,1,0,.92)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, eye * 2.4);
    g.addColorStop(0, 'rgba(2,0,0,1)'); g.addColorStop(0.42, 'rgba(3,1,0,.97)'); g.addColorStop(1, 'rgba(4,1,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, eye * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(212,175,97,${0.1 * I})`; ctx.lineWidth = u * 0.03;
    ctx.beginPath(); ctx.arc(cx, cy, eye * 1.02, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = `rgba(243,217,160,${0.4 * I})`; ctx.lineWidth = Math.max(1, u * 0.0022);
    ctx.beginPath(); ctx.arc(cx, cy, eye * 1.02, 0, Math.PI * 2); ctx.stroke();
    // Flash + onde de choc.
    const fl = bump(1.4, 1.48, 2.05);
    if (fl > 0) {
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, u * (0.25 + 0.35 * fl));
      g.addColorStop(0, `rgba(255,246,225,${0.95 * fl})`); g.addColorStop(0.25, `rgba(243,200,120,${0.6 * fl})`);
      g.addColorStop(0.6, `rgba(120,60,20,${0.3 * fl})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    const sw = seg(1.46, 2.15);
    if (sw > 0 && sw < 1) {
      ctx.strokeStyle = `rgba(212,175,97,${0.55 * (1 - sw)})`;
      ctx.lineWidth = u * 0.018 * (1 - sw) + 1;
      ctx.beginPath(); ctx.arc(cx, cy, eye + eo(sw) * u * 0.95, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // --- DOM ---
    const U = cssU, exit = seg(2.9, 3.35);
    r.overlay.style.opacity = String(1 - exit);
    const p = eio(seg(0.05, 1.45)), punch = 1 + 0.09 * bump(1.42, 1.5, 1.8);
    ([[r.avP, Math.PI], [r.avE, 0]] as const).forEach(([el, base]) => {
      const ang = base - (1 - p) * 2.8;
      const rad = (0.72 - 0.42 * p) * U * (1 + 0.08 * eo(exit));
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad * (0.55 + 0.45 * p);
      el.style.opacity = String(seg(0.12, 0.6));
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${(-(1 - p) * 70).toFixed(1)}deg) scale(${((0.45 + 0.55 * p) * punch).toFixed(3)})`;
      el.style.filter = p < 0.999 ? `blur(${((1 - p) * 0.012 * U).toFixed(1)}px)` : 'none';
    });
    const te = eox(seg(1.5, 2.0));
    r.title.style.opacity = String(te);
    r.title.style.transform = `scale(${(1.22 - 0.22 * te).toFixed(3)})`;
    r.title.style.letterSpacing = `${(0.3 - 0.29 * te).toFixed(3)}em`;
    r.title.style.filter = te < 0.999 ? `blur(${((1 - te) * 0.02 * U).toFixed(1)}px)` : 'none';
    const re = eo(seg(1.8, 2.2));
    r.rule.style.opacity = String(re); r.rule.style.transform = `scaleX(${re.toFixed(3)})`;
    const ve = eo(seg(1.46, 1.7));
    r.vs.style.opacity = String(ve); r.vs.style.transform = `scale(${(2.2 - 1.2 * ve).toFixed(3)})`;
    const ne = eo(seg(1.72, 2.1));
    [r.nameP, r.nameE].forEach(el => {
      el.style.opacity = String(ne);
      el.style.transform = `translateY(${((1 - ne) * 0.03 * U).toFixed(1)}px)`;
    });
  };

  if (opts.reduced) {
    draw(2.4);
  } else {
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - t0) / 1000, DUEL_VORTEX_END);
      try { draw(t); } finally { if (t < DUEL_VORTEX_END) raf = requestAnimationFrame(tick); }
    };
    draw(0); // première image synchrone : pas de frame vide
    raf = requestAnimationFrame(tick);
  }
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}
