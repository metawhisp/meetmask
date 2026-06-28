import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ============================================================================
// LEAN IN — how close you lean to the camera continuously dials a morph. Arm's
// length = normal you; face filling the frame = full alien: eyes bulge, skin
// goes chrome, a cool grade + vignette swell. Rock toward / away to pump it on
// the beat. The control IS the distance — a live analog fader, not a trigger.
//
// Distance proxy = inter-eye pixel span (auto-calibrated min/max), smoothed.
// Full-screen shader paints the camera (wantsRawVideo=false) with portalPull's
// coverUv+mirror+Y-flip helper; engine mode is un-mirrored so §12 holds.
// ============================================================================

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVideo;
  uniform vec2  uResolution, uVideoSize, uEyeL, uEyeR;
  uniform float uMirror, uP, uEyeRad, uActive;

  vec2 coverUv(vec2 uv){
    float ca = uResolution.x / uResolution.y;
    float va = uVideoSize.x / uVideoSize.y;
    vec2 s = vec2(1.0);
    if (ca > va) s.y = va / ca; else s.x = ca / va;
    return (uv - 0.5) * s + 0.5;
  }
  vec3 vid(vec2 p){
    vec2 c = coverUv(vec2(p.x, 1.0 - p.y));
    if (uMirror > 0.5) c.x = 1.0 - c.x;
    return texture2D(uVideo, clamp(c, 0.001, 0.999)).rgb;
  }
  vec3 grade(vec3 c, float p){
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 chrome = vec3(l);
    chrome = mix(chrome, chrome * vec3(0.72, 0.95, 1.18), 0.7);     // cool tint
    chrome = clamp((chrome - 0.5) * 1.45 + 0.5, 0.0, 1.0);          // contrast
    chrome += pow(max(l, 0.0), 3.0) * 0.45;                          // metallic highlight
    return mix(c, chrome, p);
  }

  void main(){
    vec2 uv = vUv;
    float p = uP;
    // eye-bulge: pull samples toward each eye centre → magnify (only when leaning in)
    if (uActive > 0.5) {
      for (int i = 0; i < 2; i++) {
        vec2 e = i == 0 ? uEyeL : uEyeR;
        float d = length((uv - e) / vec2(uEyeRad));
        if (d < 1.4) {
          float k = (1.0 - smoothstep(0.0, 1.4, d)) * p * 0.55;
          uv = mix(uv, e + (uv - e) * (1.0 - k), 1.0);
        }
      }
    }
    vec3 col = vid(uv);
    col = grade(col, p);
    float vig = smoothstep(1.15, 0.45, length(vUv - 0.5));
    col *= mix(1.0, vig, p * 0.55);
    gl_FragColor = vec4(col, 1.0);
  }
