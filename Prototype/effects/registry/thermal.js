export default {
  id: 'Thermal',
  title: 'THERMAL',
  subtitle: 'INFRARED PALETTE',
  category: 'PURE',
  preview: 'thermal',
  hud: 'THERMAL — move cursor: hot spot follows you',
  shader: /* glsl */ `
    vec3 col = sampleVideo(vUv);
    float l = luma(col);
    // Pointer = heat source. Adds warmth in a soft radius, stronger while held.
    float d = distance(vUv, uPointer);
    float heat = (1.0 - smoothstep(0.0, 0.28, d)) * (0.35 + 0.55 * uPointerActive);
    l = clamp(l + heat, 0.0, 1.0);
    vec3 thermal;
    if (l < 0.25)      thermal = mix(vec3(0.02, 0.0, 0.10), vec3(0.30, 0.0, 0.70), l / 0.25);
    else if (l < 0.5)  thermal = mix(vec3(0.30, 0.0, 0.70), vec3(1.00, 0.20, 0.10), (l - 0.25) / 0.25);
    else if (l < 0.75) thermal = mix(vec3(1.00, 0.20, 0.10), vec3(1.00, 0.85, 0.10), (l - 0.50) / 0.25);
    else               thermal = mix(vec3(1.00, 0.85, 0.10), vec3(1.0), (l - 0.75) / 0.25);
    gl_FragColor = vec4(thermal, 1.0);
  `,
};
