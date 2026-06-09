import * as THREE from 'three';
import { VERT, buildFragment } from './shaderLib.js';

/**
 * BaseShaderEffect — turns a GLSL shader body into a full-screen effect.
 *
 * Construct with:
 *   new BaseShaderEffect({
 *     shader:   "<glsl body — code that goes inside main()>",
 *     uniforms: { uMyParam: { value: 1.0 } },   // optional extras
 *     hud:      "Optional text shown in HUD",
 *   })
 *
 * Pointer position is exposed as uniform `uPointer` (0..1 across canvas),
 * `uPointerActive` is 1 while a finger/mouse is down.
 */
export class BaseShaderEffect {
  constructor({ shader = '', fullShader = null, uniforms = {}, hud = '' } = {}) {
    this._shaderBody = fullShader || shader;
    this._extraUniforms = uniforms;
    this._hud = hud;
    this.time = 0;
    this.pointer = { x: 0.5, y: 0.5, active: 0 };

    this._onMove = (e) => {
      // Match GL/PlaneGeometry vUv convention: Y=1 at top, Y=0 at bottom.
      this.pointer.x = e.clientX / window.innerWidth;
      this.pointer.y = 1.0 - e.clientY / window.innerHeight;
    };
    this._onDown = (e) => { this._onMove(e); this.pointer.active = 1; };
    this._onUp = () => { this.pointer.active = 0; };
  }

  async init(ctx) {
    this.ctx = ctx;

    const uniforms = {
      uVideo:         { value: ctx.videoTexture },
      uResolution:    { value: new THREE.Vector2(ctx.width, ctx.height) },
      uVideoSize:     { value: new THREE.Vector2(ctx.video.videoWidth || 1280, ctx.video.videoHeight || 720) },
      uPointer:       { value: new THREE.Vector2(0.5, 0.5) },
      uPointerActive: { value: 0 },
      uTime:          { value: 0 },
      uMirror:        { value: ctx.facing === 'user' ? 1.0 : 0.0 },
      uIntensity:     { value: 1.0 },
    };
    for (const [k, v] of Object.entries(this._extraUniforms)) {
      uniforms[k] = { ...v };
    }

    const fragmentShader = buildFragment(this._shaderBody);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });

    // Surface shader compile errors in HUD so they don't fail silently.
    // (Three.js emits them to console; we also flag them.)
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    ctx.scene.add(this.mesh);

    window.addEventListener('pointermove',   this._onMove, { passive: true });
    window.addEventListener('pointerdown',   this._onDown, { passive: true });
    window.addEventListener('pointerup',     this._onUp,   { passive: true });
    window.addEventListener('pointercancel', this._onUp,   { passive: true });

    if (this._hud) ctx.setHud(this._hud);
  }

  update(dt) {
    this.time += dt;
    if (!this.material) return;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uPointer.value.set(this.pointer.x, this.pointer.y);
    const target = this.pointer.active;
    u.uPointerActive.value += (target - u.uPointerActive.value) * Math.min(1, dt * 8);
    const vw = this.ctx.video.videoWidth, vh = this.ctx.video.videoHeight;
    if (vw && vh) u.uVideoSize.value.set(vw, vh);
  }

  resize(w, h) {
    if (this.material) this.material.uniforms.uResolution.value.set(w, h);
  }

  dispose() {
    window.removeEventListener('pointermove',   this._onMove);
    window.removeEventListener('pointerdown',   this._onDown);
    window.removeEventListener('pointerup',     this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.ctx.scene.remove(this.mesh);
    }
    if (this.material) this.material.dispose();
    this.mesh = this.material = null;
  }
}

export function makeShaderEffect(spec) {
  return new BaseShaderEffect(spec);
}
