import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// HEADBANG — shake your head and the screen turns into a concert venue:
// strobe flash, neon particle burst from your head, rotating spotlight
// beams from screen edges, subtle screen shake, and a "BPM" readout
// derived from head oscillation frequency. Calm head = calm screen.

const MAX_PARTICLES = 150;
const NUM_BEAMS = 5;
// Bright neon palette — strobes pick from here. Avoid muddy mid-tones.
const STROBE_COLORS = [0x00ffff, 0xff00d4, 0xb6ff00, 0xffea00, 0xff7a00, 0xff2255];
// Distinct hues per spotlight beam so they read as separate stage lights.
const BEAM_HUES = [0.55, 0.85, 0.30, 0.10, 0.92];

class HeadBang extends Tracker {
  constructor() {
    super({ kind: 'face' });
    this.energy = 0;
    this.t = 0;
    this.lastNose = null;
    // Rolling buffer of {t, vy} samples for BPM (zero-crossings on vertical velocity).
    this.velHist = [];
    this.bpm = 0;
    this.spawnAcc = 0;
    this.strobeTimer = 0;
    this.strobeColorIdx = 0;
  }

  async setup(ctx) {
    // Everything lives inside `shaker` so we can offset the whole scene
    // for the screen-shake effect without touching individual meshes.
    this.shaker = new THREE.Group();
    ctx.scene.add(this.shaker);

    // --- Strobe: fullscreen additive plane, color/opacity animated per-frame.
    const strobeGeo = new THREE.PlaneGeometry(ctx.width, ctx.height);
    this.strobeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.strobe = new THREE.Mesh(strobeGeo, this.strobeMat);
    this.strobe.position.set(ctx.width / 2, ctx.height / 2, 2);
    this.strobe.renderOrder = 1;
    this.shaker.add(this.strobe);

    // --- Spotlight beams: long thin triangles built once, repositioned/rotated each frame.
    // The triangle apex sits at the beam origin (screen edge); base points inward.
    this.beams = [];
    for (let i = 0; i < NUM_BEAMS; i++) {
      // Unit triangle: apex at (0,0), base from (1,-0.18) to (1,0.18). We
      // scale X to the beam length and let X grow from origin along +X.
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        0, 0, 0,
        1, -0.18, 0,
        1, 0.18, 0,
      ]), 3));
      geo.setIndex([0, 1, 2]);
      const col = new THREE.Color().setHSL(BEAM_HUES[i % BEAM_HUES.length], 1, 0.6);
      const mat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = 3;
      mesh.frustumCulled = false;
      this.shaker.add(mesh);
      // origin chosen on construction so beams come from distinct edges.
      this.beams.push({ mesh, mat, phase: Math.random() * Math.PI * 2, originIdx: i });
    }

    // --- Particles: instanced quads with additive blend → glow.
    const partGeo = new THREE.CircleGeometry(1, 12);
    this.partMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    this.partMesh = new THREE.InstancedMesh(partGeo, this.partMat, MAX_PARTICLES);
    this.partMesh.frustumCulled = false;
    this.partMesh.count = MAX_PARTICLES;
    // Per-instance color so each spark can have its own neon hue.
    const colors = new Float32Array(MAX_PARTICLES * 3);
    this.partMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.partMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) this.partMesh.setMatrixAt(i, hide);
    this.partMesh.instanceMatrix.needsUpdate = true;
    this.partMesh.position.z = 0;
    this.shaker.add(this.partMesh);

    this.particles = new Array(MAX_PARTICLES).fill(null).map(() => ({
      life: 0, maxLife: 0.6, x: 0, y: 0, vx: 0, vy: 0, hue: 0, size: 4,
    }));
    this.dummy = new THREE.Object3D();
    this.colHelper = new THREE.Color();
  }

  spawnParticle(x, y) {
    const slot = this.particles.find((p) => p.life <= 0);
    if (!slot) return;
    const a = Math.random() * Math.PI * 2;
    const speed = 200 + Math.random() * 600;
    slot.x = x; slot.y = y;
    slot.vx = Math.cos(a) * speed;
    slot.vy = Math.sin(a) * speed;
    slot.maxLife = slot.life = 0.6;
    // Hue cycles continuously so adjacent sparks read as varied neon.
    slot.hue = (this.t * 0.4 + Math.random()) % 1;
    slot.size = 4 + Math.random() * 6;
  }

  updateParticles(dt) {
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const colors = this.partMesh.instanceColor.array;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (p.life <= 0) { this.partMesh.setMatrixAt(i, hide); continue; }
      p.life -= dt;
      // Canvas Y grows downward → gravity is POSITIVE for falling sparks.
      p.vy += 400 * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = Math.max(0, p.life / p.maxLife);
      const s = p.size * (0.4 + 0.6 * t);
      this.dummy.position.set(p.x, p.y, 1);
      this.dummy.scale.set(s, s, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.partMesh.setMatrixAt(i, this.dummy.matrix);
      this.colHelper.setHSL(p.hue, 1, 0.55 + 0.25 * t);
      colors[i * 3]     = this.colHelper.r;
      colors[i * 3 + 1] = this.colHelper.g;
      colors[i * 3 + 2] = this.colHelper.b;
    }
    this.partMesh.instanceMatrix.needsUpdate = true;
    this.partMesh.instanceColor.needsUpdate = true;
  }

  // Beam origin for index i, distributed around the four screen edges.
  beamOrigin(i, w, h) {
    // 0,1 top; 2 left; 3 right; 4 bottom (extends to NUM_BEAMS=5).
    const edge = [
      { x: w * 0.20, y: 0 },
      { x: w * 0.80, y: 0 },
      { x: 0,        y: h * 0.30 },
      { x: w,        y: h * 0.30 },
      { x: w * 0.50, y: h },
    ];
    return edge[i % edge.length];
  }

  updateBeams(headX, headY, w, h) {
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      const o = this.beamOrigin(i, w, h);
      // Aim roughly at the head but oscillate around that aim — a stage
      // spotlight that sweeps. Sweep amplitude grows with energy.
      const dx = headX - o.x;
      const dy = headY - o.y;
      const aimAngle = Math.atan2(dy, dx);
      const sweep = Math.sin(this.t * (1.2 + i * 0.37) + b.phase) * (0.25 + this.energy * 0.55);
      const angle = aimAngle + sweep;
      // Beam length: long enough to always cross the head.
      const length = Math.hypot(w, h) * 0.95;
      b.mesh.position.x = o.x;
      b.mesh.position.y = o.y;
      b.mesh.rotation.z = angle;
      b.mesh.scale.set(length, length, 1); // width = length*0.36, plenty of cone
      // Opacity scales with energy; small base so beams hint when calming down.
      const targetOp = this.energy * 0.45;
      b.mat.opacity = targetOp;
    }
  }

  updateStrobe(dt) {
    if (this.energy < 0.3) { this.strobeMat.opacity = 0; return; }
    // 6–8 Hz color flicker; pick a fresh bright color each cycle.
    this.strobeTimer -= dt;
    if (this.strobeTimer <= 0) {
      this.strobeTimer = 1 / (6 + Math.random() * 2);
      this.strobeColorIdx = (this.strobeColorIdx + 1 + ((Math.random() * 2) | 0)) % STROBE_COLORS.length;
      this.strobeMat.color.setHex(STROBE_COLORS[this.strobeColorIdx]);
    }
    this.strobeMat.opacity = this.energy * 0.4;
  }

  // Count sign changes in recent vy samples → oscillations per second → BPM.
  computeBpm(now) {
    // keep last 1 second
    const cutoff = now - 1.0;
    while (this.velHist.length && this.velHist[0].t < cutoff) this.velHist.shift();
    if (this.velHist.length < 4) return 0;
    let crossings = 0;
    for (let i = 1; i < this.velHist.length; i++) {
      const a = this.velHist[i - 1].vy;
      const b = this.velHist[i].vy;
      // Require minimum magnitude to ignore noise.
      if (Math.abs(a) > 80 && Math.abs(b) > 80 && (a > 0) !== (b > 0)) crossings++;
    }
    // 2 zero-crossings per full oscillation; *60 to per-minute.
    return (crossings / 2) * 60;
  }

  frame(faces, dt) {
    this.t += dt;
    const ctx = this.ctx;
    const w = ctx.width, h = ctx.height;

    let headX = w / 2, headY = h / 2;
    let speed = 0;
    let vy = 0;

    if (faces.length) {
      const lms = faces[0];
      // Nose tip — MediaPipe face landmark 1 is the most stable head proxy.
      const [nx, ny] = this.toPx(lms[1].x, lms[1].y);
      headX = nx; headY = ny;
      if (this.lastNose) {
        const dx = nx - this.lastNose.x;
        const dy = ny - this.lastNose.y;
        speed = Math.hypot(dx, dy) / Math.max(dt, 1 / 240);
        vy = dy / Math.max(dt, 1 / 240);
      }
      this.lastNose = { x: nx, y: ny };
      this.velHist.push({ t: this.t, vy });
    } else {
      this.lastNose = null;
    }

    // Energy: gain from fast motion, exponential-ish decay per frame.
    if (speed > 500) {
      this.energy = Math.min(1, this.energy + dt * speed / 1500);
    }
    // dt-aware decay so behaviour holds at any framerate (0.92/frame @60fps).
    this.energy *= Math.pow(0.92, dt * 60);
    if (this.energy < 0.001) this.energy = 0;

    this.bpm = this.computeBpm(this.t);

    // --- Spawn particles when active. Rate scales with energy.
    if (this.energy > 0.4 && faces.length) {
      this.spawnAcc += dt * this.energy * 200;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        // Small jitter around the head so the burst feels volumetric.
        const jx = (Math.random() - 0.5) * 30;
        const jy = (Math.random() - 0.5) * 30;
        this.spawnParticle(headX + jx, headY + jy);
      }
    } else {
      this.spawnAcc = 0;
    }
    this.updateParticles(dt);

    // --- Concert layers.
    this.updateStrobe(dt);
    this.updateBeams(headX, headY, w, h);

    // --- Screen shake: jitter the shaker group by a few pixels at high energy.
    // Capped at 12 px so it stays expressive without disorienting the user.
    const shakeMag = Math.min(12, this.energy * 14);
    this.shaker.position.x = (Math.random() - 0.5) * 2 * shakeMag;
    this.shaker.position.y = (Math.random() - 0.5) * 2 * shakeMag;

    ctx.setHud(
      `HEADBANG · energy: ${(this.energy * 100) | 0}% · BPM: ${this.bpm | 0} · keep shaking!`,
    );
  }

  teardown() {
    if (!this.shaker) return;
    this.shaker.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.ctx.scene.remove(this.shaker);
    this.shaker = null;
    this.partMesh = null;
    this.beams = null;
  }
}

