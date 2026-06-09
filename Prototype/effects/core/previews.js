// Procedural preview painters for launcher tiles. Each takes a 2D canvas
// context and a size, and paints an abstract representation of the effect
// (we don't run the live effect to keep the launcher cheap).

const W = 320, H = 320;

function fill(ctx, color) { ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); }

const painters = {
  ascii(ctx) {
    fill(ctx, '#000');
    ctx.fillStyle = '#22ff66';
    ctx.font = 'bold 14px ui-monospace, Menlo, monospace';
    const glyphs = '#@%*+=-:. ';
    for (let y = 8; y < H; y += 14) {
      for (let x = 0; x < W; x += 10) {
        ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], x, y);
      }
    }
  },
  warp(ctx) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#ff0066'); g.addColorStop(0.5, '#00ffff'); g.addColorStop(1, '#ffff00');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
  },
  thermal(ctx) {
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const r = Math.min(1, t * 2);
      const g = Math.max(0, t * 1.5 - 0.4);
      const b = Math.max(0, 0.6 - t * 1.2);
      ctx.fillStyle = `rgb(${r*255|0},${g*255|0},${b*255|0})`;
      ctx.fillRect(0, y, W, 1);
    }
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 50; i++) {
      const r = 20 + Math.random() * 80;
      ctx.beginPath();
      ctx.arc(Math.random() * W, Math.random() * H, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${50 + Math.random()*200|0},${Math.random()*100|0},0,0.25)`;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
  halftone(ctx) {
    fill(ctx, '#fff');
    ctx.fillStyle = '#000';
    for (let y = 8; y < H; y += 12) {
      for (let x = 8; x < W; x += 12) {
        const d = Math.hypot(x - W/2, y - H/2);
        const r = Math.max(0, 6 - d/40);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
  sobel(ctx) {
    fill(ctx, '#000');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 80; i++) {
      ctx.beginPath();
      const x = Math.random() * W;
      const y = Math.random() * H;
      const len = 20 + Math.random() * 50;
      const a = Math.random() * Math.PI * 2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
  },
  invert(ctx) {
    fill(ctx, '#fff');
    ctx.fillStyle = '#000';
    ctx.font = 'bold 220px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('!', W/2, H/2 + 20);
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  },
  mosaic(ctx, opts = {}) {
    const cell = opts.cell || 32;
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        const v = Math.random();
        ctx.fillStyle = `rgb(${v*255|0},${v*255|0},${v*255|0})`;
        ctx.fillRect(x, y, cell, cell);
      }
    }
  },
  kaleidoscope(ctx) {
    fill(ctx, '#0a0a14');
    const cx = W/2, cy = H/2;
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((i / 6) * Math.PI * 2);
      const g = ctx.createLinearGradient(0, 0, 100, 100);
      g.addColorStop(0, '#ff6ec7'); g.addColorStop(1, '#39ddff');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(140, -30); ctx.lineTo(140, 30); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  },
  vhs(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a0344'); g.addColorStop(1, '#04293a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,80,80,0.25)';
    ctx.fillRect(0, 60, W, 14);
    ctx.fillStyle = 'rgba(80,255,255,0.20)';
    ctx.fillRect(0, 180, W, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  },
  duotone(ctx, opts = {}) {
    const [a, b] = opts.colors || ['#ff0066', '#000000'];
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, a); g.addColorStop(1, b);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  },
  posterize(ctx) {
    const cols = ['#ffcc00', '#ff6633', '#cc1166', '#330055'];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = cols[i];
      ctx.fillRect(0, (H/4)*i, W, H/4);
    }
  },
  caustics(ctx) {
    fill(ctx, '#06304d');
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      const r = 20 + Math.random() * 80;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(180,220,255,0.6)');
      g.addColorStop(1, 'rgba(0,40,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  },
  fisheye(ctx) {
    fill(ctx, '#111');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    for (let r = 10; r < W; r += 16) {
      ctx.beginPath(); ctx.arc(W/2, H/2, r, 0, Math.PI * 2); ctx.stroke();
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      ctx.beginPath();
      ctx.moveTo(W/2, H/2);
      ctx.lineTo(W/2 + Math.cos(a) * W, H/2 + Math.sin(a) * W);
      ctx.stroke();
    }
  },
  bleach(ctx) {
    fill(ctx, '#e8e2d6');
    ctx.fillStyle = '#3b2f25';
    for (let i = 0; i < 80; i++) {
      ctx.globalAlpha = 0.1 + Math.random() * 0.5;
      ctx.fillRect(Math.random() * W, Math.random() * H, 60, 20);
    }
    ctx.globalAlpha = 1;
  },
  hexpixel(ctx) {
    fill(ctx, '#000');
    const r = 16;
    for (let y = 0, row = 0; y < H + r; y += r * 1.5, row++) {
      for (let x = (row % 2) * r * Math.sqrt(3) / 2; x < W + r; x += r * Math.sqrt(3)) {
        const v = Math.random();
        ctx.fillStyle = `hsl(${v * 360}, 70%, 50%)`;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          const px = x + Math.cos(a) * r * 0.9;
          const py = y + Math.sin(a) * r * 0.9;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      }
    }
  },
  polar(ctx) {
    fill(ctx, '#000');
    for (let r = 0; r < W; r += 6) {
      ctx.strokeStyle = `hsl(${(r/W) * 360 + 200},80%,55%)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(W/2, H/2, r * 0.45, r * 0.04, r * 0.04 + 0.6);
      ctx.stroke();
    }
  },
  lineRain(ctx) {
    fill(ctx, '#001a0a');
    ctx.strokeStyle = '#33ff88';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 80; i++) {
      const x = Math.random() * W;
      const y0 = Math.random() * H;
      ctx.globalAlpha = 0.2 + Math.random() * 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y0); ctx.lineTo(x, y0 + 40 + Math.random() * 60);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  crosshatch(ctx) {
    fill(ctx, '#f6f1e7');
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 200; i++) {
      ctx.beginPath();
      const x = Math.random() * W;
      const y = Math.random() * H;
      const a = Math.random() < 0.5 ? Math.PI / 4 : -Math.PI / 4;
      const l = 20 + Math.random() * 40;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  },
  plasma(ctx) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x += 4) {
        const v = Math.sin(x / 24) + Math.sin(y / 18 + 2) + Math.sin((x + y) / 32);
        const h = (v + 3) / 6;
        ctx.fillStyle = `hsl(${h * 360},80%,55%)`;
        ctx.fillRect(x, y, 4, 1);
      }
    }
  },
  bloom(ctx) {
    fill(ctx, '#0a0014');
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 25; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      const r = 30 + Math.random() * 80;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,180,80,0.9)');
      g.addColorStop(1, 'rgba(255,180,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  },
  faceDots(ctx) {
    fill(ctx, '#0a0a0a');
    ctx.fillStyle = '#fff';
    const cx = W/2, cy = H/2;
    for (let i = 0; i < 220; i++) {
      const t = i / 220;
      const a = t * Math.PI * 2 * 3 + i * 0.3;
      const r = 40 + 80 * Math.sin(t * Math.PI);
      const x = cx + Math.cos(a) * r * (0.5 + Math.random() * 0.5);
      const y = cy + Math.sin(a) * r * (0.5 + Math.random() * 0.5);
      ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  },
  faceMesh(ctx) {
    fill(ctx, '#000');
    ctx.strokeStyle = 'rgba(0,255,200,0.65)';
    ctx.lineWidth = 0.8;
    const points = [];
    for (let i = 0; i < 60; i++) {
      points.push([
        W/2 + (Math.random() - 0.5) * W * 0.65,
        H/2 + (Math.random() - 0.5) * H * 0.65,
      ]);
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
        if (d < 50) {
          ctx.beginPath(); ctx.moveTo(...points[i]); ctx.lineTo(...points[j]); ctx.stroke();
        }
      }
    }
  },
  faceFill(ctx) {
    fill(ctx, '#0a0a0a');
    ctx.globalAlpha = 0.45;
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `hsl(${280 + Math.random() * 60},80%,60%)`;
      ctx.beginPath();
      const cx = W/2 + (Math.random() - 0.5) * W * 0.6;
      const cy = H/2 + (Math.random() - 0.5) * H * 0.6;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 30, cy - 15);
      ctx.lineTo(cx + 30, cy + 25);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  faceLines(ctx) {
    fill(ctx, '#101418');
    ctx.strokeStyle = '#ff66aa';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(W*0.32, H*0.45, 28, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(W*0.68, H*0.45, 28, 14, 0, 0, Math.PI * 2);
    ctx.moveTo(W*0.35, H*0.7);
    ctx.quadraticCurveTo(W*0.5, H*0.78, W*0.65, H*0.7);
    ctx.quadraticCurveTo(W*0.5, H*0.66, W*0.35, H*0.7);
    ctx.stroke();
  },
  eyeZoom(ctx) {
    fill(ctx, '#000');
    const g = ctx.createRadialGradient(W*0.35, H*0.5, 5, W*0.35, H*0.5, 80);
    g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#888'); g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(W*0.35, H*0.5, 80, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(W*0.65, H*0.5, 80, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(W*0.35, H*0.5, 22, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(W*0.65, H*0.5, 22, 0, Math.PI*2); ctx.fill();
  },
  scan(ctx) {
    fill(ctx, '#0c0c10');
    const g = ctx.createLinearGradient(0, H*0.3, 0, H*0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, '#00ffd1');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H*0.3, W, H*0.4);
  },
  pixelDrift(ctx) {
    fill(ctx, '#000');
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const dx = (W/2 - x) * 0.4;
      const dy = (H/2 - y) * 0.4;
      ctx.fillStyle = `hsl(${(x/W)*360},80%,60%)`;
      ctx.fillRect(x, y, 4, 4);
      ctx.fillRect(x + dx, y + dy, 4, 4);
    }
  },
  shards(ctx) {
    fill(ctx, '#0a0a0a');
    for (let i = 0; i < 30; i++) {
      const cx = Math.random() * W, cy = Math.random() * H;
      ctx.fillStyle = `hsl(${Math.random()*360},70%,55%)`;
      ctx.beginPath();
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * Math.PI * 2 + Math.random();
        const r = 20 + Math.random() * 40;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    }
  },
  crt(ctx) {
    fill(ctx, '#0a0a14');
    for (let y = 0; y < H; y += 2) {
      ctx.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y, W, 1);
    }
    for (let x = 0; x < W; x += 6) {
      ctx.fillStyle = 'rgba(255,0,0,0.18)'; ctx.fillRect(x,   0, 2, H);
      ctx.fillStyle = 'rgba(0,255,0,0.18)'; ctx.fillRect(x+2, 0, 2, H);
      ctx.fillStyle = 'rgba(0,0,255,0.18)'; ctx.fillRect(x+4, 0, 2, H);
    }
  },
  feedback(ctx) {
    fill(ctx, '#000');
    for (let i = 0; i < 12; i++) {
      ctx.strokeStyle = `hsla(${(i * 30) % 360},80%,60%,0.5)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(W/2 - i * 12, H/2 - i * 12, i * 24, i * 24);
    }
  },
  glasses(ctx) {
    fill(ctx, '#111');
    const cy = H/2, r = 56;
    ctx.fillStyle = 'rgba(120,180,220,0.20)';
    ctx.beginPath(); ctx.arc(W*0.32, cy, r - 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(W*0.68, cy, r - 4, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(W*0.32, cy, r, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W*0.68, cy, r, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W*0.32 + r - 2, cy);
    ctx.quadraticCurveTo(W/2, cy - 14, W*0.68 - r + 2, cy);
    ctx.stroke();
  },
  iceCream(ctx) {
    fill(ctx, '#1a1320');
    // pink scoop
    const sx = W/2, sy = H*0.42, sr = 56;
    ctx.fillStyle = '#ffb1d6';
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI*2); ctx.fill();
    // cherry
    ctx.fillStyle = '#d83a3a';
    ctx.beginPath(); ctx.arc(sx, sy - sr * 0.85, 10, 0, Math.PI*2); ctx.fill();
    // wafer cone
    ctx.fillStyle = '#c88652';
    ctx.beginPath();
    ctx.moveTo(sx - sr * 0.9, sy + sr * 0.05);
    ctx.lineTo(sx + sr * 0.9, sy + sr * 0.05);
    ctx.lineTo(sx, sy + sr * 2.6);
    ctx.closePath(); ctx.fill();
    // drips
    ctx.fillStyle = '#ff9ec7';
    for (let i = 0; i < 6; i++) {
      const x = sx + (Math.random() - 0.5) * sr * 1.6;
      const y = sy + sr * 0.4 + Math.random() * sr * 1.4;
      ctx.beginPath(); ctx.arc(x, y, 4 + Math.random() * 4, 0, Math.PI*2); ctx.fill();
    }
  },
  mouthFire(ctx) {
    fill(ctx, '#100808');
    // procedural flame: stacked translucent ellipses, additive
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 28; i++) {
      const x = W/2 + (Math.random() - 0.5) * W * 0.45;
      const y = H * 0.85 - Math.pow(Math.random(), 0.8) * H * 0.75;
      const r = 16 + Math.random() * 36;
      const t = 1 - Math.abs((y - H/2) / (H/2));
      ctx.fillStyle = `rgba(${255},${180 - i * 4},${30 + i},${0.18 + 0.1 * t})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.5, 0, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
  faceMask(ctx) {
    fill(ctx, '#000');
    // procedural low-poly face: random triangles in face-shaped region
    const cx = W/2, cy = H*0.55;
    const points = [];
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (60 + Math.random() * 70) * (0.6 + 0.4 * Math.sin(a));
      points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 1.2]);
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const c = points[(i + 5) % points.length];
      const hue = (i * 12) % 360;
      ctx.fillStyle = `hsla(${hue},70%,55%,0.45)`;
      ctx.beginPath();
      ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,255,209,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  },
  fingerPaint(ctx) {
    fill(ctx, '#0c0c14');
    // squiggly multi-color paint stroke
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    let x = W * 0.18, y = H * 0.6;
    for (let i = 0; i < 36; i++) {
      const nx = x + 10 + Math.random() * 10;
      const ny = y + (Math.random() - 0.5) * 26;
      ctx.strokeStyle = `hsl(${(i * 12) % 360}, 90%, 60%)`;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      x = nx; y = ny;
    }
    // index finger pointing
    ctx.fillStyle = '#f5d6a8';
    ctx.beginPath();
    ctx.ellipse(W * 0.78, H * 0.34, 30, 60, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(W * 0.78 + 20, H * 0.28 - 20, 6, 0, Math.PI*2); ctx.fill();
  },
};

/** Paint preview onto the given canvas element. */
export function paintPreview(canvas, kind, opts) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const fn = painters[kind];
  if (fn) fn(ctx, opts || {});
  else {
    // default fallback
    fill(ctx, '#222');
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px Helvetica, Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', W/2, H/2);
  }
}
