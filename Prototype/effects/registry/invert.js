export default {
  id: 'Invert',
  title: 'INVERT',
  subtitle: 'COLOR NEGATIVE',
  category: 'PURE',
  preview: 'invert',
  hud: 'INVERT — cursor is a circular lens of normal colors',
  shader: /* glsl */ `
    vec3 col = sampleVideo(vUv);
    vec3 inv = 1.0 - col;
    // Lens of un-inverted colors around the pointer.
    float dToP = distance(vUv, uPointer);
    float r = 0.14 + 0.04 * uPointerActive;
    float lens = smoothstep(r, r - 0.02, dToP);
    vec3 outCol = mix(inv, col, lens);
    // Soft outline around the lens
    float ring = smoothstep(r + 0.004, r, dToP) - smoothstep(r, r - 0.004, dToP);
    outCol = mix(outCol, vec3(1.0), ring * 0.5);
    gl_FragColor = vec4(outCol, 1.0);
  `,
};
