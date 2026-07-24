// ============ VOID PULSE — 全局配置与数值 ============

export const PALETTE = {
  bg: 0x05060f,
  fog: 0x070a18,
  grid: 0x1b4b66,
  gridCenter: 0x2ee6ff,
  player: 0x2ee6ff,
  playerCore: 0xbffaff,
  bullet: 0x53f2ff,
  enemyBullet: 0xff3ea5,
  gem: 0x4dff88,
  heart: 0xff5f7a,
  chaser: 0xff3e6d,
  speeder: 0xff9f3e,
  splitter: 0xc93eff,
  mini: 0xe07bff,
  shooter: 0xffe93e,
  tank: 0xff4e4e,
  bomber: 0xff2e2e,
  hunter: 0xff2e88,
  weaver: 0x7dff5f,
  webZone: 0x7dff5f,
  stormZone: 0xc77bff,
  supply: 0xffd23e,
  elite: 0xffffff,
  boss: 0xff2266,
  tesla: 0x9fd8ff,
  nova: 0x8a5fff,
  missile: 0x6ef3ff,
  blade: 0x7df9ff,
};

export const ARENA = 34;            // 半场尺寸（正方形竞技场）
export const WALL_PAD = 0.4;        // 实体与墙的间距

export const PLAYER = {
  radius: 0.72,
  speed: 12.0,
  accel: 62,
  maxHp: 100,
  contactIFrames: 0.6,
  dashTime: 0.19,
  dashMul: 3.6,
  dashCd: 2.5,
  dashIFrames: 0.32,
  magnetBase: 3.0,
  critMul: 2.2,
};

// —— 敌人生成导演 ——
export const DIRECTOR = {
  firstSpawnDelay: 2.4,
  baseRate: 0.78,         // 每秒累积的基础生成预算
  rateGrow: 0.009,        // 随时间平滑增加，而不是指数失控
  maxRate: 3.4,
  waveSeconds: 36,        // 22s 推进 + 7s 高潮 + 7s 喘息
  surgeAt: 22,
  respiteAt: 29,
  maxEnemiesBase: 30,
  maxEnemiesGrow: 0.42,
  maxEnemiesCap: 225,
  firstBossAt: 180,
  bossEvery: 165,
  eliteAfter: 150,
  eliteChance: 0.14,
  telegraphTime: 0.95,
  flankChance: 0.28,      // 少量截杀，避免持续在玩家正前方刷怪
  spawnMinDistance: 19,
  spawnMaxDistance: 29,
  spawnSafeDistance: 15,  // 与所有存活玩家保持的最低距离
  encircleFirst: 72,
  encircleEvery: 84,
};

// —— 连锁击杀 ——
export const CHAIN = {
  window: 3.0,            // 连杀保持窗口（秒）
  milestone: 15,          // 每 N 连锁触发冲击波
  tiers: [                // 连锁数 → 得分倍率
    { n: 10, mul: 1.25 },
    { n: 25, mul: 1.5 },
    { n: 50, mul: 2 },
    { n: 100, mul: 3 },
  ],
};

// —— 空投补给 ——
export const SUPPLY = {
  firstAt: 50,
  every: 55,
  heal: 20,
  score: 300,
  pickupR: 1.7,
  lifetime: 22,
};

// —— 流派羁绊：投入同一路线的升级越多，觉醒越强 ——
export const ROUTES = {
  pyro: { name: '燃烧', icon: '🔥', color: '#ff7a3e', tiers: ['余烬', '爆燃', '焚天'] },
  volt: { name: '雷霆', icon: '⚡', color: '#ffd23e', tiers: ['迅捷', '落雷', '雷神'] },
  void: { name: '虚空', icon: '🌑', color: '#c77bff', tiers: ['韧性', '反噬', '吞噬'] },
};
export const ROUTE_TIERS = [4, 8, 13];   // 路线投入等级阈值 → 觉醒 I/II/III

// —— 湮灭协议（终极大招）——
export const ULT = {
  max: 100,
  perGem: 1.3,          // 每点碎片充能
  bossBonus: 40,        // 击杀 Boss 额外充能
  inflation: 0.35,      // 每用一次充能效率 -35%×次数
  dmg: 500,             // 对普通敌人
  bossFrac: 0.12,       // 对 Boss 最大生命比例
  slowmoScale: 0.15,
  slowmoTime: 1.2,
};

export const ENEMY_TYPES = {
  chaser:   { hp: 22,  speed: 5.4,  dmg: 12, radius: 0.8,  xp: 1, score: 10, knockRes: 0,    unlockAt: 0 },
  speeder:  { hp: 10,  speed: 9.6,  dmg: 8,  radius: 0.52, xp: 1, score: 12, knockRes: 0,    unlockAt: 25 },
  splitter: { hp: 34,  speed: 4.4,  dmg: 10, radius: 0.95, xp: 2, score: 18, knockRes: 0.2,  unlockAt: 55 },
  shooter:  { hp: 30,  speed: 4.6,  dmg: 9,  radius: 0.8,  xp: 2, score: 20, knockRes: 0.1,  unlockAt: 78,
              keepMin: 10, keepMax: 16, fireCd: 2.6, bulletSpeed: 15 },
  tank:     { hp: 135, speed: 2.7,  dmg: 20, radius: 1.6,  xp: 5, score: 40, knockRes: 0.85, unlockAt: 125 },
  mini:     { hp: 9,   speed: 7.6,  dmg: 6,  radius: 0.42, xp: 1, score: 5,  knockRes: 0,    unlockAt: 1e9 },
  // —— 第二批敌人 ——
  bomber:   { hp: 14,  speed: 10.5, dmg: 0,  radius: 0.5,  xp: 2, score: 16, knockRes: 0,    unlockAt: 96,
              fuseTime: 0.6, blastR: 3.2, blastDmg: 26 },
  hunter:   { hp: 45,  speed: 8.2,  dmg: 14, radius: 0.7,  xp: 2, score: 24, knockRes: 0.2,  unlockAt: 148, lead: 0.45 },
  weaver:   { hp: 60,  speed: 3.9,  dmg: 10, radius: 0.85, xp: 3, score: 30, knockRes: 0.3,  unlockAt: 175,
              keepMin: 8, keepMax: 14, webCd: 3.5 },
  boss:     { hp: 2400, speed: 3.4, dmg: 26, radius: 2.6,  xp: 40, score: 1200, knockRes: 1, unlockAt: 1e9 },
};

// 生成权重表：[类型, 权重]（按时间逐步解锁）
export const SPAWN_WEIGHTS = [
  ['chaser',   100],
  ['speeder',  55],
  ['bomber',   34],
  ['splitter', 32],
  ['shooter',  28],
  ['hunter',   26],
  ['tank',     20],
  ['weaver',   16],
];

export const XP_CURVE = (level) => Math.floor(6 + level * 4.5 + level * level * 0.35);

export const PULSE = {
  max: 100,
  perKill: 3.2,
  perBossKill: 100,
  damage: 85,
  maxHpBonus: 0.28,   // 附加敌人最大生命百分比
  radius: 17,
  invuln: 1.2,
  slowmoScale: 0.22,
  slowmoTime: 0.9,
};

export const SCORE = { perSecond: 5, heartDrop: 0.045, heartHeal: 18, maxHearts: 3 };

export const COLORS_CSS = {
  cyan: '#2ee6ff', pink: '#ff3ea5', green: '#4dff88', gold: '#ffd23e', red: '#ff3e5f',
};
