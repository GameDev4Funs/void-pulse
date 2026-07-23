// ============ 拾取物：经验碎片 / 修理包 / 空投补给（联机主机权威） ============
import * as THREE from 'three';
import { PALETTE, SCORE, SUPPLY } from './config.js';
import { rand, dist2, clamp, damp } from './utils.js';

const GEM_POOL = 420;
const HEART_POOL = 6;
const SUPPLY_POOL = 2;

export class Pickups {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;

    const gemGeo = new THREE.OctahedronGeometry(0.28, 0);
    const gemMat = new THREE.MeshBasicMaterial({
      color: PALETTE.gem, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.gems = [];
    for (let i = 0; i < GEM_POOL; i++) {
      const m = new THREE.Mesh(gemGeo, gemMat);
      m.visible = false;
      scene.add(m);
      this.gems.push({ mesh: m, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), value: 1, magnet: false, t: rand(10) });
    }

    const heartGeo = new THREE.IcosahedronGeometry(0.42, 0);
    const heartMat = new THREE.MeshBasicMaterial({
      color: PALETTE.heart, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.hearts = [];
    for (let i = 0; i < HEART_POOL; i++) {
      const m = new THREE.Mesh(heartGeo, heartMat);
      m.visible = false;
      scene.add(m);
      this.hearts.push({ mesh: m, active: false, pos: new THREE.Vector3(), t: 0 });
    }

    // —— 空投补给舱 ——
    this.supplies = [];
    for (let i = 0; i < SUPPLY_POOL; i++) {
      const grp = new THREE.Group();
      const pod = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x2a2008, emissive: PALETTE.supply, emissiveIntensity: 1.6, flatShading: true })
      );
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.9, 26, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: PALETTE.supply, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      beam.position.y = 13;
      grp.add(pod, beam);
      grp.visible = false;
      scene.add(grp);
      this.supplies.push({ mesh: grp, pod, beam, active: false, x: 0, z: 0, t: 0, landed: false });
    }
  }

  spawnSupply(x, z) {
    const s = this.supplies.find((q) => !q.active);
    if (!s) return;
    s.active = true; s.x = x; s.z = z; s.t = 0; s.landed = false;
    s.mesh.position.set(x, 22, z);
    s.mesh.visible = true;
    if (this.game.mpIsHost()) this.game.mp.evSupply(x, z);
  }

  reset() {
    for (const g of this.gems) { g.active = false; g.mesh.visible = false; }
    for (const h of this.hearts) { h.active = false; h.mesh.visible = false; }
    for (const s of this.supplies) { s.active = false; s.mesh.visible = false; }
  }

  dropGems(x, z, totalValue) {
    // 大额经验拆成多颗
    let v = totalValue;
    while (v > 0) {
      const chunk = v >= 5 ? 5 : v;
      v -= chunk;
      const g = this.gems.find((q) => !q.active);
      if (!g) { this.game.addXp(v); return; }   // 池满直接入账
      g.active = true;
      g.value = chunk;
      g.magnet = false;
      const a = rand(Math.PI * 2), r = rand(0.3, 1.4);
      g.pos.set(clamp(x + Math.cos(a) * r, -this.game.arena + 0.5, this.game.arena - 0.5), 0.6, clamp(z + Math.sin(a) * r, -this.game.arena + 0.5, this.game.arena - 0.5));
      g.vel.set(Math.cos(a) * rand(2, 5), 0, Math.sin(a) * rand(2, 5));
      g.mesh.visible = true;
      g.mesh.scale.setScalar(chunk >= 5 ? 1.7 : 1);
      if (this.game.mpIsHost()) this.game.mp.evGemDrop(g, this.gems.indexOf(g));
    }
  }

  dropHeart(x, z) {
    const active = this.hearts.filter((h) => h.active).length;
    if (active >= SCORE.maxHearts) return;
    const h = this.hearts.find((q) => !q.active);
    if (!h) return;
    h.active = true;
    h.pos.set(clamp(x, -this.game.arena + 1, this.game.arena - 1), 0.7, clamp(z, -this.game.arena + 1, this.game.arena - 1));
    h.t = 0;
    h.mesh.visible = true;
    if (this.game.mpIsHost()) this.game.mp.evHeartDrop(h, this.hearts.indexOf(h));
  }

  magnetAll() {
    for (const g of this.gems) if (g.active) g.magnet = true;
  }

  // —— 客机：网络事件激活 ——
  netDropGem(id, x, z, v) {
    const g = this.gems[id];
    if (!g) return;
    g.active = true;
    g.value = v;
    g.magnet = false;
    g.pos.set(x, 0.6, z);
    g.vel.set(0, 0, 0);
    g.mesh.visible = true;
    g.mesh.scale.setScalar(v >= 5 ? 1.7 : 1);
  }

  netDropHeart(id, x, z) {
    const h = this.hearts[id];
    if (!h) return;
    h.active = true;
    h.pos.set(x, 0.7, z);
    h.t = 0;
    h.mesh.visible = true;
  }

  // ============ 主机/单机：逻辑更新 ============
  update(dt) {
    const g = this.game;
    const players = g.getPickupPlayers();   // [{id,x,z,magnet,self}]
    if (players.length === 0) return;

    for (const gm of this.gems) {
      if (!gm.active) continue;
      gm.t += dt;
      // 最近的玩家（磁吸判定用各自的磁吸半径）
      let best = null, bd = Infinity;
      for (const pl of players) {
        const d2 = dist2(gm.pos.x, gm.pos.z, pl.x, pl.z);
        if (d2 < bd) { bd = d2; best = pl; }
      }
      let collectR = 1.1;
      if (gm.magnet || (best && bd < best.magnet * best.magnet)) {
        // 直接朝"指向玩家的目标速度"收敛——纯加速会冲过头变成环绕 bug
        const d = Math.sqrt(bd) || 0.01;
        const sp = gm.magnet ? 42 : 24;
        const steer = gm.magnet ? 14 : 9;
        gm.vel.x = damp(gm.vel.x, ((best.x - gm.pos.x) / d) * sp, steer, dt);
        gm.vel.z = damp(gm.vel.z, ((best.z - gm.pos.z) / d) * sp, steer, dt);
        if (gm.magnet) collectR = 1.5;
      } else {
        gm.vel.multiplyScalar(Math.max(0, 1 - 4 * dt));
      }
      gm.pos.x += gm.vel.x * dt;
      gm.pos.z += gm.vel.z * dt;
      // 吸收
      if (best && bd < collectR * collectR) {
        const idx = this.gems.indexOf(gm);
        gm.active = false; gm.mesh.visible = false;
        g.onGemPicked(gm, best, idx);
        continue;
      }
      gm.mesh.position.set(gm.pos.x, 0.6 + Math.sin(gm.t * 3.5) * 0.14, gm.pos.z);
      gm.mesh.rotation.y += dt * 4;
    }

    for (const h of this.hearts) {
      if (!h.active) continue;
      h.t += dt;
      h.mesh.position.set(h.pos.x, 0.7 + Math.sin(h.t * 2.6) * 0.16, h.pos.z);
      h.mesh.rotation.y += dt * 2;
      const puls = 1 + Math.sin(h.t * 5) * 0.12;
      h.mesh.scale.setScalar(puls);
      for (const pl of players) {
        if (dist2(h.pos.x, h.pos.z, pl.x, pl.z) < 1.4) {
          const idx = this.hearts.indexOf(h);
          h.active = false; h.mesh.visible = false;
          g.onHeartPicked(h, pl, idx);
          break;
        }
      }
    }

    // —— 补给舱：落地动画 → 悬浮待拾取 ——
    for (const s of this.supplies) {
      if (!s.active) continue;
      s.t += dt;
      if (!s.landed) {
        s.mesh.position.y = Math.max(0.7, s.mesh.position.y - 26 * dt);
        if (s.mesh.position.y <= 0.7) {
          s.landed = true; s.t = 0;
          g.shockwaves.fire(s.x, s.z, 3, PALETTE.supply, 0.6);
          g.addTrauma(0.2);
          g.audio.explode();
        }
      } else {
        s.mesh.position.y = 0.7 + Math.sin(s.t * 2.8) * 0.15;
        s.pod.rotation.y += dt * 2.2;
        s.beam.material.opacity = 0.1 + Math.sin(s.t * 4) * 0.05;
        // 超时消失
        if (s.t > SUPPLY.lifetime) {
          s.active = false; s.mesh.visible = false;
          continue;
        }
        for (const pl of players) {
          if (dist2(s.x, s.z, pl.x, pl.z) < SUPPLY.pickupR * SUPPLY.pickupR) {
            s.active = false; s.mesh.visible = false;
            g.onSupplyTaken(s.x, s.z, pl);
            break;
          }
        }
      }
    }
  }

  // ============ 客机：纯视觉更新（位置由快照驱动） ============
  updateGuest(dt, gemTargets) {
    for (let i = 0; i < this.gems.length; i++) {
      const gm = this.gems[i];
      if (!gm.active) continue;
      gm.t += dt;
      const tg = gemTargets.get(i);
      if (tg) {
        gm.pos.x = damp(gm.pos.x, tg[0], 10, dt);
        gm.pos.z = damp(gm.pos.z, tg[1], 10, dt);
      }
      gm.mesh.position.set(gm.pos.x, 0.6 + Math.sin(gm.t * 3.5) * 0.14, gm.pos.z);
      gm.mesh.rotation.y += dt * 4;
    }
    for (const h of this.hearts) {
      if (!h.active) continue;
      h.t += dt;
      h.mesh.position.set(h.pos.x, 0.7 + Math.sin(h.t * 2.6) * 0.16, h.pos.z);
      h.mesh.rotation.y += dt * 2;
    }
    for (const s of this.supplies) {
      if (!s.active) continue;
      s.t += dt;
      if (!s.landed) {
        s.mesh.position.y = Math.max(0.7, s.mesh.position.y - 26 * dt);
        if (s.mesh.position.y <= 0.7) { s.landed = true; s.t = 0; }
      } else {
        s.mesh.position.y = 0.7 + Math.sin(s.t * 2.8) * 0.15;
        s.pod.rotation.y += dt * 2.2;
        s.beam.material.opacity = 0.1 + Math.sin(s.t * 4) * 0.05;
      }
    }
  }
}
