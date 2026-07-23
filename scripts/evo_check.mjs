// 进化卡出现逻辑验证
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
await page.goto('http://localhost:8123/index.html', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 500));
const res = await page.evaluate(() => {
  const g = window.__DBG.game;
  const u = g.upgrades;
  // 无进化条件时
  const noneBefore = u.availableEvolutions().length;
  // 脉冲枪满级 + 超频 → 应出湮灭射线
  g.weapons.levels.blaster = 5;
  u.taken.p_rate = 1;
  const after1 = u.availableEvolutions().map((e) => e.id);
  // 全部满级 + 全被动
  g.weapons.levels = { blaster: 5, blades: 5, missiles: 5, tesla: 5, nova: 5 };
  Object.assign(u.taken, { p_speed: 1, p_dmg: 1, p_crit: 1, p_hp: 1 });
  const all = u.availableEvolutions().map((e) => e.id);
  const cards = u.rollCards(3);
  const firstIsEvo = cards[0].kind === 'evolve';
  // 应用进化
  u.apply(cards[0]);
  const evolvedSet = Object.entries(g.weapons.evolved).filter(([, v]) => v).map(([k]) => k);
  // 应用后不再出现
  const afterApply = u.availableEvolutions().length;
  const view = u.cardView(cards[0]);
  return { noneBefore, after1, all, firstIsEvo, evolvedSet, afterApply, viewCls: view.cls, viewTag: view.tag };
});
console.log(JSON.stringify(res, null, 1));
console.log('errors:', errors.length, errors.slice(0, 3));
await browser.close();
process.exit(errors.length ? 1 : 0);
