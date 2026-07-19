#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Generate a "pixel face + effect" gallery-tile design for every NEW mask.
//
//   node website/tools/gen-fx.mjs
//
// Reads website/site-catalog.json + the FX keys already present in gallery-fx.js,
// then for each mask NOT yet mapped prints a ready-to-paste registry line:
//     slug: ['effectName', ...args],
// Paste the lines into the FX registry in gallery-fx.js (tune the effect/args by eye if a
// tile reads weak). Anything you DON'T paste still gets a matching tile automatically at
// runtime via MMFX.autoFor(slug, {keywords}) — this script just pre-bakes tuned entries.
//
// The keyword→effect table below MIRRORS the HINTS array in gallery-fx.js — keep them in sync.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(ROOT, 'site-catalog.json'), 'utf8'));
const engine = readFileSync(join(ROOT, 'gallery-fx.js'), 'utf8');

// existing explicit FX keys (parse the `const FX = { ... }` registry block)
const fxBlock = engine.slice(engine.indexOf('const FX = {'), engine.indexOf('// ---------- auto'));
// each registry entry is `slug: [ ... ]`; inner args (bs:, shape:) are never followed by `[`.
const existing = new Set([...fxBlock.matchAll(/([a-z0-9]+)\s*:\s*\[/gim)].map((m) => m[1]));

// keyword -> effect spec (source string). Mirror of HINTS in gallery-fx.js.
const HINTS = [
  [/laser|beam|ray|gaze/, "['beams']"],
  [/fire|flame|burn|breath|dragon|lava/, "['fire']"],
  [/thermal|heat|infrared/, "['recolor', 'thermal']"],
  [/invert|negative/, "['recolor', 'invert']"],
  [/duotone/, "['recolor', 'duotone']"],
  [/poster/, "['recolor', 'posterize']"],
  [/bleach|bypass|wash/, "['recolor', 'bleach']"],
  [/plasma|psych|rainbow|cycle/, "['recolor', 'plasma']"],
  [/caustic|underwater|water|aqua/, "['recolor', 'caustics']"],
  [/halftone|newspaper|dotscreen|print/, "['halftone']"],
  [/sobel|edge|contour/, "['edges', '#28c85a', false]"],
  [/hatch|pencil|sketch/, "['edges', '#e8e4da', true]"],
  [/ascii|glyph|terminal|code|matrix/, "['ascii']"],
  [/hex/, "['pixelate', { bs: 6, shape: 'hex' }]"],
  [/low.?poly|tri/, "['pixelate', { bs: 9, shape: 'tri' }]"],
  [/pixel|mosaic|block|voxel/, "['pixelate', { bs: 6, shape: 'sq' }]"],
  [/vhs|tape|analog/, "['glitch', 'vhs']"],
  [/crt|phosphor/, "['glitch', 'crt']"],
  [/glitch|warp|rgb|noise|corrupt/, "['glitch', 'rgb']"],
  [/kaleid|mandala|symmetry|mirror/, "['kaleido']"],
  [/fisheye|barrel|lens|bulge/, "['warp', 'fisheye']"],
  [/polar|swirl|twist/, "['warp', 'polar']"],
  [/portal|void|vortex|wormhole/, "['portal']"],
  [/feedback|trail|zoom/, "['feedback']"],
  [/echo|ghost/, "['echo', 'h']"],
  [/pose|strobe/, "['echo', 'pose']"],
  [/headbang|concert|beat|shake/, "['echo', 'bang']"],
  [/snow|frost/, "['snow']"],
  [/rain|drip|drop/, "['rain']"],
  [/gravity|melt|sag/, "['drip', 'melt']"],
  [/ice.?cream|cone|scoop/, "['icecream']"],
  [/mesh|wire/, "['mesh']"],
  [/dots|landmark|mediapipe|point/, "['dots']"],
  [/fill|neon.?mask/, "['fill']"],
  [/stare|blink|eye/, "['stare']"],
  [/glass|shade|spectacle/, "['glasses']"],
  [/cat|paw|claw|swipe|attack|slap/, "['paw']"],
  [/paint|draw|brush/, "['sparkles', 'paint']"],
  [/spell|magic|spark|glitter|star|gesture/, "['sparkles', 'spell']"],
  [/aura|mood|halo/, "['aura']"],
  [/bloom|glow|highlight/, "['bloom']"],
  [/shard|shatter|tear|crack|break|glass|dimension|voronoi/, "['shatter', '#7c6bff']"],
  [/scan|reveal|x.?ray|slice/, "['scanreveal']"],
  [/face|head/, "['dots']"],
];
const DEFAULT = "['recolor', 'plasma']";
const pick = (text) => { for (const [re, spec] of HINTS) if (re.test(text)) return spec; return DEFAULT; };

const fresh = (catalog.masks || []).filter((m) => !existing.has(String(m.slug).toLowerCase()));
if (!fresh.length) {
  console.log(`// All ${(catalog.masks || []).length} masks already have an explicit FX entry — nothing to add.`);
  process.exit(0);
}
console.log(`// ${fresh.length} new mask(s) — paste into the FX registry in gallery-fx.js:`);
for (const m of fresh) {
  const spec = pick(`${m.slug} ${m.title || ''} ${m.subtitle || ''}`.toLowerCase());
  console.log(`    ${String(m.slug).toLowerCase()}: ${spec},`);
}
