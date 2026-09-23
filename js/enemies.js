// ============ 敌人：类型 / AI / 生成导演 / Boss ============
import * as THREE from 'three';
import { ENEMY_TYPES, SPAWN_WEIGHTS, SPAWN_COST, DIRECTOR, PALETTE } from './config.js';
import { rand, pick, clamp, dist2 } from './utils.js';
import { attachEnemyArt, updateEnemyArt } from './actor_art.js';

const POOL_SIZES = { chaser: 130, speeder: 90, splitter: 45, mini: 100, shooter: 45, tank: 32, boss: 2, bomber: 70, hunter: 60, weaver: 30 };
const EBULLET_POOL = 320;
const WEB_POOL = 10;

function makeBodyMat(color, intensity = 1.5) {
  return new THREE.MeshStandardMaterial({
    color: 0x140b12, emissive: color, emissiveIntensity: intensity,
    flatShading: true, roughness: 0.4, metalness: 0.2,
  });
}

const GEO_BUILDERS = {
  chaser: () => new THREE.OctahedronGeometry(0.8, 0),
  speeder: () => new THREE.TetrahedronGeometry(0.62, 0),
  splitter: () => new THREE.IcosahedronGeometry(0.95, 0),
  mini: () => new THREE.TetrahedronGeometry(0.45, 0),
  shooter: () => new THREE.DodecahedronGeometry(0.8, 0),
  tank: () => { const g = new THREE.IcosahedronGeometry(1.55, 0); g.scale(1, 0.85, 1); return g; },
  boss: () => new THREE.IcosahedronGeometry(2.5, 1),
  bomber: () => new THREE.SphereGeometry(0.5, 8, 6),
  hunter: () => { const g = new THREE.ConeGeometry(0.5, 1.5, 4); g.rotateX(Math.PI / 2); return g; },
  weaver: () => { const g = new THREE.SphereGeometry(0.8, 6, 4); g.scale(1, 0.75, 1); return g; },
};

export class Enemies {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.list = [];

