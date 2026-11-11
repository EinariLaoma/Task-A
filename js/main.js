import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { World, roadZ, SPAWN } from './world.js';
import { Enemies } from './enemies.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { clamp, lerp, smooth, angleDiff } from './util.js';
import { CHAPTERS, PREMISE, INTRO, OBJ, DOCS, ENDING } from './story.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'raintown.v1';
const save = (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } })();
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} };
save.settings ||= { sens: 1, q: 'auto', vol: 0.9 };
const isTouch = Input.touch; if (isTouch) document.body.classList.add('touch');
const URLP = new URLSearchParams(location.search);
const qset = URLP.get('q') || (save.settings.q === 'auto' ? (isTouch ? 'low' : 'high') : save.settings.q);
const Q = { low: qset === 'low' };
Input.sens = save.settings.sens;

// ---------- renderer ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.low, powerPreference: 'high-performance' });
renderer.setPixelRatio(URLP.get('dpr') ? +URLP.get('dpr') : Math.min(devicePixelRatio, Q.low ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 420); camera.rotation.order = 'YXZ';
const fx = $('fx'), fctx = fx.getContext('2d');

let world, enemies, player;
let state = 'loading', stateT = 0, gameT = 0, clockMin = 52;
const clues = new Set(), lore = new Set();
let checkpoint = null, interactables = [], currentPrompt = null, prevState = null, docReturn = 'play';

function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); player?.setAspect(w / h);
  fx.width = w; fx.height = h;
}
addEventListener('resize', resize);

// ---------- loading ----------
async function boot() {
  resize();
  const mgr = new THREE.LoadingManager(); mgr.onProgress = (u, l, t) => { $('loadBar').style.width = (l / t * 70) + '%'; };
  const loader = new GLTFLoader(mgr);
  const [village, nature, soldier] = await Promise.all(['assets/village.glb', 'assets/nature.glb', 'assets/soldier.glb'].map(u => loader.loadAsync(u)));
  $('loadT').textContent = '正在搭建小镇……'; await frame();
  world = new World(scene, { village, nature, renderer }, Q);
  await world.build(p => { $('loadBar').style.width = (70 + p * 25) + '%'; });
  enemies = new Enemies(scene, soldier, world);
  enemies.spawn(guardDefs()); enemies.placeCorpse(world.bodyPos);
  player = new Player(camera, world, enemies);
  player.setAspect(innerWidth / innerHeight);
  hookEvents();
  buildInteractables();
  $('loadBar').style.width = '100%';
  // warm up shaders
  camera.position.set(0, 10, 30); camera.lookAt(0, 0, -10); renderer.compile(scene, camera); renderer.compile(player.vScene, player.vCam);
  Input.init(canvas);
  setTimeout(() => { $('loading').classList.remove('show'); showTitle(); }, 300);
  requestAnimationFrame(loop);
}
const frame = () => new Promise(r => requestAnimationFrame(() => r()));

