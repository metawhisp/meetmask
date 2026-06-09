import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// Tear interior shader. Vertical "Matrix" rain — each column picks its own
// speed via a cheap hash, glyphs are emulated by a stepped fract pattern,
// and the head of each stream gets a brighter white-green flare. Edges fade
// to transparent so the plane never looks rectangular.
const TEAR_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TEAR_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uOpen;   // 0 closed → 1 wide
  uniform float uJit;    // jitter amount (0..1)

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    // Horizontal distance from spine of the tear (0=center, 1=edge)
    float d = abs(vUv.x - 0.5) * 2.0;

    // Per-row jitter — makes the tear feel like a torn ragged slit
    float row = floor(vUv.y * 120.0);
    float jitter = (hash(vec2(row, 1.7)) - 0.5) * uJit * 0.08;
    d = clamp(d + jitter, 0.0, 1.0);

    // Falling-code rain
    float cols = 28.0;
    float col = floor(vUv.x * cols);
    float colSeed = hash(vec2(col, 0.0));
    float speed = 1.5 + colSeed * 2.5;
    float offset = colSeed * 10.0;
    float y = mod(vUv.y * 10.0 + uTime * speed + offset, 12.0);
    float charPattern = step(0.55, fract(y * 3.0 + hash(vec2(col, floor(y * 3.0)))));

    // Brightness fades down each stream — head is the brightest pixel
    float headBoost = smoothstep(11.7, 12.0, y) * 1.6;
    float bodyFall = 1.0 - clamp((12.0 - y) / 12.0, 0.0, 1.0);
    float bright = charPattern * (0.55 + 0.45 * bodyFall) + headBoost;

    // Neon green code on near-black inside the tear
    vec3 code = vec3(0.05, 1.0, 0.45) * bright;
    code += vec3(0.0, 1.0, 0.7) * headBoost * 0.6; // cyan tint at heads
    vec3 inside = code + vec3(0.02, 0.05, 0.04);

    // Magenta/cyan edge band — bloom-y ring near d≈0.85
    float edgeBand = smoothstep(0.75, 0.88, d) * (1.0 - smoothstep(0.92, 1.0, d));
    vec3 edgeCol = mix(vec3(1.0, 0.15, 0.85), vec3(0.25, 0.95, 1.0),
                       0.5 + 0.5 * sin(uTime * 3.0 + vUv.y * 22.0));
    inside += edgeCol * edgeBand * 1.6;

    // Outer falloff — disappears past d≈0.98 so we have a non-rectangular slit
    float alpha = (1.0 - smoothstep(0.85, 1.0, d));

    // The tear breathes open: when uOpen is small everything gets dimmer
    alpha *= mix(0.0, 1.0, smoothstep(0.02, 0.35, uOpen));
    inside *= mix(0.6, 1.15, uOpen);

    // Faint vertical spine glow
    float spine = exp(-pow(d * 6.0, 2.0)) * 0.35;
    inside += vec3(1.0, 0.4, 0.95) * spine;

    gl_FragColor = vec4(inside, alpha);
  }
`;

// Edge halo shader — bright magenta/cyan vertical pulse drawn on a slim
// plane along each side of the tear. Uses additive blending for bloom.
const HALO_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uOpen;
  void main() {
    float d = abs(vUv.x - 0.5) * 2.0;
    float core = exp(-pow(d * 3.0, 2.0));
    float pulse = 0.7 + 0.3 * sin(uTime * 5.0 + vUv.y * 18.0);
    vec3 c = mix(vec3(1.0, 0.2, 0.9), vec3(0.4, 1.0, 1.0),
                 0.5 + 0.5 * sin(uTime * 2.0 + vUv.y * 8.0));
    float a = core * pulse * smoothstep(0.0, 0.2, uOpen);
    gl_FragColor = vec4(c * 1.4, a);
  }
`;

function palmCenter(lms, toPx) {
  // Avg of wrist (0) + four base knuckles (5,9,13,17)
  const idx = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  for (const i of idx) {
    const [px, py] = toPx(lms[i].x, lms[i].y);
    x += px; y += py;
  }
  return [x / idx.length, y / idx.length];
}

class RealityTear extends Tracker {
  constructor() {
    super({ kind: 'hand', numHands: 2 });
    this.currentWidth = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.time = 0;
    this.jitter = 0;
  }

