import { REACTOR } from './reactor.js';
import { DIRECTOR } from './config.js';

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
  }
  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const g = this.game, r = g.reactor;
    const active = r.phase === 'active';
    const distance = Math.round(Math.hypot(g.player.pos.x, g.player.pos.z));
    this.title.textContent = r.buffLeft > 0 ? `能源急速 · ${Math.ceil(r.buffLeft)}s` : active ? '夺取反应堆' : `反应堆 · ${Math.ceil(r.left)}s 后上线`;
    this.detail.textContent = r.buffLeft > 0 ? '全队射速 +25% · 已夺取 ' + r.captures + ' 次'
      : active ? `${Math.ceil(r.left)}s 内完成 · ${distance <= REACTOR.radius ? (r.contested ? '敌人干扰 · 清理光环内敌人' : '正在充能 · 多人协作加速') : `距离中心 ${distance}m · 进入金色光环`}`
      : '坚守光环 7 秒 → 修复 / 超载 / 团队急速';
    this.fill.style.transform = `scaleX(${r.buffLeft > 0 ? r.buffLeft / REACTOR.buff : active ? r.charge / REACTOR.hold : 0})`;
    this.fill.style.background = r.buffLeft > 0 ? '#4dff88' : '#ffd23e';
    const phase = g.enemies.paceAt(g.time).phase;
    const within = g.time % DIRECTOR.waveSeconds;
    const until = (phase === 'advance' ? DIRECTOR.surgeAt : phase === 'surge' ? DIRECTOR.respiteAt : DIRECTOR.waveSeconds) - within;
    const hazard = g.world.hazardInfo;
    this.wave.textContent = hazard.phase !== 'calm' ? (hazard.phase === 'warning' ? '⚠ 放电预警 · 离开橙色区域' : '⚡ 放电中 · 避开红色区域')
      : `${{ advance: '推进', surge: '虫潮高峰', respite: '喘息 · 回收碎片' }[phase]} · ${Math.ceil(until)}s`;
    this.hint.textContent = g.mp?.hostAway ? '房主暂离 · 全队已暂停'
      : g.time < 18 ? 'WASD 移动 · SPACE 冲刺避伤 · 自动开火 · F 切换瞄准'
      : g.time < 30 ? '小地图：青点是你 · 黄点是队友 · 方块是补给 · 菱形是反应堆'
      : g.pulse >= 100 ? 'Q 超载已就绪 · 被包围时释放' : '';
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
      c.fillStyle = hz.phase === 'active' ? '#ef355866' : '#ffaa3355';
      const offset = Math.min(21, g.arena * 0.31), width = Math.min(11, g.arena * 0.18);
      for (const sign of [-1, 1]) {
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
    if (g.mp) for (const p of g.mp.peers.values()) if (p.ready && !p.dead) dot(p.x, p.z, 2.8, '#ffd23e');
    if (g.player.alive && !g.player.dead) {
      dot(g.player.pos.x, g.player.pos.z, 3.2, '#2ee6ff');
      c.strokeStyle = '#bffaff'; c.beginPath();
      c.moveTo(xy(g.player.pos.x), xy(g.player.pos.z));
      c.lineTo(xy(g.player.pos.x) + g.player.aimDir.x * 8, xy(g.player.pos.z) + g.player.aimDir.z * 8); c.stroke();
    }
  }
}
