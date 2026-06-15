import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ============================================================================
// CHOMP — a face-controlled arcade game. The interaction IS the game:
//   * Food falls from the top. Move your HEAD to put your mouth under it and
//     OPEN YOUR MOUTH to eat it (+1).  🍎🍌🍒🍇🍓🍊
//   * 💣 bombs fall too — keep your mouth CLOSED when one reaches you. Eat a
//     bomb and you lose a life. 3 lives, then GAME OVER (with your best score).
//   * It speeds up the longer you survive.
//
// Everything is drawn into the canvas (so it's in the Meet frame / recording);
// the live camera shows behind (wantsRawVideo). Mouth position uses the
// mirror-aware toPx so the hitbox sits on your mouth as you see it; mouth-open
// uses the jawOpen blendshape (one face model, via the base Tracker flag).
// §12 untouched — we never paint the video.
// ============================================================================

const HW = 1280, HH = 720;            // HUD canvas resolution
const GOOD = ['🍎', '🍌', '🍒', '🍇', '🍓', '🍊', '🍑', '🥝'];
const BOMB = '💣';
const MOUTH_OPEN = 0.32;              // jawOpen blendshape threshold
const LIVES0 = 3;
const FALL_BASE = 330, FALL_MAX = 640;   // HUD px/s
const SPAWN_BASE = 0.85, SPAWN_MIN = 0.34; // seconds between drops
const BOMB_CHANCE = 0.26;
const ITEM_R = 30, MOUTH_R = 78;     // HUD px hit radii
const BEST_KEY = 'chomp_best';

function readBest() { try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (_e) { return 0; } }
function writeBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (_e) { /* ignore */ } }

class Chomp extends Tracker {
  constructor() {
    super({ kind: 'face', numFaces: 1, faceBlendshapes: true });
    this.lastVideoTime = -1;
    this.best = readBest();
    this.reset();
  }

  reset() {
    this.items = [];          // {x,y,vy,bomb,glyph,r,eaten,pop}
    this.pops = [];           // {x,y,age,life,txt,color}
    this.score = 0;
    this.lives = LIVES0;
    this.time = 0;
    this.spawnAcc = 0;
    this.gameOver = false;
    this.overAge = 0;
    this.flash = 0;
    this.shake = 0;
    this.mouth = { x: HW / 2, y: HH * 0.6, open: false, active: false, r: MOUTH_R };
  }

