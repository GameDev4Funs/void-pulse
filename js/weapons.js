// ============ 玩家武器系统：脉冲枪 / 轨道刃 / 追踪导弹 / 特斯拉电弧 / 新星爆发 ============
import * as THREE from 'three';
import { PALETTE } from './config.js';
import { rand, dist2 } from './utils.js';

// —— 武器等级表 ——
export const WEAPON_TABLES = {
  blaster: [
    null,
    { dmg: 12, rate: 3.0, shots: 1, pierce: 0 },
    { dmg: 17, rate: 3.3, shots: 1, pierce: 0 },
    { dmg: 17, rate: 3.6, shots: 2, pierce: 0 },
    { dmg: 21, rate: 4.5, shots: 2, pierce: 1 },
    { dmg: 25, rate: 5.4, shots: 3, pierce: 1 },
  ],
  blades: [
    null,
    { n: 2, dmg: 16, radius: 3.1, rot: 3.4 },
    { n: 3, dmg: 20, radius: 3.3, rot: 3.7 },
    { n: 3, dmg: 30, radius: 3.5, rot: 4.1 },
    { n: 4, dmg: 38, radius: 3.9, rot: 4.6 },
    { n: 5, dmg: 50, radius: 4.4, rot: 5.2 },
  ],
  missiles: [
    null,
    { cd: 2.4, n: 1, dmg: 30, aoe: 2.6 },
    { cd: 2.2, n: 2, dmg: 34, aoe: 2.7 },
    { cd: 1.9, n: 2, dmg: 46, aoe: 3.0 },
    { cd: 1.7, n: 3, dmg: 52, aoe: 3.2 },
    { cd: 1.4, n: 4, dmg: 64, aoe: 3.6 },
  ],
  tesla: [
    null,
    { cd: 1.7, chains: 3, dmg: 20 },
    { cd: 1.5, chains: 4, dmg: 24 },
    { cd: 1.25, chains: 5, dmg: 30 },
    { cd: 1.05, chains: 6, dmg: 38 },
    { cd: 0.85, chains: 8, dmg: 48 },
  ],
  nova: [
    null,
    { cd: 4.5, dmg: 28, radius: 6.0 },
    { cd: 4.2, dmg: 34, radius: 7.0 },
    { cd: 3.6, dmg: 42, radius: 8.0 },
    { cd: 3.1, dmg: 56, radius: 8.6 },
    { cd: 2.5, dmg: 78, radius: 9.6 },
  ],
};
export const MAX_WEAPON_LV = 5;

// —— 进化形态（满级武器 + 对应被动 → 金色进化卡）——
export const EVO_TABLES = {
  blaster:  { dmg: 72, rate: 2.6, shots: 1, pierce: 99, scale: 2.7, knock: 12 },
  blades:   { n: 8, dmg: 70, radius: 5.0, rot: 6.0, flingCd: 2.6, flingDmg: 42 },
  missiles: { cd: 1.8, n: 8, dmg: 40, aoe: 3.8, bomblets: 2, bombletDmg: 22, bombletAoe: 2.2 },
  tesla:    { cd: 0.7, chains: 12, dmg: 60, zoneR: 2.8, zoneDur: 3.0, zoneTick: 15 },
  nova:     { cd: 2.2, dmg: 110, radius: 12, pull: 18 },
};
const STORM_POOL = 10;

const BULLET_POOL = 240;
const MISSILE_POOL = 30;
const BOLT_POOL = 22;

export class Weapons {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;

