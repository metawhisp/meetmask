export default {
  id: 'Caustics',
  title: 'CAUSTICS',
  subtitle: 'UNDERWATER LIGHT',
  category: 'PURE',
  preview: 'caustics',
  hud: 'CAUSTICS — cursor is the sun above the water',
  shader: /* glsl */ `
    vec3 col = sampleVideo(vUv);
    // Procedural caustics, with the wave epicenter pulled toward the pointer.
    vec2 origin = mix(vec2(0.5), uPointer, 0.6 + 0.4 * uPointerActive);
    vec2 p = (vUv - origin) * 8.0;
    float c = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec2 q = p + vec2(sin(uTime * 0.5 + fi), cos(uTime * 0.3 + fi));
      c += abs(sin(length(q) * 3.0 - uTime * 1.4));
    }
    c = pow(c * 0.25, 3.0);
    // Pointer also adds a focused sunbeam.
    float d = distance(vUv, uPointer);
    float sun = (1.0 - smoothstep(0.0, 0.28, d)) * (0.4 + 0.7 * uPointerActive);
    c = max(c, sun);
    vec3 caust = mix(vec3(0.10, 0.40, 0.65), vec3(0.85, 0.95, 1.0), c);
    gl_FragColor = vec4(col * 0.5 + caust * 0.7, 1.0);
  `,
};
