import * as THREE from 'three';

const FILES = {
  floor: 'floor-alloy-v1.jpg',
  hull: 'facility-hull-v1.jpg',
  reactor: 'reactor-deck-v1.jpg',
};

// 每个世界只加载三张贴图；设施共用装甲图，旧世界的异步回调不能重新绑定材质。
export function createWorldTextures(floorSpan, planet) {
  let disposed = false;
  const entries = new Map();
  const status = {};
  const loader = new THREE.TextureLoader();
  for (const [key, defaultFile] of Object.entries(FILES)) {
    const file = key === 'floor' && planet?.floor ? planet.floor : defaultFile;
    const entry = { texture: null, ready: false, bindings: [] };
    entries.set(key, entry);
    status[key] = 'loading';
    const folder = key === 'floor' && planet?.floor ? 'planets' : 'textures';
    const url = new URL(`../assets/${folder}/${file}`, import.meta.url).href;
    entry.texture = loader.load(url, () => {
      if (disposed) return;
      entry.ready = true;
      status[key] = 'ready';
      entry.bindings.forEach((apply) => apply());
      entry.bindings.length = 0;
    }, undefined, () => {
      if (disposed) return;
      // 网络失败仍保留原来的网格/纯色材质，不能让地图变黑或阻塞进入房间。
      status[key] = 'fallback';
      entry.bindings.length = 0;
    });
    entry.texture.name = file;
    entry.texture.colorSpace = THREE.SRGBColorSpace;
    entry.texture.anisotropy = 4;
    if (key === 'floor' || key === 'hull') {
      entry.texture.wrapS = entry.texture.wrapT = THREE.RepeatWrapping;
    }
    if (key === 'floor') entry.texture.repeat.set(floorSpan / 12, floorSpan / 12);
  }
  return {
    status,
    bind(material, key, { color, emissiveIntensity } = {}) {
      if (disposed) return;
      const entry = entries.get(key);
      const apply = () => {
        material.map = entry.texture;
        if (color !== undefined) material.color.setHex(color);
        if (emissiveIntensity !== undefined) material.emissiveIntensity = emissiveIntensity;
        material.needsUpdate = true;
      };
      if (entry.ready) apply();
      else if (status[key] === 'loading') entry.bindings.push(apply);
    },
    collectForDisposal(textures) {
      disposed = true;
      entries.forEach((entry) => {
        entry.bindings.length = 0;
        textures.add(entry.texture);
      });
    },
  };
}
