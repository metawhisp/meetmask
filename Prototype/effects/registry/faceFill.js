import * as THREE from 'three';
import { BaseTrackingEffect } from '../core/Tracker.js?v=3';

// A subset of MediaPipe's canonical face tessellation triangles. Using the
// full set (~870 triangles) is overkill for a stylised fill; this trimmed
// list (~80) gives the same gestalt at a fraction of the cost.
const TRIANGLES = [
  [10,338,297],[10,297,332],[10,332,284],[10,284,251],[10,251,389],
  [10,389,356],[10,356,454],[10,454,323],[10,323,361],[10,361,288],
  [10,288,397],[10,397,365],[10,365,379],[10,379,378],[10,378,400],
  [10,400,377],[10,377,152],[10,152,148],[10,148,176],[10,176,149],
  [10,149,150],[10,150,136],[10,136,172],[10,172,58],[10,58,132],
  [10,132,93],[10,93,234],[10,234,127],[10,127,162],[10,162,21],
  [10,21,54],[10,54,103],[10,103,67],[10,67,109],[10,109,10],
  [1,2,5],[2,5,4],[5,4,1],[1,168,6],[6,197,195],[195,5,4],
  [33,7,163],[33,163,144],[33,144,145],[33,145,153],[33,153,154],
  [263,249,390],[263,390,373],[263,373,374],[263,374,380],[263,380,381],
  [61,146,91],[61,91,181],[61,181,84],[61,84,17],[61,17,314],
  [291,375,321],[291,321,405],[291,405,314],[291,314,17],[291,17,84],
];

class FaceFill extends BaseTrackingEffect {
  constructor() {
    super({ kind: 'face', bg: { dim: 0.6, desat: 0.4 } });
    this.prevCenter = null;
    this.energy = 0;
  }
  async setup(ctx) {
    const positions = new Float32Array(TRIANGLES.length * 3 * 3);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xff66c4,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geom, this.mat);
    this.mesh.frustumCulled = false;
    ctx.scene.add(this.mesh);
  }
  frame(faces, dt) {
    const positions = this.geom.attributes.position.array;
    if (faces.length) {
      const lms = faces[0];
      // compute centroid in canvas pixels
      const nose = lms[1];
      const [cx, cy] = this.toPx(nose.x, nose.y);
      if (this.prevCenter) {
        const dx = cx - this.prevCenter[0];
        const dy = cy - this.prevCenter[1];
        const speed = Math.sqrt(dx*dx + dy*dy) / Math.max(0.001, dt);
        // smooth into energy
        this.energy += (Math.min(1, speed / 1200) - this.energy) * 0.25;
      }
      this.prevCenter = [cx, cy];
      for (let i = 0; i < TRIANGLES.length; i++) {
        const tri = TRIANGLES[i];
        for (let v = 0; v < 3; v++) {
          const lm = lms[tri[v]];
          const [x, y] = lm ? this.toPx(lm.x, lm.y) : [0, 0];
          positions[i * 9 + v * 3 + 0] = x;
          positions[i * 9 + v * 3 + 1] = y;
          positions[i * 9 + v * 3 + 2] = 1;
        }
      }
      // Color and opacity react to head motion: slow = pink, fast = electric.
      const hue = 0.92 - this.energy * 0.55; // pink → cyan
      this.mat.color.setHSL(hue, 0.85, 0.55);
      this.mat.opacity = 0.4 + this.energy * 0.55;
    } else {
      positions.fill(0);
      this.prevCenter = null;
      this.energy = 0;
    }
    this.geom.attributes.position.needsUpdate = true;
    this.ctx.setHud(`FACE FILL — move fast: it goes cyan · energy=${this.energy.toFixed(2)}`);
  }
  teardown() {
    if (this.mesh) { this.geom.dispose(); this.ctx.scene.remove(this.mesh); }
    if (this.mat) this.mat.dispose();
    this.mesh = this.geom = this.mat = null;
  }
}

export default {
  id: 'FaceFill',
  title: 'FACE FILL',
  subtitle: 'NEON MASK',
  category: 'FACE',
  preview: 'faceFill',
  factory: () => new FaceFill(),
};
