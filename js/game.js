// ============ 游戏主控：状态机 / 主循环 / 碰撞 / 相机 ============
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { ARENA, PALETTE, XP_CURVE, PULSE, SCORE, PLAYER, CHAIN, SUPPLY, ROUTES, ROUTE_TIERS, ULT } from './config.js';
import { clamp, damp, rand, dist2, SpatialHash, shakeNoise, segmentCircleHitFraction } from './utils.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { buildWorld } from './world.js';
import { Particles, Shockwaves, FloatTexts, Debris } from './particles.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { Enemies } from './enemies.js';
import { Pickups } from './pickups.js';
import { Upgrades, UPGRADES } from './upgrades.js';
import { UI } from './ui.js';
import { Net, genRoomCode, genPassword, defaultWsUrl } from './net.js';
import { MpSession } from './mp.js';
import { Reactor, REACTOR } from './reactor.js';
import { loadSettings, saveSettings } from './settings.js';
import { getPlanet, isPlanetId, applyPlanetStats } from './planets.js';

import { bestRecord, recordKey, saveRecord } from './records.js';
import { MISSION, missionComplete, DAMAGE_NAMES, ENEMY_NAMES } from './mission.js';

const CAM_OFFSET = new THREE.Vector3(0, 28.5, 15.5);
const MP_ARENA = 80;
const RESPAWN_TIME = 10;