function guardDefs() {
  const rz = x => roadZ(x) - 0.8; const L = world.hqL;
  const [hx, hz] = L(-1, 5.3);
  return [
    { id: 'road1', lantern: true, pingpong: true, path: [{ x: -58, z: rz(-58), wait: 5, look: Math.PI / 2 * -1 }, { x: -30, z: rz(-30) }, { x: 0, z: rz(0), wait: 2.5, look: Math.PI }, { x: 30, z: rz(30) }, { x: 58, z: rz(58), wait: 5, look: Math.PI / 2 }] },
    { id: 'road2', pingpong: true, path: [{ x: -55.5, z: rz(-55.5) + 1.3, wait: 5, look: -Math.PI / 2 }, { x: -27.5, z: rz(-27.5) + 1.3 }, { x: 2.5, z: rz(2.5) + 1.3, wait: 2.5, look: 0.2 }, { x: 32.5, z: rz(32.5) + 1.3 }, { x: 60, z: rz(60) + 1.3, wait: 5, look: Math.PI / 2 }] },
    { id: 'square', path: [{ x: 2, z: -17, wait: 7, look: 0, scan: 0.9 }, { x: -5, z: -10, wait: 5, look: -1.5 }, { x: 4, z: -6.5, wait: 6, look: 0.5 }] },
    { id: 'hq', yaw: -Math.PI / 2, path: [{ x: hx, z: hz, wait: 9999, look: -Math.PI / 2, scan: 0.75 }] },
    { id: 'alley', path: [{ x: -25.5, z: -12 }, { x: -25.5, z: -29, wait: 3, look: Math.PI }, { x: -6, z: -35 }, { x: 8, z: -33, wait: 3, look: 0 }, { x: 27, z: -31 }, { x: 27, z: -13, wait: 3, look: -Math.PI / 2 }, { x: 26, z: 5 }, { x: 6, z: 6, wait: 2, look: 0 }, { x: -6, z: 6 }, { x: -25, z: 4, wait: 3, look: -Math.PI / 2 }] },
    { id: 'church', pingpong: true, path: [{ x: -7.5, z: -49.5, wait: 6, look: 0, scan: 0.8 }, { x: 7.5, z: -49.5, wait: 6, look: 0, scan: 0.8 }] },
  ];
}
function placeRoadPatrolForIntro() {
  const [a, b] = enemies.list; a.pos.set(-19, 0, roadZ(-19) - 0.8); b.pos.set(-22, 0, roadZ(-22) + 0.5); a.wp = 2; b.wp = 2; a.dir = b.dir = 1; a.waitT = b.waitT = 0; a.path = b.path = null; a.yaw = b.yaw = Math.PI / 2;
}

function buildInteractables() {
  interactables = [
    { id: 'body', pos: world.bodyPos.clone().setY(world.bodyPos.y + 0.3), r: 2.4, label: '查看 阵亡的士兵' },
    { id: 'notice', pos: world.boardPos, r: 2.3, label: '查看 布告栏' },
    { id: 'orders', pos: world.docsPos, r: 2.0, label: '查看 桌上的文件' },
    { id: 'shoe', pos: world.shoePos, r: 1.7, label: '查看 地上的东西' },
    { id: 'diary', pos: world.diaryPos, r: 1.9, label: '查看 木箱上的本子' },
  ];
}

