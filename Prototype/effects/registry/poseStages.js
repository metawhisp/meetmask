import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// POSE STAGES — head orientation chooses one of 6 dramatic visual stages.
// Each stage owns its own particle system (InstancedMesh) that animates
// opacity 0↔1 on a 0.5s cross-fade so transitions feel smooth, not jarring.
//
// Stage detection is intentionally hysteretic-friendly: we pick the stage
// with the strongest signal, but smooth its TARGET opacity rather than its
// active flag — so a borderline yaw doesn't visibly flicker the scene.
//
//   STAGES
//   ------
//   1. NEUTRAL   — blue/black starfield, gentle drifting particles
//   2. STORM     — diagonal rain, occasional electric-blue lightning flash
//   3. DESERT    — horizontal sand drift, warm sun glare in a corner
//   4. UNDERWATER— bubbles rising, aqua/teal tint, lateral distortion wobble
//   5. HEAVENLY  — golden light rays from top, white sparkles falling
//   6. FIRE      — flames rising around face, orange-red embers (smile bonus)

const PARTICLES_PER_STAGE = 80;
const FADE_TIME = 0.5;           // s — cross-fade duration
const YAW_THRESHOLD = 0.25;
const PITCH_THRESHOLD = 0.25;

// Stage indices and palette — kept side-by-side so picking a stage gives us
// everything we need (name, color, hud-tint) in one lookup.
const STAGES = [
  { id: 'NEUTRAL',    title: 'NEUTRAL',    color: 0x4a5cff, tint: 0x141a3a, hex: '#a8b8ff' },
  { id: 'STORM',      title: 'STORM',      color: 0x6fb0ff, tint: 0x202830, hex: '#bfe0ff' },
  { id: 'DESERT',     title: 'DESERT',     color: 0xffb84a, tint: 0x4a2a08, hex: '#ffd084' },
  { id: 'UNDERWATER', title: 'UNDERWATER', color: 0x6fffe9, tint: 0x05334a, hex: '#9bffe9' },
  { id: 'HEAVENLY',   title: 'HEAVENLY',   color: 0xffeaa8, tint: 0x4a4008, hex: '#fff6c8' },
  { id: 'FIRE',       title: 'FIRE',       color: 0xff6420, tint: 0x3a0a00, hex: '#ff9050' },
];

const NEUTRAL = 0, STORM = 1, DESERT = 2, UNDERWATER = 3, HEAVENLY = 4, FIRE = 5;

// ---------------------------------------------------------------------------
// One self-contained particle system per stage. Each defines spawn-state and
// per-frame integration; the parent effect owns the opacity blend.
// ---------------------------------------------------------------------------
class StageSystem {
  constructor(scene, w, h, color, blending = THREE.AdditiveBlending) {
    this.w = w; this.h = h;
    this.opacity = 0;
    this.targetOpacity = 0;
    this.parts = new Array(PARTICLES_PER_STAGE).fill(null).map(() => ({
      x: 0, y: 0, vx: 0, vy: 0, size: 4, seed: Math.random() * 1000, alive: false,
    }));
    const geo = new THREE.CircleGeometry(1, 12);
    this.mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0,
      depthTest: false, blending,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, PARTICLES_PER_STAGE);
    this.mesh.frustumCulled = false;
    this.mesh.count = PARTICLES_PER_STAGE;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < PARTICLES_PER_STAGE; i++) this.mesh.setMatrixAt(i, hide);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
  }
  blend(dt) {
    // First-order low-pass toward targetOpacity over ~FADE_TIME.
    const k = Math.min(1, dt / FADE_TIME);
    this.opacity += (this.targetOpacity - this.opacity) * k;
    this.mat.opacity = this.opacity;
    this.mesh.visible = this.opacity > 0.005;
  }
  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// PoseStages — orchestrates 6 systems, detects pose, drives cross-fade.
