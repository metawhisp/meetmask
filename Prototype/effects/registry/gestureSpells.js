import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';
import { loadGestureRecognizer } from '../core/mpLoader.js';

// ============================================================================
// GESTURE SPELLS — six visual spells, each triggered by a different gesture.
//
//   Closed_Fist   -> FIREBALL (orange/red particles radiating outward)
//   Open_Palm     -> SHOCKWAVE (expanding cyan concentric rings)
//   Pointing_Up   -> LASER     (vertical beam from index fingertip)
//   Victory       -> STARS     (rainbow 4-pointed stars floating up)
//   Thumb_Up      -> CONFETTI  (colored paper bits falling with gravity)
//   ILoveYou      -> HEARTS    (pink heart shapes floating up)
//
// All spells run in parallel particle pools and may fire simultaneously from
// either hand. When the gesture ends the pool keeps animating to drain.
// ============================================================================

// Top gesture must beat this confidence to count as "held".
const GESTURE_THRESHOLD = 0.5;

// MediaPipe landmarks 0,5,9,13,17 (wrist + 4 base knuckles) average to a stable
// palm center independent of finger pose.
const PALM_IDXS = [0, 5, 9, 13, 17];
function palmCenter(lms) {
  let x = 0, y = 0;
  for (const i of PALM_IDXS) { x += lms[i].x; y += lms[i].y; }
  return { x: x / PALM_IDXS.length, y: y / PALM_IDXS.length };
}

// ---------------------------------------------------------------------------
// Shape factories — custom geometries for stars and hearts.
// ---------------------------------------------------------------------------

function makeStarGeometry(outerR = 1, innerR = 0.4) {
  // 4-pointed star: alternating outer/inner radii around 8 vertices.
  const shape = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 4);
}

function makeHeartGeometry(scale = 1) {
  // Classic heart cardioid via two arcs and a V tip.
  const s = scale;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.3 * s);
  shape.bezierCurveTo(0, 0.6 * s, -0.6 * s, 0.6 * s, -0.6 * s, 0.15 * s);
  shape.bezierCurveTo(-0.6 * s, -0.2 * s, -0.3 * s, -0.45 * s, 0, -0.7 * s);
  shape.bezierCurveTo(0.3 * s, -0.45 * s, 0.6 * s, -0.2 * s, 0.6 * s, 0.15 * s);
  shape.bezierCurveTo(0.6 * s, 0.6 * s, 0, 0.6 * s, 0, 0.3 * s);
  return new THREE.ShapeGeometry(shape, 8);
}

// ---------------------------------------------------------------------------
// Generic instanced-particle pool. Each spell parameterises geometry, material,
// spawn() params, and an updateOne() callback that mutates the slot per frame.
// ---------------------------------------------------------------------------

