import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// Build a transparent canvas with a simple procedural glasses graphic.
// Two thin frames with a bridge between them, plus a slight rim shadow.
function buildGlassesTexture() {
  const W = 1024, H = 384;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const ctx = cnv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const cy = H / 2;
  const lensR = 150;
  const leftCx = W * 0.3;
  const rightCx = W * 0.7;
  const stroke = 14;

  // Glass tint (very faint blue)
  ctx.fillStyle = 'rgba(120, 180, 220, 0.18)';
  ctx.beginPath(); ctx.arc(leftCx, cy, lensR - stroke / 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(rightCx, cy, lensR - stroke / 2, 0, Math.PI * 2); ctx.fill();

  // Frame
  ctx.strokeStyle = '#111';
  ctx.lineWidth = stroke;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(leftCx, cy, lensR, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(rightCx, cy, lensR, 0, Math.PI * 2); ctx.stroke();

  // Bridge
  ctx.beginPath();
  ctx.moveTo(leftCx + lensR - 4, cy + 6);
  ctx.quadraticCurveTo((leftCx + rightCx) / 2, cy - 20, rightCx - lensR + 4, cy + 6);
  ctx.stroke();

  // Temples (arms sticking out the sides) — short stubs so they don't dominate.
  ctx.beginPath();
  ctx.moveTo(leftCx - lensR, cy - 4); ctx.lineTo(20, cy - 10);
  ctx.moveTo(rightCx + lensR, cy - 4); ctx.lineTo(W - 20, cy - 10);
  ctx.stroke();

  // Subtle highlight on each lens
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(leftCx, cy, lensR - stroke, -Math.PI * 0.85, -Math.PI * 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rightCx, cy, lensR - stroke, -Math.PI * 0.85, -Math.PI * 0.55);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cnv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  // CSS already mirrors the video; the glasses graphic is symmetric so no flip needed.
  return { tex, aspect: W / H };
}

class Glasses extends Tracker {
  constructor() { super({ kind: 'face' }); }

  async setup(ctx) {
    const { tex, aspect } = buildGlassesTexture();
    this.tex = tex;
    this.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false });
    // height=1, width=aspect — we'll scale later by face width.
    this.geo = new THREE.PlaneGeometry(aspect, 1);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    ctx.scene.add(this.mesh);
    this.aspect = aspect;
    this.lastSeen = 0;
  }

  frame(faces) {
    if (!faces.length) {
      this.mesh.visible = false;
      this.ctx.setHud('GLASSES — looking for a face');
      return;
    }
    this.mesh.visible = true;
    const lms = faces[0];
    // Eye outer corners + nose-bridge midpoint anchor.
    const [rx, ry] = this.toPx(lms[33].x,  lms[33].y);   // right eye outer (image-frame)
    const [lx, ly] = this.toPx(lms[263].x, lms[263].y);  // left eye outer
    const [bx, by] = this.toPx(lms[6].x,   lms[6].y);    // nose bridge

    const cx = (rx + lx) / 2;
    const cy = (ry + ly) / 2;
    const eyeDist = Math.hypot(lx - rx, ly - ry);
    const tilt = Math.atan2(ly - ry, lx - rx);

    // Glasses are ~2.4x the inter-outer-eye distance — covers brows + temples.
    const targetWidth = eyeDist * 2.4;
    const targetHeight = targetWidth / this.aspect;

    // Sit slightly above the nose bridge — anchor toward eye-line.
    const anchorY = cy * 0.7 + by * 0.3;

    this.mesh.position.set(cx, anchorY, 5);
    this.mesh.rotation.z = tilt;
    this.mesh.scale.set(targetWidth, targetHeight, 1);
    this.ctx.setHud(`GLASSES — width ${targetWidth.toFixed(0)}px · tilt ${(tilt * 180 / Math.PI).toFixed(1)}°`);
  }

  teardown() {
    if (this.mesh) { this.geo.dispose(); this.ctx.scene.remove(this.mesh); }
    if (this.mat) this.mat.dispose();
    if (this.tex) this.tex.dispose();
    this.mesh = this.geo = this.mat = this.tex = null;
  }
}

export default {
  id: 'Glasses',
  title: 'GLASSES',
  subtitle: 'AR GLASSES',
  category: 'FACE',
  preview: 'glasses',
  factory: () => new Glasses(),
};
