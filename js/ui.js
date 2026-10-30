// 画面の文字（メッセージ・大見出し・浮き文字・名札）
import * as THREE from './vendor/three.module.min.js';

export const $ = (id) => document.getElementById(id);

export function msg(text, cls = 'sys', life = 4) {
  const box = $('msgs');
  const el = document.createElement('div');
  el.className = 'msg ' + cls;
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > (innerWidth < 600 || innerHeight < 500 ? 3 : 5)) box.removeChild(box.firstChild);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, life * 1000);
}
export function banner(text, sub) {
  const b = $('banner');
  b.innerHTML = `<div class="b-main">${text}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
export function flash(color) {
  const f = $('flash');
  f.style.background = color;
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
}

// 3D の位置に出す文字
const v3 = new THREE.Vector3();
export function project(camera, x, y, z) {
  v3.set(x, y, z).project(camera);
  if (v3.z > 1 || v3.z < -1) return null;
  return [(v3.x * 0.5 + 0.5) * innerWidth, (-v3.y * 0.5 + 0.5) * innerHeight];
}
export class Floats {
  constructor() { this.list = []; this.layer = $('floats'); }
  add(x, y, z, text, color = '#fff', big = false) {
    const el = document.createElement('div');
    el.className = 'float' + (big ? ' big' : '');
    el.textContent = text; el.style.color = color;
    this.layer.appendChild(el);
    this.list.push({ x, y, z, el, t: 0 });
    if (this.list.length > 40) { const f = this.list.shift(); f.el.remove(); }
  }
  update(dt, camera) {
    for (const f of this.list) {
      f.t += dt;
      const p = project(camera, f.x, f.y, f.z);
      if (!p) { f.el.style.display = 'none'; continue; }
      f.el.style.display = '';
      f.el.style.transform = `translate(${p[0]}px, ${p[1] - f.t * 50}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.max(0, 1 - f.t / 0.9));
    }
    this.list = this.list.filter((f) => { if (f.t > 0.9) { f.el.remove(); return false; } return true; });
  }
  clear() { for (const f of this.list) f.el.remove(); this.list = []; }
}
// 敵の名札と体力
export class Tags {
  constructor() { this.layer = $('tags'); this.pool = []; this.used = 0; }
  begin() { this.used = 0; }
  put(camera, x, y, z, name, frac, cls = '') {
    const p = project(camera, x, y, z);
    if (!p || p[0] < -50 || p[0] > innerWidth + 50 || p[1] < -30 || p[1] > innerHeight + 30) return;
    let el = this.pool[this.used];
    if (!el) { el = document.createElement('div'); el.className = 'tag'; el.innerHTML = '<span></span><i><b></b></i>'; this.layer.appendChild(el); this.pool.push(el); }
    this.used++;
    el.style.display = '';
    el.className = 'tag ' + cls;
    const s = el.firstChild; if (s.textContent !== name) s.textContent = name;
    el.lastChild.style.display = frac === null ? 'none' : '';
    if (frac !== null) el.lastChild.firstChild.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
    el.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(-50%, -100%)`;
  }
  end() { for (let i = this.used; i < this.pool.length; i++) this.pool[i].style.display = 'none'; }
  clear() { this.begin(); this.end(); }
}
