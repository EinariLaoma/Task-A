// Fully procedural sound: no audio files, everything is synthesized with WebAudio.
let ctx = null, master, sfxBus, ambBus, reverb, reverbSend;
let rainGain, rainFilter, droneGain, droneFilter, heartTimer = 0, tension = 0;
const buffers = {};

function noiseBuffer(sec, type = 'white') {
  const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (type === 'pink') { b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.05) * 0.9; }
    else d[i] = w;
  }
  return b;
}
function impulse(sec, decay) {
  const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return b;
}

export const Audio = {
  ready: false,
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    ambBus = ctx.createGain(); ambBus.gain.value = 0; ambBus.connect(master);
    reverb = ctx.createConvolver(); reverb.buffer = impulse(3.2, 2.6); reverb.connect(master);
    reverbSend = ctx.createGain(); reverbSend.gain.value = 0.55; reverbSend.connect(reverb);
    buffers.white = noiseBuffer(2); buffers.pink = noiseBuffer(4, 'pink'); buffers.brown = noiseBuffer(4, 'brown');
    // Rain bed: two layers of looped noise, one hissy, one heavy.
    const mk = (buf, type, f, q, g) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const gn = ctx.createGain(); gn.gain.value = g; s.connect(fl); fl.connect(gn); gn.connect(ambBus); s.start(); return [fl, gn]; };
    [rainFilter, rainGain] = mk(buffers.pink, 'lowpass', 5200, 0.3, 0.5);
    mk(buffers.white, 'highpass', 6000, 0.2, 0.05);
    mk(buffers.brown, 'lowpass', 300, 0.5, 0.35);
    // Tension drone
    droneGain = ctx.createGain(); droneGain.gain.value = 0.0; droneFilter = ctx.createBiquadFilter(); droneFilter.type = 'lowpass'; droneFilter.frequency.value = 180;
    droneFilter.connect(droneGain); droneGain.connect(master);
    [43.65, 44.2, 65.4].forEach(f => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.12; o.connect(g); g.connect(droneFilter); o.start(); });
    this.ready = true;
  },
  setVolume(v) { if (master) master.gain.value = v; },
  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  setAmbience(v, t = 2) { if (!ctx) return; ambBus.gain.setTargetAtTime(v, ctx.currentTime, t / 3); },
  setMuffled(on) { if (!ctx) return; rainFilter.frequency.setTargetAtTime(on ? 900 : 5200, ctx.currentTime, 0.4); },
  setTension(v) { tension = v; if (!ctx) return; droneGain.gain.setTargetAtTime(0.02 + v * 0.22, ctx.currentTime, 0.5); droneFilter.frequency.setTargetAtTime(120 + v * 500, ctx.currentTime, 0.5); },
  update(dt) {
    if (!ctx) return;
    if (tension > 0.35) { heartTimer -= dt; if (heartTimer <= 0) { heartTimer = 1.15 - tension * 0.55; this.heartbeat(0.25 + tension * 0.5); } }
  },
  _env(node, t0, a, peak, d) { node.gain.setValueAtTime(0.0001, t0); node.gain.exponentialRampToValueAtTime(peak, t0 + a); node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); },
  _noise(buf, type, f, q, peak, a, d, wet = 0, delay = 0, pan = 0) {
    if (!ctx) return; const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = buffers[buf]; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); this._env(g, t, a, peak, d);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    s.connect(fl); fl.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(sfxBus); if (wet) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(reverbSend); } }
    else { g.connect(sfxBus); }
    s.start(t, Math.random() * 1.5); s.stop(t + a + d + 0.1);
  },
  _tone(type, f0, f1, peak, a, d, wet = 0, delay = 0) {
    if (!ctx) return; const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    const g = ctx.createGain(); this._env(g, t, a, peak, d); o.connect(g); g.connect(sfxBus);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(reverbSend); }
    o.start(t); o.stop(t + a + d + 0.05);
  },
  step(surface = 'mud', loud = 1) {
    const v = 0.08 * loud;
    if (surface === 'stone') this._noise('white', 'bandpass', 1800 + Math.random() * 600, 1.2, v * 1.2, 0.005, 0.09);
    else if (surface === 'wood') { this._noise('white', 'bandpass', 700, 2, v * 1.3, 0.004, 0.08); this._tone('sine', 140, 90, v * 0.6, 0.004, 0.08); }
    else { this._noise('pink', 'lowpass', 900 + Math.random() * 500, 1, v * 1.6, 0.01, 0.16); this._noise('white', 'bandpass', 2600, 3, v * 0.35, 0.02, 0.12); }
  },
  shot(dist = 0) {
    const near = dist < 1; const atten = near ? 1 : Math.max(0.12, 1 - dist / 90);
    if (near) { this._noise('white', 'lowpass', 9000, 0.3, 0.9, 0.001, 0.18, 0.9); this._tone('sine', 120, 38, 0.9, 0.001, 0.35); }
    else this._noise('white', 'lowpass', 1600, 0.4, 0.5 * atten, 0.002, 0.3, 1.0);
    this._noise('brown', 'lowpass', 400, 0.5, 0.6 * atten, 0.02, 2.4, 1.2, 0.05);
  },
  distantShot() { const pan = Math.random() * 2 - 1; this._noise('white', 'lowpass', 900, 0.5, 0.12, 0.002, 0.25, 1.5, 0, pan); this._noise('brown', 'lowpass', 220, 0.5, 0.18, 0.05, 2.0, 1.0, 0.08, pan); },
  artillery() { this._noise('brown', 'lowpass', 120, 0.6, 0.5, 0.15, 3.5, 1.0); },
  thunder(delay = 0) { this._noise('brown', 'lowpass', 160, 0.7, 0.9, 0.25 + Math.random() * 0.3, 4.5, 0.8, delay); this._noise('pink', 'lowpass', 600, 0.4, 0.25, 0.05, 1.2, 0.6, delay); },
  click() { this._noise('white', 'bandpass', 3800, 6, 0.25, 0.001, 0.04); },
  lever(down = true) { this._noise('white', 'bandpass', down ? 1400 : 2200, 5, 0.3, 0.002, 0.07); this._tone('triangle', down ? 600 : 900, down ? 300 : 500, 0.06, 0.002, 0.05); },
  shell() { this._tone('sine', 3200, 2400, 0.05, 0.001, 0.2, 0, 0.35); this._tone('sine', 2900, 2500, 0.04, 0.001, 0.15, 0, 0.5); },
  insert() { this._noise('white', 'bandpass', 2600, 4, 0.18, 0.002, 0.05); this._tone('sine', 1800, 1500, 0.04, 0.001, 0.06); },
  whistle(pan = 0) { // police/army whistle: two detuned sines with trill
    if (!ctx) return; const t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.05); g.gain.setValueAtTime(0.14, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null; const lfo = ctx.createOscillator(); lfo.frequency.value = 28; const lg = ctx.createGain(); lg.gain.value = 60; lfo.connect(lg);
    [2600, 2680].forEach(f => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; lg.connect(o.frequency); o.connect(g); o.start(t); o.stop(t + 1.2); });
    lfo.start(t); lfo.stop(t + 1.2);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(sfxBus); } else g.connect(sfxBus);
    const w = ctx.createGain(); w.gain.value = 0.5; g.connect(w); w.connect(reverbSend);
  },
  hurt() { this._noise('brown', 'lowpass', 300, 1, 0.8, 0.002, 0.4); this._tone('sine', 90, 40, 0.5, 0.002, 0.5); },
  heartbeat(v = 0.5) { this._tone('sine', 62, 40, 0.5 * v, 0.01, 0.12); this._tone('sine', 58, 38, 0.38 * v, 0.01, 0.14, 0, 0.22); },
  bell(delay = 0) {
    if (!ctx) return; const t = ctx.currentTime + delay; const base = 196;
    [[0.5, 0.5, 6], [1, 0.6, 5], [1.19, 0.35, 4], [1.5, 0.3, 3.5], [2, 0.25, 3], [2.74, 0.15, 2], [3.0, 0.12, 2], [4.07, 0.08, 1.4]].forEach(([r, a, d]) => {
      const o = ctx.createOscillator(); o.frequency.value = base * r * (1 + (Math.random() - 0.5) * 0.004); const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a * 0.35, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d * 1.5);
      o.connect(g); g.connect(sfxBus); const w = ctx.createGain(); w.gain.value = 0.7; g.connect(w); w.connect(reverbSend); o.start(t); o.stop(t + d * 1.6);
    });
  },
  paper() { this._noise('white', 'highpass', 3000, 0.5, 0.12, 0.02, 0.25); this._noise('white', 'bandpass', 5000, 1, 0.06, 0.05, 0.3, 0, 0.15); },
  pickup() { this._noise('white', 'bandpass', 2400, 4, 0.15, 0.002, 0.06); this._tone('sine', 880, 870, 0.03, 0.01, 0.2); },
  shout(pan = 0, far = true) { // muffled voice-like formant bursts
    if (!ctx) return; const t0 = ctx.currentTime; const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.18 + Math.random() * 0.12); const o = ctx.createOscillator(); o.type = 'sawtooth'; const f = 140 + Math.random() * 60; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (0.8 + Math.random() * 0.4), t + 0.2);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 500 + Math.random() * 400; f1.Q.value = 4; const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = far ? 900 : 2200;
      const g = ctx.createGain(); this._env(g, t, 0.03, far ? 0.06 : 0.12, 0.18); o.connect(f1); f1.connect(f2); f2.connect(g);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (p) { p.pan.value = pan; g.connect(p); p.connect(sfxBus); } else g.connect(sfxBus);
      const w = ctx.createGain(); w.gain.value = 0.9; g.connect(w); w.connect(reverbSend); o.start(t); o.stop(t + 0.3);
    }
  },
  drip() { this._tone('sine', 1400 + Math.random() * 900, 700, 0.025, 0.001, 0.08, 0.3); },
};
