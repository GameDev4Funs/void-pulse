// ============ 联机会话：主机权威 + 客机插值 ============
import * as THREE from 'three';
import { ENEMY_TYPES, PALETTE, ULT, PULSE, WALL_PAD } from './config.js';
import { clamp, damp, dist2, rand } from './utils.js';

const PEER_COLORS = [0xffd23e, 0x4dff88, 0xff8ad8, 0x9fd8ff];
const SNAP_RATE = 0.1;       // 世界快照 10Hz
const POS_RATE = 1 / 20;     // 玩家位置 20Hz，消息小且直接影响操作观感
const DMG_RATE = 1 / 30;     // 伤害事件按帧批量冲刷，避免高射速时产生大量小包
const MAX_EXTRAPOLATION = 0.12;

// —— 队友战机（渲染 + 名牌，无本地逻辑）——
class RemotePlayer {
  constructor(scene, game, name, slot) {
    this.game = game;
    const color = PEER_COLORS[slot % PEER_COLORS.length];
    this.color = color;
    this.name = name;
    const g = new THREE.Group();
    const bodyGeo = new THREE.OctahedronGeometry(0.62, 0);
    bodyGeo.scale(1, 0.55, 1.7);
    this.body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({
      color: 0x1a1a22, emissive: color, emissiveIntensity: 1.5,
      flatShading: true, roughness: 0.35, metalness: 0.4,
    }));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    core.position.y = 0.28;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.5), new THREE.MeshStandardMaterial({
      color: 0x111118, emissive: color, emissiveIntensity: 1.0, flatShading: true,
    }));
    wing.position.set(0, 0, 0.25);
    this.light = new THREE.PointLight(color, 18, 10, 1.8);
    this.light.position.y = 1.2;
    g.add(this.body, core, wing, this.light);
    g.position.set(0, 0.75, 0);
    scene.add(g);
    this.mesh = g;
    this.tx = 0; this.tz = 0;   // 网络目标位置
    this.vx = 0; this.vz = 0;
    this.netAge = 0;
    this.hasState = false;
    this.yaw = 0;
    // 名牌
    this.label = document.createElement('div');
    this.label.style.cssText = `position:absolute;transform:translate(-50%,-100%);font-size:12px;font-weight:700;letter-spacing:1px;color:#fff;text-shadow:0 0 8px #${color.toString(16).padStart(6, '0')},0 1px 2px #000;pointer-events:none;white-space:nowrap;`;
    this.label.textContent = name;
    document.getElementById('text-layer').appendChild(this.label);
    this._v = new THREE.Vector3();
    this.resetRunState();
  }

  update(dt, camera) {
    this.netAge += dt;
    const lead = Math.min(this.netAge, MAX_EXTRAPOLATION);
    const edge = this.game.arena - WALL_PAD;
    const predictedX = clamp(this.tx + this.vx * lead, -edge, edge);
    const predictedZ = clamp(this.tz + this.vz * lead, -edge, edge);
    this.mesh.position.x = damp(this.mesh.position.x, predictedX, 18, dt);
    this.mesh.position.z = damp(this.mesh.position.z, predictedZ, 18, dt);
    this.mesh.position.y = 0.75;
    this.mesh.rotation.y = damp(this.mesh.rotation.y, this.yaw, 10, dt);
    // 名牌投影
    this._v.copy(this.mesh.position).setY(2.1).project(camera);
    this.label.style.left = `${(this._v.x * innerWidth / 2 + innerWidth / 2).toFixed(0)}px`;
    this.label.style.top = `${(-this._v.y * innerHeight / 2 + innerHeight / 2).toFixed(0)}px`;
  }

  setNetworkState(x, z, vx, vz, yaw) {
    if (!this.hasState) {
      this.mesh.position.x = x;
      this.mesh.position.z = z;
      this.hasState = true;
    }
    this.tx = x; this.tz = z;
    this.vx = vx; this.vz = vz;
    this.yaw = yaw;
    this.netAge = 0;
    this.mesh.visible = true;
    this.label.style.display = 'block';
  }

  resetRunState() {
    this.tx = 0; this.tz = 0;
    this.vx = 0; this.vz = 0;
    this.netAge = 0;
    this.hasState = false;
    this.yaw = 0;
    this.mesh.position.set(0, 0.75, 0);
    this.mesh.visible = false;
    this.label.style.display = 'none';
  }

  setDead(d) {
    this.mesh.visible = this.hasState && !d;
    this.label.style.display = this.hasState && !d ? 'block' : 'none';
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.label.remove();
  }
}

