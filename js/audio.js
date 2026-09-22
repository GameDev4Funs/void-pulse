// ============ 音频引擎：全合成 SFX + 程序化配乐（无外部素材） ============
import { clamp, rand } from './utils.js';

export class AudioEngine {
  constructor(settings = { music: 0.55, sfx: 0.8 }) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.muted = localStorage.getItem('vp_muted') === '1';
    this.lastPlay = {};      // 音效节流
    this.musicTimer = null;
    this.step = 0;
    this.nextStepTime = 0;
    this.bpm = 96;
    this.intensity = 0;      // 0..1 随战况提升
    this.enabled = false;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 22; comp.ratio.value = 8;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfxGain = c.createGain(); this.sfxGain.gain.value = this.settings.sfx; this.sfxGain.connect(this.master);
    this.musicGain = c.createGain(); this.musicGain.gain.value = this.settings.music * 0.5; this.musicGain.connect(this.master);
    // 共享噪声缓冲
    const len = c.sampleRate * 1;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.enabled = true;
    this.startMusic();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolumes() {
    if (!this.ctx) return;
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx, this.ctx.currentTime, 0.03);
    this.musicGain.gain.setTargetAtTime(this.settings.music * 0.5, this.ctx.currentTime, 0.03);
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('vp_muted', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  // ---------- SFX 基元 ----------
  osc(type, f0, f1, t0, dur, vol, dest) {
    if (!isFinite(f0) || !isFinite(f1) || !isFinite(t0) || !isFinite(dur) || !isFinite(vol)) return;
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || this.sfxGain);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  noise(t0, dur, vol, fType, f0, f1, q = 1) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = fType; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxGain);
    s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
    s.start(t0); s.stop(t0 + dur + 0.02);
  }

  throttled(name, ms) {
    const now = performance.now();
    if (this.lastPlay[name] && now - this.lastPlay[name] < ms) return true;
    this.lastPlay[name] = now;
    return false;
  }

  // ---------- 具体音效 ----------
  shoot() {
    if (!this.enabled || this.throttled('shoot', 50)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 620 + rand(-40, 40), 170, t, 0.06, 0.042);
  }
  missile() {
    if (!this.enabled || this.throttled('missile', 90)) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.22, 0.08, 'bandpass', 500, 2400, 2);
  }
  tesla() {
    if (!this.enabled || this.throttled('tesla', 80)) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.12, 0.07, 'highpass', 1800, 4200, 3);
    this.osc('sawtooth', 1200, 240, t, 0.1, 0.04);
  }
  nova() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 220, 40, t, 0.5, 0.3);
    this.noise(t, 0.4, 0.14, 'lowpass', 3000, 200);
  }
  enemyHit() {
    if (!this.enabled || this.throttled('ehit', 40)) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.06, 0.07, 'bandpass', 1400 + rand(-300, 300), 900, 1.5);
  }
  explode(big = false) {
    if (!this.enabled || this.throttled('expl', 60)) return;
    const t = this.ctx.currentTime;
    const k = big ? 1.8 : 1;
    this.noise(t, 0.35 * k, 0.16 * k, 'lowpass', 2600, 120);
    this.osc('sine', 200 * (big ? 0.7 : 1), 34, t, 0.32 * k, 0.22 * k);
  }
  pickup() {
    if (!this.enabled || this.throttled('pick', 35)) return;
    const t = this.ctx.currentTime;
    const f = 500 + rand(0, 160);
    this.osc('sine', f, f * 1.5, t, 0.09, 0.042);
  }
  heart() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 520, 780, t, 0.12, 0.12);
    this.osc('sine', 780, 1040, t + 0.09, 0.14, 0.12);
  }
  dash() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.18, 0.13, 'bandpass', 900, 3400, 1.4);
  }
  hurt() {
    if (!this.enabled || this.throttled('hurt', 150)) return;
    const t = this.ctx.currentTime;
    this.osc('sawtooth', 170, 55, t, 0.22, 0.22);
    this.noise(t, 0.15, 0.12, 'lowpass', 1200, 200);
  }
  levelup() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.osc('triangle', f, f, t + i * 0.07, 0.22, 0.14));
  }
  cardPick() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.osc('triangle', 700, 1400, t, 0.12, 0.12);
  }
  pulse() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.osc('sawtooth', 60, 900, t, 0.35, 0.16);
    this.osc('sine', 120, 30, t + 0.22, 0.6, 0.34);
    this.noise(t + 0.18, 0.55, 0.2, 'lowpass', 5000, 100);
  }
  bossWarn() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this.osc('square', 220, 220, t + i * 0.35, 0.16, 0.14);
      this.osc('square', 165, 165, t + i * 0.35 + 0.17, 0.16, 0.14);
    }
  }
  gameover() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    [440, 349, 262, 175].forEach((f, i) => this.osc('triangle', f, f * 0.98, t + i * 0.22, 0.4, 0.16));
    this.noise(t, 1.2, 0.1, 'lowpass', 2000, 80);
  }
  // 击杀脆响（高频节流）
  killPop() {
    if (!this.enabled || this.throttled('killpop', 70)) return;
    const t = this.ctx.currentTime;
    this.osc('triangle', 340 + rand(-40, 60), 75, t, 0.08, 0.11);
    this.noise(t, 0.05, 0.06, 'highpass', 2600, 4000);
  }
  // 自爆蜂引信
  fuseBeep() {
    if (!this.enabled || this.throttled('fuse', 120)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 980, 980, t, 0.07, 0.1);
    this.osc('square', 980, 980, t + 0.12, 0.07, 0.1);
  }
  // 武器进化号角
  evolve() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    [392, 523, 659, 784, 1047].forEach((f, i) => {
      this.osc('sawtooth', f, f, t + i * 0.08, 0.3, 0.1);
      this.osc('triangle', f * 2, f * 2, t + i * 0.08, 0.25, 0.08);
    });
    this.noise(t + 0.3, 0.6, 0.1, 'lowpass', 4000, 300);
  }
  // 补给舱
  supply() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 1200, 700, t, 0.15, 0.1);
    this.osc('sine', 1200, 700, t + 0.2, 0.15, 0.1);
  }
  // 连锁里程碑
  chainZap() {
    if (!this.enabled || this.throttled('chainz', 150)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 500, 1500, t, 0.12, 0.1);
    this.noise(t, 0.1, 0.07, 'bandpass', 2000, 4500, 2);
  }
  // 护盾破碎
  shieldBreak() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.25, 0.15, 'highpass', 1800, 600);
    this.osc('sine', 800, 200, t, 0.2, 0.14);
  }
  // 湮灭协议：长上升音 + 虚空轰鸣
  ult() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.osc('sawtooth', 80, 1200, t, 0.9, 0.14);
    this.osc('sawtooth', 82, 1190, t, 0.9, 0.1);
    this.noise(t + 0.75, 1.4, 0.28, 'lowpass', 6000, 60);
    this.osc('sine', 90, 24, t + 0.8, 1.1, 0.4);
    this.osc('sine', 45, 22, t + 0.8, 1.3, 0.3);
  }

  reactorReady() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    [440, 660, 880].forEach((f, i) => this.osc('sine', f, f, t + i * 0.14, 0.24, 0.12));
  }
  reactorCapture() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    [262, 330, 392, 523, 784].forEach((f, i) => this.osc('triangle', f, f, t + i * 0.08, 0.5, 0.16));
    this.osc('sine', 110, 55, t, 0.65, 0.2);
  }
  lowHealth() {
    if (!this.enabled || this.throttled('lowhp', 1600)) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 80, 42, t, 0.16, 0.16);
    this.osc('sine', 70, 38, t + 0.23, 0.13, 0.1);
  }

  // ---------- 程序化配乐 ----------
  startMusic() {
    if (this.musicTimer) return;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = setInterval(() => this.schedule(), 90);
  }

  schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // 后台恢复只调度未来的节拍，禁止追赶数分钟的旧音符。
    if (this.nextStepTime < this.ctx.currentTime - 0.3) this.nextStepTime = this.ctx.currentTime + 0.05;
    if (!this.enabled || this.muted) {
      // 静音时也要推进时钟，避免恢复时爆发
      while (this.nextStepTime < this.ctx.currentTime + 0.25) {
        this.nextStepTime += 60 / this.bpm / 4;
        this.step++;
      }
      return;
    }
    const stepDur = 60 / this.bpm / 4;
    while (this.nextStepTime < this.ctx.currentTime + 0.22) {
      this.playStep(this.step, this.nextStepTime);
      this.nextStepTime += stepDur;
      this.step++;
    }
  }

  playStep(s, t) {
    const g = this.musicGain;
    const bar = Math.floor(s / 16) % 4;
    const st = s % 16;
    const inten = clamp(this.intensity, 0, 1);
    // A 小调进行：Am - F - C - G
    const roots = [55, 43.65, 65.41, 49];           // A1 F1 C2 G1
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];
    const root = roots[bar], chord = chords[bar];

    // Kick: 四分音符（柔和）
    if (st % 4 === 0) {
      this.osc('sine', 100, 36, t, 0.16, 0.42, g);
    }
    // 军鼓/拍手（高强度，柔化）
    if (inten > 0.5 && (st === 4 || st === 12)) {
      const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500;
      const gg = c.createGain(); gg.gain.setValueAtTime(0.11, t); gg.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      src.connect(f); f.connect(gg); gg.connect(g); src.start(t); src.stop(t + 0.15);
      src.onended = () => { src.disconnect(); f.disconnect(); gg.disconnect(); };
    }
    // Hat: 反拍 8 分（极轻）
    if (st % 2 === 1) {
      const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 9500;
      const gg = c.createGain(); gg.gain.setValueAtTime(0.024 + inten * 0.02, t); gg.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      src.connect(f); f.connect(gg); gg.connect(g); src.start(t); src.stop(t + 0.05);
      src.onended = () => { src.disconnect(); f.disconnect(); gg.disconnect(); };
    }
    // Bass: 温暖三角波 + 低通
    const bassPat = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
    if (bassPat[st]) {
      const o = this.ctx.createOscillator(), og = this.ctx.createGain();
      const fl = this.ctx.createBiquadFilter(); fl.type = 'lowpass';
      fl.frequency.value = 320 + inten * 260;
      o.type = 'triangle'; o.frequency.value = root * 2;
      og.gain.setValueAtTime(0.17, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(fl); fl.connect(og); og.connect(g); o.start(t); o.stop(t + 0.26);
      o.onended = () => { o.disconnect(); fl.disconnect(); og.disconnect(); };
    }
    // Pad: 每小节头（正弦+三角，慢起音，温暖铺底）
    if (st === 0) {
      chord.forEach((fq) => {
        for (const type of ['sine', 'triangle']) {
          const o = this.ctx.createOscillator(), og = this.ctx.createGain();
          o.type = type; o.frequency.value = fq; o.detune.value = rand(-5, 5);
          const dur = 16 * (60 / this.bpm / 4);
          const vol = type === 'sine' ? 0.045 : 0.028;
          og.gain.setValueAtTime(0.0001, t);
          og.gain.linearRampToValueAtTime(vol, t + 0.8);
          og.gain.setValueAtTime(vol, t + dur - 0.6);
          og.gain.linearRampToValueAtTime(0.0001, t + dur);
          o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.05);
          o.onended = () => { o.disconnect(); og.disconnect(); };
        }
      });
    }
    // Lead 琶音（高强度，柔和正弦）
    if (inten > 0.7 && st % 4 === 2) {
      const seq = [0, 1, 2, 1];
      const fq = chord[seq[((s / 4) | 0) % seq.length]] * 2;
      this.osc('sine', fq, fq, t, 0.22, 0.022, g);
    }
  }
}
