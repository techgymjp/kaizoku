// 瀬戸内の海賊王 — 起動・入力・場面の切り替え・HUD
import * as THREE from './vendor/three.module.min.js';
import { loadDEM, DEM } from './geo.js';
import { Sea, hitChance } from './sea.js';
import { crestCanvas } from './models.js';
import { Island } from './island.js';
import { Sfx } from './audio.js';
import { $, msg, banner } from './ui.js';
import { L, setLang, getLang, applyHTML, islandName } from './i18n.js';
import { STORY, STORY_EN, zoneAt, ZONES } from './data.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------- 描画 ----------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---------------- 入力 ----------------
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');
const keys = new Set(), hits = new Set();
const I = {
  mx: 0, my: 0, mouseAim: false, joy: null, tDash: false, wheel: 0,
  fire: false, bomb: false, sword: false, spear: false, land: false,
  down: (c) => keys.has(c), pressed: (c) => hits.has(c),
};
function primary() { if (mode === 'sea') I.fire = true; else I.sword = true; }
function secondary() { if (mode === 'sea') I.bomb = true; else I.spear = true; }
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Enter') { e.target.blur(); } return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  Sfx.init();
  if (!e.repeat) hits.add(e.code);
  keys.add(e.code);
  if (G && G.state === 'play' && !e.repeat) {
    if (e.code === 'KeyJ' || e.code === 'KeyZ') { primary(); I.mouseAim = false; }
    if (e.code === 'KeyK' || e.code === 'KeyX') { secondary(); I.mouseAim = false; }
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  } else if (G && G.state === 'pause' && (e.code === 'KeyP' || e.code === 'Escape')) togglePause();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousemove', (e) => {
  I.mx = e.clientX; I.my = e.clientY;
  if (document.pointerLockElement === canvas) { I.lookDX = (I.lookDX || 0) + e.movementX; I.lookDY = (I.lookDY || 0) + e.movementY; return; }
  if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) I.mouseAim = true;
});
const bowAim = () => mode === 'sea' && sea && sea.view === 'bow';
canvas.addEventListener('mousedown', (e) => {
  Sfx.init();
  I.mx = e.clientX; I.my = e.clientY; I.mouseAim = !bowAim();
  if (G && G.state === 'play' && bowAim() && document.pointerLockElement !== canvas && !isTouch) { try { canvas.requestPointerLock(); } catch (er) { /* 使えない環境 */ } return; }
  if (G && G.state === 'play') { if (e.button === 0) primary(); if (e.button === 2) secondary(); }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { I.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
(function setupTouch() {
  const zone = $('joyzone'), base = $('joybase'), knob = $('joyknob');
  let id = null, ox = 0, oy = 0;
  zone.addEventListener('touchstart', (e) => {
    Sfx.init();
    const t = e.changedTouches[0]; id = t.identifier; ox = t.clientX; oy = t.clientY;
    base.style.left = ox + 'px'; base.style.top = oy + 'px'; base.classList.add('on');
    knob.style.transform = 'translate(-50%,-50%)'; I.joy = { x: 0, y: 0 }; e.preventDefault();
  }, { passive: false });
  zone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === id) {
      let dx = t.clientX - ox, dy = t.clientY - oy; const d = Math.hypot(dx, dy), m = 55;
      if (d > m) { dx *= m / d; dy *= m / d; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      I.joy = { x: dx / m, y: dy / m };
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e) => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; I.joy = null; base.classList.remove('on'); } };
  zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
  const bind = (el, down, up) => {
    el.addEventListener('touchstart', (e) => { Sfx.init(); el.classList.add('press'); down(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', (e) => { el.classList.remove('press'); up && up(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchcancel', () => { el.classList.remove('press'); up && up(); });
  };
  // 右側をなぞって見回す（ボタン以外）
  let lookId = null, lx = 0;
  canvas.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) if (t.clientX > innerWidth * 0.45 && lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; I.looking = true; } }, { passive: true });
  let ly = 0;
  canvas.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) { I.lookDX = (I.lookDX || 0) + (t.clientX - lx) * 1.6; I.lookDY = (I.lookDY || 0) + (t.clientY - ly) * 1.6; lx = t.clientX; ly = t.clientY; } }, { passive: true });
  const lend = (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) { lookId = null; I.looking = false; } };
  canvas.addEventListener('touchend', lend); canvas.addEventListener('touchcancel', lend);
  bind($('btnSword'), () => { primary(); I.mouseAim = false; });
  bind($('btnSpear'), () => { secondary(); I.mouseAim = false; });
  bind($('btnDash'), () => { I.tDash = true; }, () => { I.tDash = false; });
  bind($('btnLand'), () => { I.land = true; });
})();

