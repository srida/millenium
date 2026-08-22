// Constantes partagées de la scène 3D (port de Board3D.js — géométrie du board
// et styles élémentaires des particules).
import type { Unit } from '../logic/Unit.js';

// Appareil modeste : divise les budgets visuels (fragments d'explosion de
// carte, particules de pouvoir). Défini ici et non dans Scene3D pour que
// CombatAnimator3D puisse le lire sans faire entrer Three.js dans son graphe de
// modules — il ne dépend aujourd'hui de Scene3D que par un import de TYPE.
export const LOW_END_DEVICE = (navigator.hardwareConcurrency || 8) <= 4;

export interface ElementStyle {
  color: number;
  ringColor: number;
  size: number;
  speed: [number, number];
  lift: [number, number];
  gravity: number;
  spin: number;
  flash: boolean;
}

export const ELEMENT_STYLES: Record<string, ElementStyle> = {
  feu:         { color: 0xff6a3c, ringColor: 0xff8a3c, size: 0.08, speed: [1.5, 3.5], lift: [2, 4],     gravity: 2,  spin: 0, flash: false },
  eau:         { color: 0x4fc3f7, ringColor: 0x4fc3f7, size: 0.06, speed: [0.8, 2],   lift: [0.5, 1.5], gravity: 10, spin: 0, flash: false },
  terre:       { color: 0xa0743c, ringColor: 0xc09058, size: 0.09, speed: [0.6, 1.6], lift: [0.4, 1.2], gravity: 14, spin: 0, flash: false },
  air:         { color: 0xb8ffd8, ringColor: 0xc8ffe0, size: 0.06, speed: [1, 2.5],   lift: [1, 2.5],   gravity: 1,  spin: 4, flash: true  },
  foudre:      { color: 0xfff066, ringColor: 0xfff9a8, size: 0.09, speed: [2, 5],     lift: [1, 4],     gravity: 6,  spin: 0, flash: true  },
  glace:       { color: 0xa8e8ff, ringColor: 0xc8f4ff, size: 0.07, speed: [0.6, 1.6], lift: [0.6, 1.6], gravity: 6,  spin: 1, flash: false },
  sorcellerie: { color: 0xb86ae8, ringColor: 0xd8a0f8, size: 0.07, speed: [1, 2.4],   lift: [1.2, 2.8], gravity: 3,  spin: 3, flash: true  },
  energie:     { color: 0x68f0e0, ringColor: 0x9cf8ec, size: 0.07, speed: [1.4, 3.2], lift: [1.4, 3.2], gravity: 2,  spin: 2, flash: true  },
  metal:       { color: 0xc0c8d0, ringColor: 0xe0e6ec, size: 0.08, speed: [1, 2.6],   lift: [0.6, 1.8], gravity: 8,  spin: 0, flash: false },
  sable:       { color: 0xe0c878, ringColor: 0xf0dca0, size: 0.07, speed: [0.8, 2],   lift: [0.6, 1.6], gravity: 5,  spin: 2, flash: false },
  plante:      { color: 0x70c850, ringColor: 0x9ce078, size: 0.07, speed: [0.7, 1.8], lift: [0.8, 2],   gravity: 5,  spin: 1, flash: false },
  neutral:     { color: 0xd8d8e0, ringColor: 0xe8e8f0, size: 0.06, speed: [0.8, 2],   lift: [0.5, 1.5], gravity: 8,  spin: 0, flash: false },
};

// Attribut "Élément" (ARCH_048..ARCH_058, voir data/attributes.json) -> clé de style visuel.
const ELEMENT_ATTR_MAP: Record<string, string> = {
  ARCH_048: 'feu',
  ARCH_049: 'eau',
  ARCH_050: 'terre',
  ARCH_051: 'air',
  ARCH_052: 'foudre',
  ARCH_053: 'glace',
  ARCH_054: 'sorcellerie',
  ARCH_055: 'energie',
  ARCH_056: 'metal',
  ARCH_057: 'sable',
  ARCH_058: 'plante',
};

// Une unité peut porter plusieurs attributs Élément ; les effets de toutes les unités
// sans élément retombent sur le style 'neutral'.
export function elementsForUnit(unit: Pick<Unit, 'attributes'> | null | undefined): string[] {
  const found = (unit?.attributes || []).map((id) => ELEMENT_ATTR_MAP[id]).filter(Boolean);
  return found.length ? found : ['neutral'];
}

// ── Géométrie du board ──

export const COLS = 5;
export const TOTAL_ROWS = 11;
export const PLAYER_ROWS = 4;   // rangées 0-3
export const ENEMY_START = 7;   // rangées 7-10
export const CELL = 1;
export const CARD_PX = 90;
export const CSS_SCALE = CELL / CARD_PX;
export const FOV = 40;
// Cadrage de la phase de préparation : marge horizontale (en cases) laissée autour
// des 5 colonnes, et position verticale du centre du bloc joueur (fraction de la
// hauteur d'écran, 0 = haut) pour dégager le HUD au-dessus et la main en dessous.
export const PREP_COL_MARGIN = 0.5;
export const PREP_FOCUS_Y = 0.4;
// Mode web : la main et les neutralisées passent en rails verticaux à deux
// colonnes sur les côtés (bas d'écran libéré) — le bloc joueur se recentre et
// gagne en hauteur, mais le cadrage doit réserver la largeur des rails. Doit
// rester synchronisé avec la largeur `w-52` de WEB_RAIL_BAND
// (`components/hand/rail.ts`), commune aux deux rails.
export const WEB_RAIL_PX = 208;
export const PREP_ROW_MARGIN_WEB = 0.8;
export const PREP_ROW_MARGIN = 1.5;
// CSS3DObject scales the unit-card DOM by CSS_SCALE, so a screen-visible Npx ring
// must be specified as N / CSS_SCALE in the element's own (pre-scale) box-shadow.
export const HIGHLIGHT_RING_PX = 4 / CSS_SCALE;

export function zForRow(row: number): number { return (TOTAL_ROWS - 1 - row) * CELL; }
export function xForCol(col: number): number { return (col - (COLS - 1) / 2) * CELL; }
export function cellKey(pos: { col: number; row: number }): string { return `${pos.col},${pos.row}`; }

export function baseColorFor(row: number, col: number): number {
  const alt = (col + row) % 2 === 0;
  if (row < PLAYER_ROWS) return 0x06080f;                     // joueur — transparent overlay
  if (row < ENEMY_START) return alt ? 0x070810 : 0x09090f;   // zone neutre — void
  return alt ? 0x2a0d18 : 0x32101e;                          // ennemi — rose-void
}

export function emissiveFor(row: number): { color: number; intensity: number } {
  if (row < PLAYER_ROWS) return { color: 0x000000, intensity: 0 };
  if (row < ENEMY_START) return { color: 0x000000, intensity: 0 };
  return { color: 0x140508, intensity: 1.1 };
}
