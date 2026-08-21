// Fond animé « espace » commun à tous les écrans hors jeu — décor pur, jamais
// interactif.
//
// Deux moitiés, et le partage n'est pas arbitraire (cf. styles/space.css) :
//   - ce qui est LARGE et LENT (le vide profond, les deux nébuleuses) est en
//     CSS, composé par le GPU sans une frame de JS ;
//   - ce qui est PONCTUEL (les étoiles, qui scintillent et dérivent chacune à
//     son rythme, et l'étoile filante) est dessiné au <canvas>.
//
// Aucun état de jeu, aucun store : monté une seule fois par `App.tsx`, il vit
// tant qu'on n'entre pas en partie. Il est `aria-hidden` et
// `pointer-events-none` — un décor n'a rien à dire à un lecteur d'écran et ne
// doit jamais manger un tap destiné à un bouton.
//
// ⚠️ Les constantes de MOUVEMENT ci-dessous (vitesse de dérive, cadence du
// scintillement, délai entre deux filantes, et les durées d'animation des
// nébuleuses dans space.css) sont volontairement DISCRÈTES : c'est un fond de
// menu, pas un écran de veille. Elles se règlent ici, en un seul endroit.
import { useEffect, useRef } from 'react';
import { LOW_END_DEVICE } from '../../three/constants.js';

/** Une étoile par tranche de surface — la densité suit l'écran, pas sa taille. */
const AREA_PER_STAR = 3200;
/** Plafond absolu : au-delà, un grand écran paierait un champ illisible. */
const MAX_STARS = 320;
/** Le pixel ratio est plafonné : au-delà de 2 on paie 4× pour des points de 1 px. */
const MAX_DPR = 2;
/** Bornes du délai entre deux étoiles filantes (secondes). */
const SHOT_DELAY: [number, number] = [7, 19];
const SHOT_SPEED = 620;   // px/s
const SHOT_LIFE = 1.1;    // s
/** Teintes stellaires : blanc, bleu, ambre — le ciel n'est pas monochrome. */
const TINTS = ['255, 255, 255', '196, 214, 255', '255, 226, 186'];

interface Star {
  x: number;
  y: number;
  /** 0 = étoile lointaine (petite, lente, pâle) → 1 = proche. Porte la parallaxe. */
  depth: number;
  radius: number;
  /** Dérive verticale, px/s. */
  speed: number;
  alpha: number;
  /** Pulsation du scintillement (rad/s) et déphasage — sinon tout clignote ensemble. */
  twinkle: number;
  phase: number;
  /** Index dans TINTS — c'est aussi celui du halo pré-rendu correspondant. */
  tint: number;
}

interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Temps écoulé depuis l'apparition (s). */
  age: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function makeStar(width: number, height: number): Star {
  const depth = Math.random() ** 1.6;     // biaisé vers le lointain : un ciel est surtout fait de poussière
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    depth,
    radius: 0.45 + depth * 1.25,
    speed: 1.5 + depth * 7,
    alpha: 0.3 + depth * 0.55,
    twinkle: rand(0.5, 2.2),
    phase: Math.random() * Math.PI * 2,
    tint: Math.floor(Math.random() * TINTS.length),
  };
}

/**
 * Halo pré-rendu d'une teinte. Un dégradé radial par étoile et par frame
 * coûterait trop cher ; un disque plat à faible alpha, lui, se lit comme un
 * disque gris et non comme une lueur — c'est le dégradé qui fait le halo.
 */
