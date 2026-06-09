import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ---------------------------------------------------------------------------
// PORTAL PULL
// Two-hand effect — bring palms together to open a swirling black-hole portal
// that distorts the live camera pixels into a vortex with a dark singularity
// and bright accretion ring.
//
// Strategy:
//   * Disable raw <video> display; we paint the live video ourselves into a
//     full-screen background quad so the portal can sample it for distortion.
//   * Portal is a second quad placed at the midpoint between the two palms.
//     Its fragment shader samples the same videoTexture at swirled,
//     contracted polar coordinates → genuine radial distortion of the camera
//     feed inside the portal disc.
//   * Outer halo plane adds an additive glow ring around the disc.
// ---------------------------------------------------------------------------

// Shared vertex shader: pass uv through, MVP transform position so we can
// position planes in pixel-space using the ortho camera supplied by Tracker.
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Helper GLSL — cover-fit + mirror-aware video sample. Identical math to the
// one in core/shaderLib.js, repeated here because we use a custom material
// (not the BaseShaderEffect preamble).
const VIDEO_HELPER = /* glsl */ `
  uniform sampler2D uVideo;
  uniform vec2  uResolution;
  uniform vec2  uVideoSize;
  uniform float uMirror;

  vec2 coverUv(vec2 uv) {
    float ca = uResolution.x / uResolution.y;
    float va = uVideoSize.x / uVideoSize.y;
    vec2 s = vec2(1.0);
    if (ca > va) s.y = va / ca; else s.x = ca / va;
    return (uv - 0.5) * s + 0.5;
  }

  vec3 sampleVideo(vec2 uv) {
    vec2 c = coverUv(uv);
    if (uMirror > 0.5) c.x = 1.0 - c.x;
    return texture2D(uVideo, clamp(c, 0.001, 0.999)).rgb;
  }
`;

// Background full-screen plane — straight live video, no distortion.
const BG_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  ${VIDEO_HELPER}
  void main() {
    // Tracker renders with a Y-DOWN ortho camera, so screen-uv (vUv) is
    // vertically opposite to the flipY=true uVideo texture-space. Flip vUv.y so
    // the live video paints UPRIGHT — same convention the portal disc already
    // uses via portalV (1.0 - currentY/H). See CLAUDE.md §12.
    gl_FragColor = vec4(sampleVideo(vec2(vUv.x, 1.0 - vUv.y)), 1.0);
  }
