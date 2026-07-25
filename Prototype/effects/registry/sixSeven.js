import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ============================================================================
// SIX SEVEN — the "6 7" brainrot meme. Hold up two open palms (the six-seven
// pose) and a giant neon 6 pops over one hand, a 7 over the other, while a
// storm of little 6s / 7s and sparkles erupts from both hands. Drop your hands
// and it drains away fast. Localised to the hands so the call stays usable.
// ============================================================================

const OPEN_MIN = 3;            // fingers (of index/middle/ring/pinky) extended to count as "open palm"
const PALM_IDXS = [0, 5, 9, 13, 17];

function palmCenter(lms) {
  let x = 0, y = 0;
  for (const i of PALM_IDXS) { x += lms[i].x; y += lms[i].y; }
  return { x: x / PALM_IDXS.length, y: y / PALM_IDXS.length };
}

// Count extended fingers: a fingertip is "extended" when it sits farther from
// the wrist than its PIP joint. Thumb ignored (unreliable side-on).
function fingersOpen(lms) {
  const w = lms[0], d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let n = 0;
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) {
    if (d(lms[tip], w) > d(lms[pip], w) * 1.12) n++;
  }
  return n;
}

// Bold glyph baked to a transparent texture: white fill + dark outline, so a
// per-instance neon tint reads as a bright number with a crisp readable edge.
function digitTexture(ch) {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);
  c.font = '900 104px Arial Black, Arial, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = 12;
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.strokeText(ch, S / 2, S / 2 + 6);
  c.fillStyle = '#ffffff';
  c.fillText(ch, S / 2, S / 2 + 6);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// ---------------------------------------------------------------------------
// Instanced pool of flying digits. Each slot pops in, arcs out under gravity,
// spins, cycles hue, and shrinks out over the tail of its life.
// ---------------------------------------------------------------------------
class DigitPool {
  constructor(scene, texture, capacity) {
    this.capacity = capacity;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, alphaTest: 0.04, depthTest: false,
      blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = capacity;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) { this.mesh.setMatrixAt(i, hide); this.mesh.instanceColor.setXYZ(i, 1, 1, 1); }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.col = new THREE.Color();
    this.particles = Array.from({ length: capacity }, () => ({ life: 0 }));
  }

  spawn(px, py, hue) {
    const s = this.particles.find((p) => p.life <= 0);
    if (!s) return;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;      // mostly upward-fan
    const sp = 120 + Math.random() * 260;
    s.life = s.maxLife = 0.7 + Math.random() * 0.5;
    s.age = 0;
    s.x = px + (Math.random() - 0.5) * 40;
    s.y = py + (Math.random() - 0.5) * 30;
    s.vx = Math.cos(a) * sp;
    s.vy = Math.sin(a) * sp - 60;
    s.rot = (Math.random() - 0.5) * 0.8;
    s.rotV = (Math.random() - 0.5) * 8;
    s.size = 34 + Math.random() * 30;
    s.hue = hue + (Math.random() - 0.5) * 0.12;
  }

  update(dt) {
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (p.life <= 0) { this.mesh.setMatrixAt(i, hide); continue; }
      p.life -= dt; p.age += dt;
      if (p.life <= 0) { this.mesh.setMatrixAt(i, hide); continue; }
      p.vy += 520 * dt; p.vx *= 0.99;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.rotV * dt;
      const t = p.life / p.maxLife;                 // 1 fresh -> 0 dead
      const grow = Math.min(1, p.age / 0.12);        // pop in
      const tail = Math.min(1, t * 4);               // shrink out last quarter
      this.col.setHSL((p.hue + p.age * 0.6) % 1, 0.95, 0.62);
      this.mesh.instanceColor.setXYZ(i, this.col.r, this.col.g, this.col.b);
      const s = p.size * grow * tail * (0.92 + 0.12 * Math.sin(p.age * 22));
      this.dummy.position.set(p.x, p.y, 6);
      this.dummy.scale.set(s, s, 1);
      this.dummy.rotation.set(0, 0, p.rot);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(scene) { this.mesh.geometry.dispose(); this.mat.dispose(); scene.remove(this.mesh); }
}

