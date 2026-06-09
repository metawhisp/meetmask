import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ─── Constants ────────────────────────────────────────────────────────────
// MediaPipe FaceLandmarker (478-pt) — eyes + iris landmarks.
//   For each eye we use 4 lid points to compute Eye Aspect Ratio (EAR)
//   and 4 corner points to compute eye width. The 478-pt face_landmarker
//   model also returns iris centers, which gives us a usable gaze vector
//   without needing a separate gaze model.
const EYE_A = { outer: 33,  inner: 133, top: 159, bot: 145, iris: 468 };
const EYE_B = { outer: 263, inner: 362, top: 386, bot: 374, iris: 473 };

// ─── Canvas-painted textures ──────────────────────────────────────────────
// Beam CORE — bright white hot center stripe.
//   Drawn as a horizontal gradient so the bright "start" is at U=0 (left
//   edge = eye end after we stretch the plane along +X).
function buildCoreTex() {
  const W = 256, H = 16;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const ctx = cnv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.10, 'rgba(255,250,230,1)');
  g.addColorStop(0.45, 'rgba(255,200,160,0.7)');
  g.addColorStop(1.00, 'rgba(255,150,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Feather the top/bottom edges so the core has a soft envelope.
  ctx.globalCompositeOperation = 'destination-in';
  const env = ctx.createLinearGradient(0, 0, 0, H);
  env.addColorStop(0.00, 'rgba(255,255,255,0.1)');
  env.addColorStop(0.50, 'rgba(255,255,255,1)');
  env.addColorStop(1.00, 'rgba(255,255,255,0.1)');
  ctx.fillStyle = env;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  return cnv;
}

// Beam GLOW — wider soft orange/red bloom that sits behind the core.
function buildGlowTex() {
  const W = 256, H = 128;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const ctx = cnv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0.00, 'rgba(255,200,140,0.95)');
  g.addColorStop(0.15, 'rgba(255,110,50,0.85)');
  g.addColorStop(0.50, 'rgba(255,55,30,0.45)');
  g.addColorStop(1.00, 'rgba(255,20,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-in';
  const env = ctx.createLinearGradient(0, 0, 0, H);
  env.addColorStop(0.00, 'rgba(255,255,255,0)');
  env.addColorStop(0.50, 'rgba(255,255,255,1)');
  env.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = env;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  return cnv;
}

// Animated SHIMMER pattern — vertical noise stripes we'll UV-pan over time
// to make the beam look like energy is flowing through it.
function buildShimmerTex() {
  const W = 512, H = 32;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  // Sparse bright vertical streaks.
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W;
    const alpha = 0.3 + Math.random() * 0.6;
    const w = 1 + Math.random() * 3;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(x, 0, w, H);
  }
  // Add a few brighter "pulses".
  for (let i = 0; i < 15; i++) {
    const x = Math.random() * W;
    const grad = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
    grad.addColorStop(0,   'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 8, 0, 16, H);
  }
  return cnv;
}

// Radial glow used for eye sockets, lens-flare, impact sprite, burns.
function buildRadial(coreCol, edgeCol, falloff = 0.4) {
  const S = 256;
  const cnv = document.createElement('canvas');
  cnv.width = S; cnv.height = S;
  const ctx = cnv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, coreCol);
  g.addColorStop(falloff, edgeCol);
  g.addColorStop(1.00, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return cnv;
}

// 4-point lens flare cross — bright horizontal + vertical streak.
function buildLensFlare() {
  const S = 256;
  const cnv = document.createElement('canvas');
  cnv.width = S; cnv.height = S;
  const ctx = cnv.getContext('2d');
  // Horizontal streak.
  const gH = ctx.createLinearGradient(0, S / 2, S, S / 2);
  gH.addColorStop(0.00, 'rgba(255,240,200,0)');
  gH.addColorStop(0.50, 'rgba(255,255,255,1)');
  gH.addColorStop(1.00, 'rgba(255,240,200,0)');
  ctx.fillStyle = gH;
  ctx.fillRect(0, S / 2 - 3, S, 6);
  // Vertical streak.
  const gV = ctx.createLinearGradient(S / 2, 0, S / 2, S);
  gV.addColorStop(0.00, 'rgba(255,240,200,0)');
  gV.addColorStop(0.50, 'rgba(255,255,255,1)');
  gV.addColorStop(1.00, 'rgba(255,240,200,0)');
  ctx.fillStyle = gV;
  ctx.fillRect(S / 2 - 3, 0, 6, S);
  // Soft center sphere.
  const gC = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, 40);
  gC.addColorStop(0.00, 'rgba(255,255,255,1)');
  gC.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = gC;
  ctx.fillRect(0, 0, S, S);
  return cnv;
}

