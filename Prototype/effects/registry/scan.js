export default {
  id: 'Scan',
  title: 'SCAN',
  subtitle: 'REVEAL LINE',
  category: 'EXPERIMENTAL',
  preview: 'scan',
  hud: 'SCAN — line follows cursor Y; click to freeze + bright flash',
  shader: /* glsl */ `
    vec3 col = sampleVideo(vUv);
    float L = luma(col);
    // Auto-sweep when idle, follow cursor when held.
    float autoBand = mod(uTime * 0.32, 1.2) - 0.1;
    float band = mix(autoBand, uPointer.y, uPointerActive);
    float dist = abs(vUv.y - band);
    float reveal = smoothstep(0.18, 0.0, dist);
    vec3 gray = vec3(L);
    vec3 result = mix(gray, col, reveal);
    // The glowing line — thicker + warmer while you're holding.
    float thickness = 36.0 - 18.0 * uPointerActive;
    vec3 lineCol = mix(vec3(0.0, 1.0, 0.8), vec3(1.0, 0.4, 0.6), uPointerActive);
    result += lineCol * exp(-dist * thickness) * 0.8;
    gl_FragColor = vec4(result, 1.0);
  `,
};
