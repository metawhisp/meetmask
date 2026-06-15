// Effect registry. To add an effect:
//   1. Create a file in ./registry/<name>.js exporting `default { id, title, ..., shader }`
//   2. Add an import line below + push to RAW.
// That's it — the launcher picks it up automatically.
//
// See README-effects.md for shader templates and the full list of helpers.

import { makeShaderEffect } from './core/BaseShaderEffect.js';

import ascii        from './registry/ascii.js';
import warp         from './registry/warp.js';
import thermal      from './registry/thermal.js';
import halftone     from './registry/halftone.js';
import sobel        from './registry/sobel.js';
import invert       from './registry/invert.js';
import mosaic       from './registry/mosaic.js';
import kaleidoscope from './registry/kaleidoscope.js';
import vhs          from './registry/vhs.js';
import duotone      from './registry/duotone.js';
import posterize    from './registry/posterize.js';
import caustics     from './registry/caustics.js';
import fisheye      from './registry/fisheye.js';
import bleach       from './registry/bleach.js';
import hexpixel     from './registry/hexpixel.js';
import polar        from './registry/polar.js';
import lineRain     from './registry/lineRain.js';
import crosshatch   from './registry/crosshatch.js';
import plasma       from './registry/plasma.js';
import bloom        from './registry/bloom.js';

import faceDots     from './registry/faceDots.js';
import faceMesh     from './registry/faceMesh.js';
import faceFill     from './registry/faceFill.js';
import faceLines    from './registry/faceLines.js';
import eyeZoom      from './registry/eyeZoom.js';
import eyeLasers    from './registry/eyeLasers.js';

// Narrative AR effects (3D objects + physics + gestures).
import glasses      from './registry/glasses.js';
import iceCream     from './registry/iceCream.js';
import mouthFire    from './registry/mouthFire.js';
import faceMask     from './registry/faceMask.js';
import fingerPaint  from './registry/fingerPaint.js';

// Tier-S viral presets — all 11 now active. The "everything was invisible"
// bug they originally exposed was a back-face-culling issue in Tracker base
// (Y-flipped ortho camera flips triangle winding → default FrontSide
// materials get culled). Fixed in Tracker.init by patching ctx.scene.add to
// force DoubleSide on every added material.
import catAttack     from './registry/catAttack.js';
import snowPile      from './registry/snowPile.js';
import realityTear   from './registry/realityTear.js';
import gestureSpells from './registry/gestureSpells.js';
import timeEcho      from './registry/timeEcho.js';
import faceGravity   from './registry/faceGravity.js';
import auraScan      from './registry/auraScan.js';
import headbang      from './registry/headbang.js';
import portalPull    from './registry/portalPull.js';
import stareOff      from './registry/stareOff.js';
import poseStages    from './registry/poseStages.js';
import flow          from './registry/flow.js';
import sandbox       from './registry/sandbox.js';
import callWrapped   from './registry/callwrapped.js';

import scan         from './registry/scan.js';
import pixelDrift   from './registry/pixelDrift.js';
import shards       from './registry/shards.js';
import crt          from './registry/crt.js';
import feedback     from './registry/feedback.js';

const RAW = [
  // VIRAL — adding back one at a time.
  catAttack, snowPile, realityTear, gestureSpells, portalPull, flow, sandbox,
  callWrapped,
  faceGravity, headbang, auraScan, stareOff, poseStages, timeEcho,
  // Narrative AR (3D objects + physics + gestures).
  glasses, iceCream, mouthFire, faceMask, fingerPaint,
  // Pixel-driven shader effects.
  ascii, warp, thermal, halftone, sobel, invert, mosaic, kaleidoscope, vhs,
  duotone, posterize, caustics, fisheye, bleach, hexpixel, polar, lineRain,
  crosshatch, plasma, bloom,
  // Original face-only effects + new ones.
  eyeLasers, faceDots, faceMesh, faceFill, faceLines, eyeZoom,
  // Pointer-driven oddities.
  scan, pixelDrift, shards, crt, feedback,
];

function normalize(entry) {
  if (typeof entry !== 'object' || !entry.id) {
    throw new Error('Effect entry is missing an `id`: ' + JSON.stringify(entry));
  }
  if (entry.factory) return entry;
  if (entry.shader || entry.fullShader) {
    const spec = {
      shader:     entry.shader || '',
      fullShader: entry.fullShader,
      uniforms:   entry.uniforms,
      hud:        entry.hud,
    };
    return { ...entry, factory: () => makeShaderEffect(spec) };
  }
  throw new Error(`Effect "${entry.id}" must define one of: shader, fullShader, factory`);
}

export const EFFECTS = RAW.map(normalize);

export const CATEGORIES = (() => {
  const order = [];
  const seen = new Set();
  for (const e of EFFECTS) {
    const c = e.category || 'PUBLIC';
    if (!seen.has(c)) { seen.add(c); order.push(c); }
  }
  return order;
})();
