// 手続きで作る 3D モデル（船・武者・鳥居・社殿・五重塔・常夜燈・橋など）
import * as THREE from './vendor/three.module.min.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshLambertMaterial({ color, ...opts });
  matCache.set(key, m);
  return m;
}
function box(w, h, d, color, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'object' ? color : mat(color));
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
function cyl(rt, rb, h, color, seg = 8, parent) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === 'object' ? color : mat(color));
  if (parent) parent.add(m);
  return m;
}

// ---- 家紋を描いた帆 ----
function crestTexture(kind, bg, fg) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
  // 帆布の継ぎ目
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
  for (let x = 32; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  g.fillStyle = fg; g.strokeStyle = fg;
  g.translate(128, 128);
  if (kind === 'kama') {
    // 違い鎌（小早川秀秋の家紋）
    g.beginPath(); g.arc(0, 0, 92, 0, Math.PI * 2); g.lineWidth = 10; g.stroke();
    for (const s of [1, -1]) {
      g.save(); g.scale(s, 1); g.rotate(-0.78);
      g.fillRect(-7, -10, 14, 86); // 柄
      g.beginPath(); g.moveTo(-7, -10); g.quadraticCurveTo(-70, -30, -62, -70); g.quadraticCurveTo(-40, -36, 7, -26); g.closePath(); g.fill(); // 刃
      g.restore();
    }
  } else if (kind === 'maru') {
    // 丸に上の字（村上水軍風）
    g.beginPath(); g.arc(0, 0, 92, 0, Math.PI * 2); g.lineWidth = 12; g.stroke();
    g.font = '900 130px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('上', 0, 8);
  } else if (kind === 'tomoe') {
    for (let i = 0; i < 3; i++) {
      g.save(); g.rotate((i * Math.PI * 2) / 3);
      g.beginPath(); g.arc(0, -38, 30, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(30, -38); g.quadraticCurveTo(40, 30, -40, 60); g.quadraticCurveTo(10, 10, -30, -38); g.fill();
      g.restore();
    }
  } else if (kind === 'heike') {
    // 平家の赤旗（揚羽蝶）
    g.beginPath();
    for (const s of [1, -1]) { g.save(); g.scale(s, 1); g.beginPath(); g.ellipse(36, -28, 42, 30, -0.5, 0, Math.PI * 2); g.ellipse(26, 36, 26, 22, 0.6, 0, Math.PI * 2); g.fill(); g.restore(); }
    g.fillRect(-6, -60, 12, 120);
  } else {
    g.font = '900 120px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(kind, 0, 8);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- 船体 ----
function hullGeometry(L, W, D) {
  // 舳先が尖り、反り上がった和船の船体
  const secs = 14, ring = 7;
  const pos = [], idx = [];
  for (let i = 0; i <= secs; i++) {
    const t = i / secs; // 0 = 艫, 1 = 舳先
    const z = (t - 0.5) * L;
    let hw = W / 2 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.92)), 0.6);
    if (t > 0.85) hw *= 1 - (t - 0.85) / 0.15 * 0.92;
    if (t < 0.06) hw *= 0.85;
    const rise = t > 0.7 ? Math.pow((t - 0.7) / 0.3, 2) * D * 0.9 : t < 0.12 ? (0.12 - t) / 0.12 * D * 0.25 : 0;
    for (let j = 0; j <= ring; j++) {
      const a = (j / ring) * Math.PI; // 片舷から反対舷まで、底を通る
      const x = -Math.cos(a) * hw;
      const y = D * 0.55 + rise - Math.sin(a) * D * (1 - t * 0.3);
      pos.push(x, j === 0 || j === ring ? D * 0.55 + rise : y, z);
    }
  }
  for (let i = 0; i < secs; i++) for (let j = 0; j < ring; j++) {
    const a = i * (ring + 1) + j, b = a + ring + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// type: player / kobaya（小早）/ seki（関船）/ ataka（安宅船）/ heike（平家の船）
export function makeShip(type = 'player', opt = {}) {
  const S = {
    player: { L: 26, W: 7, D: 3.2, hull: '#3a2618', trim: '#b8141a', sail: '#f1e8d2', crest: 'kama', fg: '#111', yagura: 2, shields: '#8e1015' },
    kobaya: { L: 15, W: 4, D: 2.2, hull: '#4a3828', trim: '#2b2b2b', sail: '#e9e2d0', crest: opt.crest || 'maru', fg: '#1a1a1a', yagura: 0, shields: '#4a4038' },
    seki: { L: 22, W: 6, D: 2.8, hull: '#3e2e20', trim: '#1c3a6a', sail: '#ece6d6', crest: opt.crest || 'maru', fg: '#1c2a55', yagura: 1, shields: '#2a3a5a' },
    ataka: { L: 34, W: 10, D: 4, hull: '#2e2118', trim: '#3a1a40', sail: '#e6dcc6', crest: opt.crest || 'tomoe', fg: '#2a0a30', yagura: 3, shields: '#3a2030' },
    heike: { L: 24, W: 6.5, D: 3, hull: '#2a1c14', trim: '#d01818', sail: '#c8141a', crest: 'heike', fg: '#f6e8c8', yagura: 1, shields: '#a01010' },
  }[type];
  const g = new THREE.Group();
  const hull = new THREE.Mesh(hullGeometry(S.L, S.W, S.D), mat(S.hull));
  hull.rotation.y = 0; g.add(hull);
  // 船縁の色帯
  box(S.W * 0.95, 0.35, S.L * 0.82, S.trim, 0, S.D * 0.55, -S.L * 0.04, g);
  // 甲板
  box(S.W * 0.86, 0.2, S.L * 0.8, '#8a6a44', 0, S.D * 0.5, -S.L * 0.04, g);
  // 盾板（垣立て）
  const sh = mat(S.shields);
  for (const s of [-1, 1]) {
    box(0.25, 1.4, S.L * 0.66, sh, s * S.W * 0.44, S.D * 0.55 + 0.8, -S.L * 0.06, g);
    for (let k = 0; k < 6; k++) box(0.3, 0.18, 0.18, '#d8c890', s * S.W * 0.46, S.D * 0.55 + 1.25, -S.L * 0.36 + k * S.L * 0.12, g); // 鉄砲狭間
  }
  // 矢倉
  let topY = S.D * 0.55 + 1.6;
  for (let k = 0; k < S.yagura; k++) {
    const w = S.W * (0.7 - k * 0.15), l = S.L * (0.38 - k * 0.08), h = 2.2;
    box(w, h, l, k === S.yagura - 1 ? S.trim : '#5a4030', 0, topY + h / 2, -S.L * 0.12, g);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, l) * 0.78, 1.2, 4), mat('#2a2a30'));
    roof.rotation.y = Math.PI / 4; roof.scale.set(w / Math.max(w, l), 1, l / Math.max(w, l)); roof.position.set(0, topY + h + 0.5, -S.L * 0.12); g.add(roof);
    topY += h + 0.4;
  }
  // 帆柱と帆
  const mastH = S.L * 0.85;
  const mast = cyl(0.25, 0.35, mastH, '#5a3a22', 6, g); mast.position.set(0, S.D * 0.5 + mastH / 2, S.L * 0.12);
  const yard = cyl(0.15, 0.15, S.W * 1.7, '#5a3a22', 5, g); yard.rotation.z = Math.PI / 2; yard.position.set(0, S.D * 0.5 + mastH * 0.95, S.L * 0.12 + 0.4);
  const sailM = new THREE.MeshLambertMaterial({ map: crestTexture(S.crest, S.sail, S.fg), side: THREE.DoubleSide });
  const sailG = new THREE.PlaneGeometry(S.W * 1.6, mastH * 0.62, 6, 4);
  // ふくらみ
  const sp = sailG.attributes.position;
  for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i); sp.setZ(i, (1 - (x / (S.W * 0.8)) ** 2) * (0.6 + 0.4 * (1 - Math.abs(y) / (mastH * 0.31))) * S.W * 0.16); }
  sailG.computeVertexNormals();
  const sail = new THREE.Mesh(sailG, sailM);
  sail.position.set(0, S.D * 0.5 + mastH * 0.63, S.L * 0.12 + 0.6);
  g.add(sail);
  g.userData.sail = sail;
  // 幟（のぼり）
  const flagM = mat(type === 'player' ? '#c0161b' : type === 'heike' ? '#e01a1a' : S.trim, { side: THREE.DoubleSide });
  const flags = [];
  for (const [x, z] of [[-S.W * 0.42, -S.L * 0.42], [S.W * 0.42, -S.L * 0.42], [0, -S.L * 0.46]]) {
    const p = cyl(0.08, 0.08, 6, '#3a2a1a', 4, g); p.position.set(x, S.D * 0.55 + 3, z);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 3.6, 1, 4), flagM); f.position.set(x + 0.55, S.D * 0.55 + 4.1, z); f.rotation.y = Math.PI / 2; g.add(f); flags.push(f);
  }
  g.userData.flags = flags;
  // 櫓（ろ）
  const oars = [];
  const nO = type === 'kobaya' ? 4 : type === 'ataka' ? 8 : 6;
  for (const s of [-1, 1]) for (let k = 0; k < nO; k++) {
    const o = new THREE.Group();
    const bar = cyl(0.08, 0.08, S.W * 0.9, '#6a4a2a', 4, o); bar.rotation.z = Math.PI / 2; bar.position.x = s * S.W * 0.45;
    const blade = box(0.6, 0.06, 0.35, '#6a4a2a', s * S.W * 0.9, 0, 0, o);
    o.position.set(s * S.W * 0.45, S.D * 0.45, -S.L * 0.3 + (k / (nO - 1)) * S.L * 0.5);
    o.rotation.z = s * 0.5;
    g.add(o); oars.push({ o, s, ph: k * 0.4 });
  }
  g.userData.oars = oars;
  g.userData.len = S.L; g.userData.width = S.W;
  // 舳先を +z から -z に（進行方向を -z に揃える）
  const outer = new THREE.Group();
  g.rotation.y = Math.PI;
  outer.add(g);
  outer.userData = g.userData;
  return outer;
}
export function animateShip(ship, t, speed) {
  const ud = ship.userData;
  if (ud.oars) for (const o of ud.oars) {
    const a = t * (2 + speed * 0.2) + o.ph;
    o.o.rotation.y = Math.sin(a) * 0.35 * o.s;
    o.o.rotation.z = o.s * (0.45 + Math.cos(a) * 0.15);
  }
  if (ud.flags) ud.flags.forEach((f, i) => { f.rotation.x = Math.sin(t * 5 + i) * 0.15; });
}

