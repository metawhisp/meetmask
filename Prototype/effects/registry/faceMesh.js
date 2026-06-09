import * as THREE from 'three';
import { BaseTrackingEffect } from '../core/Tracker.js?v=3';
import { FACE_CONNECTIONS } from '../core/mpLoader.js';

// Flatten all connection groups except inner lips for a denser wireframe.
const EDGES = [
  ...FACE_CONNECTIONS.faceOval,
  ...FACE_CONNECTIONS.lipsOuter,
  ...FACE_CONNECTIONS.lipsInner,
  ...FACE_CONNECTIONS.rightEye,
  ...FACE_CONNECTIONS.leftEye,
  ...FACE_CONNECTIONS.rightBrow,
  ...FACE_CONNECTIONS.leftBrow,
  ...FACE_CONNECTIONS.nose,
];

class FaceMesh extends BaseTrackingEffect {
  constructor() { super({ kind: 'face', bg: { dim: 0.4, desat: 0.6 } }); }

  async setup(ctx) {
    const positions = new Float32Array(EDGES.length * 2 * 3);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0x00ffd1, transparent: true, opacity: 0.85, depthTest: false });
    this.lines = new THREE.LineSegments(this.geom, this.mat);
    this.lines.frustumCulled = false;
    ctx.scene.add(this.lines);
  }
  frame(faces) {
    const positions = this.geom.attributes.position.array;
    if (faces.length) {
      const lms = faces[0];
      for (let i = 0; i < EDGES.length; i++) {
        const [a, b] = EDGES[i];
        const la = lms[a], lb = lms[b];
        if (!la || !lb) continue;
        const [ax, ay] = this.toPx(la.x, la.y);
        const [bx, by] = this.toPx(lb.x, lb.y);
        positions[i * 6 + 0] = ax;
        positions[i * 6 + 1] = ay;
        positions[i * 6 + 2] = 1;
        positions[i * 6 + 3] = bx;
        positions[i * 6 + 4] = by;
        positions[i * 6 + 5] = 1;
      }
    } else {
      positions.fill(0);
    }
    this.geom.attributes.position.needsUpdate = true;
    this.ctx.setHud(`FACE MESH — ${faces.length ? 'face' : 'no face'} · ${EDGES.length} edges`);
  }
  teardown() {
    if (this.lines) { this.geom.dispose(); this.ctx.scene.remove(this.lines); }
    if (this.mat) this.mat.dispose();
    this.lines = this.geom = this.mat = null;
  }
}

export default {
  id: 'FaceMesh',
  title: 'MESH',
  subtitle: 'WIREFRAME',
  category: 'FACE',
  preview: 'faceMesh',
  factory: () => new FaceMesh(),
};
