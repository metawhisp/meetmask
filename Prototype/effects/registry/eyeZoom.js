import * as THREE from 'three';
import { BaseTrackingEffect } from '../core/Tracker.js?v=3';

// MediaPipe iris landmark indices (require refineLandmarks; with default model,
// fall back to eye-center estimates from the eye outline).
const RIGHT_EYE = [33, 133, 159, 145];  // outer, inner, top, bottom (right eye in image)
const LEFT_EYE  = [263, 362, 386, 374]; // outer, inner, top, bottom (left eye in image)

function center(lms, idxs, toPx) {
  let x = 0, y = 0, n = 0;
  for (const i of idxs) {
    const lm = lms[i];
    if (!lm) continue;
    const [px, py] = toPx(lm.x, lm.y);
    x += px; y += py; n++;
  }
  return n ? [x / n, y / n] : null;
}

// Vertex shader: positions are given in pixel space because we use the
// effect's pixel-space ortho camera; sample the live video for the inside
// of the eye.
const ZOOM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ZOOM_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVideo;
  uniform vec2 uEyeCenter;       // in normalised video uv space
  uniform vec2 uVideoSize;
  uniform vec2 uResolution;
  uniform float uMirror;
  uniform float uZoom;

  vec2 coverUv(vec2 uv) {
    float ca = uResolution.x / uResolution.y;
    float va = uVideoSize.x / uVideoSize.y;
    vec2 s = vec2(1.0);
    if (ca > va) s.y = va / ca; else s.x = ca / va;
    return (uv - 0.5) * s + 0.5;
  }

  void main() {
    // uEyeCenter comes from lm.y (image-y-down, 0=top of image).
    // Real-camera VideoTexture is uploaded with flipY=true (image top at
    // GL y=1), so sample at (1 - lm.y) to land on the right pixel.
    vec2 local = (vUv - 0.5) * 0.18 / uZoom;
    vec2 src = uEyeCenter + local;
    src.y = 1.0 - src.y;
    if (uMirror > 0.5) src.x = 1.0 - src.x;
    src = clamp(src, 0.001, 0.999);
    vec3 col = texture2D(uVideo, src).rgb;
    float a = smoothstep(0.5, 0.42, length(vUv - 0.5));
    gl_FragColor = vec4(col, a);
  }
`;

class EyeZoom extends BaseTrackingEffect {
  constructor() { super({ kind: 'face', bg: { dim: 0.85, desat: 0.0 } }); }
  async setup(ctx) {
    const radius = Math.max(60, Math.min(ctx.width, ctx.height) * 0.13);
    this.radius = radius;
    this.eyes = [];
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: ZOOM_VERT,
        fragmentShader: ZOOM_FRAG,
        transparent: true,
        depthTest: false,
        uniforms: {
          uVideo:      { value: ctx.videoTexture },
          uEyeCenter:  { value: new THREE.Vector2(0.5, 0.5) },
          uVideoSize:  { value: new THREE.Vector2(ctx.video.videoWidth || 1280, ctx.video.videoHeight || 720) },
          uResolution: { value: new THREE.Vector2(ctx.width, ctx.height) },
          uMirror:     { value: this.mirror ? 1.0 : 0.0 },
          uZoom:       { value: 1.0 },
        },
      });
      const geo = new THREE.CircleGeometry(radius, 48);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      ctx.scene.add(mesh);
      this.eyes.push({ mesh, mat });
    }
  }
  frame(faces) {
    const { ctx } = this;
    const visible = faces.length > 0;
    const lms = visible ? faces[0] : null;
    const right = lms ? center(lms, RIGHT_EYE, this.toPx.bind(this)) : null;
    const left  = lms ? center(lms, LEFT_EYE,  this.toPx.bind(this)) : null;
    const eyeUvR = lms ? avgUv(lms, RIGHT_EYE) : null;
    const eyeUvL = lms ? avgUv(lms, LEFT_EYE)  : null;

    if (right && eyeUvR) {
      this.eyes[0].mesh.position.set(right[0], right[1], 2);
      this.eyes[0].mat.uniforms.uEyeCenter.value.set(eyeUvR[0], eyeUvR[1]);
    } else this.eyes[0].mesh.position.set(-9999, -9999, 0);

    if (left && eyeUvL) {
      this.eyes[1].mesh.position.set(left[0], left[1], 2);
      this.eyes[1].mat.uniforms.uEyeCenter.value.set(eyeUvL[0], eyeUvL[1]);
    } else this.eyes[1].mesh.position.set(-9999, -9999, 0);

    const vw = ctx.video.videoWidth, vh = ctx.video.videoHeight;
    if (vw && vh) {
      this.eyes[0].mat.uniforms.uVideoSize.value.set(vw, vh);
      this.eyes[1].mat.uniforms.uVideoSize.value.set(vw, vh);
    }
    ctx.setHud(`EYE ZOOM — ${visible ? 'face' : 'no face'}`);
  }
  resize(w, h) {
    super.resize(w, h);
    if (this.eyes) for (const e of this.eyes) e.mat.uniforms.uResolution.value.set(w, h);
  }
  teardown() {
    if (this.eyes) {
      for (const e of this.eyes) {
        e.mesh.geometry.dispose();
        e.mat.dispose();
        this.ctx.scene.remove(e.mesh);
      }
    }
    this.eyes = null;
  }
}

function avgUv(lms, idxs) {
  let x = 0, y = 0, n = 0;
  for (const i of idxs) {
    const lm = lms[i];
    if (!lm) continue;
    x += lm.x; y += lm.y; n++;
  }
  return n ? [x / n, y / n] : null;
}

export default {
  id: 'EyeZoom',
  title: 'EYE ZOOM',
  subtitle: 'MAGNIFY EYES',
  category: 'FACE',
  preview: 'eyeZoom',
  factory: () => new EyeZoom(),
};
