// 島ごとの港の位置を国土地理院の地名検索で探す（「男木島」→「男木港」「男木島港」「男木漁港」など） → data/harbors.json
import fs from 'node:fs';
const islands = JSON.parse(fs.readFileSync(new URL('../data/islands.json', import.meta.url)));
const out = {};
const km = (a, b, c, d) => Math.hypot((a - c) * 92, (b - d) * 111);
for (const isl of islands) {
  const base = isl.name.replace(/島$/, '');
  const names = [...new Set([`${base}港`, `${isl.name}港`, `${base}漁港`, `${isl.name}漁港`, `${base}島港`])];
  const r = isl.merged ? 3 : Math.max(2, Math.sqrt(isl.areaKm2 || 1) * 1.2);
  let best = null;
  for (const q of names) {
    try {
      const js = await (await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q))).json();
      for (const f of js) {
        const t = f.properties.title;
        if (!/港$/.test(t) || !t.startsWith(base)) continue;
        const [x, y] = f.geometry.coordinates;
        const d = km(x, y, isl.lon, isl.lat);
        if (d < r && (!best || d < best.d)) best = { x, y, d, t };
      }
    } catch (e) { /* 次へ */ }
  }
  if (best) out[isl.id] = [+best.x.toFixed(5), +best.y.toFixed(5), best.t];
  console.log(isl.name, best ? best.t : '-');
}
fs.writeFileSync(new URL('../data/harbors.json', import.meta.url), JSON.stringify(out));
console.log('found', Object.keys(out).length, '/', islands.length);
