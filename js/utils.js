// ============ 工具函数 ============

export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// 帧率无关的指数趋近
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

export function formatTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatNum(n) {
  return n.toLocaleString('en-US');
}

// —— 均匀网格空间哈希（敌人邻居查询 / 子弹碰撞用）——
export class SpatialHash {
  constructor(cellSize = 3) {
    this.cell = cellSize;
    this.map = new Map();
  }
  clear() { this.map.clear(); }
  key(x, z) { return ((Math.floor(x / this.cell) + 4096) << 13) | (Math.floor(z / this.cell) + 4096); }
  insert(obj) {
    const k = this.key(obj.pos.x, obj.pos.z);
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    arr.push(obj);
  }
  // 查询以 (x,z) 为中心、radius 半径内的对象，结果写入 out（复用避免 GC），返回数量
  query(x, z, radius, out) {
    let n = 0;
    const c = this.cell;
    const x0 = Math.floor((x - radius) / c), x1 = Math.floor((x + radius) / c);
    const z0 = Math.floor((z - radius) / c), z1 = Math.floor((z + radius) / c);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.map.get(((ix + 4096) << 13) | (iz + 4096));
        if (arr) for (let i = 0; i < arr.length; i++) out[n++] = arr[i];
      }
    }
    return n;
  }
}

// 简易 1D 噪声（屏幕震动用）
export function shakeNoise(t) {
  return Math.sin(t * 31.7) * 0.55 + Math.sin(t * 47.3 + 1.7) * 0.3 + Math.sin(t * 71.1 + 4.1) * 0.15;
}