// Procedural 320×320 preview: dark concert backdrop, vertical strobe streaks,
// converging spotlight beams, blurred face silhouette, and a few neon sparks.
function preview(g) {
  const W = 320, H = 320;
  // Background: deep purple → black.
  const bg = g.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, 240);
  bg.addColorStop(0, '#1b0030');
  bg.addColorStop(1, '#000');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // Vertical strobe streaks (additive screen blend).
  g.globalCompositeOperation = 'screen';
  const streakColors = ['#00f0ff', '#ff2bd6', '#caff00', '#ffd400'];
  for (let i = 0; i < 8; i++) {
    const x = (i + 0.5) * (W / 8) + (Math.sin(i * 1.7) * 8);
    const grd = g.createLinearGradient(x, 0, x, H);
    const c = streakColors[i % streakColors.length];
    grd.addColorStop(0, c + '00');
    grd.addColorStop(0.5, c + 'cc');
    grd.addColorStop(1, c + '00');
    g.fillStyle = grd;
    g.fillRect(x - 4, 0, 8, H);
  }
  g.globalCompositeOperation = 'source-over';

  // Spotlight beams converging on center.
  const beams = [
    { x: 0,   y: 40,  col: 'rgba(0,240,255,' },
    { x: W,   y: 30,  col: 'rgba(255,40,200,' },
    { x: 40,  y: H,   col: 'rgba(200,255,0,' },
  ];
  g.globalCompositeOperation = 'screen';
  for (const b of beams) {
    const cx = W / 2, cy = H / 2 + 10;
    const ang = Math.atan2(cy - b.y, cx - b.x);
    const len = Math.hypot(cx - b.x, cy - b.y) + 60;
    g.save();
    g.translate(b.x, b.y);
    g.rotate(ang);
    const grd = g.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, b.col + '0.85)');
    grd.addColorStop(1, b.col + '0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len, -len * 0.18);
    g.lineTo(len, len * 0.18);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.globalCompositeOperation = 'source-over';

  // Face silhouette with motion blur — three offset ellipses stacked.
  g.globalCompositeOperation = 'multiply';
  const offsets = [-12, 0, 12];
  const alphas = [0.55, 0.8, 0.55];
  for (let i = 0; i < offsets.length; i++) {
    g.fillStyle = `rgba(10,10,16,${alphas[i]})`;
    g.beginPath();
    g.ellipse(W / 2 + offsets[i], H / 2 + 20, 58, 78, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';

  // Neon sparks bursting from head.
  g.globalCompositeOperation = 'screen';
  const sparkColors = ['#00ffea', '#ff39ff', '#bbff00', '#ffd000', '#ff5500'];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + 0.4;
    const r = 60 + (i % 4) * 18 + (i * 13 % 22);
    const x = W / 2 + Math.cos(a) * r;
    const y = H / 2 + 10 + Math.sin(a) * r * 0.85;
    const c = sparkColors[i % sparkColors.length];
    const rad = 2 + (i % 3);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad * 4);
    grd.addColorStop(0, c);
    grd.addColorStop(1, c + '00');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad * 4, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}

export default {
  id: 'HeadBang',
  title: 'HEADBANG',
  subtitle: 'SHAKE FOR CONCERT MODE',
  category: 'FACE',
  factory: () => new HeadBang(),
  preview,
};