// ---------- events ----------
function hookEvents() {
  document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); Audio.init(); act(b.dataset.act); }));
  $('b-pause').addEventListener('click', e => { e.stopPropagation(); if (state === 'play') pause(); });
  $('skip').addEventListener('click', e => { e.stopPropagation(); if (state === 'intro') stateT = 999; });
  $('s-sens').value = save.settings.sens; $('s-q').value = save.settings.q; $('s-vol').value = save.settings.vol;
  $('s-sens').oninput = e => { save.settings.sens = Input.sens = +e.target.value; persist(); };
  $('s-q').onchange = e => { save.settings.q = e.target.value; persist(); };
  $('s-vol').oninput = e => { save.settings.vol = +e.target.value; persist(); };
  player.onHurt = () => { $('hurt').style.opacity = 1; updateHUD(); };
  player.onDeath = () => { setTimeout(() => { if (state === 'play') die(); }, 1300); };
  player.onAmmo = updateHUD; player.onStance = updateHUD;
  player.onNoAmmo = () => toast('没有子弹了');
  player.onHit = h => { toast(h.head ? '爆头' : '命中', 900); };
  enemies.onAlert = () => { player.stats.detected++; };
  world.onBolt = s => { setTimeout(() => Audio.thunder(0), 400 + Math.random() * 2600); };
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });
}
function act(a) {
  switch (a) {
    case 'new': startNew(); break;
    case 'continue': continueGame(); break;
    case 'chapters': openPanel('chapters'); renderChapters(); break;
    case 'premise': openPanel('premise'); $('premiseT').innerHTML = PREMISE.map(p => `<p>${p}</p>`).join('') + '<p style="color:var(--dim);font-size:12px">完整剧本见项目中的 STORY.md（含剧透）。</p>'; break;
    case 'settings': openPanel('settings'); break;
    case 'help': openPanel('help'); break;
    case 'back': closePanels(); break;
    case 'resume': resume(); break;
    case 'journal': openPanel('journal'); renderJournal(); break;
    case 'restartcp': closePanels(); retry(); break;
    case 'quit': closePanels(); $('death').classList.remove('show'); $('complete').classList.remove('show'); showTitle(); break;
    case 'closedoc': closeDoc(); break;
    case 'retry': $('death').classList.remove('show'); retry(); break;
  }
}
let panelStack = [];
function openPanel(id) { const cur = document.querySelector('.screen.show:not(#hud)'); if (cur && cur.id !== id) { panelStack.push(cur.id); cur.classList.remove('show'); } $(id).classList.add('show'); }
function closePanels() { const cur = document.querySelector('.screen.panel.show'); if (cur) cur.classList.remove('show'); const prev = panelStack.pop(); if (prev) $(prev).classList.add('show'); }
function renderChapters() {
  $('chapList').innerHTML = CHAPTERS.map(c => `<div class="chap ${c.ready ? '' : 'locked'}" data-ch="${c.n}"><div class="n">${c.n}</div><div><div class="t">${c.title}</div><div class="s">${c.sub}</div></div><div class="st">${c.ready ? (save.done1 ? '已完成' : '可游玩') : '制作中'}</div></div>`).join('');
  $('chapList').querySelectorAll('.chap').forEach(el => el.onclick = () => { if (el.dataset.ch === '1') { panelStack = []; $('chapters').classList.remove('show'); startNew(); } });
}
function renderJournal() {
  const o = objective();
  let h = `<h3>当前目标</h3><p><b>${o.t}</b> —— ${o.d}</p><h3>证据与线索</h3>`;
  const all = [...clues, ...lore];
  if (!all.length) h += '<p style="color:var(--dim)">还没有发现任何东西。</p>';
  for (const id of all) h += `<div class="item" data-doc="${id}"><b>${DOCS[id].tag}</b>${DOCS[id].title}</div>`;
  h += `<h3>随身物品</h3><p>老式单发步枪 · 子弹 ${player.chamber + player.reserve} 发 · 折刀 · 停在 4:17 的怀表 · 半张命令残页：“……务必在钟声之前……”</p>`;
  $('journalT').innerHTML = h;
  $('journalT').querySelectorAll('.item').forEach(el => el.onclick = () => { $('journal').classList.remove('show'); openDoc(el.dataset.doc, 'journal'); });
}

