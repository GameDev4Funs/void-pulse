export const MISSION = Object.freeze({ seconds: 600, captures: 3 });
export function missionComplete(time, captures, endless = false) {
  return !endless && time >= MISSION.seconds && captures >= MISSION.captures;
}
export const DAMAGE_NAMES = Object.freeze({
  blaster: '脉冲枪', blades: '轨道刃', missiles: '追踪导弹', tesla: '特斯拉电弧',
  nova: '新星爆发', fling: '飞刃风暴', storm: '雷狱', burn: '点燃',
  pulse: '超载冲击', ult: '湮灭协议', route: '流派觉醒', chain: '连锁反应', direct: '其他伤害',
});
export const ENEMY_NAMES = Object.freeze({
  chaser: '追击者', speeder: '疾行者', splitter: '分裂体', mini: '幼体', shooter: '射手',
  tank: '重甲坦克', bomber: '自爆蜂', hunter: '猎手', weaver: '织网者', boss: '虚空霸主',
});
