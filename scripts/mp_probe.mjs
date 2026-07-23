// 探针：开战后 6 秒，抓取主机/客机双方世界状态与消息计数
import { spawn } from 'child_process';
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const relay = spawn('python3', ['scripts/relay_server.py', '8124'], { stdio: 'pipe' });
await sleep(800);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', protocolTimeout: 20000,
  args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  defaultViewport: { width: 640, height: 400 },
});
async function jsClick(page, id) { await page.evaluate((i) => document.getElementById(i).click(), id); }
async function mk(tag) {
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${tag} err]`, e.message.slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error') console.log(`[${tag} console]`, m.text().slice(0, 200)); });
  await p.goto('http://localhost:8123/index.html?lowfx=1&bench=1', { waitUntil: 'networkidle0' });
  await sleep(1000);
  return p;
}
const A = await mk('A');
await jsClick(A, 'mp-btn');
await jsClick(A, 'mp-create-btn');
await sleep(1200);
const room = await A.$eval('#lobby-room', (el) => el.textContent);
const pass = await A.$eval('#lobby-pass', (el) => el.textContent);
const B = await mk('B');
await jsClick(B, 'mp-btn');
await B.type('#mp-room', room);
await B.type('#mp-pass', pass);
await jsClick(B, 'mp-join-btn');
await sleep(1200);
// 消息计数探针
await B.evaluate(() => {
  const mp = window.__DBG.game.mp;
  window.__msgCount = {};
  const orig = mp._onMsg.bind(mp);
  mp._onMsg = (from, d) => { window.__msgCount[d.k] = (window.__msgCount[d.k] || 0) + 1; orig(from, d); };
});
await jsClick(A, 'lobby-start-btn');
await sleep(6000);
const dumpA = await A.evaluate(() => {
  const g = window.__DBG.game;
  return {
    state: g.state, isHost: g.mp.isHost,
    enemies: g.enemies.list.filter((e) => e.active).length,
    telegraphs: g.enemies.telegraphs.filter((t) => t.active).length,
    spawnT: g.enemies.spawnT.toFixed(2),
    time: g.time.toFixed(1),
  };
});
console.log('A:', JSON.stringify(dumpA));
const dumpB = await B.evaluate(() => {
  const g = window.__DBG.game;
  return {
    state: g.state, isHost: g.mp.isHost,
    enemies: g.enemies.list.filter((e) => e.active).length,
    telegraphs: g.enemies.telegraphs.filter((t) => t.active).length,
    peers: g.mp.peers.size,
    msgs: window.__msgCount,
  };
});
console.log('B:', JSON.stringify(dumpB));
await browser.close();
relay.kill();