// ---- 武者 ----
// kind: hero（小早川・赤備え）/ ashi（足軽）/ gun（鉄砲足軽）/ boss（頭目）/ ghost（平家の怨霊）
export function makeWarrior(kind = 'hero', color) {
  const C = {
    hero: { armor: '#b8141a', cloth: '#6a0c10', skin: '#e0b890', helm: '#2a1a12', gold: '#e3bc5c', s: 1.0 },
    ashi: { armor: color || '#3a4a6a', cloth: '#2a2a32', skin: '#d8a880', helm: '#5a4a32', gold: '#8a7a5a', s: 0.92 },
    gun: { armor: color || '#4a4a3a', cloth: '#2a2a22', skin: '#d8a880', helm: '#4a3a2a', gold: '#7a6a4a', s: 0.92 },
    boss: { armor: color || '#2a2a40', cloth: '#1a1a20', skin: '#c89870', helm: '#1a1a1a', gold: '#e3bc5c', s: 1.18 },
    ghost: { armor: color || '#8a1a1a', cloth: '#3a0a0a', skin: '#b8c0c8', helm: '#202020', gold: '#c8c8a0', s: 1.0 },
  }[kind];
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const am = new THREE.MeshLambertMaterial({ color: C.armor });
  const cm = mat(C.cloth), sk = mat(C.skin), hm = mat(C.helm), gm = mat(C.gold);
  // 脚
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * 0.17, 0.85, 0);
    box(0.2, 0.8, 0.22, cm, 0, -0.4, 0, leg);
    box(0.32, 0.35, 0.26, am, 0, -0.12, 0, leg); // 佩楯
    box(0.18, 0.08, 0.3, '#222', 0, -0.82, 0.04, leg);
    body.add(leg); legs.push(leg);
  }
  // 胴
  box(0.58, 0.6, 0.36, am, 0, 1.15, 0, body);
  box(0.7, 0.28, 0.42, am, 0, 0.82, 0, body); // 草摺
  box(0.6, 0.06, 0.38, gm, 0, 1.0, 0, body);
  // 頭
  const head = new THREE.Group(); head.position.set(0, 1.62, 0); body.add(head);
  box(0.26, 0.28, 0.26, sk, 0, 0, 0, head);
  if (kind === 'ashi' || kind === 'gun') {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.2, 10), hm); hat.position.y = 0.2; head.add(hat); // 陣笠
  } else {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), hm); helm.position.y = 0.08; head.add(helm);
    box(0.5, 0.06, 0.4, hm, 0, 0.06, -0.02, head); // 錣
    const crest = box(0.36, 0.22, 0.03, gm, 0, 0.3, 0.16, head); crest.rotation.x = -0.2; // 前立
    if (kind === 'hero') { box(0.06, 0.26, 0.03, gm, -0.14, 0.38, 0.16, head).rotation.z = 0.5; box(0.06, 0.26, 0.03, gm, 0.14, 0.38, 0.16, head).rotation.z = -0.5; }
    box(0.22, 0.1, 0.05, kind === 'ghost' ? '#e8e8f0' : '#1a1a1a', 0, -0.06, 0.13, head); // 面頬
  }
  // 腕
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.38, 1.38, 0);
    box(0.34, 0.2, 0.34, am, s * 0.04, 0.02, 0, arm); // 袖
    box(0.14, 0.55, 0.14, cm, 0, -0.32, 0, arm);
    box(0.12, 0.12, 0.12, sk, 0, -0.62, 0, arm);
    body.add(arm); arms.push(arm);
  }
  // 武器（右手）
  const weapon = new THREE.Group(); weapon.position.set(0, -0.62, 0); arms[1].add(weapon);
  const sword = new THREE.Group();
  box(0.04, 0.04, 1.0, '#e8eef4', 0, 0, 0.55, sword); box(0.05, 0.05, 0.25, '#2a1a1a', 0, 0, -0.04, sword); box(0.14, 0.03, 0.1, '#c8a040', 0, 0, 0.08, sword);
  const spear = new THREE.Group();
  box(0.05, 0.05, 2.8, '#4a2a18', 0, 0, 0.6, spear); box(0.06, 0.02, 0.4, '#e8eef4', 0, 0, 2.15, spear);
  const gun = new THREE.Group();
  box(0.07, 0.08, 1.3, '#3a2418', 0, 0, 0.3, gun); box(0.04, 0.04, 0.9, '#222', 0, 0.04, 0.6, gun);
  weapon.add(sword, spear, gun);
  const has = kind === 'gun' ? 'gun' : kind === 'ashi' ? 'spear' : 'sword';
  sword.visible = has === 'sword'; spear.visible = has === 'spear'; gun.visible = has === 'gun';
  if (kind === 'hero') { // 背中の指物（違い鎌の旗）
    const pole = box(0.04, 1.6, 0.04, '#3a2a1a', 0, 2.0, -0.22, body);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.9), new THREE.MeshLambertMaterial({ map: crestTexture('kama', '#c0161b', '#f3ead6'), side: THREE.DoubleSide }));
    fl.position.set(0.25, 2.3, -0.22); body.add(fl);
  }
  if (kind === 'boss') { const hs = box(0.04, 1.2, 0.04, '#3a2a1a', 0, 2.0, -0.22, body); const fl = box(0.5, 0.9, 0.02, color || '#2a2a40', 0.25, 2.2, -0.22, body); }
  if (kind === 'ghost') { am.transparent = true; am.opacity = 0.85; am.emissive = new THREE.Color('#300808'); }
  root.scale.setScalar(C.s);
  root.userData = { body, legs, arms, head, weapon, sword, spear, gun, armorMat: am, baseColor: new THREE.Color(C.armor), kind };
  return root;
}
// 歩き・攻撃の姿勢
export function poseWarrior(w, gait, moving, atk, dt) {
  const u = w.userData;
  const sw = moving ? Math.sin(gait) : 0;
  u.legs[0].rotation.x = sw * 0.7; u.legs[1].rotation.x = -sw * 0.7;
  u.arms[0].rotation.x = -sw * 0.5;
  u.body.position.y = moving ? Math.abs(Math.cos(gait)) * 0.06 : 0;
  const A = u.arms[1];
  if (atk) {
    const p = Math.min(1, atk.t / atk.dur);
    if (atk.type === 'sword') {
      if (atk.spin) { u.body.rotation.y = p * Math.PI * 2; A.rotation.set(-1.4, 0, -1.2); }
      else { u.body.rotation.y = 0; A.rotation.set(-1.3 + p * 0.3, (atk.dir || 1) * (1.2 - p * 2.4), 0); }
    } else if (atk.type === 'spear') { u.body.rotation.y = 0; A.rotation.set(-1.5, 0, 0); u.weapon.position.z = -0.2 + Math.sin(p * Math.PI) * 0.9; }
    else if (atk.type === 'aim') { A.rotation.set(-1.5, 0, 0); u.arms[0].rotation.x = -1.3; }
    else if (atk.type === 'swing') { A.rotation.set(-2.6 + p * 2.2, 0, 0); }
  } else {
    u.body.rotation.y = 0;
    A.rotation.set(-0.3 - sw * 0.3, 0, 0);
    u.weapon.position.z = 0;
  }
}