// ---------------------------------------------------------------------------
// Additive neon sparkle dots.
// ---------------------------------------------------------------------------
class SparklePool {
  constructor(scene, capacity) {
    this.capacity = capacity;
    const geo = new THREE.CircleGeometry(1, 10);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, capacity);
    this.mesh.frustumCulled = false; this.mesh.count = capacity;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) { this.mesh.setMatrixAt(i, hide); }
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D(); this.col = new THREE.Color();
    this.particles = Array.from({ length: capacity }, () => ({ life: 0 }));
  }

  spawn(px, py) {
    const s = this.particles.find((p) => p.life <= 0);
    if (!s) return;
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 200;
    s.life = s.maxLife = 0.4 + Math.random() * 0.4; s.age = 0;
    s.x = px; s.y = py; s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp;
    s.size = 3 + Math.random() * 5; s.hue = Math.random();
  }

  update(dt) {
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (p.life <= 0) { this.mesh.setMatrixAt(i, hide); continue; }
      p.life -= dt; p.age += dt;
      if (p.life <= 0) { this.mesh.setMatrixAt(i, hide); continue; }
      p.vy += 120 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const t = p.life / p.maxLife;
      this.col.setHSL(p.hue, 0.9, 0.6 + 0.3 * Math.random());
      this.mesh.instanceColor.setXYZ(i, this.col.r * t, this.col.g * t, this.col.b * t);
      const s = p.size * (0.4 + 0.6 * t);
      this.dummy.position.set(p.x, p.y, 5);
      this.dummy.scale.set(s, s, 1); this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(scene) { this.mesh.geometry.dispose(); this.mat.dispose(); scene.remove(this.mesh); }
}

// One giant number that rides a hand: a bright tinted glyph + an additive glow
// behind it. `present` ramps in/out so it pops on and snaps off with the hand.
class Anchor {
  constructor(scene, texture) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.glowMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.6, depthTest: false, blending: THREE.AdditiveBlending });
    this.coreMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.04, depthTest: false, blending: THREE.NormalBlending });
    this.glow = new THREE.Mesh(geo, this.glowMat); this.glow.position.z = 6; this.glow.visible = false;
    this.core = new THREE.Mesh(geo, this.coreMat); this.core.position.z = 7; this.core.visible = false;
    scene.add(this.glow); scene.add(this.core);
    this.present = 0; this.x = 0; this.y = 0;
  }

  update(dt, active, px, py, hue) {
    this.present += (active ? 10 : -9) * dt;
    this.present = Math.max(0, Math.min(1, this.present));
    if (active) { this.x = px; this.y = py; }
    const p = this.present;
    if (p <= 0.001) { this.glow.visible = this.core.visible = false; return; }
    this.glow.visible = this.core.visible = true;
    const t = performance.now() / 1000;
    const base = 150, pulse = 1 + 0.12 * Math.sin(t * 9);
    // ease-out-back pop
    const ease = p < 1 ? 1 - Math.pow(1 - p, 3) : 1;
    const s = base * ease * pulse;
    const col = new THREE.Color().setHSL((hue + t * 0.25) % 1, 0.95, 0.6);
    this.coreMat.color.copy(col);
    this.glowMat.color.copy(col);
    this.glowMat.opacity = 0.55 * p;
    const rot = Math.sin(t * 3 + hue * 6) * 0.14;
    for (const [mesh, sc] of [[this.glow, 1.28], [this.core, 1.0]]) {
      mesh.position.set(this.x, this.y, mesh.position.z);
      mesh.scale.set(s * sc, s * sc, 1);
      mesh.rotation.z = rot;
    }
  }

  dispose(scene) { this.glow.geometry.dispose(); this.glowMat.dispose(); this.coreMat.dispose(); scene.remove(this.glow); scene.remove(this.core); }
}

class SixSeven extends Tracker {
  constructor() {
    super({ kind: 'hand', numHands: 2 });
    this.emit = 0;
    this.wasActive = false;
  }

