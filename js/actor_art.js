// 生成式角色原画：共享透明图集，几何回退不影响碰撞/网络状态。
import * as THREE from 'three';
import { ENEMY_TYPES } from './config.js';

const FILES = { player: 'player-interceptor-v1.png', swarm: 'enemy-swarm-atlas-v1.png', boss: 'boss-overlord-v1.png' };
// 图集原图 1254²。按实际透明边界取 UV，避免生成图的非等距排版切到相邻角色。
const RECTS = {
  chaser: [47, 23, 338, 371], speeder: [477, 15, 300, 377], splitter: [881, 16, 317, 383],
  mini: [94, 468, 243, 297], shooter: [486, 394, 283, 386], tank: [839, 421, 401, 382],
  bomber: [70, 861, 291, 303], hunter: [515, 790, 225, 441], weaver: [845, 806, 388, 405],
};
const assets = new Map();
const geometries = new Map();
const up = new THREE.Vector3(0, 1, 0);
const heading = new THREE.Quaternion();
const markerGeometry = new THREE.RingGeometry(0.85, 0.94, 32);
markerGeometry.rotateX(-Math.PI / 2);

function asset(key) {
  if (assets.has(key)) return assets.get(key);
  const entry = { state: 'loading', callbacks: new Set(), texture: null };
  assets.set(key, entry);
  entry.texture = new THREE.TextureLoader().load(new URL(`../assets/actors/${FILES[key]}`, import.meta.url).href, () => {
    entry.state = 'ready';
    entry.callbacks.forEach((callback) => callback());
    entry.callbacks.clear();
  }, undefined, () => { entry.state = 'fallback'; entry.callbacks.clear(); });
  entry.texture.colorSpace = THREE.SRGBColorSpace;
  entry.texture.anisotropy = 4;
  entry.texture.name = FILES[key];
  return entry;
}

function geometry(type, size) {
  if (geometries.has(type)) return geometries.get(type);
  const rect = RECTS[type];
  const width = rect ? rect[2] / Math.max(rect[2], rect[3]) : 1;
  const height = rect ? rect[3] / Math.max(rect[2], rect[3]) : 1;
  const geo = new THREE.PlaneGeometry(width * size, height * size);
  if (rect) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (rect[0] + uv.getX(i) * rect[2]) / 1254, 1 - (rect[1] + (1 - uv.getY(i)) * rect[3]) / 1254);
    }
  }
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI); // 图片顶部对应本游戏的 +Z 朝向，随 yaw 转向。
  geometries.set(type, geo);
  return geo;
}

function attach(root, type, size, fallbackMaterials) {
  const entry = asset(type === 'player' || type === 'boss' ? type : 'swarm');
  const mat = new THREE.MeshBasicMaterial({ map: entry.texture, alphaTest: 0.35, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(geometry(type, size), mat);
  mesh.name = `actor-art-${type}`;
  mesh.visible = false;
  mesh.position.y = 0.12;
  root.add(mesh);
  let disposed = false;
  const reveal = () => {
    if (disposed) return;
    fallbackMaterials.forEach((material) => { material.visible = false; });
    mesh.visible = true;
  };
  if (entry.state === 'ready') reveal(); else if (entry.state === 'loading') entry.callbacks.add(reveal);
  return {
    mesh, material: mat,
    get ready() { return mesh.visible && !disposed; },
    dispose() {
      disposed = true;
      entry.callbacks.delete(reveal);
      root.remove(mesh);
      mat.dispose();
      // 图集与几何归页面级缓存所有；队友退房不得释放其他角色正在使用的资源。
    },
  };
}

export function attachShipArt(root, fallbackMaterials, color) {
  const art = attach(root, 'player', 2.5, fallbackMaterials);
  const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.65, depthWrite: false, toneMapped: false,
  }));
  marker.name = 'team-marker';
  marker.position.y = -0.42;
  root.add(marker);
  const dispose = art.dispose;
  art.dispose = () => { dispose(); root.remove(marker); marker.material.dispose(); };
  return art;
}

export function attachEnemyArt(enemy) {
  enemy.art = attach(enemy.mesh, enemy.type, ENEMY_TYPES[enemy.type].radius * 2.6, [enemy.mat]);
  const ring = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
    color: 0xffda69, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false,
  }));
  ring.scale.setScalar(ENEMY_TYPES[enemy.type].radius * 1.35);
  ring.position.y = -0.35;
  ring.visible = false;
  enemy.mesh.add(ring);
  enemy.art.eliteRing = ring;
  enemy.artYaw = 0;
}

export function updateEnemyArt(enemy, vx = enemy.vel.x, vz = enemy.vel.z) {
  const art = enemy.art;
  if (!art?.ready) return;
  if (vx * vx + vz * vz > 0.01) enemy.artYaw = Math.atan2(vx, vz);
  // 几何回退的滚转动画不能让俯视原画翻到侧面；只保留前进朝向和缩放反馈。
  heading.setFromAxisAngle(up, enemy.artYaw);
  art.mesh.quaternion.copy(enemy.mesh.quaternion).invert().multiply(heading);
  art.eliteRing.quaternion.copy(enemy.mesh.quaternion).invert();
  art.eliteRing.visible = enemy.elite;
  const flash = Math.max(0, enemy.flashT) / 0.09;
  const fuse = enemy.fuseT >= 0 ? 0.35 + Math.sin(enemy.fuseT * 42) * 0.3 : 0;
  art.material.color.setRGB(1 + flash * 2 + fuse, 1 + flash * 2, 1 + flash * 2);
}
