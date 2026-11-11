// Guards: animated soldiers (three.js Soldier.glb) with gas masks, helmets and slung rifles.
// Sight cones with line-of-sight, hearing, suspicion -> investigate -> alert -> search state machine.
import * as THREE from 'three';
import { clone as skClone } from '../vendor/SkeletonUtils.js';
import { clamp, angleDiff, lerp } from './util.js';
import { Audio } from './audio.js';

const WALK = 1.35, RUN = 3.7;
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpV2 = new THREE.Vector3();

function raySegDist(o, d, a, b) { // ray o + t d (|d|=1), segment a-b. returns [dist, t]
  const u = d, v = tmpV2.subVectors(b, a), w = new THREE.Vector3().subVectors(o, a);
  const A = 1, B = u.dot(v), C = v.dot(v), D = u.dot(w), E = v.dot(w); const den = A * C - B * B;
  let sc, tc; if (den < 1e-7) { sc = 0; tc = E / C; } else { sc = (B * E - C * D) / den; tc = (A * E - B * D) / den; }
  tc = clamp(tc, 0, 1); sc = Math.max(0, (B * tc - D) / A);
  const p = new THREE.Vector3().copy(o).addScaledVector(u, sc), q = new THREE.Vector3().copy(a).addScaledVector(v, tc);
  return [p.distanceTo(q), sc];
}

