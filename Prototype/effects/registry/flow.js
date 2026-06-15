import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ============================================================================
// FLOW — a curl-noise flow field, rendered as silky glowing ink-ribbons and
// steered live by your hands.
//
// Rendering (the "premium" part):
//   * Particles drift along a divergence-free curl field. They are NOT drawn as
//     thin lines — instead each is a soft round sprite splatted into a
//     persistent accumulation buffer (FBO) that fades a little every frame.
//     The fade IS the trail memory, so moving sprites leave long luminous
//     ribbons with zero per-particle history bookkeeping.
//   * A compact separable bloom pass blooms the bright cores into a soft glow.
//   * A final composite samples the (dimmed, slightly desaturated, vignetted)
//     camera and adds trail + bloom on top — cinematic ink-on-film look.
//
// Interaction:
//   Each detected palm is a local force — a swirl (vortex) plus a radial term
//   whose sign follows the hand's openness:  ✊ pull inward + strong swirl,
//   ✋ push outward.  No hands → the field just breathes on its own.
//
// Orientation (AGENTS.md §12): the virtual-camera frame is raw. We paint the
// camera ourselves in the composite (wantsRawVideo=false) using the same
// coverUv+mirror+Y-flip helper portalPull uses, and the trail FBO is sampled
// with the matching flip — verified with ?fake=1 (TOP/BOTTOM/L/R, "F").
// ============================================================================

const N_PARTICLES = 5000;
const FIELD_SCALE = 0.0042; // spatial frequency of the base field (1/px)
const FIELD_SPEED = 165;    // base drift speed (px/s)
const HAND_RADIUS = 240;    // px — influence falloff of a palm
const HAND_SPEED  = 760;    // px/s — peak velocity a palm imparts
const LIFE_MIN    = 3.0;    // s — particle lifetime before respawn
const LIFE_MAX    = 7.0;
const TRAIL_FADE  = 0.982;  // accumulation persistence (higher = longer ribbons)
const SPRITE_PX   = 12;     // base sprite diameter (px)
const BLOOM_GAIN  = 1.7;    // glow strength — the "premium" lift comes from here
const CAM_DIM     = 0.42;   // camera brightness behind the ink
const CAM_DESAT   = 0.30;   // pull the camera toward grey for elegance

// MediaPipe hand landmarks: 0=wrist, 9=middle-MCP; 8/12/16/20 fingertips.
const PALM_IDXS = [0, 5, 9, 13, 17];
const TIP_IDXS  = [8, 12, 16, 20];

function palmCenter(lms) {
  let x = 0, y = 0;
  for (const i of PALM_IDXS) { x += lms[i].x; y += lms[i].y; }
  return { x: x / PALM_IDXS.length, y: y / PALM_IDXS.length };
}

// Openness ∈ [0,1]: mean fingertip distance from the palm, normalised by hand
// size (wrist→middle-MCP). Fist ≈ 0, spread hand ≈ 1.
function handOpenness(lms) {
  const c = palmCenter(lms);
  const size = Math.hypot(lms[9].x - lms[0].x, lms[9].y - lms[0].y) || 1e-3;
  let sum = 0;
  for (const i of TIP_IDXS) sum += Math.hypot(lms[i].x - c.x, lms[i].y - c.y);
  const ratio = (sum / TIP_IDXS.length) / size;
  return Math.max(0, Math.min(1, (ratio - 1.15) / 0.75));
}

// Curl of an analytic stream function ψ → divergence-free velocity field.
function fieldVelocity(x, y, t, out) {
  const nx = x * FIELD_SCALE, ny = y * FIELD_SCALE;
  const p1 = Math.cos(1.0 * nx + 0.7 * ny + 0.30 * t);
  const p2 = Math.cos(-0.5 * nx + 1.3 * ny - 0.23 * t);
  const p3 = Math.cos(0.6 * nx + 0.6 * ny + 0.17 * t);
  const dPsi_dx = 1.0 * p1 + 0.9 * (-0.5) * p2 + 0.6 * 0.6 * p3;
  const dPsi_dy = 0.7 * p1 + 0.9 * (1.3) * p2 + 0.6 * 0.6 * p3;
  out.x = dPsi_dy; out.y = -dPsi_dx;
}

