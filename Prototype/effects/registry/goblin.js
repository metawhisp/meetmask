import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ============================================================================
// GOBLIN — a green goblin head locks onto yours and mirrors every expression in
// real time: jaw, brows, blinks, cheeks, bulging eyes. Push an expression to
// the extreme and the rig over-deforms (jaw unhinges, eyes bulge) for the meme.
//
// Continuous full-face puppeting every frame from blendshapes + the 4x4 head
// pose matrix (both via the base Tracker flags). Camera shows behind
// (wantsRawVideo); the goblin sits over your head. Detection is blendshape /
// matrix based → mirror-agnostic; §12 untouched.
// ============================================================================

// pull a blendshape, optionally exaggerated past 1.0 for the grotesque extreme
const ex = (v, gain = 1.6) => Math.min(1.8, (v || 0) * gain);

class Goblin extends Tracker {
  constructor() {
    super({ kind: 'face', numFaces: 1, faceBlendshapes: true, faceTransform: true });
    this.lastT = -1;
    this.lms = null; this.B = null; this.M = null;
    this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();
  }

  async setup(ctx) {
    // lights so the standard materials shade as 3D
    // Hemisphere + ambient fill so shading reads even though the goblin is
    // Y-flipped (negative Y scale) to sit upright under the Y-down ortho camera.
    this.amb = new THREE.AmbientLight(0xffffff, 0.5);
    this.hemi = new THREE.HemisphereLight(0xeaffea, 0x203010, 1.15);
    this.dir = new THREE.DirectionalLight(0xffffff, 0.45); this.dir.position.set(-0.4, 1, 2);
    ctx.scene.add(this.amb, this.hemi, this.dir);

    const skin = new THREE.MeshStandardMaterial({ color: 0x6cbf4a, roughness: 0.7, metalness: 0.0, flatShading: false });
    const skinDark = new THREE.MeshStandardMaterial({ color: 0x4f9636, roughness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: 0xfdfde8, roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x14110c, roughness: 0.4 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x3a0d12, roughness: 0.6 });
    this._mats = [skin, skinDark, white, black, mouthMat];

    const G = new THREE.Group();           // whole goblin, unit-ish scale (~radius 1)
    // skull
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 32), skin);
    skull.scale.set(0.92, 1.02, 0.9);
    G.add(skull);
    // brow ridge
    const brow = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), skin);
    brow.scale.set(0.95, 0.28, 0.5); brow.position.set(0, 0.32, 0.66);
    G.add(brow);
    // ears (pointy cones)
    const earGeo = new THREE.ConeGeometry(0.28, 0.95, 16);
    this.earL = new THREE.Mesh(earGeo, skinDark); this.earL.position.set(-0.92, 0.25, 0); this.earL.rotation.z = 1.25; this.earL.rotation.y = 0.3;
    this.earR = new THREE.Mesh(earGeo, skinDark); this.earR.position.set(0.92, 0.25, 0); this.earR.rotation.z = -1.25; this.earR.rotation.y = -0.3;
    G.add(this.earL, this.earR);
    // nose (big hooked goblin nose)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 16), skin);
    nose.position.set(0, -0.02, 0.92); nose.rotation.x = Math.PI * 0.62;
    G.add(nose);
    // eyes (white + pupil), grouped so we can scale/blink each
    const eyeWhiteGeo = new THREE.SphereGeometry(0.26, 24, 20);
    const pupilGeo = new THREE.SphereGeometry(0.12, 16, 12);
    const mkEye = (x) => {
      const g = new THREE.Group();
      const w = new THREE.Mesh(eyeWhiteGeo, white); g.add(w);
      const p = new THREE.Mesh(pupilGeo, black); p.position.z = 0.2; g.add(p);
      g.position.set(x, 0.18, 0.7);
      return g;
    };
    this.eyeL = mkEye(-0.38); this.eyeR = mkEye(0.38);
    G.add(this.eyeL, this.eyeR);
    // eyebrows
    const browGeo = new THREE.BoxGeometry(0.42, 0.1, 0.12);
    this.browL = new THREE.Mesh(browGeo, skinDark); this.browL.position.set(-0.38, 0.46, 0.78);
    this.browR = new THREE.Mesh(browGeo, skinDark); this.browR.position.set(0.38, 0.46, 0.78);
    G.add(this.browL, this.browR);
    // cheeks (puffable)
    const cheekGeo = new THREE.SphereGeometry(0.32, 20, 16);
    this.cheekL = new THREE.Mesh(cheekGeo, skin); this.cheekL.position.set(-0.55, -0.3, 0.62);
    this.cheekR = new THREE.Mesh(cheekGeo, skin); this.cheekR.position.set(0.55, -0.3, 0.62);
    G.add(this.cheekL, this.cheekR);
    // upper mouth (fixed) + lower jaw (drops). mouth cavity is dark.
    const cavity = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 18), mouthMat);
    cavity.scale.set(1, 0.55, 0.5); cavity.position.set(0, -0.52, 0.66);
    G.add(cavity);
    this.jaw = new THREE.Group();
    const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), skin);
    jawMesh.scale.set(0.7, 0.42, 0.62); jawMesh.position.set(0, -0.2, 0.5);
    this.jaw.add(jawMesh);
    // a couple teeth
    const toothGeo = new THREE.ConeGeometry(0.06, 0.16, 8);
    const tU1 = new THREE.Mesh(toothGeo, white); tU1.position.set(-0.12, -0.34, 0.95); tU1.rotation.x = Math.PI;
    const tU2 = new THREE.Mesh(toothGeo, white); tU2.position.set(0.12, -0.34, 0.95); tU2.rotation.x = Math.PI;
    G.add(tU1, tU2);
    this.jaw.position.set(0, -0.5, 0.18);
    G.add(this.jaw);

    this.goblin = G;
    G.visible = false;
    ctx.scene.add(G);
  }

  update(dt) {
    const ctx = this.ctx;
    if (!ctx || !ctx.video || ctx.video.readyState < 2) { this.apply(); return; }
    if (ctx.video.currentTime !== this.lastT) {
      this.lastT = ctx.video.currentTime;
      try {
        const r = this.landmarker.detectForVideo(ctx.video, performance.now());
        this.lms = r?.faceLandmarks?.[0] || null;
        const cats = r?.faceBlendshapes?.[0]?.categories; const B = {}; if (cats) for (const c of cats) B[c.categoryName] = c.score;
        this.B = cats ? B : null;
        this.M = r?.facialTransformationMatrixes?.[0]?.data || null;
      } catch (_e) { /* keep last */ }
    }
    this.apply();
  }

  apply() {
    const ctx = this.ctx; const G = this.goblin; if (!G) return;
    if (!this.lms || !this.B) { G.visible = false; if (ctx) ctx.setHud('GOBLIN · show your face'); return; }
    G.visible = true;
    const B = this.B, lms = this.lms;

    // position + scale to the face (pixel space)
    const fx = lms[10], cx = lms[152];                  // forehead, chin
    const [hx, hy] = this.toPx((fx.x + cx.x) / 2, (fx.y + cx.y) / 2);
    const [lx] = this.toPx(lms[234].x, lms[234].y), [rx] = this.toPx(lms[454].x, lms[454].y);
    const faceW = Math.abs(rx - lx) || 200;
    G.position.set(hx, hy, 1);
    const s = faceW * 0.58;
    G.scale.set(s, -s, s);   // negative Y → upright under the Y-down ortho camera

    // head pose from the 4x4 matrix (roll reads best in ortho; keep yaw/pitch mild)
    if (this.M && this.M.length === 16) {
      this._m4.fromArray(this.M);
      this._m4.decompose(this._p, this._q, this._s);
      const e = new THREE.Euler().setFromQuaternion(this._q, 'YXZ');
      // mirror-safe: ortho + selfie → flip yaw & roll sign so it tracks naturally
      G.rotation.set(-e.x * 0.7, -e.y * 0.7, e.z * (this.mirror ? 1 : -1));
    }

    // ---- blendshape puppeting ----
    const jaw = ex(B.jawOpen, 1.4);
    this.jaw.rotation.x = jaw * 0.9;                    // unhinge
    this.jaw.position.y = -0.5 - jaw * 0.18;

    const smile = ex((B.mouthSmileLeft + B.mouthSmileRight) / 2, 1.4);
    this.cheekL.scale.setScalar(1 + ex(B.cheekPuff, 1.8) * 0.6 + smile * 0.12);
    this.cheekR.scale.setScalar(1 + ex(B.cheekPuff, 1.8) * 0.6 + smile * 0.12);

    const blinkL = Math.min(1, (B.eyeBlinkLeft || 0) * 1.2);
    const blinkR = Math.min(1, (B.eyeBlinkRight || 0) * 1.2);
    const wideL = ex(B.eyeWideLeft, 1.5), wideR = ex(B.eyeWideRight, 1.5);
    this.eyeL.scale.set(1 + wideL * 0.5, (1 - blinkL * 0.92) * (1 + wideL * 0.5), 1 + wideL * 0.4);
    this.eyeR.scale.set(1 + wideR * 0.5, (1 - blinkR * 0.92) * (1 + wideR * 0.5), 1 + wideR * 0.4);

    const browUp = ex(B.browInnerUp, 1.3);
    const browDnL = ex(B.browDownLeft, 1.3), browDnR = ex(B.browDownRight, 1.3);
    this.browL.position.y = 0.46 + browUp * 0.16 - browDnL * 0.12;
    this.browR.position.y = 0.46 + browUp * 0.16 - browDnR * 0.12;
    this.browL.rotation.z = -browDnL * 0.5 + browUp * 0.1;   // angry inward when down
    this.browR.rotation.z = browDnR * 0.5 - browUp * 0.1;

    // ears flare with surprise (jaw + brow up)
    const flare = Math.min(1, jaw * 0.5 + browUp * 0.5);
    this.earL.rotation.z = 1.25 - flare * 0.35;
    this.earR.rotation.z = -1.25 + flare * 0.35;

    if (ctx) ctx.setHud('GOBLIN · talk, gasp, scowl — it mirrors you');
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (scene) { [this.goblin, this.amb, this.hemi, this.dir].forEach((o) => o && scene.remove(o)); }
    this.goblin?.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this._mats?.forEach((m) => m.dispose());
    this.goblin = null;
  }
}

