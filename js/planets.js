// 星球规则是主客机共享的静态配置；网络只传已知 ID，不接受远端自定义数值。
export const PLANETS = [
  {
    id: 'station', name: '能源母港', code: '01 / NEXUS', color: '#61e7ff',
    biome: '轨道设施 · 均衡战场', perk: '标准战机 · 无额外修正',
    threat: '混合虫潮 · 单发射手 · 周期放电',
    tactics: '熟悉掩体与反应堆，适合首次出击。',
    floor: null, tint: 0x8399b0, background: 0x05060f, fog: 0x070a18,
    accent: 0x55eaff, layout: 0, player: {}, regen: 0,
    roster: null, unlocks: {}, shot: 'single', summons: ['chaser', 'speeder'],
    hazard: { name: '能源放电', first: 75, every: 90, damage: 7, slow: 0.68, color: 0xff355d },
  },
  {
    id: 'cryo', name: '霜环星', code: '02 / BOREAL', color: '#9cdfff',
    biome: '冰封月面 · 机动试炼', perk: '移速 +12% · 冲刺冷却 −20%',
    threat: '疾行者 / 猎手 / 冰锥射手 · 三向弹幕',
    tactics: '利用冲刺穿过冰锥间隙，避开强减速寒潮。',
    floor: 'cryogenic-ground-v1.jpg', tint: 0x91a8bd, background: 0x07111e, fog: 0x102337,
    accent: 0x8bdfff, layout: 0.3, player: { speedMul: 1.12, dashCd: 0.8 }, regen: 0,
    roster: [['chaser', 65], ['speeder', 85], ['shooter', 46], ['hunter', 40], ['tank', 12]],
    unlocks: { speeder: 10, shooter: 32, hunter: 75, tank: 120 },
    shot: 'fan', summons: ['speeder', 'hunter'],
    hazard: { name: '极地寒潮', first: 60, every: 82, damage: 4, slow: 0.45, color: 0x65c9ff },
  },
  {
    id: 'volcanic', name: '熔核星', code: '03 / CINDER', color: '#ffab69',
    biome: '玄武岩荒原 · 爆破试炼', perk: '武器伤害 +18% · 生命上限 +10',
    threat: '自爆蜂 / 重甲坦克 / 熔火射手 · 环形爆片',
    tactics: '拉开距离击爆蜂群，用殉爆连锁破开重甲。',
    floor: 'volcanic-ground-v1.jpg', tint: 0xc7a396, background: 0x180a0a, fog: 0x2b1415,
    accent: 0xff985c, layout: -0.25, player: { dmgMul: 1.18, maxHp: 1.1 }, regen: 0,
    roster: [['chaser', 75], ['bomber', 74], ['tank', 36], ['shooter', 32], ['speeder', 20]],
    unlocks: { bomber: 18, tank: 60, shooter: 40, speeder: 90 },
    shot: 'heavy', summons: ['bomber', 'tank'],
    hazard: { name: '熔岩喷涌', first: 65, every: 88, damage: 10, slow: 0.85, color: 0xff582f },
  },
  {
    id: 'mycelium', name: '孢林星', code: '04 / VERDANT', color: '#99f5a2',
    biome: '菌毯密林 · 控场试炼', perk: '每秒修复 0.6 HP · 拾取范围 +25%',
    threat: '分裂体 / 织网者 / 孢子射手 · 毒区封路',
    tactics: '优先处理织网者，绿色孢子圈会持续造成伤害。',
    floor: 'mycelium-ground-v1.jpg', tint: 0x8eab9a, background: 0x07120e, fog: 0x10281c,
    accent: 0x9aef92, layout: 0.65, player: { magnet: 1.25 }, regen: 0.6,
    roster: [['chaser', 65], ['splitter', 75], ['weaver', 45], ['shooter', 25], ['speeder', 24]],
    unlocks: { splitter: 14, weaver: 42, shooter: 65, speeder: 100 },
    shot: 'spore', summons: ['splitter', 'weaver'],
    hazard: { name: '孢子潮汐', first: 70, every: 85, damage: 6, slow: 0.6, color: 0x8fdb55 },
  },
];

export function isPlanetId(id) { return PLANETS.some((p) => p.id === id); }
export function getPlanet(id) { return PLANETS.find((p) => p.id === id) || PLANETS[0]; }
export function applyPlanetStats(stats, planet) {
  // 仅在 Player.reset 后调用，重开/重生不会反复叠加。
  for (const [key, multiplier] of Object.entries(planet.player)) stats[key] *= multiplier;
  stats.maxHp = Math.round(stats.maxHp);
  stats.hp = stats.maxHp;
}