    // —— 子弹池 ——
    const bGeo = new THREE.CapsuleGeometry(0.1, 0.55, 3, 6);
    bGeo.rotateX(Math.PI / 2);   // 长轴对齐 Z
    const bMat = new THREE.MeshBasicMaterial({
      color: PALETTE.bullet, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.bullets = [];
    for (let i = 0; i < BULLET_POOL; i++) {
      const m = new THREE.Mesh(bGeo, bMat);
      m.visible = false;
      scene.add(m);
      this.bullets.push({ mesh: m, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), dmg: 0, pierce: 0, life: 0, crit: false, hitSet: new Set() });
    }

    // —— 导弹池 ——
    const mGeo = new THREE.ConeGeometry(0.16, 0.6, 6);
    mGeo.rotateX(Math.PI / 2);
    const mMat = new THREE.MeshBasicMaterial({ color: PALETTE.missile });
    this.missiles = [];
    for (let i = 0; i < MISSILE_POOL; i++) {
      const m = new THREE.Mesh(mGeo, mMat);
      m.visible = false;
      scene.add(m);
      this.missiles.push({ mesh: m, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, dmg: 0, aoe: 0, life: 0, crit: false });
    }

    // —— 电弧段池 ——
    const boltGeo = new THREE.BoxGeometry(0.09, 0.09, 1);
    const boltMat = new THREE.MeshBasicMaterial({
      color: PALETTE.tesla, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.bolts = [];
    for (let i = 0; i < BOLT_POOL; i++) {
      const m = new THREE.Mesh(boltGeo, boltMat.clone());
      m.visible = false;
      scene.add(m);
      this.bolts.push({ mesh: m, t: 0, dur: 0.18, active: false });
    }

    // —— 轨道刃网格（进化后最多 8）——
    this.bladeMeshes = [];
    const bladeGeo = new THREE.OctahedronGeometry(0.5, 0);
    bladeGeo.scale(0.55, 0.22, 1.5);
    const bladeMat = new THREE.MeshBasicMaterial({
      color: PALETTE.blade, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(bladeGeo, bladeMat);
      m.visible = false;
      scene.add(m);
      this.bladeMeshes.push(m);
    }
    this.bladeAngle = 0;

    // —— 雷狱持续伤害区（进化特斯拉）——
    this.stormZones = [];
    const szGeo = new THREE.CircleGeometry(1, 26);
    for (let i = 0; i < STORM_POOL; i++) {
      const m = new THREE.Mesh(szGeo, new THREE.MeshBasicMaterial({
        color: PALETTE.stormZone, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.stormZones.push({ mesh: m, active: false, x: 0, z: 0, r: 2.8, t: 0, dur: 3, tickT: 0, dmg: 15 });
    }
    // 子母弹（进化导弹）
    this.bomblets = [];

    this._queryBuf = new Array(64);
    this._v1 = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.levels = { blaster: 1, blades: 0, missiles: 0, tesla: 0, nova: 0 };
    this.evolved = { blaster: false, blades: false, missiles: false, tesla: false, nova: false };
    this.timers = { blaster: 0.2, missiles: 1.2, tesla: 1.0, nova: 2.5, fling: 2.0 };
    for (const b of this.bullets) { b.active = false; b.mesh.visible = false; b.hitSet.clear(); }
    for (const m of this.missiles) { m.active = false; m.mesh.visible = false; }
    for (const b of this.bolts) { b.active = false; b.mesh.visible = false; }
    for (const m of this.bladeMeshes) m.visible = false;
    for (const z of this.stormZones) { z.active = false; z.mesh.visible = false; }
    this.bomblets.length = 0;
    this.bladeAngle = 0;
  }

  level(id) { return this.levels[id] || 0; }
  cfg(id) { return this.evolved[id] ? EVO_TABLES[id] : WEAPON_TABLES[id][this.levels[id]]; }

  rollCrit() {
    const s = this.game.player.stats;
    return Math.random() < s.critCh;
  }
  finalDmg(base, crit) {
    const s = this.game.player.stats;
    return Math.round(base * s.dmgMul * this.game.routeFx.dmg * (crit ? s.critMul : 1));
  }
  rateMul() {
    return this.game.player.stats.rateMul * this.game.routeFx.rate * (this.game.reactor.buffLeft > 0 ? 1.25 : 1);
  }

  // ============ 更新 ============
  update(dt) {
    const g = this.game;
    const p = g.player;
    if (!p.alive || p.dead) return;
    this.updateBlaster(dt);
    this.updateBlades(dt);
    this.updateMissiles(dt);
    this.updateTesla(dt);
    this.updateNova(dt);
    this.updateBolts(dt);
    this.updateBomblets(dt);
    this.updateStormZones(dt);
  }

  // —— 脉冲枪（进化：湮灭射线）——
  updateBlaster(dt) {
    const g = this.game, p = g.player;
    const evo = this.evolved.blaster;
    const cfg = this.cfg('blaster');
    this.timers.blaster -= dt;
    const interval = 1 / (cfg.rate * this.rateMul());
    while (this.timers.blaster <= 0) {
      this.timers.blaster += interval;
      const n = cfg.shots;
      const spread = 0.14;
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : (i - (n - 1) / 2) * spread;
        this.fireBullet(cfg, off);
      }
      g.audio.shoot();
      if (evo) g.addTrauma(0.06);
      // 枪口闪光
      g.particles.spawn(
        p.pos.x + p.aimDir.x * 0.9, 0.8, p.pos.z + p.aimDir.z * 0.9,
        p.aimDir.x * 3, 1, p.aimDir.z * 3, 0.12, evo ? 2.6 : 1.4, evo ? 0xb084ff : PALETTE.bullet, 6, 0
      );
    }

    // 子弹飞行 + 碰撞
    const hash = g.enemyHash;
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.life -= dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.life <= 0
        || Math.abs(b.pos.x) > g.arena + 4
        || Math.abs(b.pos.z) > g.arena + 4
        || g.world.blocksProjectile(b.pos.x, b.pos.z, 0.16)) {
        b.active = false; b.mesh.visible = false; b.hitSet.clear();
        continue;
      }
      b.mesh.position.copy(b.pos);
      if (evo) {
        // 湮灭光束尾迹
        g.particles.spawn(b.pos.x, b.pos.y, b.pos.z, rand(-0.5, 0.5), rand(0, 0.5), rand(-0.5, 0.5), 0.22, 1.2, 0xb084ff, 5, 0);
      }
      const cnt = hash.query(b.pos.x, b.pos.z, 3.0, this._queryBuf);
      for (let i = 0; i < cnt; i++) {
        const e = this._queryBuf[i];
        if (!e.active || e.dying || b.hitSet.has(e)) continue;
        const rr = e.radius + 0.35 * b.mesh.scale.x;
        if (dist2(b.pos.x, b.pos.z, e.pos.x, e.pos.z) < rr * rr) {
          b.hitSet.add(e);
          g.damageEnemy(e, b.dmg, { crit: b.crit, knock: b.knock, kx: b.vel.x, kz: b.vel.z });
          g.particles.burst(b.pos.x, 0.7, b.pos.z, evo ? 9 : 4, evo ? 0xb084ff : PALETTE.bullet, { speed: 5, life: 0.3, size: 0.5, up: 1.5 });
          if (b.hitSet.size > b.pierce) {
            b.active = false; b.mesh.visible = false; b.hitSet.clear();
            break;
          }
        }
      }
    }
  }

  fireBullet(cfg, angleOff) {
    const g = this.game, p = g.player;
    const crit = this.rollCrit();
    const cos = Math.cos(angleOff), sin = Math.sin(angleOff);
    const dx = p.aimDir.x * cos - p.aimDir.z * sin;
    const dz = p.aimDir.x * sin + p.aimDir.z * cos;
    this.spawnBullet({
      x: p.pos.x + dx * 0.9, z: p.pos.z + dz * 0.9,
      dx, dz, speed: 46,
      dmg: this.finalDmg(cfg.dmg, crit), crit,
      pierce: cfg.pierce, life: 1.6,
      scale: (this.evolved.blaster ? cfg.scale : 1) * (crit ? 1.5 : 1),
      knock: cfg.knock || 4,
    });
  }

  // 通用子弹生成（飞刃风暴也复用）
  spawnBullet({ x, z, dx, dz, speed, dmg, crit, pierce, life, scale = 1, knock = 4 }) {
    const b = this.bullets.find((q) => !q.active);
    if (!b) return;
    b.active = true;
    b.pos.set(x, 0.75, z);
    b.vel.set(dx * speed, 0, dz * speed);
    b.dmg = dmg; b.crit = crit;
    b.pierce = pierce;
    b.life = life;
    b.knock = knock;
    b.mesh.visible = true;
    b.mesh.position.copy(b.pos);
    b.mesh.lookAt(this._v1.copy(b.pos).add(b.vel));
    b.mesh.scale.setScalar(scale);
    this.game.mpSendFx('tr', { x: +x.toFixed(1), z: +z.toFixed(1), dx: +dx.toFixed(2), dz: +dz.toFixed(2) });
  }

  // —— 轨道刃（进化：风暴剑域）——
  updateBlades(dt) {
    const lv = this.level('blades');
    if (lv === 0) return;
    const g = this.game, p = g.player;
    const evo = this.evolved.blades;
    const cfg = this.cfg('blades');
    this.bladeAngle += dt * cfg.rot;
    // 进化：周期性全方位飞刃
    if (evo) {
      this.timers.fling -= dt;
      if (this.timers.fling <= 0) {
        this.timers.fling = cfg.flingCd / this.rateMul();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const crit = this.rollCrit();
          this.spawnBullet({
            x: p.pos.x, z: p.pos.z,
            dx: Math.sin(a), dz: Math.cos(a), speed: 30,
            dmg: this.finalDmg(cfg.flingDmg, crit), crit,
            pierce: 99, life: 0.9, scale: 1.8, knock: 6,
          });
        }
        g.audio.missile();
        g.addTrauma(0.08);
      }
    }
    const n = evo ? cfg.n : Math.min(cfg.n, this.bladeMeshes.length);
    for (let i = 0; i < n; i++) {
      const m = this.bladeMeshes[i];
      m.visible = true;
      const a = this.bladeAngle + (i / n) * Math.PI * 2;
      m.position.set(p.pos.x + Math.cos(a) * cfg.radius, 0.7, p.pos.z + Math.sin(a) * cfg.radius);
      m.rotation.y = -a;
      // 接触伤害
      const cnt = g.enemyHash.query(m.position.x, m.position.z, 3.6, this._queryBuf);
      for (let j = 0; j < cnt; j++) {
        const e = this._queryBuf[j];
        if (!e.active || e.dying) continue;
        if (g.time - (e.lastBladeHit || -1) < 0.38) continue;
        const rr = e.radius + 0.8;
        if (dist2(m.position.x, m.position.z, e.pos.x, e.pos.z) < rr * rr) {
          e.lastBladeHit = g.time;
          const crit = this.rollCrit();
          const kx = e.pos.x - p.pos.x, kz = e.pos.z - p.pos.z;
          g.damageEnemy(e, this.finalDmg(cfg.dmg, crit), { crit, knock: 7, kx, kz });
          g.particles.burst(m.position.x, 0.7, m.position.z, 5, PALETTE.blade, { speed: 6, life: 0.3, size: 0.5 });
          g.audio.enemyHit();
        }
      }
    }
  }

  // —— 追踪导弹 ——
  updateMissiles(dt) {
    const lv = this.level('missiles');
    const g = this.game, p = g.player;
    if (lv > 0) {
      const cfg = this.cfg('missiles');
      this.timers.missiles -= dt;
      if (this.timers.missiles <= 0 && g.enemies.list.some((e) => e.active && !e.dying)) {
        this.timers.missiles = cfg.cd / this.rateMul();
        for (let i = 0; i < cfg.n; i++) this.fireMissile(cfg, i);
        g.audio.missile();
      }
    }
    for (const m of this.missiles) {
      if (!m.active) continue;
      m.life -= dt;
      if (m.life <= 0) { this.explodeMissile(m); continue; }
      // 追踪
      if (!m.target || !m.target.active || m.target.dying) m.target = g.nearestEnemy(m.pos.x, m.pos.z, 40);
      if (m.target) {
        const tx = m.target.pos.x - m.pos.x, tz = m.target.pos.z - m.pos.z;
        const tl = Math.hypot(tx, tz) || 1;
        const cur = Math.atan2(m.vel.x, m.vel.z);
        let want = Math.atan2(tx / tl, tz / tl);
        let diff = want - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = 6.5 * dt;
        const na = cur + Math.max(-turn, Math.min(turn, diff));
        const spd = Math.min(30, m.vel.length() + 26 * dt);
        m.vel.set(Math.sin(na) * spd, 0, Math.cos(na) * spd);
      }
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(this._v1.copy(m.pos).add(m.vel));
      // 尾迹
      if (Math.random() < 0.6) {
        g.particles.spawn(m.pos.x, m.pos.y, m.pos.z, rand(-1, 1), rand(0, 1), rand(-1, 1), 0.35, 0.7, 0x6ef3ff, 3, 0);
      }
      // 命中
      if (m.target && m.target.active) {
        const rr = m.target.radius + 0.5;
        if (dist2(m.pos.x, m.pos.z, m.target.pos.x, m.target.pos.z) < rr * rr) this.explodeMissile(m);
      }
    }
  }

  fireMissile(cfg, idx) {
    const m = this.missiles.find((x) => !x.active);
    if (!m) return;
    const g = this.game, p = g.player;
    const crit = this.rollCrit();
    const fan = Math.min(1.1, 2.4 / Math.max(1, cfg.n));
    const a = Math.atan2(p.aimDir.x, p.aimDir.z) + (idx - (cfg.n - 1) / 2) * fan + rand(-0.15, 0.15);
    m.active = true;
    m.pos.set(p.pos.x, 0.9, p.pos.z);
    m.vel.set(Math.sin(a) * 10, 0, Math.cos(a) * 10);
    m.target = g.randomEnemy();
    m.dmg = this.finalDmg(cfg.dmg, crit);
    m.aoe = cfg.aoe;
    m.crit = crit;
    m.life = 3.2;
    m.mesh.visible = true;
  }

  explodeMissile(m) {
    const g = this.game;
    m.active = false; m.mesh.visible = false;
    g.areaDamage(m.pos.x, m.pos.z, m.aoe, m.dmg, { crit: m.crit, knock: 9 });
    g.particles.burst(m.pos.x, 0.6, m.pos.z, 16, 0x6ef3ff, { speed: 9, life: 0.5, size: 0.7 });
    g.particles.burst(m.pos.x, 0.6, m.pos.z, 8, 0xff9f3e, { speed: 6, life: 0.4, size: 0.6 });
    g.shockwaves.fire(m.pos.x, m.pos.z, m.aoe, 0x6ef3ff, 0.4);
    g.audio.explode();
    g.addTrauma(0.12);
    g.mpSendFx('xpl', { x: +m.pos.x.toFixed(1), z: +m.pos.z.toFixed(1), r: m.aoe });
    // 进化：子母弹
    if (this.evolved.missiles) {
      const cfg = this.cfg('missiles');
      for (let i = 0; i < cfg.bomblets; i++) {
        this.bomblets.push({
          x: m.pos.x + rand(-1, 1), z: m.pos.z + rand(-1, 1),
          t: 0.25, dmg: this.finalDmg(cfg.bombletDmg, false), aoe: cfg.bombletAoe,
        });
      }
    }
  }

  updateBomblets(dt) {
    const g = this.game;
    for (let i = this.bomblets.length - 1; i >= 0; i--) {
      const b = this.bomblets[i];
      b.t -= dt;
      if (b.t > 0) continue;
      this.bomblets.splice(i, 1);
      g.areaDamage(b.x, b.z, b.aoe, b.dmg, { knock: 6 });
      g.particles.burst(b.x, 0.5, b.z, 10, 0xff9f3e, { speed: 7, life: 0.4, size: 0.6 });
      g.shockwaves.fire(b.x, b.z, b.aoe, 0xff9f3e, 0.35);
      g.audio.explode();
    }
  }

  // —— 特斯拉电弧 ——
  updateTesla(dt) {
    const lv = this.level('tesla');
    if (lv === 0) return;
    const g = this.game, p = g.player;
    const cfg = this.cfg('tesla');
    this.timers.tesla -= dt;
    if (this.timers.tesla > 0) return;
    const first = g.nearestEnemy(p.pos.x, p.pos.z, 13);
    if (!first) return;
    this.timers.tesla = cfg.cd / this.rateMul();

    // 链式选择目标
    const chain = [first];
    let cur = first;
    for (let i = 1; i < cfg.chains; i++) {
      let best = null, bd = 7.5 * 7.5;
      for (const e of g.enemies.list) {
        if (!e.active || e.dying || chain.includes(e)) continue;
        const d = dist2(cur.pos.x, cur.pos.z, e.pos.x, e.pos.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      chain.push(best);
      cur = best;
    }
    // 伤害 + 视觉（进化：每个命中点留下雷狱）
    let px = p.pos.x, py = 0.85, pz = p.pos.z;
    const evo = this.evolved.tesla;
    for (const e of chain) {
      this.fireBolt(px, py, pz, e.pos.x, 0.8, e.pos.z);
      const crit = this.rollCrit();
      g.damageEnemy(e, this.finalDmg(cfg.dmg, crit), { crit, knock: 1.5, kx: e.pos.x - px, kz: e.pos.z - pz });
      g.particles.burst(e.pos.x, 0.8, e.pos.z, 5, PALETTE.tesla, { speed: 4, life: 0.25, size: 0.5 });
      if (evo) this.dropStormZone(e.pos.x, e.pos.z, cfg);
      px = e.pos.x; pz = e.pos.z; py = 0.8;
    }
    g.audio.tesla();
  }

  dropStormZone(x, z, cfg) {
    const zn = this.stormZones.find((q) => !q.active) || this.stormZones[0];
    zn.active = true; zn.x = x; zn.z = z;
    zn.r = cfg.zoneR; zn.t = 0; zn.dur = cfg.zoneDur; zn.tickT = 0; zn.dmg = cfg.zoneTick;
    zn.mesh.position.set(x, 0.12, z);
    zn.mesh.visible = true;
  }

  updateStormZones(dt) {
    const g = this.game;
    for (const zn of this.stormZones) {
      if (!zn.active) continue;
      zn.t += dt;
      if (zn.t >= zn.dur) { zn.active = false; zn.mesh.visible = false; continue; }
      const f = zn.t / zn.dur;
      zn.mesh.scale.setScalar(zn.r * (f < 0.15 ? f / 0.15 : 1));
      zn.mesh.material.opacity = (0.16 + Math.sin(g.time * 7 + zn.x) * 0.07) * (1 - f * 0.6);
      zn.tickT -= dt;
      if (zn.tickT <= 0) {
        zn.tickT = 0.4;
        g.areaDamage(zn.x, zn.z, zn.r, this.finalDmg(zn.dmg, false), { knock: 0 });
        if (Math.random() < 0.5) {
          g.particles.burst(zn.x + rand(-zn.r / 2, zn.r / 2), 0.4, zn.z + rand(-zn.r / 2, zn.r / 2), 2, PALETTE.stormZone, { speed: 2, life: 0.3, size: 0.5, grav: 4 });
        }
      }
    }
  }

  fireBolt(x0, y0, z0, x1, y1, z1) {
    // 把一条链路拆成 3 段抖动折线
    const segs = 3;
    let lx = x0, ly = y0, lz = z0;
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const mx = x0 + (x1 - x0) * f + (i < segs ? rand(-0.5, 0.5) : 0);
      const my = y0 + (y1 - y0) * f + (i < segs ? rand(-0.3, 0.3) : 0);
      const mz = z0 + (z1 - z0) * f + (i < segs ? rand(-0.5, 0.5) : 0);
      const b = this.bolts.find((x) => !x.active);
      if (!b) return;
      if (i === 1) this.game.mpSendFx('bolt', { x0, y0, z0, x1, y1, z1 });
      b.active = true; b.t = 0;
      const m = b.mesh;
      m.visible = true;
      const dx = mx - lx, dy = my - ly, dz = mz - lz;
      const len = Math.hypot(dx, dy, dz);
      m.position.set((lx + mx) / 2, (ly + my) / 2, (lz + mz) / 2);
      m.scale.set(1, 1, len);
      m.lookAt(mx, my, mz);
      m.material.opacity = 1;
      lx = mx; ly = my; lz = mz;
    }
  }

  updateBolts(dt) {
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.t += dt;
      const f = b.t / b.dur;
      if (f >= 1) { b.active = false; b.mesh.visible = false; continue; }
      b.mesh.material.opacity = 1 - f;
    }
  }

  // —— 新星爆发（进化：超新星坍缩）——
  updateNova(dt) {
    const lv = this.level('nova');
    if (lv === 0) return;
    const g = this.game, p = g.player;
    const evo = this.evolved.nova;
    const cfg = this.cfg('nova');
    this.timers.nova -= dt;
    if (this.timers.nova > 0) return;
    // 周围有敌人才触发
    if (!g.nearestEnemy(p.pos.x, p.pos.z, cfg.radius + 2)) return;
    this.timers.nova = cfg.cd / this.rateMul();
    const crit = this.rollCrit();
    if (evo) {
      // 引力坍缩：把敌人往中心拽 + 爆发 + 护盾
      g.areaDamage(p.pos.x, p.pos.z, cfg.radius, this.finalDmg(cfg.dmg, crit), { crit, knock: -cfg.pull, fromX: p.pos.x, fromZ: p.pos.z });
      g.shockwaves.fire(p.pos.x, p.pos.z, cfg.radius, 0xffffff, 0.7);
      g.shockwaves.fire(p.pos.x, p.pos.z, cfg.radius * 0.7, PALETTE.nova, 0.55);
      g.particles.burst(p.pos.x, 0.6, p.pos.z, 50, PALETTE.nova, { speed: 18, life: 0.7, size: 0.9 });
      p.grantShield();
      g.texts.fire(p.pos.x, 1.8, p.pos.z, '护盾 +1', 'heal');
      g.addTrauma(0.45);
      g.slowmo(0.12, 0.25);
    } else {
      g.areaDamage(p.pos.x, p.pos.z, cfg.radius, this.finalDmg(cfg.dmg, crit), { crit, knock: 16, fromX: p.pos.x, fromZ: p.pos.z });
      g.shockwaves.fire(p.pos.x, p.pos.z, cfg.radius, PALETTE.nova, 0.5);
      g.shockwaves.fire(p.pos.x, p.pos.z, cfg.radius * 0.6, 0xffffff, 0.35);
      g.particles.burst(p.pos.x, 0.6, p.pos.z, 26, PALETTE.nova, { speed: 12, life: 0.5, size: 0.7, spread: 1 });
      g.addTrauma(0.22);
    }
    g.audio.nova();
    g.mpSendFx('nova', { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1), r: cfg.radius });
  }
}