`;

class LeanIn extends Tracker {
  constructor() {
    super({ kind: 'face', numFaces: 1 });
    this.wantsRawVideo = false;
    this.lastT = -1; this.lms = null;
    this.minD = null; this.maxD = null; this.p = 0;
  }

  async setup(ctx) {
    const vw = ctx.video?.videoWidth || 1280, vh = ctx.video?.videoHeight || 720;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        uVideo: { value: ctx.videoTexture },
        uResolution: { value: new THREE.Vector2(ctx.width, ctx.height) },
        uVideoSize: { value: new THREE.Vector2(vw, vh) },
        uMirror: { value: this.mirror ? 1 : 0 },
        uP: { value: 0 }, uActive: { value: 0 }, uEyeRad: { value: 0.08 },
        uEyeL: { value: new THREE.Vector2(0.5, 0.5) }, uEyeR: { value: new THREE.Vector2(0.5, 0.5) },
      },
    });
    this.geo = new THREE.PlaneGeometry(ctx.width, ctx.height);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.position.set(ctx.width / 2, ctx.height / 2, 0);
    this.mesh.frustumCulled = false;
    ctx.scene.add(this.mesh);
  }

  toVuv(lx, ly) { const [x, y] = this.toPx(lx, ly); return [x / this.ctx.width, y / this.ctx.height]; }

  update(dt) {
    const ctx = this.ctx; if (!ctx || !this.mat) return;
    if (ctx.video && ctx.video.readyState >= 2 && ctx.video.currentTime !== this.lastT) {
      this.lastT = ctx.video.currentTime;
      try { this.lms = this.landmarker.detectForVideo(ctx.video, performance.now())?.faceLandmarks?.[0] || null; } catch (_e) { /* keep */ }
    }
    this.step(Math.min(dt, 0.05));
  }

  step(dt) {
    const ctx = this.ctx, u = this.mat.uniforms;
    const lms = this.lms;
    if (lms && lms.length > 263) {
      const [lx, ly] = this.toPx(lms[33].x, lms[33].y);
      const [rx, ry] = this.toPx(lms[263].x, lms[263].y);
      const d = Math.hypot(rx - lx, ry - ly);
      // auto-calibrate the lean range; let the bounds drift so it re-centres
      if (this.minD == null) { this.minD = d; this.maxD = d * 1.35; }
      this.minD = Math.min(this.minD, d) + (d - this.minD) * 0.0008;
      this.maxD = Math.max(this.maxD, d) + (d - this.maxD) * 0.0008;
      const range = Math.max(1, this.maxD - this.minD);
      const target = Math.max(0, Math.min(1, (d - this.minD) / range));
      this.p += (target - this.p) * Math.min(1, dt * 6);           // smooth fader
      const [ex1, ey1] = this.toVuv(lms[468] ? lms[468].x : lms[33].x, lms[468] ? lms[468].y : lms[33].y);
      const [ex2, ey2] = this.toVuv(lms[473] ? lms[473].x : lms[263].x, lms[473] ? lms[473].y : lms[263].y);
      u.uEyeL.value.set(ex1, ey1); u.uEyeR.value.set(ex2, ey2);
      u.uEyeRad.value = Math.max(0.04, (d / ctx.width) * 0.85);
      u.uActive.value = 1;
    } else {
      this.p += (0 - this.p) * Math.min(1, dt * 4);
      u.uActive.value = 0;
    }
    u.uP.value = this.p;
    if (ctx.video?.videoWidth) u.uVideoSize.value.set(ctx.video.videoWidth, ctx.video.videoHeight);
    if (ctx) ctx.setHud(`LEAN IN · lean toward the camera to transform · ${Math.round(this.p * 100)}%`);
  }

  resize(w, h) {
    super.resize(w, h);
    if (this.mesh) {
      this.geo.dispose(); this.geo = new THREE.PlaneGeometry(w, h);
      this.mesh.geometry = this.geo; this.mesh.position.set(w / 2, h / 2, 0);
      this.mat.uniforms.uResolution.value.set(w, h);
    }
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (scene && this.mesh) scene.remove(this.mesh);
    this.geo?.dispose(); this.mat?.dispose(); this.mesh = null;
  }
}

function preview(c) {
  const W = 320, H = 320;
  // alien chrome face, leaned in
  c.fillStyle = '#0a0f14'; c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(160, 150, 30, 160, 150, 200);
  g.addColorStop(0, '#9fb6c8'); g.addColorStop(1, '#1a2530'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = '#c2d4e0'; c.beginPath(); c.ellipse(160, 165, 120, 150, 0, 0, Math.PI * 2); c.fill();
  // huge bulging eyes
  c.fillStyle = '#f4fbff'; c.beginPath(); c.arc(110, 150, 40, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(210, 150, 40, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#10202c'; c.beginPath(); c.arc(116, 154, 18, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(204, 154, 18, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(110, 147, 6, 0, Math.PI*2); c.fill(); c.beginPath(); c.arc(204, 147, 6, 0, Math.PI*2); c.fill();
  // mouth
  c.strokeStyle = '#33424d'; c.lineWidth = 7; c.beginPath(); c.moveTo(125, 240); c.lineTo(195, 240); c.stroke();
  c.fillStyle = '#7df9ff'; c.textAlign = 'left'; c.font = '800 22px ui-monospace, monospace'; c.fillText('LEAN IN ▸ 100%', 16, 28);
}

export default {
  id: 'LeanIn',
  title: 'LEAN IN',
  subtitle: 'LEAN TO THE CAMERA · MORPH ON THE BEAT',
  category: 'FACE',
  factory: () => new LeanIn(),
  preview,
};
