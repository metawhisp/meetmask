import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ---------------------------------------------------------------------------
// TIME ECHO
// A ring buffer of past video frames painted as semi-transparent ghost layers
// behind the live frame. As you move, you trail a stack of your past selves.
// ---------------------------------------------------------------------------

const N_LAYERS    = 5;     // newest + 4 echoes
const CAPTURE_MS  = 150;   // time between buffer slot advances
const X_STEP_PX   = 42;    // horizontal slide per ghost layer
const Y_STEP_PX   = 8;     // tiny vertical drift per layer
const ROT_STEP    = 0.028; // radians of rotation per layer
const CA_STEP_PX  = 2.6;   // chromatic-aberration offset per layer (pixels)

class TimeEcho extends Tracker {
  constructor() {
    super({ kind: 'face' });
    // We're painting the live video ourselves as the topmost layer, so the
    // raw <video> element must be hidden.
    this.wantsRawVideo = false;
    this.acc = 0;          // ms since last capture
    this.head = 0;         // ring-buffer write head
    this.slots = [];       // { canvas, ctx2d, tex, mesh, caMesh, caTex, caCtx }
    this.framesCaptured = 0;
  }

  // Cover-fit math (matches landmarkToCanvasPx in core/Tracker4.js).
  _coverRect(vw, vh, cw, ch) {
    const ca = cw / ch, va = vw / vh;
    let dispW, dispH, offX, offY;
    if (ca > va) { dispW = cw; dispH = cw / va; offX = 0; offY = (ch - dispH) / 2; }
    else         { dispH = ch; dispW = ch * va; offX = (cw - dispW) / 2; offY = 0; }
    return { dispW, dispH, offX, offY };
  }

  _makeSlot(i) {
    const W = this.ctx.width;
    const H = this.ctx.height;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx2d = canvas.getContext('2d');
    // Start fully black so empty slots paint as opaque void rather than
    // bleeding the page through.
    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, W, H);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;

    const geo = new THREE.PlaneGeometry(W, H);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: i > 0,         // newest layer is opaque
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    // Ortho camera: Y=0 top, Y=h bottom. Plane is centred → translate to centre.
    mesh.position.set(W / 2, H / 2, -i); // older layers deeper
    mesh.renderOrder = N_LAYERS - i;     // newest renders last (on top)

    // Optional chromatic-aberration overlay (only for the oldest layer).
    let caCanvas = null, caCtx = null, caTex = null, caMesh = null;
    if (i === N_LAYERS - 1) {
      caCanvas = document.createElement('canvas');
      caCanvas.width = W; caCanvas.height = H;
      caCtx = caCanvas.getContext('2d');
      caTex = new THREE.CanvasTexture(caCanvas);
      caTex.colorSpace = THREE.SRGBColorSpace;
      caTex.minFilter = THREE.LinearFilter;
      caTex.magFilter = THREE.LinearFilter;
      const caMat = new THREE.MeshBasicMaterial({
        map: caTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.55,
      });
      caMesh = new THREE.Mesh(geo.clone(), caMat);
      caMesh.frustumCulled = false;
      caMesh.position.set(W / 2, H / 2, -i + 0.01);
      caMesh.renderOrder = N_LAYERS - i; // same band, just after the base
    }