// ---------------------------------------------------------------------------
class PoseStages extends Tracker {
  constructor() {
    super({ kind: 'face' });
    this.systems = null;
    this.active = NEUTRAL;
    this.t = 0;
    this.lightning = 0;          // 0..1 burst envelope
    this.lightningNext = 2;      // s until next strike
    this.faceCenter = [0, 0];
    this.faceWidth = 200;
  }

  async setup(ctx) {
    const w = ctx.width, h = ctx.height;

    // Full-screen tint plane behind everything. We swap its color per stage.
    const tintGeo = new THREE.PlaneGeometry(w, h);
    this.tintMat = new THREE.MeshBasicMaterial({
      color: STAGES[NEUTRAL].tint, transparent: true, opacity: 0.15,
      depthTest: false, depthWrite: false,
    });
    this.tintMesh = new THREE.Mesh(tintGeo, this.tintMat);
    this.tintMesh.position.set(w / 2, h / 2, 0);
    this.tintMesh.frustumCulled = false;
    ctx.scene.add(this.tintMesh);
    this.tintColor = new THREE.Color(STAGES[NEUTRAL].tint);
    this.tintTarget = new THREE.Color(STAGES[NEUTRAL].tint);

    // Build one particle system per stage. Order matters only for z-stacking:
    // tint (z=0) below, particles (z=5-7) above, text (z=10) on top.
    this.systems = STAGES.map((s, i) => {
      const blend = (i === UNDERWATER) ? THREE.NormalBlending : THREE.AdditiveBlending;
      const sys = new StageSystem(ctx.scene, w, h, s.color, blend);
      sys.mesh.position.z = 5;
      return sys;
    });

    // Seed initial particle state for each stage. We re-seed off-screen
    // particles in their per-stage frame methods.
    this._seedNeutral();
    this._seedStorm();
    this._seedDesert();
    this._seedUnderwater();
    this._seedHeavenly();
    this._seedFire();

    // Lightning flash — a full-screen white plane that briefly turns opaque.
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xcfe8ff, transparent: true, opacity: 0,
      depthTest: false, depthWrite: false,
    });
    this.flashMesh = new THREE.Mesh(tintGeo.clone(), this.flashMat);
    this.flashMesh.position.set(w / 2, h / 2, 6);
    this.flashMesh.frustumCulled = false;
    ctx.scene.add(this.flashMesh);

    // Sun glare for DESERT (a soft, additive disc that rides one corner).
    const glareTex = makeRadialTexture('#fff5c0', '#ffaa30', '#ffaa3000');
    this.glareMat = new THREE.MeshBasicMaterial({
      map: glareTex, transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.glareMesh = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), this.glareMat);
    this.glareMesh.position.set(w - 80, 90, 7);
    this.glareMesh.frustumCulled = false;
    ctx.scene.add(this.glareMesh);

    // Light rays for HEAVENLY — a wide vertical gradient plane from the top.
    const rayTex = makeRayTexture();
    this.rayMat = new THREE.MeshBasicMaterial({
      map: rayTex, transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.rayMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h * 0.7), this.rayMat);
    this.rayMesh.position.set(w / 2, h * 0.35, 7);
    this.rayMesh.frustumCulled = false;
    ctx.scene.add(this.rayMesh);

    // Stage-name banner — CanvasTexture we re-paint when the stage changes.
    this.bannerCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (this.bannerCanvas) {
      this.bannerCanvas.width = 1024;
      this.bannerCanvas.height = 256;
      this.bannerCtx = this.bannerCanvas.getContext('2d');
      this.bannerTex = new THREE.CanvasTexture(this.bannerCanvas);
      this.bannerTex.minFilter = THREE.LinearFilter;
      this.bannerTex.magFilter = THREE.LinearFilter;
      this.bannerMat = new THREE.MeshBasicMaterial({
        map: this.bannerTex, transparent: true, opacity: 0.95,
        depthTest: false, depthWrite: false,
      });
      // Aspect-correct quad, anchored near the top of the canvas.
      const bw = Math.min(w * 0.9, 720);
      const bh = bw * (256 / 1024);
      this.bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), this.bannerMat);
      this.bannerMesh.position.set(w / 2, bh * 0.65 + 14, 10);
      this.bannerMesh.frustumCulled = false;
      ctx.scene.add(this.bannerMesh);
      this._paintBanner(STAGES[NEUTRAL]);
    }
  }

  // -- per-stage particle seeders ---------------------------------------------
  _seedNeutral() {
    for (const p of this.systems[NEUTRAL].parts) {
      p.x = Math.random() * this.ctx.width;
      p.y = Math.random() * this.ctx.height;
      p.vx = (Math.random() - 0.5) * 8;
      p.vy = (Math.random() - 0.5) * 8;
      p.size = 2 + Math.random() * 3;
      p.alive = true;
    }
  }
  _seedStorm() {
    for (const p of this.systems[STORM].parts) {
      p.x = Math.random() * this.ctx.width;
      p.y = Math.random() * this.ctx.height - this.ctx.height;
      p.vx = -120;
      p.vy = 480 + Math.random() * 220;
      p.size = 1.5 + Math.random() * 1.5;
      p.alive = true;
    }
  }
  _seedDesert() {
    for (const p of this.systems[DESERT].parts) {
      p.x = Math.random() * this.ctx.width;
      p.y = Math.random() * this.ctx.height;
      p.vx = 60 + Math.random() * 80;
      p.vy = -8 + Math.random() * 16;
      p.size = 2 + Math.random() * 4;
      p.alive = true;
    }
  }
  _seedUnderwater() {
    for (const p of this.systems[UNDERWATER].parts) {
      p.x = Math.random() * this.ctx.width;
      p.y = Math.random() * this.ctx.height + this.ctx.height * 0.2;
      p.vx = 0;
      p.vy = -40 - Math.random() * 60;
      p.size = 3 + Math.random() * 7;
      p.alive = true;
    }
  }
  _seedHeavenly() {
    for (const p of this.systems[HEAVENLY].parts) {
      p.x = Math.random() * this.ctx.width;
      p.y = Math.random() * this.ctx.height - this.ctx.height * 0.5;
      p.vx = (Math.random() - 0.5) * 30;
      p.vy = 50 + Math.random() * 70;
      p.size = 2 + Math.random() * 3;
      p.alive = true;
    }
  }
  _seedFire() {
    const [cx, cy] = this.faceCenter;
    for (const p of this.systems[FIRE].parts) {
      p.x = cx + (Math.random() - 0.5) * 240;
      p.y = cy + 60 + Math.random() * 80;
      p.vx = (Math.random() - 0.5) * 60;
      p.vy = -140 - Math.random() * 120;
      p.size = 5 + Math.random() * 6;
      p.alive = true;
    }
  }

  // -- pose detection ---------------------------------------------------------
  _detectStage(faces) {
    if (!faces.length) return NEUTRAL;
    const lms = faces[0];
    const [nx, ny] = this.toPx(lms[1].x, lms[1].y);
    const [rEyeX, rEyeY] = this.toPx(lms[33].x, lms[33].y);
    const [lEyeX, lEyeY] = this.toPx(lms[263].x, lms[263].y);
    const eyeMidX = (rEyeX + lEyeX) / 2;
    const eyeMidY = (rEyeY + lEyeY) / 2;
    const eyeDist = Math.max(1, Math.hypot(lEyeX - rEyeX, lEyeY - rEyeY));

    this.faceCenter = [eyeMidX, eyeMidY];
    this.faceWidth = eyeDist;

    // Smile detection: mouth corners (lm 61 and 291) sit above the inner-lip
    // midpoint when the user smiles. Use a small upward offset threshold
    // proportional to the face width so it scales with distance from camera.
    const [lcX, lcY] = this.toPx(lms[61].x, lms[61].y);
    const [rcX, rcY] = this.toPx(lms[291].x, lms[291].y);
    const [muX, muY] = this.toPx(lms[13].x, lms[13].y);
    const [mlX, mlY] = this.toPx(lms[14].x, lms[14].y);
    void lcX; void rcX; void muX; void mlX;
    const mouthMidY = (muY + mlY) / 2;
    const cornerY = (lcY + rcY) / 2;
    const smileOffset = (mouthMidY - cornerY) / eyeDist;
    if (smileOffset > 0.04) return FIRE;

    // Yaw — sign convention: positive when looking LEFT (per spec).
    const yaw = (nx - eyeMidX) / eyeDist;
    const pitch = (ny - eyeMidY) / eyeDist - 0.35;
    // ^ -0.35 baseline because nose tip naturally sits below eye-midline.

    // Pick the strongest pose signal above its threshold.
    const yawMag = Math.abs(yaw) - YAW_THRESHOLD;
    const pitchMag = Math.abs(pitch) - PITCH_THRESHOLD;
    if (yawMag < 0 && pitchMag < 0) return NEUTRAL;
    if (yawMag >= pitchMag) return (yaw > 0) ? STORM : DESERT;
    return (pitch > 0) ? UNDERWATER : HEAVENLY;
  }

  // -- per-stage integration --------------------------------------------------
  _updateSystem(idx, dt) {
    const sys = this.systems[idx];
    const w = this.ctx.width, h = this.ctx.height;
    const dummy = sys.dummy;
    for (let i = 0; i < sys.parts.length; i++) {
      const p = sys.parts[i];
      let s = p.size;
      let rot = 0;
      if (idx === NEUTRAL) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
        s = p.size * (0.6 + 0.4 * Math.sin(this.t * 2 + p.seed));
      } else if (idx === STORM) {
        // Diagonal rain — fall fast, wrap when off-screen.
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > h + 8 || p.x < -20) {
          p.x = Math.random() * w * 1.2;
          p.y = -10 - Math.random() * 80;
        }
        // Streaks: tall thin rectangles oriented down-left.
        s = p.size;
        rot = Math.atan2(p.vy, p.vx);
        const stretch = 8;
        dummy.position.set(p.x, p.y, 5);
        dummy.scale.set(s * stretch, s, 1);
        dummy.rotation.set(0, 0, rot);
        dummy.updateMatrix();
        sys.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      } else if (idx === DESERT) {
        p.x += p.vx * dt;
        p.y += p.vy * dt + Math.sin(this.t * 2 + p.seed) * 6 * dt;
        if (p.x > w + 10) { p.x = -10; p.y = Math.random() * h; }
        s = p.size * (0.7 + 0.3 * Math.sin(this.t * 3 + p.seed));
      } else if (idx === UNDERWATER) {
        // Bubbles rising; slight lateral wobble for the distortion feel.
        p.x += Math.sin(this.t * 1.5 + p.seed) * 25 * dt;
        p.y += p.vy * dt;
        if (p.y < -20) {
          p.x = Math.random() * w;
          p.y = h + 10 + Math.random() * 30;
          p.size = 3 + Math.random() * 7;
        }
        s = p.size;
      } else if (idx === HEAVENLY) {
        p.x += p.vx * dt + Math.sin(this.t + p.seed) * 8 * dt;
        p.y += p.vy * dt;
        if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
        // Twinkle so sparkles read as sparkles, not dots.
        s = p.size * (0.5 + 0.5 * Math.abs(Math.sin(this.t * 4 + p.seed)));
      } else if (idx === FIRE) {
        // Flames billow upward; accelerate; flicker scale with life.
        p.vy -= 240 * dt;
        p.vx *= 0.95;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // Respawn near face when off the top OR every ~1.2s by random chance.
        if (p.y < -20 || Math.random() < dt * 0.6) {
          const [cx, cy] = this.faceCenter;
          const r = this.faceWidth * 1.6;
          p.x = cx + (Math.random() - 0.5) * r;
          p.y = cy + 30 + Math.random() * 80;
          p.vx = (Math.random() - 0.5) * 80;
          p.vy = -120 - Math.random() * 140;
          p.size = 4 + Math.random() * 6;
        }
        s = p.size * (0.5 + 0.5 * Math.sin(this.t * 8 + p.seed));
      }
      dummy.position.set(p.x, p.y, 5);
      dummy.scale.set(s, s, 1);
      dummy.rotation.set(0, 0, rot);
      dummy.updateMatrix();
      sys.mesh.setMatrixAt(i, dummy.matrix);
    }
    sys.mesh.instanceMatrix.needsUpdate = true;
  }

  // -- banner / tint helpers --------------------------------------------------
  _paintBanner(stage) {
    if (!this.bannerCtx) return;
    const c = this.bannerCtx;
    const W = this.bannerCanvas.width, H = this.bannerCanvas.height;
    c.clearRect(0, 0, W, H);
    // Drop shadow first — slightly offset black copy under the main text.
    c.font = 'bold 180px ui-sans-serif, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillText(stage.title, W / 2 + 6, H / 2 + 8);
    // Stroke to lift the letters off chaotic stage particles.
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(0,0,0,0.75)';
    c.strokeText(stage.title, W / 2, H / 2);
    c.fillStyle = stage.hex;
    c.fillText(stage.title, W / 2, H / 2);
    if (this.bannerTex) this.bannerTex.needsUpdate = true;
  }

  // -- frame ------------------------------------------------------------------
  frame(faces, dt) {
    this.t += dt;
    if (!this.ctx) return;

    // 1) Pick active stage, set per-system targets so the rest cross-fades out.
    const next = this._detectStage(faces);
    if (next !== this.active) {
      this.active = next;
      this._paintBanner(STAGES[next]);
      this.tintTarget.set(STAGES[next].tint);
    }
    for (let i = 0; i < this.systems.length; i++) {
      this.systems[i].targetOpacity = (i === this.active) ? 1 : 0;
    }

    // 2) Integrate every stage's particles every frame (cheap; ~480 particles
    //    total). We need them positioned correctly the moment they fade in.
    for (let i = 0; i < this.systems.length; i++) {
      this._updateSystem(i, dt);
      this.systems[i].blend(dt);
    }

    // 3) Stage-specific overlays: glare (desert), rays (heaven), tint, flash.
    const glareTarget = (this.active === DESERT) ? 0.85 : 0;
    this.glareMat.opacity += (glareTarget - this.glareMat.opacity) * Math.min(1, dt / FADE_TIME);
    this.glareMesh.visible = this.glareMat.opacity > 0.005;

    const rayTarget = (this.active === HEAVENLY) ? 0.55 : 0;
    this.rayMat.opacity += (rayTarget - this.rayMat.opacity) * Math.min(1, dt / FADE_TIME);
    this.rayMesh.visible = this.rayMat.opacity > 0.005;
    if (this.rayMesh.visible) {
      // Subtle pulsing so the heavenly rays feel alive.
      this.rayMat.opacity *= 0.92 + 0.08 * Math.sin(this.t * 2);
    }

    // Lightning — only ticks during STORM; burst on a random interval.
    if (this.active === STORM) {
      this.lightningNext -= dt;
      if (this.lightningNext <= 0) {
        this.lightning = 1;
        this.lightningNext = 2 + Math.random() * 4;
      }
    } else {
      this.lightning = 0;
    }
    this.lightning = Math.max(0, this.lightning - dt * 3);
    this.flashMat.opacity = this.lightning * 0.65;
    this.flashMesh.visible = this.flashMat.opacity > 0.005;

    // Tint cross-fade — lerp RGB toward target.
    this.tintColor.lerp(this.tintTarget, Math.min(1, dt / FADE_TIME));
    this.tintMat.color.copy(this.tintColor);

    // Banner gently follows opacity of active system (fully visible once
    // settled, but doesn't snap on stage change).
    if (this.bannerMat) {
      const targetOp = (this.active === NEUTRAL) ? 0.75 : 0.95;
      this.bannerMat.opacity += (targetOp - this.bannerMat.opacity) * Math.min(1, dt / FADE_TIME);
    }

    this.ctx.setHud(`POSE STAGES · current: ${STAGES[this.active].title} · turn / tilt / smile to change`);
  }

  resize(w, h) {
    super.resize(w, h);
    if (this.tintMesh) {
      this.tintMesh.geometry.dispose();
      this.tintMesh.geometry = new THREE.PlaneGeometry(w, h);
      this.tintMesh.position.set(w / 2, h / 2, 0);
    }
    if (this.flashMesh) {
      this.flashMesh.geometry.dispose();
      this.flashMesh.geometry = new THREE.PlaneGeometry(w, h);
      this.flashMesh.position.set(w / 2, h / 2, 6);
    }
    if (this.rayMesh) {
      this.rayMesh.geometry.dispose();
      this.rayMesh.geometry = new THREE.PlaneGeometry(w, h * 0.7);
      this.rayMesh.position.set(w / 2, h * 0.35, 7);
    }
    if (this.glareMesh) this.glareMesh.position.set(w - 80, 90, 7);
    if (this.bannerMesh) {
      const bw = Math.min(w * 0.9, 720);
      const bh = bw * (256 / 1024);
      this.bannerMesh.geometry.dispose();
      this.bannerMesh.geometry = new THREE.PlaneGeometry(bw, bh);
      this.bannerMesh.position.set(w / 2, bh * 0.65 + 14, 10);
    }
    if (this.systems) {
      for (const sys of this.systems) { sys.w = w; sys.h = h; }
    }
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (!scene) return;
    if (this.systems) for (const sys of this.systems) sys.dispose(scene);
    this.systems = null;
    if (this.tintMesh) { scene.remove(this.tintMesh); this.tintMesh.geometry.dispose(); }
    if (this.tintMat) this.tintMat.dispose();
    if (this.flashMesh) { scene.remove(this.flashMesh); this.flashMesh.geometry.dispose(); }
    if (this.flashMat) this.flashMat.dispose();
    if (this.glareMesh) { scene.remove(this.glareMesh); this.glareMesh.geometry.dispose(); }
    if (this.glareMat) { if (this.glareMat.map) this.glareMat.map.dispose(); this.glareMat.dispose(); }
    if (this.rayMesh) { scene.remove(this.rayMesh); this.rayMesh.geometry.dispose(); }
    if (this.rayMat) { if (this.rayMat.map) this.rayMat.map.dispose(); this.rayMat.dispose(); }
    if (this.bannerMesh) { scene.remove(this.bannerMesh); this.bannerMesh.geometry.dispose(); }
    if (this.bannerMat) this.bannerMat.dispose();
    if (this.bannerTex) this.bannerTex.dispose();
    this.tintMesh = this.tintMat = null;
    this.flashMesh = this.flashMat = null;
    this.glareMesh = this.glareMat = null;
    this.rayMesh = this.rayMat = null;
    this.bannerMesh = this.bannerMat = this.bannerTex = this.bannerCanvas = this.bannerCtx = null;
  }
}

