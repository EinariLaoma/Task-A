// World: terrain, the village of Elmtal (assembled from the CC0 Medieval Village MegaKit),
// forest (CC0 Stylized Nature pack), lights, rain, mist, lightning, colliders and interactables.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { rng, fbm, clamp, lerp, smooth, segIntersect, closestOnSeg } from './util.js';

const H = 3.12; // kit storey height
export const SQUARE = new THREE.Vector2(0, -12);
export const roadZ = x => 30 + 4 * Math.sin(x / 25);
export const SPAWN = { x: 4, z: 53 };

export const HOUSES = [
  { id: 'A', x: -16, z: -6, w: 3, d: 3, face: 'E', floors: 1, style: 'plaster' },
  { id: 'B', x: -17, z: -22, w: 3, d: 4, face: 'E', floors: 2, style: 'grid' },
  { id: 'C', x: 16, z: -4, w: 3, d: 3, face: 'W', floors: 1, style: 'brick' },
  { id: 'HQ', x: 18, z: -22, w: 4, d: 4, face: 'W', floors: 2, style: 'plaster', open: true, back: true, interior: true, lit: true },
  { id: 'D', x: -12, z: 12, w: 3, d: 3, face: 'E', floors: 1, style: 'grid' },
  { id: 'E', x: 13, z: 13, w: 2, d: 3, face: 'W', floors: 1, style: 'brick' },
  { id: 'F', x: -30, z: -34, w: 3, d: 3, face: 'E', floors: 1, style: 'brick' },
  { id: 'G', x: 32, z: -38, w: 3, d: 3, face: 'W', floors: 1, style: 'plaster' },
  { id: 'Hs', x: -34, z: 2, w: 2, d: 2, face: 'E', floors: 1, style: 'brick' },
  { id: 'I', x: 31, z: 2, w: 2, d: 3, face: 'W', floors: 1, style: 'grid' },
  { id: 'TOWER', x: 0, z: -57, w: 2, d: 2, face: 'S', floors: 4, style: 'tower' },
  { id: 'NAVE', x: 0, z: -65, w: 4, d: 4, face: 'S', floors: 2, style: 'church' },
];
const FACE = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 };

export class World {
  constructor(scene, assets, quality) {
    this.scene = scene; this.assets = assets; this.q = quality;
    this.segs = [];      // {ax,az,bx,bz,top} walls: collision + sight + bullets
    this.circles = [];   // {x,z,r} trunks, posts, crates
    this.bushes = [];    // {x,z,r} concealment
    this.lamps = [];     // {pos, light, base, range}
    this.interactables = [];
    this.footprints = []; // {x,z,hw,hd,rot}
    this.time = 0; this.flash = 0; this.nextBolt = 8; this.boltQueue = [];
    this.tmpM = new THREE.Matrix4();
  }

  heightAt(x, z) {
    let h = (fbm(x * 0.018 + 3, z * 0.018 - 7) - 0.5) * 7 + (fbm(x * 0.07, z * 0.07) - 0.5) * 0.8;
    // flatten village (ellipse)
    const vx = x / 52, vz = (z + 20) / 50; const vd = Math.sqrt(vx * vx + vz * vz);
    const village = 1 - smooth(clamp((vd - 0.75) / 0.45, 0, 1));
    h = lerp(h, 0, village);
    // road bed
    const rd = Math.abs(z - roadZ(x)); const road = 1 - smooth(clamp((rd - 3) / 5, 0, 1));
    h = lerp(h, Math.min(h, 0.1) - 0.15 + (x < -36 && x > -52 && z < roadZ(x) ? -0.0 : 0), road * (1 - village));
    // ditch north of road on the west side (fallen soldier)
    const dd = Math.hypot(x + 44, z - 23.2); if (dd < 4) h -= 0.45 * (1 - smooth(dd / 4));
    // rising ground to the south of the forest so the horizon is closed
    if (z > 80) h += (z - 80) * 0.18; if (Math.abs(x) > 85) h += (Math.abs(x) - 85) * 0.2; if (z < -90) h += (-90 - z) * 0.2;
    return h;
  }
  surfaceAt(x, z) {
    if (this.inside(x, z, 'HQ')) return 'wood';
    if (Math.hypot(x - SQUARE.x, z - SQUARE.y) < 11 || (Math.abs(x) < 2.6 && z < 20 && z > -56)) return 'stone';
    return 'mud';
  }
  inViewCorridor(x, z) { // keep the line of sight from the wake-up spot to the road clear for the intro
    if (z > SPAWN.z + 1 || z < 31) return false;
    for (const tx of [-9, -2, 5]) { const [px, pz] = closestOnSeg(x, z, SPAWN.x, SPAWN.z, tx, 30); if (Math.hypot(px - x, pz - z) < 1.6) return true; }
    return false;
  }
  inAnyFootprint(x, z, pad = 0) { for (const f of this.footprints) { const c = Math.cos(-f.rot), s = Math.sin(-f.rot); const lx = (x - f.x) * c - (z - f.z) * s, lz = (x - f.x) * s + (z - f.z) * c; if (Math.abs(lx) < f.hw + pad && Math.abs(lz) < f.hd + pad) return true; } return false; }
  inside(x, z, id) { const f = this.footprints.find(f => f.id === id); if (!f) return false; const c = Math.cos(-f.rot), s = Math.sin(-f.rot); const lx = (x - f.x) * c - (z - f.z) * s, lz = (x - f.x) * s + (z - f.z) * c; return Math.abs(lx) < f.hw && Math.abs(lz) < f.hd; }

  async build(onProgress = () => {}) {
    this.makeTextures();
    this.buildSky(); onProgress(0.1);
    this.buildTerrain(); onProgress(0.25);
    this.buildVillage(); onProgress(0.55);
    this.buildProps(); onProgress(0.65);
    this.buildForest(); onProgress(0.85);
    this.buildRain(); this.buildMist(); this.buildNav(); onProgress(1);
  }

