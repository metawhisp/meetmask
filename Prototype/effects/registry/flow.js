import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ============================================================================
// FLOW — a curl-noise flow field rendered as thousands of glowing ink trails,
// steered live by your hands.
//
//   * The field is a divergence-free velocity field derived from an analytic
//     stream function ψ(x,y,t): velocity = ( ∂ψ/∂y , -∂ψ/∂x ). Because it is
//     a true curl, particles never converge/pile up — they flow in smooth,
//     swirling currents (the classic generative-art "flow field").
//   * ~2400 particles drift along the field. Each keeps a short position
//     history drawn as a fading additive poly-trail, so the whole field reads
//     as luminous aurora ribbons over the dimmed camera.
//   * Each detected palm becomes a local force: a swirl (vortex) plus a radial
//     term whose sign follows the hand's openness —
//         ✊ fist        → pull inward + strong swirl (a vortex that sucks)
//         ✋ open palm    → push outward (a fountain that blows the ink away)
//     With no hands the field just breathes on its own.
//
// Orientation (AGENTS.md §12): this effect never paints the video itself — the
// live camera shows behind the transparent canvas (wantsRawVideo). All trails
// live in pixel space placed via toPx(), which is already mirror-aware, so the
// swarm lines up with the hand the user sees. No uVideo / no Y-flip to manage.
// ============================================================================

const N_PARTICLES = 2400;   // trail count
const HISTORY     = 8;      // points kept per trail (HISTORY-1 segments)
const FIELD_SCALE = 0.0042; // spatial frequency of the base field (1/px)
const FIELD_SPEED = 150;    // base drift speed (px/s)
const HAND_RADIUS = 230;    // px — influence falloff of a palm
const HAND_SPEED  = 720;    // px/s — peak velocity a palm imparts
const TRAIL_GAIN  = 0.85;   // overall brightness of the additive trails
const LIFE_MIN    = 2.5;    // s — particle lifetime before a fresh respawn
const LIFE_MAX    = 6.0;

// MediaPipe hand landmarks: 0=wrist, 9=middle-finger MCP; 8/12/16/20 fingertips.
// Palm center = mean of wrist + the four finger-base knuckles (pose-stable).
const PALM_IDXS = [0, 5, 9, 13, 17];
const TIP_IDXS  = [8, 12, 16, 20];

function palmCenter(lms) {
  let x = 0, y = 0;
  for (const i of PALM_IDXS) { x += lms[i].x; y += lms[i].y; }
  return { x: x / PALM_IDXS.length, y: y / PALM_IDXS.length };
}

// Openness ∈ [0,1]: mean fingertip distance from the palm, normalised by hand
// size (wrist→middle-MCP) so it is scale-invariant. Fist ≈ 0, spread hand ≈ 1.
function handOpenness(lms) {
  const c = palmCenter(lms);
  const size = Math.hypot(lms[9].x - lms[0].x, lms[9].y - lms[0].y) || 1e-3;
  let sum = 0;
  for (const i of TIP_IDXS) sum += Math.hypot(lms[i].x - c.x, lms[i].y - c.y);
  const ratio = (sum / TIP_IDXS.length) / size;
  // Empirical: fist ratio ≈ 1.0, open hand ≈ 2.0.
  return Math.max(0, Math.min(1, (ratio - 1.15) / 0.75));
}

// ---------------------------------------------------------------------------
// Analytic stream function and its curl. Coordinates are pre-scaled by
// FIELD_SCALE; `t` is seconds. Returns a UNIT-ish velocity (vx, vy).
// ---------------------------------------------------------------------------
function fieldVelocity(x, y, t, out) {
  const nx = x * FIELD_SCALE;
  const ny = y * FIELD_SCALE;
  // ψ = Σ Aᵢ·sin( aᵢ·nx + bᵢ·ny + ωᵢ·t )
  // dψ/dx = Σ Aᵢ·aᵢ·cos(...)   ;   dψ/dy = Σ Aᵢ·bᵢ·cos(...)
  const p1 = Math.cos(1.0 * nx + 0.7 * ny + 0.30 * t);
  const p2 = Math.cos(-0.5 * nx + 1.3 * ny - 0.23 * t);
  const p3 = Math.cos(0.6 * nx + 0.6 * ny + 0.17 * t);
  const dPsi_dx = 1.0 * 1.0 * p1 + 0.9 * (-0.5) * p2 + 0.6 * 0.6 * p3;
  const dPsi_dy = 1.0 * 0.7 * p1 + 0.9 * (1.3) * p2 + 0.6 * 0.6 * p3;
  out.x = dPsi_dy;    // velocity = curl(ψ)
  out.y = -dPsi_dx;
}

