// ============ 粒子池 + 冲击波环 + 飘字 ============
import * as THREE from 'three';
import { rand } from './utils.js';

const MAX_PARTICLES = 3500;

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.cap = MAX_PARTICLES;
    this.count = 0;
    // SoA 数据
    this.px = new Float32Array(this.cap); this.py = new Float32Array(this.cap); this.pz = new Float32Array(this.cap);
    this.vx = new Float32Array(this.cap); this.vy = new Float32Array(this.cap); this.vz = new Float32Array(this.cap);
    this.life = new Float32Array(this.cap); this.maxLife = new Float32Array(this.cap);
    this.drag = new Float32Array(this.cap); this.grav = new Float32Array(this.cap);
    this.size0 = new Float32Array(this.cap);
    this.cr = new Float32Array(this.cap); this.cg = new Float32Array(this.cap); this.cb = new Float32Array(this.cap);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(this.cap * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(this.cap * 3), 3);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(this.cap), 1);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setAttribute('psize', this.sizeAttr);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float psize; attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * (140.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vColor * a, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
    this._c = new THREE.Color();
  }

  spawn(x, y, z, vx, vy, vz, life, size, colorHex, drag = 2.5, grav = 0) {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size;
    this.drag[i] = drag; this.grav[i] = grav;
    this._c.setHex(colorHex);
    this.cr[i] = this._c.r; this.cg[i] = this._c.g; this.cb[i] = this._c.b;
  }

  burst(x, y, z, n, colorHex, { speed = 8, life = 0.6, size = 0.5, up = 2, spread = 1, grav = -4 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const r = rand(0.2, 1) * speed * spread;
      this.spawn(
        x + rand(-0.2, 0.2), y + rand(0, 0.3), z + rand(-0.2, 0.2),
        Math.cos(a) * r, rand(0, up), Math.sin(a) * r,
        life * rand(0.5, 1.1), size * rand(0.7, 1.4), colorHex, 3.2, grav
      );
    }
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        this.px[i] = this.px[n]; this.py[i] = this.py[n]; this.pz[i] = this.pz[n];
        this.vx[i] = this.vx[n]; this.vy[i] = this.vy[n]; this.vz[i] = this.vz[n];
        this.life[i] = this.life[n]; this.maxLife[i] = this.maxLife[n];
        this.size0[i] = this.size0[n]; this.drag[i] = this.drag[n]; this.grav[i] = this.grav[n];
        this.cr[i] = this.cr[n]; this.cg[i] = this.cg[n]; this.cb[i] = this.cb[n];
        i--;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= d; this.vz[i] *= d; this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] = Math.max(0.05, this.py[i] + this.vy[i] * dt);
      this.pz[i] += this.vz[i] * dt;
    }
    this.count = n;
    // 写入 GPU 属性
    const pos = this.posAttr.array, col = this.colAttr.array, sz = this.sizeAttr.array;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = this.px[i]; pos[i * 3 + 1] = this.py[i]; pos[i * 3 + 2] = this.pz[i];
      const f = this.life[i] / this.maxLife[i];
      const ff = f * f;
      col[i * 3] = this.cr[i] * ff; col[i * 3 + 1] = this.cg[i] * ff; col[i * 3 + 2] = this.cb[i] * ff;
      sz[i] = this.size0[i] * (0.4 + 0.6 * f);
    }
    this.geo.setDrawRange(0, n);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}

// ============ 冲击波环池 ============
export class Shockwaves {
  constructor(scene) {
    this.pool = [];
    const geo = new THREE.RingGeometry(0.92, 1, 48);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.pool.push({ mesh: m, t: 0, dur: 0, maxR: 0, active: false });
    }
  }

  fire(x, z, maxR, colorHex, dur = 0.55, y = 0.15) {
    const w = this.pool.find((p) => !p.active);
    if (!w) return;
    w.active = true; w.t = 0; w.dur = dur; w.maxR = maxR;
    w.mesh.visible = true;
    w.mesh.position.set(x, y, z);
    w.mesh.material.color.setHex(colorHex);
    w.mesh.scale.setScalar(0.01);
  }

  update(dt) {
    for (const w of this.pool) {
      if (!w.active) continue;
      w.t += dt;
      const f = w.t / w.dur;
      if (f >= 1) { w.active = false; w.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - f, 3);   // easeOutCubic
      w.mesh.scale.setScalar(Math.max(0.01, w.maxR * e));
      w.mesh.material.opacity = (1 - f) * 0.9;
    }
  }

  clear() { for (const w of this.pool) { w.active = false; w.mesh.visible = false; } }
}

