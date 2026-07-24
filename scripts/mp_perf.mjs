// 四人联机性能回归：高敌人数下验证帧率、同步时钟、积压与控制台错误。
import { spawn } from 'child_process';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const externalUrl = process.argv[2];
const URL = externalUrl || 'http://localhost:8134/index.html';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = externalUrl ? null : spawn('python3', ['scripts/server.py', '8134'], { stdio: 'pipe' });
const browsers = [];
const pages = [];
const errors = [];
let failed = 0;

function check(name, condition, detail = '') {
  console.log(condition ? `  ✓ ${name}${detail}` : `  ✗ ${name}${detail}`);
  if (!condition) failed++;
}

async function newPage(tag) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 960, height: 600 },
  });
  browsers.push(browser);
  const page = await browser.newPage();
  pages.push(page);
  page.on('pageerror', (error) => errors.push(`[${tag}] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[${tag}] ${message.text()}`);
  });
  // 使用默认画质并实际执行 Bloom/composer，覆盖朋友直接打开分享地址的路径。
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    window.__fpsSamples = [];
    window.__frameTimes = [];
    let frames = 0;
    let sampleAt = performance.now();
    let previousFrameAt = sampleAt;
    const sample = (now) => {
      frames++;
      window.__frameTimes.push(now - previousFrameAt);
      if (window.__frameTimes.length > 900) window.__frameTimes.shift();
      previousFrameAt = now;
      if (now - sampleAt >= 1000) {
        window.__fpsSamples.push(frames * 1000 / (now - sampleAt));
        if (window.__fpsSamples.length > 30) window.__fpsSamples.shift();
        frames = 0;
        sampleAt = now;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return page;
}

async function click(page, id) {
  await page.evaluate((target) => document.getElementById(target).click(), id);
}

try {
  await sleep(800);
  const host = await newPage('host');
  await click(host, 'mp-btn');
  await click(host, 'mp-create-btn');
  await sleep(900);
  const room = await host.$eval('#lobby-room', (element) => element.textContent);
  const pass = await host.$eval('#lobby-pass', (element) => element.textContent);

  for (let i = 1; i < 4; i++) {
    const guest = await newPage(`guest-${i}`);
    await click(guest, 'mp-btn');
    await guest.evaluate((name) => { document.getElementById('mp-name').value = name; }, `队友${i}`);
    await guest.type('#mp-room', room);
    await guest.type('#mp-pass', pass);
    await click(guest, 'mp-join-btn');
    await sleep(600);
  }
  await sleep(800);
  check('四人全部进入大厅', await host.evaluate(() => window.__DBG.game.mp.playerCount === 4));

  await click(host, 'lobby-start-btn');
  await sleep(1200);
  await Promise.all(pages.map((page) => page.evaluate(() => window.__DBG.god())));
  await host.evaluate(() => {
    const game = window.__DBG.game;
    game.time = 260;
    const types = ['chaser', 'speeder', 'bomber', 'splitter', 'shooter', 'hunter', 'tank', 'weaver'];
    for (let i = 0; i < 120; i++) {
      const angle = i * 2.39996;
      const distance = 8 + (i % 28) * 0.65;
      game.enemies.spawnNow(
        types[i % types.length],
        game.player.pos.x + Math.cos(angle) * distance,
        game.player.pos.z + Math.sin(angle) * distance,
        i % 17 === 0,
      );
    }
  });

  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  await Promise.all(pages.map((page, index) => page.keyboard.down(keys[index])));
  await sleep(12000);
  await Promise.all(pages.map((page, index) => page.keyboard.up(keys[index])));

  const stats = await Promise.all(pages.map((page) => page.evaluate(() => {
    const game = window.__DBG.game;
    const samples = window.__fpsSamples.slice(-8);
    const frameTimes = window.__frameTimes.slice(-600).sort((a, b) => a - b);
    const p95 = frameTimes.length ? frameTimes[Math.floor((frameTimes.length - 1) * 0.95)] : Infinity;
    return {
      state: game.state,
      time: game.time,
      enemies: game.enemies.list.filter((enemy) => enemy.active).length,
      fpsAvg: samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0,
      fpsMin: samples.length ? Math.min(...samples) : 0,
      frameP95: p95,
      buffered: game.net?.ws?.bufferedAmount || 0,
    };
  })));

  const minAverageFps = Math.min(...stats.map((stat) => stat.fpsAvg));
  const maxBuffered = Math.max(...stats.map((stat) => stat.buffered));
  const maxFrameP95 = Math.max(...stats.map((stat) => stat.frameP95));
  const timeSpread = Math.max(...stats.map((stat) => stat.time)) - Math.min(...stats.map((stat) => stat.time));
  check('四端保持战斗状态', stats.every((stat) => stat.state === 'playing'));
  check('四端都收到敌人世界', stats.every((stat) => stat.enemies > 0));
  check('四端平均帧率不低于 30 FPS', minAverageFps >= 30, `（最低 ${minAverageFps.toFixed(1)}）`);
  check('四端 95% 帧时间低于 34ms', maxFrameP95 < 34, `（最差 ${maxFrameP95.toFixed(1)}ms）`);
  check('同步时钟偏差小于 1.5 秒', timeSpread < 1.5, `（偏差 ${timeSpread.toFixed(2)}s）`);
  check('浏览器发送侧无 WebSocket 积压', maxBuffered < 256 * 1024, `（最大 ${maxBuffered} bytes）`);
  check('浏览器控制台无错误', errors.length === 0, `（${errors.length}）`);
  console.log(JSON.stringify(stats, null, 2));
  errors.slice(0, 10).forEach((error) => console.log(error));
} finally {
  await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
  if (server) server.kill();
}

process.exit(failed);
