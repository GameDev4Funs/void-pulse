// ============ 升级系统：卡牌池 / 抽取 / 生效 ============
import { MAX_WEAPON_LV } from './weapons.js';
import { pick } from './utils.js';

// kind: weapon(新武器/武器升级) | passive | bonus
export const UPGRADES = [
  // —— 武器 ——
  {
    id: 'blaster', route: 'pyro', kind: 'weapon', icon: '🔫', name: '脉冲枪', max: MAX_WEAPON_LV,
    tag: '主武器',
    desc: (lv) => [
      '朝瞄准方向自动射击的能量枪。',
      '伤害 +40%。',
      '额外发射 1 发子弹（扇形）。',
      '射速 +35%，子弹可穿透 1 个目标。',
      '再 +1 发子弹，伤害全面提升。',
    ][lv - 1] || '',
  },
  {
    id: 'blades', route: 'void', kind: 'weapon', icon: '🌀', name: '轨道刃', max: MAX_WEAPON_LV,
    tag: '副武器',
    desc: (lv) => [
      '解锁：2 枚能量刃环绕机体，撕碎靠近的敌人。',
      '能量刃 +1（共 3 枚）。',
      '伤害 +50%，转速提升。',
      '能量刃 +1（共 4 枚），轨道扩大。',
      '能量刃 +1（共 5 枚），伤害大幅提升。',
    ][lv - 1] || '',
  },
  {
    id: 'missiles', route: 'pyro', kind: 'weapon', icon: '🚀', name: '追踪导弹', max: MAX_WEAPON_LV,
    tag: '副武器',
    desc: (lv) => [
      '解锁：周期性发射自动追踪的导弹，命中后范围爆炸。',
      '导弹 +1（共 2 枚）。',
      '冷却缩短，伤害 +35%。',
      '导弹 +1（共 3 枚），爆炸范围扩大。',
      '导弹 +1（共 4 枚），伤害大幅提升。',
    ][lv - 1] || '',
  },
  {
    id: 'tesla', route: 'volt', kind: 'weapon', icon: '⚡', name: '特斯拉电弧', max: MAX_WEAPON_LV,
    tag: '副武器',
    desc: (lv) => [
      '解锁：闪电自动劈向最近的敌人，并在敌群间跳跃。',
      '跳跃目标 +1（共 4 个）。',
      '冷却缩短，跳跃 +1。',
      '跳跃 +1（共 6 个），伤害提升。',
      '跳跃 +2（共 8 个），伤害大幅提升。',
    ][lv - 1] || '',
  },
  {
    id: 'nova', route: 'pyro', kind: 'weapon', icon: '💫', name: '新星爆发', max: MAX_WEAPON_LV,
    tag: '副武器',
    desc: (lv) => [
      '解锁：周期性释放冲击新星，击退并伤害周围敌人。',
      '冲击半径扩大。',
      '冷却缩短，伤害提升。',
      '伤害 +35%。',
      '冷却大幅缩短，半径与伤害全面提升。',
    ][lv - 1] || '',
  },
  // —— 被动 ——
  {
    id: 'p_dmg', route: 'pyro', kind: 'passive', icon: '💥', name: '增幅核心', max: 5, tag: '被动',
    desc: () => '所有武器伤害 +12%。',
    apply: (g) => { g.player.stats.dmgMul *= 1.12; },
  },
  {
    id: 'p_rate', route: 'volt', kind: 'passive', icon: '⏱️', name: '超频模块', max: 5, tag: '被动',
    desc: () => '所有武器射速 / 触发频率 +10%。',
    apply: (g) => { g.player.stats.rateMul *= 1.10; },
  },
  {
    id: 'p_speed', route: 'volt', kind: 'passive', icon: '💨', name: '离子推进器', max: 5, tag: '被动',
    desc: () => '移动速度 +8%。',
    apply: (g) => { g.player.stats.speedMul *= 1.08; },
  },
  {
    id: 'p_hp', route: 'void', kind: 'passive', icon: '❤️', name: '纳米装甲层', max: 5, tag: '被动',
    desc: () => '最大生命 +25，并立即修复 25。',
    apply: (g) => { g.player.stats.maxHp += 25; g.player.heal(25); },
  },
  {
    id: 'p_magnet', route: 'void', kind: 'passive', icon: '🧲', name: '引力收集器', max: 5, tag: '被动',
    desc: () => '碎片拾取范围 +50%。',
    apply: (g) => { g.player.stats.magnet *= 1.5; },
  },
  {
    id: 'p_armor', route: 'void', kind: 'passive', icon: '🛡️', name: '偏导护盾', max: 5, tag: '被动',
    desc: () => '受到的所有伤害 -2（至少保留 1 点）。',
    apply: (g) => { g.player.stats.armor += 2; },
  },
  {
    id: 'p_dash', route: 'void', kind: 'passive', icon: '✨', name: '相位引擎', max: 5, tag: '被动',
    desc: () => '冲刺冷却 -12%。',
    apply: (g) => { g.player.stats.dashCd = Math.max(0.9, g.player.stats.dashCd * 0.88); },
  },
  {
    id: 'p_crit', route: 'pyro', kind: 'passive', icon: '🎯', name: '弱点扫描仪', max: 5, tag: '被动',
    desc: () => '暴击率 +8%（暴击造成 220% 伤害）。',
    apply: (g) => { g.player.stats.critCh += 0.08; },
  },
  {
    id: 'p_chain', route: 'volt', kind: 'passive', icon: '🔗', name: '连锁反应堆', max: 3, tag: '被动',
    desc: () => '连锁窗口 +0.7 秒，连锁得分额外 +25%。',
    apply: (g) => { g.chainWindow += 0.7; g.chainScoreMul += 0.25; },
  },
];

