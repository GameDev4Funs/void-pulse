// 联机端到端测试：同源服务 → 建房 → 加入 → 开战 → 同步 → 伤害 → 拾取 → 倒地重生 → 团灭 → 满员限制
import { spawn } from 'child_process';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const externalUrl = process.argv[2];
const URL = externalUrl || 'http://localhost:8133/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let failed = 0;
const check = (name, cond) => {
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}`);
  if (!cond) failed++;
};

// 默认启动生产同构的单端口服务；传入 URL 时验证外部部署。
const server = externalUrl ? null : spawn('python3', ['scripts/server.py', '8133'], { stdio: 'pipe' });
await sleep(800);

// 每个客户端独立浏览器实例（单页即前台标签，rAF 不被节流）
const browsers = [];
async function newBrowser() {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 640, height: 400 },
  });
  browsers.push(b);
  return b;
}

async function jsClick(page, id) {
  await page.evaluate((i) => document.getElementById(i).click(), id);
}
async function newPage(tag) {
  const page = await (await newBrowser()).newPage();
  page.on('pageerror', (e) => errors.push(`[${tag}] ` + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ` + m.text()); });
  await page.goto(URL + '?lowfx=1&bench=1', { waitUntil: 'networkidle0' });
  await sleep(1200);
  return page;
}

