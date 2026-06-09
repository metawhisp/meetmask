export default {
  id: 'PixelDrift',
  title: 'DRIFT',
  subtitle: 'PULL TOWARD CURSOR',
  category: 'EXPERIMENTAL',
  preview: 'pixelDrift',
  hud: 'DRIFT — drag a point; pixels gravitate',
  shader: /* glsl */ `
    vec2 p = uPointer;
    vec2 dir = p - vUv;
    float dist = length(dir);
    float falloff = exp(-dist * 4.0) * (0.2 + 0.8 * uPointerActive);
    vec2 uv = vUv + dir * falloff * 0.25;
    vec3 col = sampleVideo(uv);
    // soft highlight at the gravity center
    col += vec3(0.4, 0.6, 1.0) * exp(-dist * 40.0) * uPointerActive;
    gl_FragColor = vec4(col, 1.0);
  `,
};
