export default {
  id: 'LineRain',
  title: 'RAIN',
  subtitle: 'FALLING TRAILS',
  category: 'PURE',
  preview: 'lineRain',
  hud: 'RAIN — click to strike lightning from the cursor down',
  shader: /* glsl */ `
    vec2 px = vUv * uResolution;
    float colId = floor(px.x / 10.0);
    float speed = 80.0 + hash(vec2(colId, 0.0)) * 60.0;
    float fall = mod(uTime * speed + hash(vec2(colId, 0.0)) * 200.0, uResolution.y + 100.0);
    float yDist = abs(px.y - fall);
    float trail = exp(-yDist * 0.04);
    vec3 col = sampleVideo(vUv) * 0.3;
    col += vec3(0.05, trail * 1.2, trail * 0.4);
    // Lightning column following the pointer X, descending from pointer Y.
    vec2 pPx = uPointer * uResolution;
    float xDist = abs(px.x - pPx.x);
    float column = exp(-xDist * 0.04);
    // remember: vUv.y up, pPx.y up — bolt extends to BELOW pointer (smaller y)
    float belowPointer = step(px.y, pPx.y);
    float bolt = column * belowPointer * uPointerActive;
    col += vec3(0.6, 1.0, 0.8) * bolt * 0.7;
    gl_FragColor = vec4(col, 1.0);
  `,
};