// ---------- states ----------
function setState(s) { state = s; stateT = 0; }
function showTitle() {
  setState('title'); Input.enabled = false; document.exitPointerLock?.();
  $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); $('title').classList.add('show'); $('skip').classList.add('hidden');
  $('m-continue').classList.toggle('hidden', !save.cp);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('installHint').textContent = (/iPhone|iPad/.test(navigator.userAgent) && !standalone) ? '提示：在 Safari 中点「分享」→「添加到主屏幕」，即可像 App 一样全屏游玩。' : (save.done1 ? '第一章已完成。后续章节制作中。' : '戴上耳机效果最佳。');
  $('fade').style.opacity = 0; $('lids').classList.remove('closed'); $('card').classList.remove('on'); $('subs').classList.remove('on');
  world.figure.visible = false; world.autoLightning = true;
  enemies.reset(); player.control = false; player.gunRaise = 0;
  Audio.setAmbience(0.7); Audio.setTension(0);
}
function startNew() {
  Audio.init(); Audio.setAmbience(0.0, 0.1);
  clues.clear(); lore.clear(); save.cp = null; persist();
  player.stats = { shots: 0, kills: 0, detected: 0, takedowns: 0 }; player.chamber = 1; player.reserve = 7; player.health = 3; player.dead = false;
  $('title').classList.remove('show'); $('fade').style.transition = 'none'; $('fade').style.opacity = 1; $('lids').classList.add('closed');
  requestAnimationFrame(() => { $('fade').style.transition = ''; });
  enemies.reset(); placeRoadPatrolForIntro();
  player.pos.set(SPAWN.x, world.heightAt(SPAWN.x, SPAWN.z), SPAWN.z); player.yaw = 0.2; player.pitch = 1.2; player.stance = 'stand';
  gameT = 0; clockMin = 52; world.figure.visible = false;
  setState('intro'); $('skip').classList.remove('hidden'); introFlags = {};
}
function continueGame() {
  Audio.init(); const s = save.cp; if (!s) return startNew();
  clues.clear(); lore.clear(); s.clues.forEach(c => clues.add(c)); (s.lore || []).forEach(c => lore.add(c));
  player.chamber = s.chamber; player.reserve = s.reserve; player.stats = s.stats || player.stats; clockMin = s.clock || 52;
  checkpoint = s; $('title').classList.remove('show');
  retry();
}
function beginPlay() {
  setState('play'); Input.enabled = true; player.control = true;
  $('hud').classList.remove('hidden'); if (isTouch) $('touch').classList.remove('hidden'); $('skip').classList.add('hidden');
  $('subs').classList.remove('on'); $('card').classList.remove('on'); $('lids').classList.remove('closed'); $('fade').style.opacity = 0;
  Audio.setAmbience(0.85); updateHUD();
  if (!isTouch && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
}
function pause() { if (state !== 'play') return; prevState = 'play'; setState('paused'); Input.enabled = false; document.exitPointerLock?.(); $('pause').classList.add('show'); Audio.setAmbience(0.3, 0.5); }
function resume() { panelStack = []; document.querySelectorAll('.screen.panel.show').forEach(e => e.classList.remove('show')); setState('play'); Input.enabled = true; Input.clearEdges(); Audio.setAmbience(0.85, 0.5); if (!isTouch) canvas.requestPointerLock?.(); }
function die() { setState('dead'); Input.enabled = false; document.exitPointerLock?.(); $('deathSub').textContent = clues.size ? `已找到 ${clues.size}/3 份证据。检查点会保留你的进度。` : '保持低姿态，躲开马灯的光。'; $('death').classList.add('show'); Audio.setTension(0); }
function retry() {
  const cp = checkpoint || { x: SPAWN.x, z: SPAWN.z, yaw: 0, clues: [], chamber: 1, reserve: 7 };
  enemies.reset(); player.respawn(cp); player.pitch = 0; player.chamber = Math.max(cp.chamber, player.chamber); player.reserve = cp.reserve;
  if (clues.size === 3) world.figure.visible = false;
  $('hurt').style.opacity = 0; beginPlay(); toast('检查点', 1500);
}
function makeCheckpoint() {
  checkpoint = { x: player.pos.x, z: player.pos.z, yaw: player.yaw, clues: [...clues], lore: [...lore], chamber: player.chamber, reserve: player.reserve, stats: player.stats, clock: clockMin };
  save.cp = checkpoint; persist();
}

// ---------- docs / objectives ----------
function objective() { if (clues.size >= 3) return OBJ.tower; if (clues.size === 0 && !world.inAnyFootprint(player.pos.x, player.pos.z, 30) && player.pos.z > 26) return OBJ.start; return { t: OBJ.search.t, d: OBJ.search.d.replace('{n}', clues.size) }; }
function openDoc(id, ret = 'play') {
  const d = DOCS[id]; $('docTag').textContent = d.tag; $('docH').textContent = d.head; $('docB').innerHTML = d.body.map(p => `<p>${p}</p>`).join('');
  $('doc').classList.add('show'); Audio.paper(); docReturn = ret;
  if (state === 'play') { setState('doc'); Input.enabled = false; document.exitPointerLock?.(); }
}
function closeDoc() {
  $('doc').classList.remove('show');
  if (docReturn === 'journal') { $('journal').classList.add('show'); renderJournal(); return; }
  if (state === 'doc') { setState('play'); Input.enabled = true; Input.clearEdges(); if (!isTouch) canvas.requestPointerLock?.(); }
  if (clues.size === 3 && !save.towerToastShown) { save.towerToastShown = true; toast('目标更新：前往钟楼', 3000); }
}
function collect(id) {
  const d = DOCS[id];
  if (d.kind === 'clue') {
    if (!clues.has(id)) { clues.add(id); if (id === 'body') { player.reserve += 3; } toast(`获得${d.tag}：${d.title}`, 2600); setTimeout(() => toast('检查点已保存', 1600), 2700); makeCheckpoint(); save.towerToastShown = false; }
  } else if (!lore.has(id)) { lore.add(id); Audio.pickup(); }
  updateHUD(); openDoc(id);
}

// ---------- HUD ----------
let toastTimer = 0;
function toast(t, ms = 2000) { $('toast').textContent = t; $('toast').classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('on'), ms); }
function updateHUD() {
  const o = objective(); $('objT').textContent = o.t; $('objD').textContent = o.d;
  [...$('clues').children].forEach((el, i) => el.classList.toggle('on', i < clues.size));
  [...$('hp').children].forEach((el, i) => { el.classList.toggle('on', i < player.health); el.classList.toggle('lost', i >= player.health); });
  $('stance').textContent = player.stance === 'crouch' ? '蹲伏' : '站立';
  $('chamber').classList.toggle('on', player.chamber > 0); $('reserve').textContent = player.reserve;
}
function subtitle(text) { const s = $('subs'); if (text) { if (s.textContent !== text) { s.textContent = text; } s.classList.add('on'); } else s.classList.remove('on'); }
function timedSubs(list, t) { const cur = list.find(([a, b]) => t >= a && t < b); subtitle(cur ? cur[2] : null); }

