// Regression: native keyboard menus, build information, quality persistence,
// small planet previews, and touch coordinates/cancellation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const port = 8142;
const url = process.argv[2] || `http://localhost:${port}/index.html`;
const server = process.argv[2] ? null : spawn('python3', ['scripts/server.py', String(port)], { stdio: 'pipe' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
const errors = [];
const shots = await mkdtemp(join(tmpdir(), 'void-pulse-ui-'));
try {
  if (server) for (let i = 0; ; i++) {
    if ((await fetch(`http://localhost:${port}/healthz`).catch(() => null))?.ok) break;
    if (i > 50) throw new Error('server startup timeout');
    await sleep(100);
  }
  browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const resources = [];
  page.on('request', (req) => resources.push(req.url()));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__DBG?.game);
  assert.equal(resources.filter((r) => /assets\/planets\/.+-ground/.test(r)).length, 0, 'title must not load unselected planet terrain');
  assert.equal(resources.filter((r) => /assets\/ui\/planet-/.test(r)).length, 4);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'start-btn');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__DBG.game.state === 'playing');
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => window.__DBG.game.ui.buildOpen);
  assert.equal(await page.evaluate(() => window.__DBG.game.state), 'paused');
  assert.equal(await page.$eval('#build-screen', (el) => el.inert), false);
  assert.equal(await page.$$eval('.build-item', (items) => items.length), 14);
  const build = await page.$eval('#build-content', (el) => el.textContent);
  for (const name of ['湮灭射线', '风暴剑域', '蜂群蜂巢', '天罚雷狱', '超新星坍缩']) assert.ok(build.includes(name), name);
  for (const value of ['4 级', '8 级', '13 级', '单次伤害', '下级', '缺少']) assert.ok(build.includes(value), value);
  await sleep(400); // let the panel entrance transition finish before visual inspection
  await page.screenshot({ path: join(shots, 'build.png') });
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'build-close', 'build focus remains in dialog');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__DBG.game.state === 'playing');
  await page.click('#combat-menu-btn');
  assert.equal(await page.evaluate(() => window.__DBG.game.state), 'paused');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'resume-btn');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'quit-btn', 'pause quit is a keyboard button');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__DBG.game.state === 'title');
  await page.click('#settings-btn');
  await page.select('#quality', 'low');
  await page.click('#reduced-motion');
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('vp_settings')));
  assert.equal(prefs.quality, 'low'); assert.equal(prefs.reducedMotion, true);
  assert.equal(await page.evaluate(() => document.body.classList.contains('reduced-motion')), true);
  assert.equal(await page.evaluate(() => window.__DBG.game.bloom?.enabled ?? false), false);
  await page.focus('#music-volume');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__DBG.game.ui.settingsOpen);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-btn');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__DBG?.game);
  assert.equal(await page.evaluate(() => window.__DBG.game.settings.quality), 'low');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__DBG.game.state === 'playing');
  await page.evaluate(() => window.__DBG.giveXp(12));
  await page.waitForFunction(() => !document.getElementById('levelup-screen').classList.contains('hidden') && !document.querySelector('#cards .card').disabled);
  assert.equal(await page.$eval('#cards .card', (el) => el.tagName), 'BUTTON');
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => window.__DBG.game.ui.buildOpen);
  const beforeChoice = await page.evaluate(() => JSON.stringify(window.__DBG.game.upgrades.taken));
  await page.keyboard.press('Digit1');
  await sleep(80);
  assert.equal(await page.evaluate(() => JSON.stringify(window.__DBG.game.upgrades.taken)), beforeChoice, 'build overlay must block upgrade shortcut');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__DBG.game.ui.buildOpen);
  assert.equal(await page.evaluate(() => window.__DBG.game.state), 'levelup');
  await page.focus('#cards .card');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#cards .card')].indexOf(document.activeElement)), 1);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__DBG.game.state === 'playing');
  await page.evaluate(() => window.__DBG.game.completeMission());
  await page.waitForFunction(() => window.__DBG.game.state === 'gameover');
  assert.equal(await page.$eval('#go-title', (el) => el.textContent), '能源修复完成');
  assert.ok((await page.$eval('#go-summary', (el) => el.textContent)).includes('最终构筑'));
  await page.click('#continue-endless-btn');
  await page.waitForFunction(() => window.__DBG.game.state === 'playing' && window.__DBG.game.endless);
  const touch = await browser.newPage();
  touch.on('pageerror', (error) => errors.push(error.message));
  await touch.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await touch.goto(url, { waitUntil: 'networkidle0' });
  await touch.waitForFunction(() => window.__DBG?.game);
  assert.equal(await touch.evaluate(() => window.__DBG.game.input.isTouch), true);
  assert.ok(!(await touch.$eval('#controls-grid', (el) => el.textContent)).includes('WASD'));
  await touch.evaluate(() => document.getElementById('start-btn').click());
  await touch.waitForFunction(() => window.__DBG.game.state === 'playing');
  const session = await touch.createCDPSession();
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 675, id: 7 }] });
  const center = await touch.$eval('#stick-base', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  assert.ok(Math.abs(center.x - 90) < 1 && Math.abs(center.y - 675) < 1, JSON.stringify(center));
  await touch.screenshot({ path: join(shots, 'touch.png') });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 130, y: 650, id: 7 }] });
  assert.ok(await touch.evaluate(() => window.__DBG.game.input.joy.x > 0));
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.equal(await touch.evaluate(() => window.__DBG.game.input.joy.active), false);
  const dash = await touch.$eval('#btn-dash', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...dash, id: 8 }] });
  assert.equal(await touch.evaluate(() => window.__DBG.game.input.keys.has('Space')), true);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.equal(await touch.evaluate(() => window.__DBG.game.input.keys.has('Space')), false);
  assert.deepEqual(errors, []);
  console.log('UI review regression passed: keyboard menus/cards, modal shortcut isolation, build recipes, saved quality, preview payload, victory/endless UI, touch joystick and cancel. Screenshots:', shots);
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