    // —— 各类敌人池 ——
    for (const type of Object.keys(POOL_SIZES)) {
      const geo = GEO_BUILDERS[type]();
      for (let i = 0; i < POOL_SIZES[type]; i++) {
        const mat = makeBodyMat(PALETTE[type] || 0xff3e6d);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        // Boss 附加外环
        if (type === 'boss') {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(3.4, 0.14, 8, 48),
            new THREE.MeshBasicMaterial({ color: PALETTE.boss, transparent: true, opacity: 0.8 })
          );
          ring.rotation.x = Math.PI / 2.4;
          mesh.add(ring);
          const ring2 = ring.clone();
          ring2.rotation.set(Math.PI / 3, 0.4, 0);
          ring2.scale.setScalar(0.8);
          mesh.add(ring2);
        }
        scene.add(mesh);
        this.list.push({
          netId: this.list.length, generation: 0,
          type, mesh, mat, active: false, dying: false,
          pos: mesh.position, vel: new THREE.Vector3(),
          hp: 1, maxHp: 1, speed: 1, dmg: 1, radius: 1, xp: 1, score: 1, knockRes: 0,
          elite: false, fireT: 0, flashT: 0, popT: 0, phase: 0,
          mode: 'chase', modeT: 0, attackT: 0, chargeDir: new THREE.Vector3(), mark: 0,
          lastBladeHit: -1, wobble: rand(100),
          fuseT: -1, punchT: 0, webT: rand(1, 3), fuseDone: false, spiralT: 0,
          burnT: 0, burnDps: 0, burnAcc: 0,
        });
        attachEnemyArt(this.list[this.list.length - 1]);
      }
    }

    // —— 敌弹池 ——
    const ebGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const ebMat = new THREE.MeshBasicMaterial({
      color: PALETTE.enemyBullet, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.ebullets = [];
    for (let i = 0; i < EBULLET_POOL; i++) {
      const m = new THREE.Mesh(ebGeo, ebMat);
      m.visible = false;
      scene.add(m);
      this.ebullets.push({ mesh: m, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), dmg: 0, life: 0, prevX: 0, prevZ: 0, wallHitFraction: Infinity, retireAfterCollision: false });
    }

    // —— 生成预警圈池 ——
    this.telegraphs = [];
    const tgGeo = new THREE.RingGeometry(0.7, 1, 32);
    for (let i = 0; i < 44; i++) {
      const m = new THREE.Mesh(tgGeo, new THREE.MeshBasicMaterial({
        color: 0xff3e6d, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.telegraphs.push({ mesh: m, active: false, t: 0, dur: 0, type: '', elite: false, isBoss: false });
    }

    // Boss 冲锋预警线
    this.chargeLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.06, 1),
      new THREE.MeshBasicMaterial({ color: 0xff2266, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.chargeLine.visible = false;
    this.chargeTelegraphLeft = 0;
    scene.add(this.chargeLine);

    // —— 蛛网减速区池 ——
    this.webZones = [];
    const webGeo = new THREE.CircleGeometry(1, 26);
    for (let i = 0; i < WEB_POOL; i++) {
      const m = new THREE.Mesh(webGeo, new THREE.MeshBasicMaterial({
        color: PALETTE.webZone, transparent: true, opacity: 0.16,
        blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      // 危险区用双轮廓 + 锯齿边缘，不能与绿色经验拾取物混淆。
      const dangerMat = new THREE.MeshBasicMaterial({ color: PALETTE.webZone, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.75, 32), dangerMat);
      ring.position.z = 0.015;
      m.add(ring);
      const points = [];
      for (let j = 0; j < 48; j++) {
        const a = j / 48 * Math.PI * 2, r = j % 2 ? 0.91 : 1;
        points.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.018));
      }
      const border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: PALETTE.webZone, transparent: true, opacity: 0.95 }));
      m.add(border);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.webZones.push({ mesh: m, active: false, x: 0, z: 0, r: 2.6, t: 0, dur: 6 });
    }
    this.spiralA = 0;

    this.reset();
  }

  reset() {
    for (const e of this.list) { e.active = false; e.mesh.visible = false; }
    for (const b of this.ebullets) { b.active = false; b.mesh.visible = false; }
    for (const t of this.telegraphs) { t.active = false; t.mesh.visible = false; }
    for (const w of this.webZones) { w.active = false; w.mesh.visible = false; }
    this.chargeLine.visible = false;
    this.chargeTelegraphLeft = 0;
    this.spawnT = DIRECTOR.firstSpawnDelay;
    this.spawnBudget = 0;
    this.nextSpawnType = null;
    this.pendingCount = 0;
    this.spawnTargetCursor = 0;
    this.lastSpawnAngle = rand(Math.PI * 2);
    this.bossAt = DIRECTOR.firstBossAt;
    this.bossActive = null;
    this.bossWarned = false;
    this.activeCount = 0;
    this.encircleAt = DIRECTOR.encircleFirst;
  }

  // 玩家站进蛛网区 → 移速系数
  slowFactorAt(x, z) {
    for (const w of this.webZones) {
      if (w.active && dist2(x, z, w.x, w.z) < w.r * w.r) return 0.55;
    }
    return 1;
  }

  dropWeb(x, z) {
    const w = this.webZones.find((q) => !q.active) || this.webZones[0];
    w.active = true; w.x = x; w.z = z; w.t = 0;
    w.r = this.game.planet.shot === 'spore' ? 3.1 : 2.6;
    w.dur = this.game.planet.shot === 'spore' ? 7 : 6;
    const dangerColor = this.game.planet.shot === 'spore' ? 0xffad3d : PALETTE.webZone;
    w.mesh.material.color.setHex(dangerColor);
    for (const marker of w.mesh.children) marker.material.color.setHex(dangerColor);
    w.mesh.position.set(x, 0.1, z);
    w.mesh.visible = true;
    if (this.game.mpIsHost()) this.game.mp.evWeb(x, z);
  }

  // ============ 虫群包围事件 ============
  encircle() {
    const g = this.game;
    const p = g.randomAlivePlayerPos();
    const players = g.alivePlayerPositions();
    const n = Math.min(20, 8 + Math.floor(g.sector * 1.5));
    const hunterOk = this.typeAvailable('hunter', g.time);
    const speederOk = this.typeAvailable('speeder', g.time);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
      const r = rand(16, 19);
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (!g.world.isSpawnClear(x, z, 0.9)) continue;
      if (players.some((q) => dist2(x, z, q.x, q.z) < 12 * 12)) continue;
      const roll = Math.random();
      const type = g.planet.id === 'station'
        ? (hunterOk && roll < 0.3 ? 'hunter' : speederOk && roll < 0.55 ? 'speeder' : 'chaser')
        : this.pickType(g.time);
      if (!this.queueSpawn(type, x, z, false, 1.15)) break;
    }
    g.ui.toast('⚠ 虫群包围 —— 突围！', '#ff5f7a');
    if (g.mpIsHost()) g.mp.evToast('⚠ 虫群包围 —— 突围！', '#ff5f7a');
    g.audio.bossWarn();
    g.addTrauma(0.3);
  }

  // ============ 生成导演 ============
  director(dt) {
    const g = this.game, t = g.time;

    // —— 虫群包围事件 ——
    if (t >= this.encircleAt) {
      this.encircleAt += DIRECTOR.encircleEvery;
      this.encircle();
    }

    // —— Boss 调度 ——
    if (!this.bossWarned && t >= this.bossAt - 3 && !this.bossActive) {
      this.bossWarned = true;
      g.ui.showBossBanner(true);
      if (g.mpIsHost()) g.mp.evToast('⚠ VOID OVERLORD 逼近 ⚠', '#ff2266');
      g.audio.bossWarn();
    }
    if (t >= this.bossAt && !this.bossActive) {
      const pp = g.randomAlivePlayerPos();
      const pos = this.findSpawnPosition(pp, 'boss', 25, 34);
      if (pos && this.queueSpawn('boss', pos.x, pos.z, false, 1.8)) {
        this.bossWarned = false;
        g.ui.showBossBanner(false);
        this.bossAt += DIRECTOR.bossEvery;
      } else {
        // 满载时停止普通预算增长，为 Boss 腾出硬上限中的一个槽位。
        this.spawnBudget = 0;
      }
    }

    // —— 普通生成：预算制波次，带推进 / 高潮 / 喘息，不再指数缩短间隔 ——
    this.spawnT = Math.max(0, this.spawnT - dt);
    const pace = this.paceAt(t);
    if (this.spawnT <= 0) {
      const bossMul = this.bossActive ? 0.55 : 1;
      this.spawnBudget = Math.min(7, this.spawnBudget + dt * pace.rate * bossMul);
      let room = Math.floor(pace.cap - this.activeCount - this.pendingCount);
      let issued = 0;
      while (this.spawnBudget >= 1 && room > 0 && issued < 3) {
        if (!this.spawnOne(t)) break;
        room--;
        issued++;
      }
    }

    // 预警圈推进
    for (const tg of this.telegraphs) {
      if (!tg.active) continue;
      tg.t += dt;
      const f = tg.t / tg.dur;
      if (f >= 1) {
        tg.active = false; tg.mesh.visible = false;
        if (tg.counted) {
          this.pendingCount = Math.max(0, this.pendingCount - 1);
          tg.counted = false;
        }
        // 玩家冲进预警圈时取消本次生成，不把敌人直接刷到战机身上。
        const safe = ENEMY_TYPES[tg.type].radius + 2.2;
        if (!g.alivePlayerPositions().some((p) => dist2(p.x, p.z, tg.mesh.position.x, tg.mesh.position.z) < safe * safe)) {
          this.spawnNow(tg.type, tg.mesh.position.x, tg.mesh.position.z, tg.elite);
        }
        continue;
      }
      const pulse = 0.75 + Math.sin(f * 25) * 0.25;
      tg.mesh.material.opacity = 0.25 + f * 0.65;
      tg.mesh.scale.setScalar((tg.isBoss ? 3.4 : 1.2) * (1.4 - f * 0.4) * pulse);
    }

    // 蛛网区推进
    for (const w of this.webZones) {
      if (!w.active) continue;
      w.t += dt;
      if (w.t >= w.dur) { w.active = false; w.mesh.visible = false; continue; }
      const f = w.t / w.dur;
      w.mesh.scale.setScalar(w.r * (f < 0.12 ? f / 0.12 : 1));
      w.mesh.material.opacity = (0.22 + Math.sin(this.game.time * 4) * 0.06) * (f > 0.8 ? (1 - f) / 0.2 : 1);
    }
  }

  paceAt(t) {
    const g = this.game;
    const within = t % DIRECTOR.waveSeconds;
    const phase = within >= DIRECTOR.respiteAt ? 'respite' : within >= DIRECTOR.surgeAt ? 'surge' : 'advance';
    const phaseMul = phase === 'surge' ? 1.38 : phase === 'respite' ? 0.3 : 1;
    const baseRate = Math.min(DIRECTOR.maxRate, DIRECTOR.baseRate + t * DIRECTOR.rateGrow);
    const rate = baseRate * phaseMul * g.mpSpawnRateScale();
    const cap = Math.min(
      DIRECTOR.maxEnemiesCap,
      (DIRECTOR.maxEnemiesBase + t * DIRECTOR.maxEnemiesGrow) * g.mpCapScale(),
    );
    return { phase, rate, cap };
  }

  spawnRoom() {
    return Math.max(0, Math.floor(this.paceAt(this.game.time).cap) - this.activeCount - this.pendingCount);
  }

  unlockAt(type) { return this.game.planet.unlocks[type] ?? ENEMY_TYPES[type].unlockAt; }

  typeAvailable(type, time) {
    return (this.game.planet.roster || SPAWN_WEIGHTS).some(([ty]) => ty === type) && this.unlockAt(type) <= time;
  }

  pickType(t) {
    const counts = new Map();
    for (const e of this.list) {
      if (e.active && !e.dying) counts.set(e.type, (counts.get(e.type) || 0) + 1);
    }
    const avail = (this.game.planet.roster || SPAWN_WEIGHTS)
      .filter(([ty]) => this.unlockAt(ty) <= t)
      .map(([ty, weight]) => {
        const age = t - this.unlockAt(ty);
        const ramp = ty === 'chaser' ? 1 : clamp(0.2 + age / 42, 0.2, 1);
        const crowded = (counts.get(ty) || 0) > Math.max(5, this.activeCount * 0.32) ? 0.32 : 1;
        return [ty, weight * ramp * crowded];
      });
    let total = 0;
    for (const [, w] of avail) total += w;
    let r = Math.random() * total;
    for (const [ty, w] of avail) { r -= w; if (r <= 0) return ty; }
    return 'chaser';
  }

  spawnOne(t) {
    const g = this.game;
    const type = this.nextSpawnType || (this.nextSpawnType = this.pickType(t));
    const cost = SPAWN_COST[type] || 1;
    if (this.spawnBudget < cost) return false;
    // 玩家轮转而不是随机抽样，联机时压力更均匀。
    const players = g.alivePlayerPositions();
    if (!players.length) return false;
    const p = players[this.spawnTargetCursor++ % players.length];
    const pos = this.findSpawnPosition(p, type);
    if (!pos) return false;
    const eliteRamp = clamp((t - DIRECTOR.eliteAfter) / 120, 0, 1);
    const elite = Math.random() < DIRECTOR.eliteChance * eliteRamp;
    const queued = this.queueSpawn(type, pos.x, pos.z, elite, DIRECTOR.telegraphTime);
    if (queued) { this.spawnBudget -= cost; this.nextSpawnType = null; }
    return queued;
  }

  findSpawnPosition(target, type, minDistance = DIRECTOR.spawnMinDistance, maxDistance = DIRECTOR.spawnMaxDistance) {
    const g = this.game;
    const players = g.alivePlayerPositions();
    const pv = Math.hypot(target.vx || 0, target.vz || 0);
    const useFlank = type !== 'boss' && Math.random() < DIRECTOR.flankChance && pv > 3;
    const flankAngle = Math.atan2(target.vz || 0, target.vx || 0);
    const golden = 2.399963;
    let best = null;
    for (let i = 0; i < 18; i++) {
      const angle = useFlank && i < 5
        ? flankAngle + rand(-0.65, 0.65)
        : this.lastSpawnAngle + golden * (i + 1) + rand(-0.18, 0.18);
      const distance = rand(minDistance, maxDistance);
      const x = target.x + Math.cos(angle) * distance;
      const z = target.z + Math.sin(angle) * distance;
      if (!g.world.isSpawnClear(x, z, ENEMY_TYPES[type].radius)) continue;
      let nearest = Infinity;
      for (const p of players) nearest = Math.min(nearest, Math.sqrt(dist2(x, z, p.x, p.z)));
      const safe = type === 'boss' ? 22 : DIRECTOR.spawnSafeDistance;
      if (nearest < safe) continue;
      const edgeRoom = Math.min(g.arena - Math.abs(x), g.arena - Math.abs(z));
      const score = nearest + Math.min(edgeRoom, 12) * 0.25;
      if (!best || score > best.score) best = { x, z, angle, score };
    }
    if (!best) return null;
    this.lastSpawnAngle = best.angle;
    return best;
  }

  findLocalSpawnPosition(origin, type, baseAngle, minDistance = 5, maxDistance = 8, safeDistance = 7) {
    const g = this.game;
    const players = g.alivePlayerPositions();
    for (let i = 0; i < 7; i++) {
      const angle = baseAngle + i * 0.9;
      const distance = minDistance + (maxDistance - minDistance) * (i / 6);
      const x = origin.x + Math.cos(angle) * distance;
      const z = origin.z + Math.sin(angle) * distance;
      if (!g.world.isSpawnClear(x, z, ENEMY_TYPES[type].radius)) continue;
      if (players.some((p) => dist2(x, z, p.x, p.z) < safeDistance * safeDistance)) continue;
      return { x, z };
    }
    return null;
  }

  queueSpawn(type, x, z, elite, dur) {
    const g = this.game;
    if (this.spawnRoom() <= 0) return false;
    if (!g.world.isSpawnClear(x, z, ENEMY_TYPES[type].radius)) return false;
    const tg = this.telegraphs.find((q) => !q.active);
    if (!tg) return false;
    if (g.mpIsHost()) g.mp.evTelegraph(type, x, z, elite, dur);
    this.pendingCount++;
    tg.active = true; tg.t = 0; tg.dur = dur;
    tg.counted = true;
    tg.type = type; tg.elite = elite; tg.isBoss = type === 'boss';
    tg.mesh.position.set(x, 0.12, z);
    tg.mesh.material.color.setHex(type === 'boss' ? 0xff2266 : elite ? 0xffffff : 0xff3e6d);
    tg.mesh.visible = true;
    return true;
  }

  // 客机：收到生成预警事件
  netTelegraph(type, x, z, elite, dur) {
    const tg = this.telegraphs.find((q) => !q.active);
    if (!tg) return;
    tg.active = true; tg.t = 0; tg.dur = dur;
    tg.counted = false;
    tg.type = type; tg.elite = elite; tg.isBoss = type === 'boss';
    tg.mesh.position.set(x, 0.12, z);
    tg.mesh.material.color.setHex(type === 'boss' ? 0xff2266 : elite ? 0xffffff : 0xff3e6d);
    tg.mesh.visible = true;
  }

  // 客机：按指定池位激活敌人（纯表现，无数值）
  spawnNet(id, type, x, z, elite, generation, damage) {
    const e = this.list[id];
    if (!e || e.type !== type) return;
    const base = ENEMY_TYPES[type];
    e.active = true; e.dying = false;
    e.netActive = true;
    e.generation = generation;
    e.pos.set(x, type === 'boss' ? 2.6 : 0.75, z);
    e.vel.set(0, 0, 0);
    e.netX = x; e.netZ = z; e.netVX = 0; e.netVZ = 0; e.netAge = 0;
    e.radius = base.radius * (elite ? 1.35 : 1);
    e.dmg = Number.isFinite(damage) ? damage : base.dmg;
    e.elite = elite;
    e.hp = e.maxHp = base.hp;
    e.netHpFrac = 1;
    e.flashT = 0; e.popT = 0.22; e.fuseT = -1; e.punchT = 0;
    e.burnT = 0; e.burnDps = 0; e.burnAcc = 0; e.burnSourceId = null; e.lastBladeHit = -Infinity;
    e.mesh.visible = true;
    e.mesh.scale.setScalar(0.15);
    e.mat.emissive.setHex(elite ? 0xffffff : PALETTE[type]);
    e.mat.emissiveIntensity = elite ? 2.2 : 1.5;
    if (type === 'boss') this.bossActive = e;
  }

  spawnNow(type, x, z, elite) {
    if (this.spawnRoom() <= 0) return null;
    const e = this.list.find((q) => !q.active && q.type === type);
    if (!e) return;
    const base = ENEMY_TYPES[type];
    const t = this.game.time;
    const mpHp = this.game.mpHpScale ? this.game.mpHpScale() : 1;
    const hpMul = (type === 'boss' ? 1 + 0.55 * this.bossMark() : Math.min(3.1, 1 + t / 155)) * mpHp;
    const spdMul = Math.min(1.28, 1 + t / 1100);
    const dmgMul = Math.min(1.42, 1 + t / 680);
    e.active = true; e.dying = false;
    e.generation++;
    e.pos.set(x, type === 'boss' ? 2.6 : 0.75, z);
    e.vel.set(0, 0, 0);
    e.maxHp = e.hp = Math.round(base.hp * hpMul * (elite ? 3.2 : 1));
    e.speed = base.speed * spdMul * (elite ? 1.12 : 1) * rand(0.92, 1.08);
    e.dmg = Math.round(base.dmg * dmgMul * (elite ? 1.45 : 1));
    e.radius = base.radius * (elite ? 1.35 : 1);
    e.xp = base.xp * (elite ? 4 : 1);
    e.score = base.score * (elite ? 4 : 1);
    e.knockRes = base.knockRes;
    e.elite = elite;
    e.fireT = rand(1, 2.4);
    e.flashT = 0;
    e.popT = 0.22;
    e.fuseT = -1;
    e.punchT = 0;
    e.webT = rand(1.5, 3);
    e.fuseDone = false;
    e.spiralT = 0;
    e.burnT = 0; e.burnDps = 0; e.burnAcc = 0; e.burnSourceId = null; e.lastBladeHit = -Infinity;
    e.mode = 'chase'; e.modeT = 0; e.attackT = 2.2;
    e.mesh.visible = true;
    e.mesh.scale.setScalar(0.15);
    e.mat.emissive.setHex(elite ? 0xffffff : PALETTE[type]);
    e.mat.emissiveIntensity = elite ? 2.2 : type === 'shooter' ? 1.1 : 1.5;
    this.game.world.resolveCircle(e.pos, e.radius, e.vel);
    e.pos.x = clamp(e.pos.x, -this.game.arena + 0.3, this.game.arena - 0.3);
    e.pos.z = clamp(e.pos.z, -this.game.arena + 0.3, this.game.arena - 0.3);
    if (type === 'boss') {
      this.bossActive = e;
      e.mark = this.bossMark();
      this.game.ui.setBossHp(1, e.mark);
      this.game.addTrauma(0.5);
      this.game.shockwaves.fire(x, z, 8, PALETTE.boss, 0.8);
      this.game.particles.burst(x, 1, z, 50, PALETTE.boss, { speed: 14, life: 0.9, size: 0.9 });
    }
    this.activeCount++;
    if (this.game.mpIsHost()) this.game.mp.evSpawn(e, e.netId);
    return e;
  }

  bossMark() { return Math.max(0, Math.round((this.game.time - DIRECTOR.firstBossAt) / DIRECTOR.bossEvery)); }

  // 主客机公用：保留完整轨迹供 Game 按墙面与玩家的先后顺序结算。
  updateProjectiles(dt) {
    const g = this.game;
    for (const b of this.ebullets) {
      if (!b.active) continue;
      if (b.retireAfterCollision) { b.active = false; b.mesh.visible = false; continue; }
      b.prevX = b.pos.x; b.prevZ = b.pos.z;
      const step = Math.min(dt, Math.max(0, b.life));
      b.life -= dt;
      b.pos.addScaledVector(b.vel, step);
      b.wallHitFraction = g.world.projectileHitFraction(b.prevX, b.prevZ, b.pos.x, b.pos.z, 0.22);
      b.retireAfterCollision = b.wallHitFraction <= 1 || b.life <= 0
        || Math.abs(b.pos.x) > g.arena + 2 || Math.abs(b.pos.z) > g.arena + 2;
      const t = Math.min(1, b.wallHitFraction);
      b.mesh.position.set(b.prevX + (b.pos.x - b.prevX) * t, b.pos.y, b.prevZ + (b.pos.z - b.prevZ) * t);
      b.mesh.scale.setScalar(1 + Math.sin(g.time * 14 + b.pos.x) * 0.18);
    }
  }

  setChargeTelegraph(x, z, dx, dz, left = 0.75) {
    this.chargeTelegraphLeft = left;
    this.chargeLine.visible = left > 0;
    this.chargeLine.material.opacity = 0.65;
    this.chargeLine.position.set(x + dx * 10.54, 0.3, z + dz * 10.54);
    this.chargeLine.scale.set(1, 1, 21.08);
    this.chargeLine.lookAt(x + dx * 21.08, 0.3, z + dz * 21.08);
  }

  tickChargeTelegraph(dt) {
    this.chargeTelegraphLeft = Math.max(0, this.chargeTelegraphLeft - dt);
    this.chargeLine.visible = this.chargeTelegraphLeft > 0;
    this.chargeLine.material.opacity = 0.45 + 0.3 * (1 - this.chargeTelegraphLeft / 0.75);
  }

  // ============ 每帧更新 ============
  update(dt) {
    const g = this.game, p = g.player;
    this.director(dt);

    this.updateProjectiles(dt);

    for (const e of this.list) {
      if (!e.active) continue;

      // 出生弹出动画
      if (e.popT > 0) {
        e.popT -= dt;
        const f = 1 - Math.max(0, e.popT) / 0.22;
        const s = (e.elite ? 1.35 : 1) * (0.15 + 0.85 * (1 - Math.pow(1 - f, 3)));
        e.mesh.scale.setScalar(s);
      }

      // 受击闪白衰减 + 挤压回弹
      if (e.flashT > 0) {
        e.flashT -= dt;
        e.mat.emissiveIntensity = 1.5 + (e.flashT / 0.09) * 3;
      }
      if (e.punchT > 0) e.punchT -= dt;

      // DoT 只累计仍然点燃的时间，末帧结清小数伤害并清掉过期强度。
      if (e.burnT > 0) {
        const activeDt = Math.min(dt, e.burnT);
        e.burnT = Math.max(0, e.burnT - dt);
        e.burnAcc += e.burnDps * activeDt;
        const tick = e.burnT === 0 ? e.burnAcc : Math.floor(e.burnAcc);
        if (tick > 0) {
          e.burnAcc = Math.max(0, e.burnAcc - tick);
          g.recordDamage?.(e.burnSourceId, 'burn', Math.min(e.hp, tick));
          e.hp -= tick;
        }
        const sourceId = e.burnSourceId;
        if (e.burnT === 0) { e.burnDps = 0; e.burnAcc = 0; e.burnSourceId = null; }
        if (e.hp <= 0) { g.killEnemy(e, { damageKind: 'burn', sourceId }); continue; }
        if (e.burnT > 0 && Math.random() < activeDt * 7) {
          g.particles.spawn(e.pos.x + rand(-0.4, 0.4), 1, e.pos.z + rand(-0.4, 0.4), 0, 1.5, 0, 0.35, 0.7, 0xff7a3e, 2, 0);
        }
      }

      switch (e.type) {
        case 'chaser': case 'mini': case 'tank':
          this.seekPlayer(e, dt, 1);
          break;
        case 'speeder': {
          this.seekPlayer(e, dt, 1);
          // 蛇形突进
          const w = Math.sin(g.time * 5 + e.wobble) * 3;
          e.pos.x += Math.cos(e.wobble + g.time) * w * dt;
          break;
        }
        case 'splitter':
          this.seekPlayer(e, dt, 0.9);
          e.mesh.rotation.x += dt * 1.2;
          break;
        case 'shooter':
          this.updateShooter(e, dt);
          break;
        case 'hunter':
          this.updateHunter(e, dt);
          break;
        case 'weaver':
          this.updateWeaver(e, dt);
          break;
        case 'bomber':
          this.updateBomber(e, dt);
          break;
        case 'boss':
          this.updateBoss(e, dt);
          break;
      }

      // 积分位置 + 边界
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      e.pos.x = clamp(e.pos.x, -this.game.arena + 0.3, this.game.arena - 0.3);
      e.pos.z = clamp(e.pos.z, -this.game.arena + 0.3, this.game.arena - 0.3);
      this.game.world.resolveCircle(e.pos, e.radius, e.vel);

      // 旋转/脉动动画（含受击挤压）
      if (e.type !== 'boss') {
        e.mesh.rotation.y += dt * (1 + e.wobble % 2);
        const puls = 1 + Math.sin(g.time * 4 + e.wobble) * 0.05;
        const punch = e.punchT > 0 ? 1 + 0.3 * (e.punchT / 0.14) : 1;
        // 自爆蜂引信闪烁
        const fuse = e.fuseT >= 0 ? 1 + Math.sin(g.time * 40) * 0.22 : 1;
        if (e.popT <= 0) e.mesh.scale.setScalar((e.elite ? 1.35 : 1) * puls * punch * fuse);
        // 猎手朝向飞行方向
        if (e.type === 'hunter' && (e.vel.x || e.vel.z)) {
          e.mesh.rotation.y = Math.atan2(e.vel.x, e.vel.z);
        }
      }

      // 击退衰减
      updateEnemyArt(e);
      e.vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
    }

    // 同类分离（防止完全重叠）
    this.separate(dt);
    // 分离可能把实体重新推入掩体或围墙，最后统一稳定一次位置。
    for (const e of this.list) {
      if (!e.active) continue;
      this.game.world.resolveCircle(e.pos, e.radius, e.vel);
      e.pos.x = clamp(e.pos.x, -this.game.arena + 0.3, this.game.arena - 0.3);
      e.pos.z = clamp(e.pos.z, -this.game.arena + 0.3, this.game.arena - 0.3);
    }
  }

  seekPlayer(e, dt, mul) {
    const t = this.game.playerTarget(e.pos.x, e.pos.z);
    const dx = t.x - e.pos.x, dz = t.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const steer = this.game.world.steerAround(e.pos.x, e.pos.z, dx / d, dz / d, e.radius, e.netId);
    e.vel.x += steer.x * e.speed * mul * 3.2 * dt;
    e.vel.z += steer.z * e.speed * mul * 3.2 * dt;
    // 限速
    const v = Math.hypot(e.vel.x, e.vel.z);
    const maxV = e.speed * mul;
    if (v > maxV) { e.vel.x = e.vel.x / v * maxV; e.vel.z = e.vel.z / v * maxV; }
  }

  updateShooter(e, dt) {
    const g = this.game;
    const base = ENEMY_TYPES.shooter;
    const t = g.playerTarget(e.pos.x, e.pos.z);
    const dx = t.x - e.pos.x, dz = t.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    let mx = 0, mz = 0;
    if (d > base.keepMax) { mx = dx / d; mz = dz / d; }
    else if (d < base.keepMin) { mx = -dx / d; mz = -dz / d; }
    else { mx = -dz / d * 0.6; mz = dx / d * 0.6; }  // 环绕
    const steer = g.world.steerAround(e.pos.x, e.pos.z, mx, mz, e.radius, e.netId);
    e.vel.x += steer.x * e.speed * 3 * dt;
    e.vel.z += steer.z * e.speed * 3 * dt;
    const v = Math.hypot(e.vel.x, e.vel.z);
    if (v > e.speed) { e.vel.x = e.vel.x / v * e.speed; e.vel.z = e.vel.z / v * e.speed; }

    // 开火
    e.fireT -= dt;
    if (e.fireT <= 0 && d < 26) {
      e.fireT = base.fireCd * rand(0.85, 1.15);
      const shot = g.planet.shot;
      const aim = Math.atan2(dx, dz);
      if (shot === 'fan') {
        e.fireT *= 1.25;
        for (const offset of [-0.22, 0, 0.22]) this.fireEBullet(e.pos.x, e.pos.z, Math.sin(aim + offset), Math.cos(aim + offset), 13, e.dmg * 0.75);
      } else if (shot === 'heavy') {
        e.fireT *= 1.2;
        for (const offset of [-0.08, 0.08]) this.fireEBullet(e.pos.x, e.pos.z, Math.sin(aim + offset), Math.cos(aim + offset), 10, e.dmg * 1.25);
      } else if (shot === 'spore') {
        e.fireT *= 1.35;
        this.fireEBullet(e.pos.x, e.pos.z, dx / d, dz / d, 11, e.dmg);
        this.dropWeb(e.pos.x, e.pos.z);
      } else this.fireEBullet(e.pos.x, e.pos.z, dx / d, dz / d, base.bulletSpeed, e.dmg);
      e.flashT = 0.09;
      g.particles.burst(e.pos.x, 0.8, e.pos.z, 4, PALETTE.shooter, { speed: 3, life: 0.25, size: 0.5 });
    }
  }

  // ============ 新敌人 AI ============
  // 猎手：预判走位拦截
  updateHunter(e, dt) {
    const base = ENEMY_TYPES.hunter;
    const t = this.game.playerTarget(e.pos.x, e.pos.z);
    const tx = t.x + t.vx * base.lead;
    const tz = t.z + t.vz * base.lead;
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const steer = this.game.world.steerAround(e.pos.x, e.pos.z, dx / d, dz / d, e.radius, e.netId);
    e.vel.x += steer.x * e.speed * 3.4 * dt;
    e.vel.z += steer.z * e.speed * 3.4 * dt;
    const v = Math.hypot(e.vel.x, e.vel.z);
    const maxV = e.speed;
    if (v > maxV) { e.vel.x = e.vel.x / v * maxV; e.vel.z = e.vel.z / v * maxV; }
  }

  // 织网者：保持距离，铺减速蛛网
  updateWeaver(e, dt) {
    const g = this.game;
    const base = ENEMY_TYPES.weaver;
    const t = g.playerTarget(e.pos.x, e.pos.z);
    const dx = t.x - e.pos.x, dz = t.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    let mx = 0, mz = 0;
    if (d > base.keepMax) { mx = dx / d; mz = dz / d; }
    else if (d < base.keepMin) { mx = -dx / d; mz = -dz / d; }
    else { mx = dz / d * 0.5; mz = -dx / d * 0.5; }
    const steer = g.world.steerAround(e.pos.x, e.pos.z, mx, mz, e.radius, e.netId);
    e.vel.x += steer.x * e.speed * 3 * dt;
    e.vel.z += steer.z * e.speed * 3 * dt;
    const v = Math.hypot(e.vel.x, e.vel.z);
    if (v > e.speed) { e.vel.x = e.vel.x / v * e.speed; e.vel.z = e.vel.z / v * e.speed; }
    e.webT -= dt;
    if (e.webT <= 0 && d < 20) {
      e.webT = base.webCd * rand(0.85, 1.15);
      this.dropWeb(e.pos.x, e.pos.z);
      g.particles.burst(e.pos.x, 0.5, e.pos.z, 6, PALETTE.weaver, { speed: 3, life: 0.4, size: 0.5 });
    }
  }

  // 自爆蜂：高速贴近 → 引信 → 殉爆
  updateBomber(e, dt) {
    const g = this.game;
    if (e.fuseT >= 0) {
      e.fuseT -= dt;
      e.vel.multiplyScalar(Math.max(0, 1 - 8 * dt));
      e.mat.emissiveIntensity = 2 + Math.sin(g.time * 42) * 2;
      if (e.fuseT <= 0) {
        this.bomberBlast(e, true);
      }
      return;
    }
    this.seekPlayer(e, dt, 1.15);
    const t = g.playerTarget(e.pos.x, e.pos.z);
    const d2 = dist2(e.pos.x, e.pos.z, t.x, t.z);
    if (d2 < 2.6 * 2.6) {
      e.fuseT = ENEMY_TYPES.bomber.fuseTime;
      g.audio.fuseBeep();
    }
  }

  // 自爆：hurtsPlayer=true 为近身引爆（伤玩家）；被击杀引爆只伤敌人（连锁反应奖励）
  bomberBlast(e, hurtsPlayer) {
    const g = this.game;
    const base = ENEMY_TYPES.bomber;
    if (e.dying || e.fuseDone) return;
    e.fuseDone = true;
    // 伤及周围敌人（殉爆连锁）
    g.areaDamage(e.pos.x, e.pos.z, base.blastR, 30, { knock: 10, fromX: e.pos.x, fromZ: e.pos.z });
    if (hurtsPlayer) {
      const rr = base.blastR + g.player.radius;
      if (dist2(e.pos.x, e.pos.z, g.player.pos.x, g.player.pos.z) < rr * rr) {
        const dealt = g.player.takeDamage(base.blastDmg, g, '自爆蜂');
        if (dealt === 'shield') g.onShieldBreak();
        else if (dealt !== false) g.onPlayerHurt(dealt, e.pos.x, e.pos.z);
      }
      // 联机：通知客机自检爆炸半径
      if (g.mpIsHost()) g.mp.send({ k: 'blast', x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1), r: base.blastR, dmg: base.blastDmg });
      if (g.planet.shot === 'heavy') {
        // 仅引信引爆产生爆片；击杀蜂群仍是安全的连锁奖励。
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          this.fireEBullet(e.pos.x, e.pos.z, Math.sin(a), Math.cos(a), 9, 7);
        }
      }
    }
    g.particles.burst(e.pos.x, 0.6, e.pos.z, 26, 0xff5f2e, { speed: 12, life: 0.6, size: 0.8 });
    g.particles.burst(e.pos.x, 0.6, e.pos.z, 10, 0xffe93e, { speed: 7, life: 0.4, size: 0.6 });
    g.shockwaves.fire(e.pos.x, e.pos.z, base.blastR, 0xff5f2e, 0.45);
    g.audio.explode();
    g.addTrauma(0.25);
    g.killEnemy(e);
  }

  // ============ Boss ============
  updateBoss(e, dt) {
    const g = this.game;
    const frac = e.hp / e.maxHp;
    const phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    e.phase = phase;
    g.ui.setBossHp(frac, e.mark);

    // 环旋转
    e.mesh.rotation.y += dt * 0.6;
    if (e.mesh.children[0]) e.mesh.children[0].rotation.z += dt * (0.5 + phase * 0.3);
    if (e.mesh.children[1]) e.mesh.children[1].rotation.x += dt * 0.7;

    const t0 = g.playerTarget(e.pos.x, e.pos.z);
    const dx = t0.x - e.pos.x, dz = t0.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;

    if (e.mode === 'windup') {
      e.vel.set(0, 0, 0);
      e.modeT = Math.max(0, e.modeT - dt);
      this.tickChargeTelegraph(dt);
      // 本帧仍然静止，确保至少完整 0.75 秒预警后才开始移动。
      if (e.modeT <= 1e-8) { e.mode = 'charge'; e.modeT = 0.62; this.chargeLine.visible = false; }
      return;
    }

    if (e.mode === 'charge') {
      e.modeT -= dt;
      e.vel.copy(e.chargeDir).multiplyScalar(34);
      if (e.modeT <= 0 || Math.abs(e.pos.x) > this.game.arena - 2 || Math.abs(e.pos.z) > this.game.arena - 2) {
        e.mode = 'chase'; e.vel.multiplyScalar(0.1);
        this.chargeLine.visible = false;
        g.addTrauma(0.4);
        g.shockwaves.fire(e.pos.x, e.pos.z, 5, PALETTE.boss, 0.5);
        g.audio.explode(true);
      }
      // 冲锋尾迹
      g.particles.spawn(e.pos.x, 1, e.pos.z, rand(-3, 3), rand(0, 3), rand(-3, 3), 0.4, 1.4, PALETTE.boss, 3, 0);
      return;
    }

    // 缓慢逼近
    this.seekPlayer(e, dt, 0.8);

    // MK.II 起追加螺旋弹幕
    if (e.mark >= 1) {
      e.spiralT = (e.spiralT || 0) - dt;
      if (e.spiralT <= 0) {
        e.spiralT = 0.16;
        this.spiralA += 0.42;
        this.fireEBullet(e.pos.x, e.pos.z, Math.sin(this.spiralA), Math.cos(this.spiralA), 9, e.dmg * 0.5);
        this.fireEBullet(e.pos.x, e.pos.z, Math.sin(this.spiralA + Math.PI), Math.cos(this.spiralA + Math.PI), 9, e.dmg * 0.5);
      }
    }

    e.attackT -= dt;
    if (e.attackT > 0) return;
    const attacks = g.planet.shot === 'fan' ? ['fan', 'fan', 'charge', 'radial']
      : g.planet.shot === 'heavy' ? ['radial', 'charge', 'summon']
      : g.planet.shot === 'spore' ? ['spores', 'summon', 'fan']
      : phase === 1 ? ['radial', 'fan', 'summon'] : phase === 2 ? ['radial', 'fan', 'charge', 'summon'] : ['radial', 'charge', 'fan', 'charge'];
    const atk = pick(attacks);
    e.attackT = (phase === 1 ? 3.4 : phase === 2 ? 2.7 : 2.1) * rand(0.9, 1.1);

    if (atk === 'spores') {
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + g.time * 0.2;
        this.dropWeb(e.pos.x + Math.cos(a) * 5, e.pos.z + Math.sin(a) * 5);
      }
      g.audio.nova();
    } else if (atk === 'radial') {
      const n = 14 + phase * 4;
      const off = rand(Math.PI * 2);
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        this.fireEBullet(e.pos.x, e.pos.z, Math.sin(a), Math.cos(a), 10.5, e.dmg * 0.6);
      }
      g.audio.explode(true);
      g.addTrauma(0.3);
      e.flashT = 0.09;
    } else if (atk === 'fan') {
      const base = Math.atan2(dx, dz);
      for (let i = -3; i <= 3; i++) {
        const a = base + i * 0.16;
        this.fireEBullet(e.pos.x, e.pos.z, Math.sin(a), Math.cos(a), 16, e.dmg * 0.7);
      }
      g.audio.missile();
      e.flashT = 0.09;
    } else if (atk === 'charge') {
      e.mode = 'windup';
      e.modeT = 0.75;
      e.vel.set(0, 0, 0);
      e.chargeDir.set(dx / d, 0, dz / d);
      this.setChargeTelegraph(e.pos.x, e.pos.z, e.chargeDir.x, e.chargeDir.z, e.modeT);
      if (g.mpIsHost()) g.mp.send({ k: 'bossWindup', x: e.pos.x, z: e.pos.z, dx: e.chargeDir.x, dz: e.chargeDir.z, left: e.modeT });
      g.audio.bossWarn();
    } else if (atk === 'summon') {
      const n = 3 + phase;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const type = g.planet.id === 'station'
          ? (phase >= 2 && i % 2 === 0 ? 'speeder' : 'chaser')
          : g.planet.summons[i % g.planet.summons.length];
        const pos = this.findLocalSpawnPosition(e.pos, type, a);
        if (pos) this.queueSpawn(type, pos.x, pos.z, false, 0.7);
      }
      e.flashT = 0.09;
      g.audio.nova();
    }
  }

  fireEBullet(x, z, dx, dz, speed, dmg) {
    const b = this.ebullets.find((q) => !q.active);
    if (!b) return;
    b.active = true;
    b.pos.set(x, 0.75, z);
    b.vel.set(dx * speed, 0, dz * speed);
    b.dmg = dmg;
    b.mesh.material.color.setHex(this.game.planet.id === 'station' ? PALETTE.enemyBullet : this.game.planet.accent);
    b.life = 6;
    b.prevX = x; b.prevZ = z; b.wallHitFraction = Infinity; b.retireAfterCollision = false;
    b.mesh.visible = true;
    b.mesh.position.copy(b.pos);
    if (this.game.mpIsHost()) this.game.mp.evEBullet(x, z, dx, dz, speed, dmg);
  }

  clearEBullets() {
    let n = 0;
    for (const b of this.ebullets) {
      if (!b.active) continue;
      b.active = false; b.mesh.visible = false;
      this.game.particles.burst(b.pos.x, 0.7, b.pos.z, 3, PALETTE.enemyBullet, { speed: 3, life: 0.3, size: 0.5 });
      n++;
    }
    return n;
  }

  // ============ 分离 ============
  separate(dt) {
    const hash = this.game.enemyHash;
    const buf = this._sepBuf || (this._sepBuf = new Array(24));
    for (const e of this.list) {
      if (!e.active || e.type === 'boss') continue;
      const cnt = hash.query(e.pos.x, e.pos.z, e.radius + 1.2, buf);
      for (let i = 0; i < cnt; i++) {
        const o = buf[i];
        if (o === e || !o.active) continue;
        const rr = (e.radius + o.radius) * 0.9;
        const d2 = dist2(e.pos.x, e.pos.z, o.pos.x, o.pos.z);
        if (d2 < rr * rr && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (rr - d) / rr * 6 * dt;
          const nx = (e.pos.x - o.pos.x) / d, nz = (e.pos.z - o.pos.z) / d;
          e.pos.x += nx * push; e.pos.z += nz * push;
        }
      }
    }
  }

  // 敌人死亡入口（由 game.damageEnemy 调用）
  onDeath(e) {
    const g = this.game;
    e.active = false;
    e.mesh.visible = false;
    this.activeCount--;
    if (g.mpIsHost()) g.mp.evDeath(e, e.netId);
    if (e.type === 'splitter') {
      for (let i = 0; i < 3; i++) {
        const a = rand(Math.PI * 2);
        const m = this.spawnNow('mini', e.pos.x + Math.cos(a) * 0.8, e.pos.z + Math.sin(a) * 0.8, false);
        if (m) { m.vel.set(Math.cos(a) * 8, 0, Math.sin(a) * 8); m.popT = 0.1; }
      }
    }
    if (e.type === 'boss') {
      this.bossActive = null;
      this.chargeTelegraphLeft = 0; this.chargeLine.visible = false;
      g.ui.setBossHp(-1);
      g.onBossDown(e);
    }
  }
}
