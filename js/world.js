// ============ 场景世界：地面 / 围墙 / 星空 / 灯光 ============
import * as THREE from 'three';
import { PALETTE } from './config.js';
import { rand } from './utils.js';

export function buildWorld(scene, arenaSize) {
  const ARENA = arenaSize;
  const root = new THREE.Group();
  scene.add(root);
  // —— 雾与背景 ——
  scene.background = new THREE.Color(PALETTE.bg);
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.013);

  // —— 发光网格地面（Canvas 纹理）——
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = 512;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#04060d';
  ctx.fillRect(0, 0, 512, 512);
  // 细格
  ctx.strokeStyle = 'rgba(22, 62, 96, 0.32)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const p = i * 64 + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(512, p); ctx.stroke();
  }
  // 主格线
  ctx.strokeStyle = 'rgba(46, 230, 255, 0.20)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 510, 510);
  // 交叉点
  ctx.fillStyle = 'rgba(120, 240, 255, 0.35)';
  ctx.fillRect(0, 0, 5, 5); ctx.fillRect(507, 0, 5, 5);
  ctx.fillRect(0, 507, 5, 5); ctx.fillRect(507, 507, 5, 5);

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(ARENA / 4, ARENA / 4);
  tex.anisotropy = 4;
  const groundMat = new THREE.MeshBasicMaterial({ map: tex });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2 + 8, ARENA * 2 + 8), groundMat);
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);

  // 远处黑暗底版（防止看到雾外虚空）
  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshBasicMaterial({ color: PALETTE.bg })
  );
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.2;
  root.add(far);

  // —— 围墙：发光边框 + 立柱 ——
  const wallGroup = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x081826, emissive: PALETTE.gridCenter, emissiveIntensity: 0.28,
    transparent: true, opacity: 0.9, roughness: 0.4, metalness: 0.2,
  });
  const wallGeo = new THREE.BoxGeometry(ARENA * 2 + 1.6, 1.1, 0.5);
  const wallGeo2 = new THREE.BoxGeometry(0.5, 1.1, ARENA * 2 + 1.6);
  const positions = [
    [0, 0.55, -ARENA - 0.4, wallGeo], [0, 0.55, ARENA + 0.4, wallGeo],
    [-ARENA - 0.4, 0.55, 0, wallGeo2], [ARENA + 0.4, 0.55, 0, wallGeo2],
  ];
  for (const [x, y, z, g] of positions) {
    const w = new THREE.Mesh(g, wallMat);
    w.position.set(x, y, z);
    wallGroup.add(w);
  }
  // 顶部能量线
  const railMat = new THREE.MeshBasicMaterial({ color: 0x8ff4ff });
  const railGeo = new THREE.BoxGeometry(ARENA * 2 + 1.6, 0.08, 0.08);
  const railGeo2 = new THREE.BoxGeometry(0.08, 0.08, ARENA * 2 + 1.6);
  const rails = [
    [0, 1.18, -ARENA - 0.4, railGeo], [0, 1.18, ARENA + 0.4, railGeo],
    [-ARENA - 0.4, 1.18, 0, railGeo2], [ARENA + 0.4, 1.18, 0, railGeo2],
  ];
  for (const [x, y, z, g] of rails) {
    const r = new THREE.Mesh(g, railMat);
    r.position.set(x, y, z);
    wallGroup.add(r);
  }
  // 角柱
  const pillarGeo = new THREE.CylinderGeometry(0.55, 0.8, 2.6, 6);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x0d2840, emissive: 0x2ee6ff, emissiveIntensity: 1.4, roughness: 0.5, flatShading: true,
  });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, pillarMat);
    p.position.set(sx * (ARENA + 0.4), 1.3, sz * (ARENA + 0.4));
    wallGroup.add(p);
  }
  root.add(wallGroup);

  // —— 星空 ——
  const starN = 700;
  const starPos = new Float32Array(starN * 3);
  const starCol = new Float32Array(starN * 3);
  const c = new THREE.Color();
  for (let i = 0; i < starN; i++) {
    const a = rand(Math.PI * 2), ph = rand(0.05, Math.PI * 0.48);
    const r = rand(120, 260);
    starPos[i * 3] = Math.cos(a) * Math.cos(ph) * r;
    starPos[i * 3 + 1] = Math.sin(ph) * r * 0.6 + 4;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(ph) * r;
    c.setHSL(rand(0.45, 0.75), rand(0.4, 0.9), rand(0.35, 0.85));
    starCol[i * 3] = c.r; starCol[i * 3 + 1] = c.g; starCol[i * 3 + 2] = c.b;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 1.6, vertexColors: true, sizeAttenuation: true,
    transparent: true, opacity: 0.9, depthWrite: false,
  }));
  root.add(stars);

  // —— 灯光 ——
  root.add(new THREE.AmbientLight(0x8090c0, 0.75));
  const dir = new THREE.DirectionalLight(0xbfe8ff, 1.1);
  dir.position.set(18, 40, 12);
  root.add(dir);

  // —— 中央反应堆装饰（缓慢旋转的能量核心）——
  const reactor = new THREE.Group();
  const coreGeo = new THREE.IcosahedronGeometry(0.9, 1);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x123, emissive: 0x2ee6ff, emissiveIntensity: 2.2, flatShading: true,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  const ringGeo = new THREE.TorusGeometry(1.6, 0.09, 8, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x2ee6ff, transparent: true, opacity: 0.75 });
  const ring1 = new THREE.Mesh(ringGeo, ringMat);
  const ring2 = new THREE.Mesh(ringGeo, ringMat.clone());
  ring2.rotation.x = Math.PI / 2;
  reactor.add(core, ring1, ring2);
  reactor.position.set(0, 1.4, 0);
  root.add(reactor);

  // 地面能量柱标记中心
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x2ee6ff, transparent: true, opacity: 0.10,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 30, 16, 1, true), beamMat);
  beam.position.y = 15;
  root.add(beam);

  let t = 0;
  return {
    root, reactor, stars,
    update(dt) {
      t += dt;
      core.rotation.y += dt * 0.8;
      core.rotation.x += dt * 0.3;
      ring1.rotation.z += dt * 0.5;
      ring2.rotation.z -= dt * 0.35;
      reactor.position.y = 1.4 + Math.sin(t * 1.3) * 0.18;
      coreMat.emissiveIntensity = 1.8 + Math.sin(t * 2.4) * 0.5;
      stars.rotation.y += dt * 0.004;
      beam.material.opacity = 0.07 + Math.sin(t * 1.8) * 0.035;
    },
  };
}
