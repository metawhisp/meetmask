import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';
import { loadHandLandmarker } from '../core/mpLoader.js';

// ============================================================================
// FACE OFF — pinch a facial feature (eye / nose / mouth) with your hand and
// drag it off your face. Where it was, the skin goes blank; the feature floats
// wherever you drop it (and you can drag it back to re-attach).
//
// How it works: a full-screen fragment shader paints the camera, then for each
// displaced feature it (1) fills the original spot with nearby skin colour, and
// (2) re-samples that feature's pixels at the dragged position. A hand is the
// cursor: pinch (thumb+index) near a feature to grab it; release to drop it.
//
// Two models run per frame (FaceLandmarker for the features + HandLandmarker
// for the grab) — the catAttack/sandbox precedent. We paint the video
// ourselves (wantsRawVideo=false); orientation follows portalPull's
// coverUv+mirror helper and is verified with ?fake=1. §12: engine mode is
// un-mirrored, so the captured frame stays raw.
// ============================================================================

const PINCH_RATIO = 0.55;   // dist(thumb,index)/handSize below this = pinch
const GRAB_R = 0.075;       // vUv radius to grab / re-attach a feature
const MERGE_EPS = 0.045;    // closer than this to home → snaps back on
const N = 4;                // left eye, right eye, nose, mouth

// Each feature: center landmark(s), width pair, height pair, and a nearby
// skin-source landmark used to fill its hole. MediaPipe FaceMesh 478 indices
// (468/473 = iris centers).
const FEATURES = [
  { name: 'L eye', c: [468],   w: [33, 133],  h: [159, 145], skin: 50,  sx: 1.35, sy: 1.7 },
  { name: 'R eye', c: [473],   w: [263, 362], h: [386, 374], skin: 280, sx: 1.35, sy: 1.7 },
  { name: 'nose',  c: [1],     w: [98, 327],  h: [168, 2],   skin: 50,  sx: 1.15, sy: 0.95 },
  { name: 'mouth', c: [13, 14], w: [61, 291], h: [0, 17],    skin: 152, sx: 1.15, sy: 1.5 },
];

