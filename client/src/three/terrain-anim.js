// Animations des terrains 3D : pilotées par le nom des matériaux et l'identifiant du terrain.
// Marche sur le groupe du viseur comme sur un GLB chargé (noms de matériaux et userData conservés).
// Usage : const anim = animateTerrain(root, { fxParent: scene }); chaque frame : anim.update(sec); au changement : anim.dispose();
import * as THREE from 'three';

const SWAY = { pine: 0.07, leaf: 0.1, leaf_light: 0.1, bush: 0.07, palm_leaf: 0.13, fern: 0.12, moss: 0.08, reed: 0.18, banner_red: 0.2, banner_blue: 0.2 };
const FLICKER = ['flame', 'flame_core', 'bluefire', 'bluefire_core'];
const FLOAT = { crystal: 0.09, crystal_light: 0.09, wisp: 0.07, light: 0.06, foam: 0.02 };
const LAVA = ['lava', 'lava_core'];
// [amplitude relative, vitesse rad/s, forme] — 's' sinus, 'n' bruit, 'b' clignotement
const GLOW = {
  lava: [0.2, 1.1, 's'], lava_core: [0.25, 1.6, 's'],
  flame: [0.6, 0, 'n'], flame_core: [0.5, 0, 'n'], bluefire: [0.6, 0, 'n'], bluefire_core: [0.5, 0, 'n'],
  magic: [0.6, 1.4, 's'], arcane: [0.6, 1.1, 's'], wisp: [0.8, 2.2, 's'], glow: [0.7, 1.8, 's'],
  portal: [0.7, 2.4, 's'], portal_core: [0.8, 1.2, 's'], void: [0.6, 0.9, 's'],
  neon: [0.24, 3.2, 's'], neon_y: [0.3, 2.6, 's'], beam: [0.36, 1.3, 's'],
  crystal: [0.6, 1.2, 's'], crystal_light: [0.6, 1.2, 's'], light: [0.8, 3, 's'],
  beacon: [0.9, 3.1, 'b'], window: [0.16, 0, 'n'], win: [0.2, 0, 'n'], lamp: [0.3, 0, 'n'],
};

// Effets d'ambiance par terrain (objets ajoutés à l'exécution, jamais exportés)
const WIND = { BOARD_003: 0xf4f8ff, BOARD_009: 0xfff0d0, BOARD_014: 0xfff2d8, BOARD_020: 0xffe8cc, BOARD_021: 0xe8d8c0 };
const FOG = { BOARD_008: [0xc8c0e0, 0.34], BOARD_024: [0xb8c8a8, 0.32], BOARD_026: [0xd0b8c0, 0.3], BOARD_018: [0x90a8e0, 0.26], BOARD_022: [0xb898d8, 0.3] };
const SMOKE = { // [col, row, hauteur de départ, couleur, taille]
  BOARD_023: [[2, 5, 0.8, 0x6a625c, 1]],
  BOARD_001: [[4, 4, -0.05, 0x3a2622, 0.7], [0, 6, -0.05, 0x3a2622, 0.7], [2, 4, -0.05, 0x3a2622, 0.7], [2, 6, -0.05, 0x3a2622, 0.7]],
  BOARD_016: [[4, 6, 0.8, 0x5a4a44, 0.55]],
  BOARD_018: [[2, 5, 0.3, 0x2a3450, 0.8]],
};
const WAVES = ['BOARD_005'];
const SNOW = ['BOARD_003'];
const FIREFLIES = { BOARD_015: 0xffd66a };
const CARS = { BOARD_006: { vx: [-1, 1], hz: [8, 2], lane: 0.17 } };
const xForCol = c => c - 2, zForRow = r => 10 - r;

function inject(mat, uTime, { vert = '', frag = '', fragAt = '#include <emissivemap_fragment>' }) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = 'uniform float uTime;\nvarying vec3 vAPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvAPos = position;\n' + vert);
    sh.fragmentShader = 'uniform float uTime;\nvarying vec3 vAPos;\n' + sh.fragmentShader.replace(fragAt, fragAt + '\n' + frag);
  };
  mat.customProgramCacheKey = () => 'terrain-anim:' + mat.name;
  mat.needsUpdate = true;
}

