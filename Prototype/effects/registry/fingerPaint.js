import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

class FingerPaint extends Tracker {
  constructor() {
    super({ kind: 'hand', numHands: 1 });
    this.lastTip = null;
    this.hue = 0;
  }

  async setup(ctx) {
    // Persistent paint canvas — sized to the viewport. Strokes accumulate
    // across frames; this is the FBO-substitute trick that makes the effect
    // feel like real drawing instead of a per-frame splash.
    const w = ctx.width, h = ctx.height;
    this.paintCanvas = document.createElement('canvas');
    this.paintCanvas.width = w;
    this.paintCanvas.height = h;
    this.paintCtx = this.paintCanvas.getContext('2d');
    this.paintCtx.lineCap = 'round';
    this.paintCtx.lineJoin = 'round';

    this.paintTex = new THREE.CanvasTexture(this.paintCanvas);
    this.paintTex.minFilter = THREE.LinearFilter;
    this.paintTex.magFilter = THREE.LinearFilter;
    this.paintMat = new THREE.MeshBasicMaterial({ map: this.paintTex, transparent: true, depthTest: false });
    this.paintGeo = new THREE.PlaneGeometry(w, h);
    this.paintMesh = new THREE.Mesh(this.paintGeo, this.paintMat);
    this.paintMesh.position.set(w / 2, h / 2, 1);
    this.paintMesh.frustumCulled = false;
    ctx.scene.add(this.paintMesh);

    // Little dot that follows the index tip so you can see where you'll draw.
    this.cursorGeo = new THREE.RingGeometry(10, 14, 24);
    this.cursorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
    this.cursor = new THREE.Mesh(this.cursorGeo, this.cursorMat);
    this.cursor.frustumCulled = false;
    ctx.scene.add(this.cursor);
  }

  // Hand landmarker normalises by image size — convert with toPx for canvas px.
  frame(hands, dt) {
    const haveHand = hands.length > 0;
    if (!haveHand) {
      this.lastTip = null;
      this.cursor.visible = false;
      this.ctx.setHud('PAINT — show your hand, point your index finger');
      return;
    }
    this.cursor.visible = true;
    const lms = hands[0];
    const [tipX, tipY] = this.toPx(lms[8].x,  lms[8].y);     // index tip
    const [thumbX, thumbY] = this.toPx(lms[4].x, lms[4].y);   // thumb tip
    const pinchDist = Math.hypot(thumbX - tipX, thumbY - tipY);

    this.cursor.position.set(tipX, tipY, 2);
    // Cursor shrinks when pinching — visual cue that you're about to clear.
    const pinchT = Math.max(0, 1 - pinchDist / 80);
    const ringScale = 1 + pinchT * 0.6;
    this.cursor.scale.setScalar(ringScale);
    this.cursorMat.color.setHSL((this.hue % 360) / 360, 0.8, 0.65);

    // Pinch detection: thumb-tip ↔ index-tip < threshold = clear-paint gesture
    if (pinchDist < 30) {
      this.paintCtx.clearRect(0, 0, this.paintCanvas.width, this.paintCanvas.height);
      this.paintTex.needsUpdate = true;
      this.lastTip = null;
      this.ctx.setHud('PAINT — pinch to clear · cleared!');
      return;
    }

    // Draw a stroke from the last tip to the current tip.
    if (this.lastTip) {
      const ctxP = this.paintCtx;
      ctxP.strokeStyle = `hsl(${this.hue}, 85%, 60%)`;
      ctxP.lineWidth = 8;
      ctxP.beginPath();
      ctxP.moveTo(this.lastTip[0], this.lastTip[1]);
      ctxP.lineTo(tipX, tipY);
      ctxP.stroke();
      this.paintTex.needsUpdate = true;
      this.hue = (this.hue + 1.5) % 360; // cycle colour as you draw
    }
    this.lastTip = [tipX, tipY];
    this.ctx.setHud(`PAINT — pinch (thumb+index) to clear · ${pinchDist.toFixed(0)}px`);
  }

  resize(w, h) {
    super.resize(w, h);
    // Keep existing strokes when window resizes by re-stretching the canvas.
    if (!this.paintCanvas) return;
    const old = document.createElement('canvas');
    old.width = this.paintCanvas.width;
    old.height = this.paintCanvas.height;
    old.getContext('2d').drawImage(this.paintCanvas, 0, 0);
    this.paintCanvas.width = w;
    this.paintCanvas.height = h;
    this.paintCtx.drawImage(old, 0, 0, w, h);
    this.paintCtx.lineCap = 'round';
    this.paintCtx.lineJoin = 'round';
    this.paintTex.needsUpdate = true;
    if (this.paintMesh) {
      this.paintMesh.geometry.dispose();
      this.paintMesh.geometry = new THREE.PlaneGeometry(w, h);
      this.paintMesh.position.set(w / 2, h / 2, 1);
    }
  }

  teardown() {
    if (this.paintMesh) { this.paintMesh.geometry.dispose(); this.ctx.scene.remove(this.paintMesh); }
    if (this.paintMat) this.paintMat.dispose();
    if (this.paintTex) this.paintTex.dispose();
    if (this.cursor) { this.cursorGeo.dispose(); this.ctx.scene.remove(this.cursor); }
    if (this.cursorMat) this.cursorMat.dispose();
    this.paintMesh = this.paintMat = this.paintTex = null;
    this.cursor = this.cursorGeo = this.cursorMat = null;
  }
}

export default {
  id: 'FingerPaint',
  title: 'FINGER PAINT',
  subtitle: 'DRAW IN THE AIR',
  category: 'HAND',
  preview: 'fingerPaint',
  factory: () => new FingerPaint(),
};
