export default {
  id: 'Polar',
  title: 'POLAR',
  subtitle: 'SWIRL TWIST',
  category: 'PURE',
  preview: 'polar',
  hud: 'POLAR — cursor is the twist center; click to wind it up',
  shader: /* glsl */ `
    vec2 c = uPointer;
    vec2 p = vUv - c;
    float r = length(p);
    float a = atan(p.y, p.x);
    // Wind tighter the closer you are to the center; click reinforces it.
    a += sin(r * 8.0 - uTime * 0.6) * 0.5;
    a += (0.6 + 1.4 * uPointerActive) * exp(-r * 3.0);
    vec2 uv = c + vec2(cos(a), sin(a)) * r;
    vec3 col = sampleVideo(clamp(uv, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  `,
};
