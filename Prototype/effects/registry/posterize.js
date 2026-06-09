export default {
  id: 'Posterize',
  title: 'POSTER',
  subtitle: 'FOUR LEVELS',
  category: 'PURE',
  preview: 'posterize',
  hud: 'POSTER — cursor area gets more colour levels (smoother)',
  shader: /* glsl */ `
    vec3 col = sampleVideo(vUv);
    // Levels: 3 far from pointer, up to ~16 nearby. Continuous near the cursor.
    float d = distance(vUv, uPointer);
    float t = smoothstep(0.25, 0.0, d) * (0.5 + 0.5 * uPointerActive);
    float levels = mix(3.0, 16.0, t);
    vec3 post = floor(col * levels) / (levels - 1.0);
    gl_FragColor = vec4(clamp(post, 0.0, 1.0), 1.0);
  `,
};
