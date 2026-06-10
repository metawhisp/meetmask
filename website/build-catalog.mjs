// Build site-catalog.json for the gallery from the runtime metadata emitted by
// the capture harness (china_web/tools/capture.html -> _catalog.json). Single
// source of truth is the live effect registry, so ids/slugs match the captured
// preview filenames exactly. No file regex, no hand-typed mask data.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const SITE = '/Users/android/meetamask-site';
const intermediate = `${SITE}/assets/masks/_catalog.json`;
const masks = JSON.parse(readFileSync(intermediate, 'utf8'));

const out = { schemaVersion: 1, count: masks.length, masks };
writeFileSync(`${SITE}/site-catalog.json`, JSON.stringify(out, null, 2) + '\n');
rmSync(intermediate, { force: true }); // build intermediate — never ship it

const byCat = masks.reduce((a, m) => ((a[m.category] = (a[m.category] || 0) + 1), a), {});
console.log(`site-catalog.json: ${masks.length} masks`, byCat);
