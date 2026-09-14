// La géométrie des cartes de main et de cimetière — éventail horizontal
// (portrait) et pile à deux colonnes (rails du mode web).
//
// **Pur, sans aucun import.** C'est la seule façon de le mettre sous test : la
// suite tourne en `environment: 'node'`, sans DOM, donc aucun composant React
// n'est testable dans ce projet. Ce module décide OÙ va chaque carte ; le
// composant se contente d'écrire le `transform`.
//
// ⚠️ **Sans défilement, la seule variable d'ajustement est la TAILLE.** La main
// est de taille illimitée (les cartes non jouées s'accumulent de tour en tour),
// et le choix retenu est de tout montrer d'un coup. L'ordre des concessions est
// donc : on resserre le pas jusqu'à `PITCH_MIN` — la carte ne montre plus
// qu'une lisière, mais le badge de tier et la pastille de coût y sont encore —,
// puis on RÉDUIT l'échelle. `SCALE_MIN` borne la casse ; au-delà, `overflow`
// passe à vrai et le conteneur saura un jour quoi en faire. Rien ne déborde
// jamais en silence.
//
// ⚠️ Les coordonnées sont en PIXELS et l'origine est le CENTRE de la bande :
// c'est ce qui rend la symétrie vérifiable (`x[i] === -x[n-1-i]`) au lieu d'être
// constatée à l'œil, et ce qui dispense le conteneur de connaître sa largeur.

/** Largeur / hauteur d'une carte — le `aspect-[5/7]` de `CardTile`. */
export const CARD_ASPECT = 5 / 7;

/** Pas au repos, en fraction de la largeur d'une carte : 22 % de recouvrement.
 *  Assez pour que l'éventail se lise comme une main, pas assez pour cacher une
 *  illustration. */
export const PITCH_IDEAL = 0.78;
/** Pas minimal avant de rapetisser. En dessous, la lisière visible ne porte plus
 *  le badge de tier ni la pastille de coût — c'est-à-dire plus rien qui
 *  distingue deux cartes empilées. */
export const PITCH_MIN = 0.26;
/** Plancher d'échelle : en dessous, une carte n'est plus lisible du tout et la
 *  rapetisser encore ne fait que repousser l'aveu. */
export const SCALE_MIN = 0.55;

/** Amplitude totale de l'éventail, en degrés, et sa montée par carte. Un
 *  éventail s'ouvre avec la main puis plafonne : au-delà, les cartes des bords
 *  seraient couchées. */
export const ARC_MAX_DEG = 14;
export const ARC_PER_CARD_DEG = 3;
/** Creux de l'arc aux extrémités, en fraction de la hauteur d'une carte. */
export const ARC_DROP = 0.09;

/** Pile verticale des rails : mêmes concessions, dans l'autre sens. */
export const RAIL_PITCH_IDEAL = 1.06;   // > 1 = un interstice, pas un recouvrement
export const RAIL_PITCH_MIN = 0.34;
/**
 * ⚠️ Les rails descendent PLUS BAS que l'éventail, et c'est la géométrie qui
 * l'impose : un téléphone en paysage ne laisse que ~220 px de haut entre la
 * barre de PV et la barre de phase, là où la bande du portrait dispose de toute
 * la largeur. À `SCALE_MIN`, deux colonnes n'y tiendraient que douze cartes —
 * bien en dessous d'une main de milieu de partie. Le plancher de l'éventail
 * reste le sien : il n'a jamais eu besoin de descendre si bas.
 */
export const RAIL_SCALE_MIN = 0.34;
/** Micro-rotation d'une carte de pile, en degrés — « posée à la main » plutôt
 *  qu'alignée à la règle. Semée par l'index : deux rendus du même état donnent
 *  la même pile. */
export const RAIL_JITTER_DEG = 1.6;

