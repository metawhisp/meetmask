import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// FACE GRAVITY — face features melt downward via Verlet-like physics.
// Tilt the head to slide them sideways (gravity is world-down). Open the
// mouth wide to snap every landmark back to its rest position.

const MAX_LM = 478;

// Feature loops — each list is a polyline (consecutive pairs form line
// segments). The closing index repeats the first so the loop is sealed.
const FEATURE_LOOPS = [
  [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7, 33],
  [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249, 263],
  [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61],
  [70, 63, 105, 66, 107],
  [300, 293, 334, 296, 336],
];

// Flatten loops into ordered segment pairs (a, b) we can index per frame.
const LINE_PAIRS = (() => {
  const pairs = [];
  for (const loop of FEATURE_LOOPS) {
    for (let i = 0; i < loop.length - 1; i++) pairs.push([loop[i], loop[i + 1]]);
  }
  return pairs;
})();

// Physics tunables.
const GRAVITY = 250;     // px/s^2 downward (canvas Y axis is down)
const SPRING_K = 1.2;    // pulls curPx back toward restPx (per second^2 scale)
const DAMPING = 0.92;    // velocity decay per frame
const MOUTH_OPEN_RESET = 0.35;

class FaceGravity extends Tracker {
  constructor() {
    super({ kind: 'face' });
    this.dummy = new THREE.Object3D();
    // Per-landmark state. Float32Arrays for tight, GC-friendly buffers.
    this.restPx = new Float32Array(MAX_LM * 2);
    this.curPx  = new Float32Array(MAX_LM * 2);
    this.vel    = new Float32Array(MAX_LM * 2);
    this.initialised = false;
    this.activeCount = 0;
  }

  async setup(ctx) {
    // Dots — small white discs, additive blend.
    const dotGeo = new THREE.CircleGeometry(1, 10);
    this.dotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.dots = new THREE.InstancedMesh(dotGeo, this.dotMat, MAX_LM);
    this.dots.frustumCulled = false;
    // Per-instance colour so we can tint "fallen" dots red.
    const colors = new Float32Array(MAX_LM * 3);
    for (let i = 0; i < MAX_LM; i++) { colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1; }
    this.dots.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.dots.instanceColor.setUsage(THREE.DynamicDrawUsage);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_LM; i++) this.dots.setMatrixAt(i, hidden);
    this.dots.instanceMatrix.needsUpdate = true;
    ctx.scene.add(this.dots);

    // Feature lines — thin neon-cyan, glowing via additive.
    const positions = new Float32Array(LINE_PAIRS.length * 2 * 3);
    this.lineGeom = new THREE.BufferGeometry();
    this.lineGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.lineMat = new THREE.LineBasicMaterial({
      color: 0x4dfdff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.lineGeom, this.lineMat);
    this.lines.frustumCulled = false;
    ctx.scene.add(this.lines);

    ctx.setHud('GRAVITY · features melt · open mouth to reset · tilt for sideways slide');
  }

  resetAllToRest() {
    for (let i = 0; i < MAX_LM * 2; i++) {
      this.curPx[i] = this.restPx[i];
      this.vel[i] = 0;
    }
  }

  frame(faces, dt) {
    const ctx = this.ctx;
    const positions = this.lineGeom.attributes.position.array;
    const colors = this.dots.instanceColor ? this.dots.instanceColor.array : null;

    // No face: hide everything and reset internal state so re-acquire is clean.
    if (!faces.length) {
      if (this.activeCount) {
        const hide = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < this.activeCount; i++) this.dots.setMatrixAt(i, hide);
        this.dots.instanceMatrix.needsUpdate = true;
        this.activeCount = 0;
      }
      positions.fill(0);
      this.lineGeom.attributes.position.needsUpdate = true;
      this.initialised = false;
      ctx.setHud('GRAVITY · no face');
      return;
    }

    // Clamp dt so a long pause doesn't catapult features off-screen.
    const sdt = Math.min(0.05, Math.max(0.001, dt));

    const lms = faces[0];
    const n = Math.min(lms.length, MAX_LM);

    // 1. Update restPx from raw landmarks every frame.
    for (let i = 0; i < n; i++) {
      const lm = lms[i];
      const [px, py] = this.toPx(lm.x, lm.y);
      this.restPx[i * 2] = px;
      this.restPx[i * 2 + 1] = py;
    }

    // First frame after re-acquire: seed curPx = restPx, no velocity.
    if (!this.initialised) {
      this.resetAllToRest();
      this.initialised = true;
    }

