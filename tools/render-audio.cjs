// BGM と効果音を、ブラウザの中で書き出して mp3 にする → assets/audio/
// 使い方: (python3 -m http.server 8765 &) ; node tools/render-audio.cjs
// （playwright と ffmpeg を使う）
const { chromium } = require('playwright');
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');
const OUT = path.join(__dirname, '..', 'assets', 'audio');
function wav(chs, sr) {
  const n = chs[0].length, nc = chs.length, buf = Buffer.alloc(44 + n * nc * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * nc * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * nc * 2, 28); buf.writeUInt16LE(nc * 2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * nc * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(chs[c][i] * 32767))), 44 + (i * nc + c) * 2);
  return buf;
}
function mp3(name, chs, sr, kbps) {
  const w = path.join(OUT, name + '.wav');
  fs.writeFileSync(w, wav(chs, sr));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', w, '-codec:a', 'libmp3lame', '-b:a', kbps + 'k', path.join(OUT, name + '.mp3')]);
  fs.unlinkSync(w);
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.goto('http://localhost:8765/index.html');
  await p.waitForSelector('#title:not(.hidden)', { timeout: 120000 });
  // 読み込み済みのファイルを使わず、その場で書き出す
  const res = await p.evaluate(async () => {
    const { Sfx } = await import('./js/audio.js');
    Sfx.init();
    const X = Sfx._export;
    const enc = (f32) => { const u = new Uint8Array(f32.buffer.slice(0)); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    const out = { bgm: {}, sfx: {}, loops: {} };
    for (const [n] of X.SFX) X.sfxBuf[n] = [];
    await X.renderSfx(false);
    for (const [n] of X.SFX) out.sfx[n] = X.sfxBuf[n].map((bf) => ({ sr: bf.sampleRate, ch: [enc(bf.getChannelData(0))] }));
    for (const m of X.SONG_LIST) { delete X.rendered[m]; const bf = await X.renderSong(m); out.bgm[m] = { sr: bf.sampleRate, ch: [enc(bf.getChannelData(0)), enc(bf.getChannelData(1))] }; out.loops[m] = X.songLoop(m); }
    return out;
  });
  const dec = (s) => { const u = Buffer.from(s, 'base64'); return new Float32Array(u.buffer, u.byteOffset, u.length / 4); };
  const manifest = { bgm: {}, sfx: {} };
  for (const [n, list] of Object.entries(res.sfx)) { list.forEach((v, i) => mp3(`sfx-${n}-${i}`, v.ch.map(dec), v.sr, 96)); manifest.sfx[n] = list.length; }
  for (const [m, v] of Object.entries(res.bgm)) { mp3(`bgm-${m}`, v.ch.map(dec), v.sr, 128); manifest.bgm[m] = res.loops[m]; }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
  console.log('done', Object.keys(manifest.bgm).length, 'songs', Object.values(manifest.sfx).reduce((a, b) => a + b, 0), 'sfx');
  await b.close();
})();
