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
import { createUnitEl, updateUnitEl } from './UnitCardEl.js';
import {
  ELEMENT_STYLES, elementsForUnit,
  COLS, TOTAL_ROWS, PLAYER_ROWS, CELL, CARD_PX, CSS_SCALE, FOV, HIGHLIGHT_RING_PX,
  PREP_COL_MARGIN, PREP_FOCUS_Y, PREP_ROW_MARGIN, PREP_ROW_MARGIN_WEB, WEB_RAIL_PX,
  zForRow, xForCol, cellKey as key, baseColorFor, emissiveFor,
} from './constants.js';
import type { Unit } from '../logic/Unit.js';
import type { BoardDef, Position } from '../logic/types.js';

// Low-end devices (few cores) get fewer shatter fragments per kill — deep-cloning the
// full unit-card DOM (image + badges) per fragment is the dominant cost during AOE wipes.
const LOW_END_DEVICE = (navigator.hardwareConcurrency || 8) <= 4;

// Apparition d'une unité : chute depuis y=3, puis impact élémentaire.
// LEAD/STAGGER ne servent qu'à la cascade d'apparition de l'IA (revealEnemyUnits) :
// le lead laisse la caméra amorcer son travelling de combat avant la 1re carte.
const SPAWN_DROP_S = 0.22;
const SPAWN_LEAD_S = 0.25;
const SPAWN_STAGGER_S = 0.16;