  async setup(ctx) {
    this.hud = document.createElement('canvas');
    this.hud.width = HW; this.hud.height = HH;
    this.hctx = this.hud.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.hud);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(ctx.width, ctx.height), this.mat);
    this.mesh.position.set(ctx.width / 2, ctx.height / 2, 5);
    this.mesh.frustumCulled = false;
    ctx.scene.add(this.mesh);
  }

  update(dt) {
    const ctx = this.ctx;
    if (!ctx || !ctx.video || ctx.video.readyState < 2) { this.tick(null, null, dt); return; }
    if (ctx.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = ctx.video.currentTime;
      try {
        const r = this.landmarker.detectForVideo(ctx.video, performance.now());
        const lms = r?.faceLandmarks?.[0] || null;
        let open = false;
        const cats = r?.faceBlendshapes?.[0]?.categories;
        if (cats) for (const c of cats) if (c.categoryName === 'jawOpen') open = c.score > MOUTH_OPEN;
        this.tick(lms, open, dt);
        return;
      } catch (_e) { /* fall through */ }
    }
    this.tick(this._lms || null, this._open || false, dt);
  }

  // Detection-independent core: feed mouth landmarks + open flag. Testable.
  tick(lms, open, dt) {
    this._lms = lms; this._open = open;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 4);

    // mouth from face → HUD coords (mirror-aware via toPx)
    if (lms && lms.length > 454) {
      const up = lms[13], lo = lms[14];
      const [sx, sy] = this.toPx((up.x + lo.x) / 2, (up.y + lo.y) / 2);
      const [clx] = this.toPx(lms[234].x, lms[234].y);
      const [crx] = this.toPx(lms[454].x, lms[454].y);
      const faceW = Math.abs(crx - clx) || 200;
      const W = this.ctx.width || 1280, H = this.ctx.height || 720;
      this.mouth.x = sx / W * HW;
      this.mouth.y = sy / H * HH;
      this.mouth.r = Math.max(54, faceW / W * HW * 0.42);
      this.mouth.open = open;
      this.mouth.active = true;
    } else {
      this.mouth.active = false;
    }

    if (this.gameOver) {
      this.overAge += dt;
      // re-arm, then open mouth to retry
      if (this.overAge > 1.2 && this.mouth.active && this.mouth.open) this.reset();
    } else {
      this.play(dt);
    }

    for (const p of this.pops) p.age += dt;
    this.pops = this.pops.filter((p) => p.age < p.life);

    this.draw();
    if (this.ctx) this.ctx.setHud(`CHOMP · score ${this.score} · lives ${this.lives}`);
  }

  play(dt) {
    const speed = Math.min(FALL_MAX, FALL_BASE + this.score * 7);
    const spawnEvery = Math.max(SPAWN_MIN, SPAWN_BASE - this.score * 0.018);

    this.spawnAcc += dt;
    while (this.spawnAcc >= spawnEvery) {
      this.spawnAcc -= spawnEvery;
      const bomb = Math.random() < BOMB_CHANCE;
      this.items.push({
        x: 70 + Math.random() * (HW - 140),
        y: -40, vy: speed * (0.85 + Math.random() * 0.4),
        bomb, glyph: bomb ? BOMB : GOOD[(Math.random() * GOOD.length) | 0],
        r: ITEM_R, eaten: false,
      });
    }

    const m = this.mouth;
    for (const it of this.items) {
      it.y += it.vy * dt;
      if (it.eaten) continue;
      if (m.active && Math.hypot(it.x - m.x, it.y - m.y) < m.r + it.r) {
        if (m.open) {
          it.eaten = true;
          if (it.bomb) {
            this.lives -= 1; this.flash = 1; this.shake = 1;
            this.pops.push({ x: it.x, y: it.y, age: 0, life: 0.8, txt: '💥 -1', color: '#ff5566' });
            if (this.lives <= 0) this.endGame();
          } else {
            this.score += 1;
            this.pops.push({ x: it.x, y: it.y, age: 0, life: 0.7, txt: '+1', color: '#8aff80' });
          }
        }
      }
    }
    // cull off-screen / eaten
    this.items = this.items.filter((it) => !it.eaten && it.y < HH + 60);
  }

  endGame() {
    this.gameOver = true; this.overAge = 0;
    if (this.score > this.best) { this.best = this.score; writeBest(this.best); }
  }

  // ---- drawing --------------------------------------------------------------
  draw() {
    const g = this.hctx;
    g.clearRect(0, 0, HW, HH);
    g.save();
    if (this.shake > 0) g.translate((Math.random() - 0.5) * 16 * this.shake, (Math.random() - 0.5) * 16 * this.shake);
    if (this.flash > 0) { g.fillStyle = `rgba(255,40,60,${0.22 * this.flash})`; g.fillRect(-20, -20, HW + 40, HH + 40); }

    // falling items
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '54px serif';
    for (const it of this.items) g.fillText(it.glyph, it.x, it.y);

    // mouth hitbox ring
    if (this.mouth.active && !this.gameOver) {
      const m = this.mouth;
      g.lineWidth = m.open ? 7 : 3;
      g.strokeStyle = m.open ? 'rgba(120,255,128,0.95)' : 'rgba(255,255,255,0.55)';
      g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.stroke();
      if (m.open) { g.fillStyle = 'rgba(120,255,128,0.12)'; g.fill(); }
    }

    // score popups
    g.font = '800 34px ui-monospace, Menlo, monospace';
    for (const p of this.pops) {
      g.globalAlpha = Math.max(0, 1 - p.age / p.life);
      g.fillStyle = p.color;
      g.fillText(p.txt, p.x, p.y - p.age * 60);
    }
    g.globalAlpha = 1;

    // HUD: score + lives
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = '800 46px ui-monospace, Menlo, monospace';
    g.fillStyle = 'rgba(0,0,0,0.45)'; this.rr(g, 28, 24, 250, 60, 14); g.fill();
    g.fillStyle = '#fff'; g.fillText(`🍴 ${this.score}`, 48, 55);
    g.textAlign = 'right'; g.font = '40px serif';
    g.fillText('❤️'.repeat(Math.max(0, this.lives)) || '—', HW - 36, 54);

    if (this.gameOver) this.drawOver(g);
    else if (this.time < 3.5 && !this.mouth.active) this.drawHint(g);

    g.restore();
    this.tex.needsUpdate = true;
  }

  drawHint(g) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.5)'; this.rr(g, HW / 2 - 330, HH / 2 - 50, 660, 100, 18); g.fill();
    g.fillStyle = '#fff'; g.font = '800 34px ui-monospace, Menlo, monospace';
    g.fillText('move your head · OPEN MOUTH to eat 🍎', HW / 2, HH / 2 - 12);
    g.fillStyle = '#ff8a8a'; g.font = '600 26px ui-monospace, Menlo, monospace';
    g.fillText('do NOT eat the 💣', HW / 2, HH / 2 + 28);
  }

  drawOver(g) {
    g.fillStyle = 'rgba(8,10,18,0.9)'; g.fillRect(0, 0, HW, HH);
    g.textAlign = 'center';
    g.fillStyle = '#ff5566'; g.font = '800 80px Georgia, serif';
    g.fillText('GAME OVER', HW / 2, 250);
    g.fillStyle = '#fff'; g.font = '800 56px ui-monospace, Menlo, monospace';
    g.fillText(`SCORE  ${this.score}`, HW / 2, 360);
    g.fillStyle = '#ffd23f'; g.font = '600 38px ui-monospace, Menlo, monospace';
    g.fillText(`BEST  ${this.best}`, HW / 2, 430);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 28px ui-monospace, Menlo, monospace';
    g.fillText(this.overAge > 1.2 ? 'open your mouth to play again' : '...', HW / 2, 540);
  }

  rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  resize(w, h) {
    super.resize(w, h);
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.PlaneGeometry(w, h);
      this.mesh.position.set(w / 2, h / 2, 5);
    }
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (scene && this.mesh) scene.remove(this.mesh);
    this.mesh?.geometry.dispose();
    this.mat?.dispose();
    this.tex?.dispose();
    this.mesh = null;
  }
}