// ---- 建物・名所 ----
export function makeTorii(h = 8, color = '#d8401c', inSea = false) {
  const g = new THREE.Group();
  const m = mat(color), k = mat('#1e1a18');
  const w = h * 1.3;
  for (const s of [-1, 1]) {
    const p = cyl(h * 0.045, h * 0.055, h, m, 10, g); p.position.set(s * w * 0.32, h / 2, 0);
    if (inSea) { // 厳島の大鳥居の控柱（袖柱）
      for (const d of [-1, 1]) { const q = cyl(h * 0.028, h * 0.032, h * 0.62, m, 8, g); q.position.set(s * w * 0.32, h * 0.31, d * h * 0.28); box(h * 0.03, h * 0.03, h * 0.6, m, s * w * 0.32, h * 0.55, 0, g); }
    }
    box(h * 0.12, h * 0.08, h * 0.12, k, s * w * 0.32, h * 0.04, 0, g);
  }
  box(w * 0.82, h * 0.05, h * 0.08, m, 0, h * 0.72, 0, g); // 貫
  const kasagi = box(w, h * 0.08, h * 0.12, k, 0, h * 0.95, 0, g); // 笠木
  box(w * 0.92, h * 0.06, h * 0.1, m, 0, h * 0.88, 0, g); // 島木
  box(h * 0.06, h * 0.16, h * 0.06, m, 0, h * 0.8, 0, g); // 額束
  // 反り
  for (const s of [-1, 1]) { const e = box(w * 0.12, h * 0.08, h * 0.12, k, s * w * 0.52, h * 0.98, 0, g); e.rotation.z = s * 0.18; }
  return g;
}
export function makeHall(w, d, h, roofColor = '#3a3c44', wallColor = '#e8dcc0', pillar = '#8a2a1a') {
  const g = new THREE.Group();
  box(w, h, d, wallColor, 0, h / 2, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const p = cyl(0.15 * h / 3, 0.15 * h / 3, h, pillar, 6, g); p.position.set(sx * w / 2, h / 2, sz * d / 2); }
  // 入母屋風の屋根
  const r = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) * 0.62, h * 0.9, 4), mat(roofColor));
  r.rotation.y = Math.PI / 4; r.scale.set(w / Math.hypot(w, d) * 1.35, 1, d / Math.hypot(w, d) * 1.35); r.position.y = h + h * 0.4; g.add(r);
  box(w * 0.5, h * 0.08, h * 0.08, roofColor, 0, h + h * 0.85, 0, g);
  return g;
}
export function makePagoda(stories = 5, h = 29, color = '#c8401c') {
  const g = new THREE.Group();
  const sh = h * 0.78 / stories;
  let y = 0;
  for (let i = 0; i < stories; i++) {
    const w = h * 0.26 * (1 - i * 0.07);
    box(w * 0.7, sh * 0.6, w * 0.7, color, 0, y + sh * 0.3, 0, g);
    const r = new THREE.Mesh(new THREE.ConeGeometry(w * 0.95, sh * 0.42, 4), mat('#2c2a2a'));
    r.rotation.y = Math.PI / 4; r.position.y = y + sh * 0.75; g.add(r);
    y += sh;
  }
  const s = cyl(h * 0.012, h * 0.016, h * 0.24, '#b89a50', 6, g); s.position.y = y + h * 0.1; // 相輪
  for (let i = 0; i < 7; i++) { const ring = cyl(h * 0.03, h * 0.03, h * 0.008, '#b89a50', 8, g); ring.position.y = y + h * 0.03 + i * h * 0.025; }
  return g;
}
// 鞆の浦の常夜燈
export function makeJoyato(h = 10) {
  const g = new THREE.Group();
  box(h * 0.42, h * 0.3, h * 0.42, '#9a9488', 0, h * 0.15, 0, g); // 石の基壇
  box(h * 0.3, h * 0.25, h * 0.3, '#a8a296', 0, h * 0.42, 0, g);
  box(h * 0.22, h * 0.22, h * 0.22, '#d8c8a0', 0, h * 0.66, 0, g); // 火袋
  const l = new THREE.PointLight('#ffb050', 2, h * 6); l.position.y = h * 0.66; g.add(l);
  const r = new THREE.Mesh(new THREE.ConeGeometry(h * 0.28, h * 0.22, 4), mat('#3a3a3a')); r.rotation.y = Math.PI / 4; r.position.y = h * 0.88; g.add(r);
  const em = new THREE.Mesh(new THREE.BoxGeometry(h * 0.18, h * 0.16, h * 0.24), new THREE.MeshBasicMaterial({ color: '#ffd080' })); em.position.y = h * 0.66; g.add(em);
  return g;
}
// 石段の雁木（鞆の浦の港）
export function makeGangi(len = 40, steps = 6) {
  const g = new THREE.Group();
  for (let i = 0; i < steps; i++) box(len, 0.5, 1.2, i % 2 ? '#8a847a' : '#9a948a', 0, i * 0.5 - 1.5, -i * 1.1, g);
  return g;
}
export function makeHouse(w, d, h, roof = '#4a4e5a', wall = '#e8e0d0') {
  const g = new THREE.Group();
  box(w, h, d, wall, 0, h / 2, 0, g);
  const rg = new THREE.CylinderGeometry(0.01, Math.max(w, d) * 0.6, h * 0.5, 3, 1);
  return g;
}
export function makeChest() {
  const g = new THREE.Group();
  box(1.2, 0.7, 0.8, '#7a3a12', 0, 0.35, 0, g);
  const lid = box(1.24, 0.3, 0.84, '#8a4a1a', 0, 0.82, 0, g);
  for (const x of [-0.45, 0, 0.45]) box(0.08, 1.02, 0.86, '#d8b040', x, 0.5, 0, g);
  box(0.2, 0.2, 0.05, '#e8c860', 0, 0.62, 0.43, g);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe080', transparent: true, opacity: 0.25, depthWrite: false }));
  glow.position.y = 0.6; g.add(glow);
  // 光の柱（遠くからでも見える）
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 80, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe48a', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 40; g.add(beam);
  g.userData = { lid, glow, beam };
  return g;
}
export function makeOnigiri(s = 1) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.42); shape.quadraticCurveTo(0.38, 0.05, 0.32, -0.22); shape.quadraticCurveTo(0, -0.34, -0.32, -0.22); shape.quadraticCurveTo(-0.38, 0.05, 0, 0.42);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.24, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  geo.translate(0, 0, -0.12);
  const m = new THREE.Mesh(geo, mat('#fbfaf3')); g.add(m);
  box(0.5, 0.24, 0.4, '#1d2a1d', 0, -0.17, 0, g);
  g.scale.setScalar(s);
  return g;
}
export function makePine(h = 8) {
  const g = new THREE.Group();
  const t = cyl(h * 0.03, h * 0.05, h * 0.6, '#5a3a22', 5, g); t.position.y = h * 0.3; t.rotation.z = 0.08;
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(h * (0.22 - i * 0.04), 6, 4), mat(['#2e4a2a', '#34532e', '#3a5c32'][i]));
    c.scale.y = 0.45; c.position.set((i - 1) * h * 0.1, h * (0.55 + i * 0.16), 0); g.add(c);
  }
  return g;
}
export function makeDeer() {
  const g = new THREE.Group();
  const b = mat('#9a6a3a');
  box(0.35, 0.35, 0.8, b, 0, 0.75, 0, g);
  const n = box(0.16, 0.45, 0.16, b, 0, 1.05, 0.38, g); n.rotation.x = 0.5;
  box(0.18, 0.18, 0.32, b, 0, 1.28, 0.55, g);
  for (const [x, z] of [[-0.12, -0.3], [0.12, -0.3], [-0.12, 0.3], [0.12, 0.3]]) box(0.07, 0.6, 0.07, '#6a4a2a', x, 0.3, z, g);
  for (const s of [-1, 1]) { const a = box(0.03, 0.35, 0.03, '#d8c8a8', s * 0.08, 1.5, 0.5, g); a.rotation.z = s * 0.4; }
  return g;
}
export function makeRabbit() {
  const g = new THREE.Group();
  const w = mat(Math.random() < 0.5 ? '#f4f0ea' : '#a89070');
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), w); b.scale.set(1, 0.8, 1.3); b.position.y = 0.16; g.add(b);
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), w); h.position.set(0, 0.3, 0.2); g.add(h);
  for (const s of [-1, 1]) box(0.04, 0.2, 0.06, w, s * 0.05, 0.47, 0.18, g);
  return g;
}
export function makeLighthouse(h = 14) {
  const g = new THREE.Group();
  const t = cyl(h * 0.08, h * 0.13, h, '#f0eee8', 10, g); t.position.y = h / 2;
  const top = cyl(h * 0.1, h * 0.1, h * 0.12, '#c02020', 10, g); top.position.y = h * 1.04;
  return g;
}
// 直島の「南瓜」（黄色いかぼちゃ）
export function makePumpkin(s = 2) {
  const g = new THREE.Group();
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#f2c81a'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#111';
  for (let i = 0; i < 90; i++) { const px = (i * 37) % 256, py = 8 + ((i * 53) % 112); x.beginPath(); x.arc(px, py, 4 + ((i * 7) % 6), 0, 7); x.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const p = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 10), new THREE.MeshLambertMaterial({ map: tex }));
  p.scale.y = 0.75; p.position.y = s * 0.7; g.add(p);
  const st = cyl(s * 0.12, s * 0.18, s * 0.4, '#111', 6, g); st.position.y = s * 1.45;
  return g;
}