// Launcher preview tile.
function drawPreview(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0c0410');
  g.addColorStop(0.5, '#3a0716');
  g.addColorStop(1, '#1a0608');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Silhouette face.
  ctx.fillStyle = 'rgba(255,180,150,0.18)';
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.55, W * 0.22, H * 0.27, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eye glow.
  for (const ex of [W * 0.42, W * 0.58]) {
    const r = ctx.createRadialGradient(ex, H * 0.5, 4, ex, H * 0.5, 48);
    r.addColorStop(0, 'rgba(255,255,200,1)');
    r.addColorStop(0.4, 'rgba(255,80,40,0.85)');
    r.addColorStop(1, 'rgba(255,30,20,0)');
    ctx.fillStyle = r;
    ctx.beginPath(); ctx.arc(ex, H * 0.5, 48, 0, Math.PI * 2); ctx.fill();
  }
  // Two converging beams to a target near top-right.
  const tx = W * 0.78, ty = H * 0.22;
  ctx.globalCompositeOperation = 'lighter';
  for (const [ex, ey] of [[W * 0.42, H * 0.5], [W * 0.58, H * 0.5]]) {
    const grad = ctx.createLinearGradient(ex, ey, tx, ty);
    grad.addColorStop(0,    'rgba(255,255,220,1)');
    grad.addColorStop(0.15, 'rgba(255,120,60,0.95)');
    grad.addColorStop(1,    'rgba(255,40,20,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex, ey); ctx.lineTo(tx, ty);
    ctx.stroke();
    // Thin white core.
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ex, ey); ctx.lineTo(tx, ty);
    ctx.stroke();
  }
  // Impact burst at target.
  const impact = ctx.createRadialGradient(tx, ty, 4, tx, ty, 70);
  impact.addColorStop(0,    'rgba(255,255,255,1)');
  impact.addColorStop(0.25, 'rgba(255,180,80,0.9)');
  impact.addColorStop(1,    'rgba(255,30,10,0)');
  ctx.fillStyle = impact;
  ctx.beginPath(); ctx.arc(tx, ty, 70, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Title.
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, H - 46, W, 46);
  ctx.fillStyle = '#ff7755';
  ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('EYE LASERS', 14, H - 23);
}

// ─── The effect ────────────────────────────────────────────────────────────
// Exported as a reusable base so other face effects can subclass the laser rig.
export class EyeLasers extends Tracker {
  constructor() {
    super({ kind: 'face', numFaces: 1 });

    // Auto-calibration: track the user's "wide open" EAR baseline so we
    // can compute squint relative to *their* normal eye openness instead
    // of a hardcoded value that may not match their physiology.
    this.baselineEAR = null;        // EMA-tracked rolling max
    this.smoothEAR = null;
    this.holdTime = 0;              // sustained-squint timer (blink filter)
    this.smoothedSquint = 0;

    // Gaze target — smoothed across frames so the beams don't jitter.
    this.gazeX = 0;
    this.gazeY = 0;
    this.gazeInit = false;

    // Visual time accumulator for shimmer UV scroll, ring pulse, etc.
    this.t = 0;

    // Impact rings (3 active at a time, rotated through).
    this.rings = [];

    // Particle burn marks left along the beam path.
    this.burns = [];

    // Audio.
    this.audioCtx = null;
    this.humOsc = null;
    this.humGain = null;
    this.lastZapAt = -10;

    // Screen shake.
    this.shakeT = 0;
    this.shakeAmp = 0;
  }

