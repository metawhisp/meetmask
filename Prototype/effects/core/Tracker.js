import * as THREE from 'three';
import { loadFaceLandmarker, loadHandLandmarker } from './mpLoader.js';

/**
 * Map a normalised MediaPipe landmark (lx, ly in [0,1] of the video frame)
 * to canvas-pixel coordinates, accounting for the CSS object-fit: cover
 * scaling the <video> element does, and selfie mirroring.
 *
 * The <video> in the page is shown via CSS (not via Three.js). For selfie
 * mode it is flipped with `transform: scaleX(-1)`, so the visible image of
 * the user's right hand is on the *left* of the screen. The landmarks come
 * from the raw (unflipped) video, so we mirror x ourselves when needed for
 * the overlay to line up with what the user sees.
 */
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
 * Tracker — base class for effects driven by MediaPipe face/hand landmarks.
 *
 *   Subclass and implement:
 *     async setup(ctx)         — create meshes, add to ctx.scene
 *     frame(landmarksList, dt) — update meshes from latest detection
 *     teardown()               — dispose any meshes you added
 *
 *   Provides:
 *     this.camera              — orthographic camera in canvas-pixel space
 *                                  (Y-down: y=0 at top, y=height at bottom)
 *     this.toPx(lx, ly)        — landmark uv → canvas pixel (mirror-aware)
 *     this.wantsRawVideo=true  — app.js shows the <video> behind the canvas
 *
 *   The canvas is transparent; the live video is the <video> element below it.
 */
export class Tracker {
  constructor({ kind = 'face', numFaces = 1, numHands = 2,
    faceBlendshapes = false, faceTransform = false } = {}) {
    this.kind = kind;
    this.numFaces = numFaces;
    this.numHands = numHands;
    this.faceBlendshapes = faceBlendshapes;
    this.faceTransform = faceTransform;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.mirror = true;
    this.wantsRawVideo = true;
  }

  async init(ctx) {
    this.ctx = ctx;
    this.mirror = ctx.facing !== 'environment';
    // Pixel-space orthographic camera, Y-DOWN convention so landmark
    // y=0 maps to top of screen (matching the raw MediaPipe coords).
    //
    // ⚠ Critical subtlety: passing top<bottom inverts the projection matrix
    // along Y, which flips triangle winding. Default `MeshBasicMaterial`
    // is FrontSide with back-face culling → every plane gets culled and
    // nothing visible renders. We patch ctx.scene.add below to force
    // DoubleSide on every material added under this effect, so individual
    // effects don't need to think about it.
    this.camera = new THREE.OrthographicCamera(0, ctx.width, 0, ctx.height, -1000, 1000);
    this.camera.position.z = 10;

    // Patch ctx.scene.add to fix two problems caused by the Y-flipped
    // ortho camera that EVERY tracker effect inherits:
    //
    //   1. Triangle winding inverts → default `FrontSide` materials get
    //      back-face-culled → nothing renders. Force `DoubleSide`.
    //   2. The flipped projection flips textures vertically. Three.js
    //      defaults `CanvasTexture.flipY = true` to compensate WebGL's
    //      Y-up texture convention against canvas Y-down; with our flipped
    //      camera the two flips compound and textured sprites (cats,
    //      glasses, ice-cream, etc.) appear upside-down. Force `flipY=false`.
    //
    // We restore both on dispose() so the next non-tracker effect runs clean.
    const TEX_KEYS = ['map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap',
      'emissiveMap', 'envMap', 'lightMap', 'metalnessMap', 'normalMap',
      'roughnessMap', 'specularMap'];
    const fixMaterial = (m) => {
      if (!m) return;
      m.side = THREE.DoubleSide;
      for (const k of TEX_KEYS) {
        const tex = m[k];
        if (tex && tex.flipY) {
          tex.flipY = false;
          tex.needsUpdate = true;
        }
      }
    };
    const fixObject = (obj) => {
      if (!obj) return;
      const m = obj.material;
      if (m) {
        if (Array.isArray(m)) m.forEach(fixMaterial);
        else fixMaterial(m);
      }
      if (obj.children && obj.children.length) obj.children.forEach(fixObject);
    };
    this._origSceneAdd = ctx.scene.add.bind(ctx.scene);
    ctx.scene.add = (...objects) => {
      objects.forEach(fixObject);
      return this._origSceneAdd(...objects);
    };

    ctx.setHud(`${this.kind === 'face' ? 'Face' : 'Hand'} effect — loading model…`);
    try {
      if (this.kind === 'face') {
        this.landmarker = await loadFaceLandmarker({
          numFaces: this.numFaces,
          blendshapes: this.faceBlendshapes,
          transform: this.faceTransform,
        });
      } else {
        this.landmarker = await loadHandLandmarker({ numHands: this.numHands });
      }
    } catch (e) {
      ctx.setHud(`${this.kind} model failed: ${String(e.message || e)}`);
      throw e;
    }
    ctx.setHud(`${this.kind === 'face' ? 'Face' : 'Hand'} effect — ready`);
    try {
      await this.setup(ctx);
    } catch (e) {
      ctx.setHud(`setup failed: ${String(e.message || e)}`);
      throw e;
    }
  }

  async setup(_ctx) {}
  frame(_landmarksList, _dt) {}
  teardown() {}

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
  }

  dispose() {
    this.teardown();
    // Restore the original scene.add so a subsequent non-tracker effect
    // doesn't keep getting its materials force-patched.
    if (this._origSceneAdd && this.ctx?.scene) {
      this.ctx.scene.add = this._origSceneAdd;
      this._origSceneAdd = null;
    }
  }
}

export { Tracker as BaseTrackingEffect };
