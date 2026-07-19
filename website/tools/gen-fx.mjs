#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Generate a 16-bit + ASCII gallery tile design for every NEW mask.
//
//   node website/tools/gen-fx.mjs
//
// Reads website/site-catalog.json + the FX keys already present in gallery-fx.js,
// then for each mask NOT yet mapped prints a ready-to-paste registry line:
//     slug: { f: M.motif({...}), pal: PAL.name },
// Paste the lines into the FX registry in gallery-fx.js (tune params by eye if a tile
// reads weak). Anything you DON'T paste still gets a matching tile automatically at
// runtime via MMFX.autoFor(slug, {keywords}) — this script just pre-bakes tuned entries.
//
// The keyword→motif table below MIRRORS autoFor() in gallery-fx.js — keep them in sync.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(ROOT, 'site-catalog.json'), 'utf8'));
const engine = readFileSync(join(ROOT, 'gallery-fx.js'), 'utf8');

// existing explicit FX keys (parse the `const FX = { ... }` block)
const fxBlock = engine.slice(engine.indexOf('const FX = {'), engine.indexOf('function draw'));
const existing = new Set([...fxBlock.matchAll(/^\s{4}([a-z0-9]+):\s*\{/gim)].map((m) => m[1]));

const HINTS = [
  [/fire|flame|burn|lava|ember|torch/, 'M.flames({ sp: 6 })', 'fire'],
  [/laser|beam|ray/, 'M.beams({ sp: 3 })', 'red'],
  [/portal|void|vortex|wormhole|spiral|swirl|polar|feedback|twist/, 'M.spiral({ sp: 3 })', 'violet'],
  [/eye|stare|gaze|blink|pupil/, 'M.eyes({ sp: 1.2 })', 'cyan'],
  [/thermal|heat|infrared|warm/, 'M.radial({ sp: 1.6, rings: 5 })', 'heat'],
  [/echo|ripple|sonar|expand|zoom/, 'M.rings({ sp: 1.2 })', 'violet'],
  [/aura|glow|bloom|halo|neon|pulse|fill/, 'M.radial({ sp: 2, rings: 3, amp: 0.2 })', 'pink'],
  [/matrix|ascii|code|terminal|glyph|type|char/, 'M.streaks({ sp: 1.2, thr: 0.45, rows: 2, head: 1 })', 'green'],
  [/rain|drip|snow|fall|tears|melt|gravity|ice.?cream/, 'M.streaks({ sp: 1, thr: 0.4, rows: 1.6 })', 'ice'],
  [/glitch|vhs|crt|analog|tape|\btv\b|scanline|invert|corrupt|noise/, 'M.glitch({ sp: 2.8 })', 'amber'],
  [/kaleid|mandala|symmetry|mirror/, 'M.kaleido({ sp: 2 })', 'rainbow'],
  [/pixel|mosaic|block|hex|voxel|low.?poly/, 'M.blocks({ bs: 3, sp: 1.1 })', 'rainbow'],
  [/wire|mesh/, 'M.mesh({ sp: 1 })', 'cyan'],
  [/dot|landmark|point|stipple/, 'M.dots({ sp: 2 })', 'cyan'],
  [/hatch|pencil|sketch|cross/, 'M.hatch({ sp: 1 })', 'ink'],
  [/edge|sobel|outline|contour|line/, 'M.outline({ sp: 1.4 })', 'green'],
  [/shard|shatter|tear|crack|break|split|dimension|glass/, 'M.shatter({ sp: 1 })', 'toxic'],
  [/scan|reveal|x.?ray|slice/, 'M.scan({ sp: 0.4 })', 'cyan'],
  [/spark|magic|spell|glitter|star|paint|confetti|gesture/, 'M.particles({ n: 6, sp: 1.4 })', 'rainbow'],
  [/cat|claw|paw|swipe|hit|punch|attack|slap/, 'M.particles({ n: 5, sp: 2.2, size: 3.6 })', 'amber'],
  [/halftone|dotscreen|newspaper|print/, 'M.radial({ sp: 0.8, rings: 2, amp: 0.05 })', 'ink'],
  [/plasma|caustic|liquid|wave|warp|drift|flow|psych|trip/, 'M.plasma({ sp: 1.3, sc: 0.4 })', 'rainbow'],
  [/duotone|posterize|bleach|grade|tone|color/, 'M.plasma({ sp: 1, sc: 0.35 })', 'pink'],
  [/headbang|concert|energy|shake|beat/, 'M.flames({ sp: 7, w: 0.5 })', 'amber'],
  [/face|head/, 'M.outline({ sp: 1.3 })', 'cyan'],
];
const pick = (text) => { for (const [re, code, pal] of HINTS) if (re.test(text)) return [code, pal]; return ['M.plasma({ sp: 1.2, sc: 0.42 })', 'rainbow']; };

const fresh = (catalog.masks || []).filter((m) => !existing.has(String(m.slug).toLowerCase()));
if (!fresh.length) {
  console.log(`// All ${(catalog.masks || []).length} masks already have an explicit FX entry — nothing to add.`);
  process.exit(0);
}
console.log(`// ${fresh.length} new mask(s) — paste into the FX registry in gallery-fx.js:`);
for (const m of fresh) {
  const [code, pal] = pick(`${m.slug} ${m.title || ''} ${m.subtitle || ''}`.toLowerCase());
  console.log(`    ${String(m.slug).toLowerCase()}: { f: ${code}, pal: PAL.${pal} },`);
}
