import * as THREE from 'three';
import { Tracker } from '../core/Tracker.js?v=3';
import { loadFaceLandmarker } from '../core/mpLoader.js';

// ============================================================================
// CALL WRAPPED — counts what you DO on a call and reacts, live and escalating.
//
//   * One face model with blendshapes detects: smiles, talking, blinks, nods,
//     head-shakes, eyebrow raises and "distracted" (looking away).
//   * A live counter strip is drawn INTO the canvas (so it's in the Meet frame
//     and other people see it), plus achievement toasts that ESCALATE in tone:
//     cute at first → louder → ULTRA anime-scream at high streaks.
//   * Hold a shocked face (open mouth + raised brows ~1s) to toggle the
//     end-of-call "CALL WRAPPED" card: your archetype + stats + chaos score —
//     the screenshot artifact.
//
// All copy is English by request. Everything user-facing is rendered to an
// offscreen 2D HUD canvas → CanvasTexture → full-screen plane, so it lands in
// the captured frame (DOM HUD is not captured). Camera shows behind
// (wantsRawVideo). Detection uses raw (un-mirrored) landmarks + blendshapes,
// so it is mirror-agnostic; §12 is untouched (we never paint the video).
// ============================================================================

// ---- tuning -----------------------------------------------------------------
const SMILE_ON = 0.45, SMILE_OFF = 0.30;
const BLINK_ON = 0.55, BLINK_OFF = 0.30;
const BROW_ON  = 0.55, BROW_OFF  = 0.35;
const JAW_TALK = 0.05;            // |Δ jawOpen| EMA above this ⇒ talking
const SHOCK_JAW = 0.5, SHOCK_BROW = 0.45, SHOCK_HOLD = 0.9; // card toggle
const SURP_JAW = 0.45, SURP_BROW = 0.40;     // 😮 surprise (open mouth + brows)
const SILLY_ON = 0.30, SILLY_OFF = 0.15;     // 😛 tongue out / cheek puff
const LOOK_YAW = 0.13, LOOK_HOLD = 0.6; // |nose offset|/faceW sustained ⇒ away
const NOD_AMP = 0.035, SHAKE_AMP = 0.045, OSC_GAP = 1.2;

// Each action: how it reads, and escalating tiers (count → level + message).
// level 1 cute · 2 hyped · 3 anime · 4 ULTRA scream.
const ACTIONS = {
  smile:    { icon: '😊', label: 'SMILES', kind: 'count',
    tiers: [[1,1,'aw, a smile :)'],[8,2,'SMILE STREAK x8'],[20,3,'CERTIFIED CHARMER!!'],[40,4,'😤 SMILE OVERLOAD!!! UNLIMITED JOY!!!']] },
  talk:     { icon: '💬', label: 'TALK', kind: 'time',
    tiers: [[10,1,'warming up...'],[60,2,'TALKATIVE — 1 min'],[180,3,'MIC HOG!!!'],[360,4,'🗣 MAIN CHARACTER!!! LET OTHERS SPEAK!!!']] },
  blink:    { icon: '👁', label: 'BLINKS', kind: 'count',
    tiers: [[20,1,'blink blink'],[60,2,'DRY EYES x60'],[120,3,'BLINK MACHINE!!'],[200,4,'👁 BLINKZILLA!!! HYDRATE NOW!!!']] },
  nod:      { icon: '✅', label: 'NODS', kind: 'count',
    tiers: [[5,1,'agree, huh?'],[15,2,'YES-MAN x15'],[30,3,'PROFESSIONAL NODDER!!'],[50,4,'✅ NOD GOD!!! SAY NO JUST ONCE!!!']] },
  shake:    { icon: '🙅', label: 'NOPES', kind: 'count',
    tiers: [[5,1,'nope?'],[15,2,'SKEPTIC x15'],[30,3,'HARD DISAGREE!!!']] },
  brow:     { icon: '🤨', label: 'BROWS', kind: 'count',
    tiers: [[5,1,'intrigued'],[15,2,'SUSPICIOUS x15'],[30,3,'THE EYEBROW!!!']] },
  surprise: { icon: '😮', label: 'SHOOK', kind: 'count',
    tiers: [[2,1,'oh!'],[8,2,'SHOOK x8'],[20,3,'CONSTANTLY SHOOK!!'],[40,4,'😱 DRAMA OVERLOAD!!! BREATHE!!!']] },
  silly:    { icon: '😛', label: 'SILLY', kind: 'count',
    tiers: [[2,1,'goofy :P'],[8,2,'CLOWNING x8'],[20,3,'CERTIFIED GOBLIN!!'],[40,4,'🤡 FULL CLOWN MODE!!! MEETING RUINED!!!']] },
  lookAway: { icon: '👀', label: 'DISTRACTED', kind: 'count',
    tiers: [[3,1,'psst, focus'],[10,2,'DISTRACTED x10'],[25,3,'ARE YOU EVEN HERE?!'],[50,4,'👀 TOUCH GRASS!!! THIS CALL IS OVER!!!']] },
};
const ORDER = ['smile', 'talk', 'nod', 'shake', 'brow', 'surprise', 'silly', 'blink', 'lookAway'];

