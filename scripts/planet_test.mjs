// 四星球真实浏览器回归：菜单/准星/美术/数值/攻击模式/房主权威/换局。
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { PLANETS, getPlanet, isPlanetId, applyPlanetStats } from '../js/planets.js';

assert.equal(PLANETS.length, 4);
assert.equal(isPlanetId('__proto__'), false);
assert.equal(getPlanet('invalid').id, 'station');
for (const planet of PLANETS) {
  const stats = { hp: 100, maxHp: 100, speedMul: 1, dashCd: 2.5, dmgMul: 1, magnet: 3 };
  applyPlanetStats(stats, planet);
  assert.equal(stats.hp, stats.maxHp);
  assert.ok(planet.hazard.first > 30 && planet.hazard.damage <= 10);
}
const external = process.argv[2];
const url = external || 'http://localhost:8138/index.html';
const shots = await mkdtemp(join(tmpdir(), 'void-pulse-planets-'));
const server = external ? null : spawn('python3', ['scripts/server.py', '8138'], { stdio: 'pipe' });
const browsers = [], errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const ready = (page) => page.waitForFunction(() => Object.values(window.__DBG?.game.world.textureStatus || {}).length === 3 && Object.values(window.__DBG.game.world.textureStatus).every((s) => s === 'ready'));
async function pageFor(tag) {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 800 },
  });
  browsers.push(browser);
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(tag + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await ready(page);
  return page;
}
try {
  if (server) for (let i = 0; ; i++) {
    if ((await fetch('http://localhost:8138/healthz').catch(() => null))?.ok) break;
    if (i > 50) throw new Error('server startup timeout');
    await sleep(100);
  }
  const host = await pageFor('host');
  await host.screenshot({ path: join(shots, 'planet-selector.png') });
  await host.focus('#title-planets [data-planet="cryo"]');
  await host.keyboard.press('Space'); await frame(host);
  assert.equal(await host.evaluate(() => window.__DBG.state()), 'title');
  assert.equal(await host.evaluate(() => window.__DBG.game.planet.id), 'cryo');
  await host.keyboard.press('Enter'); await frame(host);
  assert.equal(await host.evaluate(() => window.__DBG.state()), 'title');
  await host.keyboard.press('Tab'); await host.keyboard.press('Tab'); await host.keyboard.press('Tab');
  assert.equal(await host.evaluate(() => document.activeElement.id), 'start-btn');
  await host.keyboard.press('Enter'); await frame(host);
  assert.equal(await host.evaluate(() => window.__DBG.state()), 'playing');
  await host.keyboard.press('Space'); await frame(host);
  assert.ok(await host.evaluate(() => window.__DBG.game.player.dashCdT > 0), 'keyboard start must not trap dash focus');
  await host.evaluate(() => window.__DBG.game.quitToTitle());
  for (const planet of PLANETS) {
    await host.click('#title-planets [data-planet="' + planet.id + '"]');
    await ready(host);
    assert.equal(await host.$eval('#title-planets [aria-pressed="true"]', (e) => e.dataset.planet), planet.id);
    await host.click('#start-btn');
    await frame(host);
    assert.ok((await host.$eval('#app canvas', (e) => getComputedStyle(e).cursor)).includes('crosshair.svg'));
    const actual = await host.evaluate(() => {
      const g = window.__DBG.game;
      const stats = { ...g.player.stats };
      const blocked = g.selectPlanet(g.planet.id === 'station' ? 'cryo' : 'station');
      g.player.stats.armor = 9999;
      g.togglePause(true);
      return { stats, blocked, planet: g.planet.id, world: g.world.planetId,
        floor: g.world.root.getObjectByName('alloy-floor').material.map.name,
        matching: g.world.colliders.every((c, i) => Math.hypot(c.x - g.world.coverMeshes[i].position.x, c.z - g.world.coverMeshes[i].position.z) < 1e-8) };
    });
    assert.equal(actual.blocked, false);
    assert.equal(actual.planet, planet.id); assert.equal(actual.world, planet.id); assert.ok(actual.matching);
    assert.equal(actual.floor, planet.floor || 'floor-alloy-v1.jpg');
    for (const [key, value] of Object.entries(planet.player)) {
      const base = { speedMul: 1, dashCd: 2.5, dmgMul: 1, maxHp: 100, magnet: 3 }[key];
      assert.ok(Math.abs(actual.stats[key] - base * value) < 1e-8);
    }
    await frame(host);
    assert.ok(!(await host.$eval('#app canvas', (e) => getComputedStyle(e).cursor)).includes('crosshair.svg'));
    await host.click('#resume-btn');
    await host.click('#settings-btn');
    await frame(host);
    assert.ok(!(await host.$eval('#app canvas', (e) => getComputedStyle(e).cursor)).includes('crosshair.svg'));
    await host.click('#settings-close');
    const behavior = await host.evaluate(() => {
      const g = window.__DBG.game, e = g.enemies;
      g.togglePause(true); e.reset();
      const types = new Set(Array.from({ length: 800 }, () => e.pickType(400)));
      const early = new Set(Array.from({ length: 100 }, () => e.pickType(0)));
      const shooter = e.spawnNow('shooter', 0, -12, false);
      shooter.fireT = 0; e.updateShooter(shooter, .01);
      const bullets = e.ebullets.filter((b) => b.active).length;
      const webs = e.webZones.filter((w) => w.active).length;
      const hp = g.player.stats.hp;
      g.world.update(0, g.planet.hazard.first + 6);
      const inHazard = g.world.hazardAt(Math.min(21, g.arena * .31), 0);
      const slow = g.arenaHazardFactorAt(Math.min(21, g.arena * .31), 0);
      e.reset(); g.world.update(0, 0);
      return { types: [...types], early: [...early], bullets, webs, hp, inHazard, slow };
    });
    const allowed = planet.roster?.map(([ty]) => ty) || ['chaser', 'speeder', 'splitter', 'shooter', 'tank', 'bomber', 'hunter', 'weaver'];
    assert.deepEqual(behavior.types.sort(), allowed.sort());
    assert.deepEqual(behavior.early, ['chaser']);
    assert.equal(behavior.bullets, { single: 1, fan: 3, heavy: 2, spore: 1 }[planet.shot]);
    assert.equal(behavior.webs, planet.shot === 'spore' ? 1 : 0);
    assert.ok(behavior.inHazard); assert.equal(behavior.slow, planet.hazard.slow);
    // 暂停状态隐藏面板后取真实画面，不影响正在运行的联机房间。
    await host.evaluate(() => {
      const g = window.__DBG.game;
      g.ui.showPause(false);
      g.enemies.spawnNow(g.planet.summons[0], -5, -8, false);
      g.enemies.spawnNow(g.planet.summons[1], 6, -7, false);
      for (const e of g.enemies.list) if (e.active) { e.popT = 0; e.mesh.scale.setScalar(1); }
    });
    await frame(host);
    await host.screenshot({ path: join(shots, planet.id + '.png') });
    await host.evaluate(() => { const g = window.__DBG.game; g.quitToTitle(); g.start(); g.togglePause(true); });
    const statsAgain = await host.evaluate(() => ({ ...window.__DBG.game.player.stats }));
    assert.equal(statsAgain.speedMul, actual.stats.speedMul);
    assert.equal(statsAgain.dmgMul, actual.stats.dmgMul);
    assert.equal(statsAgain.maxHp, actual.stats.maxHp);
    if (planet.id === 'mycelium') {
      const poison = await host.evaluate(() => {
        const g = window.__DBG.game;
        g.player.stats.hp = 80; g.player.iFrames = 0;
        g.enemies.dropWeb(g.player.pos.x, g.player.pos.z);
        g.updatePlaying(.51, .51);
        const damaged = g.player.stats.hp;
        g.enemies.reset(); g.player.stats.hp = 50;
        g.updatePlaying(1, 1);
        const healed = g.player.stats.hp;
        g.player.stats.hp = 0;
        g.updatePlaying(.02, .02);
        return { damaged, healed, state: g.state };
      });
      assert.ok(poison.damaged < 80 && poison.damaged > 70, JSON.stringify(poison));
      assert.ok(Math.abs(poison.healed - 50.6) < 0.01);
      assert.equal(poison.state, 'dying', 'regen must not undo lethal damage');
    }
    await host.evaluate(() => window.__DBG.game.quitToTitle());
    console.log('✓ ' + planet.name + '：地表/掩体/敌群/弹幕/环境/属性与重开正确');
  }
  const memory = [];
  for (let i = 0; i < 12; i++) {
    await host.click('#title-planets [data-planet="' + PLANETS[i % 4].id + '"]');
    await ready(host); await frame(host);
    memory.push(await host.evaluate(() => window.__DBG.game.renderer.info.memory.textures));
  }
  assert.ok(Math.max(...memory.slice(4)) <= memory[3] + 1, JSON.stringify(memory));
  console.log('✓ 连续切换十二次无 GPU 贴图增长', memory);

  // 两台真正独立的浏览器，避免标签后台策略被误当作联机暂停。
  await host.click('#mp-btn'); await host.click('#mp-create-btn');
  await host.waitForFunction(() => window.__DBG.state() === 'lobby');
  const [room, pass] = await host.evaluate(() => [document.getElementById('lobby-room').textContent, document.getElementById('lobby-pass').textContent]);
  const guest = await pageFor('guest');
  await guest.click('#title-planets [data-planet="station"]');
  await guest.click('#mp-btn'); await guest.type('#mp-room', room); await guest.type('#mp-pass', pass);
  await guest.click('#mp-join-btn');
  await guest.waitForFunction(() => window.__DBG.state() === 'lobby' && window.__DBG.game.planet.id === 'mycelium');
  assert.ok(await guest.$$eval('#lobby-planets button', (buttons) => buttons.every((b) => b.disabled)));
  assert.equal(await guest.evaluate(() => window.__DBG.game.selectPlanet('cryo')), false);
  await guest.evaluate(() => window.__DBG.game.mp.send({ k: 'planet', id: 'cryo' }));
  await sleep(150);
  assert.equal(await host.evaluate(() => window.__DBG.game.planet.id), 'mycelium');
  await host.click('#lobby-planets [data-planet="volcanic"]');
  await host.focus('#lobby-planets [data-planet="volcanic"]');
  await host.keyboard.press('Enter'); await frame(host);
  assert.equal(await host.evaluate(() => window.__DBG.state()), 'lobby');
  await guest.waitForFunction(() => window.__DBG.game.planet.id === 'volcanic');
  await host.keyboard.press('Tab'); await host.keyboard.press('Tab');
  assert.equal(await host.evaluate(() => document.activeElement.id), 'lobby-start-btn');
  await host.keyboard.press('Enter');
  await guest.waitForFunction(() => window.__DBG.state() === 'playing');
  for (const p of [host, guest]) {
    await ready(p);
    assert.deepEqual(await p.evaluate(() => {
      const g = window.__DBG.game;
      return [g.planet.id, g.world.planetId, g.arena, g.player.stats.maxHp, g.player.stats.dmgMul];
    }), ['volcanic', 'volcanic', 80, 110, 1.18]);
    await p.evaluate(() => window.__DBG.god());
  }
  await host.evaluate(() => {
    const g = window.__DBG.game, e = g.enemies.spawnNow('shooter', 0, -12, false);
    e.fireT = 0; g.enemies.updateShooter(e, .01);
  });
  await guest.waitForFunction(() => window.__DBG.game.enemies.ebullets.filter((b) => b.active).length >= 2);
  assert.ok(await guest.evaluate(() => window.__DBG.game.enemies.ebullets.some((b) => b.active && Math.abs(b.vel.length() - 10) < .01)));
  console.log('✓ 熔核双弹由房主生成并以相同弹速同步客机');
  await host.evaluate(() => {
    const g = window.__DBG.game, d = { k: 'gov', sc: 1, tm: 2, kl: 0, lv: 1, sec: 1 };
    g.mp.send(d); g.mpGameOver(d); g.quitToLobby();
  });
  await guest.waitForFunction(() => window.__DBG.state() === 'gameover');
  await host.click('#lobby-planets [data-planet="cryo"]');
  await guest.waitForFunction(() => window.__DBG.game.planet.id === 'cryo');
  await host.click('#lobby-start-btn');
  await guest.waitForFunction(() => window.__DBG.state() === 'playing' && window.__DBG.game.planet.id === 'cryo');
  for (const p of [host, guest]) {
    assert.deepEqual(await p.evaluate(() => {
      const g = window.__DBG.game; return [g.world.planetId, g.player.stats.maxHp, g.player.stats.dmgMul, g.player.stats.speedMul, g.player.stats.dashCd];
    }), ['cryo', 100, 1, 1.12, 2]);
  }
  console.log('✓ 大厅选择/客机权限/开局同步/结算未返回队友/跨星球重开一致');
  await host.evaluate(() => window.__DBG.game.quitToTitle());
  await guest.waitForFunction(() => window.__DBG.state() === 'title');
  assert.equal(await guest.evaluate(() => window.__DBG.game.planet.id), 'station');
  await guest.close();

  await host.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await host.reload({ waitUntil: 'networkidle0' });
  await host.click('#title-planets [data-planet="mycelium"]');
  assert.ok(await host.evaluate(() => {
    const panel = document.getElementById('title-screen');
    return panel.scrollWidth <= innerWidth + 1;
  }));
  await host.screenshot({ path: join(shots, 'mobile-menu.png') });
  await host.click('#start-btn'); await frame(host);
  assert.ok(!await host.evaluate(() => document.body.classList.contains('in-combat')));
  await host.evaluate(() => window.__DBG.game.quitToTitle());
  await host.setViewport({ width: 568, height: 320 });
  await host.click('#title-planets [data-planet="volcanic"]');
  await host.click('#start-btn');
  assert.equal(await host.evaluate(() => window.__DBG.state()), 'playing');
  console.log('✓ 手机竖屏无横向裁切，小屏横向可选星球并出击，触屏无鼠标准星');
  assert.deepEqual(errors, []);
  console.log('✓ 控制台无异常；截图：' + shots);
} finally {
  await Promise.all(browsers.map((b) => b.close()));
  server?.kill('SIGTERM');
}
