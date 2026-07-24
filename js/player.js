// ============ 玩家：幽灵战机 ============
import * as THREE from 'three';
import { PLAYER, WALL_PAD, PALETTE } from './config.js';
import { clamp, damp } from './utils.js';

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.buildMesh();
    this.reset();
  }

  buildMesh() {
    const g = new THREE.Group();

    // 主机身：拉长的八面体
    const bodyGeo = new THREE.OctahedronGeometry(0.62, 0);
    bodyGeo.scale(1, 0.55, 1.7);
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0d3542, emissive: PALETTE.player, emissiveIntensity: 1.5,
      flatShading: true, roughness: 0.35, metalness: 0.4,
    });
    this.body = new THREE.Mesh(bodyGeo, this.bodyMat);
    bodyGeo.computeVertexNormals();
    g.add(this.body);

    // 核心光球
    const coreGeo = new THREE.SphereGeometry(0.26, 12, 10);
    this.coreMat = new THREE.MeshBasicMaterial({ color: PALETTE.playerCore });
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.core.position.y = 0.28;
    g.add(this.core);

    // 双翼
    const wingGeo = new THREE.BoxGeometry(1.5, 0.08, 0.5);
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x0a2a38, emissive: 0x1899ff, emissiveIntensity: 1.2, flatShading: true,
    });
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.position.set(0, 0, 0.25);
    g.add(wing);
    // 翼尖灯
    const tipGeo = new THREE.SphereGeometry(0.09, 8, 6);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0x9ff6ff });
    const t1 = new THREE.Mesh(tipGeo, tipMat); t1.position.set(-0.78, 0, 0.25);
    const t2 = new THREE.Mesh(tipGeo, tipMat); t2.position.set(0.78, 0, 0.25);
    g.add(t1, t2);

    // 玩家点光源（照亮周围地面）
    this.light = new THREE.PointLight(0x2ee6ff, 30, 14, 1.8);
    this.light.position.y = 1.2;
    g.add(this.light);

    // 护盾外壳（超新星坍缩赋予）
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0x9fd8ff, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    this.shell.visible = false;
    g.add(this.shell);

    g.position.y = 0.75;
    this.scene.add(g);
    this.mesh = g;
  }

  reset() {
    this.pos = this.mesh.position;
    this.pos.set(0, 0.75, 6);
    this.vel = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.aimPoint = new THREE.Vector3(0, 0, 0);
    this.radius = PLAYER.radius;

    // 基础属性 + 强化乘区
    this.level = 1;
    this.xp = 0;
    this.stats = {
      maxHp: PLAYER.maxHp,
      hp: PLAYER.maxHp,
      dmgMul: 1, rateMul: 1, speedMul: 1,
      magnet: PLAYER.magnetBase,
      armor: 0,
      critCh: 0.05, critMul: PLAYER.critMul,
      dashCd: PLAYER.dashCd,
    };

    this.dashT = 0;           // 剩余冲刺时间
    this.dashCdT = 0;         // 冲刺冷却
    this.dashDir = new THREE.Vector3();
    this.iFrames = 0;         // 受伤无敌
    this.alive = true;
    this.mesh.visible = true;
    this.banking = 0;
    this.trailAcc = 0;
    this.kills = 0;
    this.shield = false;
    this.shell.visible = false;
    this.dead = false;        // 联机倒地状态
    this.respawnT = 0;
  }

  // 联机重生
  respawn() {
    this.dead = false;
    this.alive = true;
    this.stats.hp = this.stats.maxHp * 0.5;
    this.pos.set(0, 0.75, 0);
    this.vel.set(0, 0, 0);
    this.iFrames = 2;
    this.mesh.visible = true;
  }

  grantShield() {
    this.shield = true;
    this.shell.visible = true;
  }

  get hpFrac() { return this.stats.hp / this.stats.maxHp; }
  get invulnerable() { return this.iFrames > 0 || this.dashT > 0; }

  tryDash(moveVec) {
    if (this.dashCdT > 0 || this.dashT > 0) return false;
    this.dashT = PLAYER.dashTime;
    this.dashCdT = this.stats.dashCd;
    this.iFrames = Math.max(this.iFrames, PLAYER.dashIFrames);
    if (moveVec.active) this.dashDir.set(moveVec.x, 0, moveVec.z).normalize();
    else this.dashDir.copy(this.aimDir);
    return true;
  }

  takeDamage(raw, game) {
    if (!this.alive || this.dead || this.invulnerable) return false;
    // 护盾抵挡一次
    if (this.shield) {
      this.shield = false;
      this.shell.visible = false;
      return 'shield';
    }
    const dmg = Math.max(1, Math.round(raw - this.stats.armor));
    this.stats.hp -= dmg;
    this.iFrames = PLAYER.contactIFrames;
    return dmg;
  }

  heal(n) {
    const real = Math.min(n, this.stats.maxHp - this.stats.hp);
    this.stats.hp += real;
    return real;
  }

  update(dt, input, game) {
    if (!this.alive || this.dead) return;
    const mv = input.moveVec();
    const speed = PLAYER.speed * this.stats.speedMul * (game.zoneSlowFactor || 1);

    // —— 冲刺 ——
    this.dashCdT = Math.max(0, this.dashCdT - dt);
    if ((input.justPressed('Space') || input.justPressed('ShiftLeft') || input.justPressed('ShiftRight'))) {
      if (this.tryDash(mv)) {
        game.audio.dash();
        game.shockwaves.fire(this.pos.x, this.pos.z, 2.2, PALETTE.player, 0.35);
        game.addTrauma(0.25);
      }
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.copy(this.dashDir).multiplyScalar(speed * PLAYER.dashMul);
      // 冲刺残影粒子
      game.particles.spawn(
        this.pos.x, this.pos.y, this.pos.z,
        -this.dashDir.x * 2 + (Math.random() - 0.5), 0.5, -this.dashDir.z * 2 + (Math.random() - 0.5),
        0.4, 1.6, PALETTE.player, 4, 0
      );
    } else {
      // —— 常规加速/阻尼移动 ——
      const targetVx = mv.x * speed, targetVz = mv.z * speed;
      const lambda = mv.active ? 12 : 9;
      this.vel.x = damp(this.vel.x, targetVx, lambda, dt);
      this.vel.z = damp(this.vel.z, targetVz, lambda, dt);
    }

    // 联机会动态扩大场地，碰撞边界必须与当前世界的可视围墙一致。
    const edge = game.arena - WALL_PAD;
    const nextX = this.pos.x + this.vel.x * dt;
    const nextZ = this.pos.z + this.vel.z * dt;
    this.pos.x = clamp(nextX, -edge, edge);
    this.pos.z = clamp(nextZ, -edge, edge);
    // 撞墙后清除朝墙外的速度，避免网络预测把队友模型外推到墙外。
    if (this.pos.x !== nextX) this.vel.x = 0;
    if (this.pos.z !== nextZ) this.vel.z = 0;
    // 设施掩体为圆形碰撞体；同时剔除朝掩体内部的速度，冲刺也不会穿柱。
    game.world.resolveCircle(this.pos, this.radius, this.vel);

    // —— 朝向瞄准点 ——
    const dx = this.aimPoint.x - this.pos.x, dz = this.aimPoint.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01) { this.aimDir.set(dx / d, 0, dz / d); }
    const targetYaw = Math.atan2(this.aimDir.x, this.aimDir.z);
    let dy = targetYaw - this.mesh.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.mesh.rotation.y += dy * Math.min(1, dt * 18);

    // 侧倾（压弯）
    const latVel = this.vel.x * Math.cos(this.mesh.rotation.y) - this.vel.z * Math.sin(this.mesh.rotation.y);
    this.banking = damp(this.banking, clamp(-latVel * 0.028, -0.5, 0.5), 8, dt);
    this.mesh.rotation.z = this.banking;

    // 悬浮起伏 + 引擎尾迹
    this.pos.y = 0.75 + Math.sin(game.time * 3.1) * 0.06;
    this.coreMat.color.setHSL(0.52, 1, 0.75 + Math.sin(game.time * 6) * 0.15);
    this.trailAcc += dt;
    const spd = this.vel.length();
    if (spd > 2 && this.trailAcc > 0.03) {
      this.trailAcc = 0;
      game.particles.spawn(
        this.pos.x - this.aimDir.x * 0.5 + (Math.random() - 0.5) * 0.3,
        0.45,
        this.pos.z - this.aimDir.z * 0.5 + (Math.random() - 0.5) * 0.3,
        -this.vel.x * 0.15, 0.6, -this.vel.z * 0.15,
        0.45, 0.9, 0x1899ff, 3, 0
      );
    }

    // 受击闪烁
    this.iFrames = Math.max(0, this.iFrames - dt);
    const flash = this.iFrames > 0 && Math.floor(game.time * 20) % 2 === 0;
    this.bodyMat.emissiveIntensity = flash ? 4 : 1.5;
    // 护盾脉动
    if (this.shield) {
      this.shell.material.opacity = 0.2 + Math.sin(game.time * 5) * 0.1;
      this.shell.rotation.y += dt * 1.5;
    }
  }
}