const PALM = [0, 5, 9, 13, 17];

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVideo;
  uniform vec2  uResolution, uVideoSize;
  uniform float uMirror;
  uniform vec2  uOrig[${N}];
  uniform vec2  uPos[${N}];
  uniform vec2  uRad[${N}];
  uniform vec2  uSkin[${N}];
  uniform float uActive[${N}];

  vec2 coverUv(vec2 uv){
    float ca = uResolution.x / uResolution.y;
    float va = uVideoSize.x / uVideoSize.y;
    vec2 s = vec2(1.0);
    if (ca > va) s.y = va / ca; else s.x = ca / va;
    return (uv - 0.5) * s + 0.5;
  }
  // sample the camera at a vUv-space point (y-flip + cover + mirror), like portalPull
  vec3 vid(vec2 p){
    vec2 c = coverUv(vec2(p.x, 1.0 - p.y));
    if (uMirror > 0.5) c.x = 1.0 - c.x;
    return texture2D(uVideo, clamp(c, 0.001, 0.999)).rgb;
  }
  float em(vec2 p, vec2 c, vec2 r){ return length((p - c) / r); }

  void main(){
    vec3 col = vid(vUv);
    // 1) blank skin over the original spot of any displaced feature
    for (int i = 0; i < ${N}; i++){
      if (uActive[i] < 0.5) continue;
      float disp = length(uPos[i] - uOrig[i]);
      if (disp < 0.02) continue;
      float d = em(vUv, uOrig[i], uRad[i] * 1.08);
      float hole = (1.0 - smoothstep(0.72, 1.04, d)) * smoothstep(0.03, 0.07, disp);
      col = mix(col, vid(uSkin[i]), hole);
    }
    // 2) draw the feature itself at the dragged position
    for (int i = 0; i < ${N}; i++){
      if (uActive[i] < 0.5) continue;
      float disp = length(uPos[i] - uOrig[i]);
      if (disp < 0.02) continue;
      float d = em(vUv, uPos[i], uRad[i]);
      float m = 1.0 - smoothstep(0.82, 1.0, d);
      if (m <= 0.001) continue;
      col = mix(col, vid(vUv - uPos[i] + uOrig[i]), m);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

class FaceOff extends Tracker {
  constructor() {
    super({ kind: 'face', numFaces: 1 });
    this.wantsRawVideo = false;
    this.handLm = null;
    this.faceLms = null;
    this.handsRaw = [];
    this.lastT = -1;
    // per-feature runtime state (vUv space)
    this.f = FEATURES.map(() => ({ orig: { x: 0.5, y: 0.5 }, pos: { x: 0.5, y: 0.5 }, rad: { x: 0.05, y: 0.05 }, skin: { x: 0.5, y: 0.5 }, active: 0, held: -1, displaced: false }));
  }

  async setup(ctx) {
    this.handLm = await loadHandLandmarker({ numHands: 2 });
    const vw = ctx.video?.videoWidth || 1280, vh = ctx.video?.videoHeight || 720;
    const mk = () => Array.from({ length: N }, () => new THREE.Vector2(0.5, 0.5));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        uVideo: { value: ctx.videoTexture },
        uResolution: { value: new THREE.Vector2(ctx.width, ctx.height) },
        uVideoSize: { value: new THREE.Vector2(vw, vh) },
        uMirror: { value: this.mirror ? 1 : 0 },
        uOrig: { value: mk() }, uPos: { value: mk() }, uRad: { value: mk() },
        uSkin: { value: mk() }, uActive: { value: new Array(N).fill(0) },
      },
    });
    this.geo = new THREE.PlaneGeometry(ctx.width, ctx.height);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.position.set(ctx.width / 2, ctx.height / 2, 0);
    this.mesh.frustumCulled = false;
    ctx.scene.add(this.mesh);
  }

  // The full-screen plane (Tracker Y-down ortho) has vUv.y growing DOWN-screen,
  // so a feature seen at screen (px) sits at plane-uv (px.x/W, px.y/H).
  toVuv(lx, ly) {
    const [x, y] = this.toPx(lx, ly);
    return { x: x / this.ctx.width, y: y / this.ctx.height };
  }

  update(dt) {
    const ctx = this.ctx;
    if (!ctx || !ctx.video || ctx.video.readyState < 2) { this.step(dt); return; }
    if (ctx.video.currentTime !== this.lastT) {
      this.lastT = ctx.video.currentTime;
      const ts = performance.now();
      try { this.faceLms = this.landmarker.detectForVideo(ctx.video, ts)?.faceLandmarks?.[0] || null; } catch (_e) { /* keep */ }
      try { this.handsRaw = this.handLm.detectForVideo(ctx.video, ts + 1)?.landmarks || []; } catch (_e) { /* keep */ }
    }
    this.step(dt);
  }

  step(_dt) {
    const ctx = this.ctx; if (!ctx || !this.mat) return;
    const lms = this.faceLms;

    // ---- update each feature's live face anchor (orig), radius, skin source ----
    for (let i = 0; i < N; i++) {
      const F = FEATURES[i], s = this.f[i];
      if (lms && lms.length > 473) {
        // center
        let cx = 0, cy = 0;
        for (const idx of F.c) { cx += lms[idx].x; cy += lms[idx].y; }
        const cuv = this.toVuv(cx / F.c.length, cy / F.c.length);
        const a = this.toVuv(lms[F.w[0]].x, lms[F.w[0]].y), b = this.toVuv(lms[F.w[1]].x, lms[F.w[1]].y);
        const c2 = this.toVuv(lms[F.h[0]].x, lms[F.h[0]].y), d2 = this.toVuv(lms[F.h[1]].x, lms[F.h[1]].y);
        s.orig = cuv;
        s.rad = { x: Math.max(0.02, Math.abs(a.x - b.x) * 0.5 * F.sx), y: Math.max(0.02, Math.abs(c2.y - d2.y) * 0.5 * F.sy + 0.012) };
        s.skin = this.toVuv(lms[F.skin].x, lms[F.skin].y);
        s.active = 1;
      } else {
        s.active = 0; s.held = -1; s.displaced = false;
      }
    }

    // ---- hand cursors (pinch) ----
    const cursors = [];
    for (let h = 0; h < this.handsRaw.length && h < 2; h++) {
      const hl = this.handsRaw[h]; if (!hl || hl.length < 21) continue;
      const handSize = Math.hypot(hl[0].x - hl[9].x, hl[0].y - hl[9].y) || 1e-3;
      const pinchD = Math.hypot(hl[4].x - hl[8].x, hl[4].y - hl[8].y) / handSize;
      const mid = this.toVuv((hl[4].x + hl[8].x) / 2, (hl[4].y + hl[8].y) / 2);
      cursors.push({ x: mid.x, y: mid.y, pinch: pinchD < PINCH_RATIO, claimed: false });
    }

    // ---- keep held features attached to their pinching hand ----
    for (let i = 0; i < N; i++) {
      const s = this.f[i]; if (!s.active || s.held < 0) continue;
      let best = null, bd = GRAB_R * 2.2;
      for (const c of cursors) { if (!c.pinch || c.claimed) continue; const d = dist(c, s.pos); if (d < bd) { bd = d; best = c; } }
      if (best) { s.pos = { x: best.x, y: best.y }; best.claimed = true; s.held = 1; s.displaced = true; }
      else { s.held = -1; s.displaced = dist(s.pos, s.orig) > MERGE_EPS; }
    }

    // ---- grab a new feature with a free pinching cursor ----
    for (const c of cursors) {
      if (!c.pinch || c.claimed) continue;
      let best = -1, bd = GRAB_R;
      for (let i = 0; i < N; i++) { const s = this.f[i]; if (!s.active || s.held >= 0) continue; if (dist(c, s.pos) < bd) { bd = dist(c, s.pos); best = i; } }
      if (best >= 0) { this.f[best].held = 1; this.f[best].pos = { x: c.x, y: c.y }; this.f[best].displaced = true; c.claimed = true; }
    }

    // ---- features not held: stick home unless displaced; re-merge if dragged back ----
    for (let i = 0; i < N; i++) {
      const s = this.f[i]; if (!s.active || s.held >= 0) continue;
      if (!s.displaced) { s.pos = { x: s.orig.x, y: s.orig.y }; }
      else if (dist(s.pos, s.orig) < MERGE_EPS) { s.displaced = false; s.pos = { x: s.orig.x, y: s.orig.y }; }
    }

    // ---- push uniforms ----
    const u = this.mat.uniforms;
    for (let i = 0; i < N; i++) {
      const s = this.f[i];
      u.uOrig.value[i].set(s.orig.x, s.orig.y);
      u.uPos.value[i].set(s.pos.x, s.pos.y);
      u.uRad.value[i].set(s.rad.x, s.rad.y);
      u.uSkin.value[i].set(s.skin.x, s.skin.y);
      u.uActive.value[i] = s.active;
    }
    if (ctx.video?.videoWidth) u.uVideoSize.value.set(ctx.video.videoWidth, ctx.video.videoHeight);

    const grabbed = this.f.filter((s) => s.displaced).length;
    ctx.setHud(`FACE OFF · pinch an eye / nose / mouth and pull · detached: ${grabbed}`);
  }

  resize(w, h) {
    super.resize(w, h);
    if (this.mesh) {
      this.geo.dispose();
      this.geo = new THREE.PlaneGeometry(w, h);
      this.mesh.geometry = this.geo;
      this.mesh.position.set(w / 2, h / 2, 0);
      this.mat.uniforms.uResolution.value.set(w, h);
    }
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (scene && this.mesh) scene.remove(this.mesh);
    this.geo?.dispose();
    this.mat?.dispose();
    this.mesh = null;
  }
}