// ---- 橋 ----
// pts: 橋の中心線（[x, z] の配列、両端は陸）。y: 桁の高さ。towers: 主塔の位置（0〜1）と高さ
const lineMats = new Map();
function lineMat(color) { if (!lineMats.has(color)) lineMats.set(color, new THREE.LineBasicMaterial({ color })); return lineMats.get(color); }
export function makeBridge(def, toWorld) {
  // def: { type, a:[x,z], b:[x,z], deckY, towerH, towers:[t...], color, width, piers }
  const g = new THREE.Group();
  const [ax, az] = def.a, [bx, bz] = def.b;
  const L = Math.hypot(bx - ax, bz - az);
  const ang = Math.atan2(bx - ax, bz - az);
  g.position.set(ax, 0, az); g.rotation.y = ang; // ローカル z が橋の向き
  const col = mat(def.color || '#8a9a94');
  const W = def.width || 3.5, Y = def.deckY;
  // 桁
  const deck = box(W, def.type === 'truss' ? 0.8 : 0.6, L, col, 0, Y, L / 2, g);
  // トラス（瀬戸大橋は 2 層の鉄道道路併用橋）
  if (def.truss) {
    const tr = [];
    const n = Math.max(4, Math.round(L / 3));
    for (let i = 0; i < n; i++) {
      const z0 = (i / n) * L, z1 = ((i + 1) / n) * L;
      for (const s of [-1, 1]) tr.push(s * W / 2, Y, z0, s * W / 2, Y - def.truss, z1, s * W / 2, Y - def.truss, z0, s * W / 2, Y, z1, s * W / 2, Y - def.truss, z0, s * W / 2, Y - def.truss, z1);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(tr, 3));
    g.add(new THREE.LineSegments(lg, lineMat(def.color || '#8a9a94')));
    box(W, 0.4, L, col, 0, Y - def.truss, L / 2, g);
  }
  const towerZ = (def.towers || []).map((t) => t * L);
  const H = def.towerH;
  for (const z of towerZ) {
    if (def.type === 'cable') { // 斜張橋の逆 Y 型の主塔
      for (const s of [-1, 1]) { const p = box(0.6, H, 0.8, col, s * W * 0.45, H / 2 - 2, z, g); p.rotation.z = s * 0.06; }
      box(W * 0.6, 1.2, 0.8, col, 0, H * 0.75, z, g);
    } else {
      for (const s of [-1, 1]) box(0.7, H + 4, 0.9, col, s * W * 0.55, (H + 4) / 2 - 4, z, g);
      for (const f of [0.45, 0.75, 0.98]) box(W * 1.1, 0.8, 0.7, col, 0, H * f, z, g);
    }
    const pier = cyl(W * 0.5, W * 0.6, 6, '#8a8478', 8, g); pier.position.set(0, -2, z);
  }
  // ケーブル
  const pts = [];
  const add = (a, b) => pts.push(...a, ...b);
  if (def.type === 'suspension' && towerZ.length >= 2) {
    for (const s of [-1, 1]) {
      const x = s * W * 0.55;
      const anchors = [0, ...towerZ, L];
      for (let k = 0; k < anchors.length - 1; k++) {
        const z0 = anchors[k], z1 = anchors[k + 1];
        const h0 = k === 0 ? Y + 1 : H, h1 = k === anchors.length - 2 ? Y + 1 : H;
        const sag = k === 0 || k === anchors.length - 2 ? 0.25 : 1;
        let prev = null;
        const seg = 24;
        for (let i = 0; i <= seg; i++) {
          const t = i / seg, z = z0 + (z1 - z0) * t;
          let y = h0 + (h1 - h0) * t - sag * (H - Y - 2) * 4 * t * (1 - t);
          if (y < Y + 1) y = Y + 1;
          const p = [x, y, z];
          if (prev) add(prev, p);
          if (i % 2 === 0 && i > 0 && i < seg) add(p, [x, Y, z]); // ハンガー
          prev = p;
        }
      }
    }
  } else if (def.type === 'cable') {
    for (const z of towerZ) for (const s of [-1, 1]) for (let i = 1; i <= 8; i++) {
      for (const d of [-1, 1]) {
        const zz = z + d * i * (def.span || L / 2) / 18;
        if (zz < 0 || zz > L) continue;
        add([s * W * 0.4, H * (0.92 - i * 0.02), z], [s * W * 0.5, Y, zz]);
      }
    }
  } else if (def.type === 'arch') {
    let prev = null;
    for (const s of [-1, 1]) { prev = null; for (let i = 0; i <= 24; i++) { const t = i / 24, z = L * (0.1 + 0.8 * t), y = Y + 0.5 - Math.sin(Math.PI * t) * def.archH; const p = [s * W * 0.5, y, z]; if (prev) add(prev, p); if (i % 3 === 0) add(p, [s * W * 0.5, Y, z]); prev = p; } }
  }
  if (pts.length) {
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(lg, lineMat(def.cableColor || '#d8dcd8')));
  }
  // 橋脚（アプローチ部）
  const np = Math.floor(L / 12);
  for (let i = 1; i < np; i++) {
    const z = (i / np) * L;
    if (towerZ.some((tz) => Math.abs(tz - z) < 10)) continue;
    if (def.type === 'suspension' && z > towerZ[0] && z < towerZ[towerZ.length - 1]) continue;
    if (def.type === 'cable' && towerZ.length && Math.abs(z - L / 2) < (def.span || L) / 2) continue;
    if (def.type === 'arch' && z > L * 0.1 && z < L * 0.9) continue;
    const p = box(W * 0.5, Y + 4, W * 0.4, '#9a948a', 0, Y / 2 - 2, z, g);
  }
  g.userData = { L, ang, towerZ };
  return g;
}
