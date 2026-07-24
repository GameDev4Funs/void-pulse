// ============ 敌人：类型 / AI / 生成导演 / Boss ============
import * as THREE from 'three';
import { ENEMY_TYPES, SPAWN_WEIGHTS, DIRECTOR, PALETTE } from './config.js';
import { rand, pick, clamp, dist2 } from './utils.js';

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
      this.ebullets.push({ mesh: m, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), dmg: 0, life: 0 });
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
    scene.add(this.chargeLine);

    // —— 蛛网减速区池 ——
    this.webZones = [];
    const webGeo = new THREE.CircleGeometry(1, 26);
    for (let i = 0; i < WEB_POOL; i++) {
      const m = new THREE.Mesh(webGeo, new THREE.MeshBasicMaterial({
        color: PALETTE.webZone, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
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
    this.spawnT = 2.2;               // 首次生成延迟
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
    w.mesh.position.set(x, 0.1, z);
    w.mesh.visible = true;
    if (this.game.mpIsHost()) this.game.mp.evWeb(x, z);
  }

  // ============ 虫群包围事件 ============
  encircle() {
    const g = this.game;
    const p = g.randomAlivePlayerPos();
    const n = Math.min(26, 10 + g.sector * 2);
    const hunterOk = g.time >= ENEMY_TYPES.hunter.unlockAt;
    const speederOk = g.time >= ENEMY_TYPES.speeder.unlockAt;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
      const r = rand(9.5, 11);
      const x = clamp(p.x + Math.cos(a) * r, -this.game.arena + 2, this.game.arena - 2);
      const z = clamp(p.z + Math.sin(a) * r, -this.game.arena + 2, this.game.arena - 2);
      const roll = Math.random();
      const type = hunterOk && roll < 0.3 ? 'hunter' : speederOk && roll < 0.55 ? 'speeder' : 'chaser';
      this.queueSpawn(type, x, z, false, 1.15);
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
      this.bossWarned = false;
      g.ui.showBossBanner(false);
      const pp = g.randomAlivePlayerPos();
      const a = rand(Math.PI * 2);
      const px = clamp(pp.x + Math.cos(a) * 16, -this.game.arena + 6, this.game.arena - 6);
      const pz = clamp(pp.z + Math.sin(a) * 16, -this.game.arena + 6, this.game.arena - 6);
      this.queueSpawn('boss', px, pz, false, 1.8);
      this.bossAt += DIRECTOR.bossEvery;
    }

    // —— 普通生成 ——
    const interval = Math.max(DIRECTOR.minInterval, DIRECTOR.startInterval * Math.pow(0.5, t / DIRECTOR.halfLife)) / g.mpSpawnRateScale();
    const cap = Math.min(DIRECTOR.maxEnemiesCap, (DIRECTOR.maxEnemiesBase + t * DIRECTOR.maxEnemiesGrow) * g.mpCapScale());
    this.spawnT -= dt * (this.bossActive ? 0.45 : 1);
    if (this.spawnT <= 0 && this.activeCount < cap) {
      this.spawnT = interval;
      const batch = 1 + Math.floor(t / 80) + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < batch && this.activeCount < cap; i++) {
        this.spawnOne(t);
      }
    }

    // 预警圈推进
    for (const tg of this.telegraphs) {
      if (!tg.active) continue;
      tg.t += dt;
      const f = tg.t / tg.dur;
      if (f >= 1) {
        tg.active = false; tg.mesh.visible = false;
        this.spawnNow(tg.type, tg.mesh.position.x, tg.mesh.position.z, tg.elite);
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

  pickType(t) {
    const avail = SPAWN_WEIGHTS.filter(([ty]) => ENEMY_TYPES[ty].unlockAt <= t);
    let total = 0;
    for (const [, w] of avail) total += w;
    let r = Math.random() * total;
    for (const [ty, w] of avail) { r -= w; if (r <= 0) return ty; }
    return 'chaser';
  }

  spawnOne(t) {
    const g = this.game;
    const type = this.pickType(t);
    // 以随机存活玩家为目标点生成（联机分摊压力）
    const p = g.randomAlivePlayerPos();
    let x = 0, z = 0, ok = false;
    // 40% 概率在玩家移动前方截杀（针对绕圈打法）
    const pv = Math.hypot(p.vx, p.vz);
    if (Math.random() < DIRECTOR.flankChance && pv > 3) {
      const dx = p.vx / pv, dz = p.vz / pv;
      for (let tries = 0; tries < 4 && !ok; tries++) {
        const d = rand(15, 23);
        const ja = rand(-0.7, 0.7);
        const ca = Math.cos(ja), sa = Math.sin(ja);
        x = clamp(p.x + (dx * ca - dz * sa) * d, -this.game.arena + 2, this.game.arena - 2);
        z = clamp(p.z + (dx * sa + dz * ca) * d, -this.game.arena + 2, this.game.arena - 2);
        ok = dist2(x, z, p.x, p.z) > 100;
      }
    }
    // 常规：围绕玩家的环形生成
    for (let tries = 0; tries < 6 && !ok; tries++) {
      const a = rand(Math.PI * 2), d = rand(17, 27);
      x = clamp(p.x + Math.cos(a) * d, -this.game.arena + 2, this.game.arena - 2);
      z = clamp(p.z + Math.sin(a) * d, -this.game.arena + 2, this.game.arena - 2);
      ok = dist2(x, z, p.x, p.z) > 100;
    }
    const elite = t > DIRECTOR.eliteAfter && Math.random() < DIRECTOR.eliteChance;
    this.queueSpawn(type, x, z, elite, DIRECTOR.telegraphTime);
  }

  queueSpawn(type, x, z, elite, dur) {
    const g = this.game;
    if (g.mpIsHost()) g.mp.evTelegraph(type, x, z, elite, dur);
    const tg = this.telegraphs.find((q) => !q.active);
    if (!tg) { this.spawnNow(type, x, z, elite); return; }
    tg.active = true; tg.t = 0; tg.dur = dur;
    tg.type = type; tg.elite = elite; tg.isBoss = type === 'boss';
    tg.mesh.position.set(x, 0.12, z);
    tg.mesh.material.color.setHex(type === 'boss' ? 0xff2266 : elite ? 0xffffff : 0xff3e6d);
    tg.mesh.visible = true;
  }

  // 客机：收到生成预警事件
  netTelegraph(type, x, z, elite, dur) {
    const tg = this.telegraphs.find((q) => !q.active);
    if (!tg) return;
    tg.active = true; tg.t = 0; tg.dur = dur;
    tg.type = type; tg.elite = elite; tg.isBoss = type === 'boss';
    tg.mesh.position.set(x, 0.12, z);
    tg.mesh.material.color.setHex(type === 'boss' ? 0xff2266 : elite ? 0xffffff : 0xff3e6d);
    tg.mesh.visible = true;
  }

  // 客机：按指定池位激活敌人（纯表现，无数值）
  spawnNet(id, type, x, z, elite, generation) {
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
    e.dmg = base.dmg;
    e.elite = elite;
    e.hp = e.maxHp = base.hp;
    e.netHpFrac = 1;
    e.flashT = 0; e.popT = 0.22; e.fuseT = -1; e.punchT = 0; e.burnT = 0;
    e.mesh.visible = true;
    e.mesh.scale.setScalar(0.15);
    e.mat.emissive.setHex(elite ? 0xffffff : PALETTE[type]);
    e.mat.emissiveIntensity = elite ? 2.2 : 1.5;
    if (type === 'boss') this.bossActive = e;
  }

  spawnNow(type, x, z, elite) {
    const e = this.list.find((q) => !q.active && q.type === type);
    if (!e) return;
    const base = ENEMY_TYPES[type];
    const t = this.game.time;
    const mpHp = this.game.mpHpScale ? this.game.mpHpScale() : 1;
    const hpMul = (type === 'boss' ? 1 + 0.65 * this.bossMark() : 1 + t / 78) * mpHp;
    const spdMul = Math.min(1.45, 1 + t / 700);
    e.active = true; e.dying = false;
    e.generation++;
    e.pos.set(x, type === 'boss' ? 2.6 : 0.75, z);
    e.vel.set(0, 0, 0);
    e.maxHp = e.hp = Math.round(base.hp * hpMul * (elite ? 3.2 : 1));
    e.speed = base.speed * spdMul * (elite ? 1.12 : 1) * rand(0.92, 1.08);
    e.dmg = Math.round(base.dmg * (elite ? 1.5 : 1));
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
    e.burnT = 0; e.burnDps = 0; e.burnAcc = 0;
    e.mode = 'chase'; e.modeT = 0; e.attackT = 2.2;
    e.mesh.visible = true;
    e.mesh.scale.setScalar(0.15);
    e.mat.emissive.setHex(elite ? 0xffffff : PALETTE[type]);
    e.mat.emissiveIntensity = elite ? 2.2 : type === 'shooter' ? 1.1 : 1.5;
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

  // ============ 每帧更新 ============
  update(dt) {
    const g = this.game, p = g.player;
    this.director(dt);

    // 敌弹
    for (const b of this.ebullets) {
      if (!b.active) continue;
      b.life -= dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.life <= 0 || Math.abs(b.pos.x) > this.game.arena + 2 || Math.abs(b.pos.z) > this.game.arena + 2) {
        b.active = false; b.mesh.visible = false;
        continue;
      }
      b.mesh.position.copy(b.pos);
      b.mesh.scale.setScalar(1 + Math.sin(g.time * 14 + b.pos.x) * 0.18);
    }

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

      // 点燃（焚天）DoT
      if (e.burnT > 0) {
        e.burnT -= dt;
        e.burnAcc += e.burnDps * dt;
        if (e.burnAcc >= 1) {
          const tick = Math.floor(e.burnAcc);
          e.burnAcc -= tick;
          e.hp -= tick;
          if (e.hp <= 0) { g.killEnemy(e); continue; }
        }
        if (Math.random() < dt * 10) {
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
      e.vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
    }

    // 同类分离（防止完全重叠）
    this.separate(dt);
  }

  seekPlayer(e, dt, mul) {
    const t = this.game.playerTarget(e.pos.x, e.pos.z);
    const dx = t.x - e.pos.x, dz = t.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    e.vel.x += (dx / d) * e.speed * mul * 3.2 * dt * 60 / 60;
    e.vel.z += (dz / d) * e.speed * mul * 3.2 * dt;
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
    e.vel.x += mx * e.speed * 3 * dt;
    e.vel.z += mz * e.speed * 3 * dt;
    const v = Math.hypot(e.vel.x, e.vel.z);
    if (v > e.speed) { e.vel.x = e.vel.x / v * e.speed; e.vel.z = e.vel.z / v * e.speed; }

    // 开火
    e.fireT -= dt;
    if (e.fireT <= 0 && d < 26) {
      e.fireT = base.fireCd * rand(0.85, 1.15);
      this.fireEBullet(e.pos.x, e.pos.z, dx / d, dz / d, base.bulletSpeed, e.dmg);
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
    e.vel.x += (dx / d) * e.speed * 3.4 * dt;
    e.vel.z += (dz / d) * e.speed * 3.4 * dt;
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
    e.vel.x += mx * e.speed * 3 * dt;
    e.vel.z += mz * e.speed * 3 * dt;
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
        const dealt = g.player.takeDamage(base.blastDmg, g);
        if (dealt === 'shield') g.onShieldBreak();
        else if (dealt !== false) g.onPlayerHurt(dealt, e.pos.x, e.pos.z);
      }
      // 联机：通知客机自检爆炸半径
      if (g.mpIsHost()) g.mp.send({ k: 'blast', x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1), r: base.blastR, dmg: base.blastDmg });
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
    const attacks = phase === 1 ? ['radial', 'fan', 'summon'] : phase === 2 ? ['radial', 'fan', 'charge', 'summon'] : ['radial', 'charge', 'fan', 'charge'];
    const atk = pick(attacks);
    e.attackT = (phase === 1 ? 3.4 : phase === 2 ? 2.7 : 2.1) * rand(0.9, 1.1);

    if (atk === 'radial') {
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
      e.mode = 'charge';
      e.modeT = 0.62;
      e.chargeDir.set(dx / d, 0, dz / d);
      // 预警线
      this.chargeLine.visible = true;
      this.chargeLine.material.opacity = 0.55;
      this.chargeLine.position.set(e.pos.x + e.chargeDir.x * 10, 0.3, e.pos.z + e.chargeDir.z * 10);
      this.chargeLine.scale.set(1, 1, 20);
      this.chargeLine.lookAt(e.pos.x + e.chargeDir.x * 20, 0.3, e.pos.z + e.chargeDir.z * 20);
      setTimeout(() => { this.chargeLine.visible = false; }, 350);
      g.audio.bossWarn();
    } else if (atk === 'summon') {
      const n = 3 + phase;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const sx = clamp(e.pos.x + Math.cos(a) * 5, -this.game.arena + 2, this.game.arena - 2);
        const sz = clamp(e.pos.z + Math.sin(a) * 5, -this.game.arena + 2, this.game.arena - 2);
        this.queueSpawn(phase >= 2 && i % 2 === 0 ? 'speeder' : 'chaser', sx, sz, false, 0.7);
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
    b.life = 6;
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
      g.ui.setBossHp(-1);
      g.onBossDown(e);
    }
  }
}