class ParticlePool {
  constructor(scene, geometry, material, capacity, updateOne) {
    this.capacity = capacity;
    this.updateOne = updateOne;
    this.mat = material;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = capacity;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 3), 3,
    );
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, hide);
      this.mesh.instanceColor.setXYZ(i, 1, 1, 1);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.col = new THREE.Color();
    this.particles = new Array(capacity).fill(null).map(() => ({ life: 0 }));
  }

  spawn(initialiser) {
    const slot = this.particles.find((p) => p.life <= 0);
    if (!slot) return null;
    initialiser(slot);
    return slot;
  }

  update(dt) {
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    let anyColor = false;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (p.life <= 0) { this.mesh.setMatrixAt(i, hide); continue; }
      p.life -= dt;
      const alive = this.updateOne(p, dt, this.dummy, this.col, i);
      if (alive) {
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        if (p._hasColor) {
          this.mesh.instanceColor.setXYZ(i, this.col.r, this.col.g, this.col.b);
          anyColor = true;
        }
      } else {
        p.life = 0;
        this.mesh.setMatrixAt(i, hide);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (anyColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(scene) {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    if (this.mat) this.mat.dispose();
    scene.remove(this.mesh);
    this.mesh = null;
  }
}

// ---------------------------------------------------------------------------
// FIREBALL — particles burst outward from fist; orange→red→smoke decay.
// ---------------------------------------------------------------------------
function makeFireballPool(scene) {
  const geo = new THREE.CircleGeometry(1, 12);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false,
    blending: THREE.AdditiveBlending, vertexColors: false,
  });
  return new ParticlePool(scene, geo, mat, 220, (p, dt, dummy, col) => {
    // Drag-only motion: ballistic outward radial burst with mild rise.
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.vy -= 60 * dt; // slight upward buoyancy
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const t = p.life / p.maxLife;             // 1 fresh -> 0 dead
    const k = 1 - t;                          // 0 fresh -> 1 dead
    // Hue glide orange (0.08) -> deep red (0.00) -> grey (sat to 0).
    const hue = 0.09 * t;
    const sat = Math.max(0, t * 1.1);
    const lum = 0.55 - 0.25 * k;
    col.setHSL(hue, sat, lum);
    p._hasColor = true;
    const s = p.size * (0.55 + 0.55 * t);
    dummy.position.set(p.x, p.y, 6);
    dummy.scale.set(s, s, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    return true;
  });
}

function spawnFireball(pool, px, py, count) {
  for (let i = 0; i < count; i++) {
    pool.spawn((s) => {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 220;
      s.life = s.maxLife = 0.35 + Math.random() * 0.25;
      s.x = px + Math.cos(a) * 4;
      s.y = py + Math.sin(a) * 4;
      s.vx = Math.cos(a) * sp;
      s.vy = Math.sin(a) * sp;
      s.size = 12 + Math.random() * 18;
    });
  }
}

// ---------------------------------------------------------------------------
// SHOCKWAVE — small pool of expanding cyan rings. Up to 3 concurrent rings.
// ---------------------------------------------------------------------------

class ShockwavePool {
  constructor(scene) {
    this.scene = scene;
    this.maxRings = 6;
    this.rings = [];
    for (let i = 0; i < this.maxRings; i++) {
      // Unit ring; we scale per frame from 0 to ~200px.
      const geo = new THREE.RingGeometry(0.85, 1.0, 64);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x55ffff, transparent: true, opacity: 0, depthTest: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.position.z = 5;
      scene.add(mesh);
      this.rings.push({ mesh, geo, mat, life: 0, maxLife: 0, x: 0, y: 0, maxR: 0 });
    }
  }

  spawn(px, py) {
    const slot = this.rings.find((r) => r.life <= 0);
    if (!slot) return;
    slot.life = slot.maxLife = 0.9;
    slot.x = px; slot.y = py;
    slot.maxR = 220;
    slot.mesh.visible = true;
  }

  update(dt) {
    for (const r of this.rings) {
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;       // 0 fresh -> 1 dead
      if (t >= 1) { r.life = 0; r.mesh.visible = false; continue; }
      const radius = r.maxR * t;
      r.mesh.position.set(r.x, r.y, 5);
      r.mesh.scale.set(radius, radius, 1);
      // Soft thickness sketch: shrink ring band slightly as it grows by
      // tweaking material opacity (fades out toward end).
      r.mat.opacity = 0.9 * (1 - t) * (1 - t);
    }
  }

  dispose(scene) {
    for (const r of this.rings) {
      r.geo.dispose(); r.mat.dispose(); scene.remove(r.mesh);
    }
    this.rings.length = 0;
  }
}

// ---------------------------------------------------------------------------
// LASER — vertical beam from fingertip up to top of canvas. The beam itself is
// a single Plane scaled per frame; falling streak particles add motion.
// ---------------------------------------------------------------------------

class LaserSystem {
  constructor(scene, canvasH) {
    this.scene = scene;
    this.canvasH = canvasH;
    // Beam plane: 1x1 unit, anchored at top-center, scaled per frame.
    const beamGeo = new THREE.PlaneGeometry(1, 1);
    // Anchor at top edge by shifting vertices: top edge at y=0, body extends down.
    beamGeo.translate(0, -0.5, 0);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xff3b6a, transparent: true, opacity: 0.85, depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.beam.position.z = 4;
    scene.add(this.beam);

    // Thin bright core, slightly different rotation/blend to read as "core".
    const coreGeo = new THREE.PlaneGeometry(1, 1);
    coreGeo.translate(0, -0.5, 0);
    this.coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.core.frustumCulled = false;
    this.core.visible = false;
    this.core.position.z = 5;
    scene.add(this.core);

    // Streak particles falling down the beam.
    const sGeo = new THREE.PlaneGeometry(1, 1);
    const sMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.streaks = new ParticlePool(scene, sGeo, sMat, 80,
      (p, dt, dummy, col) => {
        p.y += p.vy * dt;
        p.x += (Math.random() - 0.5) * 1.5; // mild jitter
        col.setHSL(0.95, 1.0, 0.6 + 0.3 * Math.random());
        p._hasColor = true;
        const t = p.life / p.maxLife;
        const w = p.size * (0.5 + 0.5 * t);
        const h = p.size * 4;
        dummy.position.set(p.x, p.y, 4.5);
        dummy.scale.set(w, h, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        return true;
      });

    this.time = 0;
    this.spawnAcc = 0;
  }

  setCanvasH(h) { this.canvasH = h; }

  // Active flag held externally; called each frame regardless so beam fades.
  update(dt, active, tipX, tipY) {
    this.time += dt;
    if (active) {
      // Pulse thickness between 8 and 16 px; core is 1/3 width.
      const pulse = 8 + 4 * (1 + Math.sin(this.time * 14));
      const beamH = tipY; // from tip up to y=0 (top of canvas)
      this.beam.visible = true;
      this.beam.position.set(tipX, tipY, 4);
      this.beam.scale.set(pulse, Math.max(2, beamH), 1);
      this.beamMat.opacity = 0.85;
      this.core.visible = true;
      this.core.position.set(tipX, tipY, 5);
      this.core.scale.set(pulse * 0.32, Math.max(2, beamH), 1);

      // Spawn ~30 streaks/sec falling down the beam.
      this.spawnAcc += dt * 30;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        this.streaks.spawn((s) => {
          s.life = s.maxLife = 0.25 + Math.random() * 0.25;
          s.x = tipX + (Math.random() - 0.5) * pulse;
          s.y = Math.random() * tipY;
          s.vy = 350 + Math.random() * 250; // downward (canvas Y grows down)
          s.size = 2 + Math.random() * 2;
        });
      }
    } else {
      // Fade beam quickly when released.
      this.beamMat.opacity = Math.max(0, this.beamMat.opacity - dt * 4);
      if (this.beamMat.opacity <= 0) { this.beam.visible = false; this.core.visible = false; }
    }
    this.streaks.update(dt);
  }

  dispose(scene) {
    this.beam.geometry.dispose(); this.beamMat.dispose(); scene.remove(this.beam);
    this.core.geometry.dispose(); this.coreMat.dispose(); scene.remove(this.core);
    this.streaks.dispose(scene);
  }
}

// ---------------------------------------------------------------------------
// STARS — rainbow 4-pointed stars float upward, drifting sideways via sin.
// ---------------------------------------------------------------------------
function makeStarPool(scene) {
  const geo = makeStarGeometry(1, 0.4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false,
    blending: THREE.AdditiveBlending, vertexColors: false,
  });
  return new ParticlePool(scene, geo, mat, 60, (p, dt, dummy, col) => {
    p.age += dt;
    p.x = p.x0 + Math.sin(p.age * p.swayF) * p.swayA;
    p.y += p.vy * dt;
    p.rot += p.rotV * dt;
    const t = p.life / p.maxLife;
    col.setHSL((p.hue + p.age * 0.4) % 1, 0.95, 0.65);
    p._hasColor = true;
    const sz = p.size * (0.4 + 0.6 * Math.sin(Math.PI * (1 - t)));
    dummy.position.set(p.x, p.y, 6);
    dummy.scale.set(sz, sz, 1);
    dummy.rotation.set(0, 0, p.rot);
    dummy.updateMatrix();
    return true;
  });
}