  async setup(ctx) {
    this.tex6 = digitTexture('6');
    this.tex7 = digitTexture('7');
    this.pool6 = new DigitPool(ctx.scene, this.tex6, 90);
    this.pool7 = new DigitPool(ctx.scene, this.tex7, 90);
    this.sparks = new SparklePool(ctx.scene, 160);
    this.anchor6 = new Anchor(ctx.scene, this.tex6);   // hue ~ magenta
    this.anchor7 = new Anchor(ctx.scene, this.tex7);   // hue ~ cyan
  }

  frame(hands, dt) {
    // Collect open palms with their pixel-space palm centres.
    const open = [];
    for (const lms of hands) {
      if (!lms) continue;
      if (fingersOpen(lms) < OPEN_MIN) continue;
      const c = palmCenter(lms);
      const [px, py] = this.toPx(c.x, c.y);
      open.push({ px, py });
    }

    const active = open.length >= 2;
    let left = null, right = null;
    if (active) {
      open.sort((a, b) => a.px - b.px);           // screen-left first => "6", right => "7"
      left = open[0];
      right = open[open.length - 1];
      // Numbers ride a little ABOVE the palms so the hands stay visible.
      const yOff = 70;
      // Onset burst — the "moment".
      if (!this.wasActive) {
        for (const h of [left, right]) {
          for (let i = 0; i < 14; i++) this.sparks.spawn(h.px, h.py - yOff);
          for (let i = 0; i < 5; i++) { this.pool6.spawn(h.px, h.py - yOff, 0.86); this.pool7.spawn(h.px, h.py - yOff, 0.5); }
        }
      }
      // Steady emission from both hands while held.
      this.emit += dt * 26;
      while (this.emit >= 1) {
        this.emit -= 1;
        for (const h of [left, right]) {
          this.pool6.spawn(h.px, h.py - yOff, 0.86);
          this.pool7.spawn(h.px, h.py - yOff, 0.5);
          this.sparks.spawn(h.px + (Math.random() - 0.5) * 60, h.py - yOff + (Math.random() - 0.5) * 60);
        }
      }
      this.anchor6.update(dt, true, left.px, left.py - yOff, 0.86);
      this.anchor7.update(dt, true, right.px, right.py - yOff, 0.5);
    } else {
      this.anchor6.update(dt, false, 0, 0, 0.86);
      this.anchor7.update(dt, false, 0, 0, 0.5);
    }
    this.wasActive = active;

    this.pool6.update(dt); this.pool7.update(dt); this.sparks.update(dt);
    this.ctx.setHud(active ? 'SIX SEVEN 🔥 6️⃣7️⃣' : 'SIX SEVEN — hold up both open palms');
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (!scene) return;
    for (const o of [this.pool6, this.pool7, this.sparks, this.anchor6, this.anchor7]) o?.dispose(scene);
    this.pool6 = this.pool7 = this.sparks = this.anchor6 = this.anchor7 = null;
  }
}

// ---------------------------------------------------------------------------
// Preview painter — big neon 6 7 with sparkles.
// ---------------------------------------------------------------------------
function preview(ctx) {
  const W = 320, H = 320;
  ctx.fillStyle = '#0a0612'; ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, 220);
  vg.addColorStop(0, 'rgba(80,20,90,0.4)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  // sparkles
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W, y = Math.random() * H, s = 1 + Math.random() * 3;
    ctx.fillStyle = `hsl(${(Math.random() * 360) | 0},95%,65%)`;
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  const drawGlyph = (ch, x, hue) => {
    ctx.font = '900 150px Arial Black, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(ch, x, H / 2);
    ctx.fillStyle = `hsl(${hue},95%,62%)`;
    ctx.fillText(ch, x, H / 2);
  };
  drawGlyph('6', W * 0.32, 310);
  drawGlyph('7', W * 0.68, 190);
}

export default {
  id: 'SixSeven',
  title: 'SIX SEVEN',
  subtitle: 'OPEN BOTH PALMS · 6 7 ERUPTS',
  category: 'HAND',
  factory: () => new SixSeven(),
  preview,
};