  async setup(ctx) {
    const tearMat = new THREE.ShaderMaterial({
      vertexShader: TEAR_VERT,
      fragmentShader: TEAR_FRAG,
      transparent: true,
      depthTest: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpen: { value: 0 },
        uJit:  { value: 0 },
      },
    });
    const tearGeo = new THREE.PlaneGeometry(1, 1);
    this.tear = new THREE.Mesh(tearGeo, tearMat);
    this.tear.frustumCulled = false;
    this.tear.position.set(ctx.width / 2, ctx.height / 2, 4);
    ctx.scene.add(this.tear);
    this.tearMat = tearMat;

    // Two halo planes — one for left edge, one for right
    const haloMat = () => new THREE.ShaderMaterial({
      vertexShader: TEAR_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpen: { value: 0 },
      },
    });
    this.haloL = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), haloMat());
    this.haloR = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), haloMat());
    this.haloL.frustumCulled = false;
    this.haloR.frustumCulled = false;
    ctx.scene.add(this.haloL);
    ctx.scene.add(this.haloR);

    this.currentX = ctx.width / 2;
    this.currentY = ctx.height / 2;
  }

  frame(hands, dt) {
    const { ctx } = this;
    this.time += dt;
    const W = ctx.width, H = ctx.height;
    const tearHeight = H * 0.9;

    let targetWidth = 0;
    let targetX = this.currentX;
    let targetY = this.currentY;
    let distance = 0;
    let opening = false;

    if (hands.length >= 2) {
      const p1 = palmCenter(hands[0], this.toPx.bind(this));
      const p2 = palmCenter(hands[1], this.toPx.bind(this));
      const mx = (p1[0] + p2[0]) / 2;
      const my = (p1[1] + p2[1]) / 2;
      distance = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
      targetX = mx; targetY = my;
      if (distance < 80) {
        targetWidth = 0; // snap close when hands touch
      } else {
        targetWidth = Math.max(60, Math.min(W - 100, distance * 0.7));
        opening = true;
      }
    } else if (hands.length === 1) {
      targetWidth = 0;
      const p = palmCenter(hands[0], this.toPx.bind(this));
      targetX = p[0]; targetY = p[1];
    } else {
      targetWidth = 0;
    }

    // Smoothly interpolate. Opening is snappy ("rip"), closing is ease-out.
    const openSpeed = 18;
    const closeSpeed = 6;
    const k = targetWidth > this.currentWidth ? openSpeed : closeSpeed;
    const t = 1 - Math.exp(-k * dt);
    this.currentWidth += (targetWidth - this.currentWidth) * t;
    this.currentX += (targetX - this.currentX) * (1 - Math.exp(-10 * dt));
    this.currentY += (targetY - this.currentY) * (1 - Math.exp(-10 * dt));

    // Edge jitter — always-on subtle shake, ramps up when actively opening
    const baseJit = 0.25;
    const ripJit = opening && targetWidth > this.currentWidth + 4 ? 1.0 : 0.0;
    this.jitter += (baseJit + ripJit - this.jitter) * (1 - Math.exp(-8 * dt));

    const w = Math.max(1, this.currentWidth);
    const openNorm = Math.min(1, w / Math.max(80, W * 0.3));

    // A small horizontal wobble while ripping makes it feel alive
    const wobble = (Math.sin(this.time * 27.0) + Math.sin(this.time * 41.0)) * 0.5;
    const xJit = wobble * (1.5 + ripJit * 4.0);

    this.tear.position.set(this.currentX + xJit, this.currentY, 4);
    this.tear.scale.set(w, tearHeight, 1);
    this.tearMat.uniforms.uTime.value = this.time;
    this.tearMat.uniforms.uOpen.value = openNorm;
    this.tearMat.uniforms.uJit.value = this.jitter;

    // Position halos as 2 narrow bars on either side of the tear
    const haloW = Math.max(20, w * 0.18);
    const halfW = w / 2;
    this.haloL.position.set(this.currentX - halfW + xJit, this.currentY, 5);
    this.haloR.position.set(this.currentX + halfW + xJit, this.currentY, 5);
    this.haloL.scale.set(haloW, tearHeight, 1);
    this.haloR.scale.set(haloW, tearHeight, 1);
    this.haloL.material.uniforms.uTime.value = this.time;
    this.haloR.material.uniforms.uTime.value = this.time;
    this.haloL.material.uniforms.uOpen.value = openNorm;
    this.haloR.material.uniforms.uOpen.value = openNorm;

    // Hide halos when fully closed so they don't leave a dot
    const visible = openNorm > 0.02;
    this.tear.visible = visible;
    this.haloL.visible = visible;
    this.haloR.visible = visible;

    ctx.setHud(`REALITY TEAR · spread your hands · ${distance.toFixed(0)} px`);
  }

  teardown() {
    const dispose = (m) => {
      if (!m) return;
      m.geometry.dispose();
      m.material.dispose();
      this.ctx.scene.remove(m);
    };
    dispose(this.tear);
    dispose(this.haloL);
    dispose(this.haloR);
    this.tear = this.haloL = this.haloR = null;
  }
}

