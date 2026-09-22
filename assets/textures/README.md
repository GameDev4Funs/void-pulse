# VOID PULSE 场景贴图

由内置 imagegen 生成，原始 PNG 保存在 source/，运行时只加载 1024 × 1024 的 JPEG（85% 质量，合计约 1 MB）。这些是颜色贴图，不冒充法线或 PBR 粗糙度图。

| 运行时文件 | 使用位置 | 策略 |
| --- | --- | --- |
| floor-alloy-v1.jpg | 合金地板 | 每 12 个世界单位平铺，低对比度 |
| facility-hull-v1.jpg | 立柱、路障、外围站点、货箱 | 共用一张 GPU 贴图，以材质颜色区分 |
| reactor-deck-v1.jpg | 中央反应堆平台顶面 | 独立圆形 UV，侧壁不拉伸贴图 |

源图与运行时导出均纳入版本管理；部署只需三个 JPEG。所有颜色贴图使用 sRGB、mipmap 和 4× 各向异性过滤。加载不阻塞开始游戏，失败时保留旧网格/纯色材质。碰撞体没有随装饰改变。

导出命令（逐张执行）：

```sh
sips -Z 1024 -s format jpeg -s formatOptions 85 assets/textures/source/floor-alloy-v1.png --out assets/textures/floor-alloy-v1.jpg
```

## 生成提示词

### floor-alloy-v1

Use case: stylized-concept. Asset type: seamless tileable game floor albedo texture, square 1024x1024. Create a production-ready texture for VOID PULSE, a top-down 3D neon science-fiction survival game. A flat industrial energy-station floor made of large dark blue-gray titanium plates in a staggered modular layout, narrow recessed seams, a few subtle inset service grilles, tiny bolts, restrained scuffed edges and fine brushed-metal grain. Mostly quiet broad surfaces so bright cyan player ships, pink enemies and colored danger zones remain readable over it. Very small muted cyan painted details, no bright glowing lights. Orthographic view directly perpendicular to the surface, completely flat diffuse neutral lighting, full-bleed material with identical-compatible opposite edges for continuous tiling horizontally and vertically. No perspective, no objects sitting on the floor, no central focal point, no deep holes, no text, no logos, no labels, no border, no watermark. Designed as a color/albedo map, not a rendered scene. Restrained high-quality hard-surface game art, dark but not black; medium-low contrast.

### facility-hull-v1

Use case: stylized-concept. Asset type: seamless tileable game hard-surface albedo texture, square 1024x1024. Create a production-ready exterior panel texture for energy-station pylons, low barricades and supply crates in a top-down neon science-fiction game. Desaturated slate-blue titanium cladding with layered rectangular armor plates, inset charcoal ventilation slats, beveled plate seams, precise small fasteners, light edge wear and a few restrained ochre industrial identification strips without letters. Subtle cyan enamel accents only, no emission glow. Modular hard-surface industrial design with clean readable medium-scale shapes, not cluttered with tiny greebles. Orthographic straight-on flat surface, evenly lit diffuse albedo, no perspective or directional cast shadows, seamless opposite edges, fills the complete image. No silhouettes of buildings, no separate objects, no text, no numbers, no logo, no watermark, no frame. Mostly blue-gray medium-dark metal with enough midtone detail to survive a dark game scene.

### reactor-deck-v1

Use case: stylized-concept. Asset type: game reactor platform top-surface albedo texture, square 1024x1024. A single circular industrial reactor service deck viewed precisely from directly overhead, centered at image center, diameter exactly 96 percent of image width. Inside the circle, concentric dark steel rings and twelve radial segmented titanium service panels, precise mechanical seams and bolts, inner center disk kept calm and uncluttered. A restrained band of worn ochre-and-charcoal safety stripes around the outermost ring, a few inset muted cyan circuit channels. The surrounding 2-percent margins and all corners are uniform very dark navy. This flat image will be UV-mapped onto an existing 3D circular platform, not used as a scene illustration. High quality science-fiction game material art, slate blue and charcoal steel, subtle wear, readable broad radial structure. Flat diffuse even lighting, no perspective, no elevated core, no buildings, no beam, no drop shadow, no glowing bloom. No text, numbers, logo or watermark. The graphic must have exact circular geometry and a quiet center to support visible gameplay effects.

