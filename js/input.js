// ============ 输入：键盘 / 鼠标 / 触屏摇杆 ============
import { clamp } from './utils.js';

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouseX = innerWidth / 2;
    this.mouseY = innerHeight / 2;
    this.mouseDown = false;
    this.rightDown = false;
    this.usingMouse = false;      // 鼠标是否活动过（决定瞄准方式）
    this.isTouch = ('ontouchstart' in window) && matchMedia('(pointer: coarse)').matches;
    this.joy = { active: false, id: -1, bx: 0, by: 0, x: 0, y: 0 };
    this.pressed = new Set();     // 本帧按下（边沿触发）
    this.onFirstGesture = null;

    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.gesture();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.clear());

    addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      this.usingMouse = true;
    });
    addEventListener('mousedown', (e) => {
      this.gesture();
      if (e.button === 0) { this.mouseDown = true; this.pressed.add('MouseLeft'); }
      if (e.button === 2) { this.rightDown = true; this.pressed.add('MouseRight'); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());

    if (this.isTouch) this.bindTouch();
  }

  gesture() {
    if (this.onFirstGesture) { this.onFirstGesture(); }
  }

  bindTouch() {
    const zone = document.getElementById('stick-zone');
    const base = document.getElementById('stick-base');
    const nub = document.getElementById('stick-nub');
    document.getElementById('touch-ui').classList.remove('hidden');
    const R = 52;

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault(); this.gesture();
      const t = e.changedTouches[0];
      this.joy.active = true; this.joy.id = t.identifier;
      this.joy.bx = t.clientX; this.joy.by = t.clientY;
      this.joy.x = 0; this.joy.y = 0;
      base.style.display = 'block';
      base.style.left = t.clientX + 'px'; base.style.top = t.clientY + 'px';
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joy.id) continue;
        let dx = t.clientX - this.joy.bx, dy = t.clientY - this.joy.by;
        const len = Math.hypot(dx, dy) || 1;
        const cl = Math.min(len, R);
        dx = dx / len * cl; dy = dy / len * cl;
        this.joy.x = dx / R; this.joy.y = dy / R;
        nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joy.id) continue;
        this.joy.active = false; this.joy.id = -1; this.joy.x = 0; this.joy.y = 0;
        base.style.display = 'none';
        nub.style.transform = 'translate(-50%,-50%)';
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);

    const bindBtn = (id, code) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); this.gesture(); this.pressed.add(code); this.keys.add(code); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); this.keys.delete(code); }, { passive: false });
    };
    bindBtn('btn-dash', 'Space');
    bindBtn('btn-pulse', 'KeyQ');
    bindBtn('btn-ult', 'KeyE');
  }

  clear() {
    this.keys.clear(); this.pressed.clear();
    this.mouseDown = false; this.rightDown = false;
    this.joy.active = false; this.joy.id = -1; this.joy.x = 0; this.joy.y = 0;
    const base = document.getElementById('stick-base');
    if (base) base.style.display = 'none';
  }

  // 移动向量（已归一化）
  moveVec() {
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (this.joy.active) { x += this.joy.x; z += this.joy.y; }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z, active: len > 0.01 };
  }

  justPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }
}