function drawFX(info) {
  const w = fx.width, h = fx.height; fctx.clearRect(0, 0, w, h);
  if (state !== 'play' && state !== 'doc') return;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.17;
  camera.updateMatrixWorld(); const inv = camera.matrixWorldInverse; const v = new THREE.Vector3();
  for (const it of info.ind) {
    v.set(it.x, player.eyeY, it.z).applyMatrix4(inv); const a = Math.atan2(v.x, -v.z) - Math.PI / 2;
    const lvl = clamp(it.lvl, 0, 1); const col = it.alert ? '212,72,60' : lvl > 0.55 ? '232,150,60' : '236,230,218';
    fctx.lineCap = 'round';
    fctx.strokeStyle = `rgba(${col},0.18)`; fctx.lineWidth = 5; fctx.beginPath(); fctx.arc(cx, cy, R, a - 0.22, a + 0.22); fctx.stroke();
    fctx.strokeStyle = `rgba(${col},${0.45 + lvl * 0.5})`; fctx.lineWidth = 5; fctx.beginPath(); fctx.arc(cx, cy, R, a - 0.22 * lvl, a + 0.22 * lvl); fctx.stroke();
    if (it.alert || lvl > 0.95) { fctx.fillStyle = `rgba(${col},0.95)`; fctx.font = 'bold 14px sans-serif'; fctx.textAlign = 'center'; fctx.fillText('!', cx + Math.cos(a) * (R + 16), cy + Math.sin(a) * (R + 16) + 5); }
  }
  // noise ring
  if (player.noiseT > 0 && player.lastNoise > 3) { fctx.strokeStyle = `rgba(236,230,218,${player.noiseT * 0.25})`; fctx.lineWidth = 1.5; fctx.beginPath(); fctx.arc(cx, cy, R * 0.55 + (0.6 - player.noiseT) * 40, 0, 7); fctx.stroke(); }
}

