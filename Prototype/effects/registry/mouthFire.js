import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

const MAX_PARTICLES = 200;

// Cheap per-particle Verlet: gravity + small drag, with life decaying.
class Particles {
  constructor(scene) {
    const geo = new THREE.CircleGeometry(1, 10);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffaa30,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX_PARTICLES);
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX_PARTICLES;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) this.mesh.setMatrixAt(i, hide);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.col = new THREE.Color();
    this.particles = new Array(MAX_PARTICLES).fill(null).map(() => ({
      life: 0, maxLife: 1,
      x: 0, y: 0, vx: 0, vy: 0,
      size: 4, hue: 0.07,
    }));
  }

  spawn(x, y, vx, vy, opts = {}) {
    const slot = this.particles.find((p) => p.life <= 0);
    if (!slot) return;
    slot.life = slot.maxLife = opts.life ?? (1.2 + Math.random() * 0.6);
    slot.x = x; slot.y = y;
    slot.vx = vx; slot.vy = vy;
    slot.size = opts.size ?? (6 + Math.random() * 6);
    slot.hue = opts.hue ?? (0.04 + Math.random() * 0.10); // orange→yellow range
  }

  update(dt) {
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (p.life <= 0) { this.mesh.setMatrixAt(i, hide); continue; }
      p.life -= dt;
      // gravity is NEGATIVE because canvas Y grows downward; we want flames up
      p.vy += -180 * dt;
      p.vx *= 0.96;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = Math.max(0, p.life / p.maxLife);
      const s = p.size * (0.6 + 0.4 * t);
      this.dummy.position.set(p.x, p.y, 6);
      this.dummy.scale.set(s, s, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(scene) {
    if (this.mesh) { this.mesh.geometry.dispose(); scene.remove(this.mesh); }
    if (this.mat) this.mat.dispose();
    this.mesh = this.mat = null;
  }
}

class MouthFire extends Tracker {
  constructor() { super({ kind: 'face' }); }

  async setup(ctx) {
    this.particles = new Particles(ctx.scene);
    this.spawnAcc = 0;
  }

  frame(faces, dt) {
    if (!faces.length) {
      this.particles.update(dt);
      this.ctx.setHud('FIRE — open your mouth to spit flames');
      return;
    }
    const lms = faces[0];
    // Mouth-aperture / face-width ratio gives a normalised "openness".
    const [ux, uy] = this.toPx(lms[13].x,  lms[13].y); // upper inner lip
    const [lxp, lyp] = this.toPx(lms[14].x, lms[14].y); // lower inner lip
    const [rEyeX] = this.toPx(lms[33].x,  lms[33].y);
    const [lEyeX] = this.toPx(lms[263].x, lms[263].y);
    const faceWidth = Math.abs(lEyeX - rEyeX);
    const mouthGap = Math.hypot(ux - lxp, uy - lyp);
    const openRatio = Math.min(1, mouthGap / Math.max(1, faceWidth * 0.45));

    // Mouth center for spawn origin.
    const mx = (ux + lxp) / 2;
    const my = (uy + lyp) / 2;

    // Particle spawn rate scales with openness.
    if (openRatio > 0.12) {
      this.spawnAcc += dt * (40 + openRatio * 320);
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        const a = (Math.random() - 0.5) * 0.8 - Math.PI / 2; // mostly upward
        const speed = 220 + Math.random() * 260;
        const vx = Math.cos(a) * speed * (0.4 + 0.6 * openRatio);
        const vy = Math.sin(a) * speed;
        const size = (faceWidth * 0.04) * (0.7 + Math.random() * 0.6);
        this.particles.spawn(
          mx + (Math.random() - 0.5) * faceWidth * 0.04,
          my,
          vx, vy,
          { size, life: 0.6 + Math.random() * 0.8 },
        );
      }
    }
    this.particles.update(dt);
    this.ctx.setHud(`FIRE — mouth ${(openRatio * 100).toFixed(0)}% open`);
  }

  teardown() {
    if (this.particles) this.particles.dispose(this.ctx.scene);
    this.particles = null;
  }
}

export default {
  id: 'MouthFire',
  title: 'FIRE',
  subtitle: 'OPEN MOUTH = FLAMES',
  category: 'FACE',
  preview: 'mouthFire',
  factory: () => new MouthFire(),
};
