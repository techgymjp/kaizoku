// 島の名前を国土地理院の地名検索で座標に直す（tools/islands-src.txt → tools/islands-geo.json）
import fs from 'node:fs';
const src = fs.readFileSync(new URL('./islands-src.txt', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
const km = (a, b, c, d) => Math.hypot((a - c) * 92, (b - d) * 111);
const out = [];
for (const line of src) {
  const [name, pref, lon, lat, kana] = line.split(',');
  const hx = +lon, hy = +lat;
  let best = null;
  try {
    const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(name));
    const js = await r.json();
    for (const f of js) {
      if (f.properties.title !== name) continue;
      if (!String(f.properties.addressCode || '').startsWith(pref)) continue;
      const [x, y] = f.geometry.coordinates;
      const d = km(x, y, hx, hy);
      if (d < 14 && (!best || d < best.d)) best = { x, y, d };
    }
  } catch (e) { console.error(name, e.message); }
  const rec = { name, pref, kana, lon: best ? best.x : hx, lat: best ? best.y : hy, geo: !!best };
  console.log(name, pref, best ? `ok ${best.d.toFixed(1)}km` : 'HINT');
  out.push(rec);
}
fs.writeFileSync(new URL('./islands-geo.json', import.meta.url), JSON.stringify(out, null, 1));
