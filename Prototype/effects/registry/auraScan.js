import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// AURA SCAN — a horizontal scanline sweeps top→bottom in 3s. As it crosses
// the face it "reveals" the user's randomized aura color; the chosen mood
// word is dramatised at the top in matching neon. Resets each cycle.

const WORDS = [
  'ELECTRIC', 'CHAOTIC', 'LOVING', 'TIRED', 'HUNGRY', 'BLESSED',
  'CURSED', 'MYSTERIOUS', 'RADIANT', 'UNHINGED', 'ETHEREAL', 'FERAL',
  'DELULU', 'SERVING', 'MINT', 'ICONIC',
];

// A tight, vibey palette — every entry is high-saturation and reads on dark.
const PALETTE = [
  { name: 'cyan',     hex: 0x00f0ff, css: '#00f0ff' },
  { name: 'magenta',  hex: 0xff2bd6, css: '#ff2bd6' },
  { name: 'lime',     hex: 0x9bff3c, css: '#9bff3c' },
  { name: 'gold',     hex: 0xffd23a, css: '#ffd23a' },
  { name: 'pink',     hex: 0xff7ab8, css: '#ff7ab8' },
  { name: 'purple',   hex: 0xb461ff, css: '#b461ff' },
  { name: 'electric', hex: 0x3a7bff, css: '#3a7bff' },
];

// Closed loop of MediaPipe landmarks tracing the face oval. Triangulated as
// a fan from the centroid each frame so the mesh follows the face shape
// rather than being a generic bounding box.
const OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];

const CYCLE_S = 3.0;

// Aura shader: radial gradient from centroid (UV.x = normalised radius),
// bright at the edge, transparent at the centre. The crucial bit is the
// `discard` against uScanY in canvas-pixel space so the aura only "lights
// up" once the scan line has swept past that pixel.
const AURA_VERT = /* glsl */ `
  attribute float aRadius;        // 0 at centroid, 1 at oval edge
  varying float vRadius;
  varying vec2 vScreen;           // canvas px position
  void main() {
    vRadius = aRadius;
    vScreen = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const AURA_FRAG = /* glsl */ `
  precision highp float;
  varying float vRadius;
  varying vec2 vScreen;
  uniform vec3  uColor;
  uniform float uScanY;        // canvas px; everything BELOW this is revealed
  uniform float uPulse;        // 0..1 breathing factor
  uniform float uTime;
  void main() {
    // Hard cull above the scan line so the aura only shows where the beam
    // has already passed. Soft 24 px fade at the boundary so the reveal
    // doesn't pop as a flat edge.
    if (vScreen.y < uScanY - 24.0) discard;
    float revealMask = smoothstep(uScanY - 24.0, uScanY + 6.0, vScreen.y);

    // Radial falloff: bright halo at the silhouette edge, transparent core.
    // The face below stays visible through the centre — only the "aura"
    // around the silhouette lights up.
    float edge = smoothstep(0.35, 1.0, vRadius);
    float core = 1.0 - smoothstep(0.0, 0.55, vRadius);

    float pulse = 0.85 + 0.15 * sin(uTime * 5.0);
    float a = edge * (0.55 + 0.35 * uPulse) * pulse * revealMask;

    // Tiny extra halo lift near the silhouette outline.
    vec3 col = uColor * (0.9 + 0.6 * edge);
    col += uColor * core * 0.08;   // faint inner tint, not a fill
    gl_FragColor = vec4(col, a);
  }
