export default {
  id: 'Kaleidoscope',
  title: 'KALEIDO',
  subtitle: 'SIX-FOLD SYMMETRY',
  category: 'PURE',
  preview: 'kaleidoscope',
  hud: 'KALEIDO — cursor sets the kaleido center and twists it',
  shader: /* glsl */ `
    // Kaleido axis follows the cursor so you can sweep different regions in.
    vec2 c = uPointer;
    vec2 p = vUv - c;
    float twist = uTime * 0.2 + (uPointer.x - 0.5) * 4.0 * uPointerActive;
    float a = atan(p.y, p.x) + twist;
    float r = length(p);
    float seg = PI / 3.0;
    a = mod(a, seg);
    a = abs(a - seg * 0.5);
    vec2 uv = c + vec2(cos(a), sin(a)) * r * 0.85;
    vec3 col = sampleVideo(clamp(uv, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  `,
};
