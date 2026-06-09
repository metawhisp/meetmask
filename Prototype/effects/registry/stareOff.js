import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ─── Constants ─────────────────────────────────────────────────────────────
// EAR (Eye Aspect Ratio) — vertical / horizontal opening. Eyes are "closed"
// when EAR drops below CLOSE; we re-arm detection only after it climbs above
// OPEN. Hysteresis avoids fluttering when the eyelid hovers near threshold.
const EAR_CLOSE = 0.18;
const EAR_OPEN  = 0.22;

// Game-over freeze: dramatic flash + shake duration before resetting timer.
const GAME_OVER_DURATION = 1.5;
const SHAKE_DURATION     = 0.4;

// Eye outline loops (return-to-start closed polylines).
const RIGHT_EYE_LOOP = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7, 33];
const LEFT_EYE_LOOP  = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249, 263];

// EAR landmark indices: top, bottom (vertical), outer, inner (horizontal).
const RIGHT_EAR = { top: 159, bottom: 145, outer: 33,  inner: 133 };
const LEFT_EAR  = { top: 386, bottom: 374, outer: 263, inner: 362 };

// Persists across re-mounts within the same session.
let SESSION_RECORD = 0;

// ─── Helpers ───────────────────────────────────────────────────────────────
function earOf(lms, idx) {
  const t = lms[idx.top], b = lms[idx.bottom], o = lms[idx.outer], i = lms[idx.inner];
  if (!t || !b || !o || !i) return 1.0;
  // Use raw normalized coords — ratio cancels out the aspect, no need to map
  // to pixels (and avoids mirror artefacts on the horizontal).
  const vert = Math.abs(t.y - b.y);
  const horiz = Math.abs(o.x - i.x);
  return horiz < 1e-6 ? 1.0 : vert / horiz;
}

// ─── Effect ────────────────────────────────────────────────────────────────
class StareOff extends Tracker {
  constructor() {
    super({ kind: 'face' });
    this.currentTime  = 0;
    this.record       = SESSION_RECORD;
    this.gameOver     = false;
    this.gameOverTimer = 0;
    this.blinkedAt    = 0;
    this.eyesClosed   = false;
    this.ringPhase    = 0;
    this.textRedrawAcc = 0;
  }

  async setup(ctx) {
    const W = ctx.width, H = ctx.height;

    // ── Big timer + record HUD (canvas-textured plane, top of screen) ──
    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.width = 1024;
    this.hudCanvas.height = 360;
    this.hudCtx = this.hudCanvas.getContext('2d');
    this.hudTex = new THREE.CanvasTexture(this.hudCanvas);
    this.hudTex.colorSpace = THREE.SRGBColorSpace;
    this.hudTex.minFilter = THREE.LinearFilter;
    this.hudTex.magFilter = THREE.LinearFilter;
    this.hudMat = new THREE.MeshBasicMaterial({ map: this.hudTex, transparent: true, depthTest: false });
    const hudW = Math.min(W * 0.85, 720);
    const hudH = hudW * (360 / 1024);
    this.hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(hudW, hudH), this.hudMat);
    this.hudMesh.frustumCulled = false;
    this.hudMesh.position.set(W / 2, hudH / 2 + 20, 9);
    this.hudMesh.renderOrder = 100;
    ctx.scene.add(this.hudMesh);

    // ── Game-over center text (separate canvas so we don't bloat the HUD) ──
    this.goCanvas = document.createElement('canvas');
    this.goCanvas.width = 1024;
    this.goCanvas.height = 512;
    this.goCtx = this.goCanvas.getContext('2d');
    this.goTex = new THREE.CanvasTexture(this.goCanvas);
    this.goTex.colorSpace = THREE.SRGBColorSpace;
    this.goTex.minFilter = THREE.LinearFilter;
    this.goTex.magFilter = THREE.LinearFilter;
    this.goMat = new THREE.MeshBasicMaterial({ map: this.goTex, transparent: true, depthTest: false, opacity: 0 });
    const goW = Math.min(W * 0.9, 820);
    const goH = goW * (512 / 1024);
    this.goMesh = new THREE.Mesh(new THREE.PlaneGeometry(goW, goH), this.goMat);
    this.goMesh.frustumCulled = false;
    this.goMesh.position.set(W / 2, H / 2, 11);
    this.goMesh.renderOrder = 110;
    this.goMesh.visible = false;
    ctx.scene.add(this.goMesh);