function spawnStar(pool, px, py) {
  pool.spawn((s) => {
    s.life = s.maxLife = 1.2 + Math.random() * 0.6;
    s.age = 0;
    s.x0 = px + (Math.random() - 0.5) * 60;
    s.x = s.x0;
    s.y = py + (Math.random() - 0.5) * 30;
    s.vy = -(60 + Math.random() * 80);       // upward (canvas Y down)
    s.size = 14 + Math.random() * 12;
    s.hue = Math.random();
    s.swayA = 10 + Math.random() * 30;
    s.swayF = 2 + Math.random() * 4;
    s.rot = Math.random() * Math.PI;
    s.rotV = (Math.random() - 0.5) * 3;
  });
}

// ---------------------------------------------------------------------------
// CONFETTI — colored rectangles fall with gravity + air resistance, spinning.
// ---------------------------------------------------------------------------
function makeConfettiPool(scene) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false,
    side: THREE.DoubleSide, vertexColors: false,
    // Confetti reads better with normal blending so colors stay solid.
    blending: THREE.NormalBlending,
  });
  return new ParticlePool(scene, geo, mat, 180, (p, dt, dummy, col) => {
    p.vy += 240 * dt;            // gravity (canvas Y grows down)
    p.vx *= 0.985;               // air resistance
    p.x += p.vx * dt + Math.sin(p.age * 6 + p.phase) * 15 * dt;
    p.y += p.vy * dt;
    p.rot += p.rotV * dt;
    p.age += dt;
    col.setRGB(p.r, p.g, p.b);
    p._hasColor = true;
    const t = p.life / p.maxLife;
    const flatten = 0.4 + 0.6 * Math.abs(Math.sin(p.age * 8));
    dummy.position.set(p.x, p.y, 6);
    dummy.scale.set(p.w, p.h * flatten, 1);
    dummy.rotation.set(0, 0, p.rot);
    dummy.updateMatrix();
    return t > 0;
  });
}

