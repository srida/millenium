// AnimatedLogo — le logo Millenium, vivant : le portail respire, l'anneau
// oscille, les runes s'allument et des braises montent du cœur.
//
// C'est le portage du composition Claude Design « Portail Millenium Ambiance »
// (scène `Souffle` / `Retour`, boucle de 20 s) vers un composant React
// autonome — sans le runtime de Design, sans son fond opaque plein cadre ni ses
// poussières d'ambiance : le décor du menu, c'est `SpaceBackground`, et le logo
// doit se poser DESSUS. Toutes les couches lumineuses sont donc en
// `mix-blend-mode: screen`, jamais opaques.
//
// ⚠️ **Aucun re-render React par frame.** Le DOM est monté une fois, et la
// boucle rAF mute les `style` par référence — comme le fait `three/`. Quarante
// éléments reconciliés soixante fois par seconde pour un décor de menu serait
// la dépense la plus inutile de l'application.
//
// Trois règles de coût, les mêmes que `SpaceBackground` :
//   - `prefers-reduced-motion: reduce` → AUCUNE boucle, une seule frame posée ;
//   - `LOW_END_DEVICE` → moitié moins de braises ;
//   - les rayons de `blur()` sont CONSTANTS — animer un flou re-rasterise la
//     couche à chaque frame, animer son opacité ne coûte qu'une composition.
//
// Toutes les fréquences sont des multiples entiers de la boucle : la couture
// des 20 s est exacte, il n'y a pas de saut à reprendre.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LOW_END_DEVICE } from '../../three/constants.js';

/** Repère local de la composition, en px « source ». Tout est posé dedans, puis
 *  mis à l'échelle d'un seul `scale()` sur la largeur réellement disponible. */
const BASE_W = 880;
const BASE_H = 1010;
/** Centre du portail et diamètre de la pierre, dans ce repère. */
const PX = 440;
const PY = 432;
const S = 820;
const CORE_D = (S * 178 * 2) / 600;
/** Le mot « MILLENIUM », posé sous le portail. */
const WORD_W = 740;
const WORD_Y = PY + 392;

const LOOP = 20;
const OM = (2 * Math.PI) / LOOP;
/** Frame unique servie en mouvement réduit — choisie sur une respiration haute. */
const STILL_T = 3;

// Trois helpers de mouvement : tout le reste en découle.
const breathe = (k: number, ph: number) => (T: number) => Math.sin(T * OM * k + ph);
const spin = (turns: number) => (T: number) => (turns * 360 * T) / LOOP;
const cycle = (n: number, ph: number) => (T: number) => ((((T / LOOP) * n + ph) % 1) + 1) % 1;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutQuad = (t: number) => t * (2 - t);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const swirlA = spin(2);
const swirlB = spin(-3);
const sway = breathe(1, 0);
const pulse = breathe(2, -1.2);
const flick = breathe(7, 0.6);
const drift = breathe(1, 1.9);
const shine = cycle(2, 0.15);

/** Générateur déterministe : le logo doit être le même à chaque chargement. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Braises qui s'élèvent du cœur. ⚠️ Leur taille n'est PAS celle de la source :
 *  le logo se regarde à ~180 px, une braise de 3 px source y ferait 0,6 px. */
const EMBER_COUNT = LOW_END_DEVICE ? 10 : 18;
const R2 = rng(47);
const EMBERS = Array.from({ length: EMBER_COUNT }, (_, i) => ({
  a0: R2() * 6.28,
  ph: i / EMBER_COUNT,
  size: 5 + R2() * 7,
  drift: 0.5 + R2(),
  rise: 150 + R2() * 260,
  warm: i % 4 === 0,
}));

/** Runes du pourtour : 8 lueurs qui clignotent chacune à son rythme. */
const RUNE_RADIUS = S * 0.385;
const R3 = rng(83);
const RUNES = Array.from({ length: 8 }, (_, i) => ({
  a: i * 45 + R3() * 12,
  ph: R3(),
  k: 2 + Math.floor(R3() * 3),
}));

const abs = (o: React.CSSProperties): React.CSSProperties => ({ position: 'absolute', ...o });
const centered = (size: number, extra: React.CSSProperties): React.CSSProperties =>
  abs({ left: PX, top: PY, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, ...extra });

/** Le balayage de lumière des deux copies « sheen » (anneau et mot). */
const sheenMask = (angle: number, size: string): React.CSSProperties => ({
  WebkitMaskImage: `linear-gradient(${angle}deg, transparent 40%, #000 50%, transparent 60%)`,
  maskImage: `linear-gradient(${angle}deg, transparent 40%, #000 50%, transparent 60%)`,
  WebkitMaskSize: size,
  maskSize: size,
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
});