  async setup(ctx) {
    // Build textures.
    const make = (cnv) => {
      const t = new THREE.CanvasTexture(cnv);
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      return t;
    };
    this.texCore     = make(buildCoreTex());
    this.texGlow     = make(buildGlowTex());
    this.texShimmer  = make(buildShimmerTex());
    this.texShimmer.wrapS = THREE.RepeatWrapping;     // for UV scroll
    this.texShimmer.wrapT = THREE.ClampToEdgeWrapping;
    this.texEyeGlow  = make(buildRadial('rgba(255,255,220,1)', 'rgba(255,90,40,0.8)', 0.35));
    this.texFlare    = make(buildLensFlare());
    this.texImpact   = make(buildRadial('rgba(255,255,255,1)', 'rgba(255,170,80,0.9)', 0.25));
    this.texBurn     = make(buildRadial('rgba(255,230,170,1)', 'rgba(255,90,30,0.7)', 0.35));
    this.texRing     = make(buildRadial('rgba(0,0,0,0)',       'rgba(255,180,80,0.9)', 0.85));

    // Shared geometries — one plane per "layer", scaled per frame.
    this.geoUnit = new THREE.PlaneGeometry(1, 1);

    // Per-eye 3-layer beams (glow + core + shimmer). Each layer is a plane
    // we scale to (beamLen × layerWidth) and place at the midpoint of the
    // beam. Additive blending stacks them into a hot, glowing strike.
    const makeBeam = () => {
      const glowMat = new THREE.MeshBasicMaterial({
        map: this.texGlow, transparent: true, opacity: 0,
        depthTest: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const coreMat = new THREE.MeshBasicMaterial({
        map: this.texCore, transparent: true, opacity: 0,
        depthTest: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const shimMat = new THREE.MeshBasicMaterial({
        map: this.texShimmer.clone(), transparent: true, opacity: 0,
        depthTest: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      shimMat.map.wrapS = THREE.RepeatWrapping;
      shimMat.map.needsUpdate = true;
      return {
        glow: new THREE.Mesh(this.geoUnit, glowMat),
        core: new THREE.Mesh(this.geoUnit, coreMat),
        shim: new THREE.Mesh(this.geoUnit, shimMat),
        glowMat, coreMat, shimMat,
      };
    };
    this.beamA = makeBeam();
    this.beamB = makeBeam();
    for (const beam of [this.beamA, this.beamB]) {
      for (const m of [beam.glow, beam.core, beam.shim]) {
        m.frustumCulled = false;
        m.visible = false;
        ctx.scene.add(m);
      }
    }

    // Eye flares — bright lens-flare cross + soft socket glow at each eye.
    const makeEyeFx = () => {
      const flareMat = new THREE.MeshBasicMaterial({
        map: this.texFlare, transparent: true, opacity: 0,
        depthTest: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const socketMat = new THREE.MeshBasicMaterial({
        map: this.texEyeGlow, transparent: true, opacity: 0,
        depthTest: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      return {
        flare: new THREE.Mesh(this.geoUnit, flareMat),
        socket: new THREE.Mesh(this.geoUnit, socketMat),
        flareMat, socketMat,
      };
    };
    this.eyeA = makeEyeFx();
    this.eyeB = makeEyeFx();
    for (const fx of [this.eyeA, this.eyeB]) {
      fx.flare.frustumCulled = false;
      fx.socket.frustumCulled = false;
      fx.flare.visible = false;
      fx.socket.visible = false;
      ctx.scene.add(fx.flare, fx.socket);
    }

    // Impact sprite at the gaze target — bright explosion radial.
    this.impactMat = new THREE.MeshBasicMaterial({
      map: this.texImpact, transparent: true, opacity: 0,
      depthTest: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.impactMesh = new THREE.Mesh(this.geoUnit, this.impactMat);
    this.impactMesh.frustumCulled = false;
    this.impactMesh.visible = false;
    ctx.scene.add(this.impactMesh);

    // Heat-flash fullscreen overlay at peak power.
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xff4422, transparent: true, opacity: 0,
      depthTest: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(ctx.width * 1.5, ctx.height * 1.5),
      this.flashMat,
    );
    this.flashMesh.position.set(ctx.width / 2, ctx.height / 2, 3);
    this.flashMesh.frustumCulled = false;
    ctx.scene.add(this.flashMesh);
  }

  // ── Geometry helpers ──
  computeEAR(lms, eye) {
    const o = lms[eye.outer], i = lms[eye.inner], t = lms[eye.top], b = lms[eye.bot];
    const h = Math.hypot(o.x - i.x, o.y - i.y);
    const v = Math.hypot(t.x - b.x, t.y - b.y);
    return v / (h || 1);
  }
  eyeCenterPx(lms, eye) {
    const cx = (lms[eye.outer].x + lms[eye.inner].x + lms[eye.top].x + lms[eye.bot].x) / 4;
    const cy = (lms[eye.outer].y + lms[eye.inner].y + lms[eye.top].y + lms[eye.bot].y) / 4;
    return this.toPx(cx, cy);
  }
  eyeWidthPx(lms, eye) {
    const [ox, oy] = this.toPx(lms[eye.outer].x, lms[eye.outer].y);
    const [ix, iy] = this.toPx(lms[eye.inner].x, lms[eye.inner].y);
    return Math.hypot(ox - ix, oy - iy);
  }

  // ── Place a single 3-layer beam from `start` toward `end`, normalised
  //    opacity by `pulse` (0..1).
  placeBeam(beam, sx, sy, ex, ey, pulse, t) {
    const dx = ex - sx, dy = ey - sy;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist, dirY = dy / dist;
    const angle = Math.atan2(dy, dx);
    // Extend slightly past the target so it visually "punches through".
    const overshoot = 60;
    const beamLen = dist + overshoot;
    const midX = sx + dirX * beamLen * 0.5;
    const midY = sy + dirY * beamLen * 0.5;

    const placeLayer = (mesh, mat, width, opacity, hue = null) => {
      mesh.position.set(midX, midY, 6);
      mesh.rotation.z = angle;
      mesh.scale.set(beamLen, width, 1);
      mat.opacity = opacity;
      mesh.visible = opacity > 0.005;
      if (hue !== null) mat.color.setHSL(hue, 1.0, 0.55);
    };

    // Glow — wide, low alpha, warm.
    const glowWidth = 30 + pulse * 140;
    placeLayer(beam.glow, beam.glowMat, glowWidth, pulse * 0.9);
    beam.glowMat.color.setHSL(0.03, 1.0, 0.5);

    // Core — thin, very bright, white-hot.
    const coreWidth = 4 + pulse * 22;
    placeLayer(beam.core, beam.coreMat, coreWidth, Math.min(1, pulse * 1.3));
    beam.coreMat.color.setHSL(0.10, 1.0, 0.75 + pulse * 0.2);

    // Shimmer — medium width, animated UV scroll for energy-flow feel.
    const shimWidth = 14 + pulse * 50;
    placeLayer(beam.shim, beam.shimMat, shimWidth, pulse * 0.75);
    beam.shimMat.color.setHSL(0.07, 1.0, 0.6 + pulse * 0.3);
    // UV scroll along beam length (U axis) — speed scales with pulse.
    const tex = beam.shimMat.map;
    if (tex) {
      tex.offset.x = -(t * (1.5 + pulse * 2.5)) % 1;   // negative so flow goes from eye out
      // Repeat the shimmer pattern proportionally to beam length so the
      // streak density looks consistent at any range.
      tex.repeat.x = beamLen / 240;
      tex.needsUpdate = false;          // offset/repeat don't need re-upload
    }
  }

  frame(faces, dt) {
    this.t += dt;
    this.zapCooldown = Math.max(0, (this.zapCooldown || 0) - dt);

    // Screen shake decays regardless.
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT / 0.35);
      this.camera.position.x = (Math.random() - 0.5) * this.shakeAmp * k;
      this.camera.position.y = (Math.random() - 0.5) * this.shakeAmp * k;
      this.camera.updateMatrixWorld();
      if (this.shakeT <= 0) {
        this.camera.position.x = 0;
        this.camera.position.y = 0;
      }
    }

    this.fadeBurns(dt);
    this.updateRings(dt);

    if (!faces.length) {
      this.hideAll();
      this.setHum(0);
      this.smoothedSquint = 0;
      this.holdTime = 0;
      this.ctx.setHud('EYE LASERS — щурься чтобы стрелять · покажи лицо');
      return;
    }

    const lms = faces[0];

    // ── EAR + auto-calibration ──
    // We use the smaller of the two eyes so a one-eye squint still works.
    const earRaw = Math.min(this.computeEAR(lms, EYE_A), this.computeEAR(lms, EYE_B));
    if (this.smoothEAR == null) this.smoothEAR = earRaw;
    this.smoothEAR += (earRaw - this.smoothEAR) * Math.min(1, 12 * dt);

    if (this.baselineEAR == null) {
      this.baselineEAR = this.smoothEAR;
    } else {
      // Baseline = slowly-tracked maximum. Rises *fast* on new highs,
      // decays *very* slowly. This adapts to the user without dropping
      // mid-session just because they held a long squint.
      if (this.smoothEAR > this.baselineEAR) {
        this.baselineEAR += (this.smoothEAR - this.baselineEAR) * Math.min(1, 6 * dt);
      } else {
        this.baselineEAR -= this.baselineEAR * 0.0015 * dt;       // tiny drift
      }
    }
    // Squint = how far below baseline the smoothed EAR has fallen. We
    // activate at 25% drop, full at 60% drop, so the user only has to
    // moderately scrunch — no need to close eyes.
    const startDrop = this.baselineEAR * 0.75;
    const fullDrop  = this.baselineEAR * 0.40;
    const rawSquint = Math.max(0, Math.min(1, (startDrop - this.smoothEAR) / (startDrop - fullDrop)));

    // Snap-trigger blink filter — tight enough for shot-by-shot play.
    //
    // Previously the gate required ~350ms of held squint before any beam
    // appeared, which made it impossible to "pulse" rapid shots. New
    // numbers: 60ms minimum hold + 40ms ramp = ~100ms before the beam
    // is visible, plus another ~100ms of smoothing to reach full power.
    // Total perceived attack ≈ 200ms, release ≈ 150ms.
    //
    // Trade-off: a 150-200ms blink will produce a faint flash because the
    // gate just barely starts opening before the user re-opens. We accept
    // that — the gameplay (rapid intentional squints) matters more than
    // perfect blink rejection in this game-y use case.
    if (rawSquint > 0.25) this.holdTime = Math.min(0.6, this.holdTime + dt);
    else                  this.holdTime = Math.max(0,   this.holdTime - dt * 8);
    const holdGate = Math.max(0, Math.min(1, (this.holdTime - 0.06) / 0.04));
    const target = rawSquint * holdGate;

    // Smooth final value — fast rise (snap on), moderate fall (clean cutoff
    // between shots without trailing too long).
    const rate = target > this.smoothedSquint ? 30 : 14;
    this.smoothedSquint += (target - this.smoothedSquint) * Math.min(1, rate * dt);
    const squint = this.smoothedSquint;

    if (squint < 0.03) {
      this.hideAll();
      this.setHum(0);
      const pct = Math.round(squint * 100);
      this.ctx.setHud(`EYE LASERS · ${pct}%`);
      return;
    }

    // ── Eye positions in canvas px ──
    const [aCx, aCy] = this.eyeCenterPx(lms, EYE_A);
    const [bCx, bCy] = this.eyeCenterPx(lms, EYE_B);

    // ── Gaze target from HEAD POSE ──
    // Iris offsets are tiny (couple of pixels of jitter on a 1700px screen)
    // and were unreliable here — beams kept snapping back to centre. Head
    // pose is the right signal: the user expects "where my face is pointing"
    // to be where the beams go. We derive a 2D heading from the nose
    // position relative to the face's bounding box.
    //
    // Landmarks used:
    //   1  = nose tip (the "indicator")
    //   234 / 454 = left/right face oval edges  → face width + horizontal centre
    //   10 / 152 = forehead top / chin          → face height + vertical centre
    //
    // After CSS mirror + toPx mirror, when the user turns their face toward
    // screen-right the nose-on-screen sits to the right of the face centre,
    // so the offset's sign already lines up with the direction we want the
    // beams to fire. No manual mirror flipping needed.
    const [noseX, noseY] = this.toPx(lms[1].x,   lms[1].y);
    const [lEdgeX, _lY] = this.toPx(lms[234].x, lms[234].y);
    const [rEdgeX, _rY] = this.toPx(lms[454].x, lms[454].y);
    const [_fX, foreY]  = this.toPx(lms[10].x,  lms[10].y);
    const [_cX, chinY]  = this.toPx(lms[152].x, lms[152].y);

    const faceCx = (lEdgeX + rEdgeX) / 2;
    const faceCy = (foreY  + chinY)  / 2;
    const faceW  = Math.max(1, Math.abs(rEdgeX - lEdgeX));
    const faceH  = Math.max(1, Math.abs(chinY - foreY));

    // Normalised offsets — ~[-0.4, 0.4] at hard head-turn.
    let yaw   = (noseX - faceCx) / faceW;
    let pitch = (noseY - faceCy) / faceH;

    // Iris fine-tune: if MP returned iris landmarks (478-pt model does by
    // default), nudge the heading by where the eyes are within their
    // sockets, scaled small so head-turn still dominates.
    if (lms[EYE_A.iris] && lms[EYE_B.iris]) {
      const [aIx, aIy] = this.toPx(lms[EYE_A.iris].x, lms[EYE_A.iris].y);
      const [bIx, bIy] = this.toPx(lms[EYE_B.iris].x, lms[EYE_B.iris].y);
      const wEye = Math.max(1, (this.eyeWidthPx(lms, EYE_A) + this.eyeWidthPx(lms, EYE_B)) / 2);
      const irisX = ((aIx - aCx) + (bIx - bCx)) / (2 * wEye);
      const irisY = ((aIy - aCy) + (bIy - bCy)) / (2 * wEye);
      yaw   += irisX * 0.35;
      pitch += irisY * 0.35;
    }

    // Amplify head heading into screen space. Strong gain because the
    // normalised offset is small (rarely past ±0.3 even with full neck
    // rotation). Origin is the eye midpoint so beams visually originate
    // from the user's face.
    const W = this.ctx.width, H = this.ctx.height;
    const origX = (aCx + bCx) / 2;
    const origY = (aCy + bCy) / 2;
    const gainX = W * 2.8;
    const gainY = H * 2.2;

    const rawTargetX = origX + yaw   * gainX;
    const rawTargetY = origY + pitch * gainY;

    // Smooth the gaze target — iris jitters more than the rest of the face.
    if (!this.gazeInit) {
      this.gazeX = rawTargetX; this.gazeY = rawTargetY;
      this.gazeInit = true;
    } else {
      const gRate = 10;
      this.gazeX += (rawTargetX - this.gazeX) * Math.min(1, gRate * dt);
      this.gazeY += (rawTargetY - this.gazeY) * Math.min(1, gRate * dt);
    }
    const tX = this.gazeX, tY = this.gazeY;

    // ── Pulse — combine squint level with a subtle breathing oscillation.
    const breathe = 0.92 + 0.08 * Math.sin(this.t * 14);
    const pulse = squint * breathe;

    // ── Place the two beams from each eye to the gaze target ──
    this.placeBeam(this.beamA, aCx, aCy, tX, tY, pulse, this.t);
    this.placeBeam(this.beamB, bCx, bCy, tX, tY, pulse, this.t);

    // ── Eye lens-flare + socket glow ──
    const placeEye = (fx, ex, ey) => {
      const flareSize = 60 + pulse * 140;
      fx.flare.position.set(ex, ey, 8);
      fx.flare.rotation.z = this.t * 0.6;             // slow rotation
      fx.flare.scale.set(flareSize, flareSize, 1);
      fx.flareMat.opacity = pulse * 0.95;
      fx.flareMat.color.setHSL(0.10, 1.0, 0.85);
      fx.flare.visible = pulse > 0.02;

      const socketSize = 60 + pulse * 160;
      fx.socket.position.set(ex, ey, 7);
      fx.socket.scale.set(socketSize, socketSize, 1);
      fx.socketMat.opacity = 0.55 + pulse * 0.4;
      fx.socketMat.color.setHSL(0.04, 1.0, 0.55);
      fx.socket.visible = pulse > 0.02;
    };
    placeEye(this.eyeA, aCx, aCy);
    placeEye(this.eyeB, bCx, bCy);

    // ── Impact at gaze target ──
    const impactSize = 80 + pulse * 200 + Math.sin(this.t * 18) * 12;
    this.impactMesh.position.set(tX, tY, 9);
    this.impactMesh.scale.set(impactSize, impactSize, 1);
    this.impactMat.opacity = pulse * 0.95;
    this.impactMat.color.setHSL(0.08 + Math.sin(this.t * 6) * 0.02, 1.0, 0.72);
    this.impactMesh.visible = pulse > 0.02;

    // Spawn expanding rings periodically at the target.
    if (pulse > 0.3 && this.t - (this._lastRingAt || 0) > 0.18 - pulse * 0.08) {
      this._lastRingAt = this.t;
      this.spawnRing(tX, tY, 40 + pulse * 60);
    }

    // Spawn burn marks along beam path scaled with pulse.
    // Tuned LIGHT: snappy-fire mode means lots of pulses in quick
    // succession, so we cap the count and use short-lived sparks
    // (spawnBurn uses life 0.3-0.5s) — keeps the screen readable.
    if (pulse > 0.4) {
      const beamLen = Math.hypot(tX - aCx, tY - aCy);
      const n = Math.floor(pulse * 2);            // was pulse*4
      for (let i = 0; i < n; i++) {
        const f = 0.15 + Math.random() * 0.7;
        const jx = (Math.random() - 0.5) * 18;
        const jy = (Math.random() - 0.5) * 18;
        const dx = tX - aCx, dy = tY - aCy;
        const m = Math.hypot(dx, dy) || 1;
        const dirAX = dx / m, dirAY = dy / m;
        this.spawnBurn(aCx + dirAX * beamLen * f + jx, aCy + dirAY * beamLen * f + jy, pulse);
        const dx2 = tX - bCx, dy2 = tY - bCy;
        const m2 = Math.hypot(dx2, dy2) || 1;
        this.spawnBurn(bCx + (dx2 / m2) * Math.hypot(tX - bCx, tY - bCy) * f + jx,
                       bCy + (dy2 / m2) * Math.hypot(tX - bCx, tY - bCy) * f + jy, pulse);
      }
    }

    // ── Heat-flash + zap on peak ──
    // Toned down (0.22 → 0.12) so rapid-fire pulses don't strobe the
    // whole frame red.
    const flash = Math.max(0, (pulse - 0.55) / 0.45);
    this.flashMat.opacity = flash * 0.12;
    this.flashMesh.position.set(W / 2, H / 2, 3);

    if (pulse > 0.85 && (this.t - this.lastZapAt) > 0.45) {
      this.lastZapAt = this.t;
      this.shakeAmp = 14;
      this.shakeT = 0.35;
      this.playZap();
    }

    this.setHum(pulse);

    const pct = Math.round(squint * 100);
    const tag = pulse > 0.85 ? ' · MAX POWER'
              : pulse > 0.55 ? ' · BURNING'
              : pulse > 0.25 ? ' · CHARGING'
              : '';
    this.ctx.setHud(`EYE LASERS · ${pct}%${tag}`);
  }

  hideAll() {
    for (const beam of [this.beamA, this.beamB]) {
      if (!beam) continue;
      for (const m of [beam.glow, beam.core, beam.shim]) m.visible = false;
    }
    for (const fx of [this.eyeA, this.eyeB]) {
      if (!fx) continue;
      fx.flare.visible = false;
      fx.socket.visible = false;
    }
    if (this.impactMesh) this.impactMesh.visible = false;
    if (this.flashMat) this.flashMat.opacity = 0;
  }

  spawnRing(x, y, startR) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.texRing, transparent: true, opacity: 0.85,
      depthTest: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geoUnit, mat);
    mesh.frustumCulled = false;
    mesh.position.set(x, y, 8);
    mesh.scale.set(startR, startR, 1);
    this.ctx.scene.add(mesh);
    // Shorter life (0.55 → 0.32 s) so rapid-fire doesn't stack rings on
    // top of each other.
    this.rings.push({ mesh, mat, age: 0, life: 0.32, startR });
  }

  updateRings(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        this.ctx.scene.remove(r.mesh);
        r.mat.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      // Expand ×3 (was ×6) — keeps the ring compact instead of swelling
      // halfway across the screen.
      const s = r.startR * (1 + t * 3);
      r.mesh.scale.set(s, s, 1);
      r.mat.opacity = (1 - t) * 0.85;
    }
  }

  spawnBurn(x, y, intensity) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.texBurn, transparent: true,
      opacity: 0.8 + intensity * 0.2,
      depthTest: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const size = 20 + intensity * 45;
    const mesh = new THREE.Mesh(this.geoUnit, mat);
    mesh.frustumCulled = false;
    mesh.position.set(x, y, 5);
    mesh.scale.set(size, size, 1);
    this.ctx.scene.add(mesh);
    this.burns.push({
      mesh, mat,
      age: 0,
      // Was 0.6-1.0 s — felt like a smoke screen during rapid fire.
      // 0.3-0.5 s reads as "sparks", not "fog".
      life: 0.30 + Math.random() * 0.20,
      // Less upward drift so sparks don't streak halfway up the frame.
      drift: [(Math.random() - 0.5) * 40, -50 - Math.random() * 40],
      // Less growth — softer puff, not a balloon.
      growth: 0.6 + Math.random() * 0.7,
      startSize: size,
    });
  }
  fadeBurns(dt) {
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const b = this.burns[i];
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        this.ctx.scene.remove(b.mesh);
        b.mat.dispose();
        this.burns.splice(i, 1);
        continue;
      }
      b.mat.opacity = (1 - t) * (1 - t) * 0.85;
      const s = b.startSize * (1 + t * b.growth);
      b.mesh.scale.set(s, s, 1);
      b.mesh.position.x += b.drift[0] * dt;
      b.mesh.position.y += b.drift[1] * dt;
    }
  }

  // Audio: CHARGED · WIDE — stereo FM-driven plasma with reverb tail.
  //
  // The user picked variant "L" from the standalone /laser-test.html
  // shoot-out. Two FM-modulated saw stacks live on opposite sides of
  // the stereo field, mirrored by an auto-pan LFO so the energy slowly
  // washes between the ears. A center sub + center fifth + bright
  // sparkle keep things grounded for mono playback, and a synthetic
  // reverb impulse adds cinematic space.
  //
  //   LEFT side  (FM 163Hz, mod 110Hz) → panL  ─┬─► master + dest
  //   RIGHT side (FM 167Hz, mod 112Hz) → panR  ─┤
  //   centre sub 55Hz ──────────────────────────┤
  //   centre fifth 247.5Hz (saw) ───────────────┤
  //   sparkle 1320Hz + delay tail ──────────────┤
  //   wet (convolver reverb 1.5s) ──────────────┘
  //
  //   auto-pan LFO 0.3-0.9Hz drives panL.pan / -panR.pan
  setHum(level) {
    try {
      if (!this.audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.audioCtx = new AC();
      }
      const ac = this.audioCtx;
      if (ac.state === 'suspended') ac.resume();

      if (!this.plasmaReady) {
        // Master bus.
        this.plasmaMaster = ac.createGain();
        this.plasmaMaster.gain.value = 0;
        this.plasmaMaster.connect(ac.destination);

        // Synthetic reverb impulse: 1.5 s exponentially-decaying noise.
        const conv = ac.createConvolver();
        const irLen = Math.floor(ac.sampleRate * 1.5);
        const irBuf = ac.createBuffer(2, irLen, ac.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
          const data = irBuf.getChannelData(ch);
          for (let i = 0; i < irLen; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.2);
          }
        }
        conv.buffer = irBuf;
        this.plasmaConv = conv;
        this.plasmaWetGain = ac.createGain();
        this.plasmaWetGain.gain.value = 0.42;
        conv.connect(this.plasmaWetGain).connect(this.plasmaMaster);

        // We collect every oscillator here so teardown is a single loop.
        this.plasmaOscs = [];

        // ── LEFT side: FM stack panned -0.6 ──
        this.plasmaPanL = ac.createStereoPanner();
        this.plasmaPanL.pan.value = -0.6;
        this.plasmaPanL.connect(this.plasmaMaster);
        this.plasmaPanL.connect(conv);

        const carL = ac.createOscillator();
        const modL = ac.createOscillator();
        this.plasmaModLGain = ac.createGain();
        this.plasmaCarLGain = ac.createGain();
        carL.type = 'sawtooth'; carL.frequency.value = 163;
        modL.type = 'sine';     modL.frequency.value = 110;
        this.plasmaModLGain.gain.value = 0;
        this.plasmaCarLGain.gain.value = 0;
        modL.connect(this.plasmaModLGain).connect(carL.frequency);
        carL.connect(this.plasmaCarLGain).connect(this.plasmaPanL);
        carL.start(); modL.start();
        this.plasmaOscs.push(carL, modL);

        // ── RIGHT side: FM stack panned +0.6, slightly detuned ──
        this.plasmaPanR = ac.createStereoPanner();
        this.plasmaPanR.pan.value = 0.6;
        this.plasmaPanR.connect(this.plasmaMaster);
        this.plasmaPanR.connect(conv);

        const carR = ac.createOscillator();
        const modR = ac.createOscillator();
        this.plasmaModRGain = ac.createGain();
        this.plasmaCarRGain = ac.createGain();
        carR.type = 'sawtooth'; carR.frequency.value = 167;
        modR.type = 'sine';     modR.frequency.value = 112;
        this.plasmaModRGain.gain.value = 0;
        this.plasmaCarRGain.gain.value = 0;
        modR.connect(this.plasmaModRGain).connect(carR.frequency);
        carR.connect(this.plasmaCarRGain).connect(this.plasmaPanR);
        carR.start(); modR.start();
        this.plasmaOscs.push(carR, modR);

        // Auto-pan LFO — sine 0.3Hz, mirrored gain so the two sides swap.
        this.plasmaPanLFO = ac.createOscillator();
        const panLG = ac.createGain();
        const panRG = ac.createGain();
        this.plasmaPanLFO.type = 'sine';
        this.plasmaPanLFO.frequency.value = 0.3;
        panLG.gain.value = 0.35;
        panRG.gain.value = -0.35;
        this.plasmaPanLFO.connect(panLG).connect(this.plasmaPanL.pan);
        this.plasmaPanLFO.connect(panRG).connect(this.plasmaPanR.pan);
        this.plasmaPanLFO.start();
        this.plasmaOscs.push(this.plasmaPanLFO);

        // ── Centre sub bass for mono-compatible weight ──
        const sub = ac.createOscillator();
        this.plasmaSubGain = ac.createGain();
        sub.type = 'sine'; sub.frequency.value = 55;
        this.plasmaSubGain.gain.value = 0;
        sub.connect(this.plasmaSubGain).connect(this.plasmaMaster);
        sub.start();
        this.plasmaOscs.push(sub);

        // ── Centre fifth carrier — anchors the chord (also goes to wet). ──
        const carC = ac.createOscillator();
        this.plasmaCarCGain = ac.createGain();
        carC.type = 'sawtooth'; carC.frequency.value = 247.5;
        this.plasmaCarCGain.gain.value = 0;
        carC.connect(this.plasmaCarCGain);
        this.plasmaCarCGain.connect(this.plasmaMaster);
        this.plasmaCarCGain.connect(conv);
        carC.start();
        this.plasmaOscs.push(carC);

        // ── Bright sparkle + delay tail (sci-fi echo). ──
        const spark = ac.createOscillator();
        this.plasmaSparkGain = ac.createGain();
        spark.type = 'sine'; spark.frequency.value = 1320;
        this.plasmaSparkGain.gain.value = 0;
        const delay = ac.createDelay(0.5);
        delay.delayTime.value = 0.22;
        const delayFb = ac.createGain(); delayFb.gain.value = 0.30;
        spark.connect(this.plasmaSparkGain).connect(this.plasmaMaster);
        this.plasmaSparkGain.connect(delay);
        delay.connect(delayFb).connect(delay);
        delay.connect(this.plasmaMaster);
        spark.start();
        this.plasmaOscs.push(spark);

        this.plasmaReady = true;
      }

      // ── Drive everything from level ──
      const now = ac.currentTime;
      const lvl2 = level * level;
      this.plasmaMaster.gain.setTargetAtTime(0.22 * level, now, 0.05);
      // Symmetric L/R FM modulation — 140-580 range keeps it "warble"
      // not "buzz".
      this.plasmaModLGain.gain.setTargetAtTime(140 + level * 440, now, 0.05);
      this.plasmaModRGain.gain.setTargetAtTime(140 + level * 440, now, 0.05);
      this.plasmaCarLGain.gain.setTargetAtTime(0.32 * level, now, 0.05);
      this.plasmaCarRGain.gain.setTargetAtTime(0.32 * level, now, 0.05);
      this.plasmaCarCGain.gain.setTargetAtTime(0.22 * level, now, 0.06);
      this.plasmaSubGain.gain.setTargetAtTime(0.42 * level, now, 0.06);
      this.plasmaSparkGain.gain.setTargetAtTime(0.10 * lvl2, now, 0.07);
      this.plasmaWetGain.gain.setTargetAtTime(0.32 + level * 0.30, now, 0.1);
      // Auto-pan speeds up with power.
      this.plasmaPanLFO.frequency.setTargetAtTime(0.3 + level * 0.6, now, 0.1);
    } catch (_e) { /* */ }
  }

  // Burst on max-power: pump master + FM mod + wet for a wide cannon hit.
  playZap() {
    try {
      if (!this.audioCtx || !this.plasmaReady) return;
      const ac = this.audioCtx;
      const now = ac.currentTime;
      this.plasmaMaster.gain.cancelScheduledValues(now);
      this.plasmaMaster.gain.setValueAtTime(0.60, now);
      this.plasmaMaster.gain.exponentialRampToValueAtTime(0.22, now + 0.6);
      this.plasmaModLGain.gain.cancelScheduledValues(now);
      this.plasmaModLGain.gain.setValueAtTime(1000, now);
      this.plasmaModLGain.gain.exponentialRampToValueAtTime(580, now + 0.55);
      this.plasmaModRGain.gain.cancelScheduledValues(now);
      this.plasmaModRGain.gain.setValueAtTime(1000, now);
      this.plasmaModRGain.gain.exponentialRampToValueAtTime(580, now + 0.55);
      this.plasmaWetGain.gain.cancelScheduledValues(now);
      this.plasmaWetGain.gain.setValueAtTime(0.80, now);
      this.plasmaWetGain.gain.exponentialRampToValueAtTime(0.42, now + 0.7);
    } catch (_e) { /* */ }
  }

  resize(w, h) {
    super.resize(w, h);
    if (this.flashMesh) {
      this.flashMesh.geometry.dispose();
      this.flashMesh.geometry = new THREE.PlaneGeometry(w * 1.5, h * 1.5);
      this.flashMesh.position.set(w / 2, h / 2, 3);
    }
  }

  teardown() {
    const sceneRemove = (m) => { if (m) this.ctx.scene.remove(m); };
    for (const beam of [this.beamA, this.beamB]) {
      if (!beam) continue;
      sceneRemove(beam.glow); sceneRemove(beam.core); sceneRemove(beam.shim);
      beam.glowMat.dispose(); beam.coreMat.dispose();
      // shim has its own cloned map texture — dispose it too.
      if (beam.shimMat.map) beam.shimMat.map.dispose();
      beam.shimMat.dispose();
    }
    for (const fx of [this.eyeA, this.eyeB]) {
      if (!fx) continue;
      sceneRemove(fx.flare); sceneRemove(fx.socket);
      fx.flareMat.dispose(); fx.socketMat.dispose();
    }
    if (this.impactMesh) {
      sceneRemove(this.impactMesh);
      this.impactMat.dispose();
    }
    if (this.flashMesh) {
      sceneRemove(this.flashMesh);
      this.flashMesh.geometry.dispose();
      this.flashMat.dispose();
    }
    for (const r of this.rings) {
      sceneRemove(r.mesh); r.mat.dispose();
    }
    this.rings.length = 0;
    for (const b of this.burns) {
      sceneRemove(b.mesh); b.mat.dispose();
    }
    this.burns.length = 0;
    if (this.geoUnit) this.geoUnit.dispose();
    for (const t of [this.texCore, this.texGlow, this.texShimmer, this.texEyeGlow,
                     this.texFlare, this.texImpact, this.texBurn, this.texRing]) {
      if (t) t.dispose();
    }
    // All oscillators (L+R carriers, modulators, pan LFO, sub, fifth,
    // sparkle) are kept in plasmaOscs — stop them in one loop.
    if (this.plasmaOscs) {
      for (const o of this.plasmaOscs) try { o.stop(); } catch (_e) {}
      this.plasmaOscs = null;
    }
    this.plasmaMaster    = null;
    this.plasmaConv      = null;
    this.plasmaWetGain   = null;
    this.plasmaPanL      = null;
    this.plasmaPanR      = null;
    this.plasmaPanLFO    = null;
    this.plasmaCarLGain  = null;
    this.plasmaCarRGain  = null;
    this.plasmaCarCGain  = null;
    this.plasmaModLGain  = null;
    this.plasmaModRGain  = null;
    this.plasmaSubGain   = null;
    this.plasmaSparkGain = null;
    this.plasmaReady     = false;
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { this.audioCtx.close(); } catch (_e) {}
    }
    this.audioCtx = null;
    if (this.camera) { this.camera.position.x = 0; this.camera.position.y = 0; }
  }
}

// ─── Launcher tile preview ────────────────────────────────────────────────
function preview(ctx) {
  drawPreview(ctx, 320, 320);
}

export default {
  id: 'EyeLasers',
  title: 'EYE LASERS',
  subtitle: 'GAZE TO BURN',
  category: 'FACE',
  factory: () => new EyeLasers(),
  preview,
};
