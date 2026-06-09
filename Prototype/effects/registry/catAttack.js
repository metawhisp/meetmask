import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';
import { loadFaceLandmarker } from '../core/mpLoader.js';

// ─── Procedural cat sprite painter ─────────────────────────────────────────
const PALETTES = [
  { fur: '#f0a04b', furDark: '#c97826', belly: '#fff1d6', ear: '#ffbb87', eye: '#3ddc97', nose: '#d33c6b' },
  { fur: '#2a2a2e', furDark: '#0c0c10', belly: '#5a5a62', ear: '#3c3c44', eye: '#ffd23f', nose: '#d33c6b' },
  { fur: '#b9bcc2', furDark: '#7c7f87', belly: '#e8eaee', ear: '#cbcfd5', eye: '#41d3ff', nose: '#d97a8f' },
  { fur: '#fff4d6', furDark: '#caa05c', belly: '#ffffff', ear: '#ffb88a', eye: '#5ee07a', nose: '#d33c6b' },
  { fur: '#caa472', furDark: '#7a5326', belly: '#f4e1c1', ear: '#e2b487', eye: '#43e0d0', nose: '#c63968' },
  { fur: '#e84c88', furDark: '#a02860', belly: '#ffd2e3', ear: '#ff97c2', eye: '#9bff5c', nose: '#5b27a8' }, // pink — boss vibes
];

