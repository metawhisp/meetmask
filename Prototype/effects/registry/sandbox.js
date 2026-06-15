import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';
import { loadHandLandmarker } from '../core/mpLoader.js';

// ============================================================================
// SANDBOX — a reactive physics toy where YOU are the physics. Interaction is
// the whole filter, not a trigger:
//
//   * The frame fills with bouncy balls (gravity + collisions + walls).
//   * Tilt your HEAD → gravity tilts → the whole pile slides that way.
//   * Your head and both palms are solid colliders: move them to shove, swat,
//     scoop, juggle and pile balls (a moving collider flings them).
//   * Gestures, live & continuous:  ✊ fist = magnet (balls swarm to the fist),
//     ✋ open palm = blow them away.
//
// Degrades gracefully: no face → gravity straight down; no hands → just head.
//
// Orientation (AGENTS.md §12): the camera shows behind (wantsRawVideo); all
// bodies live in pixel space via toPx(), so gravity-down piles balls at the
// BOTTOM and colliders line up with what you see. No uVideo painting.
// ============================================================================

const BALL_COUNT  = 170;
const BALL_RMIN   = 16;
const BALL_RMAX   = 34;
const GRAVITY     = 1500;   // px/s²
const WALL_REST   = 0.45;   // wall bounciness
const BALL_REST   = 0.30;   // ball-ball bounciness
const DAMP        = 0.992;  // per-frame velocity damping (settling)
const HAND_FLING  = 1.0;    // how much a moving collider imparts its velocity
const MAGNET_ACC  = 5200;   // fist attraction (px/s² near the hand)
const BLOW_ACC    = 6000;   // open-palm repulsion
const FORCE_R     = 320;    // gesture force radius (px)
const HOLD_K      = 18;     // stiffness pulling held balls to the hand
const THROW_K     = 1.3;    // hand velocity → throw speed on release

const PALM_IDXS = [0, 5, 9, 13, 17];
const TIP_IDXS  = [8, 12, 16, 20];
const CANDY = [
  0xff5d73, 0xffd23f, 0x4ad6c8, 0x5b8cff, 0xc77dff, 0x8aff80, 0xff9f45, 0xff7ad9,
];

function palmCenter(lms) {
  let x = 0, y = 0;
  for (const i of PALM_IDXS) { x += lms[i].x; y += lms[i].y; }
  return { x: x / PALM_IDXS.length, y: y / PALM_IDXS.length };
}
function handOpenness(lms) {
  const c = palmCenter(lms);
  const size = Math.hypot(lms[9].x - lms[0].x, lms[9].y - lms[0].y) || 1e-3;
  let s = 0;
  for (const i of TIP_IDXS) s += Math.hypot(lms[i].x - c.x, lms[i].y - c.y);
  return Math.max(0, Math.min(1, ((s / TIP_IDXS.length) / size - 1.15) / 0.75));
}

// Soft-shaded round ball sprite (tinted per-instance via instanceColor).
function makeBallTexture() {
  const s = 96, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s * 0.38, s * 0.34, s * 0.05, s * 0.5, s * 0.5, s * 0.5);
  grd.addColorStop(0.0, 'rgba(255,255,255,1.0)');   // highlight
  grd.addColorStop(0.25, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.6, 'rgba(190,190,190,0.95)');
  grd.addColorStop(0.92, 'rgba(70,70,70,0.95)');    // shaded rim
  grd.addColorStop(1.0, 'rgba(0,0,0,0)');           // soft edge
  g.fillStyle = grd; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  return tex;
}

// A kinematic collider circle (head / palm) with a smoothed velocity.
class Collider {
  constructor() { this.active = false; this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.r = 1; this.mode = 0; }
  set(x, y, r, dt) {
    if (this.active && dt > 0) { this.vx = (x - this.x) / dt; this.vy = (y - this.y) / dt; }
    else { this.vx = this.vy = 0; }
    this.x = x; this.y = y; this.r = r; this.active = true;
  }
  clear() { this.active = false; this.vx = this.vy = 0; }
}

class Sandbox extends Tracker {
  constructor() {
    super({ kind: 'face', numFaces: 1 });
    this.handLm = null;
    this.lastFaceTime = -1;
    this.lastHandTime = -1;
    this.faceLms = null;
    this.handsRaw = [];
    // physics state
    this.bx = new Float32Array(BALL_COUNT);
    this.by = new Float32Array(BALL_COUNT);
    this.bvx = new Float32Array(BALL_COUNT);
    this.bvy = new Float32Array(BALL_COUNT);
    this.br = new Float32Array(BALL_COUNT);
    this.head = new Collider();
    this.palms = [new Collider(), new Collider()];
    this.heldBy = new Int8Array(BALL_COUNT).fill(-1); // -1 free, else palm index
    this.gx = 0; this.gy = GRAVITY;       // current gravity vector
    this._dummy = new THREE.Object3D();
  }

