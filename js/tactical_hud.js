import { REACTOR } from './reactor.js';
import { DIRECTOR } from './config.js';
import { MISSION } from './mission.js';

export class TacticalHud {
  constructor(game) {
    this.game = game; this.timer = 0;
    this.canvas = document.getElementById('radar');
    this.ctx = this.canvas.getContext('2d');
    this.title = document.getElementById('objective-title');
    this.detail = document.getElementById('objective-detail');
    this.fill = document.getElementById('objective-fill');
    this.wave = document.getElementById('wave-status');
    this.hint = document.getElementById('field-hint');
    this.mission = document.getElementById('mission-status');
  }
  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const g = this.game, r = g.reactor;
    const active = r.phase === 'active';
    const distance = Math.hypot(g.player.pos.x, g.player.pos.z);
    const left = Math.max(0, Math.ceil(MISSION.seconds - g.time));
    this.mission.textContent = g.endless ? `无尽挑战 · 已修复 ${r.captures} 次` : `撤离条件：修复 ${Math.min(MISSION.captures, r.captures)}/${MISSION.captures} · ${left > 0 ? `坚守 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '坚守完成'}`;
    this.title.textContent = r.buffLeft > 0 ? `能源急速 · ${Math.ceil(r.buffLeft)}s` : active ? '夺取反应堆' : `反应堆 · ${Math.ceil(r.left)}s 后上线`;
    this.detail.textContent = r.buffLeft > 0 ? '全队射速 +25% · 已夺取 ' + r.captures + ' 次'
      : active ? `${Math.ceil(r.left)}s 内完成 · ${distance <= REACTOR.radius ? (r.contested ? '敌人干扰 · 清理光环内敌人' : '正在充能 · 圈内最多3人加速') : `距离中心 ${Math.ceil(distance)}m · 进入金色光环`}`
      : '坚守光环 7 秒 → 修复 / 超载 / 团队急速';
    this.fill.style.transform = `scaleX(${r.buffLeft > 0 ? r.buffLeft / REACTOR.buff : active ? r.charge / REACTOR.hold : 0})`;
    this.fill.style.background = r.buffLeft > 0 ? '#4dff88' : '#ffd23e';
    const phase = g.enemies.paceAt(g.time).phase;
    const within = g.time % DIRECTOR.waveSeconds;
    const until = (phase === 'advance' ? DIRECTOR.surgeAt : phase === 'surge' ? DIRECTOR.respiteAt : DIRECTOR.waveSeconds) - within;
    const hazard = g.world.hazardInfo;
    this.wave.textContent = hazard.phase !== 'calm' ? (hazard.phase === 'warning' ? `⚠ ${hazard.central ? '中央' : ''}${g.planet.hazard.name}预警 · 离开闪烁区域` : `⚡ ${g.planet.hazard.name} · 避开亮色区域`)
      : `${{ advance: '推进', surge: '虫潮高峰', respite: '喘息 · 回收碎片' }[phase]} · ${Math.ceil(until)}s`;
    const fallen = g.mp && [...g.mp.peers.values()].find((p) => p.ready && p.dead && !p.away);
    const nearFallen = fallen && Math.hypot(g.player.pos.x - fallen.x, g.player.pos.z - fallen.z);
    this.hint.textContent = g.mp?.hostAway ? '房主暂离 · 全队已暂停'
      : g.player.dead ? (g.rescueActive ? '队友正在协助修复 · 恢复速度 ×2' : '等待修复 · 队友靠近4m内可加速')
      : fallen ? `队友倒地 · 距离 ${Math.ceil(nearFallen)}m · 靠近4m内协助修复`
      : g.player.level < 2 && g.time < 45 ? (g.input.isTouch ? '向上拖动摇杆，收集前方绿色碎片完成升级' : '按 W 向前移动，收集绿色碎片完成第一次升级')
      : g.time < 24 ? '24秒反应堆上线 · 进入中央金色光环充能，完成修复'
      : g.time < 35 ? (g.input.isTouch ? '自动开火 · 右侧冲刺避伤 · 点击构筑查看强化与进化配方' : 'SPACE 冲刺避伤 · F 切换瞄准 · B 查看构筑与进化配方')
      : g.pulse >= 100 ? (g.input.isTouch ? '超载已就绪 · 点击右侧超载按钮解围' : 'Q 超载已就绪 · 被包围时释放') : '';
    document.getElementById('aim-mode').textContent = g.input.isTouch ? '触屏自动瞄准' : g.settings.autoAim ? '自动瞄准 [F]' : '鼠标瞄准 [F]';
    this.draw();
  }
  draw() {
    const g = this.game, c = this.ctx, size = this.canvas.width, margin = 7;
    const scale = (size - margin * 2) / (g.arena * 2);
    const xy = (n) => size / 2 + n * scale;
    c.clearRect(0, 0, size, size);
    c.fillStyle = '#081321'; c.fillRect(0, 0, size, size);
    c.strokeStyle = '#1c4558'; c.lineWidth = 1;
    c.strokeRect(margin, margin, size - margin * 2, size - margin * 2);
    c.beginPath(); c.moveTo(size / 2, margin); c.lineTo(size / 2, size - margin);
    c.moveTo(margin, size / 2); c.lineTo(size - margin, size / 2); c.stroke();
    const dot = (x, z, r, color) => { c.fillStyle = color; c.beginPath(); c.arc(xy(x), xy(z), r, 0, Math.PI * 2); c.fill(); };
    const hz = g.world.hazardInfo;
    if (hz.phase !== 'calm') {
      c.fillStyle = hz.phase === 'active' ? `#${g.planet.hazard.color.toString(16).padStart(6, '0')}88` : '#ffaa3355';
      const { offset, width } = hz;
      for (const sign of hz.central ? [1] : [-1, 1]) {
        if (hz.axis === 0) c.fillRect(xy(sign * offset - width / 2), margin, width * scale, size - margin * 2);
        else c.fillRect(margin, xy(sign * offset - width / 2), size - margin * 2, width * scale);
      }
    }
    for (const p of g.world.colliders) dot(p.x, p.z, Math.max(1.5, p.r * scale), '#466473');
    for (const e of g.enemies.list) if (e.active && !e.dying) dot(e.pos.x, e.pos.z, e.type === 'boss' ? 3 : 1.2, '#ff5679');
    c.fillStyle = g.reactor.phase === 'active' ? '#ffd23e' : '#3d9299';
    c.save(); c.translate(size / 2, size / 2); c.rotate(Math.PI / 4); c.fillRect(-3, -3, 6, 6); c.restore();
    c.fillStyle = '#ffd23e';
    for (const s of g.pickups.supplies) if (s.active) c.fillRect(xy(s.x) - 2, xy(s.z) - 2, 4, 4);
    if (g.mp) for (const p of g.mp.peers.values()) {
      if (g.mp.peerAvailable(p)) dot(p.x, p.z, 2.8, '#ffd23e');
      else if (p.ready && p.dead && !p.away) {
        dot(p.x, p.z, 3, '#ff5679');
        c.strokeStyle = '#ffffff'; c.beginPath();
        c.arc(xy(p.x), xy(p.z), 4 * scale, 0, Math.PI * 2); c.stroke();
      }
    }
    if (g.player.alive && !g.player.dead) {
      dot(g.player.pos.x, g.player.pos.z, 3.2, '#2ee6ff');
      c.strokeStyle = '#bffaff'; c.beginPath();
      c.moveTo(xy(g.player.pos.x), xy(g.player.pos.z));
      c.lineTo(xy(g.player.pos.x) + g.player.aimDir.x * 8, xy(g.player.pos.z) + g.player.aimDir.z * 8); c.stroke();
    }
  }
}
