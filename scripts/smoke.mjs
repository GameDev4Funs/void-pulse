// 无头冒烟测试：加载游戏 → 截图各阶段 → 报告控制台错误
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] || 'http://localhost:8123/index.html';
const OUT = './shots';

const errors = [];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox', '--mute-audio', '--window-size=1280,800',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  ],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('requestfailed', (r) => errors.push('[reqfail] ' + r.url() + ' ' + (r.failure()?.errorText || '')));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await sleep(2500);
await page.screenshot({ path: `${OUT}/1_title.png` });

// 开始游戏（回车等效点击开始按钮）
await page.keyboard.press('Enter');
await sleep(1200);
const state1 = await page.evaluate(() => window.__DBG?.state());
console.log('after start state =', state1);

// 移动 + 瞄准，模拟实战
await page.keyboard.down('KeyW');
await page.mouse.move(800, 300);
await sleep(1500);
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyD');
await page.mouse.move(300, 500);
await sleep(1500);
await page.keyboard.up('KeyD');
await page.screenshot({ path: `${OUT}/2_gameplay.png` });

// 冲刺
await page.keyboard.down('KeyA');
await page.keyboard.press('Space');
await sleep(900);
await page.keyboard.up('KeyA');

// 直接发经验 → 触发升级选卡（60 XP 会连升多级，循环选完）
await page.evaluate(() => window.__DBG.giveXp(60));
await sleep(800);
const state2 = await page.evaluate(() => window.__DBG.state());
console.log('after giveXp state =', state2);
await page.screenshot({ path: `${OUT}/3_levelup.png` });
for (let i = 0; i < 12; i++) {
  const st = await page.evaluate(() => window.__DBG.state());
  if (st !== 'levelup') break;
  await page.keyboard.press('Digit1');
  await sleep(350);
}
console.log('after picks state =', await page.evaluate(() => window.__DBG.state()));

// 再打一会儿（让副武器有机会表现）
await page.evaluate(() => { window.__DBG.giveXp(0); });
await page.keyboard.down('KeyS');
await sleep(1200);
await page.keyboard.up('KeyS');
await page.screenshot({ path: `${OUT}/4_combat.png` });

// 超载
await page.evaluate(() => { window.__DBG.game.pulse = 100; });
await page.keyboard.press('KeyQ');
await sleep(500);
await page.screenshot({ path: `${OUT}/5_pulse.png` });

// 召 Boss
await page.evaluate(() => window.__DBG.boss());
await sleep(4500);
await page.screenshot({ path: `${OUT}/6_boss.png` });
console.log('bossActive =', await page.evaluate(() => !!window.__DBG.game.enemies.bossActive));

// 死亡 → 结算
await page.evaluate(() => window.__DBG.hurt(99999));
await sleep(2500);
console.log('final state =', await page.evaluate(() => window.__DBG.state()));
await page.screenshot({ path: `${OUT}/7_gameover.png` });

// 重新开始
await page.keyboard.press('KeyR');
await sleep(800);
console.log('after restart state =', await page.evaluate(() => window.__DBG.state()));

// FPS 采样
const fps = await page.evaluate(() => document.getElementById('fps').textContent);
console.log('fps label =', fps);

console.log('---- errors:', errors.length);
errors.slice(0, 20).forEach((e) => console.log(e));
await browser.close();
process.exit(errors.length ? 1 : 0);