// ============ 实体碎块（击杀迸溅的甲壳碎片） ============
export class Debris {
  constructor(scene) {
    this.pool = [];
    const geo = new THREE.TetrahedronGeometry(0.24, 0);
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      this.pool.push({
        mesh: m, active: false, t: 0, dur: 0,
        vx: 0, vy: 0, vz: 0, rx: 0, ry: 0,
      });
    }
  }

  burst(x, y, z, colorHex, n = 3, speed = 9) {
    for (let i = 0; i < n; i++) {
      const d = this.pool.find((p) => !p.active);
      if (!d) return;
      d.active = true; d.t = 0; d.dur = rand(0.6, 1.0);
      const a = rand(Math.PI * 2);
      d.vx = Math.cos(a) * rand(0.3, 1) * speed;
      d.vz = Math.sin(a) * rand(0.3, 1) * speed;
      d.vy = rand(4, 10);
      d.rx = rand(-9, 9); d.ry = rand(-9, 9);
      d.mesh.visible = true;
      d.mesh.position.set(x, y + 0.3, z);
      d.mesh.scale.setScalar(rand(0.6, 1.5));
      d.mesh.material.color.setHex(colorHex);
      d.mesh.material.opacity = 1;
    }
  }

  update(dt) {
    for (const d of this.pool) {
      if (!d.active) continue;
      d.t += dt;
      if (d.t >= d.dur) { d.active = false; d.mesh.visible = false; continue; }
      d.vy -= 22 * dt;
      const m = d.mesh;
      m.position.x += d.vx * dt;
      m.position.y += d.vy * dt;
      m.position.z += d.vz * dt;
      if (m.position.y < 0.12 && d.vy < 0) { d.vy *= -0.42; d.vx *= 0.7; d.vz *= 0.7; m.position.y = 0.12; }
      m.rotation.x += d.rx * dt;
      m.rotation.y += d.ry * dt;
      const f = d.t / d.dur;
      m.material.opacity = f < 0.6 ? 1 : 1 - (f - 0.6) / 0.4;
    }
  }

  clear() { for (const d of this.pool) { d.active = false; d.mesh.visible = false; } }
}

// ============ 飘字（HTML 池，3D→2D 投影） ============
export class FloatTexts {
  constructor(camera) {
    this.camera = camera;
    this.layer = document.getElementById('text-layer');
    this.pool = [];
    for (let i = 0; i < 56; i++) {
      const el = document.createElement('div');
      el.className = 'dmg-num';
      el.style.display = 'none';
      this.layer.appendChild(el);
      this.pool.push({ el, active: false, x: 0, y: 0, z: 0, vy: 0, t: 0, dur: 0 });
    }
    this._v = new THREE.Vector3();
  }

  fire(x, y, z, text, cls = '') {
    const w = this.pool.find((p) => !p.active) || this.pool[0];
    w.active = true; w.x = x; w.y = y; w.z = z;
    w.vy = 3.2; w.t = 0; w.dur = 0.75;
    w.el.textContent = text;
    w.el.className = 'dmg-num ' + cls;
    w.el.style.display = 'block';
  }

  update(dt) {
    const w2 = innerWidth / 2, h2 = innerHeight / 2;
    for (const w of this.pool) {
      if (!w.active) continue;
      w.t += dt;
      if (w.t >= w.dur) { w.active = false; w.el.style.display = 'none'; continue; }
      w.y += w.vy * dt; w.vy *= 0.92;
      this._v.set(w.x, w.y, w.z).project(this.camera);
      const f = w.t / w.dur;
      w.el.style.transform = `translate(${(this._v.x * w2 + w2).toFixed(1)}px, ${(-this._v.y * h2 + h2).toFixed(1)}px) translate(-50%,-50%) scale(${1 + (1 - f) * 0.15})`;
      w.el.style.opacity = f < 0.7 ? 1 : (1 - (f - 0.7) / 0.3);
    }
  }

  clear() { for (const w of this.pool) { w.active = false; w.el.style.display = 'none'; } }
}