// ---------- cinematics ----------
let introFlags = {};
const camLook = (tx, ty, tz) => { const dx = tx - camera.position.x, dy = ty - camera.position.y, dz = tz - camera.position.z; return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))]; };
function updateIntro(dt) {
  const t = stateT; const P = player; const gy = world.heightAt(P.pos.x, P.pos.z);
  if (t >= 999) { // skipped
    $('fade').style.opacity = 0; $('lids').classList.remove('closed'); P.yaw = 0; P.pitch = 0; P.eyeH = 1.62; finishIntro(); return;
  }
  const once = (k, fn) => { if (!introFlags[k]) { introFlags[k] = 1; fn(); } };
  once('amb', () => Audio.setAmbience(0.9, 6));
  if (t > 2.6) once('fade', () => { $('fade').style.opacity = 0; });
  if (t > 3.2) once('open1', () => $('lids').classList.remove('closed'));
  if (t > 5.0) once('close', () => $('lids').classList.add('closed'));
  if (t > 5.5) once('open2', () => $('lids').classList.remove('closed'));
  if (t > 14.2) once('shot1', () => Audio.distantShot());
  if (t > 15.4) once('sh1', () => Audio.shout(-0.2, true));
  if (t > 16.6) once('sh2', () => { Audio.shout(0.3, true); Audio.distantShot(); });
  if (t > 11.0) once('bolt', () => world.triggerLightning(0.8));
  timedSubs(INTRO, t);
  let y, yaw, pitch;
  const lyY = gy + 0.32, sitY = gy + 0.95, stY = gy + 1.62;
  const g = enemies.list[0]; const gl = g.lantern ? g.lantern.position : g.pos;
  if (t < 9) { y = lyY; yaw = 0.25 + Math.sin(t * 0.4) * 0.05; pitch = 1.22 + Math.sin(t * 0.7) * 0.03; }
  else if (t < 13) { const k = smooth(clamp((t - 9) / 3.2, 0, 1)); y = lerp(lyY, sitY, k); pitch = lerp(1.22, 0.04, k); yaw = lerp(0.25, -0.55, k) + smooth(clamp((t - 11.2) / 1.8, 0, 1)) * 1.1; }
  else if (t < 19.2) { y = sitY; camera.position.set(P.pos.x, y, P.pos.z); const [ty, tp] = camLook(gl.x, gl.y, gl.z); const k = smooth(clamp((t - 13) / 1.6, 0, 1)); yaw = lerp(0.55, ty, k); pitch = lerp(0.04, tp, k); P._ly = yaw; P._lp = pitch; }
  else if (t < 25) { y = sitY; const k = smooth(clamp((t - 19.2) / 1.4, 0, 1)); yaw = lerp(P._ly ?? 0, 0.1, k); pitch = lerp(P._lp ?? 0, -0.42, k); P.armT = smooth(clamp((t - 19.4) / 1.2, 0, 1)) * (1 - smooth(clamp((t - 24.2) / 0.8, 0, 1))); }
  else { const k = smooth(clamp((t - 25) / 2.4, 0, 1)); y = lerp(sitY, stY, k); yaw = lerp(0.1, 0, k); pitch = lerp(-0.42, 0.0, k); P.armT = 0; P.gunRaise = Math.max(P.gunRaise, k); }
  P.yaw = yaw; P.pitch = pitch; P.eyeH = y - gy;
  camera.position.set(P.pos.x, y, P.pos.z); camera.rotation.set(pitch, yaw, t < 9 ? Math.sin(t * 0.5) * 0.04 : 0, 'YXZ');
  if (camera.fov !== 72) { camera.fov = 72; camera.updateProjectionMatrix(); }
  if (t > 28.6) once('card', () => { subtitle(null); $('card').querySelector('.no').textContent = '第 一 章'; $('card').querySelector('.tt').textContent = '雨中醒来'; $('card').classList.add('on'); });
  if (t > 32.6) finishIntro();
}
function finishIntro() {
  $('card').classList.remove('on'); subtitle(null); player.armT = 0;
  player.pitch = 0; checkpoint = { x: player.pos.x, z: player.pos.z, yaw: player.yaw, clues: [], lore: [], chamber: 1, reserve: 7, stats: player.stats, clock: 52 }; save.cp = checkpoint; persist();
  beginPlay(); toast('保持隐蔽，潜入小镇', 3000);
}
let endFlags = {};
function startEnding() {
  setState('ending'); endFlags = {}; Input.enabled = false; player.control = false; document.exitPointerLock?.();
  $('touch').classList.add('hidden'); $('hud').classList.add('hidden'); $('prompt').classList.remove('on'); world.autoLightning = false; clockMin = 77;
  player._ey = player.yaw; player._ep = player.pitch;
}
function updateEnding(dt) {
  const t = stateT; const P = player; const once = (k, fn) => { if (!endFlags[k]) { endFlags[k] = 1; fn(); } };
  const [ty, tp] = camLook(world.towerDoor[0], 2.2, world.towerDoor[1] - 2); const k = smooth(clamp(t / 1.8, 0, 1));
  P.yaw = P._ey + angleDiff(P._ey, ty) * k; P.pitch = lerp(P._ep, tp + (t > 3 && t < 6.5 ? 0.35 * smooth(clamp((t - 3) / 2, 0, 1)) * (1 - smooth(clamp((t - 5.3) / 1.2, 0, 1))) : 0), k);
  if (t > 0.8) once('b1', () => Audio.bell());
  if (t > 3.8) once('b2', () => Audio.bell());
  if (t > 6.8) once('b3', () => Audio.bell());
  if (t > 7.6) once('fig', () => { world.figure.visible = true; world.triggerLightning(1.4); Audio.thunder(0.25); Audio.setTension(0.9); });
  if (t > 11.6) once('gone', () => { world.figure.visible = false; world.triggerLightning(1.1); Audio.thunder(0.6); });
  if (t > 13) Audio.setTension(0.3);
  timedSubs(ENDING, t);
  if (t > 17.5) once('fade', () => { $('fade').style.opacity = 1; });
  if (t > 19) once('done', () => completeChapter());
}
function completeChapter() {
  setState('complete'); save.done1 = true; save.cp = null; persist(); $('hud').classList.add('hidden'); subtitle(null);
  const s = player.stats; const mins = Math.floor(gameT / 60), secs = Math.floor(gameT % 60);
  $('stats').innerHTML = `<div><b>${mins}:${String(secs).padStart(2, '0')}</b>用时</div><div><b>${clues.size}/3</b>证据</div><div><b>${lore.size}/2</b>线索</div><div><b>${s.detected}</b>被发现</div><div><b>${s.kills}</b>射杀</div><div><b>${s.takedowns}</b>刀杀</div><div><b>${s.shots}</b>开枪</div><div><b>${s.detected === 0 && s.kills === 0 && s.takedowns === 0 ? '幽灵' : s.detected === 0 ? '影子' : '幸存者'}</b>评价</div>`;
  $('complete').classList.add('show'); Audio.setTension(0); Audio.setAmbience(0.5);
}

