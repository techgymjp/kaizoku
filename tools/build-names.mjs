// 地図（地理院ベクトルタイル）に載っている島の名前を集め、標高データに無い小島は海岸線から形を取る
// → data/islandnames.json : [名前, よみ, 経度, 緯度]（標高データにある島）
// → data/islets.json      : [経度, 緯度, 長径(m), 短径(m), 向き(rad), 高さ(m), 名前, よみ]（小島）
import fs from 'node:fs';
import { decodeMVT } from '../js/mvt.js';
const meta = JSON.parse(fs.readFileSync(new URL('../data/dem10.json', import.meta.url)));
const elev10 = new Float32Array(fs.readFileSync(new URL('../.cache/elev.f32', import.meta.url)).buffer.slice(0));
const cache = new URL('../.cache/vt/', import.meta.url);
fs.mkdirSync(cache, { recursive: true });
async function tile(z, x, y) {
  const f = new URL(`${z}_${x}_${y}.pbf`, cache);
  if (fs.existsSync(f)) { const b = fs.readFileSync(f); return b.length ? b.buffer.slice(b.byteOffset, b.byteOffset + b.length) : null; }
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${z}/${x}/${y}.pbf`);
      if (r.status === 404) { fs.writeFileSync(f, ''); return null; }
      if (!r.ok) throw new Error(r.status);
      const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(f, b); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    } catch (e) { await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); }
  }
  return null;
}
const g2ll = (gx, gy, z) => { const n = 2 ** z * 256; const lon = (gx / n) * 360 - 180; const k = Math.PI - (2 * Math.PI * gy) / n; return [lon, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k)))]; };
const ll2g = (lon, lat, z) => { const n = 2 ** z * 256; const r = (lat * Math.PI) / 180; return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n]; };
const land10 = (lon, lat) => { const [gx, gy] = ll2g(lon, lat, 10); const x = Math.floor(gx - meta.x0 * 256), y = Math.floor(gy - meta.y0 * 256); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = (y + dy) * meta.w + x + dx; if (elev10[k] > -9000) return true; } return false; };
async function pool(jobs, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const j = jobs[i++]; await fn(j); } })); }
// 1) z12 の島名
const Z = 12, K = 4, X0 = meta.x0 * K, Y0 = meta.y0 * K, NX = (meta.w / 256) * K, NY = (meta.h / 256) * K;
const jobs = [];
for (let ty = 0; ty < NY; ty++) for (let tx = 0; tx < NX; tx++) {
  let land = 0, n = 0;
  for (let y = ty * 64; y < ty * 64 + 64; y += 4) for (let x = tx * 64; x < tx * 64 + 64; x += 4) { n++; if (elev10[y * meta.w + x] > -9000) land++; }
  if (land < n) jobs.push([X0 + tx, Y0 + ty]);
}
console.log('z12 tiles', jobs.length);
const names = new Map();
let done = 0;
await pool(jobs, 8, async ([x, y]) => {
  const buf = await tile(Z, x, y); if (++done % 100 === 0) console.log('z12', done);
  if (!buf) return;
  const L = decodeMVT(buf, ['label']).label || [];
  for (const f of L) {
    if (f.props.annoCtg !== 352 || !f.props.knj) continue;
    const p = f.geom[0][0];
    const [lon, lat] = g2ll((x + p[0] / f.extent) * 256, (y + p[1] / f.extent) * 256, Z);
    const key = f.props.knj + '@' + lon.toFixed(2) + ',' + lat.toFixed(2);
    if (!names.has(key)) names.set(key, { name: f.props.knj, kana: f.props.kana || '', lon, lat });
  }
});
console.log('names', names.size);
// 2) 標高データに無い島は z14 の海岸線から形を取る
const demNames = [], islets = [];
const small = [...names.values()].filter((n) => !land10(n.lon, n.lat));
const big = [...names.values()].filter((n) => land10(n.lon, n.lat));
for (const n of big) demNames.push([n.name, n.kana, +n.lon.toFixed(5), +n.lat.toFixed(5)]);
console.log('dem islands named', big.length, 'islets', small.length);
done = 0;
await pool(small, 8, async (n) => {
  const [gx, gy] = ll2g(n.lon, n.lat, 14); const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  const buf = await tile(14, tx, ty); if (++done % 50 === 0) console.log('z14', done);
  const mpp = 156543.034 * Math.cos((n.lat * Math.PI) / 180) / 2 ** 14;
  let best = null, bd = 1e9;
  if (buf) {
    const L = decodeMVT(buf, ['coastline']).coastline || [];
    const lx = (gx - tx * 256), ly = (gy - ty * 256);
    for (const f of L) for (const ring of f.geom) {
      if (ring.length < 3) continue;
      const a = ring[0], b = ring[ring.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) continue;
      const pts = ring.map((p) => [(p[0] / f.extent) * 256, (p[1] / f.extent) * 256]);
      let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
      const d = Math.hypot(cx - lx, cy - ly);
      if (d < bd && d * mpp < 250) { bd = d; best = { pts, cx, cy }; }
    }
  }
  let A = 40, B = 30, ang = 0, lon = n.lon, lat = n.lat;
  if (best) {
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of best.pts) { const dx = p[0] - best.cx, dy = p[1] - best.cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    sxx /= best.pts.length; syy /= best.pts.length; sxy /= best.pts.length;
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, q = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    A = Math.max(8, Math.sqrt(tr / 2 + q) * 1.5 * mpp); B = Math.max(6, Math.sqrt(Math.max(0.01, tr / 2 - q)) * 1.5 * mpp);
    ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    [lon, lat] = g2ll(tx * 256 + best.cx, ty * 256 + best.cy, 14);
  }
  const h = Math.round(Math.min(60, 6 + Math.sqrt(A * B) * 0.35));
  islets.push([+lon.toFixed(5), +lat.toFixed(5), Math.round(A), Math.round(B), +ang.toFixed(2), h, n.name, n.kana]);
});
// 前に z12 の標高から拾った小島（名前なし）も足す
try { for (const o of JSON.parse(fs.readFileSync(new URL('../data/islets.json', import.meta.url)))) if (o.length === 6 && !islets.some((p) => Math.abs(p[0] - o[0]) < 0.002 && Math.abs(p[1] - o[1]) < 0.002)) islets.push(o); } catch (e) { /* 無ければよい */ }
fs.writeFileSync(new URL('../data/islets.json', import.meta.url), JSON.stringify(islets));
fs.writeFileSync(new URL('../data/islandnames.json', import.meta.url), JSON.stringify(demNames));
console.log('islets', islets.length, 'names', demNames.length);
