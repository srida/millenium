// Apparition du terrain 3D en début de préparation (après la pioche).
// Marche sur le groupe du viseur comme sur un GLB chargé : aucune donnée exportée n'est touchée.
//
// Usage :
//   const reveal = createBoardReveal(holder, { mode: 'sweep', onDone });
//   chaque frame : reveal.update(dt)  → true tant que l'animation tourne (compatible Scene3D.anims)
//   reveal.finish() : saute à la fin (tap du joueur) · reveal.dispose() : annule et restaure
//
// Modes :
//   'sweep'  — le relief se lève rangée par rangée, du camp joueur vers le camp adverse
//   'radial' — onde qui part du centre de la zone neutre
//   'drop'   — le plateau tombe en se matérialisant, impact + onde au sol
//
// ⚠️ Démarrer animateTerrain() dans onDone, pas avant : les effets d'ambiance (brouillard,
// fumée, particules) n'ont pas à flotter au-dessus d'un plateau qui n'existe pas encore.
import * as THREE from 'three';

const DEFAULTS = {
  sweep: { duration: 1.35, width: 0.28 },
  radial: { duration: 1.25, width: 0.32 },
  drop: { duration: 0.95, width: 0.5 },
};
const MODE_ID = { sweep: 0, radial: 1, drop: 2 };

