export default {
  id: 'HexPixel',
  title: 'HEX',
  subtitle: 'HEXAGONAL GRID',
  category: 'PURE',
  preview: 'hexpixel',
  hud: 'HEX — cursor area sharpens (smaller hexes)',
  shader: /* glsl */ `
    vec2 px = vUv * uResolution;
    // Hex size shrinks near the pointer — sharper detail there.
    float dToPointer = distance(vUv, uPointer);
    float focus = smoothstep(0.30, 0.0, dToPointer) * (0.5 + 0.5 * uPointerActive);
    float size = mix(28.0, 6.0, focus);
    float sq3 = sqrt(3.0);
    float q = (px.x * sq3/3.0 - px.y / 3.0) / size;
    float r = (px.y * 2.0/3.0) / size;
    vec3 cube = vec3(q, r, -q - r);
    vec3 rcube = floor(cube + 0.5);
    vec3 diff = abs(rcube - cube);
    if (diff.x > diff.y && diff.x > diff.z) rcube.x = -rcube.y - rcube.z;
    else if (diff.y > diff.z) rcube.y = -rcube.x - rcube.z;
    else rcube.z = -rcube.x - rcube.y;
    vec2 center;
    center.x = size * (sq3 * rcube.x + sq3/2.0 * rcube.y);
    center.y = size * (3.0/2.0 * rcube.y);
    vec2 sampleUv = center / uResolution;
    vec3 col = sampleVideo(sampleUv);
    vec2 fromCenter = (px - center);
    float d = length(fromCenter);
    float edge = smoothstep(size * 0.85, size * 0.95, d);
    col = mix(col, col * 0.4, edge);
    gl_FragColor = vec4(col, 1.0);
  `,
};