const CONFETTI_PALETTE = [
  [1.00, 0.20, 0.40], [0.20, 0.80, 1.00], [1.00, 0.85, 0.20],
  [0.45, 1.00, 0.40], [1.00, 0.45, 1.00], [0.30, 0.55, 1.00],
];
function spawnConfetti(pool, px, py, count) {
  for (let i = 0; i < count; i++) {
    pool.spawn((s) => {
      s.life = s.maxLife = 2.2 + Math.random();
      s.age = 0;
      s.x = px + (Math.random() - 0.5) * 80;
      s.y = py - 60 - Math.random() * 40;     // start ABOVE the palm
      s.vx = (Math.random() - 0.5) * 120;
      s.vy = 40 + Math.random() * 60;
      s.w = 6 + Math.random() * 6;
      s.h = 10 + Math.random() * 10;
      s.rot = Math.random() * Math.PI * 2;
      s.rotV = (Math.random() - 0.5) * 12;
      s.phase = Math.random() * Math.PI * 2;
      const c = CONFETTI_PALETTE[(Math.random() * CONFETTI_PALETTE.length) | 0];
      s.r = c[0]; s.g = c[1]; s.b = c[2];
    });
  }
}

// ---------------------------------------------------------------------------
// HEARTS — pink hearts pop in, float up + sway, fade out.
// ---------------------------------------------------------------------------
function makeHeartPool(scene) {
  const geo = makeHeartGeometry(1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff5599, transparent: true, opacity: 0.95, depthTest: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexColors: false,
  });
  return new ParticlePool(scene, geo, mat, 60, (p, dt, dummy, col) => {
    p.age += dt;
    p.x = p.x0 + Math.sin(p.age * p.swayF) * p.swayA;
    p.y += p.vy * dt;
    const t = p.life / p.maxLife;
    // Scale-up over first 0.25s, then steady, then fade by alpha-via-color trick:
    const pop = Math.min(1, p.age / 0.25);
    const sz = p.size * (0.3 + 0.7 * pop) * (0.7 + 0.3 * t);
    // Vary pink tone slightly per heart, dim with life (since one material).
    const fade = Math.max(0, Math.min(1, t * 2));
    col.setHSL(0.92 + 0.06 * p.tone, 0.85, 0.55 + 0.15 * Math.sin(p.age * 5));
    col.multiplyScalar(0.4 + 0.6 * fade);
    p._hasColor = true;
    dummy.position.set(p.x, p.y, 6);
    dummy.scale.set(sz, sz, 1);
    dummy.rotation.set(0, 0, Math.sin(p.age * 2.5) * 0.18);
    dummy.updateMatrix();
    return true;
  });
}