// ---------- ambience ----------
let ambT = 6, artT = 30, dripT = 2;
function ambience(dt) {
  ambT -= dt; if (ambT < 0) { ambT = 8 + Math.random() * 20; Audio.distantShot(); if (Math.random() < 0.4) setTimeout(() => Audio.distantShot(), 300 + Math.random() * 700); }
  artT -= dt; if (artT < 0) { artT = 35 + Math.random() * 40; Audio.artillery(); }
  dripT -= dt; if (dripT < 0) { dripT = 0.4 + Math.random() * 2.5; Audio.drip(); }
}

// ---------- gameplay tick ----------
function updatePlay(dt) {
  gameT += dt; if (gameT > (clockMin - 51) * 26 && clockMin < 76) clockMin++;
  player.update(dt);
  const info = enemies.update(dt, player, camera, true);
  Audio.setTension(clamp(info.max, 0, 1));
  // interaction
  currentPrompt = null; const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  if (!player.dead) {
    const tg = enemies.takedownTarget(player);
    if (tg) currentPrompt = { label: '刀杀', fn: () => player.takedown(tg) };
    else for (const it of interactables) {
      if ((DOCS[it.id].kind === 'clue' ? clues : lore).has(it.id)) continue;
      const d = Math.hypot(it.pos.x - player.pos.x, it.pos.z - player.pos.z); if (d > it.r) continue;
      const to = new THREE.Vector3().subVectors(it.pos, camera.position).normalize(); if (to.dot(fwd) < 0.55 && d > 1.1) continue;
      currentPrompt = { label: it.label, fn: () => collect(it.id) }; break;
    }
  }
  const pr = $('prompt'), ub = $('b-use');
  if (currentPrompt) { $('promptT').textContent = currentPrompt.label; $('promptK').style.display = isTouch ? 'none' : ''; pr.classList.add('on'); ub.classList.add('on'); ub.querySelector('span').textContent = currentPrompt.label === '刀杀' ? '刀杀' : '查看'; }
  else { pr.classList.remove('on'); ub.classList.remove('on'); }
  if (Input.consume('interact') && currentPrompt) currentPrompt.fn();
  if (Input.consume('pause')) pause();
  if (Input.consume('journal')) { pause(); act('journal'); }
  // reach the tower
  if (clues.size >= 3 && world.towerDoor && Math.hypot(player.pos.x - world.towerDoor[0], player.pos.z - world.towerDoor[1]) < 6.5) startEnding();
  else if (clues.size < 3 && world.towerDoor && Math.hypot(player.pos.x - world.towerDoor[0], player.pos.z - world.towerDoor[1]) < 4.5 && !player._towerHint) { player._towerHint = true; toast('钟楼的门被铁链锁着。先弄清镇上发生了什么。', 3200); setTimeout(() => player._towerHint = false, 8000); }
  // HUD bits
  $('visBar').style.width = clamp(player.visibility / 1.4 * 100, 4, 100) + '%';
  $('xh').style.opacity = player.aimT > 0.5 ? 0 : 1;
  $('hurt').style.opacity = Math.max(player.hurtT * 0.9, player.health === 1 ? 0.35 + Math.sin(performance.now() / 300) * 0.1 : 0);
  if ((stateT * 4 | 0) !== ((stateT - dt) * 4 | 0)) updateHUD();
  ambience(dt);
  return info;
}

