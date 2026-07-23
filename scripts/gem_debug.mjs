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
  g.pickups.dropGems(g.player.pos.x + 10, g.player.pos.z, 3);
  g.pickups.magnetAll();
});
for (let i = 0; i < 5; i++) {
  await sleep(500);
  const s = await page.evaluate(() => {
    const g = window.__DBG.game;
    const gm = g.pickups.gems.find((q) => q.active);
    if (!gm) return 'collected';
    const p = g.player.pos;
    return {
      d: Math.hypot(gm.pos.x - p.x, gm.pos.z - p.z).toFixed(2),
      v: Math.hypot(gm.vel.x, gm.vel.z).toFixed(2),
      mag: gm.magnet,
      players: g.getPickupPlayers().length,
    };
  });
  console.log(JSON.stringify(s));
}
await browser.close();