function paintCat(ctx, size, palette, glow = 0) {
  const s = size;
  ctx.clearRect(0, 0, s, s);
  const cx = s * 0.5, cy = s * 0.58;
  const bodyR = s * 0.34;

  // Optional glow halo for boss/angry cats.
  if (glow > 0) {
    const grad = ctx.createRadialGradient(cx, cy, bodyR * 0.5, cx, cy, bodyR * 1.8);
    grad.addColorStop(0, `rgba(255,80,80,${0.45 * glow})`);
    grad.addColorStop(1, 'rgba(255,80,80,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  }

  // Tail.
  ctx.strokeStyle = palette.furDark;
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + bodyR * 0.8, cy + bodyR * 0.3);
  ctx.quadraticCurveTo(cx + bodyR * 1.55, cy - bodyR * 0.3, cx + bodyR * 1.25, cy - bodyR * 0.95);
  ctx.stroke();

  // Body.
  ctx.fillStyle = palette.fur;
  ctx.beginPath();
  ctx.ellipse(cx, cy + bodyR * 0.55, bodyR * 0.95, bodyR * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.belly;
  ctx.beginPath();
  ctx.ellipse(cx, cy + bodyR * 0.78, bodyR * 0.45, bodyR * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head.
  ctx.fillStyle = palette.fur;
  ctx.beginPath();
  ctx.arc(cx, cy, bodyR, 0, Math.PI * 2);
  ctx.fill();

  // Ears.
  const earH = bodyR * 0.85;
  ctx.fillStyle = palette.fur;
  ctx.beginPath();
  ctx.moveTo(cx - bodyR * 0.78, cy - bodyR * 0.45);
  ctx.lineTo(cx - bodyR * 0.32, cy - bodyR * 0.55);
  ctx.lineTo(cx - bodyR * 0.42, cy - bodyR * 0.45 - earH);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + bodyR * 0.78, cy - bodyR * 0.45);
  ctx.lineTo(cx + bodyR * 0.32, cy - bodyR * 0.55);
  ctx.lineTo(cx + bodyR * 0.42, cy - bodyR * 0.45 - earH);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = palette.ear;
  ctx.beginPath();
  ctx.moveTo(cx - bodyR * 0.64, cy - bodyR * 0.48);
  ctx.lineTo(cx - bodyR * 0.40, cy - bodyR * 0.55);
  ctx.lineTo(cx - bodyR * 0.48, cy - bodyR * 0.45 - earH * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + bodyR * 0.64, cy - bodyR * 0.48);
  ctx.lineTo(cx + bodyR * 0.40, cy - bodyR * 0.55);
  ctx.lineTo(cx + bodyR * 0.48, cy - bodyR * 0.45 - earH * 0.65);
  ctx.closePath();
  ctx.fill();

  // Eyes — angry slits if glow>0.5, bright otherwise.
  const eyeR = bodyR * 0.22;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * bodyR * 0.38, ey = cy - bodyR * 0.05;
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = glow > 0.5 ? '#ff3a55' : palette.eye;
    ctx.beginPath(); ctx.arc(ex, ey, eyeR * 0.78, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.ellipse(ex, ey, eyeR * 0.18, eyeR * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex - eyeR * 0.18, ey - eyeR * 0.28, eyeR * 0.22, 0, Math.PI * 2); ctx.fill();
  }

  // Nose + mouth.
  ctx.fillStyle = palette.nose;
  ctx.beginPath();
  ctx.moveTo(cx, cy + bodyR * 0.22);
  ctx.lineTo(cx - bodyR * 0.10, cy + bodyR * 0.10);
  ctx.lineTo(cx + bodyR * 0.10, cy + bodyR * 0.10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#222';
  ctx.lineWidth = Math.max(1, s * 0.015);
  ctx.beginPath();
  ctx.moveTo(cx, cy + bodyR * 0.22);
  ctx.lineTo(cx, cy + bodyR * 0.32);
  ctx.moveTo(cx, cy + bodyR * 0.32);
  ctx.quadraticCurveTo(cx - bodyR * 0.12, cy + bodyR * 0.42, cx - bodyR * 0.18, cy + bodyR * 0.34);
  ctx.moveTo(cx, cy + bodyR * 0.32);
  ctx.quadraticCurveTo(cx + bodyR * 0.12, cy + bodyR * 0.42, cx + bodyR * 0.18, cy + bodyR * 0.34);
  ctx.stroke();

  // Whiskers.
  ctx.strokeStyle = 'rgba(40,40,40,0.7)';
  ctx.lineWidth = Math.max(1, s * 0.012);
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - bodyR * 0.18, cy + bodyR * 0.20 + i * bodyR * 0.07);
    ctx.lineTo(cx - bodyR * 0.65, cy + bodyR * 0.18 + i * bodyR * 0.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + bodyR * 0.18, cy + bodyR * 0.20 + i * bodyR * 0.07);
    ctx.lineTo(cx + bodyR * 0.65, cy + bodyR * 0.18 + i * bodyR * 0.18);
    ctx.stroke();
  }
}

// Star sprite for particles.
function paintStar(ctx, size, color) {
  const s = size, cx = s / 2, cy = s / 2;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = s * 0.4;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    ctx.lineTo(cx + Math.cos(a) * s * 0.45, cy + Math.sin(a) * s * 0.45);
    const a2 = a + Math.PI / 5;
    ctx.lineTo(cx + Math.cos(a2) * s * 0.18, cy + Math.sin(a2) * s * 0.18);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
}

// Floating "+1" / "COMBO x5!" text. Pre-paint canvas, project as plane.
function paintText(ctx, w, h, text, color, fontSize) {
  ctx.clearRect(0, 0, w, h);
  ctx.font = `900 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = fontSize * 0.18;
  ctx.strokeStyle = '#000';
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
}

// MediaPipe hand landmark indices for the five fingertips.
//  4 = thumb tip, 8 = index, 12 = middle, 16 = ring, 20 = pinky.
// We treat each fingertip as an independent swat hotspot, AirMouse-style.
const TIP_LANDMARKS = [4, 8, 12, 16, 20];
const TIP_COLORS    = [0xffd23f, 0xff3a55, 0x3ddc97, 0x41d3ff, 0xe84c88];
const TIP_NAMES     = ['thumb', 'index', 'middle', 'ring', 'pinky'];

// ─── The effect ────────────────────────────────────────────────────────────
class CatAttack extends Tracker {
  constructor() {
    super({ kind: 'hand', numHands: 2 });   // two hands → up to 10 tips
    this.cats = [];
    this.particles = [];
    this.popups = [];
    this.swattedCount = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.lastSwatTime = -10;
    this.spawnTimer = 0.5;
    this.nextSpawnIn = 0.5;
    this.time = 0;
    this.faceLm = null;
    this.faceTarget = null;
    this.audioCtx = null;
    this.shakeT = 0;
    this.shakeAmp = 0;
    // 10 fingertip slots — 2 hands × 5 fingers.
    // Each: { x, y, vx, vy, lastX, lastY, lastT, alive, ringMesh, ringMat, glowMesh, glowMat }
    this.tips = [];
  }

  async setup(ctx) {
    try { this.faceLm = await loadFaceLandmarker({ numFaces: 1 }); }
    catch (_e) { this.faceLm = null; }

    // Pre-paint cat sprites (one per palette, +1 angry-eye variant for high-combo).
    this.spritePool = PALETTES.map((pal) => {
      const cnv = document.createElement('canvas');
      cnv.width = 128; cnv.height = 128;
      paintCat(cnv.getContext('2d'), 128, pal, 0);
      const tex = new THREE.CanvasTexture(cnv);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return tex;
    });

    // Particle star textures — 5 colors.
    const partColors = ['#ffd23f', '#ff3a55', '#3ddc97', '#41d3ff', '#e84c88'];
    this.particleTextures = partColors.map((col) => {
      const cnv = document.createElement('canvas');
      cnv.width = 64; cnv.height = 64;
      paintStar(cnv.getContext('2d'), 64, col);
      const tex = new THREE.CanvasTexture(cnv);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return tex;
    });

    // Build 10 fingertip cursor meshes (2 hands × 5 fingers each). Each
    // tip gets a colored ring + a softer glow that swells with speed, so
    // the user sees all 10 swat points at once like AirMouse.
    const ringGeo = new THREE.RingGeometry(14, 22, 24);
    const glowGeo = new THREE.CircleGeometry(34, 24);
    for (let h = 0; h < 2; h++) {
      for (let f = 0; f < 5; f++) {
        const ringMat = new THREE.MeshBasicMaterial({
          color: TIP_COLORS[f], transparent: true, opacity: 0,
          depthTest: false, side: THREE.DoubleSide,
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.frustumCulled = false;
        ringMesh.visible = false;
        ctx.scene.add(ringMesh);

        const glowMat = new THREE.MeshBasicMaterial({
          color: TIP_COLORS[f], transparent: true, opacity: 0,
          depthTest: false, side: THREE.DoubleSide,
        });
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        glowMesh.frustumCulled = false;
        glowMesh.visible = false;
        ctx.scene.add(glowMesh);

        this.tips.push({
          handIdx: h, fingerIdx: f, finger: TIP_NAMES[f],
          x: 0, y: 0, vx: 0, vy: 0,
          lastX: 0, lastY: 0, lastT: -1,
          alive: false,        // true only while this hand+finger is visible
          ringMesh, ringMat, glowMesh, glowMat,
        });
      }
    }

    // Cached "POPUP" canvas reused for every floating score number to avoid
    // a CanvasTexture alloc per swat. We swap text + tint at spawn time.
    this._popupGroup = new THREE.Group();
    ctx.scene.add(this._popupGroup);
  }

  spawnCat(boss = false) {
    const w = this.ctx.width, h = this.ctx.height;
    const edge = (Math.random() * 4) | 0;
    let x, y;
    if (edge === 0)      { x = Math.random() * w;     y = -60; }
    else if (edge === 1) { x = -60;                    y = Math.random() * h; }
    else if (edge === 2) { x = w + 60;                 y = Math.random() * h; }
    else                 { x = Math.random() * w;     y = h + 60; }

    const target = this.faceTarget || [w / 2, h / 2];
    const dx = target[0] - x, dy = target[1] - y;
    const d = Math.hypot(dx, dy) || 1;
    const baseSpeed = boss ? 70 : (120 + Math.random() * 80);
    const jitter = 0.5;
    const vx = (dx / d) * baseSpeed + (Math.random() - 0.5) * baseSpeed * jitter;
    const vy = (dy / d) * baseSpeed + (Math.random() - 0.5) * baseSpeed * jitter;

    const palIdx = boss ? 5 : (Math.random() * 5) | 0;  // boss = pink palette
    const tex = this.spritePool[palIdx];
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, side: THREE.DoubleSide });
    const baseSize = boss ? 180 : (70 + Math.random() * 40);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(baseSize, baseSize), mat);
    mesh.frustumCulled = false;
    mesh.position.set(x, y, 5);
    this.ctx.scene.add(mesh);

    this.cats.push({
      x, y, vx, vy,
      baseSize,
      bounceSeed: Math.random() * 10,
      impulseTimer: 0,
      facing: vx < 0 ? -1 : 1,
      mesh, mat,
      boss,
      hp: boss ? 3 : 1,
      spawnT: this.time,    // for scale-pop animation
    });
  }

  spawnParticles(x, y, count, baseColor) {
    for (let i = 0; i < count; i++) {
      const tex = this.particleTextures[(Math.random() * this.particleTextures.length) | 0];
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, side: THREE.DoubleSide });
      const size = 24 + Math.random() * 24;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mesh.frustumCulled = false;
      const a = Math.random() * Math.PI * 2;
      const speed = 400 + Math.random() * 600;
      mesh.position.set(x, y, 8);
      this.ctx.scene.add(mesh);
      this.particles.push({
        mesh, mat,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 0.6 + Math.random() * 0.3,
        age: 0,
        spinV: (Math.random() - 0.5) * 12,
      });
    }
  }

  spawnPopup(x, y, text, color) {
    const W = 320, H = 96;
    const cnv = document.createElement('canvas');
    cnv.width = W; cnv.height = H;
    const fontSize = text.length > 4 ? 48 : 64;
    paintText(cnv.getContext('2d'), W, H, text, color, fontSize);
    const tex = new THREE.CanvasTexture(cnv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.7, H * 0.7), mat);
    mesh.frustumCulled = false;
    mesh.position.set(x, y, 12);
    this.ctx.scene.add(mesh);
    this.popups.push({ mesh, mat, tex, age: 0, life: 1.1, vy: -120 - Math.random() * 60 });
  }

  updateFaceTarget() {
    if (!this.faceLm) { this.faceTarget = null; return; }
    if (this.ctx.video.readyState < 2) return;
    let res;
    try { res = this.faceLm.detectForVideo(this.ctx.video, performance.now() + 0.01); }
    catch (_e) { return; }
    const faces = res?.faceLandmarks || [];
    if (!faces.length) { this.faceTarget = null; return; }
    const [fx, fy] = this.toPx(faces[0][1].x, faces[0][1].y);
    this.faceTarget = [fx, fy];
  }

  frame(hands, dt) {
    this.time += dt;
    const w = this.ctx.width, h = this.ctx.height;
    this.updateFaceTarget();
    const target = this.faceTarget || [w / 2, h / 2];

    // ── Fingertip tracking — 10 tips, AirMouse style ──
    // Mark all tips dead first, then revive the ones the model saw this
    // frame. Dead tips hide their cursor and don't participate in swat.
    const now = this.time;
    for (const t of this.tips) t.alive = false;

    // `h` outside this loop is the canvas height, so use `hi` for hand index.
    for (let hi = 0; hi < Math.min(2, hands.length); hi++) {
      const hand = hands[hi];
      if (!hand) continue;
      for (let f = 0; f < 5; f++) {
        const lm = hand[TIP_LANDMARKS[f]];
        if (!lm) continue;
        const tip = this.tips[hi * 5 + f];
        const [px, py] = this.toPx(lm.x, lm.y);
        if (tip.lastT >= 0 && now > tip.lastT) {
          const dtTip = now - tip.lastT;
          tip.vx = (px - tip.lastX) / dtTip;
          tip.vy = (py - tip.lastY) / dtTip;
        } else {
          tip.vx = tip.vy = 0;
        }
        tip.lastX = px; tip.lastY = py; tip.lastT = now;
        tip.x = px; tip.y = py;
        tip.alive = true;
      }
    }

    // Update cursor visuals for every tip.
    for (const t of this.tips) {
      if (!t.alive) {
        t.ringMesh.visible = false;
        t.glowMesh.visible = false;
        t.lastT = -1;     // forces velocity reset next time it appears
        continue;
      }
      const speedMag = Math.hypot(t.vx, t.vy);
      const hot = Math.min(1, speedMag / 1500);
      t.ringMesh.visible = true;
      t.ringMesh.position.set(t.x, t.y, 9);
      t.ringMat.opacity = 0.55 + hot * 0.4;
      t.ringMesh.scale.setScalar(1 + hot * 0.4);
      t.glowMesh.visible = hot > 0.08;
      t.glowMesh.position.set(t.x, t.y, 8);
      t.glowMat.opacity = hot * 0.55;
      t.glowMesh.scale.setScalar(1 + hot * 0.9);
    }

    // ── Spawn — much more aggressive: target 6–10 cats alive ──
    this.spawnTimer += dt;
    const targetCount = Math.min(10 + Math.floor(this.swattedCount / 20), 18);
    if (this.spawnTimer >= this.nextSpawnIn && this.cats.length < targetCount) {
      this.spawnTimer = 0;
      this.nextSpawnIn = 0.25 + Math.random() * 0.4;
      // 1-in-25 = boss cat, but not too early.
      const boss = this.swattedCount >= 8 && Math.random() < 0.04;
      this.spawnCat(boss);
    }
    // Refill burst when too few alive.
    if (this.cats.length < 4 && this.spawnTimer > 0.2) {
      this.spawnTimer = 0;
      this.spawnCat(false);
    }

    // ── Update cats ──
    const SWAT_SPEED = 900;
    const SWAT_RADIUS = 130;
    const IMPULSE = 1800;

    let swatThisFrame = 0;

    for (let i = this.cats.length - 1; i >= 0; i--) {
      const c = this.cats[i];

      // Steering toward face.
      if (c.impulseTimer <= 0) {
        const dx = target[0] - c.x, dy = target[1] - c.y;
        const d = Math.hypot(dx, dy) || 1;
        const desiredSpeed = c.boss ? 80 : 130;
        const desiredVx = (dx / d) * desiredSpeed;
        const desiredVy = (dy / d) * desiredSpeed;
        const ax = desiredVx - c.vx, ay = desiredVy - c.vy;
        const am = Math.hypot(ax, ay);
        const maxA = 400;
        const k = am > maxA ? maxA / am : 1;
        c.vx += ax * k * dt;
        c.vy += ay * k * dt;
      } else {
        c.vx *= Math.pow(0.92, dt * 60);
        c.vy *= Math.pow(0.92, dt * 60);
        c.impulseTimer -= dt;
      }

      // Swat detection — check ALL 10 fingertips. First fast-moving tip
      // within radius wins this frame. We stop at the first hit so a single
      // swing through doesn't drain all the cat's HP in one frame.
      const swatRange = c.boss ? SWAT_RADIUS * 1.3 : SWAT_RADIUS;
      let hitTip = null;
      for (const t of this.tips) {
        if (!t.alive) continue;
        const tipSpeed = Math.hypot(t.vx, t.vy);
        if (tipSpeed < SWAT_SPEED) continue;
        const dxs = c.x - t.x, dys = c.y - t.y;
        if (Math.hypot(dxs, dys) < swatRange) { hitTip = t; break; }
      }
      if (hitTip) {
        const tvm = Math.hypot(hitTip.vx, hitTip.vy) || 1;
        c.vx = (hitTip.vx / tvm) * IMPULSE;
        c.vy = (hitTip.vy / tvm) * IMPULSE;
        c.impulseTimer = 0.4;
        c.hp -= 1;
        swatThisFrame++;
        this.spawnParticles(c.x, c.y, c.boss ? 22 : 12);

        // KO when hp drops to 0 — remove cat + big particle pop + popup.
        if (c.hp <= 0) {
          this.swattedCount++;
          if (now - this.lastSwatTime < 1.5) this.combo++;
          else this.combo = 1;
          this.lastSwatTime = now;
          this.bestCombo = Math.max(this.bestCombo, this.combo);

          const baseScore = c.boss ? 5 : 1;
          const totalScore = baseScore * Math.max(1, this.combo);
          const popupText = this.combo >= 3 ? `+${totalScore} ×${this.combo}` : `+${totalScore}`;
          const popupColor = this.combo >= 5 ? '#ff3a55' : this.combo >= 3 ? '#ffd23f' : '#fff';
          this.spawnPopup(c.x, c.y - 30, popupText, popupColor);
          if (c.boss) this.spawnPopup(c.x, c.y + 30, 'BOSS DOWN!', '#ff3a55');

          this.spawnParticles(c.x, c.y, c.boss ? 30 : 14);
          this.ctx.scene.remove(c.mesh);
          c.mesh.geometry.dispose();
          c.mat.dispose();
          this.cats.splice(i, 1);

          this.shakeAmp = Math.max(this.shakeAmp, c.boss ? 22 : 8 + this.combo);
          this.shakeT = c.boss ? 0.4 : 0.2;

          this.playSwatSound(c.boss);
          continue;
        } else {
          // Boss still alive — quick hit-flash + small shake.
          this.shakeAmp = Math.max(this.shakeAmp, 6);
          this.shakeT = 0.15;
          this.playMeow();
        }
      }

      // Integrate.
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.facing = c.vx < -5 ? -1 : (c.vx > 5 ? 1 : c.facing);

      // Walk bounce + scale-pop on spawn.
      const bounce = Math.sin(this.time * 9 + c.bounceSeed) * 5;
      const spawnAge = this.time - c.spawnT;
      const popScale = spawnAge < 0.25 ? (spawnAge / 0.25) : 1;
      // Threat scale — cats grow as they near face.
      const dxf = c.x - target[0], dyf = c.y - target[1];
      const distF = Math.hypot(dxf, dyf);
      const threatScale = 1 + Math.max(0, 1 - distF / 280) * 0.45;
      const size = popScale * threatScale;

      c.mesh.position.set(c.x, c.y + bounce, 5);
      c.mesh.scale.set(c.facing * size, size, 1);

      // Tint material redder as threat rises.
      const threat = Math.max(0, 1 - distF / 320);
      c.mat.color.setRGB(1, 1 - threat * 0.45, 1 - threat * 0.45);

      // Off-screen cleanup.
      if (c.x < -80 || c.x > w + 80 || c.y < -80 || c.y > h + 80) {
        this.ctx.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mat.dispose();
        this.cats.splice(i, 1);
      }
    }

    // ── Update particles ──
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.ctx.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mat.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      // Gravity-ish pull down.
      p.vy += 600 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.rotation.z += p.spinV * dt;
      p.mat.opacity = 1 - t;
      const sc = 1 + t * 0.4;
      p.mesh.scale.set(sc, sc, 1);
    }

    // ── Update popups ──
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.ctx.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mat.dispose();
        p.tex.dispose();
        this.popups.splice(i, 1);
        continue;
      }
      p.mesh.position.y += p.vy * dt;
      p.vy *= Math.pow(0.94, dt * 60);
      p.mat.opacity = 1 - t * t;
      // Pop scale at start.
      const sc = t < 0.15 ? (t / 0.15) * 1.3 : 1.3 - Math.min(0.3, (t - 0.15));
      p.mesh.scale.set(sc, sc, 1);
    }

    // ── Combo decay ──
    if (now - this.lastSwatTime > 1.5 && this.combo > 0) {
      this.combo = 0;
    }

    // ── Screen shake (offset the camera) ──
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT / 0.4);
      const ox = (Math.random() - 0.5) * this.shakeAmp * k;
      const oy = (Math.random() - 0.5) * this.shakeAmp * k;
      this.camera.position.x = ox;
      this.camera.position.y = oy;
      this.camera.updateMatrixWorld();
      if (this.shakeT <= 0) {
        this.camera.position.x = 0;
        this.camera.position.y = 0;
        this.shakeAmp = 0;
      }
    }

    // ── HUD ──
    const comboPart = this.combo >= 2 ? ` · COMBO ×${this.combo}` : '';
    const bestPart = this.bestCombo >= 3 ? ` · best ×${this.bestCombo}` : '';
    this.ctx.setHud(`CAT ATTACK · ${this.swattedCount}${comboPart}${bestPart}`);
  }

  playSwatSound(big) {
    try {
      if (!this.audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.audioCtx = new AC();
      }
      const ac = this.audioCtx;
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime;
      // Low thump.
      const thumpO = ac.createOscillator();
      const thumpG = ac.createGain();
      thumpO.type = 'sine';
      thumpO.frequency.setValueAtTime(big ? 60 : 110, now);
      thumpO.frequency.exponentialRampToValueAtTime(big ? 30 : 50, now + 0.16);
      thumpG.gain.setValueAtTime(0.0001, now);
      thumpG.gain.exponentialRampToValueAtTime(big ? 0.55 : 0.4, now + 0.01);
      thumpG.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      thumpO.connect(thumpG).connect(ac.destination);
      thumpO.start(now);
      thumpO.stop(now + 0.25);
      // High meow.
      this.playMeow();
      // Combo cheer — pitch rises with combo.
      if (this.combo >= 3) {
        const cheerO = ac.createOscillator();
        const cheerG = ac.createGain();
        cheerO.type = 'triangle';
        const base = 540 + this.combo * 80;
        cheerO.frequency.setValueAtTime(base, now + 0.05);
        cheerO.frequency.exponentialRampToValueAtTime(base * 1.5, now + 0.18);
        cheerG.gain.setValueAtTime(0.0001, now + 0.05);
        cheerG.gain.exponentialRampToValueAtTime(0.22, now + 0.07);
        cheerG.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
        cheerO.connect(cheerG).connect(ac.destination);
        cheerO.start(now + 0.05);
        cheerO.stop(now + 0.28);
      }
    } catch (_e) { /* */ }
  }

  playMeow() {
    try {
      if (!this.audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.audioCtx = new AC();
      }
      const ac = this.audioCtx;
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime;
      const carrier = ac.createOscillator();
      const mod = ac.createOscillator();
      const modGain = ac.createGain();
      const gain = ac.createGain();
      carrier.type = 'sine';
      mod.type = 'sine';
      const startF = 600 + Math.random() * 240;
      carrier.frequency.setValueAtTime(startF, now);
      carrier.frequency.exponentialRampToValueAtTime(startF * 0.55, now + 0.22);
      mod.frequency.setValueAtTime(110, now);
      modGain.gain.setValueAtTime(140, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);
      mod.connect(modGain).connect(carrier.frequency);
      carrier.connect(gain).connect(ac.destination);
      mod.start(now); carrier.start(now);
      mod.stop(now + 0.32); carrier.stop(now + 0.32);
    } catch (_e) { /* */ }
  }

  teardown() {
    for (const c of this.cats) {
      this.ctx.scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mat.dispose();
    }
    this.cats.length = 0;
    for (const p of this.particles) {
      this.ctx.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mat.dispose();
    }
    this.particles.length = 0;
    for (const p of this.popups) {
      this.ctx.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mat.dispose();
      p.tex.dispose();
    }
    this.popups.length = 0;
    // Dispose 10 fingertip cursors. Ring + glow share geometry instances
    // across all tips, so we only dispose them once at the end.
    for (const t of this.tips) {
      this.ctx.scene.remove(t.ringMesh);
      this.ctx.scene.remove(t.glowMesh);
      t.ringMat.dispose();
      t.glowMat.dispose();
    }
    if (this.tips.length) {
      this.tips[0].ringMesh.geometry.dispose();
      this.tips[0].glowMesh.geometry.dispose();
    }
    this.tips.length = 0;
    if (this._popupGroup) this.ctx.scene.remove(this._popupGroup);
    if (this.spritePool) { for (const t of this.spritePool) t.dispose(); this.spritePool = null; }
    if (this.particleTextures) { for (const t of this.particleTextures) t.dispose(); this.particleTextures = null; }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { this.audioCtx.close(); } catch (_e) { /* */ }
    }
    this.audioCtx = null;
    // Restore camera offset.
    if (this.camera) { this.camera.position.x = 0; this.camera.position.y = 0; }
  }
}

// ─── Launcher tile preview ────────────────────────────────────────────────
function preview(ctx) {
  const W = 320, H = 320;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1a0d2b');
  g.addColorStop(0.5, '#2a1444');
  g.addColorStop(1, '#0a0418');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const r = ctx.createRadialGradient(W / 2, H * 0.55, 30, W / 2, H * 0.55, W * 0.7);
  r.addColorStop(0, 'rgba(255,180,80,0.18)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);

  function drawCatAt(x, y, size, palette, flip, glow) {
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = 96;
    paintCat(tmp.getContext('2d'), 96, palette, glow);
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(tmp, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  drawCatAt(70, 110, 100, PALETTES[0], false, 0);
  drawCatAt(240, 90, 86, PALETTES[1], true, 0);
  drawCatAt(160, 240, 110, PALETTES[2], false, 0.6);

  ctx.strokeStyle = '#ff3a55';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(160 - 38, 240 - 38);
  ctx.lineTo(160 + 38, 240 + 38);
  ctx.moveTo(160 + 38, 240 - 38);
  ctx.lineTo(160 - 38, 240 + 38);
  ctx.stroke();

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, H - 46, W, 46);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 22px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('CAT ATTACK', 14, H - 23);
}

export default {
  id: 'CatAttack',
  title: 'CAT ATTACK',
  subtitle: 'SWAT! COMBO! CHAOS!',
  category: 'HAND',
  factory: () => new CatAttack(),
  preview,
};