try {
const A = await newPage('A');
await jsClick(A, 'mp-btn');
await jsClick(A, 'mp-create-btn');
await sleep(1500);
const room = await A.$eval('#lobby-room', (el) => el.textContent);
const pass = await A.$eval('#lobby-pass', (el) => el.textContent);
console.log(`房间: ${room} / ${pass}`);
check('房主进入大厅', await A.evaluate(() => window.__DBG.state() === 'lobby'));

const B = await newPage('B');
await jsClick(B, 'mp-btn');
await B.evaluate(() => { document.getElementById('mp-name').value = '队友B'; });
await B.type('#mp-room', room);
await B.type('#mp-pass', pass);
await jsClick(B, 'mp-join-btn');
await sleep(1500);
check('客机进入大厅', await B.evaluate(() => window.__DBG.state() === 'lobby'));
check('大厅显示 2 人', await B.evaluate(() => document.querySelectorAll('.lobby-player').length === 2));

// 房主开战
await jsClick(A, 'lobby-start-btn');
await sleep(1500);
check('房主进入战斗', await A.evaluate(() => window.__DBG.state() === 'playing'));
check('客机进入战斗', await B.evaluate(() => window.__DBG.state() === 'playing'));

// 进行中的房间必须锁定；中途加入者没有完整世界状态，不能进入本局。
const Late = await newPage('Late');
await jsClick(Late, 'mp-btn');
await Late.type('#mp-room', room);
await Late.type('#mp-pass', pass);
await jsClick(Late, 'mp-join-btn');
await sleep(700);
check('开局后中途加入被拒绝', await Late.evaluate(() => (
  window.__DBG.state() === 'title'
  && document.getElementById('mp-status').textContent.includes('已经开始')
)));
check('中途加入不会改变本局参战人数', await A.evaluate(() => (
  window.__DBG.game.mp.playerCount === 2
  && window.__DBG.game.mp.participantCount === 2
)));

check('联机能源设施扩大到 160×160', await A.evaluate(() => window.__DBG.game.arena === 80));
check('场景包含八个可碰撞战术掩体', await A.evaluate(() => {
  const world = window.__DBG.game.world;
  const roundBarriers = world.coverMeshes.slice(4).every((mesh) => mesh.userData.collisionRadius === 3);
  return world.colliders.length === 8 && world.coverMeshes.length === 8 && roundBarriers;
}));
check('玩家不能冲刺穿过设施掩体', await A.evaluate(() => {
  const g = window.__DBG.game;
  const p = g.player;
  const c = g.world.colliders[0];
  p.pos.set(c.x - c.r - p.radius - 0.18, 0.75, c.z);
  p.vel.set(0, 0, 0);
  p.dashDir.set(1, 0, 0);
  p.dashT = 0.19;
  const fakeInput = {
    moveVec: () => ({ x: 1, z: 0, active: true }),
    justPressed: () => false,
  };
  for (let i = 0; i < 6; i++) p.update(0.04, fakeInput, g);
  const blocked = p.pos.x <= c.x - c.r - p.radius + 0.04;
  p.pos.set(0, 0.75, 6);
  p.vel.set(0, 0, 0);
  p.dashT = 0;
  return blocked;
}));
check('能源放电按预警与激活阶段切换', await A.evaluate(() => {
  const g = window.__DBG.game;
  const p = g.player;
  g.world.update(0, 76);
  const warning = g.world.hazardInfo.phase === 'warning';
  g.world.update(0, 81);
  const active = g.world.hazardInfo.phase === 'active'
    && g.arenaHazardFactorAt(21, 0) === 0.68;
  const savedHp = p.stats.hp;
  const savedIFrames = p.iFrames;
  p.stats.hp = p.stats.maxHp;
  p.iFrames = 0;
  g.arenaHazardDamageT = 0;
  g.updateArenaHazard(0.1, true);
  const damaged = p.stats.hp < p.stats.maxHp;
  p.stats.hp = savedHp;
  p.iFrames = savedIFrames;
  g.arenaHazardDamageT = 0.35;
  g.world.update(0, g.time);
  return warning && active && damaged;
}));
check('敌人导演包含推进、高潮和喘息节奏', await A.evaluate(() => {
  const d = window.__DBG.game.enemies;
  const advance = d.paceAt(10);
  const surge = d.paceAt(24);
  const respite = d.paceAt(32);
  return advance.phase === 'advance'
    && surge.phase === 'surge'
    && respite.phase === 'respite'
    && surge.rate > advance.rate
    && respite.rate < advance.rate;
}));
check('敌人出生点避开玩家、墙体与掩体', await A.evaluate(() => {
  const g = window.__DBG.game;
  const players = g.alivePlayerPositions();
  for (let i = 0; i < 20; i++) {
    const pos = g.enemies.findSpawnPosition(players[i % players.length], 'chaser');
    if (!pos || !g.world.isSpawnClear(pos.x, pos.z, 0.8)) return false;
    if (players.some((p) => Math.hypot(pos.x - p.x, pos.z - p.z) < 15)) return false;
  }
  return true;
}));
check('所有生成入口共享同一敌人硬上限', await A.evaluate(() => {
  const d = window.__DBG.game.enemies;
  const savedActive = d.activeCount;
  const savedPending = d.pendingCount;
  const telegraphs = d.telegraphs.filter((tg) => tg.active).length;
  d.activeCount = Math.floor(d.paceAt(window.__DBG.game.time).cap);
  d.pendingCount = 0;
  const queued = d.queueSpawn('chaser', 60, 60, false, 1);
  const direct = d.spawnNow('mini', 60, 60, false);
  const unchanged = d.telegraphs.filter((tg) => tg.active).length === telegraphs;
  d.activeCount = savedActive;
  d.pendingCount = savedPending;
  return queued === false && direct === null && unchanged;
}));
check('补给舱落点不会被设施掩体挡住', await A.evaluate(() => {
  const g = window.__DBG.game;
  const c = g.world.colliders[0];
  if (g.world.isSpawnClear(c.x, c.z, 1.7)) return false;
  for (let i = 0; i < 20; i++) {
    const supply = g.findSupplyPosition({ x: c.x, z: c.z });
    if (!supply || !g.world.isSpawnClear(supply.x, supply.z, 1.7)) return false;
  }
  return true;
}));

// 回归：联机视觉围墙和玩家实际碰撞必须使用同一个动态边界。
await A.evaluate(() => {
  const g = window.__DBG.game;
  g.player.pos.x = 66;
  g.player.pos.z = 66;
  g.player.vel.set(0, 0, 0);
});
await sleep(150);
check('联机内场不再存在 34 单元空气墙', await A.evaluate(() => {
  const p = window.__DBG.game.player.pos;
  return p.x > 65 && p.z > 65;
}));
await A.evaluate(() => {
  const g = window.__DBG.game;
  g.player.pos.x = 100;
  g.player.pos.z = -100;
  g.player.vel.set(0, 0, 0);
});
await sleep(150);
check('左右/前后边界与可视围墙一致', await A.evaluate(() => {
  const g = window.__DBG.game;
  const edge = g.arena - 0.4;
  return Math.abs(g.player.pos.x - edge) < 0.1
    && Math.abs(g.player.pos.z + edge) < 0.1
    && g.player.vel.x === 0
    && g.player.vel.z === 0;
}));
await sleep(100);
check('墙边远端预测不会穿出围墙', await B.evaluate(() => {
  const g = window.__DBG.game;
  const peer = [...g.mp.peers.values()][0];
  const edge = g.arena - 0.4;
  return peer && Math.abs(peer.remote.mesh.position.x) <= edge + 0.01
    && Math.abs(peer.remote.mesh.position.z) <= edge + 0.01;
}));
check('远端玩家外推不会穿进设施掩体', await B.evaluate(() => {
  const g = window.__DBG.game;
  const peer = [...g.mp.peers.values()][0];
  const c = g.world.colliders[0];
  peer.remote.setNetworkState(c.x - c.r - 0.8, c.z, 24, 0, 0);
  peer.remote.update(0.12, g.camera);
  return Math.hypot(peer.remote.mesh.position.x - c.x, peer.remote.mesh.position.z - c.z)
    >= c.r + g.player.radius - 0.02;
}));
await A.evaluate(() => {
  const g = window.__DBG.game;
  g.player.pos.set(0, 0.75, 6);
  g.player.vel.set(0, 0, 0);
});

// 客机表现时钟应逐帧推进，而不是只在快照到达时跳变。
const guestClockAdvances = await B.evaluate(() => new Promise((resolve) => {
  const samples = [];
  const sample = () => {
    samples.push(window.__DBG.game.time);
    if (samples.length < 30) requestAnimationFrame(sample);
    else resolve(samples.slice(1).filter((value, i) => value > samples[i] + 0.0001).length);
  };
  requestAnimationFrame(sample);
}));
check('客机表现时钟逐帧平滑推进', guestClockAdvances >= 24);
check('大幅负校时误差不会让客机时间倒退', await B.evaluate(() => {
  const g = window.__DBG.game;
  const mp = g.mp;
  const before = g.time;
  mp.clockSynced = true;
  mp.hostTime = before - 10;
  mp.lastSnapAt = performance.now() / 1000;
  for (let i = 0; i < 60; i++) mp.advanceGuestClock(1 / 60);
  const monotonic = g.time >= before;
  mp.clockSynced = false; // 下一份真实快照重新建立基准
  return monotonic;
}));
check('主机大幅领先时客机可向前追帧', await B.evaluate(() => {
  const g = window.__DBG.game;
  const mp = g.mp;
  const before = g.time;
  mp.clockSynced = true;
  mp.hostTime = before + 10;
  mp.lastSnapAt = performance.now() / 1000;
  mp.advanceGuestClock(1 / 60);
  const caughtUp = g.time >= before + 9.9;
  mp.clockSynced = false;
  return caughtUp;
}));
check('房主后台冻结客机玩法且恢复时重建时钟基准', await B.evaluate(() => {
  const g = window.__DBG.game;
  const mp = g.mp;
  mp._onMsg(mp.net.hostId, { k: 'hostaway' });
  const before = {
    time: g.time,
    x: g.player.pos.x,
    z: g.player.pos.z,
    weaponT: g.weapons.timers.blaster,
  };
  g.player.vel.set(10, 0, 0);
  mp.advanceGuestClock(0.1);
  g.updatePlaying(0.1, 0.1);
  const frozen = g.time === before.time
    && g.player.pos.x === before.x
    && g.player.pos.z === before.z
    && g.weapons.timers.blaster === before.weaponT;
  g.player.vel.set(0, 0, 0);
  mp._onMsg(mp.net.hostId, { k: 'hostback' });
  return frozen && !mp.hostAway && !mp.clockSynced && mp.lastSnapAt === 0;
}));

// B 移动，A 应看到 B 的远程位置
await B.keyboard.down('KeyW');
await sleep(1200);
await B.keyboard.up('KeyW');
const bPos = await B.evaluate(() => ({ x: window.__DBG.game.player.pos.x, z: window.__DBG.game.player.pos.z }));
const aSeesB = await A.evaluate(() => {
  const p = [...window.__DBG.game.mp.peers.values()][0];
  return p ? { x: p.x, z: p.z } : null;
});
check('位置同步 (误差<6)', aSeesB && Math.hypot(aSeesB.x - bPos.x, aSeesB.z - bPos.z) < 6);

// 伤害事件：B 的输出应到达主机
await A.evaluate(() => {
  const mp = window.__DBG.game.mp;
  window.__dmgCount = 0;
  const orig = mp._applyDmgEvents.bind(mp);
  mp._applyDmgEvents = (l) => { window.__dmgCount += l.length; orig(l); };
});
await B.mouse.move(700, 300);
await sleep(4000);
await B.mouse.move(500, 500);
await sleep(4000);
check('客机伤害事件到达主机', await A.evaluate(() => window.__dmgCount > 0));
check('客机看到敌人(快照)', await B.evaluate(() => window.__DBG.game.enemies.list.some((e) => e.active)));
check('客机敌人外推不会穿进设施掩体', await B.evaluate(() => {
  const g = window.__DBG.game;
  const e = g.enemies.list.find((enemy) => enemy.active);
  const c = g.world.colliders[0];
  if (!e) return false;
  e.pos.set(c.x - c.r - e.radius - 0.1, e.pos.y, c.z);
  e.netX = c.x;
  e.netZ = c.z;
  e.netVX = 24;
  e.netVZ = 0;
  e.netAge = 0;
  g.mp.guestTick(0.12);
  return Math.hypot(e.pos.x - c.x, e.pos.z - c.z) >= c.r + e.radius - 0.02;
}));
check('过期代际伤害不会串到复用池位', await A.evaluate(() => {
  const g = window.__DBG.game;
  const e = g.enemies.list.find((enemy) => enemy.active && !enemy.dying && enemy.hp > 2);
  if (!e) return false;
  const hp = e.hp;
  g.mp._applyDmgEvents([[e.netId, e.generation - 1, 9999, 0, 0, 0, 0]]);
  if (e.hp !== hp) return false;
  g.mp._applyDmgEvents([[e.netId, e.generation, 1, 0, 0, 0, 0]]);
  return e.hp === hp - 1;
}));

// 宝石拾取：在 B 脚下放宝石 → 团队经验 + B 的大招充能
await A.evaluate(() => {
  const g = window.__DBG.game;
  const b = [...g.mp.peers.values()][0];
  g.pickups.dropGems(b.x, b.z, 5);
});
await sleep(2000);
check('主机团队经验入账', await A.evaluate(() => window.__DBG.game.player.xp > 0 || window.__DBG.game.player.level > 1));
check('客机大招充能', await B.evaluate(() => window.__DBG.game.ult > 0));

// 客机倒地 → 重生
await B.evaluate(() => window.__DBG.hurt(99999));
await sleep(700);
check('客机倒地', await B.evaluate(() => window.__DBG.game.player.dead));
check('重生倒计时显示', await B.evaluate(() => !document.getElementById('respawn-overlay').classList.contains('hidden')));
check('倒地队友在连续心跳下保持隐藏', await A.evaluate(() => {
  const peer = [...window.__DBG.game.mp.peers.values()][0];
  return peer?.dead && !peer.remote.mesh.visible;
}));
console.log('  …等待重生 (11s)');
await sleep(11000);
check('客机重生', await B.evaluate(() => !window.__DBG.game.player.dead && window.__DBG.game.player.alive));

// 团灭：B 再次倒地 + A 倒地 → 双方结算 → 返回大厅
await B.evaluate(() => window.__DBG.hurt(99999));
await sleep(500);
await A.evaluate(() => window.__DBG.hurt(99999));
await sleep(2000);
check('主机团灭结算', await A.evaluate(() => window.__DBG.state() === 'gameover'));
check('客机收到团灭', await B.evaluate(() => window.__DBG.state() === 'gameover'));
await A.keyboard.press('KeyR');
await sleep(800);
check('返回大厅', await A.evaluate(() => window.__DBG.state() === 'lobby'));

// 第二局：远端预测/死亡/坐标状态必须从新一局重新建立。
await jsClick(A, 'lobby-start-btn');
await sleep(1000);
check('第二局双方重新开战', await A.evaluate(() => window.__DBG.state() === 'playing')
  && await B.evaluate(() => window.__DBG.state() === 'playing'));
check('第二局队友状态已从首个心跳重建', await A.evaluate(() => {
  const g = window.__DBG.game;
  const peer = [...g.mp.peers.values()][0];
  if (!peer || !peer.ready || peer.dead || !peer.remote.hasState) return false;
  return Math.hypot(peer.remote.mesh.position.x - peer.x, peer.remote.mesh.position.z - peer.z) < 3;
}));
check('第二局清空目标与重抽状态', await A.evaluate(() => {
  const g = window.__DBG.game;
  return g.reactor.captures === 0 && g.reactor.buffLeft === 0 && g.reactorRewardCycle === -1 && g.rerolls === 2;
}));

// 新机制：由真实主机帧推进目标，使用真实 relay 检查客机奖励和快照。
for (const page of [A, B]) await page.evaluate(() => {
  const g = window.__DBG.game;
  g.player.pos.set(0, 0.75, 0); g.player.vel.set(0, 0, 0);
  g.player.stats.hp = 50; g.player.stats.armor = 9999; g.pulse = 0;
});
await sleep(150);
await A.evaluate(() => {
  const g = window.__DBG.game;
  g.enemies.reset(); g.enemies.spawnT = 9999;
  g.time = 24; g.reactor.cycle = 0; g.reactor.charge = 6.99;
});
await sleep(600);
for (const [tag, page] of [['主机', A], ['客机', B]]) {
  check(`${tag}反应堆奖励与团队急速`, await page.evaluate(() => {
    const g = window.__DBG.game;
    return g.reactor.captures === 1 && g.reactor.buffLeft > 16 && g.player.stats.hp >= 68 && g.pulse === 25 && g.weapons.rateMul() === 1.25;
  }));
}
await A.evaluate(() => {
  const g = window.__DBG.game;
  g.rewardReactor(0); g.mp.send({ k: 'reactorReward', cycle: 0 });
});
await sleep(200);
check('重复目标消息不会重复回血或充能', await B.evaluate(() => {
  const g = window.__DBG.game;
  return g.player.stats.hp === 68 && g.pulse === 25;
}));
check('非房主不能伪造奖励或暂停世界', await B.evaluate(() => {
  const g = window.__DBG.game;
  g.mp._onMsg(g.net.id, { k: 'reactorReward', cycle: 999 });
  g.mp._onMsg(g.net.id, { k: 'hostaway' });
  return g.player.stats.hp === 68 && g.pulse === 25 && g.reactorRewardCycle === 0 && !g.mp.hostAway;
}));
await A.evaluate(() => {
  const g = window.__DBG.game;
  g.reactor.buffUntil = g.time - 1;
  g.pickups.spawnSupply(40, 40, 0); g.pickups.spawnSupply(-40, -40, 1);
});
await sleep(300);
check('增益到期在客机同步恢复基础射速', await B.evaluate(() => window.__DBG.game.weapons.rateMul() === 1));
check('两个补给槽正确同步', await B.evaluate(() => window.__DBG.game.pickups.supplies.filter((s) => s.active).length === 2));
await A.evaluate(() => {
  const g = window.__DBG.game;
  const s = g.pickups.supplies[0]; s.active = false; s.mesh.visible = false;
  g.onSupplyTaken(s.x, s.z, { id: g.net.id, self: true }, 0);
});
await sleep(200);
check('拾取一个补给不删除另一个', await B.evaluate(() => {
  const s = window.__DBG.game.pickups.supplies;
  return !s[0].active && s[1].active;
}));
await A.evaluate(() => { const s = window.__DBG.game.pickups.supplies[1]; s.landed = true; s.t = 23; });
await sleep(300);
check('补给过期不会在客机留下幽灵舱', await B.evaluate(() => window.__DBG.game.pickups.supplies.every((s) => !s.active)));

const spawnedDamage = await A.evaluate(() => {
  const g = window.__DBG.game;
  const e = g.enemies.spawnNow('tank', 60, 60, true);
  return { id: e.netId, damage: e.dmg };
});
await sleep(200);
check('精英接触伤害包含主机成长倍率', await B.evaluate(({ id, damage }) => window.__DBG.game.enemies.list[id].dmg === damage, spawnedDamage));
check('经验池满仍保留当前块经验', await A.evaluate(() => {
  const g = window.__DBG.game;
  const saved = g.pickups.gems.map((gem) => gem.active);
  g.pickups.gems.forEach((gem) => { gem.active = true; });
  let awarded = 0; const addXp = g.addXp;
  g.addXp = (n) => { awarded += n; };
  try { g.pickups.dropGems(0, 0, 13); } finally {
    g.addXp = addXp; g.pickups.gems.forEach((gem, i) => { gem.active = saved[i]; });
  }
  return awarded === 13;
}));
await A.evaluate(() => window.__DBG.giveXp(12));
await sleep(200);
check('联机卡片不再用全屏遮罩挡住战斗', await B.evaluate(() => {
  const g = window.__DBG.game, el = document.getElementById('levelup-screen');
  return g.cardOpen && el.classList.contains('mp-cards') && getComputedStyle(el).pointerEvents === 'none';
}));
check('小屏联机三张卡全部在视口内', await B.evaluate(() => [...document.querySelectorAll('#cards .card')].every((el) => {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
})));
if (process.env.VP_SHOTS) await B.screenshot({ path: `${process.env.VP_SHOTS}/mp_cards.png` });
await B.keyboard.press('KeyR');
await sleep(200);
check('联机重抽消耗本局次数', await B.evaluate(() => window.__DBG.game.rerolls === 1));
await B.keyboard.press('Digit1');
await sleep(100);
check('选卡后保留短暂无敌且继续战斗', await B.evaluate(() => {
  const g = window.__DBG.game;
  return g.state === 'playing' && !g.cardOpen && g.player.iFrames > 0;
}));
// 结束本轮专项测试，恢复死亡条件。
for (const page of [A, B]) await page.evaluate(() => { window.__DBG.game.player.stats.armor = 0; });
await B.evaluate(() => window.__DBG.hurt(99999));
await sleep(300);
await A.evaluate(() => window.__DBG.hurt(99999));
await sleep(1800);
await A.keyboard.press('KeyR');
await sleep(800);
check('第二局结算后仍可返回大厅', await A.evaluate(() => window.__DBG.state() === 'lobby'));

// 满员限制：当前房间 2 人，再进 C、D 成功，E 应被拒
for (const tag of ['C', 'D']) {
  const P = await newPage(tag);
  await P.click('#mp-btn');
  await P.type('#mp-room', room);
  await P.type('#mp-pass', pass);
  await P.click('#mp-join-btn');
  await sleep(900);
  check(`${tag} 加入成功`, await P.evaluate(() => window.__DBG.state() === 'lobby'));
}
const E = await newPage('E');
await jsClick(E, 'mp-btn');
await E.type('#mp-room', room);
await E.type('#mp-pass', pass);
await jsClick(E, 'mp-join-btn');
await sleep(900);
check('E 被拒（满员）', await E.evaluate(() => window.__DBG.state() === 'title' && document.getElementById('mp-status').textContent.includes('已满')));
check('房间上限 4 人', await A.evaluate(() => window.__DBG.game.mp.playerCount === 4));

console.log('---- page errors:', errors.length);
errors.slice(0, 10).forEach((e) => console.log(e));
} finally {
  await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
  if (server) server.kill();
}

process.exit(failed + (errors.length ? 1 : 0));