`;

class AuraScan extends Tracker {
  constructor() {
    super({ kind: 'face' });
    this.elapsed = 0;
    this.cycleIdx = -1;
    this.word = WORDS[0];
    this.colorIdx = 0;
    this.lastWord = null;
    this.lastColor = null;
  }

  pickNewCycle() {
    // Avoid repeating immediately — feels random-er.
    let w = this.word, c = this.colorIdx;
    let attempts = 0;
    while ((w === this.lastWord || c === this.lastColor) && attempts++ < 6) {
      w = WORDS[(Math.random() * WORDS.length) | 0];
      c = (Math.random() * PALETTE.length) | 0;
    }
    this.lastWord = this.word = w;
    this.lastColor = this.colorIdx = c;
  }

  async setup(ctx) {
    // ---- Aura mesh: fan triangulation from centroid (vertex 0) out to the
    // oval loop. One reusable buffer; rewritten each frame from landmarks.
    const N = OVAL.length;                // edge verts
    const totalVerts = 1 + N;             // centroid + edge
    const positions = new Float32Array(totalVerts * 3);
    const radii = new Float32Array(totalVerts);   // 0 at centroid, 1 at edge
    radii[0] = 0;
    for (let i = 1; i < totalVerts; i++) radii[i] = 1;
    const indices = [];
    for (let i = 0; i < N; i++) {
      const a = 0;
      const b = 1 + i;
      const c = 1 + ((i + 1) % N);
      indices.push(a, b, c);
    }
    const auraGeo = new THREE.BufferGeometry();
    auraGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    auraGeo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    auraGeo.setIndex(indices);

    this.auraMat = new THREE.ShaderMaterial({
      vertexShader: AURA_VERT,
      fragmentShader: AURA_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor:  { value: new THREE.Color(PALETTE[0].hex) },
        uScanY:  { value: 0 },
        uPulse:  { value: 0 },
        uTime:   { value: 0 },
      },
    });
    this.aura = new THREE.Mesh(auraGeo, this.auraMat);
    this.aura.frustumCulled = false;
    this.aura.visible = false;
    ctx.scene.add(this.aura);

    // ---- Scan line: thin full-width plane with a soft halo plane behind it.
    this.scanLine = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scanLine.frustumCulled = false;
    ctx.scene.add(this.scanLine);

    this.scanHalo = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: PALETTE[0].hex,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scanHalo.frustumCulled = false;
    ctx.scene.add(this.scanHalo);

    // ---- Chromatic aberration trail: two faint plane copies (R + B ghosts)
    // sitting just above the main scan line.
    this.scanGhostR = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xff0040, transparent: true, opacity: 0.45,
        depthTest: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.scanGhostB = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x00b0ff, transparent: true, opacity: 0.45,
        depthTest: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.scanGhostR.frustumCulled = false;
    this.scanGhostB.frustumCulled = false;
    ctx.scene.add(this.scanGhostR);
    ctx.scene.add(this.scanGhostB);

    // ---- Mood word text plane (CanvasTexture, repainted on cycle change).
    this.textCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (this.textCanvas) {
      this.textCanvas.width = 1024;
      this.textCanvas.height = 320;
      this.textTexture = new THREE.CanvasTexture(this.textCanvas);
      this.textTexture.minFilter = THREE.LinearFilter;
      this.textTexture.magFilter = THREE.LinearFilter;
    } else {
      const data = new Uint8Array([255, 255, 255, 0]);
      this.textTexture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      this.textTexture.needsUpdate = true;
    }
    this.textMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.textTexture,
        transparent: true,
        depthTest: false,
      }),
    );
    this.textMesh.frustumCulled = false;
    ctx.scene.add(this.textMesh);

    // Layout the text plane: anchor it across the top of the canvas, sized
    // to the canvas aspect so a 1024×320 painted texture maps 1:1.
    const tw = Math.min(ctx.width * 0.92, 900);
    const th = tw * (320 / 1024);
    this.textMesh.scale.set(tw, th, 1);
    this.textMesh.position.set(ctx.width / 2, th / 2 + 24, 6);

    // Initial cycle pick + paint.
    this.pickNewCycle();
    this.paintText();
  }

  paintText() {
    const c = this.textCanvas;
    if (!c) return;
    const ctx2 = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx2.clearRect(0, 0, W, H);

    const col = PALETTE[this.colorIdx];

    // Subtitle "AURA:" — smaller, contrasting tone.
    ctx2.font = 'bold 42px ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif';
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'top';
    ctx2.fillStyle = 'rgba(255,255,255,0.85)';
    ctx2.shadowColor = col.css;
    ctx2.shadowBlur = 18;
    ctx2.fillText('AURA:', W / 2, 30);

    // The mood word — huge, bold, with outer glow + soft drop shadow.
    const word = this.word;
    let size = 150;
    ctx2.font = `900 ${size}px ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif`;
    // Auto-shrink to fit very long words like "MYSTERIOUS".
    let metrics = ctx2.measureText(word);
    const maxWidth = W - 80;
    if (metrics.width > maxWidth) {
      size = Math.floor(size * (maxWidth / metrics.width));
      ctx2.font = `900 ${size}px ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif`;
    }
    // Letter-spacing tracking (manual): paint each glyph spaced by +6 px.
    const tracking = 6;
    metrics = ctx2.measureText(word);
    const widths = [];
    let total = 0;
    for (const ch of word) {
      const w = ctx2.measureText(ch).width;
      widths.push(w);
      total += w;
    }
    total += tracking * (word.length - 1);
    let x = (W - total) / 2;
    const y = 100;

    // Two-pass: a wide outer glow first, then the crisp foreground glyphs.
    ctx2.shadowColor = col.css;
    ctx2.shadowBlur = 36;
    ctx2.fillStyle = col.css;
    let cx = x;
    for (let i = 0; i < word.length; i++) {
      ctx2.fillText(word[i], cx + widths[i] / 2, y);
      cx += widths[i] + tracking;
    }
    // Second pass — tighter blur, crisper.
    ctx2.shadowBlur = 10;
    cx = x;
    for (let i = 0; i < word.length; i++) {
      ctx2.fillText(word[i], cx + widths[i] / 2, y);
      cx += widths[i] + tracking;
    }
    ctx2.shadowBlur = 0;

    if (this.textTexture && this.textTexture.isCanvasTexture) {
      this.textTexture.needsUpdate = true;
    }
  }

  frame(faces, dt) {
    this.elapsed += dt;
    const ctx = this.ctx;
    const W = ctx.width, H = ctx.height;

    // Cycle bookkeeping — when the integer second-block changes, pick a new
    // word + color and repaint the text canvas.
    const cycle = Math.floor(this.elapsed / CYCLE_S);
    if (cycle !== this.cycleIdx) {
      this.cycleIdx = cycle;
      this.pickNewCycle();
      this.paintText();
      // Re-tint the halo + ghost trail to match the new aura color.
      this.scanHalo.material.color.setHex(PALETTE[this.colorIdx].hex);
      this.auraMat.uniforms.uColor.value.setHex(PALETTE[this.colorIdx].hex);
    }

    const progress = (this.elapsed % CYCLE_S) / CYCLE_S;   // 0 → 1
    const scanY = progress * H;
    const remaining = Math.max(0, CYCLE_S - (this.elapsed % CYCLE_S));

    // Aura color pulse — slow breathe; passes into shader as uPulse.
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 2.2);
    this.auraMat.uniforms.uTime.value = this.elapsed;
    this.auraMat.uniforms.uPulse.value = pulse;
    this.auraMat.uniforms.uScanY.value = scanY;

    // ---- Scan line geometry: thin bright bar at scanY, halo behind, ghosts.
    const lineH = 6;
    this.scanLine.position.set(W / 2, scanY, 7);
    this.scanLine.scale.set(W, lineH, 1);
    this.scanHalo.position.set(W / 2, scanY, 6.9);
    this.scanHalo.scale.set(W, lineH * 6, 1);

    // Chromatic aberration: R offset down ~5 px, B offset up ~5 px.
    this.scanGhostR.position.set(W / 2, scanY + 5, 6.8);
    this.scanGhostR.scale.set(W, lineH * 0.8, 1);
    this.scanGhostB.position.set(W / 2, scanY - 5, 6.8);
    this.scanGhostB.scale.set(W, lineH * 0.8, 1);

    // ---- Aura mesh: rebuild fan from current face landmarks.
    if (faces.length) {
      const lms = faces[0];
      const posAttr = this.aura.geometry.attributes.position;
      const positions = posAttr.array;

      // Average all oval landmarks → centroid in canvas px (the fan apex).
      let cx = 0, cy = 0;
      const edgePx = [];
      for (const idx of OVAL) {
        const lm = lms[idx];
        if (!lm) { edgePx.push([0, 0]); continue; }
        const [px, py] = this.toPx(lm.x, lm.y);
        edgePx.push([px, py]);
        cx += px; cy += py;
      }
      cx /= OVAL.length; cy /= OVAL.length;

      positions[0] = cx; positions[1] = cy; positions[2] = 0;
      for (let i = 0; i < edgePx.length; i++) {
        // Push each edge vertex outward ~12% so the aura halos slightly
        // beyond the silhouette rather than ending right at it.
        const dx = edgePx[i][0] - cx;
        const dy = edgePx[i][1] - cy;
        const expand = 1.18;
        positions[(1 + i) * 3 + 0] = cx + dx * expand;
        positions[(1 + i) * 3 + 1] = cy + dy * expand;
        positions[(1 + i) * 3 + 2] = 0;
      }
      posAttr.needsUpdate = true;
      this.aura.visible = true;
    } else {
      this.aura.visible = false;
    }

    ctx.setHud(`AURA SCAN · ${this.word} · next in ${remaining.toFixed(1)}s`);
  }

  teardown() {
    const dispose = (m) => {
      if (!m) return;
      this.ctx.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (m.material.map && m.material.map.dispose) m.material.map.dispose();
        m.material.dispose();
      }
    };
    dispose(this.aura);
    dispose(this.scanLine);
    dispose(this.scanHalo);
    dispose(this.scanGhostR);
    dispose(this.scanGhostB);
    dispose(this.textMesh);
    this.aura = this.scanLine = this.scanHalo = null;
    this.scanGhostR = this.scanGhostB = this.textMesh = null;
    this.auraMat = null;
    this.textTexture = null;
    this.textCanvas = null;
  }
}

function preview(c) {
  const W = 320, H = 320;
  // Dark, slightly blue background.
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#070912');
  bg.addColorStop(1, '#10121f');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  // Face silhouette below the scan line.
  const cx = W / 2, cy = H * 0.62;
  const rx = 70, ry = 88;
  // Soft magenta aura behind the head.
  c.globalCompositeOperation = 'lighter';
  const aura = c.createRadialGradient(cx, cy, 30, cx, cy, 130);
  aura.addColorStop(0.0, 'rgba(255,43,214,0)');
  aura.addColorStop(0.55, 'rgba(255,43,214,0.55)');
  aura.addColorStop(1.0, 'rgba(255,43,214,0)');
  c.fillStyle = aura;
  c.beginPath();
  c.ellipse(cx, cy, 120, 130, 0, 0, Math.PI * 2);
  c.fill();
  c.globalCompositeOperation = 'source-over';

  // Face outline (just a darker oval — like a head silhouette in shadow).
  c.fillStyle = 'rgba(30,32,50,0.85)';
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  c.fill();

  // Scan line halfway down.
  const scanY = H * 0.55;
  c.globalCompositeOperation = 'lighter';
  const halo = c.createLinearGradient(0, scanY - 18, 0, scanY + 18);
  halo.addColorStop(0, 'rgba(0,240,255,0)');
  halo.addColorStop(0.5, 'rgba(0,240,255,0.55)');
  halo.addColorStop(1, 'rgba(0,240,255,0)');
  c.fillStyle = halo;
  c.fillRect(0, scanY - 18, W, 36);
  // The crisp white-cyan line itself.
  c.fillStyle = 'rgba(220,255,255,0.95)';
  c.fillRect(0, scanY - 1.5, W, 3);
  // Chromatic ghosts.
  c.fillStyle = 'rgba(255,0,64,0.5)';
  c.fillRect(0, scanY + 5, W, 1.5);
  c.fillStyle = 'rgba(0,176,255,0.5)';
  c.fillRect(0, scanY - 5, W, 1.5);
  c.globalCompositeOperation = 'source-over';

  // Subtitle and the dramatic word at the top.
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.font = 'bold 18px ui-sans-serif, -apple-system, Helvetica, Arial, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.shadowColor = '#ff2bd6';
  c.shadowBlur = 8;
  c.fillText('AURA:', W / 2, 18);
  c.font = '900 46px ui-sans-serif, -apple-system, Helvetica, Arial, sans-serif';
  c.fillStyle = '#ff2bd6';
  c.shadowBlur = 16;
  c.fillText('CHAOTIC', W / 2, 44);
  c.shadowBlur = 0;
}

export default {
  id: 'AuraScan',
  title: 'AURA SCAN',
  subtitle: 'REVEALS YOUR MOOD',
  category: 'FACE',
  preview,
  factory: () => new AuraScan(),
};
