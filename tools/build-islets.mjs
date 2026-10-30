// z10 の標高では消えてしまう小島・岩礁を、z12（約 32m）の標高タイルから拾う → data/islets.json
// 1 つの島 = [経度, 緯度, 長径(m), 短径(m), 向き(rad), 最高点(m)]
import fs from 'node:fs';
const meta = JSON.parse(fs.readFileSync(new URL('../data/dem10.json', import.meta.url)));
const elev10 = new Float32Array(fs.readFileSync(new URL('../.cache/elev.f32', import.meta.url)).buffer.slice(0));
const Z = 12, K = 4; // z10 の 1 画素 = z12 の 4 画素
const cache = new URL('../.cache/dem12/', import.meta.url);
fs.mkdirSync(cache, { recursive: true });
const X0 = meta.x0 * K, Y0 = meta.y0 * K, NX = (meta.w / 256) * K, NY = (meta.h / 256) * K;
async function get(x, y) {
  const f = new URL(`${x}_${y}.txt`, cache);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/dem/${Z}/${x}/${y}.txt`);
      if (r.status === 404) { fs.writeFileSync(f, ''); return ''; }
      if (!r.ok) throw new Error(r.status);
      const s = await r.text(); fs.writeFileSync(f, s); return s;
    } catch (e) { await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); }
  }
  return '';
}
// z10 で全部陸のタイルは飛ばす
const jobs = [];
for (let ty = 0; ty < NY; ty++) for (let tx = 0; tx < NX; tx++) {
  let land = 0, n = 0;
  for (let y = ty * 64; y < ty * 64 + 64; y += 4) for (let x = tx * 64; x < tx * 64 + 64; x += 4) { n++; if (elev10[y * meta.w + x] > -9000) land++; }
  if (land === n) continue;
  jobs.push([tx, ty]);
}
console.log('tiles', jobs.length);
const out = [];
let done = 0;
const N = 256;
async function worker() {
  while (jobs.length) {
    const [tx, ty] = jobs.shift();
    const s = await get(X0 + tx, Y0 + ty);
    done++; if (done % 100 === 0) console.log('done', done);
    if (!s) continue;
    const h = new Float32Array(N * N).fill(-1);
    s.trim().split('\n').forEach((row, j) => row.split(',').forEach((v, i) => { if (v !== 'e') h[j * N + i] = parseFloat(v); }));
    const lab = new Int32Array(N * N).fill(-1);
    for (let i = 0; i < N * N; i++) {
      if (h[i] < 0 || lab[i] >= 0) continue;
      const st = [i]; lab[i] = i; const px = [];
      let edge = false;
      while (st.length) {
        const k = st.pop(); px.push(k); const x = k % N, y = (k / N) | 0;
        if (x === 0 || y === 0 || x === N - 1 || y === N - 1) edge = true;
        for (const q of [x > 0 ? k - 1 : -1, x < N - 1 ? k + 1 : -1, y > 0 ? k - N : -1, y < N - 1 ? k + N : -1]) if (q >= 0 && h[q] >= 0 && lab[q] < 0) { lab[q] = i; st.push(q); }
      }
      if (edge || px.length > 400) continue; // 大きな島・タイルの端は z10 にある
      // z10 で既に陸なら要らない
      let mx = 0, my = 0, maxH = 0;
      for (const k of px) { mx += k % N; my += (k / N) | 0; maxH = Math.max(maxH, h[k]); }
      mx /= px.length; my /= px.length;
      const g10x = Math.floor((tx * N + mx) / K), g10y = Math.floor((ty * N + my) / K);
      if (elev10[g10y * meta.w + g10x] > -9000) continue;
      // 楕円で近似
      let sxx = 0, syy = 0, sxy = 0;
      for (const k of px) { const dx = (k % N) - mx, dy = ((k / N) | 0) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      sxx /= px.length; syy /= px.length; sxy /= px.length;
      const tr = sxx + syy, det = sxx * syy - sxy * sxy, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const gx = (X0 + tx) * N + mx + 0.5, gy = (Y0 + ty) * N + my + 0.5;
      const n2 = 2 ** Z * 256;
      const lon = (gx / n2) * 360 - 180;
      const nn = Math.PI - (2 * Math.PI * gy) / n2, lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(nn) - Math.exp(-nn)));
      const mpp = 156543.034 * Math.cos(lat * Math.PI / 180) / 2 ** Z;
      const a = Math.max(0.6, Math.sqrt(l1) * 2) * mpp, b = Math.max(0.6, Math.sqrt(Math.max(l2, 0.05)) * 2) * mpp;
      out.push([+lon.toFixed(5), +lat.toFixed(5), Math.round(a), Math.round(b), +ang.toFixed(2), Math.round(Math.max(3, maxH))]);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
fs.writeFileSync(new URL('../data/islets.json', import.meta.url), JSON.stringify(out));
console.log('islets', out.length);
