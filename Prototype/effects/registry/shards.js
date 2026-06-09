export default {
  id: 'Shards',
  title: 'SHARDS',
  subtitle: 'VORONOI SHATTER',
  category: 'EXPERIMENTAL',
  preview: 'shards',
  hud: 'SHARDS — drag to explode shards outward from your cursor',
  shader: /* glsl */ `
    // Pointer becomes a shockwave: shards near it get pushed outward.
    vec2 toPointer = vUv - uPointer;
    float dToP = length(toPointer);
    float push = uPointerActive * smoothstep(0.6, 0.0, dToP) * 0.4;
    vec2 displacedUv = vUv + normalize(toPointer + 1e-6) * push;
    vec2 p = displacedUv * 12.0;
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float minDist = 99.0;
    float secondDist = 99.0;
    vec2 closest = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 neighbor = vec2(float(i), float(j));
        vec2 seed = ip + neighbor;
        vec2 jitter = vec2(hash(seed), hash(seed + 17.0));
        jitter += 0.15 * vec2(
          sin(uTime + hash(seed) * 6.28),
          cos(uTime + hash(seed + 9.0) * 6.28)
        );
        vec2 cellPoint = neighbor + jitter;
        float d = length(cellPoint - fp);
        if (d < minDist) {
          secondDist = minDist;
          minDist = d;
          closest = seed + jitter;
        } else if (d < secondDist) {
          secondDist = d;
        }
      }
    }
    vec2 sampleUv = closest / 12.0;
    vec3 col = sampleVideo(sampleUv);
    float edge = smoothstep(0.0, 0.04, secondDist - minDist);
    col *= edge;
    gl_FragColor = vec4(col, 1.0);
  `,
};