function spawnHeart(pool, px, py) {
  pool.spawn((s) => {
    s.life = s.maxLife = 1.5 + Math.random() * 0.6;
    s.age = 0;
    s.x0 = px + (Math.random() - 0.5) * 50;
    s.x = s.x0;
    s.y = py + (Math.random() - 0.5) * 20;
    s.vy = -(80 + Math.random() * 60);
    s.size = 30 + Math.random() * 18;
    s.swayA = 8 + Math.random() * 24;
    s.swayF = 1.5 + Math.random() * 2.5;
    s.tone = Math.random();
  });
}

// ===========================================================================
// Main effect class.
// ===========================================================================

const SPELL_LABELS = {
  Closed_Fist: 'fire',
  Open_Palm:   'wave',
  Pointing_Up: 'laser',
  Victory:     'stars',
  Thumb_Up:    'confetti',
  ILoveYou:    'hearts',
};

class GestureSpells extends Tracker {
  constructor() {
    super({ kind: 'hand', numHands: 2 });
    this.lastVideoTime = -1;
    // Per-spell spawn accumulators for time-based emitters.
    this.shockTimers = [0, 0];
    this.starTimers  = [0, 0];
    this.heartTimers = [0, 0];
    this.lastDetected = '—';
  }

  async setup(ctx) {
    // Load the gesture recognizer in addition to the hand landmarker that the
    // base Tracker already initialised.
    this.gestureRec = await loadGestureRecognizer({ numHands: 2 });

    this.fireball  = makeFireballPool(ctx.scene);
    this.shockwave = new ShockwavePool(ctx.scene);
    this.laser     = new LaserSystem(ctx.scene, ctx.height);
    this.stars     = makeStarPool(ctx.scene);
    this.confetti  = makeConfettiPool(ctx.scene);
    this.hearts    = makeHeartPool(ctx.scene);
  }

  // Override Tracker.update: run the gesture recognizer instead of the plain
  // hand landmarker so we get both 21-point landmarks AND gesture categories.
  update(dt) {
    if (!this.gestureRec) return;
    const { ctx } = this;
    if (!ctx || !ctx.video) return;
    if (ctx.video.readyState < 2) return;

    // Guard the recognizer call against duplicate frames; the recognizer
    // throws if we send the same timestamp twice.
    let handsLms = [];
    let gestures = [];
    if (ctx.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = ctx.video.currentTime;
      try {
        const res = this.gestureRec.recognizeForVideo(ctx.video, performance.now());
        handsLms = res?.landmarks || [];
        gestures = res?.gestures || [];
      } catch (_e) {
        // swallow — try again next frame
      }
    }
    this.handleGestures(handsLms, gestures, dt);
  }

