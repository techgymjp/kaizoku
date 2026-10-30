// 海モード：瀬戸内海を海賊船で西へ。敵の海賊船を鉄砲で撃ち、島に上陸する
import * as THREE from './vendor/three.module.min.js';
import { DEM, SEA_K, VEX, hPx, hSea, ll2sea, sea2ll, ll2px, isLandPx, compAt, nearestLandPx } from './geo.js';
import { BRIDGES, LANDMARKS, WHIRLPOOLS, ZONES, zoneAt, START, GOAL, FINAL_LON, DANNOURA, shipName, WIND, TIDE, STRAITS, HARBOR_HINT } from './data.js';
import { makeShip, animateShip, makeCrewman, makeWarrior, makeMusket, makeTorii, makeHall, makePagoda, makeJoyato, makeGangi, makeBridge, makePumpkin, makeLighthouse, mat } from './models.js';
import { Sfx } from './audio.js';
import { msg, banner, flash, Floats, Tags, $ } from './ui.js';
import { L, islandName, getLang, romaji } from './i18n.js';
const N = (o) => L(o.name, o.en || o.name);

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const SHIP_SCALE = 0.66; // 自分の船（敵の倍）
const ENEMY_SCALE = 0.42;
const PR = 6; // 自分の船の当たりの大きさ
const BRIDGE_V = 0.42; // 橋の高さの倍率（大きな船がくぐれるように）
const KT = 0.6; // 潮の速さ 1 ノットをゲームの何単位/秒にするか（船の速さに合わせて強調）
const CH = 64; // 地形のかたまり（画素）

// ---- 地形の色 ----
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const C = (h) => new THREE.Color(h);
const COL = { sand: C('#d8c89a'), sand2: C('#c8b480'), field: C('#9aa860'), field2: C('#b8a868'), paddy: C('#7a9a58'), forest: C('#3c5a34'), forest2: C('#2e4a2c'), rock: C('#8a8270'), town: C('#a49c8e'), floor: C('#3a5a5a'), orange: C('#6a8a3a') };
function landColor(out, h, slope, px, py, seaNear) {
  const n = vnoise(px * 0.35, py * 0.35), n2 = vnoise(px * 1.3 + 50, py * 1.3);
  if (h <= 0) { out.copy(COL.floor); return; }
  if (h < 4 && seaNear) { out.copy(COL.sand).lerp(COL.sand2, n2); return; }
  if (slope < 0.06 && h < 40) {
    // 平地：田畑と町
    if (n2 > 0.72 && seaNear) out.copy(COL.town).lerp(COL.sand2, n * 0.3);
    else out.copy(COL.field).lerp(n > 0.5 ? COL.field2 : COL.paddy, Math.abs(n - 0.5) * 2);
    return;
  }
  if (slope > 0.55 || h > 900) { out.copy(COL.rock).lerp(COL.forest2, 0.3 * n); return; }
  // 段々畑（みかん）と森
  if (h < 160 && slope < 0.25 && n2 > 0.55) { out.copy(COL.orange).lerp(COL.forest, n * 0.5); return; }
  out.copy(COL.forest).lerp(COL.forest2, n);
}