    // 2. Tilt-aware gravity vector. eyeOuterR = 33, eyeOuterL = 263.
    // tilt = atan2(L.y - R.y, L.x - R.x). Rotate by -tilt so canvas-down
    // gravity becomes world-down regardless of head roll.
    const rEyeX = this.restPx[33 * 2],     rEyeY = this.restPx[33 * 2 + 1];
    const lEyeX = this.restPx[263 * 2],    lEyeY = this.restPx[263 * 2 + 1];
    const tilt  = Math.atan2(lEyeY - rEyeY, lEyeX - rEyeX);
    const cosT  = Math.cos(-tilt);
    const sinT  = Math.sin(-tilt);
    // Rotate (0, GRAVITY) by -tilt: gx = -sinT * GRAVITY, gy = cosT * GRAVITY.
    const gx = -sinT * GRAVITY;
    const gy =  cosT * GRAVITY;

    // 3. Mouth-open reset trigger. lm 13 (upper inner lip) <-> lm 14 (lower).
    // Normalise by face width (outer eye distance).
    const u = lms[13], l = lms[14];
    let openRatio = 0;
    if (u && l) {
      const [uxp, uyp] = this.toPx(u.x, u.y);
      const [lxp, lyp] = this.toPx(l.x, l.y);
      const faceWidth = Math.max(1, Math.hypot(lEyeX - rEyeX, lEyeY - rEyeY));
      openRatio = Math.hypot(uxp - lxp, uyp - lyp) / faceWidth;
    }
    const resetActive = openRatio > MOUTH_OPEN_RESET;
    if (resetActive) this.resetAllToRest();

    // 4. Verlet-ish integration: spring-back to rest plus rotated gravity,
    //    velocity damped each frame so motion settles into a sag.
    if (!resetActive) {
      const sk = SPRING_K;
      for (let i = 0; i < n; i++) {
        const ix = i * 2;
        const iy = ix + 1;
        const rx = this.restPx[ix], ry = this.restPx[iy];
        const cx = this.curPx[ix],  cy = this.curPx[iy];
        // Spring force pulls back toward rest, gravity pulls world-down.
        const fx = (rx - cx) * sk * 60 + gx;  // *60 to scale spring into px/s^2 territory
        const fy = (ry - cy) * sk * 60 + gy;
        // v += f * dt; v *= damping; p += v * dt.
        let vx = this.vel[ix] + fx * sdt;
        let vy = this.vel[iy] + fy * sdt;
        vx *= DAMPING;
        vy *= DAMPING;
        this.vel[ix] = vx;
        this.vel[iy] = vy;
        this.curPx[ix] = cx + vx * sdt;
        this.curPx[iy] = cy + vy * sdt;
      }
    }

    // 5. Render dots (and tint by displacement).
    const dotR = Math.max(2, Math.min(ctx.width, ctx.height) * 0.0035);
    const faceWidth = Math.max(1, Math.hypot(lEyeX - rEyeX, lEyeY - rEyeY));
    const tintDenom = Math.max(1, faceWidth * 0.5); // displacement that maps to "fully red"
    for (let i = 0; i < n; i++) {
      const ix = i * 2, iy = ix + 1;
      const cx = this.curPx[ix], cy = this.curPx[iy];
      this.dummy.position.set(cx, cy, 1);
      this.dummy.scale.setScalar(dotR);
      this.dummy.updateMatrix();
      this.dots.setMatrixAt(i, this.dummy.matrix);
      if (colors) {
        const dx = cx - this.restPx[ix];
        const dy = cy - this.restPx[iy];
        const d = Math.min(1, Math.hypot(dx, dy) / tintDenom);
        // White at rest, red-ish when fallen.
        colors[i * 3]     = 1.0;
        colors[i * 3 + 1] = 1.0 - d * 0.85;
        colors[i * 3 + 2] = 1.0 - d * 0.85;
      }
    }
    // Hide any extra slots from previous (longer) frames.
    if (n < this.activeCount) {
      const hide = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = n; i < this.activeCount; i++) this.dots.setMatrixAt(i, hide);
    }
    this.activeCount = n;
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;

    // 6. Feature lines from curPx — eyes, lips, brows.
    for (let i = 0; i < LINE_PAIRS.length; i++) {
      const [a, b] = LINE_PAIRS[i];
      const ax = this.curPx[a * 2],     ay = this.curPx[a * 2 + 1];
      const bx = this.curPx[b * 2],     by = this.curPx[b * 2 + 1];
      const o = i * 6;
      positions[o]     = ax; positions[o + 1] = ay; positions[o + 2] = 1;
      positions[o + 3] = bx; positions[o + 4] = by; positions[o + 5] = 1;
    }
    this.lineGeom.attributes.position.needsUpdate = true;

    // HUD: keep the spec text but add a brief reset cue when triggered.
    const base = 'GRAVITY · features melt · open mouth to reset · tilt for sideways slide';
    ctx.setHud(resetActive ? `${base}  · RESET!` : base);
  }

  teardown() {
    if (this.dots) {
      this.ctx.scene.remove(this.dots);
      this.dots.geometry.dispose();
    }
    if (this.dotMat) this.dotMat.dispose();
    if (this.lines) {
      this.ctx.scene.remove(this.lines);
      this.lineGeom.dispose();
    }
    if (this.lineMat) this.lineMat.dispose();
    this.dots = this.dotMat = this.lines = this.lineGeom = this.lineMat = null;
  }
}