`;

// Portal disc — radial swirl + suck distortion + accretion ring + singularity.
const PORTAL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2  uPortalScreenPos;   // center in screen-uv (0..1)
  uniform vec2  uPortalScreenSize;  // diameter in screen-uv (x=w, y=h)
  uniform float uOpen;              // 0..1 — controls alpha + intensity
  uniform float uFlash;             // 0..1 — supernova flash
  ${VIDEO_HELPER}

  void main() {
    // Local portal coords: -0.5..0.5 with (0,0) at center
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;        // 0 at center → 1 at portal edge

    // Anything past r=1 is outside the disc → fully transparent
    if (r > 1.0) { discard; }

    float theta = atan(p.y, p.x);

    // Swirl: more twist near the center, slowly spinning over time.
    // Direction reverses subtly with sin() for a "breathing" feel.
    float spinDir = 1.0;
    float twist = uTime * 1.6 + (1.0 - r) * 6.5;
    theta += twist * spinDir;

    // Squeeze r before sampling — pulls pixels inward (the "suck")
    float rSample = pow(clamp(r, 0.0, 1.0), 1.4);

    // Back to cartesian in local portal space (-0.5..0.5)
    vec2 distortedLocal = vec2(cos(theta), sin(theta)) * rSample * 0.5;

    // Convert local portal-uv to screen-uv:
    //   screenUV = portalCenter + localOffset * portalDiameter
    vec2 screenUV = uPortalScreenPos + distortedLocal * uPortalScreenSize;

    vec3 col = sampleVideo(screenUV);

    // Tint the sampled pixels cool/violet to feel otherworldly
    col = mix(col, col * vec3(0.55, 0.65, 1.15), 0.35);

    // Darken radially toward center — gravitational redshift vibe
    float darken = smoothstep(0.0, 0.85, r);
    col *= mix(0.15, 1.0, darken);

    // Central singularity: jet-black core with soft falloff
    float core = 1.0 - smoothstep(0.0, 0.18, r);
    col = mix(col, vec3(0.0), core);

    // Accretion ring at r ∈ [0.45, 0.55] — pulsing cyan/magenta band
    float ring = smoothstep(0.42, 0.50, r) * (1.0 - smoothstep(0.50, 0.58, r));
    float pulse = 0.65 + 0.35 * sin(uTime * 4.0);
    vec3 ringHue = mix(vec3(0.25, 0.95, 1.0),  // cyan
                       vec3(1.0, 0.25, 0.85),  // magenta
                       0.5 + 0.5 * sin(uTime * 1.5 + theta * 3.0));
    col += ringHue * ring * pulse * 1.8;

    // Secondary inner glow ring at r ≈ 0.25 — embers swirling near the core
    float emberRing = smoothstep(0.20, 0.26, r) * (1.0 - smoothstep(0.26, 0.34, r));
    col += vec3(1.0, 0.55, 0.15) * emberRing * (0.6 + 0.4 * sin(uTime * 8.0 + theta * 5.0));

    // Outer-edge bloom — fades the disc gracefully into the surrounding halo
    float edgeBloom = smoothstep(0.85, 1.0, r);
    col += vec3(0.4, 0.6, 1.0) * edgeBloom * 0.8;

    // Supernova white flash on close-collision
    col = mix(col, vec3(1.0), uFlash);

    // Soft alpha falloff so the disc doesn't look like a hard cookie cutter
    float alpha = (1.0 - smoothstep(0.92, 1.0, r)) * uOpen;

    gl_FragColor = vec4(col, alpha);
  }
`;

// Outer halo ring — radial gradient, additive blend for soft bloom around
// the portal disc.
const HALO_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uOpen;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    // Halo lives in the annulus r ∈ [0.5, 1.0] — peaking near the inner edge
    float inner = smoothstep(0.50, 0.62, r);
    float outer = 1.0 - smoothstep(0.62, 1.0, r);
    float ring  = inner * outer;
    float pulse = 0.65 + 0.35 * sin(uTime * 3.0);
    vec3  c     = mix(vec3(0.4, 0.85, 1.0), vec3(0.95, 0.4, 1.0),
                      0.5 + 0.5 * sin(uTime * 0.9));
    float a     = ring * pulse * uOpen * 0.9;
    gl_FragColor = vec4(c * 1.4, a);
  }