export function AnimatedLogo({ className = '' }: { className?: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);

  const stage = useRef<HTMLDivElement | null>(null);
  const aura = useRef<HTMLDivElement | null>(null);
  const waves = useRef<(HTMLDivElement | null)[]>([]);
  const swirls = useRef<(HTMLDivElement | null)[]>([]);
  const core = useRef<HTMLImageElement | null>(null);
  const coreGlow = useRef<HTMLDivElement | null>(null);
  const ring = useRef<HTMLImageElement | null>(null);
  const ringSheen = useRef<HTMLImageElement | null>(null);
  const runeGroup = useRef<HTMLDivElement | null>(null);
  const runes = useRef<(HTMLDivElement | null)[]>([]);
  const embers = useRef<(HTMLDivElement | null)[]>([]);
  const word = useRef<HTMLImageElement | null>(null);
  const wordSheen = useRef<HTMLImageElement | null>(null);

  // La composition est posée en px « source » ; c'est la largeur mesurée du
  // conteneur qui décide de l'échelle. Mesuré AVANT la peinture, sinon la
  // première frame afficherait le logo à sa taille source.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w) setScale(w / BASE_W);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const apply = (T: number) => {
      // Niveau de lumière ambiante : une respiration lente, plus une seconde
      // harmonique à peine perceptible. Tout ce qui brille s'y indexe.
      const L = clamp(0.72 + pulse(T) * 0.16 + flick(T) * 0.035, 0, 1.7);
      const tilt = sway(T) * 4.5 + drift(T) * 1.5;
      const cam = 1.012 + pulse(T) * 0.008;
      const sweep = shine(T) * 400 - 150;

      if (stage.current) {
        stage.current.style.transform =
          `scale(${cam.toFixed(4)}) translate(${(sway(T) * 5).toFixed(2)}px, ${(drift(T) * 4).toFixed(2)}px)`;
      }
      if (aura.current) aura.current.style.opacity = String(0.3 + L * 0.5);

      for (let k = 0; k < 2; k++) {
        const el = waves.current[k];
        if (!el) continue;
        const p = cycle(2, 0.4 + k * 0.5)(T);
        el.style.transform = `scale(${(0.55 + easeOutQuad(p) * 1.35).toFixed(3)})`;
        el.style.opacity = String(Math.sin(p * Math.PI) * 0.3 * (0.4 + L * 0.6));
      }

      // Les deux volutes coniques TOURNENT au lieu de voir leur dégradé
      // réécrit : un `background` recalculé par frame repeint une couche floue,
      // une rotation ne fait que la recomposer.
      if (swirls.current[0]) {
        swirls.current[0]!.style.transform = `rotate(${swirlA(T).toFixed(2)}deg)`;
        swirls.current[0]!.style.opacity = String(0.42 + L * 0.4);
      }
      if (swirls.current[1]) {
        swirls.current[1]!.style.transform = `rotate(${swirlB(T).toFixed(2)}deg)`;
        swirls.current[1]!.style.opacity = String(0.34 + L * 0.42);
      }

      if (core.current) {
        core.current.style.transform =
          `scale(${(1 + pulse(T) * 0.012 + flick(T) * 0.004).toFixed(4)}) rotate(${(tilt * -0.25).toFixed(3)}deg)`;
        core.current.style.filter =
          `brightness(${(0.82 + L * 0.5).toFixed(3)}) saturate(${(1 + L * 0.25).toFixed(2)})`;
      }
      if (coreGlow.current) coreGlow.current.style.opacity = String(0.3 + L * 0.45);

      if (ring.current) {
        ring.current.style.transform = `rotate(${tilt.toFixed(3)}deg)`;
        ring.current.style.filter =
          `brightness(${(0.86 + L * 0.28).toFixed(3)}) saturate(${(0.9 + L * 0.2).toFixed(2)})` +
          ` drop-shadow(0 0 ${(16 + L * 30).toFixed(1)}px rgba(178,110,255,${(0.3 + L * 0.35).toFixed(2)}))`;
      }
      if (ringSheen.current) {
        ringSheen.current.style.transform = `rotate(${tilt.toFixed(3)}deg)`;
        ringSheen.current.style.maskPosition = `${sweep.toFixed(1)}% 50%`;
        ringSheen.current.style.webkitMaskPosition = `${sweep.toFixed(1)}% 50%`;
      }

      // Les runes suivent l'inclinaison de l'anneau par leur GROUPE : posées
      // une à une, chaque frame recalculerait huit `left`/`top`, donc un
      // recalcul de mise en page pour un mouvement de quelques degrés.
      if (runeGroup.current) runeGroup.current.style.transform = `rotate(${tilt.toFixed(3)}deg)`;
      for (let i = 0; i < RUNES.length; i++) {
        const el = runes.current[i];
        if (!el) continue;
        const r = RUNES[i];
        el.style.opacity = String(Math.max(0, Math.sin(T * OM * r.k + r.ph * 6.28)) * 0.5 * (0.4 + L * 0.7));
      }

      for (let i = 0; i < EMBERS.length; i++) {
        const el = embers.current[i];
        if (!el) continue;
        const e = EMBERS[i];
        const p = cycle(2, e.ph)(T);
        const r = mix(CORE_D * 0.34, CORE_D * 0.34 + e.rise, easeOutQuad(p));
        const a = e.a0 + p * e.drift;
        el.style.transform =
          `translate(${(Math.cos(a) * r).toFixed(1)}px, ${(Math.sin(a) * r * 0.9 - p * 60).toFixed(1)}px)`;
        el.style.opacity = String(Math.sin(p * Math.PI) * 0.85 * (0.4 + L * 0.6));
      }

      const wordShift = `translateY(${(drift(T) * 2.5).toFixed(2)}px)`;
      if (word.current) {
        word.current.style.transform = wordShift;
        word.current.style.filter =
          `drop-shadow(0 0 ${(16 + L * 22).toFixed(0)}px rgba(172,104,255,0.5)) brightness(${(0.92 + L * 0.16).toFixed(2)})`;
      }
      if (wordSheen.current) {
        wordSheen.current.style.transform = wordShift;
        wordSheen.current.style.maskPosition = `${sweep.toFixed(1)}% 50%`;
        wordSheen.current.style.webkitMaskPosition = `${sweep.toFixed(1)}% 50%`;
      }
    };

    // ⚠️ La première frame est posée TOUT DE SUITE, avant toute boucle : un
    // onglet ouvert en arrière-plan ne reçoit aucun `requestAnimationFrame`, et
    // le logo y resterait dans son état non stylé — sans halo, sans lueur de
    // cœur, l'anneau et la pierre à plat.
    apply(STILL_T);

    // Mouvement réduit : le portail est là, il ne bat pas. Aucune boucle — la
    // frame qu'on vient de poser, sur une respiration haute, suffit.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (still) return;

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // `T` est un temps de boucle, pas un cumul : un onglet revenu au premier
      // plan reprend la respiration où elle en est, sans saut à rattraper.
      apply(((now - start) / 1000) % LOOP);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      ref={box}
      role="img"
      aria-label="Millenium"
      className={`pointer-events-none relative select-none ${className}`}
      style={{ aspectRatio: `${BASE_W} / ${BASE_H}` }}
    >
      {/* Deux transforms imbriqués, et ils ne se disputent rien : l'extérieur
          porte la MISE À L'ÉCHELLE (mesurée, constante), l'intérieur le
          balancement de caméra (animé). Un seul élément pour les deux
          obligerait à recomposer la chaîne complète à chaque frame. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: BASE_W,
          height: BASE_H,
          transformOrigin: '0 0',
          transform: `scale(${scale})`,
          // Tant que la largeur n'est pas mesurée, rien n'est peint : le logo
          // apparaîtrait à sa taille source, soit cinq fois trop grand.
          visibility: scale ? 'visible' : 'hidden',
        }}
      >
        <div
          ref={stage}
          style={{
            position: 'absolute',
            inset: 0,
            transformOrigin: `${PX}px ${PY + 60}px`,
          }}
        >
          {/* Halo général : ce qui fait que le portail éclaire ce qui l'entoure. */}
          <div
            ref={aura}
            style={centered(1250, {
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(163,92,255,0.42) 0%, rgba(108,46,196,0.22) 34%, rgba(60,20,120,0) 68%)',
              filter: 'blur(14px)',
              mixBlendMode: 'screen',
            })}
          />

          {/* Ondes concentriques qui s'échappent du cœur. */}
          {[0, 1].map(k => (
            <div
              key={`wave-${k}`}
              ref={el => { waves.current[k] = el; }}
              style={centered(CORE_D, {
                borderRadius: '50%',
                border: '3px solid rgba(214,178,255,0.5)',
                filter: 'blur(3px)',
                mixBlendMode: 'screen',
              })}
            />
          ))}

          {/* Deux volutes coniques en sens inverse : l'énergie qui tourne. */}
          <div
            ref={el => { swirls.current[0] = el; }}
            style={centered(CORE_D * 1.02, {
              borderRadius: '50%',
              background:
                'conic-gradient(from 0deg, rgba(255,255,255,0) 0deg, rgba(206,150,255,0.6) 80deg,' +
                ' rgba(255,246,255,0.85) 140deg, rgba(150,72,230,0.42) 220deg, rgba(255,255,255,0) 340deg)',
              filter: 'blur(20px)',
              mixBlendMode: 'screen',
            })}
          />
          <div
            ref={el => { swirls.current[1] = el; }}
            style={centered(CORE_D * 0.7, {
              borderRadius: '50%',
              background:
                'conic-gradient(from 0deg, rgba(255,255,255,0) 0deg, rgba(255,242,255,0.8) 90deg,' +
                ' rgba(255,255,255,0) 200deg, rgba(224,186,255,0.6) 300deg, rgba(255,255,255,0) 360deg)',
              filter: 'blur(14px)',
              mixBlendMode: 'screen',
            })}
          />

          <img ref={core} src="/logo/core.png" alt="" style={centered(S, {})} />

          {/* Lueur du cœur, PAR-DESSUS la pierre : c'est elle qui la fait briller
              de l'intérieur plutôt que d'être éclairée. */}
          <div
            ref={coreGlow}
            style={centered(CORE_D * 0.92, {
              borderRadius: '50%',
              mixBlendMode: 'screen',
              background:
                'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(232,198,255,0.5) 24%,' +
                ' rgba(168,92,255,0.2) 50%, rgba(120,50,220,0) 74%)',
              filter: 'blur(11px)',
            })}
          />

          <img ref={ring} src="/logo/ring.png" alt="" style={centered(S, {})} />
          {/* Copie masquée de l'anneau : le reflet qui le traverse en biais. */}
          <img
            ref={ringSheen}
            src="/logo/ring.png"
            alt=""
            style={centered(S, {
              filter: 'brightness(2.4) saturate(0.5)',
              opacity: 0.55,
              mixBlendMode: 'screen',
              ...sheenMask(112, '260% 260%'),
            })}
          />

          <div ref={runeGroup} style={abs({ inset: 0, transformOrigin: `${PX}px ${PY}px` })}>
            {RUNES.map((r, i) => (
              <div
                key={`rune-${i}`}
                ref={el => { runes.current[i] = el; }}
                style={abs({
                  left: PX + Math.cos((r.a * Math.PI) / 180) * RUNE_RADIUS,
                  top: PY + Math.sin((r.a * Math.PI) / 180) * RUNE_RADIUS,
                  width: 74,
                  height: 74,
                  marginLeft: -37,
                  marginTop: -37,
                  borderRadius: '50%',
                  background:
                    'radial-gradient(circle, rgba(255,226,160,0.85) 0%, rgba(255,190,90,0.28) 45%, rgba(255,180,70,0) 72%)',
                  filter: 'blur(6px)',
                  mixBlendMode: 'screen',
                })}
              />
            ))}
          </div>

          {EMBERS.map((e, i) => (
            <div
              key={`ember-${i}`}
              ref={el => { embers.current[i] = el; }}
              style={abs({
                left: PX,
                top: PY,
                width: e.size,
                height: e.size,
                marginLeft: -e.size / 2,
                marginTop: -e.size / 2,
                borderRadius: 999,
                background: e.warm ? '#ffe6ae' : '#dcb8ff',
                boxShadow: `0 0 ${8 + e.size * 3}px rgba(203,146,255,0.9)`,
                mixBlendMode: 'screen',
              })}
            />
          ))}

          <img
            ref={word}
            src="/logo/wordmark.png"
            alt=""
            style={abs({ left: PX, top: WORD_Y, width: WORD_W, marginLeft: -WORD_W / 2 })}
          />
          <img
            ref={wordSheen}
            src="/logo/wordmark.png"
            alt=""
            style={abs({
              left: PX,
              top: WORD_Y,
              width: WORD_W,
              marginLeft: -WORD_W / 2,
              filter: 'brightness(2.6) saturate(0.4)',
              opacity: 0.6,
              mixBlendMode: 'screen',
              ...sheenMask(100, '300% 100%'),
            })}
          />
        </div>
      </div>
    </div>
  );
}