export class Sea {
  constructor(renderer, G) {
    this.r = renderer; this.G = G;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 14000);
    this.view = 'chase'; // 船の後ろからの視点
    this.floats = new Floats(); this.tags = new Tags();
    this.chunks = new Map();
    this.enemies = []; this.bullets = []; this.parts = []; this.loot = []; this.wakes = []; this.fallers = [];
    this.t = 0; this.spawnT = 3; this.camYaw = 0; this.camDist = 50; this.camH = 30;
    this.colliders = [];
  }

  // ---------------- 準備 ----------------
  build() {
    const S = this.scene;
    this.fog = new THREE.Fog('#c8d8e0', 2200, 9500);
    S.fog = this.fog;
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    this.sun.position.set(-0.4, 0.8, 0.45);
    S.add(this.sun);
    this.hemi = new THREE.HemisphereLight('#cfe4ff', '#5a5a3a', 1.1);
    S.add(this.hemi);
    this.buildSky();
    this.buildWater();
    this.chunkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.scanChunks();
    this.buildBridges();
    this.buildLandmarks();
    this.buildWhirlpools();
    this.buildMinimap();
    // 自分の船
    this.ship = makeShip('player');
    this.ship.scale.setScalar(SHIP_SCALE);
    S.add(this.ship);
    {
      const ud = this.ship.userData;
      // 赤備えの船長は甲板の真ん中、後ろから見える所に立つ
      const hero = makeWarrior('hero'); hero.position.set(0, ud.deckY + 0.1, -ud.len * 0.14); hero.scale.setScalar(2.0); ud.inner.add(hero); this.hero = hero;
      ud.spots.slice(2, 8).forEach(([x, z, y = 0], i) => { const c = makeCrewman('spear', 'west', '#b0141a'); c.position.set(x, ud.deckY + y, z); ud.inner.add(c); });
      // 船首の大砲
      const cn = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 10), new THREE.MeshLambertMaterial({ color: '#2a2a2e' }));
      cn.rotation.x = Math.PI / 2; cn.position.set(0, ud.deckY + 1.9, ud.len * 0.47); ud.inner.add(cn);
      this.bowCannon = new THREE.Object3D(); this.bowCannon.position.set(0, ud.deckY + 1.9, ud.len * 0.55); ud.inner.add(this.bowCannon);
      // その前、船首楼に鉄砲隊 5 人が横一列に並ぶ（船の向きに構える）
      this.gunners = [[-0.32, 0.31], [-0.16, 0.34], [0, 0.36], [0.16, 0.34], [0.32, 0.31]].map(([x, z]) => {
        const c = makeCrewman('gun', 'west', '#b0141a');
        c.position.set(x * ud.width, ud.deckY + 1.4, z * ud.len); c.scale.setScalar(1.25);
        ud.inner.add(c);
        const mz = new THREE.Object3D(); mz.position.set(0.32, 1.25, 1.15); c.add(mz); // 銃口
        return { c, mz };
      });
    }
    let [sx, sz] = ll2sea(START.lon, START.lat);
    for (let r = 0; r < 80 && (hSea(sx, sz) > -4 || hSea(sx + 8, sz) > -3 || hSea(sx, sz + 8) > -3); r++) { sx += rand(-6, 6); sz += 5; }
    this.P = { x: sx, z: sz, h: START.heading, v: 0, sail: 2, roll: 0, pitch: 0, cd: 0, cdBomb: 0, inv: 0 };
    this.G.minX = sx;
    // 戻れない線（霧の壁）
    this.straits = STRAITS.map((s) => { const [x, z] = ll2sea(s.lon, s.lat); const b = (s.flood * Math.PI) / 180; return { ...s, x, z, r: s.r / 10, fx: Math.sin(b), fz: -Math.cos(b) }; });
    [this.meetX] = ll2sea(TIDE.meetLon, 34);
    // 狙いの印
    this.aimMark = new THREE.Mesh(new THREE.RingGeometry(2.2, 3, 24), new THREE.MeshBasicMaterial({ color: '#ffdc78', transparent: true, opacity: 0.8, depthWrite: false }));
    this.aimMark.rotation.x = -Math.PI / 2; S.add(this.aimMark);
    // ゴールの目印
    let [gx, gz] = ll2sea(GOAL.lon, GOAL.lat);
    for (let r = 0; r < 60 && hSea(gx, gz) > -3; r++) { let best = null; for (let a = 0; a < 16; a++) { const x = gx + Math.cos(a / 16 * TAU) * r * 3, z = gz + Math.sin(a / 16 * TAU) * r * 3; if (hSea(x, z) < -3 && (!best || hSea(x, z) < best[2])) best = [x, z, hSea(x, z)]; } if (best) { gx = best[0]; gz = best[1]; break; } }
    this.goal = { x: gx, z: gz };
    const gm = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 300, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    gm.position.set(gx, 150, gz); S.add(gm); this.goalBeam = gm; gm.visible = false;
    // 船首で構える火縄銃（カメラに付ける）
    S.add(this.camera);
    this.gun = makeMusket();
    this.camera.add(this.gun);
    this.buildIslets();
    this.buildNames();
    this.buildHarbors();
    this.bulletGeo = new THREE.SphereGeometry(0.5, 6, 4);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: '#2a2a2a' });
    this.bombMat = new THREE.MeshBasicMaterial({ color: '#ff8a2a' });
    this.smokeTex = makeSmokeTex();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(12000, 24, 12);
    this.skyU = { top: { value: new THREE.Color('#5a8ed0') }, hor: { value: new THREE.Color('#d8e6ee') }, sunDir: { value: new THREE.Vector3(-0.4, 0.5, 0.45).normalize() }, sunCol: { value: new THREE.Color('#fff0c8') } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vP;
        void main(){ float h = max(vP.y, 0.0); vec3 c = mix(hor, top, pow(h, 0.55)); float s = max(dot(normalize(vP), sunDir), 0.0);
        c += sunCol * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.35); if (vP.y < 0.0) c = hor; gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(geo, m);
    this.sky.frustumCulled = false; this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  buildWater() {
    // 海岸からの近さ（浅瀬の色・白波）
    const s = 2, W = DEM.w / s, H = DEM.h / s;
    const d = new Float32Array(W * H).fill(99);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isLandPx(x * s, y * s) || isLandPx(x * s + 1, y * s + 1)) d[y * W + x] = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 1); if (y > 0) d[i] = Math.min(d[i], d[i - W] + 1); if (x > 0 && y > 0) d[i] = Math.min(d[i], d[i - W - 1] + 1.41); if (x < W - 1 && y > 0) d[i] = Math.min(d[i], d[i - W + 1] + 1.41); }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (x < W - 1) d[i] = Math.min(d[i], d[i + 1] + 1); if (y < H - 1) d[i] = Math.min(d[i], d[i + W] + 1); if (x < W - 1 && y < H - 1) d[i] = Math.min(d[i], d[i + W + 1] + 1.41); if (x > 0 && y < H - 1) d[i] = Math.min(d[i], d[i + W - 1] + 1.41); }
    const data = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) data[i] = Math.round(clamp(1 - d[i] / 10, 0, 1) * 255);
    const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    this.waterU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, coast: { value: null }, mapSize: { value: new THREE.Vector2(DEM.w * SEA_K, DEM.h * SEA_K) },
      sunDir: { value: new THREE.Vector3(-0.4, 0.6, 0.45).normalize() }, deep: { value: new THREE.Color('#1d4a66') }, shallow: { value: new THREE.Color('#3a9a9a') }, skyC: { value: new THREE.Color('#b8d0e0') },
    }]);
    this.waterU.coast.value = tex;
    const m = new THREE.ShaderMaterial({
      uniforms: this.waterU, fog: true, transparent: false,
      vertexShader: `#include <common>
        #include <fog_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vW;
        void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <fog_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        uniform float time; uniform sampler2D coast; uniform vec2 mapSize; uniform vec3 sunDir; uniform vec3 deep; uniform vec3 shallow; uniform vec3 skyC;
        varying vec3 vW;
        vec2 wave(vec2 p, vec2 d, float f, float s, float a){ float ph = dot(p, d) * f + time * s; return d * cos(ph) * a * f; }
        void main(){
          #include <logdepthbuf_fragment>
          vec2 p = vW.xz;
          vec2 g = wave(p, normalize(vec2(1.0,0.3)), 0.21, 1.6, 0.35) + wave(p, normalize(vec2(-0.4,1.0)), 0.33, 2.1, 0.22) + wave(p, normalize(vec2(0.7,-0.8)), 0.9, 3.3, 0.06) + wave(p, normalize(vec2(-1.0,-0.2)), 1.7, 4.7, 0.03);
          float dist = length(cameraPosition - vW);
          float fade = 1.0 / (1.0 + dist / 140.0);
          vec3 n = normalize(vec3(-g.x * fade, 1.0, -g.y * fade));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
          float c = texture2D(coast, p / mapSize).r;
          vec3 col = mix(deep, shallow, smoothstep(0.35, 1.0, c));
          col = mix(col, skyC, fres * 0.22);
          vec3 h = normalize(sunDir + v);
          col += vec3(1.0, 0.95, 0.8) * pow(max(dot(n, h), 0.0), 220.0) * 1.6 * (0.3 + 0.7 * fade) * clamp(sunDir.y * 2.0, 0.15, 1.0);
          float foam = smoothstep(0.9, 0.99, c) * (0.6 + 0.4 * sin(time * 1.2 + (p.x + p.y) * 0.08)) * (0.4 + 0.6 * fade);
          col = mix(col, vec3(0.92, 0.95, 0.95), foam * 0.6);
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000, 1, 1), m);
    this.water.rotation.x = -Math.PI / 2;
    this.water.frustumCulled = false;
    this.scene.add(this.water);
  }

  // ---- 地形（64 画素ずつ。近いほど細かく） ----
  scanChunks() {
    this.nx = Math.ceil(DEM.w / CH); this.ny = Math.ceil(DEM.h / CH);
    this.landChunks = [];
    for (let cy = 0; cy < this.ny; cy++) for (let cx = 0; cx < this.nx; cx++) {
      let land = 0;
      for (let y = cy * CH; y <= Math.min(DEM.h - 1, cy * CH + CH); y += 2) for (let x = cx * CH; x <= Math.min(DEM.w - 1, cx * CH + CH); x += 2) if (DEM.data[y * DEM.w + x] > 0) land++;
      if (land) this.landChunks.push({ cx, cy, key: cx + ',' + cy, mesh: null, stride: 0, wx: (cx + 0.5) * CH * SEA_K, wz: (cy + 0.5) * CH * SEA_K });
    }
  }
  chunkGeometry(cx, cy, s) {
    const n = CH / s + 1;
    const pos = new Float32Array((n * n + n * 4) * 3), col = new Float32Array((n * n + n * 4) * 3);
    const c = new THREE.Color();
    let k = 0;
    const put = (px, py, yOff) => {
      const h = hPx(px, py);
      const dx = hPx(px + 1, py) - hPx(px - 1, py), dy = hPx(px, py + 1) - hPx(px, py - 1);
      const slope = Math.hypot(dx, dy) / (2 * 126);
      let seaNear = false;
      if (h > 0 && h < 30) for (const [ox, oy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (hPx(px + ox, py + oy) <= 0) { seaNear = true; break; }
      landColor(c, h, slope, px, py, seaNear);
      pos[k * 3] = px * SEA_K; pos[k * 3 + 1] = (h > 0 ? h * VEX + 0.25 : h * VEX) + yOff; pos[k * 3 + 2] = py * SEA_K;
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; k++;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) put(Math.min(cx * CH + i * s, DEM.w - 1), Math.min(cy * CH + j * s, DEM.h - 1), 0);
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
    // すきまを隠すスカート
    const edges = [[0, 0, 1, 0], [0, n - 1, 1, 0], [0, 0, 0, 1], [n - 1, 0, 0, 1]];
    for (const [i0, j0, di, dj] of edges) {
      const base = k;
      for (let t = 0; t < n; t++) put(Math.min(cx * CH + (i0 + di * t) * s, DEM.w - 1), Math.min(cy * CH + (j0 + dj * t) * s, DEM.h - 1), -6);
      for (let t = 0; t < n - 1; t++) { const a = (j0 + dj * t) * n + i0 + di * t, b = (j0 + dj * (t + 1)) * n + i0 + di * (t + 1); idx.push(a, base + t, b, b, base + t, base + t + 1, a, b, base + t, b, base + t + 1, base + t); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  updateChunks(force) {
    const P = this.P;
    let built = 0;
    for (const ch of this.landChunks) {
      const d = Math.hypot(ch.wx - P.x, ch.wz - P.z);
      const want = d < 1500 ? 1 : d < 3800 ? 2 : d < 7500 ? 4 : d < 12000 ? 8 : 0;
      if (want === ch.stride) continue;
      if (!force && built >= 2 && want !== 0) continue; // 1 フレームに作る数を抑える
      if (ch.mesh) { this.scene.remove(ch.mesh); ch.mesh.geometry.dispose(); ch.mesh = null; }
      ch.stride = want;
      if (!want) continue;
      ch.mesh = new THREE.Mesh(this.chunkGeometry(ch.cx, ch.cy, want), this.chunkMat);
      this.scene.add(ch.mesh); built++;
    }
  }

  // ---- 橋 ----
  buildBridges() {
    this.bridges = [];
    for (const b of BRIDGES) {
      let [ax, az] = ll2sea(b.a[0], b.a[1]), [bx, bz] = ll2sea(b.b[0], b.b[1]);
      // 海の部分を探して両端を岸に合わせる（データの粗さで岸が無いときはそのまま）
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      let first = null, last = null;
      for (let t = -0.4 * L; t <= 1.4 * L; t += 2) { const x = ax + ux * t, z = az + uz * t; if (hSea(x, z) < -1) { if (first === null) first = t; last = t; } }
      if (first !== null && last - first > L * 0.4 && last - first < L * 1.8) {
        const pad = Math.max(8, L * 0.06);
        const t0 = first - pad, t1 = last + pad;
        bx = ax + ux * t1; bz = az + uz * t1; ax = ax + ux * t0; az = az + uz * t0;
      }
      const deckY = Math.max(16, b.deck * BRIDGE_V + 1);
      const def = { ...b, a: [ax, az], b: [bx, bz], deckY, towerH: Math.max(b.towerH * BRIDGE_V, deckY + 8) * (b.towerH ? 1 : 0), width: 4.2, archH: Math.min((b.archH || 0) * BRIDGE_V, deckY - 2), span: (b.span || 0) / 10 };
      if (b.truss) def.truss = b.truss * BRIDGE_V;
      const m = makeBridge(def);
      // 岸の高さまで寄せる
      this.scene.add(m);
      const Lw = Math.hypot(bx - ax, bz - az);
      for (const tz of m.userData.towerZ) {
        const x = ax + (bx - ax) * tz / Lw, z = az + (bz - az) * tz / Lw;
        this.colliders.push({ x, z, r: 3.5 });
      }
      this.bridges.push({ def: b, x: (ax + bx) / 2, z: (az + bz) / 2, ax, az, bx, bz, seen: false });
    }
  }

  buildLandmarks() {
    this.marks = [];
    for (const l of LANDMARKS) {
      const [x, z] = ll2sea(l.lon, l.lat);
      const big = 4; // 海から見えるよう大きく
      const hs = (l.h / 10) * big;
      let o;
      switch (l.kind) {
        case 'otorii': o = makeTorii(hs, '#d8401c', true); break;
        case 'itsukushima': {
          o = new THREE.Group();
          for (let i = -2; i <= 2; i++) { const h = makeHall(3 * big / 2, 2.2 * big / 2, 1.4 * big / 2, '#5a4a3a', '#f4eee0', '#d8401c'); h.position.set(i * 2.4 * big / 2, 0.3, -Math.abs(i) * 0.8); o.add(h); }
          const walk = new THREE.Mesh(new THREE.BoxGeometry(16 * big / 2, 0.3, 0.8), mat('#d8401c')); walk.position.set(0, 0.4, 2); o.add(walk);
          break;
        }
        case 'pagoda': o = makePagoda(5, hs, l.color || '#c8401c'); break;
        case 'joyato': o = makeJoyato(hs); break;
        case 'gangi': o = makeGangi(16, 5); break;
        case 'hall': o = makeHall(hs * 0.9, hs * 0.7, hs * 0.5, '#3a3c44', '#e8dcc0', '#6a4a2a'); break;
        case 'stupa': o = makePagoda(2, hs, '#9a948a'); break;
        case 'shrine': { o = new THREE.Group(); o.add(makeHall(hs, hs * 0.7, hs * 0.45, '#5a4a3a', '#f0e8d8', '#c8401c')); const t = makeTorii(hs * 0.8); t.position.z = hs * 1.4; o.add(t); break; }
        case 'pumpkin': o = makePumpkin(hs); break;
        case 'lighthouse': o = makeLighthouse(hs); break;
        case 'suitenmon': { o = new THREE.Group(); const gate = makeHall(hs * 0.8, hs * 0.4, hs * 0.5, '#2a6a5a', '#f4f0e8', '#e03820'); o.add(gate); const base = new THREE.Mesh(new THREE.BoxGeometry(hs * 1.2, hs * 0.2, hs * 0.6), mat('#f4f0e8')); o.add(base); break; }
        case 'tomomori': { o = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(hs * 0.4, hs * 0.5, hs * 0.4), mat('#7a766a')); b.position.y = hs * 0.25; o.add(b); const st = new THREE.Mesh(new THREE.CylinderGeometry(hs * 0.08, hs * 0.12, hs * 0.6, 6), mat('#3a4a3a')); st.position.y = hs * 0.8; o.add(st); const anc = new THREE.Mesh(new THREE.TorusGeometry(hs * 0.18, hs * 0.04, 6, 10), mat('#3a4a3a')); anc.position.y = hs * 1.25; o.add(anc); break; }
        case 'sandbar': {
          o = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 40), mat('#e6d8b0')); o.rotation.y = 0.5; o.userData.tide = true; break;
        }
        default: o = makeHall(hs, hs, hs);
      }
      let y = l.inSea ? 0 : Math.max(0.3, hSea(x, z) * VEX + 0.2);
      if (l.kind === 'itsukushima') y = 0.1;
      o.position.set(x, y, z);
      if (l.rot) o.rotation.y = l.rot;
      this.scene.add(o);
      this.marks.push({ l, x, z, o, seen: false });
    }
  }
  // 島ごとの港：集落（地名の位置）にいちばん近い岸
  buildHarbors() {
    const beamGeo = new THREE.CylinderGeometry(3, 5, 160, 12, 1, true);
    this.beamMat = new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const isl of this.G.islands) {
      const hint = HARBOR_HINT[isl.id];
      const [gx, gy] = hint ? ll2px(hint[0], hint[1]) : ll2px(isl.lon, isl.lat);
      let best = null, bd = 1e9;
      const R = 30;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = Math.round(gx) + dx, y = Math.round(gy) + dy;
        if (!isLandPx(x, y)) continue;
        if (!isl.merged && compAt(x, y) !== isl.comp) continue;
        // 海に面した岸か
        let sea = null;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!isLandPx(x + ox, y + oy) && hPx(x + ox * 2, y + oy * 2) < 0) { sea = [x + ox, y + oy, ox, oy]; break; }
        if (!sea) continue;
        const d = Math.hypot(x - gx, y - gy);
        if (d < bd) { bd = d; best = { lx: x, ly: y, sx: sea[0], sy: sea[1], ox: sea[2], oy: sea[3] }; }
      }
      if (!best) continue;
      // 船を止める海の上（岸から少し沖）
      let wx = best.sx + 0.5, wy = best.sy + 0.5;
      for (let k = 0; k < 4 && hPx(wx + best.ox, wy + best.oy) < -2; k++) { wx += best.ox * 0.5; wy += best.oy * 0.5; }
      isl.harbor = { x: wx * SEA_K, z: wy * SEA_K, lx: best.lx, ly: best.ly };
      const beam = new THREE.Mesh(beamGeo, this.beamMat);
      beam.position.set(isl.harbor.x, 80, isl.harbor.z); beam.visible = false;
      this.scene.add(beam); isl.harbor.beam = beam;
    }
  }
  // いちばん近い、財宝の残る島の港
  nearestHarbor() {
    const P = this.P; let best = null, bd = 1e9;
    for (const isl of this.G.islands) {
      if (!isl.harbor || this.G.taken.has(isl.id)) continue;
      const d = Math.hypot(isl.harbor.x - P.x, isl.harbor.z - P.z);
      if (d < bd) { bd = d; best = isl; }
    }
    return best ? { isl: best, d: bd } : null;
  }
  // 地図に載っている島の名前（無人島を含む）
  buildNames() {
    const inh = this.G.islands.map((i) => ({ n: i.name, x: (i.merged ? i.px : i.cx) * SEA_K, z: (i.merged ? i.py : i.cy) * SEA_K }));
    this.uninhabited = [];
    const add = (name, kana, lon, lat, h) => {
      const [x, z] = ll2sea(lon, lat);
      if (inh.some((o) => o.n === name && Math.hypot(o.x - x, o.z - z) < 400)) return; // 有人島
      this.uninhabited.push({ name, kana, x, z, h });
    };
    for (const [name, kana, lon, lat] of this.G.islandNames || []) add(name, kana, lon, lat, Math.max(10, hSea(...ll2sea(lon, lat))));
    for (const o of this.G.islets || []) if (o[6]) add(o[6], o[7] || '', o[0], o[1], o[5]);
  }
  uninhabitedName(x, z, r = 150) {
    let best = null, bd = r;
    for (const u of this.uninhabited || []) { const d = Math.hypot(u.x - x, u.z - z); if (d < bd) { bd = d; best = u; } }
    return best;
  }
  buildIslets() {
    const list = this.G.islets || [];
    this.isletGrid = new Map();
    if (!list.length) return;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i);
      if (y < 0) y *= 0.15; // 水の中は平たく
      p.setY(i, y);
      const c = new THREE.Color(y > 0.45 ? '#4a6a3a' : y > 0.1 ? '#7a7466' : '#9a9080');
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    list.forEach(([lon, lat, a, b, ang, h], i) => {
      const [x, z] = ll2sea(lon, lat);
      const ra = Math.max(0.8, a / 20), rb = Math.max(0.8, b / 20);
      q.setFromAxisAngle(up, -ang); sc.set(ra, Math.max(0.8, h * VEX), rb); ps.set(x, -0.2, z);
      m4.compose(ps, q, sc); mesh.setMatrixAt(i, m4);
      const k = ((x / 60) | 0) + ',' + ((z / 60) | 0);
      if (!this.isletGrid.has(k)) this.isletGrid.set(k, []);
      this.isletGrid.get(k).push({ x, z, ra, rb, c: Math.cos(ang), s: Math.sin(ang) });
    });
    this.scene.add(mesh);
  }
  isletAt(x, z, pad = 1) {
    if (!this.isletGrid || !this.isletGrid.size) return false;
    const gx = (x / 60) | 0, gz = (z / 60) | 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = this.isletGrid.get((gx + i) + ',' + (gz + j)); if (!arr) continue;
      for (const o of arr) {
        const dx = x - o.x, dz = z - o.z, u = dx * o.c + dz * o.s, v = -dx * o.s + dz * o.c;
        if ((u / (o.ra + pad)) ** 2 + (v / (o.rb + pad)) ** 2 < 1) return true;
      }
    }
    return false;
  }
  buildWhirlpools() {
    this.pools = [];
    const tex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'); g.translate(128, 128);
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      for (let k = 0; k < 4; k++) { g.beginPath(); for (let a = 0; a < 12; a += 0.05) { const r = 4 + a * 10; g.lineTo(Math.cos(a + k * 1.57) * r, Math.sin(a + k * 1.57) * r); } g.lineWidth = 3; g.stroke(); }
      const t = new THREE.CanvasTexture(c); return t;
    })();
    for (const w of WHIRLPOOLS) {
      const [x, z] = ll2sea(w.lon, w.lat);
      const r = w.r / 10;
      const group = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(r * (0.5 + i * 0.25), r * (0.5 + i * 0.25)), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.set((i - 1) * r * 0.5, 0.15 + i * 0.01, (i % 2) * r * 0.3);
        group.add(m);
      }
      group.position.set(x, 0, z);
      this.scene.add(group);
      this.pools.push({ w, x, z, r, group, warned: false });
    }
  }

  // ---- ミニマップ ----
  buildMinimap() {
    const c = document.createElement('canvas');
    const s = 2; c.width = DEM.w / s; c.height = DEM.h / s; this.miniS = s;
    const g = c.getContext('2d');
    const im = g.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const h = DEM.data[y * s * DEM.w + x * s];
      const o = (y * c.width + x) * 4;
      if (h <= 0) { im.data[o] = 30; im.data[o + 1] = 92; im.data[o + 2] = 140; }
      else { const k = Math.min(1, h / 500); im.data[o] = 190 - k * 90; im.data[o + 1] = 196 - k * 70; im.data[o + 2] = 140 - k * 70; }
      im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    g.fillStyle = 'rgb(190,196,140)';
    for (const o of this.G.islets || []) { const [x, z] = ll2sea(o[0], o[1]); g.fillRect(x / SEA_K / s - 0.7, z / SEA_K / s - 0.7, 1.6, 1.6); }
    this.miniBg = c;
  }
  drawMinimap() {
    const cv = $('minimap'), g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const P = this.P;
    // 自船のまわり（約 15km 四方）を拡大
    const span = 130; // DEM 画素
    const px = P.x / SEA_K, py = P.z / SEA_K;
    const sx = clamp(px - span / 2, 0, DEM.w - span), sy = clamp(py - span * H / W / 2, 0, DEM.h - span * H / W);
    const sh = span * H / W;
    const ms = this.miniS;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.miniBg, sx / ms, sy / ms, span / ms, sh / ms, 0, 0, W, H);
    const k = W / span;
    const tx = (x) => (x / SEA_K - sx) * k, ty = (z) => (z / SEA_K - sy) * k;
    // 島（財宝の有無）
    for (const isl of this.G.islands) {
      const x = (isl.px - sx) * k, y = (isl.py - sy) * k;
      if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
      const taken = this.G.taken.has(isl.id);
      g.fillStyle = taken ? 'rgba(160,160,160,0.9)' : '#ffd24a';
      g.strokeStyle = '#1a1a1a'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, taken ? 3.5 : 5, 0, TAU); g.fill(); g.stroke();
      g.font = '700 12px "Shippori Mincho", serif'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.fillStyle = taken ? '#ccc' : '#fff';
      const nm = islandName(isl); g.strokeText(nm, x + 7, y + 4); g.fillText(nm, x + 7, y + 4);
      if (!taken && isl.harbor) { const hx = tx(isl.harbor.x), hy = ty(isl.harbor.z); g.font = '700 15px serif'; g.lineWidth = 3; g.strokeText('⚓', hx - 7, hy + 6); g.fillStyle = '#ffd24a'; g.fillText('⚓', hx - 7, hy + 6); }
    }
    for (const e of this.enemies) { if (e.sink || e.far) continue; g.fillStyle = e.boss ? '#ff3a3a' : e.guard && !e.pursue ? '#ffb0a0' : '#ff6a4a'; g.fillRect(tx(e.x) - 3, ty(e.z) - 3, 6, 6); }
    // ゴール
    g.fillStyle = '#ffffff'; g.font = '700 11px serif';
    const gx = tx(this.goal.x), gy = ty(this.goal.z);
    if (gx > 0 && gx < W && gy > 0 && gy < H) { g.fillText(L('★下関', '★Shimonoseki'), gx - 6, gy + 4); }
    // 自船
    g.save(); g.translate(tx(P.x), ty(P.z)); g.rotate(P.h);
    g.fillStyle = '#ff3a2a'; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, -6); g.lineTo(-3, 0); g.lineTo(-7, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(W - 26, 4, 22, 22); g.fillStyle = '#fff'; g.font = '700 13px serif'; g.fillText(L('北', 'N'), W - 21, 20);
    const km5 = 500 / SEA_K * k; g.fillStyle = '#fff'; g.fillRect(8, H - 10, km5, 3); g.font = '11px serif'; g.fillText('5km', 8, H - 14);
    // 全体の進み具合
    const all = $('routebar');
    if (all) {
      const [x0] = ll2sea(START.lon, START.lat), x1 = this.goal.x;
      const p = clamp((x0 - P.x) / (x0 - x1), 0, 1);
      all.style.width = (p * 100).toFixed(1) + '%';
    }
  }

  // ---------------- 敵 ----------------
  spawnEnemy(type, x, z, faction, opt = {}) {
    const crest = faction.crest;
    const cap = opt.cap;
    const style = cap ? cap.style : 'jp';
    const shipType = faction.crest === 'heike' ? (type === 'ataka' ? 'ataka' : 'heike') : type;
    const m = makeShip(shipType, { crest: style === 'west' ? 'skull' : crest, style, sailColor: style === 'west' ? (crest === 'skull' ? '#2a2a2a' : '#e8dfc8') : undefined });
    if (faction.crest === 'heike' && type === 'ataka') { m.userData.sail && (m.userData.sail.material = m.userData.sail.material.clone()); }
    m.scale.setScalar(ENEMY_SCALE);
    this.scene.add(m);
    // 船員 8 人（船首・左舷・右舷・船尾に 2 人ずつ）
    const ud = m.userData, crew = [];
    const cstyle = faction.crest === 'heike' ? 'heike' : style;
    (ud.spots || []).forEach(([x, z, y = 0], i) => {
      const role = i < 2 ? 'gun' : i >= 6 ? (i === 6 ? 'chief' : 'gun') : 'spear';
      const c = makeCrewman(role, cstyle, faction.color);
      c.position.set(x, ud.deckY + y, z);
      ud.inner.add(c); crew.push(c);
    });
    const hp = { kobaya: 60, seki: 130, ataka: 320 }[type] * (opt.hpMul || 1);
    const e = {
      type, x, z, h: Math.atan2(this.P.z - z, this.P.x - x), v: 0, hp, maxHp: hp, m, faction, cd: rand(1, 3),
      speed: { kobaya: 27, seki: 21, ataka: 15 }[type] * (opt.spMul || 1), r: (ud.len || 20) * ENEMY_SCALE * 0.42, crew,
      guard: opt.guard || null, pursue: !opt.guard, far: false, cap, name: opt.name || (cap ? shipName(cap, type, getLang()) : L(faction.name, faction.en)), boss: !!opt.boss, wob: rand(0, TAU),
      dmg: { kobaya: 7, seki: 9, ataka: 12 }[type] * (opt.dmgMul || 1), guns: { kobaya: 1, seki: 2, ataka: 4 }[type], sink: 0, final: !!opt.final, ghost: faction.crest === 'heike',
    };
    if (e.ghost) m.traverse((o) => { if (o.material && o.material.color && !o.material.map) { o.material = o.material.clone(); o.material.emissive = new THREE.Color('#2a0606'); } });
    this.enemies.push(e);
    return e;
  }
  waterAt(x, z, margin = 2.5) { return hSea(x, z) < -margin; }
  trySpawn(dt) {
    const G = this.G, P = this.P;
    if (G.final) return;
    const [lon] = sea2ll(P.x, P.z);
    const zone = zoneAt(lon);
    const alive = this.enemies.filter((e) => !e.sink && !e.far && !e.guard).length;
    this.spawnT -= dt;
    if (this.spawnT > 0 || alive >= zone.max) return;
    this.spawnT = rand(7, 14) / Math.max(0.3, zone.rate);
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.PI + rand(-1.1, 1.1); // 西寄り
      const d = rand(650, 1100);
      const x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d;
      if (!this.waterAt(x, z, 3) || !this.waterAt(x + 15, z) || !this.waterAt(x - 15, z) || !this.waterAt(x, z + 15) || !this.waterAt(x, z - 15)) continue;
      const prog = G.progress;
      const r = Math.random();
      const type = r < 0.12 + prog * 0.2 && zone.max >= 3 ? 'ataka' : r < 0.45 + prog * 0.2 ? 'seki' : 'kobaya';
      const n = type === 'kobaya' && Math.random() < 0.5 ? 2 : 1;
      const cap = zone.captains[(Math.random() * zone.captains.length) | 0];
      for (let i = 0; i < n; i++) this.spawnEnemy(type, x + i * 20, z + i * 12, zone.faction, { cap, hpMul: 1 + prog * 0.6, dmgMul: 1 + prog * 0.5 });
      if (G.t - (this.lastWarn || -99) > 20) { msg(L(`${cap.ja}の船が現れた！（${zone.faction.name}）`, `${cap.en}'s ship sighted! (${zone.faction.en})`), 'warn', 4); this.lastWarn = G.t; Sfx.horn(0.25, 0, 0.95); }
      break;
    }
  }
  // 島ごとに縄張りを守る船を 3 隻。近づいたときに出す
  spawnGuards() {
    const G = this.G, P = this.P;
    if (G.final) return;
    for (const isl of G.islands) {
      if (G.guards.has(isl.id)) continue;
      const cx = (isl.merged ? isl.px : isl.cx) * SEA_K, cz = (isl.merged ? isl.py : isl.cy) * SEA_K;
      if (Math.hypot(cx - P.x, cz - P.z) > 1000) continue;
      if (this.enemies.filter((e) => e.guard && !e.pursue && !e.sink).length >= 18) return; // 多すぎると重い
      G.guards.set(isl.id, 'spawned');
      const R = Math.max(isl.bbox[2] - isl.bbox[0], isl.bbox[3] - isl.bbox[1]) * SEA_K * 0.5 + 90;
      const [lon] = sea2ll(cx, cz);
      const zone = zoneAt(lon);
      if (!zone.captains.length) continue;
      const cap = zone.captains[(Math.random() * zone.captains.length) | 0];
      const name = islandName(isl);
      const prog = G.progress;
      let made = 0;
      for (let k = 0; k < 24 && made < 3; k++) {
        const ang = (made / 3) * TAU + k * 0.37;
        const x = cx + Math.cos(ang) * R, z = cz + Math.sin(ang) * R;
        if (!this.waterAt(x, z, 3) || Math.hypot(x - P.x, z - P.z) < 250) continue;
        const type = made === 0 ? (prog > 0.35 ? 'ataka' : 'seki') : 'kobaya';
        const e = this.spawnEnemy(type, x, z, zone.faction, { cap, guard: { id: isl.id, name, cx, cz, R, ang }, hpMul: 1 + prog * 0.6, dmgMul: 1 + prog * 0.5,
          name: L(`${cap.ja}の${type === 'kobaya' ? '見張り船' : '守りの船'}（${name}）`, `${cap.en}'s ${type === 'kobaya' ? 'picket' : 'guard ship'} (${name})`) });
        e.h = ang + Math.PI / 2;
        made++;
      }
    }
  }
  startFinal() {
    const G = this.G;
    G.final = true;
    banner(L('壇ノ浦の決戦', 'Battle of Dan-no-ura'), L('平家の怨霊船団が現れた。一艘残らず沈めよ', 'The ghost fleet of the Heike rises. Sink every last ship!'));
    msg(L('「見るべきほどのことは見つ。今はただ自害せん」——平知盛の怨念が海を覆う', '“I have seen all there is to see.” — the grudge of Taira no Tomomori covers the sea'), 'say', 7);
    Sfx.bgm('final');
    flash('rgba(120,0,0,0.35)');
    const fac = ZONES[ZONES.length - 1].faction;
    const [dx, dz] = ll2sea(DANNOURA.lon, DANNOURA.lat);
    const spots = [];
    const heikeN = this.enemies.some((e) => e.pursue && !e.sink && e.crew.length) ? 8 : 11;
    for (let tries = 0; spots.length < heikeN && tries < 400; tries++) {
      const a = rand(0, TAU), d = rand(30, 420);
      const x = dx + Math.cos(a) * d, z = dz + Math.sin(a) * d;
      if (!this.waterAt(x, z, 3)) continue;
      if (spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 30)) continue;
      spots.push([x, z]);
    }
    spots.forEach(([x, z], i) => {
      if (i === 0) this.spawnEnemy('ataka', x, z, fac, { name: L('平知盛の御座船', 'Flagship of Taira no Tomomori'), boss: true, hpMul: 3.2, dmgMul: 1.6, final: true });
      else this.spawnEnemy(i % 3 === 0 ? 'ataka' : 'seki', x, z, fac, { name: i % 3 === 0 ? L('平家の大船', 'Heike war barge') : L('平家の怨霊船', 'Heike ghost ship'), hpMul: 1.6, dmgMul: 1.4, final: true });
    });
    // 追ってきた海賊船も、生き残りがいれば全て壇ノ浦に集結する
    // 多すぎると戦にならないので、近い順に 10 艘まで
    const chasers = this.enemies.filter((e) => !e.final && !e.sink && e.pursue && e.crew.length).sort((p, q) => Math.hypot(p.x - dx, p.z - dz) - Math.hypot(q.x - dx, q.z - dz)).slice(0, 10);
    for (const e of this.enemies) if (!e.final && !e.sink && !chasers.includes(e)) e.pursue = false;
    for (const e of this.enemies) if (!e.final && !e.sink && !e.pursue) { this.scene.remove(e.m); e.sink = 99; }
    this.enemies = this.enemies.filter((e) => e.sink !== 99);
    for (const e of chasers) {
      for (let tries = 0; tries < 80; tries++) {
        const a = rand(0, TAU), d = rand(60, 650);
        const x = dx + Math.cos(a) * d, z = dz + Math.sin(a) * d;
        if (!this.waterAt(x, z, 3)) continue;
        e.x = x; e.z = z; break;
      }
      e.final = true; e.far = false; e.m.visible = true; e.guard = null;
    }
    if (chasers.length) msg(L(`追ってきた ${chasers.length} 艘の海賊船も平家に加わった！`, `The ${chasers.length} pirate ships that hunted you have joined the Heike!`), 'warn', 6);
    G.finalTotal = this.enemies.filter((e) => e.final).length;
  }

  // ---------------- 毎フレーム ----------------
  update(dt, I) {
    const G = this.G, P = this.P;
    this.t += dt;
    // 入力
    if (I.pressed('KeyW') || I.pressed('ArrowUp')) { P.sail = Math.min(3, P.sail + 1); Sfx.whoosh(); }
    if (I.pressed('KeyS') || I.pressed('ArrowDown')) { P.sail = Math.max(-1, P.sail - 1); Sfx.whoosh(); }
    let turn = 0;
    if (I.down('KeyA') || I.down('ArrowLeft')) turn -= 1;
    if (I.down('KeyD') || I.down('ArrowRight')) turn += 1;
    if (I.joy) {
      // スティック：向けた方向へ舵を切り、倒した量で帆を張る
      const a = Math.atan2(I.joy.y, I.joy.x);
      const camH = this.camHeading();
      const target = camH + a + Math.PI / 2;
      const d = angDiff(target, P.h);
      const mag = Math.min(1, Math.hypot(I.joy.x, I.joy.y));
      turn = clamp(d * 2, -1, 1) * (mag > 0.25 ? 1 : 0);
      P.sail = mag > 0.25 ? (mag > 0.8 ? 3 : 2) : P.sail;
    }
    const dash = (I.down('Space') || I.down('ShiftLeft') || I.down('ShiftRight') || I.tDash) && G.st > 3 && P.sail > 0;
    if (dash) { G.st = Math.max(0, G.st - 22 * dt); G.stDelay = 0.6; if (Math.random() < dt * 4) Sfx.oar(); }
    else { if (G.stDelay > 0) G.stDelay -= dt; else G.st = Math.min(G.maxSt, G.st + 16 * dt); }
    const sailV = [-6, 0, 13, 22, 31][P.sail + 1];
    const target = (sailV > 0 ? sailV * this.windMul(P.h) : sailV) + (dash ? 15 : 0);
    P.v += (target - P.v) * (1 - Math.exp(-dt * (target > P.v ? 0.7 : 1.2)));
    const tr = turn * (0.55 + Math.min(0.5, Math.abs(P.v) / 40));
    P.h += tr * dt;
    P.roll += (-turn * Math.min(1, Math.abs(P.v) / 25) * 0.12 - P.roll) * (1 - Math.exp(-dt * 3));
    // 渦潮
    for (const w of this.pools) {
      const dx = w.x - P.x, dz = w.z - P.z, d = Math.hypot(dx, dz);
      if (d < w.r * 1.2) {
        const k = (1 - d / (w.r * 1.2)) * w.w.power;
        P.x += (dx / d * 3 - dz / d * 9) * k * dt; P.z += (dz / d * 3 + dx / d * 9) * k * dt;
        P.h += k * 0.6 * dt;
        if (!w.warned) { w.warned = true; msg(L(`${w.w.name}に巻き込まれた！`, `Caught in the ${w.w.en}!`), 'warn', 4); Sfx.splash(0.5); }
        if (d < w.r * 0.35 && P.inv <= 0) { this.hurtHull(4 * w.w.power, P.x, P.z, true); P.inv = 0.6; }
      } else if (d > w.r * 2) w.warned = false;
    }
    // 移動と座礁
    const nx = P.x + Math.cos(P.h) * P.v * dt, nz = P.z + Math.sin(P.h) * P.v * dt;
    const bowX = nx + Math.cos(P.h) * PR * Math.sign(P.v || 1), bowZ = nz + Math.sin(P.h) * PR * Math.sign(P.v || 1);
    if (hSea(bowX, bowZ) > -1.2 || hSea(nx, nz) > -1.2 || this.isletAt(bowX, bowZ, 1) || this.isletAt(nx, nz, 3)) {
      if (Math.abs(P.v) > 14 && P.inv <= 0) { this.hurtHull(Math.abs(P.v) * 0.25, P.x, P.z, true); msg(L('座礁した！', 'Ran aground!'), 'warn', 2); P.inv = 1; Sfx.crack(0.3); }
      P.v *= -0.25;
    } else { P.x = nx; P.z = nz; }
    // 橋脚
    for (const c of this.colliders) {
      const dx = P.x - c.x, dz = P.z - c.z, d = Math.hypot(dx, dz);
      if (d < c.r + PR * 0.6) { P.x = c.x + dx / d * (c.r + PR * 0.6); P.z = c.z + dz / d * (c.r + PR * 0.6); P.v *= 0.5; }
    }
    // 潮に流される
    const cur = this.current(P.x, P.z);
    if (hSea(P.x + cur.x * dt * 3, P.z + cur.z * dt * 3) < -1.2) { P.x += cur.x * dt; P.z += cur.z * dt; }
    this.cur = cur;
    if (P.x < G.minX) G.minX = P.x;
    P.x = clamp(P.x, 30, DEM.w * SEA_K - 30); P.z = clamp(P.z, 30, DEM.h * SEA_K - 30);
    if (P.inv > 0) P.inv -= dt;
    if (G.t - G.lastHurt > 4) G.hp = Math.min(G.maxHp, G.hp + 1.5 * dt); // 小早川と同じ自然回復

    // 船の姿
    const s = this.ship;
    s.position.set(P.x, 0.25 + Math.sin(this.t * 1.3) * 0.12, P.z);
    s.rotation.set(0, 0, 0);
    s.rotation.y = Math.atan2(-Math.cos(P.h), -Math.sin(P.h));
    s.rotateZ(P.roll + Math.sin(this.t * 0.9) * 0.025);
    s.rotateX(Math.sin(this.t * 1.1) * 0.02);
    animateShip(s, this.t, P.v * (dash ? 2 : 1));
    for (const sl of s.userData.sails) sl.scale.set(1, P.sail <= 0 ? 0.25 : 0.55 + P.sail * 0.15, 1);
    this.addWake(P.x, P.z, P.h, P.v, PR);

    // 鉄砲
    const aim = this.aimPoint(I);
    this.aimMark.position.set(aim.x, 0.3, aim.z);
    if (this.view === 'bow') {
      const gu = this.gun.userData;
      gu.kick = Math.max(0, (gu.kick || 0) - dt * 6);
      const asp = Math.min(1, this.camera.aspect * 1.1);
      this.gun.position.set(0.26 * asp, -0.3 + gu.kick * 0.03, -0.6 - (1 - asp) * 0.3 + gu.kick * 0.1);
      const fw = this.aimDir();
      const cp = this.camera.position;
      this.gun.lookAt(cp.x + fw.x * 400, cp.y + fw.y * 400, cp.z + fw.z * 400);
      this.updateCrosshair(fw);
      gu.match.material.color.setHSL(0.07, 1, 0.5 + Math.sin(this.t * 20) * 0.15);
    }
    this.aimMark.visible = false;
    $('crosshair').classList.toggle('hidden', this.view !== 'bow');
    P.cd -= dt; P.cdBomb -= dt;
    if ((I.fire || I.down('KeyJ')) && P.cd <= 0) { I.fire = false; this.fireVolley(aim); }
    if (I.bomb && P.cdBomb <= 0) { I.bomb = false; this.throwBomb(aim); }
    I.fire = false; I.bomb = false;

    // 敵
    this.trySpawn(dt);
    this.guardT = (this.guardT || 0) - dt;
    if (this.guardT <= 0) { this.guardT = 1; this.spawnGuards(); }
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.enemies = this.enemies.filter((e) => {
      if (e.sink > 4.5) { this.scene.remove(e.m); return false; }
      // 縄張りの守りの船は、離れれば島へ帰る（追手は消えない）
      if (!e.final && !e.pursue && (!e.guard || Math.hypot(e.guard.cx - P.x, e.guard.cz - P.z) > 1500)) {
        if (e.guard && this.G.guards.get(e.guard.id) === 'spawned') this.G.guards.delete(e.guard.id); // また近づけば出てくる
        this.scene.remove(e.m); return false;
      }
      return true;
    });
    this.updateBullets(dt);
    this.updateParts(dt);
    this.updateFallers(dt);
    this.updateLoot(dt);
    // 進み具合と海域
    const [lon, lat] = sea2ll(P.x, P.z);
    const [x0] = ll2sea(START.lon, START.lat);
    G.progress = clamp((x0 - P.x) / (x0 - this.goal.x), 0, 1);
    G.lon = lon; G.lat = lat;
    const zone = zoneAt(lon);
    if (zone !== this.zone) {
      if (this.zone) banner(N(zone), L(zone.faction.name + 'の海', 'Waters of the ' + zone.faction.en));
      this.zone = zone;
    }
    if (!G.final && lon < FINAL_LON) this.startFinal();
    if (G.final) {
      const left = this.enemies.filter((e) => e.final && !e.sink).length;
      G.finalLeft = left;
      if (left === 0 && !G.finalCleared) { G.finalCleared = true; banner(L('平家の怨霊、鎮まる', 'The Heike ghosts are laid to rest'), L('下関（唐戸）の港へ船を着けよ', 'Bring the ship into Karato harbor, Shimonoseki')); Sfx.bell(); this.goalBeam.visible = true; Sfx.bgm('battle'); }
      const dg = Math.hypot(P.x - this.goal.x, P.z - this.goal.z);
      if (dg < 70) {
        if (G.finalCleared) { G.onGoal(); }
        else if (this.t - (this.goalMsg || -9) > 5) { msg(L(`まだ平家の船が ${left} 艘残っている！`, `${left} Heike ships still remain!`), 'warn', 3); this.goalMsg = this.t; }
      }
    }
    // 名所・橋の案内
    for (const m of [...this.marks, ...this.bridges]) {
      if (m.seen) continue;
      const d = Math.hypot(m.x - P.x, m.z - P.z);
      if (d < 260) { m.seen = true; const o = m.l || m.def; msg(L(`${o.name}${m.def && m.def.group ? `（${m.def.group}）` : ''}が見える`, `In sight: ${o.en || o.name}`), 'sys', 4); }
    }
    for (const m of this.marks) if (m.o.userData.tide) m.o.position.y = Math.sin(this.t * 0.15) * 0.6 - 0.2; // 潮の満ち引き
    for (const w of this.pools) w.group.children.forEach((c, i) => { c.rotation.z = this.t * (1.2 + i * 0.4); });
    // 上陸できる島
    this.landCheckT = (this.landCheckT || 0) - dt;
    if (this.landCheckT <= 0) { this.landCheckT = 0.25; this.canLand = this.findLanding(); this.updateLandPrompt(); }
    const cl = this.canLand;
    if (cl && cl.isl && (I.pressed('KeyE') || I.land)) { I.land = false; G.land(cl); }
    else if (G.state === 'play') {
      // 財宝の残る島の港に入ったら、自動で上陸する
      const nh = this.nearestHarbor();
      if (nh && nh.d < 45 && (this.noAuto !== nh.isl.id || Math.hypot(P.x - this.noAutoX, P.z - this.noAutoZ) > 180)) {
        const h = nh.isl.harbor;
        msg(L(`${nh.isl.name}の港に入った——上陸！`, `Entering the port of ${islandName(nh.isl)} — landing!`), 'sys', 3);
        G.land({ isl: nh.isl, px: h.lx, py: h.ly, shipPx: P.x / SEA_K, shipPy: P.z / SEA_K, heading: P.h, d: 0 });
      }
    }
    I.land = false;
    // 音
    const near = this.enemies.some((e) => !e.sink && Math.hypot(e.x - P.x, e.z - P.z) < 450);
    if (!G.final && Sfx.bgmMode !== 'title') Sfx.bgm(near ? 'battle' : 'sea');
    Sfx.sea(0.25 + Math.min(0.25, Math.abs(P.v) / 80));
    // 空の色（大坂の朝から壇ノ浦の夕暮れへ）
    this.updateSky(G.progress, G.final);
    for (const isl of G.islands) if (isl.harbor) { const b = isl.harbor.beam; const d = Math.hypot(isl.harbor.x - P.x, isl.harbor.z - P.z); b.visible = d < 3500 && !G.taken.has(isl.id); if (b.visible) b.scale.set(1 + d / 1500, 1, 1 + d / 1500); }
    this.beamMat.opacity = 0.18 + Math.sin(this.t * 3) * 0.06;
    this.nav = this.nearestHarbor();
    this.updateChunks(false);
    this.updateCamera(dt, I);
    this.water.position.set(Math.round(this.camera.position.x / 50) * 50, 0, Math.round(this.camera.position.z / 50) * 50);
    this.sky.position.copy(this.camera.position);
    this.waterU.time.value = this.t;
  }
  camHeading() { return this.P.h + this.camYaw; }
  // 照準の向き（3D）
  aimDir() {
    const ch = this.camHeading(), p = this.pitch || 0;
    return new THREE.Vector3(Math.cos(ch) * Math.cos(p), Math.sin(p), Math.sin(ch) * Math.cos(p));
  }
  // 照準の先にいる敵（少しだけ吸い付く）
  aimTarget(fw) {
    const o = this.camera.position;
    let best = null, ba = 0.045;
    for (const e of this.enemies) {
      if (e.sink || e.far) continue;
      const v = new THREE.Vector3(e.x - o.x, 2.5 - o.y, e.z - o.z);
      const d = v.length(); if (d > 420) continue;
      const a = v.normalize().angleTo(fw) - Math.atan((e.r * 0.8) / d);
      if (a < ba) { ba = a; best = e; }
    }
    return best;
  }
  updateCrosshair(fw) {
    const el = $('crosshair'), on = this.aimTarget(fw);
    el.classList.toggle('on', !!on);
  }
  // 追い風なら速く、向かい風なら遅く
  windMul(h) { return 1 + WIND.power * Math.cos(h - WIND.dir); }
  // その場所の潮の流れ（単位/秒）。phase > 0 が上げ潮
  tidePhase() { return Math.sin((this.t / TIDE.period) * Math.PI * 2 + 0.8); }
  current(x, z) {
    const ph = this.tidePhase();
    // 沖：上げ潮は東の海で西へ、西の海で東へ（鞆の浦の沖で出会う）。少しずつ左右に振れる
    const toMeet = x > this.meetX ? Math.PI : 0;
    const near = Math.min(1, Math.abs(x - this.meetX) / 800);
    const wob = Math.sin(this.t * 0.05 + x * 0.0007) * 0.9 + Math.sin(this.t * 0.031 + z * 0.0011) * 0.5;
    const a = toMeet + wob;
    let cx = Math.cos(a) * TIDE.openKt * KT * near, cz = Math.sin(a) * TIDE.openKt * KT * near;
    // 瀬戸では速く、瀬戸の向きに流れる
    for (const s of this.straits) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > s.r) continue;
      const w = 1 - d / s.r;
      cx = cx * (1 - w) + s.fx * s.kt * KT * w; cz = cz * (1 - w) + s.fz * s.kt * KT * w;
    }
    return { x: cx * ph, z: cz * ph, ph };
  }
  // 画面に出す潮と風
  tideInfo() {
    const P = this.P, c = this.cur || { x: 0, z: 0, ph: 0 };
    const sp = Math.hypot(c.x, c.z) / KT;
    let strait = null;
    for (const s of this.straits) if (Math.hypot(P.x - s.x, P.z - s.z) < s.r * 0.8) strait = s;
    const state = Math.abs(c.ph) < 0.2 ? L('潮止まり', 'Slack tide') : c.ph > 0 ? L('上げ潮', 'Flood tide') : L('下げ潮', 'Ebb tide');
    let side = '';
    if (sp > 0.3) {
      const rel = angDiff(Math.atan2(c.z, c.x), P.h);
      side = Math.abs(rel) < 0.6 ? L('↑ 追い潮', '↑ with you') : Math.abs(rel) > 2.5 ? L('↓ 向かい潮', '↓ against you') : rel > 0 ? L('→ 右へ流される', '→ pushing right') : L('← 左へ流される', '← pushing left');
    }
    const wrel = Math.cos(P.h - WIND.dir);
    const wind = wrel > 0.5 ? L('追い風', 'tailwind') : wrel < -0.5 ? L('向かい風', 'headwind') : L('横風', 'crosswind');
    return { text: `${strait ? L(strait.name, strait.en) + ' ' : ''}${state} ${sp.toFixed(1)}${L('ノット', ' kt')} ${side}`, wind: L('東の風（西へ吹く）・', 'East wind (blowing west) · ') + wind, fast: sp > 4 };
  }
  updateCamera(dt, I) {
    const P = this.P;
    I.toggleView = false;
    if (I.down('KeyQ')) this.camYaw -= dt * 1.5;
    if (I.down('KeyE') && !this.canLand) this.camYaw += dt * 1.5;
    if (I.lookDX) { this.camYaw += I.lookDX * 0.004; I.lookDX = 0; }
    const cam = this.camera;
    this.gun.visible = this.view === 'bow';
    if (this.ship.userData.bowsprit) this.ship.userData.bowsprit.visible = this.view !== 'bow'; // 目の前をふさがないように
    if (this.view === 'bow') {
      if (I.lookDY) { this.pitch = clamp((this.pitch || 0) - I.lookDY * 0.004, -0.35, 0.25); I.lookDY = 0; }
      this.camYaw = clamp(this.camYaw, -2.6, 2.6);
      // 船首の低い所から（舳先の内側、目の高さ）
      const ud = this.ship.userData;
      const eye = ud.inner.localToWorld(new THREE.Vector3(0, ud.deckY + 1.5, ud.len * 0.44));
      cam.position.copy(eye);
      const fw = this.aimDir();
      cam.lookAt(eye.x + fw.x * 100, eye.y + fw.y * 100, eye.z + fw.z * 100);
      if (cam.fov !== 48) { cam.fov = 48; cam.updateProjectionMatrix(); }
      I.wheel = 0;
      return;
    }
    if (cam.fov !== 62) { cam.fov = 62; cam.updateProjectionMatrix(); }
    if (I.wheel) { this.camDist = clamp(this.camDist * (1 + I.wheel * 0.001), 30, 220); I.wheel = 0; }
    this.camYaw *= Math.exp(-dt * 0.4);
    const ch = this.camHeading();
    const tx = P.x - Math.cos(ch) * this.camDist, tz = P.z - Math.sin(ch) * this.camDist;
    const k = 1 - Math.exp(-dt * 3);
    if (!this.camInit) { cam.position.set(tx, this.camH, tz); this.camInit = true; }
    cam.position.x += (tx - cam.position.x) * k; cam.position.z += (tz - cam.position.z) * k;
    const gh = Math.max(0, hSea(cam.position.x, cam.position.z) * VEX);
    cam.position.y += (Math.max(this.camH * this.camDist / 46, gh + 6) - cam.position.y) * k;
    cam.lookAt(P.x + Math.cos(P.h) * 45, 4, P.z + Math.sin(P.h) * 45);
  }
  updateSky(p, fin) {
    const top = new THREE.Color('#5a8ed0'), hor = new THREE.Color('#d8e6ee');
    const eveTop = new THREE.Color('#3a3a6a'), eveHor = new THREE.Color('#f0a070');
    const redTop = new THREE.Color('#2a1020'), redHor = new THREE.Color('#c04a30');
    const k = clamp((p - 0.55) / 0.45, 0, 1);
    top.lerp(eveTop, k * 0.8); hor.lerp(eveHor, k * 0.75);
    if (fin) { top.lerp(redTop, 0.7); hor.lerp(redHor, 0.6); }
    this.skyU.top.value.copy(top); this.skyU.hor.value.copy(hor);
    this.fog.color.copy(hor);
    this.waterU.fogColor.value.copy(hor);
    this.waterU.skyC.value.copy(hor).lerp(top, 0.3);
    const sd = new THREE.Vector3(-0.4, 0.75 - k * 0.55, 0.45 - k * 0.2).normalize();
    this.skyU.sunDir.value.copy(sd); this.waterU.sunDir.value.copy(sd);
    this.sun.position.copy(sd);
    this.sun.color.set('#fff4e0').lerp(new THREE.Color('#ffb070'), k);
  }

  aimPoint(I) {
    const P = this.P;
    if (this.view === 'chase') {
      let best = null, bs = 1e9;
      for (const e of this.enemies) {
        if (e.sink || e.far) continue;
        const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz);
        if (d > 330 || d < 8) continue;
        const ad = Math.abs(angDiff(Math.atan2(dz, dx), P.h));
        if (ad > 0.02 + Math.atan(e.r / d)) continue;
        if (d < bs) { bs = d; best = e; }
      }
      this.front = best ? { e: best, d: bs } : null; // 正面にとらえた敵（画面に出す）
      return { x: P.x + Math.cos(P.h) * 260, z: P.z + Math.sin(P.h) * 260 };
    }
    if (this.view === 'bow') {
      const fw = this.aimDir(), o = this.camera.position;
      const tg = this.aimTarget(fw);
      if (tg) return { x: tg.x, z: tg.z, lock: tg };
      if (fw.y < -0.005) { const t = -o.y / fw.y; if (t < 320) return { x: o.x + fw.x * t, z: o.z + fw.z * t }; }
      const l = Math.hypot(fw.x, fw.z) || 1;
      return { x: o.x + fw.x / l * 220, z: o.z + fw.z / l * 220 };
    }
    if (I.mouseAim) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((I.mx / innerWidth) * 2 - 1, -(I.my / innerHeight) * 2 + 1), this.camera);
      const o = ray.ray.origin, d = ray.ray.direction;
      if (d.y < -0.001) {
        const t = -o.y / d.y;
        let x = o.x + d.x * t, z = o.z + d.z * t;
        const dd = Math.hypot(x - P.x, z - P.z);
        if (dd > 300) { x = P.x + (x - P.x) / dd * 300; z = P.z + (z - P.z) / dd * 300; }
        return { x, z };
      }
      // 水平線より上を指したときは、その向きの 300 先
      const l = Math.hypot(d.x, d.z) || 1;
      return { x: P.x + d.x / l * 300, z: P.z + d.z / l * 300 };
    }
    const view = this.camHeading();
    // 自動照準：前方の近い敵
    let best = null, bs = 1e9;
    for (const e of this.enemies) {
      if (e.sink) continue;
      const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz);
      if (d > 280) continue;
      const ad = Math.abs(angDiff(Math.atan2(dz, dx), view));
      if (this.view === 'bow' && ad > 0.5) continue;
      const s = d + ad * 60;
      if (s < bs) { bs = s; best = e; }
    }
    if (best) return { x: best.x + Math.cos(best.h) * best.v * 0.8, z: best.z + Math.sin(best.h) * best.v * 0.8, lock: best };
    return { x: P.x + Math.cos(view) * 160, z: P.z + Math.sin(view) * 160 };
  }
  fireVolley(aim) {
    const P = this.P;
    P.cd = 0.55;
    const a = Math.atan2(aim.z - P.z, aim.x - P.x);
    const dist = clamp(Math.hypot(aim.x - P.x, aim.z - P.z), 40, 300);
    this.gun.userData.kick = 1;
    if (this.view === 'bow') {
      const mz = this.gun.userData.muzzle.getWorldPosition(new THREE.Vector3());
      let fw = this.aimDir();
      const tg = this.aimTarget(fw);
      if (tg) fw = new THREE.Vector3(tg.x + Math.cos(tg.h) * tg.v * 0.3 - mz.x, 2.5 - mz.y, tg.z + Math.sin(tg.h) * tg.v * 0.3 - mz.z).normalize();
      for (let i = 0; i < 4; i++) {
        const sp = 190, j = 0.012;
        const b = this.addBullet(mz.x, mz.y - 0.1, mz.z, (fw.x + rand(-j, j)) * sp, (fw.y + rand(-j, j) + 0.01) * sp, (fw.z + rand(-j, j)) * sp, 'p', 14, 2.0);
        b.g = 4;
      }
      this.sprite('#ffd070', mz.x, mz.y, mz.z, 1.2, 0.12, 0, 0, 0, 0);
      this.smoke(mz.x, mz.y, mz.z, 3);
      Sfx.gun(0.6); setTimeout(() => Sfx.gun(0.35), 70);
      return;
    }
    if (this.gunners) {
      // 5 丁を、ランダムな順にわずかにずらして撃つ
      const order = [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5);
      let wait = 0;
      order.forEach((gi, k) => {
        const g = this.gunners[gi];
        wait += k === 0 ? 0 : rand(40, 110);
        setTimeout(() => this.fireOne(g, P), wait);
      });
      return;
    }
    for (let i = 0; i < 4; i++) {
      const side = angDiff(a, P.h) > 0 ? 1 : -1;
      const ox = P.x + Math.cos(P.h) * (i - 1.5) * 2.6 + Math.cos(P.h + side * Math.PI / 2) * 2.4;
      const oz = P.z + Math.sin(P.h) * (i - 1.5) * 2.6 + Math.sin(P.h + side * Math.PI / 2) * 2.4;
      const aa = a + rand(-0.03, 0.03);
      const sp = 170;
      const tf = dist / sp;
      this.addBullet(ox, 3, oz, Math.cos(aa) * sp, (0 - 2.2) / tf + 4.9 * tf * 0.5 * 0, Math.sin(aa) * sp, 'p', 14, 2.1);
      this.smoke(ox, 2.4, oz, 2);
    }
    Sfx.gun(0.5); setTimeout(() => Sfx.gun(0.35), 60);
  }
  throwBomb(aim) {
    const P = this.P, G = this.G;
    if (G.st < 25) { this.floats.add(P.x, 8, P.z, L('息が切れた', 'Out of breath'), '#ffdc78'); P.cdBomb = 0.3; return; }
    G.st -= 25; G.stDelay = 0.8;
    P.cdBomb = 1.2;
    // 船首の大砲：船の向きに、約 1.8km 先へ
    const mz = this.bowCannon ? this.bowCannon.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(P.x, 4, P.z);
    // 正面に敵がいれば、砲手がその距離に仰角を合わせる
    const fe = this.front && !this.front.e.sink ? this.front.e : null;
    const d = fe ? clamp(Math.hypot(fe.x - mz.x, fe.z - mz.z) + (Math.cos(fe.h) * Math.cos(P.h) + Math.sin(fe.h) * Math.sin(fe.h === undefined ? 0 : P.h)) * fe.v * 0.8, 30, 300) : 180;
    const T = 0.7 + d / 220;
    const vx = Math.cos(P.h) * d / T, vz = Math.sin(P.h) * d / T;
    const vy = (0.5 * 40 * T * T - mz.y) / T;
    this.addBullet(mz.x, mz.y, mz.z, vx, vy, vz, 'bomb', 70, T + 0.5);
    this.muzzleFire(mz, P.h); this.muzzleFire(mz, P.h);
    this.smoke(mz.x, mz.y + 1, mz.z, 6, '#d8d8d8');
    Sfx.cannon(0.8);
    this.camShake = 0.35;
  }
  // 鉄砲隊の 1 人が撃つ
  fireOne(g, P) {
    if (this.G.state !== 'play') return;
    const mz = g.mz.getWorldPosition(new THREE.Vector3());
    const ta = P.h + rand(-0.022, 0.022);
    const b = this.addBullet(mz.x, mz.y, mz.z, Math.cos(ta) * 150, 0.8, Math.sin(ta) * 150, 'p', 14, 2.3);
    b.ox = P.x; b.oz = P.z; b.g = 1.2;
    this.muzzleFire(mz, ta);
    Sfx.gun(rand(0.4, 0.55));
  }
  muzzleFire(p, a) {
    // 銃口から吹き出す火と煙
    for (let k = 0; k < 7; k++) { const s = rand(8, 24); this.sprite(k < 4 ? '#ffb030' : '#ff5a10', p.x + Math.cos(a) * k * 1.1, p.y, p.z + Math.sin(a) * k * 1.1, rand(2.4, 3.6) - k * 0.25, 0.35, Math.cos(a) * s, rand(-1, 2), Math.sin(a) * s, 0.8); }
    this.sprite('#fff0b0', p.x, p.y, p.z, 4, 0.1, 0, 0, 0, 0);
    this.smoke(p.x + Math.cos(a), p.y, p.z + Math.sin(a), 2);
  }
  addBullet(x, y, z, vx, vy, vz, from, dmg, life) {
    let m;
    if (from === 'p' || from === 'e') {
      // 光る弾と、その後ろに伸びる軌跡
      if (!this.tracerGeo) { this.tracerGeo = new THREE.CylinderGeometry(0.5, 0.05, 26, 6, 1, true); this.tracerGeo.rotateX(Math.PI / 2); this.tracerGeo.translate(0, 0, -13);
        this.tracerP = new THREE.MeshBasicMaterial({ color: '#ffe070', transparent: true, opacity: 0.9, depthWrite: false, fog: false });
        this.tracerE = new THREE.MeshBasicMaterial({ color: '#ff5a3a', transparent: true, opacity: 0.85, depthWrite: false, fog: false }); }
      m = new THREE.Group();
      const head = new THREE.Mesh(this.bulletGeo, from === 'p' ? this.tracerP : this.tracerE); head.scale.setScalar(1.1); m.add(head);
      const tail = new THREE.Mesh(this.tracerGeo, from === 'p' ? this.tracerP : this.tracerE); m.add(tail);
      m.lookAt(x + vx, y + vy, z + vz);
    } else m = new THREE.Mesh(this.bulletGeo, this.bombMat);
    m.position.set(x, y, z);
    if (from === 'bomb') m.scale.setScalar(2);
    this.scene.add(m);
    const b = { m, x, y, z, vx, vy, vz, from, dmg, life };
    this.bullets.push(b);
    return b;
  }
  updateBullets(dt) {
    const P = this.P;
    for (const b of this.bullets) {
      b.life -= dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (b.from === 'bomb') { b.vy -= 40 * dt; b.y += b.vy * dt; }
      else if (b.g) { b.vy -= b.g * dt; b.y += b.vy * dt; if (b.y < 0) { b.life = 0; this.splashAt(b.x, b.z, 0.6); } }
      else b.y = Math.max(0.6, b.y - dt * 0.4);
      b.m.position.set(b.x, b.y, b.z);
      if (b.from === 'p' || b.from === 'e') b.m.lookAt(b.x + b.vx, b.y + b.vy, b.z + b.vz);
      if (b.from === 'bomb') {
        if (b.y <= 0.2) {
          b.life = 0;
          this.explode(b.x, b.z);
          for (const e of this.enemies) { if (e.sink) continue; const dd = Math.hypot(e.x - b.x, e.z - b.z); if (dd < 14 + e.r) { const kill = dd < e.r + 3 ? 4 : 2; this.floats.add(e.x, 9, e.z, L(`砲撃！ ${kill} 人`, `Cannon! ${kill} down`), '#ffb040', true); this.hurtEnemy(e, (e.maxHp / 8) * kill + 0.01); } }
        }
        continue;
      }
      if (hSea(b.x, b.z) > 2) { b.life = 0; continue; }
      if (b.from === 'p') {
        for (const e of this.enemies) {
          if (e.sink) continue;
          if (Math.hypot(e.x - b.x, e.z - b.z) < e.r + 0.8 && b.y < 9) {
            b.life = 0;
            if (b.ox === undefined) { this.hurtEnemy(e, b.dmg); break; }
            const d = Math.hypot(e.x - b.ox, e.z - b.oz);
            if (Math.random() < hitChance(d)) { this.floats.add(e.x + rand(-2, 2), 7, e.z, L('命中！', 'Hit!'), '#ffe070'); this.hurtEnemy(e, e.maxHp / 8 + 0.01); }
            else { this.floats.add(e.x + rand(-2, 2), 6, e.z, L('かすった', 'Graze'), '#aab'); this.spark(b.x, 3, b.z); Sfx.clang(); }
            break;
          }
        }
      } else if (Math.hypot(P.x - b.x, P.z - b.z) < PR) {
        b.life = 0; this.hurtHull(b.dmg, b.x, b.z);
      }
      if (b.life <= 0 && b.from !== 'hit') this.splashAt(b.x, b.z, 0.6);
    }
    this.bullets = this.bullets.filter((b) => { if (b.life <= 0) { this.scene.remove(b.m); return false; } return true; });
  }
  hurtEnemy(e, dmg, big) {
    dmg *= rand(0.9, 1.1);
    e.hp -= dmg; e.flash = 0.12;
    if (big) this.floats.add(e.x, 6, e.z, Math.round(dmg), '#ffb040', big);
    Sfx.crack(big ? 0.5 : 0.25);
    this.spark(e.x, 3, e.z);
    this.dropCrew(e);
    if (e.hp <= 0 && !e.sink) this.sinkEnemy(e);
  }
  dropCrew(e) {
    const left = e.hp <= 0 ? 0 : Math.ceil((e.hp / e.maxHp) * 8);
    while (e.crew.length > left) {
      const c = e.crew.splice((Math.random() * e.crew.length) | 0, 1)[0];
      const wp = new THREE.Vector3(); c.getWorldPosition(wp);
      c.parent.remove(c);
      c.position.copy(wp); c.scale.setScalar(ENEMY_SCALE); c.rotation.set(0, rand(0, TAU), 0);
      this.scene.add(c);
      this.fallers.push({ m: c, vx: rand(-4, 4), vy: rand(4, 8), vz: rand(-4, 4), t: 0 });
    }
  }
  updateFallers(dt) {
    for (const f of this.fallers) {
      f.t += dt; f.vy -= 30 * dt;
      f.m.position.x += f.vx * dt; f.m.position.y += f.vy * dt; f.m.position.z += f.vz * dt;
      f.m.rotation.x += dt * 5;
      if (f.m.position.y < 0 && !f.splashed) { f.splashed = true; this.splashAt(f.m.position.x, f.m.position.z, 0.5); }
    }
    this.fallers = this.fallers.filter((f) => { if (f.t > 1.6) { this.scene.remove(f.m); return false; } return true; });
  }
  sinkEnemy(e) {
    const G = this.G;
    e.sink = 0.001;
    G.sunk++;
    Sfx.sink(); Sfx.swell(0.5);
    this.explode(e.x, e.z, true);
    const gold = { kobaya: 20, seki: 50, ataka: 150 }[e.type] * (e.boss ? 5 : 1);
    G.gold += gold;
    this.floats.add(e.x, 10, e.z, L(`自爆！ +${gold}両`, `Self-destruct! +${gold} ryō`), '#ffd24a', true);
    msg(L(`${e.name}の船員を全て倒した。船は自爆した！（撃沈 ${G.sunk}）`, `All hands on the ${e.name} are down — she blows herself up! (${G.sunk} sunk)`), 'kill', 4);
    for (let k = 0; k < 3; k++) setTimeout(() => this.explode(e.x + rand(-4, 4), e.z + rand(-4, 4), true), 150 + k * 260);
    flash('rgba(255,160,60,0.25)');
    if (e.boss) banner(L('平知盛、海に沈む', 'Tomomori sinks beneath the waves'), L('「沈むは平家か、海賊王か」', '“Who sinks — the Heike, or the Pirate King?”'));
    // 浮かぶ樽（兵糧・修理）
    if (Math.random() < (e.type === 'kobaya' ? 0.35 : 0.8) || e.boss) this.addLoot(e.x + rand(-4, 4), e.z + rand(-4, 4), e.type === 'ataka' ? 'big' : 'small');
  }
  hurtHull(dmg, fx, fz, silent) {
    const G = this.G;
    if (G.state !== 'play') return;
    G.hp -= dmg;
    G.lastHurt = G.t;
    this.floats.add(this.P.x, 14, this.P.z, '-' + Math.round(dmg), '#ff5a4a');
    if (!silent) Sfx.crack(0.35);
    flash('rgba(200,0,0,0.18)');
    this.camShake = 0.6;
    if (G.hp <= 0) { G.hp = 0; G.die(L('海の上で討死', 'Fell in battle at sea')); }
  }
  updateEnemy(e, dt) {
    const P = this.P;
    if (e.sink) {
      e.sink += dt;
      e.m.position.y = -e.sink * 2.2;
      e.m.rotation.z += dt * 0.25; e.m.rotation.x += dt * 0.1;
      if (Math.random() < 0.3) this.smoke(e.x + rand(-3, 3), 2, e.z + rand(-3, 3), 1, '#404040');
      return;
    }
    e.cd -= dt; e.flash = (e.flash || 0) - dt;
    const dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz);
    const toP = Math.atan2(dz, dx);
    // 遠くの追手：見えないところで少しずつ追いつく（自船の全速よりは遅い）
    if (e.far) {
      const sp = e.speed * 0.8 * dt;
      e.x += dx / d * sp; e.z += dz / d * sp;
      if (d < 1500) {
        for (let tries = 0; tries < 20; tries++) {
          const x = e.x + rand(-150, 150), z = e.z + rand(-150, 150);
          if (this.waterAt(x, z, 3) && Math.hypot(P.x - x, P.z - z) > 600) {
            e.x = x; e.z = z; e.far = false; e.m.visible = true; e.h = Math.atan2(P.z - z, P.x - x);
            msg(L(`${e.name}が追いついてきた！（船員 ${e.crew.length} 人）`, `${e.name} has caught up! (${e.crew.length} crew)`), 'warn', 3);
            break;
          }
        }
      }
      return;
    }
    if (e.pursue && !e.final && d > 2000) { e.far = true; e.m.visible = false; return; }
    let want;
    const gd = e.guard;
    if (gd && !e.pursue) {
      // 島の縄張りを回る。近づくか撃たれると襲ってくる
      const pd = Math.hypot(P.x - gd.cx, P.z - gd.cz);
      if (pd < gd.R + 60 || d < 200 || e.hp < e.maxHp) {
        e.pursue = true; this.G.guards.set(gd.id, 'fought');
        msg(L(`${gd.name}の縄張りに入った！ 守りの船が来る`, `You entered the waters of ${gd.name}! Its guard ships attack`), 'warn', 3);
        for (const f of this.enemies) if (f.guard && f.guard.id === gd.id) f.pursue = true;
      } else {
        gd.ang += dt * (e.speed * 0.45) / gd.R;
        const tx = gd.cx + Math.cos(gd.ang) * gd.R, tz = gd.cz + Math.sin(gd.ang) * gd.R;
        want = Math.atan2(tz - e.z, tx - e.x);
      }
    }
    if (want === undefined && d > 240) want = toP;
    else if (want === undefined && d < 70) want = toP + Math.PI * 0.7 * (Math.sin(e.wob) > 0 ? 1 : -1);
    else if (want === undefined) want = toP + (Math.PI / 2) * (Math.sin(e.wob) > 0 ? 1 : -1) * 0.85; // 舷側を向けて回る
    // 陸を避ける
    const probe = (a, L) => hSea(e.x + Math.cos(a) * L, e.z + Math.sin(a) * L) < -1.5;
    if (!probe(e.h, 25) || !probe(e.h, 12)) {
      want = probe(e.h + 0.9, 25) ? e.h + 1.2 : probe(e.h - 0.9, 25) ? e.h - 1.2 : e.h + Math.PI;
    }
    const da = angDiff(want, e.h);
    e.h += clamp(da, -1, 1) * 0.9 * dt;
    const tv = e.speed * (d < 100 ? 0.65 : 1) * (gd && !e.pursue ? 0.5 : 1);
    e.v += (tv - e.v) * (1 - Math.exp(-dt * 0.8));
    const ec = this.current(e.x, e.z), wv = e.v * this.windMul(e.h);
    const nx = e.x + (Math.cos(e.h) * wv + ec.x) * dt, nz = e.z + (Math.sin(e.h) * wv + ec.z) * dt;
    if (hSea(nx, nz) < -1.2 && !this.isletAt(nx, nz, 2)) { e.x = nx; e.z = nz; } else { e.v *= 0.3; e.h += 1.5 * dt; }
    // 船どうしの押し合い
    for (const f of this.enemies) {
      if (f === e || f.sink) continue;
      const ox = f.x - e.x, oz = f.z - e.z, od = Math.hypot(ox, oz), rr = e.r + f.r + 1;
      if (od < rr && od > 0.01) { e.x -= ox / od * (rr - od) * 0.5; e.z -= oz / od * (rr - od) * 0.5; }
    }
    if (d < e.r + PR) {
      e.x -= dx / d * (e.r + PR - d); e.z -= dz / d * (e.r + PR - d);
      if (P.inv <= 0 && Math.abs(this.P.v) > 15) { this.hurtEnemy(e, Math.abs(P.v) * 1.2, true); P.inv = 0.6; this.floats.add(e.x, 9, e.z, L('体当たり！', 'Ram!'), '#ff9a5a'); }
    }
    // 鉄砲を撃つ
    if (d < 230 && e.cd <= 0 && e.pursue) {
      e.cd = rand(1.6, 2.8) / (e.boss ? 1.6 : 1);
      const lead = d / 140;
      const tx = P.x + Math.cos(P.h) * P.v * lead, tz = P.z + Math.sin(P.h) * P.v * lead;
      for (let i = 0; i < e.guns; i++) {
        setTimeout(() => {
          if (e.sink || this.G.state !== 'play') return;
          const a = Math.atan2(tz - e.z, tx - e.x) + rand(-0.06, 0.06);
          this.addBullet(e.x, 2, e.z, Math.cos(a) * 140, 0, Math.sin(a) * 140, 'e', e.dmg, 2.0);
          this.muzzleFire({ x: e.x + Math.cos(a) * e.r, y: 2.2, z: e.z + Math.sin(a) * e.r }, a);
          Sfx.gun(clamp(0.45 - d / 700, 0.08, 0.4));
        }, i * 160);
      }
    }
    e.m.position.set(e.x, 0.2 + Math.sin(this.t * 1.2 + e.wob) * 0.12, e.z);
    e.m.rotation.set(0, Math.atan2(-Math.cos(e.h), -Math.sin(e.h)), 0);
    e.m.rotateZ(Math.sin(this.t * 0.8 + e.wob) * 0.03);
    animateShip(e.m, this.t + e.wob, e.v);
    const cv = d < 450; if (e.crewVis !== cv) { e.crewVis = cv; for (const c of e.crew) c.visible = cv; }
    if (d < 500) { const la = Math.atan2(-(P.x - e.x), -(P.z - e.z)) - e.m.rotation.y - Math.PI; for (const c of e.crew) c.rotation.y = la + Math.PI; }
    this.addWake(e.x, e.z, e.h, e.v, e.r);
  }

  // ---- 粒子 ----
  sprite(color, x, y, z, s, life, vx = 0, vy = 0, vz = 0, grow = 1) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color, transparent: true, depthWrite: false }));
    m.position.set(x, y, z); m.scale.setScalar(s);
    this.scene.add(m);
    this.parts.push({ m, life, max: life, vx, vy, vz, grow });
    if (this.parts.length > 260) { const p = this.parts.shift(); this.scene.remove(p.m); p.m.material.dispose(); }
  }
  smoke(x, y, z, n = 1, c = '#e8e8e8') { for (let i = 0; i < n; i++) this.sprite(c, x + rand(-1, 1), y, z + rand(-1, 1), rand(1.5, 3), rand(1, 1.6), rand(-1, 1), rand(1, 3), rand(-1, 1), 2); }
  spark(x, y, z) { for (let i = 0; i < 4; i++) this.sprite('#ffd080', x, y, z, 1.2, 0.25, rand(-15, 15), rand(0, 12), rand(-15, 15), 0); }
  splashAt(x, z, s = 1) { for (let i = 0; i < 4; i++) this.sprite('#f0f8ff', x + rand(-1, 1) * s, 0.5, z + rand(-1, 1) * s, rand(1, 2) * s, 0.6, rand(-2, 2), rand(5, 9) * s, rand(-2, 2), 1); }
  explode(x, z, big) {
    for (let i = 0; i < (big ? 14 : 8); i++) this.sprite(i % 2 ? '#ff9a40' : '#ffd070', x, 1.5, z, rand(2, 5), 0.5, rand(-12, 12), rand(4, 16), rand(-12, 12), 1.5);
    this.smoke(x, 2, z, big ? 8 : 4, '#5a5a5a');
    this.splashAt(x, z, big ? 3 : 2);
    Sfx.bomb();
  }
  addWake(x, z, h, v, w) {
    if (Math.abs(v) < 5 || Math.random() > dtWake(v)) return;
    const bx = x - Math.cos(h) * w * 1.1, bz = z - Math.sin(h) * w * 1.1;
    this.sprite('#eef6f8', bx + rand(-0.6, 0.6), 0.2, bz + rand(-0.6, 0.6), rand(0.6, 1.1), 1.2, -Math.cos(h) * 2 + rand(-1.5, 1.5), 0, -Math.sin(h) * 2 + rand(-1.5, 1.5), 1.6);
  }
  updateParts(dt) {
    for (const p of this.parts) {
      p.life -= dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      p.vy -= dt * (p.grow === 0 ? 30 : 0);
      p.m.scale.multiplyScalar(1 + dt * p.grow * 0.5);
      p.m.material.opacity = clamp(p.life / p.max, 0, 1) * 0.6;
    }
    this.parts = this.parts.filter((p) => { if (p.life <= 0) { this.scene.remove(p.m); p.m.material.dispose(); return false; } return true; });
  }
  addLoot(x, z, kind) {
    const g = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10), mat('#8a5a2a'));
    barrel.rotation.z = Math.PI / 2; g.add(barrel);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.08, 4, 12), mat('#2a2a2a')); ring.rotation.y = Math.PI / 2; g.add(ring);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe080', transparent: true, opacity: 0.2, depthWrite: false })); g.add(glow);
    g.position.set(x, 0.3, z);
    this.scene.add(g);
    this.loot.push({ g, x, z, kind, t: 0 });
  }
  updateLoot(dt) {
    const P = this.P, G = this.G;
    for (const l of this.loot) {
      l.t += dt;
      const lc = this.current(l.x, l.z); l.x += lc.x * dt; l.z += lc.z * dt; l.g.position.x = l.x; l.g.position.z = l.z;
      l.g.position.y = 0.3 + Math.sin(l.t * 2) * 0.2; l.g.rotation.y += dt * 0.5;
      if (Math.hypot(l.x - P.x, l.z - P.z) < PR + 4) {
        l.taken = true;
        const fix = l.kind === 'big' ? 60 : 25;
        G.hp = Math.min(G.maxHp, G.hp + fix);
        G.gold += l.kind === 'big' ? 60 : 15;
        this.floats.add(P.x, 8, P.z, L(`兵糧樽 体力+${fix}`, `Supply barrel: HP +${fix}`), '#7dff8a');
        Sfx.coin();
      }
    }
    this.loot = this.loot.filter((l) => { if (l.taken || l.t > 60) { this.scene.remove(l.g); return false; } return true; });
  }

  // ---- 上陸 ----
  findLanding() {
    const P = this.P, G = this.G;
    const px = P.x / SEA_K, py = P.z / SEA_K;
    const near = nearestLandPx(px, py, 6);
    if (!near || near.d > 5) return null;
    const comp = compAt(near.x, near.y);
    let cands = G.islands.filter((i) => i.comp === comp && comp >= 0);
    if (!cands.length) cands = G.islands.filter((i) => i.merged && Math.hypot(i.px - near.x, i.py - near.y) < 22);
    if (!cands.length) {
      const big = DEM.comps[comp] && DEM.comps[comp].area > 60000;
      const un = this.uninhabitedName(near.x * SEA_K, near.y * SEA_K, 250);
      const nm = un ? L(un.name, romaji(un.kana || un.name)) + ' ' : '';
      return { isl: null, why: big && !un ? L('本州・四国・九州には上陸できぬ', 'You cannot land on Honshu, Shikoku or Kyushu') : nm + L('（無人島）財宝はなさそうだ', '(uninhabited) — no treasure here') };
    }
    cands.sort((a, b) => Math.hypot(a.px - near.x, a.py - near.y) - Math.hypot(b.px - near.x, b.py - near.y));
    return { isl: cands[0], px: near.x, py: near.y, shipPx: px, shipPy: py, heading: P.h, d: near.d };
  }
  updateLandPrompt() {
    const el = $('landPrompt');
    const c = this.canLand;
    if (!c) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (!c.isl) { el.innerHTML = `<span class="dim">${c.why}</span>`; return; }
    const taken = this.G.taken.has(c.isl.id);
    el.innerHTML = L(`<b>${c.isl.name}</b><small>（${c.isl.kana}）</small> ${taken ? '<span class="dim">財宝は奪った</span>' : '<span class="gold">財宝あり</span>'}<br><kbd>E</kbd> 上陸する`, `<b>${islandName(c.isl)}</b> ${taken ? '<span class="dim">already raided</span>' : '<span class="gold">treasure!</span>'}<br><kbd>E</kbd> Land`);
  }

  // ---------------- 描画 ----------------
  render(dt) {
    const cam = this.camera;
    if (this.camShake > 0) { this.camShake -= dt; cam.position.x += rand(-0.4, 0.4); cam.position.y += rand(-0.3, 0.3); }
    this.r.render(this.scene, cam);
    this.floats.update(dt, cam);
    this.tags.begin();
    const P = this.P;
    for (const e of this.enemies) {
      if (e.sink || e.far) continue;
      const d = Math.hypot(e.x - P.x, e.z - P.z);
      if (d > 700 || (e.guard && !e.pursue && d > 350)) continue;
      this.tags.put(cam, e.x, 9 + e.r, e.z, e.name, e.hp / e.maxHp, e.boss ? 'boss' : e.ghost ? 'ghost' : '');
    }
    // 島の名前（上陸できる島がわかるように）
    const near = [];
    for (const isl of this.G.islands) {
      const cx = (isl.merged ? isl.px : isl.cx) * SEA_K, cz = (isl.merged ? isl.py : isl.cy) * SEA_K;
      const d = Math.hypot(cx - P.x, cz - P.z);
      if (d < 2400) near.push([d, isl, cx, cz]);
    }
    near.sort((p, q) => p[0] - q[0]);
    const narrow = innerWidth < 700;
    for (const [d, isl, cx0, cz0] of near.slice(0, narrow ? 4 : 8)) {
      const taken = this.G.taken.has(isl.id);
      const cx = !taken && isl.harbor ? isl.harbor.x : cx0, cz = !taken && isl.harbor ? isl.harbor.z : cz0;
      const label = islandName(isl) + (taken ? L('　財宝は奪った', ' · raided') : narrow ? ' ⚓' : L(' ⚓港', ' ⚓ port'));
      this.tags.put(cam, cx, taken ? (isl.maxH || 30) * VEX + 6 : 40, cz, label, null, taken ? 'isl done' : 'isl');
    }
    const un = [];
    for (const u of this.uninhabited || []) { const d = Math.hypot(u.x - P.x, u.z - P.z); if (d < 1100) un.push([d, u]); }
    un.sort((p, q) => p[0] - q[0]);
    for (const [, u] of un.slice(0, narrow ? 2 : 6)) this.tags.put(cam, u.x, u.h * VEX + 4, u.z, L(u.name + '（無人島）', romaji(u.kana || u.name) + ' (uninhabited)'), null, 'isl none');
    this.tags.end();
    this.miniT = (this.miniT || 0) - dt;
    if (this.miniT <= 0) { this.miniT = 0.2; this.drawMinimap(); }
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  // 島から戻ったとき
  resume(islId) {
    this.noAuto = islId; this.noAutoX = this.P.x; this.noAutoZ = this.P.z;
    this.updateChunks(true);
    this.floats.clear();
    this.P.v = 0; this.P.sail = 1;
    this.P.inv = 2;
    // 近くの敵を少し遠ざける
    // 上陸している間に近くの船は少し離れる（追手はあきらめない）
    for (const e of this.enemies) if (!e.final && !e.sink && Math.hypot(e.x - this.P.x, e.z - this.P.z) < 400) { e.far = true; e.m.visible = false; e.x = this.P.x + 900; e.z = this.P.z; }
    this.spawnT = 6;
  }
}

// 距離（単位。1 = 10m）ごとの、当たった弾が敵兵を倒す確率
export function hitChance(d) { return clamp(1.1 - d / 300, 0.2, 0.98); }
function dtWake(v) { return Math.min(0.9, Math.abs(v) / 40); }
function makeSmokeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
