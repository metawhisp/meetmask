import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';

// ============================================================================
// FACE SIMON — a reaction game where your FACE is the controller. A target
// expression appears (shock, kiss, big smile, tongue, angry, puff…); morph your
// face to match it before the timer ring empties. Each hit speeds it up; one
// miss = GAME OVER with your best streak. Pure interaction — the whole game is
// you contorting your face fast.
//
// One face model with blendshapes (via the base Tracker flag). Everything is
// drawn into the canvas (so it lands in the Meet frame); camera shows behind.
// Detection uses blendshapes only → mirror-agnostic; §12 untouched.
// ============================================================================

const HW = 1280, HH = 720;
const PASS = 0.80;          // match needed to clear a round
const HOLD = 0.10;          // seconds to hold the match
const ROUND_T0 = 4.2, ROUND_TMIN = 1.5, ROUND_DECAY = 0.13;
const BEST_KEY = 'facesimon_best';

// Target expressions → the blendshape values that define them.
const TARGETS = [
  { emoji: '😮', label: 'SHOCK',     keys: { jawOpen: 0.55, browInnerUp: 0.5 } },
  { emoji: '😗', label: 'KISS',      keys: { mouthPucker: 0.6 } },
  { emoji: '😀', label: 'BIG SMILE', keys: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6 } },
  { emoji: '😛', label: 'TONGUE OUT',keys: { tongueOut: 0.4 } },
  { emoji: '😠', label: 'ANGRY',     keys: { browDownLeft: 0.45, browDownRight: 0.45 } },
  { emoji: '😲', label: 'JAW DROP',  keys: { jawOpen: 0.7 } },
  { emoji: '🐡', label: 'PUFF CHEEKS', keys: { cheekPuff: 0.45 } },
  { emoji: '😉', label: 'WINK',      keys: { eyeBlinkLeft: 0.5 } },
];

function readBest() { try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (_e) { return 0; } }
function writeBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (_e) { /* ignore */ } }
const blendMap = (cats) => { const m = {}; if (cats) for (const c of cats) m[c.categoryName] = c.score; return m; };

class FaceSimon extends Tracker {
  constructor() {
    super({ kind: 'face', numFaces: 1, faceBlendshapes: true });
    this.lastT = -1;
    this.best = readBest();
    this.reset();
  }

  reset() {
    this.score = 0; this.level = 0;
    this.target = 0; this.tLeft = ROUND_T0; this.hold = 0; this.matchEMA = 0;
    this.gameOver = false; this.overAge = 0; this.flash = 0; this.flashColor = '#8aff80';
    this.started = false;
    this.nextTarget();
  }

  nextTarget() {
    let n = this.target;
    while (n === this.target && TARGETS.length > 1) n = (Math.random() * TARGETS.length) | 0;
    this.target = n;
    this.tLeft = Math.max(ROUND_TMIN, ROUND_T0 - this.level * ROUND_DECAY);
    this.hold = 0;
  }

  async setup(ctx) {
    this.hud = document.createElement('canvas'); this.hud.width = HW; this.hud.height = HH;
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
    if (!ctx || !ctx.video || ctx.video.readyState < 2) { this.tick(null, dt); return; }
    if (ctx.video.currentTime !== this.lastT) {
      this.lastT = ctx.video.currentTime;
      try {
        const r = this.landmarker.detectForVideo(ctx.video, performance.now());
        this.tick(blendMap(r?.faceBlendshapes?.[0]?.categories), dt);
        return;
      } catch (_e) { /* fall through */ }
    }
    this.tick(this._B || null, dt);
  }

  matchTo(t, B) {
    let m = 1;
    for (const k in t.keys) m = Math.min(m, Math.min(1, (B[k] || 0) / t.keys[k]));
    return m;
  }

  // Detection-independent core: feed a blendshape map. Testable.
  tick(B, dt) {
    this._B = B;
    dt = Math.min(dt, 0.05);
    this.flash = Math.max(0, this.flash - dt * 2.5);

    const have = !!B;
    const m = have ? this.matchTo(TARGETS[this.target], B) : 0;
    this.matchEMA += (m - this.matchEMA) * Math.min(1, dt * 12);

    if (this.gameOver) {
      this.overAge += dt;
      if (this.overAge > 1.2 && have && (B.jawOpen || 0) > 0.5) this.reset();
    } else if (have) {
      this.started = true;
      this.tLeft -= dt;
      if (this.matchEMA >= PASS) {
        this.hold += dt;
        if (this.hold >= HOLD) { this.score += 1; this.level += 1; this.flash = 1; this.flashColor = '#8aff80'; this.nextTarget(); }
      } else { this.hold = Math.max(0, this.hold - dt * 2); }
      if (this.tLeft <= 0) { this.gameOver = true; this.overAge = 0; this.flash = 1; this.flashColor = '#ff5566'; if (this.score > this.best) { this.best = this.score; writeBest(this.best); } }
    }

    this.draw(have);
    if (this.ctx) this.ctx.setHud(`FACE SIMON · score ${this.score} · best ${this.best}`);
  }

