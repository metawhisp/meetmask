export default {
  id: 'Crosshatch',
  title: 'HATCH',
  subtitle: 'PENCIL SKETCH',
  category: 'PURE',
  preview: 'crosshatch',
  hud: 'HATCH — cursor presses harder, more ink lines appear',
  shader: /* glsl */ `
    vec3 col = sampleVideo(vUv);
    float l = luma(col);
    float darkness = 1.0 - l;
    // Pointer = pen pressure. Adds darkness so more hatching layers turn on.
    float d = distance(vUv, uPointer);
    darkness += (1.0 - smoothstep(0.0, 0.22, d)) * (0.25 + 0.5 * uPointerActive);
    vec2 p = vUv * uResolution * 0.5;
    float hatch = 1.0;
    float h1 = sin((p.x + p.y) * 0.5);
    if (darkness > 0.2) hatch = min(hatch, smoothstep(0.0, 0.07, abs(h1)));
    float h2 = sin((p.x - p.y) * 0.5);
    if (darkness > 0.45) hatch = min(hatch, smoothstep(0.0, 0.07, abs(h2)));
    float h3 = sin(p.y * 0.7);
    if (darkness > 0.65) hatch = min(hatch, smoothstep(0.0, 0.07, abs(h3)));
    float h4 = sin(p.x * 0.7);
    if (darkness > 0.85) hatch = min(hatch, smoothstep(0.0, 0.07, abs(h4)));
    vec3 paper = vec3(0.96, 0.93, 0.85);
    vec3 ink   = vec3(0.06, 0.04, 0.02);
    gl_FragColor = vec4(mix(ink, paper, hatch), 1.0);
  `,
};
