export default {
  id: 'Mosaic',
  title: 'MOSAIC',
  subtitle: 'CHUNKY PIXELS',
  category: 'PURE',
  preview: 'mosaic',
  hud: 'MOSAIC — cursor area sharpens, far away blocks grow',
  shader: /* glsl */ `
    // Cell size depends on distance to pointer: small near, chunky far.
    float d = distance(vUv, uPointer);
    float focus = 1.0 - smoothstep(0.0, 0.35, d);
    float cellPx = mix(48.0, 6.0, focus * (0.5 + 0.5 * uPointerActive));
    vec2 cell = floor(vUv * uResolution / cellPx) * cellPx;
    vec2 center = (cell + cellPx * 0.5) / uResolution;
    vec3 col = sampleVideo(center);
    col = floor(col * 6.0) / 6.0;
    gl_FragColor = vec4(col, 1.0);
  `,
};