    // ── Full-screen red flash plane ──
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xff1a2a, transparent: true, opacity: 0, depthTest: false });
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H * 2), this.flashMat);
    this.flashMesh.frustumCulled = false;
    this.flashMesh.position.set(W / 2, H / 2, 8);
    this.flashMesh.renderOrder = 90;
    ctx.scene.add(this.flashMesh);

    // ── Eye outlines (two LineLoops fed by BufferGeometry per frame) ──
    this.eyeMat = new THREE.LineBasicMaterial({ color: 0x3ff0ff, transparent: true, opacity: 0.95, depthTest: false });
    this.rightEyeGeo = new THREE.BufferGeometry();
    this.rightEyeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RIGHT_EYE_LOOP.length * 3), 3));
    this.rightEyeLine = new THREE.Line(this.rightEyeGeo, this.eyeMat);
    this.rightEyeLine.frustumCulled = false;
    this.rightEyeLine.renderOrder = 50;
    ctx.scene.add(this.rightEyeLine);

    this.leftEyeGeo = new THREE.BufferGeometry();
    this.leftEyeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LEFT_EYE_LOOP.length * 3), 3));
    this.leftEyeLine = new THREE.Line(this.leftEyeGeo, this.eyeMat);
    this.leftEyeLine.frustumCulled = false;
    this.leftEyeLine.renderOrder = 50;
    ctx.scene.add(this.leftEyeLine);

    // ── Stare-power rings (3 per eye) ──
    this.rings = [];
    for (let e = 0; e < 2; e++) {
      for (let r = 0; r < 3; r++) {
        const mat = new THREE.LineBasicMaterial({ color: 0x3ff0ff, transparent: true, opacity: 0.0, depthTest: false });
        // Build a unit-circle line loop; scale per frame to animate.
        const segs = 48;
        const pts = new Float32Array((segs + 1) * 3);
        for (let s = 0; s <= segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          pts[s * 3 + 0] = Math.cos(a);
          pts[s * 3 + 1] = Math.sin(a);
          pts[s * 3 + 2] = 0;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        line.renderOrder = 40;
        ctx.scene.add(line);
        this.rings.push({ line, mat, geo, eye: e, idx: r });
      }
    }

    this._drawHud();
  }

  // ── Update right/left eye line buffers from latest landmarks. ──
  _updateEyeLine(lms, indices, geo) {
    const arr = geo.attributes.position.array;
    for (let i = 0; i < indices.length; i++) {
      const lm = lms[indices[i]];
      if (!lm) { arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = 0; continue; }
      const [px, py] = this.toPx(lm.x, lm.y);
      arr[i * 3 + 0] = px;
      arr[i * 3 + 1] = py;
      arr[i * 3 + 2] = 1;
    }
    geo.attributes.position.needsUpdate = true;
  }

  // ── Compute center + radius of an eye from its outline. ──
  _eyeBounds(lms, indices) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of indices) {
      const lm = lms[i];
      if (!lm) continue;
      const [px, py] = this.toPx(lm.x, lm.y);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (!isFinite(minX)) return null;
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, r: Math.max(20, (maxX - minX) * 0.7) };
  }

  // ── Redraw the big timer + record line. ──
  _drawHud() {
    const g = this.hudCtx;
    const W = this.hudCanvas.width, H = this.hudCanvas.height;
    g.clearRect(0, 0, W, H);

    // Background pill — subtle so it reads on bright/dark camera scenes.
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath();
    const r = 38;
    g.moveTo(r, 8);
    g.lineTo(W - r, 8);
    g.quadraticCurveTo(W - 8, 8, W - 8, r + 8);
    g.lineTo(W - 8, H - r - 8);
    g.quadraticCurveTo(W - 8, H - 8, W - r - 8, H - 8);
    g.lineTo(r + 8, H - 8);
    g.quadraticCurveTo(8, H - 8, 8, H - r - 8);
    g.lineTo(8, r + 8);
    g.quadraticCurveTo(8, 8, r + 8, 8);
    g.closePath();
    g.fill();

    // Timer color: red game-over, gold beating record, white normal.
    let timerColor = '#ffffff';
    if (this.gameOver) timerColor = '#ff3a55';
    else if (this.record > 0 && this.currentTime > this.record) timerColor = '#ffd23f';

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 200px ui-sans-serif, system-ui, -apple-system, sans-serif';
    g.shadowColor = timerColor;
    g.shadowBlur = 28;
    g.fillStyle = timerColor;
    g.fillText(`${this.currentTime.toFixed(2)}s`, W / 2, H * 0.42);

    g.shadowBlur = 0;
    g.font = 'bold 56px ui-sans-serif, system-ui, sans-serif';
    g.fillStyle = '#a8eaff';
    g.fillText(`RECORD: ${this.record.toFixed(2)}s`, W / 2, H * 0.82);
  }

  // ── Paint the GAME OVER overlay. ──
  _drawGameOver() {
    const g = this.goCtx;
    const W = this.goCanvas.width, H = this.goCanvas.height;
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    g.shadowColor = '#ff1a2a';
    g.shadowBlur = 50;
    g.fillStyle = '#ff3a55';
    g.font = 'bold 180px ui-sans-serif, system-ui, sans-serif';
    g.fillText('GAME OVER', W / 2, H * 0.42);

    g.shadowBlur = 18;
    g.font = 'bold 96px ui-sans-serif, system-ui, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText(`${this.blinkedAt.toFixed(2)}s`, W / 2, H * 0.78);
    g.shadowBlur = 0;
  }

  frame(faces, dt) {
    const { ctx } = this;
    const W = ctx.width, H = ctx.height;
    this.ringPhase += dt;

    const visible = faces.length > 0;
    const lms = visible ? faces[0] : null;

    // ── Tick game state ──
    if (this.gameOver) {
      this.gameOverTimer += dt;
      if (this.gameOverTimer >= GAME_OVER_DURATION) {
        // Reset for the next round.
        this.gameOver = false;
        this.gameOverTimer = 0;
        this.currentTime = 0;
        this.eyesClosed = false;
      }
    } else if (visible) {
      this.currentTime += dt;

      // ── Blink detection with hysteresis ──
      const earR = earOf(lms, RIGHT_EAR);
      const earL = earOf(lms, LEFT_EAR);
      const ear = (earR + earL) / 2;
      if (!this.eyesClosed && ear < EAR_CLOSE) {
        // BLINK!
        this.eyesClosed = true;
        this.blinkedAt = this.currentTime;
        if (this.currentTime > this.record) {
          this.record = this.currentTime;
          SESSION_RECORD = this.record;
        }
        this.gameOver = true;
        this.gameOverTimer = 0;
        this._drawGameOver();
        this.goTex.needsUpdate = true;
      } else if (this.eyesClosed && ear > EAR_OPEN) {
        this.eyesClosed = false;
      }
    }

    // ── Eye outlines & rings ──
    const eyeColor = this.eyesClosed ? 0xff3355 : 0x3ff0ff;
    this.eyeMat.color.setHex(eyeColor);

    if (lms) {
      this._updateEyeLine(lms, RIGHT_EYE_LOOP, this.rightEyeGeo);
      this._updateEyeLine(lms, LEFT_EYE_LOOP,  this.leftEyeGeo);
      this.rightEyeLine.visible = true;
      this.leftEyeLine.visible  = true;

      const bounds = [
        this._eyeBounds(lms, RIGHT_EYE_LOOP),
        this._eyeBounds(lms, LEFT_EYE_LOOP),
      ];
      // Stare power grows with currentTime (cap at 1.0 ~10s).
      const power = Math.min(1, this.currentTime / 10);
      for (const ring of this.rings) {
        const b = bounds[ring.eye];
        if (!b) { ring.line.visible = false; continue; }
        ring.line.visible = true;
        // Each ring pulses inward on its own phase offset.
        const phase = (this.ringPhase * 0.9 + ring.idx * 0.33) % 1;
        const scale = b.r * (1.0 + (1.0 - phase) * 1.4);
        ring.line.position.set(b.cx, b.cy, 0.5);
        ring.line.scale.set(scale, scale, 1);
        const fade = Math.sin(phase * Math.PI); // 0→1→0
        const baseOpacity = 0.15 + power * 0.55;
        ring.mat.opacity = baseOpacity * fade;
        // Tint toward red when game-over.
        if (this.gameOver) ring.mat.color.setHex(0xff3355);
        else if (this.record > 0 && this.currentTime > this.record) ring.mat.color.setHex(0xffd23f);
        else ring.mat.color.setHex(0x3ff0ff);
      }
    } else {
      this.rightEyeLine.visible = false;
      this.leftEyeLine.visible  = false;
      for (const ring of this.rings) ring.line.visible = false;
    }

    // ── Flash + shake ──
    if (this.gameOver) {
      // Flash decays from 0.6 → 0 over SHAKE_DURATION seconds, then sustains 0.
      const flash = Math.max(0, 0.6 * (1 - this.gameOverTimer / SHAKE_DURATION));
      this.flashMat.opacity = flash;

      // Screen shake — offset HUD + goMesh + eye meshes random pixels.
      const shakeAmt = this.gameOverTimer < SHAKE_DURATION
        ? 22 * (1 - this.gameOverTimer / SHAKE_DURATION)
        : 0;
      const sx = (Math.random() - 0.5) * 2 * shakeAmt;
      const sy = (Math.random() - 0.5) * 2 * shakeAmt;
      ctx.scene.position.set(sx, sy, 0);

      this.goMesh.visible = true;
      this.goMat.opacity = Math.min(1, (GAME_OVER_DURATION - this.gameOverTimer) * 2);
    } else {
      this.flashMat.opacity = 0;
      ctx.scene.position.set(0, 0, 0);
      this.goMesh.visible = false;
      this.goMat.opacity = 0;
    }

    // ── Redraw HUD text every ~6 frames to keep it cheap. ──
    this.textRedrawAcc += dt;
    if (this.textRedrawAcc >= 0.1 || this.gameOver) {
      this.textRedrawAcc = 0;
      this._drawHud();
      this.hudTex.needsUpdate = true;
    }

    ctx.setHud(`STARE OFF · ${this.currentTime.toFixed(1)}s · record: ${this.record.toFixed(1)}s · don't blink!`);
  }

  resize(w, h) {
    super.resize(w, h);
    if (this.hudMesh) {
      const hudW = Math.min(w * 0.85, 720);
      const hudH = hudW * (360 / 1024);
      this.hudMesh.geometry.dispose();
      this.hudMesh.geometry = new THREE.PlaneGeometry(hudW, hudH);
      this.hudMesh.position.set(w / 2, hudH / 2 + 20, 9);
    }
    if (this.goMesh) {
      const goW = Math.min(w * 0.9, 820);
      const goH = goW * (512 / 1024);
      this.goMesh.geometry.dispose();
      this.goMesh.geometry = new THREE.PlaneGeometry(goW, goH);
      this.goMesh.position.set(w / 2, h / 2, 11);
    }
    if (this.flashMesh) {
      this.flashMesh.geometry.dispose();
      this.flashMesh.geometry = new THREE.PlaneGeometry(w * 2, h * 2);
      this.flashMesh.position.set(w / 2, h / 2, 8);
    }
  }

  teardown() {
    const ctx = this.ctx;
    if (ctx) ctx.scene.position.set(0, 0, 0);
    const dispose = (mesh, mat, geo, tex) => {
      if (mesh && ctx) ctx.scene.remove(mesh);
      geo?.dispose();
      mat?.dispose();
      tex?.dispose();
    };
    dispose(this.hudMesh, this.hudMat, this.hudMesh?.geometry, this.hudTex);
    dispose(this.goMesh, this.goMat, this.goMesh?.geometry, this.goTex);
    dispose(this.flashMesh, this.flashMat, this.flashMesh?.geometry, null);
    if (this.rightEyeLine && ctx) ctx.scene.remove(this.rightEyeLine);
    if (this.leftEyeLine  && ctx) ctx.scene.remove(this.leftEyeLine);
    this.rightEyeGeo?.dispose();
    this.leftEyeGeo?.dispose();
    this.eyeMat?.dispose();
    for (const r of this.rings) {
      if (ctx) ctx.scene.remove(r.line);
      r.geo.dispose();
      r.mat.dispose();
    }
    this.rings = [];
    this.hudMesh = this.goMesh = this.flashMesh = null;
    this.rightEyeLine = this.leftEyeLine = null;
  }
}

