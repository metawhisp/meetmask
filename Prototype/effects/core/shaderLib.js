// Shared GLSL preamble used by all declarative shader effects.
// Anything in here is available inside an effect's `shader` body:
//
//   varyings: vUv (0..1 across canvas)
//   uniforms: uTime, uResolution, uVideoSize, uPointer, uPointerActive,
//             uMirror, uIntensity
//   helpers:  sampleVideo(uv), coverUv(uv), luma(c), hash(p), vnoise(p),
//             fbm(p), palette(t,a,b,c,d), hue2rgb(h)
//
// A "shader body" is the *contents* of `void main() { ... }` — no main()
// wrapper needed. Use `gl_FragColor = vec4(col, 1.0)` at the end.
// If you need a full shader with custom helpers, pass `fullShader` instead.

export const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const PREAMBLE = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uVideo;
uniform vec2  uResolution;
uniform vec2  uVideoSize;
uniform vec2  uPointer;
uniform float uPointerActive;
uniform float uTime;
uniform float uMirror;
uniform float uIntensity;

const float PI  = 3.14159265358979;
const float TAU = 6.28318530717958;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec2 coverUv(vec2 uv) {
  float ca = uResolution.x / uResolution.y;
  float va = uVideoSize.x  / uVideoSize.y;
  vec2 s = vec2(1.0);
  if (ca > va) s.y = va / ca; else s.x = ca / va;
  return (uv - 0.5) * s + 0.5;
}

vec3 sampleVideo(vec2 uv) {
  // Real getUserMedia VideoTexture honours flipY=true: image's top row ends
  // up at GL y=1. PURE shaders' full-screen quad has vUv.y=1 at TOP of
  // screen, so sample with vUv directly. Mirror X for selfie view.
  // (Note: canvas.captureStream-backed VideoTextures do NOT flipY — so our
  // ?fake=1 dev mode looks upside-down; the real camera is right-side up.)
  vec2 c = coverUv(uv);
  if (uMirror > 0.5) c.x = 1.0 - c.x;
  return texture2D(uVideo, clamp(c, 0.001, 0.999)).rgb;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

vec3 hue2rgb(float h) {
  vec3 k = vec3(0.0, 4.0, 2.0) / 6.0;
  vec3 p = abs(fract(h + k) * 6.0 - 3.0);
  return clamp(p - 1.0, 0.0, 1.0);
}

// Inigo Quilez's cosine palette: smooth ramp through colors
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

vec2 rotate2(vec2 p, float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c) * p;
}
`;

/**
 * Wrap a "shader body" (the inside of main) with the preamble and a main()
 * shell. If the body already contains "void main", treat it as a full shader
 * and skip wrapping.
 */
export function buildFragment(shaderBody) {
  if (/void\s+main\s*\(/.test(shaderBody)) {
    return PREAMBLE + '\n' + shaderBody;
  }
  return PREAMBLE + '\nvoid main() {\n' + shaderBody + '\n}';
}