function makeGlow(tint: string): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) return c;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${tint}, 0.5)`);
  grad.addColorStop(0.3, `rgba(${tint}, 0.13)`);
  grad.addColorStop(1, `rgba(${tint}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function makeStars(width: number, height: number, budget: number): Star[] {
  const count = Math.min(MAX_STARS, Math.round((width * height) / AREA_PER_STAR)) * budget;
  return Array.from({ length: Math.max(24, Math.round(count)) }, () => makeStar(width, height));
}

function makeShot(width: number, height: number): Shot {
  // Toujours vers le bas-droite, en partant du bord haut/gauche : une seule
  // direction se lit comme un ciel cohérent, des trajectoires aléatoires
  // donnent une pluie de météores.
  const angle = rand(0.28, 0.52);   // radians sous l'horizontale
  return {
    x: rand(-0.1, 0.7) * width,
    y: rand(-0.1, 0.35) * height,
    vx: Math.cos(angle) * SHOT_SPEED,
    vy: Math.sin(angle) * SHOT_SPEED,
    age: 0,
  };
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stars: Star[],
  glows: HTMLCanvasElement[],
  shot: Shot | null,
  time: number,
) {
  ctx.clearRect(0, 0, width, height);

  for (const s of stars) {
    const pulse = 0.58 + 0.42 * Math.sin(time * s.twinkle + s.phase);
    const alpha = Math.max(0, s.alpha * pulse);
    // Halo des seules étoiles proches : posé sur toutes, il coûterait un
    // second dessin par étoile pour un gain invisible sur les plus pâles.
    if (s.depth > 0.62) {
      const r = s.radius * 7;
      ctx.globalAlpha = alpha * 0.8;
      ctx.drawImage(glows[s.tint], s.x - r, s.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgb(${TINTS[s.tint]})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (shot) {
    // La traînée s'allonge puis s'efface : `fade` porte les deux, elle est la
    // seule chose qui distingue une étoile filante d'un trait qui traverse.
    const fade = Math.sin((shot.age / SHOT_LIFE) * Math.PI);
    const len = 90 + 140 * fade;
    const tailX = shot.x - (shot.vx / SHOT_SPEED) * len;
    const tailY = shot.y - (shot.vy / SHOT_SPEED) * len;
    const grad = ctx.createLinearGradient(shot.x, shot.y, tailX, tailY);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(0.35, 'rgba(190, 214, 255, 0.35)');
    grad.addColorStop(1, 'rgba(190, 214, 255, 0)');
    ctx.globalAlpha = fade;
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shot.x, shot.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function Starfield() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Un appareil modeste garde un ciel, deux fois moins peuplé — même
    // arbitrage que les budgets de particules du combat (LOW_END_DEVICE).
    const budget = LOW_END_DEVICE ? 0.5 : 1;
    const glows = TINTS.map(makeGlow);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let shot: Shot | null = null;
    let nextShot = rand(...SHOT_DELAY);
    let time = 0;
    let last = performance.now();
    let frame = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      width = w;
      height = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = makeStars(w, h, budget);
      shot = null;
      if (still) drawFrame(ctx, width, height, stars, glows, null, 0);
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // Un onglet revenu au premier plan rend un dt énorme : sans plafond, les
      // étoiles sauteraient d'un bloc et une filante traverserait l'écran d'un coup.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += dt;

      for (const s of stars) {
        s.y += s.speed * dt;
        if (s.y - s.radius > height) {
          s.y = -s.radius;
          s.x = Math.random() * width;
        }
      }

      if (shot) {
        shot.x += shot.vx * dt;
        shot.y += shot.vy * dt;
        shot.age += dt;
        if (shot.age >= SHOT_LIFE) shot = null;
      } else {
        nextShot -= dt;
        if (nextShot <= 0) {
          shot = makeShot(width, height);
          nextShot = rand(...SHOT_DELAY);
        }
      }

      drawFrame(ctx, width, height, stars, glows, shot, time);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Mouvement réduit : le ciel est là, il ne bouge pas. On ne lance alors
    // aucune boucle — une frame unique suffit, redessinée au redimensionnement.
    if (!still) frame = requestAnimationFrame(tick);

    // L'onglet en arrière-plan : rAF est déjà gelé par le navigateur, mais le
    // `last` ne l'est pas — on le recale au retour plutôt que d'encaisser un
    // dt de plusieurs minutes.
    const onVisibility = () => { last = performance.now(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}

/**
 * Décor spatial plein cadre, monté UNE FOIS par l'App derrière tous les écrans
 * de menu (cf. `App.tsx`) — d'où le `fixed` : la couche ne vit pas dans le
 * `<main>` de l'écran, et elle ne défile pas avec un écran plus haut que la
 * fenêtre. Chaque `<main>` passe au-dessus en `relative z-10`.
 */
export function SpaceBackground({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className}`}>
      <div className="space-bg-deep" />
      <div className="space-bg-nebula space-bg-nebula-a" />
      <div className="space-bg-nebula space-bg-nebula-b" />
      <Starfield />
      <div className="space-bg-vignette" />
    </div>
  );
}