export default {
  id: 'RealityTear',
  title: 'REALITY TEAR',
  subtitle: 'SPREAD HANDS TO RIP DIMENSIONS',
  category: 'HAND',
  factory: () => new RealityTear(),
  preview: (ctx) => {
    const W = 320, H = 320;
    // Dark void background with subtle vignette
    const bg = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, 220);
    bg.addColorStop(0, '#0a0014');
    bg.addColorStop(1, '#000');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // The tear body — vertical lens shape, magenta-edged with green code inside
    const cx = W / 2;
    const tearW = 110;
    const tearH = 280;

    // Clip to a tear-shape (ellipse-ish, narrower at top/bottom)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const y = (H - tearH) / 2 + t * tearH;
      // taper: thicker in middle
      const taper = Math.sin(t * Math.PI);
      const w = (tearW / 2) * (0.4 + 0.6 * taper);
      const x = cx + w;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = 40; i >= 0; i--) {
      const t = i / 40;
      const y = (H - tearH) / 2 + t * tearH;
      const taper = Math.sin(t * Math.PI);
      const w = (tearW / 2) * (0.4 + 0.6 * taper);
      ctx.lineTo(cx - w, y);
    }
    ctx.closePath();
    ctx.clip();

    // Interior — near-black backdrop
    ctx.fillStyle = '#020806';
    ctx.fillRect(0, 0, W, H);

    // Falling green code streaks
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    const cols = 7;
    for (let c = 0; c < cols; c++) {
      const x = cx - tearW / 2 + (c + 0.5) * (tearW / cols);
      const rows = 22;
      const off = ((c * 53) % 100) / 100;
      for (let r = 0; r < rows; r++) {
        const yPos = (H - tearH) / 2 + ((r / rows + off) % 1) * tearH;
        const headT = r / rows;
        const isHead = r === rows - 1;
        const alpha = isHead ? 1.0 : 0.25 + headT * 0.55;
        ctx.fillStyle = isHead
          ? `rgba(200,255,220,${alpha})`
          : `rgba(40,255,120,${alpha})`;
        const glyph = Math.random() < 0.5 ? '1' : '0';
        ctx.fillText(glyph, x - 4, yPos);
      }
    }
    ctx.restore();

    // Magenta edge glow on both sides of the tear (outside the clip)
    for (let side = -1; side <= 1; side += 2) {
      const g = ctx.createLinearGradient(cx + side * tearW / 2 - 16, 0,
                                          cx + side * tearW / 2 + 16, 0);
      const c0 = side === -1 ? 'rgba(255,40,200,0)' : 'rgba(255,40,200,0.85)';
      const c1 = side === -1 ? 'rgba(255,40,200,0.85)' : 'rgba(255,40,200,0)';
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.fillRect(cx + side * tearW / 2 - 16, (H - tearH) / 2, 32, tearH);
    }

    // Cyan spine highlight
    const spine = ctx.createLinearGradient(cx - 4, 0, cx + 4, 0);
    spine.addColorStop(0, 'rgba(120,255,255,0)');
    spine.addColorStop(0.5, 'rgba(180,255,255,0.55)');
    spine.addColorStop(1, 'rgba(120,255,255,0)');
    ctx.fillStyle = spine;
    ctx.fillRect(cx - 4, (H - tearH) / 2 + 10, 8, tearH - 20);

    // Outer bloom — soft magenta haze around the tear
    const bloom = ctx.createRadialGradient(cx, H / 2, 30, cx, H / 2, 130);
    bloom.addColorStop(0, 'rgba(255,80,220,0.35)');
    bloom.addColorStop(1, 'rgba(255,80,220,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  },
};
