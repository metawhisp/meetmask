export default {
  id: 'Fisheye',
  title: 'FISHEYE',
  subtitle: 'BARREL LENS',
  category: 'PURE',
  preview: 'fisheye',
  hud: 'FISHEYE — lens center follows the cursor',
  shader: /* glsl */ `
    // Lens center pulled to cursor; barrel strength swells while held.
    vec2 lens = mix(vec2(0.5), uPointer, 0.7);
    vec2 p = vUv - lens;
    float r2 = dot(p, p);
    float k = 1.0 + r2 * (1.4 + 1.6 * uPointerActive);
    vec2 uv = p * k + lens;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      vec3 col = sampleVideo(uv);
      col.r = sampleVideo(p * (k * 1.01) + lens).r;
      col.b = sampleVideo(p * (k * 0.99) + lens).b;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
