// 真实战斗方法的确定性回归；无需 WebGL、浏览器或服务器。
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('../vendor/three/three.module.min.js', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
const THREE = await import('three');
const { Weapons, WEAPON_TABLES, EVO_TABLES } = await import('../js/weapons.js');
const { Enemies } = await import('../js/enemies.js');
const { SpatialHash, segmentCircleHitFraction: hit } = await import('../js/utils.js');
const { XP_CURVE, PULSE, ULT } = await import('../js/config.js');
const noop = () => {};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-7, `${msg}: ${a} != ${b}`);
assert.equal(hit(0, 0, 0, 0, 0, 0, 1), 0);
assert.equal(hit(0, 0, 0, 0, 2, 0, 1), Infinity);
assert.equal(hit(0, 0, 10, 0, 5, 2, 1), Infinity);
near(hit(0, 0, 10, 0, 5, 1, 1), .5, 'tangent counts');
near(hit(0, 0, 10, 0, 5, 0, 1), .4, 'nearest entry');

function gameStub() {
  return { time: 0, arena: 100, player: { alive: true, dead: false, pos: new THREE.Vector3(), aimDir: new THREE.Vector3(1, 0, 0), stats: { dmgMul: 1, rateMul: 1, critCh: 0, critMul: 2.2 } },
    routeFx: { dmg: 1, rate: 1 }, reactor: { buffLeft: 0 }, enemyHash: new SpatialHash(),
    world: { projectileHitFraction: () => Infinity, resolveCircle: noop },
    audio: { shoot: noop, missile: noop, enemyHit: noop, bossWarn: noop, explode: noop },
    particles: { spawn: noop, burst: noop }, shockwaves: { fire: noop }, ui: { setBossHp: noop },
    addTrauma: noop, mpSendFx: noop, mpIsHost: () => false, damageEnemy(e, dmg) { e.hp -= dmg; },
    killEnemy(e) { e.active = false; }, playerTarget: () => ({ x: 8, z: 0 }), planet: { shot: 'heavy' },
  };
}
function enemy(x, z, radius = .42) {
  const mesh = new THREE.Mesh(); mesh.position.set(x, 0, z);
  return { active: true, dying: false, pos: mesh.position, vel: new THREE.Vector3(), radius, hp: 1e8, maxHp: 1e8, mesh,
    popT: 0, flashT: 0, punchT: 0, burnT: 0, burnDps: 0, burnAcc: 0, type: 'chaser', elite: false, wobble: 0, fuseT: -1 };
}
function singleShot(fps, obstacles = false) {
  const g = gameStub(), w = new Weapons(new THREE.Scene(), g);
  w.timers.blaster = 100;
  const target = enemy(1.1, 0);
  g.enemyHash.insert(target);
  if (obstacles) g.world.projectileHitFraction = (x0,z0,x1,z1,r) => hit(x0,z0,x1,z1,.4,0,.1+r);
  w.spawnBullet({ x: 0, z: 0, dx: 1, dz: 0, speed: 46, dmg: 12, crit: false, pierce: 0, life: 1 });
  for (let i = 0; i < fps; i++) w.updateBlaster(1 / fps);
  return 1e8 - target.hp;
}
for (const fps of [60, 30, 20, 10]) {
  assert.equal(singleShot(fps), 12, `${fps} FPS trajectory hits small target`);
  assert.equal(singleShot(fps, true), 0, `${fps} FPS cover blocks target`);
}
// 插入远敌人在前，必须仍由近敌人消耗有限穿透。
{
  const g = gameStub(), w = new Weapons(new THREE.Scene(), g);
  const far = enemy(3, 0, .2), nearEnemy = enemy(1, 0, .2);
  g.enemyHash.insert(far); g.enemyHash.insert(nearEnemy); w.timers.blaster = 100;
  w.spawnBullet({ x: 0, z: 0, dx: 1, dz: 0, speed: 46, dmg: 12, crit: false, pierce: 0, life: 1 });
  w.updateBlaster(.1);
  assert.equal(nearEnemy.hp, 1e8 - 12); assert.equal(far.hp, 1e8);
}
function bossDps(evolved, fps) {
  const g = gameStub(), w = new Weapons(new THREE.Scene(), g), target = enemy(10, 0, 2.6);
  g.enemyHash.insert(target); w.levels.blaster = 5; w.evolved.blaster = evolved;
  for (let i = 0; i < 60 * fps; i++) { g.time += 1 / fps; w.updateBlaster(1 / fps); }
  return (1e8 - target.hp) / 60;
}
const dps = [60, 30, 20, 10].map(fps => ({ fps, base: bossDps(false, fps), evolved: bossDps(true, fps) }));
for (const r of dps) assert.ok(r.evolved >= r.base, `evolution DPS regression at ${r.fps} FPS`);
assert.ok(Math.max(...dps.map(x => x.base)) - Math.min(...dps.map(x => x.base)) < 2);
assert.ok(Math.max(...dps.map(x => x.evolved)) - Math.min(...dps.map(x => x.evolved)) < 3);
assert.ok(EVO_TABLES.blaster.dmg * EVO_TABLES.blaster.rate >= WEAPON_TABLES.blaster[5].dmg * WEAPON_TABLES.blaster[5].rate * 3);