// Landmarks (MediaPipe FaceMesh): 1 = nose tip, 234/454 = cheeks, 10/152 = top/chin.
const blendMapFrom = (cats) => {
  const m = {};
  if (cats) for (const c of cats) m[c.categoryName] = c.score;
  return m;
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Counts oscillation cycles of a 1-D signal (for nods / shakes).
class Osc {
  constructor(amp, gap) { this.amp = amp; this.gap = gap; this.base = null; this.phase = 0; this.last = 0; this.t = 0; }
  feed(v, dt) {
    this.t += dt;
    if (this.base == null) { this.base = v; return false; }
    this.base += (v - this.base) * Math.min(1, dt * 1.2);
    const d = v - this.base;
    let cycle = false;
    if (this.phase <= 0 && d > this.amp) {
      if (this.phase === -1 && this.t - this.last < this.gap) cycle = true;
      this.phase = 1; this.last = this.t;
    } else if (this.phase >= 0 && d < -this.amp) {
      this.phase = -1; this.last = this.t;
    }
    return cycle;
  }
}

class CallWrapped extends Tracker {
  constructor() {
    super({ kind: 'face', numFaces: 1 });
    this.faceLm = null;
    this.lastVideoTime = -1;
    this.reset();
  }

  reset() {
    this.stats = {};
    for (const k of Object.keys(ACTIONS)) this.stats[k] = { count: 0, time: 0, tier: -1 };
    this.onCamera = 0; this.away = 0;
    this.sig = { smile: false, blinkL: false, brow: false, surprise: false, silly: false, look: 0, jawPrev: null, jawEMA: 0 };
    this.nodOsc = new Osc(NOD_AMP, OSC_GAP);
    this.shakeOsc = new Osc(SHAKE_AMP, OSC_GAP);
    this.toasts = [];
    this.showCard = false; this.shockHold = 0; this.cardCooldown = 0;
    this.flash = 0;
  }

  async setup(ctx) {
    // Our own blendshape-enabled face model (base Tracker model isn't used).
    this.faceLm = await loadFaceLandmarker({ numFaces: 1, blendshapes: true });

    // HUD: a 2D canvas drawn every frame, shown on a full-screen plane so it
    // is part of the captured frame.
    this.hud = document.createElement('canvas');
    this.hud.width = 1280; this.hud.height = 720;
    this.hctx = this.hud.getContext('2d');
    this.hudTex = new THREE.CanvasTexture(this.hud);
    this.hudTex.minFilter = this.hudTex.magFilter = THREE.LinearFilter;
    this.hudMat = new THREE.MeshBasicMaterial({ map: this.hudTex, transparent: true, depthTest: false, depthWrite: false });
    this.hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(ctx.width, ctx.height), this.hudMat);
    this.hudMesh.position.set(ctx.width / 2, ctx.height / 2, 5);
    this.hudMesh.frustumCulled = false;
    ctx.scene.add(this.hudMesh);
  }

  update(dt) {
    const ctx = this.ctx; if (!ctx || !ctx.video || ctx.video.readyState < 2) { this.tick(null, null, dt); return; }
    if (ctx.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = ctx.video.currentTime;
      try {
        const r = this.faceLm.detectForVideo(ctx.video, performance.now());
        const lms = r?.faceLandmarks?.[0] || null;
        const B = blendMapFrom(r?.faceBlendshapes?.[0]?.categories);
        this.tick(lms, B, dt);
        return;
      } catch (_e) { /* fall through */ }
    }
    this.tick(this.faceLm ? this._lastLms : null, this._lastB || null, dt);
  }

  // Acquisition-independent core: feed landmarks + blendshape map. Testable.
  tick(lms, B, dt) {
    this._lastLms = lms; this._lastB = B;
    this.cardCooldown = Math.max(0, this.cardCooldown - dt);
    this.flash = Math.max(0, this.flash - dt * 2.5);

    if (lms && B) {
      this.onCamera += dt;
      if (!this.showCard) this.ingest(lms, B, dt);
      this.handleShock(B, dt);
    } else {
      this.away += dt; this.shockHold = 0;
    }

    // animate toasts
    for (const t of this.toasts) t.age += dt;
    this.toasts = this.toasts.filter((t) => t.age < t.life);

    this.draw();
    if (this.ctx) this.ctx.setHud(`CALL WRAPPED · on-cam ${fmt(this.onCamera)} · toasts ${this.toasts.length}`);
  }

  bump(key, n = 1) {
    const s = this.stats[key], cfg = ACTIONS[key];
    s.count += n;
    // fire the highest newly-crossed tier
    for (let i = cfg.tiers.length - 1; i > s.tier; i--) {
      if (s.count >= cfg.tiers[i][0]) { this.fireTier(key, i); break; }
    }
  }
  bumpTime(key, dt) {
    const s = this.stats[key], cfg = ACTIONS[key];
    s.time += dt;
    for (let i = cfg.tiers.length - 1; i > s.tier; i--) {
      if (s.time >= cfg.tiers[i][0]) { this.fireTier(key, i); break; }
    }
  }
  fireTier(key, i) {
    const s = this.stats[key], cfg = ACTIONS[key];
    s.tier = i;
    const [, lvl, msg] = cfg.tiers[i];
    this.toasts.push({ icon: cfg.icon, msg, lvl, age: 0, life: 2.6 + lvl * 0.3 });
    if (this.toasts.length > 4) this.toasts.shift();
    if (lvl >= 4) this.flash = 1;
  }

  ingest(lms, B, dt) {
    const sm = ((B.mouthSmileLeft || 0) + (B.mouthSmileRight || 0)) / 2;
    const bl = Math.max(B.eyeBlinkLeft || 0, B.eyeBlinkRight || 0);
    const br = Math.max(B.browInnerUp || 0, B.browOuterUpLeft || 0, B.browOuterUpRight || 0);
    const jaw = B.jawOpen || 0;

    // smile (hysteresis edge)
    if (!this.sig.smile && sm > SMILE_ON) { this.sig.smile = true; this.bump('smile'); }
    else if (this.sig.smile && sm < SMILE_OFF) this.sig.smile = false;
    if (this.sig.smile) this.stats.smile.time += dt;

    // blink (single eye signal, both share one counter)
    if (!this.sig.blinkL && bl > BLINK_ON) { this.sig.blinkL = true; this.bump('blink'); }
    else if (this.sig.blinkL && bl < BLINK_OFF) this.sig.blinkL = false;

    // brow raise (only when mouth closed → otherwise it reads as surprise)
    if (!this.sig.brow && br > BROW_ON && jaw < 0.3) { this.sig.brow = true; this.bump('brow'); }
    else if (this.sig.brow && br < BROW_OFF) this.sig.brow = false;

    // surprise (open mouth + raised brows)
    if (!this.sig.surprise && jaw > SURP_JAW && br > SURP_BROW) { this.sig.surprise = true; this.bump('surprise'); }
    else if (this.sig.surprise && (jaw < SURP_JAW - 0.1 || br < SURP_BROW - 0.1)) this.sig.surprise = false;

    // silly face (tongue out / cheeks puffed)
    const silly = Math.max(B.tongueOut || 0, B.cheekPuff || 0);
    if (!this.sig.silly && silly > SILLY_ON) { this.sig.silly = true; this.bump('silly'); }
    else if (this.sig.silly && silly < SILLY_OFF) this.sig.silly = false;

    // talking: sustained jaw movement
    if (this.sig.jawPrev != null) {
      this.sig.jawEMA += (Math.abs(jaw - this.sig.jawPrev) / Math.max(dt, 1e-3) * 0.016 - this.sig.jawEMA) * Math.min(1, dt * 5);
      if (this.sig.jawEMA > JAW_TALK) this.bumpTime('talk', dt);
    }
    this.sig.jawPrev = jaw;

    // nod / shake from nose-tip motion, normalised by face width
    const nose = lms[1], cheekL = lms[234], cheekR = lms[454];
    const faceW = Math.hypot(cheekR.x - cheekL.x, cheekR.y - cheekL.y) || 1e-3;
    if (this.nodOsc.feed(nose.y / faceW, dt)) this.bump('nod');
    if (this.shakeOsc.feed(nose.x / faceW, dt)) this.bump('shake');

    // distracted: nose far from face center (turned away) sustained
    const cx = (cheekL.x + cheekR.x) / 2;
    const yaw = Math.abs(nose.x - cx) / faceW;
    if (yaw > LOOK_YAW) {
      this.sig.look += dt;
      if (this.sig.look >= LOOK_HOLD) { this.bump('lookAway'); this.sig.look = -1.2; } // fire once, then re-arm
    } else if (this.sig.look > 0) this.sig.look = 0;
    if (this.sig.look < 0) this.sig.look = Math.min(0, this.sig.look + dt);
  }

  handleShock(B, dt) {
    const shocked = (B.jawOpen || 0) > SHOCK_JAW && (B.browInnerUp || 0) > SHOCK_BROW;
    if (shocked) {
      this.shockHold += dt;
      if (this.shockHold >= SHOCK_HOLD && this.cardCooldown === 0) {
        this.showCard = !this.showCard; this.cardCooldown = 1.5; this.shockHold = 0;
      }
    } else this.shockHold = 0;
  }

  archetype() {
    const s = this.stats;
    const cand = [
      ['THE CHARMER', s.smile.count * 2, 'main character energy, but make it cute'],
      ['THE YES-MAN', s.nod.count * 2.2, 'agreed with literally everything'],
      ['THE SKEPTIC', s.shake.count * 2.5, 'trusted no one. respect.'],
      ['THE DAYDREAMER', s.lookAway.count * 3 + this.away * 0.2, 'physically present. mentally gone.'],
      ['THE MAIN CHARACTER', s.talk.time * 0.06, 'the mic feared you'],
      ['THE DRAMA QUEEN', s.surprise.count * 2.5, 'gasped at literally everything'],
      ['THE CLOWN', s.silly.count * 3, 'this was a serious meeting, allegedly'],
      ['THE NPC', 12 - (s.smile.count + s.nod.count + s.shake.count + s.brow.count
        + s.surprise.count + s.silly.count + s.lookAway.count + s.talk.time * 0.05), 'did you even move?'],
    ];
    cand.sort((a, b) => b[1] - a[1]);
    return cand[0];
  }
  chaosScore() {
    const s = this.stats;
    return Math.round(s.smile.count * 2 + s.nod.count * 2 + s.shake.count * 2 + s.brow.count
      + s.surprise.count * 2 + s.silly.count * 2.5
      + s.blink.count * 0.3 + s.lookAway.count * 3 + s.talk.time * 0.25);
  }

  // ---- HUD drawing ----------------------------------------------------------
  draw() {
    const g = this.hctx, W = 1280, H = 720;
    g.clearRect(0, 0, W, H);

    if (this.showCard) { this.drawCard(g, W, H); this.hudTex.needsUpdate = true; return; }

    if (this.flash > 0) { g.fillStyle = `rgba(255,40,60,${0.18 * this.flash})`; g.fillRect(0, 0, W, H); }

    // counter strip (top-left)
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = '600 30px ui-monospace, Menlo, monospace';
    let x = 36;
    const y = 44;
    for (const k of ORDER) {
      const s = this.stats[k], cfg = ACTIONS[k];
      const val = cfg.kind === 'time' ? fmt(s.time) : s.count;
      if (cfg.kind === 'time' ? s.time < 1 : s.count < 1) continue;
      const txt = `${cfg.icon} ${val}`;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      const w = g.measureText(txt).width + 22;
      this.roundRect(g, x, y - 24, w, 48, 12); g.fill();
      g.fillStyle = '#fff'; g.fillText(txt, x + 11, y + 1);
      x += w + 12;
    }

    // toasts (center, escalating)
    const lvlColor = ['#ffffff', '#dffcff', '#7df9ff', '#ff63c6', '#ffd23f'];
    for (let i = 0; i < this.toasts.length; i++) {
      const t = this.toasts[i];
      const p = Math.min(1, t.age / 0.25);               // slide/scale in
      const fade = Math.min(1, (t.life - t.age) / 0.5);
      const cy = 150 + i * 78;
      const shake = t.lvl >= 3 ? (Math.sin(t.age * 60) * (t.lvl - 2) * 3) : 0;
      const size = 26 + t.lvl * 12;
      g.save();
      g.globalAlpha = Math.min(p, fade);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 ${size}px ui-monospace, Menlo, monospace`;
      const txt = `${t.icon} ${t.msg}`;
      const w = g.measureText(txt).width + 40;
      const bx = W / 2 - w / 2 + shake, by = cy - size * 0.7;
      g.fillStyle = t.lvl >= 4 ? 'rgba(120,0,20,0.78)' : 'rgba(0,0,0,0.6)';
      this.roundRect(g, bx, by, w, size * 1.5, 14); g.fill();
      g.lineWidth = t.lvl >= 3 ? 3 : 1.5;
      g.strokeStyle = lvlColor[t.lvl]; g.stroke();
      g.fillStyle = lvlColor[t.lvl];
      g.fillText(txt, W / 2 + shake, cy);
      g.restore();
    }

    this.hudTex.needsUpdate = true;
  }

  drawCard(g, W, H) {
    g.save();
    g.fillStyle = 'rgba(8,10,18,0.95)'; g.fillRect(0, 0, W, H);
    const [title, , sub] = this.archetype();
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '600 24px ui-monospace, Menlo, monospace';
    g.fillText('— CALL WRAPPED —', W / 2, 54);
    g.fillStyle = '#fff'; g.font = '800 52px Georgia, "Times New Roman", serif';
    g.fillText(title, W / 2, 120);
    g.fillStyle = '#7df9ff'; g.font = 'italic 24px Georgia, serif';
    g.fillText(`"${sub}"`, W / 2, 158);

    // stat grid
    g.font = '600 25px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
    const rows = ORDER.map((k) => {
      const s = this.stats[k], cfg = ACTIONS[k];
      return `${cfg.icon}  ${cfg.label.padEnd(11)} ${cfg.kind === 'time' ? fmt(s.time) : s.count}`;
    });
    rows.push(`🎥  ${'ON CAMERA'.padEnd(11)} ${fmt(this.onCamera)}`);
    let yy = 196;
    g.textAlign = 'left';
    for (const r of rows) { g.fillStyle = '#e8e8ef'; g.fillText(r, W / 2 - 215, yy); yy += 33; }

    g.textAlign = 'center';
    g.fillStyle = '#ffd23f'; g.font = '800 36px ui-monospace, Menlo, monospace';
    g.fillText(`CHAOS SCORE  ${this.chaosScore()}`, W / 2, 560);
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.font = '500 19px ui-monospace, Menlo, monospace';
    g.fillText('shocked face to close', W / 2, 596);
    g.restore();
  }

  roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  resize(w, h) {
    super.resize(w, h);
    if (this.hudMesh) {
      this.hudMesh.geometry.dispose();
      this.hudMesh.geometry = new THREE.PlaneGeometry(w, h);
      this.hudMesh.position.set(w / 2, h / 2, 5);
    }
  }

  teardown() {
    const scene = this.ctx?.scene;
    if (scene && this.hudMesh) scene.remove(this.hudMesh);
    this.hudMesh?.geometry.dispose();
    this.hudMat?.dispose();
    this.hudTex?.dispose();
    this.hudMesh = null;
  }
}

// ===========================================================================
// Preview painter — a mock CALL WRAPPED card.
// ===========================================================================
function preview(c) {
  const W = 320, H = 320;
  c.fillStyle = '#0a0c14'; c.fillRect(0, 0, W, H);
  c.textAlign = 'center';
  c.fillStyle = 'rgba(255,255,255,0.5)'; c.font = '600 12px ui-monospace, monospace';
  c.fillText('— CALL WRAPPED —', W / 2, 40);
  c.fillStyle = '#fff'; c.font = '800 26px Georgia, serif';
  c.fillText('THE YES-MAN', W / 2, 74);
  c.fillStyle = '#7df9ff'; c.font = 'italic 12px Georgia, serif';
  c.fillText('"agreed with everything"', W / 2, 96);
  const rows = ['😊 SMILES   12', '✅ NODS     31', '👀 DISTRACT  4', '💬 TALK   3:20'];
  c.textAlign = 'left'; c.font = '600 15px ui-monospace, monospace'; c.fillStyle = '#e8e8ef';
  let y = 140; for (const r of rows) { c.fillText(r, 70, y); y += 30; }
  c.textAlign = 'center'; c.fillStyle = '#ffd23f'; c.font = '800 20px ui-monospace, monospace';
  c.fillText('CHAOS SCORE 187', W / 2, 286);
}

export default {
  id: 'CallWrapped',
  title: 'CALL WRAPPED',
  subtitle: 'IT IS COUNTING EVERYTHING YOU DO',
  category: 'FACE',
  factory: () => new CallWrapped(),
  preview,
};
