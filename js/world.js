// ============ 场景世界：能源设施 / 掩体 / 放电通道 / 围墙 ============
import * as THREE from 'three';
import { PALETTE } from './config.js';
import { rand } from './utils.js';
import { createWorldTextures } from './world_textures.js';

export function buildWorld(scene, arenaSize) {
  const ARENA = arenaSize;
  const textures = createWorldTextures(ARENA * 2 + 8);
  const root = new THREE.Group();
  scene.add(root);
  // —— 雾与背景 ——
  scene.background = new THREE.Color(PALETTE.bg);
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.013);

  // —— 合金甲板：生成式美术贴图，Canvas 网格作为加载与断网回退 ——
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
  textures.bind(groundMat, 'floor', { color: 0x8399b0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2 + 8, ARENA * 2 + 8), groundMat);
  ground.name = 'alloy-floor';
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

  // —— 中央设施地台与能源管线（不阻挡移动）——
  const facility = new THREE.Group();
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x08121f, emissive: 0x123d55, emissiveIntensity: 0.45,
    roughness: 0.72, metalness: 0.35,
  });
  const deckTopMat = deckMat.clone();
  textures.bind(deckTopMat, 'reactor', { color: 0xb0c2d0, emissiveIntensity: 0.12 });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.7, 0.18, 64), [deckMat, deckTopMat, deckMat]);
  deck.name = 'reactor-deck';
  deck.position.y = 0.08;
  facility.add(deck);
  const deckRingMat = new THREE.MeshBasicMaterial({
    color: 0x2ee6ff, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const radius of [5.2, 7.7]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.07, radius + 0.07, 64), deckRingMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.19;
    facility.add(ring);
  }
  const conduitMat = new THREE.MeshBasicMaterial({
    color: 0x167a9f, transparent: true, opacity: 0.46,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const conduitLen = Math.max(10, ARENA - 10);
  const conduitGeo = new THREE.BoxGeometry(0.16, 0.035, conduitLen);
  for (let i = 0; i < 4; i++) {
    const lane = new THREE.Mesh(conduitGeo, conduitMat);
    lane.rotation.y = i * Math.PI / 2;
    lane.position.set(Math.sin(i * Math.PI / 2) * (conduitLen / 2 + 7.5), 0.09, Math.cos(i * Math.PI / 2) * (conduitLen / 2 + 7.5));
    facility.add(lane);
  }
  root.add(facility);

  // —— 八个战术掩体：四根反应堆立柱 + 四组能量路障 ——
  const coverRing = Math.min(13.5, ARENA * 0.38);
  const barrierRing = Math.min(26, ARENA * 0.73);
  const colliders = [];
  const coverMeshes = [];
  const coverMat = new THREE.MeshStandardMaterial({
    color: 0x0a1b2b, emissive: 0x245e78, emissiveIntensity: 0.55,
    roughness: 0.45, metalness: 0.55, flatShading: true,
  });
  textures.bind(coverMat, 'hull', { color: 0xb3c9d7, emissiveIntensity: 0.16 });
  const coverGlow = new THREE.MeshBasicMaterial({
    color: 0x55eaff, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pylonGeo = new THREE.CylinderGeometry(1.35, 1.7, 3.8, 8);
  const pylonCapGeo = new THREE.CylinderGeometry(0.78, 1.05, 0.38, 8);
  const pylonRingGeo = new THREE.TorusGeometry(1.18, 0.09, 6, 24);
  const pylonPositions = [
    [-coverRing, -coverRing], [coverRing, -coverRing],
    [-coverRing, coverRing], [coverRing, coverRing],
  ];
  for (const [x, z] of pylonPositions) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(pylonGeo, coverMat);
    body.position.y = 1.9;
    const cap = new THREE.Mesh(pylonCapGeo, coverGlow.clone());
    cap.position.y = 3.85;
    const ring = new THREE.Mesh(pylonRingGeo, coverGlow.clone());
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.15;
    group.add(body, cap, ring);
    group.position.set(x, 0, z);
    root.add(group);
    coverMeshes.push(group);
    colliders.push({ x, z, r: 1.7, kind: 'pylon' });
  }

  const barrierPositions = [
    [-barrierRing, 0, 0], [barrierRing, 0, 0],
    [0, -barrierRing, Math.PI / 2], [0, barrierRing, Math.PI / 2],
  ];
  const barrierGeo = new THREE.CylinderGeometry(3, 3, 1.55, 10);
  const barrierInsetGeo = new THREE.TorusGeometry(2.45, 0.11, 6, 28);
  for (const [x, z, rot] of barrierPositions) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(barrierGeo, coverMat);
    body.position.y = 0.78;
    const strip = new THREE.Mesh(barrierInsetGeo, coverGlow.clone());
    strip.position.y = 1.58;
    strip.rotation.x = Math.PI / 2;
    group.add(body, strip);
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    root.add(group);
    coverMeshes.push(group);
    group.userData.collisionRadius = 3;
    colliders.push({ x, z, r: 3.0, kind: 'barrier' });
  }

  // —— 外围能源站、货箱与信标：InstancedMesh 控制 draw call ——
  const stationAt = Math.max(24, ARENA - 13);
  const stationGeo = new THREE.BoxGeometry(4.8, 2.6, 4.8);
  const stationMat = new THREE.MeshStandardMaterial({
    color: 0x071421, emissive: 0x12384e, emissiveIntensity: 0.65,
    roughness: 0.55, metalness: 0.5,
  });
  textures.bind(stationMat, 'hull', { color: 0x94b9cb, emissiveIntensity: 0.18 });
  const stations = new THREE.InstancedMesh(stationGeo, stationMat, 4);
  const stationGlowGeo = new THREE.CylinderGeometry(0.3, 0.42, 5.2, 6);
  const stationGlows = new THREE.InstancedMesh(stationGlowGeo, coverGlow, 4);
  const dummy = new THREE.Object3D();
  const stationPositions = [
    [-stationAt, -stationAt], [stationAt, -stationAt],
    [-stationAt, stationAt], [stationAt, stationAt],
  ];
  stationPositions.forEach(([x, z], i) => {
    dummy.position.set(x, 1.3, z);
    dummy.rotation.y = Math.PI / 4;
    dummy.updateMatrix();
    stations.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 4.1, z);
    dummy.rotation.y = 0;
    dummy.updateMatrix();
    stationGlows.setMatrixAt(i, dummy.matrix);
  });
  root.add(stations, stationGlows);

  const crateGeo = new THREE.BoxGeometry(1.6, 1.25, 1.6);
  const crateMat = new THREE.MeshStandardMaterial({
    color: 0x161c29, emissive: 0xffb32e, emissiveIntensity: 0.22,
    roughness: 0.75, metalness: 0.25,
  });
  textures.bind(crateMat, 'hull', { color: 0xc4b28c, emissiveIntensity: 0.05 });
  const crates = new THREE.InstancedMesh(crateGeo, crateMat, 16);
  for (let i = 0; i < 16; i++) {
    const q = i % 4;
    const base = stationPositions[q];
    const layer = Math.floor(i / 4);
    dummy.position.set(base[0] + (layer % 2 ? 5.2 : -5.2), 0.63, base[1] + (layer < 2 ? 2.8 : -2.8));
    dummy.rotation.y = (i * 0.73) % Math.PI;
    dummy.updateMatrix();
    crates.setMatrixAt(i, dummy.matrix);
  }
  root.add(crates);

  // —— 每三个区域触发一次的双通道放电（75s 首次，之后每 90s）——
  const hazardMat = new THREE.MeshBasicMaterial({
    color: 0xff7a3e, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const hazardFloors = [];
  for (let i = 0; i < 2; i++) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hazardMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.12;
    floor.visible = false;
    root.add(floor);
    hazardFloors.push(floor);
  }
  const hazardInfo = { cycle: -1, phase: 'calm', axis: 0, opacity: 0 };
  function eventAt(time) {
    const firstAt = 75;
    const every = 90;
    if (time < firstAt) return { cycle: -1, phase: 'calm', axis: 0, progress: 0 };
    const elapsed = time - firstAt;
    const cycle = Math.floor(elapsed / every);
    const within = elapsed - cycle * every;
    if (within < 5) return { cycle, phase: 'warning', axis: cycle % 2, progress: within / 5 };
    if (within < 14) return { cycle, phase: 'active', axis: cycle % 2, progress: (within - 5) / 9 };
    return { cycle, phase: 'calm', axis: cycle % 2, progress: 0 };
  }
  function layoutHazards(axis) {
    const offset = Math.min(21, ARENA * 0.31);
    const width = Math.min(11, ARENA * 0.18);
    const length = ARENA * 2 - 5;
    hazardFloors.forEach((floor, i) => {
      const side = i === 0 ? -1 : 1;
      floor.position.x = axis === 0 ? side * offset : 0;
      floor.position.z = axis === 0 ? 0 : side * offset;
      floor.scale.set(axis === 0 ? width : length, axis === 0 ? length : width, 1);
    });
  }

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

  // 可交互区域与装饰明确分层：地面光环不参与碰撞。
  const captureRing = new THREE.Mesh(new THREE.RingGeometry(5.8, 6, 80), new THREE.MeshBasicMaterial({
    color: 0xffd23e, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
  }));
  captureRing.rotation.x = -Math.PI / 2;
  captureRing.position.y = 0.205;
  root.add(captureRing);
  const progressRing = new THREE.Mesh(new THREE.RingGeometry(6.15, 6.38, 80), new THREE.MeshBasicMaterial({
    color: 0x4dff88, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
  }));
  progressRing.rotation.x = -Math.PI / 2;
  progressRing.position.y = 0.21;
  root.add(progressRing);
  const guideMat = new THREE.MeshBasicMaterial({ color: 0x2ee6ff, transparent: true, opacity: 0.24 });
  const guideGeo = new THREE.PlaneGeometry(0.22, 1.3);
  const guides = new THREE.InstancedMesh(guideGeo, guideMat, 4 * Math.max(0, Math.ceil((ARENA - 15) / 4)));
  const guidePose = new THREE.Object3D();
  let guideIndex = 0;
  for (let axis = 0; axis < 4; axis++) {
    const angle = axis * Math.PI / 2;
    for (let d = 10; d < ARENA - 5; d += 4) {
      guidePose.rotation.set(-Math.PI / 2, 0, -angle);
      guidePose.position.set(Math.sin(angle) * d, 0.04, Math.cos(angle) * d);
      guidePose.updateMatrix(); guides.setMatrixAt(guideIndex++, guidePose.matrix);
    }
  }
  root.add(guides);

  let t = 0;
  return {
    root, reactor, stars, facility, colliders, coverMeshes, hazardInfo,
    textureStatus: textures.status,
    isSpawnClear(x, z, radius = 1) {
      if (Math.hypot(x, z) < 8.8 + radius) return false;
      for (const c of colliders) {
        const rr = c.r + radius + 1.4;
        if ((x - c.x) ** 2 + (z - c.z) ** 2 < rr * rr) return false;
      }
      return Math.abs(x) < ARENA - 2 && Math.abs(z) < ARENA - 2;
    },
    blocksProjectile(x, z, radius = 0.15) {
      for (const c of colliders) {
        const rr = c.r + radius;
        if ((x - c.x) ** 2 + (z - c.z) ** 2 < rr * rr) return true;
      }
      return false;
    },
    resolveCircle(position, radius, velocity) {
      let hit = false;
      for (let pass = 0; pass < 2; pass++) {
        for (const c of colliders) {
          let dx = position.x - c.x;
          let dz = position.z - c.z;
          const minD = c.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= minD * minD) continue;
          let d = Math.sqrt(d2);
          if (d < 0.0001) { dx = 1; dz = 0; d = 1; }
          const nx = dx / d, nz = dz / d;
          const push = minD - d + 0.002;
          position.x += nx * push;
          position.z += nz * push;
          if (velocity) {
            const into = velocity.x * nx + velocity.z * nz;
            if (into < 0) {
              velocity.x -= nx * into;
              velocity.z -= nz * into;
            }
          }
          hit = true;
        }
      }
      return hit;
    },
    steerAround(x, z, dx, dz, radius, seed = 0) {
      let sx = dx, sz = dz;
      const dl = Math.hypot(dx, dz) || 1;
      const ux = dx / dl, uz = dz / dl;
      for (const c of colliders) {
        const rx = c.x - x, rz = c.z - z;
        const ahead = rx * ux + rz * uz;
        if (ahead <= 0 || ahead > 8) continue;
        const sideDist = Math.abs(rx * uz - rz * ux);
        const clearance = c.r + radius + 1.2;
        if (sideDist >= clearance) continue;
        const cross = ux * rz - uz * rx;
        const side = Math.abs(cross) > 0.05 ? (cross > 0 ? -1 : 1) : (seed % 2 ? 1 : -1);
        const strength = (1 - sideDist / clearance) * (1 - ahead / 9);
        sx += -uz * side * strength * dl * 1.8;
        sz += ux * side * strength * dl * 1.8;
      }
      const sl = Math.hypot(sx, sz) || 1;
      return { x: sx / sl, z: sz / sl };
    },
    hazardAt(x, z) {
      if (hazardInfo.phase !== 'active') return false;
      const offset = Math.min(21, ARENA * 0.31);
      const halfWidth = Math.min(11, ARENA * 0.18) / 2;
      return hazardInfo.axis === 0
        ? Math.abs(Math.abs(x) - offset) <= halfWidth
        : Math.abs(Math.abs(z) - offset) <= halfWidth;
    },
    update(dt, gameTime = 0, objective) {
      t += dt;
      core.rotation.y += dt * 0.8;
      core.rotation.x += dt * 0.3;
      ring1.rotation.z += dt * 0.5;
      ring2.rotation.z -= dt * 0.35;
      reactor.position.y = 1.4 + Math.sin(t * 1.3) * 0.18;
      coreMat.emissiveIntensity = 1.8 + Math.sin(t * 2.4) * 0.5;
      stars.rotation.y += dt * 0.004;
      beam.material.opacity = 0.07 + Math.sin(t * 1.8) * 0.035;
      const charging = objective?.phase === 'active';
      const boosted = objective?.buffLeft > 0;
      const color = boosted ? 0x4dff88 : charging ? 0xffd23e : 0x2ee6ff;
      coreMat.emissive.setHex(color); ringMat.color.setHex(color); ring2.material.color.setHex(color);
      beamMat.color.setHex(color);
      captureRing.material.color.setHex(color);
      captureRing.material.opacity = charging ? 0.55 + Math.sin(t * 4) * 0.2 : boosted ? 0.5 : 0.12;
      progressRing.visible = charging;
      progressRing.geometry.setDrawRange(0, Math.floor((objective?.charge || 0) / 7 * 80) * 6);
      coverMeshes.forEach((group, i) => {
        const ring = group.children[2] || group.children[1];
        if (ring) ring.material.opacity = 0.58 + Math.sin(t * 2.2 + i) * 0.22;
      });
      const event = eventAt(gameTime);
      hazardInfo.cycle = event.cycle;
      hazardInfo.phase = event.phase;
      hazardInfo.axis = event.axis;
      layoutHazards(event.axis);
      const visible = event.phase !== 'calm';
      const opacity = event.phase === 'warning'
        ? 0.08 + event.progress * 0.2 + Math.sin(t * 12) * 0.04
        : event.phase === 'active' ? 0.36 + Math.sin(t * 20) * 0.12 : 0;
      hazardInfo.opacity = Math.max(0, opacity);
      hazardMat.color.setHex(event.phase === 'active' ? 0xff355d : 0xffb13e);
      hazardMat.opacity = hazardInfo.opacity;
      hazardFloors.forEach((floor) => { floor.visible = visible; });
    },
    dispose() {
      const geometries = new Set();
      const materials = new Set();
      const ownedTextures = new Set([tex]);
      textures.collectForDisposal(ownedTextures);
      root.traverse((obj) => {
        if (obj.geometry) geometries.add(obj.geometry);
        if (Array.isArray(obj.material)) obj.material.forEach((m) => materials.add(m));
        else if (obj.material) materials.add(obj.material);
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => {
        if (m.map) ownedTextures.add(m.map);
        m.dispose();
      });
      ownedTextures.forEach((texture) => texture.dispose());
    },
  };
}
