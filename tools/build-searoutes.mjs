// 地理院ベクトルタイル（z12）の航路を集める → data/searoutes.json（[[経度, 緯度], ...] の配列）
// 航路の端が島に着く所を、その島の港として data/harbors.json に足す（地名検索で港が見つからなかった島）
import fs from 'node:fs';
import { decodeMVT } from '../js/mvt.js';
const meta = JSON.parse(fs.readFileSync(new URL('../data/dem10.json', import.meta.url)));
const elev = new Float32Array(fs.readFileSync(new URL('../.cache/elev.f32', import.meta.url)).buffer.slice(0));
const islands = JSON.parse(fs.readFileSync(new URL('../data/islands.json', import.meta.url)));
const harbors = JSON.parse(fs.readFileSync(new URL('../data/harbors.json', import.meta.url)));
const dir = new URL('../.cache/vt/', import.meta.url);
const Z = 12;
const g2ll = (gx, gy, z) => { const n = 2 ** z * 256; const lon = (gx / n) * 360 - 180; const k = Math.PI - (2 * Math.PI * gy) / n; return [lon, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k)))]; };
const ll2px = (lon, lat) => { const n = 1024 * 256, r = (lat * Math.PI) / 180; return [((lon + 180) / 360) * n - meta.x0 * 256, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n - meta.y0 * 256]; };
const land = (x, y) => { x |= 0; y |= 0; return x >= 0 && y >= 0 && x < meta.w && y < meta.h && elev[y * meta.w + x] > -9000; };
// 陸のかたまりの番号（build-islands と同じ 4 近傍）
const lab = new Int32Array(meta.w * meta.h).fill(-1);
{ let id = 0; const st = []; for (let i = 0; i < lab.length; i++) { if (elev[i] <= -9000 || lab[i] >= 0) continue; st.push(i); lab[i] = id; while (st.length) { const j = st.pop(), x = j % meta.w; for (const q of [x > 0 ? j - 1 : -1, x < meta.w - 1 ? j + 1 : -1, j - meta.w, j + meta.w]) if (q >= 0 && q < lab.length && elev[q] > -9000 && lab[q] < 0) { lab[q] = id; st.push(q); } } id++; } }
const routes = [];
for (const fn of fs.readdirSync(dir)) {
  const m = fn.match(/^12_(\d+)_(\d+)\.pbf$/); if (!m) continue;
  const b = fs.readFileSync(new URL(fn, dir)); if (!b.length) continue;
  const tx = +m[1], ty = +m[2];
  for (const f of decodeMVT(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), ['searoute']).searoute || []) for (const ring of f.geom) {
    if (ring.length < 2) continue;
    routes.push(ring.map(([x, y]) => g2ll((tx + x / f.extent) * 256, (ty + y / f.extent) * 256, Z).map((v) => +v.toFixed(4))));
  }
}
fs.writeFileSync(new URL('../data/searoutes.json', import.meta.url), JSON.stringify(routes));
// 航路の端（陸のそば）を集める
const ends = [];
for (const r of routes) for (const p of [r[0], r[r.length - 1]]) {
  const [px, py] = ll2px(p[0], p[1]);
  let best = null, bd = 4;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = Math.round(px) + dx, y = Math.round(py) + dy; if (!land(x, y)) continue; const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = [x, y]; } }
  if (best) ends.push({ lon: p[0], lat: p[1], comp: lab[best[1] * meta.w + best[0]] });
}
let added = 0;
for (const isl of islands) {
  if (harbors[isl.id]) continue;
  const mine = ends.filter((e) => (isl.merged ? Math.hypot((e.lon - isl.lon) * 92, (e.lat - isl.lat) * 111) < 2.5 : e.comp === isl.comp));
  if (!mine.length) continue;
  // 集落（地名の位置）にいちばん近い航路の端
  mine.sort((a, b) => Math.hypot(a.lon - isl.lon, a.lat - isl.lat) - Math.hypot(b.lon - isl.lon, b.lat - isl.lat));
  harbors[isl.id] = [mine[0].lon, mine[0].lat, '航路の港'];
  added++;
}
fs.writeFileSync(new URL('../data/harbors.json', import.meta.url), JSON.stringify(harbors));
console.log('routes', routes.length, 'ends', ends.length, 'harbors added', added, 'total', Object.keys(harbors).length, '/', islands.length);