// ---------------- 船長の名前 ----------------
const nameInput = $('nameInput');
const defaultName = () => L('源義経', 'Minamoto no Yoshitsune'); // 仮の名前（源平合戦がモチーフ）
let customName = '';
try { customName = localStorage.getItem('kaizoku.name') || ''; } catch (e) { /* 保存できなくても遊べる */ }
export function playerName() { return customName.trim() || defaultName(); }
function syncName() {
  nameInput.value = customName; nameInput.placeholder = defaultName();
  $('hudName').textContent = playerName();
}
nameInput.addEventListener('input', () => {
  customName = nameInput.value.replace(/[<>&"]/g, '').slice(0, 14);
  try { localStorage.setItem('kaizoku.name', customName); } catch (e) { /* 無視 */ }
  $('hudName').textContent = playerName();
  renderStory(true);
});
$('nameReset').addEventListener('click', () => { customName = ''; try { localStorage.removeItem('kaizoku.name'); } catch (e) { /* 無視 */ } syncName(); renderStory(true); });

// ---------------- 状態 ----------------
let G = null, sea = null, island = null, mode = 'title', islands = [], islets = [], islandNames = [], harborsReal = {}, seaRoutes = [];
function newGame() {
  G = {
    state: 'play', t: 0, hp: 300, maxHp: 300, hull: 300, maxHull: 300, st: 100, maxSt: 100, stDelay: 0, lastHurt: -10,
    gold: 0, taken: new Set(), sunk: 0, kills: 0, bosses: 0, progress: 0, final: false, finalCleared: false, minX: 0,
    islands, islets, islandNames, harborsReal, seaRoutes, slain: new Set(), raided: [], guards: new Map(), fleet: new Map(),
    land, board, die, onGoal,
  };
  return G;
}

async function boot() {
  Sfx.preload(); // 音のファイルは、画面に触る前から読み込んでおく
  applyHTML();
  // 画面左上の紋：笹竜胆
  { const mon = document.querySelector('.mon'); mon.textContent = ''; mon.style.backgroundImage = `url(${crestCanvas('rindo', '#f4f2ea', '#141414', 96).toDataURL()})`; mon.style.backgroundSize = 'cover'; }
  setLoad(L('瀬戸内海の地形を読み込んでいます……', 'Loading the Seto Inland Sea…'));
  await loadDEM();
  islands = await (await fetch('data/islands.json')).json();
  seaRoutes = await fetch('data/searoutes.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  harborsReal = await fetch('data/harbors.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  islandNames = await fetch('data/islandnames.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  islets = await fetch('data/islets.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  setLoad(L('海と島々を描いています……', 'Drawing the sea and islands…'));
  await new Promise((r) => setTimeout(r, 30));
  startSea();
  $('loading').classList.add('hidden');
  showTitle();
  requestAnimationFrame(loop);
}
function setLoad(t) { $('loadtext').textContent = t; }

function startSea() {
  if (sea) { sea.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  newGame();
  sea = new Sea(renderer, G);
  sea.build();
  sea.updateChunks(true);
  mode = 'sea';
}

function showTitle() {
  mode = 'title';
  G.state = 'title';
  $('title').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('result').classList.add('hidden');
  $('pause').classList.add('hidden');
  renderStory();
  refreshContinue();
  Sfx.bgm('title');
}
function renderStory(keepName) {
  if (!keepName) syncName();
  const lines = getLang() === 'en' ? STORY_EN : STORY;
  const nm = playerName().replace(/[<>&]/g, '');
  const st = $('story'); if (st) st.innerHTML = lines.map((l) => `<p>${l.replace('{name}', `<b>${nm}</b>`)}</p>`).join('');
  $('btnMute').textContent = Sfx.muted ? L('音：切', 'Sound: off') : L('音：入', 'Sound: on');
}
for (const b of document.querySelectorAll('.lang-btn')) b.addEventListener('click', () => { setLang(b.dataset.lang); renderStory(); updateHelp(); });
$('btnMute').addEventListener('click', () => { Sfx.init(); Sfx.toggle(); renderStory(); });
$('btnStart').addEventListener('click', () => { Sfx.init(); start(); });
$('btnRetry').addEventListener('click', () => { Sfx.init(); restart(); });
$('btnTitle').addEventListener('click', () => { restart(true); });
$('btnPause').addEventListener('click', () => togglePause());
$('btnView').addEventListener('click', () => { I.toggleView = true; });
$('btnResume').addEventListener('click', () => togglePause());
$('btnQuit').addEventListener('click', () => { saveGame(); $('pause').classList.add('hidden'); restart(true); });
$('btnContinue').addEventListener('click', () => { Sfx.init(); continueGame(); });

// ---------------- セーブ（タイトルに戻るとき自動で） ----------------
const SAVE_KEY = 'kaizoku.save';
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 無視 */ } }
function saveGame() {
  if (!G || !sea || (G.state !== 'play' && G.state !== 'pause')) return;
  const P = sea.P;
  // 船（決戦の前の状態で）と、航海で出会って沈めなかった船
  const fleet = [];
  for (const [key, s] of G.fleet) {
    const zi = ZONES.findIndex((z) => z.faction.name === s.faction.name);
    fleet.push([key, s.type, zi, s.cap ? s.cap.ja : '', s.crewN]);
  }
  const data = {
    v: 1, at: Date.now(), t: G.t, hp: G.hp, gold: G.gold, taken: [...G.taken], sunk: G.sunk, kills: G.kills, bosses: G.bosses, minX: G.minX,
    ship: [P.x, P.z, P.h], slain: [...(G.slain || [])], guards: [...G.guards.entries()], fleet, island: island ? island.isl.id : null,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* 保存できない */ }
}
function continueGame() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { d = null; }
  if (!d) { start(); return; }
  Object.assign(G, { t: d.t || 0, hp: Math.max(1, d.hp || G.maxHp), gold: d.gold || 0, sunk: d.sunk || 0, kills: d.kills || 0, bosses: d.bosses || 0, minX: d.minX ?? G.minX });
  G.taken = new Set(d.taken || []);
  G.slain = new Set(d.slain || []);
  G.guards = new Map(d.guards || []);
  G.fleet = new Map();
  for (const [key, type, zi, capJa, crewN] of d.fleet || []) {
    const z = ZONES[zi] || ZONES[1];
    const cap = z.captains.find((c) => c.ja === capJa) || z.captains[0];
    G.fleet.set(key, { type, cap, faction: z.faction, crewN });
  }
  const [x, zz, h] = d.ship;
  sea.P.x = x; sea.P.z = zz; sea.P.h = h; sea.P.v = 0; sea.P.sail = 1;
  if (d.island) { sea.noAuto = d.island; sea.noAutoX = x; sea.noAutoZ = zz; }
  sea.updateChunks(true);
  start(true);
}
function refreshContinue() { $('btnContinue').classList.toggle('hidden', !hasSave()); }

function start(resumed) {
  $('title').classList.add('hidden');
  $('hud').classList.remove('hidden');
  G.state = 'play';
  mode = 'sea';
  sea.camInit = false;
  Sfx.bgm('sea');
  Sfx.horn(0.4);
  if (resumed) banner(L('航海の続き', 'Voyage resumed'), L('西へ——目指すは巌流島', 'West — for Ganryūjima'));
  else { clearSave(); banner(L('姫路港より出航', 'Setting sail from Himeji'), L('追い風を受けて西へ——目指すは巌流島', 'A tailwind blows west — for Ganryūjima')); }
  msg(L('帆を張れ！ 風は西へ吹いている。潮の流れに気をつけろ。', 'Raise the sail! The wind blows west — mind the tidal currents.'), 'sys', 5);
  setTimeout(() => msg(L('金色の光の柱が港。⚓の港に入れば自動で上陸し、財宝を奪いに行ける。', 'Golden pillars of light mark the ports. Sail into a ⚓ port to land and raid its treasure.'), 'sys', 6), 4000);
  updateHelp();
}
function restart(toTitle) {
  if (island) { island.dispose(); island = null; }
  $('result').classList.add('hidden');
  $('msgs').innerHTML = '';
  setLoad(L('新しい船を用意しています……', 'Preparing a new ship…'));
  $('loading').classList.remove('hidden');
  setTimeout(() => {
    startSea();
    $('loading').classList.add('hidden');
    if (toTitle) showTitle(); else start();
  }, 30);
}
function togglePause() {
  if (!G) return;
  if (G.state === 'play') { G.state = 'pause'; $('pause').classList.remove('hidden'); if (document.pointerLockElement) document.exitPointerLock(); }
  else if (G.state === 'pause') { G.state = 'play'; $('pause').classList.add('hidden'); }
}

// ---- 上陸と乗船 ----
async function land(c) {
  if (G.state !== 'play') return;
  if (document.pointerLockElement) document.exitPointerLock();
  G.state = 'loading';
  const name = islandName(c.isl);
  setLoad(L(`${name}に上陸します……`, `Landing on ${name}…`));
  $('loading').classList.remove('hidden');
  $('landPrompt').classList.add('hidden');
  G.zoneColor = zoneAt(G.lon || 135).faction.color;
  try {
    island = new Island(renderer, G);
    await island.load(c, (t) => setLoad(t));
    mode = 'island';
    G.hp = G.maxHp; G.st = G.maxSt; // 上陸したら体力を全回復してから戦う
    sea.tags.clear(); sea.floats.clear();
    Sfx.bgm(G.final ? 'final' : 'island');
    Sfx.horn(0.3, 0, 1.05, [0.5, 0.5, 1.2]);
  } catch (e) {
    console.error(e);
    island = null;
    msg(L('上陸できなかった……', 'Could not land…'), 'warn', 4);
  }
  $('loading').classList.add('hidden');
  G.state = 'play';
  updateHelp();
}
function board() {
  if (!island) return;
  const raided = island.treasure.taken;
  if (raided && !G.raided.includes(island.isl.id)) G.raided.push(island.isl.id);
  const leftId = island.isl.id;
  island.dispose(); island = null;
  mode = 'sea';
  sea.resume(leftId);
  G.hp = G.maxHp; G.st = G.maxSt; // 船に戻ったら体力を全回復
  banner(L('船に戻った', 'Back aboard'), L('体力が全回復した', 'HP fully restored'));
  Sfx.bgm(G.final ? 'final' : 'sea');
  updateHelp();
}
function die(reason) {
  if (G.state !== 'play') return;
  G.state = 'dying'; G.endT = 0; G.deathPlace = reason;
  Sfx.dirge();
  banner(L('無念……', 'Defeated…'), reason);
}
function onGoal() {
  if (G.state !== 'play') return;
  G.state = 'clearing'; G.endT = 0;
  Sfx.bgm('clear'); Sfx.fanfare(); Sfx.bell();
  if (sea) sea.fw.show(sea.goal.x, 0, sea.goal.z, 30, true, 0.25, 180);
  banner(L('巌流島に着いた！', 'You reached Ganryūjima!'), L(`瀬戸内の海賊王・${playerName()}、ここに誕生`, `${playerName()}, Pirate King of the Seto Inland Sea, is born`));
}

// ---------------- 結果 ----------------
function rank(clear) {
  const g = G.gold;
  if (clear) return g >= 6000 ? L('真の瀬戸内の海賊王', 'True Pirate King of the Seto Sea') : L('瀬戸内の海賊王', 'Pirate King of the Seto Sea');
  if (g < 300) return L('船酔いの小悪党', 'Seasick Rascal');
  if (g < 1200) return L('海賊見習い', 'Apprentice Pirate');
  if (g < 3000) return L('島荒らし', 'Island Raider');
  if (g < 6000) return L('瀬戸内の大海賊', 'Great Pirate of the Inland Sea');
  return L('海賊王になりそこねた男', 'The Man Who Almost Became King');
}
function showResult(clear) {
  clearSave();
  G.state = 'result';
  $('hud').classList.add('hidden');
  $('result').classList.remove('hidden');
  const h = $('rHead');
  h.textContent = clear ? L('海賊王', 'PIRATE KING') : L('無　念', 'DEFEATED');
  h.classList.toggle('clear', clear);
  $('rPlace').textContent = clear ? L('平家の怨霊を鎮め、巌流島に至る', 'Laid the Heike ghosts to rest and reached Ganryūjima') : G.deathPlace || '';
  $('rTitle').textContent = L(`船長 ${playerName()}　称号：`, `Captain ${playerName()} — `) + rank(clear);
  $('rGold').textContent = G.gold.toLocaleString() + L(' 両', ' ryō');
  $('rIsl').textContent = `${G.taken.size} / ${islands.length}`;
  $('rSunk').textContent = G.sunk;
  $('rKill').textContent = G.kills + G.bosses;
  $('rProg').textContent = Math.round(G.progress * 100) + '%';
  const s = Math.floor(G.t);
  $('rTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const list = $('rList'); list.innerHTML = '';
  for (const id of G.taken) { const isl = islands.find((i) => i.id === id); if (!isl) continue; const c = document.createElement('span'); c.className = 'chip on'; c.textContent = islandName(isl); list.appendChild(c); }
  Sfx.crowd(0);
}
function shareText() {
  const clear = $('rHead').classList.contains('clear');
  return L(`【瀬戸内の海賊王】船長${playerName()}は「${rank(clear)}」——財宝 ${G.gold.toLocaleString()} 両、${G.taken.size} 島を荒らし、${G.sunk} 艘を沈めた。`, `[Pirate King of the Seto Inland Sea] Captain ${playerName()}: ${rank(clear)} — ${G.gold.toLocaleString()} ryō of treasure, ${G.taken.size} islands raided, ${G.sunk} ships sunk.`);
}
$('shareX').addEventListener('click', () => open('https://x.com/intent/post?text=' + encodeURIComponent(shareText()) + '&url=' + encodeURIComponent(location.href.split('#')[0]), '_blank', 'noopener'));
$('shareLine').addEventListener('click', () => open('https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(location.href.split('#')[0]) + '&text=' + encodeURIComponent(shareText()), '_blank', 'noopener'));

// ---------------- HUD ----------------
function updateHelp() {
  const sea = mode === 'sea';
  $('seaHelp').innerHTML = sea
    ? L('<kbd>W</kbd><kbd>S</kbd>帆 <kbd>A</kbd><kbd>D</kbd>舵 <kbd>J</kbd>鉄砲 <kbd>K</kbd>大砲 <kbd>Space</kbd>全速 <kbd>E</kbd>上陸　鉄砲は船の向きに撃つ', '<kbd>W</kbd><kbd>S</kbd> sail <kbd>A</kbd><kbd>D</kbd> steer <kbd>J</kbd> guns <kbd>K</kbd> cannon <kbd>Space</kbd> full sail <kbd>E</kbd> land · guns fire where the ship points')
    : L('<kbd>W</kbd><kbd>S</kbd>前後 <kbd>A</kbd><kbd>D</kbd>向き <kbd>J</kbd>刀 <kbd>K</kbd>槍 <kbd>Space</kbd>駆　船に戻れば乗船', '<kbd>W</kbd><kbd>S</kbd> forward/back <kbd>A</kbd><kbd>D</kbd> turn <kbd>J</kbd> sword <kbd>K</kbd> spear <kbd>Space</kbd> full speed · walk to the ship to board');
  const lab = sea ? [L('鉄砲', 'Guns'), L('大砲', 'Cannon'), L('全速', 'Full'), ''] : [L('刀', 'Sword'), L('槍', 'Spear'), L('全速', 'Full'), L('乗船', 'Board')];
  $('btnLand').classList.add('hidden'); // 上陸・乗船は港や船に近づけば自動
  ['btnSword', 'btnSpear', 'btnDash', 'btnLand'].forEach((id, i) => { $(id).textContent = lab[i]; delete $(id).dataset.en; });
}
let hudT = 0;
function updateHUD(dt) {
  hudT -= dt; if (hudT > 0) return; hudT = 0.1;
  $('hpbar').style.width = (G.hp / G.maxHp) * 100 + '%'; $('hpnum').textContent = Math.ceil(G.hp);
  $('stbar').style.width = (G.st / G.maxSt) * 100 + '%'; $('stbar').classList.toggle('low', G.st < 15);
  $('hGold').textContent = G.gold.toLocaleString();
  $('hIsl').textContent = `${G.taken.size}/${islands.length}`;
  $('hSunk').textContent = G.sunk; $('hKill').textContent = G.kills + G.bosses; $('hEsc').textContent = sea ? sea.enemies.filter((e) => e.pursue && !e.sink && !e.final).length : 0;
  let place = '';
  if (mode === 'island' && island) place = islandName(island.isl);
  else if (sea && sea.zone) place = zoneName(sea.zone);
  if (G.final && !G.finalCleared) place = L(`決戦　残り ${G.finalLeft ?? '?'} 艘`, `Final battle: ${G.finalLeft ?? '?'} ships left`);
  $('hPlace').textContent = place;
  let nh = mode === 'sea' && sea ? sea.nav : null;
  if (mode === 'island' && island && island.P) {
    const T = island.treasure, P = island.P, tg = T.taken ? island.ship : T;
    nh = { x: tg.x, z: tg.z, d: Math.hypot(tg.x - P.x, tg.z - P.z) / 10, label: T.taken ? L('⚓ 船', '⚓ Ship') : L('★ 財宝', '★ Treasure'), isl: true, h: P.heading ?? P.face, px: P.x, pz: P.z };
  }
  const nv = $('harborNav');
  nv.classList.toggle('hidden', !nh);
  if (nh) {
    const P = nh.label ? { x: nh.px, z: nh.pz, h: nh.h } : sea.P, h = nh;
    const rel = Math.atan2(h.z - P.z, h.x - P.x) - P.h; // 船（主人公）の向きから見た方向
    $('navArrow').style.transform = `rotate(${(rel * 180) / Math.PI - 90}deg)`;
    const nn = nh.label || (nh.goal ? L('巌流島', 'Ganryūjima') : islandName(nh.isl));
    if ($('navName').textContent !== nn) $('navName').textContent = nn;
    const km = nh.d * 10;
    $('navInfo').textContent = (km >= 1000 ? `${(km / 1000).toFixed(1)}km` : `${Math.round(km)}m`) + (nh.goal && G.final && !G.finalCleared ? L(`　残り${G.finalLeft ?? '?'}艘`, ` · ${G.finalLeft ?? '?'} left`) : '');
  }
  const fr = mode === 'sea' && sea && sea.front && !sea.front.e.sink ? sea.front : null;
  const tg = $('target');
  tg.classList.toggle('hidden', !fr);
  if (fr) { const pc = Math.round(hitChance(fr.d) * 100); tg.innerHTML = L(`正面　<b>${fr.e.name}</b>　${Math.round(fr.d * 10)}m　命中率 <b class="p${pc >= 70 ? 'h' : pc >= 40 ? 'm' : 'l'}">${pc}%</b>　敵兵 ${fr.e.crewN} 人`, `Ahead: <b>${fr.e.name}</b> ${Math.round(fr.d * 10)} m · hit <b class="p${pc >= 70 ? 'h' : pc >= 40 ? 'm' : 'l'}">${pc}%</b> · crew ${fr.e.crewN}`); }
  const ti = mode === 'sea' && sea ? sea.tideInfo() : null;
  $('hTide').textContent = ti ? L('潮：', 'Tide: ') + ti.text : '';
  $('hTide').classList.toggle('fast', !!(ti && ti.fast));
  $('hWind').textContent = ti ? L('風：', 'Wind: ') + ti.wind : '';
}
const ZONE_EN = { 大阪湾: 'Osaka Bay', 播磨灘: 'Harima Sea', 備讃瀬戸: 'Bisan Strait', 備後灘: 'Bingo Sea', 芸予諸島: 'Geiyo Islands', '安芸灘・広島湾': 'Aki Sea & Hiroshima Bay', '伊予灘・周防灘': 'Iyo & Suō Seas', 関門海峡: 'Kanmon Strait' };
export function zoneName(z) { return getLang() === 'en' ? ZONE_EN[z.name] || z.name : z.name; }

// ---------------- ループ ----------------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!G) return;
  if (mode === 'title') {
    // タイトルの背景：大阪湾をゆっくり巡る
    const P = sea.P; const t = now / 1000;
    sea.camera.position.set(P.x + Math.cos(t * 0.05) * 120, 40, P.z + Math.sin(t * 0.05) * 120);
    sea.camera.lookAt(P.x, 0, P.z);
    sea.updateSky(0, false);
    sea.waterU.time.value = t;
    sea.water.position.set(Math.round(sea.camera.position.x / 50) * 50, 0, Math.round(sea.camera.position.z / 50) * 50);
    sea.sky.position.copy(sea.camera.position);
    sea.ship.position.y = 0.25 + Math.sin(t * 1.3) * 0.12;
    renderer.render(sea.scene, sea.camera);
    hits.clear();
    return;
  }
  if (G.state === 'play' || G.state === 'dying' || G.state === 'clearing') {
    if (G.state !== 'play') {
      G.endT += dt; dt *= 0.35;
      if (G.endT > 2.6) showResult(G.state === 'clearing');
    }
    G.t += dt;
    if (mode === 'sea') sea.update(dt, I); else if (island) island.update(dt, I);
    updateHUD(dt);
  }
  if (mode === 'sea') sea.render(dt); else if (island) island.render(dt);
  hits.clear();
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  if (sea) sea.resize(); if (island) island.resize();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveGame(); if (G && G.state === 'play') togglePause(); Sfx.suspend(); } else Sfx.resume(); });
// 電話や通知などで音が止まったときは、次に触ったときに戻す
addEventListener('pointerdown', () => Sfx.resume(), true);
addEventListener('touchstart', () => Sfx.resume(), { capture: true, passive: true });
setInterval(() => { if (!document.hidden && Sfx.state === 'interrupted') Sfx.resume(); }, 2000);

window.__kz = { get G() { return G; }, get sea() { return sea; }, get island() { return island; }, I };
boot().catch((e) => { console.error(e); setLoad('読み込みに失敗しました / Failed to load: ' + e.message); });
