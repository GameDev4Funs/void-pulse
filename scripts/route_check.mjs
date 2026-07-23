// 流派羁绊 + 湮灭协议 专项验证
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
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
await sleep(500);

const routes = await page.evaluate(() => {
  const g = window.__DBG.game;
  // 模拟一路叠加燃烧：脉冲枪5 + 导弹5 + 增幅5 = 15 级 → 焚天(III)
  g.upgrades.taken = { blaster: 5, missiles: 5, p_dmg: 5 };
  g.weapons.levels.blaster = 5; g.weapons.levels.missiles = 5;
  g.recountRoutes();
  return {
    pyro: g.routes.pyro, pyroTier: g.routeTiers.pyro,
    dmgFx: g.routeFx.dmg,
  };
});
console.log('routes:', JSON.stringify(routes));

const ult = await page.evaluate(() => {
  const g = window.__DBG.game;
  const before = g.enemies.list.filter((e) => e.active).length;
  g.ult = 100;
  return { before, ultReady: g.ult };
});
console.log('ult before:', JSON.stringify(ult));
await sleep(2500);   // 让场上有些敌人
await page.keyboard.press('KeyE');
await sleep(1200);
const ultAfter = await page.evaluate(() => {
  const g = window.__DBG.game;
  return {
    active: g.enemies.list.filter((e) => e.active && e.type !== 'boss').length,
    ult: g.ult, uses: g.ultUses,
    chain: g.chain, state: g.state,
  };
});
console.log('ult after:', JSON.stringify(ultAfter));
await page.screenshot({ path: './shots/11_ult.png' });
console.log('errors:', errors.length, errors.slice(0, 5));
await browser.close();
process.exit(errors.length ? 1 : 0);