    return { canvas, ctx2d, tex, mesh, mat, geo, caCanvas, caCtx, caTex, caMesh };
  }

  async setup(ctx) {
    for (let i = 0; i < N_LAYERS; i++) {
      const slot = this._makeSlot(i);
      this.slots.push(slot);
      ctx.scene.add(slot.mesh);
      if (slot.caMesh) ctx.scene.add(slot.caMesh);
    }
    ctx.setHud('TIME ECHO — loading…');
  }

  _drawVideoInto(ctx2d) {
    const video = this.ctx.video;
    if (!video || video.readyState < 2) return;
    const W = this.ctx.width, H = this.ctx.height;
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const { dispW, dispH, offX, offY } = this._coverRect(vw, vh, W, H);

    ctx2d.save();
    // Repaint background black so previous slot contents don't ghost through
    // letterbox bars.
    ctx2d.globalCompositeOperation = 'source-over';
    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, W, H);

    if (this.mirror) {
      ctx2d.translate(W, 0);
      ctx2d.scale(-1, 1);
      ctx2d.drawImage(video, W - offX - dispW, offY, dispW, dispH);
    } else {
      ctx2d.drawImage(video, offX, offY, dispW, dispH);
    }
    ctx2d.restore();
  }

  _redrawChromaticAberration(srcCanvas, caCtx) {
    const W = this.ctx.width, H = this.ctx.height;
    caCtx.clearRect(0, 0, W, H);
    // Red channel pushed left, blue pushed right. Using 'lighter' so the two
    // tints additively form a VHS-style fringe over the base ghost.
    caCtx.save();
    caCtx.globalCompositeOperation = 'lighter';
    caCtx.globalAlpha = 0.85;
    caCtx.filter = 'hue-rotate(-30deg) saturate(2)';
    caCtx.drawImage(srcCanvas, -CA_STEP_PX, 0);
    caCtx.filter = 'hue-rotate(150deg) saturate(2)';
    caCtx.drawImage(srcCanvas, CA_STEP_PX, 0);
    caCtx.restore();
  }

  frame(_faces, dt) {
    // dt is in seconds.
    this.acc += dt * 1000;

    // Always refresh the live (head) slot every frame so the topmost layer is
    // butter-smooth, even between ring advances.
    const liveSlot = this.slots[this.head];
    this._drawVideoInto(liveSlot.ctx2d);
    liveSlot.tex.needsUpdate = true;

    // Advance ring buffer on the cadence.
    if (this.acc >= CAPTURE_MS) {
      this.acc -= CAPTURE_MS;
      this.head = (this.head + 1) % N_LAYERS;
      // Stamp the freshly-promoted head with the current frame so the new
      // layer-0 starts hot.
      const next = this.slots[this.head];
      this._drawVideoInto(next.ctx2d);
      next.tex.needsUpdate = true;
      this.framesCaptured++;
    }

    // Re-assign each physical slot a *display age* (0 = newest, N-1 = oldest)
    // based on its distance back from the head, then push transform + tint.
    for (let age = 0; age < N_LAYERS; age++) {
      const idx = (this.head - age + N_LAYERS) % N_LAYERS;
      const slot = this.slots[idx];

      // Lateral slide + slight rotation, alternating sign so the stack fans.
      const sign = this.mirror ? -1 : 1; // slide opposite of facing
      const x = this.ctx.width  / 2 + sign * age * X_STEP_PX;
      const y = this.ctx.height / 2 +        age * Y_STEP_PX;
      slot.mesh.position.set(x, y, -age);
      slot.mesh.rotation.z = sign * age * ROT_STEP;
      slot.mesh.renderOrder = N_LAYERS - age;

      // Opacity ramp: 1.0 → 0.25
      const t = age / (N_LAYERS - 1);
      slot.mat.opacity = 1.0 - t * 0.75;
      slot.mat.transparent = age > 0;

      // Color tint: newest = white, oldest = cool blue/cyan.
      const r = 1.0 - t * 0.55;
      const g = 1.0 - t * 0.20;
      const b = 1.0;
      slot.mat.color.setRGB(r, g, b);

      // Chromatic-aberration overlay rides with the oldest layer.
      if (slot.caMesh) {
        if (age === N_LAYERS - 1) {
          this._redrawChromaticAberration(slot.canvas, slot.caCtx);
          slot.caTex.needsUpdate = true;
          slot.caMesh.position.set(x, y, -age + 0.01);
          slot.caMesh.rotation.z = slot.mesh.rotation.z;
          slot.caMesh.renderOrder = N_LAYERS - age;
          slot.caMesh.visible = this.framesCaptured >= N_LAYERS;
        } else {
          slot.caMesh.visible = false;
        }
      }
    }

    this.ctx.setHud('TIME ECHO — move to see your past selves');
  }

  resize(w, h) {
    super.resize(w, h);
    // Rebuild slot canvases at the new size. Cheap enough on a resize event.
    for (const slot of this.slots) {
      slot.canvas.width = w; slot.canvas.height = h;
      slot.ctx2d.fillStyle = '#000';
      slot.ctx2d.fillRect(0, 0, w, h);
      slot.tex.needsUpdate = true;
      slot.geo.dispose();
      slot.geo = new THREE.PlaneGeometry(w, h);
      slot.mesh.geometry = slot.geo;
      if (slot.caCanvas) {
        slot.caCanvas.width = w; slot.caCanvas.height = h;
        slot.caMesh.geometry = slot.geo.clone();
      }
    }
  }

  teardown() {
    for (const slot of this.slots) {
      this.ctx?.scene.remove(slot.mesh);
      if (slot.caMesh) this.ctx?.scene.remove(slot.caMesh);
      slot.geo?.dispose();
      slot.mat?.dispose();
      slot.tex?.dispose();
      slot.caTex?.dispose();
      slot.caMesh?.material?.dispose();
      slot.caMesh?.geometry?.dispose();
    }
    this.slots = [];
  }
}

// ---------------------------------------------------------------------------
// Static preview: 5 stylised silhouettes trailing left, brightest in front.
// ---------------------------------------------------------------------------
function preview(ctx) {
  const W = 320, H = 320;
  // Background gradient.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a0d20');
  bg.addColorStop(1, '#1c0a2a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Soft vignette.
  const vg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 220);
  vg.addColorStop(0, 'rgba(255,255,255,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // 5 silhouettes — oldest first, in the back.
  const drawHead = (cx, cy, r, alpha, tint) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = tint;
    // Head
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.4, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    // Shoulders (rounded trapezoid).
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.1, cy + r * 1.1);
    ctx.quadraticCurveTo(cx - r * 1.2, cy + r * 0.2, cx - r * 0.7, cy + r * 0.15);
    ctx.lineTo(cx + r * 0.7, cy + r * 0.15);
    ctx.quadraticCurveTo(cx + r * 1.2, cy + r * 0.2, cx + r * 1.1, cy + r * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const cy = H * 0.55;
  // Oldest → newest. Brightest is the latest, drawn last.
  const layers = [
    { dx: -84, r: 64, a: 0.22, tint: '#5fb7ff' },
    { dx: -60, r: 66, a: 0.32, tint: '#7fc2ff' },
    { dx: -36, r: 68, a: 0.45, tint: '#a8d4ff' },
    { dx: -16, r: 70, a: 0.65, tint: '#dfeeff' },
    { dx:   0, r: 72, a: 1.00, tint: '#ffffff' },
  ];
  for (const L of layers) {
    drawHead(W / 2 + L.dx, cy, L.r, L.a, L.tint);
  }

  // Scanline veneer for VHS feel.
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.restore();

  // Chromatic fringe hint on the rear-most silhouette.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#ff3a5e';
  ctx.beginPath();
  ctx.arc(W / 2 - 88, cy - 25, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3affc8';
  ctx.beginPath();
  ctx.arc(W / 2 - 80, cy - 25, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export default {
  id: 'TimeEcho',
  title: 'TIME ECHO',
  subtitle: 'GHOSTS OF YOU',
  category: 'FACE',
  factory: () => new TimeEcho(),
  preview,
};