// ── Fond de grille d'un terrain (combat) ──
// Plan texturé de 5 × 11 posé SOUS les tuiles. Assez bas pour ne pas z-fighter
// avec le voile joueur (y = -0.04) ni avec les tuiles (y = 0 / 0.01).
const TERRAIN_BG_Y = -0.08;
// L'illustration est rabattue pour que les cartes d'unités (CSS3D, claires)
// restent lisibles par-dessus — teinte multiplicative sur le MeshBasicMaterial.
const TERRAIN_BG_TINT = 0x8f96a6;
// Voile des tuiles quand un fond est actif. Les tuiles ne couvrent que 92 % de
// leur case : c'est le contraste entre la tuile voilée et l'interstice resté
// clair qui redessine la grille par-dessus l'illustration — trop bas, les cases
// disparaissent ; trop haut, l'illustration ne sert plus à rien.
const TERRAIN_TILE_OPACITY = 0.2;

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
  _selectedPos: Position | null = null;
  _combatMode = false;

  anims: { update: (dt: number) => boolean }[] = [];
  bursts: any[] = [];
  _running = true;
  _needsRender = true;

  scene!: THREE.Scene;
  cssScene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  cssRenderer!: CSS3DRenderer;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.inset = '0';
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.cssRenderer = new CSS3DRenderer();
    this.cssRenderer.domElement.style.position = 'absolute';
    this.cssRenderer.domElement.style.inset = '0';
    this.cssRenderer.domElement.style.pointerEvents = 'none';
    this.container.appendChild(this.cssRenderer.domElement);

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

  _cameraFraming(combatMode: boolean): { centerZ: number; H: number; angle: number } {
    const showFullBoard = combatMode || this.showEnemySide;
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
      const usableWidth = web ? Math.max(0.35, (this.container.clientWidth - 2 * WEB_RAIL_PX) / (this.container.clientWidth || 1)) : 1;
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
    this._refreshTileColors();
  }

  // Pose (ou retire) l'illustration du terrain sous la grille. Appelée par
  // GameController au lancement du combat, avec `null` à sa fin.
  //
  // Sans fond pour ce terrain — ou en cas de 404 — on ne fait rien de plus que
  // nettoyer : le décor par défaut de la scène est conservé tel quel.
  setTerrainBackground(board: BoardDef | null | undefined): void {
    const token = ++this._terrainToken;
    this._clearTerrainBackground();
    if (!board?._has_background) return;

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
          new THREE.MeshBasicMaterial({ map: tex, color: TERRAIN_BG_TINT }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(0, TERRAIN_BG_Y, (zForRow(0) + zForRow(TOTAL_ROWS - 1)) / 2);
        mesh.renderOrder = -10;
        this.scene.add(mesh);

        this._terrainBg = mesh;
        this._terrainTex = tex;
        this._terrainActive = true;
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

  _clearTerrainBackground(): void {
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
    this._playerBg.visible = true;
    this._applyTerrainTileMode(false);
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
    this._blockedCells.add(key(pos));
    this._refreshTileColors();
  }

  removeTemporaryBlockedCell(pos: Position): void {
    this._blockedCells.delete(key(pos));
    this._refreshTileColors();
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

  enterCombatMode(): void {
    this._resize();
    this._combatMode = true;
    this._animateCameraTo(true);
    for (const sep of this._separators) sep.visible = true;
    for (const entry of this.unitObjs.values()) {
      if (entry.unit.side === 'enemy') this._fadeEntry(entry, true);
    }
    this._invalidate();
  }

  exitCombatMode(): void {
    this._resize();
    this._combatMode = false;
    this._animateCameraTo(false);
    for (const sep of this._separators) sep.visible = false;
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
    const { speed: [speedMin, speedMax] = [1, 3], lift: [liftMin, liftMax] = [1.5, 3.5], size = 0.07, gravity = 6, spin = 0, maxLife = 0.6 } = opts;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = center.x;
      positions[i * 3 + 1] = center.y + 0.04;
      positions[i * 3 + 2] = center.z;
      const theta = Math.random() * Math.PI * 2;
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

  spawnRing(pos: Position | THREE.Vector3, color: number, maxLife = 0.5, maxScale = 6): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const geo = new THREE.RingGeometry(0.05, 0.18, 32);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(center);
    ring.position.y = 0.06;
    this.scene.add(ring);
    this.bursts.push({ ring, life: 0, maxLife, maxScale });
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
  spawnMagicCircle(pos: Position | THREE.Vector3, tier = 1): void {
    const center = pos instanceof THREE.Vector3 ? pos : this.tilePosition(pos);
    const t = Math.max(1, Math.min(5, tier));
    const color = 0xb86ae8;
    const glowColor = 0xe8c8ff;

    const group = new THREE.Group();
    group.position.set(center.x, 0.55, center.z);
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

  spawnElementImpact(position: THREE.Vector3, elements: string[], tier = 1): void {
    const list = elements && elements.length ? elements : ['neutral'];
    const t = Math.max(1, Math.min(5, tier));
    const CFG = [
      { count: 18, sM: 0.36, szM: 0.42, lM: 0.30, rS: 3.5, rL: 0.28, fi: 1.5, fR: 2, fL: 0.12 },
      { count: 18, sM: 0.36, szM: 0.42, lM: 0.30, rS: 3.5, rL: 0.28, fi: 1.5, fR: 2, fL: 0.12 },
      { count: 18, sM: 0.36, szM: 0.42, lM: 0.30, rS: 3.5, rL: 0.28, fi: 1.5, fR: 2, fL: 0.12 },
      { count: 32, sM: 0.52, szM: 0.58, lM: 0.42, rS: 5.0, rL: 0.36, fi: 3.0, fR: 3, fL: 0.16 },
      { count: 50, sM: 0.68, szM: 0.72, lM: 0.55, rS: 7.0, rL: 0.45, fi: 5.0, fR: 4, fL: 0.20 },
    ][t - 1];
    // Plusieurs éléments -> un burst par élément, budget de particules réparti entre eux.
    const perCount = Math.max(1, Math.round(CFG.count / list.length));
    for (const element of list) {
      const style = ELEMENT_STYLES[element] || ELEMENT_STYLES.neutral;
      if (CFG.count > 0) {
        this.spawnBurst(position, style.color, perCount, {
          ...style,
          size:    style.size * CFG.szM,
          speed:   style.speed.map(v => v * CFG.sM),
          lift:    style.lift.map(v => v * CFG.sM),
          maxLife: CFG.lM,
        });
      }
      this.spawnRing(new THREE.Vector3(position.x, 0, position.z), style.ringColor, CFG.rL, CFG.rS);
      if (CFG.fi > 0) this.spawnFlash(position, style.color, CFG.fi / list.length, CFG.fR, CFG.fL);
      if (element === 'foudre') {
        const arcCount = 5 + t * 2;
        for (let i = 0; i < arcCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 0.5 + Math.random() * 0.5 * CFG.sM * 2;
          const end = new THREE.Vector3(position.x + Math.cos(angle) * dist, position.y, position.z + Math.sin(angle) * dist);
          this.spawnLightningArc(position, end, style.color, { maxLife: 0.14 + t * 0.015, branches: t >= 3 ? 2 : 1 });
        }
      }
      if (element === 'feu') this.spawnFlames(position, t);
      if (element === 'eau') this.spawnSplash(position, t);
      if (element === 'air') this.spawnTornado(position, t);
      if (element === 'sorcellerie') this.spawnMagicCircle(position, t);
      if (element === 'terre') {
        this.spawnCrater(position, t);
        // Magnitude relative à la hauteur de caméra pour rester perceptible à tout zoom.
        const camH = this._camH || 6;
        this.shakeCamera(camH * (0.035 + t * 0.012), 0.3 + t * 0.06);
      }
      if (element === 'metal') {
        this.spawnMetalShards(position, t);
        this.spawnSwordSlash(position, t);
      }
    }
    if (t === 5) this.spawnHalo(position, (ELEMENT_STYLES[list[0]] || ELEMENT_STYLES.neutral).color);
  }

  playProjectile(fromPos: Position, toPos: Position, color = 0xffffff): Promise<void> {
    return new Promise((resolve) => {
      const from = this.tilePosition(fromPos);
      const to = this.tilePosition(toPos);
      const geo = new THREE.SphereGeometry(0.08, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(from);
      this.scene.add(mesh);
      let t = 0;
      const duration = 0.25;
      this.anims.push({
        update: (dt: number) => {
          t += dt;
          const p = Math.min(t / duration, 1);
          mesh.position.x = THREE.MathUtils.lerp(from.x, to.x, p);
          mesh.position.z = THREE.MathUtils.lerp(from.z, to.z, p);
          mesh.position.y = THREE.MathUtils.lerp(from.y, to.y, p) + Math.sin(p * Math.PI) * 0.6;
          if (p >= 1) {
            this.scene.remove(mesh);
            geo.dispose();
            mat.dispose();
            resolve();
            return false;
          }
          return true;
        },
      });
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
    let opacity = this._terrainActive ? TERRAIN_TILE_OPACITY : (isPlayer ? 0.04 : 1.0);

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
    if (this._blockedCells.has(k)) {
      color = 0x4a1418; emissive = 0xd86a7e; intensity = 0.3;
      if (veiled) opacity = 0.52;
    }

    const mat = tile.material as THREE.MeshStandardMaterial;
    mat.color.setHex(color);
    mat.emissive.setHex(emissive);
    mat.emissiveIntensity = intensity;
    mat.opacity = veiled ? opacity : 1;
  }

  // ── Unités CSS3D ──────────────────────────────────────────────────────────

  _visibilityFor(unit: Unit): number {
    return (this._combatMode || this.showEnemySide || unit.side === 'player') ? 1 : 0;
  }

  // delay : retarde la chute (l'unité reste invisible en attendant) — utilisé
  // pour échelonner l'apparition des unités de l'IA au lancement du combat.
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
    const x = xForCol(pos.col);
    const z = zForRow(pos.row);
    obj.position.set(x, 3, z);
    obj.scale.setScalar(CSS_SCALE);
    this.cssScene.add(obj);

    const elements = elementsForUnit(unit);
    const entry: UnitEntry = { unit, obj, wrap, el, pos: { ...pos }, elements };
    this._applyUnitHighlightClasses(entry);

    let t = -delay;
    if (delay > 0) obj.visible = false;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        if (t < 0) return true;
        obj.visible = true;
        const p = Math.min(t / SPAWN_DROP_S, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        obj.position.y = THREE.MathUtils.lerp(3, 0.06, eased);
        if (p >= 1) {
          this.spawnElementImpact(new THREE.Vector3(x, 0.1, z), elements, unit.tier ?? 1);
          return false;
        }
        return true;
      },
    });

    return entry;
  }

  // Synchronise le côté ennemi hors du cycle refresh() (qui ne passe plus en
  // mode combat) : en solo l'IA place ses unités APRÈS le PRÊT du joueur, donc
  // une fois la caméra déjà en combat. Les unités nouvellement invoquées
  // tombent en cascade (animation d'apparition), les survivants déjà à l'écran
  // se contentent de rejoindre leur nouvelle case (rearrangeUnits les déplace).
  // Retourne la durée totale (ms) de la cascade, pour retarder le combat.
  revealEnemyUnits(units: Unit[]): number {
    let spawned = 0;
    for (const unit of units) {
      const pos = unit.position;
      if (!pos) continue;
      const entry = this.unitObjs.get(unit.uid);
      if (entry) {
        if (entry.pos.col !== pos.col || entry.pos.row !== pos.row) {
          this._animateMove(entry, pos);
          entry.pos = { ...pos };
        }
        continue;
      }
      this.unitObjs.set(unit.uid, this._spawnUnitObj(unit, SPAWN_LEAD_S + spawned * SPAWN_STAGGER_S));
      spawned++;
    }
    this._invalidate();
    if (spawned === 0) return 0;
    return (SPAWN_LEAD_S + (spawned - 1) * SPAWN_STAGGER_S + SPAWN_DROP_S) * 1000;
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

    const x = entry.obj.position.x;
    const z = entry.obj.position.z;
    if (x === undefined) { this.cssScene.remove(entry.obj); return; }
    const elements = entry.elements && entry.elements.length ? entry.elements : ['neutral'];
    const tier = Math.max(1, Math.min(5, entry.unit.tier ?? 1));

    const KILL_CFG = {
      ...[
        { fc: 4, fr: 4, speed: 3.00, vy: 1.50, rot: 17, fi:  8.0, fR: 5.0, fL: 0.26, pc:  95, fS: 0.96, halo: false, spMax: 2.5, ltMax: 1.8, mLife: 0.50, grav: 6.0 },
        { fc: 4, fr: 4, speed: 3.00, vy: 1.50, rot: 17, fi:  8.0, fR: 5.0, fL: 0.26, pc:  95, fS: 0.96, halo: false, spMax: 2.5, ltMax: 1.8, mLife: 0.50, grav: 6.0 },
        { fc: 4, fr: 4, speed: 3.00, vy: 1.50, rot: 17, fi:  8.0, fR: 5.0, fL: 0.26, pc:  95, fS: 0.96, halo: false, spMax: 2.5, ltMax: 1.8, mLife: 0.50, grav: 6.0 },
        { fc: 4, fr: 4, speed: 3.80, vy: 2.00, rot: 22, fi: 12.0, fR: 7.0, fL: 0.30, pc: 140, fS: 1.00, halo: false, spMax: 3.2, ltMax: 2.2, mLife: 0.56, grav: 5.5 },
        { fc: 6, fr: 5, speed: 6.00, vy: 3.00, rot: 30, fi: 28.0, fR:14.0, fL: 0.45, pc: 220, fS: 1.00, halo: true,  spMax: 2.5, ltMax: 2.0, mLife: 0.65, grav: 5.0 },
      ][tier - 1],
    };
    if (LOW_END_DEVICE) {
      KILL_CFG.fc = Math.max(2, Math.ceil(KILL_CFG.fc / 2));
      KILL_CFG.fr = Math.max(2, Math.ceil(KILL_CFG.fr / 2));
    }

    // Gèle toutes les animations CSS de la carte avant de la masquer
    entry.obj.visible = false;
    entry.wrap.querySelectorAll<HTMLElement>('*').forEach(el => {
      el.style.animation = 'none';
      el.style.transition = 'none';
    });
    entry.wrap.style.animation = 'none';
    entry.wrap.style.transition = 'none';

    const FCOLS = KILL_CFG.fc;
    const FROWS = KILL_CFG.fr;
    const fragW = CARD_PX / FCOLS;
    const fragH = CARD_PX / FROWS;
    const frags: any[] = [];

    for (let fc = 0; fc < FCOLS; fc++) {
      for (let fr = 0; fr < FROWS; fr++) {
        const clip = document.createElement('div');
        clip.style.width = fragW + 'px';
        clip.style.height = fragH + 'px';
        clip.style.overflow = 'hidden';
        clip.style.position = 'relative';
        clip.style.borderRadius = '2px';

        const inner = entry.wrap.cloneNode(true) as HTMLElement;
        inner.style.position = 'absolute';
        inner.style.left = (-fc * fragW) + 'px';
        inner.style.top  = (-fr * fragH) + 'px';
        inner.style.margin = '0';
        inner.style.pointerEvents = 'none';
        clip.appendChild(inner);

        const fobj = new CSS3DObject(clip);
        fobj.rotation.set(-Math.PI / 2, 0, this._camAngle);
        fobj.position.set(x, 0.06, z);
        fobj.scale.setScalar(CSS_SCALE * KILL_CFG.fS);
        this.cssScene.add(fobj);

        const dx = FCOLS > 1 ? fc / (FCOLS - 1) - 0.5 : 0;
        const dz = FROWS > 1 ? fr / (FROWS - 1) - 0.5 : 0;
        const angle = Math.atan2(dz, dx) + (Math.random() - 0.5) * 1.4;
        const speed = KILL_CFG.speed + Math.random() * KILL_CFG.speed;

        frags.push({
          obj: fobj,
          vx: Math.cos(angle) * speed,
          vy: 0.15 + Math.random() * KILL_CFG.vy,
          vz: Math.sin(angle) * speed,
          ry: (Math.random() - 0.5) * KILL_CFG.rot,
          rz: (Math.random() - 0.5) * KILL_CFG.rot * 0.7,
        });
      }
    }

    this.spawnFlash(new THREE.Vector3(x, 0.5, z), 0xffffff, KILL_CFG.fi, KILL_CFG.fR, KILL_CFG.fL);
    const perPc = Math.max(1, Math.round(KILL_CFG.pc / elements.length));
    for (const element of elements) {
      const style = ELEMENT_STYLES[element] || ELEMENT_STYLES.neutral;
      this.spawnBurst(new THREE.Vector3(x, 0.3, z), style.color, perPc, {
        size:    style.size * KILL_CFG.fS * 1.1,
        speed:   [0.1, KILL_CFG.spMax],
        lift:    [0.1, KILL_CFG.ltMax],
        gravity: KILL_CFG.grav,
        maxLife: KILL_CFG.mLife,
      });
    }
    if (KILL_CFG.halo) this.spawnHalo(new THREE.Vector3(x, 0, z), (ELEMENT_STYLES[elements[0]] || ELEMENT_STYLES.neutral).color);

    const MAX_T = 1.2;
    let t = 0;
    this.anims.push({
      update: (dt: number) => {
        t += dt;
        const p = Math.min(t / MAX_T, 1);
        for (const f of frags) {
          f.obj.position.x += f.vx * dt;
          f.obj.position.y += (f.vy - 7 * t) * dt;
          f.obj.position.z += f.vz * dt;
          f.obj.rotation.y += f.ry * dt;
          f.obj.rotation.z += f.rz * dt;
          f.obj.element.style.opacity = String(Math.max(0, 1 - p * 1.3));
        }
        if (p >= 1) {
          this.cssScene.remove(entry.obj);
          for (const f of frags) this.cssScene.remove(f.obj);
          return false;
        }
        return true;
      },
    });
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
    const from = show ? 0 : 1;
    const to = show ? 1 : 0;
    if (parseFloat(entry.wrap.style.opacity || '1') === to) return;
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

  _cellFromEvent(e: PointerEvent): Position | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (!this._raycaster) this._raycaster = new THREE.Raycaster();
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this.tileMeshes);
    if (!hits.length) return null;
    const { col, row } = hits[0].object.userData as any;
    return { col, row };
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
      if (!cell) return;
      const state: any = {
        cell, entry,
        startX: e.clientX, startY: e.clientY,
        dragging: false,
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
      if (!state.dragging && state.entry && Math.hypot(dx, dy) > 10) {
        if (this._combatMode) return;
        state.dragging = true;
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

    // Rendu à la demande : rien d'actif et rien d'invalidé → on saute la frame.
    const active = this.anims.length > 0 || this.bursts.length > 0 || this._shake !== null || this._needsRender;
    if (!active) return;
    this._needsRender = false;

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
        const scale = 1 + p * (b.maxScale ?? 6);
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
  }

  dispose(): void {
    this.destroy();
  }

  destroy(): void {
    this._running = false;
    if (this._pointerState?.longPressTimer) clearTimeout(this._pointerState.longPressTimer);
    this._pointerState = null;

    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
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

    // Textures canvas mises en cache + DOM des deux renderers
    this._flameTex?.dispose();
    this._dropletTex?.dispose();
    this._windTex?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.cssRenderer.domElement.remove();
  }
}
