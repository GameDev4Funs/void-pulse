import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const external = process.argv[2];
const url = external || 'http://localhost:8136/index.html';
const out = process.env.VP_SHOTS || await mkdtemp(join(tmpdir(), 'void-pulse-actors-'));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 900 },
});
const server = external ? null : spawn('python3', ['scripts/server.py', '8136'], { stdio: 'pipe' });
const errors = [];
try {
  if (server) for (let i = 0; ; i++) {
    if ((await fetch('http://localhost:8136/healthz').catch(() => null))?.ok) break;
    if (i === 49) throw new Error('Actor test server unavailable');
    await new Promise((r) => setTimeout(r, 100));
  }
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__DBG.game.player.art.ready && window.__DBG.game.enemies.list.every((e) => e.art.ready));
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { updateEnemyArt, attachShipArt } = await import('./js/actor_art.js');
    const game = window.__DBG.game;
    game.renderer.setAnimationLoop(null);
    const types = [...new Set(game.enemies.list.map((e) => e.type))];
    const textures = new Set([game.player.art.material.map, ...game.enemies.list.map((e) => e.art.material.map)]);
    const alpha = [...textures].map((map) => {
      const c = document.createElement('canvas'); c.width = map.image.width; c.height = map.image.height;
      const ctx = c.getContext('2d'); ctx.drawImage(map.image, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let clear = 0; for (let i = 3; i < data.length; i += 4) if (data[i] === 0) clear++;
      return { color: map.colorSpace, transparent: clear / (data.length / 4) };
    });
    const e = game.enemies.list.find((e) => e.type === 'splitter');
    e.mesh.rotation.set(1.7, 2.1, 0.3); e.elite = true; e.flashT = 0.09;
    updateEnemyArt(e, 1, 0);
    const q = e.mesh.quaternion.clone().multiply(e.art.mesh.quaternion);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const directionCorrect = normal.y > 0.999 && forward.x > 0.999;
    const flash = e.art.material.color.r > 2 && e.art.eliteRing.visible;
    e.elite = false; e.flashT = 0; updateEnemyArt(e, 0, 1);
    const reset = e.art.material.color.r === 1 && !e.art.eliteRing.visible;
    e.mesh.rotation.set(0, 0, 0);
    const shared = game.player.art.mesh.geometry;
    let sharedDisposed = false;
    shared.addEventListener('dispose', () => { sharedDisposed = true; });
    const peer = new THREE.Group(); const fallback = new THREE.MeshBasicMaterial();
    for (let i = 0; i < 20; i++) {
      const art = attachShipArt(peer, [fallback], 0xffd23e);
      art.dispose();
    }
    return { types, textures: textures.size, alpha, directionCorrect, flash, reset,
      lifecycle: !sharedDisposed && peer.children.length === 0,
      fallbackHidden: !game.player.bodyMat.visible && game.enemies.list.every((e) => !e.mat.visible) };
  });
  assert.equal(result.types.length, 10); assert.equal(result.textures, 3);
  assert.ok(result.alpha.every((x) => x.color === 'srgb' && x.transparent > 0.15));
  assert.ok(result.directionCorrect && result.flash && result.reset && result.lifecycle && result.fallbackHidden);
  console.log('✓ 玩家、九类普通敌人、Boss 全覆盖，三张透明 sRGB 贴图共享');
  console.log('✓ 朝向/防翻面/受击/精英重置与二十次队友美术释放正确');
  await page.click('#start-btn');
  await page.evaluate(async () => {
    const { updateEnemyArt } = await import('./js/actor_art.js');
    const g = window.__DBG.game; g.enemies.reset(); g.player.pos.set(0, 0.75, 8);
    g.player.mesh.rotation.set(0, Math.PI, 0);
    const types = ['chaser', 'speeder', 'splitter', 'mini', 'shooter', 'tank', 'bomber', 'hunter', 'weaver'];
    types.forEach((type, i) => {
      const e = g.enemies.spawnNow(type, (i % 5 - 2) * 4.5, i < 5 ? -3 : 3, i === 0);
      e.popT = 0; e.mesh.scale.setScalar(e.elite ? 1.35 : 1); updateEnemyArt(e, 0, 1);
    });
    const boss = g.enemies.spawnNow('boss', 0, -11, false);
    boss.popT = 0; boss.mesh.scale.setScalar(1); updateEnemyArt(boss, 0, 1);
    g.camera.position.set(0, 30, 19); g.camera.lookAt(0, 0, -1); g.composer.render();
  });
  await page.screenshot({ path: join(out, 'actor-lineup.png') });
  await page.close();

  const fallback = await browser.newPage();
  fallback.on('pageerror', (e) => errors.push(e.message));
  await fallback.setRequestInterception(true);
  fallback.on('request', (r) => r.url().includes('/assets/actors/') ? r.abort() : r.continue());
  await fallback.goto(url, { waitUntil: 'networkidle0' });
  await fallback.click('#start-btn');
  assert.ok(await fallback.evaluate(() => window.__DBG.state() === 'playing' && window.__DBG.game.player.bodyMat.visible
    && !window.__DBG.game.player.art.ready && window.__DBG.game.enemies.list.every((e) => e.mat.visible && !e.art.ready)));
  console.log('✓ 全部角色图片请求失败仍可战斗，完整保留几何回退');
  await fallback.close();
  assert.deepEqual(errors, []);
  console.log('✓ 无浏览器运行错误；原生画质角色展示截图：', out);
} finally {
  try { await browser.close(); } finally { server?.kill(); }
}