  async setup(ctx) {
    const W = ctx.width, H = ctx.height;
    this.handLm = await loadHandLandmarker({ numHands: 2 });

    this.tex = makeBallTexture();
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.mat, BALL_COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BALL_COUNT * 3), 3);
    this.mesh.renderOrder = 2;
    ctx.scene.add(this.mesh);

    const col = new THREE.Color();
    for (let i = 0; i < BALL_COUNT; i++) {
      this.bx[i] = Math.random() * W;
      this.by[i] = Math.random() * H * 0.5;          // start in the upper half → rain down
      this.bvx[i] = (Math.random() - 0.5) * 80;
      this.bvy[i] = 0;
      this.br[i] = BALL_RMIN + Math.random() * (BALL_RMAX - BALL_RMIN);
      col.setHex(CANDY[(Math.random() * CANDY.length) | 0]);
      this.mesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  // Override: run BOTH face (base landmarker) and hand landmarkers, then sim.
  update(dt) {
    const ctx = this.ctx;
    if (!ctx || !ctx.video || ctx.video.readyState < 2) { this.step(Math.min(dt, 0.033)); return; }
    const ts = performance.now();
    if (ctx.video.currentTime !== this.lastFaceTime) {
      this.lastFaceTime = ctx.video.currentTime;
      try {
        const fr = this.landmarker?.detectForVideo(ctx.video, ts);
        this.faceLms = fr?.faceLandmarks?.[0] || null;
      } catch (_e) { /* keep last */ }
      try {
        const hr = this.handLm?.detectForVideo(ctx.video, ts + 1);
        this.handsRaw = hr?.landmarks || [];
      } catch (_e) { /* keep last */ }
    }
    this.step(Math.min(dt, 0.033));
  }

  // Map detections → colliders + gravity, then advance the physics.
  step(dt) {
    const ctx = this.ctx; if (!ctx) return;
    const W = ctx.width, H = ctx.height;

    // ---- gravity: a covered face flips it; otherwise head-tilt steers it ----
    const covered = !this.faceLms && this.handsRaw.length > 0;
    if (covered) {
      this.head.clear();
      this.gx += (0 - this.gx) * Math.min(1, dt * 6);
      this.gy += (-GRAVITY - this.gy) * Math.min(1, dt * 6);   // flip UP
    } else if (this.faceLms && this.faceLms.length > 263) {
      const f = this.faceLms;
      const [fx, fy] = this.toPx(f[10].x, f[10].y);   // forehead
      const [cx, cy] = this.toPx(f[152].x, f[152].y); // chin
      const hx = (fx + cx) / 2, hy = (fy + cy) / 2;
      const r = Math.hypot(fx - cx, fy - cy) * 0.46;
      this.head.set(hx, hy, Math.max(40, r), dt);
      // roll from the eye line (33 / 263 = outer eye corners). toPx is
      // mirror-aware (flips X in selfie mode), which would flip the eye-line
      // vector and read upright as ~180° → gravity UP. Order the two points by
      // screen-X so an upright head is always roll≈0 (gravity straight down),
      // mirror or not.
      let [e1x, e1y] = this.toPx(f[33].x, f[33].y);
      let [e2x, e2y] = this.toPx(f[263].x, f[263].y);
      if (e1x > e2x) { const tx = e1x, ty = e1y; e1x = e2x; e1y = e2y; e2x = tx; e2y = ty; }
      const roll = Math.atan2(e2y - e1y, e2x - e1x); // 0 upright; sign follows tilt
      const tgx = Math.sin(roll) * GRAVITY, tgy = Math.cos(roll) * GRAVITY;
      this.gx += (tgx - this.gx) * Math.min(1, dt * 6);
      this.gy += (tgy - this.gy) * Math.min(1, dt * 6);
    } else {
      this.head.clear();
      this.gx += (0 - this.gx) * Math.min(1, dt * 6);
      this.gy += (GRAVITY - this.gy) * Math.min(1, dt * 6);
    }

    // ---- palm colliders + gesture mode ----
    const seen = [false, false];
    for (let h = 0; h < this.handsRaw.length && h < 2; h++) {
      const lms = this.handsRaw[h]; if (!lms || lms.length < 21) continue;
      const c = palmCenter(lms);
      const [px, py] = this.toPx(c.x, c.y);
      const [m9x, m9y] = this.toPx(lms[9].x, lms[9].y);
      const sz = Math.hypot(m9x - px, m9y - py);
      const open = handOpenness(lms);
      this.palms[h].set(px, py, Math.max(45, sz * 1.7), dt);
      this.palms[h].mode = open > 0.55 ? 1 : (open < 0.3 ? -1 : 0); // ✋=1 blow, ✊=-1 pull
      seen[h] = true;
    }
    for (let h = 0; h < 2; h++) if (!seen[h]) this.palms[h].clear();

    // ---- grab / hold / throw ----
    // Release balls whose hand opened (✋) or vanished — opening throws them.
    for (let i = 0; i < BALL_COUNT; i++) {
      const hb = this.heldBy[i]; if (hb < 0) continue;
      const p = this.palms[hb];
      if (!p.active || p.mode === 1) {
        this.heldBy[i] = -1;
        if (p.active) { this.bvx[i] += p.vx * THROW_K; this.bvy[i] += p.vy * THROW_K; }
      }
    }
    // A fist (✊) grabs free balls within reach → they stick to that hand.
    for (let h = 0; h < 2; h++) {
      const p = this.palms[h];
      if (!p.active || p.mode !== -1) continue;
      const gr = p.r * 2.2, gr2 = gr * gr;
      for (let i = 0; i < BALL_COUNT; i++) {
        if (this.heldBy[i] !== -1) continue;
        const dx = this.bx[i] - p.x, dy = this.by[i] - p.y;
        if (dx * dx + dy * dy < gr2) this.heldBy[i] = h;
      }
    }

    this.simulate(dt, W, H);
    this.draw();

    let held = 0; for (let i = 0; i < BALL_COUNT; i++) if (this.heldBy[i] >= 0) held++;
    const grav = covered ? 'FACE COVERED · gravity flipped' : 'tilt head = gravity';
    const hands = this.palms.some((p) => p.active)
      ? `✊ grab · ✋ throw${held ? ` · holding ${held}` : ''}`
      : 'show hands to grab';
    ctx.setHud(`SANDBOX · ${grav} · ${hands}`);
  }

  simulate(dt, W, H) {
    const { bx, by, bvx, bvy, br } = this;
    const colliders = [this.head, this.palms[0], this.palms[1]];

    // integrate + gesture forces + collider fling
    for (let i = 0; i < BALL_COUNT; i++) {
      // held balls ignore gravity/forces — they spring to (and ride) the hand
      const hb = this.heldBy[i];
      if (hb >= 0 && this.palms[hb].active) {
        const p = this.palms[hb];
        bvx[i] = (p.x - bx[i]) * HOLD_K;
        bvy[i] = (p.y - by[i]) * HOLD_K;
        bx[i] += bvx[i] * dt; by[i] += bvy[i] * dt;
        continue;
      }

      bvx[i] += this.gx * dt;
      bvy[i] += this.gy * dt;

      for (const p of this.palms) {
        if (!p.active || p.mode === 0) continue;
        const dx = p.x - bx[i], dy = p.y - by[i];
        const d2 = dx * dx + dy * dy, d = Math.sqrt(d2) + 1e-3;
        if (d > FORCE_R) continue;
        const fall = 1 - d / FORCE_R;
        const acc = (p.mode === -1 ? MAGNET_ACC : -BLOW_ACC) * fall / d;
        bvx[i] += dx * acc * dt;
        bvy[i] += dy * acc * dt;
      }

      bvx[i] *= DAMP; bvy[i] *= DAMP;
      bx[i] += bvx[i] * dt; by[i] += bvy[i] * dt;
    }

    // walls
    for (let i = 0; i < BALL_COUNT; i++) {
      const r = br[i];
      if (bx[i] < r) { bx[i] = r; if (bvx[i] < 0) bvx[i] = -bvx[i] * WALL_REST; }
      else if (bx[i] > W - r) { bx[i] = W - r; if (bvx[i] > 0) bvx[i] = -bvx[i] * WALL_REST; }
      if (by[i] < r) { by[i] = r; if (bvy[i] < 0) bvy[i] = -bvy[i] * WALL_REST; }
      else if (by[i] > H - r) { by[i] = H - r; if (bvy[i] > 0) bvy[i] = -bvy[i] * WALL_REST; }
    }

    // colliders (head / palms): push balls out + impart collider velocity
    for (const c of colliders) {
      if (!c.active) continue;
      for (let i = 0; i < BALL_COUNT; i++) {
        if (this.heldBy[i] >= 0) continue;       // held balls are glued to a hand
        const dx = bx[i] - c.x, dy = by[i] - c.y;
        const min = c.r + br[i];
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) + 1e-3;
        const nx = dx / d, ny = dy / d;
        bx[i] = c.x + nx * min; by[i] = c.y + ny * min;        // push out
        const rel = bvx[i] * nx + bvy[i] * ny;                  // remove inward vel
        if (rel < 0) { bvx[i] -= rel * nx; bvy[i] -= rel * ny; }
        bvx[i] += c.vx * HAND_FLING; bvy[i] += c.vy * HAND_FLING; // fling
      }
    }

    // ball-ball via uniform-grid broadphase (2 relaxation passes)
    const cell = BALL_RMAX * 2;
    const grid = new Map();
    const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
    for (let i = 0; i < BALL_COUNT; i++) {
      const k = key(Math.floor(bx[i] / cell), Math.floor(by[i] / cell));
      let arr = grid.get(k); if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(i);
    }
    const pairs = [];
    for (let i = 0; i < BALL_COUNT; i++) {
      const cx = Math.floor(bx[i] / cell), cy = Math.floor(by[i] / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const arr = grid.get(key(cx + ox, cy + oy)); if (!arr) continue;
        for (const j of arr) if (j > i) pairs.push(i, j);
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let p = 0; p < pairs.length; p += 2) {
        const i = pairs[p], j = pairs[p + 1];
        let dx = bx[j] - bx[i], dy = by[j] - by[i];
        const min = br[i] + br[j];
        let d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const overlap = (min - d) * 0.5;
        bx[i] -= nx * overlap; by[i] -= ny * overlap;
        bx[j] += nx * overlap; by[j] += ny * overlap;
        // exchange normal velocity (equal mass, restitution)
        const rvi = bvx[i] * nx + bvy[i] * ny, rvj = bvx[j] * nx + bvy[j] * ny;
        if (rvi - rvj > 0) {
          const imp = (rvi - rvj) * (1 + BALL_REST) * 0.5;
          bvx[i] -= imp * nx; bvy[i] -= imp * ny;
          bvx[j] += imp * nx; bvy[j] += imp * ny;
        }
      }
    }
  }

  draw() {
    const d = this._dummy;
    for (let i = 0; i < BALL_COUNT; i++) {
      d.position.set(this.bx[i], this.by[i], 2);
      d.scale.set(this.br[i] * 2.2, this.br[i] * 2.2, 1);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (scene && this.mesh) scene.remove(this.mesh);
    this.mesh?.geometry.dispose();
    this.mat?.dispose();
    this.tex?.dispose();
    this.mesh = null;
  }
}

