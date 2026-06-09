export default {
  id: 'Bloom',
  title: 'BLOOM',
  subtitle: 'NEON HIGHLIGHTS',
  category: 'PURE',
  preview: 'bloom',
  hud: 'BLOOM — cursor drops a lens flare wherever you go',
  shader: /* glsl */ `
    vec3 col = sampleVideo(vUv);
    vec2 px = 1.0 / uResolution;
    vec3 blur = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float a = float(i) * (TAU / 6.0);
      vec2 off = vec2(cos(a), sin(a)) * 8.0 * px;
      vec3 s = sampleVideo(vUv + off);
      blur += max(s - 0.5, 0.0) * 2.0;
    }
    blur /= 6.0;
    vec3 result = col + blur * 1.5;
    // Pointer drops a warm flare. Stronger when held.
    float d = distance(vUv, uPointer);
    float core = 1.0 - smoothstep(0.0, 0.05, d);
    float halo = 1.0 - smoothstep(0.0, 0.28, d);
    vec3 flare = vec3(1.0, 0.85, 0.55) * (core * 1.2 + halo * 0.4);
    result += flare * (0.5 + 0.7 * uPointerActive);
    result = pow(result, vec3(0.9));
    gl_FragColor = vec4(result, 1.0);
  `,
};
