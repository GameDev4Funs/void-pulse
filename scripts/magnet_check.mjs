// 磁吸环绕 bug 验证：全局磁吸 + 持续移动 → 碎片应全部被吸收而非环绕
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', protocolTimeout: 60000,
  args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 800, height: 500 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('http://localhost:8123/index.html?lowfx=1', { waitUntil: 'networkidle0' });
await sleep(1200);
await page.keyboard.press('Enter');
await sleep(800);
await page.evaluate(() => {
  const g = window.__DBG.game;
  window.__DBG.god();
  // 撒 30 颗碎片，然后全局磁吸
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 20;
    g.pickups.dropGems(g.player.pos.x + Math.cos(a) * d, g.player.pos.z + Math.sin(a) * d, 1);
  }
  g.pickups.magnetAll();
});
// 持续移动（环绕玩家最容易复现环绕的路径）
const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
for (let i = 0; i < 8; i++) {
  await page.keyboard.down(keys[i % 4]);
  await sleep(600);
  await page.keyboard.up(keys[i % 4]);
  // 升级弹窗出现时选卡继续
  if (await page.evaluate(() => window.__DBG.state() === 'levelup')) {
    await page.keyboard.press('Digit1');
    await sleep(250);
  }
}
const left = await page.evaluate(() => window.__DBG.game.pickups.gems.filter((g) => g.active).length);
console.log('剩余未吸收碎片:', left, left <= 2 ? '✓ 磁吸正常' : '✗ 仍有环绕');
console.log('errors:', errors.length);
await browser.close();
process.exit(left > 2 ? 1 : 0);
