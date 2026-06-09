import * as THREE from 'three';
import { VERT } from '../core/shaderLib.js';

// ASCII renders the camera as a grid of glyphs whose density tracks the
// underlying luminance. The glyph table is rendered into a single texture
// at init time and sampled by the fragment shader.

const GLYPHS = '@%#*+=-:. ';
const CELL_PX = 10;
const ATLAS_CELL = 32;

function buildGlyphAtlas() {
  const n = GLYPHS.length;
  const cnv = document.createElement('canvas');
  cnv.width = ATLAS_CELL * n;
  cnv.height = ATLAS_CELL;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.floor(ATLAS_CELL * 0.85)}px ui-monospace, Menlo, Monaco, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    ctx.fillText(GLYPHS[i], i * ATLAS_CELL + ATLAS_CELL / 2, ATLAS_CELL / 2 + 1);
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVideo;
  uniform sampler2D uAtlas;
  uniform vec2 uResolution;
  uniform vec2 uVideoSize;
  uniform float uCellPx;
  uniform float uGlyphCount;
  uniform float uMirror;
  uniform float uTime;
  uniform vec3  uTint;

  vec2 coverUv(vec2 uv) {
    float ca = uResolution.x / uResolution.y;
    float va = uVideoSize.x / uVideoSize.y;
    vec2 s = vec2(1.0);
    if (ca > va) s.y = va / ca; else s.x = ca / va;
    return (uv - 0.5) * s + 0.5;
  }

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec2 pix = vUv * uResolution;
    vec2 cell = floor(pix / uCellPx);
    vec2 cellOrigin = cell * uCellPx;
    vec2 cellCenter = (cellOrigin + uCellPx * 0.5) / uResolution;
    // Real-camera VideoTexture is already Y-flipped on upload — sample at
    // vUv directly. (canvas.captureStream sources will be upside-down here.)
    vec2 s = coverUv(cellCenter);
    if (uMirror > 0.5) s.x = 1.0 - s.x;
    vec3 vCol = texture2D(uVideo, clamp(s, 0.001, 0.999)).rgb;
    float L = luma(vCol);
    float idx = floor((1.0 - L) * (uGlyphCount - 0.001));

    vec2 local = (pix - cellOrigin) / uCellPx;
    vec2 atlasUv;
    atlasUv.x = (idx + local.x) / uGlyphCount;
    atlasUv.y = 1.0 - local.y;
    float g = texture2D(uAtlas, atlasUv).r;

    float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + cell.x * 0.07 + cell.y * 0.09);
    vec3 fg = uTint * pulse;
    fg = mix(fg, vCol * 1.4, 0.15);
    gl_FragColor = vec4(fg * g, 1.0);
  }
`;

class AsciiCamEffect {
  async init(ctx) {
    this.ctx = ctx;
    this.atlas = buildGlyphAtlas();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uVideo:      { value: ctx.videoTexture },
        uAtlas:      { value: this.atlas },
        uResolution: { value: new THREE.Vector2(ctx.width, ctx.height) },
        uVideoSize:  { value: new THREE.Vector2(ctx.video.videoWidth || 1280, ctx.video.videoHeight || 720) },
        uCellPx:     { value: CELL_PX },
        uGlyphCount: { value: GLYPHS.length },
        uMirror:     { value: ctx.facing === 'user' ? 1.0 : 0.0 },
        uTime:       { value: 0 },
        uTint:       { value: new THREE.Color(0.45, 1.0, 0.55) },
      },
      depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    ctx.scene.add(this.mesh);
    this.time = 0;
    ctx.setHud('ASCII — green glyphs from luminance');
  }
  update(dt) {
    if (!this.material) return;
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    const vw = this.ctx.video.videoWidth, vh = this.ctx.video.videoHeight;
    if (vw && vh) u.uVideoSize.value.set(vw, vh);
  }
  resize(w, h) { if (this.material) this.material.uniforms.uResolution.value.set(w, h); }
  dispose() {
    if (this.mesh) { this.mesh.geometry.dispose(); this.ctx.scene.remove(this.mesh); }
    if (this.material) this.material.dispose();
    if (this.atlas) this.atlas.dispose();
    this.mesh = this.material = this.atlas = null;
  }
}

export default {
  id: 'AsciiCam',
  title: 'ASCII',
  subtitle: 'CAMERA → GLYPHS',
  category: 'PURE',
  preview: 'ascii',
  factory: () => new AsciiCamEffect(),
};
