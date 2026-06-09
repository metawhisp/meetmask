export default {
  id: 'Plasma',
  title: 'PLASMA',
  subtitle: 'COLOR CYCLE',
  category: 'PURE',
  preview: 'plasma',
  hud: 'PLASMA — cursor shifts the local palette phase',
  shader: /* glsl */ `
    vec3 col = sampleVideo(vUv);
    float l = luma(col);
    float shift = uTime * 0.12;
    // Local phase shift around the pointer — drag to paint colours.
    float d = distance(vUv, uPointer);
    shift += (1.0 - smoothstep(0.0, 0.30, d)) * (0.3 + 0.6 * uPointerActive);
    vec3 p = palette(l + shift,
      vec3(0.5),
      vec3(0.5),
      vec3(1.0, 1.0, 0.5),
      vec3(0.0, 0.10, 0.20));
    gl_FragColor = vec4(p, 1.0);
  `,
};
