// 島モード：上陸した場所のまわりを、国土地理院の標高（5m メッシュ）・空中写真・建物の形から 3D で作る
// 戦い方は「孤軍奮闘小早川」と同じ（駆＝ダッシュ、刀＝3 連目で回転斬り・弾を弾く、槍＝駆を使い 2 人まで貫く、おむすびで回復）
import * as THREE from './vendor/three.module.min.js';
import { DEM, hPx, px2ll, lon2gx, lat2gy, gx2lon, gy2lat, loadImage, fetchWithTimeout, SEA_FLOOR } from './geo.js';
import { LANDMARKS, ISLAND_NOTES, ISLAND_NOTES_EN, ISLAND_BOSSES, ZONES, zoneAt, maxHpFor } from './data.js';
import { decodeMVT } from './mvt.js';
import { Fireworks } from './fireworks.js';
import { animateChest, makeFishingPort, makeCrewman, makeWarrior, poseWarrior, makeTorii, makeHall, makePagoda, makeJoyato, makeChest, makeOnigiri, makeShip, makeDeer, makeRabbit, makeGangi, makePumpkin, mat } from './models.js';
import { Sfx } from './audio.js';
import { LITE } from './perf.js';
import { msg, banner, flash, Floats, Tags, $ } from './ui.js';
import { L, islandName } from './i18n.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const hypot = Math.hypot;
// カメラと主人公の間にある家や木を消す（手前だけ穴を開ける）
const CUT = { value: 0 };
const PPOS = { value: new THREE.Vector3() };
// カメラの手前は消し、主人公のまわりの建物や木は網目に透かして、敵が隠れないようにする
function cutaway(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.cutR = CUT; sh.uniforms.ppos = PPOS;
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  #ifdef USE_INSTANCING
    vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`);
    sh.fragmentShader = 'uniform float cutR;\nuniform vec3 ppos;\nvarying vec3 vWPos;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (length(vViewPosition) < cutR) discard;
  if (distance(vWPos.xz, ppos.xz) < 22.0 && vWPos.y > ppos.y + 0.6 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;`);
  };
  return m;
}

// 戦いの数値（小早川の値を、1 画素 ≒ 4.5cm として m に直したもの）
const K = {
  walk: 13.2 * 1.5, dashMul: 1.9, // さらに 1.5 倍（2026-11） // 歩きは小早川の 3 倍（財宝まで速く行けるように） swordR: 2.7, spinR: 3.2, swordArc: 1.25, spearLen: 4.8, spearChargeLen: 5.8, spearHalf: 0.75,
  pr: 0.5, er: 0.42, reach: 1.0, genReach: 1.3, gunRange: 26, bulletSp: 34, knock: 7,
  SPEAR_ST: 14, PIERCE: 2, dmg: 1.24, genHp: 1.29, genHeal: 46, dropRate: 0.05, regen: 1.5,
};
const DEM_URL = { a: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/${z}/${x}/${y}.png`, b: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png` };
const PHOTO_URL = (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`;
const VT_URL = (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${z}/${x}/${y}.pbf`;

async function demTile(url) {
  try {
    const r = await fetchWithTimeout(url, 10000);
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, 256, 256).data;
    const out = new Float32Array(256 * 256);
    for (let i = 0; i < 65536; i++) {
      const x = d[i * 4] * 65536 + d[i * 4 + 1] * 256 + d[i * 4 + 2];
      out[i] = x === 8388608 ? NaN : x < 8388608 ? x * 0.01 : (x - 16777216) * 0.01;
    }
    return out;
  } catch (e) { return null; }
}

export class Island {
  constructor(renderer, G) {
    this.r = renderer; this.G = G;
    this.floats = new Floats(); this.tags = new Tags();
  }

