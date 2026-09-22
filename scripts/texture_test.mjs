// 真实 WebGL 浏览器：美术资源、重复切图、失败回退和延迟加载生命周期。
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const externalUrl = process.argv[2];
const url = externalUrl || 'http://localhost:8135/index.html';
const out = process.env.VP_SHOTS || await mkdtemp(join(tmpdir(), 'void-pulse-art-'));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const errors = [];
const waitTextures = (page, status = 'ready') => page.waitForFunction((expected) => {
  const statuses = window.__DBG?.game.world.textureStatus;
  return statuses && Object.values(statuses).every((value) => value === expected);
}, { timeout: 15000 }, status);
const frame = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const server = externalUrl ? null : spawn('python3', ['scripts/server.py', '8135'], { stdio: 'pipe' });

try {
  if (server) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch('http://localhost:8135/healthz').catch(() => null);
      if (response?.ok) break;
      if (attempt >= 49) throw new Error('Texture test server did not become ready');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await waitTextures(page);
  const maps = await page.evaluate(() => {
    const world = window.__DBG.game.world;
    const floor = world.root.getObjectByName('alloy-floor').material.map;
    const deck = world.root.getObjectByName('reactor-deck');
    const hulls = new Set();
    let hullUses = 0;
    world.root.traverse((obj) => {
      if (obj.material?.map?.name === 'facility-hull-v1.jpg') { hulls.add(obj.material.map); hullUses++; }
    });
    return {
      width: floor.image.width, height: floor.image.height, colorSpace: floor.colorSpace,
      repeat: floor.repeat.x, expectedRepeat: (window.__DBG.game.arena * 2 + 8) / 12,
      hullMaps: hulls.size, hullUses,
      deckTop: deck.material[1].map.name, deckSideUnmapped: deck.material[0].map === null,
      colliders: world.colliders.length,
    };
  });
  assert.equal(maps.width, 1024); assert.equal(maps.height, 1024);
  assert.equal(maps.colorSpace, 'srgb'); assert.equal(maps.repeat, maps.expectedRepeat);
  assert.equal(maps.hullMaps, 1); assert.equal(maps.hullUses, 10);
  assert.equal(maps.deckTop, 'reactor-deck-v1.jpg'); assert.ok(maps.deckSideUnmapped);
  assert.equal(maps.colliders, 8);
  console.log('✓ 三张贴图已加载；sRGB/平铺/设施共享/顶面 UV/八个原碰撞体正确');

  await page.click('#start-btn');
  await page.evaluate(() => window.__DBG.god());
  await frame(page);
  await page.screenshot({ path: join(out, 'alloy-arena.png') });
  await page.evaluate(() => {
    const game = window.__DBG.game;
    game.time = 25;
  });
  await frame(page);
  await page.screenshot({ path: join(out, 'reactor-objective.png') });
  const baseline = await page.evaluate(() => window.__DBG.game.renderer.info.memory.textures);
  const counts = [];
  for (let i = 0; i < 8; i++) {
    await page.evaluate((size) => window.__DBG.game.setArena(size), i % 2 ? 34 : 80);
    await waitTextures(page); await frame(page);
    counts.push(await page.evaluate(() => window.__DBG.game.renderer.info.memory.textures));
  }
  assert.ok(Math.max(...counts) <= baseline + 1, JSON.stringify({ baseline, counts }));
  console.log('✓ 连续八次大小地图切换无 GPU 贴图增长', { baseline, counts });
  await page.evaluate(() => { window.__DBG.game.time = 81; });
  await frame(page);
  await page.screenshot({ path: join(out, 'hazard-contrast.png') });
  await page.close();

  const fallback = await browser.newPage();
  fallback.on('pageerror', (error) => errors.push(error.message));
  await fallback.setRequestInterception(true);
  fallback.on('request', (request) => {
    if (request.url().includes('/assets/textures/')) request.abort(); else request.continue();
  });
  await fallback.goto(url, { waitUntil: 'networkidle0' });
  await waitTextures(fallback, 'fallback');
  await fallback.click('#start-btn');
  assert.ok(await fallback.evaluate(() => window.__DBG.state() === 'playing'
    && window.__DBG.game.world.root.getObjectByName('alloy-floor').material.map.isCanvasTexture));
  console.log('✓ 三张贴图请求全部失败时仍能开始战斗，保留网格回退');
  await fallback.close();

  const delayed = await browser.newPage();
  delayed.on('pageerror', (error) => errors.push(error.message));
  await delayed.setCacheEnabled(false);
  await delayed.setRequestInterception(true);
  const pending = [];
  let hold = true;
  delayed.on('request', (request) => {
    if (hold && request.url().includes('/assets/textures/')) pending.push(request);
    else request.continue();
  });
  await delayed.goto(url, { waitUntil: 'domcontentloaded' });
  await delayed.waitForFunction(() => window.__DBG?.game.world.textureStatus.floor === 'loading');
  await delayed.evaluate(() => {
    const game = window.__DBG.game;
    window.__retiredMaterials = [];
    for (let i = 0; i < 8; i++) {
      window.__retiredMaterials.push(game.world.root.getObjectByName('alloy-floor').material);
      game.setArena(i % 2 ? 34 : 80);
    }
  });
  hold = false;
  await Promise.all(pending.map((request) => request.continue()));
  await waitTextures(delayed); await frame(delayed);
  assert.ok(await delayed.evaluate(() => window.__retiredMaterials.every((material) => material.map.isCanvasTexture)));
  console.log('✓ 慢网络下快速切图，过期回调不会复活已销毁材质');
  assert.deepEqual(errors, []);
  console.log('✓ 无浏览器运行错误；截图：', out);
} finally {
  try { await browser.close(); } finally { server?.kill(); }
}
