export default {
  id: 'VHS',
  title: 'VHS',
  subtitle: 'ANALOG TAPE',
  category: 'PURE',
  preview: 'vhs',
  hud: 'VHS — cursor Y tears the tape, click to slip the head',
  shader: /* glsl */ `
    vec2 uv = vUv;
    float jitter = (hash(vec2(floor(uv.y * uResolution.y * 0.4), floor(uTime * 30.0))) - 0.5) * 0.02;
    uv.x += jitter;
    float glitch = step(0.97, hash(vec2(floor(uTime * 4.0), floor(uv.y * 20.0)))) * 0.08;
    uv.x += glitch;
    // A horizontal tear that follows the cursor's vertical position.
    float dY = abs(uv.y - uPointer.y);
    float tear = (1.0 - smoothstep(0.0, 0.035, dY)) * (0.18 + 0.35 * uPointerActive);
    uv.x += tear * (hash(vec2(floor(uTime * 60.0), floor(uv.y * 80.0))) - 0.5);
    vec3 col;
    col.r = sampleVideo(uv + vec2( 0.008, 0.0)).r;
    col.g = sampleVideo(uv).g;
    col.b = sampleVideo(uv + vec2(-0.008, 0.0)).b;
    col *= 0.82 + 0.18 * sin(uv.y * uResolution.y * PI);
    col = col * vec3(1.08, 0.95, 0.95) + vec3(0.04, 0.0, 0.06);
    // Bright streak right at the tear line
    col += vec3(0.6, 0.05, 0.3) * (1.0 - smoothstep(0.0, 0.005, dY)) * uPointerActive;
    gl_FragColor = vec4(col, 1.0);
  `,
};
