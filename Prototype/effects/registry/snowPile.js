import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';
import { loadSelfieSegmenter } from '../core/mpLoader.js';

// SNOW PILE — snowflakes fall under gravity, stick when they hit the
// person's silhouette (selfie segmentation), and dump off when you shake
// your head fast (nose-tip velocity over recent frames).

const NUM_FLAKES = 200;
const NOSE_HISTORY = 5;
const SHAKE_VEL_PX_S = 800;
const SHAKE_HOLD_S = 0.2;
const GRAVITY = 150;          // px/s^2 downward (Y is down in canvas space)
const WIND_AMP = 30;          // px/s^2 horizontal wobble

class SnowPile extends Tracker {
  constructor() {
    super({ kind: 'face' });
    this.segmenter = null;
    this.lastMaskTime = -1;
    this.lastMask = null;       // { bytes, mw, mh }
    this.flakes = null;
    this.t = 0;
    this.noseHistory = [];      // recent {x,y,t}
    this.shakeTimer = 0;
  }

  async setup(ctx) {
    // Pre-create flakes scattered above the canvas; they'll rain in.
    this.flakes = new Array(NUM_FLAKES).fill(null).map((_, i) => ({
      x: Math.random() * ctx.width,
      y: -Math.random() * ctx.height,
      vx: (Math.random() - 0.5) * 20,
      vy: 30 + Math.random() * 60,
      size: 3 + Math.random() * 3,
      seed: i,
      stuck: false,
    }));

    // Anti-aliased disc texture so the flakes look soft, not blocky.
    const tex = makeFlakeTexture();
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: 0xeaf3ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    const geom = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xeaf3ff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    void mat; // sprite material kept as future option but not needed for instanced mesh

    this.mesh = new THREE.InstancedMesh(geom, this.mat, NUM_FLAKES);
    this.mesh.frustumCulled = false;
    this.mesh.count = NUM_FLAKES;
    ctx.scene.add(this.mesh);
    this.dummy = new THREE.Object3D();

    // Load segmenter lazily — first frames just rain without sticking.
    loadSelfieSegmenter().then((s) => { this.segmenter = s; }).catch(() => {});
  }

  // Map a canvas pixel back to a mask pixel index, mirroring-aware.
  maskIndexAt(px, py, vw, vh, mw, mh) {
    const cw = this.ctx.width, ch = this.ctx.height;
    const ca = cw / ch, va = vw / vh;
    let dispW, dispH, offX, offY;
    if (ca > va) { dispW = cw; dispH = cw / va; offX = 0; offY = (ch - dispH) / 2; }
    else        { dispH = ch; dispW = ch * va; offX = (cw - dispW) / 2; offY = 0; }
    const ux = (px - offX) / dispW;
    const vy = (py - offY) / dispH;
    if (ux < 0 || ux > 1 || vy < 0 || vy > 1) return -1;
    const lx = this.mirror ? (1 - ux) : ux;
    const mx = Math.min(mw - 1, Math.max(0, (lx * mw) | 0));
    const my = Math.min(mh - 1, Math.max(0, (vy * mh) | 0));
    return my * mw + mx;
  }

