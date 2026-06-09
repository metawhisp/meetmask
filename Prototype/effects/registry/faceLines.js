import * as THREE from 'three';
import { BaseTrackingEffect } from '../core/Tracker.js?v=3';
import { FACE_CONNECTIONS } from '../core/mpLoader.js';

// Only feature lines: eyes, brows, lips. No face oval — looks like a stencil.
const EDGES = [
  ...FACE_CONNECTIONS.lipsOuter,
  ...FACE_CONNECTIONS.rightEye,
  ...FACE_CONNECTIONS.leftEye,
  ...FACE_CONNECTIONS.rightBrow,
  ...FACE_CONNECTIONS.leftBrow,
];

class FaceLines extends BaseTrackingEffect {
  constructor() {
    super({ kind: 'face', bg: { dim: 0.25, desat: 0.85 } });
    this.prevCenter = null;
    this.energy = 0;
    this.colorHSL = { h: 0.95, s: 0.95, l: 0.55 };
  }
  async setup(ctx) {
    const positions = new Float32Array(EDGES.length * 2 * 3);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xff3380, transparent: true, opacity: 1.0, depthTest: false });
    this.lines = new THREE.LineSegments(this.geom, this.mat);
    this.lines.frustumCulled = false;
    ctx.scene.add(this.lines);
  }
  frame(faces, dt) {
    const positions = this.geom.attributes.position.array;
    if (faces.length) {
      const lms = faces[0];
      // Mouth-open ratio = distance(upperLip, lowerLip) / faceWidth.
      const [ux, uy] = this.toPx(lms[13].x, lms[13].y);
      const [llx, lly] = this.toPx(lms[14].x, lms[14].y);
      const [rEyeX] = this.toPx(lms[33].x,  lms[33].y);
      const [lEyeX] = this.toPx(lms[263].x, lms[263].y);
      const faceWidth = Math.abs(rEyeX - lEyeX);
      const mouthOpen = Math.hypot(ux - llx, uy - lly);
      const openRatio = Math.min(1, mouthOpen / Math.max(1, faceWidth * 0.4));

      // head motion energy
      const [cx, cy] = this.toPx(lms[1].x, lms[1].y);
      if (this.prevCenter) {
        const dx = cx - this.prevCenter[0];
        const dy = cy - this.prevCenter[1];
        const speed = Math.sqrt(dx*dx + dy*dy) / Math.max(0.001, dt);
        this.energy += (Math.min(1, speed / 1500) - this.energy) * 0.25;
      }
      this.prevCenter = [cx, cy];

      for (let i = 0; i < EDGES.length; i++) {
        const [a, b] = EDGES[i];
        const la = lms[a], lb = lms[b];
        if (!la || !lb) continue;
        const [ax, ay] = this.toPx(la.x, la.y);
        const [bx, by] = this.toPx(lb.x, lb.y);
        positions[i * 6 + 0] = ax; positions[i * 6 + 1] = ay; positions[i * 6 + 2] = 1;
        positions[i * 6 + 3] = bx; positions[i * 6 + 4] = by; positions[i * 6 + 5] = 1;
      }

      // color shifts with motion AND opens mouth = brighter
      const hue = 0.93 - this.energy * 0.45 - openRatio * 0.20;
      this.mat.color.setHSL(((hue % 1) + 1) % 1, 0.95, 0.55 + openRatio * 0.25);
      this.mat.opacity = 0.7 + Math.max(this.energy, openRatio) * 0.3;
      this.ctx.setHud(`LINES — head energy=${this.energy.toFixed(2)} · mouth=${openRatio.toFixed(2)}`);
    } else {
      positions.fill(0);
      this.prevCenter = null;
      this.energy = 0;
      this.ctx.setHud('LINES — no face');
    }
    this.geom.attributes.position.needsUpdate = true;
  }
  teardown() {
    if (this.lines) { this.geom.dispose(); this.ctx.scene.remove(this.lines); }
    if (this.mat) this.mat.dispose();
    this.lines = this.geom = this.mat = null;
  }
}

export default {
  id: 'FaceLines',
  title: 'LINES',
  subtitle: 'EYES + LIPS',
  category: 'FACE',
  preview: 'faceLines',
  factory: () => new FaceLines(),
};
