// Les calques d'un effet ou d'un cadre de carte (`styles/finish.css`) — LE seul
// endroit qui sait lesquels poser, dans quel ordre, et avec quelles classes.
//
// Deux fabriques de balisage les consomment : `three/UnitCardEl` (HTML, DOM
// impératif) et `components/ui/Card3D` (JSX). Le balisage et les 18 positions
// d'éclats ne vivent donc qu'ici. Pur, sans autre import que des types.
import type { CardFinish } from '../data/CardArt.js';

/** x, y, taille, délai — x/y/taille en % de la face (taille mesurée pour une
 *  carte de 84 px de large), délai en secondes. */
export const SPARKLES: ReadonlyArray<readonly [number, number, number, number]> = [
  [24, 18, 11, 0],   [72, 28, 8, .9],   [44, 46, 13, 1.7],
  [80, 60, 7, 2.4],  [18, 64, 9, 3.2],  [58, 10, 7, 4.1],
  [10, 34, 6, .4],   [88, 14, 6, 1.3],  [62, 40, 8, 2.0],
  [32, 80, 7, 2.8],  [86, 84, 9, 3.6],  [50, 70, 6, .6],
  [36, 30, 5, 3.9],  [68, 92, 5, 1.1],  [14, 90, 6, 4.4],
  [92, 42, 5, 2.6],  [46, 22, 6, 4.8],  [26, 50, 7, 1.5],
];

/** Plateau : jusqu'à une quinzaine d'unités à l'écran, chacune avec ses éclats.
 *  Les 10 premiers suffisent à dire « ça scintille » ; à mesurer sur mobile. */
export const SPARKLES_ON_BOARD = 10;

export interface SparkleSpec { left: string; top: string; width: string; delay: string }

/** Les éclats à poser, avec leurs valeurs CSS déjà formatées. */
export function sparkleSpecs(count: number = SPARKLES.length): SparkleSpec[] {
  return SPARKLES.slice(0, count).map(([x, y, size, delay]) => ({
    left: `${x}%`, top: `${y}%`, width: `${+(size / 84 * 100).toFixed(1)}%`, delay: `${delay}s`,
  }));
}

/** La classe d'encre à poser sur l'illustration, ou ''. */
export function inkClass(f: CardFinish): string {
  return f.ink ? `ink-${f.ink}` : '';
}

/** La classe de cadre à poser sur la racine de la carte, ou ''. */
export function frameClass(f: CardFinish): string {
  return f.frame ? `frame-${f.frame}` : '';
}

/**
 * Les calques de la FACE, dans l'ordre exact de la maquette. Les deux moitiés
 * encadrent les calques que chaque fabrique possède (étoiles, nébuleuse,
 * reflet) : `beforeSheen` = encre + holo + éclats, `afterSheen` = cadre intérieur.
 * Rendus en HTML ; `Card3D` les rend en JSX à partir des mêmes données.
 */
export function inkLayersHtml(f: CardFinish): string {
  if (!f.ink) return '';
  return (f.ink === 'nb' ? '' : `<span class="finish-ink-tint ${f.ink}"></span>`)
    + '<span class="finish-ink-grain"></span>';
}

export function effectLayersHtml(f: CardFinish, sparkleCount: number = SPARKLES.length): string {
  let out = '';
  if (f.holo) out += '<span class="finish-holo"><i class="film"></i><i class="trame"></i><i class="eclat"></i></span>';
  if (f.sparkle) {
    out += '<span class="finish-sparkle">'
      + sparkleSpecs(sparkleCount)
        .map(s => `<i style="left:${s.left};top:${s.top};width:${s.width};animation-delay:${s.delay}"></i>`)
        .join('')
      + '</span>';
  }
  return out;
}

export function frameInnerHtml(f: CardFinish): string {
  return f.frame ? '<span class="finish-frame-inner"></span>' : '';
}

export const FINISH_RING_HTML = '<span class="finish-ring"></span>';
