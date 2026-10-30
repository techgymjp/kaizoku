// 地理院ベクトルタイル（Mapbox Vector Tile）の最小限の読み取り
// 返り値: { layerName: [{ type, props, geom: [[[x,y],...], ...] }] }（座標は 0〜extent）

function Reader(buf) { this.b = buf; this.p = 0; }
Reader.prototype.varint = function () {
  let r = 0, s = 0, b;
  do { b = this.b[this.p++]; if (s < 28) r |= (b & 0x7f) << s; else r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80);
  return r >>> 0 === r ? r : r;
};
Reader.prototype.svarint = function () { const v = this.varint(); return v % 2 === 1 ? (v + 1) / -2 : v / 2; };
Reader.prototype.bytes = function () { const l = this.varint(); const s = this.p; this.p += l; return this.b.subarray(s, s + l); };
Reader.prototype.skip = function (wt) {
  if (wt === 0) this.varint(); else if (wt === 1) this.p += 8; else if (wt === 2) this.p += this.varint(); else if (wt === 5) this.p += 4;
};
const td = new TextDecoder();

function readValue(buf) {
  const r = new Reader(buf); let v = null;
  while (r.p < buf.length) {
    const tag = r.varint(), f = tag >> 3, wt = tag & 7;
    if (f === 1) v = td.decode(r.bytes());
    else if (f === 2) { v = new DataView(buf.buffer, buf.byteOffset + r.p, 4).getFloat32(0, true); r.p += 4; }
    else if (f === 3) { v = new DataView(buf.buffer, buf.byteOffset + r.p, 8).getFloat64(0, true); r.p += 8; }
    else if (f === 4 || f === 5) v = r.varint();
    else if (f === 6) v = r.svarint();
    else if (f === 7) v = !!r.varint();
    else r.skip(wt);
  }
  return v;
}

function decodeGeom(arr) {
  const rings = []; let cur = null, x = 0, y = 0, i = 0;
  while (i < arr.length) {
    const ci = arr[i++], cmd = ci & 7, cnt = ci >> 3;
    if (cmd === 1 || cmd === 2) {
      for (let k = 0; k < cnt; k++) {
        const dx = arr[i++], dy = arr[i++];
        x += dx % 2 === 1 ? (dx + 1) / -2 : dx / 2;
        y += dy % 2 === 1 ? (dy + 1) / -2 : dy / 2;
        if (cmd === 1) { cur = []; rings.push(cur); }
        cur.push([x, y]);
      }
    } else if (cmd === 7) { /* closepath */ }
  }
  return rings;
}

function packed(buf) { const r = new Reader(buf), out = []; while (r.p < buf.length) out.push(r.varint()); return out; }

export function decodeMVT(arrayBuffer, want) {
  const buf = new Uint8Array(arrayBuffer);
  const r = new Reader(buf);
  const out = {};
  while (r.p < buf.length) {
    const tag = r.varint();
    if (tag >> 3 !== 3) { r.skip(tag & 7); continue; }
    const lb = r.bytes(), lr = new Reader(lb);
    let name = '', extent = 4096; const keys = [], vals = [], feats = [];
    while (lr.p < lb.length) {
      const t = lr.varint(), f = t >> 3;
      if (f === 1) name = td.decode(lr.bytes());
      else if (f === 2) feats.push(lr.bytes());
      else if (f === 3) keys.push(td.decode(lr.bytes()));
      else if (f === 4) vals.push(readValue(lr.bytes()));
      else if (f === 5) extent = lr.varint();
      else lr.skip(t & 7);
    }
    if (want && !want.includes(name)) continue;
    const list = [];
    for (const fb of feats) {
      const fr = new Reader(fb); let tags = [], type = 0, geom = [];
      while (fr.p < fb.length) {
        const t = fr.varint(), f = t >> 3;
        if (f === 2) tags = packed(fr.bytes());
        else if (f === 3) type = fr.varint();
        else if (f === 4) geom = packed(fr.bytes());
        else fr.skip(t & 7);
      }
      const props = {};
      for (let i = 0; i < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      list.push({ type, props, geom: decodeGeom(geom), extent });
    }
    out[name] = list;
  }
  return out;
}