function softTex(kind) {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  if (kind === 'streak') {
    const l = g.createLinearGradient(0, 0, S, 0); l.addColorStop(0, 'rgba(255,255,255,0)'); l.addColorStop(0.35, 'rgba(255,255,255,1)'); l.addColorStop(0.7, 'rgba(255,255,255,.8)'); l.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = l; g.fillRect(0, S * 0.3, S, S * 0.4);
    g.globalCompositeOperation = 'destination-in';
    const v = g.createLinearGradient(0, 0, 0, S); v.addColorStop(0.3, 'rgba(0,0,0,0)'); v.addColorStop(0.5, 'rgba(0,0,0,1)'); v.addColorStop(0.7, 'rgba(0,0,0,0)');
    g.fillStyle = v; g.fillRect(0, 0, S, S);
  } else if (kind === 'glow') {
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, S, S);
  } else {
    let seed = kind === 'fog' ? 7 : 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 9; i++) {
      const x = S / 2 + (rnd() - 0.5) * S * 0.35, y = S / 2 + (rnd() - 0.5) * S * 0.35, r = S * (0.2 + rnd() * 0.18);
      const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, 'rgba(255,255,255,.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, S, S);
    }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Particules instanciées : 1 draw call par effet, alpha par instance, option billboard
function particles(n, tex, color, opacity, { additive = false, billboard = false, flat = true } = {}) {
  const geo = new THREE.PlaneGeometry(1, 1);
  if (flat && !billboard) geo.rotateX(-Math.PI / 2);
  const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); aAlpha.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAlpha', aAlpha);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, color: { value: new THREE.Color(color) }, opacity: { value: opacity } },
    vertexShader: `attribute float aAlpha; varying float vA; varying vec2 vUv;
      void main() { vUv = uv; vA = aAlpha;
        ${billboard ? `vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); float s = length(instanceMatrix[0].xyz); c.xy += position.xy * s; gl_Position = projectionMatrix * c;`
                    : `gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);`} }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 color; uniform float opacity; varying float vA; varying vec2 vUv;
      void main() { float a = texture2D(map, vUv).a * vA * opacity; if (a < 0.003) discard; gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n); mesh.frustumCulled = false; mesh.renderOrder = 3;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return { mesh, aAlpha };
}

export function animateTerrain(root, { fxParent = root } = {}) {
  const uTime = { value: 0 }, pulses = [], seen = new Set(), spins = [], fx = new THREE.Group(), steps = [], owned = [];
  let meta = null;
  root.traverse(o => { if (!meta && o.userData?.boardId) meta = o.userData; });
  const id = meta?.boardId, blocked = new Set((meta?.blocked || []).map(b => b.col + ',' + b.row));
  const isBlocked = (x, z) => blocked.has(Math.round(x + 2) + ',' + Math.round(10 - z));
  fx.name = 'terrain_fx';

  root.traverse(o => {
    if (o.userData?.spin) spins.push({ o, q0: o.quaternion.clone(), axis: new THREE.Vector3(...({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] })[o.userData.spin.axis]), speed: o.userData.spin.speed });
    if (!o.isMesh || !o.material || seen.has(o.material)) return;
    const m = o.material, n = m.name; seen.add(m);
    if (SWAY[n]) inject(m, uTime, { vert: `{ float k = max(position.y - 0.08, 0.0);
      transformed.x += sin(uTime * 2.0 + position.x * 2.3 + position.z * 1.1) * ${SWAY[n].toFixed(3)} * k;
      transformed.z += cos(uTime * 1.3 + position.z * 2.1 + position.x * 0.7) * ${(SWAY[n] * 0.6).toFixed(3)} * k; }` });
    else if (FLICKER.includes(n)) inject(m, uTime, { vert: `{ float k = max(position.y - 0.08, 0.0);
      transformed.x += sin(uTime * 9.0 + position.y * 18.0 + position.z * 7.0) * 0.16 * k;
      transformed.z += cos(uTime * 7.3 + position.y * 15.0 + position.x * 6.0) * 0.16 * k;
      transformed.y += step(0.08, position.y) * sin(uTime * 11.0 + position.x * 9.0 + position.z * 4.0) * 0.12 * k; }` });
    else if (FLOAT[n]) inject(m, uTime, { vert: `transformed.y += step(0.08, position.y) * sin(uTime * 1.4 + position.x * 5.0 + position.z * 3.0) * ${FLOAT[n].toFixed(3)};` });
    else if (LAVA.includes(n)) inject(m, uTime, { frag: `{ vec2 p = vAPos.xz;
      float a = sin(p.x * 6.0 + sin(p.y * 5.0 + uTime * 0.9) * 1.8 - uTime * 1.4);
      float b = sin(p.y * 7.0 + sin(p.x * 4.0 - uTime * 0.7) * 1.6 + uTime * 1.1);
      float f = 0.5 + 0.5 * a * b; f = f * f;
      totalEmissiveRadiance *= 0.35 + 1.4 * f; diffuseColor.rgb *= 0.6 + 0.7 * f; }` });
    else if (n === 'ground' && WAVES.includes(id)) inject(m, uTime, { fragAt: '#include <color_fragment>', frag: `{ vec2 p = vAPos.xz;
      float water = smoothstep(0.08, 0.2, diffuseColor.b - diffuseColor.r) * step(vAPos.y, 0.02);
      float w1 = sin(p.y * 3.4 + p.x * 1.2 - uTime * 0.3 + sin(p.x * 2.1 + uTime * 0.12) * 0.9);
      float w2 = sin(p.x * 4.3 - p.y * 1.9 + uTime * 0.22 + sin(p.y * 1.7 - uTime * 0.1) * 1.1);
      float crest = smoothstep(0.86, 0.98, w1) * 0.9 + smoothstep(0.9, 0.99, w2) * 0.6;
      diffuseColor.rgb *= 1.0 + water * 0.12 * sin(p.y * 1.3 + p.x * 0.8 - uTime * 0.16);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.9, 0.95), water * crest * 0.55); }` });
    if (GLOW[n] && m.emissiveIntensity > 0) pulses.push({ m, base: m.emissiveIntensity, a: GLOW[n][0], w: GLOW[n][1], f: GLOW[n][2], ph: (n.length * 1.37) % 6.28 });
  });

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  if (WIND[id]) {
    const N = 26, { mesh, aAlpha } = particles(N, softTex('streak'), WIND[id], 0.75, { additive: true });
    fx.add(mesh); owned.push(mesh);
    steps.push(t => { for (let i = 0; i < N; i++) {
      const life = 3.6 + hash(i) * 2.4, ph = (t / life + hash(i + 50)) % 1, cyc = Math.floor(t / life + hash(i + 50));
      const x0 = -3.2 + hash(i * 3 + cyc) * 5, z0 = -0.5 + hash(i * 7 + cyc * 13) * 11, sp = 0.6 + hash(i + 9) * 0.45;
      const x = x0 + ph * sp * life * 0.9, z = z0 - ph * 0.35, y = 0.04 + hash(i + 21) * 0.3;
      M.compose(P.set(x, y, z), Q.setFromAxisAngle(UP, 0.12), S.set(0.5 + hash(i + 5) * 0.7, 1, 0.07));
      mesh.setMatrixAt(i, M); aAlpha.array[i] = Math.sin(Math.PI * ph) * (x > -2.5 && x < 2.5 ? 1 : 0.3);
    } mesh.instanceMatrix.needsUpdate = true; aAlpha.needsUpdate = true; });
  }
  if (FOG[id]) {
    const N = 16, [col, op] = FOG[id], { mesh, aAlpha } = particles(N, softTex('fog'), col, op);
    fx.add(mesh); owned.push(mesh);
    steps.push(t => { for (let i = 0; i < N; i++) {
      const sp = 0.06 + hash(i) * 0.07, span = 7, x = ((hash(i + 3) * span + t * sp) % span) - 3.5, z = -0.3 + hash(i + 11) * 10.6 + Math.sin(t * 0.2 + i) * 0.3;
      const s = 1.6 + hash(i + 7) * 1.4;
      M.compose(P.set(x, 0.1 + hash(i + 2) * 0.18, z), Q.setFromAxisAngle(UP, t * 0.03 * (hash(i + 4) - 0.5) + i), S.set(s, 1, s * 0.8));
      mesh.setMatrixAt(i, M); aAlpha.array[i] = Math.min(1, (3.5 - Math.abs(x)) * 0.8) * (0.6 + 0.4 * Math.sin(t * 0.4 + i * 1.7));
    } mesh.instanceMatrix.needsUpdate = true; aAlpha.needsUpdate = true; });
  }
  for (const [c, r, y0, col, size] of SMOKE[id] || []) {
    const N = 12, cx = xForCol(c), cz = zForRow(r), { mesh, aAlpha } = particles(N, softTex('smoke'), col, 0.6, { billboard: true });
    fx.add(mesh); owned.push(mesh);
    steps.push(t => { for (let i = 0; i < N; i++) {
      const life = 4.5, ph = (t / life + i / N) % 1, s = (0.18 + ph * 0.7) * size;
      M.compose(P.set(cx + ph * 0.35 + Math.sin(i * 2.3 + t) * 0.04, y0 + ph * 1.1 * size, cz - ph * 0.15 + Math.cos(i * 1.7) * 0.05), Q.identity(), S.set(s, s, s));
      mesh.setMatrixAt(i, M); aAlpha.array[i] = Math.min(1, ph * 6) * (1 - ph);
    } mesh.instanceMatrix.needsUpdate = true; aAlpha.needsUpdate = true; });
  }
  if (SNOW.includes(id)) {
    const N = 160, { mesh, aAlpha } = particles(N, softTex('glow'), 0xffffff, 0.95, { billboard: true });
    fx.add(mesh); owned.push(mesh);
    steps.push(t => { for (let i = 0; i < N; i++) {
      const fall = 0.28 + hash(i) * 0.22, H = 2.2, ph = ((t * fall / H) + hash(i + 40)) % 1, cyc = Math.floor(t * fall / H + hash(i + 40));
      const y = H * (1 - ph);
      const x = -3 + hash(i * 3 + cyc * 7) * 5.4 + (H - y) * 0.45 + Math.sin(t * 1.3 + i) * 0.05, z = -0.5 + hash(i * 5 + cyc * 11) * 11 + Math.cos(t * 1.1 + i * 2) * 0.05;
      M.compose(P.set(x, y, z), Q.identity(), S.setScalar(0.03 + hash(i + 17) * 0.035));
      mesh.setMatrixAt(i, M); aAlpha.array[i] = Math.min(1, ph * 8, (1 - ph) * 10) * (x > -2.6 && x < 2.6 ? 1 : 0);
    } mesh.instanceMatrix.needsUpdate = true; aAlpha.needsUpdate = true; });
  }
  if (FIREFLIES[id]) {
    const N = 34, { mesh, aAlpha } = particles(N, softTex('glow'), FIREFLIES[id], 1, { additive: true, billboard: true });
    fx.add(mesh); owned.push(mesh);
    const base = []; for (let i = 0; i < N; i++) base.push([-2.2 + hash(i + 3) * 4.4, -0.2 + hash(i + 8) * 10.4, 0.12 + hash(i + 13) * 0.45]);
    steps.push(t => { for (let i = 0; i < N; i++) {
      const [bx, bz, by] = base[i], w = 0.25 + hash(i + 23) * 0.25;
      const x = bx + Math.sin(t * w + i * 1.7) * 0.35 + Math.sin(t * w * 2.3 + i) * 0.1;
      const z = bz + Math.cos(t * w * 0.8 + i * 2.1) * 0.35, y = by + Math.sin(t * w * 1.6 + i * 0.9) * 0.1;
      const blink = Math.max(0, Math.sin(t * (0.6 + hash(i + 31) * 0.8) + i * 2.4));
      M.compose(P.set(x, y, z), Q.identity(), S.setScalar(0.07 + 0.05 * blink));
      mesh.setMatrixAt(i, M); aAlpha.array[i] = 0.15 + 0.85 * blink * blink;
    } mesh.instanceMatrix.needsUpdate = true; aAlpha.needsUpdate = true; });
  }
  if (CARS[id]) {
    const { vx, hz, lane } = CARS[id], lanes = [];
    for (const x of vx) { lanes.push({ ax: 'z', c: x + lane, dir: 1 }, { ax: 'z', c: x - lane, dir: -1 }); }
    for (const z of hz) { lanes.push({ ax: 'x', c: z - lane, dir: 1 }, { ax: 'x', c: z + lane, dir: -1 }); }
    const cars = []; lanes.forEach((l, li) => { const k = 1; for (let j = 0; j < k; j++) cars.push({ l, off: (j + hash(li * 5 + j) * 0.5) / k, sp: 0.2 + hash(li * 9 + j) * 0.12 }); });
    const body = new THREE.BoxGeometry(0.1, 0.026, 0.2).translate(0, 0.013 + 0.012, 0);
    const cab = new THREE.BoxGeometry(0.085, 0.02, 0.1).translate(0, 0.036 + 0.012, -0.01);
    const carGeo = mergeSimple([body, cab]);
    const COLORS = [0xd8d4c8, 0xc23a2e, 0xe8b830, 0x2a4a8a, 0x1c1e22, 0x6a8a9a];
    const carMesh = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3, flatShading: true }), cars.length);
    cars.forEach((c, i) => carMesh.setColorAt(i, new THREE.Color(COLORS[i % COLORS.length])));
    const lg = []; for (const s of [-1, 1]) { lg.push(colored(new THREE.BoxGeometry(0.022, 0.012, 0.01).translate(s * 0.03, 0.026, 0.1), 0xfff4c8), colored(new THREE.BoxGeometry(0.022, 0.012, 0.01).translate(s * 0.03, 0.026, -0.1), 0xff2a1a)); }
    const lightMesh = new THREE.InstancedMesh(mergeSimple(lg), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), cars.length);
    const beamGeo = new THREE.PlaneGeometry(0.12, 0.22).rotateX(-Math.PI / 2).translate(0, 0.014, 0.21);
    const beamMesh = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }), cars.length);
    for (const m of [carMesh, lightMesh, beamMesh]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fx.add(m); owned.push(m); }
    steps.push(t => { cars.forEach((c, i) => {
      const L = c.l.ax === 'z' ? 11.4 : 5.4, lo = c.l.ax === 'z' ? -0.7 : -2.7;
      let u = ((c.off * L + t * c.sp) % L); if (c.l.dir < 0) u = L - u;
      const along = lo + u, x = c.l.ax === 'z' ? c.l.c : along, z = c.l.ax === 'z' ? along : c.l.c;
      const edge = c.l.ax === 'z' ? Math.min(z + 0.5, 10.5 - z) : Math.min(x + 2.5, 2.5 - x);
      const s = Math.max(0, Math.min(1, edge / 0.12 + 0.5)) * (isBlocked(x, z) ? 0 : 1);
      const yaw = c.l.ax === 'z' ? (c.l.dir > 0 ? 0 : Math.PI) : (c.l.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      M.compose(P.set(x, 0, z), Q.setFromAxisAngle(UP, yaw), S.setScalar(s));
      carMesh.setMatrixAt(i, M); lightMesh.setMatrixAt(i, M); beamMesh.setMatrixAt(i, M);
    }); for (const m of [carMesh, lightMesh, beamMesh]) m.instanceMatrix.needsUpdate = true; });
  }
  if (fx.children.length) { fx.position.copy(root.position); fx.quaternion.copy(root.quaternion); fx.scale.copy(root.scale); fxParent.add(fx); }

  return {
    update(t) {
      uTime.value = t;
      for (const p of pulses) {
        const s = p.f === 'n' ? (Math.sin(t * 13.1 + p.ph) * 0.5 + Math.sin(t * 7.7 + p.ph * 2) * 0.35 + Math.sin(t * 23.3) * 0.15)
          : p.f === 'b' ? (Math.sin(t * p.w + p.ph) > 0.6 ? 1 : -1) : Math.sin(t * p.w + p.ph);
        p.m.emissiveIntensity = p.base * (1 + p.a * s);
      }
      for (const s of spins) s.o.quaternion.copy(s.q0).multiply(Q.setFromAxisAngle(s.axis, t * s.speed));
      for (const f of steps) f(t);
    },
    dispose() {
      for (const p of pulses) p.m.emissiveIntensity = p.base;
      for (const s of spins) s.o.quaternion.copy(s.q0);
      for (const m of seen) if (m.onBeforeCompile) { m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => ''; m.needsUpdate = true; }
      fx.removeFromParent();
      for (const m of owned) { m.geometry.dispose(); m.material.uniforms?.map?.value?.dispose(); m.material.dispose(); }
    },
  };
}

function colored(g, hex) { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function mergeSimple(geos) {
  const parts = geos.map(g => g.index ? g.toNonIndexed() : g), out = new THREE.BufferGeometry();
  for (const k of Object.keys(parts[0].attributes)) {
    const size = parts[0].attributes[k].itemSize, arr = new Float32Array(parts.reduce((s, g) => s + g.attributes[k].array.length, 0));
    let o = 0; for (const g of parts) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