export class Game {
  constructor(container) {
    const params = new URLSearchParams(location.search);
    this.settings = loadSettings();
    const lowfx = params.has('lowfx') || this.settings.quality === 'low';
    this.bench = params.has('bench');   // 测试模式：跳过渲染只跑逻辑
    // —— 渲染器 ——
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowfx, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(lowfx ? 1 : Math.min(devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
    this.camera.position.copy(CAM_OFFSET);

    // —— 后期：辉光（lowfx 模式关闭）——
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (!lowfx) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.5, 0.45);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.setQuality(lowfx ? 'low' : 'high');

    // —— 系统 ——
    this.reactor = new Reactor();
    this.audio = new AudioEngine(this.settings);
    this.input = new Input(this.renderer.domElement);
    this.input.onFirstGesture = () => { this.audio.init(); this.audio.resume(); };
    this.planet = getPlanet(localStorage.getItem('vp_planet'));
    this.world = buildWorld(this.scene, ARENA, this.planet);
    this.particles = new Particles(this.scene);
    this.shockwaves = new Shockwaves(this.scene);
    this.debris = new Debris(this.scene);
    this.texts = new FloatTexts(this.camera);
    this.player = new Player(this.scene);
    this.weapons = new Weapons(this.scene, this);
    this.enemies = new Enemies(this.scene, this);
    this.pickups = new Pickups(this.scene, this);
    this.upgrades = new Upgrades(this);
    this.ui = new UI(this);
    this.ui.bind({
      onStart: () => this.start(),
      onResume: () => this.togglePause(),
      onQuit: () => this.quitToTitle(),
      onRetry: () => (this.mp ? this.quitToLobby() : this.start()),
    });

    this.enemyHash = new SpatialHash(3);
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.75);
    this._camTarget = new THREE.Vector3();
    this._camPos = new THREE.Vector3().copy(CAM_OFFSET);
    this.clock = new THREE.Clock();

    // —— 状态 ——
    this.state = 'title';       // title | lobby | playing | levelup | paused | dying | gameover
    this.time = 0;
    this.score = 0;
    this.pulse = 0;
    this.sector = 1;
    this.trauma = 0;
    this.slowT = 0; this.slowScale = 1;
    this.timeScale = 1;
    this.pendingLevels = 0;
    this.dyingT = 0;
    this.pendingCards = null;
    this.cardOpen = false;      // 联机非阻塞选卡
    this.best = bestRecord(recordKey(this.planet.id));
    this.damageBySource = {};
    this.runOutcome = null; this.endless = false;
    this.lastDamageCause = '信号丢失';
    this.ambientT = 0;
    // 联机
    this.mp = null;
    this.net = null;
    this.arena = ARENA;
    this.myName = '玩家' + Math.floor(100 + Math.random() * 900);
    // 连锁击杀
    this.chain = 0;
    this.chainT = 0;
    this.chainWindow = CHAIN.window;
    this.chainScoreMul = 1;
    this.zoneSlowFactor = 1;
    this.supplyAt = SUPPLY.firstAt;
    // 流派羁绊
    this.routes = { pyro: 0, volt: 0, void: 0 };
    this.routeTiers = { pyro: 0, volt: 0, void: 0 };
    this.routeFx = { dmg: 1, rate: 1 };
    this.voltSmiteT = 5;
    this.voidNovaCd = 0;
    this.voidDevourT = 8;
    this.lastMilestoneT = -1;
    // 湮灭协议
    this.ult = 0;
    this.ultUses = 0;
    this.ultBeamT = 0;

    // 湮灭光束柱（大招视觉）
    this.ultBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 3.4, 60, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xd9b0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    this.ultBeam.visible = false;
    this.scene.add(this.ultBeam);

    this.ui.setMuted(this.audio.muted);
    this.ui.showTitle(this.best);

    addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && !this.mp) this.togglePause(true);
      // 房主切后台 → 全队暂停，广播提醒
      if (this.mpIsHost()) {
        if (document.hidden) this.mp.send({ k: 'hostaway' });
        else this.mp.send({ k: 'hostback' });
      } else if (this.mp && this.state === 'playing') this.mp.setLocalAway(document.hidden);
      // Never catch up time spent in another tab after visibility is restored.
      this.clock.getDelta();
      this._skipElapsed = true;
    });

    // 调试钩子（无头测试用）
    window.__DBG = {
      game: this,
      giveXp: (n) => this.addXp(n),
      hurt: (n) => { this.player.stats.hp -= n; },
      boss: () => { this.enemies.bossAt = this.time; },
      god: () => { this.player.stats.armor = 9999; },
      state: () => this.state,
    };

    this.renderer.setAnimationLoop(() => this.frame());
  }

  setQuality(quality) {
    const low = quality === 'low';
    this.settings.quality = low ? 'low' : 'high';
    if (!low && !this.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.5, 0.45);
      this.composer.insertPass(this.bloom, 1);
    }
    if (this.bloom) this.bloom.enabled = !low;
    this.renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 1.75));
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(innerWidth, innerHeight);
  }

  refreshRecord() {
    const count = this.mp ? (this.state === 'lobby' ? this.mp.playerCount : (this.runPlayerCount || this.mp.participantCount)) : 1;
    this.recordId = recordKey(this.planet.id, count || 1, !!this.mp, this.endless);
    this.best = bestRecord(this.recordId);
  }

  runSummary() {
    const build = UPGRADES.filter((u) => this.upgrades.level(u.id) > 0)
      .map((u) => `${u.name} ${this.upgrades.level(u.id)}${this.weapons.evolved[u.id] ? '★' : ''}`).join(' · ');
    const totals = this.damageBySource[this.net?.id ?? 'solo'] || {};
    return {
      cause: this.runOutcome === 'victory' ? '能源网络修复完成，战机撤离条件已达成' : this.lastDamageCause,
      build, planet: this.planet.name,
      mode: `${this.mp ? `${this.runPlayerCount}人合作` : '单人'}${this.endless ? '无尽' : '任务'}`,
      damage: Object.entries(totals).map(([kind, value]) => ({ name: DAMAGE_NAMES[kind] || DAMAGE_NAMES.direct, value: Math.round(value) })).sort((a, b) => b.value - a.value),
    };
  }

  saveRunRecord() {
    const { isBest, best } = saveRecord(this.recordId, {
      score: this.score, time: this.time, planet: this.planet.id, players: this.runPlayerCount || 1,
      outcome: this.runOutcome, build: this.runSummary().build,
    });
    this.best = best;
    return isBest;
  }

  completeMission(data) {
    if (this.endless || this.runOutcome === 'victory' || this.state !== 'playing') return;
    const d = data || { k: 'mission', sc: Math.floor(this.score), tm: this.time, kl: this.player.kills,
      lv: this.player.level, sec: this.sector, damage: this.damageBySource, reactor: this.reactor.snapshot() };
    this.score = d.sc; this.time = d.tm;
    if (d.damage) this.damageBySource = d.damage;
    if (d.reactor) Object.assign(this.reactor, d.reactor);
    this.runOutcome = 'victory'; this.state = 'gameover';
    this.ui.closeSettings(); this.ui.closeBuild?.(); this.ui.closeMenu?.();
    this.ui.hideLevelUp(); this.cardOpen = false;
    const isBest = this.saveRunRecord();
    if (this.mpIsHost() && !data) this.mp.send(d);
    if (this.mp) this.ui.showMpGameOver({ score: d.sc, time: d.tm, kills: d.kl, level: d.lv, sector: d.sec, isBest }, this.mpIsHost());
    else this.ui.showGameOver({ score: d.sc, time: d.tm, kills: d.kl, level: d.lv, sector: d.sec }, isBest);
    this.audio.reactorCapture();
  }

  continueEndless(fromHost = false) {
    if (this.state !== 'gameover' || this.runOutcome !== 'victory' || (this.mp && !this.mp.isHost && !fromHost)) return;
    if (this.mpIsHost()) this.mp.send({ k: 'endless' });
    this.endless = true; this.runOutcome = null; this.state = 'playing';
    this.mp?.resumeRunPresence();
    this.refreshRecord();
    this.timeScale = 1; this.slowT = 0;
    this.clock.getDelta(); this.input.clear();
    this.ui.showHud();
    if (this.mp && this.player.dead) this.ui.respawnOverlay(true);
    this.ui.toast('无尽挑战开启 · 保留构筑，继续创造纪录', '#ffd23e');
  }

  // ============ 联机：模式/大厅 ============
  setArena(size, force = false) {
    if (size === this.arena && !force) return;
    this.arena = size;
    if (this.world) {
      this.scene.remove(this.world.root);
      this.world.dispose?.();
    }
    this.world = buildWorld(this.scene, size, this.planet);
  }

  selectPlanet(id, fromHost = false) {
    if (!isPlanetId(id) || !['title', 'lobby', 'gameover'].includes(this.state)) return false;
    if (this.mp && !this.mp.isHost && !fromHost) return false;
    if (this._mpBeginPending) return false;
    if (this.planet.id !== id) {
      this.planet = getPlanet(id);
      this.setArena(this.arena, true);
    }
    if (!fromHost) localStorage.setItem('vp_planet', id);
    this.refreshRecord();
    this.ui.refreshPlanets();
    if (this.mpIsHost() && !fromHost) this.mp.send({ k: 'planet', id });
    return true;
  }

  mpIsHost() { return !!(this.mp && this.mp.isHost); }
  // 敌人生成/强度缩放（联机人越多越猛）
  mpPlayerCount() { return this.mp ? this.mp.participantCount : 1; }
  mpSpawnRateScale() { return this.mp ? 1 + 0.25 * (this.mp.participantCount - 1) : 1; }
  mpCapScale() { return this.mp ? 1 + 0.38 * (this.mp.participantCount - 1) : 1; }
  mpHpScale() { return this.mp ? 1 + 0.2 * (this.mp.participantCount - 1) : 1; }
  mpSupplyEvery() { return this.mp ? 35 : 55; }
  mpSendFx(kind, data) { if (this.mp) this.mp.sendFx(kind, data); }

  // 敌人 AI 目标：最近的存活玩家（含位置/速度）
  playerTarget(x, z) {
    const p = this.player;
    let bx = p.pos.x, bz = p.pos.z, bvx = p.vel.x, bvz = p.vel.z;
    let bd = (p.alive && !p.dead) ? dist2(x, z, bx, bz) : Infinity;
    if (this.mp) {
      for (const q of this.mp.peers.values()) {
        if (!this.mp.peerAvailable(q)) continue;
        const d = dist2(x, z, q.x, q.z);
        if (d < bd) { bd = d; bx = q.x; bz = q.z; bvx = q.vx || 0; bvz = q.vz || 0; }
      }
    }
    return { x: bx, z: bz, vx: bvx, vz: bvz };
  }

  alivePlayerPositions() {
    const list = [];
    const p = this.player;
    if (p.alive && !p.dead) list.push({ x: p.pos.x, z: p.pos.z, vx: p.vel.x, vz: p.vel.z });
    if (this.mp) {
      for (const q of this.mp.peers.values()) {
        if (this.mp.peerAvailable(q)) list.push({ x: q.x, z: q.z, vx: q.vx || 0, vz: q.vz || 0 });
      }
    }
    return list;
  }

  randomAlivePlayerPos() {
    const list = this.alivePlayerPositions();
    if (list.length === 0) return { x: 0, z: 0, vx: 0, vz: 0 };
    return list[Math.floor(Math.random() * list.length)];
  }

  findSupplyPosition(target) {
    const golden = 2.399963;
    const base = rand(Math.PI * 2);
    for (let i = 0; i < 18; i++) {
      const a = base + i * golden;
      const d = rand(8, 17);
      const x = target.x + Math.cos(a) * d;
      const z = target.z + Math.sin(a) * d;
      if (this.world.isSpawnClear(x, z, 1.7)) return { x, z };
    }
    return null;
  }

  arenaHazardFactorAt(x, z) {
    return this.world.hazardAt(x, z) ? this.planet.hazard.slow : 1;
  }

  getPickupPlayers() {
    const p = this.player;
    if (!this.mp) {
      return (p.alive && !p.dead) ? [{ id: 0, x: p.pos.x, z: p.pos.z, magnet: p.stats.magnet, self: true }] : [];
    }
    return this.mp.alivePlayerInfos();
  }

  // 创建房间
  async mpCreate(name) {
    const room = genRoomCode(), pass = genPassword();
    this.ui.setMpStatus('连接中继服务器…');
    try {
      await this._mpConnect(name);
      this.pendingRoom = { room, pass };
      this.net.create(room, pass);
    } catch (e) {
      this.ui.setMpStatus('连接失败：' + e.message);
    }
  }

  // 加入房间
  async mpJoin(name, room, pass) {
    this.ui.setMpStatus('连接中继服务器…');
    try {
      await this._mpConnect(name);
      this.net.join(room.trim().toUpperCase(), pass.trim());
    } catch (e) {
      this.ui.setMpStatus('连接失败：' + e.message);
    }
  }

  async _mpConnect(name) {
    this.net = new Net();
    this.myName = name;
    this.net.on('created', () => {
      this.mp = new MpSession(this, this.net, name);
      this.state = 'lobby';
      this.ui.showLobby(true, this.pendingRoom.room, this.pendingRoom.pass, this.mp.roster());
    });
    this.net.on('joined', (msg) => {
      this.mp = new MpSession(this, this.net, name);
      for (const peer of msg.peers) this.mp._addPeer(peer.id, peer.name);
      this.state = 'lobby';
      this.ui.showLobby(false, msg.room, null, this.mp.roster());
      this.mp.send({ k: 'planetRequest' });
    });
    this.net.on('err', (m) => {
      this.ui.setMpStatus(m);
      this.net.close();
      this.net = null;
    });
    await this.net.connect(defaultWsUrl());   // 失败会抛异常
    this.net.sendName(name);
  }

  // 房主点击开始
  async mpBegin() {
    if (!this.mpIsHost() || this._mpBeginPending) return;
    this._mpBeginPending = true;
    const locked = await this.net.lockRoom(true);
    this._mpBeginPending = false;
    if (!locked || !this.mpIsHost() || this.state !== 'lobby') {
      if (!locked) this.ui.toast('房间锁定失败，请重试', '#ff6b81');
      return;
    }
    this.mp.send({ k: 'begin', planet: this.planet.id });
    this.startMp();
  }

  // 收到 begin（或房主自己）→ 开局
  startMp(planetId = this.planet.id) {
    if (!this.mp || !['lobby', 'gameover'].includes(this.state) || !isPlanetId(planetId)) return;
    this.selectPlanet(planetId, true);
    this.mp.markRunParticipants();
    this.setArena(MP_ARENA);
    this.resetRun();
    this.state = 'playing';
    this.ui.showHud();
    this.ui.hideLobby();
    this.audio.init(); this.audio.resume();
    this.ui.toast(`⚔ ${this.planet.name} · ${this.mp.participantCount} 人小队出击！`, this.planet.color);
  }

  // 联机团灭（主机广播或本地判定）
  mpGameOver(d) {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    this.score = d.sc;
    this.time = d.tm;
    this.runOutcome = 'defeat';
    if (d.damage) this.damageBySource = d.damage;
    if (d.reactor) Object.assign(this.reactor, d.reactor);
    const isBest = this.saveRunRecord();
    this.ui.hideLevelUp(); this.cardOpen = false;
    this.ui.showMpGameOver({
      score: d.sc, time: d.tm, kills: d.kl, level: d.lv, sector: d.sec,
      isBest,
    }, this.mpIsHost());
  }

  // 团灭后回到大厅
  quitToLobby(fromHost = false) {
    if (!this.mp || !this.net?.connected) {
      this.quitToTitle(); this.ui.toast('连接已断开，请重新创建或加入房间', '#ff6b81'); return;
    }
    if (!this.mp.isHost && this.runOutcome === 'victory' && !fromHost) {
      this.ui.toast('等待房主选择继续无尽或全队返回大厅', '#ffd23e'); return;
    }
    if (this.mpIsHost()) this.mp.send({ k: 'lobby' });
    this.resetRun();
    this.state = 'lobby';
    if (this.mpIsHost()) void this.net.lockRoom(false);
    this.ui.showLobby(this.mpIsHost(), this.mp.room, null, this.mp.roster());
  }

  hostCheckWipe() {
    if (!this.mpIsHost()) return;
    const p = this.player;
    if (p.alive && !p.dead) return;
    for (const q of this.mp.peers.values()) if (q.participant && (this.mp.peerAvailable(q) || this.mp.peerPending(q))) return;
    // 团灭
    const score = Math.floor(this.score);
    const d = { k: 'gov', sc: score, tm: this.time, kl: p.kills, lv: p.level, sec: this.sector, damage: this.damageBySource, reactor: this.reactor.snapshot() };
    this.mp.send(d);
    this.mpGameOver(d);
  }

  // ============ 状态切换 ============
  start() {
    // 单机模式
    if (this.mp) { this.mp.dispose(); this.mp = null; }
    if (this.net) { this.net.close(); this.net = null; }
    this.setArena(ARENA);
    this.resetRun();
    this.state = 'playing';
    this.ui.showHud();
    this.audio.init(); this.audio.resume();
    this.ui.toast(`${this.planet.name} · ${this.planet.perk}`, this.planet.color);
  }

  resetRun() {
    this.input.clear(); this.pendingCards = null;
    this.runPlayerCount = this.mp ? this.mp.participantCount : 1;
    this.time = 0; this.score = 0; this.pulse = 0; this.sector = 1;
    this.trauma = 0; this.slowT = 0; this.timeScale = 1;
    this.pendingLevels = 0; this.dyingT = 0;
    this.cardOpen = false;
    this.rerolls = 2;
    this.runOutcome = null; this.endless = false; this.damageBySource = {};
    this.lastDamageCause = '信号丢失'; this._damageContext = null;
    this.tutorialXpSpawned = false; this.rescueActive = false;
    this.refreshRecord();
    this.reactor.reset();
    this.reactorRewardCycle = -1;
    this.reactorNoticeCycle = -1;
    this.ui?.closeSettings();
    this.ui?.closeBuild?.(); this.ui?.closeMenu?.();
    if (this.mp) this.mp.resetRunState();
    this.chain = 0; this.chainT = 0;
    this.chainWindow = CHAIN.window; this.chainScoreMul = 1;
    this.zoneSlowFactor = 1;
    this.arenaEventSeen = -1;
    this.arenaHazardDamageT = 0.35;
    this.supplyAt = SUPPLY.firstAt;
    this.routes = { pyro: 0, volt: 0, void: 0 };
    this.routeTiers = { pyro: 0, volt: 0, void: 0 };
    this.routeFx = { dmg: 1, rate: 1 };
    this.voltSmiteT = 5; this.voidNovaCd = 0; this.voidDevourT = 8;
    this.lastMilestoneT = -1;
    this.ult = 0; this.ultUses = 0; this.ultBeamT = 0;
    this.ultBeam.visible = false;
    this.player.reset();
    applyPlanetStats(this.player.stats, this.planet);
    this.sporeDamageT = 0.5;
    this.weapons.reset();
    this.enemies.reset();
    this.pickups.reset();
    this.particles.clear();
    this.shockwaves.clear();
    this.debris.clear();
    this.texts.clear();
    this.upgrades.reset();
    this.ui.showBossBanner(false);
    this.ui.setBossHp(-1);
    this.ui.hideLevelUp();
    this.ui.respawnOverlay(false);
  }

  quitToTitle() {
    this.resetRun();
    if (this.mp) { this.mp.dispose(); this.mp = null; }
    if (this.net) { this.net.close(); this.net = null; }
    const personalPlanet = getPlanet(localStorage.getItem('vp_planet'));
    const changed = personalPlanet.id !== this.planet.id;
    this.planet = personalPlanet;
    this.setArena(ARENA, changed);
    this.state = 'title';
    this.ui.hideLobby();
    this.refreshRecord();
    this.ui.showTitle(this.best);
  }

  togglePause(force) {
    if (this.state === 'playing' || force === true) {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.ui.showPause(true);
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.ui.showPause(false);
    }
  }

  gameOver() {
    this.runOutcome = 'defeat';
    this.state = 'dying';
    this.dyingT = 1.5;
    this.player.alive = false;
    this.player.mesh.visible = false;
    this.slowmo(1.1, 0.22);
    this.addTrauma(1);
    this.particles.burst(this.player.pos.x, 0.8, this.player.pos.z, 70, PALETTE.player, { speed: 16, life: 1.1, size: 0.9 });
    this.particles.burst(this.player.pos.x, 0.8, this.player.pos.z, 30, 0xffffff, { speed: 9, life: 0.8, size: 0.7 });
    this.shockwaves.fire(this.player.pos.x, this.player.pos.z, 10, PALETTE.player, 0.9);
    this.audio.explode(true);
    this.audio.gameover();
  }

  finalizeGameOver() {
    this.state = 'gameover';
    const score = Math.floor(this.score);
    const isBest = this.saveRunRecord();
    this.ui.showGameOver({
      score, time: this.time, kills: this.player.kills,
      level: this.player.level, sector: this.sector,
    }, isBest);
  }

  // ============ 经验 / 升级 ============
  addXp(v) {
    const p = this.player;
    p.xp += v;
    while (p.xp >= XP_CURVE(p.level)) {
      p.xp -= XP_CURVE(p.level);
      p.level++;
      this.pendingLevels++;
      // 主机：广播团队升级
      if (this.mpIsHost()) this.mp.send({ k: 'lv' });
    }
  }

  addUltCharge(v) {
    this.ult = Math.min(ULT.max, this.ult + (v * ULT.perGem) / (1 + this.ultUses * ULT.inflation));
  }

  // 宝石被拾取（主机/单机结算；客机由 mp 事件驱动）
  onGemPicked(gem, pl, idx) {
    if (!this.mp) {
      this.addXp(gem.value);
      this.addUltCharge(gem.value);
      this.audio.pickup();
      this.particles.burst(pl.x, 0.8, pl.z, 3, PALETTE.gem, { speed: 3, life: 0.25, size: 0.5, grav: 0 });
      return;
    }
    if (!this.mp.isHost) return;   // 客机无拾取逻辑
    // 主机：团队经验 + 通知
    this.addXp(gem.value);
    if (pl.self) {
      this.addUltCharge(gem.value);
      this.audio.pickup();
    }
    this.mp.send({ k: 'gp', id: idx, by: pl.id, v: gem.value, x: +pl.x.toFixed(1), z: +pl.z.toFixed(1) });
    this.particles.burst(pl.x, 0.8, pl.z, 3, PALETTE.gem, { speed: 3, life: 0.25, size: 0.5, grav: 0 });
  }

  onHeartPicked(h, pl, idx) {
    const healSelf = !this.mp || pl.self;
    if (this.mpIsHost()) this.mp.send({ k: 'hpk', id: idx, by: pl.id });
    if (healSelf) {
      const healed = this.player.heal(SCORE.heartHeal);
      if (healed > 0) {
        this.texts.fire(this.player.pos.x, 1.6, this.player.pos.z, `+${Math.round(healed)}`, 'heal');
        this.audio.heart();
        this.particles.burst(this.player.pos.x, 1, this.player.pos.z, 12, PALETTE.heart, { speed: 5, life: 0.5, size: 0.6, grav: 2 });
      }
    }
  }

  onSupplyTaken(x, z, pl, id) {
    const isSelf = !this.mp || pl.self;
    if (this.mpIsHost()) this.mp.send({ k: 'supT', id, x: +x.toFixed(1), z: +z.toFixed(1), by: pl.id });
    if (isSelf) this.player.heal(SUPPLY.heal);
    this.addScore(Math.round(SUPPLY.score * this.chainMul()));
    this.pickups.magnetAll();
    this.texts.fire(x, 1.8, z, `+${SUPPLY.score}`, 'crit');
    this.audio.heart();
    this.shockwaves.fire(x, z, 4, 0xffd23e, 0.6);
    this.particles.burst(x, 1, z, 24, 0xffd23e, { speed: 8, life: 0.7, size: 0.7, grav: 2 });
  }

  // 最密集敌群中心（雷神用）
  densestCluster() {
    let best = null, bestN = 2;
    const buf = this._clusterBuf || (this._clusterBuf = new Array(48));
    for (const e of this.enemies.list) {
      if (!e.active || e.dying) continue;
      const n = this.enemyHash.query(e.pos.x, e.pos.z, 4, buf);
      if (n > bestN) { bestN = n; best = e; }
    }
    return best ? { x: best.pos.x, z: best.pos.z } : null;
  }

  // ============ 湮灭协议 ============
  activateUlt() {
    if (this.ult < ULT.max || this.state !== 'playing' || this.player.dead) return;
    this.ult = 0;
    this.ultUses++;
    const p = this.player;
    if (this.mp && !this.mp.isHost) {
      this.enemies.clearEBullets();
      this.mp.sendUltDmg(p.pos.x, p.pos.z);
    } else this.resolveUltDamage({ sourceId: this.net?.id ?? 'solo', x: p.pos.x, z: p.pos.z });
    //  cinematic：光束柱 + 全屏冲击 + 慢动作
    this.ultBeamT = 0.9;
    this.ultBeam.visible = true;
    this.ultBeam.position.set(p.pos.x, 30, p.pos.z);
    this.ui.flash(0.9, 500);
    this.ui.toast('☢ 湮灭协议 —— 全场清除', '#d9b0ff');
    this.shockwaves.fire(p.pos.x, p.pos.z, 30, 0xd9b0ff, 1.2);
    this.shockwaves.fire(p.pos.x, p.pos.z, 18, 0xffffff, 0.8);
    this.particles.burst(p.pos.x, 1, p.pos.z, 80, 0xd9b0ff, { speed: 24, life: 1, size: 1, grav: 0 });
    this.slowmo(ULT.slowmoTime, ULT.slowmoScale);
    this.addTrauma(1);
    this.audio.ult();
    this.mpSendFx('ult', { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1) });
  }

  updateReactor(dt, isGuest) {
    const r = this.reactor;
    if (!isGuest) {
      const enemies = this.enemies.list.filter((e) => e.active && !e.dying).map((e) => e.pos);
      const captured = r.tick(this.time, dt, this.alivePlayerPositions(), enemies);
      if (captured) {
        this.addScore(400);
        this.rewardReactor(r.cycle);
        if (this.mpIsHost()) this.mp.send({ k: 'reactorReward', cycle: r.cycle });
      }
    }
    if (r.phase === 'active' && this.reactorNoticeCycle !== r.cycle) {
      this.reactorNoticeCycle = r.cycle;
      this.ui.toast('反应堆上线 · 进入中央光环充能', '#ffd23e');
      this.audio.reactorReady();
    }
  }

  rewardReactor(cycle) {
    if (cycle <= this.reactorRewardCycle) return;
    this.reactorRewardCycle = cycle;
    if (this.player.alive && !this.player.dead) {
      const healed = this.player.heal(REACTOR.heal);
      if (healed) this.texts.fire(this.player.pos.x, 1.8, this.player.pos.z, `+${Math.round(healed)}`, 'heal');
    }
    this.pulse = Math.min(PULSE.max, this.pulse + REACTOR.pulse);
    this.ui.toast('能源解放！全队修复 +18 · 超载 +25 · 18秒急速', '#4dff88');
    this.audio.reactorCapture();
    this.shockwaves.fire(0, 0, 13, 0x4dff88, 1);
    this.particles.burst(0, 1.5, 0, 36, 0x4dff88, { speed: 12, life: 0.8, size: 0.8 });
  }

  rerollCards() {
    if (this.rerolls <= 0 || !(this.cardOpen || this.state === 'levelup')) return;
    this.rerolls--;
    this.pendingCards = this.upgrades.rollCards(3, this.pendingCards);
    this.ui.showLevelUp(this.pendingCards, this.pendingCards.map((c) => this.upgrades.cardView(c)), (i) => this.pickCard(i));
    this.audio.cardPick();
  }

  enterLevelUp() {
    // 联机：非阻塞选卡（世界继续运转）
    if (this.mp) {
      this.cardOpen = true;
      this.audio.levelup();
      this.pendingCards = this.upgrades.rollCards(3);
      const views = this.pendingCards.map((c) => this.upgrades.cardView(c));
      this.ui.showLevelUp(this.pendingCards, views, (i) => this.pickCard(i));
      return;
    }
    this.state = 'levelup';
    this.audio.levelup();
    this.shockwaves.fire(this.player.pos.x, this.player.pos.z, 4, PALETTE.gem, 0.6);
    this.particles.burst(this.player.pos.x, 1, this.player.pos.z, 24, PALETTE.gem, { speed: 7, life: 0.7, size: 0.6, grav: 3 });
    this.pendingCards = this.upgrades.rollCards(3);
    const views = this.pendingCards.map((c) => this.upgrades.cardView(c));
    this.ui.showLevelUp(this.pendingCards, views, (i) => this.pickCard(i));
  }

  pickCard(i) {
    if (this.mp && this.cardOpen) {
      const card = this.pendingCards && this.pendingCards[i];
      if (!card) return;
      this.upgrades.apply(card);
      this.player.iFrames = Math.max(this.player.iFrames, 0.8);
      this.audio.cardPick();
      this.recountRoutes();
      this.pendingLevels--;
      this.pendingCards = null;
      if (this.pendingLevels > 0) {
        this.cardOpen = false;
        this.enterLevelUp();
      } else {
        this.cardOpen = false;
        this.ui.hideLevelUp();
      }
      return;
    }
    if (this.state !== 'levelup' || !this.pendingCards) return;
    const card = this.pendingCards[i];
    if (!card) return;
    this.upgrades.apply(card);
    this.player.iFrames = Math.max(this.player.iFrames, 0.8);
    this.audio.cardPick();
    this.recountRoutes();
    this.pendingLevels--;
    this.pendingCards = null;
    if (this.pendingLevels > 0) {
      this.enterLevelUp();
    } else {
      this.ui.hideLevelUp();
      this.state = 'playing';
    }
  }

  // ============ 战斗结算 ============
  addScore(n) { this.score += n; }

  recordDamage(sourceId, damageKind, amount) {
    if (!(amount > 0)) return;
    const id = sourceId ?? this.net?.id ?? 'solo';
    const totals = this.damageBySource[id] || (this.damageBySource[id] = {});
    totals[damageKind] = (totals[damageKind] || 0) + amount;
  }

  damageEnemy(e, dmg, options = {}) {
    if (!e.active || e.dying || !Number.isFinite(dmg) || dmg <= 0) return;
    const context = this._damageContext || {};
    const { crit = false, knock = 0, kx = 0, kz = 0 } = options;
    const sourceId = options.sourceId ?? context.sourceId ?? this.net?.id ?? 'solo';
    const damageKind = options.damageKind ?? context.damageKind ?? 'direct';
    const localSource = sourceId === (this.net?.id ?? 'solo');
    const skill = context.skill || ['pulse', 'ult'].includes(damageKind);
    const burnDps = skill ? 0 : Math.max(0, options.burnDps ?? (localSource && this.routeTiers.pyro >= 3 ? dmg * 0.2 : 0));
    e.flashT = 0.09; e.punchT = 0.14;
    if (this.mp && !this.mp.isHost) {
      this.texts.fire(e.pos.x, 1.4, e.pos.z, String(dmg), crit ? 'crit' : '');
      this.audio.enemyHit();
      this.mp.queueDmg(e, dmg, crit, knock, kx, kz, { burnDps, damageKind });
      return;
    }
    this.recordDamage(sourceId, damageKind, Math.min(Math.max(0, e.hp), dmg));
    e.hp -= dmg;
    if (burnDps > 0) {
      if (e.burnT <= 0 || burnDps >= e.burnDps) {
        e.burnDps = burnDps; e.burnSourceId = sourceId;
        if (e.burnT <= 0) e.burnAcc = 0;
      }
      e.burnT = 3;
    }
    if (knock !== 0 && e.knockRes < 1) {
      const kl = Math.hypot(kx, kz) || 1;
      e.vel.x += (kx / kl) * knock * (1 - e.knockRes);
      e.vel.z += (kz / kl) * knock * (1 - e.knockRes);
    }
    this.texts.fire(e.pos.x, 1.4, e.pos.z, String(dmg), crit ? 'crit' : '');
    this.audio.enemyHit();
    if (e.hp <= 0) this.killEnemy(e, { sourceId, damageKind });
  }

  resolvePulseDamage(source) { this.resolveSkillDamage('pulse', source); }
  resolveUltDamage(source) { this.resolveSkillDamage('ult', source); }
  resolveSkillDamage(kind, source) {
    this.enemies.clearEBullets();
    if (this.mpIsHost()) this.mp.send({ k: 'ceb' });
    const oldContext = this._damageContext;
    this._damageContext = { ...source, damageKind: kind, skill: true, refundLeft: PULSE.skillRefundCap };
    try {
      for (const e of this.enemies.list) {
        if (!e.active || e.dying) continue;
        if (kind === 'pulse' && dist2(source.x, source.z, e.pos.x, e.pos.z) >= PULSE.radius ** 2) continue;
        const dmg = kind === 'pulse' ? Math.round(PULSE.damage + e.maxHp * PULSE.maxHpBonus)
          : e.type === 'boss' ? Math.round(e.maxHp * ULT.bossFrac) : ULT.dmg;
        this.damageEnemy(e, dmg, { crit: true, knock: kind === 'pulse' ? 20 : 8, kx: e.pos.x - source.x, kz: e.pos.z - source.z });
      }
    } finally { this._damageContext = oldContext; }
  }

  // 死亡特效（主机击杀与客机回放共用）
  playDeathFx(x, z, type, elite) {
    const big = type === 'tank' || type === 'boss' || elite;
    const color = PALETTE[type] || 0xff3e6d;
    this.debris.burst(x, 0.6, z, color, big ? 5 : 3, big ? 12 : 8);
    const n = type === 'boss' ? 90 : big ? 34 : 14;
    this.particles.burst(x, 0.7, z, n, color,
      { speed: type === 'boss' ? 18 : big ? 11 : 7, life: big ? 0.8 : 0.5, size: big ? 0.9 : 0.6 });
    if (big) this.particles.burst(x, 0.7, z, 12, 0xffffff, { speed: 6, life: 0.4, size: 0.6 });
    this.shockwaves.fire(x, z, type === 'boss' ? 12 : big ? 4.5 : 2, color, big ? 0.7 : 0.4);
    this.audio.killPop();
    if (big) {
      this.audio.explode(true);
      this.addTrauma(type === 'boss' ? 1 : 0.4);
      this.slowmo(0.05, 0.1);
    } else {
      this.addTrauma(0.06);
    }
  }

  chainMul() {
    let mul = 1;
    for (const t of CHAIN.tiers) if (this.chain >= t.n) mul = t.mul;
    return mul * this.chainScoreMul;
  }

  // ============ 流派羁绊 ============
  recountRoutes() {
    for (const r of Object.keys(ROUTES)) this.routes[r] = 0;
    for (const u of UPGRADES) {
      if (u.route) this.routes[u.route] += this.upgrades.level(u.id);
    }
    let leveledUp = null;
    for (const r of Object.keys(ROUTES)) {
      const lv = this.routes[r];
      const tier = lv >= ROUTE_TIERS[2] ? 3 : lv >= ROUTE_TIERS[1] ? 2 : lv >= ROUTE_TIERS[0] ? 1 : 0;
      if (tier > this.routeTiers[r]) {
        this.routeTiers[r] = tier;
        leveledUp = { route: r, tier };
      }
    }
    // 常驻加成
    this.routeFx.dmg = this.routeTiers.pyro >= 1 ? 1.12 : 1;
    this.routeFx.rate = this.routeTiers.volt >= 1 ? 1.12 : 1;
    if (leveledUp) this.onRouteTierUp(leveledUp.route, leveledUp.tier);
  }

  onRouteTierUp(route, tier) {
    const R = ROUTES[route];
    this.ui.toast(`${R.icon} ${R.name}流派 · 觉醒【${R.tiers[tier - 1]}】`, R.color);
    this.audio.levelup();
    this.shockwaves.fire(this.player.pos.x, this.player.pos.z, 5, parseInt(R.color.slice(1), 16), 0.7);
    if (route === 'void' && tier === 1) {
      this.player.stats.maxHp += 20;
      this.player.stats.armor += 1;
      this.player.heal(20);
    }
  }

  killEnemy(e, options = {}) {
    if (e.dying) return;
    // 自爆蜂被击杀 → 殉爆（只伤敌人，连锁反应）
    if (e.type === 'bomber' && !e.fuseDone) { this.enemies.bomberBlast(e, false); return; }
    e.dying = true;
    const p = this.player;
    p.kills++;

    // —— 连锁 ——
    this.chain++;
    this.chainT = this.chainWindow;
    const mul = this.chainMul();
    this.score += Math.round(e.score * mul);
    let qp = e.type === 'boss' ? PULSE.perBossKill : PULSE.perKill;
    const ctx = this._damageContext;
    if (ctx?.skill && e.type !== 'boss') {
      qp = Math.min(ctx.refundLeft, qp * PULSE.skillKillChargeMul);
      ctx.refundLeft -= qp;
    }
    e.deathRewards = { qp, up: e.type === 'boss' ? ULT.bossBonus : 0, skill: !!ctx?.skill };
    if (p.alive && !p.dead && p.stats.hp > 0) {
      this.pulse = Math.min(PULSE.max, this.pulse + qp);
      this.ult = Math.min(ULT.max, this.ult + e.deathRewards.up);
    }
    // 连锁里程碑：冲击波（0.5s 内不重复触发，防大招刷屏）
    if (!ctx?.skill && p.alive && !p.dead && this.chain % CHAIN.milestone === 0 && this.time - this.lastMilestoneT > 0.5) {
      this.lastMilestoneT = this.time;
      this.shockwaves.fire(p.pos.x, p.pos.z, 6, 0xffd23e, 0.5);
      this.areaDamage(p.pos.x, p.pos.z, 6, 25, { damageKind: 'chain', knock: 12, fromX: p.pos.x, fromZ: p.pos.z });
      this.texts.fire(p.pos.x, 2, p.pos.z, `${this.chain} 连锁!`, 'crit');
      this.audio.chainZap();
    }

    // 掉落
    this.pickups.dropGems(e.pos.x, e.pos.z, e.xp);
    const heartChance = SCORE.heartDrop * (this.mp ? 1.6 : 1);
    if (e.type !== 'mini' && Math.random() < heartChance) this.pickups.dropHeart(e.pos.x, e.pos.z);

    // —— 击杀手感 ——
    const big = e.type === 'tank' || e.type === 'boss' || e.elite;
    this.playDeathFx(e.pos.x, e.pos.z, e.type, e.elite);
    // 击杀冲击：击退周围敌人
    for (const o of this.enemies.list) {
      if (!o.active || o.dying || o === e) continue;
      const d2 = dist2(e.pos.x, e.pos.z, o.pos.x, o.pos.z);
      if (d2 < 3 * 3 && o.knockRes < 1) {
        const d = Math.sqrt(d2) || 1;
        o.vel.x += (o.pos.x - e.pos.x) / d * 6 * (1 - o.knockRes);
        o.vel.z += (o.pos.z - e.pos.z) / d * 6 * (1 - o.knockRes);
      }
    }
    // 爆燃（燃烧 II）：击杀引发二次爆炸
    if (!ctx?.skill && p.alive && !p.dead && this.routeTiers.pyro >= 2 && e.type !== 'boss') {
      this.areaDamage(e.pos.x, e.pos.z, 2.6, 20, { damageKind: 'route', knock: 5, fromX: e.pos.x, fromZ: e.pos.z });
      this.particles.burst(e.pos.x, 0.6, e.pos.z, 8, 0xff7a3e, { speed: 6, life: 0.4, size: 0.6 });
      this.shockwaves.fire(e.pos.x, e.pos.z, 2.6, 0xff7a3e, 0.35);
    }
    // 落雷（雷霆 II）：25% 概率天降神雷
    if (!ctx?.skill && p.alive && !p.dead && this.routeTiers.volt >= 2 && Math.random() < 0.25) {
      this.smiteAt(e.pos.x, e.pos.z, 50, 3);
    }
    this.enemies.onDeath(e);
  }

  // 天雷轰击指定位置
  smiteAt(x, z, dmg, radius) {
    this.weapons.fireBolt(x, 10, z, x, 0.6, z);
    this.weapons.fireBolt(x + 0.5, 9, z - 0.4, x, 0.6, z);
    this.areaDamage(x, z, radius, dmg, { damageKind: 'route', knock: 6, fromX: x, fromZ: z });
    this.shockwaves.fire(x, z, radius, 0xffd23e, 0.4);
    this.particles.burst(x, 0.8, z, 10, 0xffd23e, { speed: 7, life: 0.4, size: 0.6 });
    this.audio.tesla();
  }

  areaDamage(x, z, r, dmg, { crit = false, knock = 0, fromX, fromZ, ...options } = {}) {
    const fx = fromX ?? x, fz = fromZ ?? z;
    for (const e of this.enemies.list) {
      if (!e.active || e.dying) continue;
      const rr = r + e.radius;
      if (dist2(x, z, e.pos.x, e.pos.z) < rr * rr) {
        this.damageEnemy(e, dmg, { ...options, crit, knock, kx: e.pos.x - fx, kz: e.pos.z - fz });
      }
    }
  }

  nearestEnemy(x, z, maxR = 1e9) {
    let best = null, bd = maxR * maxR;
    for (const e of this.enemies.list) {
      if (!e.active || e.dying) continue;
      const d = dist2(x, z, e.pos.x, e.pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  randomEnemy() {
    const act = this.enemies.list.filter((e) => e.active && !e.dying);
    return act.length ? act[Math.floor(Math.random() * act.length)] : null;
  }

  onBossDown(e) {
    this.slowmo(0.8, 0.12);
    this.pickups.magnetAll();
    this.ui.flash(0.5, 200);
    this.texts.fire(e.pos.x, 2.5, e.pos.z, `+${e.score}`, 'crit');
  }

  activatePulse() {
    if (this.pulse < PULSE.max || this.state !== 'playing' || this.player.dead) return;
    this.pulse = 0;
    const p = this.player;
    p.iFrames = Math.max(p.iFrames, PULSE.invuln);
    if (this.mp && !this.mp.isHost) {
      this.enemies.clearEBullets();
      this.mp.sendPulseDmg(p.pos.x, p.pos.z);
    } else this.resolvePulseDamage({ sourceId: this.net?.id ?? 'solo', x: p.pos.x, z: p.pos.z });
    this.ui.flash(0.75, 240);
    this.shockwaves.fire(p.pos.x, p.pos.z, PULSE.radius, 0xd94eff, 0.8);
    this.shockwaves.fire(p.pos.x, p.pos.z, PULSE.radius * 0.55, 0xffffff, 0.5);
    this.particles.burst(p.pos.x, 1, p.pos.z, 60, 0xd94eff, { speed: 20, life: 0.8, size: 0.9, grav: 0 });
    this.slowmo(PULSE.slowmoTime, PULSE.slowmoScale);
    this.addTrauma(0.85);
    this.audio.pulse();
    this.mpSendFx('pulse', { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1) });
  }

  addTrauma(n) { this.trauma = Math.min(1, this.trauma + n); }
  slowmo(dur, scale) { this.slowT = Math.max(this.slowT, dur); this.slowScale = scale; }

  // ============ 主循环 ============
  frame() {
    // 任何单帧异常都不应杀死渲染循环
    try {
      this.frameInner();
    } catch (err) {
      if (!this._errCount) this._errCount = 0;
      if (this._errCount++ < 5) console.error('[frame]', err);
    }
  }

  frameInner() {
    const elapsed = Math.max(0, this.clock.getDelta());
    const budget = this._skipElapsed ? 0 : Math.min(elapsed, 0.25);
    this._skipElapsed = false;
    this.handleGlobalKeys();
    const blocked = this.ui.blocksGameplayInput?.();
    document.body.classList.toggle('in-combat', this.state === 'playing' && !blocked && !this.cardOpen && !this.input.isTouch);
    document.body.classList.toggle('reduced-motion', this.settings.reducedMotion);
    let remaining = budget, visualDt = 0;
    // Up to 15 small steps per rendered frame: 10/20 FPS keeps real speed without tunnelling.
    // Long OS suspension is bounded; visibility changes explicitly discard hidden time.
    while (remaining > 1e-8) {
      const rawDt = Math.min(1 / 60, remaining);
      remaining -= rawDt;
      let target = this.state === 'playing' || this.state === 'dying' ? 1 : 0;
      if (this.mp && !this.mp.isHost && this.mp.hostAway) target = 0;
      if (this.slowT > 0) { this.slowT -= rawDt; target = Math.min(target, this.slowScale); }
      if (this.state === 'title' || this.state === 'lobby') target = 1;
      this.timeScale = target === 0 ? 0 : damp(this.timeScale, target, 14, rawDt);
      const dt = rawDt * this.timeScale;
      visualDt += dt;
      this.world.update(dt, this.time, this.reactor);
      switch (this.state) {
        case 'title': case 'lobby': this.updateTitle(rawDt); break;
        case 'playing': this.updatePlaying(dt, rawDt); break;
        case 'dying':
          this.updateWorldOnly(dt);
          this.dyingT -= rawDt;
          if (this.dyingT <= 0) this.finalizeGameOver();
          break;
      }
      this.input.endFrame(); // Edge-triggered actions happen once, held movement continues.
    }
    this.updateCamera(Math.min(elapsed, 0.1));
    this.particles.update(visualDt);
    this.shockwaves.update(visualDt);
    this.debris.update(visualDt);
    this.texts.update(Math.min(elapsed, 0.25));
    if (this.ultBeamT > 0) {
      this.ultBeamT -= visualDt;
      const f = Math.max(0, this.ultBeamT / 0.9);
      this.ultBeam.material.opacity = f * 0.55;
      this.ultBeam.scale.set(1 + (1 - f) * 2.2, 1, 1 + (1 - f) * 2.2);
      this.ultBeam.rotation.y += visualDt * 6;
      if (this.ultBeamT <= 0) this.ultBeam.visible = false;
    }
    this.world.update(0, this.time, this.reactor);
    if (this.state !== 'title' && this.state !== 'lobby') this.ui.update(elapsed);
    if (!this.bench) this.composer.render();
    this.input.endFrame();
  }

  updatePlaying(dt, rawDt) {
    const g = this;
    const isGuest = this.mp && !this.mp.isHost;
    const p = this.player;

    // 房主后台时客机完整冻结玩法逻辑，避免恢复后位置、冷却和伤害队列漂移。
    if (isGuest && this.mp.hostAway) {
      return;
    }

    // 客机逐帧推进并柔性校时，主客机的表现时钟都保持单调。
    if (isGuest) this.mp.advanceGuestClock(dt);
    else {
      this.time += dt;
      this.score += SCORE.perSecond * dt;
      this.sector = 1 + Math.floor(this.time / 30);
      // 连锁衰减（客机连锁数由快照同步）
      if (this.chain > 0) {
        this.chainT -= dt;
        if (this.chainT <= 0) this.chain = 0;
      }
    }
    const pace = this.enemies.paceAt(this.time);
    this.audio.intensity = clamp(0.2 + Math.min(0.35, this.enemies.activeCount / 90) + (pace.phase === 'surge' ? 0.3 : 0) + (this.enemies.bossActive ? 0.3 : 0), 0, 1);
    if (p.alive && !p.dead && p.stats.hp / p.stats.maxHp < 0.3) this.audio.lowHealth();

    // 蛛网与场地放电都会影响走位；放电按主客机共享的游戏时钟确定。
    const inArenaHazard = this.world.hazardAt(p.pos.x, p.pos.z);
    this.zoneSlowFactor = this.enemies.slowFactorAt(p.pos.x, p.pos.z) * this.arenaHazardFactorAt(p.pos.x, p.pos.z);
    this.updateArenaHazard(dt, inArenaHazard);
    if (p.alive && !p.dead) {
      if (p.stats.hp > 0) p.heal(this.planet.regen * dt);
      if (this.planet.shot === 'spore' && this.enemies.slowFactorAt(p.pos.x, p.pos.z) < 1) {
        this.sporeDamageT -= dt;
        if (this.sporeDamageT <= 0) {
          this.sporeDamageT = 0.8;
          const dealt = p.takeDamage(5, this, '孢子毒区');
          if (dealt === 'shield') this.onShieldBreak();
          else if (dealt !== false) this.onPlayerHurt(dealt, p.pos.x, p.pos.z);
        }
      } else this.sporeDamageT = 0.5;
    }

    if (!isGuest && !this.tutorialXpSpawned && this.time >= 1) {
      this.tutorialXpSpawned = true;
      this.pickups.dropGems(0, 4.5, XP_CURVE(1), { scatter: false });
      this.ui.toast('收集前方绿色碎片，完成第一次升级', '#4dff88');
      if (this.mpIsHost()) this.mp.evToast('收集前方绿色碎片，全队共享升级', '#4dff88');
    }

    // 空投补给（主机/单机）
    if (!isGuest && this.time >= this.supplyAt) {
      this.supplyAt += this.mpSupplyEvery();
      const pp = this.randomAlivePlayerPos();
      const supply = this.findSupplyPosition(pp);
      if (supply) {
        this.pickups.spawnSupply(supply.x, supply.z);
        this.ui.toast('📦 补给舱已投放', '#ffd23e');
        if (this.mpIsHost()) this.mp.evToast('📦 补给舱已投放', '#ffd23e');
        this.audio.supply();
      }
    }

    // 雷神（雷霆 III）：每 5s 轰击最密集敌群
    if (p.alive && !p.dead && p.stats.hp > 0 && this.routeTiers.volt >= 3) {
      this.voltSmiteT -= dt;
      if (this.voltSmiteT <= 0) {
        this.voltSmiteT = 5;
        const spot = this.densestCluster();
        if (spot) {
          this.smiteAt(spot.x, spot.z, 90, 4);
          this.addTrauma(0.2);
        }
      }
    }
    // 吞噬（虚空 III）：每 8s 处决周围残血敌人并回血
    if (p.alive && !p.dead && p.stats.hp > 0 && this.routeTiers.void >= 3) {
      this.voidDevourT -= dt;
      if (this.voidDevourT <= 0) {
        this.voidDevourT = 8;
        let eaten = 0;
        for (const e of this.enemies.list) {
          if (!e.active || e.dying || e.type === 'boss') continue;
          const frac = isGuest ? (e.netHpFrac ?? 1) : e.hp / e.maxHp;
          if (frac > 0.25) continue;
          if (dist2(e.pos.x, e.pos.z, p.pos.x, p.pos.z) > 81) continue;
          this.damageEnemy(e, 9999, { damageKind: 'route' });
          eaten++;
        }
        if (eaten > 0) {
          p.heal(Math.min(12, eaten * 2));
          this.shockwaves.fire(p.pos.x, p.pos.z, 9, 0xc77bff, 0.7);
          this.particles.burst(p.pos.x, 1, p.pos.z, 26, 0xc77bff, { speed: 10, life: 0.6, size: 0.7 });
          this.texts.fire(p.pos.x, 2, p.pos.z, `吞噬 x${eaten}`, 'crit');
          this.audio.nova();
          this.addTrauma(0.3);
        }
      }
    }
    this.voidNovaCd = Math.max(0, this.voidNovaCd - dt);

    // 联机倒地/重生
    if (this.mp && p.dead) {
      this.rescueActive = [...this.mp.peers.values()].some((q) => this.mp.peerAvailable(q) && dist2(p.pos.x, p.pos.z, q.x, q.z) <= 16);
      p.respawnT -= dt * (this.rescueActive ? 2 : 1);
      this.ui.respawnCountdown(p.respawnT);
      if (p.respawnT <= 0) {
        p.respawn();
        this.ui.respawnOverlay(false);
        this.shockwaves.fire(0, 0, 4, PALETTE.player, 0.6);
        this.mpSendFx('resp', { x: 0, z: 0 });
      }
    }

    this.updateAim();
    this.player.update(dt, this.input, this);

    if (isGuest) {
      this.mp.guestTick(dt);
    } else {
      this.enemies.update(dt);
    }

    // 重建空间哈希
    this.enemyHash.clear();
    for (const e of this.enemies.list) if (e.active && !e.dying) this.enemyHash.insert(e);

    this.weapons.update(dt);
    if (!isGuest) this.pickups.update(dt);
    this.checkPlayerCollisions();
    this.updateReactor(dt, isGuest);

    if (!this.ui.blocksGameplayInput?.()) {
      if (this.input.justPressed('KeyQ') || this.input.justPressed('MouseRight')) this.activatePulse();
      if (this.input.justPressed('KeyE')) this.activateUlt();
    }

    // 升级（联机为非阻塞选卡）
    if (this.pendingLevels > 0 && this.player.alive && !this.player.dead && !this.cardOpen) this.enterLevelUp();


    // 死亡判定
    if (this.player.stats.hp <= 0 && this.player.alive && !this.player.dead) {
      if (this.mp) this.startMpDeath();
      else this.gameOver();
    }

    // 主机：快照广播 + 团灭判定
    if (this.mpIsHost()) {
      this.mp.hostTick(dt);
      this.mp.hostTickPeers(dt);
      this.hostCheckWipe();
    }
    if (!isGuest && this.state === 'playing' && missionComplete(this.time, this.reactor.captures, this.endless)) this.completeMission();
  }

  updateArenaHazard(dt, inside) {
    const info = this.world.hazardInfo;
    if (info.phase === 'warning' && info.cycle !== this.arenaEventSeen) {
      this.arenaEventSeen = info.cycle;
      this.ui.toast(`⚠ ${this.planet.hazard.name}即将来袭 —— 离开闪烁区域`, '#ffb13e');
      this.audio.bossWarn();
    }
    if (info.phase !== 'active' || !inside || !this.player.alive || this.player.dead) {
      this.arenaHazardDamageT = Math.min(this.arenaHazardDamageT, 0.35);
      return;
    }
    this.arenaHazardDamageT -= dt;
    if (this.arenaHazardDamageT > 0) return;
    this.arenaHazardDamageT = 0.72;
    const p = this.player;
    const dealt = p.takeDamage(this.planet.hazard.damage, this, this.planet.hazard.name);
    if (dealt === 'shield') this.onShieldBreak();
    else if (dealt !== false) {
      this.onPlayerHurt(dealt, p.pos.x, p.pos.z);
      this.particles.burst(p.pos.x, 0.5, p.pos.z, 8, 0xff355d, { speed: 5, life: 0.35, size: 0.5 });
    }
  }

  // 联机倒地
  startMpDeath() {
    const p = this.player;
    p.dead = true;
    p.respawnT = RESPAWN_TIME;
    p.mesh.visible = false;
    this.ui.respawnOverlay(true);
    this.particles.burst(p.pos.x, 0.8, p.pos.z, 40, PALETTE.player, { speed: 12, life: 0.8, size: 0.8 });
    this.shockwaves.fire(p.pos.x, p.pos.z, 5, PALETTE.player, 0.7);
    this.audio.explode(true);
    this.mpSendFx('die', { x: +p.pos.x.toFixed(1), z: +p.pos.z.toFixed(1) });
    this.addTrauma(0.7);
  }

  // 武器进化庆祝
  onEvolution(card) {
    const p = this.player;
    this.audio.evolve();
    this.ui.toast(`⚡ 武器进化：${card.name}`, '#ffd23e');
    this.mpSendFx('evo', { txt: `${this.myName} 进化了 ${card.name}！` });
    this.ui.flash(0.5, 300);
    this.shockwaves.fire(p.pos.x, p.pos.z, 8, 0xffd23e, 0.8);
    this.particles.burst(p.pos.x, 1, p.pos.z, 40, 0xffd23e, { speed: 10, life: 0.9, size: 0.8, grav: 2 });
    this.addTrauma(0.4);
    this.slowmo(0.3, 0.2);
  }

  onShieldBreak() {
    const p = this.player;
    this.audio.shieldBreak();
    this.texts.fire(p.pos.x, 1.6, p.pos.z, '护盾破碎', 'hurt');
    this.shockwaves.fire(p.pos.x, p.pos.z, 2.5, 0x9fd8ff, 0.4);
    this.particles.burst(p.pos.x, 1, p.pos.z, 14, 0x9fd8ff, { speed: 7, life: 0.4, size: 0.6 });
  }

  updateWorldOnly(dt) {
    this.enemies.update(dt);
    this.pickups.update(dt);
    this.enemyHash.clear();
    for (const e of this.enemies.list) if (e.active && !e.dying) this.enemyHash.insert(e);
  }

  updateTitle(rawDt) {
    this.ambientT += rawDt;
    // 环绕镜头 + 氛围脉冲
    const a = this.ambientT * 0.12;
    this._camPos.set(Math.cos(a) * 26, 24, Math.sin(a) * 26);
    this._camTarget.set(0, 0, 0);
    if (this.ambientT % 2.4 < rawDt) {
      const x = rand(-14, 14), z = rand(-14, 14);
      this.shockwaves.fire(x, z, rand(3, 7), Math.random() < 0.5 ? PALETTE.player : PALETTE.enemyBullet, 1.1);
      this.particles.burst(x, 0.5, z, 10, PALETTE.player, { speed: 5, life: 0.9, size: 0.6, grav: 1 });
    }
  }

  updateAim() {
    const p = this.player;
    if (!this.settings.autoAim && this.input.usingMouse && !this.input.isTouch) {
      this._ndc.set((this.input.mouseX / innerWidth) * 2 - 1, -(this.input.mouseY / innerHeight) * 2 + 1);
      this._raycaster.setFromCamera(this._ndc, this.camera);
      const hit = this._raycaster.ray.intersectPlane(this._plane, p.aimPoint);
      if (!hit) p.aimPoint.copy(p.pos).add(p.aimDir);
    } else {
      const e = this.nearestEnemy(p.pos.x, p.pos.z, 45);
      if (e) p.aimPoint.copy(e.pos);
      else p.aimPoint.copy(p.pos).add(p.aimDir);
    }
  }

  checkPlayerCollisions() {
    const p = this.player;
    if (p.alive && !p.dead) {
      const buf = this._contactBuf || (this._contactBuf = new Array(32));
      const cnt = this.enemyHash.query(p.pos.x, p.pos.z, 3.4, buf);
      for (let i = 0; i < cnt; i++) {
        const e = buf[i];
        if (!e.active || e.dying || e.dmg <= 0) continue;
        const rr = e.radius + p.radius;
        if (dist2(p.pos.x, p.pos.z, e.pos.x, e.pos.z) < rr * rr) {
          const dealt = p.takeDamage(e.dmg, this, ENEMY_NAMES[e.type] || '敌人接触');
          if (dealt === 'shield') this.onShieldBreak();
          else if (dealt !== false) this.onPlayerHurt(dealt, e.pos.x, e.pos.z);
        }
      }
    }
    for (const b of this.enemies.ebullets) {
      if (!b.active) continue;
      if (p.alive && !p.dead) {
        const rr = 0.32 + p.radius * 0.85;
        const hit = segmentCircleHitFraction(b.prevX ?? b.pos.x, b.prevZ ?? b.pos.z, b.pos.x, b.pos.z, p.pos.x, p.pos.z, rr);
        if (Number.isFinite(hit) && hit < (b.wallHitFraction ?? Infinity)) {
          b.active = false; b.mesh.visible = false;
          const dealt = p.takeDamage(b.dmg, this, '敌方弹幕');
          if (dealt === 'shield') this.onShieldBreak();
          else if (dealt !== false) this.onPlayerHurt(dealt, b.pos.x, b.pos.z);
        }
      }
      if (b.retireAfterCollision) { b.active = false; b.mesh.visible = false; }
    }
  }

  onPlayerHurt(dmg, fromX, fromZ) {
    const p = this.player;
    this.texts.fire(p.pos.x, 1.6, p.pos.z, `-${dmg}`, 'hurt');
    this.ui.flash(0.22, 120);
    this.addTrauma(0.5);
    this.slowmo(0.05, 0.15);
    this.audio.hurt();
    this.particles.burst(p.pos.x, 0.9, p.pos.z, 14, 0xff3e5f, { speed: 8, life: 0.5, size: 0.6 });
    // 反噬（虚空 II）：受伤释放虚空新星
    if (this.routeTiers.void >= 2 && this.voidNovaCd <= 0) {
      this.voidNovaCd = 3;
      this.areaDamage(p.pos.x, p.pos.z, 5.5, 32, { damageKind: 'route', knock: 18, fromX: p.pos.x, fromZ: p.pos.z });
      this.shockwaves.fire(p.pos.x, p.pos.z, 5.5, 0xc77bff, 0.5);
      this.particles.burst(p.pos.x, 0.8, p.pos.z, 20, 0xc77bff, { speed: 10, life: 0.5, size: 0.7 });
      this.audio.nova();
    }
    // 击退
    const dx = p.pos.x - fromX, dz = p.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    p.vel.x += (dx / d) * 14;
    p.vel.z += (dz / d) * 14;
  }

  updateCamera(rawDt) {
    if (this.state === 'title') {
      this.camera.position.lerp(this._camPos, 1 - Math.exp(-2 * rawDt));
      this.camera.lookAt(this._camTarget);
      return;
    }
    const p = this.player;
    const shake = this.settings.reducedMotion ? 0 : this.trauma * this.trauma;
    this.trauma = Math.max(0, this.trauma - rawDt * 1.7);
    const t = performance.now() / 1000;

    this._camTarget.set(
      p.pos.x + p.aimDir.x * 1.6,
      0.5,
      p.pos.z + p.aimDir.z * 1.6
    );
    const want = this._camPos.set(
      this._camTarget.x + CAM_OFFSET.x + p.vel.x * 0.10,
      CAM_OFFSET.y,
      this._camTarget.z + CAM_OFFSET.z + p.vel.z * 0.10
    );
    const lambda = this.state === 'playing' ? 5.5 : 3;
    this.camera.position.x = damp(this.camera.position.x, want.x, lambda, rawDt);
    this.camera.position.y = damp(this.camera.position.y, want.y, lambda, rawDt);
    this.camera.position.z = damp(this.camera.position.z, want.z, lambda, rawDt);
    // 震动
    if (shake > 0.0001) {
      this.camera.position.x += shakeNoise(t * 3.1) * shake * 1.3;
      this.camera.position.y += shakeNoise(t * 3.7 + 9) * shake * 0.8;
      this.camera.position.z += shakeNoise(t * 2.9 + 4) * shake * 1.1;
    }
    this.camera.lookAt(this._camTarget);
  }

  handleGlobalKeys() {
    const inp = this.input;
    if (this.ui.settingsOpen || this.ui.buildOpen || this.ui.menuOpen) {
      if (inp.justPressed('Escape')) this.ui.closeTopDialog();
      else if (this.ui.buildOpen && inp.justPressed('KeyB')) this.ui.closeBuild();
      else if (this.ui.menuOpen && inp.justPressed('KeyP')) this.ui.closeMenu();
      return;
    }
    if (inp.justPressed('KeyB') && ['playing', 'paused', 'levelup'].includes(this.state)) {
      this.ui.openBuild(); return;
    }
    if (inp.justPressed('KeyF') && !this.input.isTouch) {
      this.settings.autoAim = !this.settings.autoAim;
      saveSettings(this.settings);
      this.ui.toast(this.settings.autoAim ? '自动瞄准已开启' : '鼠标瞄准已开启', '#2ee6ff');
    }
    if (inp.justPressed('KeyR') && (this.cardOpen || this.state === 'levelup')) this.rerollCards();
    if (inp.justPressed('KeyM')) {
      this.audio.setMuted(!this.audio.muted);
      this.ui.setMuted(this.audio.muted);
    }
    switch (this.state) {
      case 'title':
        if (inp.justPressed('Enter') || inp.justPressed('Space')) this.start();
        break;
      case 'lobby':
        if (inp.justPressed('Enter') && this.mpIsHost()) this.mpBegin();
        break;
      case 'playing':
        if (this.cardOpen) {
          if (inp.justPressed('Digit1') || inp.justPressed('Numpad1')) this.pickCard(0);
          if (inp.justPressed('Digit2') || inp.justPressed('Numpad2')) this.pickCard(1);
          if (inp.justPressed('Digit3') || inp.justPressed('Numpad3')) this.pickCard(2);
        }
        if (inp.justPressed('Escape') || inp.justPressed('KeyP')) {
          if (this.mp) this.ui.openMenu();
          else this.togglePause();
        }
        break;
      case 'paused':
        if (inp.justPressed('Escape') || inp.justPressed('KeyP') || inp.justPressed('Enter')) this.togglePause();
        break;
      case 'levelup':
        if (inp.justPressed('Digit1') || inp.justPressed('Numpad1')) this.pickCard(0);
        if (inp.justPressed('Digit2') || inp.justPressed('Numpad2')) this.pickCard(1);
        if (inp.justPressed('Digit3') || inp.justPressed('Numpad3')) this.pickCard(2);
        break;
      case 'gameover':
        if (this.mp) {
          if (inp.justPressed('KeyR') || inp.justPressed('Enter')) this.quitToLobby();
        } else if (inp.justPressed('KeyR') || inp.justPressed('Enter') || inp.justPressed('Space')) {
          this.start();
        }
        break;
    }
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }
}
