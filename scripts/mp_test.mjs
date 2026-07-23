// 联机端到端测试：同源服务 → 建房 → 加入 → 开战 → 同步 → 伤害 → 拾取 → 倒地重生 → 团灭 → 满员限制
import { spawn } from 'child_process';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const externalUrl = process.argv[2];
const URL = externalUrl || 'http://localhost:8133/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let failed = 0;
const check = (name, cond) => {
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}`);
  if (!cond) failed++;
};

// 默认启动生产同构的单端口服务；传入 URL 时验证外部部署。
const server = externalUrl ? null : spawn('python3', ['scripts/server.py', '8133'], { stdio: 'pipe' });
await sleep(800);

// 每个客户端独立浏览器实例（单页即前台标签，rAF 不被节流）
const browsers = [];
async function newBrowser() {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 640, height: 400 },
  });
  browsers.push(b);
  return b;
}

async function jsClick(page, id) {
  await page.evaluate((i) => document.getElementById(i).click(), id);
}
async function newPage(tag) {
  const page = await (await newBrowser()).newPage();
  page.on('pageerror', (e) => errors.push(`[${tag}] ` + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ` + m.text()); });
  await page.goto(URL + '?lowfx=1&bench=1', { waitUntil: 'networkidle0' });
  await sleep(1200);
  return page;
}

try {
const A = await newPage('A');
await jsClick(A, 'mp-btn');
await jsClick(A, 'mp-create-btn');
await sleep(1500);
const room = await A.$eval('#lobby-room', (el) => el.textContent);
const pass = await A.$eval('#lobby-pass', (el) => el.textContent);
console.log(`房间: ${room} / ${pass}`);
check('房主进入大厅', await A.evaluate(() => window.__DBG.state() === 'lobby'));

const B = await newPage('B');
await jsClick(B, 'mp-btn');
await B.evaluate(() => { document.getElementById('mp-name').value = '队友B'; });
await B.type('#mp-room', room);
await B.type('#mp-pass', pass);
await jsClick(B, 'mp-join-btn');
await sleep(1500);
check('客机进入大厅', await B.evaluate(() => window.__DBG.state() === 'lobby'));
check('大厅显示 2 人', await B.evaluate(() => document.querySelectorAll('.lobby-player').length === 2));

// 房主开战
await jsClick(A, 'lobby-start-btn');
await sleep(1500);
check('房主进入战斗', await A.evaluate(() => window.__DBG.state() === 'playing'));
check('客机进入战斗', await B.evaluate(() => window.__DBG.state() === 'playing'));
check('联机大地图', await A.evaluate(() => window.__DBG.game.arena === 52));

// B 移动，A 应看到 B 的远程位置
await B.keyboard.down('KeyW');
await sleep(1200);
await B.keyboard.up('KeyW');
const bPos = await B.evaluate(() => ({ x: window.__DBG.game.player.pos.x, z: window.__DBG.game.player.pos.z }));
const aSeesB = await A.evaluate(() => {
  const p = [...window.__DBG.game.mp.peers.values()][0];
  return p ? { x: p.x, z: p.z } : null;
});
check('位置同步 (误差<6)', aSeesB && Math.hypot(aSeesB.x - bPos.x, aSeesB.z - bPos.z) < 6);

// 伤害事件：B 的输出应到达主机
await A.evaluate(() => {
  const mp = window.__DBG.game.mp;
  window.__dmgCount = 0;
  const orig = mp._applyDmgEvents.bind(mp);
  mp._applyDmgEvents = (l) => { window.__dmgCount += l.length; orig(l); };
});
await B.mouse.move(700, 300);
await sleep(4000);
await B.mouse.move(500, 500);
await sleep(4000);
check('客机伤害事件到达主机', await A.evaluate(() => window.__dmgCount > 0));
check('客机看到敌人(快照)', await B.evaluate(() => window.__DBG.game.enemies.list.some((e) => e.active)));

// 宝石拾取：在 B 脚下放宝石 → 团队经验 + B 的大招充能
await A.evaluate(() => {
  const g = window.__DBG.game;
  const b = [...g.mp.peers.values()][0];
  g.pickups.dropGems(b.x, b.z, 5);
});
await sleep(2000);
check('主机团队经验入账', await A.evaluate(() => window.__DBG.game.player.xp > 0 || window.__DBG.game.player.level > 1));
check('客机大招充能', await B.evaluate(() => window.__DBG.game.ult > 0));

// 客机倒地 → 重生
await B.evaluate(() => window.__DBG.hurt(99999));
await sleep(700);
check('客机倒地', await B.evaluate(() => window.__DBG.game.player.dead));
check('重生倒计时显示', await B.evaluate(() => !document.getElementById('respawn-overlay').classList.contains('hidden')));
console.log('  …等待重生 (11s)');
await sleep(11000);
check('客机重生', await B.evaluate(() => !window.__DBG.game.player.dead && window.__DBG.game.player.alive));

// 团灭：B 再次倒地 + A 倒地 → 双方结算 → 返回大厅
await B.evaluate(() => window.__DBG.hurt(99999));
await sleep(500);
await A.evaluate(() => window.__DBG.hurt(99999));
await sleep(2000);
check('主机团灭结算', await A.evaluate(() => window.__DBG.state() === 'gameover'));
check('客机收到团灭', await B.evaluate(() => window.__DBG.state() === 'gameover'));
await A.keyboard.press('KeyR');
await sleep(800);
check('返回大厅', await A.evaluate(() => window.__DBG.state() === 'lobby'));

// 满员限制：当前房间 2 人，再进 C、D 成功，E 应被拒
for (const tag of ['C', 'D']) {
  const P = await newPage(tag);
  await P.click('#mp-btn');
  await P.type('#mp-room', room);
  await P.type('#mp-pass', pass);
  await P.click('#mp-join-btn');
  await sleep(900);
  check(`${tag} 加入成功`, await P.evaluate(() => window.__DBG.state() === 'lobby'));
}
const E = await newPage('E');
await jsClick(E, 'mp-btn');
await E.type('#mp-room', room);
await E.type('#mp-pass', pass);
await jsClick(E, 'mp-join-btn');
await sleep(900);
check('E 被拒（满员）', await E.evaluate(() => window.__DBG.state() === 'title' && document.getElementById('mp-status').textContent.includes('已满')));
check('房间上限 4 人', await A.evaluate(() => window.__DBG.game.mp.playerCount === 4));

console.log('---- page errors:', errors.length);
errors.slice(0, 10).forEach((e) => console.log(e));
} finally {
  await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
  if (server) server.kill();
}

process.exit(failed + (errors.length ? 1 : 0));