// ---------- main loop ----------
let last = performance.now(), titleT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!world) return;
  stateT += dt;
  let info = { ind: [] };
  if (Audio.ready && Audio._v !== save.settings.vol) { Audio._v = save.settings.vol; Audio.setVolume(save.settings.vol); }
  switch (state) {
    case 'title': {
      titleT += dt * 0.04; const a = titleT; camera.position.set(Math.sin(a) * 34, 11 + Math.sin(a * 2) * 1.5, -14 + Math.cos(a) * 34); camera.lookAt(0, 2, -22);
      if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
      enemies.update(dt, player, camera, false); ambience(dt); break;
    }
    case 'intro': enemies.update(dt, player, camera, false); updateIntro(dt); ambience(dt); player.updateWeapon(dt); if (state === 'intro' && stateT > 25) player.gunRaise = Math.min(1, player.gunRaise); break;
    case 'play': info = updatePlay(dt); break;
    case 'ending': enemies.update(dt, player, camera, false); updateEnding(dt); camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ'); player.gunRaise = Math.max(0, player.gunRaise - dt); break;
    case 'dead': { enemies.update(dt, player, camera, true); camera.position.y = lerp(camera.position.y, player.pos.y + 0.3, dt * 2); camera.rotation.z = lerp(camera.rotation.z, 0.9, dt * 2); break; }
    default: break;
  }
  if (state === 'dead' || state === 'play') { /* keep */ }
  if (Input.consume('skip') && state === 'intro') stateT = 999;
  world.update(dt, camera);
  Audio.update(dt);
  $('clock').textContent = `${clockMin >= 60 ? '04' : '03'}:${String(clockMin % 60).padStart(2, '0')}`;
  // viewmodel: torso visible when looking down
  renderer.clear(); renderer.render(scene, camera); window.__mainInfo = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  if (state === 'play' || state === 'doc' || state === 'paused' || state === 'dead' || (state === 'intro' && stateT > 18) || state === 'ending') {
    renderer.clearDepth(); renderer.render(player.vScene, player.vCam);
  }
  drawFX(info);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__g = { info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, progs: renderer.info.programs.length }; }, skip() { stateT = 999; }, tp(x, z, yaw = 0, pitch = 0) { player.pos.set(x, world.heightAt(x, z), z); player.yaw = yaw; player.pitch = pitch; }, get stateT() { return stateT; }, set stateT(v) { stateT = v; }, get world() { return world; }, get player() { return player; }, get enemies() { return enemies; }, get state() { return state; }, setState, startNew, beginPlay, clues, collect, startEnding, act, camera };
boot().catch(e => { console.error(e); $('loadT').textContent = '载入失败：' + e.message; });