  frame(faces, dt) {
    this.t += dt;
    const ctx = this.ctx;
    const w = ctx.width, h = ctx.height;

    // -- 1. Refresh segmentation (own clock; safe across face frames).
    if (this.segmenter && ctx.video.readyState >= 2) {
      const ts = performance.now();
      if (ts - this.lastMaskTime > 33) {
        this.lastMaskTime = ts;
        try {
          const res = this.segmenter.segmentForVideo(ctx.video, ts);
          const mask = res && res.categoryMask;
          if (mask) {
            const bytes = mask.getAsUint8Array();
            this.lastMask = { bytes, mw: mask.width, mh: mask.height };
            if (mask.close) mask.close();
          }
        } catch (_e) { /* skip frame */ }
      }
    }

    // -- 2. Head-shake detection from nose-tip (landmark 1).
    if (faces.length) {
      const [nx, ny] = this.toPx(faces[0][1].x, faces[0][1].y);
      this.noseHistory.push({ x: nx, y: ny, t: this.t });
      while (this.noseHistory.length > NOSE_HISTORY) this.noseHistory.shift();
      if (this.noseHistory.length >= 2) {
        let speedSum = 0, samples = 0;
        for (let i = 1; i < this.noseHistory.length; i++) {
          const a = this.noseHistory[i - 1], b = this.noseHistory[i];
          const ddt = Math.max(1e-3, b.t - a.t);
          speedSum += Math.hypot(b.x - a.x, b.y - a.y) / ddt;
          samples++;
        }
        const avg = speedSum / Math.max(1, samples);
        if (avg > SHAKE_VEL_PX_S) {
          this.shakeTimer += dt;
          if (this.shakeTimer > SHAKE_HOLD_S) {
            // Avalanche! Release all stuck flakes with a tiny lateral kick.
            for (const f of this.flakes) {
              if (f.stuck) {
                f.stuck = false;
                f.vx = (Math.random() - 0.5) * 120;
                f.vy = 20 + Math.random() * 40;
              }
            }
            this.shakeTimer = 0;
          }
        } else {
          this.shakeTimer = Math.max(0, this.shakeTimer - dt * 0.5);
        }
      }
    } else {
      this.noseHistory.length = 0;
      this.shakeTimer = 0;
    }

    // -- 3. Integrate non-stuck flakes; check sticking against the mask.
    const mask = this.lastMask;
    const vw = ctx.video.videoWidth || 1280;
    const vh = ctx.video.videoHeight || 720;
    let stuck = 0;
    for (let i = 0; i < this.flakes.length; i++) {
      const f = this.flakes[i];
      if (!f.stuck) {
        f.vy += GRAVITY * dt;
        f.vx += Math.sin(this.t * 0.5 + f.seed) * WIND_AMP * dt;
        f.vx *= 0.995; // gentle drag so wind doesn't run away
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        // Off-screen: respawn at top, fresh random column.
        if (f.y > h + 12 || f.x < -20 || f.x > w + 20) {
          f.x = Math.random() * w;
          f.y = -10 - Math.random() * 40;
          f.vx = (Math.random() - 0.5) * 20;
          f.vy = 30 + Math.random() * 60;
        }
        // Sticking: only attempt when we have a mask and the flake is on-screen.
        if (mask && f.y > 0 && f.y < h && f.x > 0 && f.x < w) {
          const idx = this.maskIndexAt(f.x, f.y, vw, vh, mask.mw, mask.mh);
          if (idx >= 0 && mask.bytes[idx] === 255) {
            f.stuck = true;
            f.vx = 0;
            f.vy = 0;
          }
        }
      }
      if (f.stuck) stuck++;

      // Twinkle scale: stuck flakes shimmer slightly; falling ones are steady.
      const twinkle = f.stuck ? (0.85 + 0.15 * Math.sin(this.t * 4 + f.seed)) : 1.0;
      const s = f.size * twinkle * 2.4; // texture is 64px, sized down via scale
      this.dummy.position.set(f.x, f.y, 5);
      this.dummy.scale.set(s, s, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    ctx.setHud(`SNOW PILE · ${stuck} stuck · shake head to clear`);
  }

  teardown() {
    if (this.mesh) {
      this.ctx.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.mat) {
      if (this.mat.map) this.mat.map.dispose();
      this.mat.dispose();
    }
    this.mesh = null;
    this.mat = null;
    this.flakes = null;
    this.lastMask = null;
  }
}

// Small canvas texture: soft white disc with a hint of blue, radial falloff.
function makeFlakeTexture() {
  const size = 64;
  const cnv = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : null;
  if (!cnv) {
    // SSR/check fallback: return a 1x1 data texture.
    const data = new Uint8Array([255, 255, 255, 255]);
    const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  }
  cnv.width = cnv.height = size;
  const c = cnv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(220,235,255,0.85)');
  g.addColorStop(0.75, 'rgba(160,200,255,0.18)');
  g.addColorStop(1.0, 'rgba(160,200,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cnv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Procedural launcher preview.
function preview(c) {
  const W = 320, H = 320;
  // Dark blue night-sky background.
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#091228');
  bg.addColorStop(1, '#1a2a4a');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  // A faint silhouette outline where snow has collected (shoulders + head).
  c.fillStyle = 'rgba(255,255,255,0.06)';
  c.beginPath();
  c.ellipse(W / 2, H * 0.55, W * 0.32, H * 0.32, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(W / 2, H * 0.38, 44, 50, 0, 0, Math.PI * 2);
  c.fill();

  // Snow piled along the silhouette: brighter dots clustering near the
  // top of the head and shoulders.
  c.globalCompositeOperation = 'lighter';
  const stuckPoints = [];
  for (let i = 0; i < 70; i++) {
    const a = -Math.PI * 0.85 + Math.random() * Math.PI * 0.7;
    const r = 40 + Math.random() * 14;
    const x = W / 2 + Math.cos(a) * r;
    const y = H * 0.38 + Math.sin(a) * r * 1.0;
    stuckPoints.push([x, y, 1.6 + Math.random() * 2.4]);
  }
  for (let i = 0; i < 80; i++) {
    const x = W * 0.18 + Math.random() * W * 0.64;
    const y = H * 0.55 + (Math.random() ** 2) * H * 0.3;
    stuckPoints.push([x, y, 1.8 + Math.random() * 2.6]);
  }
  for (const [x, y, r] of stuckPoints) {
    const g = c.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.5, 'rgba(200,225,255,0.45)');
    g.addColorStop(1, 'rgba(160,200,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r * 3, 0, Math.PI * 2);
    c.fill();
  }

  // A few flakes mid-air, falling.
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H * 0.7;
    const r = 1.4 + Math.random() * 2;
    const g = c.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(200,225,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r * 3, 0, Math.PI * 2);
    c.fill();
  }
  c.globalCompositeOperation = 'source-over';
}

export default {
  id: 'SnowPile',
  title: 'SNOW PILE',
  subtitle: 'STICKY SNOWFLAKES · SHAKE TO CLEAR',
  category: 'FACE',
  preview,
  factory: () => new SnowPile(),
};