// ===========================================================================
// Preview painter — a face with one eye pinched and pulled off, hole behind.
// ===========================================================================
function preview(c) {
  const W = 320, H = 320;
  c.fillStyle = '#1b1f29'; c.fillRect(0, 0, W, H);
  // face
  c.fillStyle = '#caa07e';
  c.beginPath(); c.ellipse(150, 165, 96, 120, 0, 0, Math.PI * 2); c.fill();
  // right eye (intact)
  c.fillStyle = '#fff'; c.beginPath(); c.ellipse(186, 140, 20, 12, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#28323e'; c.beginPath(); c.arc(186, 140, 7, 0, Math.PI * 2); c.fill();
  // left-eye HOLE (blank skin, slightly darker)
  c.fillStyle = '#b8906e'; c.beginPath(); c.ellipse(114, 140, 22, 14, 0, 0, Math.PI * 2); c.fill();
  // mouth
  c.strokeStyle = '#7a4a3a'; c.lineWidth = 6; c.beginPath(); c.arc(150, 205, 34, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
  // pulled-off eye floating top-right + pinching hand
  c.fillStyle = '#fff'; c.beginPath(); c.ellipse(250, 70, 26, 16, -0.2, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#28323e'; c.beginPath(); c.arc(250, 70, 9, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 3; c.setLineDash([6, 6]);
  c.beginPath(); c.moveTo(132, 140); c.lineTo(250, 70); c.stroke(); c.setLineDash([]);
  c.fillStyle = 'rgba(255,255,255,0.9)'; c.font = '34px serif'; c.textAlign = 'center';
  c.fillText('🤏', 285, 48);
}

export default {
  id: 'FaceOff',
  title: 'FACE OFF',
  subtitle: 'PINCH YOUR EYES / NOSE / MOUTH · PULL THEM OFF',
  category: 'FACE',
  factory: () => new FaceOff(),
  preview,
};