class Flow extends Tracker {
  constructor() {
    super({ kind: 'hand', numHands: 2 });
    this.time = 0;
    this.hands = [];           // [{x,y,open}] in pixel space, persists between detections
    // Flat particle state.
    this.px = new Float32Array(N_PARTICLES);
    this.py = new Float32Array(N_PARTICLES);
    this.life = new Float32Array(N_PARTICLES);
    this.hue = new Float32Array(N_PARTICLES);
    // Position history ring (newest at j=0). hx[i*HISTORY + j].
    this.hx = new Float32Array(N_PARTICLES * HISTORY);
    this.hy = new Float32Array(N_PARTICLES * HISTORY);
    this._v = { x: 0, y: 0 };
    this._col = new THREE.Color();
  }

  async setup(ctx) {
    const W = ctx.width, H = ctx.height;

    // --- Dim plate: darken the camera so the glow ribbons pop (normal blend) ---
    this.dimMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.5,
      depthTest: false, depthWrite: false,
    });
    this.dimGeo = new THREE.PlaneGeometry(W, H);
    this.dim = new THREE.Mesh(this.dimGeo, this.dimMat);
    this.dim.position.set(W / 2, H / 2, 0);
    this.dim.renderOrder = 0;
    this.dim.frustumCulled = false;
    ctx.scene.add(this.dim);

    // --- Trails: one LineSegments holding every trail's segments ---
    const segs = N_PARTICLES * (HISTORY - 1);
    this.posAttr = new THREE.BufferAttribute(new Float32Array(segs * 2 * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(segs * 2 * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    this.trailGeo = geo;
    this.trailMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    });
    this.trails = new THREE.LineSegments(geo, this.trailMat);
    this.trails.frustumCulled = false;
    this.trails.renderOrder = 1;
    ctx.scene.add(this.trails);

    // Seed all particles at random positions, history collapsed to that point.
    for (let i = 0; i < N_PARTICLES; i++) this.respawn(i, W, H, true);
  }

  respawn(i, W, H, scatter) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    this.px[i] = x; this.py[i] = y;
    this.life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    this.hue[i] = Math.random();
    const base = i * HISTORY;
    for (let j = 0; j < HISTORY; j++) { this.hx[base + j] = x; this.hy[base + j] = y; }
    if (!scatter) this.life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
  }

  // Read latest hand landmarks (called by Tracker.update when a new frame lands).
  frame(hands, _dt) {
    const list = [];
    for (const lms of hands) {
      if (!lms || lms.length < 21) continue;
      const c = palmCenter(lms);
      const [x, y] = this.toPx(c.x, c.y);
      list.push({ x, y, open: handOpenness(lms) });
    }
    this.hands = list;
  }

  // Drive detection (super) then advance the simulation every animation frame.
  update(dt) {
    super.update(dt);
    this.step(Math.min(dt, 0.05));
  }

  step(dt) {
    const { ctx } = this;
    if (!ctx) return;
    const W = ctx.width, H = ctx.height;
    this.time += dt;
    const t = this.time;
    const v = this._v;
    const hueDrift = t * 0.03;

    const posArr = this.posAttr.array;
    const colArr = this.colAttr.array;
    let o = 0; // write cursor into the segment buffers

    for (let i = 0; i < N_PARTICLES; i++) {
      // ---- integrate velocity = field + hand forces ----
      fieldVelocity(this.px[i], this.py[i], t, v);
      let vx = v.x * FIELD_SPEED;
      let vy = v.y * FIELD_SPEED;
      let speedBoost = 0;

      for (let h = 0; h < this.hands.length; h++) {
        const hand = this.hands[h];
        const dx = this.px[i] - hand.x;
        const dy = this.py[i] - hand.y;
        const r2 = dx * dx + dy * dy;
        const r = Math.sqrt(r2) + 1e-3;
        const falloff = Math.exp(-r2 / (2 * HAND_RADIUS * HAND_RADIUS));
        if (falloff < 0.004) continue;
        const ux = dx / r, uy = dy / r;          // radial unit (outward)
        const radialSign = hand.open * 2 - 1;    // open→+1 push, fist→-1 pull
        const swirl = 0.9 - 0.35 * hand.open;    // fist swirls harder
        // swirl (perpendicular) + radial
        vx += falloff * HAND_SPEED * (swirl * -uy + radialSign * 0.8 * ux);
        vy += falloff * HAND_SPEED * (swirl *  ux + radialSign * 0.8 * uy);
        speedBoost = Math.max(speedBoost, falloff);
      }

      let nx = this.px[i] + vx * dt;
      let ny = this.py[i] + vy * dt;

      // ---- wrap at edges; collapse history on wrap to avoid cross-screen streaks ----
      let wrapped = false;
      if (nx < 0) { nx += W; wrapped = true; }
      else if (nx >= W) { nx -= W; wrapped = true; }
      if (ny < 0) { ny += H; wrapped = true; }
      else if (ny >= H) { ny -= H; wrapped = true; }

      this.px[i] = nx; this.py[i] = ny;

      const base = i * HISTORY;
      if (wrapped) {
        for (let j = 0; j < HISTORY; j++) { this.hx[base + j] = nx; this.hy[base + j] = ny; }
      } else {
        for (let j = HISTORY - 1; j > 0; j--) {
          this.hx[base + j] = this.hx[base + j - 1];
          this.hy[base + j] = this.hy[base + j - 1];
        }
        this.hx[base] = nx; this.hy[base] = ny;
      }

      // ---- lifetime ----
      this.life[i] -= dt;
      if (this.life[i] <= 0) this.respawn(i, W, H, false);

      // ---- colour: hue from velocity direction, brighter near hands / when fast ----
      const ang = Math.atan2(vy, vx);
      const hue = (this.hue[i] * 0.15 + ang / (Math.PI * 2) + hueDrift + 0.5) % 1;
      const speed = Math.hypot(vx, vy);
      const lum = Math.min(0.78, 0.42 + speed / 4200 + speedBoost * 0.4);
      this._col.setHSL((hue + 1) % 1, 0.85, lum);
      const cr = this._col.r, cg = this._col.g, cb = this._col.b;

      // ---- emit segments with a tail fade (additive ⇒ darker = fades out) ----
      for (let j = 0; j < HISTORY - 1; j++) {
        const fade = (1 - j / (HISTORY - 1)) * TRAIL_GAIN; // 1 at head → 0 at tail
        const a = base + j, b = base + j + 1;
        // vertex A
        posArr[o] = this.hx[a]; posArr[o + 1] = this.hy[a]; posArr[o + 2] = 1;
        colArr[o] = cr * fade; colArr[o + 1] = cg * fade; colArr[o + 2] = cb * fade;
        o += 3;
        // vertex B (slightly dimmer = next fade step)
        const fadeB = (1 - (j + 1) / (HISTORY - 1)) * TRAIL_GAIN;
        posArr[o] = this.hx[b]; posArr[o + 1] = this.hy[b]; posArr[o + 2] = 1;
        colArr[o] = cr * fadeB; colArr[o + 1] = cg * fadeB; colArr[o + 2] = cb * fadeB;
        o += 3;
      }
    }

    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;

    const hint = this.hands.length
      ? this.hands.map((h) => (h.open > 0.5 ? '✋push' : '✊pull')).join(' ')
      : 'show your hands to steer';
    ctx.setHud(`FLOW · ${this.hands.length} hand(s) · ${hint}`);
  }

  resize(w, h) {
    super.resize(w, h);
    if (this.dim) {
      this.dimGeo.dispose();
      this.dimGeo = new THREE.PlaneGeometry(w, h);
      this.dim.geometry = this.dimGeo;
      this.dim.position.set(w / 2, h / 2, 0);
    }
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (scene) {
      if (this.dim) scene.remove(this.dim);
      if (this.trails) scene.remove(this.trails);
    }
    this.dimGeo?.dispose();
    this.dimMat?.dispose();
    this.trailGeo?.dispose();
    this.trailMat?.dispose();
    this.dim = this.trails = null;
    this.dimGeo = this.dimMat = this.trailGeo = this.trailMat = null;
  }
}

