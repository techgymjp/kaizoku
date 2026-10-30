// 標高から島（陸のかたまり）を切り出し、地名検索した有人島と結び付ける → data/islands.json
import fs from 'node:fs';
import { encodePNG } from './png.mjs';
const meta = JSON.parse(fs.readFileSync(new URL('../data/dem10.json', import.meta.url)));
const { w: W, h: H, x0, y0, z } = meta;
const elev = new Float32Array(fs.readFileSync(new URL('../.cache/elev.f32', import.meta.url)).buffer.slice(0));
const geo = JSON.parse(fs.readFileSync(new URL('./islands-geo.json', import.meta.url)));
const n = 2 ** z;
const px = (lon) => ((lon + 180) / 360) * n * 256 - x0 * 256;
const py = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256 - y0 * 256; };
const land = (i) => elev[i] > -9000;
// 4近傍で連結成分
const lab = new Int32Array(W * H).fill(-1);
const comps = [];
const st = new Int32Array(W * H);
for (let i = 0; i < W * H; i++) {
  if (!land(i) || lab[i] >= 0) continue;
  const id = comps.length; let sp = 0; st[sp++] = i; lab[i] = id;
  let a = 0, minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, edge = false, maxh = 0, mx = 0, my = 0;
  while (sp) {
    const j = st[--sp]; const x = j % W, y = (j / W) | 0;
    a++; mx += x; my += y; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (elev[j] > maxh) maxh = elev[j];
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
    const nb = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1];
    for (const k of nb) if (k >= 0 && land(k) && lab[k] < 0) { lab[k] = id; st[sp++] = k; }
  }
  comps.push({ id, a, minx, miny, maxx, maxy, edge, maxh, cx: mx / a, cy: my / a });
}
console.log('components', comps.length, 'big', comps.filter((c) => c.a > 50000).map((c) => c.a));
const MAIN = 60000; // これより大きいのは本州・四国・九州
const out = [];
const used = new Map();
for (const g of geo) {
  let x = px(g.lon), y = py(g.lat);
  // 近くの陸へ
  let best = -1, bd = 1e9;
  const R = 25;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const k = yy * W + xx;
    if (!land(k)) continue;
    const c = comps[lab[k]];
    const d = Math.hypot(dx, dy) + (c.a > MAIN ? 6 : 0);
    if (d < bd) { bd = d; best = k; }
  }
  if (best < 0) { console.log('NO LAND', g.name); continue; }
  const c = comps[lab[best]];
  const merged = c.a > MAIN || c.edge;
  const id = `${g.name}-${g.pref}`;
  const rec = { id, name: g.name, kana: g.kana, pref: +g.pref, lon: +g.lon.toFixed(5), lat: +g.lat.toFixed(5) };
  if (merged) {
    rec.comp = -1; rec.merged = true;
    rec.bbox = [Math.round(x) - 15, Math.round(y) - 15, Math.round(x) + 15, Math.round(y) + 15];
    rec.areaKm2 = 0;
  } else {
    if (used.has(c.id)) console.log('SHARED comp', g.name, 'with', used.get(c.id));
    used.set(c.id, g.name);
    rec.comp = c.id; rec.bbox = [c.minx, c.miny, c.maxx, c.maxy];
    rec.areaKm2 = +(c.a * 0.126 * 0.126 * 0.84).toFixed(2); rec.maxH = Math.round(c.maxh);
    rec.cx = Math.round(c.cx); rec.cy = Math.round(c.cy);
  }
  rec.px = Math.round(x); rec.py = Math.round(y); rec.snap = +bd.toFixed(1);
  out.push(rec);
}
for (const r of out) if (r.merged || r.snap > 6) console.log(r.name, r.pref, r.merged ? 'MERGED' : '', 'snap', r.snap, 'area', r.areaKm2);
fs.writeFileSync(new URL('../data/islands.json', import.meta.url), JSON.stringify(out));
// 確認用の画像
const S = 3, PW = (W / S) | 0, PH = (H / S) | 0;
const rgb = new Uint8Array(PW * PH * 3);
const isl = new Set(out.map((r) => r.comp));
for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
  const k = y * S * W + x * S; const o = (y * PW + x) * 3;
  if (!land(k)) { rgb[o] = 30; rgb[o + 1] = 60; rgb[o + 2] = 110; continue; }
  const c = lab[k];
  if (isl.has(c)) { rgb[o] = 240; rgb[o + 1] = 200; rgb[o + 2] = 60; }
  else if (comps[c].a > MAIN) { rgb[o] = 70; rgb[o + 1] = 90; rgb[o + 2] = 60; }
  else { rgb[o] = 170; rgb[o + 1] = 170; rgb[o + 2] = 170; }
}
for (const r of out) { const x = (r.px / S) | 0, y = (r.py / S) | 0; for (let d = -2; d <= 2; d++) for (const [a, b] of [[x + d, y], [x, y + d]]) if (a >= 0 && b >= 0 && a < PW && b < PH) { const o = (b * PW + a) * 3; rgb[o] = 255; rgb[o + 1] = 0; rgb[o + 2] = 0; } }
fs.writeFileSync(new URL('../.cache/preview.png', import.meta.url), encodePNG(PW, PH, rgb));
console.log('islands', out.length);