  makeTextures() {
    const cv = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; };
    const r = rng(7);
    // ground detail (grayscale mottling) — tinted by vertex colours
    const g = cv(512, 512, (x, w, h) => {
      x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { const v = 90 + r() * 120 | 0; x.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.35})`; const s = 1 + r() * 4; x.fillRect(r() * w, r() * h, s, s); }
      for (let i = 0; i < 260; i++) { const v = 60 + r() * 60 | 0; x.strokeStyle = `rgba(${v},${v * 0.95 | 0},${v * 0.8 | 0},0.5)`; x.lineWidth = 1; x.beginPath(); const px = r() * w, py = r() * h; x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 14, py - r() * 12); x.stroke(); }
    });
    this.groundTex = new THREE.CanvasTexture(g); this.groundTex.wrapS = this.groundTex.wrapT = THREE.RepeatWrapping; this.groundTex.colorSpace = THREE.SRGBColorSpace; this.groundTex.repeat.set(70, 70); this.groundTex.anisotropy = 4;
    // roughness: puddles are smooth
    const rough = cv(256, 256, (x, w, h) => {
      x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { const px = r() * w, py = r() * h, s = 6 + r() * 26; const gr = x.createRadialGradient(px, py, 0, px, py, s); gr.addColorStop(0, 'rgba(50,50,50,0.9)'); gr.addColorStop(0.5, 'rgba(90,90,90,0.5)'); gr.addColorStop(1, 'rgba(200,200,200,0)'); x.fillStyle = gr; x.beginPath(); x.ellipse(px, py, s, s * (0.5 + r() * 0.5), r() * 3, 0, 7); x.fill(); }
    });
    this.roughTex = new THREE.CanvasTexture(rough); this.roughTex.wrapS = this.roughTex.wrapT = THREE.RepeatWrapping; this.roughTex.repeat.set(18, 18);
    // soft blob for glows & mist
    const blob = cv(128, 128, (x, w) => { const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, w, w); });
    this.blobTex = new THREE.CanvasTexture(blob);
    const mist = cv(256, 128, (x, w, h) => { for (let i = 0; i < 30; i++) { const px = 40 + r() * 176, py = 40 + r() * 48, s = 20 + r() * 40; const gr = x.createRadialGradient(px, py, 0, px, py, s); gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, w, h); } });
    this.mistTex = new THREE.CanvasTexture(mist);
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(400, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { flash: { value: 0 }, top: { value: new THREE.Color(0x05070b) }, hor: { value: new THREE.Color(0x1d2632) }, time: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position.z = gl_Position.w*0.9999; }',
      fragmentShader: `uniform float flash; uniform vec3 top; uniform vec3 hor; uniform float time; varying vec3 vP;
        float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
        void main(){ vec3 d = normalize(vP); float y = clamp(d.y,0.,1.);
          vec3 c = mix(hor, top, pow(y,0.55));
          vec2 uv = d.xz/(d.y+0.25)*2.0 + vec2(time*0.02,0.);
          float cl = n(uv)*0.6+n(uv*2.3)*0.3+n(uv*5.1)*0.1; c *= 0.75+cl*0.5;
          c += vec3(0.55,0.62,0.78)*flash*(0.4+cl*0.9)*(0.3+y);
          if(d.y<0.) c = hor*0.9;
          gl_FragColor = vec4(c,1.); }`
    });
    this.sky = new THREE.Mesh(geo, this.skyMat); this.sky.renderOrder = -10; this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2(0x161d26, 0.034);
    this.hemi = new THREE.HemisphereLight(0x7486a2, 0x23251d, 1.05); this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9db0cc, 0.42); this.moon.position.set(-30, 60, -20); this.scene.add(this.moon);
    // environment for wet reflections
    const pm = new THREE.PMREMGenerator(this.assets.renderer);
    const envScene = new THREE.Scene(); const es = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
    const pos = es.geometry.attributes.position; const cols = []; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 10; const c = new THREE.Color(0x0b0f15).lerp(new THREE.Color(0x3c4a5e), clamp(1 - Math.abs(y - 0.05) * 2.5, 0, 1)); cols.push(c.r, c.g, c.b); }
    es.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); envScene.add(es);
    this.scene.environment = pm.fromScene(envScene, 0).texture; this.scene.environmentIntensity = 0.55;
  }

  buildTerrain() {
    const S = 300, N = this.q.low ? 140 : 200;
    const geo = new THREE.PlaneGeometry(S, S, N, N); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, col = [];
    const cForest = new THREE.Color(0x3a3d26), cMoss = new THREE.Color(0x2f3a22), cMud = new THREE.Color(0x4a3b2a), cStone = new THREE.Color(0x5b5a55), cGrass = new THREE.Color(0x44482c), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i); p.setY(i, this.heightAt(x, z));
      const n = fbm(x * 0.05, z * 0.05);
      c.copy(cForest).lerp(cMoss, n); if (z < 38) c.lerp(cGrass, 0.5);
      const rd = Math.min(Math.abs(z - roadZ(x)), (z < 30 && z > -56) ? Math.abs(x) : 99);
      c.lerp(cMud, 1 - smooth(clamp((rd - 1.5) / 2.5, 0, 1)));
      const sq = Math.hypot(x - SQUARE.x, z - SQUARE.y); const st = Math.max(1 - smooth(clamp((sq - 9) / 3, 0, 1)), (Math.abs(x) < 2.3 && z < 20 && z > -56) ? 0.85 : 0);
      c.lerp(cStone, st * 0.85);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: this.groundTex, vertexColors: true, roughness: 1, roughnessMap: this.roughTex, metalness: 0, envMapIntensity: 0.5 });
    mat.onBeforeCompile = sh => { // second uv scale for roughness map
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness; vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv ); roughnessFactor *= clamp(texelRoughness.g*1.05, 0.12, 1.0);`);
    };
    this.terrain = new THREE.Mesh(geo, mat); this.scene.add(this.terrain);
  }

  // ---------- village ----------
  kitTemplates() {
    if (this._tpl) return this._tpl;
    const tpl = {}; const root = this.assets.village.scene; root.updateMatrixWorld(true);
    for (const holder of root.children) {
      const parts = []; const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
      holder.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, m: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) }); });
      tpl[holder.name] = parts;
    }
    // material tweaks: wet & dark
    const seen = new Set();
    root.traverse(o => { if (!o.isMesh || seen.has(o.material)) return; const m = o.material; seen.add(m);
      m.roughness = /Tiles/.test(m.name) ? 0.42 : /Plaster/.test(m.name) ? 0.8 : 0.6; m.envMapIntensity = 0.8; m.color.multiplyScalar(/Plaster/.test(m.name) ? 0.62 : 0.8);
      if (/Glass/.test(m.name)) { m.color.set(0x0c1016); m.opacity = 0.75; m.roughness = 0.05; m.metalness = 0.2; m.envMapIntensity = 1.4; m.depthWrite = false; }
      if (/Vine/.test(m.name)) { m.alphaTest = 0.5; m.transparent = false; m.side = THREE.DoubleSide; } });
    this._tpl = tpl; return tpl;
  }
  buildVillage() {
    const tpl = this.kitTemplates();
    this.buckets = new Map(); // material -> [geometry]
    const place = (name, x, y, z, ry = 0, extra = null) => {
      const parts = tpl[name]; if (!parts) { console.warn('missing', name); return; }
      const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
      if (extra) M.multiply(extra);
      for (const p of parts) { const g = p.geo.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(M, p.m)); if (!this.buckets.has(p.mat)) this.buckets.set(p.mat, []); this.buckets.get(p.mat).push(g); }
    };
    this.place = place;
    this.glowWindows = [];
    for (const h of HOUSES) this.buildHouse(h, place);
    this.flushBuckets();
  }
  flushBuckets() {
    for (const [mat, geos] of this.buckets) {
      for (const g of geos) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.index) { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx); } g.morphAttributes = {}; }
      const merged = mergeGeometries(geos, false); if (!merged) { console.warn('merge failed', mat.name); continue; }
      merged.computeBoundingSphere(); const mesh = new THREE.Mesh(merged, mat); mesh.matrixAutoUpdate = false; this.scene.add(mesh);
      geos.forEach(g => g.dispose());
    }
    this.buckets.clear();
  }
  buildHouse(h, place) {
    const ry = FACE[h.face]; const c = Math.cos(ry), s = Math.sin(ry);
    const L = (lx, lz) => [h.x + lx * c + lz * s, h.z - lx * s + lz * c]; // local -> world
    const P = (name, lx, y, lz, lry = 0, extra) => { const [x, z] = L(lx, lz); place(name, x, y, z, ry + lry, extra); };
    const w = h.w, d = h.d; const tower = h.style === 'tower', church = h.style === 'church';
    this.footprints.push({ id: h.id, x: h.x, z: h.z, hw: w, hd: d, rot: ry });
    const brick = h.style === 'brick' || tower || church;
    const wall = brick ? 'Wall_UnevenBrick_Straight' : h.style === 'grid' ? 'Wall_Plaster_WoodGrid' : 'Wall_Plaster_Straight';
    const win = brick ? 'Wall_UnevenBrick_Window_Wide_Round' : 'Wall_Plaster_Window_Wide_Flat';
    const winThin = brick ? 'Wall_UnevenBrick_Window_Thin_Round' : 'Wall_Plaster_Window_Thin_Round';
    const door = brick ? 'Wall_UnevenBrick_Door_Round' : 'Wall_Plaster_Door_Flat';
    const r = rng(h.x * 31 + h.z * 7 + 99);
    const sides = [
      { n: w, pos: i => [-w + 1 + 2 * i, d], rot: 0, key: 'front' },
      { n: w, pos: i => [w - 1 - 2 * i, -d], rot: Math.PI, key: 'back' },
      { n: d, pos: i => [w, d - 1 - 2 * i], rot: Math.PI / 2, key: 'right' },
      { n: d, pos: i => [-w, -d + 1 + 2 * i], rot: -Math.PI / 2, key: 'left' },
    ];
    const doorIdx = Math.floor(w / 2) - (w % 2 === 0 ? 1 : 0);
    for (let f = 0; f < h.floors; f++) {
      const y = f * H;
      for (const sd of sides) for (let i = 0; i < sd.n; i++) {
        const [lx, lz] = sd.pos(i);
        let name = wall, kind = 'wall';
        if (f === 0 && sd.key === 'front' && i === doorIdx) { name = door; kind = 'door'; }
        else if (f === 0 && sd.key === 'back' && h.back && i === sd.n - 1 - doorIdx) { name = door; kind = 'door'; }
        else if (tower) { if (f === h.floors - 1) { name = winThin; kind = 'thin'; } }
        else if (church) { if (f === 0 && sd.key !== 'front' && sd.key !== 'back' && i % 2 === 0) { name = winThin; kind = 'thin'; } }
        else if ((i + f + (sd.key === 'left' ? 1 : 0)) % 2 === 0 || (sd.key === 'front' && f === 1)) { name = r() < 0.65 ? win : winThin; kind = name === win ? 'wide' : 'thin'; }
        P(name, lx, y, lz, sd.rot);
        if (kind === 'wide') {
          P('Window_Wide_Flat1', lx, y, lz, sd.rot);
          if (!h.lit) { if (r() < 0.75) P('WindowShutters_Wide_Flat_Closed', lx, y, lz, sd.rot); else P('WindowShutters_Wide_Flat_Open', lx, y, lz, sd.rot); }
          else this.glowWindows.push({ wx: L(lx, lz), ry: ry + sd.rot, y: y + 1.72, wide: true });
        } else if (kind === 'thin' && !tower) {
          P('Window_Thin_Round1', lx, y, lz, sd.rot);
          if (!h.lit && r() < 0.6) P('WindowShutters_Thin_Round_Closed', lx, y, lz, sd.rot);
          if (h.lit) this.glowWindows.push({ wx: L(lx, lz), ry: ry + sd.rot, y: y + 1.75, wide: false });
        }
        if (kind === 'door') {
          const open = h.open || tower;
          if (!open) P(brick ? 'Door_2_Round' : 'Door_1_Flat', lx - 0.55 * (sd.rot === 0 ? 1 : -1), y, lz, sd.rot);
          else if (!tower) { const ex = new THREE.Matrix4().makeRotationY(-1.25); P(brick ? 'Door_2_Round' : 'Door_1_Flat', lx - 0.55 * (sd.rot === 0 ? 1 : -1), y, lz + (sd.rot === 0 ? 0 : 0), sd.rot, ex); }
        }
      }
      for (const [cx, cz] of [[w, d], [-w, d], [w, -d], [-w, -d]]) P(brick ? 'Corner_Exterior_Brick' : 'Corner_Exterior_Wood', cx, y, cz, 0);
    }
    const top = h.floors * H;
    if (tower) {
      place('Roof_Tower_RoundTiles', h.x, top, h.z, 0);
      // floor of belfry so it doesn't look hollow from below
    } else {
      const key = `${2 * w}x${2 * d}`;
      P('Roof_RoundTiles_' + key, 0, top, 0, 0);
      P('Roof_Front_Brick' + 2 * w, 0, top, d, Math.PI); P('Roof_Front_Brick' + 2 * w, 0, top, -d, 0);
      if (!church && r() < 0.7) P(r() < 0.5 ? 'Prop_Chimney' : 'Prop_Chimney2', w * 0.45, top + 0.6 + w * 0.3, -d * 0.35, 0);
    }
    if (h.interior) {
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) { P('Floor_WoodDark', -w + 1 + 2 * i, 0.03, -d + 1 + 2 * j); P('Floor_WoodDark', -w + 1 + 2 * i, H - 0.02, -d + 1 + 2 * j, 0, new THREE.Matrix4().makeRotationX(Math.PI)); }
    }
    if (!tower && !church && r() < 0.6) P('Prop_Vine' + (r() < 0.5 ? '1' : '4'), -w + 0.6, H - 0.2, d + 0.12, 0);
    // colliders: wall segments around footprint with door gaps where doors are open
    const corners = [[-w, d], [w, d], [w, -d], [-w, -d]].map(([a, b]) => L(a, b));
    const wallTop = top + (tower ? 6 : 2.5);
    const addSeg = (a, b) => this.segs.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], top: wallTop, house: h.id });
    const gapSide = (A, B, gapAt) => { // gapAt: local offset along side from A (m) or null
      if (gapAt == null) return addSeg(A, B);
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]); const ux = (B[0] - A[0]) / len, uz = (B[1] - A[1]) / len;
      addSeg(A, [A[0] + ux * (gapAt - 0.6), A[1] + uz * (gapAt - 0.6)]); addSeg([A[0] + ux * (gapAt + 0.6), A[1] + uz * (gapAt + 0.6)], B);
    };
    const frontGap = (h.open) ? doorIdx * 2 + 1 : null;
    const backGap = (h.back && h.open) ? (w - 1 - doorIdx) * 2 + 1 : null;
    gapSide(corners[0], corners[1], frontGap); gapSide(corners[1], corners[2], null); gapSide(corners[2], corners[3], backGap); gapSide(corners[3], corners[0], null);
    if (h.id === 'HQ') { this.hqDoor = L(-0.0 + (doorIdx * 2 + 1 - w), d + 1.2); this.hqBack = L(-w + 1 + 2 * doorIdx, -d - 1.2); this.hqL = L; }
    if (tower) this.towerDoor = L(-w + 1 + 2 * doorIdx, d + 1.5);
  }

  buildProps() {
    const tpl = this.kitTemplates(); const place = this.place;
    const woodMat = tpl['Prop_Crate'][0].mat;
    const r = rng(42);
    // crates, wagon, fences (also cover)
    const crate = (x, z, rot = 0, stack = false) => { place('Prop_Crate', x, 0, z, rot); this.circles.push({ x, z, r: 0.75 }); if (stack) place('Prop_Crate', x + 0.1, 1.06, z - 0.05, rot + 0.3); };
    [[-9.5, -4, 0.2, true], [-10.6, -3.2, 0.5], [11, -14, 0.1], [9.2, -27, 0.4, true], [-10, -27, 0.3], [-25.5, -33, 0], [-25.5, -35.2, 0.4, true], [6.5, 8, 0.3], [-6, -40, 0.2, true], [24.5, -27.5, 0], [26, -16, 0.3, true]].forEach(a => crate(...a));
    place('Prop_Wagon', -7.5, 0, -18.5, 0.9); this.segs.push({ ax: -9.1, az: -17.2, bx: -5.9, bz: -19.8, top: 1.5 }); this.circles.push({ x: -8.3, z: -17.9, r: 1.0 }, { x: -6.6, z: -19.4, r: 1.0 });
    const fenceRow = (x0, z0, x1, z1) => { const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 2.06); const rot = Math.atan2(-(z1 - z0), x1 - x0); for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; if (r() < 0.12) continue; place(i % 3 ? 'Prop_WoodenFence_Extension1' : 'Prop_WoodenFence_Single', lerp(x0, x1, t), this.heightAt(lerp(x0, x1, t), lerp(z0, z1, t)), lerp(z0, z1, t), rot); } this.segs.push({ ax: x0, az: z0, bx: x1, bz: z1, top: 0.8, low: true }); };
    fenceRow(-22, 1, -22, -14); fenceRow(-22, -16, -22, -30); fenceRow(24, 6, 24, -8); fenceRow(-20, 18, -6, 18); fenceRow(18, 18, 6, 18); fenceRow(-36, -28, -36, -40); fenceRow(26, -44, 38, -44);
    this.flushBuckets();

    // --- well (procedural, kit textures) ---
    const rockMat = tpl['Corner_Exterior_Brick'][0].mat;
    const well = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.9, 20, 1, true), rockMat); ring.position.y = 0.45; well.add(ring);
    const ringIn = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.9, 20, 1, true), rockMat); ringIn.material = rockMat; ringIn.position.y = 0.45; ringIn.scale.set(-1, 1, 1); well.add(ringIn);
    const cap = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.25, 20), rockMat); cap.rotation.x = -Math.PI / 2; cap.position.y = 0.9; well.add(cap);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.95, 20), new THREE.MeshStandardMaterial({ color: 0x05080a, roughness: 0.05, metalness: 0.3 })); water.rotation.x = -Math.PI / 2; water.position.y = 0.2; well.add(water);
    for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.3, 0.16), woodMat); post.position.set(sx * 1.1, 1.15, 0); well.add(post); }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), woodMat); beam.rotation.z = Math.PI / 2; beam.position.y = 2.0; well.add(beam);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 0.9, 4, 1, true), tpl['Roof_RoundTiles_4x4'].find(p => /Tiles/.test(p.mat.name)).mat); roof.position.y = 2.65; roof.rotation.y = Math.PI / 4; well.add(roof);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.28, 10), woodMat); bucket.position.set(0.2, 1.2, 0); well.add(bucket);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.75, 4), new THREE.MeshStandardMaterial({ color: 0x3a3226 })); rope.position.set(0.2, 1.67, 0); well.add(rope);
    well.position.set(SQUARE.x, 0, SQUARE.y - 1); this.scene.add(well); this.circles.push({ x: SQUARE.x, z: SQUARE.y - 1, r: 1.45 });

    // --- notice board (clue B) ---
    const board = new THREE.Group();
    for (const sx of [-0.85, 0.85]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.1, 0.12), woodMat); p.position.set(sx, 1.05, 0); board.add(p); }
    const pl = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.06), woodMat); pl.position.y = 1.5; board.add(pl);
    const rf = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.5), woodMat); rf.position.set(0, 2.12, 0.1); rf.rotation.x = 0.25; board.add(rf);
    const paper = (w, h, x, y, rot, tex) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, color: 0x9a9384, roughness: 0.9 })); m.position.set(x, y, 0.035); m.rotation.z = rot; board.add(m); return m; };
    paper(0.62, 0.82, -0.32, 1.5, 0.02, this.paperTex('撤离令', true)); paper(0.5, 0.36, 0.42, 1.7, -0.06, this.paperTex('寻人', false)); paper(0.46, 0.3, 0.45, 1.25, 0.08, this.paperTex('', false));
    board.position.set(6.2, 0, -9.2); board.rotation.y = -0.35; this.scene.add(board); this.circles.push({ x: 6.2, z: -9.2, r: 0.6 });
    this.boardPos = new THREE.Vector3(6.2, 1.5, -9.2).add(new THREE.Vector3(Math.sin(-0.35), 0, Math.cos(-0.35)).multiplyScalar(0.4));

    // --- HQ interior: table, chair, papers, map on wall ---
    const L = this.hqL; const hqRot = FACE.W;
    const table = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 1.1), woodMat); top.position.y = 0.82; table.add(top);
    for (const [x, z] of [[-0.9, -0.45], [0.9, -0.45], [-0.9, 0.45], [0.9, 0.45]]) { const lg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.82, 0.08), woodMat); lg.position.set(x, 0.41, z); table.add(lg); }
    const docs = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.4), new THREE.MeshStandardMaterial({ map: this.paperTex('作战命令', true), roughness: 0.9, color: 0xb0a890 })); docs.rotation.x = -Math.PI / 2; docs.rotation.z = 0.2; docs.position.set(0.25, 0.87, 0.05); table.add(docs);
    const map = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ map: this.mapTex(), roughness: 0.9, color: 0xa09a88 })); map.rotation.x = -Math.PI / 2; map.rotation.z = -0.1; map.position.set(-0.45, 0.865, -0.05); table.add(map);
    const lamp = new THREE.Group(); const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 10), new THREE.MeshBasicMaterial({ color: 0xffc070 })); glass.position.y = 0.12; lamp.add(glass);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 10), new THREE.MeshStandardMaterial({ color: 0x3a3020, metalness: 0.6, roughness: 0.4 })); lamp.add(base); lamp.position.set(-0.75, 0.86, 0.35); table.add(lamp);
    const chair = new THREE.Group(); const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), woodMat); seat.position.y = 0.48; chair.add(seat); const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.06), woodMat); back.position.set(0, 0.8, -0.22); chair.add(back);
    for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) { const lg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 0.05), woodMat); lg.position.set(x, 0.24, z); chair.add(lg); }
    chair.position.set(0.3, 0, -0.85); chair.rotation.y = 0.3; table.add(chair);
    const [tx, tz] = L(0.6, -0.4); table.position.set(tx, 0.03, tz); table.rotation.y = hqRot; this.scene.add(table); this.circles.push({ x: tx, z: tz, r: 1.05 });
    this.docsPos = new THREE.Vector3(); docs.getWorldPosition(this.docsPos); table.updateMatrixWorld(true); docs.getWorldPosition(this.docsPos);
    const lampW = new THREE.Vector3(); glass.getWorldPosition(lampW);
    this.addLamp(lampW, 0xffa860, 7, 7, false, 0.9);
    // shelves / crates inside
    const [sx, sz] = L(-2.6, -3.0); place('Prop_Crate', sx, 0.03, sz, 0.2); this.circles.push({ x: sx, z: sz, r: 0.7 }); this.flushBuckets();

    // --- lit window glows (HQ only) ---
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.85 });
    for (const gw of this.glowWindows) { const m = new THREE.Mesh(new THREE.PlaneGeometry(gw.wide ? 1.35 : 0.6, gw.wide ? 1.3 : 1.2), glowMat); const off = new THREE.Vector3(Math.sin(gw.ry), 0, Math.cos(gw.ry)).multiplyScalar(-0.22); m.position.set(gw.wx[0] + off.x, gw.y, gw.wx[1] + off.z); m.rotation.y = gw.ry; this.scene.add(m); }

    // --- lantern posts ---
    const lanternPost = (x, z, wall = null) => {
      const g = new THREE.Group(); const y0 = this.heightAt(x, z);
      if (!wall) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), woodMat); p.position.y = 1.3; g.add(p); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), woodMat); arm.position.set(0.25, 2.5, 0); g.add(arm); }
      const lan = this.lanternMesh(); lan.position.set(wall ? 0 : 0.5, wall ? 2.3 : 2.2, 0); g.add(lan);
      g.position.set(x, y0, z); if (wall) g.rotation.y = wall; this.scene.add(g); if (!wall) this.circles.push({ x, z, r: 0.25 });
      const wp = new THREE.Vector3(); lan.getWorldPosition(wp); g.updateMatrixWorld(true); lan.getWorldPosition(wp); this.addLamp(wp, 0xffa04a, 10, 3.2, true);
    };
    lanternPost(-4.5, -5.5); lanternPost(3.2, 21.5);
    { const [lx, lz] = L(0.75, 4.3); lanternPost(lx, lz, FACE.W); }
    lanternPost(3.4, -53.4);

    // --- fallen soldier placeholder location (model added by enemies module) ---
    this.bodyPos = new THREE.Vector3(-44, this.heightAt(-44, 23.4), 23.4);
    // optional: child's shoe by the well
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.2), new THREE.MeshStandardMaterial({ color: 0x5a2a1c, roughness: 0.6 })); shoe.position.set(-1.6, 0.04, -14.2); shoe.rotation.y = 0.7; this.scene.add(shoe); this.shoePos = shoe.position.clone();
    // optional: diary on crate at barn F
    const diary = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.3), new THREE.MeshStandardMaterial({ color: 0x3b2b1e, roughness: 0.8 })); diary.position.set(-25.5, 1.08, -33); diary.rotation.y = 0.4; this.scene.add(diary); this.diaryPos = diary.position.clone();

    // --- ending figure (hidden) ---
    this.figure = this.makeFigure(); this.figure.visible = false; this.scene.add(this.figure);
    const [fx, fz] = [this.towerDoor[0], this.towerDoor[1] - 1.9]; this.figure.position.set(fx, 0, fz);

    // bell in the belfry
    const bell = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.9], [0.25, 0.85], [0.33, 0.6], [0.38, 0.3], [0.52, 0.02], [0.55, 0]].map(([a, b]) => new THREE.Vector2(a, b)), 16), new THREE.MeshStandardMaterial({ color: 0x6b5232, metalness: 0.9, roughness: 0.35 }));
    bell.position.set(0, 3 * H + 1.0, -57); this.scene.add(bell); this.bell = bell;
  }
  lanternMesh() {
    const g = new THREE.Group();
    const frame = new THREE.MeshStandardMaterial({ color: 0x1c1a17, metalness: 0.7, roughness: 0.5 });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), new THREE.MeshBasicMaterial({ color: 0xffb060 })); g.add(glass);
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.12, 4), frame); t.position.y = 0.17; t.rotation.y = Math.PI / 4; g.add(t);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.2), frame); b.position.y = -0.13; g.add(b);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.blobTex, color: 0xffa050, transparent: true, opacity: 0.55, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(1.6); g.add(glow); g.userData.glow = glow;
    return g;
  }
  addLamp(pos, color, range, intensity, flicker = true, glowScale = 0) {
    const l = new THREE.PointLight(color, intensity, range, 1.6); l.position.copy(pos); this.scene.add(l);
    this.lamps.push({ pos: pos.clone(), light: l, base: intensity, range, flicker, ph: Math.random() * 10 });
    return l;
  }
  paperTex(title, big) {
    const c = document.createElement('canvas'); c.width = 256; c.height = big ? 340 : 200; const x = c.getContext('2d');
    x.fillStyle = '#d8cfb8'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(90,70,40,${Math.random() * 0.08})`; x.fillRect(Math.random() * 256, Math.random() * c.height, 3 + Math.random() * 20, 2 + Math.random() * 10); }
    x.fillStyle = '#2a241c'; x.font = 'bold 28px serif'; x.textAlign = 'center'; if (title) x.fillText(title, 128, 44);
    x.fillStyle = 'rgba(40,32,24,0.75)'; for (let i = 0; i < (big ? 12 : 6); i++) { const w = 150 + Math.random() * 60; x.fillRect(128 - w / 2, 70 + i * 20, w, 5); }
    if (big) { x.strokeStyle = 'rgba(120,20,20,0.7)'; x.lineWidth = 3; x.beginPath(); x.arc(190, c.height - 50, 26, 0, 7); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  mapTex() {
    const c = document.createElement('canvas'); c.width = 384; c.height = 256; const x = c.getContext('2d');
    x.fillStyle = '#cfc4a6'; x.fillRect(0, 0, 384, 256);
    x.strokeStyle = '#6b8aa0'; x.lineWidth = 6; x.beginPath(); x.moveTo(0, 40); x.bezierCurveTo(120, 80, 200, 20, 384, 70); x.stroke();
    x.strokeStyle = '#6a5a40'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, 190); x.bezierCurveTo(120, 170, 260, 210, 384, 180); x.moveTo(192, 190); x.lineTo(192, 80); x.stroke();
    x.fillStyle = '#5a4a36'; for (let i = 0; i < 9; i++) x.fillRect(150 + Math.random() * 90, 100 + Math.random() * 70, 10, 8);
    x.strokeStyle = '#8a1a14'; x.lineWidth = 3; x.beginPath(); x.arc(192, 82, 12, 0, 7); x.stroke(); x.beginPath(); x.moveTo(40, 120); x.lineTo(180, 86); x.moveTo(340, 125); x.lineTo(204, 86); x.stroke();
    x.fillStyle = '#2a1a10'; x.font = '14px serif'; x.fillText('埃尔姆塔尔', 210, 140); x.fillText('05:00', 205, 78);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  makeFigure() {
    const g = new THREE.Group(); const m = new THREE.MeshBasicMaterial({ color: 0x020203, fog: true });
    const add = (geo, x, y, z, rx = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); g.add(o); return o; };
    add(new THREE.CapsuleGeometry(0.2, 0.9, 4, 8), 0, 1.75, -0.1, 0.35);
    add(new THREE.SphereGeometry(0.16, 10, 8), 0, 2.4, 0.15).scale.set(0.9, 1.25, 1);
    add(new THREE.CapsuleGeometry(0.05, 1.3, 4, 6), -0.33, 1.25, 0.12, 0.1, 0.12);
    add(new THREE.CapsuleGeometry(0.05, 1.4, 4, 6), 0.34, 1.2, 0.18, 0.25, -0.1);
    add(new THREE.CapsuleGeometry(0.07, 1.0, 4, 6), -0.13, 0.55, 0, 0, 0.05);
    add(new THREE.CapsuleGeometry(0.07, 1.0, 4, 6), 0.14, 0.55, 0.05, -0.1, -0.05);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x9fb6c0, fog: false }); for (const sx of [-0.05, 0.05]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), eyeM); e.position.set(sx, 2.43, 0.28); g.add(e); }
    return g;
  }

  // ---------- forest ----------
  buildForest() {
    const root = this.assets.nature.scene; root.updateMatrixWorld(true);
    const fix = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const types = {};
    for (const holder of root.children) { const parts = []; const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert(); holder.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, m: new THREE.Matrix4().multiplyMatrices(fix, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)) }); }); types[holder.name] = parts; }
    root.traverse(o => { if (o.isMesh) { const m = o.material; m.color.multiplyScalar(/Leaves/.test(m.name) ? 0.5 : 0.6); m.roughness = 0.75; m.envMapIntensity = 0.5; if (m.alphaTest > 0 || m.alphaTest === undefined) { } if (/Leaves|Flowers/.test(m.name)) { m.alphaTest = 0.5; m.transparent = false; m.side = THREE.DoubleSide; } } });
    const lists = {}; const add = (t, x, z, s, ry, y = null) => { (lists[t] ||= []).push({ x, y: y ?? this.heightAt(x, z) - 0.05, z, s, ry }); };
    const r = rng(2024);
    const blocked = (x, z, pad) => {
      if (Math.abs(z - roadZ(x)) < 5.5 + pad) return true;
      if (Math.abs(x) < 4 + pad && z < 32 && z > -56) return true;
      if (this.inAnyFootprint(x, z, 3 + pad)) return true;
      if (Math.hypot(x - SQUARE.x, z - SQUARE.y) < 13 + pad) return true;
      return false;
    };
    const inVillage = (x, z) => (x / 46) ** 2 + ((z + 18) / 44) ** 2 < 1;
    const pines = ['PineTree_1', 'PineTree_2', 'PineTree_4', 'PineTree_3', 'PineTree_5'], broad = ['NormalTree_5'], dead = ['DeadTree_1', 'DeadTree_3', 'DeadTree_6', 'DeadTree_9'];
    const nTrees = this.q.low ? 460 : 640;
    let placed = 0, tries = 0;
    while (placed < nTrees && tries < 20000) {
      tries++; const x = (r() - 0.5) * 250, z = (r() - 0.5) * 250;
      if (blocked(x, z, 0) || (inVillage(x, z) && r() < 0.93)) continue;
      const dens = fbm(x * 0.03 + 11, z * 0.03); if (dens < 0.38 && r() < 0.7) continue;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 3.2 || this.inViewCorridor(x, z)) continue;
      const k = r(); const t = k < 0.62 ? pines[Math.floor(r() * pines.length)] : k < 0.88 ? broad[Math.floor(r() * broad.length)] : dead[Math.floor(r() * dead.length)];
      const s = t.startsWith('Pine') ? 2.2 + r() * 1.6 : t.startsWith('Normal') ? 1.6 + r() * 0.9 : 1.4 + r() * 0.7;
      add(t, x, z, s, r() * 6.28); this.circles.push({ x, z, r: t.startsWith('Pine') ? 0.28 * s * 0.6 : 0.3 * s * 0.5, tree: true }); placed++;
    }
    // hand-placed trees around the wake-up spot & village edges for framing
    [[0.5, 55.5, 'PineTree_1', 3.3], [8.5, 56, 'PineTree_4', 3.6], [3.2, 58.5, 'NormalTree_2', 2.2], [10.5, 50.5, 'PineTree_2', 3], [-2.6, 51.5, 'DeadTree_1', 1.8], [11.5, 45, 'PineTree_5', 3.2], [-6, 44, 'PineTree_4', 3.1], [-26, -46, 'DeadTree_3', 1.8], [22, -50, 'DeadTree_6', 1.9], [-8, -52, 'NormalTree_5', 1.9], [10, -46, 'PineTree_3', 3]].forEach(([x, z, t, s]) => { add(t, x, z, s, r() * 6); this.circles.push({ x, z, r: 0.3 }); });
    // bushes (concealment)
    const nB = this.q.low ? 260 : 380; placed = 0; tries = 0;
    const bushHere = (x, z, s) => { const t = ['Bush', 'Bush_Large', 'Bush_Small'][Math.floor(r() * 3)]; add(t, x, z, s, r() * 6.28); this.bushes.push({ x, z, r: (t === 'Bush_Large' ? 1.0 : t === 'Bush' ? 0.6 : 0.45) * s + 0.25 }); };
    while (placed < nB && tries < 9000) { tries++; const x = (r() - 0.5) * 220, z = (r() - 0.5) * 220; if (blocked(x, z, -1.5) || this.inViewCorridor(x, z) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 3) continue; bushHere(x, z, 1.3 + r() * 1.1); placed++; }
    // stealth bushes inside the village
    [[-22.5, -10, 1.8], [-23, -18, 1.6], [-12, -31, 1.8], [11, -31, 1.9], [24.5, -24, 1.7], [9, -1.5, 1.6], [-8.5, 3, 1.7], [-31, -27, 1.8], [-38, 16, 2], [-48, 19.5, 2], [-41, 20, 1.6], [-6.5, -46, 1.9], [7, -42, 1.8], [-14, -44, 2], [28, -10, 1.8], [-3.5, 26.5, 1.9], [7.5, 26.2, 1.8], [-20, 24, 2], [16, 22, 2]].forEach(([x, z, s]) => bushHere(x, z, s));
    // rocks & grass & plants
    for (let i = 0; i < 90; i++) { const x = (r() - 0.5) * 230, z = (r() - 0.5) * 230; if (blocked(x, z, -2) || this.inViewCorridor(x, z) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 4) continue; add(['Rock_1', 'Rock_3', 'Rock_5'][i % 3], x, z, 1 + r() * 1.8, r() * 6); }
    const nG = this.q.low ? 900 : 1600;
    for (let i = 0; i < nG; i++) { const x = (r() - 0.5) * 200, z = (r() - 0.5) * 200; if (Math.abs(z - roadZ(x)) < 2.2 || (Math.abs(x) < 2.6 && z < 30 && z > -56) || Math.hypot(x, z + 12) < 10) continue; if (this.inAnyFootprint(x, z, 0.6) || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 2.5) continue; add(i % 9 === 0 ? 'Plant_1' : i % 2 ? 'Grass_Large' : 'Grass_Small', x, z, 1.4 + r() * 1.2, r() * 6, this.heightAt(x, z) - 0.02); }
    // spawn clearing grass
    for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = 2.6 + r() * 4; add('Grass_Large', SPAWN.x + Math.cos(a) * d, SPAWN.z + Math.sin(a) * d, 1.2 + r() * 0.8, r() * 6); }

    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    this.windMats = []; this.cells = []; const CS = 40;
    for (const [t, list] of Object.entries(lists)) {
      const byCell = new Map(); for (const it of list) { const k = Math.floor(it.x / CS) + ',' + Math.floor(it.z / CS); if (!byCell.has(k)) byCell.set(k, []); byCell.get(k).push(it); }
      for (const part of types[t] || []) {
        const geo = part.geo.clone(); geo.applyMatrix4(part.m);
        if (/Leaves|Grass|Bush/.test(part.mat.name) && !part.mat.userData.wind) this.addWind(part.mat);
        for (const [k, items] of byCell) {
          const im = new THREE.InstancedMesh(geo, part.mat, items.length);
          items.forEach((it, i) => { Q.setFromAxisAngle(Y, it.ry); S.setScalar(it.s); Pv.set(it.x, it.y, it.z); M.compose(Pv, Q, S); im.setMatrixAt(i, M); });
          im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); this.scene.add(im);
          const [cx, cz] = k.split(',').map(Number); const small = /Grass|Plant|Rock/.test(t);
          this.cells.push({ mesh: im, x: (cx + 0.5) * CS, z: (cz + 0.5) * CS, far: small ? 45 : 95 });
        }
      }
    }
    // the fallen soldier ditch: some extra grass
  }
  addWind(mat) {
    mat.userData.wind = true; const u = { value: 0 }; this.windMats.push(u);
    mat.onBeforeCompile = sh => { sh.uniforms.uWindT = u; sh.vertexShader = 'uniform float uWindT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.);
      #endif
      float hgt = max(position.y, 0.0); float sw = sin(uWindT*1.7 + ip.x*0.35 + ip.z*0.21)*0.5 + sin(uWindT*3.1 + ip.z*0.5)*0.25;
      transformed.x += sw * 0.035 * hgt; transformed.z += sw * 0.02 * hgt;`); };
    mat.needsUpdate = true;
  }

  // ---------- rain ----------
  buildRain() {
    const N = this.q.low ? 2600 : 5200; const pos = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { const x = Math.random(), y = Math.random(), z = Math.random(), s = Math.random(); for (let k = 0; k < 2; k++) { const j = i * 2 + k; pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z; end[j] = k; seed[j] = s; } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.rainU = { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(36, 22, 36) }, uFlash: { value: 0 }, uAlpha: { value: 1 } };
    const m = new THREE.ShaderMaterial({ uniforms: this.rainU, transparent: true, depthWrite: false, fog: false,
      vertexShader: `uniform float uT; uniform vec3 uCam; uniform vec3 uBox; attribute float aEnd; attribute float aSeed; varying float vA;
        void main(){ vec3 v = vec3(-1.6, -15.0 - aSeed*6.0, -0.9);
          vec3 p = position*uBox + v*uT; p -= uCam; p = mod(p, uBox) - uBox*0.5; p += uCam;
          p += v * 0.038 * aEnd;
          vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          float d = -mv.z; vA = smoothstep(1.2, 4.0, d) * (1.0 - smoothstep(10.0, 18.0, d)) * (0.3 + aSeed*0.35) * (aEnd*0.7+0.3); }`,
      fragmentShader: `uniform float uFlash; uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.6,0.66,0.76)+uFlash*0.6, vA*(0.3+uFlash*0.5)*uAlpha); }` });
    this.rain = new THREE.LineSegments(g, m); this.rain.frustumCulled = false; this.scene.add(this.rain);
  }
  buildMist() {
    this.mist = []; const mat = new THREE.SpriteMaterial({ map: this.mistTex, color: 0x8796a8, transparent: true, opacity: 0.22, depthWrite: false });
    const n = this.q.low ? 10 : 18;
    for (let i = 0; i < n; i++) { const s = new THREE.Sprite(mat); s.scale.set(16, 5, 1); s.userData.o = new THREE.Vector3((Math.random() - 0.5) * 50, 0, (Math.random() - 0.5) * 50); s.userData.v = 0.2 + Math.random() * 0.3; this.scene.add(s); this.mist.push(s); }
  }

  // ---------- navigation graph (for enemies) ----------
  buildNav() {
    const nodes = []; const pad = 1.4;
    for (let x = -46; x <= 46; x += 4) for (let z = -54; z <= 34; z += 4) {
      let ok = true; for (const f of this.footprints) { const c = Math.cos(-f.rot), s = Math.sin(-f.rot); const lx = (x - f.x) * c - (z - f.z) * s, lz = (x - f.x) * s + (z - f.z) * c; if (Math.abs(lx) < f.hw + pad && Math.abs(lz) < f.hd + pad) ok = false; }
      if (ok) for (const c of this.circles) if (!c.tree && Math.hypot(x - c.x, z - c.z) < c.r + 0.6) ok = false;
      if (ok) nodes.push({ x, z, n: [] });
    }
    // HQ interior + doors
    const L = this.hqL; [[0, 1.8], [0, -2.2], [-2.2, 0], [-1, 5.5], [1, -5.5]].forEach(([a, b]) => { const [x, z] = L(a, b); nodes.push({ x, z, n: [] }); });
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) { const a = nodes[i], b = nodes[j]; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < 6.2 && this.clearPath(a.x, a.z, b.x, b.z, 0.45)) { a.n.push(j); b.n.push(i); } }
    this.nav = nodes;
  }
  clearPath(ax, az, bx, bz, w = 0) {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w, nz = dx / l * w;
    for (const s of this.segs) { if (segIntersect(ax, az, bx, bz, s.ax, s.az, s.bx, s.bz)) return false; if (w && (segIntersect(ax + nx, az + nz, bx + nx, bz + nz, s.ax, s.az, s.bx, s.bz) || segIntersect(ax - nx, az - nz, bx - nx, bz - nz, s.ax, s.az, s.bx, s.bz))) return false; }
    if (w) for (const c of this.circles) { if (c.tree) continue; const [px, pz] = closestOnSeg(c.x, c.z, ax, az, bx, bz); if (Math.hypot(px - c.x, pz - c.z) < c.r + w * 0.5) return false; }
    return true;
  }
  sightClear(ax, az, ay, bx, bz, by) { // walls block sight unless low (fences) and both ends above them
    for (const s of this.segs) { if (s.low && ay > 1.0 && by > 1.0) continue; if (segIntersect(ax, az, bx, bz, s.ax, s.az, s.bx, s.bz)) return false; }
    return true;
  }
  nearestNode(x, z) {
    const N = this.nav; const order = N.map((n, i) => [(n.x - x) ** 2 + (n.z - z) ** 2, i]).sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < Math.min(12, order.length); k++) { const i = order[k][1]; if (this.clearPath(x, z, N[i].x, N[i].z)) return i; }
    return order.length ? order[0][1] : -1;
  }
  findPath(sx, sz, tx, tz) {
    if (this.clearPath(sx, sz, tx, tz, 0.4)) return [{ x: tx, z: tz }];
    const a = this.nearestNode(sx, sz), b = this.nearestNode(tx, tz); if (a < 0 || b < 0) return [{ x: tx, z: tz }];
    const N = this.nav, g = new Map([[a, 0]]), came = new Map(), open = new Set([a]); const hf = i => Math.hypot(N[i].x - N[b].x, N[i].z - N[b].z);
    let iter = 0;
    while (open.size && iter++ < 4000) {
      let cur = -1, bf = 1e9; for (const i of open) { const f = g.get(i) + hf(i); if (f < bf) { bf = f; cur = i; } }
      if (cur === b) break; open.delete(cur);
      for (const j of N[cur].n) { const ng = g.get(cur) + Math.hypot(N[cur].x - N[j].x, N[cur].z - N[j].z); if (ng < (g.get(j) ?? 1e9)) { g.set(j, ng); came.set(j, cur); open.add(j); } }
    }
    const path = [{ x: tx, z: tz }]; let c = b; if (!came.has(b) && a !== b) return [{ x: N[b].x, z: N[b].z }, { x: tx, z: tz }];
    while (c !== undefined && c !== a) { path.unshift({ x: N[c].x, z: N[c].z }); c = came.get(c); }
    path.unshift({ x: N[a].x, z: N[a].z });
    // string-pull
    const out = []; let i = 0; let px = sx, pz = sz; while (i < path.length) { let j = path.length - 1; while (j > i && !this.clearPath(px, pz, path[j].x, path[j].z, 0.35)) j--; out.push(path[j]); px = path[j].x; pz = path[j].z; i = j + 1; }
    return out;
  }

  // ---------- queries ----------
  collide(pos, radius) { // push a circle (pos.x,pos.z) out of colliders
    for (let it = 0; it < 2; it++) {
      for (const s of this.segs) { const [cx, cz] = closestOnSeg(pos.x, pos.z, s.ax, s.az, s.bx, s.bz); const dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz), R = radius + 0.18; if (d < R && d > 1e-5) { pos.x = cx + dx / d * R; pos.z = cz + dz / d * R; } }
      for (const c of this.circles) { const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), R = radius + c.r; if (d < R && d > 1e-5) { pos.x = c.x + dx / d * R; pos.z = c.z + dz / d * R; } }
    }
    const B = 118; pos.x = clamp(pos.x, -B, B); pos.z = clamp(pos.z, -B, B);
  }
  lightAt(x, y, z) {
    let l = 0; for (const lp of this.lamps) { if (!lp.light.visible) continue; const d = Math.hypot(lp.pos.x - x, lp.pos.y - y, lp.pos.z - z); if (d < lp.range) l += (1 - d / lp.range) ** 2 * lp.base / 3; }
    return clamp(l + this.flash * 0.8, 0, 1.5);
  }
  bushAt(x, z) { for (const b of this.bushes) if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r) return true; return false; }
  rayWall(ox, oz, oy, dx, dz, dy, maxD) { // returns distance to first wall hit along ray
    let best = maxD; const ex = ox + dx * maxD, ez = oz + dz * maxD;
    for (const s of this.segs) {
      const r1x = ex - ox, r1z = ez - oz, r2x = s.bx - s.ax, r2z = s.bz - s.az; const den = r1x * r2z - r1z * r2x; if (Math.abs(den) < 1e-9) continue;
      const t = ((s.ax - ox) * r2z - (s.az - oz) * r2x) / den, u = ((s.ax - ox) * r1z - (s.az - oz) * r1x) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) { const d = t * maxD; const y = oy + dy * d; if (y < s.top && y > -1 && d < best) best = d; }
    }
    return best;
  }

  triggerLightning(strength = 1) { this.boltQueue = [[0, 1 * strength], [0.09, 0.2], [0.16, 0.85 * strength], [0.32, 0.0], [0.45, 0.6 * strength], [0.7, 0]]; this.boltT = 0; this.onBolt?.(strength); }

  update(dt, camera) {
    this.time += dt;
    this.rainU.uT.value = this.time; this.rainU.uCam.value.copy(camera.position);
    this.skyMat.uniforms.time.value = this.time;
    for (const u of this.windMats || []) u.value = this.time;
    if (this.cells) for (const c of this.cells) c.mesh.visible = Math.hypot(c.x - camera.position.x, c.z - camera.position.z) < c.far;
    // lightning
    this.nextBolt -= dt; if (this.nextBolt <= 0 && this.autoLightning !== false) { this.nextBolt = 14 + Math.random() * 22; this.triggerLightning(0.6 + Math.random() * 0.6); }
    if (this.boltQueue.length) { this.boltT += dt; while (this.boltQueue.length && this.boltQueue[0][0] <= this.boltT) { this.flash = this.boltQueue.shift()[1]; } } else this.flash = Math.max(0, this.flash - dt * 3);
    const f = this.flash; this.skyMat.uniforms.flash.value = f; this.rainU.uFlash.value = f;
    this.hemi.intensity = 1.05 + f * 3.2; this.moon.intensity = 0.42 + f * 3.5;
    this.scene.fog.density = 0.034 - f * 0.012;
    // lamps flicker
    for (const l of this.lamps) if (l.flicker) { l.ph += dt * (8 + Math.random() * 6); l.light.intensity = l.base * (0.85 + Math.sin(l.ph) * 0.06 + (Math.random() < 0.02 ? -0.25 : 0)); }
    // mist follows the camera loosely
    for (const s of this.mist) { const o = s.userData.o; o.x += s.userData.v * dt; if (o.x > 25) o.x -= 50; const px = Math.round(camera.position.x / 50) * 50 + o.x, pz = Math.round(camera.position.z / 50) * 50 + o.z; s.position.set(px, this.heightAt(px, pz) + 1.1, pz); }
  }
}