export class Enemies {
  constructor(scene, gltf, world) {
    this.scene = scene; this.gltf = gltf; this.world = world; this.list = [];
    this.flash = new THREE.PointLight(0xffc070, 0, 12, 2); scene.add(this.flash); this.flashT = 0;
    // materials: field-grey uniform + dark gas-mask lenses
    const src = gltf.scene; let tex = null; src.traverse(o => { if (o.isMesh && o.material.map) tex = o.material.map; });
    this.bodyMat = new THREE.MeshStandardMaterial({ map: tex, color: new THREE.Color(0.42, 0.46, 0.4), roughness: 0.75, metalness: 0.1, envMapIntensity: 0.6 });
    this.visorMat = new THREE.MeshStandardMaterial({ color: 0x080a0c, roughness: 0.12, metalness: 0.6, envMapIntensity: 1.5 });
    this.gearMat = new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.8 });
    this.woodMat = new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.6 });
    this.metalMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.4, metalness: 0.8 });
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: world.blobTex, color: 0xffd090, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false })); this.muzzle.scale.setScalar(0.9); this.muzzle.visible = false; scene.add(this.muzzle);
  }
  makeModel() {
    const m = skClone(this.gltf.scene);
    m.traverse(o => { if (o.isMesh || o.isSkinnedMesh) { o.material = /visor/i.test(o.name) ? this.visorMat : this.bodyMat; o.frustumCulled = false; } });
    const bones = {}; m.traverse(o => { if (o.isBone) bones[o.name] = o; });
    // helmet (Stahlhelm-like silhouette)
    const helmet = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), this.gearMat); dome.scale.set(1, 0.92, 1.12); helmet.add(dome);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.19, 0.08, 18, 1, true), this.gearMat); skirt.position.y = -0.005; skirt.scale.set(1, 1, 1.12); helmet.add(skirt);
    this.scene.add(helmet);
    // rifle slung across the back
    const rifle = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.85, 6), this.metalMat); barrel.position.y = 0.35; rifle.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.09), this.woodMat); stock.position.y = -0.23; rifle.add(stock);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.05), this.woodMat); fore.position.y = 0.15; rifle.add(fore);
    this.scene.add(rifle);
    const mixer = new THREE.AnimationMixer(m);
    const acts = {}; for (const c of this.gltf.animations) acts[c.name] = mixer.clipAction(c);
    return { m, bones, helmet, rifle, mixer, acts };
  }
  spawn(defs) {
    for (const def of defs) {
      const { m, bones, helmet, rifle, mixer, acts } = this.makeModel();
      this.scene.add(m);
      const g = { def, m, bones, helmet, rifle, mixer, acts, pos: new THREE.Vector3(def.path[0].x, 0, def.path[0].z), yaw: def.yaw ?? 0,
        state: 'patrol', sus: 0, wp: 0, waitT: 0, path: null, pathTarget: null, lastKnown: new THREE.Vector3(), lostT: 0, searchT: 0,
        shootCD: 0, alive: true, deadT: 0, heightened: 0, whistleCD: 0, speed: 0, anim: null, seeing: false, spotted: false, scanPh: Math.random() * 6, dir: 1 };
      if (def.lantern) { g.lantern = this.world.lanternMesh(); g.lantern.scale.setScalar(0.9); this.scene.add(g.lantern); g.lanternLight = this.world.addLamp(new THREE.Vector3(), 0xffa04a, 9, 2.6, true); g.lamp = this.world.lamps[this.world.lamps.length - 1]; }
      this.play(g, 'Idle'); this.list.push(g);
    }
  }
  reset() { for (const g of this.list) this.resetGuard(g); }
  resetGuard(g) {
    const d = g.def; g.pos.set(d.path[0].x, 0, d.path[0].z); g.yaw = d.yaw ?? 0; g.state = 'patrol'; g.sus = 0; g.wp = 0; g.waitT = 0; g.path = null; g.alive = true; g.deadT = 0; g.heightened = 0; g.spotted = false; g.m.rotation.set(0, 0, 0); g.m.visible = true; g.helmet.visible = g.rifle.visible = true;
    if (g.lantern) { g.lantern.visible = true; g.lanternLight.visible = true; }
    g.mixer.timeScale = 1; this.play(g, 'Idle');
  }
  play(g, name, ts = 1) {
    const a = g.acts[name]; if (!a) return; a.timeScale = ts; if (g.anim === name) return;
    const prev = g.anim ? g.acts[g.anim] : null; a.reset().play(); if (prev) a.crossFadeFrom(prev, 0.3, false); g.anim = name;
  }
  // put a dead soldier (clue) in the ditch
  placeCorpse(pos) {
    const { m, helmet, rifle, mixer, acts } = this.makeModel(); this.scene.add(m);
    acts.Idle.play(); mixer.update(0.5);
    m.position.copy(pos).add(new THREE.Vector3(0, 0.16, 0)); m.rotation.set(Math.PI / 2, 0.6, 0, 'YXZ'); m.updateMatrixWorld(true);
    helmet.position.copy(pos).add(new THREE.Vector3(0.9, 0.12, 0.55)); helmet.rotation.set(1.9, 0, 0.4);
    rifle.position.copy(pos).add(new THREE.Vector3(-0.6, 0.05, 0.9)); rifle.rotation.set(Math.PI / 2, 0, 1.2);
    this.corpse = m;
    const lan = this.world.lanternMesh(); lan.position.copy(pos).add(new THREE.Vector3(1.1, 0.12, -0.6)); lan.rotation.z = Math.PI / 2; lan.userData.glow.scale.setScalar(0.9); lan.userData.glow.material = lan.userData.glow.material.clone(); lan.userData.glow.material.opacity = 0.35; this.scene.add(lan);
    this.world.addLamp(lan.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xff9a40, 6, 1.4, true);
  }

  noise(pos, radius, kind = 'step') {
    for (const g of this.list) {
      if (!g.alive) continue; const d = Math.hypot(g.pos.x - pos.x, g.pos.z - pos.z); if (d > radius) continue;
      if (kind === 'shot') { if (g.state !== 'alert') { g.state = 'search'; g.searchT = 10; g.sus = Math.max(g.sus, 0.9); } g.lastKnown.set(pos.x + (Math.random() - 0.5) * 6, 0, pos.z + (Math.random() - 0.5) * 6); g.path = null; g.heightened = 90; if (d < 45) Audio.shout(this.pan(g), d > 20); }
      else if (g.state === 'patrol' || g.state === 'suspect') { g.sus = Math.max(g.sus, 0.5); g.state = 'investigate'; g.lastKnown.set(pos.x + (Math.random() - 0.5) * 3, 0, pos.z + (Math.random() - 0.5) * 3); g.path = null; g.searchT = 5; }
    }
  }
  pan(g) { if (!this.cam) return 0; const v = tmpV.set(g.pos.x, 1.5, g.pos.z).project(this.cam); return clamp(v.x, -1, 1); }

  raycast(o, d, maxD) {
    let best = null;
    for (const g of this.list) {
      if (!g.alive) continue;
      const head = g.bones.mixamorigHead ? g.bones.mixamorigHead.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0)) : new THREE.Vector3(g.pos.x, 1.65, g.pos.z);
      const toH = new THREE.Vector3().subVectors(head, o); const th = toH.dot(d);
      if (th > 0 && th < maxD) { const dist = toH.addScaledVector(d, -th).length(); if (dist < 0.17 && (!best || th < best.t)) best = { g, t: th, head: true }; }
      const a = new THREE.Vector3(g.pos.x, 0.15, g.pos.z), b = new THREE.Vector3(g.pos.x, 1.45, g.pos.z);
      const [dist, t] = raySegDist(o, d, a, b); if (dist < 0.3 && t < maxD && (!best || t < best.t)) best = { g, t, head: false };
    }
    return best;
  }
  kill(g, silent = false) {
    g.alive = false; g.deadT = 0; g.state = 'dead'; g.sus = 0; g.mixer.timeScale = 0;
    g.fallDir = Math.random() < 0.5 ? 1 : -1; if (g.lantern) { g.lanternLight.visible = false; }
    this.onKill?.(g, silent);
  }
  // knife takedown candidate: guard close, player behind, not alert
  takedownTarget(p) {
    for (const g of this.list) {
      if (!g.alive || g.state === 'alert') continue; const dx = p.pos.x - g.pos.x, dz = p.pos.z - g.pos.z, d = Math.hypot(dx, dz);
      if (d > 1.7) continue; const toP = Math.atan2(dx, dz); if (Math.abs(angleDiff(g.yaw, toP)) < 1.9 && g.seeing) continue;
      const toG = Math.atan2(-dx, -dz); if (Math.abs(angleDiff(p.yaw + Math.PI, toG)) > 0.9) continue;
      return g;
    }
    return null;
  }

  moveTo(g, tx, tz, speed, dt) {
    if (!g.path || !g.pathTarget || Math.hypot(g.pathTarget.x - tx, g.pathTarget.z - tz) > 1.5) { g.path = this.world.findPath(g.pos.x, g.pos.z, tx, tz); g.pathTarget = { x: tx, z: tz }; g.repath = 3; }
    g.repath -= dt; if (g.repath < 0) { g.path = null; }
    if (!g.path || !g.path.length) return true;
    const n = g.path[0]; const dx = n.x - g.pos.x, dz = n.z - g.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.5) { g.path.shift(); return g.path.length === 0; }
    this.turnTo(g, Math.atan2(dx, dz), dt, 5);
    const facing = Math.abs(angleDiff(g.yaw, Math.atan2(dx, dz))) < 0.9;
    const v = facing ? speed : speed * 0.2; g.pos.x += Math.sin(g.yaw) * v * dt; g.pos.z += Math.cos(g.yaw) * v * dt; g.speed = v;
    this.world.collide(g.pos, 0.33); return false;
  }
  turnTo(g, target, dt, rate = 4) { const d = angleDiff(g.yaw, target); g.yaw += clamp(d, -rate * dt, rate * dt); }

  update(dt, P, cam, active = true) {
    this.cam = cam; const out = { max: 0, alert: false, ind: [] };
    this.flashT -= dt; if (this.flashT <= 0) { this.flash.intensity = 0; this.muzzle.visible = false; }
    for (const g of this.list) {
      g.speed = 0;
      if (!g.alive) { this.updateDead(g, dt); continue; }
      if (active) this.think(g, dt, P); else this.patrol(g, dt);
      // animation by speed
      if (g.speed > 2.2) this.play(g, 'Run', g.speed / RUN); else if (g.speed > 0.3) this.play(g, 'Walk', g.speed / WALK); else this.play(g, 'Idle');
      g.mixer.update(dt);
      g.pos.y = this.world.heightAt(g.pos.x, g.pos.z);
      g.m.position.copy(g.pos); g.m.rotation.y = g.yaw + Math.PI;
      this.attach(g);
      if (g.sus > 0.04 || g.state === 'alert' || g.state === 'search') { out.ind.push({ x: g.pos.x, z: g.pos.z, lvl: g.state === 'alert' ? 1 : g.state === 'search' ? Math.max(0.75, g.sus) : g.sus, alert: g.state === 'alert' }); }
      out.max = Math.max(out.max, g.state === 'alert' ? 1 : g.state === 'search' ? 0.7 : g.sus); if (g.state === 'alert') out.alert = true;
    }
    return out;
  }
  attach(g) {
    g.m.updateMatrixWorld(true);
    const head = g.bones.mixamorigHead, spine = g.bones.mixamorigSpine2, hand = g.bones.mixamorigLeftHand;
    if (head) { head.getWorldPosition(tmpV); g.helmet.position.copy(tmpV); g.helmet.position.y += g.helmetUp ?? 0.11; g.helmet.rotation.set(0.12, g.yaw, 0, 'YXZ'); }
    if (spine) { spine.getWorldPosition(tmpV); const fwd = new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw)); g.rifle.position.copy(tmpV).addScaledVector(fwd, -0.2); g.rifle.rotation.set(0, g.yaw, 0.55, 'YXZ'); g.rifle.rotateZ(0); }
    if (g.lantern && hand) { hand.getWorldPosition(tmpV); g.lantern.position.copy(tmpV).add(new THREE.Vector3(0, -0.22, 0)); g.lantern.rotation.y = g.yaw; g.lanternLight.position.copy(g.lantern.position); g.lamp.pos.copy(g.lantern.position); }
  }
  updateDead(g, dt) {
    if (g.deadT < 1) { g.deadT += dt; const t = Math.min(1, g.deadT / 0.75); const e = t * t; g.m.rotation.set(-Math.PI / 2 * e * g.fallDir * 0.98, g.yaw + Math.PI, 0, 'YXZ'); g.m.position.y = g.pos.y + e * 0.12; this.attach(g); if (t >= 1) { g.helmet.position.set(g.pos.x + Math.sin(g.yaw) * -1.6 * g.fallDir, g.pos.y + 0.12, g.pos.z + Math.cos(g.yaw) * -1.6 * g.fallDir); g.helmet.rotation.set(1.4, 0, 0.3); if (g.lantern) { g.lantern.position.set(g.pos.x + 0.7, g.pos.y + 0.12, g.pos.z); } } }
  }
  patrol(g, dt) {
    const path = g.def.path; const wp = path[g.wp];
    if (g.waitT > 0) {
      g.waitT -= dt; const base = wp.look ?? g.yaw; const scan = wp.scan ?? 0.6; g.scanPh += dt * 0.5;
      this.turnTo(g, base + Math.sin(g.scanPh) * scan, dt, 1.2);
      if (g.waitT <= 0) { if (path.length > 1) { if (g.def.pingpong) { if (g.wp + g.dir >= path.length || g.wp + g.dir < 0) g.dir *= -1; g.wp += g.dir; } else g.wp = (g.wp + 1) % path.length; } g.path = null; }
      return;
    }
    const arrived = this.moveTo(g, wp.x, wp.z, g.def.speed ?? WALK, dt);
    if (arrived) { g.waitT = wp.wait ?? 0.01; if (path.length === 1) g.waitT = 9999; }
  }
  canSee(g, P) {
    const dx = P.pos.x - g.pos.x, dz = P.pos.z - g.pos.z, d = Math.hypot(dx, dz);
    const hi = g.state === 'alert' || g.state === 'search' || g.heightened > 0;
    const range = hi ? 30 : 21; if (d > range) return 0;
    const ang = Math.abs(angleDiff(g.yaw, Math.atan2(dx, dz))); const fov = hi ? 1.45 : 1.08; if (ang > fov && d > 1.6) return 0;
    if (!this.world.sightClear(g.pos.x, g.pos.z, 1.6, P.pos.x, P.pos.z, P.eyeY)) return 0;
    const vis = P.visibility; const df = Math.pow(1 - d / range, 1.2); const af = 1 - 0.5 * Math.min(1, ang / fov);
    let e = vis * df * af; if (d < 2.4 && vis > 0.15) e += 0.8;
    return e;
  }
  think(g, dt, P) {
    g.heightened = Math.max(0, g.heightened - dt); g.whistleCD -= dt; g.shootCD -= dt;
    const e = this.canSee(g, P); g.seeing = e > 0.06;
    const dPlayer = Math.hypot(P.pos.x - g.pos.x, P.pos.z - g.pos.z);
    if (P.dead) { this.patrol(g, dt); g.sus = Math.max(0, g.sus - dt * 0.3); return; }
    // spotting corpses
    if (g.state !== 'alert') for (const o of this.list) if (!o.alive && !o.spotted && o !== g) { const dx = o.pos.x - g.pos.x, dz = o.pos.z - g.pos.z, d = Math.hypot(dx, dz); if (d < 16 && Math.abs(angleDiff(g.yaw, Math.atan2(dx, dz))) < 1.1 && this.world.sightClear(g.pos.x, g.pos.z, 1.6, o.pos.x, o.pos.z, 0.5)) { o.spotted = true; g.state = 'search'; g.searchT = 12; g.lastKnown.copy(o.pos); g.path = null; g.heightened = 120; this.raise(g, false); } }
    switch (g.state) {
      case 'patrol':
      case 'suspect': {
        if (g.seeing) { g.sus += e * 2.3 * dt * (g.heightened > 0 ? 1.5 : 1); g.lastKnown.copy(P.pos); }
        else g.sus = Math.max(0, g.sus - 0.1 * dt);
        if (g.sus >= 1) { this.raise(g, true); break; }
        if (g.sus > 0.28) { g.state = 'suspect'; g.speed = 0; this.turnTo(g, Math.atan2(g.lastKnown.x - g.pos.x, g.lastKnown.z - g.pos.z), dt, 2.2); if (!g.seeing && g.sus > 0.45) { g.state = 'investigate'; g.path = null; g.searchT = 5; } }
        else { if (g.state === 'suspect' && g.sus < 0.18) g.state = 'patrol'; if (g.state === 'patrol') this.patrol(g, dt); else this.turnTo(g, Math.atan2(g.lastKnown.x - g.pos.x, g.lastKnown.z - g.pos.z), dt, 2); }
        break;
      }
      case 'investigate':
      case 'search': {
        const run = g.state === 'search';
        if (g.seeing) { g.sus += e * (run ? 4 : 3) * dt; g.lastKnown.copy(P.pos); if (g.sus >= 1) { this.raise(g, true); break; } }
        const arrived = this.moveTo(g, g.lastKnown.x, g.lastKnown.z, run ? RUN * 0.8 : WALK, dt);
        if (arrived || Math.hypot(g.lastKnown.x - g.pos.x, g.lastKnown.z - g.pos.z) < 1.2) {
          g.speed = 0; g.searchT -= dt; g.scanPh += dt * 1.6; this.turnTo(g, g.yaw + Math.sin(g.scanPh) * 2, dt, 1.6);
          if (g.searchT <= 0) { g.state = 'patrol'; g.sus = run ? 0.25 : 0.1; g.path = null; g.heightened = Math.max(g.heightened, 45); }
        }
        if (!g.seeing) g.sus = Math.max(run ? 0.3 : 0, g.sus - 0.05 * dt);
        break;
      }
      case 'alert': {
        g.sus = 1;
        if (g.seeing) { g.lastKnown.copy(P.pos); g.lostT = 0; } else g.lostT += dt;
        const clear = g.seeing && dPlayer < 26;
        if (clear) {
          g.speed = 0; this.turnTo(g, Math.atan2(P.pos.x - g.pos.x, P.pos.z - g.pos.z), dt, 6);
          if (dPlayer > 15) { this.moveTo(g, P.pos.x, P.pos.z, RUN * 0.7, dt); }
          if (g.shootCD <= 0) { g.shootCD = 1.9 + Math.random() * 1.2; this.shoot(g, P, dPlayer); }
        } else {
          this.moveTo(g, g.lastKnown.x, g.lastKnown.z, RUN, dt);
          if (g.lostT > 6) { g.state = 'search'; g.searchT = 10; g.path = null; }
        }
        break;
      }
    }
  }
  raise(g, sawPlayer) {
    const was = g.state; g.state = sawPlayer ? 'alert' : 'search'; g.sus = sawPlayer ? 1 : 0.8; g.path = null; g.heightened = 120;
    if (sawPlayer && was !== 'alert') { g.shootCD = 0.9 + Math.random() * 0.4; this.onAlert?.(g); }
    if (g.whistleCD <= 0) { g.whistleCD = 12; Audio.whistle(this.pan(g)); Audio.shout(this.pan(g), false); }
    for (const o of this.list) if (o !== g && o.alive && o.state !== 'alert' && o.pos.distanceTo(g.pos) < 38) { o.state = 'search'; o.searchT = 12; o.lastKnown.copy(g.lastKnown); o.path = null; o.heightened = 120; o.sus = Math.max(o.sus, 0.7); }
  }
  shoot(g, P, d) {
    const hm = g.bones.mixamorigRightHand; const p = hm ? hm.getWorldPosition(new THREE.Vector3()) : g.pos.clone().setY(g.pos.y + 1.4);
    p.add(new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw)).multiplyScalar(0.6)); p.y = g.pos.y + 1.45;
    this.flash.position.copy(p); this.flash.intensity = 6; this.muzzle.position.copy(p); this.muzzle.visible = true; this.flashT = 0.07;
    Audio.shot(d);
    let pHit = clamp(0.82 - d / 32, 0.12, 0.72); if (P.stance === 'crouch') pHit *= 0.75; if (P.running) pHit *= 0.6; if (P.inBush) pHit *= 0.65;
    if (Math.random() < pHit) P.damage(g); else Audio._noise('white', 'bandpass', 3500, 1.5, 0.12, 0.002, 0.12);
    this.onShot?.(g);
  }
}
export { WALK, RUN };