// Elegant cool "aurora": hue confined to a cool band so it never goes amber —
// cyan → blue → indigo → violet → magenta.
const _hsl = new THREE.Color();
function aurora(t, out) {
  _hsl.setHSL((0.47 + 0.31 * t) % 1, 0.74, 0.58);
  out.r = _hsl.r; out.g = _hsl.g; out.b = _hsl.b;
}

// Soft round sprite (radial alpha falloff) used to splat each particle.
function makeSpriteTexture() {
  const s = 64;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.30, 'rgba(255,255,255,0.42)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  return tex;
}

// ---- shaders ----------------------------------------------------------------
const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const PT_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main(){
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
  }
`;
const PT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uTex;
  varying vec3 vColor;
  void main(){
    float a = texture2D(uTex, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * a, a);   // additive splat
  }
`;

const FADE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform float uFade;
  void main(){ gl_FragColor = vec4(texture2D(uPrev, vUv).rgb * uFade, 1.0); }
`;

const BRIGHT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform float uThresh;
  void main(){
    vec3 c = texture2D(uTex, vUv).rgb;
    gl_FragColor = vec4(max(c - uThresh, 0.0), 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec2 uDir;   // texel step along blur axis
  void main(){
    vec3 sum = texture2D(uTex, vUv).rgb * 0.227027;
    sum += texture2D(uTex, vUv + uDir * 1.3846).rgb * 0.316216;
    sum += texture2D(uTex, vUv - uDir * 1.3846).rgb * 0.316216;
    sum += texture2D(uTex, vUv + uDir * 3.2308).rgb * 0.070270;
    sum += texture2D(uTex, vUv - uDir * 3.2308).rgb * 0.070270;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVideo, uTrail, uBloom;
  uniform vec2 uResolution, uVideoSize;
  uniform float uMirror, uDim, uDesat, uBloomGain;

  vec2 coverUv(vec2 uv){
    float ca = uResolution.x / uResolution.y;
    float va = uVideoSize.x / uVideoSize.y;
    vec2 s = vec2(1.0);
    if (ca > va) s.y = va / ca; else s.x = ca / va;
    return (uv - 0.5) * s + 0.5;
  }
  vec3 sampleVideo(vec2 uv){
    vec2 c = coverUv(uv);
    if (uMirror > 0.5) c.x = 1.0 - c.x;
    return texture2D(uVideo, clamp(c, 0.001, 0.999)).rgb;
  }
  void main(){
    // Camera painted upright (Y-flip), dimmed + desaturated for contrast.
    vec3 cam = sampleVideo(vec2(vUv.x, 1.0 - vUv.y));
    float L = dot(cam, vec3(0.299, 0.587, 0.114));
    cam = mix(cam, vec3(L), uDesat) * uDim;

    // Trail + bloom share the camera's flip so the ink lines up with the hands.
    vec2 tUv = vec2(vUv.x, 1.0 - vUv.y);
    vec3 trail = texture2D(uTrail, tUv).rgb;
    vec3 bloom = texture2D(uBloom, tUv).rgb;

    vec3 col = cam + trail + bloom * uBloomGain;

    // Cinematic vignette.
    float vig = smoothstep(1.05, 0.35, length(vUv - 0.5));
    col *= mix(0.7, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeRT(w, h) {
  return new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
}

class Flow extends Tracker {
  constructor() {
    super({ kind: 'hand', numHands: 2 });
    this.wantsRawVideo = false; // we paint the camera ourselves in the composite
    this.time = 0;
    this.hands = [];
    this.px = new Float32Array(N_PARTICLES);
    this.py = new Float32Array(N_PARTICLES);
    this.life = new Float32Array(N_PARTICLES);
    this.seed = new Float32Array(N_PARTICLES);
    this._v = { x: 0, y: 0 };
    this._c = { r: 1, g: 1, b: 1 };
  }

  async setup(ctx) {
    const W = ctx.width, H = ctx.height;
    const bw = Math.max(2, W >> 1), bh = Math.max(2, H >> 1);

    this.sprite = makeSpriteTexture();

    // ---- offscreen targets ----
    this.trailA = makeRT(W, H);
    this.trailB = makeRT(W, H);
    this.bloomA = makeRT(bw, bh);
    this.bloomB = makeRT(bw, bh);
    const r = ctx.renderer;
    for (const rt of [this.trailA, this.trailB, this.bloomA, this.bloomB]) {
      r.setRenderTarget(rt); r.clear();
    }
    r.setRenderTarget(null);

    // ---- full-screen blit quad (shared, material swapped per pass) ----
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fsScene = new THREE.Scene();
    this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.fsQuad.frustumCulled = false;
    this.fsScene.add(this.fsQuad);

    this.fadeMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: FADE_FRAG, depthTest: false,
      uniforms: { uPrev: { value: null }, uFade: { value: TRAIL_FADE } },
    });
    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false,
      uniforms: { uTex: { value: null }, uThresh: { value: 0.10 } },
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, depthTest: false,
      uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } },
    });

    // ---- particle system (rendered into the trail buffer) ----
    this.ptGeo = new THREE.BufferGeometry();
    this.ptPos = new THREE.BufferAttribute(new Float32Array(N_PARTICLES * 3), 3);
    this.ptCol = new THREE.BufferAttribute(new Float32Array(N_PARTICLES * 3), 3);
    this.ptSize = new THREE.BufferAttribute(new Float32Array(N_PARTICLES), 1);
    this.ptPos.setUsage(THREE.DynamicDrawUsage);
    this.ptCol.setUsage(THREE.DynamicDrawUsage);
    this.ptGeo.setAttribute('position', this.ptPos);
    this.ptGeo.setAttribute('aColor', this.ptCol);
    this.ptGeo.setAttribute('aSize', this.ptSize);
    this.ptMat = new THREE.ShaderMaterial({
      vertexShader: PT_VERT, fragmentShader: PT_FRAG,
      uniforms: { uTex: { value: this.sprite } },
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.ptGeo, this.ptMat);
    this.points.frustumCulled = false;
    this.ptScene = new THREE.Scene();
    this.ptScene.add(this.points);

    // ---- final composite quad (lives in ctx.scene → app renders it) ----
    const vw = ctx.video?.videoWidth || 1280, vh = ctx.video?.videoHeight || 720;
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        uVideo: { value: ctx.videoTexture },
        uTrail: { value: this.trailA.texture },
        uBloom: { value: this.bloomA.texture },
        uResolution: { value: new THREE.Vector2(W, H) },
        uVideoSize: { value: new THREE.Vector2(vw, vh) },
        uMirror: { value: this.mirror ? 1.0 : 0.0 },
        uDim: { value: CAM_DIM },
        uDesat: { value: CAM_DESAT },
        uBloomGain: { value: BLOOM_GAIN },
      },
    });
    this.compGeo = new THREE.PlaneGeometry(W, H);
    this.comp = new THREE.Mesh(this.compGeo, this.compMat);
    this.comp.position.set(W / 2, H / 2, 0);
    this.comp.frustumCulled = false;
    ctx.scene.add(this.comp);

    for (let i = 0; i < N_PARTICLES; i++) this.respawn(i, W, H);
    // base sizes (slight variation), set once
    for (let i = 0; i < N_PARTICLES; i++) {
      this.ptSize.array[i] = SPRITE_PX * (0.7 + Math.random() * 0.9);
    }
    this.ptSize.needsUpdate = true;
  }

  respawn(i, W, H) {
    this.px[i] = Math.random() * W;
    this.py[i] = Math.random() * H;
    this.life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    this.seed[i] = Math.random();
  }

  frame(hands, _dt) {
    const list = [];
    for (const lms of hands) {
      if (!lms || lms.length < 21) continue;
      const c = palmCenter(lms);
      const [x, y] = this.toPx(c.x, c.y);
      list.push({ x, y, open: handOpenness(lms) });
    }
    this.hands = list;
  }

  update(dt) {
    super.update(dt);
    const d = Math.min(dt, 0.05);
    this.step(d);
    this.render();
  }

  step(dt) {
    const ctx = this.ctx; if (!ctx) return;
    const W = ctx.width, H = ctx.height;
    this.time += dt;
    const t = this.time, v = this._v, c = this._c;
    const pos = this.ptPos.array, col = this.ptCol.array;
    const hueDrift = t * 0.025;

    for (let i = 0; i < N_PARTICLES; i++) {
      fieldVelocity(this.px[i], this.py[i], t, v);
      // slight per-particle speed spread so they don't all ride one streamline
      const sscale = 0.8 + this.seed[i] * 0.45;
      let vx = v.x * FIELD_SPEED * sscale, vy = v.y * FIELD_SPEED * sscale;
      let boost = 0;

      for (let h = 0; h < this.hands.length; h++) {
        const hand = this.hands[h];
        const dx = this.px[i] - hand.x, dy = this.py[i] - hand.y;
        const r2 = dx * dx + dy * dy, r = Math.sqrt(r2) + 1e-3;
        const fall = Math.exp(-r2 / (2 * HAND_RADIUS * HAND_RADIUS));
        if (fall < 0.004) continue;
        const ux = dx / r, uy = dy / r;
        const radial = (hand.open * 2 - 1);     // open→push, fist→pull
        const swirl = 0.95 - 0.35 * hand.open;  // fist swirls harder
        vx += fall * HAND_SPEED * (swirl * -uy + radial * 0.8 * ux);
        vy += fall * HAND_SPEED * (swirl * ux + radial * 0.8 * uy);
        boost = Math.max(boost, fall);
      }

      let nx = this.px[i] + vx * dt, ny = this.py[i] + vy * dt;
      if (nx < 0) nx += W; else if (nx >= W) nx -= W;
      if (ny < 0) ny += H; else if (ny >= H) ny -= H;
      this.px[i] = nx; this.py[i] = ny;

      this.life[i] -= dt;
      if (this.life[i] <= 0) this.respawn(i, W, H);

      // colour: aurora gradient by flow direction; brighter when fast / near hands
      const ang = Math.atan2(vy, vx) / (Math.PI * 2);
      aurora((ang + this.seed[i] * 0.12 + hueDrift + 1) % 1, c);
      const speed = Math.hypot(vx, vy);
      const bright = (0.22 + Math.min(0.38, speed / 5800) + boost * 0.7);
      const o = i * 3;
      pos[o] = nx; pos[o + 1] = ny; pos[o + 2] = 0;
      col[o] = c.r * bright; col[o + 1] = c.g * bright; col[o + 2] = c.b * bright;
    }
    this.ptPos.needsUpdate = true;
    this.ptCol.needsUpdate = true;

    const hint = this.hands.length
      ? this.hands.map((h) => (h.open > 0.5 ? '✋' : '✊')).join(' ')
      : 'show your hands to steer';
    ctx.setHud(`FLOW · ${this.hands.length} hand(s) · ${hint}`);
  }

  blit(mat, target) {
    const r = this.ctx.renderer;
    this.fsQuad.material = mat;
    r.setRenderTarget(target);
    r.render(this.fsScene, this.fsCam);
  }

  render() {
    const ctx = this.ctx; if (!ctx) return;
    const r = ctx.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;

    // 1) fade previous trail (trailA) into trailB
    this.fadeMat.uniforms.uPrev.value = this.trailA.texture;
    this.blit(this.fadeMat, this.trailB);

    // 2) splat particles additively on top, into trailB
    r.autoClear = false;
    r.setRenderTarget(this.trailB);
    r.render(this.ptScene, this.camera);
    r.autoClear = prevAutoClear;

    // swap so trailA is always the latest accumulation
    const tmp = this.trailA; this.trailA = this.trailB; this.trailB = tmp;

    // 3) bloom: bright-pass → blur H → blur V (half-res)
    const bw = this.bloomA.width, bh = this.bloomA.height;
    this.brightMat.uniforms.uTex.value = this.trailA.texture;
    this.blit(this.brightMat, this.bloomA);
    this.blurMat.uniforms.uTex.value = this.bloomA.texture;
    this.blurMat.uniforms.uDir.value.set(1 / bw, 0);
    this.blit(this.blurMat, this.bloomB);
    this.blurMat.uniforms.uTex.value = this.bloomB.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1 / bh);
    this.blit(this.blurMat, this.bloomA);

    // 4) hand textures to the composite (rendered by the app afterwards)
    this.compMat.uniforms.uTrail.value = this.trailA.texture;
    this.compMat.uniforms.uBloom.value = this.bloomA.texture;
    if (ctx.video?.videoWidth) {
      this.compMat.uniforms.uVideoSize.value.set(ctx.video.videoWidth, ctx.video.videoHeight);
    }

    r.setRenderTarget(prevTarget);
  }

  resize(w, h) {
    super.resize(w, h);
    if (!this.trailA) return;
    const bw = Math.max(2, w >> 1), bh = Math.max(2, h >> 1);
    this.trailA.setSize(w, h); this.trailB.setSize(w, h);
    this.bloomA.setSize(bw, bh); this.bloomB.setSize(bw, bh);
    this.compMat.uniforms.uResolution.value.set(w, h);
    this.compGeo.dispose();
    this.compGeo = new THREE.PlaneGeometry(w, h);
    this.comp.geometry = this.compGeo;
    this.comp.position.set(w / 2, h / 2, 0);
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (scene && this.comp) scene.remove(this.comp);
    for (const rt of [this.trailA, this.trailB, this.bloomA, this.bloomB]) rt?.dispose();
    this.sprite?.dispose();
    this.ptGeo?.dispose();
    this.compGeo?.dispose();
    this.fsQuad?.geometry?.dispose();
    for (const m of [this.ptMat, this.fadeMat, this.brightMat, this.blurMat, this.compMat]) m?.dispose();
    this.trailA = this.trailB = this.bloomA = this.bloomB = null;
    this.points = this.comp = null;
  }
}

// ===========================================================================
// Preview painter — aurora ribbons swirling around two faint palms.
// ===========================================================================
function preview(c) {
  const W = 320, H = 320;
  const bg = c.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, 230);
  bg.addColorStop(0, '#0a1020'); bg.addColorStop(1, '#03040a');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);

  const centers = [{ x: 108, y: 150 }, { x: 214, y: 176 }];
  c.globalCompositeOperation = 'lighter';
  c.lineWidth = 2.0;
  for (let s = 0; s < 200; s++) {
    let x = (s * 53) % W, y = (s * 97) % H;
    const ctr = centers[s % 2];
    c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 16; k++) {
      const dx = x - ctr.x, dy = y - ctr.y, r = Math.hypot(dx, dy) + 1e-3;
      x += -dy / r * 7 + Math.cos(y * 0.03 + s) * 3;
      y += dx / r * 7 + Math.sin(x * 0.03 + s) * 3;
      c.lineTo(x, y);
    }
    const hue = (0.47 + 0.31 * (s / 200)) * 360;
    c.strokeStyle = `hsla(${hue},66%,60%,0.5)`;
    c.stroke();
  }
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = 'rgba(255,255,255,0.16)';
  for (const ctr of centers) { c.beginPath(); c.arc(ctr.x, ctr.y, 16, 0, Math.PI * 2); c.fill(); }
}

export default {
  id: 'Flow',
  title: 'FLOW',
  subtitle: 'CURL-FIELD INK · STEERED BY HAND',
  category: 'HAND',
  factory: () => new Flow(),
  preview,
};
