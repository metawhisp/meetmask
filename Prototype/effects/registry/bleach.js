export default {
  id: 'Bleach',
  title: 'BLEACH',
  subtitle: 'FILM BYPASS',
  category: 'PURE',
  preview: 'bleach',
  hud: 'BLEACH — cursor is a window back to true colour',
  shader: /* glsl */ `
    vec3 col = sampleVideo(vUv);
    float L = luma(col);
    vec3 lumaCol = vec3(L);
    vec3 desat = mix(col, lumaCol, 0.7);
    vec3 screen = 1.0 - (1.0 - desat) * (1.0 - lumaCol);
    screen = (screen - 0.5) * 1.1 + 0.5;
    // Reveal original colour near pointer.
    float d = distance(vUv, uPointer);
    float r = 0.18 + 0.06 * uPointerActive;
    float reveal = smoothstep(r, r - 0.02, d);
    gl_FragColor = vec4(mix(clamp(screen, 0.0, 1.0), col, reveal), 1.0);
  `,
};