  // ---------------- 読み込み ----------------
  async load(landing, onText) {
    const G = this.G, isl = landing.isl;
    this.isl = isl;
    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.3, 9000);
    // 上陸地点（岸）と船のいた場所
    const [lonL, latL] = px2ll(landing.px + 0.5, landing.py + 0.5);
    const [lonS, latS] = px2ll(landing.shipPx, landing.shipPy);
    // 範囲：小さな島は島全体、大きな島は上陸地点のまわり
    const mppDem = 126;
    const bw = (isl.bbox[2] - isl.bbox[0] + 1) * mppDem, bh = (isl.bbox[3] - isl.bbox[1] + 1) * mppDem;
    let cLon, cLat, size;
    if (!isl.merged && Math.max(bw, bh) < 1500) {
      [cLon, cLat] = px2ll((isl.bbox[0] + isl.bbox[2] + 1) / 2, (isl.bbox[1] + isl.bbox[3] + 1) / 2);
      size = Math.max(bw, bh) + 700;
    } else {
      const [iLon, iLat] = isl.merged ? [isl.lon, isl.lat] : px2ll(isl.cx, isl.cy);
      const dx = iLon - lonL, dy = iLat - latL, dl = Math.hypot(dx * 0.83, dy) || 1;
      const off = Math.min(0.0045, dl * 0.5);
      cLon = lonL + (dx * 0.83 / dl) * off / 0.83; cLat = latL + (dy / dl) * off;
      size = 1900;
    }
    size = clamp(size, 900, 2000);
    this.size = size;
    const Z = 15;
    const mpp = (156543.034 * Math.cos((cLat * Math.PI) / 180)) / 2 ** Z;
    this.mpp = mpp;
    const cgx = lon2gx(cLon, Z), cgy = lat2gy(cLat, Z);
    this.cgx = cgx; this.cgy = cgy; this.Z = Z;
    // 経緯度 → この島の座標（m）
    this.toLocal = (lon, lat) => [(lon2gx(lon, Z) - cgx) * mpp, (lat2gy(lat, Z) - cgy) * mpp];
    const half = size / 2;
    const step = size > 1400 ? 2 : 1; // 標高の画素の間引き
    const N = Math.floor(size / mpp / step) + 1;
    this.N = N; this.cell = mpp * step;
    const gx0 = cgx - half / mpp, gy0 = cgy - half / mpp;
    this.gx0 = gx0; this.gy0 = gy0;
    // ---- 標高 ----
    onText && onText(L('地形を測っています……（国土地理院 5m メッシュ）', 'Surveying the land… (GSI 5 m elevation mesh)'));
    const tx0 = Math.floor(gx0 / 256), tx1 = Math.floor((gx0 + size / mpp) / 256), ty0 = Math.floor(gy0 / 256), ty1 = Math.floor((gy0 + size / mpp) / 256);
    const tilesA = new Map(), tilesB = new Map();
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push(demTile(DEM_URL.a(15, tx, ty)).then((d) => tilesA.set(tx + ',' + ty, d)));
    for (let ty = ty0 >> 1; ty <= ty1 >> 1; ty++) for (let tx = tx0 >> 1; tx <= tx1 >> 1; tx++) jobs.push(demTile(DEM_URL.b(14, tx, ty)).then((d) => tilesB.set(tx + ',' + ty, d)));
    await Promise.all(jobs);
    let online = [...tilesA.values(), ...tilesB.values()].some((v) => v);
    this.online = online;
    const H = new Float32Array(N * N);
    const sampleA = (gx, gy) => { const t = tilesA.get(Math.floor(gx / 256) + ',' + Math.floor(gy / 256)); if (!t) return undefined; return t[(Math.floor(gy) & 255) * 256 + (Math.floor(gx) & 255)]; };
    const sampleB = (gx, gy) => { const x = gx / 2, y = gy / 2; const t = tilesB.get(Math.floor(x / 256) + ',' + Math.floor(y / 256)); if (!t) return undefined; return t[(Math.floor(y) & 255) * 256 + (Math.floor(x) & 255)]; };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const gx = gx0 + i * step, gy = gy0 + j * step;
      let h;
      if (online) {
        let a = sampleA(gx, gy);
        if (a === undefined || Number.isNaN(a)) { const b = sampleB(gx, gy); a = b === undefined ? NaN : b; }
        h = Number.isNaN(a) ? -4 : Math.max(0.4, a + 0.4);
      } else {
        // 通信できないときは手元の粗い標高で
        const lon = gx2lon(gx, Z), lat = gy2lat(gy, Z);
        const px = lon2gx(lon) - DEM.x0 * 256, py = lat2gy(lat) - DEM.y0 * 256;
        const v = hPx(px, py); h = v > 0 ? v + 0.4 : -4;
      }
      H[j * N + i] = h;
    }
    // 少しならす（海と陸の境）
    this.H = H;
    // ---- 歩ける範囲（上陸した島だけ） ----
    const [lx, lz] = this.toLocal(lonL, latL);
    const [sx, sz] = this.toLocal(lonS, latS);
    let start = this.nearestLandCell(lx, lz, sx, sz);
    const walk = new Uint8Array(N * N);
    if (start >= 0) {
      const st = [start]; walk[start] = 1;
      while (st.length) {
        const k = st.pop(); const i = k % N, j = (k / N) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj; if (ii < 1 || jj < 1 || ii >= N - 1 || jj >= N - 1) continue;
          const q = jj * N + ii; if (walk[q] || H[q] <= 0.3) continue; walk[q] = 1; st.push(q);
        }
      }
    }
    // 1 マスだけ波打ち際へ広げる
    const walk2 = walk.slice();
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const k = j * N + i; if (!walk[k] && (walk[k - 1] || walk[k + 1] || walk[k - N] || walk[k + N]) && H[k] > -5) walk2[k] = 2; }
    this.walk = walk2;
    // ---- 空中写真 ----
    onText && onText(L('空から島を見ています……（国土地理院 空中写真）', 'Looking down from the sky… (GSI aerial photos)'));
    const pz = 17; // 約 1m / 画素
    const pscale = 2 ** (pz - Z);
    const pgx0 = gx0 * pscale, pgy0 = gy0 * pscale, pw = Math.ceil((size / mpp) * pscale);
    const cv = document.createElement('canvas'); cv.width = cv.height = Math.min(2048, pw);
    const cg = cv.getContext('2d', { willReadFrequently: true });
    const sc = cv.width / pw;
    this.paintFallback(cg, cv.width);
    let photoOK = 0;
    if (online) {
      const pj = [];
      for (let ty = Math.floor(pgy0 / 256); ty <= Math.floor((pgy0 + pw) / 256); ty++) for (let tx = Math.floor(pgx0 / 256); tx <= Math.floor((pgx0 + pw) / 256); tx++) {
        pj.push(loadImage(PHOTO_URL(pz, tx, ty)).then((im) => { cg.drawImage(im, (tx * 256 - pgx0) * sc, (ty * 256 - pgy0) * sc, 256 * sc + 0.6, 256 * sc + 0.6); photoOK++; }).catch(() => {}));
      }
      await Promise.all(pj);
    }
    this.photo = cv; this.photoCtx = cg;
    // ---- 建物・社寺（ベクトルタイル） ----
    onText && onText(L('家並みと社寺を建てています……', 'Building houses, shrines and temples…'));
    const vt = { building: [], symbol: [], label: [], road: [] };
    if (online) {
      const vz = 16, vs = 2 ** (vz - Z);
      const vj = [];
      for (let ty = Math.floor((gy0 * vs) / 256); ty <= Math.floor(((gy0 + size / mpp) * vs) / 256); ty++) for (let tx = Math.floor((gx0 * vs) / 256); tx <= Math.floor(((gx0 + size / mpp) * vs) / 256); tx++) {
        vj.push(fetchWithTimeout(VT_URL(vz, tx, ty), 10000).then((r) => (r.ok ? r.arrayBuffer() : null)).then((buf) => {
          if (!buf) return;
          const L = decodeMVT(buf, ['building', 'symbol', 'label', 'road']);
          for (const name of Object.keys(vt)) for (const f of L[name] || []) {
            const ex = f.extent;
            const conv = (p) => { const gx = (tx + p[0] / ex) * 256 / vs, gy = (ty + p[1] / ex) * 256 / vs; return [(gx - cgx) * mpp, (gy - cgy) * mpp]; };
            const geom = f.geom.map((ring) => ring.map(conv));
            if (name === 'building') { const r = f.geom[0]; let cx = 0, cy = 0; for (const p of r) { cx += p[0]; cy += p[1]; } cx /= r.length; cy /= r.length; if (cx < 0 || cy < 0 || cx >= ex || cy >= ex) continue; }
            vt[name].push({ props: f.props, geom });
          }
        }).catch(() => {}));
      }
      await Promise.all(vj);
    }
    this.vt = vt;
    onText && onText(L('上陸の支度……', 'Preparing to land…'));
    this.buildScene(lx, lz, sx, sz, start, photoOK);
    return true;
  }

  // 上陸する場所：防波堤や小さな岩ではなく、島そのもの（大きな陸のかたまり）のうち、港にいちばん近い所
  nearestLandCell(lx, lz, sx, sz) {
    const N = this.N, H = this.H;
    const lab = new Int32Array(N * N).fill(-1), size = [];
    for (let k0 = 0; k0 < N * N; k0++) {
      if (H[k0] <= 0.6 || lab[k0] >= 0) continue;
      const id = size.length; let n = 0; const st = [k0]; lab[k0] = id;
      while (st.length) { const k = st.pop(); n++; const i = k % N; for (const q of [i > 0 ? k - 1 : -1, i < N - 1 ? k + 1 : -1, k - N, k + N]) if (q >= 0 && q < N * N && H[q] > 0.6 && lab[q] < 0) { lab[q] = id; st.push(q); } }
      size.push(n);
    }
    // 島の中心（地名の位置）に近い大きなかたまりを島とする
    const [cx, cz] = this.toLocal(this.isl.lon, this.isl.lat);
    let islandId = -1, bs = -1e9;
    for (let k = 0; k < N * N; k += 3) {
      const id = lab[k]; if (id < 0 || size[id] < 60) continue;
      const [x, z] = this.cellPos(k % N, (k / N) | 0);
      const sc = Math.log(size[id]) * 300 - hypot(x - cx, z - cz);
      if (sc > bs) { bs = sc; islandId = id; }
    }
    let best = -1, bd = 1e9;
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i; if (H[k] <= 0.6) continue;
      if (islandId >= 0 && lab[k] !== islandId) continue;
      const [x, z] = this.cellPos(i, j);
      const d = hypot(x - lx, z - lz) * 0.6 + hypot(x - sx, z - sz);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  cellPos(i, j) { const half = this.size / 2; return [i * this.cell - half, j * this.cell - half]; }
  // 地面の高さ（m）
  hAt(x, z) {
    const N = this.N, half = this.size / 2;
    let fx = (x + half) / this.cell, fz = (z + half) / this.cell;
    fx = clamp(fx, 0, N - 1.001); fz = clamp(fz, 0, N - 1.001);
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, H = this.H, k = j * N + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + N] * (1 - u) + H[k + N + 1] * u) * v;
  }
  // 桟橋の上なら、その高さ
  onPlank(x, z) {
    const p = this.plank; if (!p) return null;
    const dx = p.bx - p.ax, dz = p.bz - p.az, L = hypot(dx, dz) || 1;
    const t = ((x - p.ax) * dx + (z - p.az) * dz) / (L * L), side = Math.abs(((x - p.ax) * dz - (z - p.az) * dx) / L);
    return t > -0.05 && t < 1.05 && side < p.hw ? p.y : null;
  }
  inBuilding(x, z) { for (const b of this.bgrid(x, z)) if (insideOBB(b, x, z, 0.35)) return true; return false; }
  // 動くときの判定：家の中も通り抜けられる（主人公の近くの家は透けて見えないので、見えない壁にならないように）
  canWalkOpen(x, z) { if (this.onPlank(x, z) !== null) return true; const N = this.N, half = this.size / 2; const i = Math.round((x + half) / this.cell), j = Math.round((z + half) / this.cell); return i >= 1 && j >= 1 && i < N - 1 && j < N - 1; }
  canWalk(x, z) {
    if (this.onPlank(x, z) !== null) return true;
    const N = this.N, half = this.size / 2;
    const i = Math.round((x + half) / this.cell), j = Math.round((z + half) / this.cell);
    if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) return false;
    // 海は泳げる・向こうの陸にも渡れる（範囲の端と建物だけは通れない）
    for (const b of this.bgrid(x, z)) if (insideOBB(b, x, z, 0.35)) return false;
    return true;
  }
  paintFallback(g, W) {
    // 写真が取れないとき：標高から色を塗る
    const N = this.N, H = this.H;
    const im = g.createImageData(W, W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const h = H[Math.min(N - 1, ((y / W) * N) | 0) * N + Math.min(N - 1, ((x / W) * N) | 0)];
      const o = (y * W + x) * 4;
      let c;
      if (h <= 0.3) c = [40, 90, 110];
      else if (h < 3) c = [214, 200, 160];
      else if (h < 25) c = [((x >> 4) + (y >> 4)) % 2 ? 150 : 130, 160, 96];
      else c = [52 + (h % 7) * 3, 84, 48];
      im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }

  // ---------------- 3D を組み立てる ----------------
  buildScene(lx, lz, sx, sz, start, photoOK) {
    const S = this.scene, G = this.G, N = this.N, H = this.H, size = this.size, half = size / 2;
    const prog = G.progress || 0;
    const sky = new THREE.Color('#bcd4e6').lerp(new THREE.Color('#f0a878'), clamp((prog - 0.55) / 0.45, 0, 1) * 0.6);
    S.background = sky;
    S.fog = new THREE.Fog(sky, 300, 5200);
    const sun = new THREE.DirectionalLight('#fff2dc', 2.4); sun.position.set(-300, 500, 260); S.add(sun);
    sun.castShadow = false;
    S.add(new THREE.HemisphereLight('#d8e8ff', '#6a6040', 1.2));
    // 地形
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i; const [x, z] = this.cellPos(i, j);
      pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;
      uv[k * 2] = i / (N - 1); uv[k * 2 + 1] = 1 - j / (N - 1);
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6); let q = 0;
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i; idx[q++] = a; idx[q++] = a + N; idx[q++] = a + 1; idx[q++] = a + 1; idx[q++] = a + N; idx[q++] = a + N + 1; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
    const tex = new THREE.CanvasTexture(this.photo); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    this.terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    S.add(this.terrain);
    // 遠景（瀬戸内の島々・本州・四国）
    this.buildFar();
    // 海
    this.waterMat = new THREE.MeshPhongMaterial({ color: '#2a6a84', specular: '#c8e0f0', shininess: 90, transparent: true, opacity: 0.86 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000, 1, 1), this.waterMat);
    water.rotation.x = -Math.PI / 2; water.position.y = 0; S.add(water);
    // 波打ち際の白波
    // 建物
    this.buildBuildings();
    this.buildShrines();
    this.buildLandmarks();
    this.buildFarms(cx0Hint(this, start, lx, lz));
    this.buildTrees();
    // 船（実寸）
    const ship = makeShip('player');
    let shx = sx, shz = sz;
    // 岸から少し沖へ
    const [cx0, cz0] = start >= 0 ? this.cellPos(start % N, (start / N) | 0) : [lx, lz];
    let dx = sx - cx0, dz = sz - cz0, dl = hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    shx = cx0 + dx * 24; shz = cz0 + dz * 24;
    for (let k = 0; k < 5 && this.hAt(shx, shz) > -0.5; k++) { shx += dx * 4; shz += dz * 4; }
    ship.position.set(shx, 0.3, shz);
    ship.rotation.y = Math.atan2(dz, -dx) + Math.PI / 2 * 0; // 舳先を沖へ
    ship.rotation.y = Math.atan2(-dx, -dz);
    S.add(ship);
    // カメラの近くでは船も透かす
    ship.traverse((o) => { if (o.isMesh) { o.material = cutaway(o.material.clone()); } });
    this.ship = { m: ship, x: shx, z: shz };
    // 桟橋
    // 港の漁船（岸壁や家並みは空中写真と建物の形のまま。海の上に古い漁船を浮かべる）
    { const port = makeFishingPort(1); const keep = port.children.filter((o) => o.type === 'Group'); // 漁船だけ使う
      for (const b of keep) { const lx = b.position.x, lz = b.position.z; const ang = Math.atan2(dx, dz); const wx = shx + Math.cos(ang) * lx + Math.sin(ang) * (lz - 20), wz = shz - Math.sin(ang) * lx + Math.cos(ang) * (lz - 20); if (this.hAt(wx, wz) > -0.5) continue; b.position.set(wx, 0.1, wz); b.rotation.y += ang; S.add(b); } }
    // 桟橋（幅 3.2m。上を歩ける）
    const pl = hypot(shx - cx0, shz - cz0) + 2, pY = Math.max(1.2, this.hAt(cx0, cz0) + 0.2);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, pl), mat('#7a5a3a'));
    plank.position.set((shx + cx0) / 2, pY, (shz + cz0) / 2); plank.rotation.y = Math.atan2(shx - cx0, shz - cz0);
    S.add(plank);
    for (const sd of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, pl), mat('#5a3e26')); rail.position.set(0, 0, 0); plank.add(rail); rail.position.set(sd * 1.55, 0.35, 0); }
    this.plank = { ax: cx0, az: cz0, bx: shx, bz: shz, y: pY + 0.13, hw: 1.5 };
    // 主人公：岸から少し内陸に立つ（背中のカメラが船に埋まらないように）
    let px0 = cx0, pz0 = cz0;
    for (let k = 1; k <= 12; k++) { const x = cx0 - dx * k, z = cz0 - dz * k; if (this.canWalk(x, z)) { px0 = x; pz0 = z; } else break; }
    // 家の中に立ってしまうときは、いちばん近い空き地へ
    if (this.inBuilding(px0, pz0)) {
      let found = null;
      for (let r = 2; r < 80 && !found; r += 2) for (let a = 0; a < 16 && !found; a++) { const x = px0 + Math.cos(a / 16 * TAU) * r, z = pz0 + Math.sin(a / 16 * TAU) * r; if (this.hAt(x, z) > 0.3 && this.canWalk(x, z)) found = [x, z]; }
      if (found) [px0, pz0] = found;
    }
    this.P = {
      x: px0, z: pz0, y: this.hAt(px0, pz0), r: K.pr, face: Math.atan2(-dz, -dx), vx: 0, vz: 0, dashing: false, inv: 1.5, atk: null,
      cdSword: 0, cdSpear: 0, combo: 0, comboT: 0, gait: 0, stDelay: 0, stepT: 0, dead: false,
    };
    this.P.m = makeWarrior('hero');
    S.add(this.P.m);
    this.camYaw = this.P.face + Math.PI; // 背中側から
    this.camYaw = Math.atan2(dz, dx); // 船の方（背中側）にカメラ
    this.P.heading = this.P.face;
    this.camDist = 12;
    // 敵と財宝
    this.enemies = []; this.bullets = []; this.parts = []; this.pickups = []; this.critters = [];
    this.placeTreasure(cx0, cz0);
    this.spawnGangs(cx0, cz0);
    this.spawnCritters();
    this.bulletGeo = new THREE.SphereGeometry(0.07, 6, 4);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: '#202020' });
    this.smokeTex = smokeTex();
    this.t = 0;
    this.fw = new Fireworks(S, 0.5, true);
    // 島の案内
    const note = ISLAND_NOTES[this.isl.id];
    banner(L(`${this.isl.name}に上陸`, `Landed on ${islandName(this.isl)}`), L(note || (this.isl.kana ? `（${this.isl.kana}）` : ''), ISLAND_NOTES_EN[this.isl.id] || ''));
    msg(this.G.taken.has(this.isl.id) ? L('この島の財宝はもう奪った。', 'You already took this island’s treasure.') : L('光の柱の下に財宝がある。奪って船に戻れ！', 'The treasure lies under the pillar of light. Grab it and get back to the ship!'), 'sys', 5);
    if (!this.online) msg(L('（地理院タイルを読めないため、粗い地形で再現しています）', '(GSI tiles unavailable — using coarse terrain)'), 'sys', 5);
    else if (!photoOK) msg(L('（空中写真を読めなかったため、色で塗っています）', '(Aerial photos unavailable — painted by elevation)'), 'sys', 4);
  }

  buildFar() {
    // 遠くの陸：手元の z10 標高を m に直して置く（上陸範囲の中は沈める）
    const R = 110; // DEM 画素
    const lon = gx2lon(this.cgx, this.Z), lat = gy2lat(this.cgy, this.Z);
    const cpx = lon2gx(lon) - DEM.x0 * 256, cpy = lat2gy(lat) - DEM.y0 * 256;
    const s = 2, n = (R * 2) / s + 1, mppD = this.mpp * 2 ** (this.Z - 10);
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    const half = this.size / 2;
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const px = cpx - R + i * s, py = cpy - R + j * s;
      const x = (px - cpx) * mppD, z = (py - cpy) * mppD;
      let h = hPx(px, py);
      const inside = Math.abs(x) < half - 30 && Math.abs(z) < half - 30;
      const y = inside ? -60 : h > 0 ? h : -8;
      const k = j * n + i;
      pos[k * 3] = x; pos[k * 3 + 1] = y - (h > 0 ? 1.5 : 0); pos[k * 3 + 2] = z;
      if (h <= 0) c.set('#3a5a5a'); else if (h < 6) c.set('#c8b890'); else if (h < 50) c.set('#7a8a50'); else c.set('#3c5634').lerp(new THREE.Color('#2a3e26'), Math.min(1, h / 600));
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));
  }

  // ---- 家並み ----
  buildBuildings() {
    const list = this.vt.building;
    this.obbs = [];
    this.bmap = new Map();
    const pos = [], col = [];
    const cw = new THREE.Color(), cr = new THREE.Color(), STONE = new THREE.Color('#8e877a');
    const WALLS = ['#ece6da', '#e4dccb', '#d8cfbe', '#5a4a3a', '#f2efe8', '#cfc6b2'];
    const ROOFS = ['#5a5f68', '#4c5260', '#62666e', '#6a4a36', '#3e4450', '#7a5a44'];
    const tri = (a, b, c, color) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b); };
    const quad = (a, b, c, d, color) => { tri(a, b, c, color); tri(a, c, d, color); };
    for (const f of list) {
      const ring = f.geom[0]; if (!ring || ring.length < 3) continue;
      const o = minRect(ring); if (!o) continue;
      const area = o.w * o.d; if (area < 9 || area > 6000) continue;
      if (Math.abs(o.cx) > this.size / 2 - 5 || Math.abs(o.cz) > this.size / 2 - 5) continue;
      const hgt = this.hAt(o.cx, o.cz); if (hgt < 0.2) continue;
      const sturdy = f.props.ftCode !== 3101;
      const hs = hash2(o.cx, o.cz);
      const floors = sturdy ? (area > 400 ? 4 : 3) : area > 110 ? 2 : 1;
      const wallH = floors * 3.0;
      let y0 = 1e9, y1 = -1e9;
      for (const [x, z] of o.pts) { const h = this.hAt(x, z); y0 = Math.min(y0, h); y1 = Math.max(y1, h); }
      y0 -= 0.5;
      const top = y1 + wallH;
      cw.set(sturdy ? '#d8d4cc' : WALLS[(hs * WALLS.length) | 0]);
      cr.set(sturdy ? '#9a968e' : ROOFS[((hs * 7.3) % 1 * ROOFS.length) | 0]);
      const p = o.pts.map(([x, z]) => [x, z]);
      // 壁（坂に建つ家は石垣の上に）
      for (let i = 0; i < 4; i++) {
        const a = p[i], b = p[(i + 1) % 4];
        const k = 0.82 + 0.18 * Math.abs(Math.cos(Math.atan2(b[1] - a[1], b[0] - a[0]) - 0.7));
        const shade = cw.clone().multiplyScalar(k);
        if (y1 - y0 > 1) quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], STONE.clone().multiplyScalar(k));
        quad([a[0], Math.max(y0, y1 - 0.3), a[1]], [b[0], Math.max(y0, y1 - 0.3), b[1]], [b[0], top, b[1]], [a[0], top, a[1]], shade);
      }
      if (sturdy) {
        quad([p[0][0], top, p[0][1]], [p[1][0], top, p[1][1]], [p[2][0], top, p[2][1]], [p[3][0], top, p[3][1]], cr);
      } else {
        // 切妻屋根（長い辺に沿って棟）。少し軒を出す
        const e = 0.45, rise = Math.min(o.w, o.d) * 0.32 + 0.4;
        const [A, B, Cc, D] = p; // A-B が長辺
        const cx = o.cx, cz = o.cz;
        const ex = (q) => [cx + (q[0] - cx) * (1 + e / Math.min(o.w, o.d)), cz + (q[1] - cz) * (1 + e / Math.min(o.w, o.d))];
        const a = ex(A), b = ex(B), c = ex(Cc), d = ex(D);
        const m1 = [(A[0] + D[0]) / 2, (A[1] + D[1]) / 2], m2 = [(B[0] + Cc[0]) / 2, (B[1] + Cc[1]) / 2];
        const r1 = [m1[0], top + rise, m1[1]], r2 = [m2[0], top + rise, m2[1]];
        const dk = cr.clone().multiplyScalar(0.8);
        quad([a[0], top - 0.2, a[1]], [b[0], top - 0.2, b[1]], r2, r1, cr);
        quad([c[0], top - 0.2, c[1]], [d[0], top - 0.2, d[1]], r1, r2, dk);
        tri([A[0], top, A[1]], [D[0], top, D[1]], r1, cw); tri([B[0], top, B[1]], r2, [Cc[0], top, Cc[1]], cw);
      }
      const ob = { cx: o.cx, cz: o.cz, ux: o.ux, uz: o.uz, hw: o.w / 2, hd: o.d / 2 };
      this.obbs.push(ob);
      const key = ((o.cx / 20) | 0) + ',' + ((o.cz / 20) | 0);
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
        const k = (((o.cx / 20) | 0) + gx) + ',' + (((o.cz / 20) | 0) + gz);
        if (!this.bmap.has(k)) this.bmap.set(k, []); this.bmap.get(k).push(ob);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.scene.add(new THREE.Mesh(g, cutaway(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }))));
    this.buildingCount = this.obbs.length;
  }
  bgrid(x, z) { return (this.bmap && this.bmap.get(((x / 20) | 0) + ',' + ((z / 20) | 0))) || []; }

  // ---- 神社・寺（地図記号から） ----
  buildShrines() {
    this.shrines = [];
    const labels = this.vt.label.filter((l) => l.props.knj && /神社|宮|八幡|社$/.test(l.props.knj));
    const tlabels = this.vt.label.filter((l) => l.props.knj && /寺|院|庵|堂/.test(l.props.knj));
    const nameNear = (arr, x, z) => { let b = null, bd = 220; for (const l of arr) { const [lx, lz] = l.geom[0][0]; const d = hypot(lx - x, lz - z); if (d < bd) { bd = d; b = l.props.knj; } } return b; };
    for (const s of this.vt.symbol) {
      const code = s.props.ftCode; if (code !== 3231 && code !== 3232) continue;
      const [x, z] = s.geom[0][0];
      if (Math.abs(x) > this.size / 2 - 10 || Math.abs(z) > this.size / 2 - 10) continue;
      const h = this.hAt(x, z); if (h < 0.5) continue;
      // 斜面の下を向ける
      const gx = this.hAt(x + 4, z) - this.hAt(x - 4, z), gz = this.hAt(x, z + 4) - this.hAt(x, z - 4);
      const face = Math.atan2(-gx, -gz);
      const g = new THREE.Group();
      if (code === 3231) {
        const hall = makeHall(5, 4, 3.2, '#4a3a2e', '#f2ecdc', '#c8401c'); g.add(hall);
        const t = makeTorii(5.5); t.position.z = 11; g.add(t);
        const t2 = makeTorii(4.2, '#9a948a'); t2.position.z = 22; g.add(t2);
        // 石灯籠
        for (const sx of [-2.5, 2.5]) { const l = makeJoyato(1.8); l.position.set(sx, 0, 6); g.add(l); }
      } else {
        const hall = makeHall(10, 8, 5, '#3a3c44', '#e8e0cc', '#6a4a2a'); g.add(hall);
        const bell = makeHall(2.4, 2.4, 2.6, '#3a3c44', '#d8c8a8', '#5a3a2a'); bell.position.set(9, 0, 6); g.add(bell);
      }
      g.position.set(x, h - 0.2, z); g.rotation.y = face;
      this.scene.add(g);
      const name = code === 3231 ? nameNear(labels, x, z) : nameNear(tlabels, x, z);
      this.shrines.push({ x, z, h, kind: code === 3231 ? 'shrine' : 'temple', name });
      this.obbs && this.addOBB(x, z, face, code === 3231 ? 2.5 : 5, code === 3231 ? 2 : 4);
    }
  }
  addOBB(cx, cz, ang, hw, hd) {
    const ob = { cx, cz, ux: Math.cos(ang), uz: -Math.sin(ang), hw, hd };
    for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) { const k = (((cx / 20) | 0) + gx) + ',' + (((cz / 20) | 0) + gz); if (!this.bmap.has(k)) this.bmap.set(k, []); this.bmap.get(k).push(ob); }
  }

  // ---- 名所（実寸） ----
  buildLandmarks() {
    const half = this.size / 2;
    for (const l of LANDMARKS) {
      const [x, z] = this.toLocal(l.lon, l.lat);
      if (Math.abs(x) > half + 400 || Math.abs(z) > half + 400) continue;
      let o;
      if (l.kind === 'otorii') o = makeTorii(l.h, '#d8401c', true);
      else if (l.kind === 'itsukushima') {
        o = new THREE.Group();
        // 本社・回廊（海の上に建つ）
        const pil = mat('#d8401c');
        const hallM = makeHall(24, 12, 6, '#5a4a3a', '#f6f0e2', '#d8401c'); hallM.position.set(0, 1.2, -8); o.add(hallM);
        const hai = makeHall(16, 8, 4.5, '#5a4a3a', '#f6f0e2', '#d8401c'); hai.position.set(0, 1.2, 6); o.add(hai);
        for (const [cx, cz, w, d] of [[0, 18, 26, 3], [-30, 0, 3, 50], [30, 0, 3, 50], [-15, 24, 30, 3], [15, -24, 30, 3]]) {
          const f = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), mat('#8a6a4a')); f.position.set(cx, 1.6, cz); o.add(f);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.3, d + 0.6), mat('#6a5a4a')); roof.position.set(cx, 4.6, cz); o.add(roof);
          const n = Math.max(2, Math.round(Math.max(w, d) / 4));
          for (let i = 0; i <= n; i++) for (const s of [-1, 1]) {
            const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4.4, 6), pil);
            const t = i / n - 0.5;
            p.position.set(cx + (w > d ? t * w : s * d / 2), 2.4, cz + (w > d ? s * d / 2 : t * d)); o.add(p);
          }
        }
        const stage = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 8), mat('#9a7a5a')); stage.position.set(0, 1.5, 28); o.add(stage); // 平舞台
      } else if (l.kind === 'pagoda') o = makePagoda(5, l.h, l.color || '#c8401c');
      else if (l.kind === 'joyato') o = makeJoyato(l.h);
      else if (l.kind === 'gangi') o = makeGangi(60, 7);
      else if (l.kind === 'stupa') o = makePagoda(2, l.h, '#9a948a');
      else if (l.kind === 'pumpkin') o = makePumpkin(l.h);
      else if (l.kind === 'hall') o = makeHall(l.h * 1.3, l.h, l.h * 0.6, '#3a3c44', '#e8dcc0', '#6a4a2a');
      else if (l.kind === 'shrine') { o = new THREE.Group(); o.add(makeHall(14, 10, 6, '#4a3a2e', '#f2ecdc', '#c8401c')); const t = makeTorii(8); t.position.z = 30; o.add(t); }
      else continue;
      const y = l.inSea || l.kind === 'itsukushima' ? 0 : Math.max(0, this.hAt(x, z));
      o.position.set(x, y, z);
      if (l.rot) o.rotation.y = l.rot;
      this.scene.add(o);
      if (!this.firstMark) { this.firstMark = l.name; }
    }
  }

  // ---- 段々畑・みかん畑・田んぼ・野菜畑・干物 ----
  farmAt(x, z) { return this.farm && this.farm.has(((x / 10) | 0) + ',' + ((z / 10) | 0)); }
  buildFarms(port) {
    const half = this.size / 2, S = 10;
    this.farm = new Set();
    const tex = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t; };
    const stone = new THREE.MeshLambertMaterial({ map: tex((g) => { g.fillStyle = '#8a8478'; g.fillRect(0, 0, 64, 64); for (let i = 0; i < 40; i++) { g.fillStyle = ['#a09a8c', '#6e695f', '#948d80'][i % 3]; g.fillRect((i * 23) % 60, ((i * 37) % 60), 10 + (i % 3) * 3, 6); } }) });
    const rows = (bg, fg, n) => tex((g) => { g.fillStyle = bg; g.fillRect(0, 0, 64, 64); g.fillStyle = fg; for (let i = 0; i < n; i++) g.fillRect(2, 3 + i * (60 / n), 60, 60 / n / 2); });
    const terraceTop = [rows('#6a4e2e', '#4f8a3a', 6), rows('#7a5a34', '#9ab04a', 8), rows('#6a4e2e', '#3e6e2e', 5)].map((m) => new THREE.MeshLambertMaterial({ map: m }));
    const paddyM = new THREE.MeshPhongMaterial({ map: tex((g) => { g.fillStyle = '#5a8a7a'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#7ab04a'; for (let y = 4; y < 64; y += 6) for (let x = 4; x < 64; x += 6) g.fillRect(x, y, 2, 3); g.strokeStyle = '#8a7a50'; g.lineWidth = 4; g.strokeRect(0, 0, 64, 64); }), shininess: 20, specular: '#304040' });
    const vegM = new THREE.MeshLambertMaterial({ map: rows('#6e4a2a', '#5aa040', 7) });
    const dirt = new THREE.MeshLambertMaterial({ color: '#6a5034' });
    // 場所を選ぶ
    const terr = [[], [], []], paddy = [], veg = [], mikan = [];
    const nearHouse = (x, z) => this.bgrid(x, z).some((b) => Math.hypot(b.cx - x, b.cz - z) < 45);
    for (let z = -half + S; z < half - S; z += S) for (let x = -half + S; x < half - S; x += S) {
      const h = this.hAt(x, z); if (h < 0.6) continue;
      if (this.bgrid(x, z).some((b) => insideOBB(b, x, z, 2))) continue;
      if (port && Math.hypot(x - port[0], z - port[1]) < 45) continue; // 港のまわりは空けておく
      const gx = (this.hAt(x + 4, z) - this.hAt(x - 4, z)) / 8, gz = (this.hAt(x, z + 4) - this.hAt(x, z - 4)) / 8;
      const sl = Math.hypot(gx, gz);
      const n = hash2(x * 0.37, z * 0.53);
      let kind = null;
      if (sl > 0.1 && sl < 0.75 && h > 3 && h < 220 && n < 0.8) kind = 'terrace'; // 山あいは段々畑
      else if (sl < 0.05 && h < 20 && h > 0.8 && n < 0.75) kind = nearHouse(x, z) && n < 0.4 ? 'veg' : 'paddy';
      else if (sl < 0.1 && h < 60 && nearHouse(x, z) && n < 0.6) kind = 'veg';
      if (!kind) continue;
      this.farm.add(((x / 10) | 0) + ',' + ((z / 10) | 0));
      const ang = Math.atan2(gx, gz);
      if (kind === 'terrace') {
        const step = 1.8, top = Math.ceil(h / step) * step;
        const t = (n * 3) | 0; terr[t].push([x, top, z, ang]);
        if (t === 2 && n < 0.35) mikan.push([x, top, z, ang]); // みかん畑
      } else if (kind === 'paddy') paddy.push([x, h, z, ang]);
      else veg.push([x, h, z, ang]);
      if (terr[0].length + terr[1].length + terr[2].length + paddy.length + veg.length > 6000) break;
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const place = (list, geo, mats, fn) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mats, list.length);
      list.forEach((v, i) => { fn(v); m4.compose(p, q, sc); im.setMatrixAt(i, m4); });
      this.scene.add(im);
    };
    // 段々畑：上は作物の列、前は石垣。下へ伸ばして段に見せる
    const tb = new THREE.BoxGeometry(1, 1, 1); tb.translate(0, -0.5, 0);
    terr.forEach((list, t) => place(list, tb, [stone, stone, terraceTop[t], dirt, stone, stone], ([x, top, z, ang]) => { p.set(x, top + 0.15, z); q.setFromAxisAngle(up, ang); sc.set(S + 0.6, 3.2, S + 0.6); }));
    // みかんの木
    const mk = new THREE.IcosahedronGeometry(1.1, 0); mk.translate(0, 1.4, 0);
    const mkM = new THREE.MeshLambertMaterial({ map: tex((g) => { g.fillStyle = '#2e5a2a'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#f0901a'; for (let i = 0; i < 14; i++) { g.beginPath(); g.arc((i * 29) % 60 + 2, (i * 41) % 60 + 2, 3, 0, 7); g.fill(); } }) });
    const trees = []; for (const [x, top, z, ang] of mikan) for (const o of [-3, 0, 3]) trees.push([x + Math.cos(ang) * o, top, z - Math.sin(ang) * o]);
    place(trees, mk, mkM, ([x, y, z]) => { p.set(x, y + 0.1, z); q.identity(); sc.set(1, 1, 1); });
    // 田んぼ（水が張ってある）と野菜畑
    const pb = new THREE.BoxGeometry(1, 0.3, 1);
    place(paddy, pb, [dirt, dirt, paddyM, dirt, dirt, dirt], ([x, h, z, ang]) => { p.set(x, h + 0.1, z); q.setFromAxisAngle(up, ang); sc.set(S - 0.4, 1, S - 0.4); });
    place(veg, pb, [dirt, dirt, vegM, dirt, dirt, dirt], ([x, h, z, ang]) => { p.set(x, h + 0.12, z); q.setFromAxisAngle(up, ang); sc.set(S - 1, 1, S - 1); });
    // 港の近くに干物を干す棚
    if (port) {
      const wood = mat('#6a4a2c'), fish = new THREE.MeshLambertMaterial({ color: '#b8a888' });
      let made = 0;
      for (let k = 0; k < 60 && made < 6; k++) {
        const a = k * 0.9, d = 28 + k * 1.5;
        const x = port[0] + Math.cos(a) * d, z = port[1] + Math.sin(a) * d, h = this.hAt(x, z);
        if (h < 0.4 || h > 12 || this.bgrid(x, z).some((b) => insideOBB(b, x, z, 2))) continue;
        const g = new THREE.Group();
        for (const sx of [-2, 2]) for (const sz of [-0.6, 0.6]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), wood); post.position.set(sx, 0.7, sz); g.add(post); }
        for (const sz of [-0.6, 0, 0.6]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.06, 0.06), wood); bar.position.set(0, 1.35, sz); g.add(bar); }
        // 網の上に並べた干物
        const net = new THREE.Mesh(new THREE.BoxGeometry(4, 0.03, 1.3), new THREE.MeshLambertMaterial({ color: '#4a5a3a', transparent: true, opacity: 0.6 })); net.position.y = 1.38; g.add(net);
        for (let i = 0; i < 18; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.14), fish); f.position.set(-1.8 + (i % 9) * 0.45, 1.42, i < 9 ? -0.35 : 0.35); f.rotation.y = 0.2; g.add(f); }
        g.position.set(x, h, z); g.rotation.y = a; this.scene.add(g); made++;
      }
    }
  }
  // ---- 木（写真の緑の濃いところに松を立てる） ----
  buildTrees() {
    const W = this.photo.width;
    let data;
    try { data = this.photoCtx.getImageData(0, 0, W, W).data; } catch (e) { return; }
    const spots = [];
    const step = 9; // m
    const half = this.size / 2;
    for (let z = -half + 5; z < half - 5; z += step) for (let x = -half + 5; x < half - 5; x += step) {
      const xx = x + rand(-3, 3), zz = z + rand(-3, 3);
      const h = this.hAt(xx, zz); if (h < 2) continue;
      const u = ((xx + half) / this.size) * W, v = ((zz + half) / this.size) * W;
      const o = ((v | 0) * W + (u | 0)) * 4;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const green = g > r * 1.05 && g > b * 1.0 && r + g + b < 330;
      if (!green) continue;
      if (this.bgrid(xx, zz).some((ob) => insideOBB(ob, xx, zz, 3))) continue;
      if (this.farmAt(xx, zz)) continue; // 畑や田んぼには木を立てない
      spots.push([xx, h, zz, r + g + b]);
      if (spots.length > (LITE ? 3000 : 7000)) break;
    }
    if (!spots.length) return;
    // 幹は上下のふたが見えないので筒だけにする。木は区画ごとに分けて、画面の外の区画は描かない（軽くする）
    const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, LITE ? 4 : 5, 1, true); trunk.translate(0, 1.5, 0);
    const crown = new THREE.IcosahedronGeometry(2.4, 0); crown.scale(1, 0.75, 1); crown.translate(0, 4.4, 0);
    const tm = cutaway(new THREE.MeshLambertMaterial({ color: '#5a3a22' })), cm = cutaway(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const TILE = 200, tiles = new Map();
    for (const sp of spots) { const k = Math.floor(sp[0] / TILE) + ',' + Math.floor(sp[2] / TILE); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(sp); }
    for (const list of tiles.values()) {
      const it = new THREE.InstancedMesh(trunk, tm, list.length), ic = new THREE.InstancedMesh(crown, cm, list.length);
      list.forEach(([x, y, z], i) => {
        const s = rand(0.7, 1.5);
        q.setFromAxisAngle(up, rand(0, TAU)); sc.set(s, s * rand(0.8, 1.3), s); p.set(x, y - 0.3, z);
        m4.compose(p, q, sc); it.setMatrixAt(i, m4); ic.setMatrixAt(i, m4);
        c.setHSL(0.27 + rand(-0.04, 0.05), 0.35 + rand(0, 0.2), 0.18 + rand(0, 0.1)); ic.setColorAt(i, c);
      });
      it.computeBoundingSphere(); ic.computeBoundingSphere();
      this.scene.add(it, ic);
    }
  }

  // ---------------- 財宝と敵 ----------------
  placeTreasure(px, pz) {
    const G = this.G;
    const cands = [];
    for (const s of this.shrines) if (this.canWalkLoose(s.x, s.z) && hypot(s.x - px, s.z - pz) <= 420) cands.push({ x: s.x, z: s.z, w: s.kind === 'shrine' ? 3 : 2, name: s.name || (s.kind === 'shrine' ? L('島の神社', 'island shrine') : L('島の寺', 'island temple')) });
    // 高いところ
    let hi = null, hh = -1;
    for (let k = 0; k < 4000; k++) {
      const x = rand(-this.size / 2, this.size / 2), z = rand(-this.size / 2, this.size / 2);
      if (!this.canWalkLoose(x, z)) continue;
      const d = hypot(x - px, z - pz); if (d < 200 || d > 400) continue;
      if (this.inBuilding(x, z)) continue;
      const h = this.hAt(x, z); if (h > hh) { hh = h; hi = { x, z, w: 1, name: L('島の高台', 'hilltop') }; }
    }
    if (hi) cands.push(hi);
    let best = null, bs = -1e9;
    for (const c of cands) {
      const d = hypot(c.x - px, c.z - pz);
      const s = c.w * 30 - Math.abs(d - 300) * 2 - (d > 420 ? 2000 : 0) - (d < 150 ? 2000 : 0); // 港から 300m 前後を選ぶ
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) {
      // 何も無ければ上陸地点から内陸へ（できるだけ 300m 前後）
      for (let k = 0; k < 800 && !best; k++) { const a = rand(0, TAU), d = k < 400 ? rand(200, 400) : rand(60, 200); const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d; if (this.canWalkLoose(x, z)) best = { x, z, name: L('島の奥', 'inland') }; }
      if (!best) best = { x: px, z: pz, name: L('浜', 'beach') };
    }
    // 建物に埋まらないよう少しずらす
    for (let k = 0; k < 30 && !this.canWalk(best.x, best.z); k++) { best.x += rand(-4, 4); best.z += rand(-4, 4); }
    const chest = makeChest();
    chest.position.set(best.x, this.hAt(best.x, best.z), best.z);
    this.scene.add(chest);
    const taken = G.taken.has(this.isl.id);
    if (taken) chest.visible = false;
    const area = this.isl.areaKm2 || 2;
    this.treasure = { x: best.x, z: best.z, m: chest, taken, place: best.name, value: Math.round(clamp(80 + Math.sqrt(area) * 60, 80, 900) * (1 + G.progress)) };
  }
  canWalkLoose(x, z) {
    const N = this.N, half = this.size / 2;
    const i = Math.round((x + half) / this.cell), j = Math.round((z + half) / this.cell);
    if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) return false;
    return this.walk[j * N + i] === 1;
  }
  spawnGangs(px, pz) {
    const G = this.G, T = this.treasure;
    const prog = G.progress || 0;
    const color = this.G.zoneColor || '#3a4a6a';
    // この島の武将（名簿で割り当て済み）。一度討ち取った武将は二度と出てこない。足りなければ名もなき足軽大将
    const slain = this.G.slain || new Set();
    const roster = (this.G.roster && this.G.roster.byIsland[this.isl.id]) || [];
    const pool = roster.map((c) => (c && !slain.has(c.ja) ? c : null));
    let gen = 0;
    const nameless = () => { gen++; const n = ['一', '二', '三', '四', '五', '六', '七'][gen - 1] || gen; return { ja: `${this.isl.name}の足軽大将 其の${n}`, en: `Ashigaru captain #${gen} of ${islandName(this.isl)}`, style: 'jp', nameless: true }; };
    const cap = pool[0] || nameless();
    this.cap = cap;
    const boss = { name: L(`${cap.ja}（${this.isl.name}の頭目）`, `${cap.en} (boss of ${islandName(this.isl)})`), short: L(cap.ja, cap.en), hp: 230 + prog * 260, pow: 18 + prog * 10, brave: Math.random() < 0.5 + prog * 0.3 };
    this.boss = boss;
    const place = (cx, cz, r) => { for (let k = 0; k < 60; k++) { const a = rand(0, TAU), d = rand(2, r); const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d; if (this.canWalk(x, z)) return [x, z]; } return null; };
    // 小早川のように、頭目が率いる軍勢がいくつも布陣する
    this.units = [];
    const area = this.isl.areaKm2 || 3;
    const nUnits = Math.max(3, roster.length);
    const used = new Set([cap.ja]);
    for (let u = 0; u < nUnits; u++) {
      let cx, cz;
      if (u === 0) { cx = T.x; cz = T.z; } // 財宝の守り
      else {
        let ok = false;
        for (let k = 0; k < 80 && !ok; k++) {
          const a = rand(0, TAU), d = rand(70, 380);
          cx = (u % 2 ? px : T.x) + Math.cos(a) * d; cz = (u % 2 ? pz : T.z) + Math.sin(a) * d;
          ok = this.canWalk(cx, cz) && hypot(cx - px, cz - pz) > 60 && this.units.every((v) => hypot(v.x - cx, v.z - cz) > 45);
        }
        if (!ok) continue;
      }
      let gcap = cap;
      if (u > 0) gcap = pool[u] || nameless();
      const group = 'u' + u;
      const info = u === 0 ? boss : { name: L(`${gcap.ja}の軍勢`, `${gcap.en}'s band`), short: L(gcap.ja, gcap.en), hp: boss.hp * 0.7, pow: boss.pow * 0.85, brave: Math.random() < 0.5, west: false, capJa: gcap.ja };
      if (u === 0) { info.west = false; info.capJa = cap.ja; }
      if (u === 0 && T.taken) continue;
      const g = place(cx, cz, 8);
      if (g) this.addEnemy('gen', g[0], g[1], color, group, info);
      const n = Math.round(10 + prog * 8 + rand(0, 4));
      for (let i = 0; i < n; i++) { const p = place(cx, cz, 18 + n * 0.6); if (p) this.addEnemy(i < n * (0.2 + prog * 0.15) ? 'gun' : 'ashi', p[0], p[1], color, group); }
      this.units.push({ group, x: cx, z: cz, info, active: false });
    }
    // 浜の見張り
    const m = Math.round(2 + prog * 4);
    const [hx, hz] = [px + (T.x - px) * 0.35, pz + (T.z - pz) * 0.35];
    for (let i = 0; i < m; i++) { const p = place(hx, hz, 30); if (p) this.addEnemy(i === 0 && prog > 0.3 ? 'gun' : 'ashi', p[0], p[1], color, 'beach'); }
    this.nextAct = 6; // 最初の軍勢が攻めてくるまで（秒）
    this.totalEnemies = this.enemies.length;
  }
  addEnemy(type, x, z, color, group, info) {
    let m;
    if (type === 'gen') m = makeWarrior(this.G.final ? 'ghost' : info && info.west ? 'captain' : 'boss', '#2a2a40');
    else { m = makeCrewman(type === 'gun' ? 'gun' : 'spear', this.G.final ? 'heike' : 'jp', color); m.userData.s = 1.15; } // 足軽は軽いモデルで大勢出す
    this.scene.add(m);
    const prog = this.G.progress || 0;
    const e = { type, x, z, hx: x, hz: z, alive: true, state: 'hold', group, face: rand(0, TAU), m, atkT: 0, cd: rand(0.5, 1.5), aimT: 0, aimA: 0, flash: 0, kvx: 0, kvz: 0, gait: rand(0, 6), trampleCd: 0, routT: 0, charge: 0, chargeT: 0, chargeCd: rand(2, 4), chargeA: 0, wobble: rand(0, TAU) };
    if (type === 'gen') { const b = info || this.boss; e.info = b; e.r = 0.55; e.hp = e.maxHp = b.hp * K.genHp; e.speed = (b.brave ? 7.6 : 6.6) * 2 * 1.5; e.dmg = b.pow * K.dmg; e.reach = K.genReach; e.windup = 0.45; e.name = b.name; e.short = b.short; }
    else if (type === 'gun') { e.r = K.er; e.hp = e.maxHp = 24; e.speed = 8.8 * 1.5; e.dmg = (15 + prog * 4) * K.dmg; e.reach = 0; e.windup = 0.75; }
    else { e.r = K.er; e.hp = e.maxHp = 32 + prog * 10; e.speed = rand(9.2, 10.8) * 1.5; e.dmg = (8 + prog * 3) * K.dmg; e.reach = K.reach; e.windup = 0.42; }
    this.enemies.push(e);
    return e;
  }
  spawnCritters() {
    const id = this.isl.id;
    const kind = id === '厳島-34' ? 'deer' : id === '大久野島-34' ? 'rabbit' : null;
    if (!kind) return;
    const n = kind === 'rabbit' ? 40 : 18;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), d = rand(10, 140);
      const x = this.P.x + Math.cos(a) * d, z = this.P.z + Math.sin(a) * d;
      if (!this.canWalk(x, z)) continue;
      const m = kind === 'deer' ? makeDeer() : makeRabbit();
      this.scene.add(m);
      this.critters.push({ m, x, z, a: rand(0, TAU), t: rand(0, 3), kind });
    }
    msg(kind === 'deer' ? L('神の使いの鹿がいる……', 'Sacred deer, messengers of the gods…') : L('うさぎが寄ってきた', 'Rabbits come hopping over'), 'sys', 4);
  }

  activate(group) {
    for (const e of this.enemies) if (e.alive && e.state === 'hold' && (!group || e.group === group)) e.state = 'chase';
    for (const u of this.units || []) if (!u.active && (!group || u.group === group)) {
      u.active = true;
      msg(L(`${u.info.short}の軍勢が攻めてきた！`, `${u.info.short}'s band is attacking!`), 'warn', 4);
      const P = this.P, d = hypot(u.x - P.x, u.z - P.z);
      Sfx.horn(clamp(0.4 - d / 900, 0.08, 0.4), clamp((u.x - P.x) / 300, -1, 1), 0.9 + Math.random() * 0.2);
      Sfx.swell(0.6);
    }
  }

  // ---------------- 毎フレーム ----------------
  update(dt, I) {
    const G = this.G;
    if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.08; }
    this.t += dt;
    this.updatePlayer(dt, I);
    // 軍勢が一隊ずつ攻めてくる（近い隊から）
    if (this.t > this.nextAct && this.units) {
      const P = this.P;
      const idle = this.units.filter((u) => !u.active && this.enemies.some((e) => e.alive && e.group === u.group));
      if (idle.length) { idle.sort((a, b) => hypot(a.x - P.x, a.z - P.z) - hypot(b.x - P.x, b.z - P.z)); this.activate(idle[0].group); }
      this.nextAct = this.t + Math.max(7, 14 - (this.G.progress || 0) * 6);
    }
    for (const e of this.enemies) if (e.alive) this.updateEnemy(e, dt);
    this.enemies = this.enemies.filter((e) => { if (!e.alive && !e.dying) { this.scene.remove(e.m); return false; } return true; });
    this.separate();
    this.updateBullets(dt);
    this.updateParts(dt);
    this.updatePickups(dt);
    this.updateCritters(dt);
    this.fw.update(dt);
    // 財宝
    const T = this.treasure, P = this.P;
    if (!T.taken) animateChest(T.m, this.t);
    else if (T.m.visible) {
      // 奪った財宝は光りながら浮かび上がって消える
      T.gone = (T.gone || 0) + dt;
      T.m.position.y += dt * 3; T.m.rotation.y += dt * 6; T.m.scale.setScalar(Math.max(0.01, 1 - T.gone / 1.5));
      if (T.gone > 1.5) T.m.visible = false;
    }
    if (!T.taken && hypot(T.x - P.x, T.z - P.z) < 3.6 && !P.dead) {
      T.taken = true;
      G.taken.add(this.isl.id);
      G.gold += T.value;
      { const up = maxHpFor(G.taken.size) - G.maxHp; if (up > 0) { G.maxHp += up; G.hp += up; setTimeout(() => msg(L(`船の守りが固くなった！ 体力の上限 +${up}（${G.maxHp}）`, `Your ship grows stronger! Max HP +${up} (${G.maxHp})`), 'kill', 4), 1200); } }
      T.m.userData.lid.rotation.x = -1.9; T.m.userData.beam.visible = false; T.m.userData.glow.visible = false;
      for (let k = 0; k < 30; k++) this.sprite(k % 2 ? '#ffe070' : '#ffffff', T.x, this.hAt(T.x, T.z) + 2, T.z, 0.6, 1.2, rand(-6, 6), rand(4, 12), rand(-6, 6), 0.5, 8);
      Sfx.treasure(); Sfx.swell(0.8);
      banner(L(`財宝を奪った！ +${T.value}両`, `Treasure taken! +${T.value} ryō`), L(`${T.place}の宝。船に戻れ`, `From the ${T.place}. Back to the ship!`));
      msg(L('島の海賊どもが追ってくる！', 'The island pirates are coming after you!'), 'warn', 4);
      this.activate();
      flash('rgba(255,230,120,0.4)');
      { const hd = P.heading ?? P.face, fx = P.x + Math.cos(hd) * 70, fz = P.z + Math.sin(hd) * 70; this.fw.show(fx, Math.max(0, this.hAt(fx, fz)) - 14, fz, 10, false, 0.35, 90); } // 財宝を取ったら、目の前の空に花火
    }
    // 船に乗る
    const ds = hypot(this.ship.x - P.x, this.ship.z - P.z);
    // 船に戻れば自動で乗る（上陸してすぐ乗らないよう、一度船から離れてから）
    if (ds > 30) this.leftShip = true;
    $('landPrompt').classList.add('hidden');
    if (ds < 11 && (this.leftShip || T.taken) && !P.dead) { msg(L('船に乗り込んだ！', 'All aboard!'), 'sys', 2); G.board(); return; }
    I.land = false;
    // 音
    let th = 0;
    for (const e of this.enemies) { if (!e.alive || e.state !== 'chase') continue; const d = hypot(e.x - P.x, e.z - P.z); if (d < 40) { const w = 1 - d / 40; th += w * w * (e.type === 'gen' ? 3 : 1); } }
    Sfx.crowd(G.state === 'play' ? clamp(0.04 + th / 10 + (1 - G.hp / G.maxHp) * 0.3, 0, 1) : 0);
    Sfx.sea(0.12);
    Sfx.bgm(G.final ? 'final' : 'island');
    this.updateCamera(dt, I);
  }

  updatePlayer(dt, I) {
    const P = this.P, G = this.G;
    if (P.dead) return;
    // 常に前を見る：前後で進み、左右で向きを変える（カメラは背中の後ろ）
    let fwd = 0, turn = 0;
    if (I.down('KeyW') || I.down('ArrowUp')) fwd += 1;
    if (I.down('KeyS') || I.down('ArrowDown')) fwd -= 0.6;
    if (I.down('KeyA') || I.down('ArrowLeft') || I.down('KeyQ')) turn -= 1;
    if (I.down('KeyD') || I.down('ArrowRight') || (I.down('KeyE') && hypot(this.ship.x - P.x, this.ship.z - P.z) > 20)) turn += 1;
    if (I.joy) {
      const jx = Math.abs(I.joy.x) > 0.15 ? I.joy.x : 0, jy = Math.abs(I.joy.y) > 0.15 ? -I.joy.y : 0;
      fwd += jy > 0 ? jy : jy * 0.6; turn += jx;
    }
    // 全速ボタンを押している間は、スティックを倒さなくても前へ走る（海の全速と同じ）
    if ((I.down('Space') || I.down('ShiftLeft') || I.down('ShiftRight') || I.down('KeyL') || I.tDash) && fwd <= 0) fwd = 1;
    fwd = clamp(fwd, -0.6, 1); turn = clamp(turn, -1, 1);
    P.heading = (P.heading ?? P.face) + turn * dt * (fwd ? 2.2 : 2.8);
    if (!P.atk) P.face = P.heading;
    let mx = Math.cos(P.heading) * fwd, mz = Math.sin(P.heading) * fwd;
    const ml = Math.abs(fwd);

    const wantDash = I.down('Space') || I.down('ShiftLeft') || I.down('ShiftRight') || I.down('KeyL') || I.tDash;
    if (wantDash && ml > 0 && (P.dashing ? G.st > 0 : G.st > 15)) {
      if (!P.dashing) { P.dashing = true; P.dashT = 0; P.inv = Math.max(P.inv, 0.2); this.dust(P.x, P.z, 6); }
      P.dashT += dt;
      G.st = Math.max(0, G.st - 26 * dt); G.stDelay = 0.6;
    } else {
      P.dashing = false; P.dashT = 0;
      if (G.stDelay > 0) G.stDelay -= dt; else G.st = Math.min(G.maxSt, G.st + 24 * dt);
    }
    const base = K.walk * (P.dashing ? 1.6 + Math.min(1.0, P.dashT * 0.5) : 1) * (P.atk && P.atk.type === 'spear' && !P.atk.charge ? 0.55 : 1);
    if (ml > 0) {
      const tf = this.slopeFactor(P.x, P.z, mx / ml, mz / ml) * (this.hAt(P.x, P.z) < -0.3 ? 0.55 : 1); // 泳ぐと遅い
      const k = 1 - Math.exp(-dt * (P.dashing ? 9 : 12));
      P.vx += (mx * base * tf - P.vx) * k; P.vz += (mz * base * tf - P.vz) * k;
    } else { const k = 1 - Math.exp(-dt * 8); P.vx -= P.vx * k; P.vz -= P.vz * k; }
    // 歩けるところだけ（壁に沿って滑る）
    const nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
    if (this.inBuilding(P.x, P.z) && this.canWalkOpen(nx, nz)) { P.x = nx; P.z = nz; }
    else if (this.canWalkOpen(nx, nz)) { P.x = nx; P.z = nz; }
    else if (this.canWalkOpen(nx, P.z)) { P.x = nx; P.vz *= 0.5; }
    else if (this.canWalkOpen(P.x, nz)) { P.z = nz; P.vx *= 0.5; }
    else { P.vx *= 0.3; P.vz *= 0.3; }
    const py = this.onPlank(P.x, P.z);
    P.y = py !== null ? Math.max(py, this.hAt(P.x, P.z)) : Math.max(this.hAt(P.x, P.z), -1.0);
    P.swim = py === null && this.hAt(P.x, P.z) < -0.3;
    if (P.swim && hypot(P.vx, P.vz) > 1 && Math.random() < 0.4) this.sprite('#e8f4ff', P.x + rand(-0.5, 0.5), 0.1, P.z + rand(-0.5, 0.5), rand(0.4, 0.8), 0.6, rand(-1, 1), rand(0.5, 1.5), rand(-1, 1), 1.2);
    const sp = hypot(P.vx, P.vz);
    P.gait += sp * dt * 1.0;
    if (sp > 3) { P.stepT -= dt; if (P.stepT <= 0) { P.stepT = P.dashing ? 0.18 : 0.3; Sfx.gallop(); if (P.dashing) this.dust(P.x, P.z, 1); } }
    if (P.y < 0.2 && sp > 2 && Math.random() < 0.3) this.sprite('#e0f0ff', P.x, 0.2, P.z, 0.5, 0.4, rand(-1, 1), rand(1, 3), rand(-1, 1), 1); // 波しぶき

    if (G.t - G.lastHurt > 4) G.hp = Math.min(G.maxHp, G.hp + K.regen * dt);
    if (P.inv > 0) P.inv -= dt;
    P.cdSword -= dt; P.cdSpear -= dt; P.comboT -= dt;
    if (P.comboT <= 0) P.combo = 0;
    if (P.atk) { P.atk.t += dt; if (P.atk.t >= P.atk.dur) P.atk = null; }
    if (I.sword) { I.sword = false; if (P.cdSword <= 0 && !(P.atk && P.atk.type === 'spear')) this.doSword(I); }
    if (I.spear) { I.spear = false; if (P.cdSpear <= 0 && !P.atk) this.doSpear(I); }
    if (!P.atk && P.cdSword <= 0 && I.down('KeyJ')) this.doSword(I);
    if (!P.atk && P.cdSpear <= 0 && I.down('KeyK')) this.doSpear(I);
    // 体当たりで蹴散らす
    if (P.dashing && sp > 10) {
      for (const e of this.enemies) {
        if (!e.alive || e.trampleCd > 0) continue;
        const d = hypot(e.x - P.x, e.z - P.z);
        if (d < P.r + e.r + 0.2) { e.trampleCd = 0.6; this.damageEnemy(e, e.type === 'gen' ? 10 : 18, (e.x - P.x) / (d || 1) * 12, (e.z - P.z) / (d || 1) * 12, 'trample'); }
      }
    }
    // 姿
    const m = P.m;
    m.position.set(P.x, P.y, P.z);
    const fa = P.atk ? P.atk.ang : P.face;
    m.rotation.y = Math.PI / 2 - fa;
    poseWarrior(m, P.gait, sp > 1, P.atk, dt);
    m.userData.sword.visible = !(P.atk && P.atk.type === 'spear');
    m.userData.spear.visible = !!(P.atk && P.atk.type === 'spear');
    m.visible = !(P.inv > 0 && P.inv < 0.4 && Math.floor(this.t * 20) % 2);
  }
  slopeFactor(x, z, dx, dz) {
    const a = this.hAt(x, z), b = this.hAt(x + dx * 2, z + dz * 2);
    const s = (b - a) / 2; // 上りで正
    return clamp(1 - s * 1.4, 0.45, 1.15);
  }
  aimAngle(I) {
    const P = this.P;
    if (I.mouseAim) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((I.mx / innerWidth) * 2 - 1, -(I.my / innerHeight) * 2 + 1), this.camera);
      const o = ray.ray.origin, d = ray.ray.direction;
      const y = P.y + 1;
      if (Math.abs(d.y) > 1e-4) { const t = (y - o.y) / d.y; if (t > 0) return Math.atan2(o.z + d.z * t - P.z, o.x + d.x * t - P.x); }
    }
    let best = null, bs = 1e9;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - P.x, dz = e.z - P.z, d = hypot(dx, dz);
      if (d > 8) continue;
      const ad = Math.abs(angDiff(Math.atan2(dz, dx), P.face)); if (ad > 1.4) continue;
      const s = d + ad * 3 - (e.type === 'gen' ? 1.5 : 0);
      if (s < bs) { bs = s; best = e; }
    }
    return best ? Math.atan2(best.z - P.z, best.x - P.x) : P.face;
  }
  doSword(I) {
    const P = this.P;
    const a = this.aimAngle(I);
    P.combo = P.comboT > 0 ? P.combo + 1 : 1;
    P.comboT = 0.55;
    const spin = P.combo >= 3; if (spin) P.combo = 0;
    P.atk = { type: 'sword', t: 0, dur: spin ? 0.32 : 0.2, ang: a, spin, dir: P.combo % 2 ? 1 : -1 };
    P.cdSword = spin ? 0.42 : 0.22;
    Sfx.slash();
    const range = spin ? K.spinR : K.swordR, arc = spin ? Math.PI : K.swordArc, dmg = spin ? 34 : 30;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - P.x, dz = e.z - P.z, d = hypot(dx, dz);
      if (d > range + e.r) continue;
      if (!spin && Math.abs(angDiff(Math.atan2(dz, dx), a)) > arc) continue;
      this.damageEnemy(e, dmg, dx / (d || 1) * K.knock, dz / (d || 1) * K.knock, 'sword');
    }
    this.slashFx(P.x, P.y + 1.1, P.z, a, spin, range);
    // 弾を弾く
    for (const b of this.bullets) {
      const dx = b.x - P.x, dz = b.z - P.z, d = hypot(dx, dz);
      if (d < range + 0.6 && (spin || Math.abs(angDiff(Math.atan2(dz, dx), a)) < arc)) {
        b.life = 0; Sfx.clang(); this.spark(b.x, b.y, b.z, '#fff6c0');
        this.floats.add(b.x, b.y + 0.5, b.z, L('弾いた！', 'Deflected!'), '#fff6c0');
      }
    }
  }
  doSpear(I) {
    const P = this.P, G = this.G;
    if (G.st < K.SPEAR_ST) { P.cdSpear = 0.3; this.floats.add(P.x, P.y + 2.6, P.z, L('息が切れた', 'Out of breath'), '#ffdc78'); return; }
    G.st -= K.SPEAR_ST; G.stDelay = 0.6;
    const a = this.aimAngle(I);
    const charge = P.dashing && hypot(P.vx, P.vz) > 10;
    P.atk = { type: 'spear', t: 0, dur: 0.3, ang: a, charge };
    P.cdSpear = charge ? 0.6 : 0.75;
    Sfx.thrust();
    const len = charge ? K.spearChargeLen : K.spearLen, halfW = charge ? K.spearHalf * 1.25 : K.spearHalf, dmg = charge ? 85 : 58;
    const ca = Math.cos(a), sa = Math.sin(a);
    const hits = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - P.x, dz = e.z - P.z;
      const along = dx * ca + dz * sa, perp = Math.abs(-dx * sa + dz * ca);
      if (along < 0 || along > len + e.r || perp > halfW + e.r) continue;
      hits.push({ e, along });
    }
    hits.sort((p, q) => p.along - q.along);
    for (const h of hits.slice(0, K.PIERCE)) this.damageEnemy(h.e, dmg, ca * 13, sa * 13, 'spear');
  }
  hurtPlayer(dmg, fx, fz) {
    const P = this.P, G = this.G;
    if (P.inv > 0 || P.dead || G.state !== 'play') return false;
    G.hp -= dmg; P.inv = 0.4; G.lastHurt = G.t;
    const d = hypot(P.x - fx, P.z - fz) || 1;
    P.vx += (P.x - fx) / d * 7; P.vz += (P.z - fz) / d * 7;
    this.blood(P.x, P.y + 1.2, P.z, 8);
    this.floats.add(P.x, P.y + 2.4, P.z, '-' + Math.round(dmg), '#ff5a4a');
    Sfx.hurt(); flash('rgba(200,0,0,0.25)');
    this.shake = 0.25;
    if (G.hp <= 0) { G.hp = 0; P.dead = true; this.blood(P.x, P.y + 1, P.z, 30); P.m.rotation.z = Math.PI / 2; P.m.position.y += 0.3; G.die(L(`${this.isl.name}にて討死`, `Fell in battle on ${islandName(this.isl)}`)); }
    return true;
  }
  damageEnemy(e, dmg, kx, kz, src) {
    if (!e.alive) return;
    dmg *= rand(0.9, 1.1);
    e.hp -= dmg; e.flash = 0.12;
    const kb = e.type === 'gen' ? 0.35 : 1;
    e.kvx += kx * kb; e.kvz += kz * kb;
    if (e.type !== 'gen') { e.atkT = 0; e.aimT = 0; }
    this.blood(e.x, this.hAt(e.x, e.z) + 1.2, e.z, e.type === 'gen' ? 8 : 5);
    this.floats.add(e.x, this.hAt(e.x, e.z) + 2.2, e.z, Math.round(dmg), src === 'spear' ? '#ffd24a' : '#ffffff');
    Sfx.hit();
    this.hitstop = Math.max(this.hitstop || 0, src === 'spear' ? 0.045 : 0.025);
    if (e.state === 'hold') this.activate(e.group);
    if (e.hp <= 0) this.killEnemy(e);
  }
  killEnemy(e) {
    const G = this.G;
    e.alive = false; e.dying = 1.2;
    this.blood(e.x, this.hAt(e.x, e.z) + 1, e.z, e.type === 'gen' ? 26 : 12);
    if (e.type === 'gen') {
      G.bosses++;
      if (e.info && e.info.capJa) { if (!G.slain) G.slain = new Set(); G.slain.add(e.info.capJa); } // 二度と出てこない
      Sfx.kill(); Sfx.swell(0.7);
      this.shake = 0.5; this.hitstop = 0.18;
      this.addPickup(e.x, e.z, K.genHeal, true);
      for (const s of this.enemies) if (s.alive && s.group === e.group) { s.state = 'rout'; s.routT = rand(3, 6); }
      banner(L(`${e.short}を討ち取った！`, `${e.short} slain!`), L('配下の海賊は逃げ出した', 'His men scatter'));
      msg(L(`${e.name}を討ち取った`, `Slew the ${e.name}`), 'kill', 4);
      G.gold += 40;
    } else {
      G.kills++;
      if (Math.random() < K.dropRate) this.addPickup(e.x, e.z, 30, false);
    }
  }
  updateEnemy(e, dt) {
    const P = this.P;
    e.flash -= dt; e.trampleCd -= dt;
    if (e.kvx || e.kvz) {
      const nx = e.x + e.kvx * dt, nz = e.z + e.kvz * dt;
      if (this.canWalkOpen(nx, nz)) { e.x = nx; e.z = nz; }
      const k = Math.exp(-dt * 9); e.kvx *= k; e.kvz *= k;
      if (Math.abs(e.kvx) + Math.abs(e.kvz) < 0.2) e.kvx = e.kvz = 0;
    }
    const dx = P.x - e.x, dz = P.z - e.z, d = hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    let moving = false, atkPose = null;
    const move = (mx, mz, spd) => {
      const tf = this.slopeFactor(e.x, e.z, mx, mz) * (this.hAt(e.x, e.z) < -0.3 ? 0.5 : 1);
      const nx = e.x + mx * spd * tf * dt, nz = e.z + mz * spd * tf * dt;
      if (this.canWalkOpen(nx, nz)) { e.x = nx; e.z = nz; }
      else if (this.canWalkOpen(nx, e.z)) e.x = nx; else if (this.canWalkOpen(e.x, nz)) e.z = nz;
      e.gait += spd * tf * dt * 1.0; moving = true;
      e.face = Math.atan2(mz, mx);
    };
    if (e.state === 'hold') {
      const hx = e.hx - e.x, hz = e.hz - e.z, hd = hypot(hx, hz);
      if (hd > 0.5) move(hx / hd, hz / hd, e.speed * 0.4);
      if (d < (e.group === 'guard' ? 22 : 26) && !P.dead && this.t > 2) this.activate(e.group);
    } else if (e.state === 'rout') {
      move(-ux, -uz, e.speed * 1.15);
      e.routT -= dt; if (e.routT <= 0) { e.alive = false; }
    } else if (!P.dead) {
      const sm = 1 + Math.min(0.2, this.t / 300);
      e.cd -= dt;
      if (e.type === 'gun') {
        if (e.aimT > 0) {
          e.aimT -= dt; atkPose = { type: 'aim', t: 0, dur: 1 };
          if (e.aimT > 0.3) e.aimA = Math.atan2(P.z - e.z, P.x - e.x);
          e.face = e.aimA;
          if (e.aimT <= 0) this.fireGun(e);
        } else if (d < K.gunRange && d > 3 && e.cd <= 0) { e.aimT = e.windup; e.aimA = Math.atan2(dz, dx); }
        else if (d > 18) move(ux, uz, e.speed * sm);
        else if (d < 10) move(-ux, -uz, e.speed * 0.8 * sm);
        else { const s = Math.sin(e.wobble + this.t * 0.7); move(-uz * s, ux * s, e.speed * 0.35); }
      } else if (e.type === 'gen') this.updateGeneral(e, dt, d, ux, uz, sm, move);
      else {
        if (e.atkT > 0) {
          e.atkT -= dt; atkPose = { type: 'spear', t: 0.05, dur: 0.3 };
          if (e.atkT <= 0) { e.cd = rand(1.0, 1.7); if (d < e.r + P.r + e.reach + 0.4) this.hurtPlayer(e.dmg, e.x, e.z); e.thrust = 0.15; }
        } else {
          if (e.thrust > 0) { e.thrust -= dt; atkPose = { type: 'spear', t: 0.15, dur: 0.3 }; }
          if (d < e.r + P.r + e.reach && e.cd <= 0) { e.atkT = e.windup; e.face = Math.atan2(dz, dx); }
          else {
            const sw = Math.sin(e.wobble) * (d > 4 ? 0.45 : 0.15);
            const mx = ux - uz * sw, mz = uz + ux * sw, ml = hypot(mx, mz);
            if (d > e.r + P.r + 0.3) move(mx / ml, mz / ml, e.speed * sm * (e.cd > 0 && d < 3 ? 0.4 : 1));
            e.face = Math.atan2(dz, dx);
          }
        }
      }
    }
    if (e.swing > 0) { e.swing -= dt; atkPose = { type: 'swing', t: 0.22 - e.swing, dur: 0.22 }; }
    if (e.atkT > 0 && e.type === 'gen') atkPose = { type: 'swing', t: 0, dur: 0.22 };
    // 姿
    const m = e.m, y = this.hAt(e.x, e.z);
    m.position.set(e.x, Math.max(y, -0.5), e.z);
    m.rotation.y = Math.PI / 2 - e.face;
    if (m.userData.legs) {
      poseWarrior(m, e.gait, moving, atkPose, dt);
      const am = m.userData.armorMat;
      if (e.flash > 0) am.color.set('#ffffff'); else am.color.copy(m.userData.baseColor);
    } else {
      m.position.y += moving ? Math.abs(Math.sin(e.gait)) * 0.12 : 0;
      m.rotation.z = moving ? Math.sin(e.gait) * 0.08 : 0;
      m.rotation.x = atkPose ? -0.25 : 0;
      m.scale.setScalar((m.userData.s || 1) * (e.flash > 0 ? 1.12 : 1));
    }
  }
  updateGeneral(e, dt, d, ux, uz, sm, move) {
    const P = this.P;
    e.face = Math.atan2(uz, ux);
    e.chargeCd -= dt;
    if (e.chargeT > 0) {
      if (e.charge > 0) { e.charge -= dt; return; }
      e.chargeT -= dt;
      move(Math.cos(e.chargeA), Math.sin(e.chargeA), e.speed * 2.5 * sm);
      if (Math.random() < 0.5) this.dust(e.x, e.z, 1);
      if (hypot(P.x - e.x, P.z - e.z) < e.r + P.r + 0.5) { if (this.hurtPlayer(e.dmg * 1.4, e.x, e.z)) e.chargeT = 0; }
      if (e.chargeT <= 0) e.chargeCd = rand(3.5, 6);
      return;
    }
    if (e.atkT > 0) {
      e.atkT -= dt;
      if (e.atkT <= 0) { e.cd = rand(1.1, 1.6); e.swing = 0.22; if (d < e.r + P.r + e.reach + 0.5) this.hurtPlayer(e.dmg, e.x, e.z); }
      return;
    }
    const brave = (e.info || this.boss).brave;
    const desired = brave ? 0 : 5;
    if (brave && d > 5 && d < 15 && e.chargeCd <= 0) { e.charge = 0.55; e.chargeT = 0.7; e.chargeA = Math.atan2(uz, ux); this.floats.add(e.x, this.hAt(e.x, e.z) + 3, e.z, L('突撃！', 'Charge!'), '#ff7b5a'); return; }
    if (d < e.r + P.r + e.reach && e.cd <= 0) { e.atkT = e.windup; return; }
    if (d > desired + 1.5) move(ux, uz, e.speed * sm);
    else if (d < desired - 1.5) move(-ux, -uz, e.speed * 0.6 * sm);
    else { const s = Math.sin(e.wobble + this.t * 0.5); move(-uz * s, ux * s, e.speed * 0.3); }
  }
  fireGun(e) {
    const P = this.P;
    e.cd = rand(3.2, 4.8);
    const a = e.aimA + rand(-0.05, 0.05);
    const y = this.hAt(e.x, e.z) + 1.3;
    const m = new THREE.Mesh(this.bulletGeo, this.bulletMat); this.scene.add(m);
    this.bullets.push({ m, x: e.x + Math.cos(a) * 0.8, y, z: e.z + Math.sin(a) * 0.8, vx: Math.cos(a) * K.bulletSp, vz: Math.sin(a) * K.bulletSp, life: 1.0, dmg: e.dmg });
    for (let i = 0; i < 4; i++) this.sprite('#e8e8e8', e.x + Math.cos(a), y, e.z + Math.sin(a), rand(0.4, 0.8), 1.1, Math.cos(a) * rand(0.5, 2), rand(0.3, 1), Math.sin(a) * rand(0.5, 2), 1.5);
    Sfx.gun(clamp(0.5 - hypot(e.x - P.x, e.z - P.z) / 80, 0.08, 0.5));
  }
  updateBullets(dt) {
    const P = this.P;
    for (const b of this.bullets) {
      for (let i = 0; i < 3 && b.life > 0; i++) {
        b.x += b.vx * dt / 3; b.z += b.vz * dt / 3;
        if (!P.dead && hypot(b.x - P.x, b.z - P.z) < P.r + 0.35 && Math.abs(b.y - (P.y + 1.2)) < 1.4) { if (this.hurtPlayer(b.dmg, b.x - b.vx * 0.05, b.z - b.vz * 0.05)) b.life = 0; }
      }
      if (this.hAt(b.x, b.z) > b.y) b.life = 0;
      b.life -= dt; b.m.position.set(b.x, b.y, b.z);
    }
    this.bullets = this.bullets.filter((b) => { if (b.life <= 0) { this.scene.remove(b.m); return false; } return true; });
  }
  separate() {
    const list = this.enemies.filter((e) => e.alive);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const e = list[i], f = list[j];
      const dx = f.x - e.x, dz = f.z - e.z, rr = e.r + f.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-4) {
        const d = Math.sqrt(d2), push = (rr - d) * 0.5, nx = dx / d, nz = dz / d;
        const we = e.type === 'gen' ? 0.2 : 1, wf = f.type === 'gen' ? 0.2 : 1;
        e.x -= nx * push * we; e.z -= nz * push * we; f.x += nx * push * wf; f.z += nz * push * wf;
      }
    }
    const P = this.P; if (P.dead) return;
    for (const e of list) {
      const dx = e.x - P.x, dz = e.z - P.z, rr = e.r + P.r, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-4) { const d = Math.sqrt(d2), push = rr - d; e.x += dx / d * push * 0.8; e.z += dz / d * push * 0.8; P.x -= dx / d * push * 0.2; P.z -= dz / d * push * 0.2; }
    }
  }
  addPickup(x, z, heal, big) {
    const m = makeOnigiri(big ? 1.4 : 1); this.scene.add(m);
    this.pickups.push({ x, z, heal, big, m, t: 0 });
  }
  updatePickups(dt) {
    const P = this.P, G = this.G;
    for (const pk of this.pickups) {
      pk.t += dt;
      pk.m.position.set(pk.x, this.hAt(pk.x, pk.z) + 0.6 + Math.sin(pk.t * 4) * 0.12, pk.z);
      pk.m.rotation.y += dt * 1.5;
      if (!P.dead && hypot(pk.x - P.x, pk.z - P.z) < 1.3) {
        pk.taken = true; G.hp = Math.min(G.maxHp, G.hp + pk.heal);
        this.floats.add(P.x, P.y + 2.5, P.z, '+' + pk.heal + L(' おむすび', ' rice ball'), '#7dff8a'); Sfx.clang();
      }
    }
    this.pickups = this.pickups.filter((p) => { if (p.taken || p.t > 40) { this.scene.remove(p.m); return false; } return true; });
  }
  updateCritters(dt) {
    for (const c of this.critters) {
      c.t -= dt;
      if (c.t <= 0) { c.t = rand(1, 4); c.a = rand(0, TAU); c.moving = Math.random() < 0.6; }
      if (c.moving) {
        const sp = c.kind === 'rabbit' ? 1.6 : 0.9;
        const nx = c.x + Math.cos(c.a) * sp * dt, nz = c.z + Math.sin(c.a) * sp * dt;
        if (this.canWalk(nx, nz)) { c.x = nx; c.z = nz; } else c.a += Math.PI;
      }
      const hop = c.kind === 'rabbit' && c.moving ? Math.abs(Math.sin(this.t * 9 + c.x)) * 0.15 : 0;
      c.m.position.set(c.x, this.hAt(c.x, c.z) + hop, c.z);
      c.m.rotation.y = Math.PI / 2 - c.a;
    }
  }

  // ---- 粒子 ----
  sprite(color, x, y, z, s, life, vx = 0, vy = 0, vz = 0, grow = 1, g = 0) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color, transparent: true, depthWrite: false }));
    m.position.set(x, y, z); m.scale.setScalar(s); this.scene.add(m);
    this.parts.push({ m, life, max: life, vx, vy, vz, grow, g });
    if (this.parts.length > (LITE ? 160 : 300)) { const p = this.parts.shift(); this.scene.remove(p.m); p.m.material.dispose(); }
  }
  blood(x, y, z, n) { for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(1.5, 6); this.sprite(Math.random() < 0.5 ? '#a0101a' : '#d0202a', x, y, z, rand(0.12, 0.25), rand(0.3, 0.7), Math.cos(a) * s, rand(1, 4), Math.sin(a) * s, 0, 14); } }
  spark(x, y, z, c) { for (let i = 0; i < 6; i++) { const a = rand(0, TAU); this.sprite(c, x, y, z, 0.15, 0.25, Math.cos(a) * 8, rand(-3, 6), Math.sin(a) * 8, 0); } }
  dust(x, z, n) { for (let i = 0; i < n; i++) this.sprite('#c8b48c', x + rand(-0.5, 0.5), this.hAt(x, z) + 0.2, z + rand(-0.5, 0.5), rand(0.5, 1), rand(0.5, 0.9), rand(-1, 1), rand(0.3, 1), rand(-1, 1), 1.5); }
  slashFx(x, y, z, a, spin, r) {
    const arc = spin ? TAU : 2.4;
    const g = new THREE.RingGeometry(r * 0.55, r, 20, 1, -arc / 2, arc);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: spin ? '#ffe0a0' : '#ffffff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = -a; m.position.set(x, y, z);
    this.scene.add(m);
    this.parts.push({ m, life: 0.16, max: 0.16, vx: 0, vy: 0, vz: 0, grow: 0, g: 0, mesh: true });
  }
  updateParts(dt) {
    for (const p of this.parts) {
      p.life -= dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      p.vy -= p.g * dt;
      if (p.grow) p.m.scale.multiplyScalar(1 + dt * p.grow * 0.5);
      p.m.material.opacity = clamp(p.life / p.max, 0, 1) * (p.mesh ? 0.55 : 0.85);
    }
    this.parts = this.parts.filter((p) => { if (p.life <= 0) { this.scene.remove(p.m); p.m.material.dispose(); if (p.mesh) p.m.geometry.dispose(); return false; } return true; });
    // 倒れた敵
    for (const e of this.enemies) if (!e.alive && e.dying) {
      e.dying -= dt; e.m.rotation.z = Math.min(Math.PI / 2, e.m.rotation.z + dt * 6);
      if (e.dying <= 0) e.dying = 0;
    }
  }

  updateCamera(dt, I) {
    const P = this.P;
    if (I.wheel) { this.camDist = clamp(this.camDist * (1 + I.wheel * 0.001), 6, 30); I.wheel = 0; }
    const want = (P.heading ?? P.face) + Math.PI;
    this.camYaw += angDiff(want, this.camYaw) * (1 - Math.exp(-dt * 5));
    const cx = P.x + Math.cos(this.camYaw) * this.camDist, cz = P.z + Math.sin(this.camYaw) * this.camDist;
    let cy = P.y + this.camDist * 0.75;
    cy = Math.max(cy, this.hAt(cx, cz) + 2, (this.hAt((cx + P.x) / 2, (cz + P.z) / 2) + 1.5));
    const cam = this.camera, k = 1 - Math.exp(-dt * 6);
    if (!this.camInit) { cam.position.set(cx, cy, cz); this.camInit = true; }
    cam.position.x += (cx - cam.position.x) * k; cam.position.y += (cy - cam.position.y) * k; cam.position.z += (cz - cam.position.z) * k;
    if (this.shake > 0) { this.shake -= dt; cam.position.x += rand(-0.15, 0.15); cam.position.y += rand(-0.1, 0.1); }
    const hd = P.heading ?? P.face;
    cam.lookAt(P.x + Math.cos(hd) * 6, P.y + 1.6, P.z + Math.sin(hd) * 6);
    CUT.value = hypot(cam.position.x - P.x, cam.position.y - P.y - 1, cam.position.z - P.z) * 0.8;
    PPOS.value.set(P.x, P.y, P.z);
  }

  // カメラからその場所が見えるか（途中の地面や家にさえぎられていないか）
  seen(x, y, z) {
    const c = this.camera.position, n = 16;
    for (let i = 1; i < n; i++) {
      const t = i / n, px = c.x + (x - c.x) * t, py = c.y + (y - c.y) * t, pz = c.z + (z - c.z) * t;
      if (this.hAt(px, pz) > py + 0.3) return false;
      if (t > 0.15 && t < 0.9) for (const b of this.bgrid(px, pz)) if (insideOBB(b, px, pz, 0) && py < this.hAt(b.cx, b.cz) + 6) return false;
    }
    return true;
  }
  render(dt) {
    this.r.render(this.scene, this.camera);
    this.floats.update(dt, this.camera);
    this.tags.begin();
    // 敵の印は、カメラから見えている（山や家の陰でない）近くの敵だけに付ける
    for (const e of this.enemies) if (e.alive && e.type === 'gen' && hypot(e.x - this.P.x, e.z - this.P.z) < 90 && this.seen(e.x, this.hAt(e.x, e.z) + 1.5, e.z)) this.tags.put(this.camera, e.x, this.hAt(e.x, e.z) + 3.4, e.z, '▼', null, 'mk boss');
    // 攻めてくる足軽の頭上に小さな印（近い 14 人）
    const P = this.P, near = [];
    for (const e of this.enemies) if (e.alive && e.type !== 'gen' && e.state === 'chase') { const d = hypot(e.x - P.x, e.z - P.z); if (d < 60) near.push([d, e]); }
    near.sort((p, q) => p[0] - q[0]);
    for (const [, e] of near.filter(([, e]) => this.seen(e.x, this.hAt(e.x, e.z) + 1.2, e.z)).slice(0, 14)) this.tags.put(this.camera, e.x, this.hAt(e.x, e.z) + 2.4, e.z, e.type === 'gun' ? '▼鉄砲' : '▼', null, 'mk' + (e.type === 'gun' ? ' gun' : ''));
    const T = this.treasure;
    if (!T.taken) this.tags.put(this.camera, T.x, this.hAt(T.x, T.z) + 3, T.z, '★', null, 'mk gold');
    else this.tags.put(this.camera, this.ship.x, 9, this.ship.z, '⚓', null, 'mk ship');
    this.tags.end();
    this.drawMini();
  }
  drawMini() {
    const cv = $('minimap'), g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const P = this.P;
    // 自分のまわり約 350m を拡大して見せる
    const span = 350, s = W / span;
    const half = this.size / 2, pw = this.photo.width / this.size;
    g.fillStyle = '#1c3a56'; g.fillRect(0, 0, W, H);
    const sx = (P.x - span / 2 + half) * pw, sy = (P.z - span * H / W / 2 + half) * pw;
    g.drawImage(this.photo, sx, sy, span * pw, span * H / W * pw, 0, 0, W, H);
    const tx = (x) => (x - P.x) * s + W / 2, ty = (z) => (z - P.z) * s + H / 2;
    g.strokeStyle = '#000'; g.lineWidth = 2;
    for (const e of this.enemies) if (e.alive) { g.fillStyle = e.type === 'gen' ? '#ff1a1a' : '#ff4a3a'; g.beginPath(); g.arc(tx(e.x), ty(e.z), e.type === 'gen' ? 9 : 5.5, 0, TAU); g.fill(); g.stroke(); }
    const T = this.treasure;
    const clampP = (x, y) => [Math.max(6, Math.min(W - 6, x)), Math.max(6, Math.min(H - 6, y))];
    if (!T.taken) { const [x, y] = clampP(tx(T.x), ty(T.z)); g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); }
    { const [x, y] = clampP(tx(this.ship.x), ty(this.ship.z)); g.fillStyle = '#ffffff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.fillRect(x - 8, y - 5, 16, 10); g.strokeRect(x - 8, y - 5, 16, 10); }
    g.save(); g.translate(W / 2, H / 2); g.rotate(P.heading ?? P.face);
    g.fillStyle = '#ffe14d'; g.strokeStyle = '#000'; g.lineWidth = 3; g.beginPath(); g.moveTo(20, 0); g.lineTo(-12, -12); g.lineTo(-5, 0); g.lineTo(-12, 12); g.closePath(); g.stroke(); g.fill();
    g.restore();
  }
  // 広告を見て復活したとき
  revive() { const P = this.P; P.dead = false; P.inv = 3; P.m.rotation.z = 0; for (const e of this.enemies) if (e.alive && hypot(e.x - P.x, e.z - P.z) < 12) { e.kvx = (e.x - P.x) * 3; e.kvz = (e.z - P.z) * 3; } }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  dispose() {
    this.floats.clear(); this.tags.clear();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m.map) m.map.dispose(); if (!m.userData.shared) m.dispose && m.dispose(); } }
    });
  }
}

