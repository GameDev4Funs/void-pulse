# 角色美术

本轮使用内置 imagegen 生成透明 RGBA 原画，作为场景中的俯视角色面片；不是新制作的 3D 模型。碰撞、移动与联网状态仍使用原有实体。

| 运行时文件 | 覆盖对象 | 尺寸 |
| --- | --- | --- |
| player-interceptor-v1.png | 玩家及所有队友 | 512 × 512 |
| enemy-swarm-atlas-v1.png | 追击者、疾行者、分裂体、幼体、射手、坦克、自爆蜂、猎手、织网者 | 1254 × 1254 |
| boss-overlord-v1.png | VOID OVERLORD | 768 × 768 |

原始输出保存在 source/。玩家与 Boss 使用 sips 等比缩小导出，保留透明通道；敌人图集未裁切改画，按实际透明边界配置 UV，避免机械九等分切断炮管/利爪。纹理与 UV 几何在页面内共享，退房只释放队友自有材质，加载失败继续用原几何外观。图片顶部统一映射到游戏局部 +Z，绘制朝向随瞄准/速度变化。

标记规则：青色色环为本机，队友沿用槽位颜色和名牌；精英有金色环；受击和自爆引信保留闪光，Boss 保留独立能量环。角色原画不新增碰撞物。

## 最终生成提示词

### player-interceptor-v1

Use case: stylized-concept. Production-ready top-down game character sprite for VOID PULSE, a dark neon science-fiction arena survival game. High quality hand-painted hard-surface 3D game art rendered directly from above, orthographic, readable bold silhouette and restrained fine detail. Genuine transparent RGBA background, not a checkerboard or colored backdrop. No ground, shadows outside the silhouette, text, labels, logo, watermark, border, UI or glow halo. Every subject points toward the TOP of the image. Even soft neutral lighting, crisp edges, no perspective. Single heroic compact silver-white interceptor starfighter centered in a square 1024x1024 image. Full craft visible within the central 82 percent of the canvas, symmetrical broad swept wings and pointed forward fuselage, two rear engine nacelles, dark navy panel joints, a cyan glass cockpit and small cyan engine vents. Substantial sculpted armor plating, layered wing surfaces, visible weapon pods but not huge guns. Distinctive clean arrowhead silhouette. Mostly pearl white and cool silver hull with dark navy separation and restrained cyan accents. No exhaust plume. The ship must remain recognizable at 40 pixels wide.

### enemy-swarm-atlas-v1

Use case: stylized-concept. Production-ready top-down game character sprite for VOID PULSE, a dark neon science-fiction arena survival game. High quality hand-painted hard-surface 3D game art rendered directly from above, orthographic, readable bold silhouette and restrained fine detail. Genuine transparent RGBA background, not a checkerboard or colored backdrop. No ground, shadows outside the silhouette, text, labels, logo, watermark, border, UI or glow halo. Every subject points toward the TOP of the image. Even soft neutral lighting, crisp edges, no perspective. A SINGLE square 1536x1536 production SPRITE ATLAS, exact 3 by 3 equal grid of 512x512 cells, exactly nine isolated alien biomechanical drones. Each character centered at the exact center of its cell with at least 12 percent fully transparent padding on each side; no character crosses its cell boundary. All have same apparent footprint within their cell, scaling handled in game. Nine DISTINCT designs in EXACT row-major order: TOP ROW: (1) crimson-pink CHASER, crablike armored scarab with two forward hooked mandibles and four compact legs, (2) orange SPEEDER, narrow triangular wasp dart with swept side fins and compact tail, (3) purple SPLITTER, bulbous trilobed segmented beetle with three glowing violet sacs. MIDDLE ROW: (4) lavender MINI, small angular alien larva with four stubby claws, (5) yellow SHOOTER, six-sided gun drone with two prominent forward yellow rail barrels and a yellow central eye, (6) red TANK, very broad heavy turtle beetle with thick overlapping red armored carapace and stout lateral legs. BOTTOM ROW: (7) red-orange BOMBER, round bomb-tick body with a dominant glowing orange central volatile core and four short red fins, (8) magenta HUNTER, long spear-shaped mantis drone with two forward blade arms and narrow waist, (9) lime green WEAVER, clearly eight-legged mechanical spider with green abdomen and dark steel leg joints. Dark charcoal undersides and readable medium-bright colored armor surfaces, small luminous cores. Cohesive designed enemy faction, not simple geometric primitives. Do not write any type names or numbers. No grid lines. Background and gutters must truly be transparent.

### boss-overlord-v1

Use case: stylized-concept. Production-ready top-down game character sprite for VOID PULSE, a dark neon science-fiction arena survival game. High quality hand-painted hard-surface 3D game art rendered directly from above, orthographic, readable bold silhouette and restrained fine detail. Genuine transparent RGBA background, not a checkerboard or colored backdrop. No ground, shadows outside the silhouette, text, labels, logo, watermark, border, UI or glow halo. Every subject points toward the TOP of the image. Even soft neutral lighting, crisp edges, no perspective. A single imposing VOID OVERLORD boss drone centered in a square 1024x1024 canvas, entire silhouette within central 84 percent. Broad hexagonal biomechanical armored war machine with six heavy jointed claw arms arranged radially, a layered charcoal and crimson carapace, four angular forward prongs, and a bright but detailed magenta reactor iris at the center. Heavy segmented armor, sharp readable red edge plates, mechanical tendons. Symmetrical imposing boss silhouette, about as wide as tall, not a sphere. Dark silver and crimson body, magenta core, sparse hot red details. Not human, no face or text. No circular outline rings because those are animated separately by the game. No detached parts outside the single connected character.

