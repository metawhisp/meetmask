import * as THREE from 'three';
import { BaseTrackingEffect } from '../core/Tracker.js?v=3';

const MAX_LANDMARKS = 478;

class FaceDots extends BaseTrackingEffect {
  constructor() {
    super({ kind: 'face', bg: { dim: 0.45, desat: 0.3 } });
    this.dummy = new THREE.Object3D();
    this.detected = 0;
  }
  async setup(ctx) {
    const geo = new THREE.CircleGeometry(1, 12);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false });
    this.dots = new THREE.InstancedMesh(geo, this.mat, MAX_LANDMARKS);
    this.dots.frustumCulled = false;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_LANDMARKS; i++) this.dots.setMatrixAt(i, hidden);
    this.dots.instanceMatrix.needsUpdate = true;
    ctx.scene.add(this.dots);
  }
  frame(faces) {
    const { ctx } = this;
    const r = Math.max(2, Math.min(ctx.width, ctx.height) * 0.0035);
    let used = 0;
    for (let f = 0; f < faces.length && f < 1; f++) {
      const lms = faces[f];
      for (let i = 0; i < lms.length && used < MAX_LANDMARKS; i++) {
        const lm = lms[i];
        const [px, py] = this.toPx(lm.x, lm.y);
        const s = Math.max(0.8, r * (1.0 + (lm.z || 0) * -3.0));
        this.dummy.position.set(px, py, 1);
        this.dummy.scale.setScalar(s);
        this.dummy.updateMatrix();
        this.dots.setMatrixAt(used++, this.dummy.matrix);
      }
    }
    if (used !== this.detected) {
      const hide = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = used; i < this.detected; i++) this.dots.setMatrixAt(i, hide);
      this.detected = used;
    }
    this.dots.instanceMatrix.needsUpdate = true;
    ctx.setHud(`FACE DOTS — ${faces.length ? 'face' : 'no face'} · ${used} pts`);
  }
  teardown() {
    if (this.dots) { this.dots.geometry.dispose(); this.ctx.scene.remove(this.dots); }
    if (this.mat) this.mat.dispose();
    this.dots = this.mat = null;
  }
}

export default {
  id: 'FaceDots',
  title: 'FACE DOTS',
  subtitle: 'MEDIAPIPE 478',
  category: 'FACE',
  preview: 'faceDots',
  factory: () => new FaceDots(),
};
