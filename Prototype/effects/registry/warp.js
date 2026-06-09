export default {
  id: 'PixelWarp',
  title: 'WARP',
  subtitle: 'RGB SHIFT + NOISE',
  category: 'PURE',
  preview: 'warp',
  hud: 'WARP — drag to distort',
  shader: /* glsl */ `
    vec2 p = uPointer;
    float d = distance(vUv, p);
    float pointerInfluence = uPointerActive * smoothstep(0.45, 0.0, d);

    float n1 = fbm(vUv * 5.0 + uTime * 0.35) - 0.5;
    float n2 = fbm(vUv * 12.0 - uTime * 0.6) - 0.5;
    vec2 disp = vec2(n1, n2) * 0.025;
    disp += (vUv - p) * pointerInfluence * 0.18;

    float bandY = vUv.y * uResolution.y;
    float band = step(0.92, hash(vec2(floor(bandY / 6.0), floor(uTime * 12.0))));
    disp.x += band * 0.05;

    vec2 offR = disp + vec2( 0.006 + 0.018 * pointerInfluence, 0.0);
    vec2 offG = disp;
    vec2 offB = disp + vec2(-0.006 - 0.018 * pointerInfluence, 0.0);

    float r = sampleVideo(vUv + offR).r;
    float g = sampleVideo(vUv + offG).g;
    float b = sampleVideo(vUv + offB).b;
    vec3 col = vec3(r, g, b);

    col = pow(col, vec3(0.92));
    col = (col - 0.5) * 1.15 + 0.5;
    col *= 0.85 + 0.15 * sin(vUv.y * uResolution.y * PI);
    float vig = smoothstep(1.1, 0.4, length(vUv - 0.5));
    col *= mix(0.55, 1.0, vig);
    col += (hash(vUv * uResolution + uTime * 60.0) - 0.5) * 0.08;
    gl_FragColor = vec4(col, 1.0);
  `,
};
