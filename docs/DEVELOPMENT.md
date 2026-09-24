# VOID PULSE · 开发与部署

[返回游戏首页](../README.md) · [驾驶员手册](PLAYER_GUIDE.md)

## 本地运行

需要 Python 3。直接运行 `python3 scripts/server.py`；安装了 Node.js / npm 时也可使用 `npm start`。macOS 可双击 `start.command`。浏览器打开 `http://localhost:8123`，不能直接双击 HTML 文件。

游戏依赖已随仓库打包，本地运行不需要连接 CDN。浏览器自动化测试另需 Node.js 24+、本机 Chrome，以及通过 `npm install` 安装的开发依赖。

低画质可在设置中开启，或通过 `http://localhost:8123/?lowfx=1` 强制启用。

## 联机运行与规则

1. 房主运行 `npm start`（页面与联机中继同源，不再需要单独开放 8124 端口）。
2. 所有人用浏览器打开 `http://<房主IP>:8123` → **组队联机**：
   - 房主点**创建房间** → 自动生成房名（如 `NEBULA-42`）+ 4 位密码，点击可复制；
   - 队友输入房名+密码 → **加入房间** → 大厅集结 → 房主开战。
3. 联机规则：
   - 每房最多 **4 人**；**无队友伤害**（架构上不存在 PP 伤害）；
   - 场地扩大至 **160×160 单元**，包含八个战术掩体、外围能源站和货箱装饰；
   - 每个星球有独立的环境事件时间表；能源母港 75 秒后首次放电、每 90 秒一轮。所有事件先预警 5 秒、危险持续 9 秒；熔核星隔次喷发穿过中央目标；
   - 敌人按推进/高潮/喘息波次生成，并按玩家轮转分配压力，出生点会避开玩家、墙体和掩体；
   - **团队共享经验/等级**，但每人独立选卡、独立构筑流派；
   - 战机被击倒后 10 秒修复完成（半血）；存活队友靠近 4m 内可让修复速度翻倍，**团灭**时任务失败；
   - 房主切后台时全队暂停；客机暂离或心跳中断超过 3 秒会被移出存活/拾取/占点判定，回来后以倒地状态等待修复；
   - 任务胜利后由房主选择全队继续无尽或返回大厅，队员也可自行离开房间；
   - 架构：房主权威模拟敌人/掉落，客机本地模拟战机与武器，伤害事件上报；
   - 部署到 HTTPS 环境时会自动使用同源 `wss://.../ws`，避免混合内容和额外端口不可达。

## 技术要点

- Three.js r185（本地 vendor，importmap 引入），UnrealBloom 辉光后期（可 lowfx 关闭）。
- 场景使用三张生成式美术贴图（合金地板 / 设施装甲 / 反应堆平台），运行时约 1 MB；原图和提示词见 [贴图说明](../assets/textures/README.md)。音效与 BGM 由 WebAudio 实时合成。
- 玩家/队友、九类普通敌人和 Boss 使用透明角色原画与共享图集，保留队友色环、精英标记和战斗预警；原图与提示词见 [角色美术](../assets/actors/README.md)。
- 联机：纯标准库 Python WebSocket 房间中继 + 房主权威模拟 + 客机插值/短时预测（10Hz 世界快照、20Hz 玩家位置 + 事件流）。
- 对象池（敌人 / 子弹 / 粒子 / 碎块 / 飘字）+ 空间哈希与弹道扫掠碰撞；模拟子步最大 1/60 秒，每个渲染帧最多追赶 250ms，后台返回丢弃隐藏时长，HUD 按真实渲染间隔统计 FPS。小地图 10Hz 刷新，地面导引线实例化渲染。
- 首屏使用约 13KB 星球缩略图，选中星球后才加载完整地表；静态服务器仅提供运行必需资源，拒绝隐藏目录、脚本、CSV、原画源目录和目录浏览。
- 打击感：击杀顿帧、受击挤压形变、甲壳碎块迸溅、击杀冲击击退、屏幕震动、慢动作。

## 开发自测

```bash
node scripts/smoke.mjs [url]   # 状态机冒烟（需本地 Chrome）
node scripts/soak.mjs          # 高压浸泡（全进化武器 + 全敌人 + 包围事件）
node scripts/evo_check.mjs     # 进化卡出现逻辑
node scripts/route_check.mjs   # 流派觉醒 + 湮灭协议
node scripts/mp_test.mjs       # 联机端到端（建房/同步/伤害/重生/团灭/满员）
node scripts/mp_perf.mjs       # 四人联机高负载性能回归
node scripts/reactor_test.mjs  # 目标时序 / 干扰 / 衰减 / 奖励 / 重置
node scripts/texture_test.mjs [url] # 贴图回归；不传 URL 时自启 8135 测试服务
node scripts/actor_art_test.mjs [url] # 角色图集 / 朝向 / 闪光 / 回退 / 释放；默认自启 8136
```

新机制使用联机协议 v6；组队前所有玩家需刷新到同一版本，旧版客户端无法加入新版房间。

`npm run test:planets` 验证四星球地表、敌群/弹幕、环境危险、属性重置、准星、键盘/触屏、GPU 贴图回收和双浏览器跨星球联机；可传现有服务 URL 进行部署后验收。
`node scripts/mp_perf.mjs <URL> <planet>` 验证指定星球的四人默认画质压力表现；planet 为 `station` / `cryo` / `volcanic` / `mycelium`，默认 `station`。
三张新地表由内置 imagegen 生成，原始素材和完整提示词见 [assets/planets/README.md](../assets/planets/README.md)。

新增审查回归：`npm run test:combat`、`test:game`、`test:ui`、`test:mp:rules`、`test:server`。Node 测试需 Node 24+；浏览器用本机 Chrome，脚本自行关闭临时服务和浏览器。完整修复对应关系及验证边界见 [审查修复记录](REVIEW_FIXES.md)。