// ─── Launcher tile preview ─────────────────────────────────────────────────
function preview(ctx) {
  const W = 320, H = 320;
  // Dark dramatic backdrop.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#08111c');
  bg.addColorStop(0.55, '#0d1a2a');
  bg.addColorStop(1, '#050a14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Big timer at top.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffd23f';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 64px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('12.4s', W / 2, 56);
  ctx.shadowBlur = 0;

  // Face silhouette (rounded rectangle-ish oval).
  ctx.fillStyle = '#1c2738';
  ctx.beginPath();
  ctx.ellipse(W / 2, 180, 90, 110, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wide-open eyes — outer ring + iris + pupil + glint.
  const drawEye = (cx) => {
    // Outer cyan glow.
    ctx.strokeStyle = '#3ff0ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#3ff0ff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(cx, 170, 28, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // White sclera.
    ctx.fillStyle = '#f3f7ff';
    ctx.beginPath();
    ctx.ellipse(cx, 170, 25, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    // Iris.
    ctx.fillStyle = '#1c8eff';
    ctx.beginPath();
    ctx.arc(cx, 170, 11, 0, Math.PI * 2);
    ctx.fill();
    // Pupil.
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx, 170, 5, 0, Math.PI * 2);
    ctx.fill();
    // Glint.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx - 3, 167, 2, 0, Math.PI * 2);
    ctx.fill();
  };
  drawEye(W / 2 - 32);
  drawEye(W / 2 + 32);

  // Mouth — slightly open, intense.
  ctx.strokeStyle = '#3a4a60';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 20, 230);
  ctx.lineTo(W / 2 + 20, 230);
  ctx.stroke();

  // Record line at bottom.
  ctx.fillStyle = '#a8eaff';
  ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('RECORD: 18.2s', W / 2, H - 24);
}

export default {
  id: 'StareOff',
  title: 'STARE OFF',
  subtitle: "DON'T BLINK",
  category: 'FACE',
  factory: () => new StareOff(),
  preview,
};