function enemySystem(g, e = []) {
  const system = Object.create(Enemies.prototype);
  Object.assign(system, { game: g, list: e, ebullets: [], director: noop, separate: noop, seekPlayer: noop,
    chargeLine: new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()), chargeTelegraphLeft: 0 });
  return system;
}
// 点燃的最后一帧仅结算有效时长，保留精确的小数总量，结束后不残留历史DPS。
for (const fps of [60, 30, 20, 10]) {
  const g = gameStub(), e = enemy(0, 0), system = enemySystem(g, [e]);
  e.burnT = .235; e.burnDps = 17;
  for (let i = 0; i < fps; i++) system.update(1 / fps);
  near(1e8 - e.hp, .235 * 17, `burn total ${fps} FPS`);
  assert.equal(e.burnDps, 0); assert.equal(e.burnT, 0); assert.equal(e.burnAcc, 0);
  const before = e.hp; e.burnT = .3; e.burnDps = 2.4;
  for (let i = 0; i < fps; i++) system.update(1 / fps);
  near(before - e.hp, .72, `new weak burn ${fps} FPS`);
}
// 实际选择冲锋攻击的当帧即停止旧速度，进入预警，不能误入 charge。
{
  const g = gameStub(), e = enemy(0, 0, 2.6), system = enemySystem(g);
  Object.assign(e, { type: 'boss', mark: 0, mode: 'chase', modeT: 0, chargeDir: new THREE.Vector3(), attackT: 0 });
  e.vel.set(8, 0, 8);
  const random = Math.random;
  try { Math.random = () => .5; system.updateBoss(e, 1 / 60); } finally { Math.random = random; }
  assert.equal(e.mode, 'windup'); assert.equal(e.modeT, .75); assert.equal(e.vel.length(), 0);
  assert.equal(system.chargeLine.visible, true);
}
// Boss 蓄力锁定方向；暂停 dt=0 不缩短预警，任何步长均不能提前位移。
for (const fps of [60, 30, 20, 10]) {
  const g = gameStub(), e = enemy(0, 0, 2.6), system = enemySystem(g);
  Object.assign(e, { type: 'boss', mark: 0, mode: 'windup', modeT: .75, chargeDir: new THREE.Vector3(1, 0, 0), attackT: 3 });
  system.setChargeTelegraph(0, 0, 1, 0);
  system.updateBoss(e, 0); near(e.modeT, .75, 'paused windup');
  let elapsed = 0;
  while (e.mode === 'windup') {
    system.updateBoss(e, 1 / fps); elapsed += 1 / fps;
    e.pos.addScaledVector(e.vel, 1 / fps);
    near(e.pos.length(), 0, 'windup remains still');
  }
  assert.ok(elapsed >= .75 - 1e-8 && elapsed <= .75 + 1 / fps + 1e-8);
  g.playerTarget = () => ({ x: 0, z: 8 }); system.updateBoss(e, 1 / fps);
  assert.equal(e.vel.x, 34); assert.equal(e.vel.z, 0, 'charge never retargets');
}
// 敌弹仍保留扫掠轨迹与掩体顺序，不会在墙后伤人。
{
  const g = gameStub(), system = enemySystem(g), b = { active: true, pos: new THREE.Vector3(), vel: new THREE.Vector3(46, 0, 0), life: 2, mesh: new THREE.Mesh() };
  system.ebullets = [b]; g.world.projectileHitFraction = (x0,z0,x1,z1,r) => hit(x0,z0,x1,z1,2,0,.2+r);
  system.updateProjectiles(.1);
  assert.equal(b.prevX, 0); near(b.pos.x, 4.6, 'full path retained');
  assert.equal(b.retireAfterCollision, true);
  assert.ok(hit(b.prevX, 0, b.pos.x, 0, 1, 0, .2) < b.wallHitFraction);
  assert.ok(hit(b.prevX, 0, b.pos.x, 0, 3, 0, .2) > b.wallHitFraction);
  system.updateProjectiles(.1); assert.equal(b.active, false);
}
// 轨道刃的转速与重命中间隔都随倍率变化。
{
  const g = gameStub(), w = new Weapons(new THREE.Scene(), g), target = enemy(0, 0, 10);
  g.enemyHash.insert(target); w.levels.blades = 1; g.player.stats.rateMul = 2;
  w.updateBlades(.1); near(w.bladeAngle, .68, 'blade rotation doubles');
  const initialHp = target.hp; g.time = .01; w.updateBlades(.01);
  assert.equal(target.hp, initialHp, 'a hit at time zero still honors immunity');
  g.time = .2; w.updateBlades(.1);
  assert.ok(target.hp < initialHp, '2x rate permits another hit after .19 seconds');
}
// 危险区始终有非绿色的双轮廓标识；降低纯底色辉光不能移除边界。
{
  const oldLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  let system;
  try { system = new Enemies(new THREE.Scene(), gameStub()); } finally { THREE.TextureLoader.prototype.load = oldLoad; }
  system.game.planet.shot = 'spore'; system.dropWeb(1, 2);
  const w = system.webZones[0];
  assert.equal(w.mesh.material.color.getHex(), 0xffad3d);
  assert.equal(w.mesh.material.blending, THREE.NormalBlending);
  assert.equal(w.mesh.children.length, 2);
  assert.ok(w.mesh.children.some(x => x.isLineLoop));
  assert.ok(w.mesh.children.every(x => x.material.color.getHex() === 0xffad3d));
}
assert.equal(XP_CURVE(20), 236); assert.equal(XP_CURVE(21), 255);
assert.equal(XP_CURVE(50) - XP_CURVE(49), 19);
assert.ok(PULSE.maxHpBonus < ULT.bossFrac);
assert.equal(PULSE.skillRefundCap, 25);
console.log('✓ Swept player/enemy projectiles, cover ordering, 60/30/20/10 FPS DPS, evolution floor, burn expiry, Boss windup, blade rate, XP/skill balance');
console.log(JSON.stringify({ dps }, null, 2));
