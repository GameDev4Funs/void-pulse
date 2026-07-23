// ============ UI：HUD / 菜单 / 升级卡牌 ============
import { formatTime, formatNum, clamp } from './utils.js';
import { XP_CURVE, PLAYER, ROUTES, ULT } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), hpFill: $('hp-fill'), hpNum: $('hp-num'),
      xpFill: $('xp-fill'), levelNum: $('level-num'),
      sector: $('sector-label'), bossBanner: $('boss-banner'),
      score: $('score'), timer: $('timer'), kills: $('kills'), best: $('best-score'),
      dashRing: $('dash-ring'), pulseBar: $('pulse-bar'), pulseFill: $('pulse-fill'),
      title: $('title-screen'), titleBest: $('title-best'), startBtn: $('start-btn'),
      levelup: $('levelup-screen'), cards: $('cards'),
      pause: $('pause-screen'), resumeBtn: $('resume-btn'), quitBtn: $('quit-btn'),
      gameover: $('gameover-screen'), goStats: $('go-stats'), goNewBest: $('go-new-best'),
      retryBtn: $('retry-btn'), menuBtn: $('menu-btn'),
      flash: $('flash'), lowhp: $('lowhp'), muteIcon: $('mute-icon'), fps: $('fps'),
      chain: $('chain'), chainNum: $('chain-num'), toast: $('toast'),
      routes: $('routes'), ultBar: $('ult-bar'), ultFill: $('ult-fill'),
      roster: $('roster'),
      mpBtn: $('mp-btn'), mpPanel: $('mp-panel'), mpName: $('mp-name'),
      mpCreateBtn: $('mp-create-btn'), mpJoinBtn: $('mp-join-btn'),
      mpRoom: $('mp-room'), mpPass: $('mp-pass'), mpStatus: $('mp-status'),
      lobby: $('lobby-screen'), lobbyRoom: $('lobby-room'), lobbyPass: $('lobby-pass'),
      lobbyPlayers: $('lobby-players'), lobbyStartBtn: $('lobby-start-btn'),
      lobbyWait: $('lobby-wait'), lobbyQuitBtn: $('lobby-quit-btn'), lobbyRoomInfo: $('lobby-room-info'),
      respawn: $('respawn-overlay'), respawnCount: $('respawn-count'),
    };
    // Boss 血条（动态创建，置于顶部中心）
    const bw = document.createElement('div');
    bw.id = 'bosshp-wrap';
    bw.className = 'hidden';
    bw.innerHTML = `<div id="bosshp-name"></div><div class="bar" style="width:min(420px,52vw);height:9px;margin:6px auto 0;border-color:rgba(255,34,102,.6)"><div id="bosshp-fill" style="background:linear-gradient(90deg,#ff2266,#ff7a9f);box-shadow:0 0 12px rgba(255,34,102,.8)"></div></div>`;
    $('hud-center').appendChild(bw);
    this.bossWrap = bw;
    this.bossFill = bw.querySelector('#bosshp-fill');
    this.bossName = bw.querySelector('#bosshp-name');
    this.bossName.style.cssText = 'font-size:11px;letter-spacing:4px;color:#ff7a9f;text-shadow:0 0 8px rgba(255,34,102,.8)';

    this._fpsAcc = 0; this._fpsN = 0; this._fpsT = 0;
    this._lastChain = 0;
    this._toastTimer = null;
  }

  toast(text, color = '#ffd23e') {
    const t = this.el.toast;
    t.textContent = text;
    t.style.color = color;
    t.style.borderColor = color;
    t.classList.remove('hidden');
    t.style.animation = 'none';
    void t.offsetWidth;             // 重启动画
    t.style.animation = '';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  bind(callbacks) {
    this.el.startBtn.addEventListener('click', callbacks.onStart);
    this.el.resumeBtn.addEventListener('click', callbacks.onResume);
    this.el.quitBtn.addEventListener('click', callbacks.onQuit);
    this.el.retryBtn.addEventListener('click', callbacks.onRetry);
    this.el.menuBtn.addEventListener('click', callbacks.onQuit);
    // 联机
    this.el.mpBtn.addEventListener('click', () => {
      this.el.mpPanel.classList.toggle('hidden');
      if (!this.el.mpName.value) this.el.mpName.value = this.game.myName;
    });
    this.el.mpCreateBtn.addEventListener('click', () => {
      const name = (this.el.mpName.value || '').trim() || this.game.myName;
      this.game.mpCreate(name);
    });
    this.el.mpJoinBtn.addEventListener('click', () => {
      const name = (this.el.mpName.value || '').trim() || this.game.myName;
      if (!this.el.mpRoom.value.trim() || !this.el.mpPass.value.trim()) {
        this.setMpStatus('请输入房间名和密码');
        return;
      }
      this.game.mpJoin(name, this.el.mpRoom.value, this.el.mpPass.value);
    });
    this.el.lobbyStartBtn.addEventListener('click', () => this.game.mpBegin());
    this.el.lobbyQuitBtn.addEventListener('click', () => this.game.quitToTitle());
    // 点击复制房名/密码
    const copy = (el) => el.addEventListener('click', () => {
      if (navigator.clipboard && el.textContent) navigator.clipboard.writeText(el.textContent).then(() => this.toast('已复制', '#4dff88'));
    });
    copy(this.el.lobbyRoom); copy(this.el.lobbyPass);
  }

  setMpStatus(t) { this.el.mpStatus.textContent = t; }

  // ---------- 大厅 ----------
  showLobby(isHost, room, pass, roster) {
    this.el.title.classList.add('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.lobby.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.lobbyRoomInfo.style.display = room ? 'block' : 'none';
    if (room) this.el.lobbyRoom.textContent = room;
    if (pass) this.el.lobbyPass.textContent = pass;
    this.el.lobbyStartBtn.classList.toggle('hidden', !isHost);
    this.el.lobbyWait.classList.toggle('hidden', isHost);
    this.lobbyRefresh(roster, isHost);
  }

  lobbyRefresh(roster, isHost) {
    if (!this.el.lobby.classList.contains('hidden')) {
      this.el.lobbyPlayers.innerHTML = roster.map((p) =>
        `<div class="lobby-player"><span>${p.name}</span><span>${p.host ? '房主' : '就绪'}</span></div>`
      ).join('');
    }
  }

  hideLobby() { this.el.lobby.classList.add('hidden'); }

  // ---------- 倒地重生 ----------
  respawnOverlay(show) { this.el.respawn.classList.toggle('hidden', !show); }
  respawnCountdown(t) { this.el.respawnCount.textContent = Math.ceil(Math.max(0, t)); }

  // ---------- 联机结算 ----------
  showMpGameOver(stats, isHost) {
    this.el.gameover.classList.remove('hidden');
    this.el.goNewBest.classList.toggle('hidden', !stats.isBest);
    this.el.goStats.innerHTML = `
      <div class="st hero"><span>小队得分</span><b>${formatNum(stats.score)}</b></div>
      <div class="st"><span>存活时间</span><b>${formatTime(stats.time)}</b></div>
      <div class="st"><span>击杀</span><b>${formatNum(stats.kills)}</b></div>
      <div class="st"><span>团队等级</span><b>${stats.level}</b></div>
      <div class="st"><span>抵达区域</span><b>SECTOR ${stats.sector}</b></div>`;
    this.el.retryBtn.textContent = '返回大厅 [R]';
    this.respawnOverlay(false);
  }

  // ---------- 屏幕切换 ----------
  showTitle(best) {
    this.el.title.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.levelup.classList.add('hidden');
    this.el.lobby.classList.add('hidden');
    this.el.mpPanel.classList.add('hidden');
    this.el.roster.innerHTML = '';
    this.el.titleBest.textContent = best > 0 ? `最高纪录 ${formatNum(best)}` : '暂无纪录 —— 去创造历史吧';
  }
  showHud() {
    this.el.title.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.pause.classList.add('hidden');
  }
  showPause(show) { this.el.pause.classList.toggle('hidden', !show); }

  showLevelUp(cards, views, onPick) {
    this.el.levelup.classList.remove('hidden');
    const wrap = this.el.cards;
    wrap.innerHTML = '';
    // 防误点：入场动画期间锁定点击
    wrap.classList.add('locked');
    clearTimeout(this._lockT);
    this._lockT = setTimeout(() => wrap.classList.remove('locked'), 480);
    views.forEach((v, i) => {
      const div = document.createElement('div');
      div.className = 'card ' + v.cls + (v.owned ? ' is-owned' : '');
      const routeMeta = v.route ? ROUTES[v.route] : null;
      if (routeMeta) div.style.setProperty('--route-c', routeMeta.color);
      div.innerHTML = `
        <div class="c-key">${i + 1}</div>
        ${v.isNew ? '<div class="c-ribbon">NEW</div>' : ''}
        <div class="c-icon">${v.icon}</div>
        <div class="c-tag">${v.tag}</div>${routeMeta ? `<div class="c-route">${routeMeta.icon} ${routeMeta.name}</div>` : ''}
        <div class="c-name">${v.name}</div>
        <div class="c-lv">${v.lvText}</div>
        ${v.pips ? `<div class="c-pips">${v.pips}</div>` : ''}
        <div class="c-desc">${v.desc}</div>`;
      div.addEventListener('click', () => onPick(i));
      wrap.appendChild(div);
    });
  }
  hideLevelUp() { this.el.levelup.classList.add('hidden'); }

  showGameOver(stats, isBest) {
    this.el.gameover.classList.remove('hidden');
    this.el.goNewBest.classList.toggle('hidden', !isBest);
    this.el.retryBtn.textContent = '再次出击 [R]';
    this.el.goStats.innerHTML = `
      <div class="st hero"><span>最终得分</span><b>${formatNum(stats.score)}</b></div>
      <div class="st"><span>存活时间</span><b>${formatTime(stats.time)}</b></div>
      <div class="st"><span>击杀</span><b>${formatNum(stats.kills)}</b></div>
      <div class="st"><span>等级</span><b>${stats.level}</b></div>
      <div class="st"><span>抵达区域</span><b>SECTOR ${stats.sector}</b></div>`;
  }

  // ---------- 每帧 HUD ----------
  update(dt) {
    const g = this.game, p = g.player;
    // HP
    const hpF = clamp(p.hpFrac, 0, 1);
    this.el.hpFill.style.transform = `scaleX(${hpF})`;
    this.el.hpFill.className = hpF > 0.35 ? 'hp-ok' : '';
    this.el.hpFill.id = 'hp-fill';
    this.el.hpNum.textContent = `${Math.ceil(p.stats.hp)} / ${p.stats.maxHp}`;
    // XP
    const need = XP_CURVE(p.level);
    this.el.xpFill.style.transform = `scaleX(${clamp(p.xp / need, 0, 1)})`;
    this.el.levelNum.textContent = p.level;
    // 顶部
    this.el.sector.textContent = `SECTOR ${g.sector}`;
    this.el.score.textContent = formatNum(Math.floor(g.score));
    this.el.timer.textContent = formatTime(g.time);
    this.el.kills.textContent = formatNum(p.kills);
    this.el.best.textContent = formatNum(Math.max(g.best, Math.floor(g.score)));
    // 冲刺冷却环
    const dashF = 1 - clamp(p.dashCdT / p.stats.dashCd, 0, 1);
    this.el.dashRing.style.strokeDashoffset = (100.5 * (1 - dashF)).toFixed(1);
    this.el.dashRing.style.stroke = dashF >= 1 ? '#2ee6ff' : 'rgba(46,230,255,.35)';
    // 超载
    const pulseF = clamp(g.pulse / 100, 0, 1);
    this.el.pulseFill.style.transform = `scaleX(${pulseF})`;
    this.el.pulseBar.classList.toggle('full', pulseF >= 1);
    // 湮灭协议
    const ultF = clamp(g.ult / ULT.max, 0, 1);
    this.el.ultFill.style.transform = `scaleX(${ultF})`;
    this.el.ultBar.classList.toggle('full', ultF >= 1);
    // 流派面板（变化时才重建）
    const sig = `${g.routes.pyro},${g.routes.volt},${g.routes.void}|${g.routeTiers.pyro},${g.routeTiers.volt},${g.routeTiers.void}`;
    if (sig !== this._routeSig) {
      this._routeSig = sig;
      let html = '';
      for (const [id, R] of Object.entries(ROUTES)) {
        const lv = g.routes[id];
        if (lv <= 0) continue;
        const tier = g.routeTiers[id];
        const pips = '◆'.repeat(tier) + '◇'.repeat(3 - tier);
        html += `<div class="route-row" style="color:${R.color}"><span class="r-icon">${R.icon}</span><span>${R.name}</span><span class="r-pips">${pips}</span><span class="r-lv">LV.${lv}${tier > 0 ? ' · ' + R.tiers[tier - 1] : ''}</span></div>`;
      }
      this.el.routes.innerHTML = html;
    }
    // 联机队伍面板
    if (g.mp) {
      let sig = '';
      for (const p of g.mp.peers.values()) sig += `${p.id}:${Math.round(p.hp)}:${p.dead ? 1 : 0};`;
      if (sig !== this._rosterSig) {
        this._rosterSig = sig;
        let html = '';
        for (const p of g.mp.peers.values()) {
          const f = clamp(p.hp / (p.maxHp || 100), 0, 1);
          html += `<div class="roster-row${p.dead ? ' dead' : ''}"><span class="rr-name">${p.name}</span><div class="rr-bar"><div class="rr-fill" style="transform:scaleX(${f})"></div></div></div>`;
        }
        this.el.roster.innerHTML = html;
      }
    }
    // 连锁
    const ch = g.chain;
    if (ch >= 5) {
      this.el.chain.classList.remove('hidden');
      this.el.chainNum.textContent = 'x' + ch;
      this.el.chain.className = ch >= 100 ? 't4' : ch >= 50 ? 't3' : ch >= 25 ? 't2' : '';
      if (ch !== this._lastChain) {
        this.el.chain.classList.add('pop');
        clearTimeout(this._chainPopT);
        this._chainPopT = setTimeout(() => this.el.chain.classList.remove('pop'), 90);
      }
    } else {
      this.el.chain.classList.add('hidden');
    }
    this._lastChain = ch;
    // 低血量红晕
    this.el.lowhp.style.opacity = hpF < 0.32 ? (0.5 + Math.sin(g.time * 6) * 0.3) * (1 - hpF / 0.32 + 0.3) : 0;
    // FPS
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.5) {
      this.el.fps.textContent = `${Math.round(this._fpsN / this._fpsAcc)} FPS`;
      this._fpsAcc = 0; this._fpsN = 0;
    }
  }

  showBossBanner(show) { this.el.bossBanner.classList.toggle('hidden', !show); }

  setBossHp(frac, mark = 0) {
    if (frac < 0) { this.bossWrap.classList.add('hidden'); return; }
    this.bossWrap.classList.remove('hidden');
    this.bossName.textContent = mark > 0 ? `VOID OVERLORD MK.${mark + 1}` : 'VOID OVERLORD';
    this.bossFill.style.transform = `scaleX(${clamp(frac, 0, 1)})`;
  }

  flash(opacity = 0.55, ms = 90) {
    this.el.flash.style.transition = 'none';
    this.el.flash.style.opacity = opacity;
    requestAnimationFrame(() => {
      this.el.flash.style.transition = `opacity ${ms}ms ease-out`;
      this.el.flash.style.opacity = 0;
    });
  }

  setMuted(m) { this.el.muteIcon.classList.toggle('hidden', !m); }
}