// —— 进化卡：满级武器 + 对应被动 → 出现（金色，首槽必出）——
export const EVOLUTIONS = [
  {
    id: 'evo_blaster', base: 'blaster', needs: 'p_rate', kind: 'evolve',
    icon: '☄️', name: '湮灭射线', tag: '进化', needName: '超频模块',
    desc: () => '脉冲枪终极形态：沉重炽亮的湮灭光束，无限穿透，一切皆为尘埃。',
  },
  {
    id: 'evo_blades', base: 'blades', needs: 'p_speed', kind: 'evolve',
    icon: '🌪️', name: '风暴剑域', tag: '进化', needName: '离子推进器',
    desc: () => '8 枚能量刃环绕绞杀，并周期性向八方掷出穿透飞刃风暴。',
  },
  {
    id: 'evo_missiles', base: 'missiles', needs: 'p_dmg', kind: 'evolve',
    icon: '🐝', name: '蜂群蜂巢', tag: '进化', needName: '增幅核心',
    desc: () => '一次倾泻 8 枚子母导弹，爆炸后再分裂出延时炸弹。',
  },
  {
    id: 'evo_tesla', base: 'tesla', needs: 'p_crit', kind: 'evolve',
    icon: '🌩️', name: '天罚雷狱', tag: '进化', needName: '弱点扫描仪',
    desc: () => '12 链狂雷，每个命中点留下持续灼烧的雷狱区域。',
  },
  {
    id: 'evo_nova', base: 'nova', needs: 'p_hp', kind: 'evolve',
    icon: '💫', name: '超新星坍缩', tag: '进化', needName: '纳米装甲层',
    desc: () => '引力坍缩把敌人拽向中心再引爆，并生成一层护盾。',
  },
];

const BONUS_CARDS = [
  {
    id: 'b_repair', kind: 'bonus', icon: '🔧', name: '紧急修理', max: 99, tag: '补给',
    desc: () => '立即修复 40% 最大生命。',
    apply: (g) => { g.player.heal(g.player.stats.maxHp * 0.4); },
  },
  {
    id: 'b_score', kind: 'bonus', icon: '💎', name: '数据核心', max: 99, tag: '补给',
    desc: () => '立即获得 800 分。',
    apply: (g) => { g.addScore(800); },
  },
  {
    id: 'b_pulse', kind: 'bonus', icon: '⚛️', name: '超载电池', max: 99, tag: '补给',
    desc: () => '超载能量立即充满。',
    apply: (g) => { g.pulse = 100; },
  },
];