function glowTexture(kind) {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  if (kind === 'bar') {
    const l = g.createLinearGradient(0, 0, 0, S);
    l.addColorStop(0, 'rgba(255,255,255,0)'); l.addColorStop(0.5, 'rgba(255,255,255,1)'); l.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = l; g.fillRect(0, 0, S, S);
  } else {
    const r = g.createRadialGradient(S / 2, S / 2, S * 0.36, S / 2, S / 2, S / 2);
    r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.55, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

const easeOutCubic = p => 1 - Math.pow(1 - p, 3);

export function createBoardReveal(root, opts = {}) {
  const mode = MODE_ID[opts.mode] !== undefined ? opts.mode : 'sweep';
  const cfg = { ...DEFAULTS[mode], ...opts };
  const color = new THREE.Color(cfg.color ?? 0xfff1c8);
  const glow = cfg.glow ?? 1.4;

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const span = Math.max(0.001, box.max.z - box.min.z);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(0.001, Math.hypot(box.max.x - center.x, box.max.z - center.z));

  const U = {
    uBrT: { value: 0 }, uBrW: { value: cfg.width }, uBrMode: { value: MODE_ID[mode] },
    uBrFront: { value: box.max.z }, uBrSpan: { value: span },
    uBrCenter: { value: new THREE.Vector2(center.x, center.z) }, uBrRadius: { value: radius },
    uBrColor: { value: color }, uBrGlow: { value: glow },
  };
  const DIST = `
    float brDist(vec3 w) {
      if (uBrMode == 0) return (uBrFront - w.z) / uBrSpan;
      float r = length(w.xz - uBrCenter) / uBrRadius;
      if (uBrMode == 1) return r;
      float n = fract(sin(dot(floor(w.xz * 5.0), vec2(12.9898, 78.233))) * 43758.5453);
      return n * 0.65 + r * 0.35;
    }
    float brProg(float d) { return clamp((uBrT * (1.0 + uBrW) - d) / uBrW, 0.0, 1.0); }`;
  const HEAD = `uniform float uBrT; uniform float uBrW; uniform int uBrMode; uniform float uBrFront; uniform float uBrSpan;
    uniform vec2 uBrCenter; uniform float uBrRadius; uniform vec3 uBrColor; uniform float uBrGlow;
    varying vec3 vBrW;` + DIST + '\n';

  // ── Matériaux : patch chaîné (respecte un onBeforeCompile existant, ex. terrain-anim) ──
  const patched = new Map(), shadows = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    shadows.push([o, o.castShadow]); o.castShadow = false;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || patched.has(m)) continue;
      patched.set(m, { obc: m.onBeforeCompile, key: m.customProgramCacheKey, transparent: m.transparent });
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
      m.onBeforeCompile = (sh, r) => {
        if (prev) prev.call(m, sh, r);
        Object.assign(sh.uniforms, U);
        sh.vertexShader = HEAD + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 brWp = modelMatrix * vec4(transformed, 1.0);
          float brP = brProg(brDist(brWp.xyz));
          float brQ = brP - 1.0;
          transformed.y *= 1.0 + 2.2 * brQ * brQ * brQ + 1.2 * brQ * brQ;
          vBrW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
        sh.fragmentShader = HEAD + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
          float brF = brProg(brDist(vBrW));
          if (brF <= 0.0) discard;
          float brS = smoothstep(0.0, 0.08, brF) * (1.0 - smoothstep(0.08, 0.7, brF));
          gl_FragColor.rgb += uBrColor * brS * uBrGlow;`);
      };
      m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|board-reveal';
      m.needsUpdate = true;
    }
  });

  // ── Front lumineux (barre pour le balayage, anneau pour l'onde) ──
  const fx = new THREE.Group(); fx.name = 'board_reveal_fx';
  const fxParent = cfg.fxParent || root.parent || root;
  let front = null;
  if (mode !== 'drop') {
    const mat = new THREE.MeshBasicMaterial({ map: glowTexture(mode === 'sweep' ? 'bar' : 'ring'), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    const geo = mode === 'sweep' ? new THREE.PlaneGeometry(box.max.x - box.min.x + 0.6, 0.7) : new THREE.PlaneGeometry(2, 2);
    front = new THREE.Mesh(geo, mat); front.rotation.x = -Math.PI / 2; front.renderOrder = 20;
    front.position.set(center.x, box.max.y * 0.25 + 0.04, center.z);
    fx.add(front);
  }
  // Onde d'impact (chute) ou de fin (onde)
  const ringMat = new THREE.MeshBasicMaterial({ map: glowTexture('ring'), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.set(center.x, 0.06, center.z); ring.renderOrder = 21; ring.visible = false;
  fx.add(ring);
  fxParent.add(fx);

  // ── Chute : transform du groupe racine ──
  const baseY = root.position.y, baseScale = root.scale.clone();
  const DROP_H = cfg.dropHeight ?? 2.6, FALL = 0.42;
  let impacted = false, ringT = -1;

  let t = 0, done = false;
  const total = cfg.duration;

  function apply() {
    const p = Math.min(t / total, 1);
    if (mode === 'drop') {
      const fall = Math.min(t / (total * FALL), 1);
      U.uBrT.value = Math.min(1, easeOutCubic(Math.min(t / (total * 0.55), 1)));
      let y;
      if (fall < 1) y = DROP_H * (1 - fall * fall);
      else { const b = (t - total * FALL) / (total * (1 - FALL)); y = Math.max(0, Math.sin(Math.min(b, 1) * Math.PI) * 0.12 * (1 - b)); }
      root.position.y = baseY + y;
      const s = 1 + 0.03 * (y / DROP_H);
      root.scale.set(baseScale.x * s, baseScale.y, baseScale.z * s);
      if (fall >= 1 && !impacted) { impacted = true; ringT = 0; cfg.onImpact?.(); }
    } else {
      U.uBrT.value = p;
      const d = p * (1 + cfg.width) - cfg.width * 0.15;
      const vis = Math.min(1, p * 8) * (1 - THREE.MathUtils.smoothstep(p, 0.82, 1));
      front.material.opacity = 0.85 * vis;
      if (mode === 'sweep') front.position.z = box.max.z - d * span;
      else { const r = Math.max(0.05, d * radius); front.scale.set(r, r, 1); }
      if (mode === 'radial' && p >= 1 && ringT < 0) ringT = 0;
    }
    if (ringT >= 0) {
      const rp = Math.min(ringT / 0.55, 1);
      ring.visible = rp < 1;
      const r = (mode === 'drop' ? 1.2 : 0.6 * radius) + easeOutCubic(rp) * radius * 1.1;
      ring.scale.set(r, r, 1);
      ringMat.opacity = 0.7 * (1 - rp);
    }
  }

  function restore() {
    for (const [m, s] of patched) {
      m.onBeforeCompile = s.obc; m.customProgramCacheKey = s.key; m.transparent = s.transparent; m.needsUpdate = true;
    }
    patched.clear();
    for (const [o, c] of shadows) o.castShadow = c;
    root.position.y = baseY; root.scale.copy(baseScale);
    fx.parent?.remove(fx);
    fx.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
  }

  const api = {
    get done() { return done; },
    update(dt) {
      if (done) return false;
      t += Math.min(dt, 0.05);
      if (ringT >= 0) ringT += Math.min(dt, 0.05);
      apply();
      const ringBusy = ringT >= 0 && ringT < 0.55;
      if (t >= total && !ringBusy) { done = true; restore(); cfg.onDone?.(); return false; }
      return true;
    },
    finish() { if (done) return; t = total; ringT = -1; apply(); done = true; restore(); cfg.onDone?.(); },
    dispose() { if (done) return; done = true; restore(); },
  };
  apply();
  return api;
}