export class MpSession {
  constructor(game, net, myName) {
    this.game = game;
    this.net = net;
    this.myName = myName;
    this.isHost = net.isHost;
    this.peers = new Map();   // id -> { name, slot, x,z,ax,az,hp,maxHp,lv,magnet,dead, remote }
    this.snapT = 0;
    this.posT = 0;
    this.dmgT = 0;
    this.clockSynced = false;
    this.hostTime = 0;
    this.lastSnapAt = 0;
    this.hostAway = false;
    this.dmgQueue = [];
    this.gemTargets = new Map();  // 客机：宝石 id -> [x,z]
    this.tracers = [];
    this._buildTracerPool();
    this._bindNet();
  }

  _buildTracerPool() {
    // 队友子弹曳光池（纯视觉）
    const geo = new THREE.CapsuleGeometry(0.09, 0.5, 3, 6);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.game.scene.add(m);
      this.tracers.push({ mesh: m, active: false, vx: 0, vz: 0, life: 0 });
    }
  }

  fireTracer(x, z, dx, dz, speed = 46, life = 1.2) {
    const t = this.tracers.find((q) => !q.active);
    if (!t) return;
    t.active = true; t.life = life;
    t.vx = dx * speed; t.vz = dz * speed;
    t.mesh.visible = true;
    t.mesh.position.set(x, 0.75, z);
    t.mesh.lookAt(x + dx, 0.75, z + dz);
  }

  // ============ 大厅 ============
  _bindNet() {
    const n = this.net;
    n.on('peer_join', (m) => {
      this._addPeer(m.id, m.name);
      this.game.ui.lobbyRefresh(this.roster(), this.isHost);
      this.game.ui.toast(`${m.name} 加入了房间`, '#4dff88');
    });
    n.on('peer_leave', (m) => {
      this._removePeer(m.id);
      this.game.ui.lobbyRefresh(this.roster(), this.isHost);
      this.game.ui.toast(`${m.name} 离开了房间`, '#ff6b81');
    });
    n.on('host_left', () => {
      this.game.ui.toast('房主已离开，房间解散', '#ff6b81');
      this.game.quitToTitle();
    });
    n.on('closed', () => {
      if (this.game.state === 'playing' || this.game.state === 'lobby') {
        this.game.ui.toast('与服务器断开连接', '#ff6b81');
        this.game.quitToTitle();
      }
    });
    n.on('msg', ({ from, data }) => this._onMsg(from, data));
  }

  _addPeer(id, name) {
    const slot = this.peers.size;
    this.peers.set(id, {
      id, name, slot, x: 0, z: 0, ax: 0, az: -1, hp: 100, maxHp: 100, lv: 1, magnet: 3,
      dead: false, ready: false, remote: new RemotePlayer(this.game.scene, this.game, name, slot),
    });
  }

  _removePeer(id) {
    const p = this.peers.get(id);
    if (p) { p.remote.dispose(this.game.scene); this.peers.delete(id); }
  }

  roster() {
    const list = [{ id: this.net.id, name: this.myName + (this.isHost ? ' 👑' : ''), host: this.isHost }];
    for (const p of this.peers.values()) list.push({ id: p.id, name: p.name, host: false });
    return list;
  }

  get playerCount() { return 1 + this.peers.size; }

  resetRunState() {
    this.snapT = 0;
    this.posT = 0;
    this.dmgT = 0;
    this.clockSynced = false;
    this.hostTime = 0;
    this.lastSnapAt = 0;
    this.hostAway = false;
    this.dmgQueue.length = 0;
    this.gemTargets.clear();
    for (const p of this.peers.values()) {
      p.x = 0; p.z = 0; p.vx = 0; p.vz = 0;
      p.ax = 0; p.az = -1;
      p.hp = 100; p.maxHp = 100; p.lv = 1; p.magnet = 3;
      p.dead = false; p.ready = false;
      p.remote.resetRunState();
    }
  }

  advanceGuestClock(dt) {
    const g = this.game;
    const previous = g.time;
    if (this.hostAway) return;
    let next = previous + dt;
    if (this.clockSynced) {
      const estimatedHostTime = this.hostTime + (performance.now() / 1000 - this.lastSnapAt);
      const error = estimatedHostTime - next;
      // 主机大幅领先时可安全向前追帧；落后时最多减速到 10%，绝不回拨。
      if (error > 2) next = estimatedHostTime;
      else next += clamp(error * 0.08, -dt * 0.9, dt);
    }
    g.time = Math.max(previous, next);
  }

  // 房主视角：所有存活玩家的位置（敌人 AI 用）
  alivePlayerInfos() {
    const g = this.game;
    const out = [];
    if (g.player.alive && !g.player.dead) {
      out.push({ id: this.net.id, x: g.player.pos.x, z: g.player.pos.z, magnet: g.player.stats.magnet, self: true });
    }
    for (const p of this.peers.values()) {
      if (p.ready && !p.dead) out.push({ id: p.id, x: p.x, z: p.z, magnet: p.magnet, self: false });
    }
    return out;
  }

  // ============ 消息 ============
  send(obj) { this.net.send(obj); }

  _onMsg(from, d) {
    const g = this.game;
    if (!d || !d.k) return;
    switch (d.k) {
      case 'p': { // 位置心跳
        const p = this.peers.get(from);
        if (!p) break;
        p.x = d.x; p.z = d.z; p.ax = d.a; p.az = d.b;
        p.vx = d.v ? d.v[0] : 0; p.vz = d.v ? d.v[1] : 0;
        p.hp = d.h; p.maxHp = d.m; p.lv = d.l; p.magnet = d.g;
        p.ready = true;
        p.remote.setNetworkState(d.x, d.z, p.vx, p.vz, Math.atan2(d.a, d.b));
        p.dead = !!d.d;
        p.remote.setDead(p.dead);
        break;
      }
      case 'begin': g.startMp(); break;
      case 'snap': if (!this.isHost) this._applySnap(d); break;
      case 'tele': if (!this.isHost) g.enemies.netTelegraph(d.ty, d.x, d.z, d.el, d.du); break;
      case 'sp': if (!this.isHost) g.enemies.spawnNet(d.id, d.ty, d.x, d.z, d.el, d.gn); break;
      case 'de': if (!this.isHost) this._onEnemyDeath(d); break;
      case 'eb': if (!this.isHost) g.enemies.fireEBullet(d.x, d.z, d.dx, d.dz, d.sp, d.dm); break;
      case 'ceb': if (!this.isHost) g.enemies.clearEBullets(); break;
      case 'web': if (!this.isHost) g.enemies.dropWeb(d.x, d.z); break;
      case 'gd': if (!this.isHost) g.pickups.netDropGem(d.id, d.x, d.z, d.v); break;
      case 'gp': if (!this.isHost) this._onGemPicked(d); break;
      case 'hd': if (!this.isHost) g.pickups.netDropHeart(d.id, d.x, d.z); break;
      case 'hpk': if (!this.isHost) this._onHeartPicked(d); break;
      case 'sup': if (!this.isHost) g.pickups.spawnSupply(d.x, d.z); break;
      case 'supT': if (!this.isHost) this._onSupplyTaken(d); break;
      case 'lv': if (!this.isHost) { g.pendingLevels++; } break;
      case 'ts': if (!this.isHost) g.ui.toast(d.txt, d.c); break;
      case 'dmg': if (this.isHost) this._applyDmgEvents(d.list); break;
      case 'ultdmg': if (this.isHost) this._applyUltDmg(d); break;
      case 'pulsedmg': if (this.isHost) this._applyPulseDmg(d); break;
      case 'fx': this._onFx(from, d); break;
      case 'gov': if (!this.isHost) g.mpGameOver(d); break;
      case 'blast': if (!this.isHost) this._onBlast(d); break;
      case 'hostaway':
        if (!this.isHost) {
          this.hostAway = true;
          g.ui.toast('⏸ 房主切换了标签页，世界暂停中…', '#ff9f3e');
        }
        break;
      case 'hostback':
        if (!this.isHost) {
          this.hostAway = false;
          this.clockSynced = false;
          this.lastSnapAt = 0;
          g.ui.toast('▶ 房主回来了，继续战斗！', '#4dff88');
        }
        break;
    }
  }

  // ============ 主机：快照与事件 ============
  hostTick(dt) {
    const g = this.game;
    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = SNAP_RATE;
      const en = [];
      for (let i = 0; i < g.enemies.list.length; i++) {
        const e = g.enemies.list[i];
        if (!e.active || e.dying) continue;
        const flags = (e.elite ? 1 : 0) | (e.burnT > 0 ? 2 : 0) | (e.fuseT >= 0 ? 4 : 0);
        // 类型已由可靠的生成事件同步，快照只发高频变化字段。
        en.push([i, e.generation, +e.pos.x.toFixed(1), +e.pos.z.toFixed(1), Math.max(0, Math.round((e.hp / e.maxHp) * 100)), flags]);
      }
      const gm = [];
      g.pickups.gems.forEach((q, i) => { if (q.active) gm.push([i, +q.pos.x.toFixed(1), +q.pos.z.toFixed(1)]); });
      this.send({
        k: 'snap', tm: +g.time.toFixed(2), sc: Math.floor(g.score), ch: g.chain, sec: g.sector,
        xp: g.player.xp, lv: g.player.level, en, gm,
        bhp: g.enemies.bossActive ? +(g.enemies.bossActive.hp / g.enemies.bossActive.maxHp).toFixed(2) : -1,
      });
    }
    this.posT -= dt;
    if (this.posT <= 0) {
      this.posT = POS_RATE;
      this.sendPos();
    }
  }

  sendPos() {
    const g = this.game, p = g.player;
    this.send({
      k: 'p', x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1),
      a: +p.aimDir.x.toFixed(2), b: +p.aimDir.z.toFixed(2),
      v: [+p.vel.x.toFixed(1), +p.vel.z.toFixed(1)],
      h: Math.ceil(p.stats.hp), m: p.stats.maxHp, l: p.level, g: +p.stats.magnet.toFixed(1),
      d: p.dead ? 1 : 0,
    });
  }

  // 主机事件转发
  evTelegraph(ty, x, z, el, du) { this.send({ k: 'tele', ty, x: +x.toFixed(1), z: +z.toFixed(1), el: el ? 1 : 0, du }); }
  evSpawn(e, id) { this.send({ k: 'sp', id, gn: e.generation, ty: e.type, x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1), el: e.elite ? 1 : 0 }); }
  evDeath(e, id) { this.send({ k: 'de', id, gn: e.generation, ty: e.type, x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1), el: e.elite ? 1 : 0 }); }
  evEBullet(x, z, dx, dz, sp, dm) { this.send({ k: 'eb', x: +x.toFixed(1), z: +z.toFixed(1), dx: +dx.toFixed(2), dz: +dz.toFixed(2), sp, dm: Math.round(dm) }); }
  evWeb(x, z) { this.send({ k: 'web', x: +x.toFixed(1), z: +z.toFixed(1) }); }
  evGemDrop(g, id) { this.send({ k: 'gd', id, x: +g.pos.x.toFixed(1), z: +g.pos.z.toFixed(1), v: g.value }); }
  evHeartDrop(h, id) { this.send({ k: 'hd', id, x: +h.pos.x.toFixed(1), z: +h.pos.z.toFixed(1) }); }
  evSupply(x, z) { this.send({ k: 'sup', x: +x.toFixed(1), z: +z.toFixed(1) }); }
  evToast(txt, c) { this.send({ k: 'ts', txt, c }); }

  // ============ 客机：快照应用 ============
  _applySnap(d) {
    const g = this.game;
    const now = performance.now() / 1000;
    // 本地时钟逐帧运行；快照记录主机时间，逐帧校正而不是在消息回调里跳变。
    if (!this.clockSynced) {
      g.time = Math.max(g.time, d.tm);
      this.clockSynced = true;
    }
    this.hostTime = d.tm;
    g.score = d.sc; g.chain = d.ch; g.sector = d.sec;
    g.player.xp = d.xp; g.player.level = d.lv;
    const sampleDt = this.lastSnapAt ? clamp(now - this.lastSnapAt, 0.05, 0.25) : SNAP_RATE;
    this.lastSnapAt = now;
    const seen = new Set();
    for (const [id, generation, x, z, hpf, flags] of d.en) {
      seen.add(id);
      const e = g.enemies.list[id];
      if (!e || !e.active || e.generation !== generation) continue;   // 等对应代际的 sp 事件激活
      if (e.netX === undefined) {
        e.netVX = 0; e.netVZ = 0;
      } else {
        const sampleVX = clamp((x - e.netX) / sampleDt, -40, 40);
        const sampleVZ = clamp((z - e.netZ) / sampleDt, -40, 40);
        e.netVX = damp(e.netVX || 0, sampleVX, 12, sampleDt);
        e.netVZ = damp(e.netVZ || 0, sampleVZ, 12, sampleDt);
      }
      e.netX = x; e.netZ = z;
      e.netAge = 0;
      const prevFrac = e.netHpFrac ?? 1;
      e.netHpFrac = hpf / 100;
      if (e.netHpFrac < prevFrac - 0.005) { e.flashT = 0.09; e.punchT = 0.14; }
      e.elite = !!(flags & 1);
      e.burnT = flags & 2 ? 1 : 0;
      e.fuseT = flags & 4 ? 0.3 : -1;
    }
    // 快照里消失的 → 静默移除（死亡通常由 de 事件处理）
    for (let i = 0; i < g.enemies.list.length; i++) {
      const e = g.enemies.list[i];
      if (e.active && e.netActive && !seen.has(i)) {
        e.active = false; e.mesh.visible = false; e.netActive = false;
      }
    }
    // 宝石目标
    const seenG = new Set();
    for (const [id, x, z] of d.gm) {
      seenG.add(id);
      this.gemTargets.set(id, [x, z]);
      const gem = g.pickups.gems[id];
      if (gem && !gem.active) g.pickups.netDropGem(id, x, z, 1);
    }
    g.pickups.gems.forEach((gem, i) => {
      if (gem.active && !seenG.has(i)) { gem.active = false; gem.mesh.visible = false; this.gemTargets.delete(i); }
    });
    // Boss 血条
    if (d.bhp >= 0) g.ui.setBossHp(d.bhp, 0);
    else g.ui.setBossHp(-1);
  }

  _onEnemyDeath(d) {
    const g = this.game;
    const e = g.enemies.list[d.id];
    if (!e || e.generation !== d.gn) return;
    g.playDeathFx(d.x, d.z, d.ty, !!d.el);
    g.pulse = Math.min(PULSE.max, g.pulse + PULSE.perKill);
    // 客机本地流派触发：爆燃 / 落雷
    if (g.routeTiers.pyro >= 2 && d.ty !== 'boss') {
      g.areaDamage(d.x, d.z, 2.6, 20, { knock: 5, fromX: d.x, fromZ: d.z });
      g.shockwaves.fire(d.x, d.z, 2.6, 0xff7a3e, 0.35);
    }
    if (g.routeTiers.volt >= 2 && Math.random() < 0.25) {
      g.smiteAt(d.x, d.z, 50, 3);
    }
    if (e && e.active) { e.active = false; e.mesh.visible = false; e.netActive = false; }
    if (d.ty === 'boss') g.enemies.bossActive = null;
  }

  // 自爆蜂爆炸：客机自检是否在杀伤半径内
  _onBlast(d) {
    const g = this.game, p = g.player;
    const rr = d.r + p.radius;
    if (dist2(d.x, d.z, p.pos.x, p.pos.z) < rr * rr) {
      const dealt = p.takeDamage(d.dmg, g);
      if (dealt === 'shield') g.onShieldBreak();
      else if (dealt !== false) g.onPlayerHurt(dealt, d.x, d.z);
    }
  }

  _onGemPicked(d) {
    const g = this.game;
    const gem = g.pickups.gems[d.id];
    if (gem) { gem.active = false; gem.mesh.visible = false; }
    this.gemTargets.delete(d.id);
    if (d.by === this.net.id) {
      g.addUltCharge(d.v);
      g.audio.pickup();
    }
    g.particles.burst(d.x, 0.8, d.z, 3, PALETTE.gem, { speed: 3, life: 0.25, size: 0.5, grav: 0 });
  }

  _onHeartPicked(d) {
    const g = this.game;
    const h = g.pickups.hearts[d.id];
    if (h) { h.active = false; h.mesh.visible = false; }
    if (d.by === this.net.id) {
      const healed = g.player.heal(18);
      if (healed > 0) { g.texts.fire(g.player.pos.x, 1.6, g.player.pos.z, `+${Math.round(healed)}`, 'heal'); g.audio.heart(); }
    }
  }

  _onSupplyTaken(d) {
    const g = this.game;
    for (const s of g.pickups.supplies) if (s.active) { s.active = false; s.mesh.visible = false; }
    if (d.by === this.net.id) g.player.heal(20);
    g.audio.heart();
    g.shockwaves.fire(d.x, d.z, 4, 0xffd23e, 0.6);
    g.particles.burst(d.x, 1, d.z, 24, 0xffd23e, { speed: 8, life: 0.7, size: 0.7, grav: 2 });
  }

  // ============ 客机：每帧插值 ============
  guestTick(dt) {
    const g = this.game;
    // 敌人插值 + 动画
    for (const e of g.enemies.list) {
      if (!e.active) continue;
      if (e.netX !== undefined) {
        e.netAge = Math.min((e.netAge || 0) + dt, MAX_EXTRAPOLATION);
        e.pos.x = damp(e.pos.x, e.netX + (e.netVX || 0) * e.netAge, 16, dt);
        e.pos.z = damp(e.pos.z, e.netZ + (e.netVZ || 0) * e.netAge, 16, dt);
      }
      if (e.popT > 0) {
        e.popT -= dt;
        const f = 1 - Math.max(0, e.popT) / 0.22;
        e.mesh.scale.setScalar((e.elite ? 1.35 : 1) * (0.15 + 0.85 * (1 - Math.pow(1 - f, 3))));
      } else {
        const puls = 1 + Math.sin(g.time * 4 + e.wobble) * 0.05;
        const punch = e.punchT > 0 ? 1 + 0.3 * (e.punchT / 0.14) : 1;
        const fuse = e.fuseT >= 0 ? 1 + Math.sin(g.time * 40) * 0.22 : 1;
        e.mesh.scale.setScalar((e.elite ? 1.35 : 1) * puls * punch * fuse);
      }
      if (e.flashT > 0) { e.flashT -= dt; e.mat.emissiveIntensity = 1.5 + (e.flashT / 0.09) * 3; }
      if (e.punchT > 0) e.punchT -= dt;
      if (e.type === 'boss') {
        e.mesh.rotation.y += dt * 0.6;
        if (e.mesh.children[0]) e.mesh.children[0].rotation.z += dt * 0.8;
      } else {
        e.mesh.rotation.y += dt * (1 + e.wobble % 2);
      }
      if (e.burnT > 0 && Math.random() < dt * 8) {
        g.particles.spawn(e.pos.x + rand(-0.4, 0.4), 1, e.pos.z + rand(-0.4, 0.4), 0, 1.5, 0, 0.35, 0.7, 0xff7a3e, 2, 0);
      }
    }
    // 敌弹本地模拟
    for (const b of g.enemies.ebullets) {
      if (!b.active) continue;
      b.life -= dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.life <= 0 || Math.abs(b.pos.x) > g.arena + 2 || Math.abs(b.pos.z) > g.arena + 2) {
        b.active = false; b.mesh.visible = false;
        continue;
      }
      b.mesh.position.copy(b.pos);
    }
    // 预警圈动画
    for (const tg of g.enemies.telegraphs) {
      if (!tg.active) continue;
      tg.t += dt;
      const f = tg.t / tg.dur;
      if (f >= 1) { tg.active = false; tg.mesh.visible = false; continue; }
      const pulse = 0.75 + Math.sin(f * 25) * 0.25;
      tg.mesh.material.opacity = 0.25 + f * 0.65;
      tg.mesh.scale.setScalar((tg.isBoss ? 3.4 : 1.2) * (1.4 - f * 0.4) * pulse);
    }
    // 蛛网动画
    for (const w of g.enemies.webZones) {
      if (!w.active) continue;
      w.t += dt;
      if (w.t >= w.dur) { w.active = false; w.mesh.visible = false; continue; }
      const f = w.t / w.dur;
      w.mesh.scale.setScalar(w.r * (f < 0.12 ? f / 0.12 : 1));
      w.mesh.material.opacity = (0.22 + Math.sin(g.time * 4) * 0.06) * (f > 0.8 ? (1 - f) / 0.2 : 1);
    }
    // 宝石视觉（朝快照目标插值）
    g.pickups.updateGuest(dt, this.gemTargets);
    // 队友渲染
    for (const p of this.peers.values()) p.remote.update(dt, g.camera);
    // 曳光
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) { t.active = false; t.mesh.visible = false; continue; }
      t.mesh.position.x += t.vx * dt;
      t.mesh.position.z += t.vz * dt;
    }
    // 位置心跳
    this.posT -= dt;
    if (this.posT <= 0) { this.posT = POS_RATE; this.sendPos(); }
    // 伤害事件冲刷
    this.dmgT -= dt;
    if (this.dmgQueue.length && this.dmgT <= 0) {
      this.dmgT = DMG_RATE;
      this.send({ k: 'dmg', list: this.dmgQueue.splice(0, this.dmgQueue.length) });
    }
  }

  hostTickPeers(dt) {
    for (const p of this.peers.values()) p.remote.update(dt, this.game.camera);
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) { t.active = false; t.mesh.visible = false; continue; }
      t.mesh.position.x += t.vx * dt;
      t.mesh.position.z += t.vz * dt;
    }
  }

  // ============ 伤害事件 ============
  queueDmg(e, dmg, crit, knock, kx, kz) {
    const id = e.netId;
    if (id < 0) return;
    this.dmgQueue.push([id, e.generation, dmg, crit ? 1 : 0, knock, Math.round(kx), Math.round(kz)]);
  }

  _applyDmgEvents(list) {
    const g = this.game;
    for (const [id, generation, d, c, kn, kx, kz] of list) {
      const e = g.enemies.list[id];
      if (!e || !e.active || e.dying || e.generation !== generation) continue;
      g.damageEnemy(e, d, { crit: !!c, knock: kn, kx, kz });
    }
  }

  sendUltDmg(x, z) { this.send({ k: 'ultdmg', x: +x.toFixed(1), z: +z.toFixed(1) }); }
  sendPulseDmg(x, z) { this.send({ k: 'pulsedmg', x: +x.toFixed(1), z: +z.toFixed(1) }); }

  _applyUltDmg(d) {
    const g = this.game;
    for (const e of g.enemies.list) {
      if (!e.active || e.dying) continue;
      if (e.type === 'boss') g.damageEnemy(e, Math.round(e.maxHp * ULT.bossFrac), { crit: true });
      else g.damageEnemy(e, ULT.dmg, { crit: true, knock: 8, kx: e.pos.x - d.x, kz: e.pos.z - d.z });
    }
  }

  _applyPulseDmg(d) {
    const g = this.game;
    for (const e of g.enemies.list) {
      if (!e.active || e.dying) continue;
      const dd = dist2(d.x, d.z, e.pos.x, e.pos.z);
      if (dd < PULSE.radius * PULSE.radius) {
        g.damageEnemy(e, Math.round(PULSE.damage + e.maxHp * PULSE.maxHpBonus), { crit: true, knock: 20, kx: e.pos.x - d.x, kz: e.pos.z - d.z });
      }
    }
  }

  // ============ 视觉特效转发 ============
  sendFx(kind, data) { this.send({ k: 'fx', f: kind, ...data }); }

  _onFx(from, d) {
    const g = this.game;
    const p = this.peers.get(from);
    switch (d.f) {
      case 'tr': this.fireTracer(d.x, d.z, d.dx, d.dz); break;
      case 'bolt': g.weapons.fireBolt(d.x0, d.y0, d.z0, d.x1, d.y1, d.z1); break;
      case 'nova':
        g.shockwaves.fire(d.x, d.z, d.r, PALETTE.nova, 0.5);
        g.particles.burst(d.x, 0.6, d.z, 20, PALETTE.nova, { speed: 12, life: 0.5, size: 0.7 });
        break;
      case 'xpl':
        g.particles.burst(d.x, 0.6, d.z, 14, 0x6ef3ff, { speed: 9, life: 0.5, size: 0.7 });
        g.shockwaves.fire(d.x, d.z, d.r || 2.6, 0x6ef3ff, 0.4);
        break;
      case 'pulse': case 'ult': {
        const big = d.f === 'ult';
        if (p) { p.remote.tx = d.x; p.remote.tz = d.z; }
        g.shockwaves.fire(d.x, d.z, big ? 30 : PULSE.radius, big ? 0xd9b0ff : 0xd94eff, big ? 1.2 : 0.8);
        g.ui.flash(big ? 0.7 : 0.4, big ? 400 : 200);
        g.addTrauma(big ? 0.8 : 0.4);
        if (big) g.audio.ult(); else g.audio.pulse();
        break;
      }
      case 'dash': g.particles.burst(d.x, 0.7, d.z, 8, p ? p.remote.color : 0x2ee6ff, { speed: 5, life: 0.35, size: 0.6 }); break;
      case 'die': g.playDeathFx(d.x, d.z, 'chaser', false); break;
      case 'evo': g.ui.toast(d.txt, '#ffd23e'); break;
    }
  }

  dispose() {
    for (const p of this.peers.values()) p.remote.dispose(this.game.scene);
    this.peers.clear();
    for (const t of this.tracers) { t.active = false; t.mesh.visible = false; }
  }
}
