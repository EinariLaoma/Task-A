// Unified input: keyboard + mouse (pointer lock) on desktop, virtual stick + drag-look + buttons on touch.
import { clamp } from './util.js';

export const Input = {
  touch: matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window,
  move: { x: 0, y: 0 }, run: false, look: { x: 0, y: 0 },
  aim: false, crouchToggled: false,
  _pressed: new Set(), _edges: new Set(), keys: {},
  sens: 1,
  enabled: false,
  press(name) { this._edges.add(name); },
  consume(name) { if (this._edges.has(name)) { this._edges.delete(name); return true; } return false; },
  clearEdges() { this._edges.clear(); },
  init(canvas) {
    const K = this.keys;
    addEventListener('keydown', e => {
      if (e.repeat) return; K[e.code] = true;
      const map = { KeyE: 'interact', KeyF: 'interact', KeyR: 'reload', KeyC: 'crouch', ControlLeft: 'crouch', Escape: 'pause', KeyP: 'pause', KeyJ: 'journal', Tab: 'journal', Space: 'skip', Enter: 'skip' };
      if (map[e.code]) { this.press(map[e.code]); if (e.code === 'Tab') e.preventDefault(); }
    });
    addEventListener('keyup', e => { K[e.code] = false; });
    canvas.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (!this.touch && document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) this.press('fire'); if (e.button === 2) this.aim = true;
    });
    addEventListener('mouseup', e => { if (e.button === 2) this.aim = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) { this.look.x += e.movementX * 0.0022 * this.sens; this.look.y += e.movementY * 0.0022 * this.sens; } });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.enabled && !this.touch) this.press('pause'); });
    if (this.touch) this._initTouch();
    // block iOS zoom gestures
    ['gesturestart', 'gesturechange', 'dblclick'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
    document.addEventListener('touchmove', e => { if (e.target.closest && e.target.closest('.scroll')) return; e.preventDefault(); }, { passive: false });
  },
  _initTouch() {
    const zone = document.getElementById('touch');
    const stick = document.getElementById('stick'), knob = document.getElementById('knob');
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    const R = 56;
    zone.addEventListener('touchstart', e => {
      for (const t of e.changedTouches) {
        if (t.target.closest('.tbtn')) continue;
        if (t.clientX < innerWidth * 0.42 && stickId === null) {
          stickId = t.identifier; sx = t.clientX; sy = t.clientY;
          stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; stick.classList.add('on'); knob.style.transform = 'translate(-50%,-50%)';
        } else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy; const d = Math.hypot(dx, dy); const m = Math.min(d, R);
          if (d > 0) { dx = dx / d * m; dy = dy / d * m; }
          knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
          this.move.x = dx / R; this.move.y = -dy / R; this.run = d > R * 1.35 && !this.crouchToggled;
        } else if (t.identifier === lookId) {
          const k = (this.aim ? 0.0024 : 0.0048) * this.sens;
          this.look.x += (t.clientX - lx) * k; this.look.y += (t.clientY - ly) * k; lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.move.x = this.move.y = 0; this.run = false; stick.classList.remove('on'); }
        if (t.identifier === lookId) lookId = null;
      }
    };
    zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
    const bind = (id, fn) => { const el = document.getElementById(id); el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); fn(true); }, { passive: false }); el.addEventListener('touchend', e => { e.preventDefault(); el.classList.remove('down'); fn(false); }, { passive: false }); };
    bind('b-fire', d => d && this.press('fire'));
    bind('b-aim', d => { if (d) this.aim = !this.aim; document.getElementById('b-aim').classList.toggle('active', this.aim); });
    bind('b-crouch', d => d && this.press('crouch'));
    bind('b-use', d => d && this.press('interact'));
    bind('b-reload', d => d && this.press('reload'));
  },
  poll() {
    if (!this.touch) {
      const K = this.keys;
      this.move.x = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
      this.move.y = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0);
      const l = Math.hypot(this.move.x, this.move.y); if (l > 1) { this.move.x /= l; this.move.y /= l; }
      this.run = !!(K.ShiftLeft || K.ShiftRight);
    }
    const l = { x: this.look.x, y: this.look.y }; this.look.x = this.look.y = 0;
    return l;
  },
};
export { clamp };