  draw(have) {
    const g = this.hctx; g.clearRect(0, 0, HW, HH);
    if (this.flash > 0) { g.fillStyle = (this.flashColor === '#8aff80' ? `rgba(120,255,128,${0.16 * this.flash})` : `rgba(255,40,60,${0.2 * this.flash})`); g.fillRect(0, 0, HW, HH); }

    if (this.gameOver) { this.drawOver(g); g.fillStyle = '#fff'; this.tex.needsUpdate = true; return; }

    const cx = HW / 2, cy = 250;
    const T = TARGETS[this.target];
    // timer ring
    const frac = Math.max(0, this.tLeft / Math.max(ROUND_TMIN, ROUND_T0 - this.level * ROUND_DECAY));
    g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.beginPath(); g.arc(cx, cy, 95, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = frac > 0.35 ? '#7df9ff' : '#ffb02e';
    g.beginPath(); g.arc(cx, cy, 95, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
    // target emoji + label
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '110px serif'; g.fillText(T.emoji, cx, cy);
    g.font = '800 40px ui-monospace, Menlo, monospace'; g.fillStyle = '#fff';
    g.fillText('MAKE THIS FACE', cx, cy + 150);
    g.fillStyle = '#7df9ff'; g.font = '800 30px ui-monospace, Menlo, monospace';
    g.fillText(T.label, cx, cy + 192);

    // match bar
    const bw = 560, bx = cx - bw / 2, by = cy + 240;
    g.fillStyle = 'rgba(255,255,255,0.12)'; this.rr(g, bx, by, bw, 26, 13); g.fill();
    const fillW = bw * Math.min(1, this.matchEMA);
    g.fillStyle = this.matchEMA >= PASS ? '#8aff80' : '#ffd23f';
    if (fillW > 2) { this.rr(g, bx, by, fillW, 26, 13); g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2;
    const px = bx + bw * PASS; g.beginPath(); g.moveTo(px, by - 6); g.lineTo(px, by + 32); g.stroke();

    // score / best
    g.textAlign = 'left'; g.font = '800 44px ui-monospace, Menlo, monospace'; g.fillStyle = '#fff';
    g.fillText(`★ ${this.score}`, 36, 50);
    g.textAlign = 'right'; g.fillStyle = '#ffd23f'; g.font = '600 28px ui-monospace, Menlo, monospace';
    g.fillText(`BEST ${this.best}`, HW - 36, 48);

    if (!have) { g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 26px ui-monospace, monospace'; g.fillText('show your face to start', cx, HH - 40); }

    this.tex.needsUpdate = true;
  }

  drawOver(g) {
    g.fillStyle = 'rgba(8,10,18,0.9)'; g.fillRect(0, 0, HW, HH);
    g.textAlign = 'center';
    g.fillStyle = '#ff5566'; g.font = '800 76px Georgia, serif'; g.fillText('GAME OVER', HW / 2, 250);
    g.fillStyle = '#fff'; g.font = '800 50px ui-monospace, Menlo, monospace'; g.fillText(`STREAK  ${this.score}`, HW / 2, 350);
    g.fillStyle = '#ffd23f'; g.font = '600 36px ui-monospace, Menlo, monospace'; g.fillText(`BEST  ${this.best}`, HW / 2, 416);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 28px ui-monospace, Menlo, monospace';
    g.fillText(this.overAge > 1.2 ? 'open your mouth to play again' : '...', HW / 2, 520);
  }

  rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  resize(w, h) {
    super.resize(w, h);
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.geometry = new THREE.PlaneGeometry(w, h); this.mesh.position.set(w / 2, h / 2, 5); }
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (scene && this.mesh) scene.remove(this.mesh);
    this.mesh?.geometry.dispose(); this.mat?.dispose(); this.tex?.dispose(); this.mesh = null;
  }
}

function preview(c) {
  const W = 320, H = 320;
  c.fillStyle = '#0b0e16'; c.fillRect(0, 0, W, H);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  // timer ring
  c.lineWidth = 8; c.strokeStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.arc(160, 120, 70, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = '#7df9ff'; c.beginPath(); c.arc(160, 120, 70, -Math.PI / 2, Math.PI * 0.9); c.stroke();
  c.font = '78px serif'; c.fillText('😮', 160, 120);
  c.fillStyle = '#fff'; c.font = '800 22px ui-monospace, monospace'; c.fillText('MAKE THIS FACE', 160, 215);
  c.fillStyle = '#7df9ff'; c.font = '800 18px ui-monospace, monospace'; c.fillText('SHOCK', 160, 244);
  // match bar
  c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(40, 275, 240, 16);
  c.fillStyle = '#8aff80'; c.fillRect(40, 275, 180, 16);
  c.textAlign = 'left'; c.fillStyle = '#fff'; c.font = '800 20px ui-monospace, monospace'; c.fillText('★ 7', 16, 28);
}

export default {
  id: 'FaceSimon',
  title: 'FACE SIMON',
  subtitle: 'MAKE THE FACE BEFORE TIME RUNS OUT',
  category: 'FACE',
  factory: () => new FaceSimon(),
  preview,
};
