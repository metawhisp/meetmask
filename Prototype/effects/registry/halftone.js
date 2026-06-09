export default {
  id: 'Halftone',
  title: 'HALFTONE',
  subtitle: 'NEWSPAPER DOTS',
  category: 'PURE',
  preview: 'halftone',
  hud: 'HALFTONE — cursor pulls extra ink into the dots',
  shader: /* glsl */ `
    float cellPx = 10.0;
    vec2 cell = floor(vUv * uResolution / cellPx) * cellPx;
    vec2 center = (cell + cellPx * 0.5) / uResolution;
    float l = luma(sampleVideo(center));
    // Pointer pulls ink into nearby dots so they swell up.
    float dToP = distance(center, uPointer);
    float ink = (1.0 - smoothstep(0.0, 0.22, dToP)) * (0.5 + 0.6 * uPointerActive);
    l = max(0.0, l - ink);
    vec2 toCenter = (vUv * uResolution - cell - cellPx * 0.5);
    float dist = length(toCenter);
    float radius = (1.0 - l) * (cellPx * 0.55);
    float dot = smoothstep(radius + 0.6, radius - 0.6, dist);
    gl_FragColor = vec4(vec3(1.0 - dot), 1.0);
  `,
};
