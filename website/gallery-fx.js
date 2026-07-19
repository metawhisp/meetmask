/* MEETAMASK gallery FX — one unified 16-bit + ASCII animated style, one tile per preset.
   Each mask maps to an animated "motif" (field over a grid) + a 16-bit palette. Tiles render
   as live <canvas data-fx="slug">; only on-screen tiles animate (IntersectionObserver). */
(function () {
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const fract = (v) => v - Math.floor(v);
  const TAU = Math.PI * 2;
  const N = 30, CX = (N - 1) / 2, CY = (N - 1) / 2;      // glyph grid (chunky 16-bit)
  const CELL = 12, PX = N * CELL;                         // 360px internal
  const RAMP = " .:-=+*ox#░▒▓█";
  const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
  const SEEDS = []; for (let i = 0; i < 22; i++) SEEDS.push([hash(i, 7) * N, hash(i * 1.3, 13) * N]);

  // ---------- animated motifs: factory(params) -> field(gx,gy,t) in 0..1 ----------
  const M = {
    radial: (o = {}) => { const sp = o.sp ?? 1.6, rings = o.rings ?? 5, rad = o.rad ?? 0.55, amp = o.amp ?? 0.16, base = o.base ?? 1;
      return (x, y, t) => { const d = Math.hypot(x - CX, y - CY) / (N * rad); return clamp((1 - d) * base + amp * Math.sin(t * sp - d * rings)); }; },
    rings: (o = {}) => { const sp = o.sp ?? 1.2, n = o.n ?? 3;
      return (x, y, t) => { const d = Math.hypot(x - CX, y - CY) / (N * 0.5); let v = 0.06; for (let i = 0; i < n; i++) { const r = fract(t * sp * 0.3 + i / n); v = Math.max(v, clamp(1 - Math.abs(d - r) / 0.1) * (1 - r)); } return v; }; },
    flames: (o = {}) => { const sp = o.sp ?? 5, w = o.w ?? 0.45;
      return (x, y, t) => { const base = Math.max(0, 1 - y / N), taper = Math.max(0, 1 - Math.abs(x - CX) / (N * w)), turb = 0.5 + 0.5 * Math.sin(x * 0.9 + t * sp + Math.sin(y * 0.5 - t * sp * 0.8) * 1.8); return base * taper * (0.45 + 0.75 * turb); }; },
    spiral: (o = {}) => { const arms = o.arms ?? 2, tw = o.tw ?? 9, sp = o.sp ?? 3, dir = o.dir ?? 1;
      return (x, y, t) => { const dx = x - CX, dy = y - CY, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy) / (N * 0.5); return clamp((0.5 + 0.5 * Math.sin(a * arms + r * tw - t * sp * dir)) * (1 - r) + (1 - r) * 0.35); }; },
    streaks: (o = {}) => { const sp = o.sp ?? 1.3, thr = o.thr ?? 0.5, rows = o.rows ?? 2, head = o.head ?? 0;
      return (x, y, t) => { const c = hash(x, 0); if (c <= thr) return 0.04; const p = fract(y / N * rows + c * 5 + t * sp); let v = 0.2 + 0.8 * (1 - p); if (head) v *= (p > 0.85 ? 1 : 0.62); return v; }; },
    scan: (o = {}) => { const sp = o.sp ?? 0.4, band = o.band ?? 0.14, dir = o.dir ?? 1;
      return (x, y, t) => { const yl = fract(t * sp * dir); const d = Math.abs(y / N - yl); const grid = 0.1 + 0.1 * Math.sin(x * 1.2) * Math.sin(y * 0.6); return Math.max(clamp(grid), 1 - d / band); }; },
    kaleido: (o = {}) => { const seg = o.seg ?? 6, sp = o.sp ?? 2;
      return (x, y, t) => { const dx = x - CX, dy = y - CY, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy) / (N * 0.55); return clamp(0.5 + 0.5 * Math.sin(r * 7 - t * sp) * Math.cos(a * seg + t * 0.6)); }; },
    plasma: (o = {}) => { const sp = o.sp ?? 1, sc = o.sc ?? 0.4;
      return (x, y, t) => 0.5 + 0.5 * (Math.sin(x * sc + t * sp) + Math.sin(y * sc * 1.2 - t * sp * 0.8) + Math.sin((x + y) * sc * 0.7 + t * sp * 1.3) + Math.sin(Math.hypot(x - CX, y - CY) * sc * 1.2 - t * sp)) / 4; },
    glitch: (o = {}) => { const sp = o.sp ?? 3;
      return (x, y, t) => { const row = Math.floor(y), tick = Math.floor(t * sp), j = (hash(row, tick) - 0.5) * 8, band = hash(row, tick * 0.5); const v = 0.4 + 0.5 * Math.sin((x + j) * 0.5 + row * 0.4 + t) + (band > 0.85 ? 0.4 : 0); return clamp(v * (0.55 + 0.6 * band)); }; },
    blocks: (o = {}) => { const bs = o.bs ?? 3, sp = o.sp ?? 1, sc = o.sc ?? 0.5;
      return (x, y, t) => { const bx = Math.floor(x / bs) * bs, by = Math.floor(y / bs) * bs; return clamp(0.5 + 0.5 * (Math.sin(bx * sc + t * sp) + Math.sin(by * sc - t * sp * 0.7) + Math.sin((bx + by) * sc * 0.6 + t * sp)) / 3 + 0.15); }; },
    outline: (o = {}) => { const sp = o.sp ?? 1.5, rr = o.rr ?? 0.42, th = o.th ?? 0.1;
      return (x, y, t) => { const d = Math.hypot(x - CX, y - CY) / N; const ring = rr + 0.06 * Math.sin(t * sp); const face = clamp(1 - Math.abs(d - ring) / th); const eyes = Math.max(0, 1 - Math.min(Math.hypot(x - (CX - 5), y - (CY - 3)), Math.hypot(x - (CX + 5), y - (CY - 3))) / 2.5) * 0.85; const mouth = Math.max(0, 1 - Math.abs(y - (CY + 6)) / 1.5) * Math.max(0, 1 - Math.abs(x - CX) / 5) * 0.7; return Math.max(face, eyes, mouth); }; },
    mesh: (o = {}) => { const sp = o.sp ?? 1, g = o.g ?? 5;
      return (x, y, t) => { const fx = Math.abs(fract(x / g + 0.03 * Math.sin(t * sp)) - 0.5), fy = Math.abs(fract(y / g) - 0.5), fd = Math.abs(fract((x + y) / g) - 0.5); const line = Math.max(1 - fx * 6, 1 - fy * 6, 1 - fd * 6); const d = Math.hypot(x - CX, y - CY) / (N * 0.55); return clamp(line * (1.2 - d * 0.45) + 0.05); }; },
    dots: (o = {}) => { const sp = o.sp ?? 2; const P = []; for (let a = 0; a < TAU; a += TAU / 15) P.push([CX + Math.cos(a) * N * 0.3, CY + Math.sin(a) * N * 0.34]); P.push([CX - 5, CY - 3], [CX + 5, CY - 3], [CX - 6, CY - 8], [CX + 6, CY - 8], [CX, CY], [CX, CY + 3]); for (let i = -4; i <= 4; i += 2) P.push([CX + i, CY + 7]);
      return (x, y, t) => { let v = 0.04; for (let i = 0; i < P.length; i++) { const pl = 0.6 + 0.4 * Math.sin(t * sp + i * 0.7); v = Math.max(v, Math.max(0, 1 - Math.hypot(x - P[i][0], y - P[i][1]) / 1.5) * pl); } return v; }; },
    lines: (o = {}) => { const sp = o.sp ?? 1.6;
      return (x, y, t) => { const p = 0.75 + 0.25 * Math.sin(t * sp); const eL = Math.max(0, 1 - Math.hypot((x - (CX - 5)) / 2.4, (y - (CY - 3)) / 0.9)); const eR = Math.max(0, 1 - Math.hypot((x - (CX + 5)) / 2.4, (y - (CY - 3)) / 0.9)); const mo = Math.max(0, 1 - Math.hypot((x - CX) / 5, (y - (CY + 6) + Math.abs(x - CX) * 0.06) / 0.8)); const jaw = clamp(1 - Math.abs(Math.hypot(x - CX, (y - CY) * 0.95) / N - 0.42) / 0.09) * 0.28; return Math.max(eL * p, eR * p, mo * p, jaw) + 0.03; }; },
    hatch: (o = {}) => { const sp = o.sp ?? 1, g = o.g ?? 3.2;
      return (x, y, t) => { const a = Math.sin((x + y) / g + t * sp * 0.3), b = Math.sin((x - y) / g - t * sp * 0.2); const v = Math.max(a, b) * 0.5 + 0.5; const d = Math.hypot(x - CX, y - CY) / (N * 0.55); return clamp((v > 0.62 ? v : 0.08) * (1.1 - d * 0.5)); }; },
    beams: (o = {}) => { const sp = o.sp ?? 3;
      return (x, y, t) => { let v = 0.05; const eyes = [[CX - 5, CY - 3, -1], [CX + 5, CY - 3, 1]]; for (const [ex, ey, dir] of eyes) { const dx = x - ex, dy = y - ey; if (dy < 0) continue; const line = dir * dy * 0.35; const off = Math.abs(dx - line); const beam = Math.max(0, 1 - off / (1.2 + dy * 0.12)) * Math.max(0, 1 - dy / N); const flick = 0.7 + 0.3 * Math.sin(t * sp * 3 + dy * 0.5); v = Math.max(v, beam * flick); const glow = Math.max(0, 1 - Math.hypot(dx, dy) / 3) * 0.8; v = Math.max(v, glow); } return v; }; },
    particles: (o = {}) => { const n = o.n ?? 6, sp = o.sp ?? 1, rad = o.rad ?? 0.32, size = o.size ?? 3.2;
      return (x, y, t) => { let v = 0.04; for (let i = 0; i < n; i++) { const ph = i * (TAU / n); const px = CX + Math.cos(t * sp + ph) * (N * rad) * (0.6 + 0.4 * Math.sin(t * 0.5 + i)); const py = CY + Math.sin(t * sp * 1.1 + ph * 1.3) * (N * rad); v = Math.max(v, Math.max(0, 1 - Math.hypot(x - px, y - py) / size)); } return v; }; },
    shatter: (o = {}) => { const sp = o.sp ?? 1;
      return (x, y, t) => { let d1 = 1e9, d2 = 1e9; for (const s of SEEDS) { const jx = s[0] + Math.sin(t * sp + s[1]) * 0.6, jy = s[1] + Math.cos(t * sp + s[0]) * 0.6; const d = (x - jx) ** 2 + (y - jy) ** 2; if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } const edge = Math.sqrt(d2) - Math.sqrt(d1); const crack = clamp(1 - edge / 1.6); const cell = 0.25 + 0.55 * hash(Math.round(x / 2), Math.round(y / 2)); return Math.max(crack, cell * 0.6); }; },
    twinkle: (o = {}) => { const sp = o.sp ?? 2, dens = o.dens ?? 0.12;
      return (x, y, t) => { const h = hash(x, y); if (h > 1 - dens) return clamp(0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * sp + h * 30))); return 0.05; }; },
    eyes: (o = {}) => { const sp = o.sp ?? 1.2;
      return (x, y, t) => { const ring = clamp(1 - Math.abs(Math.hypot(x - CX, y - CY) / N - 0.4) / 0.12) * 0.35; const e = Math.min(Math.hypot(x - (CX - 6), (y - CY) * 1.2), Math.hypot(x - (CX + 6), (y - CY) * 1.2)); const iris = clamp(1 - e / 4.5) * (0.75 + 0.25 * Math.sin(t * sp)); const pupil = clamp(1 - Math.min(Math.hypot(x - (CX - 6), y - CY), Math.hypot(x - (CX + 6), y - CY)) / 1.9); return Math.max(ring, iris, pupil); }; },
  };

  const PAL = {
    heat: ['#140626', '#5a1a7a', '#b52a5a', '#ff6a1a', '#ffcf3a', '#fff2c0'],
    fire: ['#160402', '#6a1200', '#d63a08', '#ff7a1a', '#ffce3a', '#fff3c8'],
    violet: ['#080a1e', '#2a1e6a', '#5a3ad0', '#7c6bff', '#4ad0ff', '#eaf6ff'],
    ice: ['#0a0f18', '#12324a', '#1e6a8a', '#3aa0c8', '#9fe0ff', '#dff4ff'],
    green: ['#020602', '#063a1a', '#0e7a34', '#28c85a', '#7fffa8', '#d9ffe6'],
    rainbow: ['#140a20', '#8a5cff', '#ff5a8b', '#ffd23f', '#3ad0ff', '#eafff5'],
    ink: ['#0b0b0d', '#2a2a2e', '#55555c', '#8f8c85', '#c7c7c7', '#f7f4ee'],
    pink: ['#160610', '#4a0f2e', '#a11f5a', '#ff4f8b', '#ff9ec4', '#ffe3ef'],
    amber: ['#0d0a06', '#3a2a08', '#8a6a10', '#e0a41f', '#ffd257', '#fff2c8'],
    cyan: ['#04121a', '#0a3a4a', '#127a8a', '#22c8d8', '#7ffff0', '#d9fffa'],
    red: ['#160404', '#5a0a0a', '#c81f1f', '#ff4a4a', '#ff9a7a', '#ffe0d0'],
    toxic: ['#08160f', '#0f3a2a', '#1f7a4a', '#35d07f', '#a8ffd0', '#e6fff2'],
  };

  // ---------- registry: every mask slug -> {f: field, pal} ----------
  const FX = {
    // HAND
    catattack: { f: M.particles({ n: 5, sp: 2.2, size: 3.6 }), pal: PAL.amber },
    realitytear: { f: M.shatter({ sp: 1.4 }), pal: PAL.violet },
    gesturespells: { f: M.particles({ n: 6, sp: 1.4, rad: 0.36 }), pal: PAL.rainbow },
    portalpull: { f: M.spiral({ sp: 3 }), pal: PAL.violet },
    fingerpaint: { f: M.particles({ n: 4, sp: 1.1, size: 4.2 }), pal: PAL.rainbow },
    // FACE
    snowpile: { f: M.streaks({ sp: 0.5, thr: 0.35, rows: 1.4 }), pal: PAL.ice },
    facegravity: { f: M.streaks({ sp: 0.7, thr: 0.2, rows: 1.6 }), pal: PAL.violet },
    headbang: { f: M.flames({ sp: 7, w: 0.5 }), pal: PAL.amber },
    aurascan: { f: M.rings({ sp: 1.4 }), pal: PAL.cyan },
    stareoff: { f: M.eyes({ sp: 1 }), pal: PAL.cyan },
    posestages: { f: M.scan({ sp: 0.35, band: 0.16 }), pal: PAL.rainbow },
    timeecho: { f: M.rings({ sp: 1.1, n: 4 }), pal: PAL.violet },
    glasses: { f: M.glitch({ sp: 2 }), pal: PAL.cyan },
    icecream: { f: M.streaks({ sp: 0.6, thr: 0.4, rows: 1.3 }), pal: PAL.pink },
    mouthfire: { f: M.flames({ sp: 6 }), pal: PAL.fire },
    facemask: { f: M.blocks({ bs: 4, sp: 1 }), pal: PAL.violet },
    eyelasers: { f: M.beams({ sp: 3 }), pal: PAL.red },
    facedots: { f: M.dots({ sp: 2 }), pal: PAL.cyan },
    facemesh: { f: M.mesh({ sp: 1, g: 5 }), pal: PAL.cyan },
    facefill: { f: M.radial({ sp: 2, rings: 4 }), pal: PAL.pink },
    facelines: { f: M.lines({ sp: 1.6 }), pal: PAL.pink },
    eyezoom: { f: M.radial({ sp: 2.4, rings: 6, rad: 0.4 }), pal: PAL.violet },
    // PURE
    asciicam: { f: M.streaks({ sp: 1.2, thr: 0.45, rows: 2, head: 1 }), pal: PAL.green },
    pixelwarp: { f: M.plasma({ sp: 1.4, sc: 0.5 }), pal: PAL.rainbow },
    thermal: { f: M.radial({ sp: 1.6, rings: 5 }), pal: PAL.heat },
    halftone: { f: M.radial({ sp: 0.8, rings: 2, amp: 0.05 }), pal: PAL.ink },
    sobel: { f: M.outline({ sp: 1.4 }), pal: PAL.green },
    invert: { f: M.glitch({ sp: 2.4 }), pal: PAL.ink },
    mosaic: { f: M.blocks({ bs: 4, sp: 1.2 }), pal: PAL.rainbow },
    kaleidoscope: { f: M.kaleido({ sp: 2 }), pal: PAL.rainbow },
    vhs: { f: M.glitch({ sp: 3 }), pal: PAL.amber },
    duotone: { f: M.plasma({ sp: 1, sc: 0.35 }), pal: PAL.pink },
    posterize: { f: M.plasma({ sp: 0.9, sc: 0.4 }), pal: PAL.amber },
    caustics: { f: M.plasma({ sp: 1.2, sc: 0.45 }), pal: PAL.ice },
    fisheye: { f: M.radial({ sp: 1.4, rings: 7, rad: 0.42 }), pal: PAL.cyan },
    bleach: { f: M.plasma({ sp: 0.8, sc: 0.35 }), pal: PAL.ink },
    hexpixel: { f: M.blocks({ bs: 3, sp: 1 }), pal: PAL.green },
    polar: { f: M.spiral({ arms: 1, tw: 6, sp: 2.5 }), pal: PAL.violet },
    linerain: { f: M.streaks({ sp: 1.4, thr: 0.5, rows: 2 }), pal: PAL.ice },
    crosshatch: { f: M.hatch({ sp: 1 }), pal: PAL.ink },
    plasma: { f: M.plasma({ sp: 1.3, sc: 0.4 }), pal: PAL.rainbow },
    bloom: { f: M.radial({ sp: 2, rings: 3, amp: 0.2 }), pal: PAL.pink },
    // EXPERIMENTAL
    scan: { f: M.scan({ sp: 0.4, band: 0.12 }), pal: PAL.cyan },
    pixeldrift: { f: M.plasma({ sp: 1.1, sc: 0.5 }), pal: PAL.violet },
    shards: { f: M.shatter({ sp: 1 }), pal: PAL.toxic },
    crt: { f: M.glitch({ sp: 2.6 }), pal: PAL.green },
    feedback: { f: M.spiral({ arms: 3, tw: 11, sp: 2, dir: -1 }), pal: PAL.violet },
  };

  // ---------- auto-generator: any NEW filter gets a matching tile from its name/keywords ----------
  // Ordered keyword -> (motif, palette). First match wins; unmatched -> plasma/rainbow default.
  // Keep in sync with tools/gen-fx.mjs (which pre-bakes tuned entries for review).
  const HINTS = [
    [/fire|flame|burn|lava|ember|torch/, () => M.flames({ sp: 6 }), 'fire'],
    [/laser|beam|ray/, () => M.beams({ sp: 3 }), 'red'],
    [/portal|void|vortex|wormhole|spiral|swirl|polar|feedback|twist/, () => M.spiral({ sp: 3 }), 'violet'],
    [/eye|stare|gaze|blink|pupil/, () => M.eyes({ sp: 1.2 }), 'cyan'],
    [/thermal|heat|infrared|warm/, () => M.radial({ sp: 1.6, rings: 5 }), 'heat'],
    [/echo|ripple|sonar|expand|zoom/, () => M.rings({ sp: 1.2 }), 'violet'],
    [/aura|glow|bloom|halo|neon|pulse|fill/, () => M.radial({ sp: 2, rings: 3, amp: 0.2 }), 'pink'],
    [/matrix|ascii|code|terminal|glyph|type|char/, () => M.streaks({ sp: 1.2, thr: 0.45, rows: 2, head: 1 }), 'green'],
    [/rain|drip|snow|fall|tears|melt|gravity|ice.?cream/, () => M.streaks({ sp: 1, thr: 0.4, rows: 1.6 }), 'ice'],
    [/glitch|vhs|crt|analog|tape|\btv\b|scanline|invert|corrupt|noise/, () => M.glitch({ sp: 2.8 }), 'amber'],
    [/kaleid|mandala|symmetry|mirror/, () => M.kaleido({ sp: 2 }), 'rainbow'],
    [/pixel|mosaic|block|hex|voxel|low.?poly/, () => M.blocks({ bs: 3, sp: 1.1 }), 'rainbow'],
    [/wire|mesh/, () => M.mesh({ sp: 1 }), 'cyan'],
    [/dot|landmark|point|stipple/, () => M.dots({ sp: 2 }), 'cyan'],
    [/hatch|pencil|sketch|cross/, () => M.hatch({ sp: 1 }), 'ink'],
    [/edge|sobel|outline|contour|line/, () => M.outline({ sp: 1.4 }), 'green'],
    [/shard|shatter|tear|crack|break|split|dimension|glass/, () => M.shatter({ sp: 1 }), 'toxic'],
    [/scan|reveal|x.?ray|slice/, () => M.scan({ sp: 0.4 }), 'cyan'],
    [/spark|magic|spell|glitter|star|paint|confetti|gesture/, () => M.particles({ n: 6, sp: 1.4 }), 'rainbow'],
    [/cat|claw|paw|swipe|hit|punch|attack|slap/, () => M.particles({ n: 5, sp: 2.2, size: 3.6 }), 'amber'],
    [/halftone|dotscreen|newspaper|print/, () => M.radial({ sp: 0.8, rings: 2, amp: 0.05 }), 'ink'],
    [/plasma|caustic|liquid|wave|warp|drift|flow|psych|trip/, () => M.plasma({ sp: 1.3, sc: 0.4 }), 'rainbow'],
    [/duotone|posterize|bleach|grade|tone|color/, () => M.plasma({ sp: 1, sc: 0.35 }), 'pink'],
    [/headbang|concert|energy|shake|beat/, () => M.flames({ sp: 7, w: 0.5 }), 'amber'],
    [/face|head|mesh/, () => M.outline({ sp: 1.3 }), 'cyan'],
  ];
  function autoFor(slug, hints) {
    const text = (String(slug) + ' ' + ((hints && hints.keywords) || '')).toLowerCase();
    for (const [re, mk, pal] of HINTS) if (re.test(text)) return { f: mk(), pal: PAL[pal] };
    return { f: M.plasma({ sp: 1.2, sc: 0.42 }), pal: PAL.rainbow };
  }
  const get = (slug, hints) => FX[String(slug).toLowerCase()] || autoFor(slug, hints || {});

  function draw(ctx, field, pal, t) {
    ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, PX, PX);
    ctx.font = '700 ' + (CELL + 2) + 'px ui-monospace,Menlo,monospace'; ctx.textBaseline = 'top';
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
      let v = field(gx, gy, t) + 0.04 * Math.sin((gx * 3 + gy * 5) + t * 4); v = clamp(v);
      if (v < 0.06) continue;
      ctx.fillStyle = pal[Math.min(pal.length - 1, 1 + Math.floor(v * (pal.length - 1)))];
      ctx.fillText(RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))], gx * CELL, gy * CELL);
    }
    ctx.fillStyle = 'rgba(0,0,0,.20)'; for (let y = (t * 22) % 3; y < PX; y += 3) ctx.fillRect(0, y, PX, 1);
    const vg = ctx.createRadialGradient(PX / 2, PX / 2, PX * 0.28, PX / 2, PX / 2, PX * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, PX, PX);
  }

  let _raf = null, _io = null;
  function animateAll(root) {
    root = root || document;
    if (_raf) cancelAnimationFrame(_raf), _raf = null;          // re-entrant: gallery re-renders on tab switch
    if (_io) _io.disconnect(), _io = null;
    const tiles = [...root.querySelectorAll('canvas[data-fx]')].map((c) => {
      const fx = get(c.dataset.fx, { keywords: c.dataset.hint || '' });   // explicit, else auto-generated
      c.width = PX; c.height = PX; return { ctx: c.getContext('2d'), fx, el: c, vis: false };
    });
    if (!tiles.length) return;
    _io = new IntersectionObserver((es) => es.forEach((e) => { const tt = tiles.find((z) => z.el === e.target); if (tt) tt.vis = e.isIntersecting; }), { rootMargin: '140px' });
    tiles.forEach((tt) => _io.observe(tt.el));
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) { tiles.forEach((tt) => draw(tt.ctx, tt.fx.f, tt.fx.pal, 1.2)); return; }
    let last = 0;
    function frame(now) { if (now - last > 33) { last = now; const t = now / 1000; for (const tt of tiles) if (tt.vis) draw(tt.ctx, tt.fx.f, tt.fx.pal, t); } _raf = requestAnimationFrame(frame); }
    _raf = requestAnimationFrame(frame);
  }

  window.MMFX = { FX, PAL, M, draw, animateAll, autoFor, get, has: (s) => !!FX[String(s).toLowerCase()], slugs: () => Object.keys(FX) };
})();
