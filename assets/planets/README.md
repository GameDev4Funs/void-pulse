# 异星地表素材

使用内置 imagegen 生成（不是 CLI）。每张独立生成，保留 source/ 原始 PNG；运行时使用 sips 等比缩至 1024 像素、JPEG 85 压缩版本。没有重新绘制或修改生成图内容。地表按 12 个世界单位平铺；霓虹设施、掩体、危害区与装饰由 Three.js 绘制，以保持碰撞与画面一致。

## Prompt set

### cryogenic-ground-v1

Runtime: `cryogenic-ground-v1.jpg`  
Original: `source/cryogenic-ground-v1.png`

```text
Use case: stylized-concept. Asset type: seamless square 1024x1024 top-down ground albedo texture for a neon sci-fi arena game. Flat orthographic view exactly perpendicular to the ground. Full bleed, tileable on all four edges, even diffuse lighting, no perspective, no shadows from offscreen objects, no border, no text, no logo. Fine material detail but low-medium contrast and broad quiet areas, so small colored enemies and projectiles remain clearly visible. No large rocks or obstacles baked into the image, no cliffs or impassable holes. This is a surface texture, not a landscape illustration. Frozen alien moon: layered slate-blue glacial ice, broad fractured polygonal plates, fine frosted crystal veins, traces of pale turquoise ice powder and dark blue stone under the ice. Mostly subdued medium-dark desaturated blue, some frosty edge highlights, no bright white snow fields and no cyan glow. Elegant natural icy mineral surface.
```

### volcanic-ground-v1

Runtime: `volcanic-ground-v1.jpg`  
Original: `source/volcanic-ground-v1.png`

```text
Use case: stylized-concept. Asset type: seamless square 1024x1024 top-down ground albedo texture for a neon sci-fi arena game. Flat orthographic view exactly perpendicular to the ground. Full bleed, tileable on all four edges, even diffuse lighting, no perspective, no shadows from offscreen objects, no border, no text, no logo. Fine material detail but low-medium contrast and broad quiet areas, so small colored enemies and projectiles remain clearly visible. No large rocks or obstacles baked into the image, no cliffs or impassable holes. This is a surface texture, not a landscape illustration. Volcanic alien planet: charcoal basalt plates, dark reddish-brown volcanic dust, restrained very thin amber magma hairline fissures occupying less than four percent of the image, cooled rough rock grain and mineral edges. The whole surface must read as traversable solid rock, not a lake of lava. Warm dark rust and charcoal, no bright glowing rivers. Natural volcanic ground with broad quiet areas.
```

### mycelium-ground-v1

Runtime: `mycelium-ground-v1.jpg`  
Original: `source/mycelium-ground-v1.png`

```text
Use case: stylized-concept. Asset type: seamless square 1024x1024 top-down ground albedo texture for a neon sci-fi arena game. Flat orthographic view exactly perpendicular to the ground. Full bleed, tileable on all four edges, even diffuse lighting, no perspective, no shadows from offscreen objects, no border, no text, no logo. Fine material detail but low-medium contrast and broad quiet areas, so small colored enemies and projectiles remain clearly visible. No large rocks or obstacles baked into the image, no cliffs or impassable holes. This is a surface texture, not a landscape illustration. Bioluminescent alien forest floor: dark moss-green organic stone, subtle deep teal lichen mats, sparse fine branching jade mycelium veins and muted purple spores embedded in the surface. Broad flat soil and mineral plates, no raised mushrooms or plants, no recognizable creatures, no bright glow. Desaturated deep green and blue-green mineral ground with restrained organic filigree, visually calm but distinctly alien.
```