// ===========================================================================
// Preview painter — a pile of candy balls with a face + hand nudging them.
// ===========================================================================
function preview(c) {
  const W = 320, H = 320;
  c.fillStyle = '#0c0e14'; c.fillRect(0, 0, W, H);
  const palette = ['#ff5d73', '#ffd23f', '#4ad6c8', '#5b8cff', '#c77dff', '#8aff80', '#ff9f45'];
  // a settled pile at the bottom
  const balls = [];
  let y = H - 24;
  for (let row = 0; row < 5; row++) {
    const r = 26 - row * 2;
    for (let x = 24 + (row % 2) * r; x < W - 20; x += r * 2 + 4) {
      balls.push({ x: x + (Math.random() - 0.5) * 6, y: y - (Math.random() * 6), r, col: palette[(Math.random() * palette.length) | 0] });
    }
    y -= r * 1.7;
  }
  // a few mid-air
  for (let i = 0; i < 6; i++) balls.push({ x: 40 + Math.random() * (W - 80), y: 40 + Math.random() * 120, r: 16 + Math.random() * 10, col: palette[(Math.random() * palette.length) | 0] });
  for (const b of balls) {
    const g = c.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, b.col); g.addColorStop(1, 'rgba(0,0,0,0.25)');
    c.fillStyle = g; c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill();
  }
  // face silhouette
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.beginPath(); c.ellipse(W / 2, 120, 52, 66, 0, 0, Math.PI * 2); c.fill();
  // hand hint
  c.fillStyle = 'rgba(255,255,255,0.16)';
  c.beginPath(); c.arc(238, 150, 26, 0, Math.PI * 2); c.fill();
}

export default {
  id: 'Sandbox',
  title: 'SANDBOX',
  subtitle: 'TILT & SWAT · YOU ARE THE PHYSICS',
  category: 'FACE',
  factory: () => new Sandbox(),
  preview,
};
