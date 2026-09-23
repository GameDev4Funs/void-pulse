// Regression of actual game flow: bounded fixed steps, onboarding, mission/endless,
// skill refund rules, shield protection, records, and volcanic objective pressure.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { missionComplete } from '../js/mission.js';
import { recordKey, bestRecord, saveRecord } from '../js/records.js';
assert.equal(missionComplete(600, 3), true);
assert.equal(missionComplete(599.99, 3), false);
assert.equal(missionComplete(600, 2), false);
assert.equal(missionComplete(999, 8, true), false);
const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
const keys = [recordKey('station'), recordKey('cryo'), recordKey('station', 2, true), recordKey('station', 3, true), recordKey('station', 1, false, true)];
assert.equal(new Set(keys).size, 5);
for (const [i, key] of keys.entries()) assert.equal(saveRecord(key, { score: 100 + i, time: 600 }).isBest, true);
assert.equal(bestRecord(keys[0]), 100);
assert.equal(saveRecord(keys[0], { score: 99 }).isBest, false);
memory.set('vp_records_v2', 'invalid JSON'); assert.equal(bestRecord(keys[0]), 0);
const port = 8144, url = process.argv[2] || `http://localhost:${port}/index.html?bench=1&lowfx=1`;
const server = process.argv[2] ? null : spawn('python3', ['scripts/server.py', String(port)], { stdio: 'pipe' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser;
try {
  if (server) for (let i = 0; ; i++) {
    if ((await fetch(`http://localhost:${port}/healthz`).catch(() => null))?.ok) break;
    if (i > 50) throw new Error('server startup timeout');
    await sleep(100);
  }
  browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__DBG?.game);
  const timing = await page.evaluate(() => {
    const g = window.__DBG.game; g.renderer.setAnimationLoop(null); g.bench = true;
    g.enemies.director = () => {};
    const results = [];
    for (const fps of [60, 30, 20, 10]) {
      g.start(); g.tutorialXpSpawned = true; g.input.clear(); g.input.keys.add('KeyW');
      g.player.pos.set(0, .75, 0); g.clock.getDelta = () => 1 / fps;
      g.ui._fpsAcc = 0; g.ui._fpsN = 0;
      for (let i = 0; i < 2 * fps; i++) g.frameInner();
      results.push({ fps, time: g.time, z: g.player.pos.z, shown: document.getElementById('fps').textContent, state: g.state });
    }
    const before = g.time; g.togglePause(true); g.frameInner();
    const paused = g.time === before; g.togglePause(false); g._skipElapsed = true; g.clock.getDelta = () => 15; g.frameInner();
    return { results, paused, hiddenSkipped: g.time === before };
  });
  for (const r of timing.results) {
    assert.ok(Math.abs(r.time - 2) < 1e-6, JSON.stringify(r));
    assert.ok(Math.abs(r.z - timing.results[0].z) < .001, JSON.stringify(r));
    assert.equal(r.shown, `${r.fps} FPS`);
    assert.equal(r.state, 'playing');
  }
  assert.ok(timing.paused && timing.hiddenSkipped);
  console.log('✓ 60/30/20/10 FPS movement/time match, displayed FPS is real, pause/hidden time is skipped');
  const onboarding = await page.evaluate(() => {
    const g = window.__DBG.game; g.start(); g.clock.getDelta = () => 1 / 60;
    const spawnOutside = Math.hypot(g.player.pos.x, g.player.pos.z) > 6;
    for (let i = 0; i < 120; i++) g.frameInner();
    const autoLevel = g.player.level;
    g.input.keys.add('KeyW');
    for (let i = 0; i < 300 && g.state === 'playing'; i++) g.frameInner();
    return { pos: { x: g.player.pos.x, z: g.player.pos.z }, xp: g.player.xp, gems: g.pickups.gems.filter(x => x.active).map(x=>({x:x.pos.x,z:x.pos.z,value:x.value})), spawnOutside, autoLevel, level: g.player.level, state: g.state, mission: document.getElementById('mission-status').textContent };
  });
  assert.ok(onboarding.spawnOutside); assert.equal(onboarding.autoLevel, 1);
  assert.ok(onboarding.level >= 2, JSON.stringify(onboarding)); assert.equal(onboarding.state, 'levelup'); assert.ok(onboarding.mission.includes('0/3'));
  console.log('✓ New run requires moving to first XP; first upgrade and mission instructions are reachable');
  const skill = await page.evaluate(() => {
    const g = window.__DBG.game; g.start(); g.pulse = 100;
    g.routeTiers.pyro = 3; g.routeTiers.volt = 3;
    for (let i = 0; i < 40; i++) { const e = g.enemies.spawnNow('chaser', 1, 10, false); if (e) e.hp = 1; }
    let secondary = 0; const area = g.areaDamage; g.areaDamage = (...args) => { secondary++; return area.apply(g, args); };
    g.activatePulse(); g.areaDamage = area;
    const refund = g.pulse, skillsNoSecondary = secondary === 0;
    const survivor = g.enemies.spawnNow('tank', 1, 10, false); survivor.hp = survivor.maxHp = 10000;
    g.resolvePulseDamage({ sourceId: 'solo', x: 0, z: 10 }); const noSkillBurn = survivor.burnT === 0;
    g.player.dead = true; g.pulse = 0; g.ult = 0;
    const boss = g.enemies.spawnNow('boss', 15, 15, false); boss.hp = 1; g.damageEnemy(boss, 10);
    const noDeadCharge = g.pulse === 0 && g.ult === 0;
    g.start(); g.player.grantShield(); const hp = g.player.stats.hp;
    g.player.takeDamage(20, g); g.player.takeDamage(20, g);
    return { refund, skillsNoSecondary, noSkillBurn, noDeadCharge, shieldProtects: hp === g.player.stats.hp };
  });
  assert.ok(skill.refund > 0 && skill.refund <= 25, JSON.stringify(skill));
  assert.ok(skill.skillsNoSecondary && skill.noSkillBurn && skill.noDeadCharge && skill.shieldProtects);
  console.log('✓ Q ordinary-kill refund <=25, no skill burn/secondary effects, no downed charge, shield grants hit protection');
  const mission = await page.evaluate(async () => {
    const g = window.__DBG.game; localStorage.removeItem('vp_records_v2'); g.start(); g.tutorialXpSpawned = true;
    g.time = 599.99; g.score = 1234; g.reactor.captures = 3; g.upgrades.apply((await import('./js/upgrades.js')).UPGRADES.find(u => u.id === 'p_dmg'));
    const damage = g.player.stats.dmgMul, missionKey = g.recordId;
    g.recordDamage('solo', 'blaster', 321); g._skipElapsed = false; g.clock.getDelta = () => 1 / 60; g.frameInner();
    const victory = g.runOutcome === 'victory' && g.state === 'gameover';
    const summary = document.getElementById('go-summary').textContent;
    g.continueEndless(); const endlessKey = g.recordId;
    const continued = g.state === 'playing' && g.endless && g.player.stats.dmgMul === damage;
    g.time = 999; g.frameInner(); const staysPlaying = g.state === 'playing';
    g.quitToTitle(); g.selectPlanet('volcanic'); g.start();
    const hz = g.planet.hazard;
    g.world.update(0, hz.first + hz.every + 6, g.reactor);
    const central = g.world.hazardInfo.central && g.world.hazardAt(0, 0);
    g.world.update(0, hz.first + 6, g.reactor); const alternating = !g.world.hazardAt(0, 0);
    return { victory, summary, continued, staysPlaying, partitioned: missionKey !== endlessKey, saved: !!JSON.parse(localStorage.getItem('vp_records_v2') || '{}')[missionKey], central, alternating };
  });
  assert.ok(mission.victory && mission.continued && mission.staysPlaying && mission.partitioned && mission.saved, JSON.stringify(mission));
  assert.ok(mission.summary.includes('321') && mission.summary.includes('脉冲枪'));
  assert.ok(mission.central && mission.alternating);
  console.log('✓ Mission completion, damage recap, build-preserving endless, independent record, alternating central volcanic hazard');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); server?.kill(); }
