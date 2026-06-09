import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// Subset of the canonical face-mesh triangulation that's dense enough to give
// a recognisable low-poly face. ~80 triangles is a fraction of MediaPipe's
// full ~870 but enough for the gestalt without thousands of draw calls.
const TRIANGLES = [
  // forehead
  [10, 338, 297],[10, 297, 332],[10, 332, 284],[10, 284, 251],[10, 251, 389],
  [10, 389, 356],[10, 109, 67],[10, 67, 103],[10, 103, 54],[10, 54, 21],
  // right cheek + temple
  [127, 234, 93],[234, 93, 132],[93, 132, 58],[132, 58, 172],[58, 172, 136],
  [172, 136, 150],[136, 150, 149],[150, 149, 176],
  // left cheek + temple
  [356, 454, 323],[454, 323, 361],[323, 361, 288],[361, 288, 397],[288, 397, 365],
  [397, 365, 379],[365, 379, 378],[379, 378, 400],
  // nose
  [168, 6, 197],[6, 197, 195],[197, 195, 5],[195, 5, 4],[5, 4, 1],
  // right eye region
  [33, 7, 163],[33, 163, 144],[33, 144, 145],[145, 153, 154],[154, 155, 133],
  [33, 246, 161],[161, 160, 159],[159, 158, 157],[157, 173, 133],
  // left eye region
  [263, 249, 390],[263, 390, 373],[263, 373, 374],[374, 380, 381],[381, 382, 362],
  [263, 466, 388],[388, 387, 386],[386, 385, 384],[384, 398, 362],
  // upper lip
  [61, 185, 40],[40, 39, 37],[37, 0, 267],[267, 269, 270],[270, 409, 291],
  // lower lip
  [61, 146, 91],[91, 181, 84],[84, 17, 314],[314, 405, 321],[321, 375, 291],
  // chin
  [152, 148, 176],[176, 149, 150],[152, 377, 400],[400, 378, 379],
  // mouth surroundings (cheeks → lips bridge)
  [205, 36, 142],[142, 100, 47],[47, 121, 120],
  [425, 266, 371],[371, 329, 277],[277, 350, 349],
];

const NUM_LMS = 478;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVideo;
  uniform float uMirror;       // 1 if vid is CSS-mirrored visually
  uniform float uTime;
  uniform float uGlow;         // 0..1 edge brightness

  void main() {
    vec2 src = vUv;
    if (uMirror > 0.5) src.x = 1.0 - src.x;
    vec3 col = texture2D(uVideo, src).rgb;
    // Subtle hue pulse so the mesh feels "alive".
    float pulse = 0.92 + 0.08 * sin(uTime * 2.2);
    col *= pulse;
    // Pop the saturation a touch.
    float L = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(L), col, 1.25);
    gl_FragColor = vec4(col, 1.0);
  }
`;

class FaceMask extends Tracker {
  constructor() { super({ kind: 'face' }); }

  async setup(ctx) {
    // Build flat triangle list with shared landmarks (each landmark = 1 vertex).
    // Per frame we re-write the positions array from current landmarks.
    const positions = new Float32Array(NUM_LMS * 3);
    const uvs = new Float32Array(NUM_LMS * 2);
    // UVs are static — they map each vertex to the corresponding pixel in the
    // raw camera frame (un-mirrored). The shader then optionally flips X.
    // We can't set UVs until we have a first frame's lm — but for the canonical
    // mesh the UVs ARE the lm.x/lm.y values, which we'll update each frame too.
    // For now, init to 0 so geometry validates.
    const indices = [];
    for (const tri of TRIANGLES) indices.push(tri[0], tri[1], tri[2]);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(indices);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uVideo:  { value: ctx.videoTexture },
        uMirror: { value: this.mirror ? 1 : 0 },
        uTime:   { value: 0 },
        uGlow:   { value: 0.6 },
      },
      side: THREE.DoubleSide,
      depthTest: false,
      transparent: false,
    });
    this.mesh = new THREE.Mesh(geom, this.mat);
    this.mesh.frustumCulled = false;
    ctx.scene.add(this.mesh);

    // Neon edge overlay (LineSegments) along the triangle edges.
    const edgePositions = new Float32Array(TRIANGLES.length * 3 * 2 * 3);
    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x00ffd1, transparent: true, opacity: 0.85, depthTest: false });
    this.edges = new THREE.LineSegments(edgeGeom, this.edgeMat);
    this.edges.frustumCulled = false;
    ctx.scene.add(this.edges);

    this.time = 0;
  }

  frame(faces, dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (!faces.length) {
      this.mesh.visible = false;
      this.edges.visible = false;
      this.ctx.setHud('FACE MASK — looking for a face');
      return;
    }
    this.mesh.visible = true;
    this.edges.visible = true;
    const lms = faces[0];
    const posAttr = this.mesh.geometry.attributes.position;
    const uvAttr = this.mesh.geometry.attributes.uv;
    const positions = posAttr.array;
    const uvs = uvAttr.array;
    for (let i = 0; i < lms.length; i++) {
      const [px, py] = this.toPx(lms[i].x, lms[i].y);
      positions[i * 3 + 0] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = 0;
      // UV = raw lm.x, lm.y (the shader flips X when mirror is set so the
      // sampled pixel matches the CSS-mirrored display).
      uvs[i * 2 + 0] = lms[i].x;
      uvs[i * 2 + 1] = 1.0 - lms[i].y; // flip Y for VideoTexture (flipY=true)
    }
    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;

    // Rewrite edge positions: each triangle's 3 edges.
    const edgePos = this.edges.geometry.attributes.position.array;
    let k = 0;
    for (let i = 0; i < TRIANGLES.length; i++) {
      const [a, b, c] = TRIANGLES[i];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const [ux, uy] = this.toPx(lms[u].x, lms[u].y);
        const [vx, vy] = this.toPx(lms[v].x, lms[v].y);
        edgePos[k++] = ux; edgePos[k++] = uy; edgePos[k++] = 1;
        edgePos[k++] = vx; edgePos[k++] = vy; edgePos[k++] = 1;
      }
    }
    this.edges.geometry.attributes.position.needsUpdate = true;

    this.ctx.setHud(`FACE MASK — low-poly face · ${TRIANGLES.length} tri`);
  }

  teardown() {
    if (this.mesh) { this.mesh.geometry.dispose(); this.ctx.scene.remove(this.mesh); }
    if (this.mat) this.mat.dispose();
    if (this.edges) { this.edges.geometry.dispose(); this.ctx.scene.remove(this.edges); }
    if (this.edgeMat) this.edgeMat.dispose();
    this.mesh = this.mat = this.edges = this.edgeMat = null;
  }
}

export default {
  id: 'FaceMask',
  title: 'FACE MASK',
  subtitle: 'LOW-POLY VIDEO MESH',
  category: 'FACE',
  preview: 'faceMask',
  factory: () => new FaceMask(),
};