  handleGestures(handsLandmarks, gesturesPerHand, dt) {
    // ---- Determine active spell per hand --------------------------------
    // `active` flags drive whether time-based spells continue spawning.
    const active = { Closed_Fist: false, Open_Palm: false, Pointing_Up: false,
      Victory: false, Thumb_Up: false, ILoveYou: false };
    // Per-hand state for the LASER (needs fingertip position, not palm).
    let laserHand = null;          // { tipX, tipY } | null

    const detectedNames = [];
    for (let h = 0; h < handsLandmarks.length; h++) {
      const lms = handsLandmarks[h];
      if (!lms) continue;
      const gestList = gesturesPerHand[h] || [];
      const top = gestList[0];
      if (!top || top.score < GESTURE_THRESHOLD) continue;
      const name = top.categoryName;
      if (!(name in active) || name === 'None') continue;
      detectedNames.push(`${SPELL_LABELS[name]}`);
      active[name] = true;

      const center = palmCenter(lms);
      const [px, py] = this.toPx(center.x, center.y);

      if (name === 'Closed_Fist') {
        // FIREBALL: spawn 10 particles per frame around the fist while held.
        spawnFireball(this.fireball, px, py, 10);
      } else if (name === 'Open_Palm') {
        // SHOCKWAVE: one ring per second per active palm.
        this.shockTimers[h] += dt;
        const period = 0.45;
        while (this.shockTimers[h] > period) {
          this.shockTimers[h] -= period;
          this.shockwave.spawn(px, py);
        }
      } else if (name === 'Pointing_Up') {
        // LASER originates at index FINGERTIP (landmark 8), not palm.
        const [tipX, tipY] = this.toPx(lms[8].x, lms[8].y);
        // Pick the higher (numerically smaller y) tip if both hands point.
        if (!laserHand || tipY < laserHand.tipY) laserHand = { tipX, tipY };
      } else if (name === 'Victory') {
        // STARS: 4/sec around palm.
        this.starTimers[h] += dt;
        const period = 0.25;
        while (this.starTimers[h] > period) {
          this.starTimers[h] -= period;
          spawnStar(this.stars, px, py);
        }
      } else if (name === 'Thumb_Up') {
        // CONFETTI: 6 per frame above the palm.
        spawnConfetti(this.confetti, px, py, 6);
      } else if (name === 'ILoveYou') {
        // HEARTS: 3/sec from palm.
        this.heartTimers[h] += dt;
        const period = 0.33;
        while (this.heartTimers[h] > period) {
          this.heartTimers[h] -= period;
          spawnHeart(this.hearts, px, py);
        }
      }
    }

    // Reset per-hand timers for spells whose gesture lapsed this frame so the
    // first new ring/star/heart spawns immediately.
    for (let h = 0; h < 2; h++) {
      const lms = handsLandmarks[h];
      const gestList = gesturesPerHand[h] || [];
      const top = gestList[0];
      const okFor = (name) => lms && top && top.score >= GESTURE_THRESHOLD && top.categoryName === name;
      if (!okFor('Open_Palm'))  this.shockTimers[h] = Math.min(this.shockTimers[h], 0.4);
      if (!okFor('Victory'))    this.starTimers[h]  = Math.min(this.starTimers[h], 0.2);
      if (!okFor('ILoveYou'))   this.heartTimers[h] = Math.min(this.heartTimers[h], 0.3);
    }

    // ---- Drive all pools regardless (particles keep animating to drain) --
    this.fireball.update(dt);
    this.shockwave.update(dt);
    this.laser.update(dt, !!laserHand, laserHand?.tipX || 0, laserHand?.tipY || 0);
    this.stars.update(dt);
    this.confetti.update(dt);
    this.hearts.update(dt);

    this.lastDetected = detectedNames.length ? detectedNames.join('+') : '—';
    this.ctx.setHud(
      `SPELLS · fist=fire · palm=wave · point=laser · peace=stars · thumb=confetti · rock=hearts · current: ${this.lastDetected}`,
    );
  }

  resize(w, h) {
    super.resize(w, h);
    if (this.laser) this.laser.setCanvasH(h);
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (!scene) return;
    if (this.fireball)  this.fireball.dispose(scene);
    if (this.shockwave) this.shockwave.dispose(scene);
    if (this.laser)     this.laser.dispose(scene);
    if (this.stars)     this.stars.dispose(scene);
    if (this.confetti)  this.confetti.dispose(scene);
    if (this.hearts)    this.hearts.dispose(scene);
    this.fireball = this.shockwave = this.laser = null;
    this.stars = this.confetti = this.hearts = null;
  }
}

// ===========================================================================
// Preview painter: 2×3 grid, one mini visual per spell.
// ===========================================================================

function preview(ctx) {
  const W = 320, H = 320;
  // Dark background with a faint vignette.
  ctx.fillStyle = '#0a0612';
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W/2, H/2, 20, W/2, H/2, 220);
  vg.addColorStop(0, 'rgba(60,30,80,0.35)');
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const cells = [
    { label: 'fist',  draw: drawFireballPv },
    { label: 'palm',  draw: drawShockwavePv },
    { label: 'point', draw: drawLaserPv },
    { label: 'peace', draw: drawStarsPv },
    { label: 'thumb', draw: drawConfettiPv },
    { label: 'rock',  draw: drawHeartsPv },
  ];

  const cols = 3, rows = 2;
  const cw = W / cols, ch = H / rows;
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < cells.length; i++) {
    const c = i % cols, r = (i / cols) | 0;
    const cx = c * cw + cw / 2;
    const cy = r * ch + ch / 2 - 6;
    ctx.save();
    cells[i].draw(ctx, cx, cy, Math.min(cw, ch) * 0.42);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(cells[i].label, cx, r * ch + ch - 10);
  }
  // Faint grid dividers.
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let c = 1; c < cols; c++) {
    ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, H); ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * ch); ctx.lineTo(W, r * ch); ctx.stroke();
  }
}

