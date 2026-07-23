// 最小复现：单页 创建房间→单人开战→观察是否卡死
import { spawn } from 'child_process';
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const relay = spawn('python3', ['scripts/relay_server.py', '8124'], { stdio: 'inherit' });
await sleep(800);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', protocolTimeout: 30000,
  args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 800, height: 500 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto('http://localhost:8123/index.html?lowfx=1&ws=ws%3A%2F%2Flocalhost%3A8124', { waitUntil: 'networkidle0' });
await sleep(1200);
// 心跳探针
await page.evaluate(() => {
  window.__beats = 0;
  const g = window.__DBG.game;
  const orig = g.frame.bind(g);
  g.frame = () => { window.__beats++; orig(); };
});
await page.click('#mp-btn');
await page.click('#mp-create-btn');
await sleep(1500);
console.log('state:', await page.evaluate(() => window.__DBG.state()));
const beats0 = await page.evaluate(() => window.__beats);
console.log('lobby beats/s:', await (async () => { await sleep(1000); return (await page.evaluate(() => window.__beats)) - beats0; })());
console.log('点击开战…');
await page.click('#lobby-start-btn');
await sleep(500);
try {
  const s = await Promise.race([
    page.evaluate(() => window.__DBG.state()),
    sleep(5000).then(() => 'EVAL_TIMEOUT'),
  ]);
  console.log('after begin state:', s);
  const b0 = window.__beats;
  const b1 = await page.evaluate(() => window.__beats).catch(() => -1);
  await sleep(1000);
  const b2 = await page.evaluate(() => window.__beats).catch(() => -2);
  console.log('playing beats:', b1, '->', b2, b2 > b1 ? 'ALIVE' : 'FROZEN');
} catch (e) {
  console.log('FROZEN:', e.message.slice(0, 120));
}
await browser.close();
relay.kill();