// ---------------------------------------------------------------------------
// Texture helpers — soft radial disc and a vertical "rays from top" gradient.
// SSR fallback (no document) returns 1x1 data textures so node --check passes.
// ---------------------------------------------------------------------------
function makeRadialTexture(c0, c1, c2) {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([255, 255, 255, 255]);
    const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  }
  const size = 256;
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = size;
  const c = cnv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, c0);
  g.addColorStop(0.45, c1);
  g.addColorStop(1, c2);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cnv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function makeRayTexture() {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([255, 255, 255, 255]);
    const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  }
  const w = 256, h = 512;
  const cnv = document.createElement('canvas');
  cnv.width = w; cnv.height = h;
  const c = cnv.getContext('2d');
  // Vertical fade base
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,235,160,0.9)');
  g.addColorStop(0.6, 'rgba(255,225,140,0.35)');
  g.addColorStop(1, 'rgba(255,225,140,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // A handful of "shafts" — soft white triangles widening downward.
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const x = (i + 0.5) * (w / 7);
    const grad = c.createLinearGradient(x, 0, x, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(x - 4, 0);
    c.lineTo(x + 4, 0);
    c.lineTo(x + 40, h);
    c.lineTo(x - 40, h);
    c.closePath();
    c.fill();
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Procedural launcher preview — 2x2 quadrants showing each stage's feel.
// ---------------------------------------------------------------------------
function preview(c) {
  const W = 320, H = 320, hw = W / 2, hh = H / 2;

  // NEUTRAL (top-left): midnight blue with starfield.
  const gN = c.createLinearGradient(0, 0, 0, hh);
  gN.addColorStop(0, '#0a0e2a'); gN.addColorStop(1, '#1c2358');
  c.fillStyle = gN; c.fillRect(0, 0, hw, hh);
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * hw, y = Math.random() * hh;
    const r = 1 + Math.random() * 2;
    const g = c.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(180,200,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 3, 0, Math.PI * 2); c.fill();
  }
  c.globalCompositeOperation = 'source-over';

  // STORM (top-right): dark gray + diagonal rain + lightning bolt.
  c.fillStyle = '#262a30'; c.fillRect(hw, 0, hw, hh);
  c.strokeStyle = 'rgba(170,210,255,0.55)'; c.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) {
    const x = hw + Math.random() * hw;
    const y = Math.random() * hh;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - 12, y + 28);
    c.stroke();
  }
  // Lightning bolt centred.
  c.strokeStyle = '#cfe8ff'; c.lineWidth = 2.4;
  c.beginPath();
  c.moveTo(hw + 90, 10);
  c.lineTo(hw + 75, 50);
  c.lineTo(hw + 95, 55);
  c.lineTo(hw + 70, 110);
  c.stroke();

  // DESERT (bottom-left): warm gradient + horizontal sand + sun.
  const gD = c.createLinearGradient(0, hh, 0, H);
  gD.addColorStop(0, '#c47a28'); gD.addColorStop(1, '#5a2c08');
  c.fillStyle = gD; c.fillRect(0, hh, hw, hh);
  c.globalCompositeOperation = 'lighter';
  const sun = c.createRadialGradient(20, hh + 30, 0, 20, hh + 30, 80);
  sun.addColorStop(0, 'rgba(255,240,180,0.9)');
  sun.addColorStop(1, 'rgba(255,200,80,0)');
  c.fillStyle = sun; c.fillRect(0, hh, hw, hh);
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = 'rgba(255,220,150,0.85)';
  for (let i = 0; i < 36; i++) {
    const x = Math.random() * hw;
    const y = hh + 30 + Math.random() * (hh - 40);
    c.fillRect(x, y, 4, 1.4);
  }

  // UNDERWATER (bottom-right): aqua with bubbles.
  const gU = c.createLinearGradient(0, hh, 0, H);
  gU.addColorStop(0, '#0a4858'); gU.addColorStop(1, '#031a26');
  c.fillStyle = gU; c.fillRect(hw, hh, hw, hh);
  for (let i = 0; i < 18; i++) {
    const x = hw + Math.random() * hw;
    const y = hh + Math.random() * hh;
    const r = 3 + Math.random() * 9;
    c.strokeStyle = 'rgba(170,255,235,0.85)'; c.lineWidth = 1.4;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = 'rgba(120,220,210,0.18)';
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }

  // Crosshair dividers between quadrants for that "split preview" look.
  c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(hw, 0); c.lineTo(hw, H); c.moveTo(0, hh); c.lineTo(W, hh); c.stroke();

  // Centred title plate.
  const plateW = 220, plateH = 56;
  const px = (W - plateW) / 2, py = (H - plateH) / 2;
  c.fillStyle = 'rgba(0,0,0,0.75)';
  c.fillRect(px, py, plateW, plateH);
  c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2;
  c.strokeRect(px, py, plateW, plateH);
  c.fillStyle = '#ffffff';
  c.font = 'bold 26px ui-sans-serif, system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('POSE STAGES', W / 2, H / 2);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
}

export default {
  id: 'PoseStages',
  title: 'POSE STAGES',
  subtitle: 'TURN · TILT · SMILE TO CHANGE',
  category: 'FACE',
  factory: () => new PoseStages(),
  preview,
};