// ===========================================================================
// Preview painter — falling food + an open-mouth ring.
// ===========================================================================
function preview(c) {
  const W = 320, H = 320;
  c.fillStyle = '#0b0e16'; c.fillRect(0, 0, W, H);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '34px serif';
  const food = ['🍎', '🍌', '🍒', '🍇', '💣', '🍓'];
  const pos = [[70, 70], [150, 40], [240, 90], [110, 150], [250, 180], [60, 210]];
  for (let i = 0; i < pos.length; i++) c.fillText(food[i], pos[i][0], pos[i][1]);
  // open mouth ring near bottom
  c.lineWidth = 7; c.strokeStyle = 'rgba(120,255,128,0.95)';
  c.beginPath(); c.arc(W / 2, 250, 46, 0, Math.PI * 2); c.stroke();
  c.fillStyle = 'rgba(120,255,128,0.14)'; c.fill();
  c.fillStyle = '#fff'; c.textAlign = 'left'; c.font = '800 22px ui-monospace, monospace';
  c.fillText('🍴 12', 16, 28);
}

export default {
  id: 'Chomp',
  title: 'CHOMP',
  subtitle: 'OPEN WIDE · EAT THE FALLING FOOD',
  category: 'FACE',
  factory: () => new Chomp(),
  preview,
};
