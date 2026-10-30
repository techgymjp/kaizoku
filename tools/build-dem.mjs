// 瀬戸内海全域の標高を国土地理院の標高タイル（DEM10B, z10）から作る → data/dem10.png
// 画素値: 海 = 0、陸 = 標高m + 100 を R(上位)・G(下位) に入れる
import fs from 'node:fs';
import zlib from 'node:zlib';
export const Z = 10;
export const BOUNDS = { lon0: 130.75, lon1: 135.5, lat0: 33.55, lat1: 34.85 };
const n = 2 ** Z;
const tx = (lon) => ((lon + 180) / 360) * n;
const ty = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n; };
const X0 = Math.floor(tx(BOUNDS.lon0)), X1 = Math.floor(tx(BOUNDS.lon1));
const Y0 = Math.floor(ty(BOUNDS.lat1)), Y1 = Math.floor(ty(BOUNDS.lat0));
const W = (X1 - X0 + 1) * 256, H = (Y1 - Y0 + 1) * 256;
console.log('tiles', X0, X1, Y0, Y1, 'size', W, H);
const cache = new URL('../.cache/dem10/', import.meta.url);
fs.mkdirSync(cache, { recursive: true });
const elev = new Float32Array(W * H).fill(-9999);
async function get(x, y) {
  const f = new URL(`${x}_${y}.txt`, cache);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/dem/${Z}/${x}/${y}.txt`);
      if (r.status === 404) { fs.writeFileSync(f, ''); return ''; }
      const s = await r.text(); fs.writeFileSync(f, s); return s;
    } catch (e) { await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))); }
  }
  throw new Error('fetch failed ' + x + ',' + y);
}
const jobs = [];
for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) jobs.push([x, y]);
let done = 0;
async function worker() {
  while (jobs.length) {
    const [x, y] = jobs.shift();
    const s = await get(x, y);
    if (s) s.trim().split('\n').forEach((row, j) => row.split(',').forEach((v, i) => {
      const h = v === 'e' ? -9999 : parseFloat(v);
      elev[((y - Y0) * 256 + j) * W + (x - X0) * 256 + i] = h;
    }));
    done++;
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log('downloaded', done);
// PNG（RGB 8bit）
const raw = Buffer.alloc((W * 3 + 1) * H);
let land = 0;
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const h = elev[y * W + x];
    let v = 0;
    if (h > -9000) { v = Math.max(1, Math.min(65535, Math.round(Math.max(h, 0.5) + 100))); land++; }
    const o = y * (W * 3 + 1) + 1 + x * 3;
    raw[o] = v >> 8; raw[o + 1] = v & 255; raw[o + 2] = 0;
  }
}
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../data/dem10.png', import.meta.url), png);
fs.writeFileSync(new URL('../data/dem10.json', import.meta.url), JSON.stringify({ z: Z, x0: X0, y0: Y0, w: W, h: H }));
fs.writeFileSync(new URL('../.cache/elev.f32', import.meta.url), Buffer.from(elev.buffer));
console.log('png', png.length, 'land px', land);
