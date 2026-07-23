// 视觉验证：新卡片 UI / 流派面板 / 湮灭光束
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('http://localhost:8123/index.html', { waitUntil: 'networkidle0' });
await sleep(1200);
await page.keyboard.press('Enter');
await sleep(600);

// 布局：燃烧 7 级(觉醒I) + 雷霆 4 级(觉醒I) + 虚空 1 级，武器若干级 → 卡片应显示刻度/NEW/流派徽章
await page.evaluate(() => {
  const g = window.__DBG.game;
  window.__DBG.god();
  g.upgrades.taken = { blaster: 3, missiles: 3, p_dmg: 1, p_rate: 4, p_hp: 1 };
  g.weapons.levels = { blaster: 3, blades: 0, missiles: 3, tesla: 0, nova: 0 };
  g.recountRoutes();
});
await sleep(400);
await page.evaluate(() => window.__DBG.giveXp(20));
await sleep(700);
await page.screenshot({ path: './shots/12_cards_locked.png' });   // 防误点锁定态
await sleep(500);
await page.screenshot({ path: './shots/13_cards.png' });          // 完整卡片 UI
// 选一张后继续
await page.keyboard.press('Digit1');
await sleep(400);

// 大招光束：场上拉满敌人再按 E，抓住光束帧
await page.evaluate(() => {
  const g = window.__DBG.game;
  g.time = 100;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 18;
    g.enemies.spawnNow(['chaser', 'speeder', 'bomber'][i % 3], g.player.pos.x + Math.cos(a) * d, g.player.pos.z + Math.sin(a) * d, false);
  }
  g.ult = 100;
});
await sleep(300);
await page.keyboard.press('KeyE');
await sleep(400);
await page.screenshot({ path: './shots/14_ult_beam.png' });
await sleep(1500);
await page.screenshot({ path: './shots/15_after_ult.png' });
console.log('errors:', errors.length, errors.slice(0, 5));
await browser.close();
process.exit(errors.length ? 1 : 0);
