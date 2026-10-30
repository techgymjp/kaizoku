// 効果音と BGM（WebAudio で手続き生成）
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
    bgmBus = ac.createGain(); bgmBus.gain.value = 0.8; bgmBus.connect(master);
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
  // 琴（カープラス・ストロング風に短いノイズを櫛形フィルタで鳴らす代わりに、減衰の速い倍音で近似）
  function koto(freq, when, vol = 0.12, dur = 1.6, dest) {
    const t = ac.currentTime + when;
    const out = ac.createGain(); out.connect(dest || bgmBus);
    for (const [m, v, d] of [[1, 1, 1], [2, 0.45, 0.6], [3, 0.22, 0.35], [4.02, 0.12, 0.2]]) {
      const o = ac.createOscillator(); o.type = m === 1 ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(freq * m * 1.006, t);
      o.frequency.exponentialRampToValueAtTime(freq * m, t + 0.04); // 爪の当たり
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * v, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * d);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur * d + 0.05);
    }
    const n = ac.createBufferSource(); n.buffer = noiseBuf;
    const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = freq * 3; nf.Q.value = 4;
    const ng = ac.createGain(); ng.gain.setValueAtTime(vol * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(nf); nf.connect(ng); ng.connect(out); n.start(t, Math.random()); n.stop(t + 0.08);
  }
  // 琵琶（低く、撥の当たりが強く、音が少し下がる）
  function biwa(freq, when, vol = 0.16, dur = 1.4) {
    const t = ac.currentTime + when;
    const o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq * 1.03, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(freq * 0.985, t + dur);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(freq * 12, t); f.frequency.exponentialRampToValueAtTime(freq * 2, t + dur * 0.6);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(bgmBus); o.start(t); o.stop(t + dur + 0.05);
    const n = ac.createBufferSource(); n.buffer = noiseBuf;
    const ng = ac.createGain(); ng.gain.setValueAtTime(vol * 0.8, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    const nf = ac.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 2000;
    n.connect(nf); nf.connect(ng); ng.connect(bgmBus); n.start(t, Math.random()); n.stop(t + 0.05);
  }
  // 尺八（息の音を混ぜた正弦波。ゆっくり揺れる）
  function shaku(freq, when, dur, vol = 0.07) {
    const t = ac.currentTime + when;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 0.97, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.15);
    const lfo = ac.createOscillator(); lfo.frequency.value = 4.5;
    const lg = ac.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * 0.012, t + dur * 0.7);
    lfo.connect(lg); lg.connect(o.frequency);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.18);
    g.gain.setValueAtTime(vol, t + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bgmBus);
    const n = ac.createBufferSource(); n.buffer = noiseBuf;
    const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = freq * 2; nf.Q.value = 3;
    const ng = ac.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(vol * 0.9, t + 0.08); ng.gain.exponentialRampToValueAtTime(vol * 0.15, t + 0.4); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(nf); nf.connect(ng); ng.connect(bgmBus);
    o.start(t); lfo.start(t); n.start(t, Math.random()); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05); n.stop(t + dur + 0.05);
  }
  function taiko(when, vol = 0.3, pitch = 70) {
    const t = ac.currentTime + when;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(pitch * 1.6, t); o.frequency.exponentialRampToValueAtTime(pitch, t + 0.05); o.frequency.exponentialRampToValueAtTime(pitch * 0.7, t + 0.45);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(bgmBus); o.start(t); o.stop(t + 0.55);
    const n = ac.createBufferSource(); n.buffer = noiseBuf;
    const nf = ac.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 400;
    const ng = ac.createGain(); ng.gain.setValueAtTime(vol * 0.6, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    n.connect(nf); nf.connect(ng); ng.connect(bgmBus); n.start(t, Math.random()); n.stop(t + 0.12);
  }
  function kane(when, vol = 0.05) { // 鉦（チャンチキ）
    const t = ac.currentTime + when;
    for (const f of [1870, 2830, 4100]) {
      const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
      o.connect(hp); hp.connect(g); g.connect(bgmBus); o.start(t); o.stop(t + 0.15);
    }
  }
  // ---- BGM ----
  // 都節音階（ミ・ファ・ラ・シ・ド）を基本に、場面ごとに速さと楽器を変える
  let bgmBus = null, bgm = { mode: null, next: 0, step: 0, timer: null };
  const MIYAKO = [0, 1, 5, 7, 8]; // 半音
  const RYUKYU = [0, 2, 3, 7, 9]; // 陽音階に近い（民謡・舟歌）
  const note = (base, scale, deg) => { const o = Math.floor(deg / 5); const i = ((deg % 5) + 5) % 5; return base * 2 ** ((scale[i] + o * 12) / 12); };
  // 旋律（音階の度数。null は休み）
  const SONGS = {
    // 舟歌：ゆったりした陽の音階。尺八と琴
    sea: { bpm: 76, scale: RYUKYU, base: 293.7, len: 32,
      mel: [5, null, 4, 3, 4, null, null, null, 3, 2, 3, 4, 2, null, null, null, 5, null, 6, 7, 6, 5, 4, null, 3, 4, 2, 1, 0, null, null, null],
      bass: [0, null, null, null, -3, null, null, null, -2, null, null, null, -5, null, null, null],
      drum: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0] },
    // 海戦：速い太鼓と鉦、琴の刻み
    battle: { bpm: 152, scale: MIYAKO, base: 329.6, len: 16,
      mel: [5, 4, 5, 7, 6, 5, 4, 2, 3, 4, 3, 2, 1, 2, 0, null],
      bass: [0, 0, -5, 0, -2, -2, -3, -5],
      drum: [2, 0, 1, 1, 2, 0, 1, 0, 2, 1, 1, 0, 2, 0, 1, 1], kane: true },
    // 島：緊張した都節の琴と、小早川らしい太鼓
    island: { bpm: 118, scale: MIYAKO, base: 246.9, len: 16,
      mel: [0, 2, 3, null, 2, 1, 0, null, 3, 4, 5, 4, 3, 2, 1, null],
      bass: [0, null, -5, null, 0, null, -3, null],
      drum: [2, 0, 0, 1, 1, 0, 1, 0, 2, 0, 0, 1, 1, 0, 1, 1] },
    // 壇ノ浦：琵琶と低い太鼓、法螺貝。平家の怨霊
    final: { bpm: 96, scale: MIYAKO, base: 164.8, len: 16,
      mel: [0, null, 1, null, 0, -1, -2, null, 3, null, 2, 1, 0, null, null, null],
      bass: [0, 0, -2, -2, -5, -5, -4, -4],
      drum: [2, 0, 1, 0, 2, 0, 1, 1, 2, 0, 1, 0, 2, 1, 2, 1], biwa: true },
    title: { bpm: 64, scale: MIYAKO, base: 293.7, len: 16,
      mel: [0, null, 2, 3, 4, null, 3, 2, 1, null, 2, 0, null, null, null, null],
      bass: [0, null, null, null, -3, null, null, null], drum: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    clear: { bpm: 120, scale: RYUKYU, base: 392, len: 16,
      mel: [0, 2, 3, 5, 4, 3, 5, 7, 6, 5, 4, 3, 5, null, null, null],
      bass: [0, -2, -3, -5, 0, -2, 0, null], drum: [2, 0, 1, 1, 2, 0, 1, 0, 2, 1, 1, 1, 2, 2, 2, 0], kane: true },
  };
  function bgmTick() {
    if (!ac || !bgm.mode) return;
    const S = SONGS[bgm.mode];
    const spb = 60 / S.bpm / 2; // 8分音符
    while (bgm.next < ac.currentTime + 0.25) {
      const w = Math.max(0, bgm.next - ac.currentTime);
      const i = bgm.step;
      const m = S.mel[i % S.len];
      if (m !== null && m !== undefined) {
        const f = note(S.base, S.scale, m);
        if (bgm.mode === 'sea' || bgm.mode === 'title') {
          let len = 1; while (S.mel[(i + len) % S.len] === null && len < 4) len++;
          shaku(f, w, spb * len * 1.1, 0.06);
          if (i % 4 === 0) koto(f / 2, w, 0.05, 2.2);
        } else if (S.biwa) { if (i % 2 === 0) biwa(f, w, 0.13, 1.6); else koto(f * 2, w, 0.05); }
        else koto(f, w, bgm.mode === 'battle' ? 0.07 : 0.08, 1.2);
      }
      const bi = (i >> 1) % S.bass.length;
      if (i % 2 === 0 && S.bass[bi] !== null) {
        const f = note(S.base / 4, S.scale, S.bass[bi]);
        if (S.biwa) biwa(f, w, 0.1, 1.8); else if (bgm.mode !== 'sea' && bgm.mode !== 'title') koto(f, w, 0.06, 0.9);
      }
      const d = S.drum[i % S.drum.length];
      if (d) taiko(w, d === 2 ? 0.26 : 0.13, S.biwa ? 55 : 72);
      if (S.kane && i % 2 === 1) kane(w, 0.025);
      bgm.next += spb; bgm.step++;
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