// ===========================================================================
// Preview painter — a goblin face.
// ===========================================================================
function preview(c) {
  const W = 320, H = 320;
  c.fillStyle = '#10140d'; c.fillRect(0, 0, W, H);
  // ears
  c.fillStyle = '#4f9636';
  c.beginPath(); c.moveTo(60, 150); c.lineTo(110, 95); c.lineTo(118, 165); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(260, 150); c.lineTo(210, 95); c.lineTo(202, 165); c.closePath(); c.fill();
  // head
  c.fillStyle = '#6cbf4a'; c.beginPath(); c.ellipse(160, 165, 88, 100, 0, 0, Math.PI * 2); c.fill();
  // brows (angry)
  c.strokeStyle = '#3c7a2a'; c.lineWidth = 12; c.lineCap = 'round';
  c.beginPath(); c.moveTo(110, 130); c.lineTo(150, 145); c.stroke();
  c.beginPath(); c.moveTo(210, 130); c.lineTo(170, 145); c.stroke();
  // eyes (bulging)
  c.fillStyle = '#fdfde8'; c.beginPath(); c.arc(128, 160, 24, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(192, 160, 24, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#14110c'; c.beginPath(); c.arc(132, 162, 10, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(188, 162, 10, 0, Math.PI * 2); c.fill();
  // nose
  c.fillStyle = '#5aa83e'; c.beginPath(); c.moveTo(160, 165); c.lineTo(150, 205); c.lineTo(172, 200); c.closePath(); c.fill();
  // open mouth + teeth
  c.fillStyle = '#3a0d12'; c.beginPath(); c.ellipse(160, 235, 42, 26, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fdfde8';
  c.beginPath(); c.moveTo(140, 214); c.lineTo(150, 232); c.lineTo(132, 230); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(180, 214); c.lineTo(170, 232); c.lineTo(188, 230); c.closePath(); c.fill();
}

export default {
  id: 'Goblin',
  title: 'GOBLIN',
  subtitle: 'YOUR INNER GOBLIN · MIRRORS YOUR FACE',
  category: 'FACE',
  factory: () => new Goblin(),
  preview,
};
