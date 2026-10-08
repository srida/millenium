/* eslint-disable @typescript-eslint/no-explicit-any */
// Scene3D — port de game/ui/components/Board3D.js (rendu Three.js du board,
// 5 colonnes × 11 rangées) vers three en module npm.
//
// Différences avec l'original (PLAN_REFONTE Phase 2) :
//  - three + CSS3DRenderer importés en modules npm (plus de CDN/importmap)
//  - constructeur synchrone (`new Scene3D(container, opts)`)
//  - rendu à la demande : la boucle rAF tourne mais ne rend que si une
//    animation/burst/secousse est active ou si `_invalidate()` a été appelé
//    (drag, highlights, resize) — économie batterie/GPU hors combat
//  - `dispose()` (alias `destroy()`) complet
// Tout le reste (framing caméra, tuiles, particules, interactions) est un
// port ligne à ligne — comportement visuel identique à l'ancienne app.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EnergyArrows } from './EnergyArrows.js';
import { MeleeStrikes } from './MeleeStrikes.js';
import { UnitSpawns } from './UnitSpawns.js';
import { UnitShatter } from './UnitShatter.js';
import { Powers } from './Powers.js';
import { animateTerrain } from './terrain-anim.js';
import { createBoardReveal } from './board-reveal.js';
import { createUnitEl, updateUnitEl } from './UnitCardEl.js';
import {
  ELEMENT_STYLES, elementsForUnit,
  COLS, TOTAL_ROWS, PLAYER_ROWS, CELL, CARD_PX, CSS_SCALE, FOV, HIGHLIGHT_RING_PX,
  PREP_COL_MARGIN, PREP_FOCUS_Y, PREP_ROW_MARGIN, PREP_ROW_MARGIN_WEB, webRailPxFor,
  zForRow, xForCol, cellKey as key, baseColorFor, emissiveFor,
  LOW_END_DEVICE,
  TERRAIN_ANIM_ENABLED,
  TERRAIN_MODELS_ENABLED,
} from './constants.js';
import type { Unit } from '../logic/Unit.js';
import type { BoardDef, Position } from '../logic/types.js';
import * as Audio from '../audio/AudioManager.js';
import { primaryElementOf } from '../data/AttributeDatabase.js';

// Axe vertical du monde, réutilisé par spawnBeam (rotateOnWorldAxis).
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Part d'opacité du treillis du dôme, relative à celle de sa coque.
const LATTICE_RATIO = 0.85;

// Ouverture avec léger dépassement — le dôme claque au lieu de se gonfler.
function easeOutBack(x: number): number {
  const c = 1.9;
  const k = x - 1;
  return 1 + (c + 1) * k * k * k + c * k * k;
}

// Opacité des survivants adverses pendant la préparation (cf. `_visibilityFor`).
const ENEMY_PREP_OPACITY = 0.55;

// Apparition d'une unité : entrée + impact élémentaires, cf. `UnitSpawns`.
// LEAD/STAGGER ne servent qu'à la cascade d'apparition de l'IA (revealEnemyUnits) :
// le lead laisse la caméra amorcer son travelling de combat avant la 1re carte.
const SPAWN_LEAD_S = 0.25;
const SPAWN_STAGGER_S = 0.16;

// ── Frappe finale (fin de combat, cf. `playFinalStrike`) ──
// Une charge plus longue et plus ample que le coup d'un tick : c'est le dernier
// geste du round, et il doit tenir sous le regard le temps que les barres de vie
// se vident.
//
// ⚠️ La portée est une DISTANCE FIXE (en cases) vers le camp d'en face, jamais
// une fraction du chemin qu'il reste à parcourir : les survivants d'un round
// gagné ont le plus souvent déjà traversé le plateau, leur « chemin restant »
// est donc nul et la charge ne se voyait pas — précisément chez le camp qui
// vient de frapper. Mesuré à l'écran : quatre survivants posés dans la zone
// adverse ne bougeaient pas d'un pixel.
const FINAL_STRIKE_S = 0.6;
const FINAL_STRIKE_STAGGER_S = 0.07;
const FINAL_STRIKE_REACH_CELLS = 0.85;

// ── Fond de grille d'un terrain (combat) ──
// Plan texturé de 5 × 11 posé SOUS les tuiles. Assez bas pour ne pas z-fighter
// avec le voile joueur (y = -0.04) ni avec les tuiles (y = 0 / 0.01).
const TERRAIN_BG_Y = -0.08;
// L'illustration est rabattue pour que les cartes d'unités (CSS3D, claires)
// restent lisibles par-dessus — teinte multiplicative sur le MeshBasicMaterial.
const TERRAIN_BG_TINT = 0x8f96a6;
// Modèle 3D d'un terrain : posé à peine sous le plan des tuiles (y = 0), sans
// quoi les deux surfaces coplanaires se disputeraient la profondeur (z-fighting).
// Les cartes CSS3D (y = 0,06) restent au-dessus.
const TERRAIN_MODEL_Y = -0.03;
// Voile des tuiles quand un modèle 3D est posé : plus léger que sur le fond PNG,
// le relief et les matières du modèle portent la lecture.
const TERRAIN_MODEL_TILE_OPACITY = 0.1;
// Voile des tuiles quand un fond est actif. Les tuiles ne couvrent que 92 % de
// leur case : c'est le contraste entre la tuile voilée et l'interstice resté
// clair qui redessine la grille par-dessus l'illustration — trop bas, les cases
// disparaissent ; trop haut, l'illustration ne sert plus à rien.
const TERRAIN_TILE_OPACITY = 0.2;

// ── Case bloquée par le terrain (combat) ──
// Le rouge d'autrefois peignait un ÉTAT D'UI par-dessus l'illustration du
// terrain, dans le vocabulaire déjà pris par la zone ennemie et les dégâts. Or
// une case bloquée n'est pas une menace : c'est un trou dans la grille. La dalle
// est donc rabattue en pierre sombre, un creux est posé en retrait, et quelques
// éclats de roche disent l'obstacle. Trois précautions commandent la forme :
//  - la caméra regarde DROIT vers le bas → c'est la silhouette au sol qui se
//    lit, jamais la hauteur : empreintes polygonales larges, blocs écrasés ;
//  - le décor reste DANS sa case (< 0,46 unité du centre) — une carte CSS3D
//    voisine occupe une case entière et masquerait tout débordement ;
//  - il est STATIQUE : `_animate` fait du rendu à la demande, une animation
//    permanente relancerait la boucle pour tout le combat (seule l'émergence
//    d'un quart de seconde à la pose est animée, et elle se termine).
const BLOCKED_LEDGE_COLOR = 0x1c202b;
// Opaque MÊME sous un fond de terrain : c'est ce qui fait le trou. Voilée comme
// les autres tuiles, la case laisserait passer l'illustration et redeviendrait
// une case normale un peu plus sombre.
const BLOCKED_LEDGE_OPACITY = 0.94;
const BLOCKED_PIT_COLOR = 0x05070c;
const BLOCKED_PIT_SCALE = 0.76;
// La roche est franchement plus CLAIRE que le fond, et ce n'est pas un choix de
// palette : la zone neutre est déjà quasi noire (0x070810), le creux seul ne s'y
// distingue pas d'une case libre. C'est donc l'éclat de pierre qui porte toute la
// lecture — trop sombre, la case bloquée redevient une case ordinaire.
const BLOCKED_ROCK_COLOR = 0x8d97b0;
const BLOCKED_ROCK_COUNT = 4;
const BLOCKED_RISE_S = 0.25;

// Décor STABLE pour une case donnée : deux combats sur le même terrain doivent
// montrer les mêmes rochers, sinon le terrain n'est plus un lieu. xorshift32
// semé par (col,row) — même idiome que le tirage semé de la boutique, sans
// dépendance et sans état partagé.
function cellRandom(col: number, row: number): () => number {
  let s = ((col + 1) * 73856093) ^ ((row + 1) * 19349663) ^ 0x2545f491;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Libère géométries et matériaux d'un modèle chargé (GLB) : three ne le fait pas
// à la place de l'appelant quand l'objet quitte la scène.
function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
  });
}

// Recadre une texture en « cover » : une illustration qui n'est pas exactement
// au ratio de la grille est rognée au centre plutôt que déformée (même intention
// que le object-fit: cover de .unit-art).
function coverFitTexture(tex: THREE.Texture, planeAspect: number): void {
  const img = tex.image as { width?: number; height?: number } | undefined;
  if (!img?.width || !img?.height) return;
  const imgAspect = img.width / img.height;
  if (imgAspect > planeAspect) {
    const r = planeAspect / imgAspect;
    tex.repeat.set(r, 1);
    tex.offset.set((1 - r) / 2, 0);
  } else {
    const r = imgAspect / planeAspect;
    tex.repeat.set(1, r);
    tex.offset.set(0, (1 - r) / 2);
  }
}

export interface Scene3DOptions {
  onCellTap?: (cell: Position) => void;
  onUnitTap?: (unit: Unit, cell: Position, rect: { left: number; top: number; bottom: number; width: number; height: number }) => void;
  onUnitDrag?: (unit: Unit, from: Position, to: Position) => void;
  onUnitLongPress?: ((unit: Unit, cell: Position, rect: { left: number; top: number; bottom: number; width: number; height: number }) => void) | null;
  powerDb?: unknown;
  attributeDb?: unknown;
  showEnemySide?: boolean;
}

interface UnitEntry {
  unit: Unit;
  obj: CSS3DObject;
  wrap: HTMLDivElement;
  el: HTMLDivElement;
  pos: Position;
  elements: string[];
  // Vers l'adversaire — constant pour la durée de vie de la carte (les deux
  // camps ne changent jamais de côté). Sert d'orientation neutre à `MeleeStrikes`
  // pour calculer le lacet vers une cible.
  forward: THREE.Vector3;
  // Adaptateur « acteur » (`{ obj, home, baseQuat, baseScale, forward, dom,
  // setOpacity, entry }`) partagé par `spawns`/`melee`/`shatter`, qui s'en
  // servent comme clé de Map — mis en cache ici pour qu'un même acteur soit
  // rendu à chaque appel plutôt qu'un objet neuf que ces modules ne
  // reconnaîtraient jamais d'un appel à l'autre. `home`/`baseQuat` y sont des
  // ACCESSEURS (lus depuis `entry.pos`/`this._camAngle`) : une position ou un
  // angle de caméra mis en cache deviendrait faux dès la première case franchie.
  _actor?: SceneActor;
}

interface SceneActor {
  obj: CSS3DObject;
  readonly home: THREE.Vector3;
  readonly baseQuat: THREE.Quaternion;
  baseScale: number;
  forward: THREE.Vector3;
  dom: { wrap: HTMLDivElement; card: HTMLDivElement; flash: HTMLDivElement | null };
  entry: UnitEntry;
  setOpacity: (a: number) => void;
  spawning?: boolean;
  // Lus par `three/Powers.js` (via `PowerVfx.ts`) — jamais par `spawns`/
  // `melee`/`shatter`, qui n'ont besoin que des champs ci-dessus.
  readonly col: number;
  readonly row: number;
  readonly tier: number;
  readonly el: string[];
  readonly side: string;
  readonly range: number;
  readonly uid: number;
  readonly hp: number;
}

