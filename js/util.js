// Small math / noise helpers shared by all modules.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function angleDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

// Deterministic PRNG so the world layout is identical every run.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Value noise (2D) for terrain.
const P = new Uint8Array(512);
{ const r = rng(1917); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
function hash(x, y) { return P[(P[x & 255] + y) & 511] / 255; }
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}
export function fbm(x, y, oct = 4) { let a = 0, amp = 0.5, f = 1; for (let i = 0; i < oct; i++) { a += amp * vnoise(x * f, y * f); f *= 2; amp *= 0.5; } return a; }

// 2D segment helpers (XZ plane) used for collision and line of sight.
export function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1x = bx - ax, r1z = bz - az, r2x = dx - cx, r2z = dz - cz;
  const den = r1x * r2z - r1z * r2x; if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * r2z - (cz - az) * r2x) / den, u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
  return t > 0 && t < 1 && u > 0 && u < 1;
}
export function closestOnSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az; const l2 = vx * vx + vz * vz || 1e-9;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1);
  return [ax + vx * t, az + vz * t];
}
