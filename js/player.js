// First-person player: movement, stances, noise & visibility model, the single-shot rifle, knife, damage.
import * as THREE from 'three';
import { clamp, damp, lerp } from './util.js';
import { Input } from './input.js';
import { Audio } from './audio.js';

export class Player {
  constructor(camera, world, enemies) {
    this.cam = camera; this.world = world; this.enemies = enemies;
    this.pos = new THREE.Vector3(6, 0, 70); this.yaw = Math.PI; this.pitch = 0; this.eyeY = 1.65; this.eyeH = 1.65;
    this.stance = 'stand'; this.vel = new THREE.Vector2(); this.health = 3; this.dead = false;
    this.chamber = 1; this.reserve = 7; this.reloadT = 0; this.reloadPhase = ''; this.aimT = 0; this.recoil = 0; this.kick = 0;
    this.bob = 0; this.stepAcc = 0; this.visibility = 1; this.inBush = false; this.running = false; this.moving = false;
    this.control = false; this.hurtT = 0; this.knifeT = 0; this.stats = { shots: 0, kills: 0, detected: 0, takedowns: 0 };
    this.buildViewModel();
  }
  buildViewModel() {
    this.vScene = new THREE.Scene();
    this.vCam = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    this.vHemi = new THREE.HemisphereLight(0x8090a8, 0x201c18, 0.9); this.vScene.add(this.vHemi);
    this.vKey = new THREE.DirectionalLight(0xffb070, 0.0); this.vKey.position.set(1, 1, 1); this.vScene.add(this.vKey);
    this.vFill = new THREE.DirectionalLight(0x9aaccc, 0.9); this.vFill.position.set(-0.3, 1, -0.6); this.vScene.add(this.vFill);
    this.vFlash = new THREE.PointLight(0xffc080, 0, 3, 2); this.vFlash.position.set(0.1, 0, -1.0); this.vScene.add(this.vFlash);
    this.vScene.environment = this.world.scene.environment;
    const wood = new THREE.MeshStandardMaterial({ color: 0x2e2119, roughness: 0.5, metalness: 0.05 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.35, metalness: 0.85 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a30, roughness: 0.35, metalness: 0.9 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x3e4535, roughness: 0.95 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a58, roughness: 0.7 });
    const g = new THREE.Group(); this.gun = g;
    const box = (w, h, d, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.x = rx; g.add(o); return o; };
    const cyl = (r1, r2, l, m, x, y, z) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, l, 10), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); g.add(o); return o; };
    // Martini-style falling-block rifle, pointing -Z
    cyl(0.011, 0.013, 0.78, metal, 0, 0.02, -0.72); // barrel
    box(0.045, 0.035, 0.42, wood, 0, -0.0, -0.5); // forestock
    box(0.04, 0.05, 0.13, metal, 0, -0.012, -0.22); // receiver
    const butt = box(0.045, 0.085, 0.34, wood, 0, -0.04, 0.0, -0.12); butt.scale.y = 1.15;
    const lever = box(0.012, 0.012, 0.16, metal, 0, -0.06, -0.16); this.lever = lever; lever.geometry.translate(0, 0, -0.06);
    lever.position.set(0, -0.045, -0.12);
    box(0.005, 0.03, 0.006, metal, 0, 0.042, -1.09); // front sight
    box(0.009, 0.026, 0.01, metal, -0.011, 0.044, -0.3); box(0.009, 0.026, 0.01, metal, 0.011, 0.044, -0.3); box(0.031, 0.01, 0.01, metal, 0, 0.034, -0.3); // rear notch sight
    box(0.04, 0.006, 0.006, brass, 0, -0.025, -0.82); // band
    // left hand on forestock, right sleeve at the grip
    const lh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.11), skin); lh.position.set(-0.005, -0.03, -0.52); g.add(lh);
    const ls = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.42, 8), cloth); ls.rotation.set(1.2, 0, 0.55); ls.position.set(-0.13, -0.17, -0.38); g.add(ls); this.leftArm = [lh, ls];
    const rh = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, 0.1), skin); rh.position.set(0.012, -0.06, -0.1); g.add(rh);
    const rs = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), cloth); rs.rotation.set(1.35, 0, -0.35); rs.position.set(0.1, -0.12, 0.05); g.add(rs);
    this.round = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.07, 8), brass); this.round.rotation.x = Math.PI / 2; this.round.visible = false; g.add(this.round);
    this.muzzleS = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.world.blobTex, color: 0xffd28a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); this.muzzleS.position.set(0, 0.02, -1.15); this.muzzleS.scale.setScalar(0.35); this.muzzleS.visible = false; g.add(this.muzzleS);
    // knife (for takedowns)
    const knife = new THREE.Group(); const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.025, 0.16), new THREE.MeshStandardMaterial({ color: 0xaab0b8, metalness: 0.9, roughness: 0.25 })); blade.position.z = -0.1; knife.add(blade); const hd = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.1), wood); knife.add(hd);
    knife.visible = false; this.vScene.add(knife); this.knife = knife;
    this.vScene.add(g);
    // left arm raised into view during the intro: field-grey sleeve, torn-off armband
    const arm = new THREE.Group(); this.arm = arm;
    const tunic = new THREE.MeshStandardMaterial({ color: 0x55604a, roughness: 0.95 });
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.066, 0.62, 14), tunic); sleeve.rotation.x = Math.PI / 2; sleeve.position.z = 0.1; arm.add(sleeve);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 14), new THREE.MeshStandardMaterial({ color: 0x48523e, roughness: 1 })); cuff.rotation.x = Math.PI / 2; cuff.position.z = -0.2; arm.add(cuff);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.04, 0.11), skin); hand.position.set(0, 0, -0.29); hand.rotation.z = 0.5; arm.add(hand);
    // the pale rectangle where the armband used to be, with loose threads
    const scar = new THREE.Mesh(new THREE.CylinderGeometry(0.0675, 0.0675, 0.075, 14, 1, true, -0.9, 1.8), new THREE.MeshStandardMaterial({ color: 0x8a8b74, roughness: 1, side: THREE.DoubleSide })); scar.rotation.x = Math.PI / 2; scar.position.z = 0.16; arm.add(scar);
    for (let i = 0; i < 9; i++) { const a = -0.9 + i * 0.22; const th = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 0.02 + Math.random() * 0.025), new THREE.MeshStandardMaterial({ color: 0x2c2a22 })); th.position.set(Math.sin(a) * 0.069, Math.cos(a) * 0.069, 0.16 + (i % 2 ? 0.04 : -0.04)); th.rotation.set(Math.random() - 0.5, 0, a); arm.add(th); }
    arm.visible = false; this.vScene.add(arm); this.armT = 0;
    this.hip = new THREE.Vector3(0.15, -0.135, -0.3); this.ads = new THREE.Vector3(0, -0.05, 0.1); this.lowered = new THREE.Vector3(0.22, -0.45, -0.1);
    this.gunOffset = this.lowered.clone(); this.gunRaise = 0;
  }
  setAspect(a) { this.vCam.aspect = a; this.vCam.updateProjectionMatrix(); }
  respawn(cp) { this.pos.set(cp.x, this.world.heightAt(cp.x, cp.z), cp.z); this.yaw = cp.yaw; this.pitch = 0; this.health = 3; this.dead = false; this.stance = 'stand'; this.reloadT = 0; this.reloadPhase = ''; if (this.chamber === 0 && this.reserve > 0) { this.chamber = 1; this.reserve--; } this.hurtT = 0; }

  damage(src) {
    if (this.dead) return; this.health--; this.hurtT = 1; this.kick += 0.08; Audio.hurt(); this.onHurt?.(src);
    if (this.health <= 0) { this.dead = true; this.onDeath?.(src); }
  }
  emitNoise(r, kind = 'step') { this.enemies.noise(this.pos, r, kind); this.lastNoise = r; this.noiseT = 0.6; }

  update(dt) {
    const look = Input.poll();
    const W = this.world;
    if (this.control && !this.dead) {
      const sens = this.aimT > 0.5 ? 0.55 : 1; this.yaw -= look.x * sens; this.pitch = clamp(this.pitch - look.y * sens, -1.35, 1.35);
      if (Input.consume('crouch')) { this.stance = this.stance === 'crouch' ? 'stand' : 'crouch'; Input.crouchToggled = this.stance === 'crouch'; this.onStance?.(this.stance); }
      const mx = Input.move.x, my = Input.move.y; const mag = Math.min(1, Math.hypot(mx, my));
      this.running = Input.run && mag > 0.3 && this.reloadT <= 0 && !Input.aim; if (this.running && this.stance === 'crouch') { this.stance = 'stand'; Input.crouchToggled = false; this.onStance?.(this.stance); }
      const speed = this.running ? 4.4 : this.stance === 'crouch' ? 1.45 : (Input.aim ? 1.6 : 2.5);
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const tx = (fx * my + rx * mx) * speed, tz = (fz * my + rz * mx) * speed;
      this.vel.x = damp(this.vel.x, tx, 10, dt); this.vel.y = damp(this.vel.y, tz, 10, dt);
    } else { this.vel.x = damp(this.vel.x, 0, 10, dt); this.vel.y = damp(this.vel.y, 0, 10, dt); this.running = false; }
    const sp = this.vel.length(); this.moving = sp > 0.25;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.y * dt;
    W.collide(this.pos, 0.33);
    const gy = W.heightAt(this.pos.x, this.pos.z); this.pos.y = damp(this.pos.y, gy, 18, dt);
    // footsteps & noise
    if (this.moving && this.control) {
      this.stepAcc += sp * dt; const stride = this.running ? 1.6 : this.stance === 'crouch' ? 0.85 : 1.25;
      if (this.stepAcc > stride) { this.stepAcc = 0; const surf = W.surfaceAt(this.pos.x, this.pos.z); Audio.step(surf, this.running ? 1.4 : this.stance === 'crouch' ? 0.45 : 0.9); this.emitNoise(this.running ? 13 : this.stance === 'crouch' ? 1.2 : 4.5); }
      this.bob += sp * dt * (this.running ? 2.0 : 2.4);
    }
    this.noiseT = Math.max(0, (this.noiseT || 0) - dt);
    // eye height
    this.eyeH = damp(this.eyeH, this.stance === 'crouch' ? 1.02 : 1.62, 10, dt);
    this.eyeY = this.pos.y + this.eyeH;
    // visibility
    this.inBush = W.bushAt(this.pos.x, this.pos.z);
    const light = W.lightAt(this.pos.x, this.pos.y + 1, this.pos.z);
    let v = 0.62 + light * 1.25; if (this.stance === 'crouch') v *= 0.5; if (this.running) v *= 1.3; else if (!this.moving) v *= 0.8; if (this.inBush) v *= this.stance === 'crouch' ? 0.18 : 0.45; if (W.inside(this.pos.x, this.pos.z, 'HQ')) v *= 1.15;
    this.visibility = v; this.light = light;
    this.updateWeapon(dt);
    // camera
    const bobA = this.moving ? (this.running ? 0.055 : 0.03) : 0; const by = Math.sin(this.bob * 2) * bobA, bx = Math.cos(this.bob) * bobA * 0.6;
    this.kick = damp(this.kick, 0, 7, dt); this.recoil = damp(this.recoil, 0, 9, dt);
    const breath = Math.sin(performance.now() / 1000 * 1.3) * (0.004 + (this.aimT > 0.5 ? 0.002 : 0));
    this.cam.position.set(this.pos.x + Math.cos(this.yaw) * bx, this.eyeY + by, this.pos.z - Math.sin(this.yaw) * bx);
    this.cam.rotation.set(this.pitch + this.kick + breath, this.yaw, Math.sin(this.bob) * bobA * 0.15, 'YXZ');
    const fov = lerp(72, 42, this.aimT); if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    this.hurtT = Math.max(0, this.hurtT - dt * 0.8);
  }
  updateWeapon(dt) {
    const can = this.control && !this.dead;
    const wantAim = can && Input.aim && this.reloadT <= 0 && !this.running;
    this.aimT = damp(this.aimT, wantAim ? 1 : 0, 12, dt);
    this.gunRaise = damp(this.gunRaise, this.control ? 1 : 0, 4, dt);
    // fire
    if (can && Input.consume('fire')) {
      if (this.reloadT > 0) {} else if (this.chamber > 0) this.fire(); else { Audio.click(); this.startReload(); }
    }
    if (can && Input.consume('reload') && this.chamber === 0 && this.reloadT <= 0) this.startReload();
    // reload timeline: lever down -> eject -> insert -> lever up
    let leverA = 0;
    if (this.reloadT > 0) {
      this.reloadT += dt; const t = this.reloadT;
      if (t > 0.25 && this.reloadPhase === 'start') { this.reloadPhase = 'down'; Audio.lever(true); if (this.spent) { Audio.shell(); this.spent = false; } }
      if (t > 1.2 && this.reloadPhase === 'down') { this.reloadPhase = 'in'; Audio.insert(); }
      if (t > 1.9 && this.reloadPhase === 'in') { this.reloadPhase = 'up'; Audio.lever(false); }
      if (t > 2.35) { this.reloadT = 0; this.reloadPhase = ''; this.chamber = 1; this.reserve--; this.onAmmo?.(); }
      leverA = t < 0.25 ? t / 0.25 * 0.9 : t < 1.9 ? 0.9 : Math.max(0, 0.9 - (t - 1.9) / 0.25 * 0.9);
      this.round.visible = t > 0.7 && t < 1.25; if (this.round.visible) { const k = (t - 0.7) / 0.55; this.round.position.set(0.03 * (1 - k), 0.06 - 0.06 * k, -0.25 + 0.05 * k); }
    } else this.round.visible = false;
    this.lever.rotation.x = leverA;
    // knife animation
    if (this.knifeT > 0) { this.knifeT -= dt; const k = 1 - this.knifeT / 0.6; this.knife.visible = true; const s = Math.sin(Math.min(1, k * 1.6) * Math.PI); this.knife.position.set(0.05 - s * 0.05, -0.12 + s * 0.06, -0.35 - s * 0.25); this.knife.rotation.set(-0.2 - s * 0.6, 0.3, 0.2); if (this.knifeT <= 0) this.knife.visible = false; }
    // place gun
    const target = this.ads.clone().lerp(this.hip, 1 - this.aimT); if (this.running) target.add(new THREE.Vector3(0.05, -0.05, 0.05));
    if (this.reloadT > 0) target.add(new THREE.Vector3(-0.04, -0.06, 0.06));
    if (this.knifeT > 0) target.add(new THREE.Vector3(0.1, -0.2, 0.1));
    target.lerp(this.lowered, 1 - this.gunRaise);
    this.gunOffset.lerp(target, 1 - Math.exp(-14 * dt));
    const sway = this.moving ? 1 : 0.3; const t = performance.now() / 1000;
    this.gun.position.copy(this.gunOffset).add(new THREE.Vector3(Math.cos(this.bob) * 0.008 * sway, Math.sin(this.bob * 2) * 0.006 * sway + Math.sin(t * 1.3) * 0.002, this.recoil * 0.12));
    this.gun.rotation.set(this.recoil * 0.5 + (this.reloadT > 0 ? 0.35 : 0) * (1 - this.aimT), (this.reloadT > 0 ? -0.25 : 0), this.reloadT > 0 ? 0.35 : 0);
    this.vCam.fov = lerp(55, 40, this.aimT); this.vCam.updateProjectionMatrix();
    // light the viewmodel by nearby lamps
    this.updateTorso();
    this.vHemi.intensity = 0.55 + (this.light || 0) * 0.6 + this.world.flash * 2.5; this.vKey.intensity = (this.light || 0) * 0.9;
  }
  updateTorso() {
    const k = this.armT || 0; this.arm.visible = k > 0.01; if (!this.arm.visible) return;
    this.arm.position.set(-0.18 + k * 0.08, -0.55 + k * 0.38, -0.36); this.arm.rotation.set(0.25 + (1 - k) * 0.6, -0.55, -1.25 + Math.sin(performance.now() / 700) * 0.03);
  }
  startReload() { if (this.reserve <= 0 || this.chamber > 0) { if (this.reserve <= 0) this.onNoAmmo?.(); return; } this.reloadT = 0.0001; this.reloadPhase = 'start'; this.emitNoise(2.5); }
  fire() {
    this.chamber = 0; this.spent = true; this.stats.shots++; this.recoil = 1; this.kick += 0.07 + (this.aimT > 0.5 ? 0 : 0.03);
    Audio.shot(0); this.emitNoise(85, 'shot');
    this.muzzleS.visible = true; this.vFlash.intensity = 4; setTimeout(() => { this.muzzleS.visible = false; this.vFlash.intensity = 0; }, 60);
    this.world.flashLocal = 0.15;
    const dir = new THREE.Vector3(); this.cam.getWorldDirection(dir);
    if (this.aimT < 0.6) { dir.x += (Math.random() - 0.5) * 0.05; dir.y += (Math.random() - 0.5) * 0.04; dir.z += (Math.random() - 0.5) * 0.05; dir.normalize(); }
    const o = this.cam.position.clone();
    const flat = Math.hypot(dir.x, dir.z) || 1e-6; const wallD = this.world.rayWall(o.x, o.z, o.y, dir.x / flat, dir.z / flat, dir.y / flat, 200) / flat;
    const hit = this.enemies.raycast(o, dir, Math.min(200, wallD));
    if (hit) { this.enemies.kill(hit.g); this.stats.kills++; this.onHit?.(hit); }
    this.onAmmo?.();
  }
  takedown(g) { this.knifeT = 0.6; this.enemies.kill(g, true); this.stats.takedowns++; Audio._noise('pink', 'lowpass', 600, 1, 0.3, 0.005, 0.2); this.emitNoise(2.0); }
}