export interface CardTransform {
  /** Décalage du CENTRE de la carte par rapport au centre de la bande, en px.
   *  Positif = vers la droite. */
  x: number;
  /** Idem en vertical. Positif = vers le bas. */
  y: number;
  /** Rotation dans le plan de l'écran, en degrés. */
  rotZ: number;
  /** Basculement autour de l'axe vertical, en degrés — le relief des rails. */
  rotY: number;
  scale: number;
  zIndex: number;
}

export interface LayoutResult {
  cards: CardTransform[];
  /** Échelle appliquée à toutes les cartes (1 = taille nominale). */
  scale: number;
  /** Pas retenu entre deux cartes, en px après échelle. */
  pitch: number;
  /** Encombrement réel, ROTATIONS COMPRISES. ⚠️ C'est ce que le conteneur doit
   *  réserver : une carte tournée déborde de sa boîte, et la bande n'a pas le
   *  droit de rogner (un `overflow: hidden` couperait la carte levée). */
  boundsWidth: number;
  boundsHeight: number;
  /** Même au pas minimal et à l'échelle minimale, ça ne tient pas. */
  overflow: boolean;
}

export interface FanOptions {
  count: number;
  /** Largeur utile de la bande, en px. */
  width: number;
  /** Largeur nominale d'une carte, en px (la hauteur s'en déduit). */
  cardWidth: number;
  /**
   * Multiplicateur d'ouverture de l'éventail — amplitude ET creux. 1 par
   * défaut.
   *
   * ⚠️ **0 rend une rangée PLATE**, et c'est ce que le cimetière demande : une
   * main s'ouvre en éventail parce qu'on la TIENT, un cimetière est une rangée
   * de corps posés. Leur donner le même geste ferait lire le second comme une
   * seconde main — alors que ces cartes ne se jouent pas, elles se dépensent.
   *
   * C'est un multiplicateur et non une seconde table : il ne touche NI au pas,
   * NI à l'échelle, NI à la capacité, donc tout ce que le filet vérifie sur
   * l'éventail vaut encore.
   */
  arc?: number;
}

