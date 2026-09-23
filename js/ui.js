// ============ UI：HUD / 菜单 / 升级卡牌 ============
import { formatTime, formatNum, clamp } from './utils.js';
import { XP_CURVE, PLAYER, ROUTES, ROUTE_TIERS, ULT } from './config.js';
import { TacticalHud } from './tactical_hud.js';
import { saveSettings } from './settings.js';
import { PLANETS } from './planets.js';
import { UPGRADES } from './upgrades.js';

const $ = (id) => document.getElementById(id);
const escapeText = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class UI {
  constructor(game) {
    this.game = game;
    this.tactical = new TacticalHud(game);
    this.settingsOpen = false;
    this.buildOpen = false;
    this.menuOpen = false;
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
    this._returnFocus = {};
    document.addEventListener('keydown', (event) => this.trapFocus(event), true);
    if (this.game.input.isTouch) {
      $('controls-grid').innerHTML = '<div><b>左侧拖动</b><span>移动 · 靠近绿色碎片升级</span></div><div><b>自动瞄准</b><span>自动攻击附近敌人</span></div><div><b>冲刺</b><span>穿越危险，短暂无敌</span></div><div><b>超载 / 湮灭</b><span>充满后点击释放技能</span></div><div><b>构筑</b><span>查看装备和进化配方</span></div><div><b>菜单</b><span>设置或退出 · 联机继续战斗</span></div>';
      $('pulse-key').textContent = '超载';
      $('ult-label').querySelector('span').textContent = '湮灭';
      $('levelup-sub').querySelector('.key-hint').textContent = '点击卡牌选择';
      $('build-btn').textContent = '构筑';
      $('build-close').textContent = '返回';
      $('cards-build-btn').textContent = '构筑与配方';
      $('combat-menu-btn').textContent = '菜单';
    }
    for (const id of ['title-planets', 'lobby-planets']) {
      const picker = $(id);
      picker.innerHTML = `<div class="planet-heading">选择目的地 <span class="planet-authority"></span></div><div class="planet-grid">${PLANETS.map((p) =>
        `<button type="button" class="planet-card planet-${p.id}" data-planet="${p.id}" style="--planet-color:${p.color}" aria-pressed="false"><span class="planet-orb" aria-hidden="true"></span><span class="planet-code">${p.code}</span><b>${p.name}</b><span class="planet-biome">${p.biome}</span></button>`
      ).join('')}</div><div class="planet-brief" aria-live="polite"></div>`;
      picker.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-planet]');
        if (button) this.game.selectPlanet(button.dataset.planet);
      });
    }
  }

  refreshPlanets() {
    const g = this.game, planet = g.planet;
    if (g.state === 'title') this.el.titleBest.textContent = g.best > 0 ? `最高纪录 ${formatNum(g.best)}` : '暂无纪录 —— 去创造历史吧';
    for (const id of ['title-planets', 'lobby-planets']) {
      const picker = $(id);
      const locked = !!g.mp && !g.mp.isHost;
      picker.querySelector('.planet-authority').textContent = locked ? '跟随房主' : '本局结束后可重新选择';
      for (const button of picker.querySelectorAll('[data-planet]')) {
        button.setAttribute('aria-pressed', String(button.dataset.planet === planet.id));
        button.disabled = locked;
      }
      picker.querySelector('.planet-brief').innerHTML = `<strong style="color:${planet.color}">${planet.perk}</strong><span>${planet.threat}</span><small>${planet.tactics}</small>`;
    }
    $('planet-label').textContent = `${planet.name} / 战场目标`;
    $('planet-label').style.color = planet.color;
    $('planet-label').title = planet.perk;
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
    $('reroll-btn').addEventListener('click', () => this.game.rerollCards());
    $('settings-btn').addEventListener('click', () => this.openSettings());
    $('settings-close').addEventListener('click', () => this.closeSettings());
    $('build-btn').addEventListener('click', () => this.openBuild());
    $('cards-build-btn').addEventListener('click', () => this.openBuild());
    $('build-close').addEventListener('click', () => this.closeBuild());
    $('combat-menu-btn').addEventListener('click', () => this.openMenu());
    $('menu-build-btn').addEventListener('click', () => this.openBuild());
    $('menu-settings-btn').addEventListener('click', () => this.openSettings());
    $('continue-endless-btn').addEventListener('click', () => this.game.continueEndless());
    $('quality').addEventListener('change', () => {
      this.game.settings.quality = $('quality').value;
      saveSettings(this.game.settings);
      this.game.setQuality?.(this.game.settings.quality);
    });
    for (const [id, key] of [['music-volume', 'music'], ['sfx-volume', 'sfx'], ['auto-aim', 'autoAim'], ['reduced-motion', 'reducedMotion']]) {
      $(id).addEventListener('input', () => {
        this.game.settings[key] = $(id).type === 'range' ? Number($(id).value) / 100 : $(id).checked;
        saveSettings(this.game.settings);
        this.game.audio.setVolumes();
        document.body.classList.toggle('reduced-motion', this.game.settings.reducedMotion);
      });
    }
    this.el.startBtn.addEventListener('click', callbacks.onStart);
    this.el.resumeBtn.addEventListener('click', () => this.closeMenu());
    this.el.quitBtn.addEventListener('click', callbacks.onQuit);
    this.el.retryBtn.addEventListener('click', callbacks.onRetry);
    this.el.menuBtn.addEventListener('click', callbacks.onQuit);
    // 联机
    this.el.mpBtn.addEventListener('click', () => {
      this.el.mpPanel.classList.toggle('hidden');
      if (!this.el.mpName.value) this.el.mpName.value = this.game.myName;
      if (!this.el.mpPanel.classList.contains('hidden')) this.el.mpName.focus();
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
      const fallback = () => {
        const range = document.createRange(); range.selectNodeContents(el);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        this.toast('已选中，请按 Ctrl/Cmd+C 复制', '#4dff88');
      };
      if (navigator.clipboard && el.textContent) navigator.clipboard.writeText(el.textContent).then(() => this.toast('已复制', '#4dff88')).catch(fallback);
      else fallback();
    });
    copy(this.el.lobbyRoom); copy(this.el.lobbyPass);
  }

  setMpStatus(t) { this.el.mpStatus.textContent = t; }

  // ---------- 大厅 ----------
  showLobby(isHost, room, pass, roster) {
    this.refreshPlanets();
    $('touch-ui').classList.add('hidden');
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
    this.resetDialogs();
    $('combat-tools').classList.add('hidden');
    this.syncDialogs(isHost ? this.el.lobbyStartBtn : this.el.lobbyQuitBtn);
  }

  lobbyRefresh(roster, isHost) {
    if (!this.el.lobby.classList.contains('hidden')) {
      this.el.lobbyPlayers.innerHTML = roster.map((p) =>
        `<div class="lobby-player"><span>${escapeText(p.name)}</span><span>${p.host ? '房主' : '就绪'}</span></div>`
      ).join('');
    }
  }

  hideLobby() { this.el.lobby.classList.add('hidden'); this.syncDialogs(); }

  // ---------- 倒地重生 ----------
  respawnOverlay(show) { this.el.respawn.classList.toggle('hidden', !show); }
  respawnCountdown(t) {
    this.el.respawnCount.textContent = Math.ceil(Math.max(0, t));
    $('respawn-detail').textContent = this.game.rescueActive ? '队友在 4m 内协助修复 · 恢复速度 ×2' : '队友靠近 4m 内可加速修复；全队倒地任务失败';
  }

  // ---------- 联机结算 ----------
  showMpGameOver(stats, isHost) {
    this.el.gameover.classList.remove('hidden');
    this.el.goNewBest.classList.toggle('hidden', !stats.isBest);
    this.el.goStats.innerHTML = `
      <div class="st hero"><span>小队得分</span><b>${formatNum(stats.score)}</b></div>
      <div class="st"><span>存活时间</span><b>${formatTime(stats.time)}</b></div>
      <div class="st"><span>击杀</span><b>${formatNum(stats.kills)}</b></div>
      <div class="st"><span>团队等级</span><b>${stats.level}</b></div>
      <div class="st"><span>抵达区域</span><b>SECTOR ${stats.sector}</b></div>
      <div class="st"><span>修复反应堆</span><b>${this.game.reactor.captures}</b></div>`;
    this.el.retryBtn.textContent = '返回大厅 [R]';
    this.respawnOverlay(false);
    this.finishSummary(isHost);
  }

  // ---------- 屏幕切换 ----------
  showTitle(best) {
    this.refreshPlanets();
    $('touch-ui').classList.add('hidden');
    this.el.title.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.levelup.classList.add('hidden');
    this.el.lobby.classList.add('hidden');
    this.el.mpPanel.classList.add('hidden');
    this.el.roster.innerHTML = '';
    this.el.titleBest.textContent = best > 0 ? `最高纪录 ${formatNum(best)}` : '暂无纪录 —— 去创造历史吧';
    this.resetDialogs();
    $('combat-tools').classList.add('hidden');
    this.syncDialogs(this.el.startBtn);
  }
  showHud() {
    this.resetDialogs();
    this.refreshPlanets();
    $('touch-ui').classList.toggle('hidden', !this.game.input.isTouch);
    this.el.title.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    $('combat-tools').classList.remove('hidden');
    this.syncDialogs();
    document.activeElement?.blur();
  }
  showPause(show) {
    this.menuOpen = show;
    this.el.pause.classList.toggle('hidden', !show);
    $('pause-title').textContent = this.game.mp ? '小队菜单' : '已暂停';
    $('pause-note').textContent = this.game.mp ? '联机战斗继续。菜单不会提供无敌保护。' : '关闭菜单后继续任务';
    this.el.quitBtn.textContent = this.game.mp ? '离开房间' : '返回主菜单';
    this.syncDialogs(show ? this.el.resumeBtn : null);
  }

  showLevelUp(cards, views, onPick) {
    this.el.hud.classList.toggle('choosing-upgrade', !!this.game.mp);
    this.el.levelup.classList.toggle('mp-cards', !!this.game.mp);
    $('levelup-sub').firstChild.textContent = this.game.mp ? '战斗继续 · 选卡后获得短暂无敌 ' : '选择一项强化 ';
    $('reroll-btn').textContent = `重抽 [R] · ${this.game.rerolls} 次${views.some((v) => v.cls === 'r-evolve') ? ' · 保留进化机会' : ''}`;
    $('reroll-btn').disabled = this.game.rerolls <= 0;
    this.el.levelup.classList.remove('hidden');
    const wrap = this.el.cards;
    wrap.innerHTML = '';
    // 防误点：入场动画期间锁定点击
    wrap.classList.add('locked');
    clearTimeout(this._lockT);
    this._lockT = setTimeout(() => {
      wrap.classList.remove('locked');
      for (const button of wrap.querySelectorAll('button')) button.disabled = false;
      if (!this.blocksGameplayInput()) this.syncDialogs(wrap.querySelector('button'));
    }, this.game.settings.reducedMotion ? 180 : 480);
    views.forEach((v, i) => {
      const div = document.createElement('button');
      div.type = 'button';
      div.disabled = true;
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
        <div class="c-desc">${escapeText(v.desc)}</div>${v.detail ? `<div class="c-detail">${escapeText(v.detail)}</div>` : ''}${v.recipe ? `<div class="c-recipe">${escapeText(v.recipe)}</div>` : ''}`;
      div.addEventListener('click', () => {
        if (!this.blocksGameplayInput() && !wrap.classList.contains('locked')) onPick(i);
      });
      wrap.appendChild(div);
    });
    this.syncDialogs();
  }
  hideLevelUp() {
    clearTimeout(this._lockT);
    this.el.levelup.classList.add('hidden'); this.el.hud.classList.remove('choosing-upgrade');
    this.syncDialogs();
    if (!this.blocksGameplayInput()) document.activeElement?.blur();
  }

  openSettings() {
    if (this.settingsOpen) return;
    this._returnFocus.settings = document.activeElement;
    this.settingsOpen = true;
    this.settingsPaused = !this.game.mp && this.game.state === 'playing';
    if (this.settingsPaused) this.game.togglePause(true);
    this.game.input.clear();
    const s = this.game.settings;
    $('music-volume').value = s.music * 100; $('sfx-volume').value = s.sfx * 100;
    $('auto-aim').checked = s.autoAim; $('reduced-motion').checked = s.reducedMotion;
    $('quality').value = s.quality || 'high';
    $('auto-aim').disabled = this.game.input.isTouch;
    if (this.game.input.isTouch) $('auto-aim').checked = true;
    $('settings-note').textContent = this.game.mp && this.game.state === 'playing' ? '联机不会暂停，请先找到安全位置' : '设置自动保存到此设备';
    $('settings-screen').classList.remove('hidden');
    this.syncDialogs($('settings-close'));
  }
  closeSettings() {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    $('settings-screen').classList.add('hidden');
    this.game.input.clear();
    if (this.settingsPaused && this.game.state === 'paused') this.game.togglePause();
    this.settingsPaused = false;
    this.syncDialogs(this._returnFocus.settings);
  }

  showGameOver(stats, isBest) {
    this.el.gameover.classList.remove('hidden');
    this.el.goNewBest.classList.toggle('hidden', !isBest);
    this.el.retryBtn.textContent = '再次出击 [R]';
    this.el.goStats.innerHTML = `
      <div class="st hero"><span>最终得分</span><b>${formatNum(stats.score)}</b></div>
      <div class="st"><span>存活时间</span><b>${formatTime(stats.time)}</b></div>
      <div class="st"><span>击杀</span><b>${formatNum(stats.kills)}</b></div>
      <div class="st"><span>等级</span><b>${stats.level}</b></div>
      <div class="st"><span>抵达区域</span><b>SECTOR ${stats.sector}</b></div>
      <div class="st"><span>修复反应堆</span><b>${this.game.reactor.captures}</b></div>`;
    this.finishSummary(true);
  }

  blocksGameplayInput() { return this.settingsOpen || this.buildOpen || this.menuOpen; }

  openMenu() {
    if (!['playing', 'paused', 'levelup'].includes(this.game.state) || this.settingsOpen || this.buildOpen) return;
    this._returnFocus.menu = document.activeElement;
    this.game.input.clear();
    if (!this.game.mp && this.game.state === 'playing') this.game.togglePause(true);
    else this.showPause(true);
  }

  closeMenu() {
    if (!this.menuOpen) return;
    this.game.input.clear();
    if (!this.game.mp && this.game.state === 'paused') this.game.togglePause();
    else this.showPause(false);
    this.syncDialogs(this._returnFocus.menu);
  }

  openBuild() {
    if (this.buildOpen || this.settingsOpen || !['playing', 'paused', 'levelup'].includes(this.game.state)) return;
    this._returnFocus.build = document.activeElement;
    this.buildOpen = true;
    this.buildPaused = !this.game.mp && this.game.state === 'playing';
    if (this.buildPaused) this.game.togglePause(true);
    this.game.input.clear();
    this.renderBuild();
    $('build-screen').classList.remove('hidden');
    this.syncDialogs($('build-close'));
  }

  closeBuild() {
    if (!this.buildOpen) return;
    this.buildOpen = false;
    $('build-screen').classList.add('hidden');
    this.game.input.clear();
    if (this.buildPaused && this.game.state === 'paused') this.game.togglePause();
    this.buildPaused = false;
    this.syncDialogs(this._returnFocus.build);
  }

  closeTopDialog() {
    if (this.settingsOpen) this.closeSettings();
    else if (this.buildOpen) this.closeBuild();
    else if (this.menuOpen) this.closeMenu();
  }

  resetDialogs() {
    this.settingsOpen = this.buildOpen = this.menuOpen = false;
    this.settingsPaused = this.buildPaused = false;
    for (const id of ['settings-screen', 'build-screen', 'pause-screen']) $(id).classList.add('hidden');
  }

  topDialog() {
    return ['settings-screen', 'build-screen', 'pause-screen', 'levelup-screen', 'gameover-screen', 'lobby-screen', 'title-screen']
      .map($).find((el) => !el.classList.contains('hidden')) || null;
  }

  dialogControls(dialog) {
    if (!dialog) return [];
    const controls = [...dialog.querySelectorAll('button, input, select, a[href], [tabindex="0"]')];
    if (['title-screen', 'lobby-screen'].includes(dialog.id)) controls.push($('settings-btn'));
    return controls.filter((el) => !el.disabled && !el.closest('[inert]') && el.getClientRects().length);
  }

  syncDialogs(preferred = null) {
    const top = this.topDialog();
    for (const dialog of document.querySelectorAll('.overlay')) dialog.inert = dialog !== top;
    const blocking = this.blocksGameplayInput() || !!top;
    $('touch-ui').inert = this.blocksGameplayInput() || (!!top && !(this.game.mp && top.id === 'levelup-screen'));
    $('combat-tools').inert = blocking;
    $('settings-btn').inert = !!top && !['title-screen', 'lobby-screen'].includes(top.id);
    if (!top) { document.activeElement?.blur(); return; }
    const controls = this.dialogControls(top);
    if (preferred && controls.includes(preferred)) preferred.focus({ preventScroll: true });
    else if (!controls.includes(document.activeElement)) controls[0]?.focus({ preventScroll: true });
  }

  trapFocus(event) {
    const top = this.topDialog();
    if (!top) return;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key) && top === this.el.levelup && event.target.classList.contains('card')) {
      const cards = [...this.el.cards.querySelectorAll('button:not(:disabled)')];
      const index = cards.indexOf(event.target);
      if (index >= 0) cards[(index + (event.key === 'ArrowRight' ? 1 : cards.length - 1)) % cards.length]?.focus();
      event.preventDefault(); event.stopPropagation();
    }
    if (event.key !== 'Tab') return;
    const controls = this.dialogControls(top);
    if (!controls.length) { event.preventDefault(); return; }
    const index = controls.indexOf(document.activeElement);
    const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length;
    event.preventDefault(); controls[next].focus();
  }

  renderBuild() {
    const g = this.game, upgrades = g.upgrades;
    $('build-note').textContent = (g.mp ? '联机战斗继续 · ' : '查看时已暂停 · ') + '数值包含星球、被动、路线与当前急速增益；伤害为非暴击单次命中。';
    const rows = (kind) => UPGRADES.filter((u) => u.kind === kind).map((u) => {
      const lv = upgrades.level(u.id), evolved = g.weapons.evolved[u.id];
      const actual = kind === 'weapon' ? upgrades.weaponSummary(u.id) : upgrades.passiveValue(u.id);
      const next = lv < u.max ? `下级：${upgrades.nextBenefit(u)}` : '已达最高等级';
      return `<article class="build-item${lv ? '' : ' unowned'}"><div class="build-item-heading"><b>${u.icon} ${escapeText(u.name)}</b><span>${evolved ? '已进化' : `LV ${lv} / ${u.max}`}</span></div><p>${escapeText(actual)}</p><p class="build-next">${escapeText(next)}</p>${kind === 'weapon' ? `<p class="build-recipe">${escapeText(upgrades.evolutionRecipe(u.id))}</p>` : ''}</article>`;
    }).join('');
    const effects = {
      pyro: ['武器伤害 +12%', '击杀普通敌人产生半径 2.6m、伤害 20 的爆炸', '武器与流派伤害附加 3 秒点燃，Q / E 不点燃；每秒伤害为该次命中伤害的 20%，同一段点燃保留较强伤害'],
      volt: ['武器频率 +12%', '击杀时 25% 概率落雷，半径 3m、伤害 50', '每 5 秒轰击最密集敌群，半径 4m、伤害 90'],
      void: ['最大生命 +20、装甲 +1，并立即修复 20', '受伤时释放半径 5.5m、伤害 32 的新星，冷却 3 秒', '每 8 秒处决 9m 内生命 ≤25% 的普通敌人；每个修复 2，最多 12'],
    };
    const routes = Object.entries(ROUTES).map(([id, route]) => `<article class="build-route" style="--route-c:${route.color}"><b>${route.icon} ${route.name} · 已投入 ${g.routes[id]} 级</b>${ROUTE_TIERS.map((threshold, i) => `<p class="${g.routes[id] >= threshold ? 'unlocked' : ''}">${g.routes[id] >= threshold ? '◆' : '◇'} ${threshold} 级 · ${route.tiers[i]}：${effects[id][i]}</p>`).join('')}</article>`).join('');
    $('build-content').innerHTML = `<h3>武器与进化配方</h3><div class="build-grid">${rows('weapon')}</div><h3>被动模块</h3><div class="build-grid">${rows('passive')}</div><h3>路线觉醒</h3><p class="build-help">每次选择同路线武器或被动增加 1 点投入。已投入的路线更容易再次出现（每点权重 +12%）；进化还可能需要其他路线的模块。Q / E 的技能击杀不会触发额外击杀爆炸、落雷或连锁伤害；单次施放由普通敌人返还的超载能量最多 25。Boss 奖励独立计算，仍提供超载 100、湮灭 40。</p><div class="build-routes">${routes}</div>`;
  }

  finishSummary(isHost) {
    this.resetDialogs();
    this.hideLevelUp();
    $('touch-ui').classList.add('hidden');
    $('combat-tools').classList.add('hidden');
    const victory = this.game.runOutcome === 'victory';
    $('go-title').textContent = victory ? '能源修复完成' : '信号丢失';
    $('go-title').classList.toggle('victory', victory);
    $('continue-endless-btn').classList.toggle('hidden', !victory || !isHost);
    this.el.retryBtn.disabled = victory && !isHost;
    if (victory && !isHost) this.el.retryBtn.textContent = '等待房主选择下一步';
    this.el.menuBtn.textContent = this.game.mp ? '离开房间' : '返回主菜单';
    const summary = this.game.runSummary?.();
    if (summary) {
      const build = Array.isArray(summary.build) ? summary.build.map((item) => typeof item === 'string' ? item : `${item.name || item.id} ${item.level ? 'LV' + item.level : ''}`).join(' · ')
        : typeof summary.build === 'object' ? Object.entries(summary.build).map(([id, level]) => `${id} LV${level}`).join(' · ') : String(summary.build || '');
      $('go-summary').innerHTML = `<p><b>${escapeText(summary.planet || this.game.planet.name)} · ${escapeText(summary.mode || '')}</b></p><p>${escapeText(summary.cause || (victory ? '已完成撤离条件' : '战机被摧毁'))}</p><p>最终构筑：${escapeText(build)}</p>${summary.damage?.length ? `<div class="damage-summary">${summary.damage.map((row) => `<span>${escapeText(row.name)} <b>${formatNum(Math.round(row.value))}</b></span>`).join('')}</div>` : ''}${victory && !isHost ? '<p>等待房主选择继续无尽或带领小队返回大厅；也可离开房间。</p>' : ''}`;
    } else $('go-summary').textContent = '';
    this.syncDialogs(victory && isHost ? $('continue-endless-btn') : this.el.retryBtn);
  }

  // ---------- 每帧 HUD ----------
  update(dt) {
    this.tactical.update(dt);
    const g = this.game, p = g.player;
    // HP
    const hpF = clamp(p.hpFrac, 0, 1);
    this.el.hpFill.style.transform = `scaleX(${hpF})`;
    this.el.hpFill.className = hpF > 0.35 ? 'hp-ok' : '';
    this.el.hpFill.id = 'hp-fill';
    this.el.hpNum.textContent = `${Math.max(0, Math.ceil(p.stats.hp))} / ${p.stats.maxHp}`;
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
          html += `<div class="roster-row${p.dead ? ' dead' : ''}"><span class="rr-name">${escapeText(p.name)}</span><div class="rr-bar"><div class="rr-fill" style="transform:scaleX(${f})"></div></div></div>`;
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
    this.el.lowhp.style.opacity = hpF < 0.32 ? (g.settings.reducedMotion ? 0.4 : 0.5 + Math.sin(g.time * 6) * 0.3) * (1 - hpF / 0.32 + 0.3) : 0;
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
    if (this.game.settings.reducedMotion) return;
    this.el.flash.style.transition = 'none';
    this.el.flash.style.opacity = opacity;
    requestAnimationFrame(() => {
      this.el.flash.style.transition = `opacity ${ms}ms ease-out`;
      this.el.flash.style.opacity = 0;
    });
  }

  setMuted(m) { this.el.muteIcon.classList.toggle('hidden', !m); }
}
