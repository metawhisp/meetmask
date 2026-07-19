/* MEETAMASK gallery FX — one unified 16-bit style: a pixel-art FACE with each filter's
   effect applied, so every tile shows what the mask does. Rendered at 4x internal resolution
   (crisp + detailed, survives any downscale) and blitted nearest-neighbour. Only on-screen
   tiles animate. Vector effects draw in a 74x88 logical space (context scaled by SS);
   pixel-ops (recolor/edges/ascii/pixelate/glitch/warp/portal/scan) run at device resolution. */
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const PW = 74, PH = 88, CX = 37;                 // logical face grid + centre x
  let SS = 6, BW = PW * SS, BH = PH * SS;            // set per-tile in paint() to the tile's TRUE device resolution
  const RAMP = " .:-=+*ox#%@";
  const hash = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
  const TMP = document.createElement('canvas'); TMP.width = 1280; TMP.height = 1520;   // base-sampling scratch (>= any tile)
  const TC = TMP.getContext('2d', { willReadFrequently: true });

  const ell = (c, x, y, rx, ry, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill(); };
  const rect = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

  // ---------- face variants (variety across the 47 tiles) ----------
  const SKINS = [
    ['#7a4a30', '#9c6540', '#b87c52', '#cf9468'],
    ['#8a5a3e', '#b3774f', '#c98a63', '#d59a72'],
    ['#a06b45', '#c88a5c', '#e0a877', '#efc094'],
    ['#5f3a26', '#7e4f34', '#9a6844', '#b3805a'],
    ['#b07a52', '#d09a6c', '#e6b488', '#f2caa2'],
  ];
  const HAIRS = ['#221812', '#0f0f12', '#3a2718', '#5a3a1e', '#6a1f14', '#43301c'];
  const SHIRTS = [['#242a33', '#2f3742'], ['#33242a', '#42303a'], ['#1f2b26', '#2c3a34'], ['#2a2733', '#37344a'], ['#332f24', '#423d2c']];
  const STYLES = ['cap', 'round', 'flat', 'long', 'curly', 'bald'];

  function variantFor(slug) {
    const h = (n) => hash(slug + '#' + n);
    return {
      skin: SKINS[Math.floor(h(1) * SKINS.length) % SKINS.length],
      hair: HAIRS[Math.floor(h(2) * HAIRS.length) % HAIRS.length],
      style: STYLES[Math.floor(h(3) * STYLES.length) % STYLES.length],
      shirt: SHIRTS[Math.floor(h(4) * SHIRTS.length) % SHIRTS.length],
      brow: '#2a1d15', eye: '#20323f', lip: '#8a4a3a', lip2: '#a85f4a',
      beard: h(5) > 0.72, phase: h(6) * 6,
    };
  }

  const HAIRFN = {
    cap(c, col) { c.fillStyle = col; c.beginPath(); c.ellipse(CX, 30, 22, 18, 0, Math.PI, 0); c.fill(); rect(c, CX - 22, 18, 44, 10, col); ell(c, CX, 20, 22, 10, col); },
    round(c, col) { ell(c, CX, 26, 23, 20, col); rect(c, CX - 23, 24, 46, 8, col); },
    flat(c, col) { rect(c, CX - 22, 14, 44, 16, col); ell(c, CX, 30, 22, 8, col); },
    long(c, col) { ell(c, CX, 28, 24, 22, col); rect(c, CX - 24, 26, 8, 40, col); rect(c, CX + 16, 26, 8, 40, col); },
    curly(c, col) { for (let a = -0.2; a < Math.PI + 0.2; a += 0.5) ell(c, CX + Math.cos(a) * 22, 26 - Math.sin(a) * 18, 6, 6, col); ell(c, CX, 24, 20, 14, col); },
    bald(c) { ell(c, CX, 22, 15, 8, 'rgba(255,255,255,.05)'); },
  };

  const blinkAt = (x) => (((x * 0.24) % 1) > 0.95 ? 1 : 0);

  // draws in LOGICAL 74x88 coords — caller scales the context by SS
  function drawFace(c, v, t, o = {}) {
    if (!o.noBg) rect(c, 0, 0, PW, PH, o.bg || '#0c0b0a');
    const s = v.skin, blink = o.noBlink ? 0 : (o.blink != null ? o.blink : blinkAt(t + v.phase));
    ell(c, CX, PH + 8, 30, 20, v.shirt[0]); ell(c, CX, PH + 7, 26, 16, v.shirt[1]);
    rect(c, CX - 6, 60, 12, 14, s[1]);
    ell(c, CX, 40, 20, 24, s[2]); ell(c, CX, 46, 18, 20, s[1]); ell(c, CX, 36, 19, 20, s[3]);
    ell(c, CX - 20, 42, 3, 5, s[0]); ell(c, CX + 20, 42, 3, 5, s[0]);
    if (v.beard) { c.fillStyle = v.hair; c.beginPath(); c.ellipse(CX, 54, 15, 13, 0, 0.15, Math.PI - 0.15); c.fill(); rect(c, CX - 15, 44, 4, 10, v.hair); rect(c, CX + 11, 44, 4, 10, v.hair); }
    (HAIRFN[o.style || v.style] || HAIRFN.cap)(c, v.hair);
    rect(c, CX - 13, 33, 9, 2, v.brow); rect(c, CX + 4, 33, 9, 2, v.brow);
    const eh = blink > 0.5 ? 1 : (o.eyesBig ? 6 : 4), ew = o.eyesBig ? 7 : 5;
    ell(c, CX - 8, 39, ew, eh, '#f2ede3'); ell(c, CX + 8, 39, ew, eh, '#f2ede3');
    if (blink <= 0.5) { const pr = o.eyesBig ? 3 : 2.2; ell(c, CX - 8, 39, pr, pr + 0.4, v.eye); ell(c, CX + 8, 39, pr, pr + 0.4, v.eye); rect(c, CX - 9, 37, 1, 1, '#fff'); rect(c, CX + 7, 37, 1, 1, '#fff'); }
    ell(c, CX, 47, 2.5, 4, s[0]); rect(c, CX - 1, 50, 3, 1, s[0]);
    if (o.mouthOpen) { ell(c, CX, 55, 6, 5, '#5a2320'); ell(c, CX, 53, 5, 2, '#3a1512'); }
    else { rect(c, CX - 6, 55, 12, 2, v.lip); rect(c, CX - 5, 56, 10, 1, v.lip2); }
  }
  // render the face into TMP at full BWxBH device res, return its pixels (for pixel-ops)
  const baseImg = (v, t, o) => { TC.setTransform(SS, 0, 0, SS, 0, 0); drawFace(TC, v, t, o); TC.setTransform(1, 0, 0, 1, 0, 0); return TC.getImageData(0, 0, BW, BH); };
  const luma = (d, i) => (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;

  function mapPixels(c, v, t, fn) {                    // recolor: fn(l,r,g,b,lx,ly,t)->[r,g,b] (lx,ly logical)
    const img = baseImg(v, t), d = img.data;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) { const lx = (p % BW) / SS, ly = ((p / BW) | 0) / SS; const o = fn(luma(d, i), d[i], d[i + 1], d[i + 2], lx, ly, t); d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; }
    c.putImageData(img, 0, 0);
  }
  function remap(c, v, t, coord, bg) {                 // coord(lx,ly,t)->[logical sx,sy]; sampled at device res
    const bd = baseImg(v, t).data, out = TC.createImageData(BW, BH), od = out.data;
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
      const s = coord(x / SS, y / SS, t); let sx = Math.round(s[0] * SS), sy = Math.round(s[1] * SS); const oi = (y * BW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= BW || sy >= BH) { const b = bg || [12, 11, 10]; od[oi] = b[0]; od[oi + 1] = b[1]; od[oi + 2] = b[2]; od[oi + 3] = 255; continue; }
      const si = (sy * BW + sx) * 4; od[oi] = bd[si]; od[oi + 1] = bd[si + 1]; od[oi + 2] = bd[si + 2]; od[oi + 3] = 255;
    }
    c.putImageData(out, 0, 0);
  }
  const PAL_THERMAL = [[6, 4, 30], [40, 10, 90], [150, 20, 90], [230, 60, 20], [255, 170, 30], [255, 240, 180]];
  const ramp6 = (pal, l) => { l = clamp(l, 0, 0.999); const s = l * (pal.length - 1), k = s | 0, f = s - k, a = pal[k], b = pal[Math.min(pal.length - 1, k + 1)]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  const hsv = (h, s, v) => { h = (h % 1 + 1) % 1; const i = (h * 6) | 0, f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); const r = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; return [r[0] * 255, r[1] * 255, r[2] * 255]; };

  // ---------- effects. VECTOR effects draw in logical coords (ctx pre-scaled by SS).
  //            pixel-ops (recolor/halftone/edges/facelines/ascii/pixelate/glitch/kaleido/warp/portal/scanreveal)
  //            work at device resolution (BWxBH). ----------
  const E = {
    beams(c, t, v) {
      drawFace(c, v, t);
      const eyes = [[CX - 8, 39, -1], [CX + 8, 39, 1]], flick = 0.6 + 0.4 * Math.sin(t * 22);
      for (const [ex, ey, dir] of eyes) {
        for (let d = 0; d < PH; d++) { const x = ex + dir * d * 0.42, y = ey + d * 0.92; if (y > PH) break; const w = 1.1 + d * 0.05;
          c.fillStyle = 'rgba(255,60,50,' + (0.85 * flick * Math.max(0, 1 - d / PH)) + ')'; c.fillRect(x - w, y, w * 2, 0.9);
          c.fillStyle = 'rgba(255,220,180,' + (0.9 * flick * Math.max(0, 1 - d / PH)) + ')'; c.fillRect(x - 0.4, y, 0.8, 0.9); }
        c.fillStyle = 'rgba(255,120,90,.9)'; ell(c, ex, ey, 3 + flick, 3 + flick, 'rgba(255,120,90,.9)');
      }
    },
    fire(c, t, v) {
      drawFace(c, v, t, { mouthOpen: true }); const mx = CX, my = 57;
      const tongues = (col, sc, n, so) => { for (let i = 0; i < n; i++) { const a = -0.72 + (n > 1 ? i / (n - 1) : 0.5) * 1.44; const fl = 0.68 + 0.32 * Math.sin(t * 12 + i * 1.7 + so); const len = (15 + 7 * Math.sin(t * 9 + i * 2.1)) * sc * fl; const tx = mx + Math.sin(a) * len * 0.95, ty = my + Math.cos(a) * len + 5, bw = 3.4 * sc; c.fillStyle = col; c.beginPath(); c.moveTo(mx - bw, my); c.lineTo(mx + bw, my); c.lineTo(tx, ty); c.closePath(); c.fill(); } };
      tongues('#c81f0a', 1.28, 7, 0); tongues('#ff6a1a', 1.0, 7, 1.1); tongues('#ffc23a', 0.66, 5, 2.3);
      ell(c, mx, my + 1, 3, 3, '#fff2c0');
      for (let i = 0; i < 12; i++) { const l = (i * 0.09 + t * 2) % 1; c.fillStyle = 'rgba(255,190,70,' + (1 - l) + ')'; c.fillRect(mx + Math.sin(i * 3 + t * 5) * 11 * l, my + l * 30, 1, 1); }
    },
    recolor(c, t, v, mode) {
      const fns = {
        thermal: (l) => ramp6(PAL_THERMAL, l * 1.05 + 0.02),
        invert: (l, r, g, b) => [255 - r, 255 - g, 255 - b],
        duotone: (l) => { const sh = [26, 20, 40], hi = [255, 110, 170]; return [sh[0] + (hi[0] - sh[0]) * l, sh[1] + (hi[1] - sh[1]) * l, sh[2] + (hi[2] - sh[2]) * l]; },
        posterize: (l, r, g, b) => [Math.round(r / 72) * 72, Math.round(g / 72) * 72, Math.round(b / 72) * 72],
        bleach: (l, r, g, b) => { const gy = l * 255, m = 0.55, cc = (x) => clamp(((x * (1 - m) + gy * m) - 128) * 1.5 + 128, 0, 255); return [cc(r), cc(g), cc(b)]; },
        plasma: (l, r, g, b, x, y, tt) => { if (l < 0.12) return [10, 8, 16]; const h = (x * 0.02 + y * 0.015 + tt * 0.12 + Math.sin((x + y) * 0.1 + tt) * 0.1); return hsv(h, 0.7, 0.35 + l * 0.65); },
        caustics: (l, r, g, b, x, y, tt) => { const c1 = Math.max(0, Math.sin(x * 0.4 + y * 0.2 + tt * 2) * Math.sin(y * 0.35 - tt * 1.5)); const base = [8 + l * 30, 40 + l * 120, 70 + l * 150]; const add = c1 * 90; return [base[0] + add * 0.6, base[1] + add, base[2] + add]; },
      };
      mapPixels(c, v, t, fns[mode] || fns.thermal);
    },
    halftone(c, t, v) {
      const bd = baseImg(v, t).data; rect(c, 0, 0, BW, BH, '#12100c'); const g = 3 * SS;
      for (let y = g / 2; y < BH; y += g) for (let x = g / 2; x < BW; x += g) { const l = luma(bd, ((y | 0) * BW + (x | 0)) * 4); const r = clamp(l, 0, 1) * (g * 0.42); if (r < 1) continue; c.fillStyle = l > 0.6 ? '#f4efe6' : '#c9c2b4'; ell(c, x, y, r, r, c.fillStyle); }
    },
    edges(c, t, v, col, hatchOn) {
      const bd = baseImg(v, t).data; rect(c, 0, 0, BW, BH, hatchOn ? '#efe9dd' : '#05080a');
      const L = (dx, dy) => luma(bd, ((dy | 0) * BW + (dx | 0)) * 4);
      for (let ly = 1; ly < PH - 1; ly++) for (let lx = 1; lx < PW - 1; lx++) {
        const dx = lx * SS, dy = ly * SS, m = Math.hypot(L(dx + SS, dy) - L(dx - SS, dy), L(dx, dy + SS) - L(dx, dy - SS));
        if (hatchOn) { if (m > 0.18) { c.fillStyle = '#1c1a17'; c.fillRect(dx, dy, SS, SS); } else if (L(dx, dy) < 0.5 && ((lx + ly) % 4 === (Math.floor(t * 2) % 2 ? 0 : 2))) { c.fillStyle = 'rgba(40,36,30,.7)'; c.fillRect(dx, dy, SS, SS); } }
        else if (m > 0.16) { c.fillStyle = m > 0.34 ? '#d9ffe6' : col; c.fillRect(dx, dy, SS, SS); }
      }
    },
    facelines(c, t, v) {
      E.edges(c, t, v, '#ff4f8b', false);
      const p = 0.7 + 0.3 * Math.sin(t * 3); c.fillStyle = 'rgba(255,120,180,' + p + ')';
      for (const ex of [CX - 8, CX + 8]) c.fillRect((ex - 5) * SS, 39 * SS, 10 * SS, SS);
      c.fillRect((CX - 6) * SS, 55 * SS, 12 * SS, SS);
    },
    ascii(c, t, v) {
      const d = baseImg(v, t).data; rect(c, 0, 0, BW, BH, '#02120a'); c.font = '700 ' + (4 * SS) + 'px ui-monospace,monospace'; c.textBaseline = 'top'; const step = 2;
      for (let ly = 0; ly < PH; ly += step) for (let lx = 0; lx < PW; lx += step) { const dx = lx * SS, dy = ly * SS; let l = luma(d, ((dy | 0) * BW + (dx | 0)) * 4); l = Math.min(0.999, l + 0.06 * Math.sin(t * 6 + lx * 0.5)); if (l < 0.12) continue; c.fillStyle = l > 0.6 ? '#c6ffd0' : (l > 0.35 ? '#38e06a' : '#0f7a34'); c.fillText(RAMP[Math.floor(l * RAMP.length)], dx, dy); }
    },
    pixelate(c, t, v, o) {
      const bd = baseImg(v, t).data, B = o.bs * SS, shape = o.shape; rect(c, 0, 0, BW, BH, '#0c0b0a');
      const dxg = o.drift ? Math.sin(t * 1.2) * 4 * SS : 0, dyg = o.drift ? Math.cos(t * 1.1) * 3 * SS : 0;
      for (let by = 0; by < BH; by += B) for (let bx = 0; bx < BW; bx += B) {
        const off = shape === 'hex' && ((by / B) & 1) ? B / 2 : 0;
        const sx = clamp(Math.round(bx + B / 2 + off + dxg), 0, BW - 1) | 0, sy = clamp(Math.round(by + B / 2 + dyg), 0, BH - 1) | 0;
        const i = (sy * BW + sx) * 4; c.fillStyle = 'rgb(' + bd[i] + ',' + bd[i + 1] + ',' + bd[i + 2] + ')';
        if (shape === 'tri') { c.beginPath(); const up = ((bx / B + by / B) & 1); if (up) { c.moveTo(bx, by + B); c.lineTo(bx + B, by + B); c.lineTo(bx + B / 2, by); } else { c.moveTo(bx, by); c.lineTo(bx + B, by); c.lineTo(bx + B / 2, by + B); } c.closePath(); c.fill(); }
        else c.fillRect(bx + off, by, B - 0.5, B - 0.5);
      }
    },
    glitch(c, t, v, mode) {
      const img = baseImg(v, t), d = img.data;
      if (mode === 'rgb' || mode === 'crt') { const out = new Uint8ClampedArray(d); const dx = Math.round((mode === 'crt' ? 1 : Math.round(2 + 1.5 * Math.sin(t * 6))) * SS);
        for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) { const i = (y * BW + x) * 4; const ri = (y * BW + (clamp(x - dx, 0, BW - 1) | 0)) * 4, bi = (y * BW + (clamp(x + dx, 0, BW - 1) | 0)) * 4; out[i] = d[ri]; out[i + 2] = d[bi + 2]; } d.set(out); }
      if (mode === 'vhs' || mode === 'rgb') { for (let y = 0; y < BH; y++) { if (Math.random() < (mode === 'vhs' ? 0.10 : 0.05)) { const sh = Math.round((((Math.random() * 8) | 0) - 4) * SS); for (let x = 0; x < BW; x++) { const i = (y * BW + x) * 4, si = (y * BW + (clamp(x + sh, 0, BW - 1) | 0)) * 4; d[i] = d[si]; d[i + 1] = d[si + 1]; d[i + 2] = d[si + 2]; } } } }
      c.putImageData(img, 0, 0);
      if (mode === 'crt') { c.fillStyle = 'rgba(0,0,0,.28)'; for (let y = 0; y < BH; y += 3 * SS) c.fillRect(0, y, BW, SS); const g = c.createRadialGradient(BW / 2, BH / 2, BW * 0.27, BW / 2, BH / 2, BW * 0.7); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)'); c.fillStyle = g; c.fillRect(0, 0, BW, BH); }
      if (mode === 'vhs') { c.fillStyle = 'rgba(120,255,200,.05)'; c.fillRect(0, (t * 40 * SS) % BH, BW, 6 * SS); }
    },
    kaleido(c, t, v) {
      remap(c, v, t, (x, y) => { let dx = x - CX, dy = y - 44, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy); const seg = TAU / 6; a = Math.abs(((a % seg) + seg) % seg - seg / 2); a += t * 0.3; return [CX + Math.cos(a) * r, 44 + Math.sin(a) * r]; });
    },
    warp(c, t, v, mode) {
      if (mode === 'fisheye') remap(c, v, t, (x, y) => { const dx = (x - CX) / 37, dy = (y - 40) / 44, r = Math.hypot(dx, dy), k = 0.55 + 0.08 * Math.sin(t * 2); const f = r > 0 ? Math.pow(r, 1 + k) / r : 1; return [CX + dx * f * 37, 40 + dy * f * 44]; });
      else if (mode === 'polar') remap(c, v, t, (x, y) => { const dx = x - CX, dy = y - 40, a = Math.atan2(dy, dx) + (1 - Math.hypot(dx, dy) / 44) * 1.6 * Math.sin(t * 0.8 + 1), r = Math.hypot(dx, dy); return [CX + Math.cos(a) * r, 40 + Math.sin(a) * r]; });
      else remap(c, v, t, (x, y) => { const zoom = 1.9 + 0.2 * Math.sin(t * 3); for (const ex of [CX - 8, CX + 8]) { const dx = x - ex, dy = y - 39; if (Math.hypot(dx, dy) < 9) return [ex + dx / zoom, 39 + dy / zoom]; } return [x, y]; });
    },
    feedback(c, t, v) {
      rect(c, 0, 0, PW, PH, '#0c0b0a');
      for (let k = 4; k >= 0; k--) { const sc = 1 - k * 0.16, al = k === 0 ? 1 : 0.5 - k * 0.08; c.globalAlpha = Math.max(0, al); c.save(); c.translate(CX, 40); c.rotate(Math.sin(t + k) * 0.05); c.scale(sc, sc); c.translate(-CX, -40); drawFace(c, v, t, { noBg: true }); c.restore(); }
      c.globalAlpha = 1;
    },
    echo(c, t, v, mode) {
      rect(c, 0, 0, PW, PH, '#0c0b0a');
      if (mode === 'h') { for (const [dir, tint] of [[-1, '#4ad0ff'], [1, '#ff5a8b']]) { c.save(); c.globalAlpha = 0.5; c.translate(dir * (4 + 2 * Math.sin(t * 2)), 0); drawFace(c, v, t, { noBg: true }); c.fillStyle = tint; c.globalCompositeOperation = 'overlay'; c.fillRect(0, 0, PW, PH); c.restore(); } c.globalAlpha = 1; drawFace(c, v, t, { noBg: true }); }
      else if (mode === 'bang') { const sh = Math.sin(t * 22) * 4; c.save(); c.globalAlpha = 0.45; drawFace(c, v, t, { noBg: true, style: 'curly' }); c.restore(); c.save(); c.translate(0, sh); drawFace(c, v, t, { noBg: true, mouthOpen: true, style: 'curly' }); c.restore(); c.globalAlpha = 1; for (let i = 0; i < 8; i++) { const x = hash('b' + i) * PW; c.fillStyle = i % 2 ? 'rgba(255,80,180,.5)' : 'rgba(80,200,255,.5)'; if (Math.sin(t * 10 + i) > 0) c.fillRect(x, 0, 0.6, PH); } }
      else { const poses = ['cap', 'round', 'flat'], k = Math.floor(t * 1.5) % 3; for (let g = 2; g >= 0; g--) { c.globalAlpha = g === 0 ? 1 : 0.3; c.save(); c.translate(Math.sin((k - g) * 1.2) * 6, 0); c.rotate((k - 1) * 0.08); drawFace(c, v, t, { noBg: true, style: poses[(k + g) % 3], mouthOpen: k === 2 }); c.restore(); } c.globalAlpha = 1; }
    },
    snow(c, t, v) {
      drawFace(c, v, t);
      ell(c, CX, 18, 20, 7, '#eef7ff'); rect(c, CX - 30, 68, 60, 4, '#e6f1ff'); ell(c, CX - 20, 70, 12, 5, '#eef7ff'); ell(c, CX + 20, 70, 12, 5, '#eef7ff');
      for (let i = 0; i < 40; i++) { const sx = hash('sx' + i) * PW, sp = 8 + hash('sp' + i) * 20, y = (hash('sy' + i) * PH + t * sp) % PH, x = sx + Math.sin(t + i) * 3, s = hash('ss' + i) > 0.6 ? 1.6 : 1; c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(x, y, s, s); }
    },
    rain(c, t, v) {
      drawFace(c, v, t);
      for (let i = 0; i < 46; i++) { const x = hash('rx' + i) * PW, sp = 40 + hash('rs' + i) * 60, len = 5 + hash('rl' + i) * 8, y = (hash('ry' + i) * PH + t * sp) % (PH + len) - len; c.fillStyle = 'rgba(150,210,255,' + (0.35 + hash('ra' + i) * 0.4) + ')'; c.fillRect(x, y, 0.8, len); }
    },
    drip(c, t, v) {
      drawFace(c, v, t, { mouthOpen: (t % 4) > 3.4 }); const sag = 1 + Math.sin(t * 1.5);
      for (const [ex, col] of [[CX - 8, v.eye], [CX + 8, v.eye], [CX, '#8a4a3a']]) { const len = 6 + sag * 5 + (ex === CX ? 4 : 0); c.fillStyle = col; c.fillRect(ex - 1, ex === CX ? 56 : 41, 2, len); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(ex - 1, (ex === CX ? 56 : 41) + len, 2, 2); }
    },
    icecream(c, t, v) {
      drawFace(c, v, t, { style: 'bald' }); const bob = Math.sin(t * 2);
      c.fillStyle = '#d9a441'; c.beginPath(); c.moveTo(CX - 10, 20); c.lineTo(CX + 10, 20); c.lineTo(CX, 34); c.closePath(); c.fill();
      ell(c, CX, 13 + bob, 12, 9, '#f6d7e2'); ell(c, CX - 5, 10 + bob, 7, 6, '#ffe9f0'); ell(c, CX + 5, 11 + bob, 6, 5, '#f2c1d4'); ell(c, CX, 6 + bob, 2, 2, '#c0304a');
      for (const dx of [-8, 4]) { const dl = 4 + 3 * Math.sin(t * 2 + dx); c.fillStyle = '#f6d7e2'; c.fillRect(CX + dx, 20, 2, dl); }
    },
    mesh(c, t, v) {
      drawFace(c, v, t); c.globalAlpha = 0.85;
      const pts = []; for (let a = 0; a < TAU; a += TAU / 12) pts.push([CX + Math.cos(a) * 19, 40 + Math.sin(a) * 23]); pts.push([CX, 30], [CX - 8, 39], [CX + 8, 39], [CX, 47], [CX, 55], [CX - 10, 44], [CX + 10, 44]);
      c.strokeStyle = '#22c8d8'; c.lineWidth = 0.4; c.beginPath();
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1]; if (dx * dx + dy * dy < 130) { c.moveTo(pts[i][0], pts[i][1]); c.lineTo(pts[j][0], pts[j][1]); } }
      c.stroke(); c.fillStyle = '#7ffff0'; for (const p of pts) c.fillRect(p[0] - 0.5, p[1] - 0.5, 1.4, 1.4); c.globalAlpha = 1;
    },
    dots(c, t, v) {
      drawFace(c, v, t); const p = 0.6 + 0.4 * Math.sin(t * 3); c.fillStyle = 'rgba(120,255,240,' + p + ')';
      for (let a = 0; a < TAU; a += TAU / 22) c.fillRect(CX + Math.cos(a) * 19 - 0.5, 40 + Math.sin(a) * 23 - 0.5, 1.3, 1.3);
      for (let a = 0; a < TAU; a += TAU / 10) { c.fillRect(CX - 8 + Math.cos(a) * 3.2, 39 + Math.sin(a) * 2, 1.1, 1.1); c.fillRect(CX + 8 + Math.cos(a) * 3.2, 39 + Math.sin(a) * 2, 1.1, 1.1); }
      for (let x = -6; x <= 6; x += 2) c.fillRect(CX + x, 55, 1.1, 1.1);
      for (let y = 42; y <= 50; y += 2) c.fillRect(CX, y, 1.1, 1.1);
    },
    fill(c, t, v) {
      const p = 0.5 + 0.5 * Math.sin(t * 2), col = hsv(0.5 + 0.1 * Math.sin(t), 0.9, 1); drawFace(c, v, t);
      c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.4 + p * 0.4; c.fillStyle = 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')'; c.beginPath(); c.ellipse(CX, 40, 20, 24, 0, 0, TAU); c.fill(); c.restore();
      c.strokeStyle = 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',.9)'; c.lineWidth = 1.2; c.beginPath(); c.ellipse(CX, 40, 20, 24, 0, 0, TAU); c.stroke();
    },
    stare(c, t, v) {
      drawFace(c, v, t, { eyesBig: true, noBlink: true }); const g = 0.4 + 0.4 * Math.sin(t * 4); c.strokeStyle = 'rgba(120,220,255,' + g + ')'; c.lineWidth = 0.5;
      for (const ex of [CX - 8, CX + 8]) { c.beginPath(); c.ellipse(ex, 39, 7 + g, 6 + g, 0, 0, TAU); c.stroke(); }
    },
    glasses(c, t, v) {
      const drop = Math.min(1, (t % 3) / 0.7); drawFace(c, v, t); const gy = 10 + drop * 28;
      rect(c, CX - 16, gy, 32, 7, '#0a0a0c'); rect(c, CX - 16, gy, 32, 2, '#26262c'); rect(c, CX - 2, gy + 1, 4, 5, '#0a0a0c');
      ell(c, CX - 8, gy + 3, 6, 3, '#111'); ell(c, CX + 8, gy + 3, 6, 3, '#111');
      const sh = (t * 0.6) % 1; c.fillStyle = 'rgba(180,220,255,.5)'; c.fillRect(CX - 16 + sh * 32, gy, 2, 7);
      if (drop >= 1) { const s = 0.5 + 0.5 * Math.sin(t * 8); c.fillStyle = 'rgba(255,255,255,' + s + ')'; c.fillRect(CX + 11, gy - 2, 2, 2); c.fillRect(CX + 12, gy - 3, 1, 4); c.fillRect(CX + 10, gy - 1, 4, 1); }
    },
    paw(c, t, v) {
      drawFace(c, v, t); const ph = (t * 0.85) % 1, px = PW + 12 - ph * (PW + 34), py = 32 + ph * 22;
      ell(c, px, py, 10, 8, '#e08a2e'); ell(c, px - 1, py - 2, 8, 6, '#f0a94e');
      for (let i = 0; i < 4; i++) { const a = -0.9 + i * 0.6, tx = px - 9 + Math.cos(a) * 3, ty = py - 8 + i * 4; ell(c, tx, ty, 2.4, 2, '#c9701f'); c.fillStyle = '#fff'; c.fillRect(tx - 6, ty, 3, 1); }
      ell(c, px + 2, py + 2, 3, 2.4, '#7a3f12');
      if (ph > 0.32) { const a = Math.max(0, 1 - (ph - 0.32) / 0.62); for (let s = 0; s < 3; s++) { c.fillStyle = 'rgba(255,60,60,' + a + ')'; for (let d = 0; d < 34; d++) c.fillRect(CX - 12 + s * 11 + d * 0.18, 28 + d, (Math.sin(d * 3 + s) > 0 ? 1 : 1.8), 1); c.fillStyle = 'rgba(255,190,190,' + a + ')'; c.fillRect(CX - 12 + s * 11, 28, 1, 32); } }
    },
    sparkles(c, t, v, mode) {
      drawFace(c, v, t);
      if (mode === 'paint') { const cols = ['#ff5a8b', '#ffd23f', '#3ad0ff', '#7bed7b']; for (let s = 0; s < 4; s++) { c.strokeStyle = cols[s]; c.lineWidth = 1.4; c.beginPath(); for (let k = 0; k < 20; k++) { const th = t * 1.2 + s * 1.6, x = CX + Math.cos(th + k * 0.3) * (8 + k) * 0.9, y = 40 + Math.sin(th * 1.3 + k * 0.4) * (6 + k * 0.6); k === 0 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke(); } }
      else { const cols = ['#ffd23f', '#ff5a8b', '#8a5cff', '#4ad0ff', '#7bed7b', '#fff']; for (let i = 0; i < 16; i++) { const a = i / 16 * TAU + t * 0.5, rr = 16 + 8 * Math.sin(t * 1.5 + i), x = CX + Math.cos(a) * rr, y = 40 + Math.sin(a) * rr * 1.1, tw = 0.5 + 0.5 * Math.sin(t * 6 + i * 1.7); if (tw < 0.3) continue; c.fillStyle = cols[i % cols.length]; c.fillRect(x, y - 1, 1, 3); c.fillRect(x - 1, y, 3, 1); } }
    },
    aura(c, t, v) {
      const hue = (t * 0.1) % 1; rect(c, 0, 0, PW, PH, '#0c0b0a');
      for (let k = 3; k >= 0; k--) { const rr = 16 + k * 7 + (t * 8) % 7, col = hsv(hue + k * 0.08, 0.8, 1); c.strokeStyle = 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',' + (0.5 - k * 0.1) + ')'; c.lineWidth = 1.2; c.beginPath(); c.ellipse(CX, 42, rr, rr * 1.15, 0, 0, TAU); c.stroke(); }
      drawFace(c, v, t, { noBg: true }); c.fillStyle = 'rgba(180,255,255,.35)'; c.fillRect(0, (t * 30) % PH, PW, 1.4);
    },
    bloom(c, t, v) {
      drawFace(c, v, t); c.save(); c.globalCompositeOperation = 'lighter'; const p = 0.6 + 0.4 * Math.sin(t * 2.5);
      for (const [x, y, col] of [[CX - 8, 39, '#4ad0ff'], [CX + 8, 39, '#ff5a8b'], [CX, 55, '#ffd23f']]) { const g = c.createRadialGradient(x, y, 0, x, y, 9 * p + 4); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.globalAlpha = 0.7; c.fillRect(x - 12, y - 12, 24, 24); }
      c.restore(); c.globalAlpha = 1; c.strokeStyle = 'rgba(120,220,255,' + (0.4 + p * 0.4) + ')'; c.lineWidth = 0.9; c.beginPath(); c.ellipse(CX, 40, 21, 25, 0, 0, TAU); c.stroke();
    },
    portal(c, t, v) {
      const im = TC.createImageData(BW, BH), d = im.data;
      for (let y = 0, i = 0; y < BH; y++) for (let x = 0; x < BW; x++, i += 4) { const lx = x / SS, ly = y / SS, dx = lx - CX, dy = ly - 40, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy), sw = 0.5 + 0.5 * Math.sin(a * 3 + r * 0.45 - t * 4), col = hsv(0.72 + sw * 0.12, 0.85, clamp(sw * (0.15 + r / 55), 0, 1)); d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; }
      c.putImageData(im, 0, 0);
      const s = 0.82 + 0.04 * Math.sin(t * 2); c.save(); c.setTransform(SS, 0, 0, SS, 0, 0); c.translate(CX, 40); c.scale(s, s); c.translate(-CX, -40); drawFace(c, v, t, { noBg: true }); c.setTransform(1, 0, 0, 1, 0, 0); c.restore();
    },
    shatter(c, t, v, col) {
      drawFace(c, v, t);                          // cracked-glass overlay over a still-visible face
      const cxp = CX, cyp = 40, N = 9, wob = Math.sin(t * 3) * 0.05;
      c.lineWidth = 0.55;
      for (let i = 0; i < N; i++) {               // radial cracks (jagged)
        const a = i / N * TAU + hash('a' + i) * 0.5, len = 30 + hash('l' + i) * 16;
        c.strokeStyle = col; c.beginPath(); c.moveTo(cxp, cyp);
        for (let s = 1; s <= 5; s++) { const r = len * s / 5, aa = a + Math.sin(s * 1.7 + i) * 0.08 + wob; c.lineTo(cxp + Math.cos(aa) * r, cyp + Math.sin(aa) * r); }
        c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 0.25; c.beginPath(); c.moveTo(cxp, cyp); c.lineTo(cxp + Math.cos(a) * len, cyp + Math.sin(a) * len); c.stroke(); c.lineWidth = 0.55;
      }
      for (const rr of [10, 19, 28]) {            // concentric ring cracks
        c.strokeStyle = col; c.beginPath();
        for (let i = 0; i <= N; i++) { const a = i / N * TAU + hash('a' + (i % N)) * 0.5, r = rr * (0.85 + hash('r' + i + rr) * 0.3), x = cxp + Math.cos(a) * r, y = cyp + Math.sin(a) * r; i === 0 ? c.moveTo(x, y) : c.lineTo(x, y); }
        c.stroke();
      }
      ell(c, cxp, cyp, 1.6, 1.6, '#fff');         // impact point
    },
    scanreveal(c, t, v) {
      const bd = baseImg(v, t).data, im = TC.createImageData(BW, BH), d = im.data, yl = (t * 26 * SS) % BH;
      for (let y = 0, i = 0; y < BH; y++) for (let x = 0; x < BW; x++, i += 4) { if (y < yl) { const th = ramp6(PAL_THERMAL, luma(bd, i)); d[i] = th[0]; d[i + 1] = th[1]; d[i + 2] = th[2]; } else { d[i] = bd[i]; d[i + 1] = bd[i + 1]; d[i + 2] = bd[i + 2]; } d[i + 3] = 255; }
      c.putImageData(im, 0, 0); c.fillStyle = 'rgba(120,255,240,.9)'; c.fillRect(0, yl, BW, SS); c.fillStyle = 'rgba(120,255,240,.25)'; c.fillRect(0, yl - 2 * SS, BW, 4 * SS);
    },
  };
  const VECTOR = new Set(['beams', 'fire', 'feedback', 'echo', 'snow', 'rain', 'drip', 'icecream', 'mesh', 'dots', 'fill', 'stare', 'glasses', 'paw', 'sparkles', 'aura', 'bloom', 'shatter']);

  // ---------- registry: slug -> [effectName, ...args] ----------
  const FX = {
    eyelasers: ['beams'], mouthfire: ['fire'],
    thermal: ['recolor', 'thermal'], invert: ['recolor', 'invert'], duotone: ['recolor', 'duotone'], posterize: ['recolor', 'posterize'], bleach: ['recolor', 'bleach'], plasma: ['recolor', 'plasma'], caustics: ['recolor', 'caustics'],
    halftone: ['halftone'], sobel: ['edges', '#28c85a', false], crosshatch: ['edges', '#e8e4da', true], facelines: ['facelines'], asciicam: ['ascii'],
    mosaic: ['pixelate', { bs: 6, shape: 'sq' }], hexpixel: ['pixelate', { bs: 6, shape: 'hex' }], facemask: ['pixelate', { bs: 9, shape: 'tri' }], pixeldrift: ['pixelate', { bs: 6, shape: 'sq', drift: true }],
    pixelwarp: ['glitch', 'rgb'], vhs: ['glitch', 'vhs'], crt: ['glitch', 'crt'],
    kaleidoscope: ['kaleido'], fisheye: ['warp', 'fisheye'], polar: ['warp', 'polar'], eyezoom: ['warp', 'eyezoom'], feedback: ['feedback'],
    timeecho: ['echo', 'h'], posestages: ['echo', 'pose'], headbang: ['echo', 'bang'],
    snowpile: ['snow'], linerain: ['rain'], facegravity: ['drip', 'melt'], icecream: ['icecream'],
    facemesh: ['mesh'], facedots: ['dots'], facefill: ['fill'], stareoff: ['stare'], glasses: ['glasses'], catattack: ['paw'],
    gesturespells: ['sparkles', 'spell'], fingerpaint: ['sparkles', 'paint'], aurascan: ['aura'], bloom: ['bloom'],
    portalpull: ['portal'], realitytear: ['shatter', '#7c6bff'], shards: ['shatter', '#35d07f'], scan: ['scanreveal'],
  };

  // ---------- auto: new filters get a matching effect from name/keywords (keep gen-fx.mjs in sync) ----------
  const HINTS = [
    [/laser|beam|ray|gaze/, ['beams']],
    [/fire|flame|burn|breath|dragon|lava/, ['fire']],
    [/thermal|heat|infrared/, ['recolor', 'thermal']],
    [/invert|negative/, ['recolor', 'invert']],
    [/duotone/, ['recolor', 'duotone']],
    [/poster/, ['recolor', 'posterize']],
    [/bleach|bypass|wash/, ['recolor', 'bleach']],
    [/plasma|psych|rainbow|cycle/, ['recolor', 'plasma']],
    [/caustic|underwater|water|aqua/, ['recolor', 'caustics']],
    [/halftone|newspaper|dotscreen|print/, ['halftone']],
    [/sobel|edge|contour/, ['edges', '#28c85a', false]],
    [/hatch|pencil|sketch/, ['edges', '#e8e4da', true]],
    [/ascii|glyph|terminal|code|matrix/, ['ascii']],
    [/hex/, ['pixelate', { bs: 6, shape: 'hex' }]],
    [/low.?poly|tri/, ['pixelate', { bs: 9, shape: 'tri' }]],
    [/pixel|mosaic|block|voxel/, ['pixelate', { bs: 6, shape: 'sq' }]],
    [/vhs|tape|analog/, ['glitch', 'vhs']],
    [/crt|phosphor/, ['glitch', 'crt']],
    [/glitch|warp|rgb|noise|corrupt/, ['glitch', 'rgb']],
    [/kaleid|mandala|symmetry|mirror/, ['kaleido']],
    [/fisheye|barrel|lens|bulge/, ['warp', 'fisheye']],
    [/polar|swirl|twist/, ['warp', 'polar']],
    [/portal|void|vortex|wormhole/, ['portal']],
    [/feedback|trail|zoom/, ['feedback']],
    [/echo|ghost/, ['echo', 'h']],
    [/pose|strobe/, ['echo', 'pose']],
    [/headbang|concert|beat|shake/, ['echo', 'bang']],
    [/snow|frost/, ['snow']],
    [/rain|drip|drop/, ['rain']],
    [/gravity|melt|sag/, ['drip', 'melt']],
    [/ice.?cream|cone|scoop/, ['icecream']],
    [/mesh|wire/, ['mesh']],
    [/dots|landmark|mediapipe|point/, ['dots']],
    [/fill|neon.?mask/, ['fill']],
    [/stare|blink|eye/, ['stare']],
    [/glass|shade|spectacle/, ['glasses']],
    [/cat|paw|claw|swipe|attack|slap/, ['paw']],
    [/paint|draw|brush/, ['sparkles', 'paint']],
    [/spell|magic|spark|glitter|star|gesture/, ['sparkles', 'spell']],
    [/aura|mood|halo/, ['aura']],
    [/bloom|glow|highlight/, ['bloom']],
    [/shard|shatter|tear|crack|break|glass|dimension|voronoi/, ['shatter', '#7c6bff']],
    [/scan|reveal|x.?ray|slice/, ['scanreveal']],
    [/face|head/, ['dots']],
  ];
  function autoFor(slug, hints) {
    const text = (String(slug) + ' ' + ((hints && hints.keywords) || '')).toLowerCase();
    for (const [re, spec] of HINTS) if (re.test(text)) return spec;
    return ['recolor', 'plasma'];
  }
  const get = (slug, hints) => FX[String(slug).toLowerCase()] || autoFor(slug, hints || {});

  // ---------- render one effect into the shared BWxBH scratch ----------
  // render one effect onto `sc` at sc's own native resolution (no upscale => no blur, no blocks)
  function paint(sc, spec, t, v) {
    const W = sc.canvas.width, H = sc.canvas.height, name = spec[0];
    SS = W / PW; BW = W; BH = H;
    sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, W, H);
    if (VECTOR.has(name)) { sc.setTransform(SS, 0, 0, SS, 0, 0); (E[name] || E.recolor)(sc, t, v, spec[1], spec[2]); sc.setTransform(1, 0, 0, 1, 0, 0); }
    else (E[name] || E.recolor)(sc, t, v, spec[1], spec[2]);
  }
  const scanlines = (ctx, W, H, t) => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(0,0,0,.10)'; const g = Math.max(2, Math.round(H / 150)); for (let y = Math.floor((t * 26) % (g * 2)); y < H; y += g * 2) ctx.fillRect(0, y, W, 1); };

  function measure(c) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), r = c.getBoundingClientRect();
    const W = Math.max(2, Math.round((r.width || 220) * dpr)), H = Math.max(2, Math.round((r.height || 264) * dpr));
    c.width = W; c.height = H; return { W, H, ctx: c.getContext('2d') };
  }

  let _raf = null, _io = null, _ro = null;
  function animateAll(root) {
    root = root || document;
    if (_raf) cancelAnimationFrame(_raf), _raf = null;
    if (_io) _io.disconnect(), _io = null;
    if (_ro) _ro.disconnect(), _ro = null;
    const tiles = [...root.querySelectorAll('canvas[data-fx]')].map((c) => ({ el: c, spec: get(c.dataset.fx, { keywords: c.dataset.hint || '' }), v: variantFor(c.dataset.fx), g: measure(c), vis: false }));
    if (!tiles.length) return;
    _ro = new ResizeObserver((es) => es.forEach((e) => { const tt = tiles.find((z) => z.el === e.target); if (tt) tt.g = measure(tt.el); }));
    tiles.forEach((tt) => _ro.observe(tt.el));
    _io = new IntersectionObserver((es) => es.forEach((e) => { const tt = tiles.find((z) => z.el === e.target); if (tt) tt.vis = e.isIntersecting; }), { rootMargin: '160px' });
    tiles.forEach((tt) => _io.observe(tt.el));
    const render = (tt, t) => { paint(tt.g.ctx, tt.spec, t, tt.v); scanlines(tt.g.ctx, tt.g.W, tt.g.H, t); };
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) { tiles.forEach((tt) => render(tt, 1.2)); return; }
    let last = 0;
    function frame(now) { if (now - last > 33) { last = now; const t = now / 1000; for (const tt of tiles) if (tt.vis) render(tt, t); } _raf = requestAnimationFrame(frame); }
    _raf = requestAnimationFrame(frame);
  }

  window.MMFX = { FX, E, get, autoFor, animateAll, variantFor, paint, SS, BW, BH, has: (s) => !!FX[String(s).toLowerCase()], slugs: () => Object.keys(FX) };
})();
