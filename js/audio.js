// 効果音と BGM（WebAudio で手続き生成。BGM は海賊映画のような管弦楽を新しく作曲したもの）
// 効果音の多くは「孤軍奮闘小早川」（techgymjp/kobayakawa）の js/audio.js をそのまま使っている
export const Sfx = (() => {
  let ac = null, master = null, muted = false, noiseBuf = null;
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startCrowd();
    startWaves();
    bgmBus = ac.createGain(); bgmBus.gain.value = 0.75; bgmBus.connect(master);
    makeReverb();
    if (bgm.mode) { const m = bgm.mode; bgm.mode = null; setBgm(m); }
  }

  // 兵士たちの「ワー」という鬨の声（ノイズ＋声のフォルマント）
  let crowd = null;
  function startCrowd() {
    const out = ac.createGain(); out.gain.value = 0; out.connect(master);
    const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 800; nf.Q.value = 0.8;
    const ng = ac.createGain(); ng.gain.value = 0.5;
    n.connect(nf); nf.connect(ng); ng.connect(out); n.start();
    // 「アー」の母音（第1・第2フォルマント）
    const f1 = ac.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 760; f1.Q.value = 4;
    const f2 = ac.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1180; f2.Q.value = 5;
    const vg = ac.createGain(); vg.gain.value = 1.6;
    f1.connect(vg); f2.connect(vg); vg.connect(out);
    const voices = [];
    for (let i = 0; i < 12; i++) {
      const base = 130 + Math.random() * 190;
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = base;
      const lfo = ac.createOscillator(); lfo.frequency.value = 3 + Math.random() * 4;
      const lg = ac.createGain(); lg.gain.value = base * 0.03;
      lfo.connect(lg); lg.connect(o.frequency);
      const g = ac.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(f1); g.connect(f2);
      o.start(); lfo.start();
      voices.push({ o, g, base });
    }
    crowd = { out, nf, voices, level: 0, boost: 0, last: 0 };
  }
  // level: 0（静か）〜1（危機）
  function setCrowd(level) {
    if (!crowd) return;
    const t = ac.currentTime;
    if (t - crowd.last < 0.15) return;
    const dt = Math.min(0.5, t - crowd.last);
    crowd.last = t;
    crowd.boost = Math.max(0, crowd.boost - dt * 0.35);
    const L = Math.min(1, Math.max(level, crowd.boost));
    crowd.level = L;
    const gain = level <= 0 && crowd.boost <= 0 ? 0 : 0.025 + Math.pow(L, 1.3) * 0.6;
    crowd.out.gain.setTargetAtTime(gain, t, 0.35);
    crowd.nf.frequency.setTargetAtTime(700 + L * 700, t, 0.4);
    for (const v of crowd.voices) {
      // 声がばらばらに上がったり途切れたり。危機ほど多く、高く叫ぶ
      if (Math.random() < 0.25 + L * 0.4) {
        const on = Math.random() < 0.35 + L * 0.6;
        v.g.gain.setTargetAtTime(on ? (0.05 + Math.random() * 0.1) : 0.005, t, 0.15 + Math.random() * 0.3);
      }
      v.o.frequency.setTargetAtTime(v.base * (1 + L * 0.35) * (0.94 + Math.random() * 0.12), t, 0.3);
    }
  }
  function noise(dur, freq, q, vol, type = 'bandpass', when = 0) {
    if (!ac) return;
    const t = ac.currentTime + when;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  function tone(freq, dur, vol, type = 'sine', slide = 0, when = 0) {
    if (!ac) return;
    const t = ac.currentTime + when;
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // ---- ここから瀬戸内の海賊王で足した音 ----
  // 波の音（ずっと鳴らしておき、海モードで大きくする）
  let waves = null;
  function startWaves() {
    const out = ac.createGain(); out.gain.value = 0; out.connect(master);
    const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 0.5;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.12;
    const lg = ac.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(f.frequency);
    const amp = ac.createGain(); amp.gain.value = 0.6;
    const lfo2 = ac.createOscillator(); lfo2.frequency.value = 0.09;
    const lg2 = ac.createGain(); lg2.gain.value = 0.35; lfo2.connect(lg2); lg2.connect(amp.gain);
    n.connect(f); f.connect(amp); amp.connect(out); n.start(); lfo.start(); lfo2.start();
    // 風
    const w = ac.createBufferSource(); w.buffer = noiseBuf; w.loop = true; w.playbackRate.value = 0.7;
    const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 3;
    const wl = ac.createOscillator(); wl.frequency.value = 0.07;
    const wlg = ac.createGain(); wlg.gain.value = 400; wl.connect(wlg); wlg.connect(wf.frequency);
    const wg = ac.createGain(); wg.gain.value = 0.05;
    w.connect(wf); wf.connect(wg); wg.connect(out); w.start(); wl.start();
    waves = out;
  }
  // ---- BGM（海賊映画のような管弦楽。ニ短調・6/8 拍子の疾走感。曲はすべて新しく作ったもの） ----
  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
  function env(g, t, a, peak, d, sus, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), t + a + d);
    g.gain.setValueAtTime(Math.max(0.0001, peak * sus), end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);
  }
  // 弦の刻み（チェロ・コントラバス）：短く、強く
  function strings(m, when, dur, vol = 0.09) {
    const t = ac.currentTime + when, f = mtof(m);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(f * 8, t); lp.frequency.exponentialRampToValueAtTime(f * 3, t + dur);
    const g = ac.createGain(); env(g, t, 0.008, vol, dur * 0.6, 0.35, t + dur * 0.85);
    for (const d of [-8, 7]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + dur + 0.1); }
    lp.connect(g); g.connect(bgmBus);
  }
  // 金管（ホルン・トランペット）：吹き始めに音が開く
  function brass(m, when, dur, vol = 0.07, bright = 1) {
    const t = ac.currentTime + when, f = mtof(m);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(f * 1.2, t); lp.frequency.exponentialRampToValueAtTime(f * 5 * bright, t + 0.07); lp.frequency.exponentialRampToValueAtTime(f * 3.2 * bright, t + 0.3);
    const g = ac.createGain(); env(g, t, 0.04, vol, 0.2, 0.75, t + dur);
    const vib = ac.createOscillator(); vib.frequency.value = 5.2; const vg = ac.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.008, t + Math.min(0.5, dur));
    vib.connect(vg);
    for (const [type, mul, d] of [['sawtooth', 1, -5], ['sawtooth', 1, 6], ['square', 0.5, 0]]) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f * mul; o.detune.value = d; vg.connect(o.frequency);
      const og = ac.createGain(); og.gain.value = type === 'square' ? 0.35 : 0.5; o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.15);
    }
    vib.start(t); vib.stop(t + dur + 0.15);
    lp.connect(g); g.connect(bgmBus); g.connect(revIn);
  }
  // 弦の和音（ゆっくり立ち上がる）
  function pad(ms, when, dur, vol = 0.03) {
    const t = ac.currentTime + when;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ac.createGain(); env(g, t, Math.min(0.5, dur * 0.3), vol, 0.3, 0.85, t + dur);
    for (const m of ms) for (const d of [-10, 9]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + dur + 0.2); }
    lp.connect(g); g.connect(bgmBus); g.connect(revIn);
  }
  // 合唱（「アー」）
  function choir(ms, when, dur, vol = 0.035) {
    const t = ac.currentTime + when;
    const f1 = ac.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 720; f1.Q.value = 5;
    const f2 = ac.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 6;
    const g = ac.createGain(); env(g, t, 0.35, vol, 0.3, 0.9, t + dur);
    for (const m of ms) for (const d of [-12, 0, 11]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = d; o.connect(f1); o.connect(f2); o.start(t); o.stop(t + dur + 0.2); }
    f1.connect(g); f2.connect(g); g.connect(bgmBus); g.connect(revIn);
  }
  function timpani(m, when, vol = 0.3) {
    const t = ac.currentTime + when, f = mtof(m);
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g); g.connect(bgmBus); g.connect(revIn); o.start(t); o.stop(t + 1);
    const n = ac.createBufferSource(); n.buffer = noiseBuf;
    const nf = ac.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 600;
    const ng = ac.createGain(); ng.gain.setValueAtTime(vol * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(nf); nf.connect(ng); ng.connect(bgmBus); n.start(t, Math.random()); n.stop(t + 0.15);
  }
  function snare(when, vol = 0.08) {
    const t = ac.currentTime + when;
    const n = ac.createBufferSource(); n.buffer = noiseBuf;
    const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2200; nf.Q.value = 0.7;
    const ng = ac.createGain(); ng.gain.setValueAtTime(vol, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    n.connect(nf); nf.connect(ng); ng.connect(bgmBus); n.start(t, Math.random()); n.stop(t + 0.16);
  }
  function cymbal(when, vol = 0.07) {
    const t = ac.currentTime + when;
    const n = ac.createBufferSource(); n.buffer = noiseBuf;
    const nf = ac.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 5000;
    const ng = ac.createGain(); ng.gain.setValueAtTime(vol, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    n.connect(nf); nf.connect(ng); ng.connect(bgmBus); ng.connect(revIn); n.start(t, Math.random() * 0.2); n.stop(t + 1.45);
  }
  // 残響
  let revIn = null;
  function makeReverb() {
    const len = ac.sampleRate * 2.2, buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    const cv = ac.createConvolver(); cv.buffer = buf;
    revIn = ac.createGain(); revIn.gain.value = 0.35;
    const out = ac.createGain(); out.gain.value = 0.5;
    revIn.connect(cv); cv.connect(out); out.connect(master);
  }

  // 和音の名前 → 構成音（ニ短調の中で使うもの）
  const CH = { Dm: [50, 53, 57], C: [48, 52, 55], Bb: [46, 50, 53], A: [45, 49, 52], Gm: [43, 46, 50], F: [41, 45, 48], Am: [45, 48, 52], E: [40, 44, 47], D: [50, 54, 57], G: [43, 47, 50], Eb: [51, 55, 58], Bbm: [46, 49, 53], Cm: [48, 51, 55] };
  // 旋律は [8分音符での位置, MIDI 音, 長さ]。1 小節 = 8分音符 6 つ（6/8 拍子）
  const SONGS = {
    // 航海：勇ましく、少し哀しい主題
    sea: { dq: 66, bars: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Gm', 'A', 'A', 'F', 'C', 'Bb', 'A', 'Dm', 'Gm', 'A', 'Dm'], gallop: 1, drums: 'march',
      mel: [[0, 69, 2], [2, 74, 1], [3, 76, 2], [5, 77, 1], [6, 76, 3], [9, 74, 3], [12, 77, 2], [14, 79, 1], [15, 81, 2], [17, 82, 1], [18, 81, 3], [21, 79, 2], [23, 76, 1],
        [24, 77, 2], [26, 76, 1], [27, 74, 2], [29, 69, 1], [30, 70, 3], [33, 74, 2], [35, 79, 1], [36, 77, 2], [38, 76, 1], [39, 73, 2], [41, 69, 1], [42, 76, 6],
        [48, 72, 2], [50, 77, 1], [51, 81, 3], [54, 79, 2], [56, 76, 1], [57, 72, 3], [60, 74, 2], [62, 77, 1], [63, 82, 3], [66, 81, 2], [68, 79, 1], [69, 76, 3],
        [72, 81, 2], [74, 77, 1], [75, 74, 2], [77, 77, 1], [78, 79, 2], [80, 82, 1], [81, 81, 3], [84, 76, 2], [86, 73, 1], [87, 76, 3], [90, 74, 6]] },
    // 海戦：速く激しい。金管の連打と打楽器
    battle: { dq: 84, bars: ['Dm', 'C', 'Bb', 'A', 'Dm', 'C', 'Bb', 'A', 'Gm', 'Dm', 'Eb', 'A'], gallop: 2, drums: 'battle',
      mel: [[0, 74, 1], [1, 74, 1], [2, 74, 1], [3, 77, 2], [5, 76, 1], [6, 72, 1], [7, 72, 1], [8, 72, 1], [9, 76, 2], [11, 74, 1], [12, 70, 2], [14, 74, 1], [15, 77, 2], [17, 82, 1], [18, 81, 4], [22, 76, 2],
        [24, 74, 1], [25, 74, 1], [26, 74, 1], [27, 81, 2], [29, 79, 1], [30, 76, 1], [31, 76, 1], [32, 76, 1], [33, 79, 2], [35, 77, 1], [36, 74, 2], [38, 77, 1], [39, 82, 2], [41, 81, 1], [42, 81, 6],
        [48, 79, 2], [50, 77, 1], [51, 74, 3], [54, 74, 2], [56, 77, 1], [57, 81, 3], [60, 82, 2], [62, 79, 1], [63, 75, 3], [66, 76, 2], [68, 73, 1], [69, 69, 3]] },
    // 島：低い弦の刻みが続く、忍び寄る緊張
    island: { dq: 72, bars: ['Dm', 'Dm', 'Bb', 'A', 'Gm', 'Gm', 'Bb', 'A'], gallop: 1, drums: 'sneak', low: true,
      mel: [[0, 62, 3], [3, 65, 3], [6, 64, 2], [8, 61, 1], [9, 62, 3], [12, 65, 3], [15, 69, 3], [18, 70, 2], [20, 69, 1], [21, 64, 3],
        [24, 67, 3], [27, 70, 3], [30, 69, 2], [32, 65, 1], [33, 62, 3], [36, 70, 3], [39, 74, 3], [42, 73, 6]] },
    // 壇ノ浦：遅く重い。合唱と金管、雷のようなティンパニ
    final: { dq: 52, bars: ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Eb', 'Cm', 'A'], gallop: 0, drums: 'doom', choir: true,
      mel: [[0, 62, 3], [3, 65, 2], [5, 64, 1], [6, 62, 6], [12, 67, 3], [15, 70, 2], [17, 69, 1], [18, 64, 6], [24, 69, 3], [27, 75, 3], [30, 74, 3], [33, 72, 2], [35, 70, 1], [36, 69, 6], [42, 61, 6]] },
    title: { dq: 50, bars: ['Dm', 'Bb', 'F', 'A', 'Dm', 'Gm', 'Bb', 'A'], gallop: 0, drums: 'title',
      mel: [[0, 69, 3], [3, 74, 3], [6, 77, 4], [10, 76, 2], [12, 74, 3], [15, 72, 3], [18, 73, 6], [24, 74, 3], [27, 77, 3], [30, 82, 4], [34, 81, 2], [36, 79, 3], [39, 77, 2], [41, 73, 1], [42, 74, 6]] },
    clear: { dq: 76, bars: ['D', 'G', 'D', 'A', 'D', 'G', 'A', 'D'], gallop: 1, drums: 'march', major: true,
      mel: [[0, 74, 2], [2, 78, 1], [3, 81, 3], [6, 83, 2], [8, 81, 1], [9, 78, 3], [12, 74, 2], [14, 78, 1], [15, 81, 2], [17, 86, 1], [18, 85, 6],
        [24, 86, 2], [26, 83, 1], [27, 79, 3], [30, 81, 2], [32, 78, 1], [33, 74, 3], [36, 76, 2], [38, 78, 1], [39, 79, 2], [41, 85, 1], [42, 86, 6]] },
  };
  let bgmBus = null, bgm = { mode: null, next: 0, step: 0, timer: null };
  function bgmTick() {
    if (!ac || !bgm.mode) return;
    const S = SONGS[bgm.mode];
    const e8 = 60 / S.dq / 3; // 8分音符の長さ
    const total = S.bars.length * 6;
    while (bgm.next < ac.currentTime + 0.3) {
      const w = Math.max(0, bgm.next - ac.currentTime);
      const i = bgm.step % total, bar = (i / 6) | 0, pos = i % 6;
      const chord = CH[S.bars[bar]];
      const root = chord[0] - (chord[0] > 47 ? 12 : 0);
      // 低音の刻み（タタタ・タタタ）
      if (S.gallop) {
        const acc = pos === 0 || pos === 3;
        strings(root, w, e8 * 0.9, acc ? 0.11 : 0.07);
        if (S.gallop > 1 || acc) strings(root + 12, w, e8 * 0.8, acc ? 0.06 : 0.04);
        if (!S.low && pos % 3 === 1) strings(chord[1] + 12, w, e8 * 0.7, 0.035);
      } else if (pos === 0) strings(root, w, e8 * 5, 0.06);
      if (pos === 0) {
        pad(chord.map((m) => m + 12), w, e8 * 6, S.low ? 0.018 : 0.026);
        if (S.choir) choir(chord.map((m) => m + 12), w, e8 * 6, 0.04);
        if (bar === 0 || (S.drums === 'battle' && bar % 2 === 0)) cymbal(w, S.drums === 'battle' ? 0.08 : 0.05);
      }
      // 打楽器
      const D = S.drums;
      if (D === 'march') { if (pos === 0) timpani(38, w, 0.28); if (pos === 3) timpani(45, w, 0.18); if (pos === 5) snare(w, 0.05); }
      else if (D === 'battle') { if (pos === 0 || pos === 3) timpani(pos ? 45 : 38, w, 0.3); snare(w, pos === 2 || pos === 5 ? 0.09 : 0.035); }
      else if (D === 'sneak') { if (pos === 0) timpani(38, w, 0.2); if (pos === 4 && bar % 2 === 1) timpani(37, w, 0.12); }
      else if (D === 'doom') { if (pos === 0) timpani(38, w, 0.38); if (pos === 3 && bar % 2 === 1) for (let k = 0; k < 3; k++) timpani(38, w + k * e8 / 3, 0.15); }
      else if (D === 'title') { if (pos === 0 && bar % 2 === 0) timpani(38, w, 0.25); }
      // 旋律（金管）
      for (const [p, m, len] of S.mel) if (p === i) {
        brass(m, w, e8 * len * 0.95, S.drums === 'battle' ? 0.075 : 0.065, S.drums === 'doom' ? 0.7 : 1);
        if (S.drums === 'battle' || S.drums === 'doom') brass(m - 12, w, e8 * len * 0.95, 0.04, 0.6); // 低い金管で重ねる
      }
      bgm.next += e8; bgm.step++;
    }
  }
  function setBgm(mode) {
    if (!ac) { bgm.mode = mode; return; }
    if (bgm.mode === mode && bgm.timer) return;
    bgm.mode = mode; bgm.step = 0; bgm.next = ac.currentTime + 0.3;
    if (!bgm.timer) bgm.timer = setInterval(bgmTick, 90);
    if (mode === 'final') setTimeout(() => api.horn(0.4, 0, 0.8, [0.8, 0.8, 2.2]), 400);
  }
  let lastHit = 0;
  const api = {
    init,
    crowd: setCrowd,
    // 一時的に「ワーッ」と沸き上がる
    swell(amt) { if (crowd) { crowd.boost = Math.max(crowd.boost, amt); crowd.last = 0; } },
    // アプリが裏に回ったときなどに音を止める／再開する
    suspend() { if (ac && ac.state === 'running') ac.suspend(); },
    resume() { if (ac && ac.state === 'suspended') ac.resume(); },
    get muted() { return muted; },
    toggle() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; },
    slash() { noise(0.12, 3200, 0.8, 0.35, 'highpass'); },
    thrust() { noise(0.16, 1400, 1.5, 0.35); tone(180, 0.1, 0.1, 'triangle', 0.5); },
    hit() {
      if (!ac || ac.currentTime - lastHit < 0.03) return; lastHit = ac.currentTime;
      noise(0.08, 900, 1, 0.45); tone(120, 0.08, 0.25, 'square', 0.4);
    },
    clang() { tone(1800, 0.25, 0.12, 'triangle', 0.9); tone(2600, 0.2, 0.08, 'sine'); },
    hurt() { tone(220, 0.18, 0.25, 'sawtooth', 0.4); noise(0.1, 600, 1, 0.3); },
    gun(vol = 0.5) { noise(0.35, 500, 0.6, vol, 'lowpass'); noise(0.05, 3000, 1, vol * 0.6); },
    kill() { tone(90, 0.35, 0.4, 'sine', 0.5); noise(0.2, 400, 1, 0.3, 'lowpass'); },
    gallop() { noise(0.05, 300, 2, 0.12, 'lowpass'); },
    drum(v = 0.5) { tone(70, 0.4, v, 'sine', 0.6); noise(0.08, 200, 1, v * 0.3, 'lowpass'); },
    // 法螺貝「ブォ〜、ブォ〜、ブォオオ〜〜」 vol: 音量, pan: -1(左)〜1(右), pitch: 音高倍率
    horn(vol = 0.3, pan = 0, pitch = 1, calls = [0.55, 0.55, 1.7]) {
      if (!ac) return;
      const out = ac.createGain(); out.gain.value = vol;
      let dest = out;
      if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); out.connect(p); p.connect(master); }
      else out.connect(master);
      // 遠くの法螺貝ほどこもらせる
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + vol * 1400; lp.Q.value = 3;
      lp.connect(dest);
      let t = ac.currentTime + 0.05;
      const f0 = 118 * pitch;
      for (const dur of calls) {
        const end = t + dur;
        const o1 = ac.createOscillator(); o1.type = 'sawtooth';
        const o2 = ac.createOscillator(); o2.type = 'square';
        for (const o of [o1, o2]) {
          o.frequency.setValueAtTime(f0 * 0.8, t);
          o.frequency.exponentialRampToValueAtTime(f0, t + 0.18); // しゃくり上げ
          o.frequency.setValueAtTime(f0, end - 0.25);
          o.frequency.exponentialRampToValueAtTime(f0 * 0.86, end); // 息切れで下がる
        }
        o2.detune.value = 1200 + 6; // 1オクターブ上を少し混ぜる
        const lfo = ac.createOscillator(); lfo.frequency.value = 5.5;
        const lg = ac.createGain(); lg.gain.value = f0 * 0.012;
        lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
        g.gain.setValueAtTime(0.5, end - 0.2);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        const g2 = ac.createGain(); g2.gain.value = 0.25;
        o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(lp);
        // 息の音
        const n = ac.createBufferSource(); n.buffer = noiseBuf;
        const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = f0 * 4; nf.Q.value = 2;
        const ng = ac.createGain();
        ng.gain.setValueAtTime(0.0001, t);
        ng.gain.exponentialRampToValueAtTime(0.12, t + 0.06);
        ng.gain.exponentialRampToValueAtTime(0.0001, end);
        n.connect(nf); nf.connect(ng); ng.connect(lp);
        o1.start(t); o2.start(t); lfo.start(t); n.start(t);
        o1.stop(end + 0.05); o2.stop(end + 0.05); lfo.stop(end + 0.05); n.stop(end + 0.05);
        t = end + 0.22;
      }
    },
    fanfare() {
      [0, 0.25, 0.5, 0.9].forEach((w, i) => tone([392, 440, 523, 659][i], 0.5, 0.15, 'triangle', 1, w));
    },
    dirge() { [0, 0.6, 1.2].forEach((w, i) => tone([220, 196, 147][i], 0.9, 0.18, 'triangle', 1, w)); },
    bgm: setBgm,
    get bgmMode() { return bgm.mode; },
    sea(level) { if (waves) waves.gain.setTargetAtTime(level, ac.currentTime, 0.6); },
    cannon(vol = 0.6) { noise(0.8, 180, 0.7, vol, 'lowpass'); tone(60, 0.5, vol * 0.7, 'sine', 0.5); noise(0.08, 2400, 1, vol * 0.5); },
    splash(vol = 0.4) { noise(0.5, 1200, 0.6, vol, 'bandpass'); noise(0.9, 400, 0.5, vol * 0.6, 'lowpass', 0.05); },
    crack(vol = 0.45) { noise(0.12, 1800, 2, vol); noise(0.3, 260, 1, vol * 0.8, 'lowpass', 0.03); tone(90, 0.3, vol * 0.4, 'square', 0.4); },
    sink() { noise(2.2, 220, 0.6, 0.5, 'lowpass'); [0, 0.25, 0.6, 1.0].forEach((w) => noise(0.4, 600 + Math.random() * 500, 3, 0.2, 'bandpass', w)); tone(70, 1.8, 0.2, 'sine', 0.4); },
    treasure() { [0, 0.09, 0.18, 0.3, 0.45].forEach((w, i) => tone([1046, 1318, 1568, 2093, 2637][i], 0.6, 0.08, 'triangle', 1, w)); setTimeout(() => api.fanfare(), 500); },
    coin() { tone(1760, 0.12, 0.08, 'square', 1); tone(2637, 0.25, 0.06, 'triangle', 1, 0.06); },
    bomb() { noise(1.0, 140, 0.5, 0.75, 'lowpass'); noise(0.3, 900, 0.8, 0.4, 'bandpass'); tone(48, 0.7, 0.4, 'sine', 0.5); },
    whoosh() { noise(0.35, 700, 1.2, 0.18, 'bandpass'); },
    bell() { [0, 1.5].forEach((w) => { tone(196, 3.5, 0.12, 'sine', 1, w); tone(392 * 1.01, 2.5, 0.05, 'sine', 1, w); tone(590, 1.8, 0.03, 'sine', 1, w); }); },
    oar() { noise(0.25, 500, 1.5, 0.1, 'bandpass'); },
  };
  return api;
})();
