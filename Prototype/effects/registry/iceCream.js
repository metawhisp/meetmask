import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// Build a small ice cream group: cone (wafer) with a sphere (scoop) on top,
// plus a tiny cherry on top of the scoop. All procedural via Three.js
// primitives, drawn on a transparent canvas so they sit naturally on top of
// the live <video>.
function buildIceCream(radius) {
  const group = new THREE.Group();

  // Wafer cone, tip down. ConeGeometry's tip is +Y; we'll flip later.
  const coneGeo = new THREE.ConeGeometry(radius * 0.85, radius * 2.4, 28, 1, true);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xc88652, transparent: true, opacity: 0.96 });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.y = -radius * 1.2;
  cone.rotation.z = Math.PI; // tip points down
  group.add(cone);

  // Waffle pattern: cross-hatch lines on the cone using thin tori segments.
  const lineMat = new THREE.LineBasicMaterial({ color: 0x6c3a14, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 4; i++) {
    const y = -radius * 0.6 - i * radius * 0.4;
    const r = radius * 0.85 * (1 - (radius * 1.2 + y) / (radius * 2.4));
    if (r <= 0) continue;
    const ringGeo = new THREE.RingGeometry(r * 0.98, r, 32);
    const ringMat = new THREE.LineBasicMaterial({ color: 0x6c3a14, transparent: true, opacity: 0.5 });
    const ring = new THREE.LineSegments(new THREE.EdgesGeometry(ringGeo), ringMat);
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }

  // Scoop — pink ice cream sphere.
  const scoopGeo = new THREE.SphereGeometry(radius, 28, 22);
  const scoopMat = new THREE.MeshBasicMaterial({ color: 0xffb1d6 });
  const scoop = new THREE.Mesh(scoopGeo, scoopMat);
  scoop.position.y = radius * 0.15;
  group.add(scoop);

  // Cherry on top.
  const cherryGeo = new THREE.SphereGeometry(radius * 0.22, 16, 12);
  const cherryMat = new THREE.MeshBasicMaterial({ color: 0xd83a3a });
  const cherry = new THREE.Mesh(cherryGeo, cherryMat);
  cherry.position.y = radius * 1.05;
  group.add(cherry);

  // Tiny green stem.
  const stemGeo = new THREE.CylinderGeometry(radius * 0.03, radius * 0.03, radius * 0.18, 8);
  const stemMat = new THREE.MeshBasicMaterial({ color: 0x5a8a3a });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = radius * 1.22;
  stem.rotation.z = 0.2;
  group.add(stem);

  return group;
}

class IceCream extends Tracker {
  constructor() { super({ kind: 'face' }); }

  async setup(ctx) {
    // Initial radius is a guess; we rescale every frame from face width.
    this.group = buildIceCream(40);
    ctx.scene.add(this.group);
    // Simple "melting drip" particles spawned from the bottom of the scoop.
    const N = 60;
    this.drips = new Array(N).fill(null).map(() => ({
      life: 0,
      x: 0, y: 0,
      vx: 0, vy: 0,
    }));
    const dripGeo = new THREE.CircleGeometry(1, 10);
    const dripMat = new THREE.MeshBasicMaterial({ color: 0xff9ec7, transparent: true, opacity: 0.85 });
    this.dripMesh = new THREE.InstancedMesh(dripGeo, dripMat, N);
    this.dripMesh.frustumCulled = false;
    this.dripMesh.count = N;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) this.dripMesh.setMatrixAt(i, hide);
    this.dripMesh.instanceMatrix.needsUpdate = true;
    ctx.scene.add(this.dripMesh);
    this.dummy = new THREE.Object3D();
    this.spawnTimer = 0;
  }

  frame(faces, dt) {
    if (!faces.length) {
      this.group.visible = false;
      this.ctx.setHud('ICE CREAM — looking for a face');
      return;
    }
    this.group.visible = true;
    const lms = faces[0];

    // Anchor at top-of-head landmark 10, scaled by inter-temple distance.
    const [headX, headY] = this.toPx(lms[10].x,  lms[10].y);
    const [rX, rY]       = this.toPx(lms[127].x, lms[127].y); // right temple
    const [lX, lY]       = this.toPx(lms[356].x, lms[356].y); // left temple
    const faceWidth = Math.hypot(lX - rX, lY - rY);
    const tilt = Math.atan2(lY - rY, lX - rX);

    // Cone sits above the head; size scales with face width.
    const radius = faceWidth * 0.28;
    this.group.position.set(headX, headY - faceWidth * 0.55, 8);
    this.group.rotation.z = tilt;
    this.group.scale.setScalar(radius / 40); // 40 was the build-time radius

    // ---- Drips: spawn near bottom of scoop, fall with gravity, react to tilt
    this.spawnTimer += dt;
    const spawnEvery = 0.18;
    while (this.spawnTimer > spawnEvery) {
      this.spawnTimer -= spawnEvery;
      // find a dead drip slot
      const slot = this.drips.find((d) => d.life <= 0);
      if (slot) {
        const a = (Math.random() - 0.5) * Math.PI * 0.5;
        slot.x = this.group.position.x + Math.cos(a) * radius * 0.9;
        slot.y = this.group.position.y + Math.sin(Math.abs(a)) * radius * 0.4 + radius * 0.5;
        slot.vx = (Math.random() - 0.5) * 30 + Math.sin(tilt) * 80;
        slot.vy = 20;
        slot.life = 2.0 + Math.random();
      }
    }
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const g = 380; // px/s² downward
    for (let i = 0; i < this.drips.length; i++) {
      const d = this.drips[i];
      if (d.life <= 0) { this.dripMesh.setMatrixAt(i, hide); continue; }
      d.life -= dt;
      d.vy += g * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const sz = Math.max(2, radius * 0.12 * (d.life / 2.0));
      this.dummy.position.set(d.x, d.y, 7);
      this.dummy.scale.set(sz, sz, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.dripMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.dripMesh.instanceMatrix.needsUpdate = true;

    this.ctx.setHud(`ICE CREAM — tilt your head to make it melt`);
  }

  teardown() {
    if (this.group) this.ctx.scene.remove(this.group);
    if (this.dripMesh) { this.dripMesh.geometry.dispose(); this.ctx.scene.remove(this.dripMesh); }
    this.group = this.dripMesh = null;
  }
}

export default {
  id: 'IceCream',
  title: 'ICE CREAM',
  subtitle: 'WAFER + SCOOP + DRIPS',
  category: 'FACE',
  preview: 'iceCream',
  factory: () => new IceCream(),
};