export class Upgrades {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.taken = { blaster: 1 };   // 脉冲枪初始即 1 级
  }

  level(id) { return this.taken[id] || 0; }

  available() {
    return UPGRADES.filter((u) => {
      const lv = this.level(u.id);
      if (lv >= u.max) return false;
      // 副武器未解锁时也可选；脉冲枪从 1 级开始
      return true;
    });
  }

  availableEvolutions() {
    const g = this.game;
    return EVOLUTIONS.filter((ev) =>
      !this.level(ev.id) &&
      g.weapons.level(ev.base) >= MAX_WEAPON_LV &&
      this.level(ev.needs) >= 1
    );
  }

  rollCards(n = 3) {
    const g = this.game;
    const pool = this.available();
    const cards = [];
    // 有可用进化 → 首槽必出
    const evos = this.availableEvolutions();
    if (evos.length > 0) cards.push(pick(evos));
    const weights = pool.map((u) => {
      const lv = this.level(u.id);
      let w = 1.0;
      if (u.kind === 'weapon' && lv === 0) w = 1.3;      // 新武器略优先
      else if (u.kind === 'weapon') w = 1.1;
      // 已投入的流派更容易刷到 → 鼓励单一路线叠加
      const routeLv = g.routes ? g.routes[u.route] || 0 : 0;
      w *= 1 + routeLv * 0.12;
      return w;
    });
    for (let k = cards.length; k < n && pool.length > 0; k++) {
      let total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < pool.length; idx++) { r -= weights[idx]; if (r <= 0) break; }
      idx = Math.min(idx, pool.length - 1);
      cards.push(pool[idx]);
      pool.splice(idx, 1);
      weights.splice(idx, 1);
    }
    // 全满级时发补给卡
    while (cards.length < n) cards.push(pick(BONUS_CARDS));
    return cards;
  }

  apply(card) {
    const g = this.game;
    const lv = this.level(card.id);
    this.taken[card.id] = lv + 1;
    if (card.kind === 'evolve') {
      g.weapons.evolved[card.base] = true;
      g.onEvolution(card);
    } else if (card.kind === 'weapon') {
      g.weapons.levels[card.id] = lv + 1;
    } else {
      card.apply(g);
    }
  }

  // 卡牌显示数据
  cardView(card) {
    const cur = this.level(card.id);
    if (card.kind === 'evolve') {
      const baseU = UPGRADES.find((u) => u.id === card.base) || {};
      return {
        icon: card.icon, tag: '⚡ 进化', name: card.name,
        lvText: `${baseU.name || card.base} + ${card.needName} → EVOLVE`,
        desc: card.desc(), cls: 'r-evolve',
        route: baseU.route, pips: '', isNew: false, owned: false,
      };
    }
    const isNew = card.kind === 'weapon' && cur === 0;
    const owned = cur > 0 && card.kind !== 'bonus';
    // 等级刻度（补给卡无）
    let pips = '';
    if (card.max <= 90) {
      const full = '●'.repeat(cur);
      const next = cur < card.max ? '◉' : '';
      const empty = '○'.repeat(Math.max(0, card.max - cur - 1));
      pips = full + next + empty;
    }
    return {
      icon: card.icon,
      tag: isNew ? '✦ 新武器' : card.tag,
      name: card.name,
      lvText: card.max <= 90 ? (isNew ? 'UNLOCK' : `LV ${cur} → ${cur + 1}`) : 'SUPPLY',
      desc: card.desc(cur + 1),
      cls: isNew ? 'r-weapon' : card.kind === 'weapon' ? 'r-upgrade' : card.kind === 'passive' ? 'r-passive' : 'r-weapon',
      route: card.route || null,
      pips,
      isNew,
      owned,
    };
  }
}
