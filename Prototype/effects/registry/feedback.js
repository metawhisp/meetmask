export default {
  id: 'Feedback',
  title: 'TRAIL',
  subtitle: 'RADIAL ZOOM',
  category: 'EXPERIMENTAL',
  preview: 'feedback',
  hud: 'TRAIL — zoom epicenter follows the cursor (click for warp speed)',
  shader: /* glsl */ `
    // Zoom epicenter follows the cursor.
    vec2 center = uPointer;
    vec2 p = vUv - center;
    vec3 col = vec3(0.0);
    float total = 0.0;
    float step = 0.022 + 0.04 * uPointerActive;   // tighter step = stronger trail
    for (int i = 0; i < 10; i++) {
      float s = 1.0 - float(i) * step;
      vec2 uv = p * s + center;
      float w = pow(0.85, float(i));
      col += sampleVideo(clamp(uv, 0.0, 1.0)) * w;
      total += w;
    }
    col /= total;
    col = mix(col, col * vec3(0.6, 0.9, 1.3), 0.4);
    gl_FragColor = vec4(col, 1.0);
  `,
};