const EMPTY: LayoutResult = {
  cards: [], scale: 1, pitch: 0, boundsWidth: 0, boundsHeight: 0, overflow: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * L'encombrement d'un rectangle `w × h` tourné de `deg`.
 *
 * ⚠️ Il ne se déduit PAS de la largeur du rectangle : une carte tournée de 7°
 * dépasse en hauteur comme en largeur, et c'est ce dépassement qui se fait
 * rogner quand le conteneur ne réserve que la boîte droite.
 */
function rotatedBounds(w: number, h: number, deg: number): { w: number; h: number } {
  const c = Math.abs(Math.cos(rad(deg)));
  const s = Math.abs(Math.sin(rad(deg)));
  return { w: w * c + h * s, h: w * s + h * c };
}

/**
 * Le facteur d'échelle qui fait tenir `count` cartes de largeur `cardWidth`
 * dans `width`, au pas minimal.
 *
 * ⚠️ `slot` est l'encombrement d'UNE carte, rotation comprise, et il s'ajoute
 * aux `(n-1)` pas : la dernière carte occupe sa place pleine, les autres ne
 * coûtent qu'un pas. L'oublier fait déborder d'exactement une carte — le genre
 * d'erreur qui ne se voit que sur la main la plus longue.
 */
function scaleToFit(count: number, room: number, slot: number, pitchMin: number): number {
  const needed = slot + pitchMin * (count - 1);
  return needed <= 0 ? 1 : room / needed;
}

/**
 * L'éventail horizontal du mode portrait.
 *
 * L'arc est une PARABOLE et non un cercle : les deux se ressemblent à ces
 * amplitudes, mais la parabole donne le creux des extrémités en pixels
 * (`ARC_DROP`) au lieu de le faire dépendre d'un rayon qu'il faudrait accorder à
 * la main de la hauteur. Un éventail qui creuse de plus en plus mangerait la
 * bande de phase en dessous.
 */
export function fanLayout({ count, width, cardWidth, arc = 1 }: FanOptions): LayoutResult {
  if (count <= 0 || width <= 0 || cardWidth <= 0) return EMPTY;
  const opening = Math.max(0, arc);

  const cardHeight = cardWidth / CARD_ASPECT;

  if (count === 1) {
    return {
      cards: [{ x: 0, y: 0, rotZ: 0, rotY: 0, scale: 1, zIndex: 0 }],
      scale: 1, pitch: 0,
      boundsWidth: cardWidth, boundsHeight: cardHeight,
      overflow: cardWidth > width,
    };
  }

  // ① L'arc d'abord : son amplitude ne dépend que du compte, et c'est elle qui
  //    dit ce qu'une carte occupe RÉELLEMENT en largeur.
  const spread = Math.min(ARC_MAX_DEG, ARC_PER_CARD_DEG * (count - 1)) * opening;
  const half = spread / 2;

  // ⚠️ L'encombrement d'une carte des extrémités, ROTATION COMPRISE. Mesurer la
  //    place disponible sur la boîte droite et la reporter sur la boîte tournée
  //    fait déclarer en débordement une main qui tient pile — l'écart vaut ici
  //    une bonne dizaine de pixels, soit un tiers de pas.
  const slotWidth = rotatedBounds(cardWidth, cardHeight, half).w;

  // ② Le pas, au repos puis contraint par la largeur disponible.
  const pitchIdeal = cardWidth * PITCH_IDEAL;
  const pitchAvailable = (width - slotWidth) / (count - 1);
  const pitchFloor = cardWidth * PITCH_MIN;

  let scale = 1;
  let pitch = Math.min(pitchIdeal, pitchAvailable);

  // ③ Le pas ne descend pas sous son plancher : c'est l'échelle qui cède.
  if (pitch < pitchFloor) {
    scale = clamp(scaleToFit(count, width, slotWidth, cardWidth * PITCH_MIN), SCALE_MIN, 1);
    pitch = cardWidth * scale * PITCH_MIN;
  }

  const w = cardWidth * scale;
  const h = cardHeight * scale;
  const drop = h * ARC_DROP * opening;

  const cards: CardTransform[] = [];
  let maxBoundW = 0;
  let maxBoundH = 0;

  for (let i = 0; i < count; i++) {
    // `t` court de -1 à +1 : la position sur l'arc, indépendante du compte.
    const t = (i / (count - 1)) * 2 - 1;
    const rotZ = half * t;
    const b = rotatedBounds(w, h, rotZ);
    maxBoundW = Math.max(maxBoundW, b.w);
    maxBoundH = Math.max(maxBoundH, b.h);
    cards.push({
      x: (i - (count - 1) / 2) * pitch,
      y: drop * t * t,
      rotZ,
      rotY: 0,
      scale,
      // ⚠️ L'ordre d'empilement suit l'ordre de la main, de gauche à droite :
      // c'est le seul qui se lise comme un éventail tenu en main. Un z uniforme
      // laisserait l'ordre de peinture du DOM décider, donc changerait au
      // moindre re-render.
      zIndex: i,
    });
  }

  const spanX = (count - 1) * pitch;
  return {
    cards, scale, pitch,
    boundsWidth: spanX + maxBoundW,
    boundsHeight: maxBoundH + drop,
    overflow: spanX + maxBoundW > width + 0.5,
  };
}

export interface RailOptions {
  count: number;
  /** Largeur utile du rail, en px. */
  width: number;
  /** Hauteur utile du rail, en px. */
  height: number;
  /** Largeur nominale d'une carte, en px. */
  cardWidth: number;
  /** Colonnes du rail — **2**, comme la grille qu'il remplace. */
  columns?: number;
  /** Gouttière horizontale entre deux colonnes, en px. */
  gapX?: number;
}

/**
 * Bruit déterministe d'une carte de pile, dans [-1, 1].
 *
 * ⚠️ Semé par l'INDEX et non tiré au hasard : deux rendus du même état doivent
 * donner la même pile, sinon chaque re-render redresserait les cartes sous les
 * doigts du joueur. Même geste que le décor des cases bloquées, semé par
 * `(col, row)`.
 */
export function railJitter(index: number): number {
  const seed = (index * 9301 + 49297) % 233280;
  return (seed / 233280) * 2 - 1;
}

/**
 * La pile verticale des rails du mode web, à deux colonnes.
 *
 * Les cartes se lisent dans l'ordre de la grille qu'elle remplace — de gauche à
 * droite, puis de haut en bas —, donc `colonne = i % columns` et
 * `rangée = ⌊i / columns⌋`. C'est le RANG qui se resserre : deux cartes d'une
 * même rangée sont côte à côte et ne se recouvrent jamais.
 */
export function railLayout({
  count, width, height, cardWidth, columns = 2, gapX = 8,
}: RailOptions): LayoutResult {
  if (count <= 0 || width <= 0 || height <= 0 || cardWidth <= 0 || columns <= 0) return EMPTY;

  const rows = Math.ceil(count / columns);
  const cardHeight = cardWidth / CARD_ASPECT;

  // ① Le pas vertical entre deux rangées. Comme dans l'éventail, la place se
  //    mesure sur la boîte TOURNÉE — ici par le bruit de pile.
  const slotHeight = rotatedBounds(cardWidth, cardHeight, RAIL_JITTER_DEG).h;
  const pitchIdeal = cardHeight * RAIL_PITCH_IDEAL;
  const pitchAvailable = rows > 1 ? (height - slotHeight) / (rows - 1) : pitchIdeal;
  const pitchFloor = cardHeight * RAIL_PITCH_MIN;

  let scale = 1;
  let pitch = Math.min(pitchIdeal, pitchAvailable);

  if (rows > 1 && pitch < pitchFloor) {
    scale = clamp(scaleToFit(rows, height, slotHeight, cardHeight * RAIL_PITCH_MIN), RAIL_SCALE_MIN, 1);
    pitch = cardHeight * scale * RAIL_PITCH_MIN;
  }

  // ② La largeur du rail borne elle aussi la carte : deux colonnes et leur
  //    gouttière doivent tenir, quoi qu'ait décidé la hauteur.
  const colWidth = (width - gapX * (columns - 1)) / columns;
  if (cardWidth * scale > colWidth) scale = Math.min(scale, colWidth / cardWidth);

  const w = cardWidth * scale;
  const h = cardHeight * scale;
  if (rows > 1) {
    const slot = rotatedBounds(w, h, RAIL_JITTER_DEG).h;
    pitch = Math.min(pitch, Math.max(pitchFloor * scale, (height - slot) / (rows - 1)));
  }

  const cards: CardTransform[] = [];
  let maxBoundW = 0;
  let maxBoundH = 0;

  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const rotZ = RAIL_JITTER_DEG * railJitter(i);
    const b = rotatedBounds(w, h, rotZ);
    maxBoundW = Math.max(maxBoundW, b.w);
    maxBoundH = Math.max(maxBoundH, b.h);
    cards.push({
      x: (col - (columns - 1) / 2) * (w + gapX),
      y: (row - (rows - 1) / 2) * pitch,
      rotZ,
      // Le relief du rail : les cartes se tournent légèrement vers le board.
      rotY: 0,
      scale,
      // ⚠️ La rangée du DESSOUS passe au-dessus : c'est le sens d'une pile
      // qu'on garnit par le haut, et c'est aussi celui qui garde la lisière
      // portant le nom visible.
      zIndex: row,
    });
  }

  const spanY = (rows - 1) * pitch;
  return {
    cards, scale, pitch,
    boundsWidth: (columns - 1) * (w + gapX) + maxBoundW,
    boundsHeight: spanY + maxBoundH,
    overflow: spanY + maxBoundH > height + 0.5,
  };
}