// Procedural launcher preview — dark BG, oval face with droopy features.
function preview(c) {
  const W = 320, H = 320;
  // Dark backdrop with a soft radial vignette.
  c.fillStyle = '#0a0c14';
  c.fillRect(0, 0, W, H);
  const vg = c.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.7);
  vg.addColorStop(0, 'rgba(40,80,120,0.35)');
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = vg;
  c.fillRect(0, 0, W, H);

  // Face silhouette oval.
  c.strokeStyle = 'rgba(180,210,255,0.35)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.ellipse(W / 2, H * 0.5, W * 0.32, H * 0.40, 0, 0, Math.PI * 2);
  c.stroke();

  // Where features "should" be (faint ghost).
  c.strokeStyle = 'rgba(180,210,255,0.10)';
  c.beginPath(); c.ellipse(W * 0.40, H * 0.42, 14, 6, 0, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.ellipse(W * 0.60, H * 0.42, 14, 6, 0, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.ellipse(W / 2, H * 0.58, 22, 4, 0, 0, Math.PI * 2); c.stroke();

  // Brows, slid DOWN with a sad droop.
  c.strokeStyle = 'rgba(77,253,255,0.85)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(W * 0.32, H * 0.50);
  c.quadraticCurveTo(W * 0.40, H * 0.54, W * 0.48, H * 0.52);
  c.stroke();
  c.beginPath();
  c.moveTo(W * 0.52, H * 0.52);
  c.quadraticCurveTo(W * 0.60, H * 0.54, W * 0.68, H * 0.50);
  c.stroke();

  // Eyes — droopy, well below their ghost positions.
  c.strokeStyle = 'rgba(77,253,255,0.95)';
  c.beginPath();
  c.ellipse(W * 0.40, H * 0.60, 16, 5, 0.08, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.ellipse(W * 0.60, H * 0.60, 16, 5, -0.08, 0, Math.PI * 2);
  c.stroke();

  // Mouth — low, drooping like melting wax.
  c.strokeStyle = 'rgba(255,140,200,0.9)';
  c.lineWidth = 2.2;
  c.beginPath();
  c.moveTo(W * 0.36, H * 0.78);
  c.bezierCurveTo(W * 0.42, H * 0.90, W * 0.58, H * 0.90, W * 0.64, H * 0.78);
  c.bezierCurveTo(W * 0.58, H * 0.84, W * 0.42, H * 0.84, W * 0.36, H * 0.78);
  c.stroke();

  // Slip trails — small dots/streaks from the ghost slots down to the fallen ones.
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) {
    const lane = Math.random();
    const x = (lane < 0.33) ? W * 0.40 : (lane < 0.66) ? W * 0.60 : W * 0.50;
    const jitter = (Math.random() - 0.5) * 22;
    const yStart = H * 0.42 + Math.random() * 8;
    const yEnd = yStart + 6 + Math.random() * 32;
    const g = c.createLinearGradient(x + jitter, yStart, x + jitter, yEnd);
    g.addColorStop(0, 'rgba(77,253,255,0)');
    g.addColorStop(1, 'rgba(77,253,255,0.55)');
    c.strokeStyle = g;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x + jitter, yStart);
    c.lineTo(x + jitter, yEnd);
    c.stroke();
  }
  // Scattered fallen dots.
  for (let i = 0; i < 30; i++) {
    const x = W * 0.30 + Math.random() * W * 0.40;
    const y = H * 0.55 + Math.random() * H * 0.35;
    const r = 1 + Math.random() * 1.5;
    const g = c.createRadialGradient(x, y, 0, x, y, r * 3);
    const fallen = Math.random();
    const r1 = fallen > 0.6 ? 255 : 220;
    const g1 = fallen > 0.6 ? 90  : 240;
    const b1 = fallen > 0.6 ? 110 : 255;
    g.addColorStop(0, `rgba(${r1},${g1},${b1},0.9)`);
    g.addColorStop(1, `rgba(${r1},${g1},${b1},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r * 3, 0, Math.PI * 2);
    c.fill();
  }
  c.globalCompositeOperation = 'source-over';
}

export default {
  id: 'FaceGravity',
  title: 'FACE GRAVITY',
  subtitle: 'FEATURES MELT · OPEN MOUTH TO RESET',
  category: 'FACE',
  preview,
  factory: () => new FaceGravity(),
};
