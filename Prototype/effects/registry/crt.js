export default {
  id: 'CRT',
  title: 'CRT',
  subtitle: 'PHOSPHOR + GLASS',
  category: 'EXPERIMENTAL',
  preview: 'crt',
  hud: 'CRT — cursor magnetises the electron beam (bend & scanline bow)',
  shader: /* glsl */ `
    // Glass center moves toward the cursor — like sticking a magnet to a CRT.
    vec2 glassCenter = mix(vec2(0.5), uPointer, 0.6);
    vec2 p = vUv - glassCenter;
    float r2 = dot(p, p);
    vec2 uv = p * (1.0 + r2 * (0.25 + 0.35 * uPointerActive)) + glassCenter;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      vec3 col = sampleVideo(uv);
      vec2 px = uv * uResolution;
      float maskX = mod(px.x, 3.0);
      vec3 mask = vec3(
        step(0.0, maskX) * step(maskX, 1.0),
        step(1.0, maskX) * step(maskX, 2.0),
        step(2.0, maskX) * step(maskX, 3.0)
      );
      col *= mix(vec3(1.0), mask * 3.0, 0.55);
      // Scanlines bow toward the cursor — magnet visual.
      float bow = (uPointer.y - vUv.y) * (1.0 - distance(vUv.x, uPointer.x)) * 60.0 * uPointerActive;
      float scan = 0.82 + 0.18 * sin((px.y + bow) * PI * 0.85);
      col *= scan;
      float vig = smoothstep(1.2, 0.4, length(vUv - glassCenter));
      col *= mix(0.35, 1.0, vig);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