// ===========================================================================
// Preview painter — aurora streaks swirling around two faint palms.
// ===========================================================================
function preview(c) {
  const W = 320, H = 320;
  const bg = c.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, 230);
  bg.addColorStop(0, '#0a1020');
  bg.addColorStop(1, '#03040a');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  // Two attractor centers the streaks curl around.
  const centers = [{ x: 108, y: 150 }, { x: 214, y: 176 }];
  c.globalCompositeOperation = 'lighter';
  c.lineWidth = 1.4;
  for (let s = 0; s < 220; s++) {
    // Start each streak somewhere random, integrate a fake curl toward a center.
    let x = (s * 53) % W;
    let y = (s * 97) % H;
    const ctr = centers[s % 2];
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 14; k++) {
      const dx = x - ctr.x, dy = y - ctr.y;
      const r = Math.hypot(dx, dy) + 1e-3;
      // swirl + gentle field
      const vx = -dy / r * 7 + Math.cos(y * 0.03 + s) * 3;
      const vy = dx / r * 7 + Math.sin(x * 0.03 + s) * 3;
      x += vx; y += vy;
      c.lineTo(x, y);
    }
    const hue = (s * 7 + 180) % 360;
    c.strokeStyle = `hsla(${hue},85%,62%,0.5)`;
    c.stroke();
  }
  c.globalCompositeOperation = 'source-over';

  // Faint palm glyphs at the centers.
  c.fillStyle = 'rgba(255,255,255,0.18)';
  for (const ctr of centers) {
    c.beginPath();
    c.arc(ctr.x, ctr.y, 16, 0, Math.PI * 2);
    c.fill();
  }
}

export default {
  id: 'Flow',
  title: 'FLOW',
  subtitle: 'CURL-FIELD INK · STEERED BY HAND',
  category: 'HAND',
  factory: () => new Flow(),
  preview,
};
