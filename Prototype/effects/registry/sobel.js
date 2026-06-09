export default {
  id: 'Sobel',
  title: 'EDGES',
  subtitle: 'SOBEL OPERATOR',
  category: 'PURE',
  preview: 'sobel',
  hud: 'EDGES — cursor is a flashlight showing the real frame',
  shader: /* glsl */ `
    vec2 px = 1.0 / uResolution;
    float tl = luma(sampleVideo(vUv + vec2(-px.x,  px.y)));
    float t  = luma(sampleVideo(vUv + vec2(0.0,    px.y)));
    float tr = luma(sampleVideo(vUv + vec2( px.x,  px.y)));
    float l_ = luma(sampleVideo(vUv + vec2(-px.x, 0.0)));
    float r  = luma(sampleVideo(vUv + vec2( px.x, 0.0)));
    float bl = luma(sampleVideo(vUv + vec2(-px.x,-px.y)));
    float b  = luma(sampleVideo(vUv + vec2(0.0,  -px.y)));
    float br = luma(sampleVideo(vUv + vec2( px.x,-px.y)));
    float gx = -tl - 2.0*l_ - bl + tr + 2.0*r + br;
    float gy = -tl - 2.0*t  - tr + bl + 2.0*b + br;
    float g  = sqrt(gx*gx + gy*gy);
    g = smoothstep(0.08, 0.5, g);
    vec3 edge = vec3(g);
    // Pointer = spotlight that reveals the real video locally.
    float dToP = distance(vUv, uPointer);
    float spot = (1.0 - smoothstep(0.0, 0.18, dToP)) * (0.4 + 0.6 * uPointerActive);
    vec3 col = sampleVideo(vUv);
    gl_FragColor = vec4(mix(edge, col, spot), 1.0);
  `,
};
