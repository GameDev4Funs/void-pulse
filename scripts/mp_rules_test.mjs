// 双浏览器规则回归：来源、技能清弹、奖励、暂离、回收、断线；停渲染后逐步驱动以避免时序随机。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const port = 8147;
const server = spawn('python3', ['scripts/server.py', String(port)], { stdio: 'ignore' });
const browsers = [];
const errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, value) => { assert.ok(value, name); console.log(`✓ ${name}`); };
async function page(tag) {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'], defaultViewport: { width: 640, height: 400 } });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  await p.goto(`http://127.0.0.1:${port}/?lowfx=1&bench=1`, { waitUntil: 'networkidle0' });
  await p.waitForFunction(() => !!window.__DBG?.game);
  return p;
}
async function settle() { await sleep(150); }

try {
  await sleep(400);
  const host = await page('host');
  const guest = await page('guest');
  await host.evaluate(() => window.__DBG.game.mpCreate('Host'));
  await host.waitForFunction(() => window.__DBG.game.state === 'lobby');
  const room = await host.evaluate(() => window.__DBG.game.pendingRoom);
  await guest.evaluate(({ room, pass }) => window.__DBG.game.mpJoin('Guest', room, pass), room);
  await guest.waitForFunction(() => window.__DBG.game.state === 'lobby');
  await host.evaluate(() => window.__DBG.game.mpBegin());
  await guest.waitForFunction(() => window.__DBG.game.state === 'playing');
  for (const p of [host, guest]) await p.evaluate(() => {
    const g = window.__DBG.game;
    g.renderer.setAnimationLoop(null);
    g.player.stats.armor = 9999;
    g.player.dead = false; g.player.alive = true;
    g.enemies.reset();
    g.pendingLevels = 0;
    g.mp.sendPos();
  });
  await settle();

  const guestId = await guest.evaluate(() => window.__DBG.game.net.id);
  check('双端位置心跳形成可用战斗成员', await host.evaluate(() => {
    const g = window.__DBG.game; return [...g.mp.peers.values()].every(p => g.mp.peerAvailable(p));
  }));

  const enemy = await host.evaluate(() => {
    const g = window.__DBG.game;
    g.routeTiers.pyro = 3;
    const e = g.enemies.spawnNow('tank', 15, 15, false);
    e.hp = e.maxHp = 10000;
    return { id: e.netId, generation: e.generation };
  });
  await settle();
  await guest.evaluate(({ id }) => {
    const g = window.__DBG.game; g.routeTiers.pyro = 0;
    g.damageEnemy(g.enemies.list[id], 73, { damageKind: 'plasma' });
    g.mp.guestTick(0.04);
  }, enemy);
  await settle();
  check('客机无燃烧时不继承房主焚天', await host.evaluate(({ id }) => {
    const e = window.__DBG.game.enemies.list[id]; return e.hp === 9927 && !(e.burnT > 0);
  }, enemy));
  await host.evaluate(() => { window.__DBG.game.routeTiers.pyro = 0; });
  await guest.evaluate(({ id }) => {
    const g = window.__DBG.game; g.routeTiers.pyro = 3;
    g.damageEnemy(g.enemies.list[id], 100, { damageKind: 'plasma' });
    g.mp.guestTick(0.04);
  }, enemy);
  await settle();
  check('客机焚天完整发送直伤与DOT而非25%近似', await host.evaluate(({ id }) => {
    const e = window.__DBG.game.enemies.list[id]; return e.hp === 9827 && e.burnDps === 20 && e.burnT === 3;
  }, enemy));
  check('实际伤害按发起玩家及武器归属', await host.evaluate(id => {
    const g = window.__DBG.game; return g.damageBySource[id].plasma === 173;
  }, guestId));

  await host.evaluate(() => { const g = window.__DBG.game; for (const e of g.enemies.list) e.active = false; });
  for (const kind of ['Pulse', 'Ult']) {
    await host.evaluate(() => window.__DBG.game.enemies.fireEBullet(40, 40, 1, 0, 9, 10));
    await settle();
    check(`${kind}前双端存在同一弹幕`, await guest.evaluate(() => window.__DBG.game.enemies.ebullets.some(b => b.active)));
    await guest.evaluate(kind => {
      const g = window.__DBG.game; g.pulse = 100; g.ult = 100; g[`activate${kind}`]();
    }, kind);
    await settle();
    check(`客机${kind}使全队消弹`, await host.evaluate(() => !window.__DBG.game.enemies.ebullets.some(b => b.active))
      && await guest.evaluate(() => !window.__DBG.game.enemies.ebullets.some(b => b.active)));
  }

  for (const p of [host, guest]) await p.evaluate(() => {
    const g = window.__DBG.game; g.pulse = 0; g.ult = 0; g.routeTiers.pyro = 0; g.routeTiers.volt = 0;
  });
  const boss = await host.evaluate(() => {
    const e = window.__DBG.game.enemies.spawnNow('boss', 15, 15, false); return { id: e.netId, generation: e.generation };
  });
  await settle();
  await host.evaluate(({ id }) => window.__DBG.game.killEnemy(window.__DBG.game.enemies.list[id]), boss);
  await settle();
  for (const [name, p] of [['房主', host], ['客机', guest]]) {
    check(`${name}同获Boss Q100/E40奖励`, await p.evaluate(() => {
      const g = window.__DBG.game; return g.pulse === 100 && g.ult === 40;
    }));
  }
  await host.evaluate(({ id }) => { const g = window.__DBG.game; g.mp.evDeath(g.enemies.list[id], id); }, boss);
  await settle();
  check('重复死亡事件不重复发放奖励', await guest.evaluate(() => window.__DBG.game.ult === 40));

  await guest.evaluate(() => {
    const g = window.__DBG.game;
    g.routeTiers.pyro = 2; g.routeTiers.volt = 2; g.mp.sendPos();
    window.__procCount = 0;
    const area = g.areaDamage.bind(g), smite = g.smiteAt.bind(g);
    g.areaDamage = (...args) => { window.__procCount++; return area(...args); };
    g.smiteAt = (...args) => { window.__procCount++; return smite(...args); };
  });
  await settle();
  await host.evaluate(() => {
    const g = window.__DBG.game;
    const e = g.enemies.spawnNow('tank', 15, 15, false); e.hp = 1;
    g.resolvePulseDamage({ sourceId: g.net.id, x: 15, z: 15 });
  });
  await settle();
  check('技能击杀不会在客机异步再触发流派伤害', await guest.evaluate(() => window.__procCount === 0));
  await guest.evaluate(() => { const g = window.__DBG.game; g.player.dead = true; g.pulse = 0; g.ult = 0; g.mp.sendPos(); });
  await host.evaluate(() => {
    const g = window.__DBG.game;
    const e = g.enemies.spawnNow('tank', 15, 15, false); g.killEnemy(e);
  });
  await settle();
  check('倒地客机不会触发流派或收到战斗充能', await guest.evaluate(() => {
    const g = window.__DBG.game; return window.__procCount === 0 && g.pulse === 0 && g.ult === 0;
  }));
  await guest.evaluate(() => { const g = window.__DBG.game; g.player.respawn(); g.mp.sendPos(); });
  await settle();

  await guest.evaluate(() => window.__DBG.game.mp.setLocalAway(true));
  await settle();
  check('暂离者排除AI、拾取及反应堆目标', await host.evaluate(() => {
    const g = window.__DBG.game, p = [...g.mp.peers.values()][0];
    return p.away && p.dead && !g.mp.peerAvailable(p) && g.mp.alivePlayerInfos().every(q => q.id !== p.id);
  }));
  await guest.evaluate(() => window.__DBG.game.mp.setLocalAway(false));
  await settle();
  check('恢复连接须先倒地重生', await guest.evaluate(() => {
    const p = window.__DBG.game.player; return p.dead && p.respawnT === 10;
  }));
  await guest.evaluate(() => { const g = window.__DBG.game; g.player.respawn(); g.mp.sendPos(); });
  await settle();
  check('正常重生恢复战斗资格', await host.evaluate(() => {
    const g = window.__DBG.game; return g.mp.peerAvailable([...g.mp.peers.values()][0]);
  }));
  check('3秒无心跳即不阻止团灭', await host.evaluate(() => {
    const g = window.__DBG.game, p = [...g.mp.peers.values()][0];
    p.lastSeenAt = performance.now() - 3100; g.mp.hostTickPeers(0);
    return p.away && p.dead && !g.mp.peerAvailable(p) && !g.mp.peerPending(p);
  }));
  await guest.evaluate(() => window.__DBG.game.mp.sendPos());
  await settle();
  check('无visibilitychange的心跳恢复也强制倒地', await guest.evaluate(() => window.__DBG.game.player.dead));

  await host.evaluate(() => {
    const g = window.__DBG.game; g.player.pos.set(0, 0.75, 0); g.player.vel.set(0, 0, 0); g.mp.sendPos();
  });
  await settle();
  check('4米内存活队友救援令倒计时按2倍下降', await guest.evaluate(() => {
    const g = window.__DBG.game; g.player.pos.set(0, 0.75, 0); g.player.dead = true; g.player.respawnT = 10;
    g.updatePlaying(1, 1);
    return g.rescueActive && g.player.respawnT === 8;
  }));
  await host.evaluate(() => {
    const g = window.__DBG.game; g.player.pos.set(10, 0.75, 0); g.mp.sendPos();
  });
  await settle();
  check('离开救援范围恢复正常重生倒计时', await guest.evaluate(() => {
    const g = window.__DBG.game; g.player.respawnT = 10; g.updatePlaying(1, 1);
    return !g.rescueActive && g.player.respawnT === 9;
  }));
  for (const [p, best] of [[host, 50], [guest, 9999]]) await p.evaluate(best => {
    const g = window.__DBG.game;
    localStorage.setItem('vp_records_v2', JSON.stringify({ [g.recordId]: { score: best } }));
    const show = g.ui.showMpGameOver.bind(g.ui);
    g.ui.showMpGameOver = (stats, isHost) => { window.__lastResult = stats; return show(stats, isHost); };
  }, best);
  await guest.evaluate(() => { const g = window.__DBG.game; g.player.respawn(); g.mp.sendPos(); });
  await settle();
  await host.evaluate(() => { const g = window.__DBG.game; g.startMpDeath(); g.score = 1000; g.reactor.captures = 3; g.completeMission(); });
  await settle();
  check('任务完成广播令双端进入胜利结算', await host.evaluate(() => window.__DBG.game.runOutcome === 'victory' && window.__DBG.game.state === 'gameover')
    && await guest.evaluate(() => window.__DBG.game.runOutcome === 'victory' && window.__DBG.game.state === 'gameover' && window.__DBG.game.reactor.captures === 3));
  check('主客按各自本地纪录独立判定新纪录', await host.evaluate(() => window.__lastResult.isBest === true && window.__DBG.game.best === 1000)
    && await guest.evaluate(() => window.__lastResult.isBest === false && window.__DBG.game.best === 9999));
  await guest.evaluate(() => window.__DBG.game.quitToLobby());
  check('胜利客机快捷键不能提前清空构筑返回大厅', await guest.evaluate(() => window.__DBG.game.state === 'gameover' && window.__DBG.game.runOutcome === 'victory'));
  await guest.evaluate(() => window.__DBG.game.continueEndless());
  check('客机不能单独进入无尽分叉世界', await guest.evaluate(() => window.__DBG.game.state === 'gameover' && !window.__DBG.game.endless));
  for (const p of [host, guest]) await p.evaluate(() => {
    for (const peer of window.__DBG.game.mp.peers.values()) peer.lastSeenAt = performance.now() - 10000;
  });
  await host.evaluate(() => {
    const g = window.__DBG.game; g.continueEndless(); g.mp.hostTickPeers(0); g.hostCheckWipe();
  });
  await settle();
  check('房主继续无尽令双端保留本局进入战斗', await host.evaluate(() => window.__DBG.game.state === 'playing' && window.__DBG.game.endless)
    && await guest.evaluate(() => window.__DBG.game.state === 'playing' && window.__DBG.game.endless));

  check('停留结算超过3秒不误判离线或团灭并保留真实倒地', await host.evaluate(() => {
    const g = window.__DBG.game, peer = [...g.mp.peers.values()][0];
    return g.state === 'playing' && g.player.dead && !peer.away && g.mp.peerAvailable(peer);
  }) && await guest.evaluate(() => !window.__DBG.game.player.dead));
  await host.evaluate(() => window.__DBG.game.quitToLobby());
  await settle();
  check('房主返回大厅令全队同步重置', await host.evaluate(() => window.__DBG.game.state === 'lobby' && !window.__DBG.game.endless)
    && await guest.evaluate(() => window.__DBG.game.state === 'lobby' && !window.__DBG.game.endless));

  await host.evaluate(() => {
    const g = window.__DBG.game; g.state = 'gameover'; g.net.ws.close();
  });
  await host.waitForFunction(() => window.__DBG.game.state === 'title');
  check('结算阶段断线返回主菜单', await host.evaluate(() => !window.__DBG.game.mp && !window.__DBG.game.net));
  await guest.waitForFunction(() => window.__DBG.game.state === 'title');
  check('房间解散客机正常返回主菜单', await guest.evaluate(() => !window.__DBG.game.mp));

  check('会话dispose移除全部60个曳光且幂等', await host.evaluate(async () => {
    const g = window.__DBG.game;
    const { MpSession } = await import('./js/mp.js');
    const net = { isHost: true, on() {}, send() {} };
    const before = g.scene.children.length;
    const mp = new MpSession(g, net, 'test');
    let geoDisposed = 0, matDisposed = 0;
    mp.tracerGeometry.addEventListener('dispose', () => geoDisposed++);
    mp.tracerMaterial.addEventListener('dispose', () => matDisposed++);
    const allocated = g.scene.children.length - before;
    mp.dispose(); mp.dispose();
    return allocated === 60 && g.scene.children.length === before && geoDisposed === 1 && matDisposed === 1;
  }));
  assert.deepEqual(errors, [], '浏览器不得出现运行异常');
  console.log('联机规则回归全部通过');
} finally {
  await Promise.all(browsers.map(b => b.close()));
  server.kill();
}
