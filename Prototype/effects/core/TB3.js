import * as THREE from 'three';
import { VERT, buildFragment } from './shaderLib.js';
import { loadFaceLandmarker, loadHandLandmarker } from './mpLoader.js';

// Convert a normalised landmark to canvas-pixel position, applying cover-fit
// and optional mirroring so the dot lands on top of the displayed feature.
export function landmarkToCanvasPx(lx, ly, vw, vh, cw, ch, mirror) {
  const ca = cw / ch;
  const va = vw / vh;
  let dispW, dispH, offX, offY;
  if (ca > va) {
    dispW = cw;
    dispH = cw / va;
    offX = 0;
    offY = (ch - dispH) / 2;
  } else {
    dispH = ch;
    dispW = ch * va;
    offX = (cw - dispW) / 2;
    offY = 0;
  }
  const ux = mirror ? (1 - lx) : lx;
  return [offX + ux * dispW, offY + ly * dispH];
}

/**
 * BaseTrackingEffect — abstract base for face/hand effects.
 *
 *   Subclass and implement:
 *     async setup(ctx)        — create your meshes, add to ctx.scene
 *     frame(landmarksList, dt) — update meshes from latest detection
 *     teardown()              — dispose any meshes you added
 *
 *   Provides:
 *     this.camera             — ortho camera in pixel space (Y=0 at top, Y=h at bottom)
 *     this.bgScene            — separate scene where the live video plate lives
 *     this.bgMaterial.uniforms.uDim / uDesat / uTint — style the video plate
 *     this.toPx(lx, ly)       — landmark uv to canvas pixel (already mirrored)
 *
 *   Render flow:
 *     The app's render loop sees `this.bgScene` and renders it FIRST with the
 *     shared clip-space camera (state.camera), then renders state.scene with
 *     `this.camera` so landmark meshes sit on top of the live video plate.
 *     This means the BG uses the exact same sampleVideo path as PURE shaders
 *     (orientation + mirror Just Work).
 */
export class BaseTrackingEffect {
  constructor({ kind = 'face', bg = {} } = {}) {
    this.kind = kind;
    this._bgOpts = { dim: 0.55, desat: 0.25, tint: [1, 1, 1], mirror: undefined, ...bg };
    this.landmarker = null;
    this.bgScene = null;
    this.bgMesh = null;
    this.bgMaterial = null;
    this.lastVideoTime = -1;
    this.mirror = true;
  }

  async init(ctx) {
    this.ctx = ctx;
    this.mirror = this._bgOpts.mirror !== undefined
      ? !!this._bgOpts.mirror
      : ctx.facing !== 'environment';

    // ---- Landmark camera: pixel space, Y-down ----
    this.camera = new THREE.OrthographicCamera(0, ctx.width, 0, ctx.height, -1000, 1000);
    this.camera.position.z = 10;

    // ---- BG scene: full-screen quad sampled via shaderLib.sampleVideo ----
    const bgBody = /* glsl */ `
      vec3 col = sampleVideo(vUv);
      float L = luma(col);
      col = mix(col, vec3(L), uDesat);
      col *= uDim;
      col *= uTint;
      // DIAGNOSTIC: bright magenta corner if BG plate is rendering
      if (vUv.x < 0.10 && vUv.y > 0.80) {
        gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
      } else {
        gl_FragColor = vec4(col, 1.0);
      }
    `;
    this.bgMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: buildFragment(bgBody),
      uniforms: {
        uVideo:         { value: ctx.videoTexture },
        uResolution:    { value: new THREE.Vector2(ctx.width, ctx.height) },
        uVideoSize:     { value: new THREE.Vector2(ctx.video.videoWidth || 1280, ctx.video.videoHeight || 720) },
        uPointer:       { value: new THREE.Vector2(0.5, 0.5) },
        uPointerActive: { value: 0 },
        uTime:          { value: 0 },
        uMirror:        { value: this.mirror ? 1 : 0 },
        uIntensity:     { value: 1 },
        uDim:           { value: this._bgOpts.dim },
        uDesat:         { value: this._bgOpts.desat },
        uTint:          { value: new THREE.Vector3(...this._bgOpts.tint) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMaterial);
    this.bgMesh.frustumCulled = false;
    this.bgScene = new THREE.Scene();
    this.bgScene.add(this.bgMesh);

    ctx.setHud(`${this.kind === 'face' ? 'Face' : 'Hand'} effect — loading model…`);

    if (this.kind === 'face') {
      this.landmarker = await loadFaceLandmarker({ numFaces: 1 });
    } else {
      this.landmarker = await loadHandLandmarker({ numHands: 2 });
    }

    ctx.setHud(`${this.kind === 'face' ? 'Face' : 'Hand'} effect — ready`);
    await this.setup(ctx);
  }

  // Subclasses override.
  async setup(_ctx) {}
  frame(_landmarksList, _dt) {}

  toPx(lx, ly) {
    const { ctx, mirror } = this;
    return landmarkToCanvasPx(
      lx, ly,
      ctx.video.videoWidth || 1280,
      ctx.video.videoHeight || 720,
      ctx.width, ctx.height,
      mirror,
    );
  }

  update(dt) {
    if (!this.landmarker) return;
    const { ctx } = this;
    if (ctx.video.readyState < 2) return;

    const vw = ctx.video.videoWidth, vh = ctx.video.videoHeight;
    if (vw && vh) this.bgMaterial.uniforms.uVideoSize.value.set(vw, vh);

    if (ctx.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = ctx.video.currentTime;

    let res;
    try {
      res = this.landmarker.detectForVideo(ctx.video, performance.now());
    } catch (_e) {
      return;
    }
    const list = this.kind === 'face' ? (res?.faceLandmarks || []) : (res?.landmarks || []);
    this.frame(list, dt);
  }

  resize(w, h) {
    if (this.camera) {
      this.camera.right = w;
      this.camera.bottom = h;
      this.camera.updateProjectionMatrix();
    }
    if (this.bgMaterial) this.bgMaterial.uniforms.uResolution.value.set(w, h);
  }

  dispose() {
    if (this.bgMesh) {
      this.bgMesh.geometry.dispose();
      if (this.bgScene) this.bgScene.remove(this.bgMesh);
    }
    if (this.bgMaterial) this.bgMaterial.dispose();
    this.bgScene = null;
    this.bgMesh = null;
    this.bgMaterial = null;
    this.teardown();
  }

  teardown() {}
}