function drawFireballPv(ctx, x, y, r) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    const sz = 4 + Math.random() * 8;
    const g = ctx.createRadialGradient(px, py, 0, px, py, sz);
    g.addColorStop(0, 'rgba(255,200,60,0.95)');
    g.addColorStop(0.5, 'rgba(255,90,40,0.55)');
    g.addColorStop(1, 'rgba(80,10,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - sz, py - sz, sz * 2, sz * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawShockwavePv(ctx, x, y, r) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const t = i / 3;
    const rad = r * (0.35 + 0.65 * t);
    ctx.strokeStyle = `rgba(80,255,255,${0.85 * (1 - t)})`;
    ctx.lineWidth = 3 - t * 1.5;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawLaserPv(ctx, x, y, r) {
  ctx.globalCompositeOperation = 'lighter';
  const beamH = r * 1.8;
  const beamW = 8;
  const g = ctx.createLinearGradient(x, y - beamH * 0.5, x, y + beamH * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,80,120,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(x - beamW / 2, y - beamH * 0.5, beamW, beamH);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x - 1.5, y - beamH * 0.5, 3, beamH);
  // streaks
  for (let i = 0; i < 8; i++) {
    const sy = y - beamH * 0.5 + Math.random() * beamH;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(x - 1, sy, 2, 6);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawStarsPv(ctx, x, y, r) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const px = x + Math.cos(a) * r * 0.55;
    const py = y + Math.sin(a) * r * 0.55;
    const sz = 6 + Math.random() * 4;
    ctx.fillStyle = `hsl(${(i * 70) % 360},90%,65%)`;
    drawStarShape(ctx, px, py, sz, sz * 0.4);
  }
  ctx.fillStyle = '#ffffff';
  drawStarShape(ctx, x, y, r * 0.35, r * 0.14);
}

function drawStarShape(ctx, x, y, R, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? R : r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawConfettiPv(ctx, x, y, r) {
  const palette = ['#ff3366', '#33ccff', '#ffd633', '#73ff66', '#ff73ff', '#4d8aff'];
  for (let i = 0; i < 18; i++) {
    const px = x + (Math.random() - 0.5) * r * 2;
    const py = y + (Math.random() - 0.5) * r * 2;
    const w = 4 + Math.random() * 4;
    const h = 8 + Math.random() * 6;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.random() * Math.PI);
    ctx.fillStyle = palette[(Math.random() * palette.length) | 0];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

function drawHeartsPv(ctx, x, y, r) {
  for (let i = 0; i < 4; i++) {
    const px = x + (Math.random() - 0.5) * r * 1.4;
    const py = y + (Math.random() - 0.5) * r * 1.4;
    const sz = 10 + Math.random() * 8;
    ctx.fillStyle = `hsla(${330 + Math.random() * 20},85%,${60 + Math.random() * 15}%,0.95)`;
    drawHeartShape(ctx, px, py, sz);
  }
  ctx.fillStyle = 'rgba(255,120,180,0.95)';
  drawHeartShape(ctx, x, y, r * 0.55);
}

function drawHeartShape(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + 0.3 * s);
  ctx.bezierCurveTo(x, y - 0.4 * s, x - 0.9 * s, y - 0.4 * s, x - 0.9 * s, y + 0.1 * s);
  ctx.bezierCurveTo(x - 0.9 * s, y + 0.55 * s, x - 0.3 * s, y + 0.75 * s, x, y + s);
  ctx.bezierCurveTo(x + 0.3 * s, y + 0.75 * s, x + 0.9 * s, y + 0.55 * s, x + 0.9 * s, y + 0.1 * s);
  ctx.bezierCurveTo(x + 0.9 * s, y - 0.4 * s, x, y - 0.4 * s, x, y + 0.3 * s);
  ctx.closePath();
  ctx.fill();
}

export default {
  id: 'GestureSpells',
  title: 'GESTURE SPELLS',
  subtitle: 'SIX SPELLS, SIX GESTURES',
  category: 'HAND',
  factory: () => new GestureSpells(),
  preview,
};