`;

// ---------------------------------------------------------------------------
// JS implementation
// ---------------------------------------------------------------------------

function palmCenter(lms) {
  const idx = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  for (const i of idx) { x += lms[i].x; y += lms[i].y; }
  return { x: x / idx.length, y: y / idx.length };
}

class PortalPull extends Tracker {
  constructor() {
    super({ kind: 'hand', numHands: 2 });
    // We paint the live video ourselves (so the portal can distort it).
    this.wantsRawVideo = false;
    this.time = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.currentRadius = 0;   // smoothed
    this.flash = 0;            // 0..1 supernova mix
  }

  async setup(ctx) {
    const W = ctx.width, H = ctx.height;
    this.currentX = W / 2;
    this.currentY = H / 2;

    const vw = ctx.video?.videoWidth || 1280;
    const vh = ctx.video?.videoHeight || 720;

    // ---- Background plane (Z=0) — straight live video ----
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BG_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uVideo:      { value: ctx.videoTexture },
        uResolution: { value: new THREE.Vector2(W, H) },
        uVideoSize:  { value: new THREE.Vector2(vw, vh) },
        uMirror:     { value: this.mirror ? 1.0 : 0.0 },
      },
    });
    this.bgGeo = new THREE.PlaneGeometry(W, H);
    this.bg = new THREE.Mesh(this.bgGeo, this.bgMat);
    this.bg.frustumCulled = false;
    this.bg.position.set(W / 2, H / 2, 0);
    this.bg.renderOrder = 0;
    ctx.scene.add(this.bg);

    // ---- Portal disc (Z=2) ----
    this.portalMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: PORTAL_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uVideo:            { value: ctx.videoTexture },
        uResolution:       { value: new THREE.Vector2(W, H) },
        uVideoSize:        { value: new THREE.Vector2(vw, vh) },
        uMirror:           { value: this.mirror ? 1.0 : 0.0 },
        uTime:             { value: 0 },
        uPortalScreenPos:  { value: new THREE.Vector2(0.5, 0.5) },
        uPortalScreenSize: { value: new THREE.Vector2(0, 0) },
        uOpen:             { value: 0 },
        uFlash:            { value: 0 },
      },
    });
    this.portalGeo = new THREE.PlaneGeometry(1, 1);
    this.portal = new THREE.Mesh(this.portalGeo, this.portalMat);
    this.portal.frustumCulled = false;
    this.portal.position.set(W / 2, H / 2, 2);
    this.portal.renderOrder = 2;
    this.portal.visible = false;
    ctx.scene.add(this.portal);

    // ---- Halo ring (Z=3, additive) — slightly larger than the portal ----
    this.haloMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpen: { value: 0 },
      },
    });
    this.haloGeo = new THREE.PlaneGeometry(1, 1);
    this.halo = new THREE.Mesh(this.haloGeo, this.haloMat);
    this.halo.frustumCulled = false;
    this.halo.position.set(W / 2, H / 2, 3);
    this.halo.renderOrder = 3;
    this.halo.visible = false;
    ctx.scene.add(this.halo);
  }

  frame(hands, dt) {
    const { ctx } = this;
    this.time += dt;
    const W = ctx.width, H = ctx.height;

    // Keep video size uniforms fresh — videoWidth is 0 until the stream binds.
    if (ctx.video?.videoWidth) {
      this.bgMat.uniforms.uVideoSize.value.set(ctx.video.videoWidth, ctx.video.videoHeight);
      this.portalMat.uniforms.uVideoSize.value.set(ctx.video.videoWidth, ctx.video.videoHeight);
    }

    // ---- Compute portal target geometry from hand landmarks ----
    let targetRadius = 0;
    let targetX = this.currentX;
    let targetY = this.currentY;
    let distance = Infinity;

    if (hands.length >= 2) {
      const c1 = palmCenter(hands[0]);
      const c2 = palmCenter(hands[1]);
      const [p1x, p1y] = this.toPx(c1.x, c1.y);
      const [p2x, p2y] = this.toPx(c2.x, c2.y);
      distance = Math.hypot(p1x - p2x, p1y - p2y);
      targetX = (p1x + p2x) / 2;
      targetY = (p1y + p2y) / 2;

      if (distance < 400) {
        targetRadius = Math.max(40, 250 - distance * 0.5);
      } else {
        targetRadius = 0;
      }

      // Supernova on near-collision (distance < 50)
      if (distance < 50) {
        this.flash = Math.min(1, this.flash + dt * 6);
      }
    } else if (hands.length === 1) {
      // One hand → portal closes, but track that hand so it shrinks to its palm
      const c = palmCenter(hands[0]);
      const [px, py] = this.toPx(c.x, c.y);
      targetX = px; targetY = py;
      targetRadius = 0;
    } else {
      targetRadius = 0;
    }

    // Decay flash regardless — half-life ~0.5s
    this.flash = Math.max(0, this.flash - dt * 2.0);

    // ---- Smooth all dynamic values ----
    const openSpeed  = 14;  // snappy on open
    const closeSpeed = 7;   // softer close
    const k = targetRadius > this.currentRadius ? openSpeed : closeSpeed;
    this.currentRadius += (targetRadius - this.currentRadius) * (1 - Math.exp(-k * dt));
    this.currentX += (targetX - this.currentX) * (1 - Math.exp(-12 * dt));
    this.currentY += (targetY - this.currentY) * (1 - Math.exp(-12 * dt));

    const radius = this.currentRadius;
    const visible = radius > 2;
    this.portal.visible = visible;
    this.halo.visible   = visible;

    if (visible) {
      // Position + scale the portal disc to (2r × 2r) at midpoint
      const diameter = radius * 2;
      this.portal.position.set(this.currentX, this.currentY, 2);
      this.portal.scale.set(diameter, diameter, 1);

      // Halo is 2.4× the disc — leaves room for the outer falloff
      const haloDiameter = diameter * 2.4;
      this.halo.position.set(this.currentX, this.currentY, 3);
      this.halo.scale.set(haloDiameter, haloDiameter, 1);

      // Convert portal center + size to screen-uv (0..1) for the shader.
      // Note: ortho cam has Y=0 at TOP, so flip Y to match texture-space.
      const portalU = this.currentX / W;
      const portalV = 1.0 - (this.currentY / H);
      const portalUw = diameter / W;
      const portalVh = diameter / H;

      const openNorm = Math.min(1, radius / 250);

      this.portalMat.uniforms.uTime.value = this.time;
      this.portalMat.uniforms.uPortalScreenPos.value.set(portalU, portalV);
      this.portalMat.uniforms.uPortalScreenSize.value.set(portalUw, portalVh);
      this.portalMat.uniforms.uOpen.value = openNorm;
      this.portalMat.uniforms.uFlash.value = this.flash;

      this.haloMat.uniforms.uTime.value = this.time;
      this.haloMat.uniforms.uOpen.value = openNorm;
    }

    const dStr = (distance === Infinity) ? '∞' : distance.toFixed(0);
    ctx.setHud(`PORTAL · bring hands together · distance: ${dStr} px · radius: ${radius.toFixed(0)} px`);
  }

  resize(w, h) {
    super.resize(w, h);
    if (this.bg) {
      this.bgGeo.dispose();
      this.bgGeo = new THREE.PlaneGeometry(w, h);
      this.bg.geometry = this.bgGeo;
      this.bg.position.set(w / 2, h / 2, 0);
    }
    if (this.bgMat)     this.bgMat.uniforms.uResolution.value.set(w, h);
    if (this.portalMat) this.portalMat.uniforms.uResolution.value.set(w, h);
  }

  teardown() {
    const scene = this.ctx?.scene;
    const drop = (mesh, geo, mat) => {
      if (!mesh) return;
      if (scene) scene.remove(mesh);
      geo?.dispose();
      mat?.dispose();
    };
    drop(this.bg,     this.bgGeo,     this.bgMat);
    drop(this.portal, this.portalGeo, this.portalMat);
    drop(this.halo,   this.haloGeo,   this.haloMat);
    this.bg = this.portal = this.halo = null;
    this.bgGeo = this.portalGeo = this.haloGeo = null;
    this.bgMat = this.portalMat = this.haloMat = null;
  }
}

// ---------------------------------------------------------------------------
// Preview — dark vortex with cyan/magenta swirl arms + two flanking hands.
// ---------------------------------------------------------------------------
function preview(c) {
  const W = 320, H = 320;
  const cx = W / 2, cy = H / 2;

  // Deep-space backdrop
  const bg = c.createRadialGradient(cx, cy, 10, cx, cy, 220);
  bg.addColorStop(0, '#1a0a2c');
  bg.addColorStop(1, '#02000a');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  // A few starfield specks for atmosphere
  c.fillStyle = 'rgba(255,255,255,0.65)';
  for (let i = 0; i < 60; i++) {
    const sx = (i * 71) % W;
    const sy = (i * 137) % H;
    const sr = ((i * 13) % 3) * 0.6 + 0.3;
    c.beginPath();
    c.arc(sx, sy, sr, 0, Math.PI * 2);
    c.fill();
  }

  // Swirl arms — parametric spirals in cyan and magenta
  c.save();
  c.translate(cx, cy);
  c.globalCompositeOperation = 'lighter';
  const arms = 4;
  for (let a = 0; a < arms; a++) {
    const baseAngle = (a / arms) * Math.PI * 2;
    const hue = (a % 2 === 0) ? 'rgba(60,220,255,' : 'rgba(255,80,210,';
    c.lineWidth = 2.4;
    c.beginPath();
    for (let t = 0; t < 200; t++) {
      const tt = t / 200;
      const r = 8 + tt * 110;
      const ang = baseAngle + tt * 5.0;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      const alpha = (1 - tt) * 0.85;
      c.strokeStyle = hue + alpha.toFixed(3) + ')';
      if (t === 0) c.moveTo(x, y);
      else {
        c.lineTo(x, y);
        c.stroke();
        c.beginPath();
        c.moveTo(x, y);
      }
    }
  }
  c.restore();

  // Accretion ring — bright halo around the singularity
  c.save();
  c.translate(cx, cy);
  c.globalCompositeOperation = 'lighter';
  const ringGrad = c.createRadialGradient(0, 0, 38, 0, 0, 64);
  ringGrad.addColorStop(0, 'rgba(80,220,255,0)');
  ringGrad.addColorStop(0.5, 'rgba(180,240,255,0.9)');
  ringGrad.addColorStop(1, 'rgba(255,80,210,0)');
  c.fillStyle = ringGrad;
  c.beginPath();
  c.arc(0, 0, 64, 0, Math.PI * 2);
  c.fill();
  c.restore();

  // Black hole singularity
  c.fillStyle = '#000';
  c.beginPath();
  c.arc(cx, cy, 28, 0, Math.PI * 2);
  c.fill();
  // Tiny rim highlight
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = 1.2;
  c.beginPath();
  c.arc(cx, cy, 30, 0, Math.PI * 2);
  c.stroke();

  // Two hand silhouettes flanking the portal
  const drawHand = (hx, hy, flip) => {
    c.save();
    c.translate(hx, hy);
    if (flip) c.scale(-1, 1);
    c.fillStyle = 'rgba(255,255,255,0.92)';
    // Palm (rounded rect)
    c.beginPath();
    c.moveTo(0, -22);
    c.quadraticCurveTo(28, -22, 28, 0);
    c.quadraticCurveTo(28, 30, 6, 32);
    c.quadraticCurveTo(-10, 32, -10, 12);
    c.closePath();
    c.fill();
    // Fingers — four little nubs
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      const fx = 4 + i * 7;
      c.ellipse(fx, -28, 3.2, 12, 0, 0, Math.PI * 2);
      c.fill();
    }
    // Thumb
    c.beginPath();
    c.ellipse(-12, 6, 5, 11, -0.5, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  drawHand(40, cy + 8, true);
  drawHand(W - 40, cy + 8, false);

  // Outer bloom haze — sells the portal's glow
  c.save();
  c.globalCompositeOperation = 'screen';
  const bloom = c.createRadialGradient(cx, cy, 30, cx, cy, 150);
  bloom.addColorStop(0, 'rgba(180,90,255,0.45)');
  bloom.addColorStop(1, 'rgba(180,90,255,0)');
  c.fillStyle = bloom;
  c.fillRect(0, 0, W, H);
  c.restore();
}

export default {
  id: 'PortalPull',
  title: 'PORTAL PULL',
  subtitle: 'PALMS TOGETHER · OPEN THE VOID',
  category: 'HAND',
  factory: () => new PortalPull(),
  preview,
};
