// 地理：国土地理院の標高（data/dem10.png）を読み、緯度経度・画素・ゲーム座標を相互に変換する
// 海モードの座標は 1 単位 = 10m（水平）。高さは見栄えのため 2 倍に強調する（1m → 0.2 単位）

export const DEM = { z: 10, x0: 0, y0: 0, w: 0, h: 0, data: null, label: null, comps: [] };
export const MPP = (156543.034 * Math.cos((34.2 * Math.PI) / 180)) / 1024; // z10 の 1 画素の幅（m）
export const SEA_K = MPP / 10; // 1 画素 = 何単位か
export const VEX = 0.2; // 標高 1m → 0.2 単位
export const SEA_FLOOR = -12; // 海の画素の「標高」（m）

const n10 = 2 ** 10;
export function lon2gx(lon, z = 10) { return ((lon + 180) / 360) * 2 ** z * 256; }
export function lat2gy(lat, z = 10) { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * 256; }
export function gx2lon(gx, z = 10) { return (gx / (2 ** z * 256)) * 360 - 180; }
export function gy2lat(gy, z = 10) { const n = Math.PI - (2 * Math.PI * gy) / (2 ** z * 256); return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

// 緯度経度 → DEM 画素
export function ll2px(lon, lat) { return [lon2gx(lon) - DEM.x0 * 256, lat2gy(lat) - DEM.y0 * 256]; }
export function px2ll(px, py) { return [gx2lon(px + DEM.x0 * 256), gy2lat(py + DEM.y0 * 256)]; }
// 緯度経度 → 海モードの座標 (x, z)
export function ll2sea(lon, lat) { const [px, py] = ll2px(lon, lat); return [px * SEA_K, py * SEA_K]; }
export function sea2ll(x, z) { return px2ll(x / SEA_K, z / SEA_K); }

export async function loadDEM(url = 'data/dem10.png', metaUrl = 'data/dem10.json') {
  const meta = await (await fetch(metaUrl)).json();
  Object.assign(DEM, meta);
  const blob = await (await fetch(url)).blob();
  let img;
  try { img = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); }
  catch (e) { img = await createImageBitmap(blob); }
  const c = document.createElement('canvas'); c.width = DEM.w; c.height = DEM.h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, DEM.w, DEM.h).data;
  const N = DEM.w * DEM.h;
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = (px[i * 4] << 8) | px[i * 4 + 1];
    d[i] = v === 0 ? SEA_FLOOR : v - 100;
  }
  DEM.data = d;
  labelComponents();
}

export function isLandPx(x, y) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= DEM.w || y >= DEM.h) return false;
  return DEM.data[y * DEM.w + x] > 0;
}
// 画素座標での標高（m）。双一次補間
export function hPx(x, y) {
  const W = DEM.w, H = DEM.h;
  if (x < 0) x = 0; if (y < 0) y = 0; if (x > W - 1.001) x = W - 1.001; if (y > H - 1.001) y = H - 1.001;
  const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy;
  const d = DEM.data, i = iy * W + ix;
  const a = d[i], b = d[i + 1], c = d[i + W], e = d[i + W + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}
// 海モード座標での標高（m）
export function hSea(x, z) { return hPx(x / SEA_K, z / SEA_K); }

// 陸のかたまり（島）に番号を振る
function labelComponents() {
  const W = DEM.w, H = DEM.h, d = DEM.data;
  const lab = new Int16Array(W * H).fill(-1);
  const st = new Int32Array(W * H);
  const comps = [];
  for (let i = 0; i < W * H; i++) {
    if (d[i] <= 0 || lab[i] >= 0) continue;
    const id = comps.length;
    let sp = 0, a = 0; st[sp++] = i; lab[i] = id;
    while (sp) {
      const j = st[--sp]; a++;
      const x = j % W;
      if (x > 0 && d[j - 1] > 0 && lab[j - 1] < 0) { lab[j - 1] = id; st[sp++] = j - 1; }
      if (x < W - 1 && d[j + 1] > 0 && lab[j + 1] < 0) { lab[j + 1] = id; st[sp++] = j + 1; }
      if (j >= W && d[j - W] > 0 && lab[j - W] < 0) { lab[j - W] = id; st[sp++] = j - W; }
      if (j < W * (H - 1) && d[j + W] > 0 && lab[j + W] < 0) { lab[j + W] = id; st[sp++] = j + W; }
    }
    comps.push({ id, area: a });
  }
  DEM.label = lab; DEM.comps = comps;
}
export function compAt(px, py) {
  px |= 0; py |= 0;
  if (px < 0 || py < 0 || px >= DEM.w || py >= DEM.h) return -1;
  return DEM.label[py * DEM.w + px];
}
// いちばん近い陸の画素（半径 r 画素以内）
export function nearestLandPx(px, py, r) {
  let best = null, bd = 1e9;
  const cx = Math.round(px), cy = Math.round(py);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!isLandPx(x, y)) continue;
    const dd = Math.hypot(x - px, y - py);
    if (dd < bd) { bd = dd; best = [x, y]; }
  }
  return best ? { x: best[0], y: best[1], d: bd } : null;
}

// ---- 地理院タイル（実行時に取得） ----
export function tileXY(lon, lat, z) { return [lon2gx(lon, z) / 256, lat2gy(lat, z) / 256]; }
export function loadImage(url) {
  return new Promise((ok, ng) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => ok(im); im.onerror = () => ng(new Error('img ' + url));
    im.src = url;
  });
}
export async function fetchWithTimeout(url, ms = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { signal: ac.signal }); } finally { clearTimeout(t); }
}
