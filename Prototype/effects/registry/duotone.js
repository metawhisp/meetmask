export default {
  id: 'Duotone',
  title: 'DUOTONE',
  subtitle: 'PINK + INK',
  category: 'PURE',
  preview: 'duotone',
  hud: 'DUOTONE — cursor X rotates the palette through the spectrum',
  shader: /* glsl */ `
    float l = luma(sampleVideo(vUv));
    // Pointer X picks a hue; we build a duotone around it.
    float h = uPointer.x;
    vec3 light = hue2rgb(h);
    vec3 dark  = 0.10 * hue2rgb(h + 0.5);
    // Click = boost saturation: push extremes toward black/white.
    light = mix(light, vec3(1.0), 0.25 * uPointerActive);
    dark  = mix(dark,  vec3(0.0), 0.5  * uPointerActive);
    vec3 col = mix(dark, light, smoothstep(0.05, 0.95, l));
    gl_FragColor = vec4(col, 1.0);
  `,
};
