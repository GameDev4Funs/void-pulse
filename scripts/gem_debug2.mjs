import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 800, height: 500 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[err]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('http://localhost:8123/index.html?lowfx=1', { waitUntil: 'networkidle0' });
await sleep(1200);
await page.keyboard.press('Enter');
await sleep(500);
await page.evaluate(() => {
  const g = window.__DBG.game;
  window.__DBG.god();
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 20;
    g.pickups.dropGems(g.player.pos.x + Math.cos(a) * d, g.player.pos.z + Math.sin(a) * d, 1);
  }
  g.pickups.magnetAll();
});
const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
for (let i = 0; i < 8; i++) {
  await page.keyboard.down(keys[i % 4]);
  await sleep(600);
  await page.keyboard.up(keys[i % 4]);
  const s = await page.evaluate(() => {
    const g = window.__DBG.game;
    const act = g.pickups.gems.filter((q) => q.active);
    let maxD = 0;
    for (const gm of act) maxD = Math.max(maxD, Math.hypot(gm.pos.x - g.player.pos.x, gm.pos.z - g.player.pos.z));
    return { left: act.length, maxD: maxD.toFixed(1) };
  });
  console.log(JSON.stringify(s));
}
await browser.close();
