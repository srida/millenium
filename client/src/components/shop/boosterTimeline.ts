// Timeline de l'ouverture d'un booster (« booster déchiré ») — PURE.
//
// `frameAt(t, tB, n)` rend TOUT ce qui se dessine à l'instant `t` : aucune
// référence DOM, aucun import. `BoosterOpening` ne fait qu'écrire ces valeurs
// sur ses refs à chaque frame ; la décision vit ici, donc elle se teste en node.
//
// Deux temps, parce que la réponse du serveur n'arrive pas à date fixe :
// - temps A (sans les cartes) : voile, montée du sachet, tremblement — `t`.
// - temps B (avec les cartes) : déchirure, sortie, étalement, retournement.
//   `tB` est l'instant où il démarre ; `null` tant que `result` n'est pas là.
//
// ⚠️ Les durées de B sont celles de la maquette, dont la réponse est immédiate
// (`tB` = SHAKE_MIN). On les lit donc sur un temps recalé `mt = t − (tB − SHAKE_MIN)`.
// Tant que `tB` est nul, `mt` n'existe pas : rien de B ne peut se dessiner,
// quel que soit `t` — le tremblement boucle jusqu'à l'arrivée des cartes.

export const SHAKE_MIN = 0.5;
export const CARD_W = 92;
export const CARD_H = 129;
export const CARD_PITCH = 102;

const cl = (x: number) => Math.max(0, Math.min(1, x));
const sm = (x: number) => x * x * (3 - 2 * x);
const eo = (x: number) => 1 - Math.pow(1 - x, 3);
const eio = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eob = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const seg = (t: number, a: number, b: number) => cl((t - a) / (b - a));
const bump = (t: number, a: number, p: number, b: number) =>
  (t < a || t > b ? 0 : t < p ? sm((t - a) / (p - a)) : 1 - sm((t - p) / (b - p)));

/** Début du retournement de la carte `i`, dans le temps recalé. */
const FLIP_BASE = 2.0 + SHAKE_MIN;
const flipStart = (i: number) => FLIP_BASE + i * 0.14;

export interface Slot { x: number; y: number }

/** Positions d'arrivée (centre = 0,0) : une rangée jusqu'à 3 cartes, sinon 3 + le reste. */
export function layout(n: number): Slot[] {
  const rows = n <= 3 ? [n] : [3, n - 3];
  const ys = n <= 3 ? [0] : [-72, 72];
  const out: Slot[] = [];
  rows.forEach((count, r) => {
    for (let i = 0; i < count; i++) out.push({ x: (i - (count - 1) / 2) * CARD_PITCH, y: ys[r] });
  });
  return out;
}

export interface CardFrame {
  x: number; y: number; rot: number; scale: number;
  opacity: number; z: number;
  /** Retournement, 0–180°. */
  flip: number;
  /** Intensité de l'éclat au retournement, 0–1. */
  glow: number;
}

export interface Frame {
  veil: number;
  glow: number;
  pack: { opacity: number; x: number; y: number; rot: number; scale: number };
  tear: { opacity: number; scaleX: number };
  top: { x: number; y: number; rot: number; opacity: number };
  body: { y: number; rot: number; opacity: number };
  flash: number;
  cards: CardFrame[];
  cta: { opacity: number; y: number; interactive: boolean };
  /** La timeline est allée au bout : la boucle peut s'arrêter. */
  end: boolean;
}

/** Instant (temps B recalé) où le bouton « Continuer » est entièrement posé. */
export function endTime(n: number): number {
  return flipStart(Math.max(n, 1) - 1) + 0.45 + 0.25;
}

/** Durée de B, de `tB` à la fin — borne testée (< 4 s pour 5 cartes). */
export function durationAfterB(n: number): number {
  return endTime(n) - SHAKE_MIN;
}

export function frameAt(t: number, tB: number | null, n: number): Frame {
  const P = layout(n);
  const hasB = tB != null;
  // Temps recalé de B. Avant B, une valeur qui tombe sous toutes les bornes.
  const mt = hasB ? t - (tB - SHAKE_MIN) : -Infinity;

  // --- Temps A ---
  const rise = eob(seg(t, 0.05, 0.5));
  const p = seg(t, SHAKE_MIN, 1.15);
  // Amplitude croissante ; tenue à 1 tant que les cartes n'arrivent pas, coupée
  // quand le sachet s'ouvre. `hasB` borne : avant B, jamais d'arrêt.
  const k = p * p * (hasB ? 1 - seg(mt, 1.15, 1.2) : 1);

  // --- Temps B ---
  const tp = eo(seg(mt, 1.15, 1.65));
  const fall = eio(seg(mt, 1.6, 2.05));

  const cards: CardFrame[] = P.map((slot, i) => {
    const off = i - (n - 1) / 2;
    const up = eo(seg(mt, 1.22 + i * 0.03, 1.75));
    const sx = off * 6, sy = 40 - up * 150, sr = off * 5 * up;
    const sp = eob(seg(mt, 1.9 + i * 0.05, 2.38 + i * 0.05));
    const fs = flipStart(i);
    return {
      x: sx + (slot.x - sx) * sp,
      y: sy + (slot.y - sy) * sp,
      rot: sr * (1 - sp),
      scale: (0.92 + 0.08 * sp) * (1 + 0.08 * bump(mt, fs, fs + 0.18, fs + 0.45)),
      opacity: mt > 1.2 ? 1 : 0,
      z: sp > 0.4 ? 3 : 1,
      flip: 180 * eio(seg(mt, fs, fs + 0.35)),
      glow: 0.7 * bump(mt, fs + 0.1, fs + 0.3, fs + 0.7),
    };
  });

  const end = endTime(n);
  const ce = eo(seg(mt, end - 0.35, end));

  return {
    veil: sm(seg(t, 0, 0.3)),
    glow: Math.min(1, 0.25 * seg(t, 0.1, 0.5) + 0.5 * k + 0.6 * bump(mt, 1.1, 1.25, 2.3)) * (1 - 0.5 * seg(mt, 2.2, 2.8)),
    pack: {
      opacity: seg(t, 0.05, 0.15),
      x: Math.sin(t * 61) * k * 2.5,
      y: (1 - rise) * 260,
      rot: (1 - rise) * -12 + Math.sin(t * 42) * k * 3.5,
      scale: 0.55 + 0.45 * rise + 0.05 * k,
    },
    tear: { opacity: seg(mt, 0.6, 0.7) * (1 - seg(mt, 1.15, 1.25)), scaleX: eo(seg(mt, 0.6, 1.15)) },
    top: {
      x: tp * 140,
      y: -tp * 190 + tp * tp * 60,
      rot: tp * 55,
      opacity: 1 - seg(mt, 1.4, 1.65),
    },
    body: { y: fall * 420, rot: fall * 8, opacity: 1 - seg(mt, 1.85, 2.05) },
    flash: bump(mt, 1.12, 1.2, 1.7),
    cards,
    cta: { opacity: ce, y: (1 - ce) * 12, interactive: ce > 0.5 },
    end: hasB && mt >= end,
  };
}
