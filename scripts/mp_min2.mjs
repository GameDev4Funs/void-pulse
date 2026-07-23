// 双页复现：建房+加入+开战 → 探测两页心跳，找出谁冻结
import { spawn } from 'child_process';
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const relay = spawn('python3', ['scripts/relay_server.py', '8124'], { stdio: 'inherit' });
await sleep(800);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', protocolTimeout: 15000,
  args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  defaultViewport: { width: 800, height: 500 },
});
async function mk(tag) {
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${tag} err]`, e.message.slice(0, 150)));
  p.on('console', (m) => { if (m.type() === 'error') console.log(`[${tag} console]`, m.text().slice(0, 150)); });
  await p.goto('http://localhost:8123/index.html?lowfx=1&bench=1&ws=ws%3A%2F%2Flocalhost%3A8124', { waitUntil: 'networkidle0' });
  await sleep(1000);
  await p.evaluate(() => {
    window.__beats = 0;
    const g = window.__DBG.game;
    const orig = g.frame.bind(g);
    g.frame = () => { window.__beats++; orig(); };
  });
  return p;
}
const beats = async (p, tag) => {
  try {
    const b1 = await p.evaluate(() => window.__beats);
    await sleep(1000);
    const b2 = await p.evaluate(() => window.__beats);
    console.log(`${tag} beats: ${b1} -> ${b2} ${b2 > b1 ? 'ALIVE' : 'FROZEN'}`);
  } catch (e) { console.log(`${tag} evaluate FAILED: ${e.message.slice(0, 80)}`); }
};

const A = await mk('A');
await A.click('#mp-btn');
await A.click('#mp-create-btn');
await sleep(1200);
const room = await A.$eval('#lobby-room', (el) => el.textContent);
const pass = await A.$eval('#lobby-pass', (el) => el.textContent);
console.log('room', room, pass);

const B = await mk('B');
await B.click('#mp-btn');
await B.type('#mp-room', room);
await B.type('#mp-pass', pass);
await B.click('#mp-join-btn');
await sleep(1200);
console.log('B state:', await B.evaluate(() => window.__DBG.state()));

console.log('--- 大厅心跳 ---');
await beats(A, 'A');
await beats(B, 'B');

console.log('--- 开战 ---');
await A.click('#lobby-start-btn');
await sleep(2000);
await beats(A, 'A');
await beats(B, 'B');
await sleep(2000);
await beats(A, 'A');
await beats(B, 'B');
await browser.close();
relay.kill();