// 港（上陸地点）の位置
function cx0Hint(self, start, lx, lz) { if (start < 0) return [lx, lz]; return self.cellPos(start % self.N, (start / self.N) | 0); }
// ---- 図形の小道具 ----
function hash2(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }
// 多角形を囲む最小の長方形（向き付き）。辺の向きをすべて試す
function minRect(ring) {
  const pts = ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  if (pts.length < 3) return null;
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const L = hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.5) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    let mn0 = 1e9, mx0 = -1e9, mn1 = 1e9, mx1 = -1e9;
    for (const p of pts) { const s = p[0] * ux + p[1] * uz, t = -p[0] * uz + p[1] * ux; mn0 = Math.min(mn0, s); mx0 = Math.max(mx0, s); mn1 = Math.min(mn1, t); mx1 = Math.max(mx1, t); }
    const area = (mx0 - mn0) * (mx1 - mn1);
    if (!best || area < best.area) best = { area, ux, uz, mn0, mx0, mn1, mx1 };
  }
  if (!best) return null;
  let { ux, uz, mn0, mx0, mn1, mx1 } = best;
  // 長い辺を u に
  if (mx1 - mn1 > mx0 - mn0) { const nux = -uz, nuz = ux; [mn0, mx0, mn1, mx1] = [mn1, mx1, -mx0, -mn0]; ux = nux; uz = nuz; }
  const P = (s, t) => [s * ux - t * uz, s * uz + t * ux];
  const pts4 = [P(mn0, mn1), P(mx0, mn1), P(mx0, mx1), P(mn0, mx1)];
  const c = P((mn0 + mx0) / 2, (mn1 + mx1) / 2);
  return { pts: pts4, w: mx0 - mn0, d: mx1 - mn1, cx: c[0], cz: c[1], ux, uz };
}
function insideOBB(b, x, z, pad = 0) {
  const dx = x - b.cx, dz = z - b.cz;
  const s = dx * b.ux + dz * b.uz, t = -dx * b.uz + dz * b.ux;
  return Math.abs(s) < b.hw + pad && Math.abs(t) < b.hd + pad;
}
function smokeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
