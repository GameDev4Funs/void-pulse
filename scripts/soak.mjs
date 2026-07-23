// 高压浸泡测试：解锁全部敌人 + 全武器 3 级，跑 30 秒观察稳定性与性能
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const errors = [];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--mute-audio', '--window-size=1280,800', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto('http://localhost:8123/index.html', { waitUntil: 'networkidle0' });
await sleep(1500);
await page.keyboard.press('Enter');
await sleep(500);

// 上帝模式 + 时间快进到全敌人解锁 + 全武器满级进化 + 连锁被动
await page.evaluate(() => {
  const g = window.__DBG.game;
  window.__DBG.god();
  g.time = 260;
  g.weapons.levels = { blaster: 5, blades: 5, missiles: 5, tesla: 5, nova: 5 };
  g.weapons.evolved = { blaster: true, blades: true, missiles: true, tesla: true, nova: true };
  g.upgrades.taken = { blaster: 5, blades: 5, missiles: 5, tesla: 5, nova: 5, p_chain: 3, p_rate: 1, p_speed: 1, p_dmg: 1, p_crit: 1, p_hp: 1 };
  g.supplyAt = g.time + 2;             // 2 秒后空投
  g.enemies.encircleAt = g.time + 6;   // 6 秒后虫群包围
});

// 绕圈走位 30 秒
const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
await page.mouse.move(700, 350);
for (let round = 0; round < 10; round++) {
  const k = keys[round % 4];
  await page.keyboard.down(k);
  await page.mouse.move(300 + Math.random() * 700, 200 + Math.random() * 400);
  await sleep(1500);
  await page.keyboard.up(k);
  if (round === 4) await page.screenshot({ path: './shots/8_soak_mid.png' });
  // 随时按冲刺
  await page.keyboard.press('Space');
  const st = await page.evaluate(() => window.__DBG.state());
  if (st === 'levelup') { await page.keyboard.press('Digit2'); await sleep(300); }
  if (st === 'gameover') break;
}
await page.screenshot({ path: './shots/9_soak_late.png' });

const info = await page.evaluate(() => {
  const g = window.__DBG.game;
  const typeCount = {};
  for (const e of g.enemies.list) if (e.active) typeCount[e.type] = (typeCount[e.type] || 0) + 1;
  return {
    state: g.state,
    time: g.time.toFixed(1),
    types: typeCount,
    webs: g.enemies.webZones.filter((w) => w.active).length,
    storms: g.weapons.stormZones.filter((z) => z.active).length,
    supplies: g.pickups.supplies.filter((s) => s.active).length,
    chain: g.chain,
    ebullets: g.enemies.ebullets.filter((b) => b.active).length,
    particles: g.particles.count,
    kills: g.player.kills,
    score: Math.floor(g.score),
    boss: !!g.enemies.bossActive,
    shield: g.player.shield,
    fps: document.getElementById('fps').textContent,
  };
});
console.log(JSON.stringify(info));

// 暂停/恢复/静音
await page.keyboard.press('Escape');
await sleep(300);
console.log('paused =', await page.evaluate(() => window.__DBG.state()));
await page.screenshot({ path: './shots/10_pause.png' });
await page.keyboard.press('Escape');
await sleep(300);
console.log('resumed =', await page.evaluate(() => window.__DBG.state()));
await page.keyboard.press('KeyM');
await sleep(200);
await page.keyboard.press('KeyM');

console.log('---- errors:', errors.length);
errors.slice(0, 15).forEach((e) => console.log(e));
await browser.close();
process.exit(errors.length ? 1 : 0);