// Tuile arrondie plate (vue du dessus) — ShapeGeometry avec coins arrondis
function createRoundedTileGeo(size: number, radius: number): THREE.ShapeGeometry {
  const s = size / 2;
  const r = Math.min(radius, s * 0.45);
  const shape = new THREE.Shape();
  shape.moveTo(-s + r, -s);
  shape.lineTo(s - r, -s);
  shape.quadraticCurveTo(s, -s, s, -s + r);
  shape.lineTo(s, s - r);
  shape.quadraticCurveTo(s, s, s - r, s);
  shape.lineTo(-s + r, s);
  shape.quadraticCurveTo(-s, s, -s, s - r);
  shape.lineTo(-s, -s + r);
  shape.quadraticCurveTo(-s, -s, -s + r, -s);
  const geo = new THREE.ShapeGeometry(shape, 4);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export class Scene3D {
  container: HTMLElement;
  onCellTap: NonNullable<Scene3DOptions['onCellTap']>;
  onUnitTap: NonNullable<Scene3DOptions['onUnitTap']>;
  onUnitDrag: NonNullable<Scene3DOptions['onUnitDrag']>;
  onUnitLongPress: Scene3DOptions['onUnitLongPress'];
  powerDb: unknown;
  attributeDb: unknown;
  showEnemySide: boolean;

  board: any = null;
  unitObjs = new Map<number, UnitEntry>();
  _highlighted = new Set<string>();
  _materialCandidates = new Set<string>();
  _materialSelected = new Set<string>();
  _materialsAllSelected = false;
  _blockedCells = new Set<string>();
  // Sous-ensemble de _blockedCells posé par POWER_FREEZE : même blocage, mais une
  // teinte de glace au lieu du rouge générique des cases bloquées d'un terrain.
  _frozenCells = new Set<string>();
  // Effets persistants (bloc de glace) : leurs disposers, pour que destroy() ne
  // laisse pas de géométrie derrière si le combat s'arrête pendant qu'ils vivent.
  _persistent = new Set<() => void>();
  // Amas de cristaux vivants, par case. Scene3D possède le cycle de vie du
  // décor de glace : l'animateur ne pilote que les cases (add/remove), il n'a
  // pas à traîner un disposer en parallèle de son propre registre.
  _iceBlocks = new Map<string, () => void>();
  // Décors de case bloquée (creux + rochers), par case. Même propriété que les
  // blocs de glace : la scène possède le cycle de vie, setBlockedCells ne fait
  // que déclarer la liste des cases.
  _blockedProps = new Map<string, () => void>();
  _selectedPos: Position | null = null;
  // Case SURVOLÉE pendant un glisser de carte — cf. `setHoverCell`.
  _hoverCell: string | null = null;
  _combatMode = false;

  anims: { update: (dt: number) => boolean }[] = [];
  bursts: any[] = [];
  _running = true;
  _needsRender = true;

  scene!: THREE.Scene;
  cssScene!: THREE.Scene;
  fxScene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  cssRenderer!: CSS3DRenderer;
  fxRenderer!: THREE.WebGLRenderer;
  // Projectiles « flèche d'énergie » (EnergyArrows) : calque WebGL transparent
  // séparé, posé AU-DESSUS des cartes CSS3D (cf. `_buildScene`) — un projectile
  // rendu dans `scene` passerait sous les cartes, qui vivent dans un calque DOM
  // empilé par-dessus le canvas WebGL principal.
  fx: any;
  // Apparition, frappe au corps à corps et destruction des unités — les trois
  // pilotent directement `entry.obj` (CSS3DObject, donc `cssScene`) et pour la
  // frappe/l'apparition partagent `fx` pour leurs propres impacts élémentaires
  // (tranchant de mêlée, atterrissage). `killUnitObj` en est le seul point de
  // convergence : une unité qui meurt doit pouvoir couper net une apparition ou
  // une frappe encore en vol sur elle.
  spawns: any;
  melee: any;
  shatter: any;
  // Animations des 16 pouvoirs + effets d'état persistants (three/Powers.js,
  // composé par PowerVfx.ts) — même famille que `fx`/`spawns`/`melee`/
  // `shatter` : un module qui ne connaît que des acteurs et des cellules,
  // jamais un `Unit` ni un `CombatEvent`.
  powers: any;

  tileGeometry!: THREE.ShapeGeometry;
  tileMeshes: THREE.Mesh[] = [];
  tilesByKey = new Map<string, THREE.Mesh>();
  _separators: THREE.Mesh[] = [];
  _playerBg!: THREE.Mesh;

  // Fond de terrain : le mesh n'existe que pendant un combat sur un terrain qui
  // a une illustration. `_terrainToken` invalide un chargement en vol (fin de
  // combat ou terrain suivant avant que la texture soit arrivée).
  _terrainBg: THREE.Mesh | null = null;
  _terrainTex: THREE.Texture | null = null;
  _terrainActive = false;
  _terrainToken = 0;
  // Modèle 3D (GLB) du terrain, quand il remplace le fond PNG. `_terrainActive`
  // reste vrai dans ce mode (tuiles voilées) ; ce drapeau-ci ne change que le
  // voile et le décor des cases bloquées, que le relief du modèle remplace.
  _terrainModel: THREE.Object3D | null = null;
  _terrainModelActive = false;
  _terrainAnim: { update(t: number): void; dispose(): void } | null = null;
  /** Id du terrain actuellement posé (modèle ou PNG), `null` si aucun. */
  _terrainBoardId: string | null = null;
  _terrainReveal: { update(dt: number): boolean; finish(): void; dispose(): void } | null = null;
  // Calque de repérage (grille 5×11, séparation des zones, cases bloquées cerclées
  // de rouge) — celui de la démo « Terrains 3D ». Éteint par défaut : sur un décor
  // illustré, les séparateurs dorés et le quadrillage le salissent. C'est un choix
  // du JOUEUR (`setGridVisible`), pas une donnée de terrain.
  _gridVisible = false;
  _gridGroup: THREE.Group | null = null;
  // Éclairage propre au modèle (celui de la démo « Terrains 3D »), posé et retiré
  // avec lui : la lumière de scène, sombre et bleutée, l'éteignait.
  _terrainLights: THREE.Group | null = null;
  // Duel en ligne, rôle B : le fond de grille suit le miroir des rangées.
  _terrainMirrored = false;

  _camCenterZ = 0;
  _camH = 6;
  // Rotation de la vue de dessus autour de l'axe vertical (radians).
  // 0 = portrait (ennemi en haut) ; PI/2 = paysage (ennemi à droite).
  _camAngle = 0;
  _shake: { time: number; duration: number; magnitude: number } | null = null;
  _raycaster: THREE.Raycaster | null = null;
  _pointerState: any = null;
  _resizeHandler!: () => void;
  _resizeObserver?: ResizeObserver;
  _onPointerDown!: (e: PointerEvent) => void;
  _onPointerMove!: (e: PointerEvent) => void;
  _onPointerUp!: (e: PointerEvent) => void;
  _onWheel!: (e: WheelEvent) => void;
  _lastW = 0;
  _lastH = 0;
  _lastTime = 0;
  _flameTex?: THREE.CanvasTexture;
  _dropletTex?: THREE.CanvasTexture;
  _windTex?: THREE.CanvasTexture;

  constructor(container: HTMLElement, opts: Scene3DOptions = {}) {
    this.container = container;
    this.onCellTap = opts.onCellTap || (() => {});
    this.onUnitTap = opts.onUnitTap || (() => {});
    this.onUnitDrag = opts.onUnitDrag || (() => {});
    this.onUnitLongPress = opts.onUnitLongPress || null;
    this.powerDb = opts.powerDb || null;
    this.attributeDb = opts.attributeDb || null;
    this.showEnemySide = opts.showEnemySide || false;

    this._buildScene();
    this._buildPlayerBackground();
    this._buildTiles();
    this._buildSeparators();
    this._bindPointerEvents();
    this._bindResize();

    this._setCameraImmediate(false);
    this._resize();
    this._animate();
  }

  // Marque la scène à re-rendre au prochain tick (rendu à la demande).
  _invalidate(): void {
    this._needsRender = true;
  }

  // ── Scene / caméra ─────────────────────────────────────────────────────

  _buildScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0A0C18);
    this.cssScene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.up.set(0, 0, -1);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // Ombres : ne coûtent que tant qu'une lumière en projette (celle du modèle 3D d'un terrain).
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.inset = '0';
    this.renderer.domElement.style.touchAction = 'none';
    // L'appui long sur une unité ouvre le tooltip du jeu : le navigateur ne doit
    // ni sélectionner, ni proposer son menu contextuel par-dessus (cf. le garde
    // hérité de <body> dans styles/index.css — répété ici parce que c'est ce
    // canvas qui reçoit le geste, et qu'il vit aussi dans le TestBench).
    this.renderer.domElement.style.userSelect = 'none';
    (this.renderer.domElement.style as any).webkitUserSelect = 'none';
    (this.renderer.domElement.style as any).webkitTouchCallout = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.cssRenderer = new CSS3DRenderer();
    this.cssRenderer.domElement.style.position = 'absolute';
    this.cssRenderer.domElement.style.inset = '0';
    this.cssRenderer.domElement.style.pointerEvents = 'none';
    this.cssRenderer.domElement.style.userSelect = 'none';
    (this.cssRenderer.domElement.style as any).webkitUserSelect = 'none';
    this.container.appendChild(this.cssRenderer.domElement);

    // Calque FX (EnergyArrows) : un troisième renderer, transparent, posé
    // AU-DESSUS des cartes CSS3D. Sans lui les projectiles — rendus dans une
    // scène WebGL classique — passeraient SOUS les cartes, qui vivent dans un
    // calque DOM empilé par-dessus le canvas WebGL principal.
    this.fxScene = new THREE.Scene();
    this.fxRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true });
    this.fxRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.fxRenderer.setClearColor(0x000000, 0);
    this.fxRenderer.domElement.style.position = 'absolute';
    this.fxRenderer.domElement.style.inset = '0';
    this.fxRenderer.domElement.style.pointerEvents = 'none';
    this.container.appendChild(this.fxRenderer.domElement);
    this.fx = new EnergyArrows(this.fxScene, this.camera, { lowEnd: LOW_END_DEVICE });
    // Reprend le réglage d'arc du prototype (tailles par tier déjà par défaut).
    this.fx.setGlobals({ arc: 2 });

    // Apparition : chaque unité posée sur le board tombe/jaillit selon son
    // élément (`_spawnUnitObj`) puis reçoit son impact de tier.
    this.spawns = new UnitSpawns(this.fx, {
      onShake: (a: number) => this.shakeCamera(this._camH * a, 0.3),
    } as any);
    // Frappe au corps à corps : `onHit` ne fait qu'un flash léger + resynchro
    // de la carte cible — le tranchant a DÉJÀ posé son impact élémentaire
    // complet via `fx.fire()` (même `_impact` que les projectiles à distance),
    // le doubler ici referait deux fois le même geste.
    this.melee = new MeleeStrikes(this.fx, {
      onHit: (target: any) => {
        const entry: UnitEntry = target.entry;
        if (!this.unitObjs.has(entry.unit.uid)) return; // déjà mort entre le coup et son tranchant
        this._flashClass(entry.el, 'anim-hit');
        updateUnitEl(entry.el, entry.unit);
      },
      onShake: (a: number) => this.shakeCamera(this._camH * a, 0.3),
    } as any);
    // Destruction : fissure puis explosion en éclats de verre, dans l'élément
    // et le tier de l'unité — `onDone` est le seul endroit qui retire l'objet
    // de la scène, une fois le dernier éclat disparu.
    this.shatter = new UnitShatter(this.fx, {
      onShake: (a: number) => this.shakeCamera(this._camH * a, 0.3),
      onDone: (actor: any) => { this.cssScene.remove(actor.obj); },
    } as any);
    // Pouvoirs : `posOf`/`cellPos` retombent sur `tilePosition`, `opponents`/
    // `allies` filtrent `unitObjs` par côté — Scene3D n'a pas besoin de
    // connaître `CombatManager` pour ça, ses propres cartes à l'écran
    // suffisent. `isFree`/`relocate`/`summon` n'existent plus : ce que la
    // simulation a déjà décidé (case libérée, destination) voyage dans
    // `extra`, jamais recalculé ici (cf. l'en-tête de `Powers.js`).
    this.powers = new Powers(this.fx, {
      posOf: (u: any) => u.home,
      cellPos: (c: number, r: number) => this.tilePosition({ col: c, row: r }),
      alive: (u: any) => this.unitObjs.has(u.entry.unit.uid) && u.entry.unit.isAlive(),
      opponents: (u: any) => [...this.unitObjs.values()]
        .filter((e) => e.unit.side !== u.side && e.unit.isAlive())
        .map((e) => this._actorFor(e)),
      allies: (u: any) => [...this.unitObjs.values()]
        .filter((e) => e.unit.side === u.side && e.unit.isAlive())
        .map((e) => this._actorFor(e)),
      shake: (a: number) => this.shakeCamera(this._camH * a, 0.3),
    } as any);

    // Ambiance astrale : lumière froide violet-bleu + clé dorée rasante
    this.scene.add(new THREE.AmbientLight(0x1e2860, 1.4));
    const sun = new THREE.DirectionalLight(0xe8d090, 0.6);  // or céleste
    sun.position.set(-3, 8, 6);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x4858c0, 0.22); // reflet violet
    fill.position.set(3, 5, -4);
    this.scene.add(fill);
  }

  _buildPlayerBackground(): void {
    const w = COLS * CELL + 0.12;
    const d = PLAYER_ROWS * CELL + 0.12;
    const geo = new THREE.PlaneGeometry(w, d);
    const mat = new THREE.MeshBasicMaterial({ color: 0x6fb2dc, transparent: true, opacity: 0.16 });
    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI / 2;
    const centerZ = (zForRow(0) + zForRow(PLAYER_ROWS - 1)) / 2;
    plane.position.set(0, -0.04, centerZ);
    this.scene.add(plane);
    this._playerBg = plane;
  }

  _buildTiles(): void {
    // Tuile arrondie 8px équivalent (CARD_PX=90px → 1 unit, donc 8/90*0.92 ≈ 0.082)
    const tileSize = CELL * 0.92;
    const tileGeo = createRoundedTileGeo(tileSize, 0.082);
    this.tileGeometry = tileGeo;
    for (let row = 0; row < TOTAL_ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const isPlayer = row < PLAYER_ROWS;
        const baseColor = baseColorFor(row, col);
        const baseEmit = emissiveFor(row);
        const mat = new THREE.MeshStandardMaterial({
          color: baseColor,
          transparent: isPlayer,
          opacity: isPlayer ? 0.04 : 1.0,
          depthWrite: !isPlayer,
          roughness: isPlayer ? 0.7 : 0.84,
          metalness: isPlayer ? 0.0 : 0.03,
          emissive: new THREE.Color(baseEmit.color),
          emissiveIntensity: baseEmit.intensity,
        });
        const tile = new THREE.Mesh(tileGeo, mat);
        tile.position.set(xForCol(col), isPlayer ? 0.01 : 0, zForRow(row));
        tile.userData = {
          col, row, baseColor, isPlayer,
          baseEmissive: baseEmit.color,
          baseEmissiveIntensity: baseEmit.intensity,
        };
        this.scene.add(tile);
        this.tileMeshes.push(tile);
        this.tilesByKey.set(`${col},${row}`, tile);
      }
    }
  }

  _buildSeparators(): void {
    const geo = new THREE.PlaneGeometry(COLS * CELL, 0.08);
    const makeSep = (zPos: number) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xcba85a, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0.07, zPos);
      mesh.visible = false;
      this.scene.add(mesh);
      return mesh;
    };
    this._separators = [
      makeSep((zForRow(3) + zForRow(4)) / 2),
      makeSep((zForRow(6) + zForRow(7)) / 2),
    ];
  }

  _aspect(): number {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    return w / h;
  }

  // Vue web (conteneur plus large que haut) : pendant le combat, on pivote la vue
  // de dessus d'un quart de tour pour que les 11 rangées s'étalent sur la largeur
  // de l'écran — les cases y sont bien plus grandes qu'en cadrage portrait.
  _shouldRotate(combatMode: boolean): boolean {
    return combatMode && this._aspect() > 1;
  }

  /**
   * Le cadrage de PRÉPARATION, entre le bloc joueur (`_prepView` = 0) et le
   * plateau entier (1) — c'est ce qui permet au joueur de voir les obstacles du
   * terrain, révélé dès le début du tour, avant de poser ses unités.
   *
   * ⚠️ Le plateau entier est pris SANS rotation, même en mode web : la rotation
   * d'un quart de tour est celle du combat, et pivoter sous les rails de la
   * main ferait tourner le décor à chaque coup de molette.
   */
  _cameraFraming(combatMode: boolean): { centerZ: number; H: number; angle: number } {
    if (combatMode || this.showEnemySide || this._prepView <= 0) return this._baseFraming(combatMode);
    const prep = this._baseFraming(false);
    const full = this._baseFraming(false, true);
    const t = this._prepView;
    return {
      centerZ: THREE.MathUtils.lerp(prep.centerZ, full.centerZ, t),
      H: THREE.MathUtils.lerp(prep.H, full.H, t),
      angle: 0,
    };
  }

  _baseFraming(combatMode: boolean, forceFullBoard = false): { centerZ: number; H: number; angle: number } {
    const showFullBoard = combatMode || this.showEnemySide || forceFullBoard;
    const rotated = this._shouldRotate(combatMode);
    const vFov = THREE.MathUtils.degToRad(FOV);
    const aspect = this._aspect();
    const span = 2 * Math.tan(vFov / 2);   // hauteur monde visible par unité de distance

    let H: number;
    let centerZ: number;
    if (rotated) {
      // Rangées → largeur de l'écran, colonnes → hauteur.
      const heightForRows = ((TOTAL_ROWS + 0.6) * CELL) / (span * aspect);
      const heightForCols = ((COLS + 0.8) * CELL) / span;
      H = Math.max(heightForRows, heightForCols);
      centerZ = (zForRow(0) + zForRow(TOTAL_ROWS - 1)) / 2;
    } else if (showFullBoard) {
      const heightForRows = ((TOTAL_ROWS + 1.5) * CELL) / span;
      const heightForCols = (COLS * 1.25 * CELL) / (span * aspect);
      H = Math.max(heightForRows, heightForCols);
      centerZ = (zForRow(0) + zForRow(TOTAL_ROWS - 1)) / 2;
    } else {
      // Préparation. En mode web la main et les neutralisées sont des rails
      // latéraux : le board dispose de toute la hauteur mais pas de toute la
      // largeur. En portrait c'est l'inverse — la main mange le bas de l'écran.
      const web = aspect > 1;
      const railPx = web ? webRailPxFor(this.container.clientWidth, this.container.clientHeight) : 0;
      const usableWidth = web ? Math.max(0.35, (this.container.clientWidth - 2 * railPx) / (this.container.clientWidth || 1)) : 1;
      // Les 5 colonnes du joueur doivent tenir dans la largeur utile — sur un
      // écran étroit (mobile portrait) c'est cette contrainte qui commande le
      // zoom, sinon la moitié des cases sort de l'écran.
      const heightForRows = ((PLAYER_ROWS + (web ? PREP_ROW_MARGIN_WEB : PREP_ROW_MARGIN)) * CELL) / span;
      const heightForCols = ((COLS + PREP_COL_MARGIN) * CELL) / (span * aspect * usableWidth);
      H = Math.max(heightForRows, heightForCols);
      // Le bloc joueur est centré verticalement en web (rien ne mange le bas),
      // remonté au-dessus du milieu en portrait pour dégager la main.
      const focusY = web ? 0.5 : PREP_FOCUS_Y;
      centerZ = zForRow((PLAYER_ROWS - 1) / 2) + (0.5 - focusY) * span * H;
    }
    return { centerZ, H, angle: rotated ? Math.PI / 2 : 0 };
  }

  // Applique l'état caméra courant (_camH / _camCenterZ / _camAngle). L'angle pivote
  // le vecteur "up" de la caméra ; les cartes CSS3D suivent pour rester lisibles.
  _applyCameraState(): void {
    const a = this._camAngle;
    this.camera.up.set(-Math.sin(a), 0, -Math.cos(a));
    this.camera.position.set(0, this._camH, this._camCenterZ);
    this.camera.lookAt(0, 0, this._camCenterZ);
    this._applyCardOrientation();
  }

  _applyCardOrientation(): void {
    for (const entry of this.unitObjs.values()) {
      entry.obj.rotation.set(-Math.PI / 2, 0, this._camAngle);
    }
  }

  // ── Vue de préparation (le terrain se lit avant de poser) ─────────────────

  /** 0 = cadrage du bloc joueur, 1 = plateau entier. Sans effet en combat. */
  _prepView = 0;
  /** Le survol automatique en cours, annulé par tout geste du joueur. */
  _prepPreview: { cancelled: boolean } | null = null;

  /** Où en est la vue de préparation (0 → 1). */
  getPrepView(): number { return this._prepView; }

  /**
   * Règle la vue de préparation. Un geste du joueur (défilement, molette,
   * bouton) annule un survol automatique en cours — sinon la caméra lui
   * reprendrait la main.
   */
  setPrepView(t: number, opts: { animate?: boolean; fromPreview?: boolean } = {}): void {
    if (!opts.fromPreview && this._prepPreview) { this._prepPreview.cancelled = true; this._prepPreview = null; }
    const v = Math.min(1, Math.max(0, t));
    if (v === this._prepView && !opts.animate) return;
    this._prepView = v;
    if (this._combatMode) return;
    if (opts.animate) this._animateCameraTo(false);
    else this._setCameraImmediate(false);
  }

  /**
   * Le SURVOL du terrain : la caméra recule jusqu'au plateau entier, s'y
   * attarde, puis revient au bloc joueur. Joué une fois, à la révélation du
   * terrain en début de tour. Tout geste du joueur l'interrompt.
   */
  previewTerrain(holdMs = 900): void {
    if (this._combatMode) return;
    if (this._prepPreview) this._prepPreview.cancelled = true;
    const run = { cancelled: false };
    this._prepPreview = run;
    this.setPrepView(1, { animate: true, fromPreview: true });
    setTimeout(() => {
      if (run.cancelled || this._combatMode) return;
      this._prepPreview = null;
      this.setPrepView(0, { animate: true, fromPreview: true });
    }, 500 + holdMs);
  }

  _setCameraImmediate(combatMode: boolean): void {
    const { centerZ, H, angle } = this._cameraFraming(combatMode);
    this._camCenterZ = centerZ;
    this._camH = H;
    this._camAngle = angle;
    this._applyCameraState();
    this._invalidate();
  }

  _animateCameraTo(combatMode: boolean): void {
    const from = { centerZ: this._camCenterZ, H: this._camH, angle: this._camAngle };
    const to = this._cameraFraming(combatMode);
    let t = 0;
    const duration = 0.5;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        const p = Math.min(t / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        this._camCenterZ = THREE.MathUtils.lerp(from.centerZ, to.centerZ, eased);
        this._camH = THREE.MathUtils.lerp(from.H, to.H, eased);
        this._camAngle = THREE.MathUtils.lerp(from.angle, to.angle, eased);
        this._applyCameraState();
        return p < 1;
      },
    });
  }

  // ── API publique ─────────────────────────────────────────────────────────

  setBoard(board: any): void {
    this.board = board;
  }

  setBlockedCells(cells: Position[] | null | undefined): void {
    this._blockedCells = new Set((cells || []).map(key));
    this._clearIceBlocks();
    this._clearBlockedProps();
    for (const cell of cells || []) {
      const k = key(cell);
      // Un terrain peut lister deux fois la même case : le décor se pose une
      // seule fois, sinon les rochers se superposeraient à l'identique (semés
      // sur la case, ils sortiraient rigoureusement pareils).
      if (this._terrainModelActive) continue; // le relief du modèle tient lieu de décor
      if (!this._blockedProps.has(k)) this._blockedProps.set(k, this.spawnBlockedDecor(cell));
    }
    this._refreshTileColors();
    this._rebuildGrid();
  }

  _clearBlockedProps(): void {
    for (const dispose of this._blockedProps.values()) dispose();
    this._blockedProps.clear();
  }

  /**
   * En duel en ligne, le monde du rôle B est le reflet de celui de A : ses
   * cases bloquées sont miroitées à l'application (`logic/BoardMirror`). Le
   * fond de grille est le PLAN de ces mêmes obstacles — sans le retourner sur
   * l'axe des rangées, le décor peint et les rochers du terrain ne seraient
   * plus en face l'un de l'autre chez ce joueur.
   *
   * Posé une fois par `PvpController` ; faux partout ailleurs.
   */
  setTerrainMirrored(mirrored: boolean): void {
    this._terrainMirrored = !!mirrored;
  }

  // Pose (ou retire) le décor du terrain sous la grille. Appelée par
  // GameController au lancement du combat, avec `null` à sa fin.
  //
  // Deux décors coexistent : le modèle 3D (GLB, `_has_model`) et le fond PNG.
  // Le PNG est la solution de repli — appareil modeste (`LOW_END_DEVICE`),
  // terrain sans modèle, modèle illisible ou 404. Sans fond du tout, on ne fait
  // rien de plus que nettoyer : le décor par défaut de la scène est conservé.
  setTerrainBackground(board: BoardDef | null | undefined, opts: { reveal?: boolean } = {}): void {
    const token = ++this._terrainToken;
    this._clearTerrainBackground();
    this._terrainBoardId = board?.id ?? null;
    if (!board) return;

    if (board._has_model && TERRAIN_MODELS_ENABLED) {
      this._loadTerrainModel(board, token, !!opts.reveal).catch(() => {
        // Le chargement a échoué : repli sur le PNG, sauf si un autre terrain a
        // été demandé entre-temps (le jeton a alors changé).
        if (token === this._terrainToken && this._running) this._loadTerrainPng(board, token);
      });
      return;
    }
    this._loadTerrainPng(board, token);
  }

  // Le modèle est déjà dans le repère du jeu (`xForCol` / `zForRow`) : aucune
  // translation à appliquer, hormis le décalage vertical anti z-fighting.
  async _loadTerrainModel(board: BoardDef, token: number, reveal = false): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(`/api/board-models/${board.id}`);
    const model = gltf.scene;
    if (token !== this._terrainToken || !this._running) { disposeObject(model); return; }

    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Ces deux réglages ne survivent pas au format glTF : réappliqués ici.
      if (mesh.name === 'ground_details') {
        (mesh.material as THREE.Material).depthWrite = false;
        mesh.renderOrder = 1;
      }
      mesh.receiveShadow = true;
      mesh.castShadow = mesh.name !== 'ground' && mesh.name !== 'ground_details';
    });

    // Rôle B (duel en ligne) : le monde est le reflet de celui de A, les cases
    // bloquées sont miroitées — le modèle l'est donc aussi, autour du centre du
    // plateau (rangée ↔ 10 - rangée).
    const holder = new THREE.Group();
    const centerZ = (zForRow(0) + zForRow(TOTAL_ROWS - 1)) / 2;
    holder.add(model);
    if (this._terrainMirrored) {
      holder.scale.z = -1;
      holder.position.z = 2 * centerZ;
    }
    holder.position.y = TERRAIN_MODEL_Y;
    this.scene.add(holder);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const startAnim = () => {
      if (reduced || !TERRAIN_ANIM_ENABLED || this._terrainModel !== holder) return;
      // fxParent = holder : les particules héritent du miroir et de TERRAIN_MODEL_Y
      this._terrainAnim = animateTerrain(model, { fxParent: holder });
      this._invalidate();
    };

    this._terrainModel = holder;
    this._terrainLights = this._buildTerrainLights(centerZ);
    this.scene.add(this._terrainLights);
    // ⚠️ L'apparition AVANT l'ambiance : brouillard, fumée et particules ne
    // doivent pas flotter au-dessus d'un plateau encore en l'air.
    if (reveal && !reduced) {
      this._terrainReveal = createBoardReveal(holder, {
        mode: 'drop',
        fxParent: this.scene,
        onImpact: () => this.shakeCamera(this._camH * 0.012, 0.25),
        onDone: () => { this._terrainReveal = null; startAnim(); },
      });
      this.anims.push(this._terrainReveal);
    } else {
      startAnim();
    }
    this._terrainModelActive = true;
    this._terrainActive = true;
    this._syncSeparators();
    // Le relief du modèle remplace le décor de roches des cases bloquées.
    this._clearBlockedProps();
    this._playerBg.visible = false;
    this._applyTerrainTileMode(true);
    this._refreshTileColors();
    this._invalidate();
  }

  // Lumière de la démo « Terrains 3D » (three-d-stage) : un lavis hémisphérique
  // blanc, une clé blanche qui porte les ombres, un remplissage chaud à contre-jour.
  // Les terrains sombres (Enfer, Nuit des machines…) ont été réglés sous cet
  // éclairage ; la scène du jeu (ambiance astrale, 1,4 + 0,6 + 0,22) les rend
  // presque noirs. Les tuiles étant voilées à 10 %, elles n'en sont pas affectées.
  _buildTerrainLights(centerZ: number): THREE.Group {
    const group = new THREE.Group();
    group.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 5 + centerZ);
    key.target.position.set(0, 0, centerZ);
    key.castShadow = true;
    // Le plateau entier (5 × 11) dans le frustum d'ombre, et rien de plus.
    const cam = key.shadow.camera;
    cam.left = -7; cam.right = 7; cam.top = 8; cam.bottom = -8;
    cam.near = 0.5; cam.far = 25;
    key.shadow.mapSize.set(LOW_END_DEVICE ? 1024 : 2048, LOW_END_DEVICE ? 1024 : 2048);
    key.shadow.bias = -0.0002;
    group.add(key, key.target);

    const fill = new THREE.DirectionalLight(0xfff4e6, 0.5);
    fill.position.set(-5, 3, -4 + centerZ);
    group.add(fill);
    return group;
  }

  _loadTerrainPng(board: BoardDef, token: number): void {
    if (!board._has_background) return;

    // Construire l'URL ici plutôt que de la faire descendre depuis la couche
    // app est le précédent en place — cf. UnitCardEl, qui pointe directement
    // sur /illustrations/<card_id>.
    new THREE.TextureLoader().load(
      `/board-backgrounds/${board.id}`,
      (tex) => {
        // Combat terminé, terrain suivant déjà demandé, ou scène détruite
        // pendant le chargement : la texture n'a plus de destination.
        if (token !== this._terrainToken || !this._running) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        const w = COLS * CELL;
        const d = TOTAL_ROWS * CELL;
        coverFitTexture(tex, w / d);

        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(w, d),
          // Basic et non Standard : l'illustration ne doit pas être assombrie
          // par l'éclairage de scène. La teinte la rabat d'un cran.
          // DoubleSide : une échelle négative (miroir du rôle B) inverse le
          // sens d'enroulement des faces, et le plan disparaîtrait sous le
          // culling par défaut.
          new THREE.MeshBasicMaterial({ map: tex, color: TERRAIN_BG_TINT, side: THREE.DoubleSide }),
        );
        mesh.rotation.x = -Math.PI / 2;
        // Le plan est en XY avant rotation : son Y local est l'axe des rangées.
        if (this._terrainMirrored) mesh.scale.y = -1;
        mesh.position.set(0, TERRAIN_BG_Y, (zForRow(0) + zForRow(TOTAL_ROWS - 1)) / 2);
        mesh.renderOrder = -10;
        this.scene.add(mesh);

        this._terrainBg = mesh;
        this._terrainTex = tex;
        this._terrainActive = true;
        this._syncSeparators();
        // Le voile bleu du bloc joueur salirait l'illustration ; en combat, la
        // lecture des zones est portée par les séparateurs dorés et la teinte
        // rosée des rangées ennemies.
        this._playerBg.visible = false;
        this._applyTerrainTileMode(true);
        this._refreshTileColors();
        this._invalidate();
      },
      undefined,
      () => { /* 404 ou image illisible : on garde le fond actuel */ },
    );
  }

  setGridVisible(visible: boolean): void {
    if (this._gridVisible === visible) return;
    this._gridVisible = visible;
    this._rebuildGrid();
    this._syncSeparators();
    this._invalidate();
  }

  // Les séparateurs dorés des zones n'accompagnent un décor illustré que sur
  // demande ; sans décor (ou hors combat) ils gardent leur comportement d'avant.
  _syncSeparators(): void {
    const show = this._gridVisible || (this._combatMode && !this._terrainActive);
    for (const sep of this._separators) sep.visible = show;
    this._invalidate();
  }

  _rebuildGrid(): void {
    if (this._gridGroup) {
      this.scene.remove(this._gridGroup);
      this._gridGroup.traverse((o) => {
        const l = o as THREE.LineSegments;
        if (l.isLineSegments) { l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
      });
      this._gridGroup = null;
    }
    if (!this._gridVisible) return;

    const y = 0.02;
    const half = CELL / 2;
    const x0 = xForCol(0) - half, x1 = xForCol(COLS - 1) + half;
    const zNear = zForRow(TOTAL_ROWS - 1) - half;
    const lines: number[] = [];
    for (let c = 0; c <= COLS; c++) lines.push(x0 + c * CELL, y, zNear, x0 + c * CELL, y, zNear + TOTAL_ROWS * CELL);
    for (let r = 0; r <= TOTAL_ROWS; r++) lines.push(x0, y, zNear + r * CELL, x1, y, zNear + r * CELL);

    const blocked: number[] = [];
    const inset = half - 0.03;
    for (const k of this._blockedCells) {
      const [col, row] = k.split(',').map(Number);
      const ax = xForCol(col) - inset, bx = xForCol(col) + inset;
      const az = zForRow(row) - inset, bz = zForRow(row) + inset;
      blocked.push(ax, y, az, bx, y, az, bx, y, az, bx, y, bz, bx, y, bz, ax, y, bz, ax, y, bz, ax, y, az);
    }

    const make = (pts: number[], color: number, opacity: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const seg = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }));
      seg.renderOrder = 10;
      return seg;
    };
    const group = new THREE.Group();
    group.add(make(lines, 0xffffff, 0.28));
    if (blocked.length) group.add(make(blocked, 0xff4d5e, 1));
    group.visible = true;
    this.scene.add(group);
    this._gridGroup = group;
  }

  /** Termine l'apparition du terrain en cours (tap du joueur). */
  finishTerrainReveal(): void { this._terrainReveal?.finish(); }

  _clearTerrainBackground(): void {
    this._terrainReveal?.dispose();
    this._terrainReveal = null;
    const hadModel = this._terrainModelActive;
    this._terrainAnim?.dispose();
    this._terrainAnim = null;
    if (this._terrainModel) {
      this.scene.remove(this._terrainModel);
      disposeObject(this._terrainModel);
      this._terrainModel = null;
    }
    if (this._terrainLights) {
      this.scene.remove(this._terrainLights);
      this._terrainLights.traverse((o) => (o as THREE.DirectionalLight).shadow?.map?.dispose());
      this._terrainLights = null;
    }
    this._terrainModelActive = false;
    if (this._terrainBg) {
      this.scene.remove(this._terrainBg);
      this._terrainBg.geometry.dispose();
      (this._terrainBg.material as THREE.Material).dispose();
      this._terrainBg = null;
    }
    this._terrainTex?.dispose();
    this._terrainTex = null;
    if (!this._terrainActive) return;
    this._terrainActive = false;
    this._syncSeparators();
    this._playerBg.visible = true;
    this._applyTerrainTileMode(false);
    // Le décor de roches avait cédé la place au relief : on le rend.
    if (hadModel) {
      for (const k of this._blockedCells) {
        const [col, row] = k.split(',').map(Number);
        if (!this._blockedProps.has(k)) this._blockedProps.set(k, this.spawnBlockedDecor({ col, row }));
      }
    }
    this._refreshTileColors();
    this._invalidate();
  }

  // Les rangées neutres et ennemies sont opaques par défaut : elles masqueraient
  // entièrement le fond. Le mode « fond actif » les fait passer en voile.
  _applyTerrainTileMode(active: boolean): void {
    for (const tile of this.tileMeshes) {
      const { isPlayer } = tile.userData as { isPlayer: boolean };
      const mat = tile.material as THREE.MeshStandardMaterial;
      mat.transparent = active || isPlayer;
      mat.depthWrite = !(active || isPlayer);
      mat.needsUpdate = true;
    }
  }

  // Additive variants used for POWER_FREEZE: merge/remove a single cell
  // without touching the terrain's permanent blocked cells set above.
  addTemporaryBlockedCell(pos: Position): void {
    const k = key(pos);
    this._blockedCells.add(k);
    this._frozenCells.add(k);
    if (!this._iceBlocks.has(k)) this._iceBlocks.set(k, this.spawnIceBlock(pos));
    this._refreshTileColors();
  }

  removeTemporaryBlockedCell(pos: Position): void {
    const k = key(pos);
    this._blockedCells.delete(k);
    this._frozenCells.delete(k);
    this._iceBlocks.get(k)?.();
    this._iceBlocks.delete(k);
    this._refreshTileColors();
  }

  _clearIceBlocks(): void {
    for (const dispose of this._iceBlocks.values()) dispose();
    this._iceBlocks.clear();
    this._frozenCells.clear();
  }

  setHighlight(cells: Position[] | null | undefined): void {
    this._highlighted = new Set((cells || []).map(key));
    this._refreshTileColors();
  }

  clearHighlight(): void {
    this._highlighted.clear();
    this._selectedPos = null;
    this._refreshTileColors();
  }

  setMaterialCandidates(cells: Position[] | null | undefined): void {
    this._materialCandidates = new Set((cells || []).map(key));
    this._refreshTileColors();
  }

  setMaterialSelected(cells: Position[] | null | undefined, complete = false): void {
    this._materialSelected = new Set((cells || []).map(key));
    this._materialsAllSelected = complete;
    this._refreshTileColors();
  }

  clearMaterialHighlight(): void {
    this._materialCandidates.clear();
    this._materialSelected.clear();
    this._materialsAllSelected = false;
    this._refreshTileColors();
  }

  setSelectedPos(pos: Position | null): void {
    this._selectedPos = pos ? { ...pos } : null;
    this._refreshTileColors();
  }

  /**
   * La case sous le doigt pendant un GLISSER de carte. `null` la retire.
   *
   * ⚠️ **Elle sort tôt quand rien ne change**, et ce n'est pas une micro-
   * optimisation : l'appelant est un `pointermove`, donc jusqu'à une fois par
   * frame, et `_refreshTileColors` repeint les 55 tuiles puis invalide le rendu
   * — c'est-à-dire qu'il annulerait à lui seul le rendu à la demande de
   * `_animate` pour toute la durée du geste.
   *
   * ⚠️ Elle ne teste RIEN : une case invalide se voit déjà (elle n'est pas
   * allumée par `setHighlight`), et la validité d'une case ne se juge qu'à la
   * pose — `canSummon` refuserait par exemple une case parfaitement légitime
   * tant que les matériaux ne sont pas désignés (cf. « Invocation »). Le survol
   * dit « c'est cette case-là », pas « ça marchera ».
   */
  setHoverCell(pos: Position | null): void {
    const k = pos ? key(pos) : null;
    if (k === this._hoverCell) return;
    this._hoverCell = k;
    this._refreshTileColors();
  }

  enterCombatMode(): void {
    this._resize();
    this._combatMode = true;
    this._animateCameraTo(true);
    this._syncSeparators();
    for (const entry of this.unitObjs.values()) {
      if (entry.unit.side === 'enemy') this._fadeEntry(entry, true);
    }
    this._invalidate();
  }

  exitCombatMode(): void {
    this._resize();
    this._combatMode = false;
    // Les statuts persistants ne sont resynchronisés qu'à chaque tick de combat
    // (`syncPowerStatuses`) : sans ce balayage, ceux encore posés au dernier tick
    // restent affichés pendant toute la préparation.
    this.powers?.clearAll();
    // Le tour suivant repart du bloc joueur : la vue de préparation ne survit
    // pas à un combat.
    this._prepView = 0;
    this._prepPreview = null;
    this._animateCameraTo(false);
    this._syncSeparators();
    for (const entry of this.unitObjs.values()) {
      if (entry.unit.side === 'enemy') this._fadeEntry(entry, false);
    }
    this.refresh();
  }

  refresh(): void {
    if (!this.board || this._combatMode) return;
    this._resize();
    const units: Unit[] = this.board.getAllUnits();
    const seen = new Set<number>();
    for (const unit of units) {
      seen.add(unit.uid);
      let entry = this.unitObjs.get(unit.uid);
      if (!entry) {
        entry = this._spawnUnitObj(unit);
        this.unitObjs.set(unit.uid, entry);
      } else {
        updateUnitEl(entry.el, unit);
        const pos = unit.position;
        if (pos && (entry.pos.col !== pos.col || entry.pos.row !== pos.row)) {
          this._animateMove(entry, pos);
          entry.pos = { ...pos };
        }
      }
    }
    for (const [uid, entry] of [...this.unitObjs.entries()]) {
      if (!seen.has(uid)) {
        this._removeUnitObj(entry);
        this.unitObjs.delete(uid);
      }
    }
    this._invalidate();
  }

  // ── Accesseurs additionnels (CombatAnimator3D) ───────────────────────────

  getUnitEntry(uid: number): { obj: CSS3DObject; el: HTMLDivElement; position: Position | null } | null {
    const entry = this.unitObjs.get(uid);
    if (!entry) return null;
    return { obj: entry.obj, el: entry.el, position: entry.unit.position };
  }

  /** L'acteur de `Powers.js` pour une unité encore à l'écran — `null` sinon
   * (une carte déjà retirée, cf. `killUnitObj`). `SceneActor` n'est pas
   * exporté (comme `fx`/`spawns`/`melee`/`shatter`, cf. leurs champs `any`) :
   * `PowerVfx.ts` ne fait que le faire transiter vers `Powers.js`. */
  actorForUid(uid: number): any {
    const entry = this.unitObjs.get(uid);
    return entry ? this._actorFor(entry) : null;
  }

  tilePosition(pos: Position): THREE.Vector3 {
    return new THREE.Vector3(xForCol(pos.col), 0.06, zForRow(pos.row));
  }

  worldToScreen(vec3: THREE.Vector3): { x: number; y: number } {
    const v = vec3.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
  }

  // ── Effets (particules / anneaux / flashs / arcs…) ──────────────────────

  spawnBurst(pos: Position | THREE.Vector3, color: number, count = 70, opts: any = {}): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    // `dir` ({x, z}) + `cone` (ouverture en radians) : émission dans un secteur au
    // lieu du cercle complet. Sans `dir`, comportement d'origine (360°).
    const { speed: [speedMin, speedMax] = [1, 3], lift: [liftMin, liftMax] = [1.5, 3.5], size = 0.07, gravity = 6, spin = 0, maxLife = 0.6, dir = null, cone = Math.PI / 3 } = opts;
    const baseAngle = dir ? Math.atan2(dir.z ?? 0, dir.x ?? 0) : 0;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = center.x;
      positions[i * 3 + 1] = center.y + 0.04;
      positions[i * 3 + 2] = center.z;
      const theta = dir ? baseAngle + (Math.random() - 0.5) * cone : Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      velocities[i * 3] = Math.cos(theta) * speed;
      velocities[i * 3 + 1] = liftMin + Math.random() * (liftMax - liftMin);
      velocities[i * 3 + 2] = Math.sin(theta) * speed;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, velocities, life: 0, maxLife, gravity, spin });
  }

  // `startScale` permet l'anneau RENTRANT : la géométrie de base ne fait que
  // 0,18 d'extérieur, un `maxScale` négatif seul ferait donc rétrécir un point.
  // Un anneau qui se referme se démarre grand (startScale 6, maxScale -5).
  spawnRing(pos: Position | THREE.Vector3, color: number, maxLife = 0.5, maxScale = 6, startScale = 1): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const geo = new THREE.RingGeometry(0.05, 0.18, 32);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center);
    ring.position.y = 0.06;
    this.scene.add(ring);
    ring.scale.setScalar(startScale);
    this.bursts.push({ ring, life: 0, maxLife, maxScale, startScale });
  }

  spawnFlash(center: THREE.Vector3, color: number, intensity = 4, range = 4, maxLife = 0.25): void {
    const light = new THREE.PointLight(color, intensity, range, 2);
    light.position.set(center.x, 1.2, center.z);
    this.scene.add(light);
    this.bursts.push({ light, life: 0, maxLife, maxIntensity: intensity });
  }

  spawnHalo(center: THREE.Vector3, color: number): void {
    this.spawnRing(new THREE.Vector3(center.x, 0, center.z), color, 0.7, 9);
    const geo2 = new THREE.RingGeometry(0.05, 0.22, 48);
    const mat2 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
    const ring2 = new THREE.Mesh(geo2, mat2);
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.set(center.x, 0.04, center.z);
    this.scene.add(ring2);
    this.bursts.push({ ring: ring2, life: 0, maxLife: 1.0, maxScale: 13 });
    this.spawnFlash(center, color, 5, 5, 0.55);
  }

  // Arc électrique brisé entre deux points (ou un point + une direction aléatoire courte
  // si toPos est omis) — bolt principal + halo blanc + quelques ramifications courtes.
  spawnLightningArc(fromPos: Position | THREE.Vector3, toPos: Position | THREE.Vector3, color = 0xfff066, opts: any = {}): void {
    const from = fromPos instanceof THREE.Vector3 ? fromPos : this.tilePosition(fromPos);
    const to = toPos instanceof THREE.Vector3 ? toPos : this.tilePosition(toPos);
    const { segments = 7, jitter = 0.16, lift = 0.3, maxLife = 0.16, branches = 1 } = opts;

    const makeBoltPoints = (a: THREE.Vector3, b: THREE.Vector3) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const p = a.clone().lerp(b, t);
        p.y += lift;
        if (i > 0 && i < segments) {
          p.x += (Math.random() - 0.5) * jitter;
          p.y += (Math.random() - 0.5) * jitter;
          p.z += (Math.random() - 0.5) * jitter;
        }
        pts.push(p);
      }
      return pts;
    };

    const lines: THREE.Line[] = [];
    const addBolt = (pts: THREE.Vector3[], lineColor: number, opacity: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: lineColor, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.userData.baseOpacity = opacity;
      this.scene.add(line);
      lines.push(line);
    };

    const mainPts = makeBoltPoints(from, to);
    addBolt(mainPts, color, 1);
    addBolt(mainPts, 0xffffff, 0.55);

    for (let b = 0; b < branches; b++) {
      const startIdx = 1 + Math.floor(Math.random() * Math.max(1, segments - 2));
      const branchStart = mainPts[startIdx];
      const branchEnd = branchStart.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.7,
        Math.random() * 0.25,
        (Math.random() - 0.5) * 0.7,
      ));
      addBolt(makeBoltPoints(branchStart, branchEnd), color, 0.65);
    }

    this.bursts.push({ lines, life: 0, maxLife });
  }

  // Cercle magique : anneaux concentriques tournant à vitesses/sens différents + petits
  // motifs (façon symboles runiques) répartis sur l'anneau médian, qui tourne avec eux.
  // Flash bref façon "cercle d'invocation" — appelé pour l'élément 'sorcellerie'.
  spawnMagicCircle(pos: Position | THREE.Vector3, tier = 1, color = 0xb86ae8, scale = 1): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const t = Math.max(1, Math.min(5, tier));
    // La teinte claire est dérivée de la couleur au lieu d'être une seconde
    // constante : deux couleurs à tenir d'accord finissent par diverger.
    const glowColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex();

    const group = new THREE.Group();
    group.position.set(center.x, 0.55, center.z);
    group.scale.setScalar(scale);
    this.scene.add(group);

    const ringDefs = [
      { rIn: 0.30, rOut: 0.34, spin: 2.6, color },
      { rIn: 0.46, rOut: 0.49, spin: -2.0, color: glowColor },
      { rIn: 0.60 + t * 0.03, rOut: 0.63 + t * 0.03, spin: 1.4, color },
    ];
    const rings = ringDefs.map((def) => {
      const geo = new THREE.RingGeometry(def.rIn, def.rOut, 48);
      const mat = new THREE.MeshBasicMaterial({
        color: def.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
      return { mesh, spin: def.spin };
    });

    const glyphCount = 6 + t;
    const glyphRadius = 0.46;
    const glyphs: THREE.Mesh[] = [];
    for (let i = 0; i < glyphCount; i++) {
      const a = (i / glyphCount) * Math.PI * 2;
      const geo = new THREE.OctahedronGeometry(0.045, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: glowColor, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.cos(a) * glyphRadius, 0.01, Math.sin(a) * glyphRadius);
      group.add(mesh);
      glyphs.push(mesh);
    }

    this.spawnFlash(center, color, 2 + t * 0.4, 3 + t * 0.4, 0.3);
    this.bursts.push({ group, rings, glyphs, glyphSpin: 1.4, life: 0, maxLife: 0.6 + t * 0.08 });
  }

  // Texture flamme générée une fois (canvas, gradient radial chaud) et mise en cache.
  _getFlameTexture(): THREE.CanvasTexture {
    if (this._flameTex) return this._flameTex;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0,    'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,220,120,0.95)');
    grad.addColorStop(0.6,  'rgba(255,120,40,0.45)');
    grad.addColorStop(1,    'rgba(255,60,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    this._flameTex = tex;
    return tex;
  }

  // Flammèches qui s'échappent vers le haut en se dissipant (gravité négative = portance),
  // texture flamme + dégradé de couleur (cœur clair -> orange -> rouge) + flash chaud.
  spawnFlames(pos: Position | THREE.Vector3, tier = 1, opts: any = {}): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const t = Math.max(1, Math.min(5, tier));
    const count = opts.count ?? (10 + t * 6);
    const innerR = opts.innerRadius ?? 0.5;
    const band = opts.spread ?? 0.22;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [
      new THREE.Color(0xfff3b0),
      new THREE.Color(0xffb347),
      new THREE.Color(0xff5a1f),
    ];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = innerR + Math.random() * band;
      positions[i * 3]     = center.x + Math.cos(a) * r;
      positions[i * 3 + 1] = center.y + Math.random() * 0.06;
      positions[i * 3 + 2] = center.z + Math.sin(a) * r;
      velocities[i * 3]     = Math.cos(a) * (0.25 + Math.random() * 0.3);
      velocities[i * 3 + 1] = 1.4 + Math.random() * (1.2 + t * 0.3);
      velocities[i * 3 + 2] = Math.sin(a) * (0.25 + Math.random() * 0.3);
      const c = palette[Math.min(palette.length - 1, Math.floor(Math.random() * palette.length))];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: opts.size ?? (0.22 + t * 0.05),
      map: this._getFlameTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({
      points,
      velocities,
      life: 0,
      maxLife: opts.maxLife ?? (0.45 + t * 0.05),
      gravity: opts.gravity ?? -1.2,
      spin: 0,
    });
    this.spawnFlash(center, 0xff7a3c, 1 + t * 0.3, 2 + t * 0.4, 0.18);
  }

  // Texture goutte d'eau (cœur clair -> bleu profond) générée une fois et mise en cache.
  _getDropletTexture(): THREE.CanvasTexture {
    if (this._dropletTex) return this._dropletTex;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0,    'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, 'rgba(170,224,255,0.9)');
    grad.addColorStop(0.7,  'rgba(70,160,230,0.55)');
    grad.addColorStop(1,    'rgba(40,120,200,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    this._dropletTex = tex;
    return tex;
  }

  // Splash d'eau : gouttelettes projetées en arc qui retombent rapidement + ondes de ricochet.
  spawnSplash(pos: Position | THREE.Vector3, tier = 1, opts: any = {}): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const t = Math.max(1, Math.min(5, tier));
    const count = opts.count ?? (14 + t * 8);
    const innerR = opts.innerRadius ?? 0.12;
    const band = opts.spread ?? 0.18;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [
      new THREE.Color(0xe8faff),
      new THREE.Color(0x9adcff),
      new THREE.Color(0x4fc3f7),
    ];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = innerR + Math.random() * band;
      positions[i * 3]     = center.x + Math.cos(a) * r;
      positions[i * 3 + 1] = center.y + 0.03;
      positions[i * 3 + 2] = center.z + Math.sin(a) * r;
      const speed = 0.9 + Math.random() * (0.8 + t * 0.25);
      velocities[i * 3]     = Math.cos(a) * speed;
      velocities[i * 3 + 1] = 1.6 + Math.random() * (1 + t * 0.35);
      velocities[i * 3 + 2] = Math.sin(a) * speed;
      const c = palette[Math.min(palette.length - 1, Math.floor(Math.random() * palette.length))];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: opts.size ?? (0.16 + t * 0.03),
      map: this._getDropletTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({
      points,
      velocities,
      life: 0,
      maxLife: opts.maxLife ?? (0.4 + t * 0.04),
      gravity: opts.gravity ?? (9 + t * 0.6),
      spin: 0,
    });
    // Onde de ricochet : un cercle net qui s'étale vite, superposé à un second plus large et plus pâle.
    this.spawnRing(new THREE.Vector3(center.x, 0, center.z), 0xaee6ff, 0.32 + t * 0.03, 3 + t * 0.6);
    this.spawnRing(new THREE.Vector3(center.x, 0.01, center.z), 0xddf4ff, 0.5 + t * 0.05, 5 + t * 0.9);
  }

  // Fissure unique au sol (ligne brisée) utilisée par spawnCrater.
  spawnCrack(from: THREE.Vector3, to: THREE.Vector3, color = 0x2a1c10): THREE.Line {
    const segments = 4;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const tt = i / segments;
      const p = from.clone().lerp(to, tt);
      p.y += 0.01;
      if (i > 0 && i < segments) {
        p.x += (Math.random() - 0.5) * 0.05;
        p.z += (Math.random() - 0.5) * 0.05;
      }
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    line.userData.baseOpacity = 0.85;
    this.scene.add(line);
    return line;
  }

  // Cratère : craquelures radiales sombres + anneau de terre soulevée + débris rocheux lourds.
  spawnCrater(pos: Position | THREE.Vector3, tier = 1): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const t = Math.max(1, Math.min(5, tier));
    const crackCount = 5 + t;
    const lines: THREE.Line[] = [];
    for (let i = 0; i < crackCount; i++) {
      const angle = (i / crackCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const len = 0.22 + Math.random() * (0.12 + t * 0.06);
      const end = new THREE.Vector3(center.x + Math.cos(angle) * len, center.y, center.z + Math.sin(angle) * len);
      lines.push(this.spawnCrack(center, end));
    }
    this.bursts.push({ lines, life: 0, maxLife: 0.9 + t * 0.15 });
    this.spawnRing(new THREE.Vector3(center.x, 0.02, center.z), 0x4a3318, 1.0 + t * 0.12, 3.5 + t * 0.7);
    // Nuage de poussière fine (discret, en fond derrière les éclats rocheux).
    this.spawnBurst(center, 0x6b4a2c, 5 + t, {
      speed: [0.4, 0.9 + t * 0.1],
      lift: [0.8, 1.4 + t * 0.2],
      size: 0.08 + t * 0.01,
      gravity: 14 + t,
      maxLife: 0.45 + t * 0.05,
    });
    this.spawnRockShards(center, t);
  }

  // Éclats de pierre : polyèdres irréguliers projetés, culbutent, rebondissent une fois.
  spawnRockShards(pos: Position | THREE.Vector3, tier = 1): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const t = Math.max(1, Math.min(5, tier));
    const count = 7 + t * 3;
    const palette = [0x6b4a2c, 0x8a6238, 0x4a3318, 0x9c805a, 0x5c4226];
    const rocks: any[] = [];
    for (let i = 0; i < count; i++) {
      const size = 0.09 + Math.random() * (0.07 + t * 0.03);
      const geo = new THREE.DodecahedronGeometry(size, 0);
      const color = palette[Math.floor(Math.random() * palette.length)];
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(center.x, center.y + 0.06, center.z);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.9 + Math.random() * (0.9 + t * 0.35);
      rocks.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(angle) * speed, 2.2 + Math.random() * (1.6 + t * 0.4), Math.sin(angle) * speed),
        angVel: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
        bounced: false,
      });
    }
    this.bursts.push({ rocks, life: 0, maxLife: 0.9 + t * 0.12, gravity: 9 + t * 0.8 });
  }

  // Éclats métalliques façon douilles + gerbe d'étincelles + flash blanc bref.
  spawnMetalShards(pos: Position | THREE.Vector3, tier = 1): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const t = Math.max(1, Math.min(5, tier));
    const count = 6 + t * 2;
    const palette = [0xd8dee4, 0xb0b8c0, 0x8c94a0, 0xf0f4f8];
    const rocks: any[] = [];
    for (let i = 0; i < count; i++) {
      const size = 0.05 + Math.random() * (0.04 + t * 0.015);
      const geo = new THREE.BoxGeometry(size, size * 0.4, size * 0.4);
      const color = palette[Math.floor(Math.random() * palette.length)];
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(center.x, center.y + 0.08, center.z);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.4 + Math.random() * (1.4 + t * 0.4);
      rocks.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(angle) * speed, 1.8 + Math.random() * (1.4 + t * 0.4), Math.sin(angle) * speed),
        angVel: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        bounced: false,
      });
    }
    this.bursts.push({ rocks, life: 0, maxLife: 0.5 + t * 0.06, gravity: 14 + t });
    this.spawnBurst(center, 0xfff6d8, 10 + t * 3, {
      speed: [2, 4.5 + t * 0.4], lift: [1, 2.5 + t * 0.3], size: 0.045, gravity: 16, maxLife: 0.22 + t * 0.02,
    });
    this.spawnFlash(center, 0xf0f4f8, 2 + t * 0.4, 3, 0.14);
  }

  // Slash d'épée : arcs fins à plat sur le sol qui flashent puis s'effacent très vite.
  spawnSwordSlash(pos: Position | THREE.Vector3, tier = 1): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const t = Math.max(1, Math.min(5, tier));
    const slashCount = 2 + (t >= 3 ? 1 : 0) + (t >= 5 ? 1 : 0);
    const slashes: THREE.Mesh[] = [];
    for (let i = 0; i < slashCount; i++) {
      const rOut = 0.32 + Math.random() * 0.12 + t * 0.02;
      const rIn = rOut - (0.04 + Math.random() * 0.02);
      const thetaLength = (0.7 + Math.random() * 0.3) * Math.PI;
      const thetaStart = Math.random() * Math.PI * 2;
      const geo = new THREE.RingGeometry(rIn, rOut, 24, 1, thetaStart, thetaLength);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xe8eef4, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(center.x, 0.07 + i * 0.01, center.z);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(mesh);
      slashes.push(mesh);
    }
    this.bursts.push({ slashes, life: 0, maxLife: 0.22 + t * 0.02 });
    this.spawnFlash(center, 0xe8eef4, 1.5 + t * 0.3, 2.5, 0.12);
  }

  // Texture poussière/courant d'air générée une fois et mise en cache.
  _getWindTexture(): THREE.CanvasTexture {
    if (this._windTex) return this._windTex;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0,    'rgba(255,255,255,0.9)');
    grad.addColorStop(0.4,  'rgba(220,255,235,0.55)');
    grad.addColorStop(1,    'rgba(200,255,220,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    this._windTex = tex;
    return tex;
  }

  // Tornade : colonne de particules en spirale + entonnoir de poussière au sol.
  spawnTornado(pos: Position | THREE.Vector3, tier = 1, opts: any = {}): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const t = Math.max(1, Math.min(5, tier));
    const strands = opts.count ?? (10 + t * 4);
    const echoesPerStrand = 4;
    const count = strands * echoesPerStrand;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const baseAngle = new Float32Array(count);
    const baseRadius = new Float32Array(count);
    const rotSpeed = new Float32Array(count);
    const expandSpeed = new Float32Array(count);
    const riseSpeed = new Float32Array(count);
    const maxHeight = new Float32Array(count);
    const maxRadius = new Float32Array(count);
    const echoDelay = new Float32Array(count);
    const palette = [
      new THREE.Color(0xffffff),
      new THREE.Color(0xc8ffe6),
      new THREE.Color(0x7af0c0),
      new THREE.Color(0x4ad8a0),
    ];
    for (let s = 0; s < strands; s++) {
      const angle0 = Math.random() * Math.PI * 2;
      const radius0 = 0.1 + Math.random() * 0.16;
      const rot = (7 + Math.random() * 5 + t * 0.7) * (Math.random() < 0.5 ? -1 : 1);
      const expand = 0.5 + Math.random() * (0.35 + t * 0.08);
      const rise = 1.6 + Math.random() * (1.0 + t * 0.3);
      const height = 1.6 + Math.random() * (0.8 + t * 0.3);
      const rad = 0.7 + Math.random() * (0.35 + t * 0.1);
      const c = palette[Math.min(palette.length - 1, Math.floor(Math.random() * palette.length))];
      for (let e = 0; e < echoesPerStrand; e++) {
        const i = s * echoesPerStrand + e;
        baseAngle[i] = angle0;
        baseRadius[i] = radius0;
        rotSpeed[i] = rot;
        expandSpeed[i] = expand;
        riseSpeed[i] = rise;
        maxHeight[i] = height;
        maxRadius[i] = rad;
        echoDelay[i] = e * 0.05;
        positions[i * 3]     = center.x + Math.cos(angle0) * radius0;
        positions[i * 3 + 1] = center.y;
        positions[i * 3 + 2] = center.z + Math.sin(angle0) * radius0;
        const fade = 1 - e / echoesPerStrand;
        colors[i * 3]     = c.r * fade;
        colors[i * 3 + 1] = c.g * fade;
        colors[i * 3 + 2] = c.b * fade;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: opts.size ?? (0.22 + t * 0.05),
      map: this._getWindTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({
      points,
      life: 0,
      maxLife: opts.maxLife ?? (1.1 + t * 0.12),
      orbit: { center, baseAngle, baseRadius, rotSpeed, expandSpeed, riseSpeed, maxHeight, maxRadius, echoDelay },
    });
    // Entonnoir de poussière au sol : trois anneaux empilés.
    this.spawnRing(new THREE.Vector3(center.x, 0.01, center.z), 0xeafff0, 0.9 + t * 0.1, 6 + t);
    this.spawnRing(new THREE.Vector3(center.x, 0.02, center.z), 0xc8ffe0, 0.75 + t * 0.08, 4 + t * 0.7);
    this.spawnRing(new THREE.Vector3(center.x, 0.03, center.z), 0x8cf0bc, 0.6 + t * 0.06, 2.2 + t * 0.4);
  }

  // Secousse caméra : décale légèrement la position le temps de duration, en décroissant.
  shakeCamera(magnitude = 0.08, duration = 0.3): void {
    this._shake = { time: 0, duration, magnitude };
  }

  // Projectile « flèche d'énergie » (EnergyArrows, calque FX transparent posé
  // au-dessus des cartes CSS3D — cf. `_buildScene`). `element` est une clé
  // (ou un tableau de clés pour un projectile mixte) de `ELEMENT_STYLES` /
  // `EnergyArrows.ELEMENT_PRESETS`, qui partagent exactement le même
  // vocabulaire (feu, eau, terre, air, foudre, glace, sorcellerie, énergie,
  // métal, sable, plante, neutre) : aucune traduction n'est nécessaire.
  //
  // ⚠️ Compatibilité : `PowerVfx.ts` appelle encore ce point d'entrée avec une
  // couleur hexadécimale de pouvoir (pas une identité élémentaire) — un
  // nombre bascule sur l'élément neutre, teinté par cette couleur via les
  // surcharges `core`/`halo` d'EnergyArrows, plutôt que d'inventer un élément
  // thématique que personne n'a demandé.
  playProjectile(
    fromPos: Position,
    toPos: Position,
    element: string | string[] | number = 'neutral',
    opts: { tier?: number } = {},
  ): Promise<void> {
    const from = this.tilePosition(fromPos);
    const to = this.tilePosition(toPos);
    if (typeof element === 'number') {
      return this.fx.fire(from, to, 'neutral', { ...opts, core: element, halo: element }).then(() => {});
    }
    return this.fx.fire(from, to, element, opts).then(() => {});
  }

  // ── Effets de pouvoir (cf. three/PowerVfx.ts) ───────────────────────────
  // Ces primitives passent toutes par `this.anims` (closure qui possède sa
  // géométrie et son propre nettoyage, cf. playProjectile) et jamais par
  // `bursts`, dont chaque variante coûte trois branches : mise à jour, disposal
  // à p >= 1, et destroy().

  // Rayon plat entre deux cases : gaine colorée + cœur blanc, apparition
  // instantanée, tenue, puis fondu. Super Attaque, Blocage, Provocation.
  spawnBeam(fromPos: Position | THREE.Vector3, toPos: Position | THREE.Vector3, color = 0xffffff, opts: any = {}): void {
    const from = fromPos instanceof THREE.Vector3 ? fromPos : this.tilePosition(fromPos);
    const to = toPos instanceof THREE.Vector3 ? toPos : this.tilePosition(toPos);
    const { width = 0.2, maxLife = 0.24, hold = 0.06, y = 0.32, core = true, opacity = 0.9 } = opts;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const angle = Math.atan2(dz, dx);

    const meshes: THREE.Mesh[] = [];
    const addPlank = (w: number, c: number, o: number, dy = 0) => {
      const geo = new THREE.PlaneGeometry(len, w);
      const mat = new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity: o, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // rotation.x = -PI/2 couche le plan (son X local suit X monde), puis une
      // rotation MONDE autour de Y l'oriente : l'ordre d'Euler ne rentre pas en
      // jeu, contrairement à un rotation.set(x, y, z) qu'il faudrait décoder.
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotateOnWorldAxis(WORLD_UP, -angle);
      mesh.position.set((from.x + to.x) / 2, y + dy, (from.z + to.z) / 2);
      mesh.userData.baseOpacity = o;
      this.scene.add(mesh);
      meshes.push(mesh);
    };
    addPlank(width, color, opacity, 0);
    // Le cœur blanc est décalé en hauteur : coplanaire, il z-fightait avec la
    // gaine et délavait la couleur du rayon en gris.
    if (core) addPlank(width * 0.3, 0xffffff, opacity * 0.55, 0.012);

    let t = 0;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        const fade = t <= hold ? 1 : 1 - (t - hold) / Math.max(0.01, maxLife - hold);
        for (const mesh of meshes) {
          (mesh.material as THREE.MeshBasicMaterial).opacity = mesh.userData.baseOpacity * Math.max(0, fade);
        }
        if (t >= maxLife) {
          for (const mesh of meshes) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
          }
          return false;
        }
        return true;
      },
    });
  }

  // Coque hémisphérique + treillis tournant. Bouclier, et déflexion d'immunité.
  // ⚠ Le rayon par défaut DÉBORDE la case à dessein. La carte CSS3D d'une unité
  // occupe exactement une case (CARD_PX × CSS_SCALE = 1 unité monde) et vit dans
  // un calque DOM empilé AU-DESSUS du canvas WebGL : tout ce qui est dessiné à
  // moins de 0,5 unité du centre d'une unité est caché, quelle que soit sa
  // hauteur. Même contrainte pour spawnOrbit et le sceau de POWER_BLOCK.
  spawnDome(pos: Position | THREE.Vector3, color = 0x6ab4e8, opts: any = {}): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const { radius = 0.9, maxLife = 0.75, growth = 0.13, opacity = 0.7 } = opts;

    const geo = new THREE.SphereGeometry(radius, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const shell = new THREE.Mesh(geo, mat);

    const geo2 = new THREE.SphereGeometry(radius * 1.05, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat2 = new THREE.MeshBasicMaterial({
      // Teinté et non blanc : un treillis blanc se lisait comme une cage grise,
      // sans rapport avec la couleur du pouvoir. 0.35 seulement vers le blanc —
      // au-delà la teinte disparaît.
      color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex(),
      transparent: true, opacity: opacity * LATTICE_RATIO, wireframe: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const lattice = new THREE.Mesh(geo2, mat2);

    const group = new THREE.Group();
    group.add(shell);
    group.add(lattice);
    group.position.set(center.x, 0.03, center.z);
    group.scale.setScalar(0.01);
    this.scene.add(group);

    let t = 0;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        group.scale.setScalar(t < growth ? Math.max(0.01, easeOutBack(t / growth)) : 1);
        lattice.rotation.y += dt * 1.3;
        const fade = t <= growth ? 1 : 1 - (t - growth) / Math.max(0.01, maxLife - growth);
        mat.opacity = opacity * Math.max(0, fade);
        mat2.opacity = opacity * LATTICE_RATIO * Math.max(0, fade);
        if (t >= maxLife) {
          this.scene.remove(group);
          geo.dispose(); mat.dispose();
          geo2.dispose(); mat2.dispose();
          return false;
        }
        return true;
      },
    });
  }

  // L'inverse de spawnBurst : les particules naissent sur un anneau et
  // convergent vers le centre. Soin (elles montent), Débuff et départ de
  // Téléportation (elles descendent, `sink`).
  spawnConvergence(pos: Position | THREE.Vector3, color: number, count = 30, opts: any = {}): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    // ⚠ Rayon par défaut LARGE : sous ~0,7 les particules naissent déjà sous la
    // carte CSS3D de l'unité et n'ont plus de trajet visible (cf. spawnDome).
    const { radius = 1.5, size = 0.1, maxLife = 0.45, height = 0.55, sink = false } = opts;
    const starts = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = radius * (0.55 + Math.random() * 0.45);
      const j = i * 3;
      starts[j]     = center.x + Math.cos(theta) * r;
      starts[j + 1] = center.y + (sink ? height * Math.random() : height * Math.random() * 0.5);
      starts[j + 2] = center.z + Math.sin(theta) * r;
      positions[j] = starts[j]; positions[j + 1] = starts[j + 1]; positions[j + 2] = starts[j + 2];
    }
    const endY = center.y + (sink ? -0.04 : height * 0.9);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    let t = 0;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        const p = Math.min(t / maxLife, 1);
        const e = p * p; // accélération vers le centre — l'aspiration se sent
        const arr = geo.attributes.position.array as unknown as Float32Array;
        for (let j = 0; j < arr.length; j += 3) {
          arr[j]     = THREE.MathUtils.lerp(starts[j], center.x, e);
          arr[j + 1] = THREE.MathUtils.lerp(starts[j + 1], endY, e);
          arr[j + 2] = THREE.MathUtils.lerp(starts[j + 2], center.z, e);
        }
        geo.attributes.position.needsUpdate = true;
        mat.opacity = Math.min(1, (1 - p) * 3);
        if (p >= 1) {
          this.scene.remove(points);
          geo.dispose(); mat.dispose();
          return false;
        }
        return true;
      },
    });
  }

  // Motes en orbite au-dessus d'une unité. `alive` fait vivre l'effet tant que
  // le statut dure (plutôt qu'une durée figée, qui mentirait dès que la vitesse
  // de combat change ou qu'un POWER_DEBUFF purge le statut) ; `followUid` lui
  // fait suivre la carte, qui se déplace pendant ce temps.
  spawnOrbit(pos: Position | THREE.Vector3, color: number, opts: any = {}): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const {
      count = 3, radius = 0.76, height = 0.6, speed = 3.4, size = 0.1,
      maxLife = 4, alive = null, followUid = null,
    } = opts;

    // Des MESHES et non des Points : trois particules de 0,12 se réduisent à
    // trois poussières illisibles à la distance de caméra du board, là où un
    // octaèdre garde une taille d'écran franche (mêmes glyphes que
    // spawnMagicCircle, qui se lisent très bien).
    const geo = new THREE.OctahedronGeometry(size, 0);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const motes: THREE.Mesh[] = [];
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const mote = new THREE.Mesh(geo, mat);
      group.add(mote);
      motes.push(mote);
    }
    this.scene.add(group);

    let t = 0;
    let fadeT = -1;
    let cx = center.x;
    let cz = center.z;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        if (followUid !== null) {
          const entry = this.unitObjs.get(followUid);
          if (entry) { cx = entry.obj.position.x; cz = entry.obj.position.z; }
        }
        if (fadeT < 0 && ((alive && !alive()) || t >= maxLife)) fadeT = 0;
        if (fadeT >= 0) fadeT += dt;

        for (let i = 0; i < count; i++) {
          const a = t * speed + (i / count) * Math.PI * 2;
          motes[i].position.set(
            cx + Math.cos(a) * radius,
            height + Math.sin(t * 2.4 + i) * 0.07,
            // 0.85 et non 0.55 : trop aplatie, l'orbite repasserait sous la carte.
            cz + Math.sin(a) * radius * 0.85,
          );
          motes[i].rotation.y += dt * 2.5;
          motes[i].rotation.x += dt * 1.7;
        }
        mat.opacity = fadeT >= 0 ? Math.max(0, 1 - fadeT / 0.3) : Math.min(1, t / 0.15);

        if (fadeT >= 0.3) {
          this.scene.remove(group);
          geo.dispose(); mat.dispose();
          return false;
        }
        return true;
      },
    });
  }

  // Amas de cristaux posé sur une case gelée. Il vit jusqu'à ce que son disposer
  // soit appelé (le cycle de vie `_frozenCells` de CombatAnimator3D), et reste
  // STATIQUE une fois poussé : une animation permanente forcerait une frame à
  // chaque tour de boucle et annulerait le rendu à la demande de `_animate`.
  // Décor d'une case bloquée par le terrain : un creux posé en retrait de la
  // dalle (qui donne la marche, donc la profondeur vue de dessus) et quelques
  // éclats de roche. Rend son disposer, comme spawnIceBlock.
  spawnBlockedDecor(pos: Position): () => void {
    const center = this.tilePosition(pos);
    const rand = cellRandom(pos.col, pos.row);
    const group = new THREE.Group();
    group.position.set(center.x, 0, center.z);

    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];

    // Le creux. Basic et non Standard : c'est un trou, l'éclairage de scène n'a
    // rien à y révéler — et une géométrie de tuile arrondie, pour épouser la
    // dalle au lieu de poser un disque dans un carré.
    const pitGeo = createRoundedTileGeo(CELL * 0.92 * BLOCKED_PIT_SCALE, 0.06);
    const pitMat = new THREE.MeshBasicMaterial({
      color: BLOCKED_PIT_COLOR, transparent: true, opacity: 0.88, depthWrite: false,
    });
    const pit = new THREE.Mesh(pitGeo, pitMat);
    // Au-dessus des deux hauteurs de dalle (0 en zone neutre, 0.01 côté joueur)
    // et sous les séparateurs dorés (0.07) : pas de z-fighting possible.
    pit.position.y = 0.015;
    group.add(pit);
    geos.push(pitGeo); mats.push(pitMat);

    // Les éclats. Un prisme à 5-6 faces donne une empreinte polygonale
    // irrégulière — la seule chose que la vue de dessus lit — et garde assez de
    // flanc pour que la clé dorée rasante le détache du creux.
    const rockMat = new THREE.MeshStandardMaterial({
      color: BLOCKED_ROCK_COLOR, roughness: 0.95, metalness: 0.04,
    });
    mats.push(rockMat);
    for (let i = 0; i < BLOCKED_ROCK_COUNT; i++) {
      const r = 0.09 + rand() * 0.07;
      const h = 0.10 + rand() * 0.12;
      const geo = new THREE.CylinderGeometry(r * (0.62 + rand() * 0.3), r, h, 5 + Math.floor(rand() * 2));
      geos.push(geo);
      const rock = new THREE.Mesh(geo, rockMat);
      const a = (i / BLOCKED_ROCK_COUNT) * Math.PI * 2 + rand() * 0.9;
      // Rayon borné : le décor ne doit jamais déborder sa case, une carte CSS3D
      // voisine le mangerait.
      const d = i === 0 ? rand() * 0.06 : 0.13 + rand() * 0.09;
      rock.position.set(Math.cos(a) * d, h / 2 + 0.016, Math.sin(a) * d);
      rock.rotation.y = rand() * Math.PI;
      // Basculement franc : des blocs tous d'aplomb se liraient comme des plots.
      rock.rotation.x = (rand() - 0.5) * 0.4;
      rock.rotation.z = (rand() - 0.5) * 0.4;
      group.add(rock);
    }

    this.scene.add(group);

    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      this._persistent.delete(dispose);
      this.scene.remove(group);
      for (const geo of geos) geo.dispose();
      for (const mat of mats) mat.dispose();
      this._invalidate();
    };
    this._persistent.add(dispose);

    // Émergence : la roche sort du sol au lieu d'apparaître. UNE SEULE fois —
    // l'anim se termine (return false) et la scène retombe en rendu à la demande.
    let t = 0;
    group.scale.set(1, 0.01, 1);
    this.anims.push({
      update: (dt: number) => {
        if (disposed) return false;
        t += dt;
        const g = Math.min(1, t / BLOCKED_RISE_S);
        group.scale.set(1, g, 1);
        return g < 1;
      },
    });
    this._invalidate();
    return dispose;
  }

  spawnIceBlock(pos: Position | THREE.Vector3): () => void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbfe9ff, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const geos: THREE.BufferGeometry[] = [];
    const group = new THREE.Group();
    group.position.set(center.x, 0.02, center.z);
    group.scale.set(1, 0.01, 1);
    for (let i = 0; i < 5; i++) {
      const h = 0.24 + Math.random() * 0.3;
      const geo = new THREE.ConeGeometry(0.08 + Math.random() * 0.06, h, 5);
      geos.push(geo);
      const spike = new THREE.Mesh(geo, mat);
      const a = (i / 5) * Math.PI * 2 + Math.random() * 0.7;
      const r = i === 0 ? 0 : 0.15 + Math.random() * 0.12;
      spike.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      spike.rotation.x = (Math.random() - 0.5) * 0.35;
      spike.rotation.z = (Math.random() - 0.5) * 0.35;
      group.add(spike);
    }
    this.scene.add(group);

    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      this._persistent.delete(dispose);
      this.scene.remove(group);
      for (const geo of geos) geo.dispose();
      mat.dispose();
      this._invalidate();
    };
    this._persistent.add(dispose);

    let t = 0;
    this.anims.push({
      update: (dt: number) => {
        if (disposed) return false;
        t += dt;
        const g = Math.min(1, t / 0.2);
        group.scale.set(1, g, 1);
        return g < 1;
      },
    });
    return dispose;
  }

  // Téléportation : la carte se rétracte, se REPOSE (pas de lerp — une
  // téléportation qui traverse le board est une marche), puis rejaillit.
  playBlink(uid: number, toPos: Position, outDur = 0.11, inDur = 0.15): void {
    const entry = this.unitObjs.get(uid);
    if (!entry) return;
    entry.pos = { ...toPos };
    const to = this.tilePosition(toPos);
    let t = 0;
    let moved = false;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        if (t < outDur) {
          entry.obj.scale.setScalar(CSS_SCALE * Math.max(0.001, 1 - t / outDur));
          return true;
        }
        if (!moved) {
          entry.obj.position.set(to.x, to.y, to.z);
          moved = true;
        }
        const p = Math.min((t - outDur) / inDur, 1);
        entry.obj.scale.setScalar(CSS_SCALE * Math.max(0.001, p));
        if (p >= 1) {
          entry.obj.scale.setScalar(CSS_SCALE);
          return false;
        }
        return true;
      },
    });
  }

  // ── Tuiles : couleurs/teintes ────────────────────────────────────────────

  _refreshTileColors(): void {
    for (const tile of this.tileMeshes) this._updateTileColor(tile);
    for (const entry of this.unitObjs.values()) this._applyUnitHighlightClasses(entry);
    this._invalidate();
  }

  _applyUnitHighlightClasses(entry: UnitEntry): void {
    const pos = entry.unit.position;
    const k = pos ? key(pos) : null;
    const el = entry.el;
    const wrap = entry.wrap;
    const isSelected = !!(pos && this._selectedPos && this._selectedPos.col === pos.col && this._selectedPos.row === pos.row);
    const isMatSelected = !!(k && this._materialSelected.has(k));
    const isMatCandidate = !!(k && this._materialCandidates.has(k));
    el.classList.toggle('selected', isSelected);
    el.classList.toggle('material-selected', isMatSelected);
    el.classList.toggle('material-complete', isMatSelected && this._materialsAllSelected);
    el.classList.toggle('material-candidate', isMatCandidate);

    // An inset box-shadow on the unit-card itself would be hidden behind its own
    // opaque artwork/gradient layers, so highlight via the CSS3D wrapper instead.
    if (isMatSelected) {
      wrap.style.boxShadow = `inset 0 0 0 ${HIGHLIGHT_RING_PX}px #ffffff`;
    } else if (isMatCandidate) {
      wrap.style.boxShadow = `inset 0 0 0 ${HIGHLIGHT_RING_PX}px #ff9833`;
    } else if (isSelected) {
      wrap.style.boxShadow = `inset 0 0 0 ${HIGHLIGHT_RING_PX}px var(--accent)`;
    } else {
      wrap.style.boxShadow = '';
    }
  }

  _updateTileColor(tile: THREE.Mesh): void {
    const { col, row, baseColor, baseEmissive = 0x000000, baseEmissiveIntensity = 0, isPlayer } = tile.userData as any;
    const k = `${col},${row}`;
    let color = baseColor;
    let emissive = baseEmissive;
    let intensity = baseEmissiveIntensity;
    // Une tuile n'est « voilée » (= son opacité compte) que sur le bloc joueur,
    // ou partout dès qu'un fond de terrain est posé. Sans ça les états ci-dessous
    // resteraient invisibles hors du bloc joueur — or les cases bloquées d'un
    // terrain tombent justement en zone neutre.
    const veiled = isPlayer || this._terrainActive;
    // Avec un fond, les trois zones passent au même voile : les différencier par
    // l'opacité créerait une couture horizontale en travers de l'illustration.
    // C'est la couleur des tuiles (joueur/neutre sombres, ennemi rosé) qui porte
    // seule la lecture des zones.
    const veilOpacity = this._terrainModelActive ? TERRAIN_MODEL_TILE_OPACITY : TERRAIN_TILE_OPACITY;
    let opacity = this._terrainActive ? veilOpacity : (isPlayer ? 0.04 : 1.0);

    if (this._highlighted.has(k)) {
      color = 0x1a2a54; emissive = 0x9d74dc; intensity = 0.4;
      if (veiled) opacity = 0.38;
    }
    if (this._materialCandidates.has(k)) {
      emissive = 0xcba85a; intensity = 0.38;
      if (veiled) opacity = 0.32;
    }
    if (this._materialSelected.has(k)) {
      color = 0x2a3060; emissive = 0xecd7a2; intensity = 0.45;
      if (veiled) opacity = 0.42;
    }
    if (this._selectedPos && this._selectedPos.col === col && this._selectedPos.row === row) {
      color = 0x1a2a54; emissive = 0xbd9df0; intensity = 0.65;
      if (veiled) opacity = 0.48;
    }
    // Le survol d'un glisser passe APRÈS les quatre états ci-dessus — c'est le
    // plus vif, parce que c'est le seul qui suive le doigt : il doit se voir sur
    // une case déjà allumée comme sur une case éteinte. Et AVANT les deux cas
    // suivants, qui sont des faits de terrain : une case bloquée ne doit pas
    // s'allumer sous le doigt, elle n'acceptera rien.
    if (this._hoverCell === k) {
      color = 0x243a70; emissive = 0xffd98a; intensity = 0.85;
      if (veiled) opacity = 0.6;
    }
    if (this._blockedCells.has(k)) {
      // Pierre sombre et AUCUNE emissive : les cinq états au-dessus sont des
      // retours d'UI (survol, matériau, sélection) et s'annoncent par une lueur.
      // Une case bloquée est un fait de terrain, pas un retour à un geste.
      color = BLOCKED_LEDGE_COLOR; emissive = 0x000000; intensity = 0;
      // Sous un modèle 3D, le relief EST la case bloquée : pas de dalle opaque.
      if (veiled) opacity = this._terrainModelActive ? veilOpacity : BLOCKED_LEDGE_OPACITY;
    }
    // Après le cas générique : une case gelée EST bloquée, mais le rouge des
    // cases bloquées d'un terrain mentirait sur ce qui vient de s'y passer.
    if (this._frozenCells.has(k)) {
      color = 0x123a4e; emissive = 0x8fd6ff; intensity = 0.45;
      if (veiled) opacity = 0.58;
    }

    const mat = tile.material as THREE.MeshStandardMaterial;
    mat.color.setHex(color);
    mat.emissive.setHex(emissive);
    mat.emissiveIntensity = intensity;
    mat.opacity = veiled ? opacity : 1;
  }

  // ── Unités CSS3D ──────────────────────────────────────────────────────────

  /**
   * L'opacité d'une unité hors combat. Les SURVIVANTS adverses restent visibles
   * en préparation, en fantôme : le joueur les a vus combattre, et c'est contre
   * eux qu'il place. Les poses du tour adverse restent cachées (en solo l'IA
   * place au PRÊT, en PvP le board adverse n'arrive qu'à `round:go`), et ses
   * neutralisés ne s'affichent pas.
   */
  _visibilityFor(unit: Unit): number {
    if (this._combatMode || this.showEnemySide || unit.side === 'player') return 1;
    return unit.is_neutralized ? 0 : ENEMY_PREP_OPACITY;
  }

  // Rejoue une classe d'animation CSS depuis le début (retire puis pose,
  // séparés par un reflow forcé) — même geste que `CombatAnimator3D._flashClass`,
  // ici pour le flash de coup que `melee.onHit` déclenche directement sur la
  // carte cible, sans détour par l'animateur.
  _flashClass(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }

  // L'acteur que `spawns`/`melee`/`shatter` manipulent, mis en cache sur
  // l'entrée elle-même — cf. le commentaire de `SceneActor`.
  _actorFor(entry: UnitEntry): SceneActor {
    if (entry._actor) return entry._actor;
    // `home`/`baseQuat` en accesseurs plutôt qu'en champs : des flèches, pour
    // fermer sur le `this` de CETTE méthode (Scene3D) sans l'aliaser — un
    // accesseur d'objet littéral (`get home() {}`) lierait `this` à l'acteur
    // lui-même, pas à la scène.
    const actor = {
      obj: entry.obj,
      baseScale: CSS_SCALE,
      forward: entry.forward,
      dom: { wrap: entry.wrap, card: entry.el, flash: entry.el.querySelector<HTMLDivElement>('.unit-fx-flash') },
      entry,
      setOpacity: (a: number) => { entry.wrap.style.opacity = String(a); },
    } as SceneActor;
    Object.defineProperties(actor, {
      home: { get: () => this.tilePosition(entry.pos) },
      baseQuat: { get: () => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, this._camAngle)) },
      // Lus par `Powers.js` seul (cf. `SceneActor`) — en accesseurs pour les
      // mêmes raisons que `home` : `col`/`row` et `tier` (vétérance à part,
      // `Unit.tier` ne bouge pas) suivent l'entrée plutôt qu'une valeur figée
      // au premier appel, qui deviendrait fausse au premier déplacement.
      col: { get: () => entry.pos.col },
      row: { get: () => entry.pos.row },
      tier: { get: () => entry.unit.tier ?? 1 },
      el: { get: () => entry.elements },
      side: { get: () => entry.unit.side },
      range: { get: () => entry.unit.range ?? 3 },
      uid: { get: () => entry.unit.uid },
      hp: { get: () => entry.unit.max_hp > 0 ? entry.unit.current_hp / entry.unit.max_hp : 0 },
    });
    entry._actor = actor;
    return entry._actor;
  }

  // delay : retarde l'apparition (l'unité reste invisible en attendant) —
  // utilisé pour échelonner l'apparition des unités de l'IA au lancement du
  // combat. L'entrée du décor (chute, éruption, éclair…) et l'impact de tier
  // sont ceux de `UnitSpawns`, choisis par l'élément de la carte.
  _spawnUnitObj(unit: Unit, delay = 0): UnitEntry {
    const pos = unit.position as Position;
    const wrap = document.createElement('div');
    wrap.style.width = CARD_PX + 'px';
    wrap.style.height = CARD_PX + 'px';
    wrap.style.borderRadius = '6px';
    wrap.style.overflow = 'visible';
    wrap.style.pointerEvents = 'none';
    wrap.style.opacity = String(this._visibilityFor(unit));
    wrap.className = 'poc3d-card-wrap';
    const el = createUnitEl(unit);
    wrap.appendChild(el);

    const obj = new CSS3DObject(wrap);
    // CSS3DObject force pointer-events: auto sur l'élément — on l'annule pour
    // que tous les pointer events passent par le canvas WebGL (raycasting).
    wrap.style.pointerEvents = 'none';
    obj.rotation.set(-Math.PI / 2, 0, this._camAngle);
    obj.position.set(xForCol(pos.col), 0.06, zForRow(pos.row));
    obj.scale.setScalar(CSS_SCALE);
    this.cssScene.add(obj);

    const elements = elementsForUnit(unit);
    // Vers le camp d'en face — cf. `UnitEntry.forward` : ne dépend que du côté,
    // jamais de la case (le repère est toujours celui du joueur en bas, quel
    // que soit le rôle réseau — cf. « L'asymétrie… » dans CLAUDE.md).
    const forward = new THREE.Vector3(0, 0, unit.side === 'player' ? -1 : 1);
    const entry: UnitEntry = { unit, obj, wrap, el, pos: { ...pos }, elements, forward };
    this._applyUnitHighlightClasses(entry);

    this.spawns.spawn(this._actorFor(entry), elements, { tier: unit.tier ?? 1, delay });

    return entry;
  }

  /**
   * Ajoute la carte visuelle d'UNE unité apparue en PLEIN COMBAT —
   * POWER_SUMMON_TOKEN, seul cas où `board.grid` grossit après le début du
   * combat. `refresh()` ne peut pas la voir : il ne repasse plus une fois en
   * mode combat (cf. son en-tête). `revealEnemyUnits` ne convient pas non
   * plus : c'est un balayage de tout un camp au lancement du combat, avec
   * purge des unités disparues — un ajout ponctuel n'a besoin ni de l'un ni
   * de l'autre. Sans cette carte, le token existe bien dans la simulation
   * (il combat, encaisse, peut mourir) mais reste invisible à l'écran.
   */
  spawnUnit(unit: Unit): void {
    if (this.unitObjs.has(unit.uid)) return;
    this.unitObjs.set(unit.uid, this._spawnUnitObj(unit));
    this._invalidate();
  }

  // Synchronise le côté ennemi hors du cycle refresh() (qui ne passe plus en
  // mode combat) : en solo l'IA place ses unités APRÈS le PRÊT du joueur, donc
  // une fois la caméra déjà en combat. Les unités nouvellement invoquées
  // tombent en cascade (animation d'apparition), les survivants déjà à l'écran
  // se contentent de rejoindre leur nouvelle case (rearrangeUnits les déplace).
  // Retourne la durée totale (ms) de la cascade, pour retarder le combat.
  //
  // ⚠️ C'est une SYNCHRO, pas un simple ajout : le tour de l'IA peut aussi FAIRE
  // DISPARAÎTRE des unités du board (un survivant consommé comme matériau de
  // sacrifice/fusion/héritage, remplacé par une transformation, ou écarté par le
  // plafond de slots de rearrangeUnits). Ces unités-là ont déjà un objet de
  // scène hérité du round précédent ; sans la purge ci-dessous, leur carte reste
  // affichée pendant tout le combat alors qu'elles ne sont plus dans
  // `board.grid` — un fantôme qui n'attaque pas, ne bouge pas et n'est pas
  // ciblable, et que seul le refresh() de exitCombatMode finit par balayer.
  revealEnemyUnits(units: Unit[]): number {
    const seen = new Set<number>();
    let spawned = 0;
    // Le pire achèvement de la cascade, pas juste celui du dernier arrivé :
    // depuis que la durée d'apparition dépend de l'élément (`UnitSpawns`), une
    // Sorcellerie arrivée plus tôt peut finir de se poser après un Feu arrivé
    // après elle. `estimateDuration` répond à la même question que `spawn()`,
    // sans lancer l'action.
    let finishS = 0;
    for (const unit of units) {
      const pos = unit.position;
      if (!pos) continue;
      seen.add(unit.uid);
      const entry = this.unitObjs.get(unit.uid);
      if (entry) {
        if (entry.pos.col !== pos.col || entry.pos.row !== pos.row) {
          this._animateMove(entry, pos);
          entry.pos = { ...pos };
        }
        continue;
      }
      const delaySec = SPAWN_LEAD_S + spawned * SPAWN_STAGGER_S;
      this.unitObjs.set(unit.uid, this._spawnUnitObj(unit, delaySec));
      const settleS = this.spawns.estimateDuration(elementsForUnit(unit), unit.tier ?? 1);
      finishS = Math.max(finishS, delaySec + settleS);
      // Le son suit la CASCADE, pas le tir groupé : chaque unité ennemie sonne
      // à l'instant précis où elle apparaît, comme sa propre chute.
      setTimeout(() => Audio.playSfx('summon', { tier: unit.tier ?? undefined }), delaySec * 1000);
      spawned++;
    }
    // Purge des unités ennemies qui ont quitté le board. Retrait franc
    // (_removeUnitObj) et non killUnitObj : elles n'ont pas été tuées — une
    // explosion de mort avant le premier coup mentirait sur ce qui s'est passé.
    // Le côté joueur n'est jamais touché ici : il reste géré par refresh().
    for (const [uid, entry] of [...this.unitObjs.entries()]) {
      if (entry.unit.side !== 'enemy' || seen.has(uid)) continue;
      this._removeUnitObj(entry);
      this.unitObjs.delete(uid);
    }
    this._invalidate();
    return spawned === 0 ? 0 : finishS * 1000;
  }

  animateUnitMove(uid: number, toPos: Position, duration = 0.28): void {
    const entry = this.unitObjs.get(uid);
    if (!entry) return;
    entry.pos = { ...toPos };
    this._animateMove(entry, toPos, duration);
  }

  removeUnitObj(uid: number): void {
    const entry = this.unitObjs.get(uid);
    if (!entry) return;
    this._removeUnitObj(entry);
    this.unitObjs.delete(uid);
  }

  killUnitObj(uid: number): void {
    const entry = this.unitObjs.get(uid);
    if (!entry) return;
    this.unitObjs.delete(uid);
    if (entry.obj.position.x === undefined) { this.cssScene.remove(entry.obj); return; }

    const actor = this._actorFor(entry);
    // Une unité peut mourir en pleine apparition (invocation et mort dans le
    // même tick) ou en plein élan de corps-à-corps (attaque partie plus tôt,
    // retour pas terminé) : sans l'annulation, la carte continuerait de
    // charger/frapper/revenir sur un objet 3D que la fissure remplace déjà.
    this.spawns.cancel(actor);
    this.melee.cancel(actor);

    const elements = entry.elements && entry.elements.length ? entry.elements : ['neutral'];
    const tier = Math.max(1, Math.min(5, entry.unit.tier ?? 1));
    this.shatter.shatter(actor, elements, { tier });
  }

  /**
   * La frappe finale : les survivants d'un camp s'élancent ENSEMBLE vers le
   * camp d'en face, en éventail, et leur charge se solde d'un éclat sur la
   * ligne adverse. C'est le geste qui porte les dégâts de fin de combat, ceux
   * que le récapitulatif chiffre ensuite.
   *
   * ⚠️ L'origine est la position de l'OBJET, jamais celle de l'unité :
   * `finishCombat` vient de ramener les survivants à leur `initial_position`
   * alors que leurs cartes sont encore là où le combat les a laissées (le
   * `refresh()` qui les range n'a lieu qu'à `exitCombatMode`). Lire
   * `unit.position` ferait donc sauter chaque carte à son point de départ avant
   * de s'élancer — c'est exactement la faute que `playLunge` ne peut pas
   * commettre, lui qui joue au milieu du combat.
   *
   * ⚠️ Un `uid` sans carte à l'écran est ignoré en silence : c'est le cas normal
   * d'une unité réanimée par un attribut, dont `killUnitObj` a déjà emporté la
   * carte à sa mort.
   */
  playFinalStrike(uids: number[], toward: 'player' | 'enemy'): void {
    // Le SENS de la charge : vers le fond du camp d'en face. Il se dérive de
    // `zForRow` plutôt que d'être écrit en dur — celui-ci range les rangées à
    // l'envers de leur numéro, et une constante recopiée ici ferait charger les
    // deux camps à reculons le jour où il changerait d'avis. Le plateau est
    // toujours dans le même sens à l'écran (joueur en 0–3, adversaire en 7–10),
    // miroir du rôle B compris : celui-ci ne change que le repère de la
    // SIMULATION.
    const rowDir = Math.sign(zForRow(TOTAL_ROWS - 1) - zForRow(0)) * (toward === 'enemy' ? 1 : -1);
    let struck = 0;
    for (const uid of uids) {
      const entry = this.unitObjs.get(uid);
      if (!entry) continue;
      const homeX = entry.obj.position.x;
      const homeZ = entry.obj.position.z;
      const reachZ = homeZ + rowDir * FINAL_STRIKE_REACH_CELLS * CELL;
      const delay = struck * FINAL_STRIKE_STAGGER_S;
      const color = (ELEMENT_STYLES[elementsForUnit(entry.unit)[0]] || ELEMENT_STYLES.neutral).color;
      struck++;
      let t = -delay;
      let flashed = false;
      this.anims.push({
        update: (dt: number) => {
          t += dt;
          if (t < 0) return true;
          const p = Math.min(t / FINAL_STRIKE_S, 1);
          // Élan bref puis retour : même courbe que `playLunge`, en plus ample.
          const f = p < 0.35 ? p / 0.35 : (1 - p) / 0.65;
          entry.obj.position.z = THREE.MathUtils.lerp(homeZ, reachZ, f);
          if (!flashed && p >= 0.35) {
            flashed = true;
            const impact = new THREE.Vector3(homeX, 0.06, reachZ);
            this.spawnRing(impact, color, 0.34, 4);
            this.spawnBurst(impact, color, LOW_END_DEVICE ? 10 : 24, {
              size: 0.05, speed: [0.5, 1.1], lift: [0.4, 0.9], gravity: 7, maxLife: 0.3,
            });
            // La frappe finale n'est PAS un événement `attack` de CombatManager
            // (c'est un flourish cosmétique, hors simulation) : le son ne partait
            // donc jamais ici. Il suit le même timing que l'impact visuel —
            // l'échelonnement (`FINAL_STRIKE_STAGGER_S`) inclus, un par survivant.
            Audio.playSfx('attack', { element: primaryElementOf(entry.unit.attributes) ?? undefined });
          }
          if (p >= 1) { entry.obj.position.z = homeZ; return false; }
          return true;
        },
      });
    }
    if (struck === 0) return;
    // Une secousse, et une seule pour toute la charge : le camp d'en face vient
    // d'encaisser d'un bloc, pas une fois par survivant.
    this.shakeCamera(this._camH * 0.03, 0.34);
    this._invalidate();
  }

  playLunge(uid: number, towardPos: Position): void {
    const entry = this.unitObjs.get(uid);
    if (!entry) return;
    const home = this.tilePosition(entry.unit.position as Position);
    const target = this.tilePosition(towardPos);
    const lungeX = THREE.MathUtils.lerp(home.x, target.x, 0.3);
    const lungeZ = THREE.MathUtils.lerp(home.z, target.z, 0.3);
    let t = 0;
    const duration = 0.25;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        const p = Math.min(t / duration, 1);
        const f = p < 0.5 ? p * 2 : (1 - p) * 2;
        entry.obj.position.x = THREE.MathUtils.lerp(home.x, lungeX, f);
        entry.obj.position.z = THREE.MathUtils.lerp(home.z, lungeZ, f);
        return p < 1;
      },
    });
  }

  /**
   * Attaque au corps à corps (`MeleeStrikes`) : approche selon l'élément de
   * l'attaquant, N coups selon son tier (chacun un tranchant `EnergyArrows` qui
   * pose son propre impact), retour. Résout quand l'unité est revenue à sa
   * place — `CombatAnimator3D` ne s'en sert pas pour enchaîner (fire-and-forget,
   * comme `playProjectile`), la décoration du coup se fait au vol via
   * `melee.onHit` (posé à la construction).
   */
  playMeleeStrike(attackerUid: number, targetUid: number, elements: string[], tier: number): Promise<void> {
    const atkEntry = this.unitObjs.get(attackerUid);
    const tgtEntry = this.unitObjs.get(targetUid);
    if (!atkEntry || !tgtEntry) return Promise.resolve();
    return this.melee.strike(this._actorFor(atkEntry), this._actorFor(tgtEntry), elements, { tier });
  }

  /**
   * Répercute le multiplicateur ×1/×2/×4 de `CombatAnimator3D.setSpeed` sur la
   * frappe au corps à corps, l'apparition et la destruction : leurs durées se
   * divisent déjà par `globals.speed` en interne, mais rien ne le réglait —
   * une frappe gardait donc sa durée « temps réel » pendant qu'à vitesse ×4
   * les ticks de jeu, eux, s'enchaînaient quatre fois plus vite, ce qui
   * creusait un retard croissant entre le combat et ce qu'on en voit.
   *
   * La destruction reçoit en plus un budget `power` réduit à vitesse ×2/×4 et
   * sur un appareil modeste — même geste que `PowerVfx.applyGlobals` sur
   * `scene.powers` : plus d'unités meurent par seconde réelle à vitesse
   * accélérée, donc chaque explosion (particules, distance de projection des
   * éclats, secousse) doit peser moins pour que le total reste stable.
   */
  setAnimSpeed(speed: number): void {
    this.melee.setGlobals({ speed });
    this.spawns.setGlobals({ speed });
    const power = (LOW_END_DEVICE ? 0.5 : 1) * Math.max(0.55, Math.min(1, 1 / Math.max(0.1, speed)));
    this.shatter.setGlobals({ speed, power });
  }

  /**
   * Coupe court à toute frappe au corps à corps encore en vol ou en file —
   * appelé quand le combat se termine : les ticks de jeu s'arrêtent net, et
   * une frappe en retard continuerait sinon d'animer sous le récapitulatif.
   */
  finishMeleeStrikes(): void {
    this.melee.finishAll();
  }

  _animateMove(entry: UnitEntry, toPos: Position, duration = 0.28): void {
    const from = entry.obj.position.clone();
    const to = this.tilePosition(toPos);
    let t = 0;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        const p = Math.min(t / duration, 1);
        entry.obj.position.x = THREE.MathUtils.lerp(from.x, to.x, p);
        entry.obj.position.z = THREE.MathUtils.lerp(from.z, to.z, p);
        entry.obj.position.y = THREE.MathUtils.lerp(from.y, to.y, p);
        return p < 1;
      },
    });
  }

  _removeUnitObj(entry: UnitEntry): void {
    let t = 0;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        const s = Math.max(0, 1 - t / 0.2);
        entry.obj.scale.setScalar(CSS_SCALE * s);
        if (s <= 0) {
          this.cssScene.remove(entry.obj);
          return false;
        }
        return true;
      },
    });
  }

  _fadeEntry(entry: UnitEntry, show: boolean): void {
    const from = parseFloat(entry.wrap.style.opacity || '1');
    const to = show ? 1 : this._visibilityFor(entry.unit);
    if (from === to) return;
    let t = 0;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        const p = Math.min(t / 0.3, 1);
        entry.wrap.style.opacity = String(THREE.MathUtils.lerp(from, to, p));
        return p < 1;
      },
    });
  }

  // ── Interaction (raycasting) ─────────────────────────────────────────────

  /**
   * La case sous un point de l'ÉCRAN, ou `null` hors du plateau.
   *
   * Publique parce que le glisser-déposer d'une carte de main en a besoin : le
   * geste part d'un élément React, pas du canvas, donc il ne peut pas passer
   * par les écouteurs de la scène. C'est la SEULE chose que ce lot ajoute côté
   * `three/` — le reste du glisser se solde par `onCellTap`, exactement comme
   * un tap sur le plateau.
   */
  cellAtScreen(clientX: number, clientY: number): Position | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (!this._raycaster) this._raycaster = new THREE.Raycaster();
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this.tileMeshes);
    if (!hits.length) return null;
    const { col, row } = hits[0].object.userData as any;
    return { col, row };
  }

  _cellFromEvent(e: PointerEvent): Position | null {
    return this.cellAtScreen(e.clientX, e.clientY);
  }

  _entryAt(pos: Position | null): UnitEntry | null {
    if (!pos) return null;
    for (const entry of this.unitObjs.values()) {
      const p = entry.unit.position;
      if (p && p.col === pos.col && p.row === pos.row) return entry;
    }
    return null;
  }

  // Fallback hit-test: pick the unit whose CSS3D card center is closest to the
  // tap point on screen, within roughly half a cell.
  _unitNear(clientX: number, clientY: number): UnitEntry | null {
    let best: UnitEntry | null = null;
    let bestDist = Infinity;
    for (const entry of this.unitObjs.values()) {
      const pos = entry.unit.position;
      if (!pos) continue;
      const screen = this.worldToScreen(this.tilePosition(pos));
      const dist = Math.hypot(screen.x - clientX, screen.y - clientY);
      if (dist < bestDist) { bestDist = dist; best = entry; }
    }
    if (!best) return null;
    const cellPx = this.worldToScreen(this.tilePosition({ col: 1, row: 0 })).x
      - this.worldToScreen(this.tilePosition({ col: 0, row: 0 })).x;
    return bestDist <= Math.abs(cellPx) * 0.6 ? best : null;
  }

  _bindPointerEvents(): void {
    const el = this.renderer.domElement;
    this._pointerState = null;

    this._onPointerDown = (e: PointerEvent) => {
      let cell = this._cellFromEvent(e);
      const entry = (cell && this._entryAt(cell)) || this._unitNear(e.clientX, e.clientY);
      if (entry) cell = { ...(entry.unit.position as Position) };
      // ⚠️ Un appui hors du plateau n'est pas un tap, mais il peut DÉFILER la
      // vue de préparation : l'état est donc créé sans case.
      if (!cell && this._combatMode) return;
      const state: any = {
        cell, entry,
        startX: e.clientX, startY: e.clientY,
        dragging: false,
        panning: false,
        panFrom: this._prepView,
        longPressTimer: null,
      };
      if (entry && this.onUnitLongPress) {
        state.longPressTimer = setTimeout(() => {
          state.longPressTimer = null;
          if (!state.dragging) {
            const screen = this.worldToScreen(entry.obj.position.clone());
            const top = screen.y - CARD_PX / 2;
            const rect = { left: screen.x - CARD_PX / 2, top, bottom: top + CARD_PX, width: CARD_PX, height: CARD_PX };
            this.onUnitLongPress!(entry.unit, cell as Position, rect);
            this._pointerState = null;
          }
        }, 500);
      }
      this._pointerState = state;
    };

    this._onPointerMove = (e: PointerEvent) => {
      const state = this._pointerState;
      if (!state) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      // DÉFILEMENT de la vue de préparation : un glisser vertical parti d'une
      // case VIDE (ou d'hors du plateau). Une unité sous le doigt se déplace,
      // elle ne fait pas défiler. Seuil de 8 px pour ne pas voler un tap.
      // ⚠️ Un fantôme adverse (survivant visible en préparation) ne se déplace
      // pas : un glisser parti de lui fait défiler, comme une case vide.
      if ((!state.entry || state.entry.unit.side !== 'player') && !this._combatMode) {
        if (!state.panning && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          state.panning = true;
          if (state.longPressTimer) { clearTimeout(state.longPressTimer); state.longPressTimer = null; }
        }
        if (state.panning) {
          const h = this.container.clientHeight || 1;
          this.setPrepView(state.panFrom + dy / (h * 0.6));
        }
        return;
      }
      if (!state.dragging && state.entry && Math.hypot(dx, dy) > 10) {
        if (this._combatMode) return;
        state.dragging = true;
        state.entry.el.classList.add('dragging');
        if (state.longPressTimer) { clearTimeout(state.longPressTimer); state.longPressTimer = null; }
      }
      if (state.dragging) {
        const cell = this._cellFromEvent(e);
        if (cell) {
          state.hoverCell = cell;
          const t = this.tilePosition(cell);
          state.entry.obj.position.set(t.x, 0.3, t.z);
          this._invalidate();
        }
      }
    };

    this._onPointerUp = (e: PointerEvent) => {
      void e;
      const state = this._pointerState;
      if (!state) return;
      this._pointerState = null;
      if (state.longPressTimer) clearTimeout(state.longPressTimer);
      if (state.dragging && state.entry) state.entry.el.classList.remove('dragging');
      if (state.panning || !state.cell) return;

      if (state.dragging && state.entry) {
        const dropCell = state.hoverCell || state.cell;
        this.onUnitDrag(state.entry.unit, state.cell, dropCell);
        return;
      }
      if (state.entry) {
        const screen = this.worldToScreen(state.entry.obj.position.clone());
        const top = screen.y - CARD_PX / 2;
        const rect = { left: screen.x - CARD_PX / 2, top, bottom: top + CARD_PX, width: CARD_PX, height: CARD_PX };
        this.onUnitTap(state.entry.unit, state.cell, rect);
        return;
      }
      this.onCellTap(state.cell);
    };

    // La molette fait défiler la vue de préparation (vers le haut = vers le
    // camp adverse), comme le glisser au doigt.
    this._onWheel = (e: WheelEvent) => {
      if (this._combatMode) return;
      this.setPrepView(this._prepView - e.deltaY * 0.0015);
    };
    el.addEventListener('wheel', this._onWheel, { passive: true });
    el.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  // ── Boucle de rendu / resize ─────────────────────────────────────────────

  _bindResize(): void {
    this._resizeHandler = () => this._resize();
    window.addEventListener('resize', this._resizeHandler);
    if (window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(this._resizeHandler);
      this._resizeObserver.observe(this.container);
    }
  }

  _resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.cssRenderer.setSize(w, h);
    this.fxRenderer.setSize(w, h);
    this.fx.setViewport(h * this.fxRenderer.getPixelRatio());
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._setCameraImmediate(this._combatMode);
  }

  _animate(): void {
    if (!this._running) return;
    requestAnimationFrame(() => this._animate());

    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    if (w !== this._lastW || h !== this._lastH) {
      this._lastW = w;
      this._lastH = h;
      this._resize();
    }

    const now = performance.now();
    if (!this._lastTime) this._lastTime = now;
    const dt = Math.min((now - this._lastTime) / 1000, 0.05);
    this._lastTime = now;

    // Un projectile EnergyArrows en vol, ou ses particules/anneaux d'impact
    // encore visibles après que son propre `activeCount` soit retombé à 0
    // (rings/timers d'impact continuent après la fin du vol) : tant que l'un
    // des trois compte, il faut mettre à jour ET rendre le calque FX.
    const fxActive = this.fx.activeCount > 0 || this.fx.pAdd.n > 0 || this.fx.pNorm.n > 0
      || this.fx.rings.length > 0 || this.fx.timers.length > 0;
    // Apparition, frappe au corps à corps, destruction — pilotent `cssScene`
    // directement (déjà rendue à chaque frame active), mais doivent forcer
    // cette activité et être avancées comme `anims`/`bursts`.
    // ⚠️ `melee.states.size`, pas `melee.activeCount` : ce dernier ne compte
    // que les coups en cours, pas le recul (`kicks`) d'une cible qui vient
    // d'en encaisser un — un recul qu'on cesse d'avancer se figerait à mi-course.
    const unitFxActive = this.spawns.activeCount > 0 || this.melee.states.size > 0 || this.shatter.activeCount > 0;
    // Pouvoirs : un statut persistant (brûlé, empoisonné…) doit continuer à
    // émettre des particules même sur une frame où le pool venait de retomber
    // à 0 entre deux pulses — `fxActive` seul flancherait par intermittence.
    // Un tween de recette en cours (`anims`, cf. `Powers.pose`/`nudge`) compte
    // de la même façon : lui aussi doit continuer d'avancer sans particule
    // visible à l'instant T.
    const powersActive = this.powers.activeCount > 0 || this.powers.status.size > 0;

    // Rendu à la demande : rien d'actif et rien d'invalidé → on saute la frame.
    const active = this.anims.length > 0 || this.bursts.length > 0 || this._shake !== null || this._needsRender || fxActive || unitFxActive || powersActive || this._terrainAnim !== null;
    if (!active) return;
    this._needsRender = false;
    this._terrainAnim?.update(now / 1000);

    // Powers AVANT fx : les particules qu'un statut vient d'émettre cette
    // frame profitent tout de suite de l'intégration de position de `fx.update`.
    if (fxActive || powersActive) this.powers.update(dt);
    if (fxActive) this.fx.update(dt);
    if (unitFxActive) { this.spawns.update(dt); this.melee.update(dt); this.shatter.update(dt); }

    this.anims = this.anims.filter((a) => a.update(dt));

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      const p = Math.min(b.life / b.maxLife, 1);
      if (b.orbit) {
        // Tornade : position recalculée chaque frame en coordonnées polaires.
        const o = b.orbit;
        const arr = b.points.geometry.attributes.position.array;
        for (let i2 = 0, j = 0; j < arr.length; i2++, j += 3) {
          const localLife = Math.max(0, b.life - (o.echoDelay?.[i2] ?? 0));
          const angle = o.baseAngle[i2] + localLife * o.rotSpeed[i2];
          const radius = Math.min(o.baseRadius[i2] + localLife * o.expandSpeed[i2], o.maxRadius[i2]);
          const height = Math.min(localLife * o.riseSpeed[i2], o.maxHeight[i2]);
          arr[j]     = o.center.x + Math.cos(angle) * radius;
          arr[j + 1] = o.center.y + height;
          arr[j + 2] = o.center.z + Math.sin(angle) * radius;
        }
        b.points.geometry.attributes.position.needsUpdate = true;
        b.points.material.opacity = 1 - p;
      } else if (b.points) {
        const gravity = b.gravity ?? 6;
        const spin = b.spin ?? 0;
        const arr = b.points.geometry.attributes.position.array;
        for (let j = 0; j < arr.length; j += 3) {
          if (spin) {
            const angle = spin * dt;
            const vx = b.velocities[j];
            const vz = b.velocities[j + 2];
            b.velocities[j]     = vx * Math.cos(angle) - vz * Math.sin(angle);
            b.velocities[j + 2] = vx * Math.sin(angle) + vz * Math.cos(angle);
          }
          arr[j]     += b.velocities[j] * dt;
          arr[j + 1] += (b.velocities[j + 1] - gravity * b.life) * dt;
          arr[j + 2] += b.velocities[j + 2] * dt;
        }
        b.points.geometry.attributes.position.needsUpdate = true;
        b.points.material.opacity = 1 - p;
      }
      if (b.ring) {
        const scale = (b.startScale ?? 1) + p * (b.maxScale ?? 6);
        b.ring.scale.set(scale, scale, scale);
        b.ring.material.opacity = 0.9 * (1 - p);
      }
      if (b.light) {
        b.light.intensity = (b.maxIntensity ?? 4) * (1 - p);
      }
      if (b.lines) {
        const flicker = 0.5 + Math.random() * 0.5;
        for (const line of b.lines) {
          line.material.opacity = line.userData.baseOpacity * flicker * (1 - p);
        }
      }
      if (b.group) {
        for (const r of b.rings) r.mesh.rotation.z += r.spin * dt;
        b.group.rotation.y += b.glyphSpin * dt;
        const fadeIn = Math.min(b.life / 0.15, 1);
        const opacity = fadeIn * (1 - p);
        for (const r of b.rings) r.mesh.material.opacity = 0.85 * opacity;
        for (const g of b.glyphs) g.material.opacity = 0.95 * opacity;
      }
      if (b.slashes) {
        const grow = 1 + p * 0.4;
        for (const s of b.slashes) {
          s.scale.set(grow, 1, grow);
          s.material.opacity = 0.95 * (1 - p);
        }
      }
      if (b.rocks) {
        const gravity = b.gravity ?? 9;
        const fadeStart = 0.7;
        for (const r of b.rocks) {
          r.vel.y -= gravity * dt;
          r.mesh.position.addScaledVector(r.vel, dt);
          if (r.mesh.position.y < 0.04) {
            r.mesh.position.y = 0.04;
            if (!r.bounced && r.vel.y < 0) {
              r.bounced = true;
              r.vel.y *= -0.35;
              r.vel.x *= 0.5;
              r.vel.z *= 0.5;
            } else {
              r.vel.set(0, 0, 0);
            }
          }
          r.mesh.rotation.x += r.angVel.x * dt;
          r.mesh.rotation.y += r.angVel.y * dt;
          r.mesh.rotation.z += r.angVel.z * dt;
          if (p > fadeStart) {
            r.mesh.material.opacity = 1 - (p - fadeStart) / (1 - fadeStart);
          }
        }
      }
      if (p >= 1) {
        if (b.light) {
          this.scene.remove(b.light);
        } else if (b.lines) {
          for (const line of b.lines) {
            this.scene.remove(line);
            line.geometry.dispose();
            line.material.dispose();
          }
        } else if (b.rocks) {
          for (const r of b.rocks) {
            this.scene.remove(r.mesh);
            r.mesh.geometry.dispose();
            r.mesh.material.dispose();
          }
        } else if (b.slashes) {
          for (const s of b.slashes) {
            this.scene.remove(s);
            s.geometry.dispose();
            s.material.dispose();
          }
        } else if (b.group) {
          for (const r of b.rings) {
            r.mesh.geometry.dispose();
            r.mesh.material.dispose();
          }
          for (const g of b.glyphs) {
            g.geometry.dispose();
            g.material.dispose();
          }
          this.scene.remove(b.group);
        } else {
          const obj = b.points || b.ring;
          this.scene.remove(obj);
          obj.geometry.dispose();
          obj.material.dispose();
        }
        this.bursts.splice(i, 1);
      }
    }

    if (this._shake) {
      this._shake.time += dt;
      const sp = this._shake.time / this._shake.duration;
      const mag = sp >= 1 ? 0 : this._shake.magnitude * (1 - sp);
      if (sp >= 1) this._shake = null;
      // Décalage le long de l'axe « droite écran » (perpendiculaire au up de la
      // caméra) : sans ça, une vue pivotée secouerait en roulis au lieu de trembler.
      const a = this._camAngle;
      const dx = mag ? (Math.random() * 2 - 1) * mag : 0;
      const dy = mag ? (Math.random() * 2 - 1) * mag * 0.6 : 0;
      this.camera.position.set(Math.cos(a) * dx, this._camH + dy, this._camCenterZ - Math.sin(a) * dx);
      this.camera.lookAt(0, 0, this._camCenterZ);
    }

    this.renderer.render(this.scene, this.camera);
    this.cssRenderer.render(this.cssScene, this.camera);
    // Rendue seulement quand active : sur une frame qui ne l'était pas déjà à
    // la frame précédente, le canvas transparent reste tel qu'on l'a laissé
    // (vide) plutôt que de coûter un rendu pour rien.
    if (fxActive || powersActive) this.fxRenderer.render(this.fxScene, this.camera);
  }

  /** Ressources GPU vivantes — lu par l'indicateur de diagnostic admin. */
  memoryInfo(): { geometries: number; textures: number; programs: number } {
    const i = this.renderer.info;
    return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 };
  }

  dispose(): void {
    this.destroy();
  }

  destroy(): void {
    this._running = false;
    if (this._pointerState?.longPressTimer) clearTimeout(this._pointerState.longPressTimer);
    this._pointerState = null;

    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('resize', this._resizeHandler);
    if (this._resizeObserver) this._resizeObserver.disconnect();

    for (const tile of this.tileMeshes) (tile.material as THREE.Material).dispose();
    this.tileGeometry.dispose();
    for (const sep of this._separators) {
      sep.geometry.dispose();
      (sep.material as THREE.Material).dispose();
    }
    this._playerBg.geometry.dispose();
    (this._playerBg.material as THREE.Material).dispose();
    if (this._terrainBg) {
      this._terrainBg.geometry.dispose();
      (this._terrainBg.material as THREE.Material).dispose();
      this._terrainBg = null;
    }
    this._terrainTex?.dispose();
    this._terrainTex = null;
    this._terrainReveal?.dispose();
    this._terrainReveal = null;
    this._terrainAnim?.dispose();
    this._terrainAnim = null;
    if (this._terrainModel) { disposeObject(this._terrainModel); this._terrainModel = null; }
    this._gridVisible = false;
    this._rebuildGrid();
    this._terrainLights?.traverse((o) => (o as THREE.DirectionalLight).shadow?.map?.dispose());
    this._terrainLights = null;
    for (const b of this.bursts) {
      if (b.points) { b.points.geometry.dispose(); b.points.material.dispose(); }
      if (b.ring) { b.ring.geometry.dispose(); b.ring.material.dispose(); }
      if (b.lines) { for (const line of b.lines) { line.geometry.dispose(); line.material.dispose(); } }
      if (b.rocks) { for (const r of b.rocks) { r.mesh.geometry.dispose(); r.mesh.material.dispose(); } }
      if (b.slashes) { for (const s of b.slashes) { s.geometry.dispose(); s.material.dispose(); } }
      if (b.group) {
        for (const r of b.rings) { r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
        for (const g of b.glyphs) { g.geometry.dispose(); g.material.dispose(); }
      }
    }
    this.bursts = [];
    this.anims = [];
    this._iceBlocks.clear();
    this._blockedProps.clear();
    for (const dispose of [...this._persistent]) dispose();
    this._persistent.clear();

    // Textures canvas mises en cache + DOM des trois renderers
    this._flameTex?.dispose();
    this._dropletTex?.dispose();
    this._windTex?.dispose();
    this.spawns.dispose();
    this.melee.dispose();
    this.shatter.dispose();
    this.powers.dispose();
    this.fx.dispose();
    this.renderer.dispose();
    this.fxRenderer.dispose();
    // ⚠️ `dispose()` libère les ressources GPU mais PAS le contexte WebGL :
    // three ne le rend qu'à la collecte du canvas. Un navigateur en plafonne le
    // nombre par page (16 chez Chrome) — sans cette ligne, chaque partie jouée
    // en laissait deux contextes vivants (le canvas principal ET le calque FX),
    // et au bout de quelques lancements la création du suivant échouait
    // (« Error creating WebGL context »), écran de jeu figé.
    this.renderer.forceContextLoss();
    this.fxRenderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.cssRenderer.domElement.remove();
    this.fxRenderer.domElement.remove();
  }
}
